import Handlebars from 'handlebars';

export const EXTENSION_ID = 'tracktor';
export const METADATA_KEY = 'tracktor';
export const SETTINGS_PATH = 'settings.json';
export const SCHEMA_PRESETS_PATH = 'schema-presets.json';
export const DIAGNOSTICS_PATH = 'diagnostics/latest.json';
export const VERSION = '0.3.1';

export type MessageRole = 'system' | 'user' | 'assistant';
export type TrackerAutoMode = 'none' | 'responses' | 'inputs' | 'both';
export type StructuredOutputMode = 'native_json_schema' | 'json_prompt' | 'xml_prompt' | 'toon_prompt';
export type TrackerConversationRoleMode = 'preserve' | 'all_assistant' | 'plain_transcript';
export type TrackerWorldBookMode = 'include_all' | 'exclude_all' | 'allowlist';
export type SnapshotTransformPresetKey = 'default_json' | 'minimal' | 'toon' | 'custom';
export type TemplateEngine = 'handlebars' | 'simple';

export interface LlmMessageDTO {
  role: MessageRole;
  content: string;
  name?: string;
}

export interface ConnectionOption {
  id: string;
  name: string;
  provider?: string;
  model?: string;
}

export interface ChatMessageDTO {
  id: string;
  role: MessageRole;
  content: string;
  name?: string;
  extra?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  swipe_id?: number;
  swipes?: string[];
  swipe_dates?: number[];
}

export interface SchemaPreset {
  id: string;
  key: string;
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  jsonSchema: Record<string, unknown>;
  templateHtml: string;
  renderTemplate: string;
  systemPrompt: string;
  extractionPrompt: string;
  trackerInstructionPrompt: string;
  jsonPromptTemplate: string;
  xmlPromptTemplate: string;
  toonPromptTemplate: string;
  structuredOutputMode?: StructuredOutputMode;
  templateEngine?: TemplateEngine;
  createdAt: number;
  updatedAt: number;
}

export type TrackerPreset = SchemaPreset;

export interface TrackerSnapshot {
  id: string;
  chatId: string;
  messageId: string;
  schemaPresetKey: string;
  value: Record<string, unknown>;
  renderTemplate: string;
  partsOrder: string[];
  partsMeta: Record<string, unknown>;
  pendingRedactions: Record<string, unknown>;
  templateEngine?: TemplateEngine;
  createdAt: number;
  updatedAt: number;
}

export interface TrackerSnapshotFile {
  chatId: string;
  snapshots: TrackerSnapshot[];
}

export interface TrackerMetadataMirror {
  snapshotId: string;
  updatedAt: number;
}

export interface TrackerRecord {
  version: string;
  snapshotId?: string;
  schemaId: string;
  schemaName: string;
  schema: Record<string, unknown>;
  templateHtml: string;
  templateEngine?: TemplateEngine;
  data: unknown;
  renderedHtml: string;
  updatedAt: string;
  sourceMessageId: string;
  pendingRedactions?: Record<string, unknown>;
}

export interface SnapshotTransformPreset {
  key: SnapshotTransformPresetKey;
  name: string;
  input: 'pretty_json' | 'top_level_lines' | 'toon';
  regexPattern: string;
  regexFlags: string;
  replacement: string;
  codeFenceLang: string;
  wrapInCodeFence: boolean;
}

export interface ChatVariableExportSettings {
  enabled: boolean;
  key: string;
}

export interface LegacyInjectionSettings {
  enabled: boolean;
  includeLastTrackers: number;
  role: MessageRole;
  header: string;
}

export interface TracktorSettings {
  version: string;
  schemaPresets: Record<string, SchemaPreset>;
  activeTrackerPresetKey: string;
  activeSchemaPresetKey: string;
  activeSchemaId: string;
  trackerConnectionId: string | null;
  trackerPresetId: string | null;
  autoMode: TrackerAutoMode;
  sequentialGeneration: boolean;
  sequentialPartGeneration: boolean;
  maxResponseTokens: number;
  skipFirstMessages: number;
  trackerContextMessageLimit: number;
  includeLastMessages: number;
  includeLastTrackers: number;
  includeCharacterCardInTrackerPrompt: boolean;
  trackerConversationRoleMode: TrackerConversationRoleMode;
  structuredOutputMode: StructuredOutputMode;
  generationMode: 'json' | 'native_json';
  systemPrompt: string;
  extractionPrompt: string;
  trackerInstructionPrompt: string;
  jsonPromptTemplate: string;
  xmlPromptTemplate: string;
  toonPromptTemplate: string;
  trackerSystemPromptSource: 'active_preset' | 'selected_tracker_preset' | 'saved_tracker_prompt';
  savedTrackerPromptId: string | null;
  injectTrackerSnapshots: boolean;
  trackerSnapshotCount: number;
  snapshotRole: MessageRole;
  injectAsVirtualCharacter: boolean;
  snapshotHeader: string;
  snapshotTransformPresetKey: SnapshotTransformPresetKey;
  snapshotTransformPresets: Record<string, SnapshotTransformPreset>;
  injection: LegacyInjectionSettings;
  chatVariableExport: ChatVariableExportSettings;
  trackerWorldBookMode: TrackerWorldBookMode;
  allowedWorldBookIds: string[];
  allowedWorldBookEntryIds: string[];
  debugLogging: boolean;
  templateEngine: TemplateEngine;
}

