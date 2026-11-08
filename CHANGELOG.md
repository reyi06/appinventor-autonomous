# Changelog

## 2.1.0 - 2026-11-08

Designer breadth: colour, choice and project properties are now automatable, screen
switching works, and the loop that verifies a change against the running app is short
enough to use while designing.

### Security
- **The loopback listener is now authenticated.** Binding `127.0.0.1` keeps the server off the
  network but not away from the browser: any page could `POST` to it, and `ai_asset_upload`
  reads an arbitrary local file into the project, which is an arbitrary-file-read from a
  website. Fixed with four controls:
  - `Host` must be the loopback name it listens on (DNS rebinding);
  - the WebSocket upgrade requires `Origin: https://*.appinventor.mit.edu` (another site's page);
  - `POST /rpc` and `POST /relay-call` require `Authorization: Bearer <token>` from the new
    `logs/token` (created on first run, 0600, gitignored, overridable with
    `APPINVENTOR_MCP_TOKEN`);
  - those POSTs require `Content-Type: application/json`, so the preflight-free "simple request"
    that made the token advisory is refused.
  CORS now reflects only allowed origins instead of `*`. New `npm run security` runs 34 checks,
  including a real WebSocket handshake from a foreign origin.

### Fixed
- **`color.primary` and friends now persist.** Writing `youngandroidproject/project.properties`
  through the upload endpoint returns success and is then reverted by the editor, so a themed app
  always fell back to the default indigo — the one visible defect left from the design pass.
  `ai_project { action: "properties", set }` now drives the **Project Properties dialog** for
  `theme`, `color.*`, `aname` and the version fields, then re-reads the exported project and
  reports any key that did not stick instead of claiming success. One dialog per property: three
  colour pickers in one session overwrite each other, and the first write into a fresh dialog is
  sometimes dropped, so each write is verified and retried once.
  Verified end to end: `color.primary=&HFF3D5AFE`, `color.primary.dark=&HFF1E2A78`,
  `color.accent=&HFFF59E0B` in the export, and the rebuilt APK's action bar is the new indigo.
- `PrimaryColorDark` is reported as `unsupported` rather than failing the call: its dialog editor
  accepts the picker but never applies, and this build derives the value from the theme.
- The Theme dropdown uses captions, not stored values (`AppTheme.Light.DarkActionBar` is
  "Device Default"), which the tool now maps.
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
- **`logic_compare` is equality only.** Its Yail generator maps every operator except `NEQ` to
  `yail-equal?`, so `OP=GT` compiles to `=` and `5 > 0` is silently false. Ordering comparisons
  belong on `math_compare`. Found by running the app; nothing in the editor complains. See
  `docs/blocks.md`.
- **Colours in blocks take colour blocks.** A text block holding `&H16A34A` in `TextColor`
  compiles, then crashes at runtime with *Bad arguments to TextColor* and exits the app.
- **Horizontal alignment codes were swapped in the layout compiler**, so `mainAlign: "center"`
  produced right alignment: App Inventor is `1 left, 2 right, 3 center` horizontally and
  `1 top, 2 center, 3 bottom` vertically. They are separate maps now, with tests.
- **`props.Width`/`props.Height` in a layout spec were ignored** in favour of the per-kind
  default, so an explicit `72` became `Automatic` and nothing said so.
- **uiautomator text containing quotes was unreadable.** Android escapes `"` inside `text="…"`
  as `&quot;`, so `waitForText('Who wrote "Romeo and Juliet"?')` never matched. Attribute values
  are decoded now.
- **A client-side abort does not stop the relay.** An interrupted `ai_layout` apply kept writing
  components in the background, and the next batch collided with it.

### Added
- **Colour, typeface, alignment and shape properties are settable.** The relay drives the  colour picker (Pickr: type the hex, Save) and the choice `DropDownButton` menus, so
  `BackgroundColor`, `TextColor`, `Shape`, `AlignHorizontal` and `TextAlignment` all work
  through `ai_component { action: "set" }`. Colour writes are verified by re-reading the
  picker, because the property panel cannot display a custom colour (it repaints as
  `Default`) — and the tool says `verified: false` rather than claiming a pass when it cannot
  tell.
- `npm run layout` (34 checks): sizing, alignment codes, colour encoding, naming, gap spacers,
  `crossAlign: stretch`.
- `docs/blocks.md`: the block and input-name table read from the App Inventor sources, plus the
  runtime traps above.
- `samples/quiz/`: QuizMaster, a three-screen quiz built end to end through the tools.

### Added
- `ai_validate` sizing lint from MIT's Responsive Design guide:
  `fixed_size_with_responsive` (warning) and `percent_with_fixed_sizing` (info), Canvas exempt.
- The Length editor accepts `"50%"` / `"50 percent"`, not just the stored `-1050`.
- `samples/corpus/` - 16 real projects from `mit-cml/appinventor-sources` and
  `npm run corpus` (129 offline checks). The first run found a CRLF bug in `parseScm`.
- `docs/compat.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE` (MIT), CI on node 20 + 22.

### UI

- QuizMaster was rebuilt against idioms measured from production projects
  (`samples/ui-corpus/`): a bottom bar of `Image` + `Label` columns (the icon is the hit
  target, so no `Button.Image` scaling), form fields as `outer(image) → inner(transparent)`
  with `&H00FFFFFF` widgets, `TitleVisible=False` with the content drawing its own header,
  and a progress bar built from a track row plus a fill label whose width the blocks compute
  (pixel widths — a percentage in blocks resolves against the screen, not the bar).
- The result screen's score is a hero number (72 pt), which is how the corpus apps treat a
  headline figure.
- Fixed a percentage trap that had shipped into the sample: `92%` inside a 317 dp field is
  331 dp, because percentages resolve against the *screen*; it clipped the first character and
  let a transparent `Spinner` paint black past the pill.
- `docs/layout.md` gained *What a real project does* and *Measured across five real apps*.

### Docs
- `docs/layout.md` — the six layout components, the seven properties a  `VerticalArrangement` actually has, and the rules that follow: position with the
  alignment grid, `Fill parent` only works on the last child, percentages are
  screen-relative, spacing is structure. Written after a design pass kept fighting
  the box model.
- `docs/live-preview.md` — the ~4 s Companion loop: what MIT's setup package
  installs, `aiStarter` on port 8004, why HAXM is not wanted, and the refresh
  rules for new components.
- `docs/clients.md` - Claude Code, Codex, Cursor, Windsurf, VS Code and OpenCode
  configs, what each client surfaces, and what a client must not get wrong.
- `docs/layout.md` gained "Chrome as assets": design tools can supply the radius, shadow and
  gradient App Inventor cannot draw, but a bitmap on a container stretches to the container's
  box and does not inset the widgets inside it — so chrome works for content-free surfaces
  (screen background, header band, icons) and fights the content everywhere else. A `Button`
  has no `BackgroundImage` at all, only `Image` (an icon). `samples/quiz/chrome.figcraft` and
  `samples/quiz/assets/` hold the source and the exported PNGs from that test.

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
