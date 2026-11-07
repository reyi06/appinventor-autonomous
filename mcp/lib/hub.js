import { WebSocketServer } from 'ws';

/**
 * WebSocket hub: accepts relay connections from App Inventor editor tabs and
 * correlates tool calls with their responses.
 */
/** Compare dotted versions: true when a >= b. */
function versionAtLeast(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

export function createHub(httpServer, { log = () => {}, remoteFallback = null, expectedRelayVersion = null, originAllowed = null, token = null } = {}) {
  const clients = new Map(); // ws -> meta
  const pending = new Map(); // id -> { resolve, reject, timer, tool }
  let wss = null;
  let seq = 0;

  if (httpServer) {
    wss = new WebSocketServer({ noServer: true });
    // A bind failure surfaces here too; without a listener it becomes an
    // uncaught exception that kills the process.
    wss.on('error', (err) => log(`websocket server error: ${err.message}`));

    // The relay lives in a page on appinventor.mit.edu, so every legitimate
    // connection carries that Origin. Checking it here is what stops any other
    // site the user has open from attaching to the editor.
    httpServer.on('upgrade', (req, socket, head) => {
      const origin = req.headers.origin;
      if (originAllowed && !originAllowed(origin)) {
        log(`refusing websocket from origin ${origin || '(none)'}`);
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });

    attach(wss);
  }

  function attach(server) {
    server.on('connection', (ws, req) => {
    const meta = {
      id: `c${++seq}`,
      ws,
      hello: null,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      remote: req.socket.remoteAddress
    };
    clients.set(ws, meta);
    log(`relay connected (${meta.id}) from ${meta.remote}, total=${clients.size}`);

    ws.on('message', (data) => {
      meta.lastSeen = Date.now();
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        log(`relay parse error: ${e.message}`);
        return;
      }
      if (msg.type === 'hello') {
        // Reject a relay OLDER than the script this server ships (a stale page
        // or a foreign script). A newer relay is still ours: relay.js is served
        // from disk per request, so bumping it does not require a restart.
        if (expectedRelayVersion && !versionAtLeast(msg.version, expectedRelayVersion)) {
          log(`rejecting relay ${meta.id}: version ${msg.version} is older than ${expectedRelayVersion}`);
          try {
            ws.send(JSON.stringify({
              type: 'reject',
              reason: `relay version ${msg.version} is older than ${expectedRelayVersion}; reload the App Inventor tab`
            }));
            ws.close();
          } catch { /* ignore */ }
          clients.delete(ws);
          return;
        }
        meta.hello = { version: msg.version, url: msg.url, project: msg.project, view: msg.view };
        log(`relay hello ${meta.id}: ${msg.project || '?'} @ ${msg.view || '?'} (v${msg.version || '?'})`);
        return;
      }
      if (msg.type === 'result') {
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.ok) entry.resolve(msg.result);
        else entry.reject(new Error(msg.error || 'relay error'));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      log(`relay disconnected (${meta.id}), total=${clients.size}`);
    });

    ws.on('error', (err) => log(`relay socket error (${meta.id}): ${err.message}`));

    try {
      ws.send(JSON.stringify({ type: 'ping' }));
    } catch {
      /* ignore */
    }
    });
  }

  function liveClients() {
    return [...clients.entries()]
      .filter(([ws]) => ws.readyState === 1)
      .map(([, meta]) => meta);
  }

  function pick() {
    const live = liveClients();
    if (live.length === 0) return null;
    // Newest relay build wins, then the most recently active tab.
    // Calls are addressed to a single client, so extra relays never duplicate work.
    live.sort((a, b) => {
      const va = a.hello ? String(a.hello.version || '') : '';
      const vb = b.hello ? String(b.hello.version || '') : '';
      if (va !== vb) return vb.localeCompare(va, undefined, { numeric: true });
      return b.lastSeen - a.lastSeen;
    });
    return live[0];
  }

  /**
   * Send a tool call to a relay tab and await its result.
   * @param {string} tool
   * @param {object} params
   * @param {{timeoutMs?: number, clientId?: string}} [opts]
   */
  function call(tool, params = {}, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 45000;
    const live = liveClients();
    const remote = typeof remoteFallback === 'function' ? remoteFallback() : remoteFallback;
    if (live.length === 0 && remote) {
      return fetch(`${remote}/relay-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ tool, params, timeoutMs })
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok || data.__error) throw Object.assign(new Error(data.__error || `remote relay HTTP ${res.status}`), { code: data.__code || 'REMOTE_ERROR' });
          return data.result;
        })
        .catch((e) => {
          const err = new Error(`No local relay and remote bridge failed: ${e.message}`);
          err.code = 'RELAY_DISCONNECTED';
          throw err;
        });
    }
    if (live.length === 0) {
      const err = new Error(
        'App Inventor relay not connected. Open the App Inventor editor tab and inject the relay (see ai_relay_inject).'
      );
      err.code = 'RELAY_DISCONNECTED';
      return Promise.reject(err);
    }
    const target = opts.clientId ? live.find((c) => c.id === opts.clientId) : pick();
    if (!target) {
      const err = new Error(`Relay client ${opts.clientId} not found`);
      err.code = 'RELAY_NOT_FOUND';
      return Promise.reject(err);
    }

    const id = `t${Date.now().toString(36)}-${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const err = new Error(`Relay timeout after ${timeoutMs}ms for ${tool}`);
        err.code = 'RELAY_TIMEOUT';
        reject(err);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, tool });
      try {
        target.ws.send(JSON.stringify({ type: 'call', id, tool, params }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error(`Failed to send to relay: ${e.message}`));
      }
    });
  }

  function status() {
    return [...clients.values()].map((m) => ({
      id: m.id,
      connected: m.ws.readyState === 1,
      hello: m.hello,
      lastSeen: new Date(m.lastSeen).toISOString()
    }));
  }

  function close() {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Hub closing'));
    }
    pending.clear();
    if (wss) wss.close();
  }

  return { call, status, close, wss, clientCount: () => liveClients().length };
}
