declare const spindle: any;

import {
  DIAGNOSTICS_PATH,
  METADATA_KEY,
  SCHEMA_PRESETS_PATH,
  SETTINGS_PATH,
  VERSION,
  type ActiveChatState,
  type ChatMessageDTO,
  type ChatTracktorConfig,
  type ConnectionOption,
  type FrontendState,
  type LlmMessageDTO,
  type MessageRole,
  type SchemaPreset,
  type TemplateEngine,
  type StructuredOutputMode,
  type TrackerJobState,
  type TrackerMetadataMirror,
  type TrackerRecord,
  type TrackerSnapshot,
  type TrackerSnapshotFile,
  type TrackerSummary,
  type TracktorSettings,
  buildTopLevelPartSchema,
  chatConfigPath,
  deepMergeSettings,
  defaultSchemaPresets,
  defaultSettings,
  formatTrackerSnapshot,
  getTemplateCompatibilityWarnings,
  getSchemaPreset,
  getTopLevelSchemaKeys,
  assertTrackerTemplateRenders,
  isPlainObject,
  jobsPath,
  safePreview,
  safeRenderTracker,
  sanitizeSchemaPresetMap,
  schemaPresetNeedsMigration,
  schemaToExample,
  settingsForStorage,
  snapshotToRecord,
  snapshotsPath,
} from './shared.js';
import { parseJsonTrackerResponse } from './parser.js';

type FrontendMessage = Record<string, any>;

interface TrackerPresetRuntime {
  schema: Record<string, unknown>;
  renderTemplate: string;
  systemPrompt: string;
  trackerInstructionPrompt: string;
  jsonPromptTemplate: string;
  xmlPromptTemplate: string;
  toonPromptTemplate: string;
  structuredOutputMode: StructuredOutputMode;
  templateEngine: TemplateEngine;
}

interface BackendJob {
  state: TrackerJobState;
  userId: string;
  controller: AbortController;
}

const settingsCache = new Map<string, TracktorSettings>();
const activeJobs = new Map<string, BackendJob>();
const lastErrors = new Map<string, string>();
const diagnostics = new Map<string, string[]>();
const chatUserIds = new Map<string, string>();
const connectionListWarnings = new Set<string>();
const connectionStateWarnings = new Set<string>();
const generationDiagnostics = new Set<string>();
let lastFrontendUserId: string | null = null;
let interceptorRegistered = false;

function setUserFromFrontend(userId: string | undefined, chatId?: string | null): void {
  if (userId) lastFrontendUserId = userId;
  if (userId && chatId) chatUserIds.set(chatId, userId);
}

function resolveUserId(chatId?: string | null, explicitUserId?: string | null): string | null {
  if (explicitUserId) return explicitUserId;
  if (chatId) {
    const mapped = chatUserIds.get(chatId);
    if (mapped) return mapped;
  }
  return lastFrontendUserId;
}

function requireUserId(userId?: string | null): string {
  if (!userId) {
    throw new Error('Tracktor could not resolve the Lumiverse userId. Open the Tracktor drawer once, then retry.');
  }
  return userId;
}

function send(userId: string | null | undefined, payload: unknown): void {
  if (!userId) {
    spindle.log.warn(`Tracktor skipped frontend send without userId: ${JSON.stringify(payload).slice(0, 220)}`);
    return;
  }
  spindle.sendToFrontend(payload, userId);
}

