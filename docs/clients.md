# MCP clients

The server speaks **MCP over stdio**: newline-delimited JSON-RPC 2.0 on stdin and
stdout, with logs on stderr and in `logs/mcp.log`. Anything that can start a
process and speak MCP works. It echoes the client's `protocolVersion` on
`initialize` (falling back to `2024-11-05`), and only advertises capabilities it
has — so a client that knows nothing about prompts or resources simply sees 13
tools.

Nothing in the tool surface depends on a particular client: no sampling, no
elicitation, no notifications. That is what makes portability cheap.

## Config by client

Paths below are this machine's; use your own checkout.

### Claude Code

```bash
claude mcp add appinventor -- node "C:/Opencode - Projects/appinventor-autonomous/mcp/server.js"
```

or a project-scoped `.mcp.json`:

```json
{
  "mcpServers": {
    "appinventor": {
      "command": "node",
      "args": ["C:/Opencode - Projects/appinventor-autonomous/mcp/server.js"],
      "env": { "APPINVENTOR_MCP_PORT": "8766" }
    }
  }
}
```

Claude Code surfaces tools, and also the 6 prompts (as commands) and the 10
resources (as `@` references).

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.appinventor]
command = "node"
args = ["C:/Opencode - Projects/appinventor-autonomous/mcp/server.js"]
env = { APPINVENTOR_MCP_PORT = "8766" }
```

Codex uses the tools. Whether prompts/resources appear depends on the version;
the tool surface is unaffected.

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project) — same `mcpServers`
shape as Claude Code above.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, same shape.

### VS Code (Copilot agent mode)

`.vscode/mcp.json` uses a `servers` object with an explicit type:

```json
{
  "servers": {
    "appinventor": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/Opencode - Projects/appinventor-autonomous/mcp/server.js"]
    }
  }
}
```

### OpenCode

`opencode.json` in the project, or the global config:

```json
{
  "mcp": {
    "appinventor": {
      "type": "local",
      "command": ["node", "C:/Opencode - Projects/appinventor-autonomous/mcp/server.js"],
      "enabled": true
    }
  }
}
```

## Windows notes

- Quote paths that contain spaces (`C:/Opencode - Projects/...`) in the JSON, and
  prefer forward slashes — both node and the clients accept them.
- `command` must be an executable the client can spawn. If `node` is not on the
  client's `PATH`, use the absolute path to `node.exe` (this machine:
  `C:\Users\reyes\toolchains\node\node-v24.22.1-win-x64\node.exe`).
- `npx appinventor-mcp --print-config` prints a ready-made block with absolute
  paths, which saves the quoting.

## What a client needs to get right

- **Keep the process alive.** The server holds the WebSocket to the App Inventor
  tab; a client that restarts it per call loses the relay (it reconnects on the
  next `ai_status { action: "status" }` probe, but the browser tab must be
  re-injected only if the page reloaded).
- **Show tool errors.** Failures come back as MCP `isError` results with a
  `code` (`RELAY_DISCONNECTED`, `RELAY_TIMEOUT`, `IR_INVALID`, `TOOL_ERROR`).
  A client that swallows them will make the model hallucinate success.
- **Do not run two clients against the same port.** Only one process can bind
  8766; the second forwards to the first over `POST /relay-call`, which now needs
  the bearer token from `logs/token` (both instances share it).

## Compatibility summary

| Client | Tools | Prompts | Resources | Notes |
| --- | --- | --- | --- | --- |
| Claude Code | ✅ | ✅ | ✅ | first-class MCP support |
| Codex | ✅ | version-dependent | version-dependent | stdio config in `config.toml` |
| Cursor | ✅ | — | — | `mcpServers` JSON |
| Windsurf | ✅ | — | — | `mcp_config.json` |
| VS Code (Copilot) | ✅ | — | — | `servers` + `type: stdio` |
| OpenCode | ✅ | ✅ | ✅ | this project's own client |
| Any MCP stdio client | ✅ | — | — | nothing client-specific in the tools |
