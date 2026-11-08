import fs from 'node:fs';
import { relay } from './harness.mjs';

const dir = 'C:/Opencode - Projects/appinventor-autonomous/samples/quiz/assets';

// Replace the asset in the project (same name, so the Image component keeps it).
const buf = fs.readFileSync(`${dir}/logo.png`);
const up = await relay('project.uploadAsset', {
  name: 'logo.png',
  base64: buf.toString('base64'),
  mime: 'image/png',
  path: 'assets/logo.png'
}, 60000);
console.log('upload:', JSON.stringify(up));
