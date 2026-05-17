// src/shared.ts
var METADATA_KEY = "tracktor";
var SETTINGS_PATH = "settings.json";
var VERSION = "0.1.2";
var DEFAULT_SYSTEM_PROMPT = `You are a structured tracker extraction assistant. Analyze the conversation and return only tracker data that matches the requested schema. Do not roleplay, continue the scene, explain yourself, or include markdown unless the tracker format instructions explicitly ask for it. Preserve continuity with previous tracker snapshots, but update the tracker from the newest chat evidence.`;
var DEFAULT_EXTRACTION_PROMPT = `Create a complete tracker update for the target message. Fill every required field. If a field is not explicitly stated, infer a short, reasonable value from the conversation context. Keep values concise and concrete.`;
var DEFAULT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "SceneTracker",
  type: "object",
  properties: {
    time: {
      type: "string",
      description: "Current in-scene time, including date if known."
    },
    location: {
      type: "string",
      description: "Specific current location."
    },
    situation: {
      type: "string",
      description: "One sentence summary of what is currently happening."
    },
    mood: {
      type: "string",
      description: "Dominant emotional tone."
    },
    charactersPresent: {
      type: "array",
      description: "Names of characters currently present.",
      items: { type: "string" }
    },
    characters: {
      type: "array",
      description: "Visible state for each present character.",
      "x-tracktor-idKey": "name",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          appearance: { type: "string" },
          outfit: { type: "string" },
          posture: { type: "string" },
          notableState: { type: "string" }
        },
        required: ["name", "appearance", "outfit", "posture", "notableState"]
      }
    },
    openThreads: {
      type: "array",
      description: "Unresolved goals, tensions, promises, clues, or pending actions.",
      items: { type: "string" }
    }
  },
  required: ["time", "location", "situation", "mood", "charactersPresent", "characters", "openThreads"]
};
var DEFAULT_TEMPLATE_HTML = `
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
var defaultSettings = {
  version: VERSION,
  activeSchemaId: "scene",
  schemaPresets: {
    scene: {
      id: "scene",
      name: "Scene Tracker",
      description: "General roleplay scene state.",
      schema: DEFAULT_SCHEMA,
      templateHtml: DEFAULT_TEMPLATE_HTML
    }
  },
  generationMode: "json",
  maxResponseTokens: 1800,
  includeLastMessages: 12,
  includeLastTrackers: 1,
  sequentialPartGeneration: false,
  autoMode: "off",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
  injection: {
    enabled: true,
    includeLastTrackers: 1,
    role: "system",
    header: "Recent tracker snapshot"
  },
  chatVariableExport: {
    enabled: true,
    key: "tracktor"
  },
  debugLogging: false
};
function deepMergeSettings(input) {
  const saved = isPlainObject(input) ? input : {};
  const merged = structuredClone(defaultSettings);
  assignKnown(merged, saved, [
    "version",
    "activeSchemaId",
    "generationMode",
    "maxResponseTokens",
    "includeLastMessages",
    "includeLastTrackers",
    "sequentialPartGeneration",
    "autoMode",
    "systemPrompt",
    "extractionPrompt",
    "debugLogging"
  ]);
  if (isPlainObject(saved.schemaPresets)) {
    merged.schemaPresets = {};
    for (const [id, value] of Object.entries(saved.schemaPresets)) {
      if (!isPlainObject(value)) continue;
      const preset = value;
      if (!isPlainObject(preset.schema) || typeof preset.templateHtml !== "string") continue;
      const normalizedId = sanitizeId(typeof preset.id === "string" ? preset.id : id) || id;
      merged.schemaPresets[normalizedId] = {
        id: normalizedId,
        name: typeof preset.name === "string" && preset.name.trim() ? preset.name : normalizedId,
        description: typeof preset.description === "string" ? preset.description : void 0,
        schema: preset.schema,
        templateHtml: preset.templateHtml
      };
    }
    if (Object.keys(merged.schemaPresets).length === 0) {
      merged.schemaPresets = structuredClone(defaultSettings.schemaPresets);
    }
  }
  if (isPlainObject(saved.injection)) {
    assignKnown(merged.injection, saved.injection, [
      "enabled",
      "includeLastTrackers",
      "role",
      "header"
    ]);
  }
  if (isPlainObject(saved.chatVariableExport)) {
    assignKnown(merged.chatVariableExport, saved.chatVariableExport, ["enabled", "key"]);
  }
  merged.activeSchemaId = merged.schemaPresets[merged.activeSchemaId] ? merged.activeSchemaId : Object.keys(merged.schemaPresets)[0];
  merged.maxResponseTokens = sanitizeInteger(merged.maxResponseTokens, 1800, 1, 64e3);
  merged.includeLastMessages = sanitizeInteger(merged.includeLastMessages, 12, 1, 200);
  merged.includeLastTrackers = sanitizeInteger(merged.includeLastTrackers, 1, 0, 25);
  merged.injection.includeLastTrackers = sanitizeInteger(merged.injection.includeLastTrackers, 1, 0, 25);
  merged.generationMode = merged.generationMode === "native_json" ? "native_json" : "json";
  merged.autoMode = ["off", "assistant_message", "user_message"].includes(merged.autoMode) ? merged.autoMode : "off";
  merged.injection.role = ["system", "user", "assistant"].includes(merged.injection.role) ? merged.injection.role : "system";
  merged.chatVariableExport.key = sanitizeVariableKey(merged.chatVariableExport.key) || "tracktor";
  return merged;
}
function getSchemaPreset(settings, preferredId) {
  const id = preferredId && settings.schemaPresets[preferredId] ? preferredId : settings.activeSchemaId;
  return settings.schemaPresets[id] ?? settings.schemaPresets[Object.keys(settings.schemaPresets)[0]];
}
function getTopLevelSchemaKeys(schema) {
  const properties = schema.properties;
  if (!isPlainObject(properties)) return [];
  return Object.keys(properties);
}
function buildTopLevelPartSchema(schema, key) {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const property = properties[key];
  if (!property) {
    throw new Error(`Unknown schema part: ${key}`);
  }
  return {
    $schema: schema.$schema ?? "http://json-schema.org/draft-07/schema#",
    title: `${String(schema.title ?? "Tracker")}Part`,
    type: "object",
    properties: { [key]: property },
    required: [key]
  };
}
function schemaToExample(schema) {
  if (!isPlainObject(schema)) return null;
  if ("example" in schema) return schema.example;
  if ("default" in schema) return schema.default;
  switch (schema.type) {
    case "object": {
      const out = {};
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      for (const [key, value] of Object.entries(properties)) {
        out[key] = schemaToExample(value);
      }
      return out;
    }
    case "array":
      return [schemaToExample(schema.items)];
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "string":
      return typeof schema.description === "string" ? schema.description : "string";
    default:
      return null;
  }
}
function renderTrackerTemplate(templateHtml, data) {
  const withoutScripts = stripDangerousHtml(templateHtml);
  return renderScopedTemplate(withoutScripts, data, data);
}
function formatTrackerSnapshot(record, header = "Tracker") {
  return `${header}
