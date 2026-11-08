/**
 * Layout IR — our own source-agnostic model of a screen.
 *
 * Every design source (a JSON spec, a FigCraft frame set, an exported .aia, a brief)
 * is translated INTO this shape. One compiler turns it into App Inventor components.
 * Nothing outside this module may depend on a particular design tool.
 */

export const IR_VERSION = 1;

const KINDS = new Set(['container', 'grid', 'text', 'button', 'image', 'input', 'spacer', 'canvas']);
const DIRECTIONS = new Set(['vertical', 'horizontal', 'absolute']);
const ALIGN = new Set(['start', 'center', 'end', 'stretch', 'space-between', 'spacebetween', 'spacebetween']);

/**
 * Alignment codes, per axis. The two axes do NOT share an order:
 *
 *   AlignHorizontal  1 left, 2 right, 3 center   (GRAVITY_LEFT/RIGHT/CENTER_HORIZONTAL)
 *   AlignVertical    1 top,  2 center, 3 bottom  (GRAVITY_TOP/CENTER_VERTICAL/BOTTOM)
 *
 * Taking "center" to be 2 on both axes right-aligns every centred design, which
 * is why these are separate maps.
 */
const AXIS_CODE = {
  horizontal: { start: '1', left: '1', end: '2', right: '2', center: '3' },
  vertical: { start: '1', top: '1', center: '2', end: '3', bottom: '3' }
};

/** App Inventor TextAlignment codes. */
const TEXT_ALIGN = { left: '0', start: '0', center: '1', right: '2', end: '2' };

/** Default component for each IR kind. */
export const DEFAULT_TYPE = {
  container: null, // depends on layout.dir
  grid: 'TableArrangement',
  text: 'Label',
  button: 'Button',
  image: 'Image',
  input: 'TextBox',
  spacer: 'Label',
  canvas: 'Canvas'
};

