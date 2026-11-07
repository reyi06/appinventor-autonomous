# Changelog

## 2.0.0 — tool surface consolidation

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
