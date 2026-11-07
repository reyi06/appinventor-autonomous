# Ship an APK

Compile, verify and test the app in project `{{project}}` on `{{device}}`.

1. **Preflight.**
   - `ai_status` — relay connected, correct project.
   - `ai_project_info` — confirm the project.
   - `ai_validate` — must return `issueCount: 0`. Fix errors before building; a build that
     succeeds with broken blocks still ships a broken app.

2. **Wait for autosave.**
   Reads come from the saved `.scm`. After a designer edit, wait ~6 s (or until
   `ai_component_tree` reports `stale: false`) so the build includes the change.

3. **Build.**
   `ai_build_apk { timeoutSeconds: 300 }`.
   Success looks like `{ ok: true, verify: { valid: true, checks: { manifest, dex, resources,
   signature } } }`. On failure you get `{ ok: false, stage: "compile", error }` — read the
   error, do not retry blindly.

4. **Install and test.**
   `ai_test_apk { file, device: "{{device}}", steps: [...] }`, or `ai_build_and_test` in one
   call. The scenario must exercise the app's core interaction, not just launch it.

5. **Check for crashes explicitly.**
   `ok: true` already requires `crash.crashed === false`, but read `crash.appInventorErrors`
   too — a runtime error dialog is not a native crash but still means the app is broken.

6. **Deliver.**
   Report: APK path, byte size, verification checks, device serial, each scenario step with
   its result, and any App Inventor log warnings.

Never say "built successfully" on the strength of the build dialog alone.
