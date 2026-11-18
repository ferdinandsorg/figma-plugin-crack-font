// Plugin sandbox: selection handling and messages. Live editing and undo grouping follow in phase 2.
import { findCrack, rotate, restore, shuffle, split, validateSource, UserError, type Crack } from './crack'
import { clampAngle } from './rotate'

type Message = { type?: string; left?: unknown; right?: unknown }
type Target = { kind: 'crack'; crack: Crack } | { kind: 'text'; node: TextNode } | { kind: 'none'; error: string }

const DEFAULTS = { left: 3, right: 3 }
let busy = false

function target(): Target {
  const selection = figma.currentPage.selection
  if (selection.length !== 1) return { kind: 'none', error: selection.length ? 'Select only one text layer.' : 'Select a text layer.' }
  const node = selection[0]
  const crack = findCrack(node)
  if (crack) return { kind: 'crack', crack }
  if (node.type !== 'TEXT') return { kind: 'none', error: 'Select a text layer.' }
  return { kind: 'text', node }
}

function postSelection(): void {
  const t = target()
  if (t.kind === 'crack') {
    const { data, original } = t.crack
    figma.ui.postMessage({ type: 'selection', kind: 'crack', name: original.characters, letters: data.letters.length, left: data.left, right: data.right })
  } else if (t.kind === 'text') {
    let error: string | undefined
    try { validateSource(t.node) } catch (e) { error = e instanceof Error ? e.message : String(e) }
    figma.ui.postMessage({ type: 'selection', kind: 'text', name: t.node.characters, letters: t.node.characters.length, error })
  } else {
    figma.ui.postMessage({ type: 'selection', kind: 'none', error: t.error })
  }
}

function status(message: string, error = false): void {
  figma.ui.postMessage({ type: 'status', message, error })
}

async function handle(msg: Message): Promise<void> {
  const t = target()
  if (msg.type === 'restore') {
    if (t.kind !== 'crack') return status('Select a Crack Font group to restore.', true)
    const original = restore(t.crack)
    figma.currentPage.selection = [original]
    return status('Original text restored.')
  }
  const left = clampAngle(msg.left ?? DEFAULTS.left), right = clampAngle(msg.right ?? DEFAULTS.right)
  if (left === null || right === null) return status('Rotation must be a number.', true)
  if (t.kind === 'none') return status(t.error, true)
  if (t.kind === 'text') {
    const crack = await split(t.node, left, right)
    figma.currentPage.selection = [crack.group]
    return status(`${crack.data.letters.length} letters. Restore turns them back into one text layer.`)
  }
  t.crack.data.left = left
  t.crack.data.right = right
  if (msg.type === 'shuffle') shuffle(t.crack)
  else rotate(t.crack)
}

figma.showUI(__html__, { width: 300, height: 260, themeColors: true })
figma.on('selectionchange', () => { if (!busy) postSelection() })
figma.ui.onmessage = async (msg: Message) => {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'ready') { postSelection(); return }
  if (msg.type === 'close') { if (!busy) figma.closePlugin(); return }
  if (msg.type !== 'apply' && msg.type !== 'shuffle' && msg.type !== 'restore') return
  if (busy) return
  busy = true
  try { await handle(msg) }
  catch (error) {
    status(error instanceof UserError ? error.message : 'Could not update the text. Nothing was changed.', true)
    if (!(error instanceof UserError)) console.error(error)
  } finally {
    busy = false
    postSelection()
  }
}
