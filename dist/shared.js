export const EXTENSION_ID = 'tracktor';
export const METADATA_KEY = 'tracktor';
export const SETTINGS_PATH = 'settings.json';
export const VERSION = '0.1.2';
export const DEFAULT_SYSTEM_PROMPT = `You are a structured tracker extraction assistant. Analyze the conversation and return only tracker data that matches the requested schema. Do not roleplay, continue the scene, explain yourself, or include markdown unless the tracker format instructions explicitly ask for it. Preserve continuity with previous tracker snapshots, but update the tracker from the newest chat evidence.`;
export const DEFAULT_EXTRACTION_PROMPT = `Create a complete tracker update for the target message. Fill every required field. If a field is not explicitly stated, infer a short, reasonable value from the conversation context. Keep values concise and concrete.`;
export const DEFAULT_SCHEMA = {
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
export const defaultSettings = {
    version: VERSION,
    activeSchemaId: 'scene',
    schemaPresets: {
        scene: {
            id: 'scene',
            name: 'Scene Tracker',
            description: 'General roleplay scene state.',
            schema: DEFAULT_SCHEMA,
            templateHtml: DEFAULT_TEMPLATE_HTML,
        },
    },
    generationMode: 'json',
    maxResponseTokens: 1800,
    includeLastMessages: 12,
    includeLastTrackers: 1,
    sequentialPartGeneration: false,
    autoMode: 'off',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
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
    debugLogging: false,
};
export function deepMergeSettings(input) {
    const saved = isPlainObject(input) ? input : {};
    const merged = structuredClone(defaultSettings);
    assignKnown(merged, saved, [
        'version',
        'activeSchemaId',
        'generationMode',
        'maxResponseTokens',
        'includeLastMessages',
        'includeLastTrackers',
        'sequentialPartGeneration',
        'autoMode',
        'systemPrompt',
        'extractionPrompt',
        'debugLogging',
    ]);
    if (isPlainObject(saved.schemaPresets)) {
        merged.schemaPresets = {};
        for (const [id, value] of Object.entries(saved.schemaPresets)) {
            if (!isPlainObject(value))
                continue;
            const preset = value;
            if (!isPlainObject(preset.schema) || typeof preset.templateHtml !== 'string')
                continue;
            const normalizedId = sanitizeId(typeof preset.id === 'string' ? preset.id : id) || id;
            merged.schemaPresets[normalizedId] = {
                id: normalizedId,
                name: typeof preset.name === 'string' && preset.name.trim() ? preset.name : normalizedId,
                description: typeof preset.description === 'string' ? preset.description : undefined,
                schema: preset.schema,
                templateHtml: preset.templateHtml,
            };
        }
        if (Object.keys(merged.schemaPresets).length === 0) {
            merged.schemaPresets = structuredClone(defaultSettings.schemaPresets);
        }
    }
    if (isPlainObject(saved.injection)) {
        assignKnown(merged.injection, saved.injection, [
            'enabled',
            'includeLastTrackers',
            'role',
            'header',
        ]);
    }
    if (isPlainObject(saved.chatVariableExport)) {
        assignKnown(merged.chatVariableExport, saved.chatVariableExport, ['enabled', 'key']);
    }
    merged.activeSchemaId = merged.schemaPresets[merged.activeSchemaId] ? merged.activeSchemaId : Object.keys(merged.schemaPresets)[0];
    merged.maxResponseTokens = sanitizeInteger(merged.maxResponseTokens, 1800, 1, 64000);
    merged.includeLastMessages = sanitizeInteger(merged.includeLastMessages, 12, 1, 200);
    merged.includeLastTrackers = sanitizeInteger(merged.includeLastTrackers, 1, 0, 25);
    merged.injection.includeLastTrackers = sanitizeInteger(merged.injection.includeLastTrackers, 1, 0, 25);
    merged.generationMode = merged.generationMode === 'native_json' ? 'native_json' : 'json';
    merged.autoMode = ['off', 'assistant_message', 'user_message'].includes(merged.autoMode) ? merged.autoMode : 'off';
    merged.injection.role = ['system', 'user', 'assistant'].includes(merged.injection.role) ? merged.injection.role : 'system';
    merged.chatVariableExport.key = sanitizeVariableKey(merged.chatVariableExport.key) || 'tracktor';
    return merged;
}
export function getSchemaPreset(settings, preferredId) {
    const id = preferredId && settings.schemaPresets[preferredId] ? preferredId : settings.activeSchemaId;
    return settings.schemaPresets[id] ?? settings.schemaPresets[Object.keys(settings.schemaPresets)[0]];
}
export function getTopLevelSchemaKeys(schema) {
    const properties = schema.properties;
    if (!isPlainObject(properties))
        return [];
    return Object.keys(properties);
}
export function buildTopLevelPartSchema(schema, key) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const property = properties[key];
    if (!property) {
        throw new Error(`Unknown schema part: ${key}`);
    }
    return {
        $schema: schema.$schema ?? 'http://json-schema.org/draft-07/schema#',
        title: `${String(schema.title ?? 'Tracker')}Part`,
        type: 'object',
        properties: { [key]: property },
        required: [key],
    };
}
export function schemaToExample(schema) {
    if (!isPlainObject(schema))
        return null;
    if ('example' in schema)
        return schema.example;
    if ('default' in schema)
        return schema.default;
    switch (schema.type) {
        case 'object': {
            const out = {};
            const properties = isPlainObject(schema.properties) ? schema.properties : {};
            for (const [key, value] of Object.entries(properties)) {
                out[key] = schemaToExample(value);
            }
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
export function renderTrackerTemplate(templateHtml, data) {
    const withoutScripts = stripDangerousHtml(templateHtml);
    return renderScopedTemplate(withoutScripts, data, data);
}
export function formatTrackerSnapshot(record, header = 'Tracker') {
    return `${header}\n\`\`\`json\n${JSON.stringify(record.data, null, 2)}\n\`\`\``;
}
export function safePreview(value, max = 160) {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= max)
        return compact;
    return `${compact.slice(0, Math.max(0, max - 1))}...`;
}
export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
export function stripDangerousHtml(html) {
    return html
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
        .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
        .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');
}
export function sanitizeId(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}
export function sanitizeVariableKey(value) {
    return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80);
}
export function chatConfigPath(chatId) {
    return `chats/${chatId.replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`;
}
export function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function assignKnown(target, source, keys) {
    const writable = target;
    for (const key of keys) {
        if (source[key] !== undefined) {
            writable[key] = source[key];
        }
    }
}
function sanitizeInteger(value, fallback, min, max) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}
function renderScopedTemplate(template, scope, rootData) {
    let rendered = template.replace(/{{#each\s+([^}]+)}}([\s\S]*?){{\/each}}/g, (_match, path, body) => {
        const items = resolveTemplatePath(path.trim(), scope, rootData);
        if (!Array.isArray(items))
            return '';
        return items.map((item) => renderScopedTemplate(body, item, rootData)).join('');
    });
    rendered = rendered.replace(/{{\s*join\s+([^\s}]+)\s+(['"])(.*?)\2\s*}}/g, (_match, path, _quote, separator) => {
        const value = resolveTemplatePath(path.trim(), scope, rootData);
        if (!Array.isArray(value))
            return '';
        return escapeHtml(value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(separator));
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
    if (path === 'this')
        return scope;
    if (path === 'data')
        return rootData;
    const parts = path.split('.').filter(Boolean);
    let current;
    if (parts[0] === 'data') {
        current = rootData;
        parts.shift();
    }
    else {
        current = scope;
    }
    for (const part of parts) {
        if (current == null)
            return '';
        if (Array.isArray(current)) {
            const index = Number.parseInt(part, 10);
            current = Number.isFinite(index) ? current[index] : undefined;
            continue;
        }
        if (!isPlainObject(current))
            return '';
        current = current[part];
    }
    return current ?? '';
}