async function addDiagnostic(userId: string | null | undefined, message: string): Promise<void> {
  const target = userId ?? lastFrontendUserId;
  spindle.log.warn(message);
  if (!target) return;
  const list = [message, ...(diagnostics.get(target) ?? [])].slice(0, 12);
  diagnostics.set(target, list);
  await spindle.userStorage.setJson(DIAGNOSTICS_PATH, { messages: list, updatedAt: Date.now() }, { indent: 2, userId: target }).catch(() => {});
  send(target, { type: 'diagnostic', message });
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

async function listConnectionProfiles(userId: string): Promise<ConnectionOption[]> {
  if (typeof spindle.connections?.list !== 'function') return [];
  try {
    const raw = await spindle.connections.list(userId);
    const entries: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.connections)
        ? raw.connections
        : Array.isArray(raw?.profiles)
          ? raw.profiles
          : Array.isArray(raw?.items)
            ? raw.items
            : [];
    return entries
      .flatMap((entry: unknown) => normalizeConnectionOption(entry))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (!connectionListWarnings.has(userId)) {
      connectionListWarnings.add(userId);
      await addDiagnostic(userId, `Tracktor could not list Lumiverse connection profiles: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
}

function normalizeConnectionOption(input: unknown): ConnectionOption[] {
  if (!isPlainObject(input)) return [];
  const id = readConnectionString(input.id) || readConnectionString(input.connection_id) || readConnectionString(input.key);
  if (!id) return [];
  const name = readConnectionString(input.name)
    || readConnectionString(input.label)
    || readConnectionString(input.displayName)
    || id;
  const provider = readConnectionString(input.provider) || readConnectionString(input.providerName);
  const model = readConnectionString(input.model) || readConnectionString(input.modelName);
  return [{
    id,
    name,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  }];
}

function readConnectionString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadSettings(userId: string): Promise<TracktorSettings> {
  const cached = settingsCache.get(userId);
  if (cached) return cached;

  const [savedSettings, savedSchemas, savedDiagnostics] = await Promise.all([
    spindle.userStorage.getJson(SETTINGS_PATH, { fallback: defaultSettings, userId }).catch(() => defaultSettings),
    spindle.userStorage.getJson(SCHEMA_PRESETS_PATH, { fallback: null, userId }).catch(() => null),
    spindle.userStorage.getJson(DIAGNOSTICS_PATH, { fallback: { messages: [] }, userId }).catch(() => ({ messages: [] })),
  ]);
  const rawSchemaPresets = savedSchemas ?? (isPlainObject(savedSettings) ? savedSettings.schemaPresets : null);
  const migrationNeeded = schemaPresetNeedsMigration(rawSchemaPresets);
  const promptDefaults = isPlainObject(savedSettings) ? savedSettings as Partial<TracktorSettings> : defaultSettings;
  const schemaPresets = sanitizeSchemaPresetMap(rawSchemaPresets, promptDefaults);
  const settings = deepMergeSettings(savedSettings, schemaPresets);
  settingsCache.set(userId, settings);
  if (Array.isArray(savedDiagnostics?.messages)) {
    diagnostics.set(userId, savedDiagnostics.messages.filter((item: unknown) => typeof item === 'string').slice(0, 12));
  }
  if (migrationNeeded) {
    await addDiagnostic(userId, 'Tracktor migrated schema presets into tracker presets with per-preset prompts and templates.');
  }
  await saveSettings(settings, userId);
  return settings;
}

async function saveSettings(settings: TracktorSettings, userId: string, validatePresetKey?: string): Promise<TracktorSettings> {
  const merged = deepMergeSettings(settings, settings.schemaPresets);
  if (validatePresetKey) {
    const preset = getSchemaPreset(merged, validatePresetKey);
    const runtime = resolvePresetRuntime(merged, preset);
    await assertRuntimeTemplateRenders(userId, preset, runtime, schemaToExample(runtime.schema));
  }
  settingsCache.set(userId, merged);
  await Promise.all([
    spindle.userStorage.setJson(SETTINGS_PATH, settingsForStorage(merged), { indent: 2, userId }),
    spindle.userStorage.setJson(SCHEMA_PRESETS_PATH, merged.schemaPresets, { indent: 2, userId }),
  ]);
  return merged;
}

async function loadChatConfig(userId: string, chatId: string): Promise<ChatTracktorConfig> {
  return spindle.userStorage.getJson(chatConfigPath(chatId), { fallback: {}, userId });
}

async function saveChatConfig(userId: string, chatId: string, config: ChatTracktorConfig): Promise<void> {
  await spindle.userStorage.setJson(chatConfigPath(chatId), config, { indent: 2, userId });
}

async function loadSnapshots(userId: string, chatId: string): Promise<TrackerSnapshot[]> {
  const file = await spindle.userStorage.getJson(snapshotsPath(chatId), {
    fallback: { chatId, snapshots: [] } satisfies TrackerSnapshotFile,
    userId,
  }).catch(() => ({ chatId, snapshots: [] } satisfies TrackerSnapshotFile));
  const snapshots = Array.isArray(file?.snapshots) ? file.snapshots : [];
  return snapshots.flatMap((snapshot: unknown) => normalizeSnapshot(snapshot, chatId));
}

async function saveSnapshots(userId: string, chatId: string, snapshots: TrackerSnapshot[]): Promise<void> {
  snapshots.sort((a, b) => a.updatedAt - b.updatedAt);
  await spindle.userStorage.setJson(snapshotsPath(chatId), { chatId, snapshots }, { indent: 2, userId });
}

function normalizeSnapshot(input: unknown, fallbackChatId: string): TrackerSnapshot[] {
  if (!isPlainObject(input)) return [];
  if (!isPlainObject(input.value) || typeof input.messageId !== 'string') return [];
  const now = Date.now();
  return [{
    id: typeof input.id === 'string' ? input.id : makeId('snapshot'),
    chatId: typeof input.chatId === 'string' ? input.chatId : fallbackChatId,
    messageId: input.messageId,
    schemaPresetKey: typeof input.schemaPresetKey === 'string' ? input.schemaPresetKey : typeof input.schemaId === 'string' ? input.schemaId : 'scene',
    value: input.value as Record<string, unknown>,
    renderTemplate: typeof input.renderTemplate === 'string' ? input.renderTemplate : typeof input.templateHtml === 'string' ? input.templateHtml : '',
    partsOrder: Array.isArray(input.partsOrder) ? input.partsOrder.filter((part): part is string => typeof part === 'string') : [],
    partsMeta: isPlainObject(input.partsMeta) ? input.partsMeta : {},
    pendingRedactions: isPlainObject(input.pendingRedactions) ? input.pendingRedactions : {},
    templateEngine: input.templateEngine === 'simple' || input.templateEngine === 'handlebars' ? input.templateEngine : undefined,
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : now,
  }];
}

async function upsertSnapshot(userId: string, snapshot: TrackerSnapshot): Promise<void> {
  const snapshots = await loadSnapshots(userId, snapshot.chatId);
  const index = snapshots.findIndex((item) => item.messageId === snapshot.messageId);
  if (index >= 0) snapshots[index] = snapshot;
  else snapshots.push(snapshot);
  await saveSnapshots(userId, snapshot.chatId, snapshots);
}

async function deleteSnapshot(userId: string, chatId: string, messageId: string): Promise<void> {
  const snapshots = await loadSnapshots(userId, chatId);
  await saveSnapshots(userId, chatId, snapshots.filter((item) => item.messageId !== messageId));
}

async function buildState(userId: string, chatId?: string | null): Promise<FrontendState> {
  const settings = await loadSettings(userId);
  const userJobs = [...activeJobs.values()].filter((job) => job.userId === userId).map((job) => job.state);
  const availableConnections = await listConnectionProfiles(userId);
  if (settings.trackerConnectionId && availableConnections.length > 0 && !availableConnections.some((item) => item.id === settings.trackerConnectionId)) {
    const warningKey = `${userId}:missing:${settings.trackerConnectionId}`;
    if (!connectionStateWarnings.has(warningKey)) {
      connectionStateWarnings.add(warningKey);
      await addDiagnostic(userId, `Selected Tracktor connection was not found: ${settings.trackerConnectionId}`);
    }
  }
  const activePresetKey = settings.activeTrackerPresetKey || settings.activeSchemaPresetKey || settings.activeSchemaId;
  if (activePresetKey && !settings.schemaPresets[activePresetKey]) {
    const warningKey = `${userId}:missing-preset:${activePresetKey}`;
    if (!connectionStateWarnings.has(warningKey)) {
      connectionStateWarnings.add(warningKey);
      await addDiagnostic(userId, `Selected Tracktor preset was not found: ${activePresetKey}`);
    }
  }
  return {
    settings,
    availableConnections,
    activeChat: await getActiveChatState(settings, userId, chatId),
    permissionWarnings: permissionWarnings(),
    busy: userJobs.length > 0,
    jobs: userJobs,
    diagnostics: diagnostics.get(userId) ?? [],
    ...(lastErrors.get(userId) ? { lastError: lastErrors.get(userId) } : {}),
  };
}

async function sendState(userId: string, chatId?: string | null): Promise<void> {
  send(userId, { type: 'state', state: await buildState(userId, chatId) });
}

async function getActiveChatState(settings: TracktorSettings, userId: string, chatId?: string | null): Promise<ActiveChatState | null> {
  if (!hasPermission('chats') || !hasPermission('chat_mutation')) return null;
  const chat = chatId
    ? await spindle.chats.get(chatId, userId).catch(() => null)
    : await spindle.chats.getActive(userId).catch(() => null);
  if (!chat?.id) return null;
  chatUserIds.set(chat.id, userId);
  const messages = await spindle.chat.getMessages(chat.id, userId) as ChatMessageDTO[];
  const snapshots = await loadSnapshots(userId, chat.id);
  return {
    id: chat.id,
    name: chat.name ?? 'Active chat',
    messageCount: messages.length,
    trackers: collectTrackerSummaries(chat.id, messages, snapshots, settings),
  };
}

function collectTrackerSummaries(
  chatId: string,
  messages: ChatMessageDTO[],
  snapshots: TrackerSnapshot[],
  settings: TracktorSettings,
): TrackerSummary[] {
  const byMessage = new Map(snapshots.map((snapshot) => [snapshot.messageId, snapshot]));
  return messages.flatMap((message) => {
    const snapshot = byMessage.get(message.id) ?? legacySnapshotFromMessage(chatId, message);
    if (!snapshot) return [];
    const preset = settings.schemaPresets[snapshot.schemaPresetKey];
    return [{
      chatId,
      messageId: message.id,
      role: message.role,
      messagePreview: safePreview(message.content || ''),
      snapshot,
      tracker: snapshotToRecord(snapshot, preset),
    }];
  });
}

function legacySnapshotFromMessage(chatId: string, message: ChatMessageDTO): TrackerSnapshot | undefined {
  const candidate = message.metadata?.[METADATA_KEY];
  if (!isPlainObject(candidate) || !('data' in candidate) || !candidate.data || !candidate.sourceMessageId) return undefined;
  const record = candidate as unknown as TrackerRecord;
  if (!isPlainObject(record.data)) return undefined;
  const updatedAt = Date.parse(record.updatedAt || '') || Date.now();
  return {
    id: record.snapshotId ?? makeSnapshotId(chatId, message.id),
    chatId,
    messageId: message.id,
    schemaPresetKey: record.schemaId,
    value: record.data as Record<string, unknown>,
    renderTemplate: record.templateHtml,
    partsOrder: getTopLevelSchemaKeys(record.schema),
    partsMeta: {},
    pendingRedactions: record.pendingRedactions ?? {},
    createdAt: updatedAt,
    updatedAt,
  };
}

function readSnapshotMirror(message: ChatMessageDTO): TrackerMetadataMirror | undefined {
  const candidate = message.metadata?.[METADATA_KEY];
  if (!isPlainObject(candidate)) return undefined;
  if (typeof candidate.snapshotId !== 'string' || typeof candidate.updatedAt !== 'number') return undefined;
  return candidate as unknown as TrackerMetadataMirror;
}

function resolveTargetMessage(messages: ChatMessageDTO[], requestedMessageId?: string): ChatMessageDTO {
  if (requestedMessageId) {
    const found = messages.find((message) => message.id === requestedMessageId);
    if (!found) throw new Error(`Message not found: ${requestedMessageId}`);
    return found;
  }
  const latest = messages[messages.length - 1];
  if (!latest) throw new Error('No messages are available in the active chat.');
  return latest;
}

function resolvePresetRuntime(settings: TracktorSettings, preset: SchemaPreset): TrackerPresetRuntime {
  const trackerInstructionPrompt = preset.trackerInstructionPrompt
    || preset.extractionPrompt
    || settings.trackerInstructionPrompt
    || settings.extractionPrompt
    || defaultSettings.trackerInstructionPrompt;
  return {
    schema: preset.schema ?? preset.jsonSchema,
    renderTemplate: preset.renderTemplate || preset.templateHtml,
    systemPrompt: preset.systemPrompt || settings.systemPrompt || defaultSettings.systemPrompt,
    trackerInstructionPrompt,
    jsonPromptTemplate: preset.jsonPromptTemplate || settings.jsonPromptTemplate || defaultSettings.jsonPromptTemplate,
    xmlPromptTemplate: preset.xmlPromptTemplate || settings.xmlPromptTemplate || defaultSettings.xmlPromptTemplate,
    toonPromptTemplate: preset.toonPromptTemplate || settings.toonPromptTemplate || defaultSettings.toonPromptTemplate,
    structuredOutputMode: preset.structuredOutputMode ?? settings.structuredOutputMode,
    templateEngine: preset.templateEngine ?? settings.templateEngine ?? 'handlebars',
  };
}

async function addGenerationDiagnosticOnce(userId: string, key: string, message: string, debugOnly = false, settings?: TracktorSettings): Promise<void> {
  if (debugOnly && !settings?.debugLogging) return;
  const diagnosticKey = `${userId}:${key}`;
  if (generationDiagnostics.has(diagnosticKey)) return;
  generationDiagnostics.add(diagnosticKey);
  await addDiagnostic(userId, message);
}

async function assertRuntimeTemplateRenders(
  userId: string,
  preset: SchemaPreset,
  runtime: TrackerPresetRuntime,
  data: unknown,
  savedTemplate?: string,
  templateEngine?: TemplateEngine,
): Promise<void> {
  const template = savedTemplate ?? runtime.renderTemplate;
  const engine = templateEngine ?? runtime.templateEngine;
  for (const warning of getTemplateCompatibilityWarnings(template)) {
    await addGenerationDiagnosticOnce(userId, `template-warning:${preset.key}:${warning}`, `Tracktor template warning for "${preset.name}" (${preset.key}): ${warning}`);
  }
  try {
    assertTrackerTemplateRenders(template, data, {
      templateEngine: engine,
      label: `Tracker preset "${preset.name}" (${preset.key})`,
      onWarning: (message) => {
        void addDiagnostic(userId, `Tracktor template warning for "${preset.name}" (${preset.key}): ${message}`);
      },
    });
  } catch (error) {
    const message = `Tracktor template render failed for "${preset.name}" (${preset.key}): ${error instanceof Error ? error.message : String(error)}`;
    spindle.log.warn(message);
    throw new Error(message);
  }
}

async function generateTrackerForMessage(options: {
  userId: string;
  chatId?: string;
  messageId?: string;
  sequential?: boolean;
  job?: BackendJob;
}): Promise<TrackerSnapshot> {
  if (!hasPermission('generation')) throw new Error('Generation permission is not granted.');
  if (!hasPermission('chats')) throw new Error('Chats permission is not granted.');
  if (!hasPermission('chat_mutation')) throw new Error('Chat mutation permission is not granted.');

  const settings = await loadSettings(options.userId);
  const chat = options.chatId
    ? await spindle.chats.get(options.chatId, options.userId).catch(() => ({ id: options.chatId }))
    : await spindle.chats.getActive(options.userId);
  if (!chat?.id) throw new Error('No active chat is open.');
  chatUserIds.set(chat.id, options.userId);

  const messages = await spindle.chat.getMessages(chat.id, options.userId) as ChatMessageDTO[];
  const target = resolveTargetMessage(messages, options.messageId);
  const targetIndex = messages.findIndex((message) => message.id === target.id);
  if (settings.skipFirstMessages > 0 && targetIndex < settings.skipFirstMessages) {
    throw new Error(`Tracker generation is skipped for the first ${settings.skipFirstMessages} messages.`);
  }

  const chatConfig = await loadChatConfig(options.userId, chat.id);
  const requestedPresetKey = chatConfig.schemaPresetKey ?? chatConfig.schemaId ?? settings.activeTrackerPresetKey ?? settings.activeSchemaPresetKey;
  if (requestedPresetKey && !settings.schemaPresets[requestedPresetKey]) {
    await addGenerationDiagnosticOnce(options.userId, `missing-preset:${requestedPresetKey}`, `Tracktor preset "${requestedPresetKey}" was missing; generation fell back to an available tracker preset.`);
  }
  const preset = getSchemaPreset(settings, requestedPresetKey);
  const runtime = resolvePresetRuntime(settings, preset);
  await addGenerationDiagnosticOnce(options.userId, `preset:${preset.key}`, `Tracktor generation using tracker preset "${preset.name}" (${preset.key}).`);
  const snapshots = await loadSnapshots(options.userId, chat.id);
  const priorSnapshots = collectPriorSnapshots(messages, snapshots, targetIndex, settings.includeLastTrackers);
  const sequential = options.sequential ?? settings.sequentialGeneration;
  const data = sequential
    ? await generateTrackerSequential(messages, targetIndex, settings, preset, runtime, priorSnapshots, options.userId, options.job)
    : await generateTrackerFull(messages, targetIndex, settings, preset, runtime, priorSnapshots, options.userId, options.job?.controller.signal);

  assertSchemaRequired(data, runtime.schema);
  const snapshot = makeTrackerSnapshot(chat.id, target.id, preset, runtime, data, snapshots.find((item) => item.messageId === target.id));
  await assertRuntimeTemplateRenders(options.userId, preset, runtime, snapshot.value, snapshot.renderTemplate, snapshot.templateEngine);
  await persistTrackerSnapshot(options.userId, target, snapshot, settings);
  return snapshot;
}

async function generateTrackerFull(
  messages: ChatMessageDTO[],
  targetIndex: number,
  settings: TracktorSettings,
  preset: SchemaPreset,
  runtime: TrackerPresetRuntime,
  priorSnapshots: TrackerSnapshot[],
  userId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const prompt = buildTrackerPrompt(messages, targetIndex, settings, preset, runtime, priorSnapshots);
  const data = await requestJsonForSchema(prompt, runtime.schema, 'tracktor_tracker', settings, runtime, userId, signal);
  if (!isPlainObject(data)) throw new Error('Tracker response was not a JSON object.');
  return data;
}

async function generateTrackerSequential(
  messages: ChatMessageDTO[],
  targetIndex: number,
  settings: TracktorSettings,
  preset: SchemaPreset,
  runtime: TrackerPresetRuntime,
  priorSnapshots: TrackerSnapshot[],
  userId: string,
  job?: BackendJob,
): Promise<Record<string, unknown>> {
  const keys = getTopLevelSchemaKeys(runtime.schema);
  if (keys.length === 0) throw new Error('The active tracker schema has no top-level properties.');

  const tracker: Record<string, unknown> = {};
  for (let index = 0; index < keys.length; index += 1) {
    if (job?.controller.signal.aborted) throw new DOMException('Tracker generation cancelled.', 'AbortError');
    const key = keys[index];
    updateJob(job, { currentPart: index + 1, totalParts: keys.length, label: `Generating ${key}` });
    const partSchema = buildTopLevelPartSchema(runtime.schema, key);
    const prompt = buildTrackerPrompt(messages, targetIndex, settings, preset, runtime, priorSnapshots, {
      partKey: key,
      trackerSoFar: tracker,
    });
    const part = await requestJsonForSchema(prompt, partSchema, `tracktor_${key}`, settings, runtime, userId, job?.controller.signal);
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
  runtime: TrackerPresetRuntime,
  userId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const parameters: Record<string, unknown> = {
    max_tokens: settings.maxResponseTokens,
  };

  const messages = [...promptMessages];
  if (runtime.structuredOutputMode === 'native_json_schema') {
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
      content: buildFormatInstruction(runtime, schema),
    });
  }

  if (settings.trackerConnectionId) {
    await addGenerationDiagnosticOnce(userId, `connection:${settings.trackerConnectionId}`, `Tracktor generation using selected Lumiverse connection: ${settings.trackerConnectionId}.`);
  } else {
    await addGenerationDiagnosticOnce(userId, 'connection:active', 'Tracktor generation using the active Lumiverse connection.');
  }

  const result = await spindle.generate.quiet({
    type: 'quiet',
    messages,
    parameters,
    ...(settings.trackerConnectionId ? { connection_id: settings.trackerConnectionId } : {}),
    userId,
    signal,
  });

  if (result?.content && typeof result.content === 'object') return result.content;
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
  runtime: TrackerPresetRuntime,
  priorSnapshots: TrackerSnapshot[],
  options: { partKey?: string; trackerSoFar?: Record<string, unknown> } = {},
): LlmMessageDTO[] {
  const limit = settings.trackerContextMessageLimit;
  const start = limit <= 0 ? 0 : Math.max(0, targetIndex - limit + 1);
  const recent = messages.slice(start, targetIndex + 1);
  const target = messages[targetIndex];
  const partLine = options.partKey
    ? `Generate only the top-level "${options.partKey}" property and return it wrapped in a JSON object.`
    : 'Generate the complete tracker object.';

  const prompt: LlmMessageDTO[] = [
    { role: 'system', content: runtime.systemPrompt },
    {
      role: 'user',
      content: [
        runtime.trackerInstructionPrompt,
        partLine,
        `Active tracker preset: ${preset.name}`,
        `Target message id: ${target.id}`,
      ].join('\n'),
    },
  ];

  if (priorSnapshots.length > 0) {
    prompt.push({
      role: 'user',
      content: `Previous tracker snapshots for continuity:\n\n${priorSnapshots.map((snapshot) => formatTrackerSnapshot(snapshot, snapshot.schemaPresetKey)).join('\n\n')}`,
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
    content: `Recent conversation up to the target message:\n\n${formatConversation(recent, settings)}`,
  });

  return prompt;
}

function buildFormatInstruction(runtime: TrackerPresetRuntime, schema: Record<string, unknown>): string {
  const template = runtime.structuredOutputMode === 'xml_prompt'
    ? runtime.xmlPromptTemplate
    : runtime.structuredOutputMode === 'toon_prompt'
      ? runtime.toonPromptTemplate
      : runtime.jsonPromptTemplate;
  return template
    .replaceAll('{{schema}}', JSON.stringify(schema, null, 2))
    .replaceAll('{{example_response}}', JSON.stringify(schemaToExample(schema), null, 2))
    .replaceAll('{{format_instructions}}', 'Return only valid JSON that matches the schema.')
    .replaceAll('{{current_tracker}}', '')
    .replaceAll('{{target_part}}', '');
}

function formatConversation(messages: ChatMessageDTO[], settings: TracktorSettings): string {
  if (settings.trackerConversationRoleMode === 'plain_transcript') {
    return messages.map((message) => `${message.name || message.role}: ${message.content.trim()}`).join('\n\n');
  }
  return messages
    .map((message) => {
      const role = settings.trackerConversationRoleMode === 'all_assistant' ? 'assistant' : message.role;
      return `${role.toUpperCase()} (${message.id}):\n${message.content.trim()}`;
    })
    .join('\n\n');
}

function collectPriorSnapshots(messages: ChatMessageDTO[], snapshots: TrackerSnapshot[], targetIndex: number, limit: number): TrackerSnapshot[] {
  if (limit <= 0) return [];
  const messageIndex = new Map(messages.map((message, index) => [message.id, index]));
  return snapshots
    .filter((snapshot) => {
      const index = messageIndex.get(snapshot.messageId);
      return typeof index === 'number' && index <= targetIndex;
    })
    .sort((a, b) => (messageIndex.get(a.messageId) ?? 0) - (messageIndex.get(b.messageId) ?? 0))
    .slice(-limit);
}

function makeTrackerSnapshot(
  chatId: string,
  messageId: string,
  preset: SchemaPreset,
  runtime: TrackerPresetRuntime,
  data: Record<string, unknown>,
  existing?: TrackerSnapshot,
  options: { renderTemplate?: string } = {},
): TrackerSnapshot {
  const now = Date.now();
  return {
    id: existing?.id ?? makeSnapshotId(chatId, messageId),
    chatId,
    messageId,
    schemaPresetKey: preset.key,
    value: data,
    renderTemplate: options.renderTemplate ?? runtime.renderTemplate,
    partsOrder: getTopLevelSchemaKeys(runtime.schema),
    partsMeta: existing?.partsMeta ?? {},
    pendingRedactions: existing?.pendingRedactions ?? {},
    templateEngine: existing?.templateEngine ?? runtime.templateEngine,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function persistTrackerSnapshot(
  userId: string,
  message: ChatMessageDTO,
  snapshot: TrackerSnapshot,
  settings: TracktorSettings,
): Promise<void> {
  await upsertSnapshot(userId, snapshot);
  if (hasPermission('chat_mutation')) {
    const nextMetadata = {
      ...(message.metadata ?? {}),
      [METADATA_KEY]: { snapshotId: snapshot.id, updatedAt: snapshot.updatedAt } satisfies TrackerMetadataMirror,
    };
    await spindle.chat.updateMessage(snapshot.chatId, message.id, { metadata: nextMetadata }, userId).catch((error: unknown) => {
      void addDiagnostic(userId, `Tracktor could not mirror snapshot metadata: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  if (settings.chatVariableExport.enabled) {
    await spindle.variables?.chat?.set?.(snapshot.chatId, settings.chatVariableExport.key, JSON.stringify(snapshot.value)).catch?.(() => {});
  }
}

async function updateTrackerData(userId: string, chatId: string, messageId: string, data: unknown): Promise<void> {
  if (!isPlainObject(data)) throw new Error('Tracker JSON must be an object.');
  const settings = await loadSettings(userId);
  const messages = await spindle.chat.getMessages(chatId, userId) as ChatMessageDTO[];
  const message = messages.find((item) => item.id === messageId);
  if (!message) throw new Error(`Message not found: ${messageId}`);
  const snapshots = await loadSnapshots(userId, chatId);
  const current = snapshots.find((item) => item.messageId === messageId) ?? legacySnapshotFromMessage(chatId, message);
  const preset = getSchemaPreset(settings, current?.schemaPresetKey);
  const runtime = resolvePresetRuntime(settings, preset);
  const snapshot = makeTrackerSnapshot(chatId, messageId, preset, runtime, data, current, {
    renderTemplate: current?.renderTemplate || runtime.renderTemplate,
  });
  await assertRuntimeTemplateRenders(userId, preset, runtime, snapshot.value, snapshot.renderTemplate, snapshot.templateEngine);
  await persistTrackerSnapshot(userId, message, snapshot, settings);
}

async function deleteTracker(userId: string, chatId: string, messageId: string): Promise<void> {
  const messages = await spindle.chat.getMessages(chatId, userId) as ChatMessageDTO[];
  const message = messages.find((item) => item.id === messageId);
  await deleteSnapshot(userId, chatId, messageId);
  if (message && hasPermission('chat_mutation')) {
    const nextMetadata = { ...(message.metadata ?? {}) };
    delete nextMetadata[METADATA_KEY];
    await spindle.chat.updateMessage(chatId, messageId, { metadata: nextMetadata }, userId);
  }
}

async function regeneratePart(userId: string, chatId: string, messageId: string, partKey: string): Promise<void> {
  const { settings, messages, targetIndex, preset, runtime, snapshot, message } = await loadSnapshotGenerationContext(userId, chatId, messageId);
  const schema = buildTopLevelPartSchema(runtime.schema, partKey);
  const prompt = buildTrackerPrompt(messages, targetIndex, settings, preset, runtime, [], {
    partKey,
    trackerSoFar: omitKey(snapshot.value, partKey),
  });
  const part = await requestJsonForSchema(prompt, schema, `tracktor_${partKey}`, settings, runtime, userId);
  if (!isPlainObject(part) || !(partKey in part)) throw new Error(`Part response did not include "${partKey}".`);
  const next = { ...snapshot.value, [partKey]: part[partKey] };
  const updated = makeTrackerSnapshot(chatId, messageId, preset, runtime, next, snapshot);
  await assertRuntimeTemplateRenders(userId, preset, runtime, updated.value, updated.renderTemplate, updated.templateEngine);
  await persistTrackerSnapshot(userId, message, updated, settings);
}

async function loadSnapshotGenerationContext(userId: string, chatId: string, messageId: string) {
  const settings = await loadSettings(userId);
  const messages = await spindle.chat.getMessages(chatId, userId) as ChatMessageDTO[];
  const message = messages.find((item) => item.id === messageId);
  if (!message) throw new Error(`Message not found: ${messageId}`);
  const snapshots = await loadSnapshots(userId, chatId);
  const snapshot = snapshots.find((item) => item.messageId === messageId) ?? legacySnapshotFromMessage(chatId, message);
  if (!snapshot) throw new Error('No tracker snapshot is saved for this message.');
  const preset = getSchemaPreset(settings, snapshot.schemaPresetKey);
  const runtime = resolvePresetRuntime(settings, preset);
  const targetIndex = messages.findIndex((item) => item.id === messageId);
  return { settings, messages, message, snapshot, preset, runtime, targetIndex };
}

function omitKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const next = { ...value };
  delete next[key];
  return next;
}

function assertSchemaRequired(data: unknown, schema: Record<string, unknown>): void {
  if (!isPlainObject(data)) throw new Error('Tracker response was not a JSON object.');
  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter((key): key is string => typeof key === 'string' && !(key in data));
  if (missing.length > 0) throw new Error(`Tracker response is missing required fields: ${missing.join(', ')}`);
}

function makeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

function makeSnapshotId(chatId: string, messageId: string): string {
  return `snap_${hashText(`${chatId}:${messageId}`)}`;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createJob(userId: string, chatId: string, messageId: string | undefined, label: string): BackendJob {
  const job: BackendJob = {
    userId,
    controller: new AbortController(),
    state: {
      id: makeId('job'),
      chatId,
      messageId,
      label,
      status: 'running',
    },
  };
  activeJobs.set(job.state.id, job);
  send(userId, { type: 'job_started', job: job.state });
  void saveJobs(userId, chatId);
  return job;
}

function updateJob(job: BackendJob | undefined, patch: Partial<TrackerJobState>): void {
  if (!job) return;
  job.state = { ...job.state, ...patch };
  activeJobs.set(job.state.id, job);
  send(job.userId, { type: 'job_progress', job: job.state });
  void saveJobs(job.userId, job.state.chatId);
}

function finishJob(job: BackendJob, status: 'complete' | 'failed', error?: string): void {
  job.state = { ...job.state, status, ...(error ? { error } : {}) };
  send(job.userId, status === 'complete' ? { type: 'job_finished', job: job.state } : { type: 'job_failed', job: job.state });
  activeJobs.delete(job.state.id);
  void saveJobs(job.userId, job.state.chatId);
}

async function saveJobs(userId: string, chatId: string): Promise<void> {
  const jobs = [...activeJobs.values()]
    .filter((job) => job.userId === userId && job.state.chatId === chatId)
    .map((job) => job.state);
  await spindle.userStorage.setJson(jobsPath(chatId), { chatId, jobs, updatedAt: Date.now() }, { indent: 2, userId }).catch(() => {});
}

function parsePayloadJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return parseJsonTrackerResponse(value).data;
}

async function runJob(userId: string, chatId: string | undefined, messageId: string | undefined, label: string, work: (job: BackendJob) => Promise<void>): Promise<void> {
  const resolvedChatId = chatId || (await spindle.chats.getActive(userId))?.id;
  if (!resolvedChatId) throw new Error('No active chat is open.');
  const job = createJob(userId, resolvedChatId, messageId, label);
  lastErrors.delete(userId);
  await sendState(userId, resolvedChatId);
  try {
    await work(job);
    finishJob(job, 'complete');
    await sendState(userId, resolvedChatId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastErrors.set(userId, message);
    finishJob(job, 'failed', message);
    spindle.toast.error(message, { title: 'Tracktor', duration: 10000 });
    await addDiagnostic(userId, message);
    await sendState(userId, resolvedChatId);
  }
}

spindle.onFrontendMessage(async (payload: FrontendMessage, rawUserId: string | undefined) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : null;
  setUserFromFrontend(rawUserId, chatId);
  if (!rawUserId) {
    await addDiagnostic(null, 'Tracktor received a frontend message without a Lumiverse userId.');
    return;
  }
  const userId = rawUserId;

  try {
    switch (payload?.type) {
      case 'ready':
      case 'refresh_state':
      case 'get_state':
        await sendState(userId, chatId);
        break;

      case 'save_settings': {
        const validatePresetKey = typeof payload.validatePresetKey === 'string' ? payload.validatePresetKey : undefined;
        await saveSettings(payload.settings, userId, validatePresetKey);
        spindle.toast.success('Settings saved.', { title: 'Tracktor' });
        await sendState(userId, chatId);
        break;
      }

      case 'set_chat_schema': {
        if (!payload.chatId || !payload.schemaId) throw new Error('chatId and schemaId are required.');
        await saveChatConfig(userId, payload.chatId, { schemaPresetKey: payload.schemaId, schemaId: payload.schemaId });
        spindle.toast.success('Chat schema updated.', { title: 'Tracktor' });
        await sendState(userId, payload.chatId);
        break;
      }

      case 'generate_tracker':
      case 'regenerate_tracker':
        await runJob(userId, payload.chatId, payload.messageId, 'Generating tracker', async (job) => {
          await generateTrackerForMessage({
            chatId: payload.chatId,
            messageId: payload.messageId,
            sequential: payload.sequential,
            userId,
            job,
          });
          spindle.toast.success('Tracker generated.', { title: 'Tracktor' });
        });
        break;

      case 'regenerate_part':
        if (!payload.chatId || !payload.messageId || !payload.partKey) throw new Error('chatId, messageId, and partKey are required.');
        await runJob(userId, payload.chatId, payload.messageId, `Regenerating ${payload.partKey}`, async () => {
          await regeneratePart(userId, payload.chatId, payload.messageId, payload.partKey);
          spindle.toast.success('Tracker section regenerated.', { title: 'Tracktor' });
        });
        break;

      case 'edit_snapshot':
      case 'update_tracker':
        await runJob(userId, payload.chatId, payload.messageId, 'Saving tracker JSON', async () => {
          await updateTrackerData(userId, payload.chatId, payload.messageId, parsePayloadJson(payload.data));
          spindle.toast.success('Tracker updated.', { title: 'Tracktor' });
        });
        break;

      case 'delete_snapshot':
      case 'delete_tracker':
        await runJob(userId, payload.chatId, payload.messageId, 'Deleting tracker', async () => {
          await deleteTracker(userId, payload.chatId, payload.messageId);
          spindle.toast.success('Tracker deleted.', { title: 'Tracktor' });
        });
        break;

      case 'cancel_job': {
        const job = typeof payload.jobId === 'string' ? activeJobs.get(payload.jobId) : undefined;
        if (job && job.userId === userId) job.controller.abort();
        break;
      }

      case 'toggle_injection': {
        const settings = await loadSettings(userId);
        settings.injectTrackerSnapshots = !settings.injectTrackerSnapshots;
        await saveSettings(settings, userId);
        await sendState(userId, chatId);
        break;
      }

      default:
        await addDiagnostic(userId, `Unknown frontend message: ${JSON.stringify(payload)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastErrors.set(userId, message);
    spindle.toast.error(message, { title: 'Tracktor', duration: 10000 });
    await addDiagnostic(userId, message);
    await sendState(userId, chatId);
  }
});

function shouldAutoGenerate(settings: TracktorSettings, kind: 'responses' | 'inputs'): boolean {
  return settings.autoMode === kind || settings.autoMode === 'both';
}

async function handleAutoGeneration(payload: any, eventUserId: string | undefined, kind: 'responses' | 'inputs'): Promise<void> {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : null;
  const messageId = typeof payload?.messageId === 'string' ? payload.messageId : typeof payload?.message?.id === 'string' ? payload.message.id : undefined;
  const userId = resolveUserId(chatId, eventUserId);
  if (!chatId || !messageId || !userId) {
    await addDiagnostic(userId, `Tracktor skipped ${kind} auto-generation because chat/user/message context was incomplete.`);
    return;
  }
  setUserFromFrontend(userId, chatId);
  const settings = await loadSettings(userId);
  if (!shouldAutoGenerate(settings, kind)) return;
  await runJob(userId, chatId, messageId, `Auto tracker (${kind})`, async (job) => {
    await generateTrackerForMessage({ userId, chatId, messageId, job });
  });
}

spindle.on('CHARACTER_MESSAGE_RENDERED', (payload: any, userId?: string) => {
  void handleAutoGeneration(payload, userId, 'responses');
});

spindle.on('USER_MESSAGE_RENDERED', (payload: any, userId?: string) => {
  void handleAutoGeneration(payload, userId, 'inputs');
});

spindle.on('CHAT_CHANGED', (payload: any, userId?: string) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : null;
  const targetUserId = resolveUserId(chatId, userId);
  if (!targetUserId) return;
  setUserFromFrontend(targetUserId, chatId);
  void sendState(targetUserId, chatId);
});

spindle.on('CHAT_SWITCHED', (payload: any, userId?: string) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : null;
  const targetUserId = resolveUserId(chatId, userId);
  if (!targetUserId) return;
  setUserFromFrontend(targetUserId, chatId);
  void sendState(targetUserId, chatId);
});

spindle.on('GENERATION_STARTED', (payload: any, userId?: string) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : null;
  if (chatId && userId) setUserFromFrontend(userId, chatId);
});

function tryRegisterInterceptor(): void {
  if (interceptorRegistered || !hasPermission('interceptor')) return;
  spindle.registerInterceptor(async (messages: LlmMessageDTO[], context: any) => {
    const chatId = typeof context?.chatId === 'string' ? context.chatId : null;
    if (!chatId || context?.generationType === 'quiet') return messages;
    const userId = resolveUserId(chatId, typeof context?.userId === 'string' ? context.userId : null);
    if (!userId) {
      await addDiagnostic(null, 'Tracktor skipped prompt injection because no userId was known for the chat.');
      return messages;
    }
    const settings = await loadSettings(userId);
    if (!settings.injectTrackerSnapshots || settings.trackerSnapshotCount <= 0) return messages;
    const snapshots = (await loadSnapshots(userId, chatId)).slice(-settings.trackerSnapshotCount);
    if (snapshots.length === 0) return messages;
    const transform = settings.snapshotTransformPresets[settings.snapshotTransformPresetKey] ?? settings.snapshotTransformPresets.default_json;
    const injected = snapshots.map((snapshot) => ({
      role: settings.snapshotRole,
      ...(settings.injectAsVirtualCharacter ? { name: 'Tracker' } : {}),
      content: formatTrackerSnapshot(snapshot, settings.snapshotHeader || snapshot.schemaPresetKey, transform),
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
  if (permission === 'interceptor' && granted) tryRegisterInterceptor();
});

void (async () => {
  tryRegisterInterceptor();
  spindle.log.info('Tracktor backend loaded.');
})();