\`\`\`json
${JSON.stringify(record.data, null, 2)}
\`\`\``;
}
function safePreview(value, max = 160) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}...`;
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function stripDangerousHtml(html) {
  return html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "").replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "").replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "").replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, "");
}
function sanitizeId(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}
function sanitizeVariableKey(value) {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80);
}
function chatConfigPath(chatId) {
  return `chats/${chatId.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`;
}
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function assignKnown(target, source, keys) {
  const writable = target;
  for (const key of keys) {
    if (source[key] !== void 0) {
      writable[key] = source[key];
    }
  }
}
function sanitizeInteger(value, fallback, min, max) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
function renderScopedTemplate(template, scope, rootData) {
  let rendered = template.replace(/{{#each\s+([^}]+)}}([\s\S]*?){{\/each}}/g, (_match, path, body) => {
    const items = resolveTemplatePath(path.trim(), scope, rootData);
    if (!Array.isArray(items)) return "";
    return items.map((item) => renderScopedTemplate(body, item, rootData)).join("");
  });
  rendered = rendered.replace(/{{\s*join\s+([^\s}]+)\s+(['"])(.*?)\2\s*}}/g, (_match, path, _quote, separator) => {
    const value = resolveTemplatePath(path.trim(), scope, rootData);
    if (!Array.isArray(value)) return "";
    return escapeHtml(value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(separator));
  });
  rendered = rendered.replace(/{{\s*json\s+([^}]+)\s*}}/g, (_match, path) => {
    const value = resolveTemplatePath(path.trim(), scope, rootData);
    return escapeHtml(JSON.stringify(value, null, 2));
  });
  rendered = rendered.replace(/{{\s*([a-zA-Z0-9_.-]+|this)\s*}}/g, (_match, path) => {
    return escapeHtml(resolveTemplatePath(path.trim(), scope, rootData));
  });
  return rendered;
}
function resolveTemplatePath(path, scope, rootData) {
  if (path === "this") return scope;
  if (path === "data") return rootData;
  const parts = path.split(".").filter(Boolean);
  let current;
  if (parts[0] === "data") {
    current = rootData;
    parts.shift();
  } else {
    current = scope;
  }
  for (const part of parts) {
    if (current == null) return "";
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      current = Number.isFinite(index) ? current[index] : void 0;
      continue;
    }
    if (!isPlainObject(current)) return "";
    current = current[part];
  }
  return current ?? "";
}

// src/parser.ts
function parseJsonTrackerResponse(content) {
  const repairSteps = [];
  const candidates = [
    content,
    stripFences(content),
    extractBalancedJson(content)
  ].filter((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  for (const candidate of candidates) {
    const normalized = normalizeJsonCandidate(candidate, repairSteps);
    try {
      return {
        data: JSON.parse(normalized),
        repairSteps: [...new Set(repairSteps)]
      };
    } catch {
    }
  }
  throw new Error("The model did not return valid JSON tracker data.");
}
function stripFences(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const firstFence = trimmed.indexOf("```");
  if (firstFence === -1) return trimmed;
  const afterOpen = trimmed.indexOf("\n", firstFence);
  const lastFence = trimmed.lastIndexOf("```");
  if (afterOpen !== -1 && lastFence > afterOpen) {
    return trimmed.slice(afterOpen + 1, lastFence).trim();
  }
  return trimmed;
}
function normalizeJsonCandidate(content, repairSteps) {
  let out = content.trim().replace(/\r\n?/g, "\n");
  if (out !== content.trim()) repairSteps.push("line-ending normalization");
  const smartQuoteNormalized = out.replace(/[\u201c\u201d\u201e\u201f]/g, '"');
  if (smartQuoteNormalized !== out) repairSteps.push("smart quote normalization");
  out = smartQuoteNormalized;
  const trailingCommaNormalized = removeTrailingCommas(out);
  if (trailingCommaNormalized !== out) repairSteps.push("trailing comma removal");
  out = trailingCommaNormalized;
  return out;
}
function removeTrailingCommas(content) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let j = i + 1;
      while (/\s/.test(content[j] ?? "")) j += 1;
      if (content[j] === "}" || content[j] === "]") {
        continue;
      }
    }
    output += char;
  }
  return output;
}
function extractBalancedJson(content) {
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char !== "{" && char !== "[") continue;
    const end = findBalancedEnd(content, i);
    if (end !== void 0) return content.slice(i, end + 1);
  }
  return void 0;
}
function findBalancedEnd(content, start) {
  const stack = [content[start] === "{" ? "}" : "]"];
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < content.length; i += 1) {
    const char = content[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") stack.push("}");
    if (char === "[") stack.push("]");
    if (char === "}" || char === "]") {
      const expected = stack.pop();
      if (expected !== char) return void 0;
      if (stack.length === 0) return i;
    }
  }
  return void 0;
}