export interface ChatTracktorConfig {
  schemaId?: string;
  schemaPresetKey?: string;
}

export interface TrackerSummary {
  chatId: string;
  messageId: string;
  role: MessageRole;
  messagePreview: string;
  snapshot: TrackerSnapshot;
  tracker: TrackerRecord;
}

export interface ActiveChatState {
  id: string;
  name: string;
  messageCount: number;
  trackers: TrackerSummary[];
}

export interface TrackerJobState {
  id: string;
  chatId: string;
  messageId?: string;
  label: string;
  status: 'running' | 'failed' | 'complete';
  currentPart?: number;
  totalParts?: number;
  error?: string;
}

export interface FrontendState {
  settings: TracktorSettings;
  availableConnections: ConnectionOption[];
  activeChat: ActiveChatState | null;
  permissionWarnings: string[];
  busy: boolean;
  jobs: TrackerJobState[];
  diagnostics: string[];
  lastError?: string;
}

export const DEFAULT_SYSTEM_PROMPT = `You are a structured tracker extraction assistant. Analyze the conversation and return only tracker data that matches the requested schema. Do not roleplay, continue the scene, explain yourself, or include markdown unless the tracker format instructions explicitly ask for it. Preserve continuity with previous tracker snapshots, but update the tracker from the newest chat evidence.`;

export const DEFAULT_EXTRACTION_PROMPT = `Create a complete tracker update for the target message. Fill every required field. If a field is not explicitly stated, infer a short, reasonable value from the conversation context. Keep values concise and concrete.`;

export const DEFAULT_JSON_PROMPT_TEMPLATE = [
  'Return only one valid JSON object.',
  'Do not include markdown fences, commentary, or prose outside JSON.',
  'The object must conform to this JSON Schema:',
  '{{schema}}',
  'Example shape:',
  '{{example_response}}',
].join('\n\n');

export const DEFAULT_XML_PROMPT_TEMPLATE = [
  'Return tracker data as valid JSON even if the model was asked for XML-style structure.',
  'Use this schema as the authority:',
  '{{schema}}',
].join('\n\n');

export const DEFAULT_TOON_PROMPT_TEMPLATE = [
  'Return tracker data as valid JSON. Keep values compact like TOON, but the response must still parse as JSON.',
  'Use this schema as the authority:',
  '{{schema}}',
].join('\n\n');

export const DEFAULT_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'SceneTracker',
  type: 'object',
  properties: {
    time: {
      type: 'string',
      description: 'Current in-scene time, including date if known.',
    },
    location: {
      type: 'string',
      description: 'Specific current location.',
    },
    situation: {
      type: 'string',
      description: 'One sentence summary of what is currently happening.',
    },
    mood: {
      type: 'string',
      description: 'Dominant emotional tone.',
    },
    charactersPresent: {
      type: 'array',
      description: 'Names of characters currently present.',
      items: { type: 'string' },
    },
    characters: {
      type: 'array',
      description: 'Visible state for each present character.',
      'x-tracktor-idKey': 'name',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          appearance: { type: 'string' },
          outfit: { type: 'string' },
          posture: { type: 'string' },
          notableState: { type: 'string' },
        },
        required: ['name', 'appearance', 'outfit', 'posture', 'notableState'],
      },
    },
    openThreads: {
      type: 'array',
      description: 'Unresolved goals, tensions, promises, clues, or pending actions.',
      items: { type: 'string' },
    },
  },
  required: ['time', 'location', 'situation', 'mood', 'charactersPresent', 'characters', 'openThreads'],
};

