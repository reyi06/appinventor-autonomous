import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Opencode - Projects/appinventor-autonomous';
const TOKEN = fs.readFileSync(path.join(ROOT, 'logs', 'token'), 'utf8').trim();

export async function relay(tool, params = {}, timeoutMs = 60000) {
  const res = await fetch('http://127.0.0.1:8766/relay-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ tool, params, timeoutMs })
  });
  const body = await res.json();
  if (!res.ok || body.__error) throw new Error(`${tool}: ${body.__error || res.status}`);
  return body.result;
}

export async function rpc(tool, args = {}, timeoutMs = 180000) {
  const res = await fetch('http://127.0.0.1:8766/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ tool, arguments: args }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) throw new Error(`${tool}: ${body.error || res.status}`);
  return body;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const r = await relay('designer.setProperty', { component: 'Screen1', property: 'TitleVisible', value: 'False' });
  console.log('TitleVisible ->', JSON.stringify(r));
}
