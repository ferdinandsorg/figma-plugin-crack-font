# Plan: Crack Font – Live-Rotation direkt auf dem Text

Stand: 2026-11-18 · Vorbild: Font Axis Gradient (`../figma-plugin-font-variable-progression`, PLAN.md dort)

## 1. Ist-Zustand

| Datei | Inhalt |
|---|---|
| `manifest.json` | **Veröffentlichte Community-ID `929414938810147814` – bleibt!** `main: code.js`, `ui: ui.html`, `documentAccess: dynamic-page`, kein Netzwerk |
| `code.ts` → `code.js` (eingecheckt) | `tsc`-Build. Klont die Textebene pro Buchstabe (Klon + `deleteCharacters`), legt die Buchstaben als Gruppe **24 px unter das Original**, rotiert zufällig ±Stärke. Original bleibt unverändert, kein Restore |
| `ui.html` | Eigenes HTML/CSS, ein Slider „Rotation strength“ 0–15°, Buttons Apply / Reroll, feste Farben (`#554bdb`) |
| `tests/plugin.test.cjs` | Node-VM mit Figma-Mock, testet das kompilierte `code.js` |
| `node_modules/` | **120 Dateien in Git eingecheckt** (Altlast) |

Einschränkungen heute: nur oberste Ebene, eine Zeile, Auto width, linksbündig, Original-Schreibweise, max. 200 Zeichen, ASCII + Latin-1.

## 2. Zielfunktionen

1. **Live auf dem ausgewählten Text**: Keine Vorschau im Plugin. Sobald man einen Regler bewegt, wird der Text in Buchstaben aufgeteilt (an derselben Stelle, statt 24 px darunter) und die Rotation ändert sich direkt auf dem Canvas.
2. **Zwei Regler**: maximale Rotation nach links (0–15°) und nach rechts (0–15°), getrennt einstellbar.
3. **Shuffle-Button**: neue zufällige Verteilung, beliebig oft, bis es passt.
4. **Restore**: macht aus den Einzelbuchstaben wieder **eine** Textebene, so wie sie am Anfang war (Text, Formatierung, Position, Name).
5. Dark/Light über `themeColors: true` und nur `--figma-color-*`-Tokens, UI mit **FigUI3** wie bei Font Axis Gradient.
6. Ein ⌘Z pro losgelassenem Regler bzw. Shuffle-Klick, nicht pro Zwischenschritt.

### Rotations-Logik (Vorschlag)
- Pro Buchstabe wird **einmal** ein Zufallswert `u ∈ [−1, 1]` gespeichert (Seed).
- Winkel = `u < 0 ? u · links : u · rechts`.
- Regler verändern nur das Ausmaß, **das Muster bleibt gleich**. Dadurch springt beim Ziehen nichts wild hin und her. Nur Shuffle würfelt neue `u`.
- Die Seeds werden in der Gruppe gespeichert (`pluginData`). Nach erneutem Öffnen geht es mit demselben Muster weiter.

### Restore (Vorschlag, wird in Phase 0 geprüft)
- **A (Empfehlung):** Das Original wird beim Aufteilen nicht gelöscht, sondern **unsichtbar und gesperrt in die Buchstaben-Gruppe** gelegt. Restore holt es zurück an die alte Stelle (Eltern, Ebenen-Reihenfolge) und löscht die Buchstaben. Hält Kerning, Ligaturen, alle Stile und Eigenschaften zu 100 %.
- B: Original löschen und aus gespeicherten `styledTextSegments` neu aufbauen. Kommt ohne versteckte Ebene aus, verliert aber leicht Eigenschaften, an die man nicht gedacht hat.

## 3. Übernahme aus Font Axis Gradient

| Thema | So machen wir es |
|---|---|
| Build | `esbuild` wie dort (`scripts/build.mjs`): `src/code.ts` → `dist/code.js`, `src/ui.html` + `src/ui/main.ts` + FigUI3 inline → `dist/ui.html`. `npm run build / watch / typecheck / test` |
| UI-Kit | `@rogieking/figui3` (fig-slider, fig-button, fig-field …), Figma-Tokens, keine festen Farben |
| Skills | `figui3` + `propskit` aus dem anderen Repo nach `.claude/skills/` kopieren; `figma:figma-use` für Testdatei und Experimente per MCP |
| Live-Bearbeitung | Muster von dort: nur auf Nutzer-Eingabe schreiben, max. ein Schreibvorgang gleichzeitig, nur der neueste Wert zählt (`requestLive` / `liveNext`), `commitUndo` erst bei Loslassen / Ebenenwechsel / Done / Schließen |
| Auswahl beobachten | `selectionchange` + `nodechange` auf der Seite, `currentpagechange` |
| Tests | Reine Logik (Winkel, Seeds, Layout) mit `vitest`; Figma-Mock-Tests bleiben für Aufteilen/Restore |
| Testen in Figma | Testdatei per MCP anlegen, Import from manifest, `npm run watch` |
| Messen statt raten | Performance zuerst messen (wie dort bei Live-Vorschau vs. Live-Text), dann entscheiden |

