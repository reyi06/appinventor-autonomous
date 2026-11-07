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
