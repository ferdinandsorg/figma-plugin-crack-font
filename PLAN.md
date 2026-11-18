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

**Phase 1 – Kern: Aufteilen an Ort und Stelle, Rotation, Restore ✅ umgesetzt (Test im Plugin offen)**
- `src/rotate.ts` (rein, ohne Figma-API): Seeds `[-1, 1)`, `angleFor(seed, left, right)` (positiv = gegen den Uhrzeigersinn = nach links, wie Figmas Rotation), Drehung um die Buchstabenmitte, 2×3-Matrizen.
- `src/crack.ts`: `split` · `rotate` · `shuffle` · `restore` · `findCrack`.
  - Aufteilen an Ort und Stelle: Gruppe an der Ebenen-Position des Originals, Original unsichtbar + gesperrt darin. Positionen über Präfix-Breiten (Kerning bleibt), Strut bei gemischten Zeilenhöhen.
  - **Leerzeichen bekommen keine eigene Ebene** (weniger Ebenen, schneller), außer sie sind unterstrichen/durchgestrichen.
  - Buchstabenmitten werden im Koordinatensystem des Originals gespeichert. Die Rotation rechnet über das Original zurück. So stimmt alles auch nach dem Verschieben der Gruppe. Wichtig: In Figma sind Kinder einer Gruppe relativ zum nächsten Frame/zur Seite positioniert, nicht zur Gruppe. Der alte Code hatte das falsch angenommen.
  - Gelöschte Buchstaben werden beim Drehen übersprungen, Restore geht trotzdem.
  - Bei einem Fehler mitten im Aufteilen kommt das Original unverändert zurück, alles Neue wird gelöscht.
  - Speicherformat `crack-font-v2`: `{ originalId, left, right, letters: [{ id, seed, cx, cy }] }`.
  - Auswahl eines einzelnen Buchstabens zählt wie die Auswahl der Gruppe.
- `src/code.ts`: Nachrichten `apply` / `shuffle` / `restore`, Auswahl-Info ans UI (Text / Crack-Font-Gruppe mit gespeicherten Werten / nichts).
- Übergangs-UI: Regler Left/Right (0–15°), Buttons Restore / Shuffle / Apply. Live-Bearbeitung und FigUI3-Gestaltung folgen in Phase 2/3.
- Grenzen schon gelockert, weil sie technisch nicht mehr nötig sind: Ausrichtung (zentriert/rechts) und gedrehte Textebenen. Weiterhin: nur oberste Ebene, Auto width, eine Zeile, 200 Zeichen, Latin-1.
- Tests (`npm test`, vitest): 9 Unit-Tests für die Mathematik, 17 Tests mit Figma-Mock auf dem gebauten `dist/code.js` (Mock bildet Figmas Gruppen-Koordinaten, versteckte Kinder und Leerzeichen-Breite nach).
- In Figma per MCP mit dem echten Code geprüft: Headline 9 Buchstaben in 125 ms, Kerning-Beispiel 16 Buchstaben in 101 ms, gemischte Stile auf der Grundlinie, zentrierter Text. Gruppe um 300 px verschoben → Drehen 10 ms, Shuffle 13 ms, Restore exakt an der neuen Stelle.

