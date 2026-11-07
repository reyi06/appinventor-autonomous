# Audit an app

Review project `{{project}}` without changing it.

1. `ai_project_info`, `ai_screens_list`, `ai_assets_list` — inventory.
2. `ai_component_tree` per screen — structure, naming, property sanity.
3. `ai_blocks_diagnostics` per screen — block counts, event handlers, duplicate handlers,
   blocks pointing at missing components.
4. `ai_validate` — unknown types, missing assets, missing component refs, duplicate
   handlers, variable scoping.
5. `ai_build_apk` — does it compile at all? Report the verification checks.
6. `ai_test_apk { steps: [{ action: "dump" }] }` — does it launch without crashing? Read
   `crash.appInventorErrors` for runtime-error dialogs.
7. Cross-check against `design/bundle.json` if one exists, and report where the app has
   drifted from the design.

Report format:

- **Blockers** — anything that stops the app working (crashes, missing assets, broken refs)
- **Risks** — duplicate handlers, unguarded list access, hard-coded sizes that break on
  other screens
- **Naming** — components that will make blocks unreadable (`Label3`, `Button7`)
- **Design drift** — layout or style differences from the design source

Make no edits. This prompt is read-only by design; if fixes are wanted, follow
`fix-runtime-crash` afterwards.
