# appinventor-autonomous

An MCP server that drives **MIT App Inventor** directly: it creates projects, edits the
Designer, writes Blockly code, exports `.aia`, compiles APKs, installs them on an
emulator, and runs UI assertions — all from an agent.

App Inventor stays the source of truth. Nothing is re-implemented offline: every edit goes
through the live editor (GWT designer, Blockly workspace, official upload/download and build
endpoints) and is then read back and verified.

## Status

Verified end to end on `ai2a.appinventor.mit.edu` (Form `$Version 32`), see
[samples/TapCounter.aia](samples/TapCounter.aia):

| Capability | State |
| --- | --- |
| Create / import / export projects | works |
| Read component tree + every property | works (authoritative `.scm`) |
| Add / remove / rename components, nest in containers | works, verified after each change |
| Set designer properties (text, number, bool, choice) | works |
| Asset upload (PNG/SVG/audio/video/JSON) | works, verified in the exported `.aia` and the APK |
| Layout IR compiler (JSON spec → screen) | works, with a fidelity report |
| Read / replace / append / clear Blockly code | works |
| Block diagnostics (duplicates, unknown refs, unbound variables) | works |
| Compile APK, download, verify package structure | works (~35–50 s) |
| Install + launch + scripted UI tests + crash detection | works (emulator) |
| Static validation + safe auto-repair | works |
| Add screen | works |
| Remove screen | only the screen currently open in the Designer |
| Switch screens | experimental — the selector does not always respond to programmatic clicks |
| MCP prompts (6 workflows) and resources (10 URIs) | works |
| Self-test against the live editor | works (`ai_selftest`) |
| Colour/typeface/alignment pickers | not automatable — reported, never faked |

## Quick start

1. **Run the server.** It is already registered in `opencode.json` as the `appinventor`
   MCP server:

   ```json
   { "command": ["<node>", "C:\\Opencode - Projects\\appinventor-autonomous\\mcp\\server.js"] }
   ```

   The server listens on `127.0.0.1:8766` and serves the page relay at `/relay.js`.

2. **Attach the relay to the editor.** Either
   - load the unpacked extension in `extension/` (Chrome → `chrome://extensions` →
     Developer mode → Load unpacked), which re-attaches automatically after every page load, or
   - call `ai_relay_inject` and run the returned snippet in the App Inventor tab.

3. **Check the link.**

   ```
   ai_status            -> { connectedTabs: 1, ... }
   ai_state             -> { projectName, view, components, blocks }
   ```

4. **Build something.**

   ```
   ai_project_create   { name: "MyApp" }
   ai_component_add    { type: "Button", name: "BtnGo" }
   ai_component_set_property { component: "BtnGo", property: "Text", value: "Go" }
   ai_blocks_add       { xml: "<xml ...>...</xml>" }
   ai_validate
   ai_build_and_test   { device: "emulator-5554", steps: [...] }
   ```

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
samples/                TapCounter.aia (+ .apk) and the block XML it was built from
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
  `unbound location $name`. `ai_validate` catches this, `ai_repair` fixes it.
- `math_arithmetic` does not exist in App Inventor; use `math_add`, `math_subtract`, etc.
- GWT buttons ignore a bare `click` event — the relay dispatches a full pointer + mouse
  sequence at real coordinates.
- A modal dialog (for example a finished build) blocks every later designer click; the
  relay dismisses stale dialogs before each designer operation.
- `ai_blocks_add` is not transactional: an invalid block type leaves the earlier blocks in
  place. Use `ai_blocks_set` (or clear first) when the XML is not known-good.
