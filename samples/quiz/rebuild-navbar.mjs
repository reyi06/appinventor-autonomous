import fs from 'node:fs';
import { relay } from './harness.mjs';

const dir = 'C:/Opencode - Projects/appinventor-autonomous/samples/quiz/assets';

// 1. Assets first, so the picker has them.
for (const name of ['icon_home.png', 'icon_play.png', 'icon_trophy.png']) {
  const buf = fs.readFileSync(`${dir}/${name}`);
  const up = await relay('project.uploadAsset', { name, base64: buf.toString('base64'), mime: 'image/png', path: `assets/${name}` }, 60000);
  console.log(name.padEnd(17), up.status);
}

const add = (type, name, parent) => relay('designer.addComponent', { type, name, parent }, 90000);
const set = (component, property, value) => relay('designer.setProperty', { component, property, value }, 90000);
const rm = (name) => relay('designer.removeComponent', { name }, 90000);

// 2. Rebuild the tab bar so it comes *after* a fill-parent spacer: the bar only
//    pins to the bottom when it is the last child of a top-aligned column.
console.log('--- tearing down the floating bar ---');
for (const name of ['NavHome', 'NavPlay', 'NavScore', 'NavRow', 'NavBar']) {
  await rm(name).then((r) => console.log('removed', name, r.verified)).catch((e) => console.log('remove failed', name, String(e.message).slice(0, 60)));
}

await add('Label', 'SpacerNav', 'Root');
await set('SpacerNav', 'Text', '');
await set('SpacerNav', 'Width', 'Fill parent');
await set('SpacerNav', 'Height', 'Fill parent');

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

for (const [name, label, icon] of [['NavHome', 'Home', 'icon_home.png'], ['NavPlay', 'Play', 'icon_play.png'], ['NavScore', 'Scores', 'icon_trophy.png']]) {
  await add('Button', name, 'NavRow');
  await set(name, 'Width', '33%');
  await set(name, 'Height', '64');
  await set(name, 'Text', label);
  await set(name, 'FontSize', '11');
  await set(name, 'BackgroundColor', '&HFFFFFFFF');
  await set(name, 'TextColor', '&HFF3D5AFE');
  await set(name, 'Image', icon);
}

// 3. Top-align the column so the spacer can absorb the slack above the bar.
await set('Root', 'AlignVertical', 'top');
console.log('done');
