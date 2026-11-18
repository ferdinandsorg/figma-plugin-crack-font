// UI logic: the fan and the angle fields write live to the selected text; Shuffle / Restore / Done.
import { Fan, type Side } from './fan'

const MAX = 45, STEP = 0.5
type Selection = { type: 'selection'; kind: 'crack' | 'text' | 'none'; name?: string; letters?: number; left?: number; right?: number; error?: string; legacy?: boolean }
type Incoming = Selection | { type: 'status'; message: string; error: boolean } | { type: 'busy'; busy: boolean }
type Field = HTMLElement & { value?: string | number }

const $ = (id: string) => document.getElementById(id) as Field
const fields: Record<Side, Field> = { left: $('left'), right: $('right') }
const statusEl = $('status')
const values: Record<Side, number> = { left: 3, right: 3 }
let selection: Selection = { type: 'selection', kind: 'none' }
let busy = false
let linked = false

const send = (msg: object) => parent.postMessage({ pluginMessage: msg }, '*')
const usable = () => !busy && selection.kind !== 'none' && !selection.error
const clamp = (v: number) => Math.min(MAX, Math.max(0, Math.round(v / STEP) * STEP))

// Coalesce changes to one message per frame; the plugin also keeps only the newest.
let timer: ReturnType<typeof setTimeout> | undefined
function scheduleLive(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    if (usable()) send({ type: 'live', ...values })
  }, 16)
}

/** One place for every change: keeps fan, fields and the linked side in sync. */
function setAngle(side: Side, value: number, from: 'fan' | 'field' | 'plugin'): void {
  const v = clamp(value)
  const sides: Side[] = linked && from !== 'plugin' ? ['left', 'right'] : [side]
  for (const s of sides) {
    values[s] = v
    fan.set(s, v)
    if (from !== 'field' || s !== side || Number(fields[s].value) !== v) fields[s].setAttribute('value', String(v))
  }
  if (from !== 'plugin') scheduleLive()
}

const fan = new Fan($('fan'), { max: MAX, step: STEP, onInput: (side, v) => setAngle(side, v, 'fan') })
fan.set('left', values.left)
fan.set('right', values.right)

for (const side of ['left', 'right'] as Side[]) {
  const read = () => { const v = Number(fields[side].value); if (Number.isFinite(v)) setAngle(side, v, 'field') }
  fields[side].addEventListener('input', read)
  fields[side].addEventListener('change', read)
}

$('link').addEventListener('click', () => {
  linked = !linked
  $('link').toggleAttribute('selected', linked)
  $('link').setAttribute('aria-pressed', String(linked))
  if (linked && values.left !== values.right) setAngle('left', Math.max(values.left, values.right), 'field')
})

// Easter egg: press a letter or digit anywhere (outside the number fields) and the fan shows it.
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
  if (e.target instanceof Element && e.target.closest('fig-input-number, input, textarea, [contenteditable]')) return
  if (/^[a-z0-9äöüàáâãåæçèéêëìíîïñòóôõøùúûýÿ]$/i.test(e.key)) fan.setLetter(e.key.toLocaleUpperCase())
})

function onClick(id: string, handler: () => void): void {
  $(id).addEventListener('click', () => { if (!$(id).hasAttribute('disabled')) handler() })
}
onClick('shuffle', () => send({ type: 'shuffle', ...values }))
onClick('restore', () => send({ type: 'restore' }))
onClick('done', () => send({ type: 'done' }))

function plural(n = 0): string { return `${n} ${n === 1 ? 'letter' : 'letters'}` }

function render(): void {
  const s = selection
  // The selection bar is always one line, so the window keeps its height; problems go to the status line.
  $('selection-bar').className = `selection-bar ${s.kind}${s.error ? ' error' : ''}`
  $('selection').textContent = s.kind === 'none' ? 'Select a text layer' : `${s.name} · ${plural(s.letters)}`
  $('selection').title = s.kind === 'none' ? '' : s.name ?? ''
  const on = usable()
  fan.setDisabled(!on)
  for (const f of Object.values(fields)) f.toggleAttribute('disabled', !on)
  $('link').toggleAttribute('disabled', !on)
  $('shuffle').toggleAttribute('disabled', !on)
  $('restore').toggleAttribute('disabled', busy || s.kind !== 'crack' || !!s.error)
  $('done').toggleAttribute('disabled', busy)
  renderStatus()
}

/** Status line: a message from the plugin, else the selection's problem, else a hint. */
function renderStatus(): void {
  const s = selection
  const shown = message ?? (s.error ? { text: s.error, error: true } : { text: hintFor(s), error: false })
  statusEl.textContent = shown.text
  statusEl.classList.toggle('error', shown.error)
}

function hintFor(s: Selection): string {
  if (s.kind === 'none') return 'Select a single-line text layer to crack its letters.'
  if (s.kind === 'text') return 'Drag the fan or type an angle. The text splits into letters on the first change.'
  if (s.legacy) return 'From Crack Font 1. Restore removes these letters; the original is untouched.'
  return 'Drag the fan or Shuffle for a new pattern. Restore brings back the text layer.'
}

let message: { text: string; error: boolean } | null = null
function status(text: string, error = false): void {
  message = text ? { text, error } : null
  renderStatus()
}

// Figma Desktop does not deliver plugin messages with event.source === parent, so don't filter on it
// (Font Axis Gradient does the same). Only messages carrying a pluginMessage are handled.
let connected = false
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as Incoming | undefined
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'status') { status(msg.message, msg.error); return }
  if (msg.type === 'busy') { busy = msg.busy; render(); return }
  if (msg.type !== 'selection') return
  connected = true
  const changed = msg.kind !== selection.kind || msg.name !== selection.name
  selection = msg
  if (changed) status('')
  // A Crack Font group brings its saved angles; plain text keeps the current values.
  if (msg.kind === 'crack' && typeof msg.left === 'number' && typeof msg.right === 'number') {
    setAngle('left', msg.left, 'plugin')
    setAngle('right', msg.right, 'plugin')
  }
  render()
})

// Start independently of component registration; the first 'ready' can get lost while Figma sets up
// the iframe, so ask again until the plugin answers (same as Font Axis Gradient).
send({ type: 'ready' })
render()
for (const delay of [100, 500, 1500, 4000]) setTimeout(() => { if (!connected) send({ type: 'ready' }) }, delay)
setTimeout(() => { if (!connected) status('Could not connect to Figma. Close and reopen the plugin.', true) }, 6000)
for (const tag of ['fig-input-number', 'fig-button', 'fig-footer']) customElements.whenDefined(tag).then(render)

let lastHeight = 0
new ResizeObserver(() => {
  const height = Math.ceil(document.body.getBoundingClientRect().height)
  if (height !== lastHeight) { lastHeight = height; send({ type: 'resize', height }) }
}).observe(document.body)