## 4. Umsetzung in Phasen

**Phase 0 – Setup & Experimente ✅ erledigt**
- Erledigt: `package.json` (npm, esbuild, FigUI3 12.0.3, TypeScript 7, vitest), `tsconfig.json` + `tsconfig.ui.json`, `scripts/build.mjs` aus Font Axis Gradient. Quellen in `src/` (`code.ts`, `ui.html`, `ui/main.ts`), Build nach `dist/`. Manifest auf `dist/…`, Name „Crack Font“, **ID unverändert**. `node_modules/`, `code.js`, `pnpm-lock.yaml` aus Git entfernt, `.gitignore` neu. Skills `figui3` + `propskit` in `.claude/skills/`. Die alten Tests laufen gegen `dist/code.js` (34 grün); den alten UI-Test und den Lockfile-Test habe ich entfernt (UI wird neu gebaut).
- Testdatei: https://www.figma.com/design/UsrT5bOvoav6SWTCUWUuEk (Headline, Kerning-Beispiel „AVATAR Toyota WAVE“, gemischte Stile/Größen, variable Schrift, zentriert, 100 und 200 Zeichen, Text in einem Frame).

### Ergebnisse der Experimente (2026-11-18, per `use_figma`)
| Test | Ergebnis |
|---|---|
| Aufteilen: Klon + `deleteCharacters` | 18 Zeichen 55 ms · 100 Zeichen 240–310 ms · 200 Zeichen 410–620 ms. Wächst etwa linear (~2–3 ms/Buchstabe), nicht quadratisch |
| Aufteilen: neue Textebenen + Stile kopieren | **2,5× langsamer** (135 / 490 / 860 ms) und verliert Eigenschaften → verworfen, Klonen bleibt |
| Kerning mit natürlichen Breiten (heute) | Buchstaben driften bis **26 px** (bei 72 px) vom Original weg, Gesamtbreite 742 statt 723 px |
| Kerning mit Präfix-Breiten | Eine Kopie, von hinten Zeichen für Zeichen löschen und die Breite lesen: **9 ms** für 18 Zeichen. Position `x = Präfix(i+1) − Breite(i)`. Overlay mit dem Original: **deckungsgleich** |
| Gemischte Schriftgrößen | Oben ausgerichtet (heute) und unten ausgerichtet liegen daneben, Grundlinie per SVG-Messung auch. **Funktioniert:** pro anderem Stil ein unsichtbares Null-Breiten-Zeichen (U+200B) im Buchstaben („Strut“). Dann hat jeder Buchstabe dieselbe Zeilenbox wie das Original, `y` = Original-`y`, deckungsgleich. Nur nötig, wenn die Zeilenhöhen im Text unterschiedlich sind |
| Unsichtbares Original in der Gruppe | Beeinflusst die Größe der Gruppe **nicht** (auch wenn es verschoben ist) |
| Restore (Original zurück an Eltern + Ebenen-Position, Gruppe löschen) | 7–13 ms. `absoluteTransform` identisch, auch für Text in einem Frame (gleicher Eltern-Knoten, gleiche Position) |
| Live-Rotation pro Regler-Schritt (alle Buchstaben) | 18 Zeichen 5–8 ms · 100 Zeichen 28–46 ms · 200 Zeichen 56–70 ms |

### Entscheidungen daraus
1. **Restore-Variante A** (unsichtbares, gesperrtes Original in der Gruppe): exakt, schnell, beeinflusst die Gruppe nicht.
2. **Positionen über Präfix-Breiten** statt natürlicher Breiten → Kerning bleibt erhalten, Text sieht vor dem Drehen genauso aus wie vorher.
3. **Strut nur bei gemischten Zeilenhöhen.**
4. **Zeichenlimit 200 bleibt.** Aufteilen passiert einmal (≤ 0,6 s mit Statusmeldung), danach läuft die Rotation flüssig. Bei der Live-Bearbeitung gilt wie bei Font Axis Gradient: max. ein Schreibvorgang gleichzeitig, nur der neueste Wert zählt.
5. Text in Frames ohne Auto-Layout funktioniert technisch (Gruppe im selben Frame) → in Phase 4 erlauben.

