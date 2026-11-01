const DATA_KEY = 'crack-font-v1';
const MAX_LETTERS = 200;
const CHANNEL = 'crack-font-ui-v1';
type GlyphData = { id: string; text: string; width: number; height: number; dx: number; dy: number };
type EffectData = { version: 1; sourceId: string; glyphs: GlyphData[] };
type Target = { id: string; pageId: string; text: string; revision: number };
type Request = { type: string; channel: string; session: string; requestId: number;
  strength: unknown; angles: unknown; target: Target };
let session = '', activeRequestId = 0, lastRequestId = 0, revision = 0;
let lastResult: object | undefined;
const loadedFonts = new Set<string>();

class InputError extends Error {}
function fail(message: string): never { throw new InputError(message); }
function send(message: object): void {
  if (session) figma.ui.postMessage({ ...message, channel: CHANNEL, session });
}
function progress(message: string): void { send({ type: 'progress', requestId: activeRequestId, message }); }

function assertPageNode(node: SceneNode): void {
  let ancestor: BaseNode | null = node;
  while (ancestor && ancestor.type !== 'DOCUMENT') {
    if ('locked' in ancestor && ancestor.locked) fail('Unlock the selected layer and its ancestors first.');
    if ('visible' in ancestor && !ancestor.visible) fail('Select a visible layer.');
    ancestor = ancestor.parent;
  }
  if (node.parent !== figma.currentPage) {
    fail('Only top-level layers are supported. Copy the text outside frames, groups, components and auto-layout first.');
  }
  const t = node.relativeTransform;
  if (Math.abs(t[0][0] - 1) > 0.000001 || Math.abs(t[1][1] - 1) > 0.000001 ||
      Math.abs(t[0][1]) > 0.000001 || Math.abs(t[1][0]) > 0.000001) {
    fail('Unrotate the selected layer first; scaled and flipped layouts are not supported.');
  }
}

function validateText(node: TextNode): void {
  assertPageNode(node);
  const text = node.characters;
  if (!text.trim()) fail('Select text with at least one visible letter.');
  if (text.length > MAX_LETTERS) fail('Use at most 200 characters, including spaces.');
  // Deliberately conservative fallback: no UTF-16 slicing of complex graphemes or shaping scripts.
  if (!/^[\x20-\x7e\u00c0-\u00ff]+$/.test(text)) {
    fail('Use printable ASCII or precomposed Latin-1 letters. Line breaks, tabs, combining marks, emoji and other scripts are not supported.');
  }
  if (node.textAutoResize !== 'WIDTH_AND_HEIGHT' || node.textAlignHorizontal !== 'LEFT') {
    fail('Use a single line with Auto width and left alignment; wrapped or fixed-size text is not supported.');
  }
  if (node.getRangeTextCase(0, text.length) !== 'ORIGINAL') fail('Set text case to Original before splitting letters.');
  if (node.hasMissingFont) fail('Resolve missing fonts before applying the effect.');
}

function readEffect(group: GroupNode): EffectData {
  let data: EffectData;
  try { data = JSON.parse(group.getPluginData(DATA_KEY)); }
  catch (_) { return fail('Select text or a group created by this version of Crack Font.'); }
  if (!data || data.version !== 1 || typeof data.sourceId !== 'string' || !Array.isArray(data.glyphs) ||
      !data.glyphs.length || data.glyphs.length > MAX_LETTERS || data.glyphs.length !== group.children.length) {
    fail('This is not an intact Crack Font group. Select the original text instead.');
  }
  const ids = new Set<string>();
  for (const g of data.glyphs) {
    if (!g || typeof g.id !== 'string' || ids.has(g.id) || typeof g.text !== 'string' ||
        g.text.length !== 1 || ![g.width, g.height, g.dx, g.dy].every(Number.isFinite) || g.width < 0 || g.height <= 0) {
      fail('The Crack Font group has invalid saved data.');
    }
    ids.add(g.id);
  }
  return data;
}

