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
import { loadToken, originAllowed, hostAllowed, tokenMatches, isJsonRequest } from './lib/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.APPINVENTOR_MCP_PORT || 8766);
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'mcp.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

/** Bearer token for the two POST endpoints; created on first run. */
const TOKEN_INFO = loadToken(LOG_DIR);
const TOKEN = TOKEN_INFO.token;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  // Asynchronous: never let disk or a full stderr pipe block the protocol loop.
  fs.appendFile(LOG_FILE, line, () => {});
  process.stderr.write(line);
}

const relayPath = path.join(__dirname, 'page', 'relay.js');

let hub = null;
let toolMap = new Map();
let built = null;
let bound = false;

/** The relay version this server ships, read from the served script. */
function relayVersion() {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'page', 'relay.js'), 'utf8');
    const m = src.match(/var VERSION\s*=\s*'([^']+)'/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const EXPECTED_RELAY_VERSION = relayVersion();

function buildTools(h) {
  const result = createTools({ hub: h, workDir: ROOT });
  toolMap = new Map(result.tools.map((t) => [t.name, t]));
  return result;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function createHttpHandler(h) {
  return async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const origin = req.headers.origin;

    // DNS rebinding. The socket is loopback either way, but the name is not:
    // a page on evil.com that resolves to 127.0.0.1 still sends `Host: evil.com`.
    if (!hostAllowed(req.headers.host, PORT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end(`Host ${req.headers.host} not accepted: this server answers only on 127.0.0.1:${PORT}`);
      return;
    }

    // Reflect only our own origins. `*` plus `Allow-Headers: *` used to make the
    // whole surface callable from any page.
    if (origin && originAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      // Refusing the preflight means the real request is never sent.
      if (origin && !originAllowed(origin)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }).end('origin not allowed');
        return;
      }
      res.writeHead(204).end();
      return;
    }

    const deny = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: message }, null, 2));
    };

    /**
     * Both POST endpoints execute tools, so both need the token. Requiring JSON
     * is what makes the header mandatory: a `text/plain` body would be a CORS
     * simple request and skip the preflight entirely.
     */
    const guarded = () => {
      if (!isJsonRequest(req)) {
        deny(415, 'Content-Type: application/json required');
        return false;
      }
      if (!tokenMatches(req.headers.authorization, TOKEN)) {
        deny(401, `Missing or wrong token. Send "Authorization: Bearer <token>" with the value from ${TOKEN_INFO.file}`);
        return false;
      }
      return true;
    };

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
      if (!guarded()) return;
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
      if (!guarded()) return;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { tool, arguments: args } = JSON.parse(body || '{}');
          const entry = toolMap.get(tool);
          if (!entry) {
            const op = built && built.ops ? built.ops.get(tool) : null;
            if (!op) throw new Error(`Unknown tool: ${tool}`);
            const result = await op.handler(args || {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result, null, 2));
            return;
          }
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
<p>Connected tabs: ${h.clientCount()}</p>
<p><code>POST /rpc</code> and <code>POST /relay-call</code> require
<code>Authorization: Bearer &lt;token&gt;</code> from <code>${escapeHtml(TOKEN_INFO.file)}</code>.
The WebSocket relay accepts only App Inventor origins.</p>`);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  };
}

/**
 * Startup order matters: the MCP transport is attached FIRST and synchronously,
 * because the client waits on `initialize`. Binding the HTTP/WebSocket relay is
 * best effort and must never gate the protocol handshake — a stalled bind used
 * to look to the client like "Request timed out".
 */
function start() {
  let remoteHint = null;

  const httpServer = http.createServer((req, res) => {
    if (!hub) { res.writeHead(503).end('starting'); return; }
    createHttpHandler(hub)(req, res);
  });

  hub = createHub(httpServer, {
    log,
    expectedRelayVersion: EXPECTED_RELAY_VERSION,
    remoteFallback: () => remoteHint,
    originAllowed,
    token: TOKEN
  });

  built = buildTools(hub);
  const prompts = createPrompts({ rootDir: ROOT });
  const resources = createResources({ rootDir: ROOT, hub });
  createMcpServer({ name: 'appinventor-autonomous', version: '2.0.0', tools: built.tools, prompts, resources, log });
  log(`MCP server ready with ${built.tools.length} tools, ${prompts.list().length} prompts, ${resources.list().length} resources`);

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      remoteHint = `http://127.0.0.1:${PORT}`;
      log(`port ${PORT} is busy - forwarding relay calls to the bridge already there`);
    } else {
      log(`http server error: ${err.message}`);
    }
  });

  httpServer.listen(PORT, '127.0.0.1', () => {
    bound = true;
    log(`relay listening on http://127.0.0.1:${PORT} (relay: /relay.js)`);
    log(`POST /rpc and POST /relay-call require "Authorization: Bearer <token>" from ${TOKEN_INFO.file}`);
  });
}

process.on('uncaughtException', (err) => log(`uncaught: ${err.stack || err.message}`));
process.on('unhandledRejection', (err) => log(`unhandled rejection: ${err && err.stack ? err.stack : err}`));

start();

process.on('SIGTERM', () => { try { hub && hub.close(); } catch { /* ignore */ } process.exit(0); });
process.on('SIGINT', () => { try { hub && hub.close(); } catch { /* ignore */ } process.exit(0); });

if (process.env.APPINVENTOR_MCP_NO_STDIN !== '1') process.stdin.resume();
