# Crack Font

Figma plugin that splits a text layer into single letters and tilts each one a little, live on the canvas. Restore turns the letters back into the original text layer. Plugin ID: `929414938810147814` (Community). Roadmap and decisions: [PLAN.md](PLAN.md).

## Use

1. Select a text layer (on the page, in a frame, group or auto layout).
2. Open **Crack Font**. Drag the fan or type how far letters may tilt **left** and **right** (0–45°). The link button sets both sides to the same angle.
3. The first change splits the text into letters in place; every further change only tilts them. **Shuffle** draws a new random pattern.
4. **Restore** turns the letters back into the original text layer, exactly as it was. **Done** closes the plugin.

Select a Crack Font group (or one of its letters) later to keep editing it. Undo works step by step: one step per released drag, Shuffle or Restore.

Easter egg: press any letter or digit while the plugin has focus and the fan shows it.

## How it works

- Each letter is a clone of the text, sliced to one character, so every range style survives. Positions come from prefix widths, so kerning is kept. Mixed font sizes stay on one baseline through zero-width "strut" characters.
- The original text is kept: hidden and locked inside the letter group, or in auto layout left in place at opacity 0 (it keeps its space, so nothing else moves) with the letters absolutely positioned on top.
- Every letter gets one random seed. The angles only scale that pattern, so dragging never jumps around. Seeds and angles are stored on the group (`crack-font-v2` plugin data).
- Spaces get no layer unless they are underlined or struck through.
- Groups made by Crack Font 1 can still be tilted and shuffled; Restore removes their letters (their original was never changed).

## Limits

- One line, Auto width, at most 200 characters, Latin letters (printable ASCII and Latin-1). No emoji, combining accents or other scripts.
- Text inside instances can't be split (Figma doesn't allow new layers there).
- Changing a letter's text or font after splitting works, but Restore always brings back the original.
- No network access.

## Development

Requires Node.js 22+.

```sh
npm install
npm run build      # dist/code.js + dist/ui.html
npm run watch      # rebuild on change
npm run typecheck
npm test           # builds, then runs the vitest suite
```

In Figma Desktop: **Plugins → Development → Import plugin from manifest…** → `manifest.json`. Console: **Plugins → Development → Show/Hide console**. Test file: https://www.figma.com/design/UsrT5bOvoav6SWTCUWUuEk

- `src/code.ts` – plugin sandbox: selection, live editing, undo grouping
- `src/crack.ts` – split, rotate, shuffle, restore
- `src/rotate.ts` – pure angle and matrix math
- `src/ui.html`, `src/ui/main.ts`, `src/ui/fan.ts` – UI with FigUI3, bundled into `dist/ui.html`
- `scripts/build.mjs` – esbuild build
- `test/` – unit tests and tests of the built plugin against a Figma mock
- `.claude/skills/figui3`, `.claude/skills/propskit` – agent skills from `@rogieking/figui3` (MIT)

## Publishing

Publish through Figma (**Plugins → Development → Manage plugins**) with the existing ID and mention "2.0" in the release notes. The `"api": "1.0.0"` field in `manifest.json` is the Figma plugin API version, not the plugin version; leave it as is.
