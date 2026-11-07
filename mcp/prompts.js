import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * MCP prompts: reusable workflows shipped with the server.
 * The markdown bodies in docs/prompts/ are the single source of truth; the skill
 * points at the same files so they cannot drift.
 */

export const PROMPT_DEFS = [
  {
    name: 'app_from_brief',
    file: 'app-from-brief.md',
    title: 'Build an app from a brief',
    description: 'End-to-end: read a brief and sources, plan screens, upload assets, build layout + blocks, validate, compile and test.',
    arguments: [
      { name: 'project', description: 'Project folder under the workspace root', required: true },
      { name: 'name', description: 'App Inventor project name', required: true },
      { name: 'brief', description: 'Brief file name inside the project folder', required: false }
    ]
  },
  {
    name: 'screen_from_design',
    file: 'screen-from-design.md',
    title: 'Build a screen from a design',
    description: 'Compile a design bundle into a screen: assets first, dry-run plan, apply, then report fidelity.',
    arguments: [
      { name: 'project', description: 'Project folder', required: true },
      { name: 'screen', description: 'Target screen name', required: true }
    ]
  },
  {
    name: 'restyle_screen',
    file: 'restyle-screen.md',
    title: 'Restyle a screen with brand tokens',
    description: 'Apply colour and type tokens to an existing screen and report what cannot be automated.',
    arguments: [
      { name: 'project', description: 'Project folder', required: true },
      { name: 'screen', description: 'Screen name', required: true },
      { name: 'tokens', description: 'Tokens as JSON, e.g. {"color.primary":"#3F51B5"}', required: true }
    ]
  },
  {
    name: 'fix_runtime_crash',
    file: 'fix-runtime-crash.md',
    title: 'Fix a runtime crash',
    description: 'Classify a runtime error from the device, apply the smallest safe fix, rebuild and retest.',
    arguments: [
      { name: 'project', description: 'Project folder', required: true },
      { name: 'error', description: 'The error text or log excerpt', required: true }
    ]
  },
  {
    name: 'ship_apk',
    file: 'ship-apk.md',
    title: 'Ship an APK',
    description: 'Validate, compile, verify the package, install and run a UI scenario on a device.',
    arguments: [
      { name: 'project', description: 'Project folder', required: true },
      { name: 'device', description: 'adb serial, e.g. emulator-5554', required: false }
    ]
  },
  {
    name: 'audit_app',
    file: 'audit-app.md',
    title: 'Audit an app without changing it',
    description: 'Read-only review: structure, blocks, validation, compile, launch, design drift.',
    arguments: [
      { name: 'project', description: 'Project folder', required: true }
    ]
  }
];

export function createPrompts({ rootDir }) {
  const dir = path.join(rootDir, 'docs', 'prompts');
  const cache = new Map();

  async function body(def) {
    if (cache.has(def.file)) return cache.get(def.file);
    const text = await fs.readFile(path.join(dir, def.file), 'utf8');
    cache.set(def.file, text);
    return text;
  }

  function list() {
    return PROMPT_DEFS.map((d) => ({
      name: d.name,
      title: d.title,
      description: d.description,
      arguments: d.arguments
    }));
  }

  async function get(name, args = {}) {
    const def = PROMPT_DEFS.find((d) => d.name === name);
    if (!def) {
      const err = new Error(`Unknown prompt: ${name}`);
      err.code = 'PROMPT_NOT_FOUND';
      throw err;
    }
    let text = await body(def);
    for (const arg of def.arguments) {
      if (arg.required && !args[arg.name]) {
        throw new Error(`Prompt ${name} requires argument "${arg.name}"`);
      }
      const value = args[arg.name] != null ? String(args[arg.name]) : `<${arg.name}>`;
      text = text.split(`{{${arg.name}}}`).join(value);
    }
    return {
      description: def.description,
      messages: [{ role: 'user', content: { type: 'text', text } }]
    };
  }

  return { list, get };
}
