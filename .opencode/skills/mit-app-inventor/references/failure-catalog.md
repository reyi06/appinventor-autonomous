# Failure catalogue

Every entry below was observed while building this integration. Each one has a symptom, the
underlying cause, and the fix that actually works.

---

## Relay not connected

**Symptom** `ai_status` → `connectedTabs: 0`, every tool errors with
`App Inventor relay not connected`.

**Cause** The page relay is gone: a reload (opening a project, a build, a sign-in) removes
the in-page script.

**Fix** `ai_relay_inject`, run `snippet` in the tab. With the `extension/` bridge loaded,
it re-attaches itself within ~20 s.

---

## Designer buttons do nothing

**Symptom** Rename / Delete / Add Screen / Build menu / Project Properties silently do
nothing; the tool then times out waiting for a dialog.

**Cause** GWT `PushButton` listens for pointer events at real coordinates. A bare
`element.click()` or `dispatchEvent(new MouseEvent('click'))` is ignored.

**Fix** Dispatch the full sequence on the element (and its `.html-face`):
`pointerover, mouseover, pointerenter, mouseenter, pointerdown, mousedown, pointerup,
mouseup, pointerclick, click`. The relay's `click()` does this — copy it.

---

## Rename "succeeds" but nothing changes

**Symptom** No error, but the component keeps its old name.

**Cause** The Rename dialog has two text boxes: old name (disabled) and new name. Writing
to the first one makes `handleOkClick()` see "unchanged" and close without renaming.

**Fix** Target the last *enabled* text input, and verify afterwards: the new name must exist
**and** the old name must be gone.

---

## Rename changes the wrong component

**Symptom** Two components added; the second rename renames the first.

**Cause** `selectComponent` returned early because the properties panel header already showed
the target name, while the GWT tree selection still pointed at the previous component.
`Rename` acts on the *tree-selected* item.

**Fix** Force selection by clicking the tree row `[data-name="<name>"]`, then verify
`selectedComponentName()` matches before clicking Rename.

---

## `Component was not added (palette double-click had no effect)`

**Cause** A modal dialog (usually the build-result dialog) is open and swallowing clicks, or
the Designer tab wasn't active.

**Fix** Dismiss `.ode-DialogBox` (Dismiss/Close/Cancel/OK) before designer operations; the
relay does this automatically. Re-run.

---

## `Invalid block definition for type: math_arithmetic`

**Cause** `math_arithmetic` is stock Blockly. App Inventor has one block per operator.

**Fix** `math_add`, `math_subtract`, `math_multiply`, `math_division` with inputs `NUM0` /
`NUM1`.

---

## Partial blocks after a failed add

**Symptom** `ai_blocks_add` errors, but the workspace now contains half the blocks.

**Cause** `Blockly.Xml.domToWorkspace` is not transactional — it creates blocks until it
hits the invalid type.

**Fix** `ai_blocks_clear` then `ai_blocks_set` with the corrected XML. Prefer `ai_blocks_set`
whenever the XML is generated rather than copied.

---

## Runtime dialog: `unbound location $count`

**Symptom** App launches, first tap opens "Runtime Error … unbound location $count", and
`crash.appInventorErrors` shows the `.yail` line.

**Cause** `lexical_variable_get` / `set` with `<field name="VAR">count</field>`. App
Inventor treats an unprefixed name as a *local*; the global is never defined in that scope.

**Fix** Reference globals as `global count`. `ai_validate` reports
`global_missing_prefix`; `ai_repair` rewrites it safely. Rebuild and re-test.

**Prevention** Always write `global <name>` in `VAR` and the bare name in the
`global_declaration` `NAME` field.

---

## Blocks reference components that no longer exist

**Symptom** `ai_blocks_diagnostics.unknownComponentRefs` non-empty; the block is orphaned and
the app silently does nothing.

**Cause** A component was deleted or renamed after the blocks were written.

**Fix** Rename updates blocks automatically when done through the Designer. After deleting a
component, delete or repoint its blocks with `ai_blocks_set`.

---

## `stale: true` on `ai_component_tree`

**Cause** Autosave runs ~5 s after the last edit (forced every 30 s). Reads come from the
saved `.scm`.

**Fix** Wait a few seconds and re-read, or use `ai_state.components` for the live view.

---

## Build succeeds but the app shows old behaviour

**Cause** The compile started before autosave flushed the last edit.

**Fix** Sleep ~6–7 s after the final designer edit, or re-read `ai_component_tree` until
`stale` is false, then build.

---

## Build fails with a compile error

**Fix** `ai_build_apk` returns `{ ok: false, stage: "compile", error }` containing the
server message. Run `ai_blocks_diagnostics` and `ai_validate`; check that every
`instance_name` exists and every variable is scoped correctly.

---

## `INSTALL_FAILED_USER_RESTRICTED`

**Cause** The target device/serial is the user's phone, which requires manual approval.

**Fix** Always pass `device: "emulator-5554"` (or omit it so the tool picks the first
emulator). Never test on the user's phone unless asked.

---

## `INSTALL_FAILED_UPDATE_INCOMPATIBLE`

**Cause** Different signing key than the installed build.

**Fix** `adb -s emulator-5554 uninstall <package>` then install again.

---

## Text never appears in the scenario

**Fix** Read `steps[].texts` — it lists what was actually on screen. Common causes: the app
is still on a splash, a runtime-error dialog replaced the UI, or the label text differs by
case/spacing. Match on exact text.

---

## `Could not read the APK package name (aapt missing?)`

**Fix** Ensure `ANDROID_HOME` points at an SDK with `build-tools/*/aapt.exe`. The tool
searches `%ANDROID_HOME%\build-tools` from the newest version down.

---

## Relay reconnect storm (older builds)

**Symptom** `logs/mcp.log` shows connect/close every 0.5 s.

**Cause** Two relay versions in one page, each closing the other as "stale".

**Fix** Fixed in 1.1.2+: the hub never closes duplicate relays, it just prefers the newest
version, and calls are addressed to one client so nothing runs twice.

---

## `ai_screen_remove` fails

**Cause** Only the screen currently open in the Designer can be removed; this App Inventor
build does not expose a clickable screen switcher to automation.

**Fix** Open the screen in the Designer first, then remove it. Or drop it from an exported
`.aia` and re-import (changes the project id).
