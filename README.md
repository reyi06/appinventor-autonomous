# appinventor-autonomous

**An MCP server for MIT App Inventor.**

[MCP](docs/clients.md) is the Model Context Protocol — the tool interface Claude Code, Codex,
Cursor, Windsurf, VS Code and OpenCode all speak. This server exposes a live App Inventor
session through it: **13 tools** that create projects, place components, set properties, write
Blockly, validate the result, compile an APK, install it on an emulator and assert on the UI.

It is an MCP server in the strict sense: it holds no model of its own. The 6 prompts and 10
resources are optional conveniences — the tools are the product. Point any MCP client at it and
the App Inventor editor becomes something an agent can operate.

App Inventor stays the source of truth. Nothing is re-implemented offline: every edit goes
through the live editor (GWT designer, Blockly workspace, official upload/download and build
endpoints) and is then read back and verified — the tool reports success only when the editor
or the exported project agrees.

## Status

Verified end to end on `ai2a.appinventor.mit.edu` (Form `$Version 32`), in both Classic and
Neo UI modes, against the apps in [samples/](samples):

| Capability | State |
| --- | --- |
| Create / import / export projects | works |
| Read component tree + every property | works (authoritative `.scm`) |
| Add / remove / rename components, nest in containers | works, verified after each change |
| Set designer properties (text, number, bool, length) | works |
| Set **choice** properties (alignment, shape, typeface) | works — drives the `DropDownButton` menu |
| Set **colour** properties | works — drives the colour picker; verified by re-reading the picker, because the panel cannot display a custom colour |
| **Project properties** (theme, primary/dark/accent colour, app name, version) | works via the Project Properties dialog; `PrimaryColorDark` reported as unsupported |
| Asset upload (PNG/SVG/audio/video/JSON) | works, verified in the exported `.aia` and the APK |
| Layout IR compiler (JSON spec → screen) | works, with a fidelity report |
| Read / replace / append / clear Blockly code | works |
| Block diagnostics (duplicates, unknown refs, unbound variables) | works |
| Compile APK, download, verify package structure | works (~35–50 s) |
| Install + launch + scripted UI tests + crash detection | works (emulator) |
| Static validation + safe auto-repair | works |
| Add screen | works |
| Remove screen | only the screen currently open in the Designer |
| Switch screens | works — verified against the live model, returns `previous`/`current` |
| Live preview while editing | ~4 s per change via the AI2 Companion, see [docs/live-preview.md](docs/live-preview.md) |
| MCP prompts (6 workflows) and resources (10 URIs) | works |
| Self-test against the live editor | works (`ai_selftest`) |
| Component **extensions** (`.aix`) | not implemented — the palette slot is there, the import is not |

## Download

Three ways in, all the same server:

```bash
# 1. a release tarball (no git, no build step)
curl -L -o appinventor-autonomous.tgz \
  https://github.com/reyi06/appinventor-autonomous/releases/latest/download/appinventor-autonomous.tgz
tar -xzf appinventor-autonomous.tgz && cd package && npm ci

# 2. the CLI, once published to npm
npx appinventor-mcp --print-config

# 3. a clone, if you want the tests and the samples
git clone https://github.com/reyi06/appinventor-autonomous.git
cd appinventor-autonomous && npm ci
```

Every release is built from a tagged commit by CI, which also runs the protocol,
security and corpus suites before the tarball exists.

## Install

Add the server to your MCP client — see [docs/clients.md](docs/clients.md) for
Claude Code, Codex, Cursor, Windsurf, VS Code and OpenCode:

```json
{
  "mcpServers": {
    "appinventor": {
      "command": "node",
      "args": ["/absolute/path/to/appinventor-autonomous/mcp/server.js"],
      "env": { "APPINVENTOR_MCP_PORT": "8766" }
    }
  }
}
```

`npx appinventor-mcp --print-config` prints the same block with absolute paths filled in.

Requirements: **Node 20+**, a Chromium browser, and an App Inventor account. Android builds
and device testing additionally need the Android SDK (`adb`, plus `build-tools` for `aapt`).
The live-preview loop optionally uses MIT's setup package — [docs/live-preview.md](docs/live-preview.md).

### Local listener

The server listens on `127.0.0.1:8766` for the browser relay and optionally for scripts.
Loopback is not a security boundary on its own — a page in your browser can reach it — so the
listener is authenticated: the WebSocket accepts only `*.appinventor.mit.edu` origins, and
`POST /rpc` / `POST /relay-call` need `Authorization: Bearer <token>` with the token generated
on first run into `logs/token` (gitignored). Details in [SECURITY.md](SECURITY.md).

