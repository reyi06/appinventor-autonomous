# Build an app from a brief

You are building a complete MIT App Inventor app from the brief at `{{brief}}` in the
project folder `{{project}}`.

Work in this order. Do not skip the verification steps.

1. **Read the brief and the sources.**
   Read `{{project}}/brief.md` and every file under `{{project}}/sources/`.
   If `{{project}}/design/` exists, read `bundle.json` — it overrides layout guesses.

2. **Establish the link.**
   `ai_status` → if `connectedTabs` is 0, run `ai_relay_inject` and execute the snippet in
   the App Inventor editor tab.

3. **Create the project.**
   `ai_project_create { name: "{{name}}", title: "<from brief>" }`, then open it and
   re-attach the relay (`ai_project_open`, `ai_relay_inject`).

4. **Plan the screens.**
   Decide the screen list and, for each screen, the component tree. Write it as a Layout IR
   spec (`{ name, title, props, root }`) and run `ai_layout_plan` to see the plan, the
   fidelity report and any missing assets *before* touching the project.

5. **Assets first.**
   Every asset must exist before a component references it: `ai_asset_upload` for each file.
   Verify with `ai_assets_list`.

6. **Build the screens.**
   `ai_layout_apply` per screen with `createScreen: true`. Read the returned
   `approximations` and fix what matters (colours and dropdown-only properties are not
   automatable — note them rather than fighting them).

7. **Write the behaviour.**
   `ai_blocks_context` → design the handlers → `ai_blocks_set` with complete XML.
   Every global variable reference must be `global <name>`.

8. **Validate.**
   `ai_validate` and `ai_blocks_diagnostics`. Zero errors before building.

9. **Prove it runs.**
   `ai_build_and_test { device: "emulator-5554", steps: [...] }`. The scenario must cover
   the brief's core interactions. Never report success without `ok: true` and
   `crash.crashed: false`.

10. **Deliver.**
    `ai_project_export` and report the `.aia` path, the APK path, the screens, and the
    limitations you hit.

If a step fails twice, stop and report what you tried — do not guess your way forward.
