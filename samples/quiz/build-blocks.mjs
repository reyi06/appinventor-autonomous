#!/usr/bin/env node
/**
 * QuizMaster blocks, as App Inventor block XML — one file per screen.
 *
 * Every block type, input name and mutation here was read from
 * mit-cml/appinventor-sources (blocklyeditor/src/blocks) rather than guessed:
 *   lists_select_item  input LIST, NUM
 *   lists_length       input LIST
 *   lists_add_items    inputs LIST, ITEM0 (mutation items="1")
 *   lists_create_with  inputs ADD0.. (mutation items="N")
 *   controls_openAnotherScreenWithStartValue  SCREENNAME, STARTVALUE
 *   controls_openAnotherScreen                SCREEN
 *   controls_getStartValue                    (value block, no inputs)
 *
 * The app is deliberately deterministic: questions are fixed, and there are no
 * modal dialogs (Notifier.ShowAlert is a toast that dismisses itself), so an
 * emulator script can assert exact text at every step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));

let counter = 0;
const uid = () => `qz_${++counter}`;
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** One block. `inline` is left null unless a block needs it. */
function block(type, { fields = {}, values = {}, statements = {}, mutation = null, inline = null } = {}) {
  const parts = [];
  if (mutation) parts.push(mutation);
  if (inline !== null) parts.push(`<field name="INLINE">${inline}</field>`);
  for (const [name, value] of Object.entries(fields)) {
    parts.push(`<field name="${name}">${esc(value)}</field>`);
  }
  for (const [name, value] of Object.entries(values)) {
    if (!value) continue;
    parts.push(`<value name="${name}">${value}</value>`);
  }
  for (const [name, value] of Object.entries(statements)) {
    if (!value) continue;
    parts.push(`<statement name="${name}">${value}</statement>`);
  }
  return `<block type="${type}" id="${uid()}">${parts.join('')}</block>`;
}

const withNext = (xml, next) => (next ? xml.replace(/<\/block>$/, `<next>${next}</next></block>`) : xml);
const seq = (...items) => items.filter(Boolean).reduceRight((next, item) => withNext(item, next), '');

const num = (n) => block('math_number', { fields: { NUM: String(n) } });
const txt = (t) => block('text', { fields: { TEXT: t } });
const bool = (v) => block('logic_boolean', { fields: { BOOL: v ? 'TRUE' : 'FALSE' } });
const emptyList = () => block('lists_create_with', { mutation: '<mutation items="0"></mutation>' });
const listOf = (...items) => block('lists_create_with', {
  mutation: `<mutation items="${items.length}"></mutation>`,
  values: items.reduce((acc, item, i) => Object.assign(acc, { [`ADD${i}`]: item }), {})
});

const getVar = (name) => block('lexical_variable_get', { fields: { VAR: `global ${name}` } });
const setVar = (name, value) => block('lexical_variable_set', { fields: { VAR: `global ${name}` }, values: { VALUE: value } });
const globalVar = (name, value) => block('global_declaration', { fields: { NAME: name }, values: { VALUE: value } });

const compMutation = (type, attrs) =>
  `<mutation component_type="${type}" ${attrs} is_generic="false"></mutation>`;

const getProp = (comp, type, prop) => block('component_set_get', {
  mutation: compMutation(type, `set_or_get="get" property_name="${prop}" instance_name="${comp}"`),
  fields: { COMPONENT_SELECTOR: comp, PROP: prop }
});
const setProp = (comp, type, prop, value) => block('component_set_get', {
  mutation: compMutation(type, `set_or_get="set" property_name="${prop}" instance_name="${comp}"`),
  fields: { COMPONENT_SELECTOR: comp, PROP: prop },
  values: { VALUE: value }
});
const callMethod = (comp, type, method, args = []) => block('component_method', {
  mutation: compMutation(type, `method_name="${method}" instance_name="${comp}"`),
  fields: { COMPONENT_SELECTOR: comp, METHOD: method },
  values: args.reduce((acc, arg, i) => Object.assign(acc, { [`ARG${i}`]: arg }), {})
});
const event = (comp, type, name, body) => block('component_event', {
  mutation: compMutation(type, `event_name="${name}" instance_name="${comp}"`),
  fields: { COMPONENT_SELECTOR: comp },
  statements: { DO: body }
});

