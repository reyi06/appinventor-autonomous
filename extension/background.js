/* Keeps the appinventor-autonomous relay attached to every App Inventor tab.
 *
 * The relay itself (mcp/page/relay.js) is served by the MCP host on
 * http://127.0.0.1:8766/relay.js and owns the WebSocket connection. This
 * worker only makes sure it is present after every navigation and periodically
 * while the editor is open.
 */

const DEFAULT_PORT = 8766;
const APP_INVENTOR = '*://*.appinventor.mit.edu/*';

/* Runs in the page's MAIN world. */
function injectRelay(port) {
  if (window.__aiRelay && window.__aiRelay.version) {
    try { window.__aiRelay.reconnect(); } catch (e) { /* ignore */ }
    return { state: 'present', version: window.__aiRelay.version };
  }
  if (window.__aiRelayInjecting) return { state: 'pending' };

  window.__aiRelayInjecting = true;
  const script = document.createElement('script');
  script.src = `http://127.0.0.1:${port}/relay.js?ts=${Date.now()}`;
  script.onload = () => {
    script.remove();
    window.__aiRelayInjecting = false;
  };
  script.onerror = () => {
    script.remove();
    window.__aiRelayInjecting = false;
    window.__aiRelayInjectError = 'relay.js blocked or host unreachable';
  };
  (document.head || document.documentElement).appendChild(script);
  return { state: 'injected' };
}

/* Runs in the page's MAIN world. */
function relayStatus() {
  if (!window.__aiRelay) return { present: false, error: window.__aiRelayInjectError || null };
  try {
    return Object.assign({ present: true }, window.__aiRelay.status());
  } catch (e) {
    return { present: true, error: e.message };
  }
}

async function getPort() {
  const { port } = await chrome.storage.local.get({ port: DEFAULT_PORT });
  return port;
}

function appInventorTabs() {
  return chrome.tabs.query({ url: [APP_INVENTOR] });
}

async function injectInto(tabId, port) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: injectRelay,
      args: [port]
    });
    return res && res.result;
  } catch (e) {
    return { state: 'error', error: e.message };
  }
}

async function statusOf(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: relayStatus
    });
    return res && res.result;
  } catch (e) {
    return { present: false, error: e.message };
  }
}

async function refreshBadge() {
  const tabs = await appInventorTabs();
  let connected = 0;
  for (const tab of tabs) {
    if (tab.id == null) continue;
    const s = await statusOf(tab.id);
    if (s && s.present && s.connected) connected++;
  }
  if (connected > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
    chrome.action.setBadgeText({ text: String(connected) });
    chrome.action.setTitle({ title: `Relay connected on ${connected} tab(s)` });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#9e9e9e' });
    chrome.action.setBadgeText({ text: tabs.length ? '0' : '' });
    chrome.action.setTitle({ title: tabs.length ? 'App Inventor tab open, relay not connected' : 'No App Inventor tab' });
  }
  return { tabs: tabs.length, connected };
}

async function ensureAll() {
  const port = await getPort();
  const tabs = await appInventorTabs();
  for (const tab of tabs) {
    if (tab.id == null) continue;
    await injectInto(tab.id, port);
  }
  return refreshBadge();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('ai-relay-sweep', { periodInMinutes: 0.35 });
  ensureAll();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('ai-relay-sweep', { periodInMinutes: 0.35 });
  ensureAll();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ai-relay-sweep') ensureAll();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || tab.url.indexOf('appinventor.mit.edu') === -1) return;
  getPort().then((port) => injectInto(tabId, port)).then(refreshBadge);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    if (tab.url.indexOf('appinventor.mit.edu') === -1) return;
    getPort().then((port) => injectInto(tabId, port)).then(refreshBadge);
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'sweep') {
    ensureAll().then(sendResponse);
    return true;
  }
  return false;
});

/* Best effort on worker start. */
ensureAll();