- Ursprünglicher Plan:
- `package.json` / `tsconfig` / `scripts/build.mjs` wie im anderen Plugin, Quellen nach `src/`, Build nach `dist/`, `manifest.json` auf `dist/…` umstellen, **ID beibehalten**.
- `node_modules/` aus Git entfernen (nur aus dem Index, lokal bleibt es), `.gitignore` mit `node_modules/`, `dist/`, `.DS_Store`. `pnpm-lock.yaml` entfernen, nur npm wie im anderen Projekt.
- FigUI3-Skills kopieren.
- Testdatei in Figma anlegen (verschiedene Schriften, gemischte Stile, Leerzeichen, kurze/lange Texte, Text in Frame).
- Experimente per `use_figma`:
  1. Aufteilen: Zeit bei 10 / 50 / 100 / 200 Zeichen (Klon + `deleteCharacters` ist pro Buchstabe proportional zur Länge → quadratisch).
  2. Kerning: heutige Positionierung über natürliche Breiten vs. Messung über Präfix-Breiten. Wie weit weichen die Buchstaben vom Original ab?
  3. Restore A: Beeinflusst ein unsichtbares Kind die Größe der Gruppe? Geht das Zurückholen an die exakte alte Stelle?
  4. Live-Rotation: Zeit pro Regler-Schritt bei 200 Buchstaben.
- Ergebnis kommt in diesen Plan, danach Entscheidung über Restore-Variante und Zeichenlimit.

**Phase 1 – Kern: Aufteilen an Ort und Stelle, Rotation, Restore**
- `src/split.ts`: Text → Buchstaben-Gruppe an der Stelle des Originals (gleiches Elternteil, gleiche Ebenen-Position), Original sichern (Variante aus Phase 0).
- `src/rotate.ts` (rein, testbar): Seeds, Winkel aus links/rechts, Drehung um die Buchstabenmitte.
- `src/restore.ts`: Gruppe → ursprüngliche Textebene.
- Speicherformat `crack-font-v2` (Seeds, links/rechts, Original-Infos). Unit-Tests.

**Phase 2 – Live-Bearbeitung**
- Regler → sofort auf dem Canvas, erstes Bewegen teilt den Text auf. Öffnen oder Auswählen allein ändert nichts.
- Shuffle-Button, Restore-Button, Done.
- Undo-Verhalten wie im anderen Plugin (ein Schritt pro losgelassenem Regler).
- Erkennt bei Auswahl: normaler Text, eigene Crack-Font-Gruppe (Regler zeigen gespeicherte Werte), etwas anderes. Relaunch-Button an der Gruppe („Crack Font“).

**Phase 3 – UI mit FigUI3**
- Kompakte Zeile mit der Auswahl („T Headline · 12 letters“), Regler „Left“ / „Right“ mit Zahlenfeld, Footer einzeilig: Restore · Shuffle · Done.
- Dark/Light, Statusmeldungen, Fensterhöhe automatisch.
- Iteration mit dir nach Test in Figma.

**Phase 4 – Feinschliff & Fehlerfälle**
- Grenzen prüfen und ggf. lockern (z. B. Text in Frames ohne Auto-Layout, zentrierter Text), Zeichenlimit nach Messung.
- Gemischte Schriften, fehlende Schrift, gesperrte Ebenen, geänderte Buchstaben (Restore trotzdem möglich?).
- Alte Gruppen aus Version 1 (24 px darunter, ohne Restore): weiter shuffeln können, Restore dort nicht anbieten.
- README neu, Name im Manifest „Crack Font“.

**Phase 5 – Community-Assets (zum Schluss)**
- Icon, Cover, Carousel in einer Figma-Datei entwerfen (wie beim anderen Plugin: erst Entwurf, dann gemeinsam auf einen Stil einigen), exportieren nach `assets/community/`.
- Listing-Texte (Tagline, Beschreibung, Kategorie, Tags) in `docs/community-listing.md`.
- Neue Version über Figmas Publish-Flow mit der bestehenden ID veröffentlichen (machst du).

## 5. Offene Entscheidungen

1. ~~Restore-Variante~~ → A (Phase 0).
2. ~~Zeichenlimit~~ → 200 bleibt (Phase 0).
3. **Bestehende Grenzen** (nur oberste Ebene, linksbündig, Auto width): lockern, soweit es ohne großen Aufwand sauber geht?
