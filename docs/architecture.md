# Architecture

```
 agent / MCP client
        │  stdio JSON-RPC (newline-delimited)
        ▼
 ┌─────────────────────────┐        HTTP 127.0.0.1:8766
 │ mcp/server.js           │◄──────  GET /relay.js   (page relay source)
 │  ├ MCP transport        │        GET /health
 │  ├ tool registry        │        POST /relay-call (raw relay call)
 │  └ WebSocket hub        │        POST /rpc        (tool call, debugging)
 └───────────┬─────────────┘
             │ ws://127.0.0.1:8766
             ▼
 ┌─────────────────────────┐
 │ mcp/page/relay.js       │   runs in the App Inventor tab, MAIN world
 │  ├ GWT designer control │
 │  ├ Blockly read/write   │
 │  └ fetch to same origin │
 └───────────┬─────────────┘
             ▼
   ai2a.appinventor.mit.edu
   (designer DOM, Blockly workspace, /ode/upload, /ode/download, /b/<nonce>)
```

## Why a page relay

App Inventor has no public API. Its GWT client keeps the project model in the browser and
persists it through `POST /ode/projects` (GWT-RPC `save2`) on autosave. The only reliable
way to edit a project *and keep the editor consistent* is to act inside that page:

- **Designer edits** go through the real widgets (palette double-click, Rename/Delete
  dialogs, property editors), so App Inventor performs its own validation, renaming
  propagation and autosave.
- **Block edits** go through `Blockly.Xml.domToWorkspace` / `workspaceToDom`, so the
  workspace, warnings and code generation all stay in sync.

The relay is served by the MCP host, so upgrading the integration means restarting the
server and re-attaching — no extension rebuild.

## The extension

`extension/` is deliberately thin. On every navigation of an `*.appinventor.mit.edu` tab it
injects `<script src="http://127.0.0.1:8766/relay.js">` in the MAIN world and shows a badge
with the number of connected tabs. It holds no logic of its own, so the relay can change
freely.

Without the extension, call `ai_relay_inject` and run the snippet after each page load.

## One bridge, many MCP clients

Only one process can own port 8766. If a second MCP server starts (for example after the
client restarts without the old process exiting), it probes `/health`, detects a live
bridge, and forwards every relay call to it over `POST /relay-call`. That means the tools
work regardless of which instance the client spawned, and no command is ever sent twice —
calls are addressed to a single tab, not broadcast.

## Request flow

1. Tool handler runs in `tools.js`.
2. Local work first when possible (ZIP parsing, `.scm` reading, aapt, adb, HTTP downloads).
3. Relay calls go `hub.call(tool, params)` → `{type:"call", id, tool, params}` over WebSocket.
4. The relay resolves the promise and replies `{type:"result", id, ok, result}`.
5. Errors come back as `{ok:false, error}` and surface as MCP `isError` results.

Timeouts are per call: 45 s default, 90 s for block writes, up to 15 min for a compile.

## Trust boundaries

- The relay runs with the user's App Inventor session. Every write is scoped to the open
  project; nothing else in the account is touched.
- Build links (`/b/<nonce>`) are short-lived and public for ~2 h; the host downloads the
  APK directly so large binaries never travel through the MCP transport.
- `ai_ui_eval` executes arbitrary JS in the page. It exists for debugging, not for
  production workflows.

## Access control on the loopback listener

Loopback keeps the listener off the network, not away from the browser: a page can POST to
`127.0.0.1:8766`, and `ai_asset_upload` reads local files into the project. Three controls in
`mcp/lib/security.js`, all exercised by `npm run security`:

| Control | Applies to | Closes |
| --- | --- | --- |
| `Host` allowlist (`127.0.0.1`, `localhost`, `[::1]` on the bound port) | every request | DNS rebinding |
| `Origin` allowlist (`https://*.appinventor.mit.edu`) | WebSocket upgrade, CORS preflight | another site driving the editor |
| `Authorization: Bearer <token>` + `Content-Type: application/json` | `POST /rpc`, `POST /relay-call` | CSRF, including the preflight-free `text/plain` kind |

The token is created on first run in `logs/token` (48 hex characters, gitignored) and is shared
by every instance in the checkout, which is what keeps the port-busy fallback above working:
the second instance forwards `POST /relay-call` with the same bearer token.

`GET /relay.js` stays public — it is the client script, and a page that loads it still cannot
open a socket without an allowed `Origin`. `GET /health` stays public but is unreadable
cross-origin, because CORS reflects only allowed origins.

## Editor surfaces the relay drives

Each surface was found by inspecting the live page (and confirmed against
`mit-cml/appinventor-sources`), never assumed:

| Surface | How it is driven | How the result is verified |
| --- | --- | --- |
| Palette | double-click, or the component's "+" | component appears in the exported `.scm` |
| Property rows | text/checkbox/asset editors | row read-back, polled up to 3 s |
| Choice properties (alignment, shape, typeface, theme) | the `DropDownButton` menu, one click each | row caption |
| Colour properties | the colour picker (`Pickr`): type the hex, press Save | **re-read from the picker** — the panel cannot display a custom colour and repaints as "Default" |
| Project properties (theme, palette, app name, version) | the **Project Properties dialog**; one dialog per property | re-export and compare |
| Screens | the toolbar selector | live model (`previous`/`current`) |
| Blocks | `Blockly.Xml.domToWorkspace` | editor diagnostics plus the saved `.bky` |
| Assets | `POST /ode/upload/file/<pid>/<path>` | the exported `.aia` |

Two consequences shaped the design:

- **Some surfaces cannot be trusted as their own oracle.** The colour panel is lossy, so a
  colour write is verified by re-opening the picker; the property file is rewritten by the
  editor, so project properties are verified by re-exporting. When neither can confirm, the
  tool returns `verified: false` with the reason instead of claiming success.
- **The file is not always the source of truth.** `youngandroidproject/project.properties`
  returns success on write and is then overwritten; the dialog is the writer that sticks.
  See `docs/designer.md`.

## Verification model

Every mutating tool follows the same shape:

1. **Checkpoint** destructive writes to `checkpoints/*.aia`.
2. **Act** on the real editor surface.
3. **Read back** from the most authoritative place available (row, live model, saved file).
4. **Report** `verified: true` only when the read matches; otherwise an error or an explicit
   `unverified`/`unsupported` entry.

`ai_validate` is the project-level version of the same idea: it reads the exported `.aia`
and the editor's own diagnostics, so a mismatch between what the tools think they did and
what the project contains is reported rather than hidden.