export const DEFAULT_TEMPLATE_HTML = `
<section class="tracktor-card">
  <div class="tracktor-grid">
    <div><strong>Time</strong><span>{{data.time}}</span></div>
    <div><strong>Location</strong><span>{{data.location}}</span></div>
    <div><strong>Mood</strong><span>{{data.mood}}</span></div>
  </div>
  <p class="tracktor-situation">{{data.situation}}</p>
  <details>
    <summary>Details</summary>
    <p><strong>Present:</strong> {{join data.charactersPresent ', '}}</p>
    {{#each data.characters}}
      <div class="tracktor-character">
        <strong>{{name}}</strong>
        <span>{{appearance}}</span>
        <span>{{outfit}}</span>
        <span>{{posture}}</span>
        <span>{{notableState}}</span>
      </div>
    {{/each}}
    <p><strong>Open threads:</strong> {{join data.openThreads '; '}}</p>
  </details>
</section>
`.trim();

export const defaultSchemaPresets: Record<string, SchemaPreset> = {
  scene: normalizeSchemaPreset({
    key: 'scene',
    id: 'scene',
    name: 'Scene Tracker',
    description: 'General roleplay scene state.',
    jsonSchema: DEFAULT_SCHEMA,
    schema: DEFAULT_SCHEMA,
    renderTemplate: DEFAULT_TEMPLATE_HTML,
    templateHtml: DEFAULT_TEMPLATE_HTML,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
    trackerInstructionPrompt: DEFAULT_EXTRACTION_PROMPT,
    jsonPromptTemplate: DEFAULT_JSON_PROMPT_TEMPLATE,
    xmlPromptTemplate: DEFAULT_XML_PROMPT_TEMPLATE,
    toonPromptTemplate: DEFAULT_TOON_PROMPT_TEMPLATE,
    templateEngine: 'handlebars',
  }, 'scene'),
};

export const defaultSnapshotTransformPresets: Record<string, SnapshotTransformPreset> = {
  default_json: {
    key: 'default_json',
    name: 'Default JSON',
    input: 'pretty_json',
    regexPattern: '',
    regexFlags: '',
    replacement: '',
    codeFenceLang: 'json',
    wrapInCodeFence: true,
  },
  minimal: {
    key: 'minimal',
    name: 'Minimal Lines',
    input: 'top_level_lines',
    regexPattern: '',
    regexFlags: '',
    replacement: '',
    codeFenceLang: '',
    wrapInCodeFence: false,
  },
  toon: {
    key: 'toon',
    name: 'TOON',
    input: 'toon',
    regexPattern: '',
    regexFlags: '',
    replacement: '',
    codeFenceLang: 'toon',
    wrapInCodeFence: true,
  },
};

export const defaultSettings: TracktorSettings = {
  version: VERSION,
  schemaPresets: structuredClone(defaultSchemaPresets),
  activeTrackerPresetKey: 'scene',
  activeSchemaPresetKey: 'scene',
  activeSchemaId: 'scene',
  trackerConnectionId: null,
  trackerPresetId: null,
  autoMode: 'none',
  sequentialGeneration: false,
  sequentialPartGeneration: false,
  maxResponseTokens: 4096,
  skipFirstMessages: 0,
  trackerContextMessageLimit: 12,
  includeLastMessages: 12,
  includeLastTrackers: 1,
  includeCharacterCardInTrackerPrompt: false,
  trackerConversationRoleMode: 'preserve',
  structuredOutputMode: 'json_prompt',
  generationMode: 'json',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
  trackerInstructionPrompt: DEFAULT_EXTRACTION_PROMPT,
  jsonPromptTemplate: DEFAULT_JSON_PROMPT_TEMPLATE,
  xmlPromptTemplate: DEFAULT_XML_PROMPT_TEMPLATE,
  toonPromptTemplate: DEFAULT_TOON_PROMPT_TEMPLATE,
  trackerSystemPromptSource: 'saved_tracker_prompt',
  savedTrackerPromptId: null,
  injectTrackerSnapshots: true,
  trackerSnapshotCount: 1,
  snapshotRole: 'system',
  injectAsVirtualCharacter: false,
  snapshotHeader: 'Recent tracker snapshot',
  snapshotTransformPresetKey: 'default_json',
  snapshotTransformPresets: structuredClone(defaultSnapshotTransformPresets),
  injection: {
    enabled: true,
    includeLastTrackers: 1,
    role: 'system',
    header: 'Recent tracker snapshot',
  },
  chatVariableExport: {
    enabled: true,
    key: 'tracktor',
  },
  trackerWorldBookMode: 'include_all',
  allowedWorldBookIds: [],
  allowedWorldBookEntryIds: [],
  debugLogging: false,
  templateEngine: 'handlebars',
};

