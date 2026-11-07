# Block recipes

All examples are complete `<xml>` fragments accepted by `ai_blocks_set` / `ai_blocks_add`.
Verified against App Inventor with Form `$Version 32`.

Common ids are arbitrary; keep them unique within the workspace.

---

## Global variable + references

```xml
<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="global_declaration" id="v_count" x="20" y="20">
    <field name="NAME">count</field>
    <value name="VALUE">
      <block type="math_number" id="v_zero"><field name="NUM">0</field></block>
    </value>
  </block>

  <block type="lexical_variable_set" id="v_set" x="20" y="140">
    <field name="VAR">global count</field>
    <value name="VALUE">
      <block type="math_number" id="v_one"><field name="NUM">1</field></block>
    </value>
  </block>

  <block type="lexical_variable_get" id="v_get" x="300" y="20">
    <field name="VAR">global count</field>
  </block>
</xml>
```

Rule: declaration `NAME` is bare, every reference `VAR` is `global <name>`.

---

## Button click → change a label

```xml
<block type="component_event" id="ev_tap" x="24" y="24">
  <mutation component_type="Button" is_generic="false"
            instance_name="BtnTap" event_name="Click"></mutation>
  <field name="COMPONENT_SELECTOR">BtnTap</field>
  <statement name="DO">
    <block type="component_set_get" id="set_label">
      <mutation component_type="Label" set_or_get="set" property_name="Text"
                is_generic="false" instance_name="LblStatus"></mutation>
      <field name="COMPONENT_SELECTOR">LblStatus</field>
      <field name="PROP">Text</field>
      <value name="VALUE">
        <block type="text" id="t1"><field name="TEXT">Clicked</field></block>
      </value>
    </block>
  </statement>
</block>
```

---

## Counter (increment + render)

```xml
<block type="component_event" id="ev_inc" x="24" y="24">
  <mutation component_type="Button" is_generic="false"
            instance_name="BtnTap" event_name="Click"></mutation>
  <field name="COMPONENT_SELECTOR">BtnTap</field>
  <statement name="DO">
    <block type="lexical_variable_set" id="s1">
      <field name="VAR">global count</field>
      <value name="VALUE">
        <block type="math_add" id="a1">
          <value name="NUM0">
            <block type="lexical_variable_get" id="g1">
              <field name="VAR">global count</field>
            </block>
          </value>
          <value name="NUM1">
            <block type="math_number" id="n1"><field name="NUM">1</field></block>
          </value>
        </block>
      </value>
      <next>
        <block type="component_set_get" id="set1">
          <mutation component_type="Label" set_or_get="set" property_name="Text"
                    is_generic="false" instance_name="LblCount"></mutation>
          <field name="COMPONENT_SELECTOR">LblCount</field>
          <field name="PROP">Text</field>
          <value name="VALUE">
            <block type="lexical_variable_get" id="g2">
              <field name="VAR">global count</field>
            </block>
          </value>
        </block>
      </next>
    </block>
  </statement>
</block>
```

---

## Text concatenation

```xml
<block type="text_join" id="j1">
  <mutation items="2"></mutation>
  <value name="ADD0">
    <block type="text" id="t0"><field name="TEXT">Count: </field></block>
  </value>
  <value name="ADD1">
    <block type="lexical_variable_get" id="g3">
      <field name="VAR">global count</field>
    </block>
  </value>
</block>
```

---

## if / else

```xml
<block type="controls_if" id="if1">
  <mutation elseif="1" else="1"></mutation>
  <value name="IF0">
    <block type="logic_compare" id="c1">
      <field name="OP">GT</field>
      <value name="A">
        <block type="lexical_variable_get" id="g4">
          <field name="VAR">global count</field>
        </block>
      </value>
      <value name="B">
        <block type="math_number" id="n2"><field name="NUM">10</field></block>
      </value>
    </block>
  </value>
  <statement name="DO0">
    <block type="component_set_get" id="set2">
      <mutation component_type="Label" set_or_get="set" property_name="Text"
                is_generic="false" instance_name="LblStatus"></mutation>
      <field name="COMPONENT_SELECTOR">LblStatus</field>
      <field name="PROP">Text</field>
      <value name="VALUE">
        <block type="text" id="t2"><field name="TEXT">High</field></block>
      </value>
    </block>
  </statement>
  <statement name="ELSE">
    <block type="component_set_get" id="set3">
      <mutation component_type="Label" set_or_get="set" property_name="Text"
                is_generic="false" instance_name="LblStatus"></mutation>
      <field name="COMPONENT_SELECTOR">LblStatus</field>
      <field name="PROP">Text</field>
      <value name="VALUE">
        <block type="text" id="t3"><field name="TEXT">Low</field></block>
      </value>
    </block>
  </statement>
</block>
```

