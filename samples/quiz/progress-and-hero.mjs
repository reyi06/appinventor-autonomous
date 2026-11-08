import { relay } from './harness.mjs';

const add = (type, name, parent) => relay('designer.addComponent', { type, name, parent }, 90000);
const set = (c, p, v) => relay('designer.setProperty', { component: c, property: p, value: v }, 90000);
const sw = (name) => relay('designer.switchScreen', { name }, 90000);

/* --- Result screen: the score becomes the hero (one project in the corpus sizes
       a headline figure at 301; 72 is the readable version of that idea) --- */
await sw('ResultScreen');
await set('ScoreLabel', 'FontSize', '72');
await set('ScoreLabel', 'Height', '110');
console.log('ResultScreen: score is a hero number');

/* --- Quiz screen: a progress bar built from two labels. The track is the row,
       the fill is a label whose width the blocks set in pixels. --- */
await sw('QuizScreen');
await add('HorizontalArrangement', 'HABar', 'Root2');
await set('HABar', 'Width', '88%');
await set('HABar', 'Height', '8');
await set('HABar', 'BackgroundColor', '&HFFE5E9F2');
await set('HABar', 'AlignHorizontal', 'left');
await set('HABar', 'AlignVertical', 'center');

await add('Label', 'ProgressFill', 'HABar');
await set('ProgressFill', 'Text', '');
await set('ProgressFill', 'Width', '0');
await set('ProgressFill', 'Height', 'Fill parent');
await set('ProgressFill', 'BackgroundColor', '&HFF3D5AFE');
console.log('QuizScreen: progress track + fill added');

await sw('Screen1');
