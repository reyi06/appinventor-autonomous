#!/usr/bin/env node
/**
 * UI/UX pattern report over real App Inventor projects.
 *
 * Reads .aia files from samples/ui-corpus/ and reports the design decisions they
 * actually make: nesting depth, where artwork sits, how sizes are expressed,
 * which colours and type sizes recur, and what the blocks reveal about behaviour.
 *
 *   node samples/ui-corpus/report.mjs            # summary
 *   node samples/ui-corpus/report.mjs connect    # one project, in depth
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseScm, componentNode, flattenComponents } from '../../mcp/lib/scm.js';
import { scanBky } from '../../mcp/lib/bky.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---- minimal zip reader (central directory only) ---- */
function readZip(buf) {
  // find EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const lnameLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(start, start + csize);
    files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const top = (map, n = 6) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

function analyse(file) {
  const files = readZip(fs.readFileSync(file));
  const scms = [...files.keys()].filter((k) => k.endsWith('.scm'));
  const out = { project: path.basename(file, '.aia'), screens: [], types: new Map(), colours: new Map(), fontSizes: new Map(), align: new Map(), blocks: 0, blockTypes: new Map(), events: [], globals: 0, procedures: 0 };

  for (const scmPath of scms) {
    const doc = parseScm(files.get(scmPath).toString('utf8'));
    const root = componentNode(doc.Properties);
    const flat = flattenComponents(root);
    const form = doc.Properties || {};

    // depth of arrangement nesting
    let maxDepth = 0;
    let withArt = 0;
    let transparent = 0;
    let pct = 0;
    let fixed = 0;
    let fill = 0;
    let auto = 0;
    (function walk(node, depth) {
      const p = node.properties || {};
      maxDepth = Math.max(maxDepth, depth);
      const isArr = /Arrangement|Layout/.test(node.type || '');
      if (isArr && p.Image) withArt++;
      if (String(p.BackgroundColor || '').toUpperCase().startsWith('&H00')) transparent++;
      for (const k of ['Width', 'Height']) {
        const v = Number(p[k]);
        if (!p[k]) continue;
        if (p[k] === 'Fill parent') fill++;
        else if (p[k] === 'Automatic') auto++;
        else if (Number.isFinite(v) && v <= -1000) pct++;
        else if (Number.isFinite(v) && v > 0) fixed++;
      }
      if (p.BackgroundColor) bump(out.colours, String(p.BackgroundColor).toUpperCase());
      if (p.TextColor) bump(out.colours, String(p.TextColor).toUpperCase());
      if (p.FontSize) bump(out.fontSizes, String(p.FontSize).replace(/\.0$/, ''));
      if (p.AlignHorizontal) bump(out.align, 'H' + p.AlignHorizontal);
      if (p.AlignVertical) bump(out.align, 'V' + p.AlignVertical);
      bump(out.types, node.type);
      for (const c of node.children || []) walk(c, depth + 1);
    })(root, 0);

    const bky = files.get(scmPath.replace(/\.scm$/, '.bky'));
    let scan = null;
    if (bky) {
      const xml = bky.toString('utf8');
      scan = scanBky(xml);
      out.blocks += scan.blockCount;
      // count occurrences, not distinct types
      for (const m of xml.matchAll(/<block[^>]*type="([^"]+)"/g)) bump(out.blockTypes, m[1]);
      out.events.push(...scan.events.map((e) => `${e.instance}.${e.event}`));
      out.globals += scan.globals.size;
      out.procedures += (xml.match(/type="procedures_defnoreturn"/g) || []).length;
      out.procedures += (xml.match(/type="procedures_defreturn"/g) || []).length;
      // how many distinct components own a handler
      out.handlerComponents = new Set(scan.events.map((e) => e.instance));
    }

    out.screens.push({
      name: path.basename(scmPath, '.scm'),
      components: flat.length,
      blocks: scan ? scan.blockCount : 0,
      titleBarHidden: String(form.TitleVisible || '').toLowerCase() === 'false',
      scrollable: String(form.Scrollable || '').toLowerCase() === 'true',
      maxDepth,
      arrangedWithArt: withArt,
      transparent: transparent,
      sizing: { pct, fixed, fill, auto }
    });
  }
  return out;
}

const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.aia'));
const filter = process.argv[2];
const reports = files
  .filter((f) => !filter || f.toLowerCase().includes(filter.toLowerCase()))
  .map((f) => analyse(path.join(HERE, f)));

for (const r of reports) {
  console.log(`\n=== ${r.project} — ${r.screens.length} screen(s), ${r.blocks} blocks ===`);
  for (const s of r.screens) {
    console.log(
      `  ${s.name.padEnd(14)} comps=${String(s.components).padStart(3)} blocks=${String(s.blocks).padStart(4)} ` +
      `depth=${s.maxDepth} art-on-arrangement=${s.arrangedWithArt} transparent=${s.transparent} ` +
      `titleBarHidden=${s.titleBarHidden} scrollable=${s.scrollable} ` +
      `sizing[pct=${s.sizing.pct} px=${s.sizing.fixed} fill=${s.sizing.fill} auto=${s.sizing.auto}]`
    );
  }
  console.log('  components:', top(r.types, 8).map(([k, v]) => `${k}×${v}`).join('  '));
  console.log('  colours   :', top(r.colours, 7).map(([k, v]) => `${k}×${v}`).join('  '));
  console.log('  font sizes:', top(r.fontSizes, 7).map(([k, v]) => `${k}×${v}`).join('  '));
  console.log('  aligns    :', top(r.align, 6).map(([k, v]) => `${k}×${v}`).join('  '));
  console.log('  blocks    :', `total=${r.blocks} handlers=${r.events.length} globals=${r.globals} procedures=${r.procedures}`);
  console.log('  block types:', top(r.blockTypes, 8).map(([k, v]) => `${k}×${v}`).join('  '));
  console.log('  handlers  :', r.events.slice(0, 10).join(', '));
}
