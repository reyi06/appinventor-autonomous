#!/usr/bin/env node
/**
 * Access-control test for the local HTTP/WebSocket surface.
 *
 * These endpoints can read arbitrary local files (`ai_asset_upload`) and drive
 * ADB, so "it binds 127.0.0.1" is not a security boundary: the browser can reach
 * it. Each check below is one of the attacks that made the boundary necessary.
 *
 * Spawns a real server on a spare port with a known token, then speaks HTTP and
 * WebSocket to it from the outside.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { loadToken, originAllowed, hostAllowed, tokenMatches } from '../mcp/lib/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'mcp', 'server.js');

const PORT = 8811;
const TOKEN = 'test-token-0123456789abcdef';

const checks = [];
const check = (ok, name, detail) => checks.push({ ok: !!ok, name, detail });

/** @returns {Promise<{status:number, headers:object, body:string}>} */
function request({ method = 'GET', path: pathname = '/', headers = {}, body = null, host = `127.0.0.1:${PORT}` }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path: pathname, headers: { host, ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function openSocket(origin) {
  return new Promise((resolve) => {
    // A browser always sends Origin on a WebSocket handshake; `undefined` here
    // models a non-browser client, and `ws` needs the header left out entirely.
    const options = origin === undefined ? {} : { headers: { Origin: origin } };
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`, options);
    const done = (result) => { try { ws.close(); } catch { /* ignore */ } resolve(result); };
    ws.on('open', () => done({ opened: true }));
    ws.on('unexpected-response', (_req, res) => done({ opened: false, status: res.statusCode }));
    ws.on('error', (e) => done({ opened: false, error: e.message }));
    setTimeout(() => done({ opened: false, error: 'timeout' }), 4000);
  });
}

const json = { 'content-type': 'application/json' };
const auth = { authorization: `Bearer ${TOKEN}` };
const rpcBody = JSON.stringify({ tool: 'nope', arguments: {} });

// --- pure helpers, no server needed ---------------------------------------

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai2-token-'));
  const first = loadToken(dir, {});
  check(/^[a-f0-9]{48}$/.test(first.token), 'loadToken generates 48 hex chars', first.token.length + ' chars');
  check(first.created === true, 'loadToken reports first creation');
  const second = loadToken(dir, {});
  check(second.token === first.token && second.created === false, 'loadToken reuses the file on restart');
  check(loadToken(dir, { APPINVENTOR_MCP_TOKEN: 'from-env' }).token === 'from-env', 'env token wins over the file');
  fs.rmSync(dir, { recursive: true, force: true });
}

check(originAllowed('https://ai2.appinventor.mit.edu'), 'ai2 origin allowed');
check(originAllowed('https://ai2a.appinventor.mit.edu'), 'ai2a origin allowed');
check(originAllowed('https://code.appinventor.mit.edu'), 'code origin allowed');
check(!originAllowed('https://evil.com'), 'foreign origin refused');
check(!originAllowed('https://ai2.appinventor.mit.edu.evil.com'), 'suffix spoof refused');
check(!originAllowed('null'), 'null origin refused');
check(!originAllowed(''), 'missing origin refused');
check(originAllowed('http://localhost:8888', ['http://localhost:8888']), 'extra origin allowed when configured');

check(hostAllowed(`127.0.0.1:${PORT}`, PORT), 'loopback host allowed');
check(hostAllowed(`localhost:${PORT}`, PORT), 'localhost host allowed');
check(!hostAllowed(`evil.com:${PORT}`, PORT), 'rebound host refused');
check(!hostAllowed('127.0.0.1:9999', PORT), 'wrong port refused');

check(tokenMatches(`Bearer ${TOKEN}`, TOKEN), 'correct bearer token matches');
check(!tokenMatches(`Bearer ${TOKEN}x`, TOKEN), 'token prefix refused');
check(!tokenMatches(TOKEN, TOKEN), 'raw token without scheme refused');
check(!tokenMatches('', TOKEN), 'missing token refused');

// --- live server ----------------------------------------------------------

const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    APPINVENTOR_MCP_PORT: String(PORT),
    APPINVENTOR_MCP_TOKEN: TOKEN,
    APPINVENTOR_MCP_NO_STDIN: '1'
  }
});

try {
  // Wait for the port, not a fixed sleep.
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      await request({ path: '/health' });
      up = true;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  check(up, 'server bound on the test port');

  if (up) {
    const health = await request({ path: '/health' });
    check(health.status === 200, 'GET /health is public', `status ${health.status}`);
    check(!health.headers['access-control-allow-origin'], '/health does not send a wildcard CORS header',
      health.headers['access-control-allow-origin'] || '(none)');

    const noToken = await request({ method: 'POST', path: '/rpc', headers: json, body: rpcBody });
    check(noToken.status === 401, 'POST /rpc without a token is refused', `status ${noToken.status}`);

    const wrongToken = await request({ method: 'POST', path: '/rpc', headers: { ...json, authorization: 'Bearer nope' }, body: rpcBody });
    check(wrongToken.status === 401, 'POST /rpc with a wrong token is refused', `status ${wrongToken.status}`);

    const simpleRequest = await request({
      method: 'POST',
      path: '/rpc',
      headers: { ...auth, 'content-type': 'text/plain' },
      body: rpcBody
    });
    check(simpleRequest.status === 415, 'POST /rpc with text/plain is refused (no CSRF preflight bypass)',
      `status ${simpleRequest.status}`);

    const rebound = await request({ method: 'POST', path: '/rpc', headers: { ...json, ...auth }, body: rpcBody, host: 'evil.com' });
    check(rebound.status === 403, 'POST /rpc with a foreign Host is refused (DNS rebinding)', `status ${rebound.status}`);

    const allowed = await request({ method: 'POST', path: '/rpc', headers: { ...json, ...auth }, body: rpcBody });
    check(allowed.status === 500 && /Unknown tool/.test(allowed.body), 'POST /rpc with a valid token reaches the tool layer',
      `status ${allowed.status}`);

    const preflightEvil = await request({ method: 'OPTIONS', path: '/rpc', headers: { origin: 'https://evil.com' } });
    check(preflightEvil.status === 403, 'CORS preflight from a foreign origin is refused', `status ${preflightEvil.status}`);

    const preflightOk = await request({ method: 'OPTIONS', path: '/rpc', headers: { origin: 'https://ai2.appinventor.mit.edu' } });
    check(preflightOk.status === 204, 'CORS preflight from App Inventor is allowed', `status ${preflightOk.status}`);
    check(preflightOk.headers['access-control-allow-origin'] === 'https://ai2.appinventor.mit.edu',
      'CORS reflects the caller origin instead of *', preflightOk.headers['access-control-allow-origin']);

    const evilSocket = await openSocket('https://evil.com');
    check(!evilSocket.opened, 'WebSocket from a foreign origin is refused',
      evilSocket.status ? `status ${evilSocket.status}` : evilSocket.error || 'opened');

    const noOriginSocket = await openSocket(undefined);
    check(!noOriginSocket.opened, 'WebSocket without an Origin is refused',
      noOriginSocket.status ? `status ${noOriginSocket.status}` : noOriginSocket.error || 'opened');

    const goodSocket = await openSocket('https://ai2.appinventor.mit.edu');
    check(goodSocket.opened === true, 'WebSocket from App Inventor is allowed',
      goodSocket.error || `status ${goodSocket.status || ''}`);
  }
} catch (e) {
  check(false, 'fatal', e.message);
} finally {
  child.kill();
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