export function deepMergeSettings(input: unknown, schemaPresets?: Record<string, SchemaPreset>): TracktorSettings {
  const saved = isPlainObject(input) ? input as Record<string, unknown> : {};
  const merged: TracktorSettings = structuredClone(defaultSettings);

  assignKnown(merged, saved, [
    'version',
    'trackerConnectionId',
    'trackerPresetId',
    'maxResponseTokens',
    'skipFirstMessages',
    'trackerContextMessageLimit',
    'includeLastMessages',
    'includeLastTrackers',
    'includeCharacterCardInTrackerPrompt',
    'systemPrompt',
    'extractionPrompt',
    'trackerInstructionPrompt',
    'jsonPromptTemplate',
    'xmlPromptTemplate',
    'toonPromptTemplate',
    'trackerSystemPromptSource',
    'savedTrackerPromptId',
    'injectTrackerSnapshots',
    'trackerSnapshotCount',
    'injectAsVirtualCharacter',
    'snapshotHeader',
    'debugLogging',
  ]);

  merged.schemaPresets = sanitizeSchemaPresetMap(schemaPresets ?? saved.schemaPresets, merged);
  merged.activeTrackerPresetKey = sanitizeId(
    readString(saved.activeTrackerPresetKey)
      || readString(saved.activeSchemaPresetKey)
      || readString(saved.activeSchemaId)
      || merged.activeTrackerPresetKey,
  ) || 'scene';
  merged.activeSchemaPresetKey = merged.activeTrackerPresetKey;
  merged.activeSchemaId = merged.activeTrackerPresetKey;

  merged.autoMode = normalizeAutoMode(saved.autoMode);
  merged.sequentialGeneration = readBool(saved.sequentialGeneration, readBool(saved.sequentialPartGeneration, merged.sequentialGeneration));
  merged.sequentialPartGeneration = merged.sequentialGeneration;
  merged.structuredOutputMode = normalizeStructuredOutputMode(saved.structuredOutputMode ?? saved.generationMode);
  merged.generationMode = merged.structuredOutputMode === 'native_json_schema' ? 'native_json' : 'json';
  merged.trackerConversationRoleMode = normalizeEnum(saved.trackerConversationRoleMode, ['preserve', 'all_assistant', 'plain_transcript'], 'preserve');
  merged.templateEngine = normalizeTemplateEngine(saved.templateEngine);
  merged.snapshotRole = normalizeEnum(saved.snapshotRole, ['system', 'user', 'assistant'], 'system');
  merged.trackerWorldBookMode = normalizeEnum(saved.trackerWorldBookMode, ['include_all', 'exclude_all', 'allowlist'], 'include_all');
  merged.snapshotTransformPresetKey = normalizeEnum(saved.snapshotTransformPresetKey, ['default_json', 'minimal', 'toon', 'custom'], 'default_json');
  merged.allowedWorldBookIds = sanitizeStringArray(saved.allowedWorldBookIds);
  merged.allowedWorldBookEntryIds = sanitizeStringArray(saved.allowedWorldBookEntryIds);
  if (saved.trackerContextMessageLimit === undefined && saved.includeLastMessages !== undefined) {
    merged.trackerContextMessageLimit = saved.includeLastMessages as number;
  }
  if (saved.trackerInstructionPrompt === undefined && typeof saved.extractionPrompt === 'string') {
    merged.trackerInstructionPrompt = saved.extractionPrompt;
  }

  if (isPlainObject(saved.snapshotTransformPresets)) {
    merged.snapshotTransformPresets = {
      ...structuredClone(defaultSnapshotTransformPresets),
      ...sanitizeSnapshotTransformPresets(saved.snapshotTransformPresets),
    };
  }

  if (isPlainObject(saved.injection)) {
    const injection = saved.injection as Record<string, unknown>;
    merged.injectTrackerSnapshots = readBool(injection.enabled, merged.injectTrackerSnapshots);
    merged.trackerSnapshotCount = sanitizeInteger(injection.includeLastTrackers, merged.trackerSnapshotCount, 0, 25);
    merged.snapshotRole = normalizeEnum(injection.role, ['system', 'user', 'assistant'], merged.snapshotRole);
    merged.snapshotHeader = readString(injection.header) || merged.snapshotHeader;
  }

  if (isPlainObject(saved.chatVariableExport)) {
    assignKnown(merged.chatVariableExport, saved.chatVariableExport as Record<string, unknown>, ['enabled', 'key']);
  }

  merged.maxResponseTokens = sanitizeInteger(merged.maxResponseTokens, 4096, 1, 64000);
  merged.skipFirstMessages = sanitizeInteger(merged.skipFirstMessages, 0, 0, 1000);
  merged.trackerContextMessageLimit = sanitizeInteger(merged.trackerContextMessageLimit, merged.includeLastMessages, 0, 400);
  merged.includeLastMessages = merged.trackerContextMessageLimit;
  merged.includeLastTrackers = sanitizeInteger(merged.includeLastTrackers, 1, 0, 25);
  merged.trackerSnapshotCount = sanitizeInteger(merged.trackerSnapshotCount, 1, 0, 25);
  merged.injection = {
    enabled: merged.injectTrackerSnapshots,
    includeLastTrackers: merged.trackerSnapshotCount,
    role: merged.snapshotRole,
    header: merged.snapshotHeader,
  };
  merged.chatVariableExport.enabled = readBool(merged.chatVariableExport.enabled, true);
  merged.chatVariableExport.key = sanitizeVariableKey(String(merged.chatVariableExport.key ?? 'tracktor')) || 'tracktor';
  merged.trackerConnectionId = normalizeNullableString(merged.trackerConnectionId);
  merged.trackerPresetId = normalizeNullableString(merged.trackerPresetId);
  merged.savedTrackerPromptId = normalizeNullableString(merged.savedTrackerPromptId);
  merged.trackerInstructionPrompt = merged.trackerInstructionPrompt || merged.extractionPrompt || DEFAULT_EXTRACTION_PROMPT;
  merged.extractionPrompt = merged.trackerInstructionPrompt;

  if (!merged.schemaPresets[merged.activeTrackerPresetKey]) {
    merged.activeTrackerPresetKey = Object.keys(merged.schemaPresets)[0] ?? 'scene';
    merged.activeSchemaPresetKey = merged.activeTrackerPresetKey;
    merged.activeSchemaId = merged.activeTrackerPresetKey;
  }
  if (!merged.schemaPresets[merged.activeTrackerPresetKey]) {
    merged.schemaPresets = structuredClone(defaultSchemaPresets);
    merged.activeTrackerPresetKey = 'scene';
    merged.activeSchemaPresetKey = 'scene';
    merged.activeSchemaId = 'scene';
  }

  return merged;
}

