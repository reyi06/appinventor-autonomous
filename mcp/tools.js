import fs from 'node:fs/promises';
import path from 'node:path';
import { readZip, writeZip } from './lib/zip.js';
import * as adb from './lib/adb.js';
import {
  parseScm, serializeScm, parseProperties, serializeProperties,
  componentNode, flattenComponents, findComponent, listScreens, sourceDir
} from './lib/scm.js';

const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/** Build the tool registry. ctx = { hub, workDir } */
export function createTools(ctx) {
  const { hub, workDir } = ctx;

  const exportDir = path.join(workDir, 'exports');
  const buildDir = path.join(workDir, 'builds');

  async function ensureDirs() {
    await fs.mkdir(exportDir, { recursive: true });
    await fs.mkdir(buildDir, { recursive: true });
  }

  function call(tool, params, timeoutMs) {
    return hub.call(tool, params, { timeoutMs });
  }

  /** Export the live project as an .aia and unpack it in memory. */
  async function fetchProject() {
    await ensureDirs();
    const res = await call('project.exportAia', {}, 60000);
    const buf = Buffer.from(res.base64, 'base64');
    const files = readZip(buf);
    return { buf, files, projectId: res.projectId, projectName: res.projectName };
  }

  async function saveExport(buf, projectName, suffix = '') {
    await ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(exportDir, `${projectName}${suffix}-${stamp}.aia`);
    await fs.writeFile(file, buf);
    return file;
  }

  function screenFile(files, screen = 'Screen1') {
    for (const p of files.keys()) {
      if (p.endsWith(`/${screen}.scm`)) return p;
    }
    return null;
  }

  function readForm(files, screen) {
    const p = screenFile(files, screen);
    if (!p) return null;
    return { path: p, doc: parseScm(files.get(p).toString('utf8')) };
  }

  async function downloadToFile(url, dir, suggestedName) {
    await fs.mkdir(dir, { recursive: true });
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const disposition = res.headers.get('content-disposition') || '';
    const m = disposition.match(/filename="?([^";]+)"?/);
    const name = (m && m[1]) || suggestedName;
    const file = path.join(dir, name);
    await fs.writeFile(file, buf);
    return { file, bytes: buf.length, contentType: res.headers.get('content-type') };
  }

  /* --------------------------------------------------------------- tools */

  const tools = [];
  const add = (t) => { tools.push(t); return t; };

  add({
    name: 'ai_status',
    description: 'Check whether the App Inventor relay is connected, which project/screen tab is live, and how to inject the relay.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const clients = hub.status();
      const connected = clients.filter((c) => c.connected).length;
      return {
        ok: connected > 0,
        connectedTabs: connected,
        clients,
        workDir,
        hint: connected === 0
          ? 'Run ai_relay_inject and execute the returned script in the App Inventor editor tab.'
          : 'Relay ready.'
      };
    }
  });

  add({
    name: 'ai_relay_inject',
    description: 'Return the one-line script that attaches the App Inventor editor tab to this MCP server, plus how to run it.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'Relay host port (default 8766)' }
      }
    },
    handler: async ({ port = 8766 } = {}) => {
      const snippet =
        `(function(){var s=document.createElement('script');` +
        `s.src='http://127.0.0.1:${port}/relay.js?ts='+Date.now();` +
        `s.onload=function(){s.remove()};document.head.appendChild(s);})()`;
      return {
        url: `http://127.0.0.1:${port}/relay.js`,
        snippet,
        bookmarklet: `javascript:${snippet}`,
        howTo: [
          '1. Open the App Inventor editor tab (ai2a.appinventor.mit.edu or ai2.appinventor.mit.edu) with your project open.',
          '2. Run the snippet in the browser context (browser tool evaluate, DevTools console, or the bookmarklet).',
          '3. Call ai_status to confirm the relay is connected.',
          'The relay dies on page reload; re-run the snippet after navigation.'
        ]
      };
    }
  });

  add({
    name: 'ai_state',
    description: 'Live state of the open editor: project, view (designer/blocks), selected component, component list, block counts.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => call('state')
  });

  add({
    name: 'ai_project_info',
    description: 'Project name, numeric project id, editor URL and signed-in account.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => call('project.info')
  });

  add({
    name: 'ai_project_export',
    description: 'Export the live project as an editable .aia and save it locally. Returns the file path, screens, and component counts.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Optional absolute destination path. Defaults to <workDir>/exports.' }
      }
    },
    handler: async ({ file } = {}) => {
      const { buf, files, projectName } = await fetchProject();
      let outFile;
      if (file) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, buf);
        outFile = file;
      } else {
        outFile = await saveExport(buf, projectName);
      }
      const screens = listScreens(files);
      const counts = {};
      for (const s of screens) {
        const form = readForm(files, s.screen);
        if (form) {
          const root = componentNode(form.doc.Properties);
          counts[s.screen] = flattenComponents(root).length;
        }
      }
      return {
        ok: true,
        file: outFile,
        bytes: buf.length,
        projectName,
        screens: screens.map((s) => s.screen),
        componentCounts: counts,
        assetCount: [...files.keys()].filter((k) => k.startsWith('assets/')).length
      };
    }
  });

  add({
    name: 'ai_project_import',
    description: 'Import a local .aia file into App Inventor as a new project (overwrites a project of the same name on the server).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path to the .aia file' },
        name: { type: 'string', description: 'Target project name (defaults to the file base name)' }
      },
      required: ['file']
    },
    handler: async ({ file, name }) => {
      const buf = await fs.readFile(file);
      const projectName = name || path.basename(file, '.aia');
      const res = await call('project.importAia', {
        name: projectName,
        base64: buf.toString('base64')
      }, 120000);
      return {
        ok: !!res.success,
        projectName,
        projectId: res.projectId,
        status: res.status,
        note: res.success
          ? `Project ${projectName} imported (id ${res.projectId}). Open it with ai_project_open.`
          : `Import failed: ${res.raw}`
      };
    }
  });

  add({
    name: 'ai_project_create',
    description: 'Create a new blank App Inventor project by generating a minimal .aia and importing it. Leaves all other projects untouched.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'New project name (letters, digits, underscore)' },
        title: { type: 'string', description: 'Screen1 title (defaults to the project name)' }
      },
      required: ['name']
    },
    handler: async ({ name, title }) => {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
        throw new Error('Project name must start with a letter and contain only letters, digits, underscore');
      }
      // Learn the account package prefix + current Form version from the open project.
      let userPackage = null;
      let formVersion = '32';
      try {
        const { files } = await fetchProject();
        const dir = sourceDir(files);
        if (dir) userPackage = dir.split('/')[2];
        const form = readForm(files, 'Screen1');
        if (form && form.doc.Properties.$Version) formVersion = form.doc.Properties.$Version;
      } catch {
        /* no project open - fall back to a default package */
      }
      if (!userPackage) {
        throw new Error('Open any App Inventor project first so the account package name can be detected, or pass no project.');
      }

      const screen = 'Screen1';
      const scm = {
        authURL: ['ai2.appinventor.mit.edu'],
        YaVersion: '233',
        Source: 'Form',
        Properties: {
          $Name: screen,
          $Type: 'Form',
          $Version: formVersion,
          AppName: name,
          Title: title || name,
          Uuid: '0',
          Sizing: 'Responsive',
          Theme: 'Classic',
          $Components: []
        }
      };

      const files = [
        {
          name: 'youngandroidproject/project.properties',
          data: serializeProperties({
            main: `${userPackage.replace(/^ai_/, 'appinventor.')}.${name}.Screen1`.replace(/_/g, '.'),
            name,
            assets: '../assets',
            source: '../src',
            build: '../build',
            versioncode: '1',
            versionname: '1.0',
            useslocation: 'False',
            aname: name,
            sizing: 'Responsive',
            showlistsasjson: 'True',
            actionbar: 'False',
            theme: 'Classic',
            'color.primary': '&HFF3F51B5',
            'color.primary.dark': '&HFF303F9F',
            'color.accent': '&HFFFF4081'
          })
        },
        { name: `src/appinventor/${userPackage}/${name}/${screen}.scm`, data: serializeScm(scm) },
        { name: `src/appinventor/${userPackage}/${name}/${screen}.bky`, data: '<xml xmlns="http://www.w3.org/1999/xhtml"></xml>' }
      ];

      const buf = writeZip(files);
      const res = await call('project.importAia', {
        name,
        base64: buf.toString('base64')
      }, 120000);

      return {
        ok: !!res.success,
        projectName: name,
        projectId: res.projectId,
        status: res.status,
        aiaBytes: buf.length,
        next: res.success ? `ai_project_open({projectId:"${res.projectId}"})` : res.raw
      };
    }
  });

  add({
    name: 'ai_project_open',
    description: 'Open a project by numeric id in the editor tab. The page reloads, so re-inject the relay afterwards.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId']
    },
    handler: async ({ projectId }) => call('project.open', { projectId })
  });

  add({
    name: 'ai_project_delete',
    description: 'Move a project to the trash via the App Inventor project list UI (uses the live page). Requires the projects list to be visible.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId']
    },
    handler: async ({ projectId }) => {
      const out = await call('ui.eval', {
        script: `(function(){
          var rows=[...document.querySelectorAll('.ode-ProjectRow')];
          var row=rows.find(function(r){
            var a=r.querySelector('a[href*="${projectId}"], [data-project-id="${projectId}"]');
            return !!a;
          });
          return {found:!!row, count:rows.length};
        })()`
      });
      return { ok: false, supported: false, detail: out, error: 'Direct project deletion is not implemented; use the Projects list UI or the AIA trash workflow.' };
    }
  });

  add({
    name: 'ai_screens_list',
    description: 'List every screen in the project with component counts and whether it has blocks.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const { files, projectName } = await fetchProject();
      const screens = listScreens(files);
      return {
        ok: true,
        projectName,
        screens: screens.map((s) => {
          const form = readForm(files, s.screen);
          const root = form ? componentNode(form.doc.Properties) : null;
          const bky = files.get(s.path.replace(/\.scm$/, '.bky'));
          const blockCount = bky ? (bky.toString('utf8').match(/<block /g) || []).length : 0;
          return {
            screen: s.screen,
            components: root ? flattenComponents(root).length : 0,
            hasBlocks: s.hasBlocks,
            hasYail: s.hasYail,
            blocks: blockCount
          };
        })
      };
    }
  });

  add({
    name: 'ai_screen_add',
    description: 'Add a new screen to the project using the Designer "Add Screen" dialog.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    },
    handler: async ({ name }) => call('designer.addScreen', { name }, 60000)
  });

  add({
    name: 'ai_screen_remove',
    description: 'Remove a screen from the project.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    },
    handler: async ({ name }) => call('designer.removeScreen', { name }, 60000)
  });

  add({
    name: 'ai_component_tree',
    description: 'Authoritative component tree of a screen read from the exported .scm, merged with the live component list. Includes every designer property.',
    inputSchema: {
      type: 'object',
      properties: {
        screen: { type: 'string', description: 'Screen name (default Screen1)' },
        includeProperties: { type: 'boolean', description: 'Include property values (default true)' }
      }
    },
    handler: async ({ screen = 'Screen1', includeProperties = true }) => {
      const { files, projectName } = await fetchProject();
      const form = readForm(files, screen);
      if (!form) throw new Error(`Screen not found in project: ${screen}`);
      const root = componentNode(form.doc.Properties);
      let live = null;
      try {
        live = await call('state');
      } catch {
        /* relay optional for this read */
      }
      const tree = includeProperties ? root : stripProps(root);
      const liveNames = live && live.components ? live.components.map((c) => c.name).sort() : null;
      const scmNames = flattenComponents(root).map((c) => c.name).sort();
      return {
        ok: true,
        projectName,
        screen,
        tree,
        componentCount: scmNames.length,
        liveNames,
        stale: liveNames ? JSON.stringify(liveNames) !== JSON.stringify(scmNames) : null,
        note: liveNames && JSON.stringify(liveNames) !== JSON.stringify(scmNames)
          ? 'Saved .scm differs from the live designer (autosave runs ~6s after an edit). Re-run shortly or call ai_state for live components.'
          : undefined
      };
    }
  });

  add({
    name: 'ai_component_add',
    description: 'Add a component to a screen via the Designer palette (real GWT path, saves through App Inventor). Optionally rename it and nest it inside a parent container.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Component type, e.g. Button, Label, HorizontalArrangement' },
        name: { type: 'string', description: 'Desired instance name, e.g. BtnStart' },
        parent: { type: 'string', description: 'Container instance name to nest into (selects it first)' }
      },
      required: ['type']
    },
    handler: async (args) => call('designer.addComponent', args, 90000)
  });

  add({
    name: 'ai_component_remove',
    description: 'Remove a component from the active screen using the Designer Delete button.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    },
    handler: async ({ name }) => call('designer.removeComponent', { name }, 60000)
  });

  add({
    name: 'ai_component_rename',
    description: 'Rename a component instance using the Designer Rename dialog.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to']
    },
    handler: async ({ from, to }) => call('designer.renameComponent', { from, to }, 60000)
  });

  add({
    name: 'ai_component_select',
    description: 'Select a component in the Designer so the properties panel shows it.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    },
    handler: async ({ name }) => call('designer.select', { name })
  });

  add({
    name: 'ai_component_properties',
    description: 'Read the live property values of a component from the Designer properties panel.',
    inputSchema: {
      type: 'object',
      properties: { component: { type: 'string' } },
      required: ['component']
    },
    handler: async ({ component }) => call('designer.getProperties', { component }, 60000)
  });

  add({
    name: 'ai_component_set_property',
    description: 'Set a designer property on a component (text, number, boolean or choice editor). Saves through App Inventor.',
    inputSchema: {
      type: 'object',
      properties: {
        component: { type: 'string' },
        property: { type: 'string', description: 'Property name exactly as shown in the Designer, e.g. Text, Width, Enabled' },
        value: { description: 'New value (string, number or boolean)' }
      },
      required: ['component', 'property', 'value']
    },
    handler: async (args) => call('designer.setProperty', args, 60000)
  });

  add({
    name: 'ai_component_types',
    description: 'Full component catalog from the live editor (all types, with categories).',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional filter' } }
    },
    handler: async ({ query } = {}) => {
      const out = await call('blocks.catalog', {}, 60000);
      let types = Object.keys(out);
      if (query) {
        const q = query.toLowerCase();
        types = types.filter((t) => t.toLowerCase().includes(q));
      }
      return { ok: true, count: types.length, types };
    }
  });

  add({
    name: 'ai_component_schema',
    description: 'Events, methods, properties, getters and setters for a component type (drives valid block generation).',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string' } },
      required: ['type']
    },
    handler: async ({ type }) => {
      const out = await call('blocks.catalog', { type }, 60000);
      if (out.error) throw new Error(out.error);
      return { ok: true, type, schema: out };
    }
  });

  add({
    name: 'ai_blocks_context',
    description: 'Everything needed to author blocks correctly: project, live components (name/type) and current workspace summary.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => call('blocks.context')
  });

  add({
    name: 'ai_blocks_get',
    description: 'Read the current Blockly workspace as XML (plus a block summary).',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['xml', 'summary'], description: 'Default xml' }
      }
    },
    handler: async ({ format = 'xml' } = {}) => call('blocks.get', { format }, 60000)
  });

  add({
    name: 'ai_blocks_set',
    description: 'Replace the whole Blockly workspace with the given XML (clears first). Prefer ai_blocks_add for incremental edits.',
    inputSchema: {
      type: 'object',
      properties: { xml: { type: 'string' } },
      required: ['xml']
    },
    handler: async ({ xml }) => call('blocks.set', { xml }, 90000)
  });

  add({
    name: 'ai_blocks_add',
    description: 'Append blocks to the workspace from Blockly XML. Existing blocks are preserved.',
    inputSchema: {
      type: 'object',
      properties: { xml: { type: 'string' } },
      required: ['xml']
    },
    handler: async ({ xml }) => call('blocks.add', { xml }, 90000)
  });

  add({
    name: 'ai_blocks_clear',
    description: 'Delete every block on the active screen.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => call('blocks.clear', {}, 60000)
  });

  add({
    name: 'ai_blocks_diagnostics',
    description: 'Live block health: counts, event handlers, duplicate handler detection, and blocks pointing at missing components.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => call('blocks.diagnostics', {}, 60000)
  });

  add({
    name: 'ai_build_apk',
    description: 'Compile an APK through the App Inventor Build menu, download it, and verify the file is a valid package. Fails loudly with server diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Optional absolute destination path' },
        timeoutSeconds: { type: 'number', description: 'Compile timeout, default 240' }
      }
    },
    handler: async ({ file, timeoutSeconds = 240 } = {}) => {
      const start = Date.now();
      const res = await call('build.apk', {}, Math.min(timeoutSeconds, 900) * 1000);
      if (res.error) {
        return { __isError: true, data: { ok: false, stage: 'compile', error: res.error, elapsedMs: Date.now() - start } };
      }
      if (!res.link) throw new Error('Build finished without a download link');

      let target = file;
      if (!target) {
        await ensureDirs();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        target = path.join(buildDir, `app-${stamp}.apk`);
      }
      await fs.mkdir(path.dirname(target), { recursive: true });

      // The build link is nonce-based and public for ~2h.
      let buf;
      try {
        const r = await fetch(res.link, { redirect: 'follow' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        buf = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        // Fall back to the browser (same-origin cookies).
        const b64 = await call('ui.eval', {
          script: `fetch(${JSON.stringify(res.link)},{credentials:'include'}).then(function(r){return r.arrayBuffer();})`
        }, 120000);
        throw new Error(`Host download failed (${e.message}); browser-side fetch returned ${b64 && b64.value ? 'data' : 'nothing'} - not implemented`);
      }
      await fs.writeFile(target, buf);

      const verify = verifyApk(buf);
      return {
        ok: verify.valid,
        file: target,
        bytes: buf.length,
        elapsedMs: Date.now() - start,
        link: res.link,
        verify
      };
    }
  });

  add({
    name: 'ai_build_status',
    description: 'Poll the build dialog for progress text or a finished download link.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => call('build.progress')
  });

  add({
    name: 'ai_validate',
    description: 'Validate the project end to end: duplicate event handlers, blocks referencing missing components, missing assets, unknown component types, empty screens.',
    inputSchema: {
      type: 'object',
      properties: { screen: { type: 'string' } }
    },
    handler: async ({ screen } = {}) => {
      const { files, projectName } = await fetchProject();
      const screens = listScreens(files);
      const assets = new Set([...files.keys()].filter((k) => k.startsWith('assets/')).map((k) => k.slice('assets/'.length)));

      let catalog = null;
      try {
        catalog = await call('blocks.catalog', {}, 60000);
      } catch {
        /* relay offline: type checks skipped */
      }
      const issues = [];
      const summary = [];

      for (const s of screens) {
        if (screen && s.screen !== screen) continue;
        const form = readForm(files, s.screen);
        if (!form) continue;
        const root = componentNode(form.doc.Properties);
        const flat = flattenComponents(root);
        const names = new Set(flat.map((c) => c.name));

        // unknown component types
        if (catalog) {
          for (const c of flat) {
            if (!catalog[c.type]) {
              issues.push({ severity: 'error', screen: s.screen, kind: 'unknown_component_type', component: c.name, detail: c.type });
            }
          }
        }

        // missing assets referenced by properties
        for (const c of flat) {
          for (const [prop, val] of Object.entries(c.properties)) {
            if (typeof val !== 'string' || !val) continue;
            if (!/\.(png|jpg|jpeg|gif|webp|mp3|wav|ogg|m4a|mp4|3gp|ttf|csv|txt|json|pdf)$/i.test(val)) continue;
            if (val.startsWith('http')) continue;
            if (!assets.has(val)) {
              issues.push({ severity: 'error', screen: s.screen, kind: 'missing_asset', component: c.name, property: prop, asset: val });
            }
          }
        }

        const bky = files.get(s.path.replace(/\.scm$/, '.bky'));
        const bx = bky ? bky.toString('utf8') : '';
        const blockCount = (bx.match(/<block /g) || []).length;

        // blocks referencing missing instances
        const refs = [...bx.matchAll(/instance_name="([^"]+)"/g)].map((m) => m[1]);
        const missing = [...new Set(refs.filter((r) => r && !names.has(r)))];
        for (const m of missing) {
          issues.push({ severity: 'error', screen: s.screen, kind: 'missing_component_reference', instance: m });
        }

        // variable scoping: AI compiles `lexical_variable_*` with no prefix as a
        // LOCAL, so a global read/write without the "global " prefix throws
        // "unbound location $name" at runtime.
        const globals = new Set(
          [...bx.matchAll(/<block[^>]*type="global_declaration"[^>]*>[\s\S]*?<field name="NAME">([^<]*)<\/field>/g)].map((m) => m[1])
        );
        const locals = new Set(
          [...bx.matchAll(/<block[^>]*type="local_declaration_(?:statement|expression)"[^>]*>[\s\S]*?<field name="VAR">([^<]*)<\/field>/g)].map((m) => m[1])
        );
        const varRefs = [...bx.matchAll(/<field name="VAR">([^<]*)<\/field>/g)].map((m) => m[1]);
        const seenVar = new Set();
        for (const v of varRefs) {
          if (seenVar.has(v)) continue;
          seenVar.add(v);
          if (v.startsWith('global ')) {
            const bare = v.slice('global '.length);
            if (!globals.has(bare)) {
              issues.push({ severity: 'error', screen: s.screen, kind: 'missing_global_declaration', variable: bare });
            }
          } else if (globals.has(v) && !locals.has(v)) {
            issues.push({
              severity: 'error',
              screen: s.screen,
              kind: 'global_missing_prefix',
              variable: v,
              fix: `rename reference "${v}" to "global ${v}"`
            });
          }
        }

        // duplicate event handlers
        const evts = [...bx.matchAll(/<block type="component_event"[^>]*>[\s\S]*?<mutation[^>]*instance_name="([^"]*)"[^>]*event_name="([^"]*)"/g)]
          .map((m) => `${m[1]}.${m[2]}`);
        const seen = new Set();
        for (const e of evts) {
          if (seen.has(e)) issues.push({ severity: 'error', screen: s.screen, kind: 'duplicate_event_handler', handler: e });
          seen.add(e);
        }

        summary.push({ screen: s.screen, components: flat.length, blocks: blockCount, events: evts.length });
      }

      return {
        ok: issues.filter((i) => i.severity === 'error').length === 0,
        projectName,
        screens: summary,
        issueCount: issues.length,
        issues,
        notes: catalog ? [] : ['Live editor catalog unavailable, component-type checks skipped.']
      };
    }
  });

  add({
    name: 'ai_ui_eval',
    description: 'Escape hatch: evaluate an expression in the App Inventor page and return the value. Use for exploration, not for edits you can do with a dedicated tool.',
    inputSchema: {
      type: 'object',
      properties: { script: { type: 'string', description: 'JavaScript expression or async expression' } },
      required: ['script']
    },
    handler: async ({ script }) => call('ui.eval', { script }, 90000)
  });

  add({
    name: 'ai_devices',
    description: 'List attached Android devices and emulators available for testing.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        return { ok: true, devices: await adb.listDevices() };
      } catch (e) {
        return { ok: false, error: e.message, devices: [] };
      }
    }
  });

  add({
    name: 'ai_install_apk',
    description: 'Install an APK on a connected device or emulator (defaults to the first emulator).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path to the APK' },
        device: { type: 'string', description: 'adb serial, e.g. emulator-5554' }
      },
      required: ['file']
    },
    handler: async ({ file, device }) => {
      await fs.access(file);
      const dev = await adb.pickDevice(device);
      const info = await adb.inspectApk(file);
      const out = await adb.install(dev.serial, file);
      return { ok: true, device: dev.serial, install: out, ...(info || {}) };
    }
  });

  add({
    name: 'ai_test_apk',
    description: 'Install and exercise an APK: launch it, run scripted tap/assert steps, and report crashes from logcat.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path to the APK' },
        device: { type: 'string', description: 'adb serial (defaults to the first emulator)' },
        steps: {
          type: 'array',
          description: 'Scenario steps: {action:"tapText"|"expectText"|"expectNotText"|"waitForText"|"dump"|"sleep"|"back", ...}',
          items: { type: 'object' }
        },
        launchWaitMs: { type: 'number', description: 'Wait after launch (default 6000)' }
      },
      required: ['file']
    },
    handler: async ({ file, device, steps, launchWaitMs = 6000 }) => {
      await fs.access(file);
      const dev = await adb.pickDevice(device);
      const info = await adb.inspectApk(file);
      if (!info || !info.packageName) throw new Error('Could not read the APK package name (aapt missing?)');
      await adb.install(dev.serial, file);
      await adb.clearLogcat(dev.serial);
      await adb.launch(dev.serial, info.packageName, info.launchActivity, launchWaitMs);
      const scenario = steps && steps.length ? { steps } : { steps: [{ action: 'dump' }] };
      const report = await adb.runScenario(dev.serial, info.packageName, scenario);
      return {
        ok: report.ok,
        device: dev.serial,
        emulator: dev.emulator,
        ...info,
        ...report,
        file
      };
    }
  });

  add({
    name: 'ai_build_and_test',
    description: 'One-shot loop: compile the APK, download it, install on an emulator, launch it, run assertions, and report crashes.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'adb serial (defaults to the first emulator)' },
        steps: { type: 'array', items: { type: 'object' }, description: 'Same steps as ai_test_apk' },
        timeoutSeconds: { type: 'number', description: 'Compile timeout, default 240' }
      }
    },
    handler: async ({ device, steps, timeoutSeconds = 240 } = {}) => {
      const buildTool = tools.find((t) => t.name === 'ai_build_apk');
      const build = await buildTool.handler({ timeoutSeconds });
      if (!build.ok) return { ok: false, stage: 'build', build };

      const testTool = tools.find((t) => t.name === 'ai_test_apk');
      const test = await testTool.handler({ file: build.file, device, steps });
      return { ok: build.ok && test.ok, build, test };
    }
  });

  add({
    name: 'ai_app_logs',
    description: 'Read crashes and App Inventor runtime errors from the device logcat buffer.',
    inputSchema: {
      type: 'object',
      properties: { device: { type: 'string' } }
    },
    handler: async ({ device } = {}) => {
      const dev = await adb.pickDevice(device);
      return { device: dev.serial, ...(await adb.readCrashes(dev.serial)) };
    }
  });

  add({
    name: 'ai_repair',
    description: 'Detect block-level defects and apply the smallest safe fix. Currently fixes global-variable references that are missing the required "global " prefix (a runtime "unbound location" crash). Destructive fixes are reported, never applied automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        apply: { type: 'boolean', description: 'Write the fix back to the workspace (default true)' }
      }
    },
    handler: async ({ apply = true } = {}) => {
      const current = await call('blocks.get', { format: 'xml' }, 60000);
      const xml = current.xml;
      const globals = new Set(
        [...xml.matchAll(/<block[^>]*type="global_declaration"[^>]*>[\s\S]*?<field name="NAME">([^<]*)<\/field>/g)].map((m) => m[1])
      );
      const locals = new Set(
        [...xml.matchAll(/<block[^>]*type="local_declaration_(?:statement|expression)"[^>]*>[\s\S]*?<field name="VAR">([^<]*)<\/field>/g)].map((m) => m[1])
      );

      const fixes = [];
      let next = xml;
      for (const name of globals) {
        if (locals.has(name)) continue;
        const needle = `<field name="VAR">${name}</field>`;
        if (!next.includes(needle)) continue;
        const count = next.split(needle).length - 1;
        next = next.split(needle).join(`<field name="VAR">global ${name}</field>`);
        fixes.push({ kind: 'global_missing_prefix', variable: name, references: count, fix: `"${name}" -> "global ${name}"` });
      }

      const blocked = [];
      const dupes = [...xml.matchAll(/<mutation[^>]*instance_name="([^"]*)"[^>]*event_name="([^"]*)"/g)].map((m) => `${m[1]}.${m[2]}`);
      const seen = new Set();
      for (const d of dupes) {
        if (seen.has(d)) blocked.push({ kind: 'duplicate_event_handler', handler: d, reason: 'removing blocks is destructive; fix manually' });
        seen.add(d);
      }

      if (!fixes.length) {
        return { ok: true, changed: false, fixes: [], blocked, note: blocked.length ? 'Only destructive issues found; nothing applied.' : 'No repairable issues found.' };
      }

      if (apply) {
        await call('blocks.set', { xml: next }, 90000);
      }

      return { ok: true, changed: apply, applied: apply, fixes, blocked, bytesBefore: xml.length, bytesAfter: next.length };
    }
  });

  add({
    name: 'ai_download',
    description: 'Download a URL (for example a build link) to a local file.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        file: { type: 'string', description: 'Absolute destination path' }
      },
      required: ['url', 'file']
    },
    handler: async ({ url, file }) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await fs.writeFile(file, buf);
      return { ok: true, file, bytes: buf.length, contentType: r.headers.get('content-type') };
    }
  });

  return tools;
}

