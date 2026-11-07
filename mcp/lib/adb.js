import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ADB_TIMEOUT = 120000;

/** Run a command and resolve with stdout (rejects with stderr on failure). */
export function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeout || ADB_TIMEOUT, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

export function adb(serial, args, opts) {
  const base = serial ? ['-s', serial, ...args] : args;
  return exec('adb', base, opts);
}

function sdkRoot() {
  if (process.env.ANDROID_HOME) return process.env.ANDROID_HOME;
  if (process.env.ANDROID_SDK_ROOT) return process.env.ANDROID_SDK_ROOT;

  // Derive from adb on PATH: <sdk>/platform-tools/adb[.exe]
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(which, ['adb'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim();
    if (out) return path.resolve(path.dirname(out), '..');
  } catch { /* adb not on PATH */ }

  const candidates = process.platform === 'win32'
    ? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'), 'C:\\Android\\Sdk']
    : process.platform === 'darwin'
      ? [path.join(process.env.HOME || '', 'Library', 'Android', 'sdk')]
      : [path.join(process.env.HOME || '', 'Android', 'Sdk')];

  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'build-tools'))) return c;
  }
  return '';
}

function aaptPath() {
  const root = path.join(sdkRoot(), 'build-tools');
  if (!fs.existsSync(root)) return null;
  const versions = fs.readdirSync(root).sort().reverse();
  for (const v of versions) {
    const p = path.join(root, v, 'aapt.exe');
    if (fs.existsSync(p)) return p;
    const p2 = path.join(root, v, 'aapt');
    if (fs.existsSync(p2)) return p2;
  }
  return null;
}

/** List attached devices with model and state. */
export async function listDevices() {
  const out = await adb(null, ['devices', '-l']);
  const devices = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\S+)(.*)$/);
    if (!m || m[1] === 'List') continue;
    const rest = m[3] || '';
    const model = (rest.match(/model:(\S+)/) || [])[1] || null;
    devices.push({
      serial: m[1],
      state: m[2],
      model,
      emulator: /^emulator-/.test(m[1])
    });
  }
  return devices;
}

/** Pick a device: explicit serial > first emulator > first device. */
export async function pickDevice(serial) {
  const devices = (await listDevices()).filter((d) => d.state === 'device');
  if (serial) {
    const hit = devices.find((d) => d.serial === serial);
    if (!hit) throw new Error(`Device not found or offline: ${serial}. Available: ${devices.map((d) => d.serial).join(', ')}`);
    return hit;
  }
  const emu = devices.find((d) => d.emulator);
  if (emu) return emu;
  if (devices[0]) return devices[0];
  throw new Error('No Android device or emulator attached');
}

/** Read the package name and launchable activity from an APK. */
export async function inspectApk(apkPath) {
  const aapt = aaptPath();
  if (!aapt) return null;
  const out = await exec(aapt, ['dump', 'badging', apkPath]);
  const pkg = (out.match(/package: name='([^']+)'/) || [])[1] || null;
  const activity = (out.match(/launchable-activity: name='([^']+)'/) || [])[1] || null;
  const versionName = (out.match(/versionName='([^']*)'/) || [])[1] || null;
  const versionCode = (out.match(/versionCode='([^']*)'/) || [])[1] || null;
  return { packageName: pkg, launchActivity: activity, versionName, versionCode };
}

/** Install an APK (replacing any existing install). */
export async function install(serial, apkPath) {
  const out = await adb(serial, ['install', '-r', '-g', apkPath], { timeout: 240000 });
  if (!/Success/i.test(out)) throw new Error(`Install failed: ${out.trim()}`);
  return out.trim();
}

export async function uninstall(serial, pkg) {
  try {
    await adb(serial, ['uninstall', pkg]);
    return true;
  } catch {
    return false;
  }
}

export async function clearLogcat(serial) {
  await adb(serial, ['logcat', '-c']);
}

/** Launch the app's launcher activity and wait for it to appear. */
export async function launch(serial, pkg, activity, waitMs = 6000) {
  await adb(serial, ['shell', 'am', 'force-stop', pkg]);
  if (activity) {
    await adb(serial, ['shell', 'am', 'start', '-n', `${pkg}/${activity}`]);
  } else {
    await adb(serial, ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
  }
  await new Promise((r) => setTimeout(r, waitMs));
}

export async function stop(serial, pkg) {
  await adb(serial, ['shell', 'am', 'force-stop', pkg]);
}

/** Dump the current UI hierarchy and return it as XML text. */
export async function dumpUi(serial, tmpName = 'ui.xml') {
  const remote = `/sdcard/${tmpName}`;
  await adb(serial, ['shell', 'uiautomator', 'dump', remote]);
  const out = await adb(serial, ['shell', 'cat', remote]);
  return out;
}

/** Extract visible nodes (text, resource-id, class, bounds) from a UI dump. */
export function parseUi(xml) {
  const nodes = [];
  const re = /<node\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const get = (name) => {
      const a = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return a ? a[1] : null;
    };
    const bounds = get('bounds');
    const b = bounds && bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    nodes.push({
      text: get('text') || '',
      id: get('resource-id'),
      cls: get('class'),
      clickable: get('clickable') === 'true',
      enabled: get('enabled') === 'true',
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4], cx: Math.round((+b[1] + +b[3]) / 2), cy: Math.round((+b[2] + +b[4]) / 2) } : null
    });
  }
  return nodes;
}

