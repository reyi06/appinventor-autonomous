import fs from 'node:fs/promises';
import path from 'node:path';
import { readZip } from './lib/zip.js';
import { parseScm, componentNode, flattenComponents } from './lib/scm.js';

/**
 * MCP resources: read-only documents a client can pull without a tool call.
 * Static docs come from docs/; live resources are read from the connected editor.
 */

const DOC_TOPICS = [
  { topic: 'architecture', description: 'How the server, relay and editor fit together' },
  { topic: 'mcp-tools', description: 'Every tool and what it is for' },
  { topic: 'designer', description: 'Designer automation: add/remove/rename/properties/screens' },
  { topic: 'blocks', description: 'Blockly authoring rules and recipes' },
  { topic: 'build-and-test', description: 'Compiling and device testing' },
  { topic: 'troubleshooting', description: 'Failure catalogue and release-drift checks' }
];

export function createResources({ rootDir, hub }) {
  const docsDir = path.join(rootDir, 'docs');

  function list() {
    const out = DOC_TOPICS.map((d) => ({
      uri: `appinventor://docs/${d.topic}`,
      name: `docs/${d.topic}`,
      description: d.description,
      mimeType: 'text/markdown'
    }));

    out.push(
      { uri: 'appinventor://catalog/components', name: 'component catalog', description: 'Component types, events, methods and properties from the live editor', mimeType: 'application/json' },
      { uri: 'appinventor://project/tree', name: 'current project tree', description: 'Component tree of the open project, read from the saved .scm', mimeType: 'application/json' },
      { uri: 'appinventor://project/blocks', name: 'current workspace blocks', description: 'Blockly XML of the active screen', mimeType: 'application/xml' },
      { uri: 'appinventor://state', name: 'editor state', description: 'Live project/view/selection/component report', mimeType: 'application/json' }
    );

    return out;
  }

  async function read(uri) {
    if (uri.startsWith('appinventor://docs/')) {
      const topic = uri.slice('appinventor://docs/'.length);
      if (!DOC_TOPICS.some((d) => d.topic === topic)) throw new Error(`Unknown doc: ${topic}`);
      const text = await fs.readFile(path.join(docsDir, `${topic}.md`), 'utf8');
      return { uri, mimeType: 'text/markdown', text };
    }

    if (uri === 'appinventor://catalog/components') {
      const catalog = await hub.call('blocks.catalog', {}, { timeoutMs: 60000 });
      return { uri, mimeType: 'application/json', text: JSON.stringify(catalog, null, 2) };
    }

    if (uri === 'appinventor://state') {
      const state = await hub.call('state', {}, { timeoutMs: 30000 });
      return { uri, mimeType: 'application/json', text: JSON.stringify(state, null, 2) };
    }

    if (uri === 'appinventor://project/blocks') {
      const blocks = await hub.call('blocks.get', { format: 'xml' }, { timeoutMs: 60000 });
      return { uri, mimeType: 'application/xml', text: blocks.xml };
    }

    if (uri === 'appinventor://project/tree') {
      const exported = await hub.call('project.exportAia', {}, { timeoutMs: 60000 });
      const files = readZip(Buffer.from(exported.base64, 'base64'));
      const screens = [];
      for (const [name, buf] of files) {
        if (!name.endsWith('.scm')) continue;
        const doc = parseScm(buf.toString('utf8'));
        const root = componentNode(doc.Properties);
        screens.push({
          screen: root.name,
          components: flattenComponents(root).length,
          tree: root
        });
      }
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ project: exported.projectName, projectId: exported.projectId, screens }, null, 2)
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  }

  return { list, read };
}
