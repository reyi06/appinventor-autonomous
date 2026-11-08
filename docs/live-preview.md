# Live preview (Companion + emulator)

Building an APK to look at a padding change costs ~40 s. The App Inventor
Companion gives the same fidelity in ~4 s, because the phone runs the project
straight from the editor. This is for *developing* the MCP or a design; shipped
apps still come from `ai_build { action: "apk" }`.

Verified on Windows 11 with `ledger` (API 36, x86_64) and App Inventor
`ai2a` in the Classic UI.

## One-time setup

1. **Install MIT's setup package** — "App Inventor Setup Software" from
   <https://appinventor.mit.edu/explore/ai2/windows>
   (`https://appinv.us/aisetup_win_30_265.exe`, ~1.5 GB download, ~3.7 GB
   installed, needs an administrator). It installs to
   `C:\Program Files\MIT App Inventor` and registers as *MIT App Inventor Tools
   30.265.0*.
2. **Start `aiStarter.exe`** from that folder. It listens on **port 8004** and is
   the piece the browser talks to:
   ```powershell
   Start-Process "C:\Program Files\MIT App Inventor\aiStarter.exe"
   Get-NetTCPConnection -LocalPort 8004      # State = Listen
   ```
3. **Run an emulator you control** (this project's `ledger` AVD, for instance).
   `Connect → Emulator` reuses a running emulator rather than starting the AVD
   bundled in the package.

You do **not** need to install Intel HAXM. The package ships
`extras\intel\Hardware_Accelerated_Execution_Manager\haxm-7.6.5-setup.exe` but
never runs it, and it is not wanted on a Hyper-V/WHPX machine:

```
emulator -accel-check   →   WHPX(10.0.26200) is installed and usable
sc query intelhaxm      →   service does not exist
```

## Connecting

Designer → **Connect ▾ → Emulator**. The dialog says *"Emulator started, waiting
19 seconds…"*; aiStarter installs `MITAI2Companion.apk` if needed, launches it
with the project, and the phone shows the app. `mCurrentFocus` then reports:

```
edu.mit.appinventor.aicompanion3/edu.mit.appinventor.aicompanion3.Screen1
```

On an emulator the Companion runs in *"Running using the emulator or USB"* mode —
there is no code entry, which is normal; the code path is for phones.

## Editing while connected

| Change | Appears |
| --- | --- |
| property on an existing component | ~2–4 s, by itself |
| a **newly added** component | after **Connect → Refresh Companion Screen** (`Alt+R`) |
| blocks | after saving the blocks workspace |

So the loop is: edit → wait a beat → `adb exec-out screencap -p > shot.png` →
look. No build, no install.

## Caveats

- The Companion owns the foreground, so `ai_test { action: "run" }` (which installs
  and launches the APK) closes it. Reconnect with Connect → Emulator; the project
  state is untouched.
- The Companion re-renders the screen it was given; switching screens in the
  Designer follows, but a brand-new screen is safest after a refresh.
- `%` sizes and the programmatic Designer path behave identically here, so this
  is a valid check of `ai_component { action: "set" }` — including the colour
  picker, which is otherwise only observable in the panel.
- It is a *preview*: signing, minification and the built APK's asset packaging are
  still only exercised by `ai_build`.