function selectionPreview(): Target & { valid: boolean; reason: string } {
  const selected = figma.currentPage.selection;
  const target = { id: selected.length === 1 ? selected[0].id : '', pageId: figma.currentPage.id, text: '', revision };
  try {
    if (selected.length !== 1) fail('Select exactly one text layer or Crack Font group.');
    const node = selected[0];
    if (node.type === 'TEXT') { validateText(node); target.text = node.characters; }
    else if (node.type === 'GROUP') {
      assertPageNode(node);
      target.text = readEffect(node).glyphs.map(g => {
        const child = node.children.find(n => n.id === g.id);
        if (!child || child.type !== 'TEXT' || child.characters !== g.text) fail('The generated letters were edited or removed.');
        return g.text;
      }).join('');
    } else fail('Select a text layer or a group created by Crack Font.');
    return { ...target, valid: true, reason: '' };
  } catch (error) {
    if (!(error instanceof InputError)) console.error('Crack Font preview', error);
    return { ...target, valid: false, reason: error instanceof Error ? error.message : 'Could not read selection.' };
  }
}

function center(node: TextNode): { x: number; y: number } {
  const t = node.absoluteTransform;
  return { x: t[0][2] + t[0][0] * node.width / 2 + t[0][1] * node.height / 2,
    y: t[1][2] + t[1][0] * node.width / 2 + t[1][1] * node.height / 2 };
}

async function preflightFonts(nodes: TextNode[]): Promise<void> {
  const fonts = new Map<string, FontName>();
  const signatures = nodes.map(node => JSON.stringify([node.characters,
    node.getRangeAllFontNames(0, node.characters.length)]));
  for (const node of nodes) {
    if (node.hasMissingFont) fail('Resolve missing fonts before applying the effect.');
    for (const font of node.getRangeAllFontNames(0, node.characters.length)) {
      if (!loadedFonts.has(JSON.stringify(font))) fonts.set(JSON.stringify(font), font);
    }
  }
  if (fonts.size) {
    let waiting = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set(Array.from(fonts.values(), f => `${f.family} ${f.style}`));
    progress(`Loading fonts: ${Array.from(pending).join(', ')} (10 second limit)...`);
    try {
      await Promise.race([Promise.all(Array.from(fonts, async ([key, font]) => {
        try { await figma.loadFontAsync(font); }
        catch (_) { fail(`Could not load ${font.family} ${font.style}. No letters were changed.`); }
        if (waiting) { loadedFonts.add(key); pending.delete(`${font.family} ${font.style}`); }
      })), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new InputError(`Timed out loading ${Array.from(pending).join(', ')}. No letters were changed. Check font availability and retry.`)), 10000);
      })]);
    } finally { waiting = false; if (timer !== undefined) clearTimeout(timer); }
  }
  nodes.forEach((node, i) => {
    if (node.removed || signatures[i] !== JSON.stringify([node.characters,
      node.getRangeAllFontNames(0, node.characters.length)])) {
      fail('Text changed while fonts were loading. Please try again.');
    }
  });
}

