#!/usr/bin/env node
/**
 * Load the generated block XML into the live project, screen by screen.
 *
 * Uses the server's HTTP endpoint rather than an MCP client, which is the
 * practical way to send 24 KB of XML: it needs the bearer token from
 * `logs/token`, so this doubles as a live check of the /rpc access control.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = Number(process.env.APPINVENTOR_MCP_PORT || 8766);
const TOKEN = fs.readFileSync(path.join(ROOT, 'logs', 'token'), 'utf8').trim();

async function rpc(tool, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ tool, arguments: args })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
  if (!res.ok || data.ok === false) {
    throw new Error(`${tool} ${JSON.stringify(args).slice(0, 80)} -> HTTP ${res.status}: ${data.error || text.slice(0, 200)}`);
  }
  return data;
}

const screens = ['Screen1', 'QuizScreen', 'ResultScreen'];

for (const screen of screens) {
  const xml = fs.readFileSync(path.join(HERE, `${screen}.xml`), 'utf8');
  const switched = await rpc('ai_screen', { action: 'switch', name: screen });
  const applied = await rpc('ai_blocks', { action: 'set', xml });
  const summary = applied.summary || {};
  console.log(
    `${screen.padEnd(13)} current=${switched.current.padEnd(13)} ` +
    `blocks=${applied.blocks ?? summary.total ?? '?'} errors=${applied.errors ?? summary.errors ?? 0} ` +
    `(xml ${Math.round(xml.length / 1024)} KB)`
  );
  if (applied.diagnostics && applied.diagnostics.errorCount) {
    console.log(JSON.stringify(applied.diagnostics, null, 2).slice(0, 2000));
  }
}
