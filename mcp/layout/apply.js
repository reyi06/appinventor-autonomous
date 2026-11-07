/**
 * Execute a layout plan against the live editor.
 *
 * Every step goes through the same verified tools the agent uses by hand, so a
 * compiled screen is indistinguishable from a hand-built one. Property writes
 * that this App Inventor build cannot automate (colour and other GWT
 * DropDownButton editors) become approximations, never silent successes.
 */
export async function applyPlan(ops, ctx) {
  const { addScreen, addComponent, setProperty, log = () => {} } = ctx;

  const applied = { screens: [], components: [], properties: 0, spacers: 0 };
  const approximations = [];
  const failures = [];
  const spacerNames = [];

  for (const op of ops) {
    if (op.op === 'screen') {
      try {
        await addScreen(op.name, op.title, op.props);
        applied.screens.push(op.name);
      } catch (e) {
        failures.push({ op: 'screen', name: op.name, error: e.message });
        throw new Error(`Cannot create screen "${op.name}": ${e.message}`);
      }
      continue;
    }

    if (op.op === 'component') {
      try {
        await addComponent(op.type, op.name, op.parent);
        applied.components.push({ name: op.name, type: op.type, parent: op.parent });
      } catch (e) {
        failures.push({ op: 'component', name: op.name, error: e.message });
        throw new Error(`Cannot add ${op.type} "${op.name}": ${e.message}`);
      }
      continue;
    }

    if (op.op === 'spacer') {
      try {
        const name = op.name || `Spacer_${applied.spacers + 1}`;
        await addComponent('Label', name, op.parent);
        await setProperty(name, 'Text', '');
        if (op.fill) {
          // A Fill parent spacer absorbs the leftover space: App Inventor has no
          // space-between, so this is how distribution is expressed.
          if (op.dir === 'horizontal') await setProperty(name, 'Width', 'Fill parent');
          else await setProperty(name, 'Height', 'Fill parent');
        } else if (op.dir === 'horizontal') {
          await setProperty(name, 'Width', String(op.size));
        } else {
          await setProperty(name, 'Height', String(op.size));
        }
        spacerNames.push(name);
        applied.spacers++;
      } catch (e) {
        approximations.push({ kind: 'spacer', component: op.name || null, parent: op.parent, reason: e.message });
      }
      continue;
    }

    if (op.op === 'property') {
      try {
        await setProperty(op.component, op.property, op.value);
        applied.properties++;
      } catch (e) {
        approximations.push({
          kind: 'property',
          component: op.component,
          property: op.property,
          value: op.value,
          reason: e.message
        });
      }
      continue;
    }

    approximations.push({ kind: 'unknown_op', op });
  }

  // Hide spacers only after everything is placed: an invisible component cannot
  // receive the palette drop that the next sibling needs.
  for (const name of spacerNames) {
    try {
      await setProperty(name, 'Visible', 'False');
    } catch (e) {
      approximations.push({ kind: 'spacer-visibility', component: name, reason: e.message });
    }
  }

  log(`applied ${applied.components.length} components, ${applied.properties} properties, ${approximations.length} approximated`);

  return { applied, approximations, failures };
}