**Phase 2 – Live-Bearbeitung ✅ umgesetzt und in Figma getestet**
- Kein Apply mehr: Der erste Regler-Schritt teilt den Text auf, jeder weitere dreht nur. Öffnen oder Auswählen allein ändert nichts.
- Wie bei Font Axis Gradient: UI schickt höchstens eine Nachricht pro Frame (16 ms), das Plugin schreibt immer nur einmal gleichzeitig und behält nur den neuesten Wert (`requestLive` / `liveNext`). Auch während des Aufteilens (bis 0,6 s) gehen keine Werte durcheinander.
- Undo: kein `commitUndo` pro Schritt. Abgeschlossen wird bei Ebenenwechsel, vor und nach Shuffle, bei Restore und Done. Dass das Plugin danach die neue Gruppe selbst auswählt, zählt nicht als Ebenenwechsel. Erwartung wie im anderen Plugin: ⌘Z springt pro losgelassenem Regler zurück.
- Shuffle auf normalem Text teilt ihn direkt auf. Restore wählt danach wieder die Textebene aus. Done schließt das Plugin.
- **Gradzahl eintippen** über das Zahlenfeld von `fig-slider`, Grenze **45°** (UI und Plugin begrenzen beide; 270 → 45 im Browser geprüft).
- UI bereits mit FigUI3 und den Grundstilen aus Font Axis Gradient (Auswahl-Zeile mit T-Symbol, `fig-field`-Zeilen, `fig-footer`: Restore · Shuffle · Done, Fensterhöhe passt sich an, localStorage-Ersatz für das Plugin-iframe).
- Fix nach erstem Test (Regler gesperrt, „Select a text layer“ blieb stehen): Die UI hat nur Nachrichten mit `event.source === parent` angenommen. In Figma Desktop kommen Plugin-Nachrichten aber nicht von dort. In Phase 1 fiel das nicht auf, weil die Buttons immer aktiv waren. Jetzt wie bei Font Axis Gradient: kein Absender-Filter, „ready“ wird wiederholt, bis das Plugin antwortet, und das Plugin schickt die Auswahl auch direkt beim Start.
- Tests: 32 grün (neu: Zusammenfassen schneller Regler-Schritte, nichts ändert sich beim Öffnen/Auswählen, 45°-Grenze, Undo-Schritte, Shuffle auf Text, Done).

**Phase 3 – UI mit FigUI3 ✅ umgesetzt und in Figma getestet**
- **Fächer** statt zwei Reglern (`src/ui/fan.ts`): ein Halbkreis, der Keil zeigt den Bereich von „nach links“ bis „nach rechts“. Links oder rechts der Mitte ziehen setzt die jeweilige Seite (ganze Grad), über die Mitte gezogen geht die Seite auf 0. Gezeichnet mit doppeltem Winkel (45° = waagerecht), damit kleine Werte sichtbar bleiben. In der Mitte ein „A“ gerade plus zwei blasse „A“ in den echten Grenzwinkeln. Griffe per Tab erreichbar, Pfeiltasten ±1°, Shift ±5°.
- Darunter **Tilt left / Tilt right** als `fig-input-number` (0–45°, 0,5er-Schritte, Eingaben darüber → 45°) und dazwischen ein **Verknüpfen-Button**: gleiche Gradzahl auf beiden Seiten.
- Auswahl-Zeile: Text-Symbol, bei einer Crack-Font-Gruppe leicht schräg. Fehler in Rot, mehrzeilig. Ohne Auswahl ist der Fächer ausgegraut.
- Hinweis bei normalem Text: „Drag the fan or type an angle. The text splits into letters on the first change.“ Danach Statusmeldungen des Plugins.
- Footer: Restore · Shuffle (mit Symbol) · Done. Light und Dark über Figmas Tokens geprüft.
- Tests: 34 grün (neu: Geometrie des Fächers).
- Feedback-Runde 1 (2026-11-18), umgesetzt:
  - **Griffe greifen zuverlässiger:** Ein Klick bis 16 px um einen Griff nimmt diesen Griff, egal auf welcher Seite der Mitte. Beispiel: links 45°, rechts 0° (Griff oben) → ein Klick knapp links neben dem oberen Griff bewegt den rechten, nicht mehr den linken. Liegen beide Griffe übereinander (beide nahe 0°), entscheidet die Seite. Griffe etwas größer (r 7).
  - **Pfeiltasten in den Zahlenfeldern in ganzen Grad** (16 → 17 → 18). 16,5 lässt sich weiterhin eintippen.
  - **Text in Frames, Gruppen und Auto-Layout** (siehe Phase 4, vorgezogen).
