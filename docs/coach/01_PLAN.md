# Coach-Modul – Plan und Arbeitspakete

Stand 12.10.2026. Grundlage: Auftrag „Modul Coach“ (Sascha) + Entscheidungen vom 12.10. + Dropbox-Konzepte
(User Stories USA-Test 08.10., Swing-Score 08.10., Fehlschlag-Katalog 04.10., Konzept Schlagarten 23.09., Wettbewerbsanalyse 10.10.).
Textauszüge der Quellen: `C:\Users\SMoescheit\GolfOS\features\015-coach\quellen\` (bewusst außerhalb des Repos, das später öffentlich auf GitHub liegt).

Dieser Prototyp ist **Ideengebung für Ben** (wie der Runden-Prototyp). Bens Code wird nicht angefasst.

## Architektur

```
src/coach/                 ← das portable Modul (kein React im Kern, alles in Node testbar)
  model/                   types.ts (Datenmodell A), constants.ts (APP_NAME, Landmarken, Schlagarten), geometry.ts
  pose/                    PoseProvider.ts (Schnittstelle), mediapipe.ts (Browser), smoothing.ts, mirror.ts (Linkshänder)
  club/                    ClubProvider.ts (Schnittstelle), track.ts (Schaft über den Schwung + neutrale Linie), image.ts
  analysis/                analyze.ts (Pipeline, reine Funktion), phases.ts, metrics.ts, quality.ts, context.ts
  faults/                  catalog.json, drills.json, ballflights.json, engine.ts, score.ts, diagnosis.ts
  training/                Zielpositionen, Annäherung 0..1, Spiegel-Modus, Ball-Serie, Töne
  live/                    swingTrigger.ts (automatische Aufnahme ohne Knopf, US-1.0)
  pipeline/                Video → Bilder → Pose (+ Graustufenbilder für den Schläger) → analyzeSequence (Browser)
  storage/                 Store.ts (Schnittstelle), memory.ts, idb.ts, index.ts (getStore)
  i18n/                    i18n.ts, locales/{en,de}/<namespace>.json
  testing/                 synth.ts (synthetischer Schwung-Generator) + Tests
