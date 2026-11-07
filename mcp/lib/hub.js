import { WebSocketServer } from 'ws';

/**
 * WebSocket hub: accepts relay connections from App Inventor editor tabs and
 * correlates tool calls with their responses.
 */
export function createHub(httpServer, { log = () => {}, remoteFallback = null } = {}) {
  const clients = new Map(); // ws -> meta
  const pending = new Map(); // id -> { resolve, reject, timer, tool }
  let wss = null;
  let seq = 0;

  if (httpServer) {
    wss = new WebSocketServer({ server: httpServer });
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
        meta.hello = { version: msg.version, url: msg.url, project: msg.project, view: msg.view };
        log(`relay hello ${meta.id}: ${msg.project || '?'} @ ${msg.view || '?'}`);
        // Drop older relays for the same tab so a command never runs twice.
        for (const [otherWs, other] of clients) {
          if (otherWs === ws) continue;
          if (other.hello && other.hello.url === msg.url) {
            log(`closing stale relay ${other.id} (same tab as ${meta.id})`);
            clients.delete(otherWs);
            try { otherWs.close(); } catch { /* ignore */ }
          }
        }
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
    // Prefer a tab that has completed the handshake most recently.
    live.sort((a, b) => (b.hello ? b.lastSeen : 0) - (a.hello ? a.lastSeen : 0));
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
        headers: { 'Content-Type': 'application/json' },
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
