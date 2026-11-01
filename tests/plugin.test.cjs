const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const code = readFileSync(resolve(__dirname, '../code.js'), 'utf8');
const identity = (x = 0, y = 0) => [[1, 0, x], [0, 1, y]];
const copy = value => JSON.parse(JSON.stringify(value));
const CHANNEL = 'crack-font-ui-v1', SESSION = '0123456789abcdef0123456789abcdef';
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fakeClock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async tick(ms) {
      await settle(); now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await settle();
    },
    get size() { return timers.size; }
  };
}

function harness(text = 'Ab c', options = {}) {
  let nextId = 0;
  let mutationCount = 0;
  const messages = [], fontLoads = [], nodes = [], draws = [];
  const clock = fakeClock(), errors = [], listeners = new Map();
  let requestId = 0;
  let failMutation = null;
  let failAfter = 0;
  const changed = kind => {
    mutationCount++;
    if (failMutation === kind && failAfter-- === 0) { failMutation = null; throw new Error(`Injected ${kind} failure`); }
  };
  class Node {
    constructor(type) {
      this.id = String(++nextId); this.type = type; this.parent = null;
      this.locked = false; this.visible = true; this.removed = false;
      this.name = ''; this.data = {}; this._t = identity(); this.children = [];
      nodes.push(this);
    }
    get relativeTransform() { return copy(this._t); }
    set relativeTransform(t) { changed('transform'); this._t = copy(t); this.parent?.normalize(); }
    get absoluteTransform() {
      const p = this.parent ? this.parent.absoluteTransform : identity(), t = this._t;
      return [[p[0][0] * t[0][0] + p[0][1] * t[1][0], p[0][0] * t[0][1] + p[0][1] * t[1][1], p[0][0] * t[0][2] + p[0][1] * t[1][2] + p[0][2]],
        [p[1][0] * t[0][0] + p[1][1] * t[1][0], p[1][0] * t[0][1] + p[1][1] * t[1][1], p[1][0] * t[0][2] + p[1][1] * t[1][2] + p[1][2]]];
    }
    get x() { return this._t[0][2]; }
    set x(x) { const t = this.relativeTransform; t[0][2] = x; this.relativeTransform = t; }
    get y() { return this._t[1][2]; }
    set y(y) { const t = this.relativeTransform; t[1][2] = y; this.relativeTransform = t; }
    appendChild(node) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this; this.children.push(node);
    }
    normalize() {
      if (this.type !== 'GROUP' || !this.children.length) return;
      const corners = this.children.flatMap(n => [[0, 0], [n.width, 0], [0, n.height], [n.width, n.height]].map(([x, y]) =>
        [n._t[0][0] * x + n._t[0][1] * y + n.x, n._t[1][0] * x + n._t[1][1] * y + n.y]));
      const x = Math.min(...corners.map(p => p[0])), y = Math.min(...corners.map(p => p[1]));
      this._t[0][2] += x; this._t[1][2] += y;
      for (const n of this.children) { n._t[0][2] -= x; n._t[1][2] -= y; }
    }
    getPluginData(key) { return this.data[key] || ''; }
    setPluginData(key, value) { changed('metadata'); this.data[key] = value; }
    remove() {
      changed('remove');
      for (const child of [...this.children]) child.remove();
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null; this.removed = true;
    }
  }
  class Text extends Node {
    constructor(characters, styles) {
      super('TEXT'); this.characters = characters;
      this.styles = styles || Array.from(characters, (_, i) => ({ fontName: { family: i % 2 ? 'Second' : 'First', style: 'Regular' }, fontSize: i % 2 ? 24 : 16, fills: [{ type: 'SOLID', color: { r: i / 10, g: 0, b: 0 } }], textDecoration: i % 2 ? 'UNDERLINE' : 'NONE' }));
      this.textAutoResize = 'WIDTH_AND_HEIGHT'; this.textAlignHorizontal = 'LEFT'; this.textCase = 'ORIGINAL'; this.hasMissingFont = false;
    }
    get width() { return [...this.characters].reduce((sum, c, i) => sum + this.styles[i].fontSize * (c === ' ' ? .25 : .6), 0); }
    get height() { return Math.max(...this.styles.map(s => s.fontSize)); }
    getRangeTextCase() { return this.textCase; }
    getRangeAllFontNames(start, end) { return this.styles.slice(start, end).map(s => s.fontName); }
    clone() {
      changed('clone'); const node = new Text(this.characters, copy(this.styles));
      node._t = copy(this._t); node.textAutoResize = this.textAutoResize;
      this.parent.appendChild(node); return node;
    }
    deleteCharacters(start, end) {
      changed('delete'); this.characters = this.characters.slice(0, start) + this.characters.slice(end);
      this.styles.splice(start, end - start);
    }
  }
  const page = new Node('PAGE'); page.selection = [];
  const source = new Text(text); source._t = identity(100, 200); page.appendChild(source); page.selection = [source];
  const figma = {
    currentPage: page,
    on(event, callback) { listeners.set(event, callback); },
    ui: { postMessage(message) { messages.push(message); } },
    showUI(html, opts) { this.uiOptions = opts; },
    viewport: { scrollAndZoomIntoView() {} },
    closePlugin() {},
    async loadFontAsync(font) {
      fontLoads.push({ font, mutationCount });
      if (options.fontHook) await options.fontHook(font, source);
      if (font.family === options.failFont) throw new Error('Missing font');
    },
    group(letters, parent) {
      changed('group'); const group = new Node('GROUP'); parent.appendChild(group);
      for (const node of letters) group.appendChild(node);
      group.normalize(); return group;
    }
  };
  const math = Object.create(Math);
  math.random = () => draws.length ? draws.shift() : .5;
  const start = () => {
    vm.runInNewContext(code, { figma, __html__: '', Math: math, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
      console: { error: (...args) => errors.push(args) } });
    figma.ui.onmessage({ type: 'ready', channel: CHANNEL, session: SESSION });
  };
  start();
  const target = () => { figma.ui.onmessage({ type: 'status', channel: CHANNEL, session: SESSION }); return messages.at(-1).selection; };
  const raw = msg => figma.ui.onmessage({ channel: CHANNEL, session: SESSION, ...msg });
  return { figma, page, source, messages, fontLoads, nodes, draws, Node, clock, errors, start, raw, target,
    emit(event) { listeners.get(event)(); },
    fail(kind, after = 0) { failMutation = kind; failAfter = after; },
    get mutationCount() { return mutationCount; },
    async send(type = 'apply', strength = 2, extra = {}) {
      const selected = target();
      const angles = Array.from(selected.text, () => (draws.length ? draws.shift() * 2 - 1 : 0) * (typeof strength === 'number' ? strength : 0));
      await raw({ type, strength, target: selected, angles, requestId: ++requestId, ...extra });
      return messages.findLast(m => m.type === 'result');
    },
    groups() { return page.children.filter(n => n.type === 'GROUP'); }
  };
}
function glyphCenter(n) {
  const t = n.absoluteTransform;
  return [t[0][2] + t[0][0] * n.width / 2 + t[0][1] * n.height / 2,
    t[1][2] + t[1][0] * n.width / 2 + t[1][1] * n.height / 2];
}
function angle(n) { const t = n.absoluteTransform; return Math.atan2(-t[1][0], t[0][0]) * 180 / Math.PI; }
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`); }
function snapshot(node) { return copy({ text: node.characters, styles: node.styles, transform: node.absoluteTransform, visible: node.visible, data: node.data }); }

test('Apply preserves original and range formatting, preflights every font before cloning', async () => {
  const h = harness(); const original = snapshot(h.source);
  assert.equal((await h.send()).ok, true);
  assert.deepEqual(snapshot(h.source), original);
  assert.equal(h.source.removed, false);
  assert.equal(h.groups().length, 1);
  const group = h.groups()[0];
  assert.equal(group.children.map(n => n.characters).join(''), h.source.characters);
  group.children.forEach((n, i) => assert.deepEqual(n.styles, [original.styles[i]]));
  assert.ok(group.children.every(n => glyphCenter(n)[1] > h.source.y + h.source.height));
  assert.deepEqual(h.fontLoads.slice(0, 2).map(l => l.font.family), ['First', 'Second']);
  assert.ok(h.fontLoads.slice(0, 2).every(l => l.mutationCount === 0));
});

test('backend applies exact bounded CSS preview angles with the Figma sign inverted', async () => {
  const h = harness('ABC'); h.draws.push(0, .5, 1 - Number.EPSILON);
  await h.send();
  const angles = h.groups()[0].children.map(angle);
  near(angles[0], 2); near(angles[1], 0); near(angles[2], -2);
  assert.ok(angles.every(a => a >= -2 && a <= 2));
});

test('repeated Apply and Reroll reuse identical nodes without rotation or center drift', async () => {
  const h = harness('ABC'); await h.send();
  const group = h.groups()[0], ids = group.children.map(n => n.id), centers = group.children.map(glyphCenter);
  const original = snapshot(h.source);
  for (let i = 0; i < 80; i++) {
    h.draws.push(0, .9999, .25);
    if (i % 2) h.page.selection = [h.source];
    assert.equal((await h.send(i % 2 ? 'apply' : 'reroll', 15)).ok, true);
    assert.equal(h.groups().length, 1);
    assert.deepEqual(group.children.map(n => n.id), ids);
    group.children.forEach((n, j) => { glyphCenter(n).forEach((v, k) => near(v, centers[j][k])); assert.ok(Math.abs(angle(n)) <= 15); });
  }
  await h.send('apply', 0);
  group.children.forEach(n => near(angle(n), 0));
  assert.deepEqual(snapshot(h.source), original);
});

test('saved group supports reopening and translation without source; arbitrary groups are untouched', async () => {
  const h = harness('AB'); await h.send(); const group = h.groups()[0];
  group.x += 50; group.y += 70; const centers = group.children.map(glyphCenter);
  h.source.remove();
  // Re-execute plugin in a fresh VM; only plugin-owned persisted metadata survives.
  h.start();
  assert.equal((await h.send('reroll')).ok, true);
  group.children.forEach((n, i) => glyphCenter(n).forEach((v, j) => near(v, centers[i][j])));
  const arbitrary = new h.Node('GROUP'); h.page.appendChild(arbitrary); h.page.selection = [arbitrary];
  const count = h.mutationCount;
  assert.equal((await h.send()).ok, false); assert.equal(h.mutationCount, count);
});

test('font failure creates nothing and leaves originals intact', async () => {
  const h = harness('AB', { failFont: 'Second' }); const original = snapshot(h.source);
  assert.match((await h.send()).message, /Could not load Second/);
  assert.equal(h.mutationCount, 0); assert.equal(h.groups().length, 0);
  assert.deepEqual(snapshot(h.source), original);
});

for (const kind of ['clone', 'delete', 'group', 'metadata', 'transform']) {
  test(`creation cleans up ${kind} failures without touching the original`, async () => {
    const h = harness(); const original = snapshot(h.source); h.fail(kind);
    assert.equal((await h.send()).ok, false);
    assert.equal(h.page.children.length, 1); assert.equal(h.page.children[0], h.source);
    assert.deepEqual(snapshot(h.source), original);
  });
}

test('failed reroll rolls back existing letters', async () => {
  const h = harness(); await h.send(); const group = h.groups()[0];
  const before = group.children.map(n => n.absoluteTransform);
  h.draws.push(0, .25, .75, .99);
  h.fail('transform', 2);
  assert.equal((await h.send('reroll')).ok, false);
  group.children.forEach((n, i) => n.absoluteTransform.flat().forEach((v, j) => near(v, before[i].flat()[j])));
});

test('font successes are cached; after reopening a font failure has no mutations', async () => {
  const options = {}; const h = harness('AB', options); await h.send();
  const loads = h.fontLoads.length;
  await h.send('reroll'); assert.equal(h.fontLoads.length, loads);
  options.failFont = 'Second'; h.start(); const count = h.mutationCount;
  assert.equal((await h.send('reroll')).ok, false); assert.equal(h.mutationCount, count);
});

test('text changed during asynchronous font loading is rejected before mutations', async () => {
  const h = harness('AB', { fontHook(font, source) { if (font.family === 'Second') source.characters = 'CD'; } });
  assert.match((await h.send()).message, /changed while fonts/); assert.equal(h.mutationCount, 0);
});

for (const text of ['', '   ', 'A\nB', 'A\rB', 'A\tB', 'e\u0301', '\ud83d\ude00', '\ud83d\udc69\u200d\ud83d\udcbb', '\ud800', '\u05d0', 'A'.repeat(201)]) {
  test(`unsupported/empty text is safely rejected: ${JSON.stringify(text.slice(0, 12))}`, async () => {
    const h = harness(text); assert.equal((await h.send()).ok, false); assert.equal(h.mutationCount, 0);
  });
}

test('precomposed Latin-1 and the 200 character bound work', async () => {
  const h = harness('\u00c9'.repeat(200)); assert.equal((await h.send()).ok, true);
  assert.equal(h.groups()[0].children.length, 200);
});

test('selection validation and Reroll before Apply never mutate', async () => {
  const h = harness();
  assert.equal((await h.send('reroll')).ok, false);
  for (const selection of [[], [h.source, h.source], [new h.Node('RECTANGLE')]]) {
    h.page.selection = selection; assert.equal((await h.send()).ok, false);
  }
  assert.equal(h.mutationCount, 0);
});

test('locked ancestors, nested/auto-layout, rotated and fixed-width text are rejected', async () => {
  for (const setup of [
    h => { h.source.locked = true; },
    h => { h.source.visible = false; },
    h => { h.source.hasMissingFont = true; },
    h => { h.source.textAutoResize = 'HEIGHT'; },
    h => { h.source.textAlignHorizontal = 'CENTER'; },
    h => { h.source.textCase = 'UPPER'; },
    h => { h.source._t = [[0, 1, 0], [-1, 0, 0]]; },
    h => { const parent = new h.Node('FRAME'); parent.layoutMode = 'HORIZONTAL'; h.page.appendChild(parent); parent.appendChild(h.source); },
    h => { const parent = new h.Node('GROUP'); parent.locked = true; h.page.appendChild(parent); parent.appendChild(h.source); }
  ]) {
    const h = harness(); setup(h); const count = h.mutationCount;
    assert.equal((await h.send()).ok, false); assert.equal(h.mutationCount, count);
  }
});

test('invalid strengths are rejected at the plugin boundary', async () => {
  const h = harness();
  for (const value of [-1, 16, NaN, Infinity, '2', null, undefined]) {
    assert.equal((await h.send('apply', 2, { strength: value })).ok, false);
  }
  assert.equal(h.mutationCount, 0);
});

test('edited letters and malformed saved data are rejected without modifying groups', async () => {
  for (const edit of [
    g => { g.children[0].characters = 'X'; },
    g => { g.children[0].locked = true; },
    g => { g.children[0].x += 10; },
    g => { g.data['crack-font-v1'] = '{'; },
    g => { const d = JSON.parse(g.data['crack-font-v1']); d.glyphs[0].width = 'bad'; g.data['crack-font-v1'] = JSON.stringify(d); }
  ]) {
    const h = harness(); await h.send(); edit(h.groups()[0]); const count = h.mutationCount;
    assert.equal((await h.send('reroll')).ok, false); assert.equal(h.mutationCount, count);
  }
});

test('concurrent clicks do not create duplicate groups', async () => {
  let unblock; const gate = new Promise(resolve => { unblock = resolve; });
  const h = harness('AB', { fontHook: () => gate });
  const first = h.send(); const second = h.send(); unblock(); await Promise.all([first, second]);
  assert.equal(h.groups().length, 1); assert.equal(h.messages.filter(m => m.type === 'result').length, 1);
});

test('source lookup is bounded and ignores unrelated corrupt metadata', async () => {
  const h = harness('A');
  const unrelated = new h.Node('GROUP'); unrelated.data['crack-font-v1'] = '{'; h.page.appendChild(unrelated);
  assert.equal((await h.send()).ok, true);
  h.page.selection = [h.source];
  // Fake lightweight unrelated page layers; no deep traversal is needed.
  h.page.children.push(...Array.from({ length: 10000 }, () => ({ type: 'RECTANGLE' })));
  const count = h.mutationCount;
  assert.match((await h.send()).message, /too large/); assert.equal(h.mutationCount, count);
});

test('multiple source-linked groups report ambiguity instead of creating more output', async () => {
  const h = harness('A'); await h.send();
  const duplicate = new h.Node('GROUP'); duplicate.data = copy(h.groups()[0].data); h.page.appendChild(duplicate);
  h.page.selection = [h.source]; const count = h.mutationCount;
  assert.match((await h.send()).message, /Multiple copies/); assert.equal(h.mutationCount, count);
});

test('asynchronous group locks and glyph shears are rejected', async () => {
  const options = {}; const h = harness('AB', options); await h.send(); const group = h.groups()[0];
  h.start();
  options.fontHook = () => { group.locked = true; };
  const count = h.mutationCount;
  assert.equal((await h.send('reroll')).ok, false); assert.equal(h.mutationCount, count);
  group.locked = false;
  h.start();
  options.fontHook = () => { group.children[0]._t[0][1] = .2; };
  assert.equal((await h.send('reroll')).ok, false); assert.equal(h.mutationCount, count);
});

function uiHarness() {
  const html = readFileSync(resolve(__dirname, '../ui.html'), 'utf8');
  class Element {
    constructor(id) { this.id = id; this.disabled = ['apply', 'reroll', 'strength'].includes(id); this.children = []; this.style = {}; this.attributes = {}; this.textContent = ''; this.className = ''; }
    replaceChildren() { this.children = []; }
    appendChild(node) { this.children.push(node); }
    setAttribute(key, value) { this.attributes[key] = value; }
  }
  const elements = Object.fromEntries(['strength', 'value', 'status', 'apply', 'reroll', 'label-art', 'preview', 'check'].map(id => [id, new Element(id)]));
  elements.strength.value = '2';
  const sent = [], parent = { postMessage: msg => sent.push(copy(msg.pluginMessage)) }, window = {}, draws = [], clock = fakeClock();
  const buttons = [elements.apply, elements.reroll];
  const math = Object.create(Math); math.random = () => draws.length ? draws.shift() : .25;
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: id => elements[id], createElement: () => new Element('span') }, parent, window, Math: math,
    crypto: { getRandomValues: array => array.fill(42) }, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout
  });
  const target = { id: 'text', pageId: 'page', text: 'Hello world', revision: 0, valid: true, reason: '' };
  const receive = (msg, source = null) => window.onmessage({ source, data: { pluginMessage: { channel: CHANNEL, session: sent[0].session, ...msg } } });
  const connect = () => receive({ type: 'state', activeRequestId: 0, requestId: 0, selection: target });
  return { elements, sent, parent, window, buttons, draws, clock, target, receive, connect };
}

test('UI handshake accepts authenticated null-source replies and rejects missing/wrong capabilities', () => {
  const u = uiHarness(); assert.equal(u.sent[0].type, 'ready'); assert.ok(u.buttons.every(b => b.disabled));
  u.window.onmessage({ source: {}, data: { pluginMessage: { type: 'state', activeRequestId: 0, selection: u.target } } });
  assert.ok(u.buttons.every(b => b.disabled));
  u.receive({ type: 'state', activeRequestId: 0, session: 'bad', selection: u.target });
  assert.ok(u.buttons.every(b => b.disabled));
  u.connect(); assert.ok(u.buttons.every(b => !b.disabled));
  assert.equal(u.elements.preview.children.map(n => n.textContent).join(''), 'Hello world');
});

test('UI slider cracks label and preview deterministically; Apply sends those exact angles; zero straightens', () => {
  const u = uiHarness(); u.connect(); const e = u.elements;
  e.strength.value = '4.5'; e.strength.oninput(); assert.equal(e.value.textContent, '\u00b14.5\u00b0');
  assert.equal(e['label-art'].children.map(n => n.textContent).join(''), 'Rotation strength');
  assert.ok(e['label-art'].children.every(n => n.style.transform === 'rotate(-2.25deg)'));
  assert.ok(e.preview.children.every(n => n.style.transform === 'rotate(-2.25deg)'));
  assert.equal(u.sent.length, 1, 'dragging is UI-only');
  e.apply.onclick(); const request = u.sent.at(-1);
  assert.equal(request.type, 'apply'); assert.equal(request.strength, 4.5);
  assert.ok(request.angles.every(a => a === -2.25)); assert.equal(request.target.id, 'text');
  assert.ok(u.buttons.every(b => b.disabled)); assert.equal(e.strength.disabled, true);
  u.receive({ type: 'result', requestId: request.requestId, ok: false, message: '<b>Error</b>', selection: u.target });
  assert.ok(u.buttons.every(b => !b.disabled)); assert.equal(e.status.textContent, '<b>Error</b>');
  e.strength.value = '0'; e.strength.oninput();
  assert.ok(e['label-art'].children.concat(e.preview.children).every(n => n.style.transform === 'rotate(0deg)'));
});

test('UI ignores stale result/state/progress while a newer request is active', () => {
  const u = uiHarness(); u.connect(); u.elements.apply.onclick(); const first = u.sent.at(-1).requestId;
  u.receive({ type: 'result', requestId: first, ok: true, message: 'Updated', selection: u.target });
  u.draws.push(...Array(40).fill(.9)); u.elements.reroll.onclick();
  const second = u.sent.at(-1); assert.equal(second.type, 'reroll'); assert.ok(second.angles.every(a => a > 0));
  u.receive({ type: 'result', requestId: first, ok: true, message: 'stale' });
  u.receive({ type: 'progress', requestId: first, message: 'stale' });
  u.receive({ type: 'state', requestId: first, activeRequestId: 0, selection: u.target });
  assert.ok(u.buttons.every(b => b.disabled)); assert.notEqual(u.elements.status.textContent, 'stale');
  u.receive({ type: 'result', requestId: second.requestId, ok: true, message: 'Updated', selection: u.target });
  assert.ok(u.buttons.every(b => !b.disabled));
  u.receive({ type: 'state', requestId: second.requestId, activeRequestId: second.requestId, selection: u.target });
  assert.ok(u.buttons.every(b => !b.disabled), 'a delayed busy state cannot relock a completed request');
});

test('UI watchdog probes backend without unlocking duplicates; cached result recovers lost delivery', async () => {
  const u = uiHarness(); u.connect(); u.elements.apply.onclick(); const requestId = u.sent.at(-1).requestId;
  await u.clock.tick(5000);
  assert.equal(u.sent.at(-1).type, 'status'); assert.equal(u.sent.at(-1).requestId, requestId);
  assert.ok(u.buttons.every(b => b.disabled)); assert.match(u.elements.status.textContent, /stay locked/);
  u.receive({ type: 'state', activeRequestId: requestId, requestId, selection: u.target });
  assert.ok(u.buttons.every(b => b.disabled));
  u.receive({ type: 'state', activeRequestId: 0, requestId, selection: u.target,
    result: { type: 'result', requestId, ok: true, message: 'Recovered', selection: u.target } });
  assert.ok(u.buttons.every(b => !b.disabled)); assert.equal(u.elements.status.textContent, 'Recovered');
});

test('UI startup retries handshake and never enables actions on silence', async () => {
  const u = uiHarness(); await u.clock.tick(5000);
  assert.equal(u.sent.at(-1).type, 'ready'); assert.ok(u.buttons.every(b => b.disabled));
  assert.match(u.elements.status.textContent, /No connection/);
});

test('font deadline identifies pending font, releases busy and never mutates after late resolution', async () => {
  let resolveFont;
  const gate = new Promise(resolve => { resolveFont = resolve; });
  const options = { fontHook: font => font.family === 'Second' ? gate : undefined };
  const h = harness('AB', options), original = snapshot(h.source);
  const operation = h.send(); await h.clock.tick(10000);
  const result = await operation;
  assert.equal(result.ok, false); assert.match(result.message, /Timed out loading Second Regular/);
  assert.equal(h.mutationCount, 0); assert.deepEqual(snapshot(h.source), original);
  await h.raw({ type: 'status' }); assert.equal(h.messages.at(-1).activeRequestId, 0);
  resolveFont(); await settle(); assert.equal(h.mutationCount, 0); assert.equal(h.groups().length, 0);
  options.fontHook = undefined;
  assert.equal((await h.send()).ok, true); assert.equal(h.groups().length, 1);
  assert.equal(h.clock.size, 0);
});

test('late resolution of a timed-out font cannot finish an old operation during a retry', async () => {
  const resolvers = [];
  const options = { fontHook: () => new Promise(resolve => resolvers.push(resolve)) };
  const h = harness('A', options);
  const first = h.send(); await h.clock.tick(10000); assert.equal((await first).ok, false);
  const second = h.send(); await settle(); assert.equal(resolvers.length, 2);
  resolvers[0](); await settle(); assert.equal(h.mutationCount, 0);
  resolvers[1](); assert.equal((await second).ok, true); assert.equal(h.groups().length, 1);
  assert.equal(h.messages.filter(m => m.type === 'result').length, 2);
});

test('ready and selection/page events publish preview text without font loading or mutation', async () => {
  const h = harness('Ab c');
  assert.equal(h.messages[0].type, 'state'); assert.equal(h.messages[0].selection.text, 'Ab c');
  h.page.selection = []; h.emit('selectionchange');
  assert.equal(h.messages.at(-1).selection.valid, false);
  h.page.selection = [h.source]; h.emit('selectionchange');
  assert.equal(h.messages.at(-1).selection.text, 'Ab c');
  const other = new h.Node('PAGE'); other.selection = []; h.figma.currentPage = other; h.emit('currentpagechange');
  assert.equal(h.messages.at(-1).selection.pageId, other.id);
  assert.equal(h.fontLoads.length, 0); assert.equal(h.mutationCount, 0);
  h.figma.currentPage = h.page; await h.send();
  const loads = h.fontLoads.length; h.emit('selectionchange');
  assert.equal(h.messages.at(-1).selection.text, 'Ab c'); assert.equal(h.fontLoads.length, loads);
});

test('selection, page, source deletion and away-and-back changes during fonts abort before creation', async () => {
  for (const change of [
    h => { h.page.selection = []; h.emit('selectionchange'); },
    h => { const page = new h.Node('PAGE'); page.selection = []; h.figma.currentPage = page; h.emit('currentpagechange'); },
    h => { h.source.remove(); },
    h => { h.page.selection = []; h.emit('selectionchange'); h.page.selection = [h.source]; h.emit('selectionchange'); }
  ]) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const h = harness('AB', { fontHook: () => gate }); const operation = h.send();
    change(h); const count = h.mutationCount; release();
    assert.equal((await operation).ok, false); assert.equal(h.mutationCount, count); assert.equal(h.groups().length, 0);
  }
});

test('stale preview IDs/text/revision and malformed angles cannot mutate the canvas', async () => {
  for (const override of [
    h => ({ target: { ...h.target(), id: 'wrong' } }),
    h => ({ target: { ...h.target(), text: 'XY' } }),
    h => ({ target: { ...h.target(), revision: 9 } }),
    () => ({ angles: [0] }), () => ({ angles: [0, 3] }), () => ({ angles: [NaN, 0] }),
    () => ({ angles: ['0', 0] }), () => ({ angles: null }), () => ({ angles: new Array(2) })
  ]) {
    const h = harness('AB'); assert.equal((await h.send('apply', 2, override(h))).ok, false);
    assert.equal(h.mutationCount, 0);
  }
});

test('idle status fences off delayed actions and request IDs are never executed twice', async () => {
  const h = harness('AB'), target = h.target();
  await h.raw({ type: 'status', requestId: 1 });
  await h.raw({ type: 'apply', requestId: 1, strength: 2, target, angles: [0, 0] });
  assert.equal(h.mutationCount, 0);
  await h.raw({ type: 'apply', requestId: 2, strength: 2, target, angles: [1, -1] });
  assert.equal(h.messages.at(-1).ok, true); const count = h.mutationCount;
  await h.raw({ type: 'apply', requestId: 2, strength: 2, target, angles: [0, 0] });
  assert.equal(h.mutationCount, count); assert.equal(h.messages.at(-1).type, 'state');
  assert.equal(h.messages.at(-1).result.requestId, 2);
});

test('unexpected API errors are logged and reported; validation errors are not logged', async () => {
  const h = harness('AB'); h.fail('clone');
  const result = await h.send(); assert.equal(result.ok, false); assert.match(result.message, /Unexpected Figma error/);
  assert.ok(h.errors.length); assert.equal(h.page.children.length, 1);
  const normal = harness(''); await normal.send(); assert.equal(normal.errors.length, 0);
});

test('changing the original text cannot apply new preview angles to stale effect letters', async () => {
  const h = harness('AB'); await h.send(); h.page.selection = [h.source]; h.source.characters = 'CD';
  const count = h.mutationCount;
  assert.match((await h.send()).message, /original text changed/); assert.equal(h.mutationCount, count);
});

test('backend uses UI Apply and Reroll angles end-to-end with unchanged originals and no duplicates', async () => {
  const h = harness('Hello world'), u = uiHarness(), original = snapshot(h.source);
  // Bridge the real UI script to the real compiled backend using the UI's private session.
  h.start();
  const first = u.sent[0];
  // A fresh backend is needed to bind this UI's session rather than the harness default.
  const clock = h.clock;
  vm.runInNewContext(code, { figma: h.figma, __html__: '', setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, console });
  await h.figma.ui.onmessage(first);
  u.receive({ ...h.messages.at(-1), session: first.session });
  for (const button of [u.elements.apply, u.elements.reroll]) {
    u.draws.push(...Array(60).fill(.9)); button.onclick(); const request = u.sent.at(-1);
    await h.figma.ui.onmessage(request);
    const result = h.messages.at(-1); assert.equal(result.ok, true); u.receive(result);
    h.groups()[0].children.forEach((n, i) => near(angle(n), -request.angles[i]));
    assert.equal(h.groups().length, 1); assert.deepEqual(snapshot(h.source), original);
  }
});

test('UI selection updates ignore older revisions and safely render long text without markup', () => {
  const u = uiHarness(); u.connect();
  const next = { ...u.target, revision: 2, text: '<b>'.repeat(66) };
  u.receive({ type: 'selection', selection: next });
  assert.equal(u.elements.preview.children.map(n => n.textContent).join(''), next.text);
  assert.ok(parseFloat(u.elements.preview.style.fontSize) <= 10);
  u.receive({ type: 'selection', selection: u.target });
  assert.equal(u.elements.preview.attributes['aria-label'], next.text);
});

test('manifest retains Community identity and disallows network access', () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, '../manifest.json'), 'utf8'));
  assert.equal(manifest.id, '929414938810147814');
  assert.equal(manifest.documentAccess, 'dynamic-page');
  assert.deepEqual(manifest.networkAccess.allowedDomains, ['none']);
});

test('package and npm lockfile agree on exact toolchain versions', () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve(__dirname, '../package-lock.json'), 'utf8'));
  assert.deepEqual(pkg.devDependencies, lock.packages[''].devDependencies);
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
    assert.equal(lock.dependencies[name].version, version);
  }
});
