# Sample: PizzaOrder

The screen described here is built entirely through the MCP — no dragging.

- `build-blocks.mjs` — generates all 418 blocks (7 globals, 9 procedures, 17 handlers) from
  small helpers instead of hand-written XML
- `blocks.xml` — the generated output, fed to `ai_blocks { action: "set" }`

No `.aia` or `.apk` is committed: both embed the author's App Inventor package name
(`appinventor.ai_<account>.<project>`), which is account-specific. Build your own:

```bash
# 1. generate the blocks
node samples/pizza/build-blocks.mjs > /tmp/blocks.xml

# 2. create the project and screen (see the spec below), then
#    apply the blocks and compile from the MCP:
#    ai_blocks { action: "set", xml: <contents of blocks.xml> }
#    ai_build  { action: "apk" }
#    ai_test   { action: "run", device: "emulator-5554", steps: [...] }
```

## Screen

| Component | Type | Notes |
| --- | --- | --- |
| `CbBase1..3` | CheckBox | `Ham and Cheese - 200`, `Hawaiian - 300`, `Pepperoni - 400` — single-select |
| `HABasePrice` | HorizontalArrangement | `LbBasePriceTitle` (PRICE), `LbBasePrice`, `BtnClearBase` |
| `CbTop1..3` | CheckBox | same items — multi-select |
| `HATopPrice` | HorizontalArrangement | `LbTopPriceTitle`, `LbTopPrice`, `BtnClearTop` |
| `HATotal` | HorizontalArrangement | `BtnTotal`, `LbTotal`, `BtnClearOrder` |
| `HADiscount` | HorizontalArrangement | `LbDiscountTitle`, `TableDiscount` (2×2 of `CbDisc0/10/5/20`), `BtnResetDisc` |
| `HADiscPct` | HorizontalArrangement | `LbDiscPctTitle`, `LbDiscPct` |
| `HADiscAmt` | HorizontalArrangement | `BtnDiscAmt`, `LbDiscAmt`, `BtnClearData` |
| `HAFinal` | HorizontalArrangement | `LbFinalTitle`, `LbFinal` |
| `Notifier1` | Notifier | all feedback goes through it |

## Behaviour

- `PRICE` updates live as boxes are ticked.
- `TOTAL` requires **a pizza and at least one extra**; otherwise it explains what is missing.
- `TOTAL DISCOUNT` requires a computed total and a chosen percentage.
- Any selection change clears the previous total and discount results.
- Clearing never asks for confirmation: it acts, then reports in a single OK dialog.

## Why the blocks look the way they do

Three App Inventor quirks are encoded here and documented in
`docs/blocks.md`:

1. Globals are declared with a `NAME` field and referenced as `global <name>`.
2. `math_add`/`math_multiply` use `NUM0`/`NUM1`; `math_subtract`/`math_division` use `A`/`B`.
3. `ShowChooseDialog`'s `cancelable` flag adds a third button — pass `false` when you supply
   your own Cancel.
