import fs from 'node:fs';
import { relay, rpc } from './harness.mjs';

// Regenerate the XML from build-blocks.mjs, then push only Screen1's handlers.
const { execFileSync } = await import('node:child_process');
console.log(execFileSync(process.execPath, ['samples/quiz/build-blocks.mjs'], { encoding: 'utf8' }).trim());

await relay('designer.switchScreen', { name: 'Screen1' });
const xml = fs.readFileSync('samples/quiz/Screen1.xml', 'utf8');
const res = await rpc('ai_blocks', { action: 'set', xml }, 180000);
console.log('blocks:', res.blocks ?? JSON.stringify(res).slice(0, 160));

const diag = await relay('blocks.diagnostics');
console.log('block errors:', diag.blockErrors && diag.blockErrors.errorCount);
const events = (diag.events || []).map((e) => e.component + '.' + e.event);
console.log('handlers:', events.join(', '));
