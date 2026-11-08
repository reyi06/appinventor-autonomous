import fs from 'node:fs';
import { relay } from './harness.mjs';

const dir = 'C:/Opencode - Projects/appinventor-autonomous/samples/quiz/assets';
const buf = fs.readFileSync(`${dir}/field.png`);
const up = await relay('project.uploadAsset', {
  name: 'field.png', base64: buf.toString('base64'), mime: 'image/png', path: 'assets/field.png'
}, 60000);
console.log('field.png', up.status, up.bytes);