function stripProps(node) {
  return {
    name: node.name,
    type: node.type,
    children: (node.children || []).map(stripProps)
  };
}

/** Structural verification of a downloaded APK/AAB. */
export function verifyApk(buf) {
  const result = { valid: false, checks: {} };
  if (!buf || buf.length < 1024) {
    result.checks.size = `too small (${buf ? buf.length : 0} bytes)`;
    return result;
  }
  result.checks.size = `${buf.length} bytes`;

  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  result.checks.zip = isZip;
  if (!isZip) return result;

  try {
    const files = readZip(buf);
    const names = [...files.keys()];
    result.checks.entryCount = names.length;
    result.checks.manifest = names.includes('AndroidManifest.xml');
    result.checks.dex = names.some((n) => /^classes\d*\.dex$/.test(n));
    result.checks.resources = names.includes('resources.arsc');
    result.checks.signature = names.some((n) => /^META-INF\/.*\.(RSA|DSA|EC|SF)$/i.test(n));
    const manifest = files.get('AndroidManifest.xml');
    if (manifest) {
      // Binary XML: package name appears as a UTF-16LE string in the string pool.
      const ascii = manifest.toString('latin1');
      const m = ascii.match(/appinventor\.ai_[A-Za-z0-9_]+[A-Za-z0-9_.]*/);
      if (m) result.checks.packageNameGuess = m[0];
    }
    result.valid = !!(result.checks.manifest && (result.checks.dex || result.checks.entryCount > 100));
  } catch (e) {
    result.checks.zipError = e.message;
  }
  return result;
}
