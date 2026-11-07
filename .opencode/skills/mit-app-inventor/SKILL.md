---
name: mit-app-inventor
description: Build MIT App Inventor apps end to end through the `appinventor` MCP server — create a project, place components in the Designer, write Blockly code, validate, export .aia, compile an APK, install and test it on an emulator, and repair the defects you find. Use whenever the task involves App Inventor, .aia, .bky, Blockly, or building an Android APK from a visual blocks project.
---

# MIT App Inventor

App Inventor is the source of truth. All work happens in the live editor through the
`appinventor` MCP server (`C:\Opencode - Projects\appinventor-autonomous`). Never hand-edit
an `.aia` on disk as the primary workflow — export it, but edit the live project.

## 0. Establish the link (every session)

```
ai_status
```

If `connectedTabs` is 0:

```
ai_relay_inject          -> run `snippet` in the App Inventor editor tab
```

With the bridge extension installed, the relay re-attaches by itself after every page load.
Otherwise re-run the snippet **after any reload** (opening a project, a build, signing in).

Then:

```
ai_state                -> projectName, view, components, blocks
```

If no project is open, `ai_project_open { projectId }` (the id is the `#<number>` in the URL).

## 1. Create or import a project

```
ai_project_create { name: "TapCounter", title: "Tap Counter" }
```

This generates a minimal `.aia` and imports it through the official endpoint. It needs one
project already open so the account package prefix can be detected.

To bring in an existing project: `ai_project_import { file, name? }`.
To get an editable copy out: `ai_project_export` → returns the saved `.aia` path.

Adding a screen: `ai_screen_add { name: "History" }`.
Removing one only works for the screen currently open in the Designer.

## 2. Design the screen

Read before writing:

```
ai_component_tree                 -> authoritative tree + every property
ai_component_types { query }      -> catalog from the live editor
ai_component_schema { type }      -> events, methods, properties, getters, setters
```

Place components:

```
ai_component_add { type: "Label",  name: "LblCount" }
ai_component_add { type: "Button", name: "BtnTap" }
ai_component_add { type: "Button", name: "BtnGo", parent: "Row1" }   // nest
ai_component_rename { from: "Button1", to: "BtnReset" }
ai_component_remove { name: "LblTemp" }
```

Configure:

```
ai_component_set_property { component: "LblCount", property: "Text", value: "0" }
ai_component_set_property { component: "LblCount", property: "FontSize", value: "40" }
ai_component_properties   { component: "LblCount" }
```

Property names are the exact Designer labels. Supported editors: text, textarea, number,
checkbox, dropdown. Colour and asset pickers are not supported — leave those for the UI.

Naming: use `Type`-prefixed PascalCase (`BtnTap`, `LblCount`, `Row1`). App Inventor assigns
`Button1`, `Button2`, … and the tool renames right after adding.

## 3. Write the blocks

```
ai_blocks_context               -> live components + current workspace
ai_blocks_get { format: "xml" } -> what is already there
ai_blocks_set { xml }           -> replace (preferred when generating)
ai_blocks_add { xml }           -> append (not transactional)
ai_blocks_clear
ai_blocks_diagnostics
```

Rules that prevent almost every runtime crash:

1. **Global variables need a prefix.** Declare with `<field name="NAME">count</field>` and
   reference everywhere as `<field name="VAR">global count</field>`. An unprefixed reference
   is compiled as a local and crashes with `unbound location $count`.
2. **Arithmetic blocks are per operator**: `math_add`, `math_subtract`, `math_multiply`,
   `math_division` — there is no `math_arithmetic`.
3. **Copy mutation attributes exactly** for component blocks:
   `component_type`, `instance_name`, `event_name` / `method_name` / `property_name`,
   `set_or_get`, `is_generic="false"`. Also set the matching `COMPONENT_SELECTOR` field
   (and `PROP` for property blocks).
4. **Match instances to real components.** Run `ai_blocks_context` first; a block pointing
   at `BtnGo` when the component is `BtnGo1` compiles but never fires.

Recipes for every common block shape: [references/block-recipes.md](references/block-recipes.md).

## 4. Validate

```
ai_validate   -> { ok, issues[], screens[] }
ai_repair     -> fixes missing `global ` prefixes, reports destructive findings
```

`ai_validate` checks: unknown component types, missing assets, blocks pointing at missing
components, duplicate event handlers, undeclared globals, and globals referenced without the
prefix. Fix everything with `severity: "error"` before building.

## 5. Build

```
ai_build_apk { timeoutSeconds: 300 }
```

Returns `ok`, `file`, `bytes`, `link` and `verify.checks` (zip, manifest, dex, resources,
signature). `ok` is already a real verification — do not claim success from the build dialog
alone.

Typical: 35–50 s. On failure the result is `{ ok: false, stage: "compile", error }`.

## 6. Test on a device

```
ai_devices                 -> prefer the entry with emulator: true
ai_build_and_test { device: "emulator-5554", steps: [...] }
ai_test_apk    { file, device, steps }
ai_app_logs
```

A scenario is a list of steps:

```json
[
  { "action": "waitForText", "text": "Tap", "timeoutMs": 20000 },
  { "action": "expectText", "text": "0" },
  { "action": "tapText", "text": "Tap" },
  { "action": "expectText", "text": "1" },
  { "action": "tapText", "text": "Reset" },
  { "action": "expectText", "text": "0" }
]
```

Always pass `device` explicitly when a phone is also attached — the tool defaults to the
first emulator, but being explicit keeps the user's phone out of the loop.

Never claim the app works without a passing scenario and `crash.crashed === false`.

## 7. Debug and repair

```
ai_state / ai_blocks_diagnostics / ai_app_logs / ai_ui_eval
```

Repair loop:

```
ai_validate  -> find the defect
smallest safe fix
  global_missing_prefix   -> ai_repair (or fix the XML)
  missing component ref   -> ai_component_rename / recreate the component
  duplicate handler       -> merge the blocks by hand, never auto-delete
  missing asset           -> add the asset in the Designer (not automated)
ai_validate again  -> ai_build_apk  -> ai_test_apk
```

Failure catalogue: [references/failure-catalog.md](references/failure-catalog.md).

## Guardrails

- Do not touch projects the user did not ask about. Create a new project for new work.
- Do not use the user's phone for testing unless they ask; use an emulator.
- `ai_ui_eval` is for inspection. Anything repeatable belongs in a tool.
- Confirm before destructive project operations (delete, re-import over an existing name).
- After a page reload the relay is gone — re-inject before blaming a tool.

## Reference

| File | Contents |
| --- | --- |
| [references/block-recipes.md](references/block-recipes.md) | Exact XML for events, methods, properties, variables, procedures, loops, lists, dictionaries |
| [references/failure-catalog.md](references/failure-catalog.md) | Symptom → cause → fix, including everything learned building the sample |
| [references/workflows.md](references/workflows.md) | Copy-paste playbooks: new app, add a feature, fix a crash, ship a build |
| `../../docs/` | Architecture, tool reference, designer internals, build/test, troubleshooting |
