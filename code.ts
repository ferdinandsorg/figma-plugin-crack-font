const DATA_KEY = 'crack-font-v1';
const MAX_LETTERS = 200;
type GlyphData = { id: string; text: string; width: number; height: number; dx: number; dy: number };
type EffectData = { version: 1; sourceId: string; glyphs: GlyphData[] };
let busy = false;

function fail(message: string): never { throw new Error(message); }

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
      fonts.set(JSON.stringify(font), font);
    }
  }
  for (const font of fonts.values()) {
    try { await figma.loadFontAsync(font); }
    catch (_) { fail(`Could not load ${font.family} ${font.style}. No letters were changed.`); }
  }
  nodes.forEach((node, i) => {
    if (node.removed || signatures[i] !== JSON.stringify([node.characters,
      node.getRangeAllFontNames(0, node.characters.length)])) {
      fail('Text changed while fonts were loading. Please try again.');
    }
  });
}

async function reroll(group: GroupNode, strength: number): Promise<void> {
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
  const write = (node: TextNode, t: Transform) => {
    const parent = group.absoluteTransform;
    node.relativeTransform = [[t[0][0], t[0][1], t[0][2] - parent[0][2]],
      [t[1][0], t[1][1], t[1][2] - parent[1][2]]];
  };
  try {
    nodes.forEach((node, i) => {
      const radians = ((Math.random() * 2 - 1) * strength) * Math.PI / 180;
      const c = Math.cos(radians), s = Math.sin(radians), p = positions[i];
      write(node, [[c, s, p.x - c * node.width / 2 - s * node.height / 2],
        [-s, c, p.y + s * node.width / 2 - c * node.height / 2]]);
    });
  } catch (error) {
    nodes.forEach((node, i) => write(node, before[i]));
    throw error;
  }
}

async function createEffect(source: TextNode, strength: number): Promise<GroupNode> {
  validateText(source);
  await preflightFonts([source]);
  validateText(source);
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
    await reroll(group, strength);
    return group;
  } catch (error) {
    if (group && !group.removed) group.remove();
    for (const letter of letters) if (!letter.removed) letter.remove();
    throw error;
  }
}

async function apply(strength: unknown, rerollOnly: boolean): Promise<void> {
  if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 15) {
    fail('Rotation strength must be a number between 0 and 15 degrees.');
  }
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) fail('Select exactly one text layer or Crack Font group.');
  const selected = selection[0];
  let group: GroupNode;
  if (selected.type === 'GROUP') {
    group = selected;
    await reroll(group, strength);
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
      await reroll(group, strength);
    } else {
      if (rerollOnly) fail('Apply once to create letters, then use Reroll.');
      group = await createEffect(selected, strength);
    }
  } else { return fail('Select a text layer or a group created by Crack Font.'); }
  figma.currentPage.selection = [group];
  figma.viewport.scrollAndZoomIntoView([group]);
}

figma.showUI(__html__, { width: 320, height: 330, themeColors: true });
figma.ui.onmessage = async (message: unknown) => {
  if (!message || typeof message !== 'object') return;
  const msg = message as { type?: string; strength?: unknown };
  if (msg.type === 'close') { if (!busy) figma.closePlugin(); return; }
  if (msg.type !== 'apply' && msg.type !== 'reroll') return;
  if (busy) return;
  busy = true;
  try {
    await apply(msg.strength, msg.type === 'reroll');
    figma.ui.postMessage({ type: 'result', ok: true, message: 'Letters updated. Your original text is unchanged.' });
  } catch (error) {
    figma.ui.postMessage({ type: 'result', ok: false,
      message: error instanceof Error ? error.message : 'Could not update letters. Your original text is unchanged.' });
  } finally { busy = false; }
};
