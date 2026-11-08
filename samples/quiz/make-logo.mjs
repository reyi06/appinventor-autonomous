#!/usr/bin/env node
/**
 * Generate the QuizMaster icon as a PNG, with no image dependencies.
 *
 * A rounded indigo tile with a white "?" mark: ring + stem + dot. Drawn at 3x
 * (288 px) so it stays crisp at 96 dp, and supersampled 3x3 for smooth edges.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 288;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logo.png');

const BG = [0x3d, 0x5a, 0xfe];
const FG = [0xff, 0xff, 0xff];

const radius = 62;          // tile corner radius
const ring = { cx: SIZE / 2, cy: 118, r: 58, w: 22 };
const stem = { x: SIZE / 2, top: 150, bottom: 186, w: 22 };
const dot = { cx: SIZE / 2, cy: 216, r: 14 };

const inside = (px, py) => {
  // rounded rectangle
  const m = radius;
  const x = Math.min(px, SIZE - px);
  const y = Math.min(py, SIZE - py);
  if (x >= m || y >= m) return x >= 0 && y >= 0;
  const dx = m - x;
  const dy = m - y;
  return dx * dx + dy * dy <= m * m;
};

const inRing = (px, py) => {
  const d = Math.hypot(px - ring.cx, py - ring.cy);
  return Math.abs(d - ring.r) <= ring.w / 2;
};

const inStem = (px, py) =>
  Math.abs(px - stem.x) <= stem.w / 2 && py >= stem.top && py <= stem.bottom;

const inDot = (px, py) => Math.hypot(px - dot.cx, py - dot.cy) <= dot.r;

const samples = 3;
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);

for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        const px = x + (sx + 0.5) / samples;
        const py = y + (sy + 0.5) / samples;
        if (!inside(px, py)) continue;
        const mark = inRing(px, py) || inStem(px, py) || inDot(px, py);
        const c = mark ? FG : BG;
        r += c[0];
        g += c[1];
        b += c[2];
        a += 255;
      }
    }
    const n = samples * samples;
    const i = rowStart + 1 + x * 4;
    const cover = a / (255 * n);
    raw[i] = cover ? Math.round(r / (a / 255)) : 0;
    raw[i + 1] = cover ? Math.round(g / (a / 255)) : 0;
    raw[i + 2] = cover ? Math.round(b / (a / 255)) : 0;
    raw[i + 3] = Math.round(cover * 255);
  }
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // colour type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

fs.writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${SIZE}x${SIZE}, ${png.length} bytes)`);
