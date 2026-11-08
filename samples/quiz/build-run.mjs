import { rpc } from './harness.mjs';

const build = await rpc('ai_build', { action: 'apk' }, 600000);
console.log('apk:', build.file, 'verify:', build.verify && build.verify.valid);

const run = await rpc('ai_test', {
  action: 'run',
  file: build.file,
  steps: [{ action: 'sleep', ms: 2500 }, { action: 'dump' }]
}, 600000);
const failed = (run.steps || []).filter((s) => !s.ok).map((s) => s.error);
console.log('run ok:', run.ok, 'failed:', failed);
console.log('texts:', JSON.stringify((run.steps || []).filter((s) => s.texts).map((s) => s.texts)));

const shot = await rpc('ai_test', { action: 'screenshot' }, 120000);
console.log('shot:', shot.file);
