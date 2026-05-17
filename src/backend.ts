declare const spindle: any;

import {
  METADATA_KEY,
  SETTINGS_PATH,
  VERSION,
  type ActiveChatState,
  type ChatMessageDTO,
  type ChatTracktorConfig,
  type FrontendState,
  type LlmMessageDTO,
  type MessageRole,
  type SchemaPreset,
  type TrackerRecord,
  type TrackerSummary,
  type TracktorSettings,
  buildTopLevelPartSchema,
  chatConfigPath,
  defaultSettings,
  deepMergeSettings,
  formatTrackerSnapshot,
  getSchemaPreset,
  getTopLevelSchemaKeys,
  renderTrackerTemplate,
  safePreview,
  schemaToExample,
} from './shared.js';
import { parseJsonTrackerResponse } from './parser.js';

let settingsCache: TracktorSettings | undefined;
let busy = false;
let lastError: string | undefined;
let interceptorRegistered = false;

async function loadSettings(): Promise<TracktorSettings> {
  if (settingsCache) return settingsCache;
  const saved = await spindle.storage.getJson(SETTINGS_PATH, { fallback: defaultSettings });
  settingsCache = deepMergeSettings(saved);
  await spindle.storage.setJson(SETTINGS_PATH, settingsCache, { indent: 2 });
  return settingsCache;
}

async function saveSettings(settings: TracktorSettings): Promise<TracktorSettings> {
  settingsCache = deepMergeSettings(settings);
  await spindle.storage.setJson(SETTINGS_PATH, settingsCache, { indent: 2 });
  return settingsCache;
}

async function loadChatConfig(chatId: string): Promise<ChatTracktorConfig> {
  return spindle.storage.getJson(chatConfigPath(chatId), { fallback: {} });
}

async function saveChatConfig(chatId: string, config: ChatTracktorConfig): Promise<void> {
  await spindle.storage.setJson(chatConfigPath(chatId), config, { indent: 2 });
}

function hasPermission(permission: string): boolean {
  try {
    return !!spindle.permissions?.has?.(permission);
  } catch {
    return false;
  }
}

function permissionWarnings(): string[] {
  const warnings: string[] = [];
  for (const permission of ['generation', 'chats', 'chat_mutation', 'interceptor', 'ui_panels', 'app_manipulation']) {
    if (!hasPermission(permission)) warnings.push(permission);
  }
  return warnings;
}

async function buildState(): Promise<FrontendState> {
  const settings = await loadSettings();
  return {
    settings,
    activeChat: await getActiveChatState(settings),
    permissionWarnings: permissionWarnings(),
    busy,
    ...(lastError ? { lastError } : {}),
  };
}

async function sendState(userId?: string): Promise<void> {
  spindle.sendToFrontend({ type: 'state', state: await buildState() }, userId);
}

async function getActiveChatState(settings: TracktorSettings): Promise<ActiveChatState | null> {
  if (!hasPermission('chats') || !hasPermission('chat_mutation')) {
    return null;
  }

  const chat = await spindle.chats.getActive();
  if (!chat) return null;
  const messages = await spindle.chat.getMessages(chat.id) as ChatMessageDTO[];
  return {
    id: chat.id,
    name: chat.name ?? 'Active chat',
    messageCount: messages.length,
    trackers: collectTrackerSummaries(chat.id, messages, settings),
  };
}

function collectTrackerSummaries(chatId: string, messages: ChatMessageDTO[], settings: TracktorSettings): TrackerSummary[] {
  return messages.flatMap((message) => {
    const tracker = readTrackerRecord(message);
    if (!tracker) return [];
    const preset = settings.schemaPresets[tracker.schemaId];
    const renderedHtml = safeRenderTracker(tracker.templateHtml || preset?.templateHtml || '', tracker.data);
    return [{
      chatId,
      messageId: message.id,
      role: message.role,
      messagePreview: safePreview(message.content || ''),
      tracker: {
        ...tracker,
        renderedHtml,
      },
    }];
  });
}

function readTrackerRecord(message: ChatMessageDTO): TrackerRecord | undefined {
  const metadata = message.metadata;
  const candidate = metadata?.[METADATA_KEY];
  if (!candidate || typeof candidate !== 'object') return undefined;
  const record = candidate as TrackerRecord;
  if (!record.data || !record.sourceMessageId) return undefined;
  return record;
}

