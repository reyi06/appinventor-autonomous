#!/usr/bin/env node
/**
 * Layout IR tests: the compiler's sizing, alignment and naming rules.
 *
 * Pure functions — no browser, no editor. This is the subsystem a live test
 * cannot cover cheaply (a wrong alignment code just looks slightly off), and it
 * is where a silent default can quietly resize a component.
 */
import { normalizeScreen, IrError, toAppInventorColor, flatten } from '../mcp/layout/ir.js';
import { planScreen } from '../mcp/layout/plan.js';

const checks = [];
const check = (ok, name, detail) => checks.push({ ok: !!ok, name, detail });

function props(spec, path = []) {
  return normalizeScreen(spec);
}

function propOf(screen, name) {
  const all = flatten(screen.root);
  const hit = all.find(({ node }) => node.name === name);
  return hit ? hit.node.props : null;
}

// --- naming ---------------------------------------------------------------

{
  const { screen } = props({ name: 'Screen1', root: { kind: 'container', children: [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }] } });
  check(screen.root.children[0].name === 'Label1', 'unnamed text nodes get deterministic names', screen.root.children[0].name);
  check(screen.root.children[1].name === 'Label2', 'the counter keeps increasing');
}

{
  const { screen, notes } = props({ name: 'Screen1', root: { kind: 'container', children: [
    { kind: 'text', name: 'Dup', text: 'a' },
    { kind: 'text', name: 'Dup', text: 'b' }
  ] } });
  const names = screen.root.children.map((c) => c.name);
  check(names[0] === 'Dup' && names[1] === 'Dup_2', 'duplicate names are renamed', names.join(', '));
  check(notes.some((n) => /duplicate name/.test(n.message)), 'the rename is reported');
}

{
  const { screen, notes } = props({ name: 'my screen!', root: { kind: 'container' } });
  check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(screen.name), 'invalid identifiers are sanitized', screen.name);
  check(notes.some((n) => /sanitized/.test(n.message)), 'sanitizing is reported');
}

// --- sizing ---------------------------------------------------------------

{
  // Regression: props.Width was replaced by the kind default, so a caller that
  // supplied 72 got Automatic and nothing said so.
  const { screen } = props({ name: 'Screen1', root: { kind: 'container', children: [
    { kind: 'image', name: 'Logo', asset: 'logo.png', props: { Width: '72', Height: '72' } },
    { kind: 'button', name: 'Go', text: 'Go', props: { Width: 'Fill parent', Height: '52' } }
  ] } });
  check(propOf(screen, 'Logo').Width === '72', 'image keeps props.Width', propOf(screen, 'Logo').Width);
  check(propOf(screen, 'Logo').Height === '72', 'image keeps props.Height');
  check(propOf(screen, 'Go').Width === 'Fill parent', 'button keeps props.Width', propOf(screen, 'Go').Width);
  check(propOf(screen, 'Go').Height === '52', 'button keeps props.Height', propOf(screen, 'Go').Height);
}

{
  const { screen } = props({ name: 'Screen1', root: { kind: 'container', children: [
    { kind: 'text', name: 'T', text: 'x' },
    { kind: 'input', name: 'I' },
    { kind: 'container', name: 'C', layout: { dir: 'vertical' } },
    { kind: 'button', name: 'B', text: 'b' }
  ] } });
  check(propOf(screen, 'T').Width === 'Fill parent', 'labels default to full width');
  check(propOf(screen, 'I').Width === 'Fill parent', 'inputs default to full width');
  check(propOf(screen, 'C').Height === 'Automatic', 'containers default to automatic height');
  check(propOf(screen, 'B').Width === 'Automatic', 'buttons default to automatic width');
}

{
  const { screen } = props({ name: 'Screen1', root: { kind: 'container', children: [
    { kind: 'text', name: 'Half', text: 'x', width: '50%' },
    { kind: 'text', name: 'Px', text: 'x', width: '120px' },
    { kind: 'text', name: 'Named', text: 'x', props: { Width: '60%' } }
  ] } });
  check(propOf(screen, 'Half').Width === '-1050', 'percent width encodes as -1000-n', propOf(screen, 'Half').Width);
  check(propOf(screen, 'Px').Width === '120', 'px suffix is stripped', propOf(screen, 'Px').Width);
  check(propOf(screen, 'Named').Width === '-1060', 'percent in props is encoded too', propOf(screen, 'Named').Width);
}