export class IrError extends Error {
  constructor(message, path) {
    super(path ? `${path}: ${message}` : message);
    this.code = 'IR_INVALID';
    this.path = path;
  }
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** `#rrggbb`, `#rrggbbaa`, `&H...`, `rgb(...)`, or {r,g,b,a} -> `&HAARRGGBB`. */
export function toAppInventorColor(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'object') {
    const r = clamp255(input.r), g = clamp255(input.g), b = clamp255(input.b);
    const a = input.a == null ? 255 : (input.a <= 1 ? Math.round(input.a * 255) : clamp255(input.a));
    return '&H' + hex(a) + hex(r) + hex(g) + hex(b);
  }
  const s = String(input).trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return '&HFF' + hex(r) + hex(g) + hex(b);
  }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return '&HFF' + m[1].toUpperCase();
  m = s.match(/^#([0-9a-f]{8})$/i);
  if (m) {
    const v = m[1].toUpperCase();
    // #RRGGBBAA -> &HAARRGGBB
    return '&H' + v.slice(6, 8) + v.slice(0, 6);
  }
  m = s.match(/^&H([0-9a-f]{8})$/i);
  if (m) return '&H' + m[1].toUpperCase();
  m = s.match(/^rgb\(?\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return '&HFF' + hex(+m[1]) + hex(+m[2]) + hex(+m[3]);
  throw new IrError(`Unsupported colour: ${s}`);
}

function clamp255(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hex(n) {
  return clamp255(n).toString(16).toUpperCase().padStart(2, '0');
}

/** App Inventor identifiers must start with a letter. */
export function sanitizeIdentifier(raw, fallback) {
  if (!raw) return fallback;
  let s = String(raw).replace(/[^A-Za-z0-9_]/g, '_');
  s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[A-Za-z]/.test(s)) s = fallback + '_' + s;
  if (s.length > 60) s = s.slice(0, 60);
  return s || fallback;
}

/**
 * Normalize a screen spec into { screen, notes }.
 * Throws IrError on anything that cannot be represented at all.
 */
export function normalizeScreen(spec, options = {}) {
  if (!isPlainObject(spec)) throw new IrError('screen spec must be an object');
  const notes = [];

  const name = sanitizeIdentifier(spec.name, 'Screen1');
  if (name !== spec.name) notes.push({ level: 'info', message: `screen name "${spec.name}" sanitized to "${name}"` });

  const rootSpec = spec.root || { kind: 'container', layout: { dir: 'vertical' }, children: [] };
  const counters = {};
  const used = new Set();

  function walk(nodeSpec, path, depth, parent) {
    if (!isPlainObject(nodeSpec)) throw new IrError('node must be an object', path);

    const kind = nodeSpec.kind || inferKind(nodeSpec);
    if (!KINDS.has(kind)) throw new IrError(`unknown node kind "${kind}"`, path);

    const layout = isPlainObject(nodeSpec.layout) ? { ...nodeSpec.layout } : {};
    if (layout.dir && !DIRECTIONS.has(layout.dir)) throw new IrError(`unknown layout.dir "${layout.dir}"`, path);
    for (const key of ['mainAlign', 'crossAlign']) {
      if (layout[key] && !ALIGN.has(layout[key])) throw new IrError(`unknown ${key} "${layout[key]}"`, path);
    }

    const style = isPlainObject(nodeSpec.style) ? { ...nodeSpec.style } : {};
    const font = isPlainObject(style.font) ? style.font : {};

    const type = chooseType(kind, layout, nodeSpec.type);

    // deterministic instance name
    let desired = nodeSpec.name ? sanitizeIdentifier(nodeSpec.name, type) : null;
    if (!desired) {
      counters[type] = (counters[type] || 0) + 1;
      desired = type + counters[type];
    }
    let unique = desired;
    let n = 1;
    while (used.has(unique)) unique = desired + '_' + ++n;
    if (unique !== desired) notes.push({ level: 'info', message: `duplicate name "${desired}" renamed to "${unique}"` });
    used.add(unique);

    const props = buildProps(kind, type, nodeSpec, style, font, layout, notes, path);

    // `stretch` is not an alignment value in App Inventor: it means every child
    // fills the parent's cross axis.
    if (parent && parent.layout && parent.layout.crossAlign === 'stretch') {
      const verticalParent = parent.layout.dir !== 'horizontal';
      const explicitCross = verticalParent ? nodeSpec.width : nodeSpec.height;
      if (!explicitCross && !props.Width && !props.Height) {
        if (verticalParent) props.Width = 'Fill parent';
        else props.Height = 'Fill parent';
      }
    }

    const node = {
      id: nodeSpec.id || null,
      kind,
      type,
      name: unique,
      text: typeof nodeSpec.text === 'string' ? nodeSpec.text : (typeof nodeSpec.characters === 'string' ? nodeSpec.characters : null),
      asset: nodeSpec.asset || null,
      layout,
      style,
      props,
      children: []
    };

    if (node.text && type === 'Label' && !node.props.Text) node.props.Text = node.text;
    if (node.text && type === 'Button' && !node.props.Text) node.props.Text = node.text;

    const kids = Array.isArray(nodeSpec.children) ? nodeSpec.children : [];
    node.children = kids.map((c, i) => walk(c, `${path}.children[${i}]`, depth + 1, node));

    // gaps between auto-layout children become spacer components
    if (layout.gap > 0 && node.children.length > 1 && (layout.dir === 'vertical' || layout.dir === 'horizontal')) {
      notes.push({
        level: 'approximated',
        node: node.name,
        message: `gap ${layout.gap} rendered as spacer components (App Inventor arrangements have no padding)`
      });
    }

    return node;
  }

  const root = walk(rootSpec, 'root', 0, null);

  return {
    screen: {
      name,
      title: spec.title || name,
      props: isPlainObject(spec.props) ? spec.props : {},
      root
    },
    notes
  };
}

function inferKind(node) {
  if (Array.isArray(node.children) && node.children.length) return 'container';
  if (node.asset || node.image) return 'image';
  if (node.role === 'button' || node.button) return 'button';
  if (node.role === 'input' || node.input) return 'input';
  if (node.text != null || node.characters != null) return 'text';
  return 'container';
}

function chooseType(kind, layout, explicit) {
  if (explicit) return explicit;
  if (kind === 'container') {
    if (layout.dir === 'horizontal') return 'HorizontalArrangement';
    if (layout.dir === 'absolute') return 'Canvas';
    return 'VerticalArrangement';
  }
  if (kind === 'grid') return 'TableArrangement';
  return DEFAULT_TYPE[kind];
}

function buildProps(kind, type, spec, style, font, layout, notes, path) {
  const props = isPlainObject(spec.props) ? { ...spec.props } : {};

  if (style.fill) {
    try {
      props.BackgroundColor = toAppInventorColor(style.fill);
    } catch (e) {
      notes.push({ level: 'approximated', node: spec.name || path, message: `fill ignored: ${e.message}` });
    }
  }
  if (style.color) {
    try {
      props.TextColor = toAppInventorColor(style.color);
    } catch (e) {
      notes.push({ level: 'approximated', node: spec.name || path, message: `text colour ignored: ${e.message}` });
    }
  }
  if (font.size) props.FontSize = String(Math.round(Number(font.size)));
  if (font.weight === 'bold' || Number(font.weight) >= 600 || font.bold) props.FontBold = 'True';
  if (font.italic) props.FontItalic = 'True';
  if (style.align && TEXT_ALIGN[style.align] != null) props.TextAlignment = TEXT_ALIGN[style.align];

  // `shape: "rounded"` and `radius: n` both mean the Button.Shape choice; the
  // other shapes App Inventor offers are "default" and "oval".
  if (kind === 'button' && (style.radius || style.shape === 'rounded' || style.shape === 'oval')) {
    props.Shape = style.shape === 'oval' ? 'oval' : 'rounded';
  }

  // sizing
  // An explicit props.Width/Height must win: it is the same field the .scm
  // stores, so a caller that reads a component and hands it back (or a design
  // adapter that already computed a length) would otherwise have its value
  // silently replaced by the default for its kind.
  const width = normalizeSize(spec.width ?? style.width ?? layout.width ?? props.Width);
  const height = normalizeSize(spec.height ?? style.height ?? layout.height ?? props.Height);

  if (kind === 'text' || kind === 'input') {
    props.Width = width || 'Fill parent';
  } else if (kind === 'button') {
    props.Width = width || 'Automatic';
    props.Height = height || 'Automatic';
  } else if (kind === 'image') {
    props.Width = width || 'Automatic';
    props.Height = height || 'Automatic';
  } else if (kind === 'container') {
    props.Width = width || 'Fill parent';
    props.Height = height || 'Automatic';
  }

  if (kind === 'container' || kind === 'grid') {
    // main/cross axis depends on the container's direction:
    //   vertical  -> AlignVertical is main, AlignHorizontal is cross
    //   horizontal-> AlignHorizontal is main, AlignVertical is cross
    const vertical = layout.dir !== 'horizontal';
    const main = AXIS_CODE[vertical ? 'vertical' : 'horizontal'][String(layout.mainAlign || '').toLowerCase()];
    const cross = AXIS_CODE[vertical ? 'horizontal' : 'vertical'][String(layout.crossAlign || '').toLowerCase()];

    if (vertical) {
      if (main) props.AlignVertical = main;
      if (cross) props.AlignHorizontal = cross;
    } else {
      if (main) props.AlignHorizontal = main;
      if (cross) props.AlignVertical = cross;
    }

    if (kind === 'grid') {
      const cols = Number(layout.columns || spec.columns || 2);
      const rows = Number(layout.rows || spec.rows || 2);
      props.Columns = String(Math.max(1, cols));
      props.Rows = String(Math.max(1, rows));
    }
  }

  if (kind === 'spacer') {
    props.Visible = 'False';
    props.Width = width || '0';
    props.Height = height || '0';
    props.Text = '';
    delete props.BackgroundColor;
  }

  if (kind === 'image' && (spec.asset || spec.image)) props.Picture = spec.asset || spec.image;

  return props;
}

function normalizeSize(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return String(Math.round(v));
  const s = String(v).trim();
  if (/^(fill|fill parent|fill_parent)$/i.test(s)) return 'Fill parent';
  if (/^(auto|automatic)$/i.test(s)) return 'Automatic';
  if (/^\d+(\.\d+)?%$/.test(s)) return String(-1000 - Math.round(parseFloat(s)));
  if (/^\d+(\.\d+)?(px|dp)?$/.test(s)) return String(Math.round(parseFloat(s)));
  return null;
}

/** Flatten an IR tree to a list with parents, for planning and reporting. */
export function flatten(root) {
  const out = [];
  (function walk(node, parent) {
    out.push({ node, parent });
    for (const c of node.children || []) walk(c, node);
  })(root, null);
  return out;
}

/** Turn a normalized screen into a comparable signature (used for plan hashing). */
export function screenSignature(screen) {
  return JSON.stringify({ name: screen.name, root: screen.root });
}