`OP` values: `EQ`, `NEQ`, `LT`, `LTE`, `GT`, `GTE`.

---

## Loop over a range

```xml
<block type="controls_forRange" id="fr1">
  <field name="VAR">i</field>
  <value name="START">
    <block type="math_number" id="n3"><field name="NUM">1</field></block>
  </value>
  <value name="END">
    <block type="math_number" id="n4"><field name="NUM">5</field></block>
  </value>
  <value name="STEP">
    <block type="math_number" id="n5"><field name="NUM">1</field></block>
  </value>
  <statement name="DO">
    <!-- statements -->
  </statement>
</block>
```

`i` inside the body is referenced as `<field name="VAR">i</field>` (a local).

---

## Build a list and read an item

```xml
<block type="lexical_variable_set" id="s4">
  <field name="VAR">global names</field>
  <value name="VALUE">
    <block type="lists_create_with" id="l1">
      <mutation items="2"></mutation>
      <value name="ADD0"><block type="text" id="t4"><field name="TEXT">a</field></block></value>
      <value name="ADD1"><block type="text" id="t5"><field name="TEXT">b</field></block></value>
    </block>
  </value>
</block>

<block type="lists_select_item" id="sel1">
  <value name="LIST">
    <block type="lexical_variable_get" id="g5"><field name="VAR">global names</field></block>
  </value>
  <value name="NUM">
    <block type="math_number" id="n6"><field name="NUM">1</field></block>
  </value>
</block>
```

Lists are 1-based in App Inventor.

---

## Dictionary

```xml
<block type="dictionaries_create_with" id="d1">
  <mutation items="1"></mutation>
  <value name="ADD0">
    <block type="key_value_pair" id="kv1">
      <value name="KEY"><block type="text" id="t6"><field name="TEXT">hits</field></block></value>
      <value name="VALUE"><block type="math_number" id="n7"><field name="NUM">0</field></block></value>
    </block>
  </value>
</block>
```

Read: `dictionaries_lookup`; write: `dictionaries_set_pair`.

---

## Call a component method

```xml
<block type="component_method" id="m_play">
  <mutation component_type="Sound" method_name="Play" is_generic="false"
            instance_name="Sound1"></mutation>
  <field name="COMPONENT_SELECTOR">Sound1</field>
</block>
```

With arguments, add `<value name="ARG0">…</value>`, `<value name="ARG1">…</value>`, matching
the parameter order from `ai_component_schema`.

---

## Timer

```xml
<block type="component_event" id="ev_tick" x="24" y="24">
  <mutation component_type="Clock" is_generic="false"
            instance_name="Clock1" event_name="Timer"></mutation>
  <field name="COMPONENT_SELECTOR">Clock1</field>
  <statement name="DO">
    <!-- runs every Clock1.TimerInterval ms -->
  </statement>
</block>
```

Set `TimerInterval` on the Clock component with `ai_component_set_property`.

---

## Screen navigation

```xml
<block type="component_method" id="open_screen">
  <mutation component_type="Form" method_name="OpenScreen" is_generic="false"
            instance_name="Screen1"></mutation>
  <field name="COMPONENT_SELECTOR">Screen1</field>
  <value name="ARG0">
    <block type="text" id="scr"><field name="TEXT">History</field></block>
  </value>
</block>
```

---

## Getting types right

- Do not invent block type names. Copy a working block with `ai_blocks_get` and adapt it.
- Component block mutations come from the component's schema — `ai_component_schema`
  returns the exact event/method/property names the runtime expects.
- After writing, `ai_blocks_diagnostics` must report no `unknownComponentRefs` and
  `ai_validate` no errors.
