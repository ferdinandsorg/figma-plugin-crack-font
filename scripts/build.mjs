// Builds dist/code.js (plugin sandbox) and dist/ui.html (src/ui.html with FigUI3 CSS/JS and
// the bundled src/ui/main.ts inlined — Figma plugin iframes cannot load relative files).
import { build, context } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const watchMode = process.argv.includes('--watch')
const figui = 'node_modules/@rogieking/figui3/dist'
const safe = js => js.replace(/<\/script/gi, '<\\/script')

const codeOptions = { entryPoints: ['src/code.ts'], bundle: true, outfile: 'dist/code.js', target: 'es2017', logLevel: 'info' }
const uiOptions = { entryPoints: ['src/ui/main.ts'], bundle: true, write: false, format: 'iife', target: 'es2020', logLevel: 'info' }

async function writeUi(uiJs) {
  const [html, css, js] = await Promise.all([
    readFile('src/ui.html', 'utf8'),
    readFile(`${figui}/fig.css`, 'utf8'),
    readFile(`${figui}/fig.js`, 'utf8'),
  ])
  if (!html.includes('</head>') || !html.includes('<!-- UI_SCRIPT -->')) throw new Error('src/ui.html needs </head> and <!-- UI_SCRIPT -->')
  const head = `<style>${css}</style>\n<script type="module">${safe(js)}</script>\n`
  const out = html.replace('</head>', () => head + '</head>').replace('<!-- UI_SCRIPT -->', () => `<script>${safe(uiJs)}</script>`)
  await writeFile('dist/ui.html', out)
  console.log('built dist/ui.html')
}

// esbuild plugin: after every UI bundle, assemble the HTML.
const assembleUi = {
  name: 'assemble-ui',
  setup(b) {
    b.onEnd(async result => {
      if (result.errors.length) return
      await writeUi(result.outputFiles[0].text).catch(e => console.error(e.message))
    })
  },
}

await mkdir('dist', { recursive: true })
if (watchMode) {
  const code = await context(codeOptions)
  const ui = await context({ ...uiOptions, plugins: [assembleUi] })
  await Promise.all([code.watch(), ui.watch()])
  // src/ui.html is not part of the bundle graph; rebuild when it changes.
  const { watch } = await import('node:fs/promises')
  for await (const event of watch('src')) if (event.filename === 'ui.html') await ui.rebuild()
} else {
  await Promise.all([build(codeOptions), build({ ...uiOptions, plugins: [assembleUi] })])
}
