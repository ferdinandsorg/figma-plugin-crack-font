# Crack Font

A standard Community Figma plugin that splits text into editable letters and rotates each independently. Plugin ID: `929414938810147814`.

## Use

1. Select one visible, unlocked, top-level text layer in Figma Design.
2. Use a single line, Auto width, left alignment and Original text case.
3. Open Crack Font. The letters in the Rotation strength label and the selected text in the gray preview field rotate live as you drag the slider (default +/-2 degrees, range 0-15). Slider changes never touch the canvas.
4. Apply uses the preview's per-letter angles. The original stays visible and unchanged. A group of editable letter clones appears 24 units below it. Apply reuses those same letters; Reroll draws fresh preview angles and applies them to the same group rather than adding rotation or duplicating output. Strength 0 straightens them.
5. Reselect the original or the generated group to update it. This works after reopening the plugin. You can move the entire group, or delete the original, and still reroll the intact group.

Delete the effect group to start over or discard it. There is no hidden original or restore operation: the plugin never edits, hides or deletes the original, including its plugin data. Figma Undo is also available. Duplicated groups are editable artwork but cannot be rerolled because their child IDs change. If multiple source-linked groups exist, selecting the source reports ambiguity instead of creating another copy; select the intact original effect group or delete its copies.

## Preview and Connection Recovery

- The centered gray-field preview uses a system font, not the document's actual fonts or styles. Per-index angles match Apply/Reroll (including CSS/Figma rotation direction), but typography and spacing are indicative, not pixel-identical. Long text scales down and wraps in the preview only. The canvas retains the source's original range formatting. Slider coefficients remain fixed while dragging; Reroll draws new ones. There are no decorative A endpoints.
- A UI-ready handshake publishes the current text or plugin-owned group's text without loading fonts. Selection/page changes refresh it. Actions identify the page, layer, text and selection revision; changes during font loading abort rather than applying a stale preview. If the original's text no longer matches an existing effect, delete that effect and Apply again.
- Replies carry a private, random 128-bit UI session capability, protocol channel and request IDs. The UI does not depend on `MessageEvent.source === parent`: host bridges can forward replies with a null/different source. The public Figma UI API documents `pluginMessage`, not a guaranteed browser source identity. Wrong-session and stale replies are ignored; user text is rendered with `textContent` only.
- Font loading has one shared 10-second deadline with the pending family/style in the error. Successful fonts are cached for the plugin session, including between creation and reroll. Fonts are still conservatively preflighted before transforms rather than assuming all host text transforms are font-independent. A late font resolution cannot resume a timed-out operation or mutate the canvas.
- Controls and the slider stay disabled during an operation. Progress identifies validation, font loading, creation and rotation. After 5 seconds without a reply, the UI probes backend status; it never enables a duplicate operation solely because a UI timer expired. A cached result recovers a lost completion. An idle probe fences off delayed request delivery. If the host remains silent, use Check connection or close/reopen the plugin. Expected failures are shown in the UI; unexpected API failures are also logged to the plugin console.

The earlier source had both a strict browser-source filter and unbounded `loadFontAsync` awaits. Either could explain a stuck loading message. The bridge and hanging-font failure modes are covered by local tests, but the user's live Figma hang has not been reproduced or verified fixed in Figma.

## Safety and Limitations

- At most 200 characters including spaces. Whitespace-only text is rejected.
- The explicit supported character set is printable ASCII U+0020-U+007E and precomposed Latin-1 U+00C0-U+00FF. Other characters are rejected before any mutation. In particular, no UTF-16 splitting of surrogate pairs, emoji, ZWJ sequences, combining marks, flags or shaping scripts is attempted. Precompose accents (for example, use U+00E9 rather than `e` + U+0301).
- Multiline, tabs, wrapped/fixed-width text, transformed text case, rotated/flipped/scaled layers, nested layers, frames/components/instances and auto-layout are not supported. Copy the text to the page first. Locked or invisible layers/ancestors are rejected. The plugin never unlocks anything.
- Splitting re-typesets independent glyphs in a horizontal row using each clone's natural width and top alignment. Original kerning, ligatures, baseline relationships between mixed font sizes, and paragraph layout are not reproduced. Rotation is around each letter's center. This is a letter effect, not exact preservation of the source's typesetting.
- Each letter is sliced from a clone of the source, preserving range fonts, sizes, fills, decorations and other text formatting instead of assigning mixed properties to new text nodes. Spaces remain editable text nodes. All source fonts are loaded before cloning; unavailable fonts abort without mutation. Partial creation is cleaned up. Existing rerolls preflight fonts and snapshot transforms for rollback on API errors.
- Reroll uses only private, versioned plugin metadata and checks saved child IDs, content, size and arrangement. Arbitrary groups are never modified. Do not change the effect's text, glyph dimensions, arrangement, locks or group rotation if you need reroll. Color/style edits that do not change geometry can remain. Keep a modified effect as editable artwork, or delete it and Apply to the original again.
- Existing effects are found among at most 10,000 top-level page layers. Work is bounded; no recursive traversal of the document or loading of other pages is needed. Dynamic-page access is enabled. No external services, AI, user login or credentials are used.

## Build and Test

Requires Node.js 22+ and pnpm. Versions of TypeScript and the public Figma typings are pinned in `package.json` and `pnpm-lock.yaml`; the existing npm lockfile is retained.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
```

`code.ts` compiles to the checked-in `code.js`. The standalone UI is `ui.html`; no UI framework or internal Figma package is needed. The legacy repository tracks `node_modules`; this change leaves those tracked files untouched. Use a clean toolchain installed from the lockfile rather than the old checked-in dependencies. Do not include installed dependency changes when uploading the upgrade.

Tests execute the actual compiled plugin and UI scripts in Node VMs with mock Figma/DOM APIs, including group-bounds normalization during child rotation and fake timers. They cover preview-to-canvas angles, ready/selection messages, null-source replies, stale messages, the UI watchdog, font deadlines and late resolutions, cache/retry, center stability, repeated Apply/Reroll, persisted groups, original preservation, mixed styles, cleanup/rollback, unsupported Unicode/layouts and bounded work. These are not live Figma integration tests; real font shaping, clone slicing and host undo behavior still need manual checks in Figma.

## Manual Figma Check and Publication

Import `manifest.json` as a development plugin. Confirm the label and gray preview animate at strengths 0, 2 and 15, and that selection changes refresh the preview without a canvas edit. Try 200-character text and both Figma themes. Apply and compare rotation directions; repeatedly Apply/Reroll, move the group, reopen and reroll. Try mixed fonts/sizes/fills and spaces; confirm the original remains unchanged and the letters stay editable. Confirm rejection of multiline/fixed-width text, combining accents/emoji, locked ancestors and nested auto-layout. Check font-timeout recovery, selection/page changes during loading, missing fonts, plugin-console errors and Undo in the real host.

This upgrade is based on commit `18692591a4843660b46698731410fb809d6e885a`. Updating files on GitHub does not publish a Community plugin release. The owner must build, test and manually publish the existing plugin through Figma's publishing flow, retaining the existing ID. No deployment or publication is performed by this source change.
