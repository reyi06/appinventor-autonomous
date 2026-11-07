# Blockly authoring

Blocks are plain Blockly XML. Anything the workspace knows can be written:
component events/methods/getters/setters, variables, procedures, control flow, math, text,
lists, dictionaries, colours, and raw types via any `type` attribute the runtime supports.

## Workflow

```
ai_blocks_context     -> project, live components (name + type), current workspace
ai_component_schema   -> events, methods, properties, getters, setters for a type
ai_blocks_set         -> replace the workspace (preferred for known-good XML)
ai_blocks_add         -> append (not transactional)
ai_blocks_diagnostics -> duplicates, unknown component refs, counts
ai_validate           -> project-level checks, including variable scoping
```

## Component event

```xml
<block type="component_event" id="ev_click" x="24" y="24">
  <mutation component_type="Button" is_generic="false"
            instance_name="BtnGo" event_name="Click"></mutation>
  <field name="COMPONENT_SELECTOR">BtnGo</field>
  <statement name="DO">
    ...
  </statement>
</block>
```

## Component method

```xml
<block type="component_method" id="m1">
  <mutation component_type="Sound" method_name="Play" is_generic="false"
            instance_name="Sound1"></mutation>
  <field name="COMPONENT_SELECTOR">Sound1</field>
</block>
```

## Component property get/set

```xml
<block type="component_set_get" id="s1">
  <mutation component_type="Label" set_or_get="set" property_name="Text"
            is_generic="false" instance_name="LblCount"></mutation>
  <field name="COMPONENT_SELECTOR">LblCount</field>
  <field name="PROP">Text</field>
  <value name="VALUE">
    <block type="text"><field name="TEXT">Ready</field></block>
  </value>
</block>
```

Use `set_or_get="get"` for a getter and drop the `VALUE` input.

## Variables

This is the single most common source of runtime crashes.

```xml
<block type="global_declaration" id="v1" x="20" y="20">
  <field name="NAME">count</field>
  <value name="VALUE"><block type="math_number"><field name="NUM">0</field></block></value>
</block>

<block type="lexical_variable_set" id="s2">
  <field name="VAR">global count</field>
  <value name="VALUE">...</value>
</block>

<block type="lexical_variable_get" id="g1">
  <field name="VAR">global count</field>
</block>
```

- The declaration's `NAME` is the bare name: `count`.
- **Every reference must be prefixed**: `VAR` = `global count`.
  App Inventor compiles an unprefixed `VAR` as a *local* lookup; the app then dies at
  runtime with `unbound location $count` in a runtime-error dialog.
- Event parameters are used unprefixed and resolve through the enclosing
  `component_event` (`<field name="VAR">x</field>` inside a `when ... do` that declares `x`).

`ai_validate` flags both directions (`global_missing_prefix`,
`missing_global_declaration`) and `ai_repair` rewrites the prefix mechanically.

## Arithmetic — there is no `math_arithmetic`

App Inventor ships one block per operator:

| Operation | Block | Inputs |
| --- | --- | --- |
| add | `math_add` | `NUM0`, `NUM1` (mutator-driven, 2 by default) |
| subtract | `math_subtract` | **`A`, `B`** |
| multiply | `math_multiply` | `NUM0`, `NUM1` |
| divide | `math_division` | **`A`, `B`** |
| compare | `math_compare` | `NUM0`, `NUM1`, field `OP` |
| random integer | `math_random_int` | `FROM`, `TO` |

The inconsistent input names are real: add and multiply use `NUM0`/`NUM1`, subtract and
divide use `A`/`B`. Sockets with the wrong name are silently dropped, so the block loads
but evaluates with empty inputs.

Writing `math_arithmetic` (the stock-Blockly name) fails with
`Invalid block definition for type: math_arithmetic`.

## Text

```xml
<block type="text_join">
  <mutation items="2"></mutation>
  <value name="ADD0"><block type="text"><field name="TEXT">Count: </field></block></value>
  <value name="ADD1"><block type="lexical_variable_get"><field name="VAR">global count</field></block></value>
</block>
```

## Control flow

`controls_if`, `controls_forRange`, `controls_forEach`, `controls_while`, `logic_compare`,
`logic_operation`, `logic_negate` all use standard Blockly shapes. AI-specific names worth
knowing: `controls_choose`, `controls_do_then_return`, `controls_for_each_dict`.

## Procedures

A definition names itself with a `NAME` field; a call needs **both** the mutation and a
`PROCNAME` field. Getting this wrong shows up as an error marker on every call block.

```xml
<block type="procedures_defnoreturn" id="p1" x="500" y="20">
  <field name="NAME">recalcBase</field>
  <statement name="STACK">...</statement>
</block>

<block type="procedures_callnoreturn" id="c1">
  <mutation name="recalcBase"></mutation>
  <field name="PROCNAME">recalcBase</field>
</block>
```

The definition has **no** mutation element. A call with only the mutation renders but is
flagged "procedure not found" (`ai_blocks_diagnostics` → `blockErrors`).

## Notifier: three different things

| Block | What it does | Event |
| --- | --- | --- |
| `ShowAlert(text)` | **Toast** — disappears after ~3 s, not a dialog | none |
| `ShowMessageDialog(message, title, buttonText)` | one-button dialog (3 args) | none |
| `ShowChooseDialog(message, title, b1, b2, cancelable)` | two-button dialog (5 args) | `AfterChoosing` |
| `ShowTextDialog` / `ShowPasswordDialog(message, title, cancelable)` | input dialog | `AfterTextInput` |

`AfterChoosing(choice)` receives the **button text as a String** (`"Yes"`, `"Cancel"`, or the
localised system cancel), not an index. Compare it with a text block:

```
if choice = "Yes" then <action> else <cancel>
```

Because `AfterChoosing` fires for every dialog, a global `pendingAction` set before showing
the dialog is what tells the handler which routine to run. Passing four arguments to
`ShowMessageDialog` silently does nothing useful — it takes three, and it never raises the
event, so a confirmation flow built on it will never run.


```xml
<block type="procedures_defreturn" id="p1" x="500" y="20">
  <field name="PROCNAME">double</field>
  <value name="RETURN">
    <block type="math_multiply">
      <value name="NUM0"><block type="lexical_variable_get"><field name="VAR">$x</field></block></value>
      <value name="NUM1"><block type="math_number"><field name="NUM">2</field></block></value>
    </block>
  </value>
</block>
```

Argument declarations live in the `procedures_defreturn` mutation; copy an existing
procedure block with `ai_blocks_get` and adapt it when you need arguments.

## Safety rules

1. Prefer `ai_blocks_set` over `ai_blocks_add` when the XML is generated rather than copied:
   `domToWorkspace` is not transactional and a bad block type leaves partial state behind.
2. Prefer `ai_component_schema` over guessing names — it is read from the live editor.
3. Run `ai_validate` after every block batch, and `ai_build_and_test` before claiming the
   app works. Compilation success does not imply runtime correctness.
4. Elements in app-inventor `.bky` files use the `xhtml` namespace. Both
   `https://developers.google.com/blockly/xml` and `http://www.w3.org/1999/xhtml` are
   accepted on write.