src/ui/                    React-Oberfläche (Screens + Komponenten), nav.ts (Screen-Stack)
```

**Datenfluss Analyse:** Video (Aufnahme oder Upload) → `pipeline` dekodiert Bild für Bild → MediaPipe Pose (`PoseProvider`)
+ Graustufenbild je Frame → `analyzeSequence()` = Spiegeln (Linkshänder) → Glätten → Schläger verfolgen (`trackClub`)
→ Schlüsselpositionen (`detectKeyframes`) → Messwerte (`computeMetrics`) → Qualität (`assessQuality`)
→ Fehler (`evaluateFaults`, Katalog-JSON) → Swing-Score → `Swing` speichern → Ergebnis-Screen.

**Koordinaten:** siehe Kopf von `model/types.ts` (kanonisch = Rechtshänder, Face-on: Ziel rechts im Bild; DTL: Spieler blickt nach rechts).

## Schlüsselpositionen (Chris, 06.10.2026)
Setup/Ansprechen, 9 Uhr Aufschwung, Top, 9 Uhr Abschwung, Treffmoment, Finish. „9 Uhr“ = Schaft parallel zum Boden.
Kurze Schläge haben weniger Positionen (`SHOT_TYPES` in constants.ts).

## Arbeitspakete und Zuständigkeit

| Paket | Inhalt | Agent / Owner | Dateien (Owner schreibt nur hier + eigene Tests + eigener i18n-Namespace) |
|---|---|---|---|
| A | Gerüst, Datenmodell, Schnittstellen, Testgenerator, Pipeline-Gerüst | Lead (fertig) | model/*, analysis/analyze.ts, analysis/context.ts, testing/synth.ts, ui/nav.ts, App.tsx |
| B + C1 | Aufnahme (Live + Upload), Kamera-Hinweise/Silhouette, Auto-Aufnahme, MediaPipe, Video-Pipeline, Glättung, Qualität, Video-Player mit Overlay | **capture-pose** | pose/mediapipe.ts, pose/smoothing.ts, analysis/quality.ts, live/*, pipeline/*, ui/screens/CaptureScreen.tsx, ui/components/SwingPlayer.tsx (+ eigene Komponenten), i18n `capture`, `player` |
| C2 | Schläger: Schaft im Bild finden, Handschätzung, neutrale Linie | **club** | club/* (außer ClubProvider.ts-Vertrag), i18n `club` |
| C3 | Phasenerkennung + Messwerte | **phases-metrics** | analysis/phases.ts, analysis/metrics.ts (+ Hilfsdateien in analysis/) |
| D | Fehlerkatalog, Drills, Regel-Engine, Top-3, Swing-Score, Rückwärts-Diagnose, Ergebnis-Screen, Diagnose-Screen | **faults** | faults/*, ui/screens/AnalysisScreen.tsx, ui/screens/DiagnoseScreen.tsx, ui/components/Fault*.tsx, i18n `analysis`, `diagnose` |
| E | Trainingsmodus: Ziele, Spiegel-Modus, Ball-Serie, Töne, Toleranzen, Quote | **training** | training/*, ui/screens/TrainingScreen.tsx, ui/components/Live*.tsx, i18n `training` |
| F + G | IndexedDB, Verlauf, Vergleich, Fortschritt (Elo-Rohdaten), Einstellungen, Sprache, Offline/Service Worker, Startseite | **history-i18n-offline** | storage/*, ui/screens/{History,Compare,Settings,Home}Screen.tsx, vite.config.ts (nur PWA-Teil), i18n `history`, `settings`, `common` |
| H | Tests je Paket (jeder Owner) + Gesamtlauf | alle + Lead | `*.test.ts` neben dem Code |
| Review | Prüfung gegen Auftrag, hat nicht mitentwickelt | **reviewer** | nur docs/coach/REVIEW.md |

Verträge (Signaturen) stehen bereits als Stubs in den Dateien. **Signaturen nicht ändern** ohne Eintrag in `DECISIONS.md`;
Erweiterungen (zusätzliche Exporte, optionale Felder) sind erlaubt.

## Gemeinsame Regeln für alle Agents
- Branch `feature/coach-module`, kleine Commits mit englischen Messages, **kein Push**, kein Force.
- Nur in den eigenen Dateien schreiben. Gemeinsame Dateien (types.ts, constants.ts) nur additiv ändern und in DECISIONS.md vermerken.
- Golf-Grenzwerte immer mit `REVIEW(golf)` markieren (im JSON: Feld `review`; im Code: Kommentar `// REVIEW(golf): …`).
- Annahmen → `docs/coach/DECISIONS.md` (Abschnitt des Agents), Fachfragen → `docs/coach/OPEN_QUESTIONS.md`.
- App-Texte nur über i18n (`t('<namespace>.<key>')`), Englisch und Deutsch, Spielersprache ohne Fachchinesisch.
- Große Tippflächen (Handschuh, Sonne), Status grün/rot immer mit ✓/✕ bzw. Text.
- Tests: `npm test` (Vitest, Node), Typen: `npx tsc -b`, Build: `npm run build`. Node liegt unter `C:\Program Files\nodejs` (in Bash: `export PATH="/c/Program Files/nodejs:$PATH"`).

## Reihenfolge
1. A (fertig) → 2. capture-pose, club, phases-metrics, faults, training, history-i18n-offline parallel
→ 3. Integration + Gesamttests (Lead) → 4. Review-Agent → 5. Nacharbeiten → 6. MORNING_REPORT.md.
Puffer-Themen nach Nutzen auf der Range, falls Zeit bleibt: echte Videos testen (sobald von Sascha geliefert), Kalibrierung der
2D-Messwerte, Probeschwung-Erkennung, Ghost-Silhouette im Sucher, Zeitlupen-Upload (240 fps) prüfen, Spec/Ticket-Entwürfe für Ben.
