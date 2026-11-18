// UI logic: sliders write live to the selected text, buttons for Shuffle / Restore / Done.
export {}

const MAX = 45
type Selection = { type: 'selection'; kind: 'crack' | 'text' | 'none'; name?: string; letters?: number; left?: number; right?: number; error?: string }
type Incoming = Selection | { type: 'status'; message: string; error: boolean } | { type: 'busy'; busy: boolean }

const $ = (id: string) => document.getElementById(id) as HTMLElement & { value?: string | number }
const sliders = { left: $('left'), right: $('right') }
const selectionEl = $('selection'), statusEl = $('status')
let selection: Selection = { type: 'selection', kind: 'none' }
let busy = false

const send = (msg: object) => parent.postMessage({ pluginMessage: msg }, '*')

/** Reads a slider, clamped to 0…MAX (typed values above the limit snap to it). */
function read(el: HTMLElement & { value?: string | number }): number {
  const v = Number(el.value ?? el.getAttribute('value'))
  return Number.isFinite(v) ? Math.min(MAX, Math.max(0, v)) : 0
}
function write(el: HTMLElement, v: number): void { el.setAttribute('value', String(v)) }
const values = () => ({ left: read(sliders.left), right: read(sliders.right) })
const usable = () => !busy && (selection.kind === 'crack' || (selection.kind === 'text' && !selection.error))

// Coalesce slider drags to one message per frame; the plugin also keeps only the newest.
let timer: ReturnType<typeof setTimeout> | undefined
function scheduleLive(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    if (usable()) send({ type: 'live', ...values() })
  }, 16)
}

for (const el of Object.values(sliders)) {
  el.addEventListener('input', scheduleLive)
  el.addEventListener('change', () => {
    const v = read(el)
    if (Number(el.value) !== v) write(el, v)
    scheduleLive()
  })
}

function onClick(id: string, handler: () => void): void {
  $(id).addEventListener('click', () => { if (!$(id).hasAttribute('disabled')) handler() })
}
onClick('shuffle', () => send({ type: 'shuffle', ...values() }))
onClick('restore', () => send({ type: 'restore' }))
onClick('done', () => send({ type: 'done' }))

function render(): void {
  const s = selection
  const label = s.kind === 'crack' ? 'Crack Font' : 'Text'
  selectionEl.textContent = s.kind === 'none' || s.error ? (s.error ?? 'Select a text layer.') : `${label} · ${s.name} · ${s.letters} ${s.letters === 1 ? 'letter' : 'letters'}`
  selectionEl.classList.toggle('error', !!s.error)
  for (const el of Object.values(sliders)) el.toggleAttribute('disabled', !usable())
  $('shuffle').toggleAttribute('disabled', !usable())
  $('restore').toggleAttribute('disabled', busy || s.kind !== 'crack')
  $('done').toggleAttribute('disabled', busy)
}

function status(message: string, error = false): void {
  statusEl.textContent = message
  statusEl.classList.toggle('error', error)
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
  if (msg.kind !== selection.kind || msg.name !== selection.name) status('')
  selection = msg
  // A Crack Font group brings its saved angles; plain text keeps the current slider values.
  if (msg.kind === 'crack' && typeof msg.left === 'number' && typeof msg.right === 'number') {
    write(sliders.left, msg.left)
    write(sliders.right, msg.right)
  }
  render()
})

// Start independently of component registration; the first 'ready' can get lost while Figma sets up
// the iframe, so ask again until the plugin answers (same as Font Axis Gradient).
send({ type: 'ready' })
render()
for (const delay of [100, 500, 1500, 4000]) setTimeout(() => { if (!connected) send({ type: 'ready' }) }, delay)
setTimeout(() => { if (!connected) status('Could not connect to Figma. Close and reopen the plugin.', true) }, 6000)
for (const tag of ['fig-slider', 'fig-button', 'fig-field', 'fig-footer']) customElements.whenDefined(tag).then(render)

let lastHeight = 0
new ResizeObserver(() => {
  const height = Math.ceil(document.body.getBoundingClientRect().height)
  if (height !== lastHeight) { lastHeight = height; send({ type: 'resize', height }) }
}).observe(document.body)