export function settingsForStorage(settings: TracktorSettings): Record<string, unknown> {
  const copy = structuredClone(settings) as unknown as Record<string, unknown>;
  delete copy.schemaPresets;
  delete copy.activeSchemaId;
  delete copy.generationMode;
  delete copy.sequentialPartGeneration;
  delete copy.includeLastMessages;
  delete copy.injection;
  delete copy.extractionPrompt;
  return copy;
}

type PresetPromptDefaults = Partial<Pick<
  TracktorSettings,
  | 'systemPrompt'
  | 'extractionPrompt'
  | 'trackerInstructionPrompt'
  | 'jsonPromptTemplate'
  | 'xmlPromptTemplate'
  | 'toonPromptTemplate'
  | 'templateEngine'
>>;

export function sanitizeSchemaPresetMap(input: unknown, promptDefaults: PresetPromptDefaults = defaultSettings): Record<string, SchemaPreset> {
  if (!isPlainObject(input)) return structuredClone(defaultSchemaPresets);
  const out: Record<string, SchemaPreset> = {};
  for (const [fallbackKey, value] of Object.entries(input)) {
    if (!isPlainObject(value)) continue;
    const preset = normalizeSchemaPreset(value, fallbackKey, promptDefaults);
    if (preset) out[preset.key] = preset;
  }
  return Object.keys(out).length > 0 ? out : structuredClone(defaultSchemaPresets);
}

