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
| Read / replace / append / clear Blockly code | works |
| Block diagnostics (duplicates, unknown refs, unbound variables) | works |
| Compile APK, download, verify package structure | works (~35–50 s) |
| Install + launch + scripted UI tests + crash detection | works (emulator) |
| Static validation + safe auto-repair | works |
| Add screen | works |
| Remove screen | only the screen currently open in the Designer |
| Switch screens, asset upload, extensions, colour/asset pickers | not implemented |

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

## Layout

```
mcp/
  server.js            MCP stdio + HTTP relay host + WebSocket hub (port 8766)
  tools.js             the 38 tools (schemas + handlers)
  page/relay.js        in-page agent driving GWT + Blockly (served at /relay.js)
  lib/hub.js           WebSocket hub, request correlation, single-instance forwarding
  lib/mcp.js           JSON-RPC stdio transport
  lib/zip.js           ZIP read/write (AIA, APK, AAB)
  lib/scm.js           .aia / .scm / .bky / project.properties helpers
  lib/adb.js           device control, UI dumps, scenario runner, logcat triage
extension/             MV3 bridge that keeps the relay attached
docs/                  architecture, tool reference, designer, blocks, build/test, troubleshooting
samples/               TapCounter.aia (+ .apk) and the block XML it was built from
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
