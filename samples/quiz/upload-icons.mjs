import fs from 'node:fs';
import { relay } from './harness.mjs';

const dir = 'C:/Opencode - Projects/appinventor-autonomous/samples/quiz/assets';

for (const name of ['logo.png', 'icon_home.png', 'icon_play.png', 'icon_trophy.png', 'icon_clock.png']) {
  const buf = fs.readFileSync(`${dir}/${name}`);
  const up = await relay('project.uploadAsset', {
    name,
    base64: buf.toString('base64'),
    mime: 'image/png',
    path: `assets/${name}`
  }, 60000);
  console.log(name.padEnd(18), up.status, up.bytes);
}
