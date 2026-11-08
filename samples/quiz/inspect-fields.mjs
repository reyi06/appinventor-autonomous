import { rpc, relay } from './harness.mjs';

for (const name of ['FldName', 'FldNameInner', 'NameBox', 'FldLevel', 'FldLevelInner', 'LevelSpinner']) {
  const got = await rpc('ai_component', { action: 'get', component: name }).catch((e) => ({ error: String(e.message).slice(0, 70) }));
  const p = got.properties || {};
  console.log(
    name.padEnd(14),
    'w=' + String(p.Width ?? '-').padEnd(14),
    'h=' + String(p.Height ?? '-').padEnd(14),
    'bg=' + String(p.BackgroundColor ?? '-').padEnd(11),
    'img=' + String(p.Image ?? '-')
  );
}