const add = (a, b) => block('math_add', { values: { NUM0: a, NUM1: b } });
const sub = (a, b) => block('math_subtract', { values: { A: a, B: b } });
const eq = (a, b) => block('logic_compare', { fields: { OP: 'EQ' }, values: { A: a, B: b } });
// Ordering comparisons are math_compare, not logic_compare: logic_compare only
// implements = and !=, and its generator turns any other operator into =.
const gt = (a, b) => block('math_compare', { fields: { OP: 'GT' }, values: { A: a, B: b } });
const lte = (a, b) => block('math_compare', { fields: { OP: 'LTE' }, values: { A: a, B: b } });
const negate = (a) => block('logic_negate', { values: { BOOL: a } });

const joinN = (...parts) => block('text_join', {
  mutation: `<mutation items="${parts.length}"></mutation>`,
  values: parts.reduce((acc, part, i) => Object.assign(acc, { [`ADD${i}`]: part }), {})
});
const trim = (value) => block('text_trim', { values: { TEXT: value } });

const selectItem = (list, n) => block('lists_select_item', { values: { LIST: list, NUM: n } });
const listLength = (list) => block('lists_length', { values: { LIST: list } });
const listAdd = (list, item) => block('lists_add_items', {
  mutation: '<mutation items="1"></mutation>',
  values: { LIST: list, ITEM0: item }
});

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

const procDef = (name, body, params = []) => block('procedures_defnoreturn', {
  mutation: params.length ? `<mutation>${params.map((p) => `<arg name="${p}"></arg>`).join('')}</mutation>` : null,
  fields: { NAME: name },
  statements: { STACK: body }
});
const procCall = (name, args = [], params = null) => {
  const names = params || args.map((_, i) => `arg${i}`);
  return block('procedures_callnoreturn', {
    mutation: `<mutation name="${name}">${names.map((p) => `<arg name="${p}"></arg>`).join('')}</mutation>`,
    fields: { PROCNAME: name },
    values: args.reduce((acc, arg, i) => Object.assign(acc, { [`ARG${i}`]: arg }), {})
  });
};

/** Read a procedure parameter (no "global " prefix). */
const getParam = (name) => block('lexical_variable_get', { fields: { VAR: name } });

const startValue = () => block('controls_getStartValue');
const openWith = (screen, value) => block('controls_openAnotherScreenWithStartValue', {
  values: { SCREENNAME: txt(screen), STARTVALUE: value }
});
const openScreen = (screen) => block('controls_openAnotherScreen', { values: { SCREEN: txt(screen) } });
const alert = (message) => callMethod('Notifier1', 'Notifier', 'ShowAlert', [message]);

// A colour property takes a colour block, not text: passing "&HFF16A34A" as a
// text block crashes at runtime with "Bad arguments to TextColor".
const green = () => block('color_green');
const red = () => block('color_red');

/* ------------------------------------------------------------------ Screen1 */

const QUIZ = [
  ['Which planet is known as the Red Planet?', 'Mars', 'Venus', 'Jupiter', 'Mercury'],
  ['What does CPU stand for?', 'Central Processing Unit', 'Computer Power Unit', 'Central Print Unit', 'Control Panel Unit'],
  ['How many sides does a hexagon have?', '6', '5', '7', '8'],
  ['Who wrote "Romeo and Juliet"?', 'William Shakespeare', 'Charles Dickens', 'Jane Austen', 'Mark Twain'],
  ['What is the largest ocean on Earth?', 'Pacific', 'Atlantic', 'Indian', 'Arctic']
];

