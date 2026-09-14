// Minimal in-memory DOM for auto-tracker tests.
//
// Enough of the platform for adapters to run headlessly: a tree of elements,
// a selector engine covering what the adapters actually use (tag, #id,
// .class, [attr], [attr="v"], [attr*="v"], compound selectors, descendant
// combinators, comma lists), bubbling events, shadow roots, and an
// instrumented MutationObserver whose live instances can be counted so a
// leaked observer fails a test instead of a user's tab.

let observerRegistry = new Set();

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.target = null;
    this.options = null;
    this.connected = false;
  }
  observe(target, options) {
    this.target = target;
    this.options = options || {};
    this.connected = true;
    observerRegistry.add(this);
  }
  disconnect() {
    this.connected = false;
    observerRegistry.delete(this);
  }
  takeRecords() { return []; }
  // Test hook: deliver records as if the DOM had mutated.
  trigger(records) {
    if (!this.connected) return;
    this.callback(records, this);
  }
  static active() { return Array.from(observerRegistry); }
  static activeCount() { return observerRegistry.size; }
  static reset() { observerRegistry = new Set(); }
  static observing(target) { return Array.from(observerRegistry).filter(o => o.target === target); }
}

// --- selector engine ---------------------------------------------------------
function parseCompound(compound) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([*^$]?=)"?([^"\]]*)"?)?\]/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(compound)) !== null) {
    consumed += m[0].length;
    if (m[1]) out.tag = m[1].toLowerCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else if (m[4]) out.attrs.push({ name: m[4], op: m[5] || null, value: m[6] !== undefined ? m[6] : null });
  }
  if (consumed !== compound.length) throw new Error('Unsupported selector fragment: ' + compound);
  return out;
}

function matchesCompound(el, c) {
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '*=' && !v.includes(a.value)) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '$=' && !v.endsWith(a.value)) return false;
  }
  return true;
}

function splitList(selector) {
  return String(selector).split(',').map(s => s.trim()).filter(Boolean);
}

function matchesComplex(el, complex) {
  const parts = complex.split(/\s+/).map(parseCompound);
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let idx = parts.length - 2;
  let node = el.parentElement;
  while (idx >= 0 && node) {
    if (matchesCompound(node, parts[idx])) idx--;
    node = node.parentElement;
  }
  return idx < 0;
}

function matchesSelector(el, selector) {
  return splitList(selector).some(sel => matchesComplex(el, sel));
}

// --- nodes -------------------------------------------------------------------
class FakeClassList {
  constructor(el) { this.el = el; }
  _list() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  contains(c) { return this._list().includes(c); }
  add(...cs) { const l = this._list(); cs.forEach(c => { if (!l.includes(c)) l.push(c); }); this.el.setAttribute('class', l.join(' ')); }
  remove(...cs) { this.el.setAttribute('class', this._list().filter(c => !cs.includes(c)).join(' ')); }
  toggle(c, force) { const has = this.contains(c); const want = force === undefined ? !has : !!force; if (want) this.add(c); else this.remove(c); return want; }
}