async function reroll(group: GroupNode, angles: number[], assertCurrent: () => void): Promise<void> {
  assertPageNode(group);
  const data = readEffect(group);
  const getGlyph = (g: GlyphData): TextNode => {
    const node = group.children.find(n => n.id === g.id);
    if (!node || node.type !== 'TEXT' || node.locked || !node.visible || node.characters !== g.text ||
        Math.abs(node.width - g.width) > 0.001 || Math.abs(node.height - g.height) > 0.001) {
      return fail('The generated letters were edited, locked or removed. Keep the group intact to reroll.');
    }
    const t = node.relativeTransform;
    if (Math.abs(t[0][0] * t[1][1] - t[0][1] * t[1][0] - 1) > 0.000001 ||
        Math.abs(t[0][0] * t[0][0] + t[1][0] * t[1][0] - 1) > 0.000001 ||
        Math.abs(t[0][1] * t[0][1] + t[1][1] * t[1][1] - 1) > 0.000001) {
      fail('Scaled or flipped letters cannot be rerolled.');
    }
    return node;
  };
  const nodes = data.glyphs.map(getGlyph);
  await preflightFonts(nodes);
  assertCurrent();
  assertPageNode(group);
  if (JSON.stringify(readEffect(group)) !== JSON.stringify(data)) fail('The group changed while fonts were loading. Please try again.');
  data.glyphs.forEach(getGlyph);
  const anchor = center(nodes[0]);
  const positions = data.glyphs.map((g, i) => {
    const p = center(nodes[i]);
    if (Math.abs(p.x - anchor.x - g.dx) > 0.01 || Math.abs(p.y - anchor.y - g.dy) > 0.01) {
      fail('The letter arrangement was changed. Keep the group intact to reroll.');
    }
    return { x: anchor.x + g.dx, y: anchor.y + g.dy };
  });
  // Snapshot page-space transforms. Group bounds can move when any child rotates.
  const before = nodes.map(node => node.absoluteTransform);
  progress('Rotating existing letters...');
  const write = (node: TextNode, t: Transform) => {
    const parent = group.absoluteTransform;
    node.relativeTransform = [[t[0][0], t[0][1], t[0][2] - parent[0][2]],
      [t[1][0], t[1][1], t[1][2] - parent[1][2]]];
  };
  try {
    nodes.forEach((node, i) => {
      // CSS angles are clockwise; Figma's positive rotation is counterclockwise.
      const radians = -angles[i] * Math.PI / 180;
      const c = Math.cos(radians), s = Math.sin(radians), p = positions[i];
      write(node, [[c, s, p.x - c * node.width / 2 - s * node.height / 2],
        [-s, c, p.y + s * node.width / 2 - c * node.height / 2]]);
    });
  } catch (error) {
    nodes.forEach((node, i) => write(node, before[i]));
    throw error;
  }
}

async function createEffect(source: TextNode, angles: number[], assertCurrent: () => void): Promise<GroupNode> {
  validateText(source);
  await preflightFonts([source]);
  assertCurrent();
  validateText(source);
  progress('Creating editable letters...');
  const letters: TextNode[] = [];
  let group: GroupNode | undefined;
  try {
    let x = source.x;
    for (let i = 0; i < source.characters.length; i++) {
      const letter = source.clone();
      letters.push(letter);
      // Slice clones rather than assigning fontName/fontSize: retain all range styles.
      if (i + 1 < letter.characters.length) letter.deleteCharacters(i + 1, letter.characters.length);
      if (i > 0) letter.deleteCharacters(0, i);
      letter.name = source.characters[i] === ' ' ? 'Space' : source.characters[i];
      letter.x = x;
      letter.y = source.y + source.height + 24;
      x += letter.width;
    }
    group = figma.group(letters, figma.currentPage);
    group.name = `Crack Font - ${source.characters}`;
    const anchor = center(letters[0]);
    const data: EffectData = { version: 1, sourceId: source.id, glyphs: letters.map(node => {
      const p = center(node);
      return { id: node.id, text: node.characters, width: node.width, height: node.height,
        dx: p.x - anchor.x, dy: p.y - anchor.y };
    }) };
    group.setPluginData(DATA_KEY, JSON.stringify(data));
    await reroll(group, angles, assertCurrent);
    return group;
  } catch (error) {
    if (group && !group.removed) group.remove();
    for (const letter of letters) if (!letter.removed) letter.remove();
    throw error;
  }
}