- Kompakte Zeile mit der Auswahl („T Headline · 12 letters“), Regler „Left“ / „Right“ mit Zahlenfeld, Footer einzeilig: Restore · Shuffle · Done.
- Dark/Light, Statusmeldungen, Fensterhöhe automatisch.
- Iteration mit dir nach Test in Figma.
- Feedback nach Phase 1 (2026-11-18):
  - **Gradzahl direkt eingeben** (Zahlenfeld neben dem Regler). Grenze **45°**: Darüber stehen die Buchstaben fast quer und überlappen, das sieht nicht mehr nach „Crack“ aus. Eingaben darüber werden auf 45° gesetzt. Der Regler deckt 0–45° ab. (Zahlenfeld kommt mit `fig-slider text` schon in Phase 2.)
  - **Coolere Interaktion** als die zwei Regler, z. B. ein Bogen/Fächer, der den Bereich links ↔ rechts zeigt und an dem man beide Enden zieht. Ideen in Phase 3 zeigen, sonst später.

**Phase 4 – Feinschliff & Fehlerfälle ✅ umgesetzt und in Figma getestet**
- ✅ (vorgezogen) **Text in Frames, Gruppen und Auto-Layout**:
  - Frames/Gruppen/Sections/Components: Buchstaben-Gruppe an der Stelle des Texts im selben Elternteil, Original unsichtbar darin (wie auf der Seite).
  - **Auto-Layout**: Das Original bleibt an seinem Platz im Layout, mit Deckkraft 0 und gesperrt, und hält so den Platz frei. Die Buchstaben-Gruppe liegt direkt darüber, absolut positioniert (`layoutPositioning = ABSOLUTE`). Frame-Höhe und alle anderen Elemente bleiben, wo sie sind. Restore setzt die ursprüngliche Deckkraft zurück und löscht die Gruppe. Verschiebt das Layout den Text später (z. B. anderes Padding), springen die Buchstaben bei der nächsten Änderung mit.
  - Text in Instanzen wird abgelehnt (Instanzen erlauben keine neuen Ebenen): „Edit the main component or detach the instance.“
  - In Figma per MCP mit dem echten Code geprüft (Testfälle „08 Frame“, neu „09 Auto layout“): Positionen exakt, Layout unverändert, Restore exakt.
  - Erkenntnis: `clone()` legt die Kopie immer auf der Seite ab, nicht im Frame. Die Positionen setzt deshalb erst `rotate()` nach dem Gruppieren.
- Zentrierter und rechtsbündiger Text funktioniert schon (seit Phase 1). Zeichenlimit 200 bleibt.
- ✅ **Duplizierte Gruppen** (⌘D, Copy/Paste) funktionieren weiter: Die neuen Ebenen-IDs werden über die Reihenfolge zugeordnet, Restore holt das Original aus der Kopie.
- ✅ **Original gelöscht** (z. B. das unsichtbare Original im Auto-Layout): klare Meldung statt „Select a text layer“.
- ✅ **Gesperrte oder ausgeblendete Gruppe**: Meldung „Unlock the layer and its parents first.“, nichts wird verändert.
- ✅ **Gelöschte oder geänderte Buchstaben**: werden übersprungen bzw. um ihre Mitte gedreht, Restore geht immer.
- ✅ Fehlende Schrift: wird vor dem Aufteilen abgefangen. Drehen braucht keine geladene Schrift (in Figma geprüft), Gruppen mit fehlender Schrift lassen sich also weiter drehen.
- ✅ **Gruppen aus Crack Font 1** (24 px unter dem Original): werden erkannt. Die aktuellen Winkel werden zum Muster (Left/Right = größter Winkel), danach lassen sie sich drehen und shuffeln. Restore entfernt die Buchstaben und wählt das unveränderte Original aus. Hinweis im Plugin.
- ✅ README neu (Englisch, wie bisher). Name im Manifest „Crack Font“ (seit Phase 0).
- ✅ **Easter Egg**: Ein Buchstabe oder eine Ziffer auf der Tastatur ersetzt das „A“ im Fächer (immer groß). Nicht in den Zahlenfeldern, nicht mit ⌘/Ctrl/Alt.
- Feedback-Runde (2026-11-18):
  - **„Original deleted“ im Auto-Layout**: Der reine Ablauf cracken → Restore → cracken funktioniert (in Figma nachgespielt). Die Meldung kam, sobald die absolut positionierte Buchstaben-Gruppe nicht mehr im selben Frame lag wie das Original. Das passiert, wenn man sie zieht und Figma sie umhängt. Das Original wird jetzt zuerst neben bzw. in der Gruppe gesucht, dann im ganzen Dokument (`getNodeByIdAsync`). Dadurch ist die Auswahl-Prüfung im Plugin jetzt asynchron, und nur die neueste Anfrage meldet sich beim UI. Duplikate nutzen weiterhin ihr eigenes Original.
  - **UI springt nicht mehr**: Auswahl-Zeile immer einzeilig, Probleme stehen in der Statuszeile. Die Statuszeile hat immer zwei Zeilen Platz und zeigt in jedem Zustand etwas (Hinweis, Meldung oder Fehler). Alle Meldungen auf höchstens zwei Zeilen gekürzt. „Select a text layer“ ist kein roter Fehler mehr. Im Browser gemessen: Fensterhöhe in allen Zuständen 334 px.
  - Klarstellung: Im Auto-Layout liegt das Original absichtlich außerhalb der Gruppe (unsichtbar, gesperrt), damit es den Platz im Layout hält.
