import { relay } from './harness.mjs';

const add = (type, name, parent) => relay('designer.addComponent', { type, name, parent }, 90000);
const set = (c, p, v) => relay('designer.setProperty', { component: c, property: p, value: v }, 90000);
const rm = (name) => relay('designer.removeComponent', { name }, 90000);

const INK = '&HFF1B1F3B';
const BRAND = '&HFF3D5AFE';
const MUTED = '&HFF94A3B8';
const CLEAR = '&H00FFFFFF';

console.log('--- teardown: navbar + form fields ---');
for (const name of ['NavHome', 'NavPlay', 'NavScore', 'NavRow', 'NavBar']) {
  await rm(name).catch((e) => console.log('rm', name, String(e.message).slice(0, 50)));
}
for (const name of ['NameBox', 'NameCaption', 'GapC', 'DiffCaption', 'LevelSpinner', 'GapD', 'OptionsRow']) {
  await rm(name).catch((e) => console.log('rm', name, String(e.message).slice(0, 50)));
}
console.log('torn down');

/* ---------------- fields: outer carries the art, inner is transparent --------------- */

await add('Label', 'NameCaption', 'FormCard');
await set('NameCaption', 'Text', 'Your name');
await set('NameCaption', 'FontSize', '13');
await set('NameCaption', 'FontBold', 'True');
await set('NameCaption', 'TextColor', INK);
await set('NameCaption', 'Width', 'Fill parent');

await add('HorizontalArrangement', 'FldName', 'FormCard');
await set('FldName', 'Width', 'Fill parent');
await set('FldName', 'Height', '52');
await set('FldName', 'Image', 'field.png');
await set('FldName', 'AlignHorizontal', 'center');
await set('FldName', 'AlignVertical', 'center');

await add('HorizontalArrangement', 'FldNameInner', 'FldName');
await set('FldNameInner', 'Width', '92%');
await set('FldNameInner', 'Height', 'Fill parent');
await set('FldNameInner', 'BackgroundColor', CLEAR);
await set('FldNameInner', 'AlignVertical', 'center');

await add('TextBox', 'NameBox', 'FldNameInner');
await set('NameBox', 'Width', 'Fill parent');
await set('NameBox', 'Height', '40');
await set('NameBox', 'BackgroundColor', CLEAR);
await set('NameBox', 'TextColor', INK);
await set('NameBox', 'FontSize', '15');
await set('NameBox', 'Hint', 'e.g. Ada');

await add('Label', 'GapC', 'FormCard');
await set('GapC', 'Text', '');
await set('GapC', 'Height', '10');

await add('Label', 'DiffCaption', 'FormCard');
await set('DiffCaption', 'Text', 'Difficulty');
await set('DiffCaption', 'FontSize', '13');
await set('DiffCaption', 'FontBold', 'True');
await set('DiffCaption', 'TextColor', INK);
await set('DiffCaption', 'Width', 'Fill parent');

await add('HorizontalArrangement', 'FldLevel', 'FormCard');
await set('FldLevel', 'Width', 'Fill parent');
await set('FldLevel', 'Height', '52');
await set('FldLevel', 'Image', 'field.png');
await set('FldLevel', 'AlignHorizontal', 'center');
await set('FldLevel', 'AlignVertical', 'center');

await add('HorizontalArrangement', 'FldLevelInner', 'FldLevel');
await set('FldLevelInner', 'Width', '92%');
await set('FldLevelInner', 'Height', 'Fill parent');
await set('FldLevelInner', 'BackgroundColor', CLEAR);
await set('FldLevelInner', 'AlignVertical', 'center');

await add('Spinner', 'LevelSpinner', 'FldLevelInner');
await set('LevelSpinner', 'Width', 'Fill parent');
await set('LevelSpinner', 'Height', '40');
await set('LevelSpinner', 'BackgroundColor', CLEAR);
await set('LevelSpinner', 'TextColor', INK);
await set('LevelSpinner', 'FontSize', '15');
await set('LevelSpinner', 'ElementsFromString', 'Easy,Medium,Hard');

await add('Label', 'GapD', 'FormCard');
await set('GapD', 'Text', '');
await set('GapD', 'Height', '10');

await add('HorizontalArrangement', 'OptionsRow', 'FormCard');
await set('OptionsRow', 'Width', 'Fill parent');
await set('OptionsRow', 'Height', 'Automatic');

await add('Switch', 'HintsSwitch', 'OptionsRow');
await set('HintsSwitch', 'Text', 'Show hints');
await set('HintsSwitch', 'Width', 'Automatic');
await set('HintsSwitch', 'TextColor', INK);

await add('CheckBox', 'TimerCheck', 'OptionsRow');
await set('TimerCheck', 'Text', 'Timed');
await set('TimerCheck', 'Width', 'Automatic');
await set('TimerCheck', 'TextColor', INK);

console.log('fields rebuilt');

/* --------------- navbar: Image (clickable) + Label columns, per the reference ---------- */

await add('VerticalArrangement', 'NavBar', 'Root');
await set('NavBar', 'Width', 'Fill parent');
await set('NavBar', 'Height', '72');
await set('NavBar', 'BackgroundColor', '&HFFFFFFFF');
await set('NavBar', 'AlignHorizontal', 'center');
await set('NavBar', 'AlignVertical', 'center');

await add('HorizontalArrangement', 'NavRow', 'NavBar');
await set('NavRow', 'Width', 'Fill parent');
await set('NavRow', 'Height', '72');
await set('NavRow', 'AlignHorizontal', 'center');
await set('NavRow', 'AlignVertical', 'center');

const tabs = [
  ['VAHome', 'IconHome', 'LbHome', 'HOME', 'icon_home.png', BRAND],
  ['VAPlay', 'IconPlay', 'LbPlay', 'PLAY', 'icon_play.png', MUTED],
  ['VAScore', 'IconScore', 'LbScore', 'SCORES', 'icon_trophy.png', MUTED]
];
for (const [va, icon, label, text, png, colour] of tabs) {
  await add('VerticalArrangement', va, 'NavRow');
  await set(va, 'Width', 'Fill parent');
  await set(va, 'AlignHorizontal', 'center');

  await add('Image', icon, va);
  await set(icon, 'Width', '30');
  await set(icon, 'Height', '30');
  await set(icon, 'Picture', png);

  await add('Label', label, va);
  await set(label, 'Width', 'Fill parent');
  await set(label, 'Text', text);
  await set(label, 'FontSize', '10');
  await set(label, 'FontBold', 'True');
  await set(label, 'TextAlignment', 'center');
  await set(label, 'TextColor', colour);
}
console.log('navbar rebuilt as image+label columns');