/** Visible texts in order, useful for assertions. */
export function visibleTexts(nodes) {
  return nodes.filter((n) => n.text).map((n) => n.text);
}

export async function tapText(serial, text, nodes, occurrence = 0) {
  let hits = nodes.filter((n) => n.text === text);
  if (hits.length <= occurrence) {
    // Material themes render dialog buttons in upper case, so fall back to a
    // case-insensitive match before giving up.
    const lower = String(text).toLowerCase();
    hits = nodes.filter((n) => String(n.text).toLowerCase() === lower);
  }
  const node = hits[occurrence];
  if (!node || !node.bounds) throw new Error(`Text not found on screen: "${text}"`);
  await adb(serial, ['shell', 'input', 'tap', String(node.bounds.cx), String(node.bounds.cy)]);
  await new Promise((r) => setTimeout(r, 1200));
  return node;
}

/** Read logcat since the last clear and report crashes / runtime errors. */
export async function readCrashes(serial) {
  const out = await adb(serial, ['logcat', '-d', '-v', 'brief']);
  const lines = out.split(/\r?\n/);
  const fatal = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/FATAL EXCEPTION|AndroidRuntime.*Process:/.test(line)) {
      fatal.push(lines.slice(i, Math.min(i + 12, lines.length)).join('\n'));
    } else if (/\sE\s/.test(line) && /exception|error/i.test(line)) {
      if (errors.length < 40) errors.push(line);
    }
  }
  const appInventorErrors = lines.filter((l) => /E\/AppInventor|RuntimeError|com\.google\.appinventor/i.test(l)).slice(0, 30);
  return {
    crashed: fatal.length > 0,
    fatal: fatal.slice(0, 3),
    errors,
    appInventorErrors
  };
}

/** Wait until a target text appears in a fresh UI dump, or time out. */
export async function waitForText(serial, text, timeoutMs = 15000) {
  const started = Date.now();
  const lower = String(text).toLowerCase();
  let last = [];
  while (Date.now() - started < timeoutMs) {
    const nodes = parseUi(await dumpUi(serial));
    last = visibleTexts(nodes);
    if (last.includes(text) || last.some((t) => String(t).toLowerCase() === lower)) {
      return { found: true, nodes, texts: last };
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return { found: false, nodes: [], texts: last };
}

/** Run one scripted scenario against the app. */
export async function runScenario(serial, pkg, scenario) {
  const steps = [];
  const results = [];

  for (const step of scenario.steps || []) {
    const entry = { action: step.action, ok: false };
    try {
      if (step.action === 'dump') {
        const nodes = parseUi(await dumpUi(serial));
        entry.texts = visibleTexts(nodes);
        entry.count = nodes.length;
      } else if (step.action === 'waitForText') {
        const r = await waitForText(serial, step.text, step.timeoutMs || 15000);
        entry.found = r.found;
        entry.texts = r.texts;
        if (!r.found) throw new Error(`Text never appeared: ${step.text}`);
      } else if (step.action === 'tapText') {
        const nodes = parseUi(await dumpUi(serial));
        const node = await tapText(serial, step.text, nodes, step.occurrence || 0);
        entry.tapped = node.text;
        entry.at = { x: node.bounds.cx, y: node.bounds.cy };
      } else if (step.action === 'expectText') {
        const nodes = parseUi(await dumpUi(serial));
        const texts = visibleTexts(nodes);
        entry.texts = texts;
        if (!texts.includes(step.text)) throw new Error(`Expected text missing: ${step.text}`);
      } else if (step.action === 'expectNotText') {
        const nodes = parseUi(await dumpUi(serial));
        const texts = visibleTexts(nodes);
        entry.texts = texts;
        if (texts.includes(step.text)) throw new Error(`Unexpected text still present: ${step.text}`);
      } else if (step.action === 'sleep') {
        await new Promise((r) => setTimeout(r, step.ms || 1000));
      } else if (step.action === 'back') {
        await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
        await new Promise((r) => setTimeout(r, 900));
      } else {
        throw new Error(`Unknown scenario step: ${step.action}`);
      }
      entry.ok = true;
    } catch (e) {
      entry.ok = false;
      entry.error = e.message;
      results.push(entry);
      steps.push(entry);
      break;
    }
    steps.push(entry);
  }

  const crash = await readCrashes(serial);
  const failed = steps.filter((s) => !s.ok);
  return {
    ok: failed.length === 0 && !crash.crashed && steps.length > 0,
    packageName: pkg,
    steps,
    crash
  };
}