// src/backend.ts
var settingsCache;
var busy = false;
var lastError;
var interceptorRegistered = false;
async function loadSettings() {
  if (settingsCache) return settingsCache;
  const saved = await spindle.storage.getJson(SETTINGS_PATH, { fallback: defaultSettings });
  settingsCache = deepMergeSettings(saved);
  await spindle.storage.setJson(SETTINGS_PATH, settingsCache, { indent: 2 });
  return settingsCache;
}
async function saveSettings(settings) {
  settingsCache = deepMergeSettings(settings);
  await spindle.storage.setJson(SETTINGS_PATH, settingsCache, { indent: 2 });
  return settingsCache;
}
async function loadChatConfig(chatId) {
  return spindle.storage.getJson(chatConfigPath(chatId), { fallback: {} });
}
async function saveChatConfig(chatId, config) {
  await spindle.storage.setJson(chatConfigPath(chatId), config, { indent: 2 });
}
function hasPermission(permission) {
  try {
    return !!spindle.permissions?.has?.(permission);
  } catch {
    return false;
  }
}
function permissionWarnings() {
  const warnings = [];
  for (const permission of ["generation", "chats", "chat_mutation", "interceptor", "ui_panels", "app_manipulation"]) {
    if (!hasPermission(permission)) warnings.push(permission);
  }
  return warnings;
}
async function buildState() {
  const settings = await loadSettings();
  return {
    settings,
    activeChat: await getActiveChatState(settings),
    permissionWarnings: permissionWarnings(),
    busy,
    ...lastError ? { lastError } : {}
  };
}
async function sendState(userId) {
  spindle.sendToFrontend({ type: "state", state: await buildState() }, userId);
}
async function getActiveChatState(settings) {
  if (!hasPermission("chats") || !hasPermission("chat_mutation")) {
    return null;
  }
  const chat = await spindle.chats.getActive();
  if (!chat) return null;
  const messages = await spindle.chat.getMessages(chat.id);
  return {
    id: chat.id,
    name: chat.name ?? "Active chat",
    messageCount: messages.length,
    trackers: collectTrackerSummaries(chat.id, messages, settings)
  };
}
function collectTrackerSummaries(chatId, messages, settings) {
  return messages.flatMap((message) => {
    const tracker = readTrackerRecord(message);
    if (!tracker) return [];
    const preset = settings.schemaPresets[tracker.schemaId];
    const renderedHtml = safeRenderTracker(tracker.templateHtml || preset?.templateHtml || "", tracker.data);
    return [{
      chatId,
      messageId: message.id,
      role: message.role,
      messagePreview: safePreview(message.content || ""),
      tracker: {
        ...tracker,
        renderedHtml
      }
    }];
  });
}
function readTrackerRecord(message) {
  const metadata = message.metadata;
  const candidate = metadata?.[METADATA_KEY];
  if (!candidate || typeof candidate !== "object") return void 0;
  const record = candidate;
  if (!record.data || !record.sourceMessageId) return void 0;
  return record;
}
function resolveTargetMessage(messages, requestedMessageId) {
  if (requestedMessageId) {
    const found = messages.find((message) => message.id === requestedMessageId);
    if (!found) throw new Error(`Message not found: ${requestedMessageId}`);
    return found;
  }
  const preferred = [...messages].reverse().find((message) => message.role === "assistant") ?? messages[messages.length - 1];
  if (!preferred) throw new Error("No messages are available in the active chat.");
  return preferred;
}
async function generateTrackerForMessage(options) {
  if (!hasPermission("generation")) throw new Error("Generation permission is not granted.");
  if (!hasPermission("chat_mutation")) throw new Error("Chat mutation permission is not granted.");
  const settings = await loadSettings();
  const chat = options.chatId ? { id: options.chatId } : await spindle.chats.getActive();
  if (!chat?.id) throw new Error("No active chat is open.");
  const messages = await spindle.chat.getMessages(chat.id);
  const target = resolveTargetMessage(messages, options.messageId);
  const targetIndex = messages.findIndex((message) => message.id === target.id);
  const chatConfig = await loadChatConfig(chat.id);
  const preset = getSchemaPreset(settings, chatConfig.schemaId);
  const sequential = options.sequential ?? settings.sequentialPartGeneration;
  const data = sequential ? await generateTrackerSequential(messages, targetIndex, settings, preset, options.userId) : await generateTrackerFull(messages, targetIndex, settings, preset, options.userId);
  const record = makeTrackerRecord(target.id, preset, data);
  await persistTrackerRecord(chat.id, target, record, settings);
  return record;
}
async function generateTrackerFull(messages, targetIndex, settings, preset, userId) {
  const prompt = buildTrackerPrompt(messages, targetIndex, settings, preset);
  return requestJsonForSchema(prompt, preset.schema, "tracktor_tracker", settings, userId);
}
async function generateTrackerSequential(messages, targetIndex, settings, preset, userId) {
  const keys = getTopLevelSchemaKeys(preset.schema);
  if (keys.length === 0) throw new Error("The active tracker schema has no top-level properties.");
  const tracker = {};
  for (const key of keys) {
    const partSchema = buildTopLevelPartSchema(preset.schema, key);
    const prompt = buildTrackerPrompt(messages, targetIndex, settings, preset, {
      partKey: key,
      trackerSoFar: tracker
    });
    const part = await requestJsonForSchema(prompt, partSchema, `tracktor_${key}`, settings, userId);
    if (!part || typeof part !== "object" || !(key in part)) {
      throw new Error(`Part response did not include "${key}".`);
    }
    tracker[key] = part[key];
  }
  return tracker;
}
async function requestJsonForSchema(promptMessages, schema, schemaName, settings, userId) {
  const parameters = {
    max_tokens: settings.maxResponseTokens
  };
  const messages = [...promptMessages];
  if (settings.generationMode === "native_json") {
    parameters.response_format = {
      type: "json_schema",
      json_schema: {
        name: schemaName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48),
        strict: true,
        schema
      }
    };
  } else {
    messages.push({
      role: "user",
      content: buildJsonFormatInstruction(schema)
    });
  }
  const result = await spindle.generate.quiet({
    type: "quiet",
    messages,
    parameters,
    ...userId ? { userId } : {}
  });
  if (result?.content && typeof result.content === "object") {
    return result.content;
  }
  const content = typeof result?.content === "string" ? result.content : JSON.stringify(result?.content ?? "");
  const parsed = parseJsonTrackerResponse(content);
  if (settings.debugLogging && parsed.repairSteps.length > 0) {
    spindle.log.info(`Tracktor parser repair steps: ${parsed.repairSteps.join(", ")}`);
  }
  return parsed.data;
}
function buildTrackerPrompt(messages, targetIndex, settings, preset, options = {}) {
  const start = Math.max(0, targetIndex - settings.includeLastMessages + 1);
  const recent = messages.slice(start, targetIndex + 1);
  const priorTrackers = collectPriorTrackers(messages.slice(0, targetIndex + 1), settings.includeLastTrackers);
  const target = messages[targetIndex];
  const partLine = options.partKey ? `Generate only the top-level "${options.partKey}" property and return it wrapped in a JSON object.` : "Generate the complete tracker object.";
  const prompt = [
    { role: "system", content: settings.systemPrompt },
    {
      role: "user",
      content: [
        settings.extractionPrompt,
        partLine,
        `Active schema preset: ${preset.name}`,
        `Target message id: ${target.id}`
      ].join("\n")
    }
  ];
  if (priorTrackers.length > 0) {
    prompt.push({
      role: "user",
      content: `Previous tracker snapshots for continuity:

${priorTrackers.map((record) => formatTrackerSnapshot(record, record.schemaName)).join("\n\n")}`
    });
  }
  if (options.trackerSoFar && Object.keys(options.trackerSoFar).length > 0) {
    prompt.push({
      role: "user",
      content: `Tracker fields already generated in this run:
\`\`\`json
${JSON.stringify(options.trackerSoFar, null, 2)}
\`\`\``
    });
  }
  prompt.push({
    role: "user",
    content: `Recent conversation up to the target message:

${formatConversation(recent)}`
  });
  return prompt;
}
function buildJsonFormatInstruction(schema) {
  return [
    "Return only one valid JSON object. Do not include markdown fences, commentary, or prose outside JSON.",
    "The object must conform to this JSON Schema:",
    "```json",
    JSON.stringify(schema, null, 2),
    "```",
    "Example shape:",
    "```json",
    JSON.stringify(schemaToExample(schema), null, 2),
    "```"
  ].join("\n");
}
function formatConversation(messages) {
  return messages.map((message) => `${message.role.toUpperCase()} (${message.id}):
${message.content.trim()}`).join("\n\n");
}
function collectPriorTrackers(messages, limit) {
  if (limit <= 0) return [];
  const found = [];
  for (let i = messages.length - 1; i >= 0 && found.length < limit; i -= 1) {
    const record = readTrackerRecord(messages[i]);
    if (record) found.unshift(record);
  }
  return found;
}
function makeTrackerRecord(messageId, preset, data) {
  return {
    version: VERSION,
    schemaId: preset.id,
    schemaName: preset.name,
    schema: preset.schema,
    templateHtml: preset.templateHtml,
    data,
    renderedHtml: safeRenderTracker(preset.templateHtml, data),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceMessageId: messageId
  };
}
function safeRenderTracker(templateHtml, data) {
  try {
    return renderTrackerTemplate(templateHtml, data);
  } catch (error) {
    return `<pre>${escapeForPre(JSON.stringify(data, null, 2))}</pre>`;
  }
}
function escapeForPre(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
async function persistTrackerRecord(chatId, message, record, settings) {
  const nextMetadata = {
    ...message.metadata ?? {},
    [METADATA_KEY]: record
  };
  await spindle.chat.updateMessage(chatId, message.id, { metadata: nextMetadata });
  if (settings.chatVariableExport.enabled) {
    await spindle.variables.chat.set(chatId, settings.chatVariableExport.key, JSON.stringify(record.data));
  }
}
async function updateTrackerData(chatId, messageId, data) {
  const settings = await loadSettings();
  const messages = await spindle.chat.getMessages(chatId);
  const message = messages.find((item) => item.id === messageId);
  if (!message) throw new Error(`Message not found: ${messageId}`);
  const current = readTrackerRecord(message);
  const preset = getSchemaPreset(settings, current?.schemaId);
  const record = makeTrackerRecord(messageId, current ? {
    id: current.schemaId,
    name: current.schemaName,
    schema: current.schema,
    templateHtml: current.templateHtml
  } : preset, data);
  await persistTrackerRecord(chatId, message, record, settings);
}
async function deleteTracker(chatId, messageId) {
  const messages = await spindle.chat.getMessages(chatId);
  const message = messages.find((item) => item.id === messageId);
  if (!message) throw new Error(`Message not found: ${messageId}`);
  const nextMetadata = { ...message.metadata ?? {} };
  delete nextMetadata[METADATA_KEY];
  await spindle.chat.updateMessage(chatId, messageId, { metadata: nextMetadata });
}
async function setBusy(work, userId) {
  busy = true;
  lastError = void 0;
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
function parsePayloadJson(value) {
  if (typeof value !== "string") return value;
  return parseJsonTrackerResponse(value).data;
}
spindle.onFrontendMessage(async (payload, userId) => {
  try {
    switch (payload?.type) {
      case "get_state":
        await sendState(userId);
        break;
      case "save_settings": {
        await saveSettings(payload.settings);
        spindle.toast.success("Settings saved.", { title: "Tracktor" });
        await sendState(userId);
        break;
      }
      case "set_chat_schema": {
        if (!payload.chatId || !payload.schemaId) throw new Error("chatId and schemaId are required.");
        await saveChatConfig(payload.chatId, { schemaId: payload.schemaId });
        spindle.toast.success("Chat schema updated.", { title: "Tracktor" });
        await sendState(userId);
        break;
      }
      case "generate_tracker":
        await setBusy(async () => {
          await generateTrackerForMessage({
            chatId: payload.chatId,
            messageId: payload.messageId,
            sequential: payload.sequential,
            userId
          });
          spindle.toast.success("Tracker generated.", { title: "Tracktor" });
        }, userId);
        break;
      case "update_tracker":
        await setBusy(async () => {
          await updateTrackerData(payload.chatId, payload.messageId, parsePayloadJson(payload.data));
          spindle.toast.success("Tracker updated.", { title: "Tracktor" });
        }, userId);
        break;
      case "delete_tracker":
        await setBusy(async () => {
          await deleteTracker(payload.chatId, payload.messageId);
          spindle.toast.success("Tracker deleted.", { title: "Tracktor" });
        }, userId);
        break;
      default:
        spindle.log.warn(`Unknown frontend message: ${JSON.stringify(payload)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastError = message;
    spindle.toast.error(message, { title: "Tracktor", duration: 1e4 });
    await sendState(userId);
  }
});
spindle.on("CHARACTER_MESSAGE_RENDERED", async (payload) => {
  const settings = await loadSettings();
  if (settings.autoMode !== "assistant_message") return;
  try {
    await generateTrackerForMessage({ chatId: payload.chatId, messageId: payload.messageId });
    await sendState();
  } catch (error) {
    spindle.log.warn(`Auto tracker generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});
spindle.on("USER_MESSAGE_RENDERED", async (payload) => {
  const settings = await loadSettings();
  if (settings.autoMode !== "user_message") return;
  try {
    await generateTrackerForMessage({ chatId: payload.chatId, messageId: payload.messageId });
    await sendState();
  } catch (error) {
    spindle.log.warn(`Auto tracker generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});
spindle.on("CHAT_CHANGED", async () => {
  await sendState();
});
function tryRegisterInterceptor() {
  if (interceptorRegistered || !hasPermission("interceptor")) return;
  spindle.registerInterceptor(async (messages, context) => {
    const settings = await loadSettings();
    if (!settings.injection.enabled || settings.injection.includeLastTrackers <= 0) {
      return messages;
    }
    const chatId = context?.chatId;
    if (!chatId || !hasPermission("chat_mutation")) return messages;
    const chatMessages = await spindle.chat.getMessages(chatId);
    const trackers = collectPriorTrackers(chatMessages, settings.injection.includeLastTrackers);
    if (trackers.length === 0) return messages;
    const injected = trackers.map((tracker) => ({
      role: settings.injection.role,
      content: formatTrackerSnapshot(tracker, settings.injection.header || tracker.schemaName)
    }));
    return {
      messages: [...injected, ...messages],
      breakdown: injected.map((_message, index) => ({
        messageIndex: index,
        name: "Tracktor Snapshot"
      }))
    };
  }, 80);
  interceptorRegistered = true;
  spindle.log.info("Tracktor interceptor registered.");
}
spindle.permissions?.onChanged?.(({ permission, granted }) => {
  if (permission === "interceptor" && granted) {
    tryRegisterInterceptor();
  }
});
void loadSettings().then(() => {
  tryRegisterInterceptor();
  spindle.log.info("Tracktor backend loaded.");
});
