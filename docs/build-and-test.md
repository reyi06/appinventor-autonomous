# Build and device testing

## Compiling

`ai_build_apk` drives the real Build menu:

1. Switch to the Designer (the menu is only there).
2. Click `Build ▾` → `Android App (.apk)` (or `.aab` with `{ aab: true }`).
3. Poll the modal for a `a.download-button` link or an error message (up to 15 min).
4. Download the link from the host (no cookies needed, link valid ~2 h).
5. Verify the package: ZIP signature, `AndroidManifest.xml`, `classes*.dex`,
   `resources.arsc`, `META-INF` signature, entry count.
6. Dismiss the modal so the next designer operation isn't blocked.

Returned shape:

```json
{
  "ok": true,
  "file": "builds/app-2026-11-07T00-47-12.apk",
  "bytes": 3765790,
  "elapsedMs": 47112,
  "link": "https://ai2a.appinventor.mit.edu/b/2jid0",
  "verify": { "valid": true, "checks": { "zip": true, "manifest": true, "dex": true,
              "resources": true, "signature": true, "entryCount": 442 } }
}
```

A compile failure returns `{ ok: false, stage: "compile", error }` with the server's message.

## Installing and testing

`ai_test_apk` and `ai_build_and_test` share the same runner:

```json
{
  "device": "emulator-5554",
  "steps": [
    { "action": "waitForText", "text": "Tap", "timeoutMs": 20000 },
    { "action": "expectText", "text": "0" },
    { "action": "tapText", "text": "Tap" },
    { "action": "expectText", "text": "1" }
  ]
}
```

- Device selection: an explicit serial wins; otherwise the first **emulator**; otherwise
  the first device. The user's phone is never used implicitly.
- Package name and launch activity come from `aapt dump badging`, not guesswork.
- `uiautomator dump` is parsed into nodes with text, class, bounds and centre point.
- The runner stops at the first failing step but still reads logcat, so a crash is always
  reported next to the failure.
- `readCrashes` separates `FATAL EXCEPTION` blocks, `E`-level errors, and App Inventor
  runtime errors (`RuntimeErrorAlert`, `E/AppInventor`).

## Emulator

```powershell
$env:ANDROID_HOME\emulator\emulator.exe -avd <name> -no-snapshot-load -no-window `
  -gpu swiftshader_indirect -no-audio
```

Wait for `adb devices` to show `device` (not `offline`). The current machine has the
`ledger` and `snag_test` AVDs.

## Reading failures

| Symptom | Where to look |
| --- | --- |
| Runtime-error dialog on the device | `crash.appInventorErrors` — AI surfaces the YAIL location |
| `unbound location $name` | missing `global ` prefix on a variable reference |
| App closes immediately | `crash.fatal` |
| Compile error | `ai_build_apk` → `error` string, then `ai_blocks_diagnostics` |
| Text never appears | `steps[].texts` shows what was on screen |

## Loop to follow

```
ai_validate
  -> issues?              -> ai_repair / fix the block XML
  -> ai_build_apk         -> verify.valid must be true
  -> ai_test_apk          -> every step ok, crash.crashed false
  -> runtime failure?     -> read crash.appInventorErrors, fix, rebuild
```

Never report an APK as working on the strength of a successful compile alone.
