# Crack Font

A standard Community Figma plugin that splits text into editable letters and rotates each independently. Plugin ID: `929414938810147814`.

## Use

1. Select one visible, unlocked, top-level text layer in Figma Design.
2. Use a single line, Auto width, left alignment and Original text case.
3. Open Crack Font, choose rotation strength (default +/-2 degrees, range 0-15), then Apply.
4. The original stays visible and unchanged. A group of editable letter clones appears 24 units below it. Both Apply and Reroll reuse those same letters, with fresh absolute rotations rather than adding rotation. Strength 0 straightens them.
5. Reselect the original or the generated group to update it. This works after reopening the plugin. You can move the entire group, or delete the original, and still reroll the intact group.

Delete the effect group to start over or discard it. There is no hidden original or restore operation: the plugin never edits, hides or deletes the original, including its plugin data. Figma Undo is also available. Duplicated groups are editable artwork but cannot be rerolled because their child IDs change. If multiple source-linked groups exist, selecting the source reports ambiguity instead of creating another copy; select the intact original effect group or delete its copies.

## Safety and Limitations

- At most 200 characters including spaces. Whitespace-only text is rejected.
- The explicit supported character set is printable ASCII U+0020-U+007E and precomposed Latin-1 U+00C0-U+00FF. Other characters are rejected before any mutation. In particular, no UTF-16 splitting of surrogate pairs, emoji, ZWJ sequences, combining marks, flags or shaping scripts is attempted. Precompose accents (for example, use U+00E9 rather than `e` + U+0301).
- Multiline, tabs, wrapped/fixed-width text, transformed text case, rotated/flipped/scaled layers, nested layers, frames/components/instances and auto-layout are not supported. Copy the text to the page first. Locked or invisible layers/ancestors are rejected. The plugin never unlocks anything.
- Splitting re-typesets independent glyphs in a horizontal row using each clone's natural width and top alignment. Original kerning, ligatures, baseline relationships between mixed font sizes, and paragraph layout are not reproduced. Rotation is around each letter's center. This is a letter effect, not exact preservation of the source's typesetting.
- Each letter is sliced from a clone of the source, preserving range fonts, sizes, fills, decorations and other text formatting instead of assigning mixed properties to new text nodes. Spaces remain editable text nodes. All source fonts are loaded before cloning; unavailable fonts abort without mutation. Partial creation is cleaned up. Existing rerolls preflight fonts and snapshot transforms for rollback on API errors.
- Reroll uses only private, versioned plugin metadata and checks saved child IDs, content, size and arrangement. Arbitrary groups are never modified. Do not change the effect's text, glyph dimensions, arrangement, locks or group rotation if you need reroll. Color/style edits that do not change geometry can remain. Keep a modified effect as editable artwork, or delete it and Apply to the original again.
- Existing effects are found among at most 10,000 top-level page layers. Work is bounded; no recursive traversal of the document or loading of other pages is needed. Dynamic-page access is enabled. No external network, AI, authentication or credentials are used.

## Build and Test

Requires Node.js 22+. Roadmap: [PLAN.md](PLAN.md).

```sh
npm install
npm run build      # dist/code.js + dist/ui.html
npm run watch      # rebuild on change
npm run typecheck
npm test
```

In Figma Desktop: **Plugins → Development → Import plugin from manifest…** → `manifest.json`. Console: **Plugins → Development → Show/Hide console**. Test file: https://www.figma.com/design/UsrT5bOvoav6SWTCUWUuEk

- `src/code.ts` – plugin logic (sandbox)
- `src/ui.html` + `src/ui/main.ts` – UI, bundled with FigUI3 into `dist/ui.html`
- `scripts/build.mjs` – esbuild build
- `.claude/skills/figui3`, `.claude/skills/propskit` – agent skills from `@rogieking/figui3` (MIT)

## Manual Figma Check and Publication

Import `manifest.json` as a development plugin. Try mixed fonts/sizes/fills and spaces; confirm the original remains unchanged and the new letters stay editable. Test strengths 0, 2 and 15, repeatedly Apply/Reroll, move the group, reopen the plugin and reroll again. Confirm rejection of multiline/fixed-width text, combining accents/emoji, locked ancestors and nested auto-layout. Check missing fonts and Undo in the real host.

This upgrade is based on commit `18692591a4843660b46698731410fb809d6e885a`. Updating files on GitHub does not publish a Community plugin release. The owner must build, test and manually publish the existing plugin through Figma's publishing flow, retaining the existing ID. No deployment or publication is performed by this source change.
