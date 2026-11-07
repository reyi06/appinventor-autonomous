/** MIT App Inventor project format helpers (.aia / .scm / .bky / project.properties). */

const SCM_HEADER = '#|\n$JSON\n';
const SCM_FOOTER = '\n|#';

/** Parse a `.scm` designer file into its JSON form document. */
export function parseScm(text) {
  const start = text.indexOf('$JSON\n');
  if (start < 0) throw new Error('Not an .scm file: $JSON marker missing');
  const body = text.slice(start + '$JSON\n'.length);
  const end = body.lastIndexOf('|#');
  const json = end >= 0 ? body.slice(0, end) : body;
  return JSON.parse(json);
}

/** Serialise a form document back to `.scm` text. */
export function serializeScm(doc) {
  return SCM_HEADER + JSON.stringify(doc) + SCM_FOOTER;
}

/** Parse `project.properties` (simple key=value lines). */
export function parseProperties(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** Serialise a properties map (stable key order). */
export function serializeProperties(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

/**
 * Normalise an SCM component node into a neutral tree node.
 * Keeps every designer property so callers can diff/repair the project.
 */
export function componentNode(props) {
  const out = {
    name: props.$Name,
    type: props.$Type,
    version: props.$Version,
    uuid: props.Uuid,
    properties: {},
    children: []
  };
  const reserved = new Set(['$Name', '$Type', '$Version', '$Components', 'Uuid']);
  for (const [k, v] of Object.entries(props)) {
    if (!reserved.has(k)) out.properties[k] = v;
  }
  for (const child of props.$Components || []) out.children.push(componentNode(child));
  return out;
}

/** Walk a component tree, calling fn(node, parent). */
export function walkComponents(node, fn, parent = null) {
  fn(node, parent);
  for (const child of node.children || []) walkComponents(child, fn, node);
}

/** Flatten a component tree into a list with parent names. */
export function flattenComponents(root) {
  const out = [];
  walkComponents(root, (node, parent) => {
    out.push({ name: node.name, type: node.type, parent: parent ? parent.name : null, properties: node.properties });
  });
  return out;
}

/** Find a component node by name (depth-first). */
export function findComponent(root, name) {
  if (root.name === name) return root;
  for (const child of root.children || []) {
    const hit = findComponent(child, name);
    if (hit) return hit;
  }
  return null;
}

/** List screen metadata from an unpacked .aia file map. */
export function listScreens(files) {
  const screens = [];
  for (const [path, buf] of files) {
    const m = path.match(/^src\/appinventor\/(ai_[^/]+)\/([^/]+)\/(.+)\.scm$/);
    if (!m) continue;
    screens.push({
      screen: m[3],
      project: m[2],
      userPackage: m[1],
      path,
      hasBlocks: files.has(path.replace(/\.scm$/, '.bky')),
      hasYail: files.has(path.replace(/\.scm$/, '.yail'))
    });
  }
  screens.sort((a, b) => (a.screen === 'Screen1' ? -1 : b.screen === 'Screen1' ? 1 : a.screen.localeCompare(b.screen)));
  return screens;
}

/** Directory inside the .aia that holds source for a project. */
export function sourceDir(files) {
  for (const path of files.keys()) {
    const m = path.match(/^src\/appinventor\/(ai_[^/]+)\/([^/]+)\//);
    if (m) return `src/appinventor/${m[1]}/${m[2]}`;
  }
  return null;
}
