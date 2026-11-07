import { flatten, toAppInventorColor } from './ir.js';

/**
 * Plan a normalized screen into App Inventor operations. Pure: no I/O.
 *
 * The IR root represents the screen itself, so its children become the screen's
 * top-level components and its style becomes the screen's background.
 */

const PROP_ORDER = [
  'Text', 'Width', 'Height', 'AlignHorizontal', 'AlignVertical',
  'BackgroundColor', 'TextColor', 'FontSize', 'FontBold', 'FontItalic',
  'TextAlignment', 'Shape', 'Picture', 'Visible', 'Hint'
];

export function planScreen(screen) {
  const report = {
    screen: screen.name,
    created: 0,
    mapped: 0,
    approximated: [],
    unsupported: [],
    skipped: []
  };

  const ops = [{ op: 'screen', name: screen.name, title: screen.title, props: screen.props }];
  const spacerCount = {};

  function spacer(parentName, dir, size) {
    const key = parentName || '__screen__';
    spacerCount[key] = (spacerCount[key] || 0) + 1;
    ops.push({
      op: 'spacer',
      parent: parentName,
      name: `Spacer_${spacerCount[key]}`,
      dir,
      size,
      reason: 'arrangement gap'
    });
  }

  function emit(node, parentName) {
    if (node.kind === 'canvas') {
      report.unsupported.push({
        node: node.name,
        reason: 'absolute positioning needs Canvas + ImageSprites; not generated yet'
      });
      report.skipped.push(node.name);
      return;
    }

    ops.push({ op: 'component', type: node.type, name: node.name, parent: parentName });

    for (const [property, value] of Object.entries(sortProps(node.props))) {
      ops.push({ op: 'property', component: node.name, property, value, node: node.name });
    }

    if (node.layout && node.layout.gap > 0) {
      report.approximated.push({
        node: node.name,
        reason: `gap ${node.layout.gap}px rendered as spacer components (App Inventor arrangements have no padding)`
      });
    }

    const dir = node.layout && node.layout.dir === 'horizontal' ? 'horizontal' : 'vertical';
    const gap = node.layout && node.layout.gap > 0 ? node.layout.gap : 0;

    node.children.forEach((child, index) => {
      if (index > 0 && gap) spacer(node.name, dir, gap);
      emit(child, node.name);
    });

    report.mapped++;
  }

  // Root = the screen. Its style becomes the Screen's own properties.
  const rootStyle = screen.root.props || {};
  for (const [property, value] of Object.entries(rootStyle)) {
    if (property === 'BackgroundColor') {
      ops.push({ op: 'property', component: screen.name, property, value, node: screen.name });
    }
  }

  const rootDir = screen.root.layout && screen.root.layout.dir === 'horizontal' ? 'horizontal' : 'vertical';
  const rootGap = screen.root.layout && screen.root.layout.gap > 0 ? screen.root.layout.gap : 0;

  screen.root.children.forEach((child, index) => {
    if (index > 0 && rootGap) spacer(null, rootDir, rootGap);
    emit(child, null);
  });

  report.created = report.mapped;
  report.names = flatten(screen.root).slice(1).map(({ node }) => node.name);
  report.opCount = ops.length;
  return { ops, report };
}

function sortProps(props) {
  const out = {};
  const keys = Object.keys(props);
  keys.sort((a, b) => {
    const ia = PROP_ORDER.indexOf(a);
    const ib = PROP_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  for (const k of keys) out[k] = props[k];
  return out;
}

/** Assets referenced by the screen that are not present in the project. */
export function missingAssets(screen, available) {
  const missing = [];
  for (const { node } of flatten(screen.root)) {
    if (node.asset && available && !available.has(node.asset)) {
      missing.push({ node: node.name, asset: node.asset });
    }
  }
  return missing;
}

/** Plan theme token application for an existing screen. */
export function planTheme(screen, tokens = {}) {
  const notes = [];
  const ops = [];

  const bg = pick(tokens, ['color.background', 'background', 'surface']);
  const fg = pick(tokens, ['color.text', 'text', 'onSurface']);
  const accent = pick(tokens, ['color.primary', 'primary', 'accent']);
  const bodySize = pick(tokens, ['type.body', 'body', 'fontSize']);

  for (const { node } of flatten(screen.root)) {
    const props = {};
    if (node.kind === 'text') {
      if (fg) props.TextColor = safeColor(fg, notes, node.name, 'text colour');
      if (bodySize && !node.props.FontSize) props.FontSize = String(bodySize);
    }
    if (node.kind === 'button') {
      if (accent) props.BackgroundColor = safeColor(accent, notes, node.name, 'button fill');
      if (fg) props.TextColor = safeColor(fg, notes, node.name, 'button text');
    }
    for (const [property, value] of Object.entries(props)) {
      if (value != null) ops.push({ op: 'property', component: node.name, property, value });
    }
  }

  return { ops, notes };
}

function pick(tokens, keys) {
  for (const k of keys) if (tokens[k] != null) return tokens[k];
  return null;
}

function safeColor(value, notes, node, what) {
  try {
    return toAppInventorColor(value);
  } catch (e) {
    notes.push({ level: 'approximated', node, message: `${what} ignored: ${e.message}` });
    return null;
  }
}