export function normalizeSchemaPreset(
  input: unknown,
  fallbackKey = 'schema',
  promptDefaults: PresetPromptDefaults = {},
): SchemaPreset {
  const value = isPlainObject(input) ? input : {};
  const key = sanitizeId(readString(value.key) || readString(value.id) || fallbackKey) || sanitizeId(fallbackKey) || 'schema';
  const schema = isPlainObject(value.jsonSchema)
    ? value.jsonSchema
    : isPlainObject(value.schema)
      ? value.schema
      : DEFAULT_SCHEMA;
  const template = readString(value.renderTemplate) || readString(value.templateHtml) || DEFAULT_TEMPLATE_HTML;
  const systemPrompt = readString(value.systemPrompt) || readString(promptDefaults.systemPrompt) || DEFAULT_SYSTEM_PROMPT;
  const trackerInstructionPrompt = readString(value.trackerInstructionPrompt)
    || readString(value.extractionPrompt)
    || readString(promptDefaults.trackerInstructionPrompt)
    || readString(promptDefaults.extractionPrompt)
    || DEFAULT_EXTRACTION_PROMPT;
  const now = Date.now();
  const preset: SchemaPreset = {
    id: key,
    key,
    name: readString(value.name) || key,
    description: readString(value.description) || undefined,
    schema: schema as Record<string, unknown>,
    jsonSchema: schema as Record<string, unknown>,
    templateHtml: template,
    renderTemplate: template,
    systemPrompt,
    extractionPrompt: trackerInstructionPrompt,
    trackerInstructionPrompt,
    jsonPromptTemplate: readString(value.jsonPromptTemplate) || readString(promptDefaults.jsonPromptTemplate) || DEFAULT_JSON_PROMPT_TEMPLATE,
    xmlPromptTemplate: readString(value.xmlPromptTemplate) || readString(promptDefaults.xmlPromptTemplate) || DEFAULT_XML_PROMPT_TEMPLATE,
    toonPromptTemplate: readString(value.toonPromptTemplate) || readString(promptDefaults.toonPromptTemplate) || DEFAULT_TOON_PROMPT_TEMPLATE,
    templateEngine: normalizeTemplateEngine(value.templateEngine ?? promptDefaults.templateEngine),
    createdAt: sanitizeInteger(value.createdAt, now, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: sanitizeInteger(value.updatedAt, now, 0, Number.MAX_SAFE_INTEGER),
  };
  const outputMode = normalizeOptionalStructuredOutputMode(value.structuredOutputMode);
  if (outputMode) preset.structuredOutputMode = outputMode;
  return preset;
}

export function schemaPresetNeedsMigration(input: unknown): boolean {
  if (!isPlainObject(input)) return false;
  const requiredFields = [
    'systemPrompt',
    'trackerInstructionPrompt',
    'jsonPromptTemplate',
    'xmlPromptTemplate',
    'toonPromptTemplate',
  ];
  return Object.values(input).some((value) => (
    isPlainObject(value)
      && requiredFields.some((field) => typeof value[field] !== 'string' || !value[field])
  ));
}

export function getSchemaPreset(settings: TracktorSettings, preferredId?: string): SchemaPreset {
  const key = preferredId && settings.schemaPresets[preferredId]
    ? preferredId
    : settings.activeTrackerPresetKey || settings.activeSchemaPresetKey;
  return settings.schemaPresets[key] ?? settings.schemaPresets[Object.keys(settings.schemaPresets)[0]];
}

export function getTopLevelSchemaKeys(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  if (!isPlainObject(properties)) return [];
  return Object.keys(properties);
}

export function buildTopLevelPartSchema(schema: Record<string, unknown>, key: string): Record<string, unknown> {
  const properties = isPlainObject(schema.properties) ? schema.properties as Record<string, unknown> : {};
  const property = properties[key];
  if (!property) throw new Error(`Unknown schema part: ${key}`);
  return {
    $schema: schema.$schema ?? 'http://json-schema.org/draft-07/schema#',
    title: `${String(schema.title ?? 'Tracker')}Part`,
    type: 'object',
    properties: { [key]: property },
    required: [key],
  };
}

export function schemaToExample(schema: unknown): unknown {
  if (!isPlainObject(schema)) return null;
  if ('example' in schema) return schema.example;
  if ('default' in schema) return schema.default;

  switch (schema.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      const properties = isPlainObject(schema.properties) ? schema.properties as Record<string, unknown> : {};
      for (const [key, value] of Object.entries(properties)) out[key] = schemaToExample(value);
      return out;
    }
    case 'array':
      return [schemaToExample(schema.items)];
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return typeof schema.description === 'string' ? schema.description : 'string';
    default:
      return null;
  }
}

export function renderTrackerTemplate(
  templateHtml: string,
  data: unknown,
  options: { templateEngine?: TemplateEngine; onWarning?: (message: string) => void } = {},
): string {
  const engine = options.templateEngine ?? 'handlebars';
  const sanitizedTemplate = stripDangerousHtml(templateHtml);
  try {
    const rendered = engine === 'simple'
      ? renderScopedTemplate(sanitizedTemplate, data, data)
      : renderHandlebarsTemplate(sanitizedTemplate, data);
    return stripDangerousHtml(rendered);
  } catch (error) {
    if (engine !== 'simple' && error instanceof Error && error.message === 'Handlebars renderer is unavailable.') {
      options.onWarning?.(`Handlebars template renderer failed; falling back to simple renderer: ${error instanceof Error ? error.message : String(error)}`);
      return stripDangerousHtml(renderScopedTemplate(sanitizedTemplate, data, data));
    }
    throw error;
  }
}

