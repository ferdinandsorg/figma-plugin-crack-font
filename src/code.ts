// Plugin sandbox: selection handling, live editing on the canvas, undo grouping.
import { assertCrackEditable, inspect, rotate, restore, shuffle, split, validateSource, UserError, type Crack } from './crack'
import { clampAngle } from './rotate'

type Message = { type?: string; left?: unknown; right?: unknown }
type Target = { kind: 'crack'; crack: Crack } | { kind: 'text'; node: TextNode } | { kind: 'none'; error: string }

const NO_SELECTION = 'Select a text layer.'

async function target(): Promise<Target> {
  const selection = figma.currentPage.selection
  if (selection.length !== 1) return { kind: 'none', error: selection.length ? 'Select only one text layer.' : NO_SELECTION }
  const node = selection[0]
  const found = await inspect(node)
  if (found && 'error' in found) return { kind: 'none', error: found.error }
  if (found) return { kind: 'crack', crack: found.crack }
  if (node.type !== 'TEXT') return { kind: 'none', error: 'Select a text layer.' }
  return { kind: 'text', node }
}

// Selection info is computed asynchronously; only the newest request may post.
let selectionRequest = 0
async function postSelection(): Promise<void> {
  const request = ++selectionRequest
  const t = await target()
  if (request !== selectionRequest) return
  if (t.kind === 'crack') {
    const { data, original, group } = t.crack
    const legacy = !original
    const name = original ? original.characters : group.name.replace(/^Crack Font\s*[-–]\s*/, '')
    let error: string | undefined
    try { assertCrackEditable(t.crack) } catch (e) { error = e instanceof Error ? e.message : String(e) }
    figma.ui.postMessage({ type: 'selection', kind: 'crack', name, letters: data.letters.length, left: data.left, right: data.right, legacy, error })
  } else if (t.kind === 'text') {
    let error: string | undefined
    try { validateSource(t.node) } catch (e) { error = e instanceof Error ? e.message : String(e) }
    figma.ui.postMessage({ type: 'selection', kind: 'text', name: t.node.characters, letters: t.node.characters.length, error })
  } else {
    // Nothing selected is not an error: the UI shows its own hint.
    figma.ui.postMessage({ type: 'selection', kind: 'none', error: t.error === NO_SELECTION ? undefined : t.error })
  }
}

/** Fire-and-forget selection update (from events). */
function refresh(): void {
  postSelection().catch(error => console.error(error))
}

function status(message: string, error = false): void {
  figma.ui.postMessage({ type: 'status', message, error })
}

function report(error: unknown): void {
  status(error instanceof UserError ? error.message : 'Could not update the text. Nothing was changed.', true)
  if (!(error instanceof UserError)) console.error(error)
}

function angles(msg: Message): { left: number; right: number } | null {
  const left = clampAngle(msg.left), right = clampAngle(msg.right)
  return left === null || right === null ? null : { left, right }
}

// ---------- undo grouping ----------
// Live changes are not committed per slider step. Figma closes an undo step when the user lets go;
// we additionally close it on selection changes, Shuffle, Restore and Done.
let dirty = false
function commit(): void {
  if (!dirty) return
  dirty = false
  figma.commitUndo()
}

// Selecting the new letter group ourselves must not look like the user switching layers.
let ownSelection: string | null = null
function select(node: SceneNode): void {
  ownSelection = node.id
  figma.currentPage.selection = [node]
}

/** Splits the selected text on first use, otherwise returns the selected Crack Font group. */
async function crackFor(t: Target, left: number, right: number): Promise<Crack | null> {
  if (t.kind === 'none') { status(t.error, true); return null }
  if (t.kind === 'crack') { assertCrackEditable(t.crack); return t.crack }
  const crack = await split(t.node, left, right)
  select(crack.group)
  await postSelection()
  status(`${crack.data.letters.length} letters. Restore turns them back into one text layer.`)
  return crack
}

// ---------- live editing ----------
// At most one write at a time; while one runs, only the newest request is kept.
let liveRunning = false
let liveNext: Message | null = null
let busy = false // Shuffle / Restore / Done in progress

function requestLive(msg: Message): void {
  if (liveRunning) { liveNext = msg; return }
  liveRunning = true
  applyLive(msg).catch(report).finally(() => {
    liveRunning = false
    const next = liveNext
    liveNext = null
    if (next && !busy) requestLive(next)
  })
}

async function waitForLive(): Promise<void> {
  liveNext = null
  while (liveRunning) await new Promise<void>(resolve => setTimeout(resolve, 10))
}

async function applyLive(msg: Message): Promise<void> {
  const a = angles(msg)
  if (!a) return
  const t = await target()
  const wasText = t.kind === 'text'
  const crack = await crackFor(t, a.left, a.right)
  if (!crack) return
  if (!wasText) {
    crack.data.left = a.left
    crack.data.right = a.right
    rotate(crack)
  }
  dirty = true
}

async function runShuffle(msg: Message): Promise<void> {
  const a = angles(msg)
  if (!a) return
  commit()
  const t = await target()
  const crack = await crackFor(t, a.left, a.right) // a fresh split already has new seeds
  if (!crack) return
  if (t.kind === 'crack') {
    crack.data.left = a.left
    crack.data.right = a.right
    shuffle(crack)
  }
  dirty = true
  commit()
}

async function runRestore(): Promise<void> {
  const t = await target()
  if (t.kind !== 'crack') { status('Select a Crack Font group to restore.', true); return }
  const legacy = !t.crack.original
  const original = restore(t.crack)
  dirty = true
  commit()
  if (original) select(original)
  await postSelection()
  status(legacy ? 'Letters removed. Your original text was never changed.' : 'Original text restored.')
}

async function exclusive(task: () => Promise<void> | void): Promise<void> {
  if (busy) return
  busy = true
  figma.ui.postMessage({ type: 'busy', busy: true })
  try {
    await waitForLive()
    await task()
  } catch (error) { report(error) }
  finally {
    busy = false
    figma.ui.postMessage({ type: 'busy', busy: false })
  }
}

figma.showUI(__html__, { width: 280, height: 220, themeColors: true })

figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection
  if (ownSelection && selection.length === 1 && selection[0].id === ownSelection) { ownSelection = null; return }
  ownSelection = null
  commit()
  if (!busy) refresh()
})

figma.ui.onmessage = async (msg: Message) => {
  if (!msg || typeof msg !== 'object') return
  switch (msg.type) {
    case 'ready': refresh(); return
    case 'resize': {
      const h = (msg as { height?: unknown }).height
      if (typeof h === 'number' && Number.isFinite(h)) figma.ui.resize(280, Math.max(120, Math.min(600, Math.round(h))))
      return
    }
    case 'live': if (!busy) requestLive(msg); return
    case 'shuffle': await exclusive(() => runShuffle(msg)); return
    case 'restore': await exclusive(runRestore); return
    case 'done': await exclusive(() => { commit(); figma.closePlugin() }); return
  }
}

// Tell the UI about the current selection right away; Figma delivers it once the UI has loaded.
refresh()
