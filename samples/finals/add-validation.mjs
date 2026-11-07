#!/usr/bin/env node
/**
 * Adds input validation to the finals_act3 CRUD screen without rewriting the
 * existing handlers: each handler's original body is preserved verbatim and
 * wrapped in a guard.
 *
 *   node samples/finals/add-validation.mjs <in.xml> > out.xml
 */
import fs from 'node:fs/promises';

let counter = 0;
const uid = () => `val_${++counter}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function block(type, parts = {}) {
  const attrs = [`type="${type}"`, `id="${parts.id || uid()}"`];
  if (parts.x !== undefined) attrs.push(`x="${parts.x}"`, `y="${parts.y}"`);
  let inner = parts.mutation || '';
  for (const [k, v] of Object.entries(parts.fields || {})) inner += `<field name="${k}">${esc(v)}</field>`;
  for (const [k, v] of Object.entries(parts.values || {})) inner += `<value name="${k}">${v}</value>`;
  for (const [k, v] of Object.entries(parts.statements || {})) inner += `<statement name="${k}">${v}</statement>`;
  if (parts.next) inner += `<next>${parts.next}</next>`;
  return `<block ${attrs.join(' ')}>${inner}</block>`;
}

const withNext = (xml, next) => (next ? xml.replace(/<\/block>$/, `<next>${next}</next></block>`) : xml);
const seq = (...items) => items.filter(Boolean).reduceRight((next, item) => withNext(item, next), '');

const txt = (t) => block('text', { fields: { TEXT: t } });
const num = (n) => block('math_number', { fields: { NUM: String(n) } });
const bool = (v) => block('logic_boolean', { fields: { BOOL: v ? 'TRUE' : 'FALSE' } });
const getVar = (name) => block('lexical_variable_get', { fields: { VAR: `global ${name}` } });
const setVar = (name, value) => block('lexical_variable_set', { fields: { VAR: `global ${name}` }, values: { VALUE: value } });
const globalVar = (name, value) => block('global_declaration', { fields: { NAME: name }, values: { VALUE: value } });

const propMut = (comp, type, attrs) =>
  `<mutation component_type="${type}" ${attrs} is_generic="false" instance_name="${comp}"></mutation>`;
const getProp = (comp, type, name) => block('component_set_get', {
  mutation: propMut(comp, type, `set_or_get="get" property_name="${name}"`),
  fields: { COMPONENT_SELECTOR: comp, PROP: name }
});
const callMethod = (comp, type, name, args = []) => block('component_method', {
  mutation: propMut(comp, type, `method_name="${name}"`),
  fields: { COMPONENT_SELECTOR: comp },
  values: Object.fromEntries(args.map((a, i) => [`ARG${i}`, a]))
});
const procCall = (name) => block('procedures_callnoreturn', { mutation: `<mutation name="${name}"></mutation>`, fields: { PROCNAME: name } });

const eq = (a, b) => block('logic_compare', { fields: { OP: 'EQ' }, values: { A: a, B: b } });
const lt = (a, b) => block('logic_compare', { fields: { OP: 'LT' }, values: { A: a, B: b } });
const and = (a, b) => block('logic_operation', { fields: { OP: 'AND' }, values: { A: a, B: b } });
const or = (a, b) => block('logic_operation', { fields: { OP: 'OR' }, values: { A: a, B: b } });
const not = (a) => block('logic_negate', { values: { BOOL: a } });
const trim = (v) => block('text_trim', { values: { TEXT: v } });
const isNumber = (v) => block('math_is_a_number', { fields: { OP: 'NUMBER' }, values: { NUM: v } });
const isDecimal = (v) => block('math_is_a_number', { fields: { OP: 'BASE10' }, values: { NUM: v } });

function ifBlock(branches, elseStack) {
  const mutation = `<mutation elseif="${branches.length - 1}" else="${elseStack ? 1 : 0}"></mutation>`;
  const values = {};
  const statements = {};
  branches.forEach((br, i) => {
    values[`IF${i}`] = br.cond;
    statements[`DO${i}`] = br.stack;
  });
  if (elseStack) statements.ELSE = elseStack;
  return block('controls_if', { mutation, values, statements });
}

const alert = (msg) => callMethod('Notifier1', 'Notifier', 'ShowMessageDialog', [txt(msg), txt('Hold on'), txt('OK')]);

/* --------------------------------------------------------------- the guard */

const newGlobals = [
  globalVar('checkName', txt('')),
  globalVar('checkPrice', txt('')),
  globalVar('errMsg', txt(''))
];

const validateInput = block('procedures_defnoreturn', {
  fields: { NAME: 'validateInput' },
  statements: {
    STACK: seq(
      setVar('errMsg', txt('')),
      ifBlock([
        { cond: eq(trim(getVar('checkName')), txt('')), stack: setVar('errMsg', txt('Enter the item name.')) },
        { cond: eq(trim(getVar('checkPrice')), txt('')), stack: setVar('errMsg', txt('Enter the price.')) },
        {
          cond: and(not(isNumber(getVar('checkPrice'))), not(isDecimal(getVar('checkPrice')))),
          stack: setVar('errMsg', txt('Price must be a number.'))
        },
        { cond: lt(getVar('checkPrice'), num(0)), stack: setVar('errMsg', txt('Price cannot be negative.')) }
      ])
    )
  }
});

function guard(prelude, body) {
  return seq(
    ...prelude,
    procCall('validateInput'),
    ifBlock([
      { cond: eq(getVar('errMsg'), txt('')), stack: body }
    ], alert_placeholder())
  );
}

// The alert text is the runtime value of errMsg, so build it explicitly.
function alert_placeholder() {
  return callMethod('Notifier1', 'Notifier', 'ShowMessageDialog', [getVar('errMsg'), txt('Hold on'), txt('OK')]);
}

function wrapHandler(xml, component, buildGuard) {
  const marker = `instance_name="${component}"`;
  const at = xml.indexOf(marker);
  if (at < 0) throw new Error(`handler not found: ${component}`);
  const doOpen = xml.indexOf('<statement name="DO">', at);
  const start = doOpen + '<statement name="DO">'.length;

  let depth = 1;
  let i = start;
  while (i < xml.length) {
    const nextOpen = xml.indexOf('<statement', i);
    const nextClose = xml.indexOf('</statement>', i);
    if (nextClose === -1) throw new Error('unbalanced statement');
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + '<statement'.length;
      continue;
    }
    depth--;
    if (depth === 0) {
      const body = xml.slice(start, nextClose);
      return xml.slice(0, start) + buildGuard(body) + xml.slice(nextClose);
    }
    i = nextClose + '</statement>'.length;
  }
  throw new Error('unbalanced statement');
}

const input = process.argv[2];
let xml = await fs.readFile(input, 'utf8');

// ADD: name and price must be valid.
xml = wrapHandler(xml, 'btnadd', (body) => guard([
  setVar('checkName', getProp('txtname', 'TextBox', 'Text')),
  setVar('checkPrice', getProp('txtprice', 'TextBox', 'Text'))
], body));

// UPDATE: selection first — you cannot update nothing — then the field checks.
xml = wrapHandler(xml, 'btnupd', (body) => ifBlock([
  { cond: eq(getProp('ListView1', 'ListView', 'SelectionIndex'), num(0)), stack: alert('Pick an item from the list first.') }
], guard([
  setVar('checkName', getProp('txtname', 'TextBox', 'Text')),
  setVar('checkPrice', getProp('txtprice', 'TextBox', 'Text'))
], body)));

// REMOVE: only needs a selection; name/price are irrelevant here.
xml = wrapHandler(xml, 'btnrem', (body) => ifBlock([
  { cond: eq(getProp('ListView1', 'ListView', 'SelectionIndex'), num(0)), stack: alert('Pick an item from the list first.') }
], body));

// Insert the new globals and the procedure as top-level blocks.
const insertAt = xml.indexOf('>') + 1;
const added = newGlobals.concat([validateInput]).map((b, i) =>
  b.replace('<block ', `<block x="${-1000 + i * 40}" y="${-420 + i * 30}" `)
).join('\n');
xml = xml.slice(0, insertAt) + '\n' + added + '\n' + xml.slice(insertAt);

process.stdout.write(xml);
