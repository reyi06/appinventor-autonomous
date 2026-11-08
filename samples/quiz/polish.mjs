import { relay } from './harness.mjs';

const set = (c, p, v) => relay('designer.setProperty', { component: c, property: p, value: v }, 90000);
const sw = (name) => relay('designer.switchScreen', { name }, 90000);

// A full-screen background image letterboxes when the content aspect differs, which
// is what produced the white bands above and below. Flat colour instead.
await sw('Screen1');
await set('Screen1', 'BackgroundImage', 'None');
console.log('Screen1 background image cleared');

// The reference project hides the title bar on every screen and draws its own headers.
for (const screen of ['QuizScreen', 'ResultScreen']) {
  await sw(screen);
  await set(screen, 'TitleVisible', 'False');
  console.log(screen, 'TitleVisible -> False');
}

await sw('Screen1');
console.log('done');