function resolveTargetMessage(messages: ChatMessageDTO[], requestedMessageId?: string): ChatMessageDTO {
  if (requestedMessageId) {
    const found = messages.find((message) => message.id === requestedMessageId);
    if (!found) throw new Error(`Message not found: ${requestedMessageId}`);
    return found;
  }

  const preferred = [...messages].reverse().find((message) => message.role === 'assistant') ?? messages[messages.length - 1];
  if (!preferred) throw new Error('No messages are available in the active chat.');
  return preferred;
}

async function generateTrackerForMessage(options: {
  chatId?: string;
  messageId?: string;
  sequential?: boolean;
  userId?: string;
}): Promise<TrackerRecord> {
  if (!hasPermission('generation')) throw new Error('Generation permission is not granted.');
  if (!hasPermission('chat_mutation')) throw new Error('Chat mutation permission is not granted.');

  const settings = await loadSettings();
  const chat = options.chatId
    ? { id: options.chatId }
    : await spindle.chats.getActive();
  if (!chat?.id) throw new Error('No active chat is open.');

  const messages = await spindle.chat.getMessages(chat.id) as ChatMessageDTO[];
  const target = resolveTargetMessage(messages, options.messageId);
  const targetIndex = messages.findIndex((message) => message.id === target.id);
  const chatConfig = await loadChatConfig(chat.id);
  const preset = getSchemaPreset(settings, chatConfig.schemaId);
  const sequential = options.sequential ?? settings.sequentialPartGeneration;
  const data = sequential
    ? await generateTrackerSequential(messages, targetIndex, settings, preset, options.userId)
    : await generateTrackerFull(messages, targetIndex, settings, preset, options.userId);

  const record = makeTrackerRecord(target.id, preset, data);
  await persistTrackerRecord(chat.id, target, record, settings);
  return record;
}

async function generateTrackerFull(
  messages: ChatMessageDTO[],
  targetIndex: number,
  settings: TracktorSettings,
  preset: SchemaPreset,
  userId?: string,
): Promise<unknown> {
  const prompt = buildTrackerPrompt(messages, targetIndex, settings, preset);
  return requestJsonForSchema(prompt, preset.schema, 'tracktor_tracker', settings, userId);
}

async function generateTrackerSequential(
  messages: ChatMessageDTO[],
  targetIndex: number,
  settings: TracktorSettings,
  preset: SchemaPreset,
  userId?: string,
): Promise<Record<string, unknown>> {
  const keys = getTopLevelSchemaKeys(preset.schema);
  if (keys.length === 0) throw new Error('The active tracker schema has no top-level properties.');

  const tracker: Record<string, unknown> = {};
  for (const key of keys) {
    const partSchema = buildTopLevelPartSchema(preset.schema, key);
    const prompt = buildTrackerPrompt(messages, targetIndex, settings, preset, {
      partKey: key,
      trackerSoFar: tracker,
    });
    const part = await requestJsonForSchema(prompt, partSchema, `tracktor_${key}`, settings, userId);
    if (!part || typeof part !== 'object' || !(key in (part as Record<string, unknown>))) {
      throw new Error(`Part response did not include "${key}".`);
    }
    tracker[key] = (part as Record<string, unknown>)[key];
  }
  return tracker;
}

async function requestJsonForSchema(
  promptMessages: LlmMessageDTO[],
  schema: Record<string, unknown>,
  schemaName: string,
  settings: TracktorSettings,
  userId?: string,
): Promise<unknown> {
  const parameters: Record<string, unknown> = {
    max_tokens: settings.maxResponseTokens,
  };

  const messages = [...promptMessages];
  if (settings.generationMode === 'native_json') {
    parameters.response_format = {
      type: 'json_schema',
      json_schema: {
        name: schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48),
        strict: true,
        schema,
      },
    };
  } else {
    messages.push({
      role: 'user',
      content: buildJsonFormatInstruction(schema),
    });
  }

  const result = await spindle.generate.quiet({
    type: 'quiet',
    messages,
    parameters,
    ...(userId ? { userId } : {}),
  });

  if (result?.content && typeof result.content === 'object') {
    return result.content;
  }

  const content = typeof result?.content === 'string' ? result.content : JSON.stringify(result?.content ?? '');
  const parsed = parseJsonTrackerResponse(content);
  if (settings.debugLogging && parsed.repairSteps.length > 0) {
    spindle.log.info(`Tracktor parser repair steps: ${parsed.repairSteps.join(', ')}`);
  }
  return parsed.data;
}

