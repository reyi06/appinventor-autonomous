# Workflows

Copy-paste playbooks. Each one assumes the relay is connected (`ai_status` →
`connectedTabs > 0`).

---

## New app from nothing

```
ai_project_create { name: "TapCounter", title: "Tap Counter" }
ai_project_open   { projectId: "<id from create>" }     // reloads the page
ai_relay_inject                                          // re-attach if no extension
```

Then build the screen:

```
ai_component_set_property { component: "Screen1", property: "Title", value: "Tap Counter" }
ai_component_add { type: "Label",  name: "LblCount" }
ai_component_set_property { component: "LblCount", property: "Text", value: "0" }
ai_component_set_property { component: "LblCount", property: "FontSize", value: "40" }
ai_component_add { type: "Button", name: "BtnTap" }
ai_component_set_property { component: "BtnTap", property: "Text", value: "Tap" }
ai_component_add { type: "Button", name: "BtnReset" }
ai_component_set_property { component: "BtnReset", property: "Text", value: "Reset" }
```

Blocks:

```
ai_blocks_context
ai_blocks_set { xml: "<xml …>" }     // see references/block-recipes.md
ai_blocks_diagnostics
ai_validate
```

Ship:

```
ai_build_and_test {
  device: "emulator-5554",
  steps: [
    { action: "waitForText", text: "Tap", timeoutMs: 25000 },
    { action: "expectText", text: "0" },
    { action: "tapText",   text: "Tap" },
    { action: "expectText", text: "1" },
    { action: "tapText",   text: "Reset" },
    { action: "expectText", text: "0" }
  ]
}
ai_project_export
```

---

## Add a feature to an existing app

```
ai_project_open { projectId }
ai_relay_inject
ai_component_tree                      // know what exists before adding
ai_component_add { type: "Label", name: "LblResult" }
ai_component_set_property { component: "LblResult", property: "Text", value: "" }
ai_blocks_get { format: "xml" }        // never clobber existing behaviour
```

Append only the new handler (either `ai_blocks_set` with the old XML + the new block, or
`ai_blocks_add` with just the new top-level block):

```
ai_blocks_set { xml: "<xml>…old blocks…<block type=\"component_event\" …>…</block></xml>" }
ai_validate
ai_build_and_test { device: "emulator-5554", steps: [ … existing behaviour still asserted … ] }
```

Keep the old scenario steps in the test so the feature does not regress the app.

---

## Fix a runtime crash

```
ai_app_logs                            // or the crash block from the last test
ai_blocks_diagnostics
ai_validate
```

Map the message:

| Message | Action |
| --- | --- |
| `unbound location $x` | `ai_repair` (adds the `global ` prefix) |
| `The operation ... cannot accept the arguments` | fix the block's input types using `ai_component_schema` |
| `Attempt to get item number N of a list of length M` | guard the index with `controls_if` + `lists_length` |
| null / component missing | the block references a deleted component — repoint or delete it |

Then:

```
ai_validate
ai_build_apk
ai_test_apk { file, device, steps: [ <the step that crashed>, … ] }
```

---

## Verify an app someone else built

```
ai_project_import { file: "C:\\path\\to\\app.aia", name: "AuditCopy" }
ai_project_open { projectId }
ai_relay_inject
ai_validate
ai_screens_list
ai_component_tree { screen: "Screen1" }
ai_build_and_test { device: "emulator-5554", steps: [ { action: "dump" } ] }
```

Use a copy (`AuditCopy`) so the original project is untouched.

---

## Recover from a broken editor state

```
ai_ui_eval { script: "({dialogs: document.querySelectorAll('.ode-DialogBox').length, url: location.href, hasRelay: !!window.__aiRelay})" }
```

If a dialog is stuck, reload the tab and re-attach:

```
// in the browser
location.reload()
```

then `ai_relay_inject`. Then `ai_state` to confirm the editor is back.

If a designer mutation half-applied, re-read with `ai_component_tree` and reconcile: the
saved `.scm` tells you exactly what exists.

---

## Batch designer work efficiently

Every designer mutation costs ~0.5–2 s (GWT re-render + verification). Do:

1. `ai_component_tree` once — learn what exists.
2. Add all components in one turn (each `ai_component_add` also renames).
3. Set all properties (one call each; they are cheap).
4. One `ai_blocks_set` for the whole workspace.
5. One `ai_validate`.
6. One build + one test.

Avoid re-reading the tree after each call; the responses already carry the created names.
