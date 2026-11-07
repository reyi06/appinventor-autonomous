# Security

## What this software can do

`appinventor-autonomous` drives a **live, signed-in MIT App Inventor session** in your own
browser. Anything it can do, your account can do: create and edit projects, upload files,
compile apps, and read every project you can open.

Treat it like handing an agent your editor.

## Trust boundaries

| Component | Runs where | Access |
| --- | --- | --- |
| MCP server (`mcp/server.js`) | your machine | stdio, plus a loopback HTTP listener |
| Relay (`mcp/page/relay.js`) | inside the App Inventor tab | runs as *you* in that tab; only acts on the open project |
| Bridge extension (`extension/`) | Chrome | `scripting`, `tabs`, `alarms`, `storage` on `*.appinventor.mit.edu` only |

- The HTTP/WebSocket listener binds **127.0.0.1 only**. It is not reachable from your network.
- The extension requests no host permissions beyond App Inventor and `127.0.0.1`.
- Nothing is sent to a remote service. There is no telemetry.

## The loopback listener is authenticated

Binding loopback keeps the server off your network but **not away from your browser**: any page
you have open can send requests to `127.0.0.1:8766`, and `ai_asset_upload` reads an arbitrary
local file into the project. So the listener is a security boundary, and it is enforced:

| Control | Closes |
| --- | --- |
| `Host` must be `127.0.0.1:<port>` or `localhost:<port>` | DNS rebinding — a domain that resolves to 127.0.0.1 still sends its own `Host` |
| WebSocket `Origin` must match `*.appinventor.mit.edu` | another site's page attaching to your editor |
| `POST /rpc` and `POST /relay-call` require `Authorization: Bearer <token>` | everything that is not the extension or a local script |
| `POST` bodies must be `application/json` | CSRF without a preflight — `text/plain` is a CORS "simple request" and would otherwise be sent even though the response is unreadable |
| CORS reflects only allowed origins, never `*` | cross-origin reads of `/health` and `/rpc` |

The token is generated on first run, 48 hex characters, and kept in `logs/token`
(gitignored). `APPINVENTOR_MCP_TOKEN` overrides it; `ai_status { action: "status" }` reports the
file. A second server instance that failed to bind reuses the same file, so the port-busy
fallback keeps working.

```sh
# what a local script has to send
curl -s http://127.0.0.1:8766/rpc \
  -H "Authorization: Bearer $(cat logs/token)" \
  -H "Content-Type: application/json" \
  -d '{"tool":"ai_status","arguments":{"action":"status"}}'
```

`npm run security` runs the whole matrix — 34 checks, including a real WebSocket handshake
from a foreign origin.

## What this does not protect against

- **A process running as you.** It can read `logs/token` and connect. The threat model is other
  *websites* and *browser extensions*, not local malware. If your machine is compromised, this
  tool is compromised; so is your App Inventor session, which is open in your browser anyway.
- **A hostile extension.** Extensions can read and modify pages in their host permissions. Load
  only the bridge extension.

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
  relay script, and would then be the thing your editor talks to. Start the server before
  opening the editor, and keep the extension loaded so the relay is injected by it.
- `*.appinventor.mit.edu` is a shared domain. If it were ever compromised, its pages could
  attach to the relay; the same compromise would give an attacker the editor directly.
- App Inventor is a GWT application: this software depends on internal DOM and Blockly
  behaviour that can change without notice. See `docs/compat.md`.

## Reporting a vulnerability

Open a private security advisory on the repository (Security → Report a vulnerability) rather
than a public issue. Include reproduction steps and the App Inventor build you were using
(the version is visible in the editor's Help → About, and in `ai_status`).