// --- alignment ------------------------------------------------------------

{
  const { screen } = props({ name: 'Screen1', root: { kind: 'container', layout: { dir: 'vertical', mainAlign: 'center', crossAlign: 'end' } } });
  const root = screen.root.props;
  check(root.AlignVertical === '2', 'vertical container: mainAlign center is AlignVertical 2', root.AlignVertical);
  check(root.AlignHorizontal === '2', 'vertical container: crossAlign end is AlignHorizontal 2 (right)', root.AlignHorizontal);

  // The axes do not share an order: horizontal is 1 left, 2 right, 3 center.
  const { screen: h } = props({ name: 'Screen1', root: { kind: 'container', layout: { dir: 'horizontal', mainAlign: 'center', crossAlign: 'center' } } });
  check(h.root.props.AlignHorizontal === '3', 'horizontal container: mainAlign center is AlignHorizontal 3', h.root.props.AlignHorizontal);
  check(h.root.props.AlignVertical === '2', 'horizontal container: crossAlign center is AlignVertical 2', h.root.props.AlignVertical);

  const { screen: sb } = props({ name: 'Screen1', root: { kind: 'container', layout: { dir: 'horizontal', mainAlign: 'space-between' } } });
  check(sb.root.props.AlignHorizontal === undefined, 'space-between is not an App Inventor alignment code');
}

{
  let threw = null;
  try {
    props({ name: 'Screen1', root: { kind: 'nope' } });
  } catch (e) {
    threw = e;
  }
  check(threw instanceof IrError && threw.code === 'IR_INVALID', 'unknown kind is rejected with IR_INVALID');
}

// --- style ----------------------------------------------------------------

{
  check(toAppInventorColor('#3D5AFE') === '&HFF3D5AFE', 'colour hex to ARGB', toAppInventorColor('#3D5AFE'));
  check(toAppInventorColor('#3D5AFE80') === '&H803D5AFE', 'alpha is preserved', toAppInventorColor('#3D5AFE80'));
  check(toAppInventorColor({ r: 1, g: 2, b: 3, a: 1 }) === '&HFF010203', 'object colour');
}

{
  const { screen } = props({ name: 'Screen1', root: { kind: 'container', children: [
    { kind: 'button', name: 'B', text: 'b', style: { fill: '#3D5AFE', color: '#FFFFFF', shape: 'rounded', font: { size: 18, weight: 'bold' } } },
    { kind: 'text', name: 'T', text: 't', style: { color: '#6B7280', align: 'center', font: { size: 13.6 } } }
  ] } });
  const b = propOf(screen, 'B');
  check(b.BackgroundColor === '&HFF3D5AFE', 'style.fill lands on BackgroundColor', b.BackgroundColor);
  check(b.TextColor === '&HFFFFFFFF', 'style.color lands on TextColor');
  check(b.Shape === 'rounded', 'style.shape lands on Shape', b.Shape);
  check(b.FontSize === '18' && b.FontBold === 'True', 'font size and weight');
  const t = propOf(screen, 'T');
  check(t.TextAlignment === '1', 'style.align center is TextAlignment 1', t.TextAlignment);
  check(t.FontSize === '14', 'font size is rounded', t.FontSize);
}

// --- planning -------------------------------------------------------------

{
  const { screen } = props({ name: 'Screen1', title: 'T', root: { kind: 'container', layout: { dir: 'vertical', gap: 14 }, children: [
    { kind: 'text', name: 'A', text: 'a' },
    { kind: 'text', name: 'B', text: 'b' }
  ] } });
  const plan = planScreen(screen);
  const ops = plan.ops || plan;
  const spacers = (Array.isArray(ops) ? ops : []).filter((o) => o.op === 'spacer');
  check(spacers.length >= 1, 'a gap becomes spacer components', `${spacers.length} spacers`);
}

{
  const { screen } = props({ name: 'Screen1', root: { kind: 'container', layout: { dir: 'vertical', crossAlign: 'stretch' }, children: [
    { kind: 'text', name: 'A', text: 'a' }
  ] } });
  const a = propOf(screen, 'A');
  check(a.Width === 'Fill parent', 'crossAlign stretch fills the cross axis', a.Width);
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
