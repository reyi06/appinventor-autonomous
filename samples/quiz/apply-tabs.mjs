import { relay } from './harness.mjs';

// The tab image already contains icon + label, so the button carries no text.
const set = (component, property, value) => relay('designer.setProperty', { component, property, value }, 90000);

for (const [name, image] of [['NavHome', 'tab_home.png'], ['NavPlay', 'tab_play.png'], ['NavScore', 'tab_scores.png']]) {
  await set(name, 'Text', '');
  await set(name, 'Image', image);
  await set(name, 'BackgroundColor', '&HFFFFFFFF');
  console.log(name, '->', image);
}
