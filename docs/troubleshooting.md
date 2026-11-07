# Troubleshooting

## `relay not connected`

The page relay is gone. Page reloads (opening a project, a build, signing in) drop it.

- With the extension: click the toolbar icon → "Re-attach relay", or wait for the 20 s
  sweep.
- Without it: `ai_relay_inject` → run the snippet in the App Inventor tab.

Confirm with `ai_status`.

## Buttons do nothing

GWT `PushButton` widgets (Rename, Delete, Add Screen, Project Properties, the Build menu)
ignore a synthetic `click`. They need a full pointer + mouse sequence at real coordinates.
The relay does this; if you are writing your own automation, copy `click()` from
`mcp/page/relay.js`.

## Clicks do nothing after a build

A modal build-result dialog is open. Every designer operation in the relay dismisses stale
dialogs first, but a dialog opened *after* an operation started will still block it. Call
`ai_build_status` and dismiss, or re-run the operation.

## `Invalid block definition for type: X`

That block type does not exist in App Inventor. Common confusions:

| Stock Blockly | App Inventor |
| --- | --- |
| `math_arithmetic` | `math_add` / `math_subtract` / `math_multiply` / `math_division` |
| `text` (for joining) | `text_join` with `ADD0..ADDn` |
| `variables_get` / `variables_set` | `lexical_variable_get` / `lexical_variable_set` |

Check the type list with `ai_component_schema` for component blocks; for stock blocks, copy
a working block with `ai_blocks_get` and adapt it.

## Runtime error: `unbound location $name`

A `lexical_variable_get/set` references a global without the `global ` prefix, so App
Inventor compiled a local lookup. Run `ai_validate` (reports `global_missing_prefix`) and
`ai_repair` (fixes it), then rebuild.

## The app shows an "Error 1103" / connection error

Unrelated to this tooling — the app is trying a network call. Check the component
properties and the device's network.

## `Component was not added (palette double-click had no effect)`

- The palette item may be hidden behind a collapsed category in some builds; retry once.
- A modal dialog was blocking (see above).
- The Designer view did not become active — check `ai_state.view`.

## `Could not select "<name>"`

The relay selects through `[data-name="<name>"]` in the source-structure explorer. If the
component was just added, wait for the GWT re-render (the tool already sleeps ~800 ms) or
retry once. If the tree is collapsed, expand the parent first.

## `ai_component_tree` shows `stale: true`

Autosave runs ~5 s after the last edit and is forced every 30 s. Wait and re-read; the
`saved` `.scm` is the source of truth for reads, while `ai_state.components` reflects the
live editor.

## Build fails immediately

- The project may have a compile error in a block. Run `ai_blocks_diagnostics` and
  `ai_validate`.
- Empty screens are fine; an unknown component type is not.
- Retry once: the build server occasionally drops a request.

## Build link downloads 0 bytes or 403

Links expire after ~2 hours. Re-run `ai_build_apk` and download the fresh link from the
same process — the host downloads it immediately after the build finishes.

## Emulator not detected

```
adb devices          # must show "device", not "offline"
adb kill-server; adb start-server
```

Cold-boot the AVD if it stays offline. Pass `device: "emulator-5554"` explicitly when more
than one device is attached, so the user's phone is never used.

## `INSTALL_FAILED_UPDATE_INCOMPATIBLE`

The debug keystore changed (different App Inventor account or a rebuilt keystore). Uninstall
first:

```powershell
adb -s emulator-5554 uninstall <package>
```

## App Inventor release drift

DOM classes (`.ode-TextButton`, `.ode-PropertyRow`, `.ode-SimplePaletteItem`,
`.ode-SourceStructureExplorer`, `.ode-DialogBox`) and the `Blockly`/`BlocklyPanel_*` globals
are internals. They were verified against `ai2a.appinventor.mit.edu` with Form
`$Version 32`. After an upstream release:

1. `ai_status` and `ai_state` — confirms the relay still loads and the workspace is readable.
2. `ai_component_tree` — exercises export + `.scm` parsing (unaffected by DOM changes).
3. `ai_component_add { type: "Label", name: "SmokeTest" }` then remove it — exercises the
   palette, rename dialog and delete dialog.
4. `ai_build_apk` — exercises the Build menu.

If a selector broke, inspect with `ai_ui_eval` and patch `mcp/page/relay.js` — the server
serves it fresh, no extension rebuild needed.

## Logs

- Server: `logs/mcp.log` (every relay connect/disconnect and tool dispatch).
- Live health: `curl http://127.0.0.1:8766/health`.
- Device: `adb -s emulator-5554 logcat -d`, or `ai_app_logs`.
