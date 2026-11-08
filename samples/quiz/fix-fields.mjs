import { relay } from './harness.mjs';

const set = (c, p, v) => relay('designer.setProperty', { component: c, property: p, value: v }, 90000);
const BRAND = '&HFF3D5AFE';

// Percentages resolve against the SCREEN, not the parent, so 92% inside a 317dp
// field is 331dp - wider than the field. Fixed dp keeps the inset honest.
for (const inner of ['FldNameInner', 'FldLevelInner']) {
  await set(inner, 'Width', '250');
  await set(inner, 'AlignHorizontal', 'center');
  console.log(inner, '-> 250dp');
}

// A transparent Spinner paints black on Android; give it the pill colour instead.
await set('FldLevelInner', 'BackgroundColor', '&H00FFFFFF');
await set('LevelSpinner', 'BackgroundColor', '&HFFF3F5FA');
console.log('spinner background set');

// The reference keeps every tab label in one tone rather than an active state.
await set('LbPlay', 'TextColor', BRAND);
await set('LbScore', 'TextColor', BRAND);
console.log('nav labels unified');
