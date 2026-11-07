#!/usr/bin/env node
/**
 * Generates the Blockly XML for the PizzaOrder sample screen.
 *
 * Hand-writing ~250 blocks in XML is error-prone, so this builds the tree from
 * small helpers and prints the result. Feed the output to ai_blocks_set:
 *
 *   node samples/pizza/build-blocks.mjs > samples/pizza/blocks.xml
 */

let counter = 0;
const uid = () => `pz_${++counter}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function block(type, parts = {}) {
  const attrs = [`type="${type}"`, `id="${parts.id || uid()}"`];
  if (parts.x !== undefined) attrs.push(`x="${parts.x}"`);
  if (parts.y !== undefined) attrs.push(`y="${parts.y}"`);
  let inner = parts.mutation || '';
  for (const [k, v] of Object.entries(parts.fields || {})) inner += `<field name="${k}">${esc(v)}</field>`;
  for (const [k, v] of Object.entries(parts.values || {})) inner += `<value name="${k}">${v}</value>`;
  for (const [k, v] of Object.entries(parts.statements || {})) inner += `<statement name="${k}">${v}</statement>`;
  if (parts.next) inner += `<next>${parts.next}</next>`;
  return `<block ${attrs.join(' ')}>${inner}</block>`;
}

const withNext = (xml, next) => (next ? xml.replace(/<\/block>$/, `<next>${next}</next></block>`) : xml);
const seq = (...items) => items.filter(Boolean).reduceRight((next, item) => withNext(item, next), '');

const num = (n) => block('math_number', { fields: { NUM: String(n) } });
const txt = (t) => block('text', { fields: { TEXT: t } });
const bool = (v) => block('logic_boolean', { fields: { BOOL: v ? 'TRUE' : 'FALSE' } });
const getVar = (name) => block('lexical_variable_get', { fields: { VAR: `global ${name}` } });
const getLocal = (name) => block('lexical_variable_get', { fields: { VAR: name } });
const setVar = (name, value) => block('lexical_variable_set', { fields: { VAR: `global ${name}` }, values: { VALUE: value } });
const globalVar = (name, value) => block('global_declaration', { fields: { NAME: name }, values: { VALUE: value } });

const propMut = (comp, type, attrs) =>
  `<mutation component_type="${type}" ${attrs} is_generic="false" instance_name="${comp}"></mutation>`;
const getProp = (comp, type, name) => block('component_set_get', {
  mutation: propMut(comp, type, `set_or_get="get" property_name="${name}"`),
  fields: { COMPONENT_SELECTOR: comp, PROP: name }
});
const setProp = (comp, type, name, value) => block('component_set_get', {
  mutation: propMut(comp, type, `set_or_get="set" property_name="${name}"`),
  fields: { COMPONENT_SELECTOR: comp, PROP: name },
  values: { VALUE: value }
});
const callMethod = (comp, type, name, args = []) => block('component_method', {
  mutation: propMut(comp, type, `method_name="${name}"`),
  fields: { COMPONENT_SELECTOR: comp },
  values: Object.fromEntries(args.map((a, i) => [`ARG${i}`, a]))
});
const event = (comp, type, evName, body) => block('component_event', {
  mutation: propMut(comp, type, `event_name="${evName}"`),
  fields: { COMPONENT_SELECTOR: comp },
  statements: { DO: body }
});

const add = (a, b) => block('math_add', { values: { NUM0: a, NUM1: b } });
// math_subtract / math_division use A/B in App Inventor; add and multiply use NUM0/NUM1
const sub = (a, b) => block('math_subtract', { values: { A: a, B: b } });
const mul = (a, b) => block('math_multiply', { values: { NUM0: a, NUM1: b } });
const div = (a, b) => block('math_division', { values: { A: a, B: b } });
const eq = (a, b) => block('logic_compare', { fields: { OP: 'EQ' }, values: { A: a, B: b } });
const and = (...xs) => xs.reduce((a, b) => block('logic_operation', { fields: { OP: 'AND' }, values: { A: a, B: b } }));
const or = (...xs) => xs.reduce((a, b) => block('logic_operation', { fields: { OP: 'OR' }, values: { A: a, B: b } }));
const not = (a) => block('logic_negate', { values: { BOOL: a } });
const join = (a, b) => block('text_join', { mutation: '<mutation items="2"></mutation>', values: { ADD0: a, ADD1: b } });

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

// App Inventor: a definition names itself with a NAME field (no mutation);
// every call carries both a mutation and a PROCNAME field.
const procDef = (name, body) => block('procedures_defnoreturn', {
  fields: { NAME: name },
  statements: { STACK: body }
});
const procCall = (name) => block('procedures_callnoreturn', {
  mutation: `<mutation name="${name}"></mutation>`,
  fields: { PROCNAME: name }
});

// App Inventor's Notifier: ShowAlert is a transient toast, ShowMessageDialog is a
// one-button dialog with no event, and only ShowChooseDialog raises AfterChoosing
// (with the button TEXT, not an index).
const showDialog = (message, title, button = 'OK') =>
  callMethod('Notifier1', 'Notifier', 'ShowMessageDialog', [txt(message), txt(title), txt(button)]);
const askConfirm = (action, message, title) => seq(
  setVar('pendingAction', txt(action)),
  callMethod('Notifier1', 'Notifier', 'ShowChooseDialog', [txt(message), txt(title), txt('Yes'), txt('Cancel'), bool(true)])
);
const done = (message) => showDialog(message, 'Done');
const check = (message) => showDialog(message, 'Check input');

/* ---------------------------------------------------------------- globals */

const globals = [
  globalVar('basePrice', num(0)),
  globalVar('topPrice', num(0)),
  globalVar('total', num(0)),
  globalVar('discountPct', num(0)),
  globalVar('discountAmt', num(0)),
  globalVar('updating', bool(false)),
  globalVar('pendingAction', txt(''))
];

/* ------------------------------------------------------------- procedures */

const invalidateResults = procDef('invalidateResults', seq(
  setVar('total', num(0)),
  setVar('discountAmt', num(0)),
  setProp('LbTotal', 'Label', 'Text', txt('-')),
  setProp('LbDiscAmt', 'Label', 'Text', txt('-')),
  setProp('LbFinal', 'Label', 'Text', txt('-'))
));

const recalcBase = procDef('recalcBase', seq(
  setVar('basePrice', num(0)),
  ifBlock([{ cond: getProp('CbBase1', 'CheckBox', 'Checked'), stack: setVar('basePrice', num(200)) }]),
  ifBlock([{ cond: getProp('CbBase2', 'CheckBox', 'Checked'), stack: setVar('basePrice', num(300)) }]),
  ifBlock([{ cond: getProp('CbBase3', 'CheckBox', 'Checked'), stack: setVar('basePrice', num(400)) }]),
  setProp('LbBasePrice', 'Label', 'Text', getVar('basePrice')),
  procCall('invalidateResults')
));

const recalcTops = procDef('recalcTops', seq(
  setVar('topPrice', num(0)),
  ifBlock([{ cond: getProp('CbTop1', 'CheckBox', 'Checked'), stack: setVar('topPrice', add(getVar('topPrice'), num(200))) }]),
  ifBlock([{ cond: getProp('CbTop2', 'CheckBox', 'Checked'), stack: setVar('topPrice', add(getVar('topPrice'), num(300))) }]),
  ifBlock([{ cond: getProp('CbTop3', 'CheckBox', 'Checked'), stack: setVar('topPrice', add(getVar('topPrice'), num(400))) }]),
  setProp('LbTopPrice', 'Label', 'Text', getVar('topPrice')),
  procCall('invalidateResults')
));

const recalcDiscount = procDef('recalcDiscount', seq(
  setVar('discountPct', num(0)),
  ifBlock([{ cond: getProp('CbDisc5', 'CheckBox', 'Checked'), stack: setVar('discountPct', num(5)) }]),
  ifBlock([{ cond: getProp('CbDisc10', 'CheckBox', 'Checked'), stack: setVar('discountPct', num(10)) }]),
  ifBlock([{ cond: getProp('CbDisc20', 'CheckBox', 'Checked'), stack: setVar('discountPct', num(20)) }]),
  setProp('LbDiscPct', 'Label', 'Text', join(getVar('discountPct'), txt('%'))),
  // a discount change invalidates only the discount results
  setVar('discountAmt', num(0)),
  setProp('LbDiscAmt', 'Label', 'Text', txt('-')),
  setProp('LbFinal', 'Label', 'Text', txt('-'))
));

const clearBase = procDef('clearBase', seq(
  setVar('updating', bool(true)),
  setProp('CbBase1', 'CheckBox', 'Checked', bool(false)),
  setProp('CbBase2', 'CheckBox', 'Checked', bool(false)),
  setProp('CbBase3', 'CheckBox', 'Checked', bool(false)),
  setVar('updating', bool(false)),
  procCall('recalcBase')
));

const clearTops = procDef('clearTops', seq(
  setVar('updating', bool(true)),
  setProp('CbTop1', 'CheckBox', 'Checked', bool(false)),
  setProp('CbTop2', 'CheckBox', 'Checked', bool(false)),
  setProp('CbTop3', 'CheckBox', 'Checked', bool(false)),
  setVar('updating', bool(false)),
  procCall('recalcTops')
));

const clearOrder = procDef('clearOrder', seq(procCall('clearBase'), procCall('clearTops')));

const resetDiscount = procDef('resetDiscount', seq(
  setVar('updating', bool(true)),
  setProp('CbDisc0', 'CheckBox', 'Checked', bool(false)),
  setProp('CbDisc5', 'CheckBox', 'Checked', bool(false)),
  setProp('CbDisc10', 'CheckBox', 'Checked', bool(false)),
  setProp('CbDisc20', 'CheckBox', 'Checked', bool(false)),
  setVar('updating', bool(false)),
  procCall('recalcDiscount')
));

const clearAll = procDef('clearAll', seq(procCall('clearBase'), procCall('clearTops'), procCall('resetDiscount')));

/* --------------------------------------------------------------- handlers */

const anyDiscount = or(
  getProp('CbDisc0', 'CheckBox', 'Checked'),
  getProp('CbDisc5', 'CheckBox', 'Checked'),
  getProp('CbDisc10', 'CheckBox', 'Checked'),
  getProp('CbDisc20', 'CheckBox', 'Checked')
);

const baseHandlers = [1, 2, 3].map((n) => {
  const others = [1, 2, 3].filter((o) => o !== n);
  return event(`CbBase${n}`, 'CheckBox', 'Changed', ifBlock([{
    cond: not(getVar('updating')),
    stack: seq(
      setVar('updating', bool(true)),
      ifBlock([{
        cond: getProp(`CbBase${n}`, 'CheckBox', 'Checked'),
        stack: seq(...others.map((o) => setProp(`CbBase${o}`, 'CheckBox', 'Checked', bool(false))))
      }]),
      setVar('updating', bool(false)),
      procCall('recalcBase')
    )
  }]));
});

const topHandlers = [1, 2, 3].map((n) =>
  event(`CbTop${n}`, 'CheckBox', 'Changed', procCall('recalcTops')));

const discHandlers = [0, 5, 10, 20].map((pct) => {
  const others = [0, 5, 10, 20].filter((o) => o !== pct);
  return event(`CbDisc${pct}`, 'CheckBox', 'Changed', ifBlock([{
    cond: not(getVar('updating')),
    stack: seq(
      setVar('updating', bool(true)),
      ifBlock([{
        cond: getProp(`CbDisc${pct}`, 'CheckBox', 'Checked'),
        stack: seq(...others.map((o) => setProp(`CbDisc${o}`, 'CheckBox', 'Checked', bool(false))))
      }]),
      setVar('updating', bool(false)),
      procCall('recalcDiscount')
    )
  }]));
});

const totalHandler = event('BtnTotal', 'Button', 'Click', ifBlock([
  {
    cond: and(eq(getVar('basePrice'), num(0)), eq(getVar('topPrice'), num(0))),
    stack: check('Select a pizza and at least one extra.')
  },
  { cond: eq(getVar('basePrice'), num(0)), stack: check('Select a pizza first.') },
  { cond: eq(getVar('topPrice'), num(0)), stack: check('Select at least one extra.') }
], seq(
  setVar('total', add(getVar('basePrice'), getVar('topPrice'))),
  setProp('LbTotal', 'Label', 'Text', getVar('total')),
  setVar('discountAmt', num(0)),
  setProp('LbDiscAmt', 'Label', 'Text', txt('-')),
  setProp('LbFinal', 'Label', 'Text', txt('-'))
)));

const discountHandler = event('BtnDiscAmt', 'Button', 'Click', ifBlock([
  { cond: eq(getVar('total'), num(0)), stack: check('Press TOTAL first.') },
  { cond: not(anyDiscount), stack: check('Please select a discount.') }
], seq(
  setVar('discountAmt', div(mul(getVar('total'), getVar('discountPct')), num(100))),
  setProp('LbDiscAmt', 'Label', 'Text', getVar('discountAmt')),
  setProp('LbFinal', 'Label', 'Text', sub(getVar('total'), getVar('discountAmt')))
)));

const clearBaseHandler = event('BtnClearBase', 'Button', 'Click', ifBlock([
  { cond: eq(getVar('basePrice'), num(0)), stack: check('Nothing to clear.') }
], askConfirm('base', 'Clear the selected pizza?', 'Clear pizza')));

const clearTopHandler = event('BtnClearTop', 'Button', 'Click', ifBlock([
  { cond: eq(getVar('topPrice'), num(0)), stack: check('Nothing to clear.') }
], askConfirm('tops', 'Clear the extras?', 'Clear extras')));

const clearOrderHandler = event('BtnClearOrder', 'Button', 'Click', ifBlock([
  {
    cond: and(eq(getVar('basePrice'), num(0)), eq(getVar('topPrice'), num(0))),
    stack: check('The order is already empty.')
  }
], askConfirm('order', 'Clear the whole order?', 'Clear order')));

const resetDiscHandler = event('BtnResetDisc', 'Button', 'Click', ifBlock([
  { cond: not(anyDiscount), stack: check('No discount selected.') }
], askConfirm('discount', 'Reset the discount?', 'Reset discount')));

const clearDataHandler = event('BtnClearData', 'Button', 'Click', ifBlock([
  {
    cond: and(eq(getVar('basePrice'), num(0)), eq(getVar('topPrice'), num(0)), not(anyDiscount)),
    stack: check('Nothing to clear.')
  }
], askConfirm('all', 'Reset everything?', 'Clear data')));

const afterChoosing = event('Notifier1', 'Notifier', 'AfterChoosing', seq(
  ifBlock([{
    cond: eq(getLocal('choice'), txt('Yes')),
    stack: ifBlock([
      { cond: eq(getVar('pendingAction'), txt('base')), stack: seq(procCall('clearBase'), done('Pizza cleared.')) },
      { cond: eq(getVar('pendingAction'), txt('tops')), stack: seq(procCall('clearTops'), done('Extras cleared.')) },
      { cond: eq(getVar('pendingAction'), txt('order')), stack: seq(procCall('clearOrder'), done('Order cleared.')) },
      { cond: eq(getVar('pendingAction'), txt('discount')), stack: seq(procCall('resetDiscount'), done('Discount reset.')) },
      { cond: eq(getVar('pendingAction'), txt('all')), stack: seq(procCall('clearAll'), done('All data cleared.')) }
    ])
  }], check('Cancelled')),
  setVar('pendingAction', txt(''))
));

/* ----------------------------------------------------------------- output */

const topLevel = [
  ...globals,
  invalidateResults, recalcBase, recalcTops, recalcDiscount,
  clearBase, clearTops, clearOrder, resetDiscount, clearAll,
  ...baseHandlers, ...topHandlers, ...discHandlers,
  totalHandler, discountHandler,
  clearBaseHandler, clearTopHandler, clearOrderHandler, resetDiscHandler, clearDataHandler,
  afterChoosing
];

let xml = '<xml xmlns="https://developers.google.com/blockly/xml">\n';
topLevel.forEach((b, i) => {
  xml += b.replace('<block ', `<block x="${20 + (i % 3) * 320}" y="${20 + Math.floor(i / 3) * 260}" `) + '\n';
});
xml += '</xml>\n';

process.stdout.write(xml);