async function apply(msg: Request): Promise<void> {
  const strength = msg.strength;
  if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 15) {
    fail('Rotation strength must be a number between 0 and 15 degrees.');
  }
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) fail('Select exactly one text layer or Crack Font group.');
  const selected = selection[0];
  const target = msg.target;
  const assertCurrent = () => {
    const now = selectionPreview();
    if (!target || selected.removed || !now.valid || target.id !== now.id || target.pageId !== now.pageId ||
        target.text !== now.text || target.revision !== now.revision) {
      fail('Selection or text changed. Review the updated preview and try again.');
    }
  };
  assertCurrent();
  if (!Array.isArray(msg.angles) || msg.angles.length !== target.text.length || msg.angles.length > MAX_LETTERS ||
      !Array.from(msg.angles).every(a => typeof a === 'number' && Number.isFinite(a) && Math.abs(a) <= strength)) {
    fail('Preview angles are invalid. Review the preview and try again.');
  }
  const angles = msg.angles.slice() as number[];
  let group: GroupNode;
  if (selected.type === 'GROUP') {
    group = selected;
    await reroll(group, angles, assertCurrent);
  } else if (selected.type === 'TEXT') {
    validateText(selected);
    const children = figma.currentPage.children;
    if (children.length > 10000) fail('This page is too large to safely find existing effects (maximum 10,000 top-level layers).');
    const matches = children.filter(n => {
      if (n.type !== 'GROUP' || !n.getPluginData(DATA_KEY)) return false;
      try { return JSON.parse(n.getPluginData(DATA_KEY)).sourceId === selected.id; }
      catch (_) { return false; }
    }) as GroupNode[];
    if (matches.length > 1) fail('Multiple copies of this effect exist. Select the specific Crack Font group to reroll.');
    if (matches.length) {
      group = matches[0];
      if (readEffect(group).glyphs.map(g => g.text).join('') !== target.text) {
        fail('The original text changed since these letters were created. Delete the effect group and Apply again.');
      }
      await reroll(group, angles, assertCurrent);
    } else {
      if (msg.type === 'reroll') fail('Apply once to create letters, then use Reroll.');
      group = await createEffect(selected, angles, assertCurrent);
    }
  } else { return fail('Select a text layer or a group created by Crack Font.'); }
  figma.currentPage.selection = [group];
  figma.viewport.scrollAndZoomIntoView([group]);
}

figma.showUI(__html__, { width: 360, height: 490, themeColors: true });
for (const event of ['selectionchange', 'currentpagechange'] as const) {
  figma.on(event, () => { revision++; send({ type: 'selection', selection: selectionPreview() }); });
}
figma.ui.onmessage = async (message: unknown) => {
  if (!message || typeof message !== 'object') return;
  const msg = message as Request;
  if (msg.channel !== CHANNEL || typeof msg.session !== 'string' || !/^[a-f0-9]{32}$/.test(msg.session)) return;
  if (msg.type === 'ready' && !session) session = msg.session;
  if (msg.session !== session) return;
  // An idle status probe fences off an action whose delivery was delayed or lost.
  if (msg.type === 'status' && !activeRequestId && Number.isSafeInteger(msg.requestId)) {
    lastRequestId = Math.max(lastRequestId, msg.requestId);
  }
  const state = () => send({ type: 'state', requestId: msg.requestId || 0, activeRequestId,
    result: lastResult, selection: selectionPreview() });
  if (msg.type === 'ready' || msg.type === 'status') { state(); return; }
  if (msg.type !== 'apply' && msg.type !== 'reroll') return;
  if (!Number.isSafeInteger(msg.requestId) || msg.requestId < 1) return;
  if (activeRequestId || msg.requestId <= lastRequestId) { state(); return; }
  lastRequestId = activeRequestId = msg.requestId;
  progress('Validating selection...');
  let ok = false, resultMessage = '';
  try {
    await apply(msg);
    ok = true; resultMessage = 'Letters updated. Your original text is unchanged.';
  } catch (error) {
    if (!(error instanceof InputError)) console.error('Crack Font operation', error);
    resultMessage = error instanceof InputError ? error.message :
      `Unexpected Figma error: ${error instanceof Error ? error.message : String(error)}. Your original text is unchanged. See the plugin console for details.`;
  } finally {
    activeRequestId = 0;
    lastResult = { type: 'result', requestId: msg.requestId, ok, message: resultMessage, selection: selectionPreview() };
    send(lastResult);
  }
};
