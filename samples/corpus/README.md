# Test corpus

Real App Inventor projects used by `tests/corpus.mjs`. No browser needed: these exercise the
`.scm` / `.bky` parsers and the shared block scanner (`mcp/lib/bky.js`) offline.

## Source

Taken verbatim from **mit-cml/appinventor-sources**, commit
`b097193903890d6aa729ac52464ae342d3a600e2` (2026-11-03):

| From | To |
| --- | --- |
| `appinventor/blocklyeditor/tests/…/blocklyeditor/data/<name>/` | `samples/corpus/<name>/` |
| `appinventor/aiplayapp/src/edu/mit/appinventor/aicompanion3/` | `samples/corpus/aiCompanion/` |

Only `Screen1.scm` and `Screen1.bky` are copied; the `.yail` expectations are not needed here.

**License:** Apache License 2.0, © Massachusetts Institute of Technology. These files remain
under Apache-2.0 while the rest of this repository is MIT. See
<https://github.com/mit-cml/appinventor-sources/blob/master/LICENSE>.

## Why both formats are here

App Inventor changed block serialisation in 2018:

| | Blocks | Fields |
| --- | --- | --- |
| **modern** | `<block type="component_event">` + `<mutation instance_name=… event_name=…>` | `<field name=…>` |
| **legacy** | per-event types, e.g. `<block type="SubmitButton_Click">` | `<title name=…>` |

The live editor upgrades legacy files on import, so the meaningful invariants (component
references resolve, handlers unique, globals declared, global refs prefixed) only apply to the
modern shape. The legacy projects still guard against the parser crashing on old input.

## Projects

| Project | Format | Components | Blocks | What it covers |
| --- | --- | --- | --- | --- |
| `aiCompanion` | modern | 44 | 216 | the AI Companion app: the richest real workspace here |
| `globalLocalVars` | modern | 4 | 25 | global vs local variable scoping |
| `mathsconvert` | modern | 1 | 6 | arithmetic blocks |
| `helloPurr` | modern | 4 | 0 | a project with no blocks at all |
| `makeQuiz`, `moleMash`, `paintPot`, `pixelCycle`, `factorial`, `productLookup`, `sensor`, … | legacy | 1–18 | 2–72 | import-path robustness |

## Adding to the corpus

Copy a `<name>/Screen1.scm` and `.bky` pair into `samples/corpus/<name>/`. Prefer real exports
over hand-written files: the point of the corpus is to disagree with assumptions.