export function assertTrackerTemplateRenders(
  templateHtml: string,
  data: unknown,
  options: { templateEngine?: TemplateEngine; label?: string; onWarning?: (message: string) => void } = {},
): string {
  try {
    return renderTrackerTemplate(templateHtml, data, options);
  } catch (error) {
    const label = options.label ? `${options.label}: ` : '';
    throw new Error(`${label}Template render failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function testRenderTrackerPreset(preset: SchemaPreset, settings?: Partial<TracktorSettings>): string {
  const engine = preset.templateEngine ?? settings?.templateEngine ?? 'handlebars';
  return assertTrackerTemplateRenders(preset.renderTemplate || preset.templateHtml, schemaToExample(preset.schema), {
    templateEngine: engine,
    label: `Tracker preset "${preset.name}" (${preset.key})`,
  });
}

export function getTemplateCompatibilityWarnings(templateHtml: string): string[] {
  const warnings: string[] = [];
  if (/{{{\s*[\s\S]*?}}}/.test(templateHtml) || /{{&\s*[^}]+}}/.test(templateHtml)) {
    warnings.push('Template uses unescaped Handlebars output. Tracktor sanitizes rendered HTML, but normal {{...}} output is safer.');
  }
  return warnings;
}

export function snapshotToRecord(snapshot: TrackerSnapshot, preset?: SchemaPreset): TrackerRecord {
  const schema = preset?.schema ?? preset?.jsonSchema ?? {};
  const template = snapshot.renderTemplate || preset?.templateHtml || preset?.renderTemplate || '';
  const templateEngine = snapshot.templateEngine ?? preset?.templateEngine ?? 'handlebars';
  return {
    version: VERSION,
    snapshotId: snapshot.id,
    schemaId: snapshot.schemaPresetKey,
    schemaName: preset?.name ?? snapshot.schemaPresetKey,
    schema,
    templateHtml: template,
    templateEngine,
    data: snapshot.value,
    renderedHtml: safeRenderTracker(template, snapshot.value, { templateEngine }),
    updatedAt: new Date(snapshot.updatedAt).toISOString(),
    sourceMessageId: snapshot.messageId,
    pendingRedactions: snapshot.pendingRedactions,
  };
}

export function safeRenderTracker(
  templateHtml: string,
  data: unknown,
  options: { templateEngine?: TemplateEngine; onWarning?: (message: string) => void } = {},
): string {
  try {
    return renderTrackerTemplate(templateHtml, data, options);
  } catch {
    return `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  }
}

export function formatTrackerSnapshot(
  record: TrackerRecord | TrackerSnapshot | { data?: unknown; value?: unknown },
  header = 'Tracker',
  transform: SnapshotTransformPreset = defaultSnapshotTransformPresets.default_json,
): string {
  const data = 'value' in record ? record.value : 'data' in record ? record.data : record;
  let body = formatSnapshotBody(data, transform.input);
  if (transform.regexPattern) {
    try {
      body = body.replace(new RegExp(transform.regexPattern, transform.regexFlags), transform.replacement);
    } catch {
      // Keep the base snapshot if a custom regex is invalid.
    }
  }
  const fenced = transform.wrapInCodeFence
    ? `\`\`\`${transform.codeFenceLang}\n${body}\n\`\`\``
    : body;
  return `${header}\n${fenced}`;
}

export function formatSnapshotBody(data: unknown, input: SnapshotTransformPreset['input']): string {
  if (input === 'top_level_lines' && isPlainObject(data)) {
    return Object.entries(data)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join('\n');
  }
  if (input === 'toon') return toToon(data);
  return JSON.stringify(data, null, 2);
}

export function safePreview(value: string, max = 160): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}...`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '')
    .replace(/\s(href|src)\s*=\s*javascript:[^\s>]+/gi, '');
}

export function sanitizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

export function sanitizeVariableKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80);
}

export function safeStorageKey(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
  return sanitized || 'unknown';
}

export function chatConfigPath(chatId: string): string {
  return `chats/${safeStorageKey(chatId)}.json`;
}

export function snapshotsPath(chatId: string): string {
  return `snapshots/${safeStorageKey(chatId)}.json`;
}

export function jobsPath(chatId: string): string {
  return `jobs/${safeStorageKey(chatId)}.json`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeSnapshotTransformPresets(input: Record<string, unknown>): Record<string, SnapshotTransformPreset> {
  const out: Record<string, SnapshotTransformPreset> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!isPlainObject(raw)) continue;
    const presetKey = normalizeEnum(raw.key ?? key, ['default_json', 'minimal', 'toon', 'custom'], 'custom');
    out[key] = {
      key: presetKey,
      name: readString(raw.name) || key,
      input: normalizeEnum(raw.input, ['pretty_json', 'top_level_lines', 'toon'], 'pretty_json'),
      regexPattern: readString(raw.regexPattern),
      regexFlags: readString(raw.regexFlags),
      replacement: readString(raw.replacement),
      codeFenceLang: readString(raw.codeFenceLang),
      wrapInCodeFence: readBool(raw.wrapInCodeFence, presetKey !== 'minimal'),
    };
  }
  return out;
}

function normalizeAutoMode(value: unknown): TrackerAutoMode {
  if (value === 'off') return 'none';
  if (value === 'assistant_message') return 'responses';
  if (value === 'user_message') return 'inputs';
  return normalizeEnum(value, ['none', 'responses', 'inputs', 'both'], 'none');
}

function normalizeStructuredOutputMode(value: unknown): StructuredOutputMode {
  if (value === 'native_json') return 'native_json_schema';
  if (value === 'json') return 'json_prompt';
  return normalizeEnum(value, ['native_json_schema', 'json_prompt', 'xml_prompt', 'toon_prompt'], 'json_prompt');
}

function normalizeTemplateEngine(value: unknown): TemplateEngine {
  return normalizeEnum(value, ['handlebars', 'simple'], 'handlebars');
}

function normalizeOptionalStructuredOutputMode(value: unknown): StructuredOutputMode | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizeStructuredOutputMode(value);
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : []);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function assignKnown(target: object, source: Record<string, unknown>, keys: string[]): void {
  const writable = target as Record<string, unknown>;
  for (const key of keys) {
    if (source[key] !== undefined) writable[key] = source[key];
  }
}

function sanitizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

const handlebarsRuntime = (() => {
  try {
    const runtime = Handlebars.create();
    runtime.registerHelper('join', (value: unknown, separator: unknown) => {
      if (!Array.isArray(value)) return '';
      const delimiter = typeof separator === 'string' ? separator : ', ';
      return value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item ?? '')).join(delimiter);
    });
    runtime.registerHelper('json', (value: unknown) => JSON.stringify(value, null, 2));
    return runtime;
  } catch {
    return null;
  }
})();

function renderHandlebarsTemplate(template: string, data: unknown): string {
  if (!handlebarsRuntime) {
    throw new Error('Handlebars renderer is unavailable.');
  }
  const compiled = handlebarsRuntime.compile(template, {
    noEscape: false,
    strict: false,
  });
  return compiled({ data }, {
    allowProtoMethodsByDefault: false,
    allowProtoPropertiesByDefault: false,
  });
}

function renderScopedTemplate(template: string, scope: unknown, rootData: unknown): string {
  let rendered = template.replace(/{{#each\s+([^}]+)}}([\s\S]*?){{\/each}}/g, (_match, path: string, body: string) => {
    const items = resolveTemplatePath(path.trim(), scope, rootData);
    if (!Array.isArray(items)) return '';
    return items.map((item) => renderScopedTemplate(body, item, rootData)).join('');
  });

  rendered = rendered.replace(/{{\s*join\s+([^\s}]+)\s+(['"])(.*?)\2\s*}}/g, (_match, path: string, _quote: string, separator: string) => {
    const value = resolveTemplatePath(path.trim(), scope, rootData);
    if (!Array.isArray(value)) return '';
    return escapeHtml(value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(separator));
  });

  rendered = rendered.replace(/{{\s*json\s+([^}]+)\s*}}/g, (_match, path: string) => {
    const value = resolveTemplatePath(path.trim(), scope, rootData);
    return escapeHtml(JSON.stringify(value, null, 2));
  });

  rendered = rendered.replace(/{{\s*([a-zA-Z0-9_.-]+|this)\s*}}/g, (_match, path: string) => {
    return escapeHtml(resolveTemplatePath(path.trim(), scope, rootData));
  });

  return rendered;
}

function resolveTemplatePath(path: string, scope: unknown, rootData: unknown): unknown {
  if (path === 'this') return scope;
  if (path === 'data') return rootData;

  const parts = path.split('.').filter(Boolean);
  let current: unknown;
  if (parts[0] === 'data') {
    current = rootData;
    parts.shift();
  } else {
    current = scope;
  }

  for (const part of parts) {
    if (current == null) return '';
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      current = Number.isFinite(index) ? current[index] : undefined;
      continue;
    }
    if (!isPlainObject(current)) return '';
    current = current[part];
  }

  return current ?? '';
}

function toToon(data: unknown, indent = ''): string {
  if (Array.isArray(data)) {
    return data.map((item, index) => `${indent}${index}: ${isPlainObject(item) || Array.isArray(item) ? `\n${toToon(item, `${indent}  `)}` : String(item)}`).join('\n');
  }
  if (isPlainObject(data)) {
    return Object.entries(data)
      .map(([key, value]) => `${indent}${key}: ${isPlainObject(value) || Array.isArray(value) ? `\n${toToon(value, `${indent}  `)}` : String(value)}`)
      .join('\n');
  }
  return String(data ?? '');
}