class FakeElement {
  constructor(tagName, doc) {
    this.nodeType = 1;
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = doc || null;
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.ownText = '';
    this.listeners = {};
    this.shadowRoot = null;
    this.classList = new FakeClassList(this);
    this.checked = false;
    this.style = {};
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get href() { return this.getAttribute('href') || ''; }
  get isConnected() {
    let n = this;
    while (n) { if (n.isRoot) return true; n = n.parentNode; }
    return false;
  }
  get textContent() {
    return this.ownText + this.children.map(c => c.textContent).join('');
  }
  set textContent(v) { this.ownText = String(v); this.children.forEach(c => { c.parentElement = null; c.parentNode = null; }); this.children = []; }
  get innerText() { return this.textContent; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; }
  setAttribute(n, v) { this.attributes[n] = String(v); }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n); }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentElement = null;
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  contains(other) {
    let n = other;
    while (n) { if (n === this) return true; n = n.parentElement; }
    return false;
  }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    let n = this;
    while (n && n.nodeType === 1) { if (n.matches(selector)) return n; n = n.parentElement; }
    return null;
  }
  *walk() {
    for (const c of this.children) { yield c; yield* c.walk(); }
  }
  querySelectorAll(selector) {
    const out = [];
    for (const el of this.walk()) if (el.matches(selector)) out.push(el);
    return out;
  }
  querySelector(selector) {
    for (const el of this.walk()) if (el.matches(selector)) return el;
    return null;
  }
  addEventListener(type, fn, opts) {
    (this.listeners[type] = this.listeners[type] || []).push({ fn, opts });
  }
  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(l => l.fn !== fn);
    if (!this.listeners[type].length) delete this.listeners[type];
  }
  listenerCount(type) {
    if (type) return (this.listeners[type] || []).length;
    return Object.values(this.listeners).reduce((n, l) => n + l.length, 0);
  }
  // Bubbles from target up through ancestors; capture/bubble ordering is
  // irrelevant to the adapters, which only read event.target.
  dispatchEvent(event) {
    event.target = event.target || this;
    let n = this;
    while (n) {
      const ls = (n.listeners[event.type] || []).slice();
      ls.forEach(l => l.fn.call(n, event));
      n = n.parentElement;
    }
    return true;
  }
  attachShadow(init) {
    const root = new FakeElement('#shadow-root', this.ownerDocument);
    root.mode = init && init.mode;
    root.host = this;
    this.shadowRoot = init && init.mode === 'closed' ? null : root;
    this._shadow = root;
    return root;
  }
}

class FakeDocument {
  constructor() {
    this.title = '';
    this.documentElement = new FakeElement('html', this);
    this.documentElement.isRoot = true;
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.body);
    this.listeners = {};
  }
  createElement(tag) { return new FakeElement(tag, this); }
  getElementById(id) { return this.documentElement.querySelector('#' + id); }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  addEventListener(type, fn, opts) { (this.listeners[type] = this.listeners[type] || []).push({ fn, opts }); }
  removeEventListener(type, fn) { if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter(l => l.fn !== fn); }
}

// el('h1.app-title#x', { text: 'Title', attrs: {...}, children: [...] })
function el(doc, spec, options = {}) {
  const c = parseCompound(spec);
  const node = doc.createElement(c.tag || 'div');
  if (c.id) node.id = c.id;
  if (c.classes.length) node.className = c.classes.join(' ');
  c.attrs.forEach(a => node.setAttribute(a.name, a.value === null ? '' : a.value));
  if (options.attrs) Object.entries(options.attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (options.text !== undefined) node.ownText = String(options.text);
  (options.children || []).forEach(ch => node.appendChild(ch));
  return node;
}

function makeEvent(type, target, extra = {}) {
  return Object.assign({ type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, extra);
}

// Delivers `nodes` to every observer currently watching an ancestor of them.
function emitAdded(nodes) {
  const list = [].concat(nodes);
  const records = [{ type: 'childList', addedNodes: list, removedNodes: [] }];
  for (const obs of FakeMutationObserver.active()) {
    const hit = list.some(n => obs.target === n || (obs.target && obs.target.contains && obs.target.contains(n)));
    if (hit) obs.trigger(records);
  }
}

// Changes a node's text and notifies observers scoped to it (or an ancestor
// observing characterData).
function setText(node, text) {
  node.ownText = String(text);
  const records = [{ type: 'characterData', addedNodes: [], removedNodes: [], target: node }];
  for (const obs of FakeMutationObserver.active()) {
    if (obs.target === node || (obs.target && obs.target.contains && obs.target.contains(node) && obs.options && obs.options.characterData)) {
      obs.trigger(records);
    }
  }
}

function installDom() {
  FakeMutationObserver.reset();
  global.MutationObserver = FakeMutationObserver;
  const doc = new FakeDocument();
  return doc;
}

module.exports = {
  FakeMutationObserver,
  FakeElement,
  FakeDocument,
  el,
  makeEvent,
  emitAdded,
  setText,
  installDom,
  matchesSelector
};
