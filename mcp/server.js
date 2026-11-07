#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub } from './lib/hub.js';
import { createMcpServer } from './lib/mcp.js';
import { createTools } from './tools.js';
import { createPrompts } from './prompts.js';
import { createResources } from './resources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.APPINVENTOR_MCP_PORT || 8766);
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'mcp.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
  process.stderr.write(line);
}

const relayPath = path.join(__dirname, 'page', 'relay.js');

/** Is another appinventor-autonomous bridge already serving this port? */
async function probeExistingBridge() {
  try {
    const ctl = AbortSignal.timeout(700);
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: ctl });
    const body = await res.json();
    return !!(body && body.relayUrl);
  } catch {
    return false;
  }
}

let hub = null;
let toolMap = new Map();
let bound = false;

function buildTools(h) {
  const tools = createTools({ hub: h, workDir: ROOT });
  toolMap = new Map(tools.map((t) => [t.name, t]));
  return tools;
}

function createHttpHandler(h) {
  return async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    if (url.pathname === '/relay.js') {
      try {
        const body = await fsp.readFile(relayPath);
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(body);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`relay.js unavailable: ${e.message}`);
      }
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        port: PORT,
        relayUrl: `http://127.0.0.1:${PORT}/relay.js`,
        clients: h.status()
      }, null, 2));
      return;
    }

    if (url.pathname === '/relay-call' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { tool, params, timeoutMs } = JSON.parse(body || '{}');
          const result = await h.call(tool, params || {}, { timeoutMs: timeoutMs || 45000 });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (e) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ __error: e.message, __code: e.code || 'RELAY_ERROR' }));
        }
      });
      return;
    }

    if (url.pathname === '/rpc' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { tool, arguments: args } = JSON.parse(body || '{}');
          const entry = toolMap.get(tool);
          if (!entry) throw new Error(`Unknown tool: ${tool}`);
          const result = await entry.handler(args || {});
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result, null, 2));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message, code: e.code || 'TOOL_ERROR' }, null, 2));
        }
      });
      return;
    }

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>appinventor-autonomous</title>
<h1>appinventor-autonomous MCP</h1>
<p>Relay script: <a href="/relay.js">/relay.js</a></p>
<p>Health: <a href="/health">/health</a></p>
<p>Connected tabs: ${h.clientCount()}</p>`);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  };
}

async function start() {
  const alreadyRunning = await probeExistingBridge();

  if (alreadyRunning) {
    log(`another bridge already serves 127.0.0.1:${PORT} - this instance forwards relay calls to it`);
    hub = createHub(null, { log, remoteFallback: `http://127.0.0.1:${PORT}` });
  } else {
    const httpServer = http.createServer((req, res) => {
      if (!hub) { res.writeHead(503).end('starting'); return; }
      createHttpHandler(hub)(req, res);
    });

    hub = createHub(httpServer, { log });

    await new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };

      httpServer.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          log(`port ${PORT} became busy - switching to remote mode`);
        } else {
          log(`http server error: ${err.message}`);
        }
        done();
      });

      httpServer.listen(PORT, '127.0.0.1', () => {
        bound = true;
        log(`listening on http://127.0.0.1:${PORT} (relay: /relay.js)`);
        done();
      });
    });

    if (!bound) {
      hub = createHub(null, { log, remoteFallback: `http://127.0.0.1:${PORT}` });
    }
  }

  const tools = buildTools(hub);
  const prompts = createPrompts({ rootDir: ROOT });
  const resources = createResources({ rootDir: ROOT, hub });
  createMcpServer({ name: 'appinventor-autonomous', version: '1.1.0', tools, prompts, resources, log });
  log(`MCP server ready with ${tools.length} tools, ${prompts.list().length} prompts, ${resources.list().length} resources (${bound ? 'bridge' : 'relay-forwarder'} mode)`);
}

process.on('uncaughtException', (err) => log(`uncaught: ${err.stack || err.message}`));
process.on('unhandledRejection', (err) => log(`unhandled rejection: ${err && err.stack ? err.stack : err}`));

start().catch((err) => {
  log(`fatal during startup: ${err.stack || err.message}`);
  process.exit(1);
});

process.on('SIGTERM', () => { try { hub && hub.close(); } catch { /* ignore */ } process.exit(0); });
process.on('SIGINT', () => { try { hub && hub.close(); } catch { /* ignore */ } process.exit(0); });

if (process.env.APPINVENTOR_MCP_NO_STDIN !== '1') process.stdin.resume();
