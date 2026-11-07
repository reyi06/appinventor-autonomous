# Contributing

Thanks for looking. This project automates a **live** App Inventor editor, so the highest
value contributions are the ones that keep it honest: new diagnostics, better failure
messages, and fixes that survive App Inventor's UI changes.

## Before you start

- Node 20+. `npm ci` then `npm run selftest` — 28 protocol checks, no browser needed. That
  must stay green.
- Read [docs/architecture.md](docs/architecture.md) to understand the three layers
  (MCP server → relay → editor).
- Read [docs/compat.md](docs/compat.md) before touching anything that matches DOM classes.

## The rule that matters

**Never report success for something that did not happen.** Every write is verified: a rename
must show the new name *and* drop the old one; a property write is read back; a delete is
confirmed against the live component database. If you add an operation, it is not done until
it can prove it worked — or throws with a message that says why.

## Testing against the real editor

Unit tests can't cover the interesting half. To test by hand:

1. `npm start`, then attach the relay (`ai_status { action: "inject" }` or the extension).
2. `ai_status { action: "selftest" }` — expect 6/6.
3. For UI changes, verify in **both** App Inventor modes (Classic and Neo); the toolbar
   markup differs.
4. For app-level changes, run a scenario: `ai_test { action: "buildAndTest", device, steps }`.

## Commits

Conventional-ish prefixes (`feat:`, `fix:`, `docs:`), one coherent change per commit, and say
*why* in the body when the change is not obvious. If you fix a class of bug, add it to the
failure catalogue in `.opencode/skills/mit-app-inventor/references/failure-catalog.md` — that
file is how the next person avoids repeating it.

## Reporting a bug

Include the App Inventor build, the UI mode (Classic/Neo), the tool call, and the result. If
the server misbehaved, attach the last lines of `logs/mcp.log`.

Security issues: see [SECURITY.md](SECURITY.md), not the public issue tracker.