function buildTrackerPrompt(
  messages: ChatMessageDTO[],
  targetIndex: number,
  settings: TracktorSettings,
  preset: SchemaPreset,
  options: { partKey?: string; trackerSoFar?: Record<string, unknown> } = {},
): LlmMessageDTO[] {
  const start = Math.max(0, targetIndex - settings.includeLastMessages + 1);
  const recent = messages.slice(start, targetIndex + 1);
  const priorTrackers = collectPriorTrackers(messages.slice(0, targetIndex + 1), settings.includeLastTrackers);
  const target = messages[targetIndex];
  const partLine = options.partKey
    ? `Generate only the top-level "${options.partKey}" property and return it wrapped in a JSON object.`
    : 'Generate the complete tracker object.';

  const prompt: LlmMessageDTO[] = [
    { role: 'system', content: settings.systemPrompt },
    {
      role: 'user',
      content: [
        settings.extractionPrompt,
        partLine,
        `Active schema preset: ${preset.name}`,
        `Target message id: ${target.id}`,
      ].join('\n'),
    },
  ];

  if (priorTrackers.length > 0) {
    prompt.push({
      role: 'user',
      content: `Previous tracker snapshots for continuity:\n\n${priorTrackers.map((record) => formatTrackerSnapshot(record, record.schemaName)).join('\n\n')}`,
    });
  }

  if (options.trackerSoFar && Object.keys(options.trackerSoFar).length > 0) {
    prompt.push({
      role: 'user',
      content: `Tracker fields already generated in this run:\n\`\`\`json\n${JSON.stringify(options.trackerSoFar, null, 2)}\n\`\`\``,
    });
  }

  prompt.push({
    role: 'user',
    content: `Recent conversation up to the target message:\n\n${formatConversation(recent)}`,
  });

  return prompt;
}

function buildJsonFormatInstruction(schema: Record<string, unknown>): string {
  return [
    'Return only one valid JSON object. Do not include markdown fences, commentary, or prose outside JSON.',
    'The object must conform to this JSON Schema:',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    'Example shape:',
    '```json',
    JSON.stringify(schemaToExample(schema), null, 2),
    '```',
  ].join('\n');
}

function formatConversation(messages: ChatMessageDTO[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()} (${message.id}):\n${message.content.trim()}`)
    .join('\n\n');
}

function collectPriorTrackers(messages: ChatMessageDTO[], limit: number): TrackerRecord[] {
  if (limit <= 0) return [];
  const found: TrackerRecord[] = [];
  for (let i = messages.length - 1; i >= 0 && found.length < limit; i -= 1) {
    const record = readTrackerRecord(messages[i]);
    if (record) found.unshift(record);
  }
  return found;
}

function makeTrackerRecord(messageId: string, preset: SchemaPreset, data: unknown): TrackerRecord {
  return {
    version: VERSION,
    schemaId: preset.id,
    schemaName: preset.name,
    schema: preset.schema,
    templateHtml: preset.templateHtml,
    data,
    renderedHtml: safeRenderTracker(preset.templateHtml, data),
    updatedAt: new Date().toISOString(),
    sourceMessageId: messageId,
  };
}

function safeRenderTracker(templateHtml: string, data: unknown): string {
  try {
    return renderTrackerTemplate(templateHtml, data);
  } catch (error) {
    return `<pre>${escapeForPre(JSON.stringify(data, null, 2))}</pre>`;
  }
}

function escapeForPre(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function persistTrackerRecord(
  chatId: string,
  message: ChatMessageDTO,
  record: TrackerRecord,
  settings: TracktorSettings,
): Promise<void> {
  const nextMetadata = {
    ...(message.metadata ?? {}),
    [METADATA_KEY]: record,
  };
  await spindle.chat.updateMessage(chatId, message.id, { metadata: nextMetadata });

  if (settings.chatVariableExport.enabled) {
    await spindle.variables.chat.set(chatId, settings.chatVariableExport.key, JSON.stringify(record.data));
  }
}

async function updateTrackerData(chatId: string, messageId: string, data: unknown): Promise<void> {
  const settings = await loadSettings();
  const messages = await spindle.chat.getMessages(chatId) as ChatMessageDTO[];
  const message = messages.find((item) => item.id === messageId);
  if (!message) throw new Error(`Message not found: ${messageId}`);

  const current = readTrackerRecord(message);
  const preset = getSchemaPreset(settings, current?.schemaId);
  const record = makeTrackerRecord(messageId, current ? {
    id: current.schemaId,
    name: current.schemaName,
    schema: current.schema,
    templateHtml: current.templateHtml,
  } : preset, data);
  await persistTrackerRecord(chatId, message, record, settings);
}

async function deleteTracker(chatId: string, messageId: string): Promise<void> {
  const messages = await spindle.chat.getMessages(chatId) as ChatMessageDTO[];
  const message = messages.find((item) => item.id === messageId);
  if (!message) throw new Error(`Message not found: ${messageId}`);
  const nextMetadata = { ...(message.metadata ?? {}) };
  delete nextMetadata[METADATA_KEY];
  await spindle.chat.updateMessage(chatId, messageId, { metadata: nextMetadata });
}

async function setBusy<T>(work: () => Promise<T>, userId?: string): Promise<T> {
  busy = true;
  lastError = undefined;
  await sendState(userId);
  try {
    return await work();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    busy = false;
    await sendState(userId);
  }
}

function parsePayloadJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return parseJsonTrackerResponse(value).data;
}

spindle.onFrontendMessage(async (payload: any, userId: string | undefined) => {
  try {
    switch (payload?.type) {
      case 'get_state':
        await sendState(userId);
        break;

      case 'save_settings': {
        await saveSettings(payload.settings);
        spindle.toast.success('Settings saved.', { title: 'Tracktor' });
        await sendState(userId);
        break;
      }

      case 'set_chat_schema': {
        if (!payload.chatId || !payload.schemaId) throw new Error('chatId and schemaId are required.');
        await saveChatConfig(payload.chatId, { schemaId: payload.schemaId });
        spindle.toast.success('Chat schema updated.', { title: 'Tracktor' });
        await sendState(userId);
        break;
      }

      case 'generate_tracker':
        await setBusy(async () => {
          await generateTrackerForMessage({
            chatId: payload.chatId,
            messageId: payload.messageId,
            sequential: payload.sequential,
            userId,
          });
          spindle.toast.success('Tracker generated.', { title: 'Tracktor' });
        }, userId);
        break;

      case 'update_tracker':
        await setBusy(async () => {
          await updateTrackerData(payload.chatId, payload.messageId, parsePayloadJson(payload.data));
          spindle.toast.success('Tracker updated.', { title: 'Tracktor' });
        }, userId);
        break;

      case 'delete_tracker':
        await setBusy(async () => {
          await deleteTracker(payload.chatId, payload.messageId);
          spindle.toast.success('Tracker deleted.', { title: 'Tracktor' });
        }, userId);
        break;

      default:
        spindle.log.warn(`Unknown frontend message: ${JSON.stringify(payload)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastError = message;
    spindle.toast.error(message, { title: 'Tracktor', duration: 10000 });
    await sendState(userId);
  }
});

