# UI corpus

Real App Inventor projects, analysed rather than eyeballed.

`report.mjs` opens each `.aia`, parses every `.scm` and `.bky`, and reports the
design decisions the project actually makes: nesting depth, where artwork sits,
how sizes are expressed, which colours and type sizes recur, and what the blocks
reveal (`handlers`, `globals`, `procedures`, block frequencies).

```bash
node samples/ui-corpus/report.mjs            # all projects
node samples/ui-corpus/report.mjs connect    # one, by filename substring
```

## Fetching the samples

The `.aia` files are **not** in this repository: they are third-party projects
with no licence permitting redistribution. Add them locally with:

```bash
curl -L -o samples/ui-corpus/Connect_Four.aia "https://raw.githubusercontent.com/bglossner/AppsAIA/master/Connect%204/Connect_Four.aia"
curl -L -o samples/ui-corpus/Hangman.aia      "https://raw.githubusercontent.com/bglossner/AppsAIA/master/Minigames/Hangman.aia"
curl -L -o samples/ui-corpus/Square_Game.aia  "https://raw.githubusercontent.com/bglossner/AppsAIA/master/Sqaure%20Game/Square_Game.aia"
curl -L -o samples/ui-corpus/Drawing.aia      "https://raw.githubusercontent.com/bglossner/AppsAIA/master/Utilities/Drawing.aia"
curl -L -o samples/ui-corpus/MoleMash.aia     "https://appinventor.mit.edu/explore/sites/all/files/ai2tutorials/moleMash/MoleMash.aia"
```

`*.aia` is gitignored here, so a local copy never lands in a commit.

## What the five measure

| Project | Screens | Components | Blocks | Handlers | Globals | Procedures | Depth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Connect Four | 1 | 38 | 1377 | 16 | 20 | 12 | 3 |
| Hangman | 1 | 51 | 993 | 18 | 21 | 17 | 4 |
| Square Game | 1 | 27 | 1314 | 6 | 19 | 24 | 3 |
| Drawing | 1 | 20 | 58 | 9 | 1 | 0 | 2 |
| MoleMash (MIT) | 1 | 7 | 35 | 0 | 0 | 2 | 2 |

Findings that changed how this project builds screens are written up in
`docs/layout.md` under *What real projects do*.
