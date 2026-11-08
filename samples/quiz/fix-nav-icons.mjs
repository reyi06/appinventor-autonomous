import { relay } from './harness.mjs';

const set = (c, p, v) => relay('designer.setProperty', { component: c, property: p, value: v }, 90000);
for (const icon of ['IconHome', 'IconPlay', 'IconScore']) {
  await set(icon, 'Width', '44');
  await set(icon, 'Height', '44');
}
console.log('nav icons -> 44dp (the PNG carries ~40% padding, so the glyph reads ~18dp)');
