# Changelog

## Unreleased

### Fixed
- **Screen switching now works.** `ai_screen { action: "switch" }` was documented as
  experimental because the toolbar selector never opened. Two independent bugs:
  - the relay's `click()` fires three click events (a pointer click, one on the face and one on
    the element), which is harmless for a button that acts but makes a **toggle** open and
    close in the same instant. Added `clickOnce()`, which sends exactly one.
  - the menu readiness check waited on `.gwt-PopupPanel`, which the hidden file-upload popups
    satisfy at all times, so the code proceeded before the menu existed and then closed
    whatever was there.
  It also now reuses an already-open menu instead of toggling it shut, retries the click if the
  menu did not appear, skips the components-tree filter (which also has a `▾` caret), and
  returns `previous` / `current` so a no-op is distinguishable from a switch.
- A failed rename during component creation no longer leaves a half-created component behind.

### Added
- `ai_validate` sizing lint from MIT's Responsive Design guide:
  `fixed_size_with_responsive` (warning) and `percent_with_fixed_sizing` (info), Canvas exempt.
- The Length editor accepts `"50%"` / `"50 percent"`, not just the stored `-1050`.
- `samples/corpus/` - 16 real projects from `mit-cml/appinventor-sources` and
  `npm run corpus` (129 offline checks). The first run found a CRLF bug in `parseScm`.
- `docs/compat.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE` (MIT), CI on node 20 + 22.

## 2.0.0 - tool surface consolidation

**Breaking:** the 48 per-action tools were collapsed into 13 intention-level tools that take
an `action` parameter. Anything calling `ai_component_add`, `ai_blocks_set`, `ai_build_apk`
and friends must move to `ai_component { action: "add" }`, `ai_blocks { action: "set" }`,
`ai_build { action: "apk" }`. `ai_batch` accepts both spellings, so old sequences can be
replayed through it while migrating.

### Added
- `ai_status { action: "state" }` — live editor view, selection, components, block counts
- `ai_batch` — several calls in one request, stops at the first failure
- `ai_project { action: "properties" }` — read/write `project.properties`, including the theme
  (`Classic`, `AppTheme.Light.DarkActionBar`, `AppTheme.Light`, `AppTheme`)
- `ai_project { action: "removeScreen" }` — deterministic screen removal by rewriting the `.aia`
- `ai_test { action: "screenshot" }` — capture the device screen to a PNG
- `ai_test` scenario steps `tapEditText`, `typeText`, `clearText`
- Validation: block errors from the editor, missing/empty launcher screen, legacy theme

### Security
- `ai_ui_eval` is disabled unless `AI2_ALLOW_EVAL=1`
- results carrying project/device text are marked `_untrusted` and size-capped
- the relay is version-pinned; older relays are rejected
- destructive writes checkpoint to `checkpoints/*.aia` first

### Fixed
- the MCP handshake no longer waits on the relay bind (a contended port looked like a
  client timeout)
- property writes wait for the properties panel to actually rebind, then verify the value
  (previously a write could land on the previously selected component)
- checkbox properties are toggled with the native `.click()`; synthetic events do not toggle
  them
- the Length editor is driven through its radio group, so `Width`/`Height` work for pixels,
  percent, `Fill parent` and `Automatic`
- `Add Screen` / `Remove Screen` / view tabs work in both App Inventor UI modes (Classic and
  Neo)

## 1.1.0 — layout compiler

- Layout IR (`mcp/layout/`) with `plan` (dry run + fidelity report), `apply`, and `theme`
- `ai_project { action: "properties" }` groundwork, asset upload and verification
- `.aia`/`.scm`/`.bky` parsing, ZIP read/write, APK structural verification

## 1.0.0 — first working server

- MCP stdio server, in-page relay, bridge extension
- designer reads/writes, block read/write, AIA export, APK build, ADB testing
- `ai_validate` and `ai_repair`