spindle.on('CHARACTER_MESSAGE_RENDERED', async (payload: any) => {
  const settings = await loadSettings();
  if (settings.autoMode !== 'assistant_message') return;
  try {
    await generateTrackerForMessage({ chatId: payload.chatId, messageId: payload.messageId });
    await sendState();
  } catch (error) {
    spindle.log.warn(`Auto tracker generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

spindle.on('USER_MESSAGE_RENDERED', async (payload: any) => {
  const settings = await loadSettings();
  if (settings.autoMode !== 'user_message') return;
  try {
    await generateTrackerForMessage({ chatId: payload.chatId, messageId: payload.messageId });
    await sendState();
  } catch (error) {
    spindle.log.warn(`Auto tracker generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

spindle.on('CHAT_CHANGED', async () => {
  await sendState();
});

function tryRegisterInterceptor(): void {
  if (interceptorRegistered || !hasPermission('interceptor')) return;
  spindle.registerInterceptor(async (messages: LlmMessageDTO[], context: any) => {
    const settings = await loadSettings();
    if (!settings.injection.enabled || settings.injection.includeLastTrackers <= 0) {
      return messages;
    }
    const chatId = context?.chatId;
    if (!chatId || !hasPermission('chat_mutation')) return messages;
    const chatMessages = await spindle.chat.getMessages(chatId) as ChatMessageDTO[];
    const trackers = collectPriorTrackers(chatMessages, settings.injection.includeLastTrackers);
    if (trackers.length === 0) return messages;

    const injected = trackers.map((tracker) => ({
      role: settings.injection.role,
      content: formatTrackerSnapshot(tracker, settings.injection.header || tracker.schemaName),
    }));

    return {
      messages: [...injected, ...messages],
      breakdown: injected.map((_message, index) => ({
        messageIndex: index,
        name: 'Tracktor Snapshot',
      })),
    };
  }, 80);
  interceptorRegistered = true;
  spindle.log.info('Tracktor interceptor registered.');
}

spindle.permissions?.onChanged?.(({ permission, granted }: { permission: string; granted: boolean }) => {
  if (permission === 'interceptor' && granted) {
    tryRegisterInterceptor();
  }
});

void loadSettings().then(() => {
  tryRegisterInterceptor();
  spindle.log.info('Tracktor backend loaded.');
});