- Tests: 46 grün.
- Version 2.0: `package.json` steht auf 2.0.0. Das Feld `"api": "1.0.0"` im Manifest ist die **Version der Figma-Plugin-API**, nicht die des Plugins, und muss so bleiben. Die Versionsnummer des Plugins vergibt Figma beim Veröffentlichen; dort in den Release-Notes „2.0“ angeben.

**Phase 5 – Community-Assets ✅ erledigt**
- Vorlage: alte Assets (Seite „Community Assets“, Section „Version 1“) und dein Versuch „Version 2“ mit Allo Variable. Übernommen: Farben Grün #00DE81, Pink #FF1D6E, Gelb #FEE92F, Blau #4F60FF, Schwarz; Formen mit schwarzer Kontur (Stern, Sonne, Pille, Dreieck, Raute, Kreis); Noise (dasselbe Bild, gekachelt, 6–10 %).
- Neu: kein Raster mit Kopf- und Fußleiste mehr, sondern freie, große Formen, die angeschnitten und überlappend liegen. Große gekippte Headlines (jeder Buchstabe einzeln gedreht, Kerning über Präfix-Breiten wie im Plugin), Labels als Pillen mit Kontur.
- **Schrift:** Allo Variable ist über die Figma-Anbindung nicht verfügbar (lokale Schrift). Platzhalter: Google Sans Flex mit ROND 100 / wght 1000, für Zahlen Google Sans Code. Tausch über Text → Replace fonts.
- Vorschlag in der Section „Version 3 – Vorschlag“: Cover („Crack your type.“), Carousel 1 „Set the range.“ (Fächer wie im Plugin, Left 30° / Right 18°, drei „A“ in den Grenzwinkeln), Carousel 2 „Shuffle till it clicks.“ (dreimal „Funky“ in drei Mustern), Carousel 3 „Change your mind?“ (gekipptes „Groovy“ → gerades „Groovy“, Chips Frames / Groups / Auto layout), drei Icon-Varianten (Aa, Cf, A) in Pink/Gelb.
- Listing-Texte als Entwurf in `docs/community-listing.md`.
- Von dir manuell überarbeitet und exportiert nach `assets/community/`: Icon „Aa“, Cover („Crack Font 3.0“), Carousel 1 (Fächer), Carousel 2 (Shuffle). Carousel 3 entfällt.
- **Version 3:** Die Community-Version 2 war schon veröffentlicht, dieses Release ist Version 3. Code braucht dafür nichts (Figma nummeriert selbst). Angepasst: `package.json` 3.0.0, Listing „What's new in 3.0“, Hinweis bei alten Gruppen neutral („Made with an older Crack Font“), weil auch Gruppen aus der veröffentlichten Version 2 das alte Format haben.

## 5. Offene Entscheidungen

1. ~~Restore-Variante~~ → A (Phase 0).
2. ~~Zeichenlimit~~ → 200 bleibt (Phase 0).
3. **Bestehende Grenzen** (nur oberste Ebene, linksbündig, Auto width): lockern, soweit es ohne großen Aufwand sauber geht?
