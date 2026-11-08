import { rpc } from './harness.mjs';

const file = 'C:/Opencode - Projects/appinventor-autonomous/builds/app-2026-11-08T05-19-06.apk';
const run = await rpc('ai_test', {
  action: 'run',
  file,
  steps: [
    { action: 'sleep', ms: 2500 },
    { action: 'tapEditText' },
    { action: 'typeText', text: 'Ada' },
    { action: 'tapText', text: 'Start quiz' },
    { action: 'waitForText', text: 'Computer Power Unit', timeoutMs: 9000 },
    { action: 'sleep', ms: 500 }
  ]
}, 600000).catch((e) => ({ ok: false, error: String(e.message) }));

console.log('run ok:', run.ok, run.error || '');
const failed = (run.steps || []).filter((s) => !s.ok).map((s) => `${s.action}: ${s.error}`);
console.log('failed steps:', failed.length ? failed : 'none');
const shot = await rpc('ai_test', { action: 'screenshot' }, 120000);
console.log('shot:', shot.file);
