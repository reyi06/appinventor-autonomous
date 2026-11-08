# Writing block XML

`ai_blocks { action: "set" }` takes App Inventor's block XML. Most of it is
straightforward, but a few block types look interchangeable and are not — the
compiler accepts them silently and the app misbehaves at runtime. Each entry
below was found by running the app on an emulator, and the input names were read
from `mit-cml/appinventor-sources` (`blocklyeditor/src/blocks/*.js`).

## Comparisons: `logic_compare` is equality only

| Operator | Block |
| --- | --- |
| `=` | `logic_compare` with `OP=EQ` |
| `≠` | `logic_compare` with `OP=NEQ` |
| `<`, `≤`, `>`, `≥` | **`math_compare`** with `OP=LT/LTE/GT/GTE` |

`logic_compare` declares a six-value dropdown, but its Yail generator maps every
operator except `NEQ` to `yail-equal?`. So this:

```xml
<block type="logic_compare"><field name="OP">GT</field>…</block>
```

compiles to `5 = 0`, evaluates to false, and nothing warns you. Put ordering
comparisons on `math_compare` (inputs `A` and `B`).

## Colours: a colour property needs a colour block

`TextColor`, `BackgroundColor` and friends take a *colour* block, not text:

```xml
<!-- works -->
<block type="color_green"/>
<!-- runtime crash: "Bad arguments to TextColor", then the app exits -->
<block type="text"><field name="TEXT">&amp;HFF16A34A</field></block>
```

Available literals: `color_black`, `color_blue`, `color_cyan`, `color_darkgray`,
`color_default`, `color_gray`, `color_green`, `color_lightgray`,
`color_magenta`, `color_none`, `color_orange`, `color_pink`, `color_red`,
`color_white`, `color_yellow`. Arbitrary palettes belong in the Designer (where
`ai_component { action: "set" }` drives the picker) or in the `.scm`, not in
blocks.

## Input names that are easy to get wrong

| Block | Inputs |
| --- | --- |
| `lists_select_item` | `LIST`, `NUM` |
| `lists_length` | `LIST` |
| `lists_add_items` | `LIST`, `ITEM0`… (`<mutation items="N">`) |
| `lists_create_with` | `ADD0`, `ADD1`… (`<mutation items="N">`) |
| `text_join` | `ADD0`, `ADD1`… (`<mutation items="N">`) |
| `math_add`, `math_multiply` | `NUM0`, `NUM1` |
| `math_subtract`, `math_division` | `A`, `B` |
| `controls_openAnotherScreen` | `SCREEN` |
| `controls_openAnotherScreenWithStartValue` | `SCREENNAME`, `STARTVALUE` |
| `controls_getStartValue` | none (it is a value block) |

Procedures: a definition names itself with a `NAME` field and declares
parameters in its mutation; a call carries both a mutation naming the
**parameter names** and a `PROCNAME` field.

```xml
<block type="procedures_defnoreturn">
  <mutation><arg name="qIndex"></arg></mutation>
  <field name="NAME">LoadQuestion</field>
  …
</block>

<block type="procedures_callnoreturn">
  <mutation name="LoadQuestion"><arg name="qIndex"></arg></mutation>
  <field name="PROCNAME">LoadQuestion</field>
  <value name="ARG0">…</value>
</block>
```

A parameter is read with `lexical_variable_get` and its **bare** name; a global
needs the `global ` prefix. Getting that wrong compiles and then throws
`unbound location $name` at runtime.

## Feedback that cannot block automation

`Notifier.ShowAlert` is a toast: it disappears on its own. `ShowMessageDialog`,
`ShowChooseDialog` and `Texting` dialogs sit on the screen until a person taps
them, and an emulator script will hang behind them. Use labels and toasts when
the app has to be testable; use dialogs only where a human is expected.

## Verify against the running app

Block errors (`ai_blocks { action: "diagnostics" }` → `errorCount`) only catch
structural problems. Everything above compiles cleanly and fails at runtime, so
the loop that actually finds these is:

```
ai_blocks { action: "set", xml } → ai_build { action: "apk" }
  → ai_test { action: "run", steps: [...], file } → read the dump
```

`samples/quiz/` is a worked example of all of the above.
