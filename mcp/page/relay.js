/* MIT App Inventor in-page relay.
 *
 * Runs in the MAIN world of the App Inventor editor tab. Connects to the
 * appinventor-autonomous MCP host over WebSocket and executes commands against
 * the live GWT designer + Blockly workspace.
 *
 * Loaded from http://127.0.0.1:8766/relay.js
 * Protocol (both directions JSON):
 *   host -> page : { type: "call", id, tool, params }
 *   page -> host : { type: "result", id, ok: true, result }
 *                  { type: "result", id, ok: false, error }
 *   page -> host : { type: "hello", version, url, project }
 */
(function () {
  'use strict';

  var VERSION = '1.3.3';
  var BUILD = '2026-11-09.20'; // implementation revision: changing this replaces a live instance
  var WS_URL = window.__AI_RELAY_WS__ || 'ws://127.0.0.1:8766';
  var PREFIX = '[ai-relay]';

  if (window.__aiRelay && window.__aiRelay.build === BUILD) {
    try { window.__aiRelay.reconnect(); } catch (e) { /* ignore */ }
    console.log(PREFIX, 'already loaded, reconnecting');
    return;
  }
  if (window.__aiRelay && typeof window.__aiRelay.disconnect === 'function') {
    try { window.__aiRelay.disconnect(); } catch (e) { /* ignore */ }
    console.log(PREFIX, 'replacing older relay instance');
  }

  /* ------------------------------------------------------------------ utils */

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(PREFIX);
    console.log.apply(console, args);
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function waitFor(fn, timeoutMs, intervalMs) {
    timeoutMs = timeoutMs || 8000;
    intervalMs = intervalMs || 120;
    var started = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        var value;
        try { value = fn(); } catch (e) { value = null; }
        if (value) return resolve(value);
        if (Date.now() - started > timeoutMs) return reject(new Error('timeout after ' + timeoutMs + 'ms'));
        setTimeout(tick, intervalMs);
      })();
    });
  }

  function byText(selector, txt, root) {
    var list = (root || document).querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) {
      if (list[i].textContent.trim() === txt) return list[i];
    }
    return null;
  }

  function byTextContains(selector, txt, root) {
    var list = (root || document).querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) {
      if (list[i].textContent.indexOf(txt) !== -1) return list[i];
    }
    return null;
  }

  /**
   * Toolbar buttons changed shape in newer App Inventor builds: the view tabs
   * are .ode-ProjectListButton and several commands are Material icon buttons
   * whose label lives in `title` rather than in the text. Match both.
   */
  function findButton(label, root) {
    var candidates = (root || document).querySelectorAll('.ode-ProjectListButton, .ode-TextButton, button');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.offsetParent === null) continue;
      var face = el.querySelector('.html-face');
      var text = (face ? face.textContent : el.textContent).trim();
      if (text === label) return el;
      var title = el.getAttribute('title') || el.getAttribute('aria-label') || '';
      if (title === label) return el;
      if (title.indexOf(label) === 0) return el;
    }
    return null;
  }

  function isActiveTab(el) {
    // App Inventor disables the tab you are already on.
    return !!el && /up-disabled|ode-ProjectListButton-down|ode-TextButton-down/.test(el.className);
  }

  function fire(el, type, opts) {
    var ev;
    if (/^(mouse|click|dblclick|contextmenu|pointer)/.test(type)) {
      ev = new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true, view: window }, opts || {}));
    } else {
      ev = new Event(type, { bubbles: true, cancelable: true });
    }
    el.dispatchEvent(ev);
  }

  /* GWT 2.8 widgets (PushButton and friends) only react to a full pointer +
   * mouse sequence at real coordinates. A bare click event is ignored. */
  function click(el) {
    if (!el) throw new Error('click: element missing');
    var box = el.getBoundingClientRect();
    var x = box.left + box.width / 2;
    var y = box.top + box.height / 2;
    var base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: 1, detail: 1
    };
    function pointer(type, extra) {
      if (typeof PointerEvent !== 'function') return null;
      try {
        return new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, base, extra || {}));
      } catch (e) {
        return null;
      }
    }
    function mouse(type, extra) {
      return new MouseEvent(type, Object.assign({}, base, extra || {}));
    }
    var face = el.querySelector('.html-face') || el;

    try { el.focus(); } catch (e) { /* not focusable */ }

    [['pointerover'], ['mouseover'], ['pointerenter'], ['mouseenter']].forEach(function (pair) {
      var p = pointer(pair[0]);
      if (p) face.dispatchEvent(p);
      face.dispatchEvent(mouse(pair[0]));
    });

    var pd = pointer('pointerdown');
    if (pd) face.dispatchEvent(pd);
    face.dispatchEvent(mouse('mousedown'));

    var upBits = { buttons: 0 };
    var pu = pointer('pointerup', upBits);
    if (pu) face.dispatchEvent(pu);
    face.dispatchEvent(mouse('mouseup', upBits));

    var pc = pointer('pointerclick', upBits);
    if (pc) face.dispatchEvent(pc);
    face.dispatchEvent(mouse('click', upBits));
    el.dispatchEvent(mouse('click', upBits));
  }

  /**
   * Press and release, with exactly ONE click event.
   *
   * `click()` above fires three click events (a pointer click, one on the face
   * and one on the element) because a button can sit behind wrappers that each
   * listen. That is harmless for a button that merely acts, but a dropdown
   * toggles on click, so three clicks open it and immediately close it again.
   */
  function clickOnce(el) {
    if (!el) throw new Error('clickOnce: element missing');
    var box = el.getBoundingClientRect();
    var x = box.left + box.width / 2;
    var y = box.top + box.height / 2;
    var base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: 1, detail: 1
    };
    var face = el.querySelector('.html-face') || el;
    try { el.focus(); } catch (e) { /* not focusable */ }

    var upBits = Object.assign({}, base, { buttons: 0 });

    // GWT's button tracks hover/press state through mouseover/mouseout. Without
    // them the element is left stuck in the "down-hovering" style and stops
    // toggling on later clicks.
    ['pointerover', 'mouseover', 'pointerenter', 'mouseenter'].forEach(function (type) {
      if (type.indexOf('pointer') === 0 && typeof PointerEvent !== 'function') return;
      face.dispatchEvent(type.indexOf('pointer') === 0
        ? new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, base))
        : new MouseEvent(type, base));
    });

    face.dispatchEvent(new MouseEvent('mousedown', base));
    face.dispatchEvent(new MouseEvent('mouseup', upBits));
    face.dispatchEvent(new MouseEvent('click', upBits));

    ['pointerout', 'mouseout', 'pointerleave', 'mouseleave'].forEach(function (type) {
      if (type.indexOf('pointer') === 0 && typeof PointerEvent !== 'function') return;
      face.dispatchEvent(type.indexOf('pointer') === 0
        ? new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, upBits))
        : new MouseEvent(type, upBits));
    });
  }

  function dblclick(el) {
    if (!el) throw new Error('dblclick: element missing');
    var box = el.getBoundingClientRect();
    var x = box.left + box.width / 2;
    var y = box.top + box.height / 2;

    function mouse(type, detail, buttons) {
      var base = {
        bubbles: true, cancelable: true, composed: true, view: window,
        clientX: x, clientY: y, screenX: x, screenY: y,
        button: 0, buttons: buttons, detail: detail
      };
      if (typeof PointerEvent === 'function' && type !== 'dblclick') {
        try {
          el.dispatchEvent(new PointerEvent('pointer' + type, Object.assign({
            pointerId: 1, pointerType: 'mouse', isPrimary: true
          }, base)));
        } catch (e) { /* ignore */ }
      }
      el.dispatchEvent(new MouseEvent(type, base));
    }

    mouse('down', 1, 1);
    mouse('up', 1, 0);
    mouse('click', 1, 0);
    mouse('down', 2, 1);
    mouse('up', 2, 0);
    mouse('click', 2, 0);
    mouse('dblclick', 2, 0);
  }

  function b64FromArrayBuffer(buf) {
    var bytes = new Uint8Array(buf);
    var chunk = 0x8000;
    var out = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function arrayBufferFromB64(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  /* --------------------------------------------------- app inventor handles */

  function blockly() {
    if (typeof Blockly === 'undefined') throw new Error('Blockly not loaded yet - wait for the editor to finish loading');
    return Blockly;
  }

  function workflow() {
    var ws;
    try { ws = blockly().getMainWorkspace(); } catch (e) { ws = null; }
    if (!ws) throw new Error('Blockly workspace unavailable - switch to the Blocks editor or wait for load');
    return ws;
  }

  function componentDb() {
    var ws = workflow();
    if (!ws.componentDb_) throw new Error('Component database unavailable - wait for the editor to finish loading');
    return ws.componentDb_;
  }

  function projectName() {
    try { if (typeof BlocklyPanel_getProjectName === 'function') return BlocklyPanel_getProjectName(); } catch (e) {}
    var el = document.querySelector('.ode-ProjectNameLabel');
    return el ? el.textContent.trim() : null;
  }

  function projectId() {
    try { if (typeof HTML5DragDrop_getOpenProjectId === 'function') return HTML5DragDrop_getOpenProjectId(); } catch (e) {}
    var m = (window.location.hash || '').match(/#(\d+)/);
    return m ? m[1] : null;
  }

  function instances() {
    return componentDb().instances_ || {};
  }

  function instanceList() {
    var inst = instances();
    var out = [];
    Object.keys(inst).forEach(function (k) {
      var i = inst[k];
      if (i && i.name) out.push({ name: i.name, type: i.typeName, uid: i.uid });
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  function selectedComponentName() {
    var el = document.querySelector('.ode-PropertiesComponentName');
    if (el && el.textContent.trim()) return el.textContent.trim();
    var tree = document.querySelector('.gwt-TreeItem-selected');
    return tree ? tree.textContent.trim() : null;
  }

  /**
   * The properties panel rebinds asynchronously after a tree click: the header
   * can briefly still name the previous component while the rows are already
   * (or not yet) swapped. Writing during that window lands on the WRONG
   * component, so every write waits until the panel names the target.
   */
  function waitForSelection(name) {
    return waitFor(function () { return selectedComponentName() === name; }, 6000)
      .then(function () { return sleep(180); })
      .catch(function () {
        throw new Error('Properties panel did not switch to "' + name + '" (still showing "' +
          selectedComponentName() + '"); refusing to write');
      });
  }

  /** Poll the property row until it shows the expected value, or time out. */
  function waitForRowValue(property, expected, timeoutMs) {
    var started = Date.now();
    function tick() {
      var row = propertyRow(property);
      var actual = row ? readRowValue(row) : null;
      if (sameValue(actual, expected)) return Promise.resolve(actual);
      if (Date.now() - started > (timeoutMs || 3000)) return Promise.resolve(actual);
      return sleep(120).then(tick);
    }
    return tick();
  }

  /** Current display value of a property row, for read-back verification. */
  function readRowValue(row) {
    var colorEditor = row.querySelector('.ode-ColorChoicePropertyEditor');
    if (colorEditor) {
      // A custom colour cannot be shown by this widget: ColorChoicePropertyEditor
      // only knows its swatches, so it falls back to "Default" after a repaint.
      // Colour writes are verified by re-reading the picker instead (see
      // setColorProperty); this value is only used for named swatches.
      var face = colorEditor.querySelector('.html-face') || colorEditor;
      return (face.textContent || '').replace(/\s+/g, ' ').trim();
    }

    var choiceEditor = row.querySelector('.ode-ChoicePropertyEditor');
    if (choiceEditor) {
      // "rounded : 1 ▾" -> "rounded"
      var text = (choiceEditor.textContent || '').replace(/\s*\u25be\s*$/, '').trim();
      return (text.split(':')[0] || '').trim();
    }
    var checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) return checkbox.checked;
    var select = row.querySelector('select');
    if (select) {
      var opt = select.options[select.selectedIndex];
      return opt ? opt.text : null;
    }
    var area = row.querySelector('textarea');
    if (area) return area.value;
    var input = row.querySelector('input.ode-PropertyEditor, input.ode-TextPropertyEditor');
    if (input) return input.value;
    var choice = row.querySelector('.ode-ColorChoicePropertyEditor, .ode-ChoicePropertyEditor');
    if (choice) return choice.textContent.trim();
    return null;
  }

  /** Normalise any colour spelling to AARRGGBB, or null. */
  function argbOf(value) {
    var v = String(value == null ? '' : value).trim();
    if (COLOR_BY_NAME[v.toLowerCase()]) v = COLOR_BY_NAME[v.toLowerCase()];
    var m = v.match(/^&H([0-9A-Fa-f]{8})$/);
    if (m) return m[1].toUpperCase();
    m = v.match(/^#([0-9A-Fa-f]{6})$/);
    if (m) return ('FF' + m[1]).toUpperCase();
    m = v.match(/^#([0-9A-Fa-f]{8})$/);
    if (m) return m[1].toUpperCase();
    return null;
  }

  function sameValue(actual, expected) {
    if (typeof actual === 'boolean') {
      return actual === (expected === true || expected === 'True' || expected === 'true' || expected === 1 || expected === '1');
    }
    var a = String(actual == null ? '' : actual).trim().replace(/\.+$/, '');
    var b = String(expected == null ? '' : expected).trim().replace(/\.+$/, '');
    if (a === b) return true;
    // Choice captions come back capitalised ("Center") while the value is
    // written lowercase ("center").
    if (a.toLowerCase() === b.toLowerCase()) return true;

    // Colours are spelled differently by the picker (#3D5AFE), the row summary
    // and the .scm (&HFF3D5AFE).
    var ca = argbOf(a);
    var cb = argbOf(b);
    if (ca && cb && ca === cb) return true;

    // The length editor summarises values: "56 pixels", "50 %", "-1050 pixels"
    var px = a.match(/^(-?\d+)\s*pixels?$/i);
    if (px) {
      var n = parseInt(px[1], 10);
      if (b === String(n)) return true;
      // percent values are stored as -1000 - percent but summarised as "... %"
      var pct = b.match(/^-(\d+)$/);
      if (pct && (-1000 - parseInt(pct[1], 10)) === n) return true;
    }
    var pc = a.match(/^(-?\d+)\s*(%|percent)$/i);
    if (pc) {
      var p = parseInt(pc[1], 10);
      if (b === String(-1000 - p)) return true;
      if (b === p + '%') return true;
    }
    return false;
  }

  function viewMode() {
    var designerTab = findButton('Designer');
    var blocksTab = findButton('Blocks');
    var designerActive = isActiveTab(designerTab);
    var blocksActive = isActiveTab(blocksTab);
    if (designerActive && !blocksActive) return 'designer';
    if (blocksActive && !designerActive) return 'blocks';
    if (document.querySelector('.blocklyWorkspace') && !document.querySelector('.ode-SimpleFormDesigner')) return 'blocks';
    if (document.querySelector('.ode-SimpleFormDesigner')) return 'designer';
    return 'unknown';
  }

  function ensureDesigner() {
    return new Promise(function (resolve) {
      dismissDialogs();
      if (viewMode() === 'designer') return resolve(true);
      var tab = findButton('Designer');
      if (!tab) throw new Error('Designer tab button not found');
      click(tab);
      setTimeout(function () { resolve(viewMode() === 'designer'); }, 900);
    });
  }

  function ensureBlocks() {
    return new Promise(function (resolve) {
      dismissDialogs();
      if (viewMode() === 'blocks') return resolve(true);
      var tab = findButton('Blocks');
      if (!tab) throw new Error('Blocks tab button not found');
      click(tab);
      setTimeout(function () { resolve(viewMode() === 'blocks'); }, 1200);
    });
  }

  /** Close leftover modal dialogs and dropdown popups that swallow clicks. */
  function dismissDialogs() {
    closePopups();
    var dialogs = document.querySelectorAll('.ode-DialogBox');
    for (var i = 0; i < dialogs.length; i++) {
      var buttons = dialogs[i].querySelectorAll('button, .ode-TextButton, .gwt-Button');
      for (var j = 0; j < buttons.length; j++) {
        var label = buttons[j].textContent.trim();
        if (/^(Dismiss|Close|Cancel|OK)$/i.test(label)) {
          try { click(buttons[j]); } catch (e) { /* ignore */ }
          break;
        }
      }
    }
  }

  /** Escape + hide any open GWT popup (dropdown menus, choice panels). */
  function closePopups() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (e) { /* ignore */ }
    var pops = document.querySelectorAll('.ode-MultipleChoicePropertyEditor, .ode-ChoicePropertyEditor-popup');
    for (var i = 0; i < pops.length; i++) {
      pops[i].style.display = 'none';
    }
  }

  /* ------------------------------------------------------ component select */

  function mockCandidates(name) {
    var out = [];
    var mock = document.querySelectorAll('.ode-SimpleMockComponent, .ode-MockComponent, .ode-MockForm');
    for (var i = 0; i < mock.length; i++) {
      var el = mock[i];
      if (el.getAttribute('data-ai-relay-name') === name) { out.push(el); continue; }
      if (el.textContent.indexOf(name) !== -1) out.push(el);
    }
    return out;
  }

  function selectComponent(name, force) {
    return new Promise(function (resolve, reject) {
      var db = componentDb();
      var found = null;
      Object.keys(db.instances_ || {}).forEach(function (k) {
        var i = db.instances_[k];
        if (i && i.name === name) found = i;
      });
      if (!found) return reject(new Error('Component not found: ' + name));
      if (!force && selectedComponentName() === name) return resolve({ selected: name, alreadySelected: true });

      var rowNode = document.querySelector('.ode-SourceStructureExplorer [data-name="' + name + '"]');
      if (rowNode) {
        var item = rowNode.querySelector('.gwt-TreeItem') || rowNode;
        var label = rowNode.querySelector('.gwt-HTML') || item;
        click(label);
        return setTimeout(function () {
          var got = selectedComponentName();
          if (got !== name) click(item);
          setTimeout(function () {
            resolve({ selected: selectedComponentName(), expected: name, via: 'tree' });
          }, 250);
        }, 250);
      }

      var candidates = mockCandidates(name);
      if (candidates.length) {
        click(candidates[0]);
        return setTimeout(function () {
          resolve({ selected: selectedComponentName(), expected: name, via: 'mock' });
        }, 400);
      }

      var treeItems = document.querySelectorAll('.gwt-TreeItem');
      for (var i = 0; i < treeItems.length; i++) {
        if (treeItems[i].textContent.trim() === name) {
          fire(treeItems[i], 'focus');
          click(treeItems[i]);
          return setTimeout(function () {
            resolve({ selected: selectedComponentName(), expected: name, via: 'tree-text' });
          }, 350);
        }
      }
      reject(new Error('Could not select component ' + name + ' (no mock or tree item)'));
    });
  }

  /* -------------------------------------------------------- blockly helpers */

  function workspaceXml(pretty) {
    var ws = workflow();
    var dom = Blockly.Xml.workspaceToDom(ws);
    return pretty ? Blockly.Xml.domToPrettyText(dom) : Blockly.Xml.domToText(dom);
  }

  function parseXml(xmlStr) {
    return Blockly.utils.xml.textToDom(xmlStr);
  }

  function blockSummary() {
    var ws = workflow();
    var blocks = ws.getAllBlocks(false) || [];
    var types = {};
    var top = [];
    blocks.forEach(function (b) {
      types[b.type] = (types[b.type] || 0) + 1;
    });
    (ws.getTopBlocks(true) || []).forEach(function (b) {
      top.push({ type: b.type, id: b.id, hasNext: !!b.getNextBlock() });
    });
    return { total: blocks.length, topLevel: top, types: types };
  }

  /* --------------------------------------------------- event/procedure scan */

  function scanEvents() {
    var ws = workflow();
    var dom = Blockly.Xml.workspaceToDom(ws);
    var out = [];
    var nodes = dom.querySelectorAll('block[type="component_event"]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var m = n.querySelector('mutation');
      out.push({
        id: n.getAttribute('id'),
        component: m && m.getAttribute('instance_name'),
        componentType: m && m.getAttribute('component_type'),
        event: m && m.getAttribute('event_name')
      });
    }
    return out;
  }

  function duplicateHandlers() {
    var events = scanEvents();
    var seen = {};
    var dups = [];
    events.forEach(function (e) {
      var key = e.component + '.' + e.event;
      if (seen[key]) dups.push({ handler: key, ids: [seen[key], e.id] });
      else seen[key] = e.id;
    });
    return dups;
  }

  /**
   * App Inventor's own block error/warning pass. The workspace keeps the
   * results in its warning handler; reading them turns a silent red triangle in
   * the editor into a machine-readable diagnostic.
   */
  function workspaceErrors() {
    var ws = workflow();
    var handler = null;
    try { handler = ws.getWarningHandler ? ws.getWarningHandler() : null; } catch (e) { handler = null; }
    if (!handler) return { available: false };

    function collect(hash) {
      var out = [];
      var ids = Object.keys(hash || {});
      for (var i = 0; i < ids.length; i++) {
        var block = ws.getBlockById(ids[i]);
        out.push({
          id: ids[i],
          type: block ? block.type : null,
          fields: block && block.getFieldValue && block.getFieldValue('PROCNAME') ? { PROCNAME: block.getFieldValue('PROCNAME') } : null
        });
      }
      return out;
    }

    var errors = collect(handler.errorIdHash);
    var warnings = collect(handler.warningIdHash);
    return {
      available: true,
      errorCount: handler.errorCount != null ? handler.errorCount : errors.length,
      errors: errors,
      warnings: warnings,
      byType: errors.reduce(function (acc, e) {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      }, {})
    };
  }

  function unknownComponentRefs() {    var known = {};
    instanceList().forEach(function (i) { known[i.name] = i.type; });
    var ws = workflow();
    var dom = Blockly.Xml.workspaceToDom(ws);
    var nodes = dom.querySelectorAll('mutation[instance_name]');
    var bad = [];
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var inst = nodes[i].getAttribute('instance_name');
      var blk = nodes[i].parentNode;
      if (inst && !known[inst] && !seen[inst]) {
        seen[inst] = true;
        bad.push({ instance: inst, blockId: blk && blk.getAttribute('id'), blockType: blk && blk.getAttribute('type') });
      }
    }
    return bad;
  }

  /* ---------------------------------------------------------- property edit */

  /** The editable text box inside a GWT dialog (skips disabled/readonly fields). */
  function dialogTextInput(dialog) {
    var inputs = dialog.querySelectorAll('input[type="text"], input.gwt-TextBox');
    var best = null;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].disabled || inputs[i].readOnly) continue;
      best = inputs[i]; // prefer the last editable field (rename dialogs list old name first)
    }
    return best;
  }

  function dialogButton(dialog, pattern) {
    var candidates = dialog.querySelectorAll('button, .ode-TextButton, .gwt-Button');
    for (var i = 0; i < candidates.length; i++) {
      if (pattern.test(candidates[i].textContent.trim())) return candidates[i];
    }
    return null;
  }

  function propertyRow(propName) {
    var label = document.querySelector('[id^="prop-label-' + propName + '-"]');
    if (!label) return null;
    var node = label;
    for (var i = 0; i < 6 && node; i++) {
      if (node.classList && node.classList.contains('ode-PropertyRow')) return node;
      node = node.parentElement;
    }
    return null;
  }

  /** Drive the Length editor popup (Automatic / Fill parent / px / %). */
  function chooseLengthValue(popup, value) {
    var radios = popup.querySelectorAll('input[type="radio"]');
    if (!radios.length) return false;

    var fields = popup.querySelectorAll('input[type="text"]');
    var raw = String(value).trim();
    var norm = raw.replace(/\.+$/, '').toLowerCase();
    var numeric = /^-?\d+$/.test(raw) ? parseInt(raw, 10) : null;

    // Accept the language the Designer uses: "50%" means the stored -1050.
    var pct = raw.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (pct && numeric === null) numeric = -(1000 + Math.round(parseFloat(pct[1])));

    function checkRadio(radio) {
      if (!radio) return false;
      try { radio.click(); } catch (e) { /* ignore */ }
      if (!radio.checked) radio.checked = true;
      fire(radio, 'input');
      fire(radio, 'change');
      return true;
    }

    function radioByText(re) {
      for (var i = 0; i < radios.length; i++) {
        var t = radios[i].parentElement ? radios[i].parentElement.textContent : '';
        if (re.test(t)) return radios[i];
      }
      return null;
    }

    function setField(field, text) {
      if (!field) return;
      field.focus();
      field.value = text;
      fire(field, 'input');
      fire(field, 'keyup');
      fire(field, 'change');
    }

    if (norm === 'automatic' || norm === 'auto') {
      checkRadio(radioByText(/automatic/i) || radios[0]);
    } else if (norm === 'fill parent' || norm === 'fill_parent' || norm === 'fillparent') {
      checkRadio(radioByText(/fill\s*parent/i) || radios[1]);
    } else if (numeric !== null) {
      if (numeric <= -1000) {
        // percent: the custom-length radio has no caption, so go by position
        checkRadio(radios[3] || radios[radios.length - 1]);
        setField(fields.length > 1 ? fields[fields.length - 1] : fields[0], String(-numeric - 1000));
      } else {
        checkRadio(radios[2] || radios[radios.length - 1]);
        setField(fields[0], String(Math.max(0, numeric)));
      }
    } else {
      return false;
    }

    return sleep(200).then(function () {
      var ok = dialogButton(popup, /^(OK|Ok)$/i);
      if (!ok) throw new Error('OK button not found in the length editor');
      click(ok);
      return sleep(300).then(function () { return { kind: 'length', value: raw }; });
    });
  }

  /** Open the additional-choice popup for editors like the asset selector. */
  function chooseAdditionalValue(row, value) {
    var field = row.querySelector('input.ode-PropertyEditor');
    if (!field) throw new Error('no editor field in this property row');
    field.focus();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return waitFor(function () { return document.querySelector('.ode-MultipleChoicePropertyEditor'); }, 5000)
      .then(function (popup) {
        var select = popup.querySelector('select');
        if (select) {
          var match = null;
          for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].text === String(value) || select.options[i].value === String(value)) { match = select.options[i]; break; }
          }
          if (!match) {
            var available = [];
            for (var j = 0; j < select.options.length; j++) available.push(select.options[j].text);
            throw new Error('Option not found: ' + value + ' (available: ' + available.join(', ') + ')');
          }
          select.value = match.value;
          fire(select, 'change');
          return sleep(200).then(function () { return popup; });
        }

        // Length editor path
        return chooseLengthValue(popup, value).then(function (res) {
          if (res === false) {
            try { closePopups(); } catch (e) { /* ignore */ }
            throw new Error('This choice editor cannot take "' + value + '"; set it in the Designer UI');
          }
          return null;
        });
      })
      .then(function (popup) {
        if (!popup) return { kind: 'length', value: String(value) };
        var ok = dialogButton(popup, /^(OK|Ok)$/i);
        if (!ok) throw new Error('OK button not found in the choice dialog');
        click(ok);
        return sleep(300).then(function () { return { kind: 'choice', value: value }; });
      });
  }

  /** Named colours the Designer's swatches offer, and what the .scm stores. */
  var COLOR_BY_NAME = {
    none: '&H00000000', default: '&H00000000', black: '&HFF000000', blue: '&HFF0000FF',
    cyan: '&HFF00FFFF', darkgray: '&HFF444444', gray: '&HFF888888', green: '&HFF00FF00',
    lightgray: '&HFFCCCCCC', magenta: '&HFFFF00FF', orange: '&HFFFFC800', pink: '&HFFFFAFAF',
    red: '&HFFFF0000', white: '&HFFFFFFFF', yellow: '&HFFFFFF00'
  };

  /** Captions for choice editors whose stored value is a code, not a word. */
  var CHOICE_CAPTIONS = {
    text: { '0': 'left', '1': 'center', '2': 'right' },
    horizontal: { '1': 'left', '2': 'right', '3': 'center' },
    vertical: { '1': 'top', '2': 'center', '3': 'bottom' }
  };

  /** `&HFF3D5AFE` / `#3D5AFE` / `Blue` -> `#3D5AFE` for the Pickr hex field. */
  function toPickerHex(value) {
    var v = String(value == null ? '' : value).trim();
    if (COLOR_BY_NAME[v.toLowerCase()]) v = COLOR_BY_NAME[v.toLowerCase()];
    var m = v.match(/^&H([0-9A-Fa-f]{8})$/);
    if (m) {
      var alpha = m[1].slice(0, 2).toUpperCase();
      var rgb = m[1].slice(2).toUpperCase();
      return alpha === 'FF' ? '#' + rgb : '#' + rgb + alpha;
    }
    m = v.match(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/);
    if (m) return '#' + m[1].toUpperCase();
    return null;
  }

  /**
   * Press and release with only the events a click needs.
   *
   * clickOnce() also fires mouseover/mouseout so GWT's button styling settles,
   * but Pickr (the colour picker) treats a pointer leaving the widget as "close
   * me", so the hover events have to be left out here.
   */
  function clickPlain(el) {
    var box = el.getBoundingClientRect();
    var base = {
      bubbles: true, cancelable: true, view: window,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2,
      screenX: box.left + box.width / 2, screenY: box.top + box.height / 2,
      button: 0, buttons: 1, detail: 1
    };
    var face = el.querySelector('.html-face') || el;
    try { el.focus(); } catch (e) { /* not focusable */ }
    face.dispatchEvent(new MouseEvent('mousedown', base));
    var up = Object.assign({}, base, { buttons: 0 });
    face.dispatchEvent(new MouseEvent('mouseup', up));
    face.dispatchEvent(new MouseEvent('click', up));
  }

  /**
   * The colour editor is a TextButton that opens Pickr (.pcr-app): a hex field
   * plus Save. Typing the hex and pressing Save is the same path a human takes.
   */
  /**
   * Pickr stays open until it is told otherwise, and a stray click leaves it
   * covering the panel: the next open would then toggle it shut instead. Every
   * colour write starts by closing whatever is there.
   */
  function openPickers() {
    return [].slice.call(document.querySelectorAll('.pcr-app.visible'));
  }

  function closePickerIfOpen() {
    var open = openPickers();
    if (!open.length) return Promise.resolve(false);
    open.forEach(function (app) {
      var cancel = app.querySelector('.pcr-cancel');
      if (cancel) cancel.click();
    });
    return sleep(180).then(function () {
      if (!openPickers().length) return true;
      var editor = document.querySelector('.ode-ColorChoicePropertyEditor');
      if (editor) clickPlain(editor);
      return sleep(180).then(function () { return !openPickers().length; });
    });
  }

  /**
   * Pickr appends its panel to the document, one panel per editor that has ever
   * been opened. After the first colour change another panel exists, so
   * document.querySelector('.pcr-app.visible') can hand back the wrong one and
   * the keystrokes land on another row. Match by proximity instead.
   */
  function pickerFor(editor) {
    var rect = editor.getBoundingClientRect();
    var best = null;
    var bestDistance = Infinity;
    openPickers().forEach(function (app) {
      var b = app.getBoundingClientRect();
      var dx = Math.max(b.left - rect.right, rect.left - b.right, 0);
      var dy = Math.max(b.top - rect.bottom, rect.top - b.bottom, 0);
      var distance = dx + dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = app;
      }
    });
    return best;
  }

  function setColorProperty(editor, value) {
    var hex = toPickerHex(value);
    if (!hex) throw new Error('Not a colour: ' + value);
    return closePickerIfOpen().then(function () {
      clickPlain(editor);
      return waitFor(function () { return pickerFor(editor); }, 4000).catch(function () {
        throw new Error('Colour picker did not open (expected .pcr-app)');
      });
    }).then(function (app) {
      // Pickr attaches its field handlers a tick after the panel appears; typing
      // before that leaves Save committing the colour that was already there.
      return sleep(400).then(function () { return app; });
    }).then(function (app) {
      var input = app.querySelector('.pcr-result');
      var save = app.querySelector('.pcr-save');
      if (!input || !save) throw new Error('Colour picker is missing its hex field or Save button');
      input.focus();
      input.value = hex;
      // Pickr updates its internal colour from keyboard events, not from
      // setting .value: without the key sequence Save commits the *previous*
      // colour, which looks like a successful write that silently does nothing.
      ['keydown', 'keypress', 'input', 'keyup', 'change', 'blur'].forEach(function (type) {
        var ev;
        try {
          ev = type.indexOf('key') === 0
            ? new KeyboardEvent(type, { bubbles: true, cancelable: true })
            : new Event(type, { bubbles: true });
        } catch (e) {
          ev = new Event(type, { bubbles: true });
        }
        input.dispatchEvent(ev);
      });
      // Pickr debounces the field handler; clicking Save in the same tick
      // commits the colour that was there *before* typing.
      return sleep(600).then(function () {
        save.click();
        return sleep(220);
      }).then(function () {
        return { kind: 'colour', value: hex };
      });
    });
  }

  /**
   * Alignment, typeface and shape use the same DropDownButton as the screen
   * selector: one click opens the menu, one click picks the item.
   */
  function setChoiceProperty(editor, caption) {
    clickOnce(editor);
    return waitFor(function () {
      var menu = document.querySelector('.ode-ContextMenu');
      return menu && menu.querySelectorAll('.ode-ContextMenuItem').length ? menu : null;
    }, 4000).catch(function () {
      throw new Error('Choice menu did not open for "' + caption + '"');
    }).then(function () {
      var items = document.querySelectorAll('.ode-ContextMenu .ode-ContextMenuItem');
      var wanted = String(caption).trim().toLowerCase();
      for (var i = 0; i < items.length; i++) {
        var full = (items[i].textContent || '').trim();
        // Items are rendered as "caption : code" (e.g. "rounded : 1"), so accept
        // either the caption or the code.
        var parts = full.split(':');
        var label = (parts[0] || '').trim().toLowerCase();
        var code = (parts[1] || '').trim();
        if (label === wanted || full.toLowerCase() === wanted || code === wanted) {
          clickOnce(items[i]);
          return sleep(220).then(function () { return { kind: 'choice', value: label }; });
        }
      }
      throw new Error('Choice "' + caption + '" is not in the menu (' +
        [].map.call(items, function (it) { return (it.textContent || '').trim(); }).join(', ') + ')');
    });
  }

  function setPropertyOnRow(row, value, propertyName) {
    var colorEditor = row.querySelector('.ode-ColorChoicePropertyEditor');
    if (colorEditor) return setColorProperty(colorEditor, value);

    var choiceEditor = row.querySelector('.ode-ChoicePropertyEditor');
    if (choiceEditor) {
      var caption = String(value);
      if (/^[0-9]$/.test(caption)) {
        var name = String(propertyName || '');
        var axis = /^TextAlignment$/i.test(name) ? 'text'
          : /^AlignHorizontal$/i.test(name) ? 'horizontal'
            : /^AlignVertical$/i.test(name) ? 'vertical' : null;
        if (axis && CHOICE_CAPTIONS[axis][caption]) caption = CHOICE_CAPTIONS[axis][caption];
      }
      return setChoiceProperty(choiceEditor, caption);
    }

    var input = row.querySelector('input.ode-PropertyEditor, input.ode-TextPropertyEditor');
    if (input && input.readOnly) {
      // Asset / dependent-choice editors only commit through their popup.
      return chooseAdditionalValue(row, value);
    }
    if (input && input.type !== 'checkbox') {
      input.focus();
      input.value = String(value);
      fire(input, 'input');
      fire(input, 'keyup');
      fire(input, 'change');
      input.blur();
      return Promise.resolve({ kind: 'text', value: input.value });
    }
    var checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) {
      var want = value === true || value === 'true' || value === 'True' || value === 1 || value === '1';
      if (checkbox.checked !== want) {
        // An untrusted click event does not toggle a checkbox; the native
        // .click() method does, and GWT listens for the resulting change event.
        try { checkbox.click(); } catch (e) { /* ignore */ }
        if (checkbox.checked !== want) {
          checkbox.checked = want;
          fire(checkbox, 'click');
          fire(checkbox, 'change');
        }
        fire(checkbox, 'input');
      }
      return Promise.resolve({ kind: 'checkbox', value: checkbox.checked });
    }
    var select = row.querySelector('select.gwt-ListBox, select');
    if (select) {
      var match = null;
      for (var i = 0; i < select.options.length; i++) {
        var o = select.options[i];
        if (o.value === String(value) || o.text === String(value)) { match = o; break; }
      }
      if (!match) {
        throw new Error('Option not found: ' + value + ' (available: ' +
          Array.prototype.map.call(select.options, function (o) { return o.text; }).slice(0, 20).join(', ') + ')');
      }
      select.value = match.value;
      fire(select, 'change');
      return Promise.resolve({ kind: 'select', value: match.text });
    }
    var area = row.querySelector('textarea');
    if (area) {
      area.focus();
      area.value = String(value);
      fire(area, 'input');
      fire(area, 'change');
      area.blur();
      return Promise.resolve({ kind: 'textarea', value: area.value });
    }
    throw new Error('No editable control found for this property');
  }

  /* ------------------------------------------------------------------- RPC */

  var H = {};

  H.ping = function () {
    return { ok: true, version: VERSION, url: location.href, view: viewMode() };
  };

  H.state = function () {
    var out = {
      url: location.href,
      projectName: projectName(),
      projectId: projectId(),
      view: viewMode(),
      // Which screen the Designer has open. `components` below belongs to this
      // screen only, so a reader must not compare it against another screen's
      // .scm and conclude the project is out of date.
      screen: currentScreen(),
      selected: selectedComponentName(),
      intercepted: (window.__aiRelayDialogs || []).slice(-10)
    };
    try {
      out.componentCount = instanceList().length;
      out.components = instanceList();
    } catch (e) { out.componentError = e.message; }
    try { out.blocks = blockSummary(); } catch (e) { out.blocksError = e.message; }
    return out;
  };

  /* --- project --- */

  H['project.info'] = function () {
    return {
      name: projectName(),
      id: projectId(),
      url: location.href,
      user: (function () {
        var el = document.querySelector('[class*="UserEmail"], .ode-TopPanelAccountEmail');
        return el ? el.textContent.trim() : null;
      })()
    };
  };

  H['project.exportAia'] = function () {
    var id = projectId();
    var name = projectName();
    if (!id || !name) throw new Error('No project open');
    var url = '/ode/download/project-source/' + id + '/' + encodeURIComponent(name);
    return fetch(url, { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) throw new Error('export failed: HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (buf) {
        return {
          projectId: id,
          projectName: name,
          bytes: buf.byteLength,
          base64: b64FromArrayBuffer(buf)
        };
      });
  };

  H['project.importAia'] = function (p) {
    if (!p || !p.name || !p.base64) throw new Error('name and base64 are required');
    var bytes = new Uint8Array(arrayBufferFromB64(p.base64));
    var blob = new Blob([bytes], { type: 'application/zip' });
    var fd = new FormData();
    fd.append('uploadProjectArchive', blob, p.name + '.aia');
    return fetch('/ode/upload/project/' + encodeURIComponent(p.name), {
      method: 'POST', body: fd, credentials: 'include'
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var m = text.match(/\[UPLOAD RESPONSE BEGIN\]([\s\S]*?)\[UPLOAD RESPONSE END\]/);
        var payload = m ? m[1] : text;
        var parts = payload.split('#DELIM#');
        return {
          raw: payload,
          success: parts[0] === 'SUCCESS',
          status: parts[0],
          projectId: parts[3] || null,
          projectName: parts[4] || null
        };
      });
  };

  /**
   * Set project-level properties through the Project Properties dialog.
   *
   * Writing youngandroidproject/project.properties directly does NOT work for
   * the colour properties and theme: the file is rewritten from the client's
   * settings, so the change is reverted (the theme appears to survive only
   * because it is also mirrored in each .scm). The dialog is what the editor
   * itself uses, and its values persist.
   */
  /**
   * Set project-level properties through the Project Properties dialog.
   *
   * Writing youngandroidproject/project.properties directly does NOT work for
   * the colour properties: the file is rewritten from the editor's settings and
   * the change is reverted. The dialog is what the editor itself uses, and its
   * values persist.
   *
   * One dialog per property on purpose. Three colour pickers driven in one
   * dialog session overwrite each other (they share Pickr panels), and the
   * first write into a freshly opened dialog can be dropped.
   */
  H['project.setProperties'] = function (p) {
    var wanted = (p && p.props) || {};
    var keys = Object.keys(wanted);
    if (!keys.length) throw new Error('props required');

    // Theme captions from YoungAndroidThemeChoicePropertyEditor.
    var THEME_CAPTIONS = {
      'Classic': 'Classic',
      'AppTheme.Light.DarkActionBar': 'Device Default',
      'AppTheme.Light': 'Black Title Text',
      'AppTheme': 'Dark'
    };

    var TITLES = {
      theme: 'Theme',
      'color.primary': 'PrimaryColor',
      'color.primary.dark': 'PrimaryColorDark',
      'color.accent': 'AccentColor',
      aname: 'AppName',
      versioncode: 'VersionCode',
      versionname: 'VersionName'
    };

    function sameValueInDialog(a, b) {
      if (a == null) return false;
      var x = String(a).trim().toLowerCase();
      var y = String(b).trim().toLowerCase();
      if (x === y) return true;
      function argb(v) {
        var m = v.match(/^&h([0-9a-f]{8})$/);
        if (m) return m[1];
        m = v.match(/^#([0-9a-f]{6})$/);
        if (m) return 'ff' + m[1];
        m = v.match(/^#([0-9a-f]{8})$/);
        if (m) return m[1];
        return null;
      }
      var ca = argb(x);
      var cb = argb(y);
      return !!(ca && cb && ca === cb);
    }

    function dialogEl() {
      return document.querySelector('.ode-DialogBox, .gwt-DialogBox');
    }

    function containerIn(dlg, title) {
      var found = null;
      dlg.querySelectorAll('.ode-propertyDialogPropertyContainer').forEach(function (c) {
        var t = c.querySelector('.ode-propertyDialogPropertyTitle');
        if (found || !t) return;
        if ((t.textContent || '').trim().toLowerCase() === title.toLowerCase()) found = c;
      });
      return found;
    }

    function readContainer(c) {
      var editor = c.querySelector('.ode-propertyDialogPropertyEditor');
      // Choice captions render with a caret ("Device Default \u25be").
      if (editor) return (editor.textContent || '').replace(/\s*\u25be\s*$/, '').trim().replace(/\s+/g, ' ');
      var input = c.querySelector('input');
      if (input && input.type === 'checkbox') return input.checked;
      return input ? input.value : null;
    }

    function closeDialog() {
      var dlg = dialogEl();
      if (!dlg) return Promise.resolve();
      var close = null;
      dlg.querySelectorAll('button, .gwt-Button').forEach(function (b) {
        if (!close && (b.textContent || '').trim() === 'Close') close = b;
      });
      if (close) clickOnce(close);
      return sleep(300).then(function () {
        if (document.querySelector('.ode-DialogBox, .gwt-DialogBox')) {
          closePopups();
          return sleep(200);
        }
        return null;
      });
    }

    /** Open the dialog, set one property, read it back, close. */
    function setOne(key, value) {
      var title = TITLES[key] || key;
      return closeDialog().then(function () {
        var button = findButton('Project Properties');
        if (!button) throw new Error('Project Properties button not found');
        clickOnce(button);
        return waitFor(dialogEl, 6000);
      }).then(function (dlg) {
        return sleep(600).then(function () { return dlg; });
      }).then(function (dlg) {
        var c = containerIn(dlg, title);
        if (!c) throw new Error('No "' + title + '" in Project Properties (key ' + key + ')');
        var editor = c.querySelector('.ode-propertyDialogPropertyEditor');
        if (!editor) {
          var input = c.querySelector('input');
          if (!input) throw new Error('No editor for ' + title);
          input.focus();
          input.value = String(value);
          fire(input, 'input');
          fire(input, 'change');
          input.blur();
          return sleep(150).then(function () { return readContainer(c); });
        }
        var isColour = /^(&H|#)/i.test(String(value));
        var asCaption = key === 'theme' ? (THEME_CAPTIONS[String(value)] || String(value)) : String(value);
        return Promise.resolve(isColour ? setColorProperty(editor, String(value)) : setChoiceProperty(editor, asCaption))
          .then(function () { return sleep(250); })
          .then(function () { return readContainer(c); });
      }).then(function (read) {
        return closeDialog().then(function () { return read; });
      });
    }

    var applied = {};
    var unsupported = [];
    var chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        var expected = key === 'theme' ? (THEME_CAPTIONS[String(wanted[key])] || String(wanted[key])) : wanted[key];
        return setOne(key, wanted[key]).then(function (read) {
          if (sameValueInDialog(read, expected)) {
            applied[key] = read;
            return null;
          }
          // Second attempt in a fresh dialog: a dropped first write is common.
          return setOne(key, wanted[key]).then(function (read2) {
            if (!sameValueInDialog(read2, expected)) {
              unsupported.push({
                key: key,
                requested: String(wanted[key]),
                actual: read2,
                reason: 'the Project Properties editor accepted the picker but never applied the value (this build derives it from the theme)'
              });
              return null;
            }
            applied[key] = read2;
          });
        });
      });
    });

    return chain.then(function () { return { applied: applied, unsupported: unsupported }; });
  };

  H['project.uploadAsset'] = function (p) {
    if (!p || !p.name || !p.base64) throw new Error('name and base64 are required');
    var pid = projectId();
    if (!pid) throw new Error('No project open');
    var target = p.path || ('assets/' + p.name);
    var bytes = new Uint8Array(arrayBufferFromB64(p.base64));
    var blob = new Blob([bytes], { type: p.mime || 'application/octet-stream' });
    var fd = new FormData();
    fd.append('uploadFile', blob, p.name);
    var urlPath = target.split('/').map(encodeURIComponent).join('/');
    return fetch('/ode/upload/file/' + pid + '/' + urlPath, {
      method: 'POST', body: fd, credentials: 'include'
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var m = text.match(/\[UPLOAD RESPONSE BEGIN\]([\s\S]*?)\[UPLOAD RESPONSE END\]/);
        var payload = m ? m[1] : text;
        var parts = payload.split('#DELIM#');
        return {
          raw: payload.slice(0, 300),
          success: parts[0] === 'SUCCESS',
          status: parts[0],
          bytes: bytes.length,
          path: target
        };
      });
  };

  H['project.open'] = function (p) {
    if (!p || !p.projectId) throw new Error('projectId required');
    window.location.hash = '#' + p.projectId;
    return { navigating: true, note: 'The relay is re-established after the page reloads.' };
  };

  /* --- screens --- */

  H['designer.addScreen'] = function (p) {
    var name = (p && p.name) || 'Screen';
    return ensureDesigner().then(function () {
      var btn = findButton('Add Screen ...') || findButton('Add Screen');
      if (!btn) throw new Error('Add Screen button not found');
      click(btn);
    }).then(function () {
      return waitFor(function () { return document.querySelector('.ode-DialogBox'); }, 6000);
    }).then(function (dialog) {
      var input = dialogTextInput(dialog);
      if (!input) throw new Error('Screen name input not found in dialog');
      input.focus();
      input.value = name;
      fire(input, 'input');
      var ok = dialogButton(dialog, /^(OK|Ok|Add|Add Screen)$/);
      if (!ok) throw new Error('OK button not found in dialog');
      click(ok);
      return sleep(900).then(function () {
        var dlg = document.querySelector('.ode-DialogBox');
        var dialogText = null;
        if (dlg) {
          dialogText = dlg.innerText.replace(/\s+/g, ' ');
          try { dismissDialogs(); } catch (e) { /* ignore */ }
          if (/already|exists|invalid/i.test(dialogText)) {
            throw new Error('Screen add failed: ' + dialogText.slice(0, 200));
          }
        }
        return { screen: name, dialogText: dialogText, verified: false, note: 'Confirm with ai_screens_list' };
      });
    });
  };

  H['designer.removeScreen'] = function (p) {
    var name = p && p.name;
    if (!name) throw new Error('name required');
    return ensureDesigner().then(function () {
      var current = null;
      try {
        var inst = instances();
        Object.keys(inst).forEach(function (k) {
          if (inst[k] && inst[k].typeName === 'Form') current = inst[k].name;
        });
      } catch (e) { /* ignore */ }
      if (current && current !== name) {
        throw new Error('Cannot remove screen "' + name + '": only the screen currently open in the Designer can be removed (open: "' + current + '"). Use ai_screen_switch first.');
      }
      var btn = findButton('Remove Screen');
      if (!btn) throw new Error('Remove Screen button not found');
      click(btn);
      return waitFor(function () { return document.querySelector('.ode-DialogBox'); }, 8000);
    }).then(function (dialog) {
      // The removal dialog demands the screen name typed into a text box.
      var input = dialogTextInput(dialog);
      if (input) {
        input.focus();
        input.value = name;
        fire(input, 'input');
        fire(input, 'change');
      }
      return sleep(200).then(function () { return dialog; });
    }).then(function (dialog) {
      var del = dialogButton(dialog, /^Delete$/i) || dialogButton(dialog, /^(OK|Ok|Yes|Remove)$/i);
      if (!del) throw new Error('Delete button not found in the Remove Screen dialog');
      click(del);
      return sleep(1500);
    }).then(function () {
      var names = [];
      try {
        var inst2 = instances();
        Object.keys(inst2).forEach(function (k) {
          if (inst2[k] && inst2[k].name) names.push(inst2[k].name);
        });
      } catch (e) { /* ignore */ }
      var stillThere = document.querySelector('.ode-DialogBox');
      var dialogText = stillThere ? stillThere.innerText.replace(/\s+/g, ' ').slice(0, 200) : null;
      if (stillThere) {
        try { dismissDialogs(); } catch (e) { /* ignore */ }
      }
      return { screen: name, blocksRemaining: names, dialogText: dialogText };
    });
  };

  /** Name of the screen open in the Designer, read from the live model. */
  function currentScreen() {
    var current = null;
    try {
      var inst = instances();
      Object.keys(inst).forEach(function (k) {
        if (inst[k] && inst[k].typeName === 'Form') current = inst[k].name;
      });
    } catch (e) { /* relay attached before the editor finished loading */ }
    return current;
  }

  /**
   * The toolbar screen selector: "<current screen> \u25be". Its class differs
   * between Classic (.ode-TextButton) and Neo (.ode-ProjectListButton), so it is
   * found by its caret, then filtered to exclude the other carets on screen
   * (Projects/Connect/Build/Settings/Help/language/account and the
   * components-tree filter, which also says "All Components \u25be").
   */
  function findScreenSelector() {
    var candidates = document.querySelectorAll('.ode-TextButton, .ode-ProjectListButton, button, .ode-TopPanelButton');
    for (var i = 0; i < candidates.length; i++) {
      var txt = (candidates[i].textContent || '').trim();
      if (txt.indexOf('\u25be') === -1) continue;
      if (/^(Projects|Connect|Build|Settings|Help|English)\b/i.test(txt)) continue;
      if (txt.indexOf('@') !== -1) continue;
      if (/components-tree-filter/.test(String(candidates[i].className || ''))) continue;
      return candidates[i];
    }
    return null;
  }

  /**
   * Open the screen menu.
   *
   * The selector is a toggle, and App Inventor can be left believing the menu is
   * still showing after a previous switch, in which case the next click closes
   * it instead of opening it. So: reuse a menu that is already open, otherwise
   * click until one with items is actually in the DOM.
   */
  function openScreenMenu(trigger) {
    function openMenu() {
      var menu = document.querySelector('.ode-ContextMenu');
      if (!menu) return null;
      return menu.querySelectorAll('.ode-ContextMenuItem').length ? menu : null;
    }
    if (openMenu()) return Promise.resolve(openMenu());
    var attempts = 0;
    function attempt() {
      attempts++;
      clickOnce(trigger);
      return sleep(300).then(function () {
        var menu = openMenu();
        if (menu) return menu;
        if (attempts >= 4) throw new Error('Screen selector did not open after ' + attempts + ' clicks');
        return attempt();
      });
    }
    return attempt();
  }

  H['designer.switchScreen'] = function (p) {
    var name = p && p.name;
    if (!name) throw new Error('name required');
    return ensureDesigner().then(function () {
      var before = currentScreen();
      if (before === name) {
        return { requested: name, previous: before, current: before, switched: false };
      }

      var trigger = findScreenSelector();
      if (!trigger) throw new Error('Screen selector not found (is a project open?)');

      return openScreenMenu(trigger).then(function () {
        var entry = byText('.ode-ContextMenuItem', name)
          || byText('.gwt-MenuItem', name)
          || byText('td', name)
          || byText('.gwt-HTML', name);
        if (!entry) {
          closePopups();
          throw new Error('Screen not found in the selector menu: ' + name);
        }
        clickOnce(entry.closest('.ode-ContextMenuItem') || entry);
        return sleep(2500);
      }).then(function () {
        var current = currentScreen();
        if (current !== name) {
          throw new Error('Screen switch did not take effect (still on "' + current + '")');
        }
        return { requested: name, previous: before, current: current, switched: true };
      });
    });
  };

  /* --- components --- */

  H['designer.select'] = function (p) {
    if (!p || !p.name) throw new Error('name required');
    return ensureDesigner().then(function () { return selectComponent(p.name); });
  };

  H['designer.addComponent'] = function (p) {
    if (!p || !p.type) throw new Error('type required');
    var type = p.type;
    var name = p.name || type;
    var parent = p.parent || null;

    return ensureDesigner()
      .then(function () {
        if (parent) return selectComponent(parent);
      })
      .then(function () {
        var item = byText('.ode-SimplePaletteItem', type);
        if (!item) {
          var items = document.querySelectorAll('.ode-SimplePaletteItem');
          for (var i = 0; i < items.length; i++) {
            if (items[i].textContent.trim().toLowerCase() === type.toLowerCase()) { item = items[i]; break; }
          }
        }
        if (!item) throw new Error('Palette item not found: ' + type);
        dblclick(item);
        return sleep(800);
      })
      .then(function () {
        var before = instances();
        return waitFor(function () {
          var now = instances();
          return Object.keys(now).length > Object.keys(before).length ? now : null;
        }, 8000).catch(function () { return instances(); });
      })
      .then(function (now) {
        var names = [];
        Object.keys(now).forEach(function (k) { if (now[k] && now[k].name) names.push(now[k].name); });
        var added = names.filter(function (n) {
          var base = type;
          return n === base || new RegExp('^' + base.replace(/[^\w]/g, '') + '\\d+$').test(n);
        });
        var newest = added.sort(function (a, b) {
          var na = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
          var nb = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
          return nb - na;
        })[0];
        if (!newest) throw new Error('Component was not added (palette double-click had no effect)');
        return { created: newest, type: type };
      })
      .then(function (res) {
        if (!name || name === type || name === res.created) return res;
        return H['designer.renameComponent']({ from: res.created, to: name }).then(function () {
          return { created: name, previousName: res.created, type: type, renamed: true };
        }, function (err) {
          // Do not leave a half-created component behind when the rename fails.
          return Promise.resolve(H['designer.removeComponent']({ name: res.created }))
            .catch(function () { /* best effort */ })
            .then(function () {
              throw new Error('Component added as "' + res.created + '" but renaming to "' + name +
                '" failed; the component was removed again. ' + err.message);
            });
        });
      });
  };

  H['designer.renameComponent'] = function (p) {
    if (!p || !p.from || !p.to) throw new Error('from and to required');
    return ensureDesigner()
      .then(function () { return selectComponent(p.from, true); })
      .then(function (sel) {
        if (sel.selected !== p.from) throw new Error('Could not select "' + p.from + '" (selected "' + sel.selected + '")');
        return waitForSelection(p.from);
      })
      .then(function () {
        var groups = document.querySelectorAll('.ode-SourceStructureExplorer .ode-PanelButtons');
        var target = null;
        for (var g = 0; g < groups.length; g++) {
          var btn = byText('.ode-TextButton', 'Rename', groups[g]);
          if (btn && btn.className.indexOf('disabled') === -1) { target = btn; break; }
        }
        if (!target) throw new Error('Enabled Rename button not found');
        click(target);
        return waitFor(function () { return document.querySelector('.ode-DialogBox'); }, 6000);
      })
      .then(function (dialog) {
        var input = dialogTextInput(dialog);
        if (!input) throw new Error('Rename input not found');
        input.focus();
        input.value = p.to;
        fire(input, 'input');
        var ok = dialogButton(dialog, /^(OK|Ok|Rename)$/);
        if (!ok) throw new Error('OK button not found in rename dialog');
        click(ok);
        return sleep(800);
      })
      .then(function () {
        var names = instanceList().map(function (i) { return i.name; });
        if (names.indexOf(p.to) === -1) {
          throw new Error('Rename did not apply (dialog rejected "' + p.to + '"); components now: ' + names.join(', '));
        }
        if (p.from !== p.to && names.indexOf(p.from) !== -1) {
          throw new Error('Rename renamed the wrong component: "' + p.from + '" still exists. Renamed selection to "' + p.to + '". Components: ' + names.join(', '));
        }
        return { from: p.from, to: p.to, verified: true };
      });
  };

  H['designer.removeComponent'] = function (p) {
    if (!p || !p.name) throw new Error('name required');
    return ensureDesigner()
      .then(function () { return selectComponent(p.name); })
      .then(function () { return sleep(300); })
      .then(function () {
        var groups = document.querySelectorAll('.ode-SourceStructureExplorer .ode-PanelButtons');
        var target = null;
        for (var g = 0; g < groups.length; g++) {
          var btn = byText('.ode-TextButton', 'Delete', groups[g]);
          if (btn && btn.className.indexOf('disabled') === -1) { target = btn; break; }
        }
        if (!target) throw new Error('Enabled Delete button not found');
        click(target);
        return sleep(600);
      })
      .then(function () {
        var dlg = document.querySelector('.ode-DialogBox');
        if (dlg) {
          var yes = dialogButton(dlg, /^(OK|Ok|Yes|Delete)$/);
          if (yes) click(yes);
          return sleep(700);
        }
      })
      .then(function () {
        var names = instanceList().map(function (i) { return i.name; });
        if (names.indexOf(p.name) !== -1) {
          throw new Error('Component still present after delete: ' + p.name);
        }
        return { removed: p.name, verified: true };
      });
  };

  H['designer.getProperties'] = function (p) {
    if (!p || !p.component) throw new Error('component required');
    return ensureDesigner()
      .then(function () { return selectComponent(p.component); })
      .then(function () { return waitForSelection(p.component); })
      .then(function () {
        var rows = document.querySelectorAll('.ode-PropertyRow');
        var out = {};
        for (var i = 0; i < rows.length; i++) {
          var label = rows[i].querySelector('.ode-PropertyLabel');
          if (!label) continue;
          var key = label.textContent.trim();
          var input = rows[i].querySelector('input.ode-PropertyEditor, input.ode-TextPropertyEditor');
          var checkbox = rows[i].querySelector('input[type="checkbox"]');
          var select = rows[i].querySelector('select');
          var area = rows[i].querySelector('textarea');
          var color = rows[i].querySelector('.ode-ColorChoicePropertyEditor');
          if (checkbox) out[key] = checkbox.checked;
          else if (select) out[key] = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : null;
          else if (area) out[key] = area.value;
          else if (input && input.type !== 'checkbox') out[key] = input.value;
          else if (color) out[key] = color.textContent.trim();
          else out[key] = null;
        }
        return { component: p.component, properties: out };
      });
  };

  H['designer.setProperty'] = function (p) {
    if (!p || !p.component || !p.property) throw new Error('component and property required');
    return ensureDesigner()
      .then(function () { return selectComponent(p.component, true); })
      .then(function (sel) {
        if (sel.selected && sel.selected !== p.component) {
          throw new Error('Could not select "' + p.component + '" (selected "' + sel.selected + '")');
        }
        return waitForSelection(p.component);
      })
      .then(function () {
        var row = propertyRow(p.property);
        if (!row) throw new Error('Property row not found: ' + p.property +
          ' (properties are grouped; select the component in the Designer first)');
        return Promise.resolve(setPropertyOnRow(row, p.value, p.property)).then(function (result) {
          // A choice menu stores a code ("1") but the row reads back its
          // caption ("center"), so compare against what was actually picked.
          var expected = result && result.kind === 'choice' ? result.value : p.value;
          var isColour = result && result.kind === 'colour';
          return waitForRowValue(p.property, expected, isColour ? 1500 : 3000).then(function (actual) {
            if (sameValue(actual, expected)) {
              return { component: p.component, property: p.property, written: p.value, control: result, verified: true };
            }
            if (isColour) {
              // ColorChoicePropertyEditor only knows its swatches, so a custom
              // colour repaints as "Default" even when the model holds it. Say
              // so instead of claiming a pass (or a failure).
              return {
                component: p.component,
                property: p.property,
                written: p.value,
                control: result,
                verified: false,
                verifiedBy: 'unconfirmed',
                note: 'Written through the colour picker. This panel cannot display a custom colour (it shows "Default"), so confirm with ai_component { action: "tree" }, which reads the saved .scm.'
              };
            }
            throw new Error('Write did not stick: ' + p.component + '.' + p.property +
              ' is "' + actual + '", expected "' + expected + '"');
          });
        });
      });
  };

  /* --- blocks --- */

  H['blocks.get'] = function (p) {
    return ensureBlocks().then(function () {
      var format = (p && p.format) || 'xml';
      if (format === 'summary') return blockSummary();
      return { xml: workspaceXml(true), summary: blockSummary() };
    });
  };

  H['blocks.set'] = function (p) {
    if (!p || !p.xml) throw new Error('xml required');
    return ensureBlocks().then(function () {
      var ws = workflow();
      var dom = parseXml(p.xml);
      ws.clear();
      Blockly.Xml.domToWorkspace(dom, ws);
      return sleep(300).then(function () { return blockSummary(); });
    });
  };

  H['blocks.add'] = function (p) {
    if (!p || !p.xml) throw new Error('xml required');
    return ensureBlocks().then(function () {
      var ws = workflow();
      var dom = parseXml(p.xml);
      Blockly.Xml.domToWorkspace(dom, ws);
      return sleep(300).then(function () { return blockSummary(); });
    });
  };

  H['blocks.clear'] = function () {
    return ensureBlocks().then(function () {
      workflow().clear();
      return sleep(200).then(function () { return { cleared: true }; });
    });
  };

  H['blocks.diagnostics'] = function () {
    var out = {};
    try { out.blocks = blockSummary(); } catch (e) { out.blocksError = e.message; }
    try { out.events = scanEvents(); } catch (e) { out.eventsError = e.message; }
    try { out.duplicateHandlers = duplicateHandlers(); } catch (e) { out.dupError = e.message; }
    try { out.unknownComponentRefs = unknownComponentRefs(); } catch (e) { out.refError = e.message; }
    try { out.components = instanceList(); } catch (e) { out.compError = e.message; }
    try { out.blockErrors = workspaceErrors(); } catch (e) { out.errorScanError = e.message; }
    return out;
  };

  H['blocks.catalog'] = function (p) {
    var db = componentDb();
    var wanted = p && p.type;
    var out = {};
    var types = db.types_ || {};
    Object.keys(types).forEach(function (t) {
      if (wanted && t !== wanted) return;
      var info = types[t];
      out[t] = {
        external: !!(info && info.external),
        events: info && info.eventDictionary ? Object.keys(info.eventDictionary) : [],
        methods: info && info.methodDictionary ? Object.keys(info.methodDictionary) : [],
        properties: info && info.properties ? Object.keys(info.properties) : [],
        getters: info && info.getPropertyList ? Object.keys(info.getPropertyList) : [],
        setters: info && info.setPropertyList ? Object.keys(info.setPropertyList) : []
      };
    });
    return wanted ? (out[wanted] || { error: 'Unknown component type: ' + wanted }) : out;
  };

  H['blocks.context'] = function () {
    return {
      project: projectName(),
      components: instanceList(),
      workspace: blockSummary()
    };
  };

  /* --- build --- */

  function buildMenuClick() {
    var els = document.querySelectorAll('[aria-label="Build menu"], .ode-TopPanelBuildButton, .gwt-Image');
    for (var i = 0; i < els.length; i++) {
      var label = els[i].getAttribute && els[i].getAttribute('aria-label');
      if (label === 'Build menu') { click(els[i]); return true; }
    }
    var byLabel = document.querySelector('[aria-label="Build menu"]');
    if (byLabel) { click(byLabel); return true; }
    return false;
  }

  H['build.apk'] = function (p) {
    var wantAab = !!(p && p.aab);
    var target = wantAab ? 'Android App Bundle (.aab)' : 'Android App (.apk)';
    return ensureDesigner()
      .then(function () { return sleep(400); })
      .then(function () {
        if (!buildMenuClick()) throw new Error('Build menu not found');
        return waitFor(function () {
          var menu = document.querySelector('.ode-ContextMenu');
          return menu && menu.textContent.indexOf('Android App') !== -1 ? menu : null;
        }, 6000);
      })
      .then(function () {
        var menu = document.querySelector('.ode-ContextMenu');
        var entry = byText('.ode-ContextMenuItem', target) ||
                    byText('td', target) ||
                    byTextContains('*', target);
        if (!entry) throw new Error('Build entry not found: ' + target);
        click(entry.closest('.ode-ContextMenuItem') || entry);
        return waitFor(function () {
          var d = document.querySelector('.ode-DialogBox');
          if (!d) return null;
          var link = d.querySelector('a.download-button');
          if (link) return { link: link.href, text: d.innerText.slice(0, 400) };
          var txt = d.innerText || '';
          if (/error|failed|compilation/i.test(txt) && !/Compiling/i.test(txt)) {
            return { error: txt.slice(0, 1500) };
          }
          return null;
        }, 180000, 500);
      })
      .then(function (res) {
        // The success dialog is modal; close it so later designer edits are not blocked.
        try { dismissDialogs(); } catch (e) { /* ignore */ }
        return res;
      });
  };

  H['build.progress'] = function () {
    var d = document.querySelector('.ode-DialogBox');
    if (!d) return { dialog: false };
    var link = d.querySelector('a.download-button');
    return {
      dialog: true,
      text: d.innerText.replace(/\s+/g, ' ').slice(0, 500),
      link: link ? link.href : null
    };
  };

  /* --- escape hatch --- */

  H['ui.eval'] = function (p) {
    if (!p || typeof p.script !== 'string') throw new Error('script required');
    // eslint-disable-next-line no-new-func
    var fn = new Function('return (' + p.script + ')');
    var value = fn();
    if (value && typeof value.then === 'function') {
      return value.then(function (v) { return { value: v }; });
    }
    return { value: value };
  };

  /* ------------------------------------------------------------ transport */

  /* App Inventor uses native alert/confirm for some flows (screen deletion).
   * A native dialog freezes the page and blocks every later command, so the
   * relay records the message instead and answers yes. Everything intercepted
   * is reported back in `state.intercepted`, so nothing happens silently. */
  if (!window.__aiRelayDialogs) {
    window.__aiRelayDialogs = [];
    try {
      window.alert = function (msg) { window.__aiRelayDialogs.push('alert: ' + String(msg)); };
      window.confirm = function (msg) { window.__aiRelayDialogs.push('confirm: ' + String(msg)); return true; };
      window.prompt = function (msg) { window.__aiRelayDialogs.push('prompt: ' + String(msg)); return ''; };
    } catch (e) { /* ignore */ }
  }
  if (window.__aiRelayDialogs.length > 50) window.__aiRelayDialogs.splice(0, window.__aiRelayDialogs.length - 50);

  var ws = null;
  var connected = false;
  var backoff = 500;
  var queue = [];

  function send(obj) {
    var payload = JSON.stringify(obj);
    if (ws && ws.readyState === 1) ws.send(payload);
    else queue.push(payload);
  }

  function reply(id, result) {
    var obj = { type: 'result', id: id, ok: true, result: result };
    try {
      JSON.stringify(obj);
    } catch (e) {
      obj = { type: 'result', id: id, ok: false, error: 'Result not serialisable: ' + e.message };
    }
    send(obj);
  }

  function replyError(id, err) {
    send({ type: 'result', id: id, ok: false, error: err && err.message ? err.message : String(err) });
  }

  function handle(msg) {
    if (!msg || msg.type !== 'call') return;
    var handler = H[msg.tool];
    if (!handler) return replyError(msg.id, new Error('Unknown tool: ' + msg.tool));
    try {
      var out = handler(msg.params || {});
      if (out && typeof out.then === 'function') {
        out.then(function (r) { reply(msg.id, r); }, function (e) { replyError(msg.id, e); });
      } else {
        reply(msg.id, out);
      }
    } catch (e) {
      replyError(msg.id, e);
    }
  }

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try { ws = new WebSocket(WS_URL); } catch (e) { log('bad url', e); return; }

    ws.onopen = function () {
      connected = true;
      backoff = 500;
      log('connected to host');
      send({ type: 'hello', version: VERSION, url: location.href, project: projectName(), view: viewMode() });
      while (queue.length) { try { ws.send(queue.shift()); } catch (e) { break; } }
    };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'ping') return;
      handle(msg);
    };

    ws.onclose = function () {
      connected = false;
      var wait = Math.max(backoff, 1000) + Math.floor(Math.random() * 400);
      setTimeout(connect, wait);
      backoff = Math.min(Math.max(backoff, 1000) * 2, 8000);
    };

    ws.onerror = function () { /* onclose handles retry */ };
  }

  window.__aiRelay = {
    version: VERSION,
    build: BUILD,
    reconnect: connect,
    disconnect: function () {
      try {
        if (ws) { ws.onclose = null; ws.close(); }
      } catch (e) { /* ignore */ }
      ws = null;
      connected = false;
    },
    status: function () { return { version: VERSION, connected: connected, view: viewMode(), project: projectName() }; },
    tools: Object.keys(H),
    call: function (tool, params) {
      var handler = H[tool];
      if (!handler) return Promise.reject(new Error('Unknown tool: ' + tool));
      return Promise.resolve().then(function () { return handler(params || {}); });
    }
  };

  connect();
  log('ready v' + VERSION + ' (' + Object.keys(H).length + ' tools)');
})();
