#!/usr/bin/env node
/**
 * appinventor-mcp — MCP server for MIT App Inventor.
 *
 *   npx appinventor-mcp                 start the MCP server on stdio
 *   npx appinventor-mcp --port 8766     choose the relay port
 *   npx appinventor-mcp --print-config  print an MCP client config snippet
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`appinventor-mcp — MCP server for MIT App Inventor

Usage:
  appinventor-mcp [--port N] [--print-config]

Options:
  --port N         Port for the page relay (default 8766, env APPINVENTOR_MCP_PORT)
  --print-config   Print an MCP client configuration snippet and exit

The server speaks MCP over stdio and serves the page relay at
http://127.0.0.1:<port>/relay.js. Attach it to an App Inventor tab with the
bundled browser extension, or by calling ai_relay_inject.`);
  process.exit(0);
}

const portIndex = args.indexOf('--port');
if (portIndex >= 0 && args[portIndex + 1]) {
  process.env.APPINVENTOR_MCP_PORT = args[portIndex + 1];
}

if (args.includes('--print-config')) {
  const serverPath = path.join(__dirname, '..', 'mcp', 'server.js');
  console.log(JSON.stringify({
    mcpServers: {
      appinventor: {
        command: process.execPath,
        args: [serverPath],
        env: { APPINVENTOR_MCP_PORT: process.env.APPINVENTOR_MCP_PORT || '8766' }
      }
    }
  }, null, 2));
  process.exit(0);
}

await import(path.join(__dirname, '..', 'mcp', 'server.js'));
