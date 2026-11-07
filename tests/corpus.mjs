#!/usr/bin/env node
/**
 * Offline corpus check: runs the MCP's own parsers and validators over real
 * App Inventor projects, with no browser involved.
 *
 * The corpus in samples/corpus/ is MIT-licensed test data from
 * mit-cml/appinventor-sources. See samples/corpus/README.md.
 *
 * This is the cheap half of `ai_validate`: parser regressions and false
 * positives show up here without a signed-in editor. It deliberately imports the
 * production scanner (`mcp/lib/bky.js`) instead of reimplementing it, so a
 * divergence between the test and the tool is impossible.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScm, componentNode, flattenComponents } from '../mcp/lib/scm.js';
import { scanBky, undeclaredGlobals, globalsMissingPrefix } from '../mcp/lib/bky.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(ROOT, 'samples', 'corpus');

const checks = [];
const check = (ok, label, detail) => checks.push({ ok, label, detail });

const projects = (await fs.readdir(CORPUS, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

check(projects.length >= 10, 'corpus loaded', `${projects.length} projects`);

const summary = [];
const allBlockTypes = new Set();

for (const name of projects) {
  const dir = path.join(CORPUS, name);
  let scm = null;
  let bky = null;
  try { scm = await fs.readFile(path.join(dir, 'Screen1.scm'), 'utf8'); } catch { /* missing */ }
  try { bky = await fs.readFile(path.join(dir, 'Screen1.bky'), 'utf8'); } catch { /* missing */ }

  check(!!scm, `${name}: .scm present`);
  check(!!bky, `${name}: .bky present`);
  if (!scm || !bky) continue;

  let doc;
  try {
    doc = parseScm(scm);
    check(true, `${name}: .scm parses`);
  } catch (e) {
    check(false, `${name}: .scm parses`, e.message);
    continue;
  }

  const props = doc.Properties || {};
  check(!!props.$Name && !!props.$Type, `${name}: form has $Name/$Type`, `${props.$Name}/${props.$Type}`);
  check(!!props.$Version, `${name}: form has $Version`, props.$Version);

  const root = componentNode(props);
  const flat = flattenComponents(root);
  const names = new Set(flat.map((c) => c.name));

  const scan = scanBky(bky);
  check(true, `${name}: format`, scan.legacy ? 'legacy (pre-2018 blocks)' : 'modern');

  if (scan.legacy) {
    // The official fixtures predate the 2018 serialisation change (per-event
    // block types, <title> fields). The live editor upgrades them on import, so
    // they only need to parse without crashing.
    check(scan.blockCount >= 0, `${name}: legacy blocks readable`, `${scan.blockCount} blocks`);
    summary.push({ project: name, format: 'legacy', components: flat.length, blocks: scan.blockCount, handlers: 0, globals: 0, types: 0 });
    continue;
  }

  scan.blockTypes.forEach((t) => allBlockTypes.add(t));

  const missing = scan.instanceRefs.filter((i) => !names.has(i));
  check(missing.length === 0, `${name}: block refs resolve`,
    missing.length ? `missing: ${missing.join(', ')}` : `${scan.blockCount} blocks`);

  const badEvents = scan.events.filter((e) => !e.instance || !e.event);
  check(badEvents.length === 0, `${name}: events well formed`,
    badEvents.length ? JSON.stringify(badEvents.slice(0, 2)) : `${scan.events.length} handlers`);

  check(scan.duplicateHandlers.length === 0, `${name}: no duplicate handlers`,
    scan.duplicateHandlers.join(', ') || 'ok');

  const undeclared = undeclaredGlobals(scan);
  check(undeclared.length === 0, `${name}: globals declared`,
    undeclared.length ? `undeclared: ${undeclared.join(', ')}` : `${scan.globals.size} globals`);

  const unprefixed = globalsMissingPrefix(scan);
  check(unprefixed.length === 0, `${name}: global refs prefixed`,
    unprefixed.length ? `missing prefix: ${unprefixed.join(', ')}` : 'ok');

  summary.push({
    project: name,
    format: 'modern',
    components: flat.length,
    blocks: scan.blockCount,
    handlers: scan.events.length,
    globals: scan.globals.size,
    types: scan.blockTypes.length
  });
}

const failed = checks.filter((c) => !c.ok);
if (process.env.VERBOSE) {
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? '  — ' + c.detail : ''}`);
}

const pad = (v, n) => String(v).padEnd(n);
console.log('\nproject                  format   comps  blocks  handlers  globals  types');
for (const s of summary) {
  console.log(
    pad(s.project, 23) + pad(s.format, 9) +
    String(s.components).padStart(5) +
    String(s.blocks).padStart(8) +
    String(s.handlers).padStart(10) +
    String(s.globals).padStart(9) +
    String(s.types).padStart(7)
  );
}

const modern = summary.filter((s) => s.format === 'modern').length;
console.log(`\n${modern} modern / ${summary.length - modern} legacy · distinct block types: ${allBlockTypes.size}`);
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log('\nfailures:');
  for (const f of failed) console.log(`  ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
}
process.exit(failed.length ? 1 : 0);
