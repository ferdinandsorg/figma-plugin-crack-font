// Interim UI logic for phase 1 (Apply / Shuffle / Restore). Live editing follows in phase 2.
export {}

type Selection = { type: 'selection'; kind: 'crack' | 'text' | 'none'; name?: string; letters?: number; left?: number; right?: number; error?: string }
type Status = { type: 'status'; message: string; error: boolean }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const left = $<HTMLInputElement>('left'), right = $<HTMLInputElement>('right')
const selectionEl = $('selection'), statusEl = $('status')
const buttons = { apply: $('apply'), shuffle: $('shuffle'), restore: $('restore') }

const send = (type: string) => parent.postMessage({ pluginMessage: { type, left: Number(left.value), right: Number(right.value) } }, '*')
const showValue = (input: HTMLInputElement) => { $(`${input.id}-value`).textContent = `${input.value}°` }
for (const input of [left, right]) input.addEventListener('input', () => showValue(input))
for (const [type, button] of Object.entries(buttons)) button.addEventListener('click', () => {
  if (button.hasAttribute('disabled')) return
  statusEl.textContent = ''
  send(type)
})

function setDisabled(name: keyof typeof buttons, disabled: boolean): void {
  if (disabled) buttons[name].setAttribute('disabled', '')
  else buttons[name].removeAttribute('disabled')
}

window.onmessage = (event: MessageEvent) => {
  if (event.source !== parent) return
  const msg = event.data?.pluginMessage as Selection | Status | undefined
  if (!msg) return
  if (msg.type === 'status') {
    statusEl.className = msg.error ? 'error' : ''
    statusEl.textContent = msg.message
    return
  }
  if (msg.type !== 'selection') return
  const usable = msg.kind === 'crack' || (msg.kind === 'text' && !msg.error)
  selectionEl.textContent = msg.kind === 'none' ? (msg.error ?? '') : `${msg.kind === 'crack' ? 'Crack Font' : 'Text'} · “${msg.name}” · ${msg.letters} letters`
  if (msg.kind === 'text' && msg.error) { statusEl.className = 'error'; statusEl.textContent = msg.error }
  if (msg.kind === 'crack' && typeof msg.left === 'number' && typeof msg.right === 'number') {
    left.value = String(msg.left); right.value = String(msg.right)
    showValue(left); showValue(right)
  }
  setDisabled('apply', !usable)
  setDisabled('shuffle', !usable)
  setDisabled('restore', msg.kind !== 'crack')
}

parent.postMessage({ pluginMessage: { type: 'ready' } }, '*')
