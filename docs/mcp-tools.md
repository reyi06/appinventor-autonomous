# MCP tool reference

38 tools. Every tool returns JSON. Failures return `{ ok: false, error, code }` and never
report success for an operation that did not happen.

## Connection

| Tool | Purpose |
| --- | --- |
| `ai_status` | Connected tabs, relay version, project/screen, working directory |
| `ai_relay_inject` | Returns the snippet (and bookmarklet) that attaches the editor tab |
| `ai_state` | Live editor state: view, selected component, components, block counts |

## Project

| Tool | Purpose |
| --- | --- |
| `ai_project_info` | Project name, numeric id, editor URL |
| `ai_project_create` | Generate a minimal `.aia` and import it as a new project |
| `ai_project_import` | Import a local `.aia` (replaces a project of the same name) |
| `ai_project_export` | Export and save the `.aia`; returns path, screens, component counts |
| `ai_project_open` | Open a project by id (page reloads — the relay reconnects) |
| `ai_project_delete` | Not implemented; returns `supported: false` |

## Screens

| Tool | Purpose |
| --- | --- |
| `ai_screens_list` | Screens with component/block counts, verified from the exported `.aia` |
| `ai_screen_add` | Create a screen through the "Add Screen" dialog, verified by export |
| `ai_screen_remove` | Remove a screen; only the screen currently open in the Designer |

## Designer

| Tool | Purpose |
| --- | --- |
| `ai_component_tree` | Authoritative component tree of a screen (`.scm`), with properties |
| `ai_component_add` | Add a palette component, rename it, optionally nest in a container |
| `ai_component_remove` | Delete a component via the Designer Delete button (verified) |
| `ai_component_rename` | Rename via the Designer Rename dialog (verified both ways) |
| `ai_component_select` | Select a component so the properties panel shows it |
| `ai_component_properties` | Read live property values from the properties panel |
| `ai_component_set_property` | Write a property (text, number, boolean, choice) |
| `ai_component_types` | Component catalog from the live editor (107+ types) |
| `ai_component_schema` | Events, methods, properties, getters, setters for a type |

## Blocks

| Tool | Purpose |
| --- | --- |
| `ai_blocks_context` | Project + live components + workspace summary, for authoring XML |
| `ai_blocks_get` | Workspace as XML (pretty) or a summary |
| `ai_blocks_set` | Replace the whole workspace |
| `ai_blocks_add` | Append blocks (not transactional — see pitfalls) |
| `ai_blocks_clear` | Delete every block on the screen |
| `ai_blocks_diagnostics` | Counts, event handlers, duplicate handlers, unknown component refs |

## Validation and repair

| Tool | Purpose |
| --- | --- |
| `ai_validate` | Full project check (see below) |
| `ai_repair` | Apply the smallest safe fix for detected block defects |

`ai_validate` reports:

- `unknown_component_type` — a component type the live catalog doesn't know
- `missing_asset` — a property references a file that isn't in `assets/`
- `missing_component_reference` — a block points at a component that no longer exists
- `duplicate_event_handler` — two blocks handle the same component event
- `missing_global_declaration` — `global x` used but `x` is never declared
- `global_missing_prefix` — a global declared as `x` referenced as `x` (compiles as a
  local and crashes at runtime)

`ai_repair` applies `global_missing_prefix` only (a mechanical, provably safe rewrite) and
reports destructive findings without touching them.

## Build

| Tool | Purpose |
| --- | --- |
| `ai_build_apk` | Compile via the Build menu, download, verify the package structure |
| `ai_build_status` | Poll the build dialog for progress text or a finished link |
| `ai_download` | Fetch any URL to a local file |

`ai_build_apk` returns `verify.checks` for `size`, `zip`, `manifest`, `dex`, `resources`,
`signature`, and `entryCount`. `ok` is only true when verification passes.

## Device testing

| Tool | Purpose |
| --- | --- |
| `ai_devices` | Attached devices (emulator flag included) |
| `ai_install_apk` | Install and read the package name/activity via aapt |
| `ai_test_apk` | Install, launch, run a scenario, report crashes |
| `ai_build_and_test` | Compile → install → launch → assert → crash check in one call |
| `ai_app_logs` | Crashes and App Inventor runtime errors from logcat |

### Scenario steps

```json
[
  { "action": "waitForText", "text": "Tap", "timeoutMs": 20000 },
  { "action": "expectText", "text": "0" },
  { "action": "tapText", "text": "Tap" },
  { "action": "expectText", "text": "1" },
  { "action": "tapEditText", "index": 0 },
  { "action": "typeText", "text": "Pizza" },
  { "action": "clearText", "count": 8 },
  { "action": "tapText", "text": "ADD" },
  { "action": "expectNotText", "text": "1" },
  { "action": "back" },
  { "action": "sleep", "ms": 800 },
  { "action": "dump" }
]
```

`tapText` taps the centre of the matching bounds from a fresh `uiautomator` dump and falls
back to a case-insensitive match (Material themes upper-case dialog buttons);
`tapEditText` taps the Nth text field so `typeText` can drive it; `typeText` sends
`input text` (a leading `-` is sent as a key event); `clearText` moves to the end and sends
backspaces. `expectText` re-dumps before asserting. The runner stops at the first failure
and still reads logcat, so a crash is reported alongside the failing step.

## Escape hatch

| Tool | Purpose |
| --- | --- |
| `ai_ui_eval` | Evaluate an expression in the App Inventor page |

Use it for exploration. Anything it discovers that is worth repeating should become a
proper tool, because page internals change between App Inventor releases.