## Quick start

1. **Attach the relay to the editor.** Either
   - load the unpacked extension in `extension/` (Chrome → `chrome://extensions` →
     Developer mode → Load unpacked), which re-attaches automatically after every page load, or
   - call `ai_status { action: "inject" }` and run the returned snippet in the App Inventor tab.

2. **Check the link.**

   ```
   ai_status                    -> { connectedTabs: 1, ... }
   ai_status { action: "selftest" }  -> 6/6
   ai_status { action: "state" }     -> { view, selected, components, blocks }
   ```

3. **Build something.**

   ```
   ai_project   { action: "create", name: "MyApp" }
   ai_component { action: "add", type: "Button", name: "BtnGo" }
   ai_component { action: "set", component: "BtnGo", property: "Text", value: "Go" }
   ai_blocks    { action: "set", xml: "<xml ...>...</xml>" }
   ai_validate
   ai_test      { action: "buildAndTest", device: "emulator-5554", steps: [...] }
   ```

4. **Connect a capable client.** The workflows in
   [docs/prompts](docs/prompts) are served as MCP prompts; the skill in
   [.opencode/skills/mit-app-inventor](.opencode/skills/mit-app-inventor) teaches an agent the
   order of operations and the traps.

## This is unofficial

MIT App Inventor has no public API. This project drives its **web client** the way a person
does — the same endpoints, the same Blockly workspace — from a browser session you are signed
into. Consequences:

- An App Inventor update can break it. `ai_status { action: "selftest" }` tells you which
  layer; [docs/compat.md](docs/compat.md) lists what breaks first.
- It is not affiliated with or endorsed by MIT or the App Inventor team.
- Use your own account. Do not use it to touch projects you have no right to change, and do
  not point it at someone else's session.
- There is no warranty. See [LICENSE](LICENSE) and [SECURITY.md](SECURITY.md) for the trust
  model before running it against a real account.

## Layout IR (design sources are optional)

A screen can be described as plain JSON and compiled into components:

```json
{
  "name": "Settings",
  "title": "Settings",
  "root": {
    "kind": "container",
    "layout": { "dir": "vertical", "gap": 12 },
    "children": [
      { "kind": "text",   "name": "LblTitle", "text": "Settings",
        "style": { "font": { "size": 24, "weight": "bold" } } },
      { "kind": "button", "name": "BtnSave", "text": "Save",
        "style": { "radius": 8 } },
      { "kind": "image",  "name": "ImgLogo", "asset": "logo.png",
        "width": 96, "height": 96 }
    ]
  }
}
```

- `ai_layout_plan` — dry run: component ops + fidelity report, no writes
- `ai_layout_apply` — create the screen, add components, set properties
- `ai_theme_apply` — apply colour/type tokens to an existing screen

The IR deliberately only holds what App Inventor can express. Anything a design source
provides beyond that is reported as `approximated` or `unsupported`, never silently dropped.
FigCraft, Penpot or a hand-written spec all translate into this shape; the compiler itself
knows nothing about them.

## Prompts and resources

The server ships MCP prompts (workflows invoked from the client) and resources (readable
documents), both from files in this repo:

```
docs/prompts/*.md                       single source of truth for workflows
appinventor://docs/<topic>              architecture, designer, blocks, build-and-test, ...
appinventor://catalog/components        live component catalog
appinventor://project/tree              component tree from the saved .scm
appinventor://project/blocks            Blockly XML of the active screen
appinventor://state                     live editor state
```

Prompts: `app_from_brief`, `screen_from_design`, `restyle_screen`, `fix_runtime_crash`,
`ship_apk`, `audit_app`. The skill at `.opencode/skills/mit-app-inventor` points at the same
files, so the two cannot drift apart.


```
bin/appinventor-mcp.js  npx entry point (--port, --print-config)
mcp/
  server.js             MCP stdio + HTTP relay host + WebSocket hub
  tools.js              the tools (schemas + handlers)
  prompts.js            MCP prompts from docs/prompts/*.md
  resources.js          MCP resources (docs, catalog, project tree, blocks)
  page/relay.js         in-page agent driving GWT + Blockly (served at /relay.js)
  layout/
    ir.js               Layout IR: validation, colours, sizing
    plan.js             IR -> component/property/spacer ops + fidelity report
    apply.js            ops -> verified tool calls
  lib/hub.js            WebSocket hub, request correlation, single-instance forwarding
  lib/mcp.js            JSON-RPC stdio transport (tools, prompts, resources)
  lib/zip.js            ZIP read/write (AIA, APK, AAB)
  lib/scm.js            .aia / .scm / .bky / project.properties helpers
  lib/adb.js            device control, UI dumps, scenario runner, logcat triage
extension/              MV3 bridge that keeps the relay attached
docs/
  prompts/              one markdown file per MCP prompt (single source)
  architecture.md designer.md blocks.md build-and-test.md troubleshooting.md mcp-tools.md
tests/mcp-smoke.mjs     protocol smoke test (no browser needed)
samples/                pizza/ — the block generator and its output (no binaries)
```

