/**
 * Access control for the local HTTP/WebSocket surface.
 *
 * The server binds 127.0.0.1, which keeps it off the network but does NOT keep
 * it away from the browser. Any page the user has open can send a request to
 * 127.0.0.1:8766, and `ai_asset_upload` reads an arbitrary local file into the
 * project, so an unauthenticated endpoint here is an arbitrary-file-read for
 * any website the user visits.
 *
 * Three controls, each closing a different hole:
 *
 *   Host allowlist    DNS rebinding: evil.com resolves to 127.0.0.1, the browser
 *                     still sends `Host: evil.com`.
 *   Origin allowlist  cross-site requests from a page: the browser always sends
 *                     Origin, and it cannot be forged by script.
 *   Bearer token      everything else, including plain CSRF. A custom header
 *                     forces a CORS preflight, which is refused.
 *
 * The token is generated once and kept in the (gitignored) logs directory, so a
 * restart, or a second server instance that failed to bind, uses the same one.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** App Inventor is served from several hosts, all under this domain. */
const APPINVENTOR_ORIGIN = /^https:\/\/[a-z0-9-]+\.appinventor\.mit\.edu$/i;

/** Extra origins for local development, comma separated. */
function extraOrigins() {
  return String(process.env.APPINVENTOR_MCP_ALLOW_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function originAllowed(origin, extra = extraOrigins()) {
  if (!origin) return false;
  if (extra.includes(origin)) return true;
  return APPINVENTOR_ORIGIN.test(origin);
}

/**
 * Only accept requests addressed to the loopback names the server actually
 * listens on. `Host` is set by the browser from the URL it was given, so a
 * rebound domain shows up here even though the socket is local.
 */
export function hostAllowed(host, port) {
  const value = String(host || '').toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}` || value === `[::1]:${port}`;
}

/** Constant-time comparison; length is compared first, which leaks nothing useful. */
export function tokenMatches(authorization, token) {
  if (!token) return false;
  const value = String(authorization || '');
  const m = value.match(/^Bearer\s+(\S+)$/i);
  if (!m) return false;
  const given = Buffer.from(m[1], 'utf8');
  const expected = Buffer.from(token, 'utf8');
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

/**
 * JSON is required on every POST. A cross-origin `text/plain` or
 * `application/x-www-form-urlencoded` request is a CORS "simple request" and
 * skips the preflight, so requiring JSON is what makes the token header
 * mandatory rather than advisory.
 */
export function isJsonRequest(req) {
  return /^application\/json\b/i.test(String(req.headers['content-type'] || ''));
}

/**
 * Read the token, creating it on first run.
 * @returns {{ token: string, file: string, created: boolean }}
 */
export function loadToken(dir, env = process.env) {
  const file = path.join(dir, 'token');
  if (env.APPINVENTOR_MCP_TOKEN) {
    return { token: String(env.APPINVENTOR_MCP_TOKEN), file: '(APPINVENTOR_MCP_TOKEN)', created: false };
  }
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 16) return { token: existing, file, created: false };
  } catch {
    /* first run */
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows ignores POSIX modes; the file is inside the user profile anyway */
  }
  return { token, file, created: true };
}
