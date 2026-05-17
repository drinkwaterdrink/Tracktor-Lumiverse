# Tracktor for Lumiverse

Tracktor is a Lumiverse Spindle extension scaffold for flexible, schema-driven chat trackers. It is inspired by SillyTavern zTracker/WTracker, but it is built around Lumiverse APIs instead of SillyTavern globals.

## What It Does

- Generates structured tracker JSON with the user's active Lumiverse generation profile.
- Stores tracker records on Lumiverse message metadata under `metadata.tracktor`.
- Provides a drawer tab for settings, schema presets, manual generation, editing, and deletion.
- Provides an entry in Lumiverse extension settings with the same prompt and schema controls.
- Renders tracker widgets inline on tracked messages using Lumiverse message widgets.
- Supports prompted JSON and native JSON-schema generation modes.
- Supports sequential top-level part generation for large schemas.
- Can inject recent tracker snapshots into normal generations through a Spindle interceptor.
- Can export the latest tracker to a chat variable such as `{{@tracktor}}`.

## How To Open It In Lumiverse

After installing and granting permissions, Tracktor appears as a Lumiverse drawer tab:

- Open the sidebar / ViewportDrawer and click **Track**.
- Or press `Ctrl+K` / `Cmd+K`, type `Tracktor`, and open the tab from the command palette.
- Or open the chat input bar **Extras** popover and choose **Open Tracktor**.

The drawer tab contains the tracker list, generation buttons, settings, prompt textareas, JSON schema editor, and HTML template editor.

Tracktor also mounts its controls in **Settings -> Extensions -> Tracktor** when Lumiverse exposes the extension settings mount.

The input bar **Extras** popover also has **Generate Latest Tracker** for quickly generating a tracker for the latest message.
Inside the drawer/settings UI, use **Generate Tracker** to create the current tracker with the built-in default prompt or your edited prompt/schema.

## Project Layout

```text
spindle.json
src/
  backend.ts    # generation, storage, metadata, interceptor
  frontend.ts   # drawer tab, widgets, settings UI
  shared.ts     # schema defaults, template renderer, shared types
  parser.ts     # JSON extraction and repair
```

## Build

```bash
npm install
npm run build
npm run smoke
```

The build emits bundled `dist/backend.js` and `dist/frontend.js` entry files for Lumiverse. The TypeScript output for shared smoke tests is also left in `dist/`.

## Permissions

Tracktor requests:

- `generation`: generate tracker data with `spindle.generate.quiet`.
- `chats`: locate the active chat.
- `chat_mutation`: read messages and persist tracker metadata.
- `interceptor`: inject recent tracker snapshots into normal generations.
- `ui_panels`: allow panel-style UI placement where Lumiverse requires it.
- `app_manipulation`: allow extension settings/app mount surfaces where Lumiverse requires it.

Users still need to grant those permissions in the Lumiverse Extensions panel.
