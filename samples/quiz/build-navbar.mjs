import { relay } from './harness.mjs';

const add = (type, name, parent) => relay('designer.addComponent', { type, name, parent }, 90000);
const set = (component, property, value) => relay('designer.setProperty', { component, property, value }, 90000);

// Bottom tab bar: an arrangement of icon+label buttons, pinned as Root's last child.
console.log('NavBar', (await add('VerticalArrangement', 'NavBar', 'Root')).created);
await set('NavBar', 'Width', 'Fill parent');
await set('NavBar', 'Height', '76');
await set('NavBar', 'BackgroundColor', '&HFFFFFFFF');
await set('NavBar', 'AlignHorizontal', 'center');
await set('NavBar', 'AlignVertical', 'center');

console.log('NavRow', (await add('HorizontalArrangement', 'NavRow', 'NavBar')).created);
await set('NavRow', 'Width', 'Fill parent');
await set('NavRow', 'Height', '76');
await set('NavRow', 'AlignHorizontal', 'center');
await set('NavRow', 'AlignVertical', 'center');

const tabs = [
  ['NavHome', 'Home', 'icon_home.png'],
  ['NavPlay', 'Play', 'icon_play.png'],
  ['NavScore', 'Scores', 'icon_trophy.png']
];
for (const [name, label, icon] of tabs) {
  console.log(name, (await add('Button', name, 'NavRow')).created);
  await set(name, 'Width', '33%');
  await set(name, 'Height', '64');
  await set(name, 'Text', label);
  await set(name, 'FontSize', '11');
  await set(name, 'BackgroundColor', '&HFFFFFFFF');
  await set(name, 'TextColor', '&HFF3D5AFE');
  await set(name, 'Image', icon);
}
console.log('done');
