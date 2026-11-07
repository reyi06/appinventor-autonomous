const statusEl = document.getElementById('status');
const portEl = document.getElementById('port');

async function refresh() {
  const { port } = await chrome.storage.local.get({ port: 8766 });
  portEl.textContent = `http://127.0.0.1:${port}`;

  const tabs = await chrome.tabs.query({ url: ['*://*.appinventor.mit.edu/*'] });
  if (!tabs.length) {
    statusEl.innerHTML = '<span class="bad">No App Inventor tab open</span>';
    return;
  }

  let best = null;
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => (window.__aiRelay ? window.__aiRelay.status() : { present: false })
      });
      const s = res && res.result;
      if (s && s.present && s.connected) { best = s; break; }
      if (!best) best = s;
    } catch (e) {
      best = { present: false, error: e.message };
    }
  }

  if (best && best.present && best.connected) {
    statusEl.innerHTML =
      `<span class="ok">Connected</span><br>` +
      `${escapeHtml(best.project || '?')} · ${escapeHtml(best.view || '?')}<br>` +
      `<span class="muted">relay v${escapeHtml(best.version || '?')}</span>`;
  } else if (best && best.present) {
    statusEl.innerHTML = '<span class="bad">Relay loaded, not connected</span><br><span class="muted">Is the MCP host running on this port?</span>';
  } else {
    statusEl.innerHTML = '<span class="bad">Relay not injected</span><br><span class="muted">Click Re-attach relay.</span>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

document.getElementById('sweep').addEventListener('click', async () => {
  statusEl.textContent = 'Re-attaching…';
  const res = await chrome.runtime.sendMessage({ type: 'sweep' });
  await refresh();
  if (res) statusEl.textContent += '';
});

refresh();
setInterval(refresh, 2000);
