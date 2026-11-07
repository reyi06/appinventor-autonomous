/**
 * `.bky` (Blockly workspace) scanning, shared by `ai_validate` and the offline
 * corpus test so the two cannot drift apart.
 *
 * App Inventor changed block serialisation in 2018:
 *   legacy  <block type="SubmitButton_Click"><title name="VAR">…</title>
 *   modern  <block type="component_event"><mutation instance_name=… event_name=…>
 * The live editor upgrades legacy files on import, so checks here only apply to
 * the modern shape.
 */

export function isLegacyBky(xml) {
  const text = String(xml || '');
  return /<title name=/.test(text) && !/<field name=/.test(text);
}

export function scanBky(xml) {
  const text = String(xml || '');
  const legacy = isLegacyBky(text);

  const instanceRefs = [...new Set(
    [...text.matchAll(/instance_name="([^"]+)"/g)].map((m) => m[1])
  )];

  const blockTypes = [...new Set(
    [...text.matchAll(/<block[^>]*type="([^"]+)"/g)].map((m) => m[1])
  )];

  const blockCount = (text.match(/<block /g) || []).length;

  // A global is declared once with a bare NAME field…
  const globals = new Set(
    [...text.matchAll(/<block[^>]*type="global_declaration"[^>]*>[\s\S]{0,400}?<field name="NAME">([^<]*)</g)]
      .map((m) => m[1])
  );

  // …and referenced as `global <name>`. Procedure parameters and loop variables
  // are declared locally and referenced bare.
  const locals = new Set(
    [...text.matchAll(/<block[^>]*type="local_declaration_(?:statement|expression)"[^>]*>[\s\S]{0,400}?<field name="VAR">([^<]*)</g)]
      .map((m) => m[1])
  );

  const varRefs = [...text.matchAll(/<field name="VAR">([^<]*)</g)].map((m) => m[1]);

  const events = [...text.matchAll(/<block[^>]*type="component_event"[^>]*>([\s\S]*?)<\/mutation>/g)]
    .map((m) => {
      const mut = m[1];
      return {
        instance: (mut.match(/instance_name="([^"]*)"/) || [])[1] || null,
        componentType: (mut.match(/component_type="([^"]*)"/) || [])[1] || null,
        event: (mut.match(/event_name="([^"]*)"/) || [])[1] || null
      };
    });

  const duplicateHandlers = [];
  const seen = new Map();
  for (const e of events) {
    const key = `${e.instance}.${e.event}`;
    if (seen.has(key)) duplicateHandlers.push(key);
    seen.set(key, true);
  }

  return {
    legacy,
    blockCount,
    blockTypes,
    instanceRefs,
    globals,
    locals,
    varRefs,
    variableRefs: [...new Set(varRefs)],
    events,
    duplicateHandlers
  };
}

/** Variables referenced as global that are never declared as one. */
export function undeclaredGlobals(scan) {
  return [...new Set(
    scan.varRefs
      .filter((v) => v.startsWith('global '))
      .map((v) => v.slice('global '.length))
  )].filter((v) => !scan.globals.has(v));
}

/** Globals declared but referenced without the required `global ` prefix. */
export function globalsMissingPrefix(scan) {
  return [...scan.globals].filter((name) => !scan.locals.has(name) && scan.varRefs.includes(name));
}
