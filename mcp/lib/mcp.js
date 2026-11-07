/** Minimal MCP (Model Context Protocol) stdio server: newline-delimited JSON-RPC 2.0. */

export function createMcpServer({ name, version, tools, prompts = null, resources = null, log = () => {} }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  let initialised = false;

  function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  function ok(id, result) {
    send({ jsonrpc: '2.0', id, result });
  }

  function fail(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async function handle(msg) {
    const { id, method, params } = msg;

    if (method === 'initialize') {
      initialised = true;
      return ok(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
          prompts: prompts ? { listChanged: false } : undefined,
          resources: resources ? { listChanged: false } : undefined
        },
        serverInfo: { name, version }
      });
    }

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return undefined;
    }

    if (method === 'ping') return ok(id, {});

    if (method === 'tools/list') {
      return ok(id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema || { type: 'object', properties: {} }
        }))
      });
    }

    if (method === 'tools/call') {
      const tool = byName.get(params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.handler(params?.arguments || {});
        const isError = !!(result && result.__isError);
        const payload = isError ? result.data : result;
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          isError
        });
      } catch (err) {
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message, code: err.code || 'TOOL_ERROR' }, null, 2) }],
          isError: true
        });
      }
    }

    if (method === 'prompts/list') {
      if (!prompts) return fail(id, -32601, 'Prompts are not supported by this server build');
      return ok(id, { prompts: prompts.list() });
    }

    if (method === 'prompts/get') {
      if (!prompts) return fail(id, -32601, 'Prompts are not supported by this server build');
      try {
        const result = await prompts.get(params?.name, params?.arguments || {});
        return ok(id, result);
      } catch (err) {
        return fail(id, -32602, err.message);
      }
    }

    if (method === 'resources/list') {
      if (!resources) return ok(id, { resources: [] });
      return ok(id, { resources: resources.list() });
    }

    if (method === 'resources/read') {
      if (!resources) return fail(id, -32601, 'Resources are not supported by this server build');
      try {
        const res = await resources.read(params?.uri);
        return ok(id, {
          contents: [{ uri: res.uri, mimeType: res.mimeType, text: res.text }]
        });
      } catch (err) {
        return fail(id, -32602, err.message);
      }
    }

    if (id !== undefined) return fail(id, -32601, `Method not found: ${method}`);
    return undefined;
  }

  let buffer = '';
  if (process.env.APPINVENTOR_MCP_NO_STDIN === '1') return { handle, isInitialised: () => initialised };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        log(`invalid JSON-RPC line: ${e.message}`);
        continue;
      }
      Promise.resolve()
        .then(() => handle(msg))
        .catch((err) => {
          log(`handler error: ${err.stack || err.message}`);
          if (msg && msg.id !== undefined) fail(msg.id, -32603, err.message);
        });
    }
  });

  process.stdin.on('end', () => process.exit(0));

  return { handle, isInitialised: () => initialised };
}
