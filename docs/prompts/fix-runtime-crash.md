# Fix a runtime crash

The app in project `{{project}}` fails at runtime: `{{error}}`

1. **Reproduce with evidence.**
   `ai_app_logs` and the `crash` block from the last `ai_test_apk` run. App Inventor reports
   runtime errors as a dialog with the YAIL line number — that line points at the block.

2. **Classify the failure.**

   | Message | Cause | Fix |
   | --- | --- | --- |
   | `unbound location $name` | a `lexical_variable_get/set` without the `global ` prefix | `ai_repair` |
   | `The operation ... cannot accept the arguments` | wrong input type on a block | correct the block using `ai_component_schema` |
   | `Attempt to get item number N of a list of length M` | unguarded index | add `controls_if` + `lists_length` |
   | component is null / not found | block references a deleted component | repoint or delete the blocks |
   | `Error 1103` / network | the app's own network call | inspect the component, not the tooling |

3. **Apply the smallest safe fix.**
   `ai_validate` lists the structural defects. `ai_repair` fixes only global-variable
   prefixes; it reports destructive findings instead of applying them.

4. **Re-verify.**
   `ai_validate` → 0 issues, then `ai_build_apk`, then `ai_test_apk` with the step that
   crashed plus the steps before it.

5. **Report.**
   State the cause, the fix, and the evidence (log line + passing scenario). If you could
   not reproduce it, say so — do not declare it fixed.
