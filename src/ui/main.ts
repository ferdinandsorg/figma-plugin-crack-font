// Phase 0: the legacy UI logic, moved out of ui.html so esbuild can bundle it.
// Replaced by the FigUI3 live-editing UI in phases 2–3.
export {}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const slider = $<HTMLInputElement>('strength')
const value = $('value')
const statusEl = $('status')
const buttons = Array.from(document.querySelectorAll('button'))
slider.oninput = () => { value.textContent = `+/-${slider.value} degrees` }
for (const button of buttons) button.onclick = () => {
  for (const b of buttons) b.disabled = true
  statusEl.className = ''
  statusEl.textContent = 'Loading fonts and updating letters...'
  parent.postMessage({ pluginMessage: { type: button.id, strength: Number(slider.value) } }, '*')
}
window.onmessage = (event: MessageEvent) => {
  if (event.source !== parent) return
  const msg = event.data?.pluginMessage
  if (!msg || msg.type !== 'result') return
  for (const b of buttons) b.disabled = false
  statusEl.className = msg.ok ? '' : 'error'
  statusEl.textContent = msg.message
}
