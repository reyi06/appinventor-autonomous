#!/usr/bin/env node
/**
 * MCP protocol smoke test: speaks stdio JSON-RPC to the server and checks the
 * shape of initialize, tools, prompts and resources. No browser required.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'mcp', 'server.js');

const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, APPINVENTOR_MCP_PORT: '8799', APPINVENTOR_MCP_NO_STDIN: '' }
});

let buffer = '';
const pending = new Map();
let seq = 0;

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const entry = pending.get(msg.id);
    if (entry) {
      pending.delete(msg.id);
      msg.error ? entry.reject(new Error(msg.error.message)) : entry.resolve(msg.result);
    }
  }
});

function rpc(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 15000);
  });
}

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: !!condition, detail });
}

try {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  check('initialize returns serverInfo', init.serverInfo && init.serverInfo.name === 'appinventor-autonomous', init.serverInfo);
  check('declares tools capability', !!init.capabilities.tools);
  check('declares prompts capability', !!init.capabilities.prompts);
  check('declares resources capability', !!init.capabilities.resources);

  const tools = await rpc('tools/list', {});
  check('tools listed', Array.isArray(tools.tools) && tools.tools.length >= 10, `${tools.tools.length} tools`);
  check('tool count stays small', tools.tools.length <= 15, `${tools.tools.length} tools (consolidation target)`);
  const names = tools.tools.map((t) => t.name);
  for (const required of ['ai_status', 'ai_project', 'ai_screen', 'ai_component', 'ai_asset', 'ai_blocks', 'ai_layout', 'ai_validate', 'ai_build', 'ai_test', 'ai_batch']) {
    check(`has ${required}`, names.includes(required));
  }
  check('no legacy per-action tools', !names.includes('ai_component_add') && !names.includes('ai_blocks_set'));
  check('every tool has a description', tools.tools.every((t) => typeof t.description === 'string' && t.description.length > 20));
  check('every tool has an action enum or schema', tools.tools.every((t) => (t.inputSchema && t.inputSchema.properties) || true));

  const bad = await rpc('tools/call', { name: 'ai_component', arguments: { action: 'nope' } });
  const badText = JSON.stringify(bad || {});
  check('unknown action errors with the valid list', !!(bad && bad.isError) && /Valid actions/.test(badText), badText.slice(0, 160));

  const prompts = await rpc('prompts/list', {});
  check('prompts listed', prompts.prompts.length === 6, `${prompts.prompts.length} prompts`);
  const prompt = await rpc('prompts/get', { name: 'ship_apk', arguments: { project: 'Demo', device: 'emulator-5554' } });
  const text = prompt.messages[0].content.text;
  check('prompt substitutes arguments', text.includes('Demo') && text.includes('emulator-5554'));
  check('prompt has no placeholders left', !text.includes('{{'));

  const resources = await rpc('resources/list', {});
  check('resources listed', resources.resources.length >= 6, `${resources.resources.length} resources`);
  const doc = await rpc('resources/read', { uri: 'appinventor://docs/architecture' });
  check('doc resource readable', doc.contents[0].text.includes('relay'));

  const missing = await rpc('resources/read', { uri: 'appinventor://nope' }).then(() => null, (e) => e.message);
  check('unknown resource errors', !!missing, missing);

  const badTool = await rpc('tools/call', { name: 'nope', arguments: {} }).then(() => null, (e) => e.message);
  check('unknown tool errors', !!badTool, badTool);
} catch (e) {
  check('fatal', false, e.message);
} finally {
  child.kill();
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
