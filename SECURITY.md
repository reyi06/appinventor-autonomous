# Security

## What this software can do

`appinventor-autonomous` drives a **live, signed-in MIT App Inventor session** in your own
browser. Anything it can do, your account can do: create and edit projects, upload files,
compile apps, and read every project you can open.

Treat it like handing an agent your editor.

## Trust boundaries

| Component | Runs where | Access |
| --- | --- | --- |
| MCP server (`mcp/server.js`) | your machine | stdio only, plus a loopback HTTP listener |
| Relay (`mcp/page/relay.js`) | inside the App Inventor tab | runs as *you* in that tab; only acts on the open project |
| Bridge extension (`extension/`) | Chrome | `scripting`, `tabs`, `alarms`, `storage` on `*.appinventor.mit.edu` only |

- The HTTP/WebSocket listener binds **127.0.0.1 only**. It is not reachable from your network.
- The extension requests no host permissions beyond App Inventor and `127.0.0.1`.
- Nothing is sent to a remote service. There is no telemetry.

## Deliberate controls

- **`ai_ui_eval` is disabled by default.** It executes arbitrary JavaScript in your signed-in
  session. Enable with `AI2_ALLOW_EVAL=1` only if you need it.
- **Results carry provenance.** Anything returned from the project or device is marked
  `_untrusted: true` with a notice: a project can contain text that looks like instructions,
  and the model must treat it as data.
- **The relay is version-pinned.** The server rejects a relay older than the script it ships,
  so a stale or foreign script cannot drive the session.
- **Destructive writes checkpoint first** to `checkpoints/*.aia`.
- **Block errors gate builds.** `ai_build` refuses to compile while the editor reports errors.

## Known limitations

- A local process that can bind `127.0.0.1:8766` before the server starts could serve its own
  relay script to the page. Run the server before opening the editor, and keep the extension
  loaded so the relay is only ever injected by it.
- The relay executes commands sent over a loopback WebSocket with no authentication. Any local
  process can connect to that port. This is a local-machine trust model, not a sandbox.
- App Inventor is a GWT application: this software depends on internal DOM and Blockly
  behaviour that can change without notice. See `docs/compat.md`.

## Reporting a vulnerability

Open a private security advisory on the repository (Security → Report a vulnerability) rather
than a public issue. Include reproduction steps and the App Inventor build you were using
(the version is visible in the editor's Help → About, and in `ai_status`).