const screen1 = [
  globalVar('playerName', txt('')),
  event('Screen1', 'Form', 'Initialize', seq(
    setProp('BestLabel', 'Label', 'Text', joinN(
      txt('Best: '),
      callMethod('DataStore1', 'TinyDB', 'GetValue', [txt('best'), num(0)])
    ))
  )),
  event('StartButton', 'Button', 'Click', seq(
    setVar('playerName', trim(getProp('NameBox', 'TextBox', 'Text'))),
    ifBlock(
      [{ cond: eq(getVar('playerName'), txt('')), stack: seq(alert(txt('Please enter your name first.'))) }],
      seq(
        callMethod('DataStore1', 'TinyDB', 'StoreValue', [txt('playerName'), getVar('playerName')]),
        callMethod('DataStore1', 'TinyDB', 'StoreValue', [txt('timed'), getProp('TimerCheck', 'CheckBox', 'Checked')]),
        callMethod('DataStore1', 'TinyDB', 'StoreValue', [txt('hints'), getProp('HintsSwitch', 'Switch', 'On')]),
        callMethod('DataStore1', 'TinyDB', 'StoreValue', [txt('difficulty'), getProp('LevelSpinner', 'Spinner', 'Selection')]),
        openWith('QuizScreen', getVar('playerName'))
      )
    )
  )),
  event('Screen1', 'Form', 'OtherScreenClosed', seq(
    setProp('BestLabel', 'Label', 'Text', joinN(
      txt('Best: '),
      callMethod('DataStore1', 'TinyDB', 'GetValue', [txt('best'), num(0)])
    ))
  )),

  // Bottom tab bar. Home just re-reads the best score (we are already here);
  // Play and Scores jump straight to their screens with the stored values.
  event('IconHome', 'Image', 'Click', seq(
    setProp('BestLabel', 'Label', 'Text', joinN(
      txt('Best: '),
      callMethod('DataStore1', 'TinyDB', 'GetValue', [txt('best'), num(0)])
    ))
  )),
  event('IconPlay', 'Image', 'Click', seq(
    openWith('QuizScreen', callMethod('DataStore1', 'TinyDB', 'GetValue', [txt('playerName'), txt('')]))
  )),
  event('IconScore', 'Image', 'Click', seq(
    openWith('ResultScreen', callMethod('DataStore1', 'TinyDB', 'GetValue', [txt('lastScore'), num(0)]))
  ))
];

/* --------------------------------------------------------------- QuizScreen */

// questions = list of [question, correct, wrong1, wrong2, wrong3]
const questionsLiteral = listOf(...QUIZ.map((q) => listOf(...q.map((cell) => txt(cell)))));

const quizScreen = [
  globalVar('questions', emptyList()),
  globalVar('index', num(1)),
  globalVar('score', num(0)),
  globalVar('secondsLeft', num(15)),
  globalVar('timed', bool(false)),

  event('QuizScreen', 'Form', 'Initialize', seq(
    setVar('timed', callMethod('DataStore', 'TinyDB', 'GetValue', [txt('timed'), bool(false)])),
    setProp('QuestionClock', 'Clock', 'TimerEnabled', getVar('timed')),
    setVar('questions', questionsLiteral),
    setVar('index', num(1)),
    setVar('score', num(0)),
    procCall('LoadQuestion', [num(1)], ['qIndex'])
  )),

  procDef('LoadQuestion', seq(
    setVar('index', getParam('qIndex')),
    setProp('QuestionLabel', 'Label', 'Text', selectItem(selectItem(getVar('questions'), getVar('index')), num(1))),
    setProp('Answer1', 'Button', 'Text', selectItem(selectItem(getVar('questions'), getVar('index')), num(2))),
    setProp('Answer2', 'Button', 'Text', selectItem(selectItem(getVar('questions'), getVar('index')), num(3))),
    setProp('Answer3', 'Button', 'Text', selectItem(selectItem(getVar('questions'), getVar('index')), num(4))),
    setProp('Answer4', 'Button', 'Text', selectItem(selectItem(getVar('questions'), getVar('index')), num(5))),
    setProp('ProgressLabel', 'Label', 'Text', joinN(
      txt('Question '), getVar('index'), txt(' of '), listLength(getVar('questions'))
    )),
    setProp('FeedbackLabel', 'Label', 'Text', txt('')),
    setVar('secondsLeft', num(15)),
    setProp('TimerLabel', 'Label', 'Text', joinN(getVar('secondsLeft'), txt('s')))
  ), ['qIndex']),

  procDef('NextQuestion', seq(
    ifBlock(
      [{ cond: eq(getVar('index'), listLength(getVar('questions'))), stack: seq(
        callMethod('DataStore', 'TinyDB', 'StoreValue', [txt('lastScore'), getVar('score')]),
        openWith('ResultScreen', getVar('score'))
      ) }],
      seq(procCall('LoadQuestion', [add(getVar('index'), num(1))], ['qIndex']))
    )
  )),

  procDef('CheckAnswer', seq(
    ifBlock(
      [{ cond: eq(
        selectItem(selectItem(getVar('questions'), getVar('index')), add(getParam('choice'), num(1))),
        selectItem(selectItem(getVar('questions'), getVar('index')), num(2))
      ), stack: seq(
        setVar('score', add(getVar('score'), num(1))),
        setProp('FeedbackLabel', 'Label', 'Text', txt('Correct!')),
        setProp('FeedbackLabel', 'Label', 'TextColor', green())
      ) }],
      seq(
        setProp('FeedbackLabel', 'Label', 'Text', joinN(
          txt('Answer: '),
          selectItem(selectItem(getVar('questions'), getVar('index')), num(2))
        )),
        setProp('FeedbackLabel', 'Label', 'TextColor', red())
      )
    ),
    procCall('NextQuestion')
  ), ['choice']),

  event('QuestionClock', 'Clock', 'Timer', seq(
    setVar('secondsLeft', sub(getVar('secondsLeft'), num(1))),
    ifBlock(
      [{ cond: lte(getVar('secondsLeft'), num(0)), stack: seq(
        setProp('FeedbackLabel', 'Label', 'Text', txt('Time up')),
        setProp('FeedbackLabel', 'Label', 'TextColor', red()),
        procCall('NextQuestion')
      ) }],
      seq(setProp('TimerLabel', 'Label', 'Text', joinN(getVar('secondsLeft'), txt('s'))))
    )
  ))
];