## Design notes

- **Reads are authoritative.** `ai_component_tree`, `ai_screens_list` and `ai_validate`
  export the live project as `.aia`, unzip it in the server, and parse the `.scm`/`.bky`.
  There is no guessing from the DOM.
- **Writes go through the real editor**, then are verified against the live component
  database. A failed rename/delete throws instead of reporting success.
- **Blocks are plain Blockly XML.** Any block type the workspace knows can be written,
  including `component_event`, `component_method`, `component_set_get`, procedures,
  lexical variables, lists, dictionaries, loops and arbitrary raw types.
- **Calls are addressed to one relay**, so duplicate tabs never execute a command twice.
- **13 tools, not 50.** Every tool is intention-level and takes an `action`; the ~48 internal
  operations sit behind them. Large tool catalogues measurably degrade agent tool selection.
  `ai_batch` runs several calls in one request.
- **Untrusted content is marked.** Results that embed text from the project or device carry
  `_untrusted: true` and a notice: a project containing instruction-like text is data, not a
  command.
- **The relay is version-pinned.** The server refuses a page relay whose version differs from
  the script it ships, so a stale or foreign script cannot drive a signed-in session.
- **`ai_ui_eval` is off by default** (`AI2_ALLOW_EVAL=1` to enable): it executes arbitrary
  JavaScript in that session.
- **Destructive writes checkpoint first** to `checkpoints/*.aia`, so a bad edit is
  recoverable by re-importing.

## Known pitfalls (learned the hard way)

- `lexical_variable_get/set` must reference globals as `global <name>`; without the prefix
  App Inventor compiles a *local* lookup and the app crashes at runtime with
  `unbound location $name`. `ai_validate` catches this, `ai_blocks { action: "repair" }` fixes it.
- `math_arithmetic` does not exist. `math_add`/`math_multiply` take `NUM0`/`NUM1`;
  `math_subtract`/`math_division` take `A`/`B`. Wrong socket names are dropped silently.
- Procedure definitions use a `NAME` field; a call needs the mutation **and** a `PROCNAME`
  field. Miss it and every call block shows an error marker.
- `Notifier.ShowAlert` is a toast, not a dialog, and `ShowChooseDialog`'s `cancelable` flag
  adds a *third* button.
- GWT buttons ignore a bare `click` event — the relay dispatches a full pointer + mouse
  sequence at real coordinates.
- A modal dialog (for example a finished build) blocks every later designer click; the
  relay dismisses stale dialogs before each designer operation.
- `ai_blocks { action: "add" }` is not transactional: an invalid block type leaves the earlier
  blocks in place. Use `action: "set"` when the XML is not known-good.
- The Android launcher is always `Screen1`; a UI built on another screen installs and opens
  blank.

## Documentation

| File | Contents |
| --- | --- |
| [docs/mcp-tools.md](docs/mcp-tools.md) | every tool and action |
| [docs/architecture.md](docs/architecture.md) | server → relay → editor, and why |
| [docs/designer.md](docs/designer.md) | designer automation and its limits |
| [docs/layout.md](docs/layout.md) | the six layout components and the rules they follow |
| [docs/blocks.md](docs/blocks.md) | block authoring rules and recipes |
| [docs/build-and-test.md](docs/build-and-test.md) | compiling and device testing |
| [docs/live-preview.md](docs/live-preview.md) | the 4-second loop: Companion + emulator |
| [docs/clients.md](docs/clients.md) | Claude Code, Codex, Cursor, VS Code, OpenCode |
| [docs/compat.md](docs/compat.md) | what survives an App Inventor release |
| [docs/troubleshooting.md](docs/troubleshooting.md) | failure catalogue |
| [docs/release.md](docs/release.md) | publishing checklist |
| [SECURITY.md](SECURITY.md) | trust boundaries and controls |
| [CONTRIBUTING.md](CONTRIBUTING.md) | how to test against a live editor |
