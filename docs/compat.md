# Compatibility

This project drives **MIT App Inventor's own web client**. There is no official API: the
relay reads and writes the GWT designer and the Blockly workspace, and uses the same HTTP
endpoints the browser uses (`/ode/upload`, `/ode/download`, the build link). Anything internal
can change without notice.

## Verified against

| | |
| --- | --- |
| Instance | `ai2a.appinventor.mit.edu` (also used: `ai2.appinventor.mit.edu`) |
| Screen `$Version` | 32 |
| Component catalogue | 107 types |
| UI mode | **Classic** and **Neo** (both exercised end to end) |
| Android target | emulator API 36 (Android 16) |
| Node | 20 and 22 |

`ai_status { action: "selftest" }` is the compatibility check: it exercises the relay, editor
state, the component catalogue, `.aia` export, block reading and the component tree. If it
passes, the server can do useful work on that build.

## What breaks between releases, in order of likelihood

| Surface | Fragility |
| --- | --- |
| Toolbar DOM classes | highest — Neo moved tabs to `.ode-ProjectListButton` and turned commands into Material icon buttons whose label lives in `title` |
| Property editor widgets | high — colour/typeface/alignment are GWT drop-downs that ignore scripted input |
| Dialog markup | medium — `.ode-DialogBox` plus native `confirm()` for screen deletion |
| Block shapes | medium — socket names and mutations differ per block type|
| `.scm` / `.bky` format | low — stable, versioned by `$Version` |
| `/ode/upload`, `/ode/download`, build links | low |

## Behaviour differences that are not bugs

- **Colours, typeface and text alignment** cannot be set programmatically; the editor's
  drop-down does not open from scripted clicks. `ai_component { action: "set" }` reports them
  as unsupported rather than pretending.
- **Screen switching** requires a human click in some builds. `ai_screen { action: "switch" }`
  fails loudly instead of silently doing nothing.
- **Screens**: the Android launcher is always `Screen1`. A project whose UI lives on another
  screen installs and opens blank — `ai_validate` reports it.
- **Neo vs Classic**: switching modes reloads the page, which drops the relay. Re-inject.

## Keeping up

After an App Inventor update:

1. `ai_status { action: "selftest" }` — which layer broke?
2. If a designer action fails with "…button not found", the toolbar markup changed: inspect
   with the browser devtools and extend `findButton()` in `mcp/page/relay.js`.
3. If a property write fails, check the widget type in `docs/blocks.md` / `docs/designer.md`.
4. Add the finding to
   `.opencode/skills/mit-app-inventor/references/failure-catalog.md`.

The relay is served from disk on every request, so a relay change only needs a re-inject
(bump `BUILD`), not a server restart.