for (let i = 1; i <= 4; i++) {
  quizScreen.push(event(`Answer${i}`, 'Button', 'Click', procCall('CheckAnswer', [num(i)], ['choice'])));
}

/* ------------------------------------------------------------- ResultScreen */

const total = 5;

const resultScreen = [
  globalVar('finalScore', num(0)),
  globalVar('best', num(0)),
  globalVar('attempts', emptyList()),

  event('ResultScreen', 'Form', 'Initialize', seq(
    setVar('finalScore', startValue()),
    setProp('ScoreLabel', 'Label', 'Text', joinN(getVar('finalScore'), txt(' / '), num(total))),
    setVar('best', callMethod('DataStore2', 'TinyDB', 'GetValue', [txt('best'), num(0)])),
    ifBlock(
      [{ cond: gt(getVar('finalScore'), getVar('best')), stack: seq(
        callMethod('DataStore2', 'TinyDB', 'StoreValue', [txt('best'), getVar('finalScore')]),
        setProp('MessageLabel', 'Label', 'Text', txt('New personal best!'))
      ) }],
      seq(setProp('MessageLabel', 'Label', 'Text', joinN(
        txt('You scored '), getVar('finalScore'), txt(' of '), num(total)
      )))
    ),
    setVar('attempts', callMethod('DataStore2', 'TinyDB', 'GetValue', [txt('attempts'), emptyList()])),
    listAdd(getVar('attempts'), joinN(getVar('finalScore'), txt('/'), num(total))),
    callMethod('DataStore2', 'TinyDB', 'StoreValue', [txt('attempts'), getVar('attempts')]),
    setProp('AttemptsList', 'ListView', 'Elements', getVar('attempts'))
  )),

  event('AgainButton', 'Button', 'Click', openScreen('Screen1')),

  event('RateSlider', 'Slider', 'PositionChanged', seq(
    callMethod('DataStore2', 'TinyDB', 'StoreValue', [
      txt('rating'),
      getProp('RateSlider', 'Slider', 'ThumbPosition')
    ])
  ))
];

/* -------------------------------------------------------------------- write */

const wrap = (blocks) => `<xml xmlns="https://developers.google.com/blockly/xml">${blocks.join('')}</xml>`;

fs.writeFileSync(path.join(OUT, 'Screen1.xml'), wrap(screen1));
fs.writeFileSync(path.join(OUT, 'QuizScreen.xml'), wrap(quizScreen));
fs.writeFileSync(path.join(OUT, 'ResultScreen.xml'), wrap(resultScreen));

for (const [name, blocks] of [['Screen1', screen1], ['QuizScreen', quizScreen], ['ResultScreen', resultScreen]]) {
  console.log(`${name}: ${blocks.length} top-level blocks`);
}
