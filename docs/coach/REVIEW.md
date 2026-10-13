# Review – Modul Coach (unabhängiger Review-Agent)

Stand 13.10.2026. Geprüft gegen den Auftrag (`features/015-coach/auftrag.md`, inkl. Saschas 4 Entscheidungen) und die
verbindlichen Swing-Score-Regeln (`features/015-coach/swing-score-regeln.md`). Der Reviewer hat nichts mitentwickelt und
keinen Quellcode geändert. Geprüfter Code-Stand für Tests/Build: `8e68e6b` (der Lead hat parallel weiter committet, z. B.
`2d037e0` dev:https – nicht Teil dieser Prüfung).

## Gesamturteil

**Weitgehend erfüllt, solide gebaut – für einen Prototyp ungewöhnlich vollständig.** Alle Pakete A–H sind vorhanden,
Typprüfung, 408 Tests und Build laufen grün, die App läuft in WebKit (iPhone-13-Emulation) und Edge ohne einen einzigen
Konsolen- oder Seitenfehler, funktioniert **nachweislich offline** (inkl. Analyse mit dem gecachten Modell) und macht
**keine einzige Anfrage nach außen**. Kein kritischer Fehler gefunden.

Schwachstellen liegen im **Golf-Inhalt** (Tempo-Fehler logisch vertauscht, einige Trainingsziele bestrafen einen
Idealschwung) und bei **Linkshändern** (Skelett-Farben auf der falschen Körperseite, Texte nur für Rechtshänder).
Der größte offene Punkt bleibt – ehrlich dokumentiert – die Messung auf **echten Videos** (Schaft, Grenzwerte): bisher
ist alles nur synthetisch kalibriert.

Befunde: **0 kritisch · 7 wichtig · 10 klein.**

## Test- und Build-Ergebnis

| Prüfung | Ergebnis |
|---|---|
| `npx tsc -b` | ✓ 0 Fehler |
| `npm test` | ✓ 32 Testdateien, **408 Tests grün** (22 s) |
| `npm run build` | ✓ gebaut; Warnung: ein JS-Chunk 672 kB (gzip 214 kB) |
| Precache (Service Worker) | **17 Einträge, 28.672 KiB (≈ 28 MB)** – enthält `vision_wasm_internal.wasm`, `pose_landmarker_lite.task`, `pose_landmarker_full.task` |

## Abgleich mit dem Auftrag

| Abschnitt | Status | Beleg / Bemerkung |
|---|---|---|
| **A** Gerüst & Datenmodell | ✓ erfüllt | `vite.config.ts` (VitePWA, Manifest, `registerType: 'prompt'`), `index.html` (Apple-Meta-Tags), `model/types.ts` mit allen geforderten Typen (`ShotType`, `CameraView`, `Handedness`, `Session`, `Swing`, `SwingPhase`, `PhaseKeyframe`, `SwingMetrics`, `Fault`, `Correction`, `Drill`) |
| **B** Aufnahme | ✓ erfüllt | Live-Kamera mit Auto-Aufnahme (`CaptureLive.tsx`, `live/swingTrigger.ts`) + Upload (`CaptureScreen.tsx:147`); Schlagart/Perspektive/Händigkeit vor der Aufnahme; Kamerahinweise (Abstand, Höhe, ganzer Körper) mit Silhouette; Putt stellt auf Face-on um (L3, im Browser bestätigt). Race-Bedingung beim Vorbelegen siehe W6 |
| **C** Analyse | ✓ erfüllt | Glättung (`pose/smoothing.ts`), Phasen je Schlagart (`analysis/phases.ts`), Messwerte je Position (`metrics.ts`, inkl. Schaftebene, Tempo), Player mit Skelett, Sprungmarken, 1×/½×/¼×, Einzelbild (`SwingPlayer.tsx`). Schläger per Bilderkennung + Handschätzung als Notlösung hinter `ClubProvider` (Entscheidung 2) |
| **D** Fehlererkennung & Korrektur | ◐ weitgehend | `faults/catalog.json`: 32 Fehlerbilder, 35 Drills, **jedes** mit Name/Ballwirkung/Ursache/Korrektur/Nutzen EN+DE, Schlagarten, Perspektiven, 1–2 existierende Drills; **jede Regelschwelle mit `REVIEW(golf)`** (per Skript geprüft). Startkatalog vollständig vorhanden. Max. 3 Fehler mit Sprung zur Bildmarke (`AnalysisScreen.tsx:61,94`, `engine.ts:168`). Schlechte Qualität → alles „nicht sicher erkennbar“ (`engine.ts:151`, im Browser bestätigt). Perspektiv-Fehler nur in ihrer Ansicht (`engine.ts:75–82`). Rückwärts-Diagnose als reine Funktion (`diagnosis.ts:60`) + Screen. **Abzug:** „Tempo zu schnell aus dem Top“ ist inhaltlich nicht richtig abgebildet (W1) |
| **E** Trainingsmodus | ◐ weitgehend | Ziele aus Vorlage, eigenem Schwung, Korrektur (`training/targets.ts`); Spiegel-Modus mit Farbverlauf + Ton bei Erreichen/Halten, Ball-Serie mit binärem Ton und Trefferquote (`series.ts:338`); Toleranz je Kriterium (`TrainingSetup.tsx:86–89`) und global (`SettingsScreen.tsx:108`). iOS-Audio-Freischaltung im Tap (`TrainingScreen.tsx:89–92`). **Abzug:** mehrere Korrektur-Ziele sind mit einem Idealschwung nicht erreichbar (W2) |
| **F** Verlauf & Fortschritt | ◐ weitgehend | IndexedDB mit Speicher-Fallback (`storage/idb.ts`, `memory.ts`), Verlauf gruppiert nach Schlagart, Auswahl → Vergleich synchron nebeneinander (im Browser mit 2 hochgeladenen Videos geprüft), Fortschrittswerte je Fehlerbild (`progress.ts`), „Elo“ vorbereitet. **Abzug:** W5 (Vergleich meldet „kein Fehler“ bei unsicheren Schwüngen), W7 (Score im Verlauf nicht auf aktuelle Stufe umgerechnet) |
| **G** Mehrsprachigkeit | ✓ erfüllt | 9 Namespaces, **453 Schlüssel, EN und DE deckungsgleich**, keine leeren Texte, keine fest verdrahteten UI-Texte gefunden; Telefonsprache als Standard, Umschalter in den Einstellungen, bleibt nach Neuladen erhalten (im Browser bestätigt) |
| **H** Tests | ✓ erfüllt | Unit-Tests für Messwerte, Phasen, Fehlerregeln, Score (alle Abnahmepunkte aus Abschnitt 6 der Score-Regeln), Training, Linkshänder-Spiegelung (`metrics.test.ts:146`, `phases.test.ts:49`, `track.test.ts:56`, `synth.test.ts:41`, `live.test.ts:55`); synthetischer Generator `testing/synth.ts` |
| **2** Technik | ✓ erfüllt | PWA installierbar; MediaPipe lokal, GPU mit CPU-Fallback (`mediapipe.ts:60–65`); Offline: SW precacht App + WASM + beide Modelle; **offline neu geladen und ein Video analysiert – funktioniert**; 0 externe Anfragen; keine Secrets, kein Server, keine Konten; `PoseProvider`/`ClubProvider` als Schnittstellen mit je 1–2 Implementierungen; `APP_NAME` nur in `constants.ts`, überall sonst über die Konstante (Titel, Manifest, Startseite, Einstellungen) |
| **7** Golf-Inhalte | ◐ weitgehend | Texte kurz (DE Ø 18 Wörter, max. 29), Spielersprache, motivierender „Nutzen“-Satz je Fehler; „nicht sicher erkennbar“ mit Gründen und Tipps; Perspektiv-Fehler nur dort geprüft, Diagnose sagt „Noch nicht geprüft – filme von hinten“. **Abzug:** W1, W4 |
| **8** Regeln | ✓ erfüllt | Branch `feature/coach-module`, 67 kleine englische Commits, kein Force-Push, keine Secrets, Quellen bewusst außerhalb des Repos, `DECISIONS.md`/`OPEN_QUESTIONS.md` + `decisions/*.md` gepflegt. Deploy-Workflow nur auf `main` → live erst nach Saschas OK (Entscheidung 4) |
| Entscheidung 2 (Finger-Korrektur) | ◐ teilweise | Per Finger lässt sich die **neutrale Linie** verschieben (gespeichert, aber reine Markierung, L2). Den **Schaft** selbst kann man nicht korrigieren, und die verschobene Linie ändert weder Messwert noch Score (K2) |

## Smoke-Test im Browser

Gebaut, `vite preview` auf Port **4187** (4173 war bereits von einem anderen Prozess belegt; nicht angefasst), danach
gestoppt. Playwright 1.49.1, WebKit mit iPhone-13-Emulation (en-US und de-DE) und Edge (`channel: 'msedge'`).

| Prüfung | WebKit en-US | WebKit de-DE | Edge en-US |
|---|---|---|---|
| Startseite, Aufnahme-Setup, Putt → Face-on-Hinweis, Linkshänder wählbar | ✓ | ✓ | ✓ |
| Ohne Kamera | ✓ freundlicher Hinweis + Upload als Hauptknopf (kein `mediaDevices`) | ✓ | ✓ „Kamera konnte nicht gestartet werden … Video hochladen“ (Berechtigung verweigert), kein Absturz |
| Verlauf leer, Diagnose (Slice → Ursachen mit „Noch nicht geprüft – filme …“), Trainingsauswahl, Training-Setup (Toleranz ±, Start ohne Kamera deaktiviert mit Hinweis) | ✓ | ✓ | ✓ |
| Einstellungen, Sprachwechsel, bleibt nach Neuladen | ✓ | ✓ | ✓ |
| Service Worker aktiv, Cache enthält WASM + 2 Modelle | ✓ | ✓ | ✓ |
| Konsolen-/Seitenfehler | **0** | **0** | **0** |

**Zusatz (Edge):** Im Browser ein synthetisches Strichmännchen-Video (WebM, 3,5 s) erzeugt und zweimal hochgeladen.
Die Analyse läuft durch (MediaPipe lädt, ~16 s beim ersten, ~6 s beim zweiten Mal), zeigt korrekt **„Nicht sicher
erkennbar – keine Person gefunden“** mit Tipps und speichert den Schwung. Verlauf → 2 auswählen → Vergleich öffnet
(dabei W5 und W6 entdeckt). **Offline-Test:** Seite geladen, Netz aus, neu geladen → App startet, Upload-Analyse läuft
mit dem Modell aus dem Cache. Externe Anfragen während des gesamten Laufs: **keine**.
Ein „Vergleich ohne Daten“ ist über die Oberfläche nicht erreichbar (Vergleich nur nach Auswahl zweier Schwünge) – kein Befund.

Screenshots (nicht im Repo, Scratch-Ordner des Reviewers `…/scratchpad/review/`):
`webkit_{en-US,de-DE}_01_home`, `_02_capture_setup`, `_02b_capture_putt`, `_03_capture_nocamera`, `_04_history_empty`,
`_05_diagnose`, `_05b_diagnose_slice`, `_06_training_picker`, `_07_settings`, `_08_settings_switched`,
`_09_home_after_reload`, `webkit_en-US_10_training_setup`; `msedge_en-US_01…09` (dieselben Screens, `_03_capture_camera`
mit Kamera-Fehlermeldung), `msedge_upload_1/2`, `msedge_history_2swings`, `msedge_history_select`, `msedge_compare`,
`msedge_de_offline_analysis`. (`webkit_en-US_zz_failure` und `msedge_compare_fail` stammen von Selektor-Fehlern im
Testskript, nicht von der App.)

## Befunde

### Kritisch
Keine.

### Wichtig

**W1 – Tempo-Fehler inhaltlich vertauscht/mehrdeutig** · `src/coach/faults/catalog.json:771–800` (tempo_slow), `:709–740` (tempo_fast)
`tempo_ratio` = Rückschwungzeit / Abschwungzeit (`types.ts:131`). Ein Verhältnis **> 3,6** bedeutet einen im Verhältnis
*schnellen* Abschwung oder sehr langsamen Aufschwung – der Katalog nennt es aber „Zu langsamer Abschwung / bremst ab“
(Review-Text Zeile 791). Ein abbremsender Abschwung macht das Verhältnis *kleiner*, landet also bei `tempo_fast`
(„Hastiger Aufschwung“). Der Auftragsfehler „Tempo zu schnell aus dem Top“ (Reißen im Übergang) ist so nicht erkennbar.
*Vorschlag:* die vorhandenen Messwerte `backswing_ms`/`downswing_ms` mitverwenden: „hastiger Aufschwung“ = Verhältnis < 2,4
**und** `backswing_ms` kurz; „bremst ab“ = `downswing_ms` lang; Verhältnis > 3,6 umbenennen in „langer/zögernder Aufschwung“
oder vorerst streichen. Mit Chris klären (REVIEW(golf)).

**W2 – Einige Trainingsziele aus Korrekturen bestrafen einen Idealschwung** · `catalog.json:641` (short_shoulder_turn 64 ± 8),
`:1134` (bent_lead_arm 168 ± 10), `:1193` (flying_elbow 90 ± 15), `:1646` (bunker_short_backswing 95 ± 15); Auswertung
zweiseitig in `training/proximity.ts:45`.
Selbst nachgerechnet (synthetischer Idealschwung durch die volle Pipeline): volle Schulterdrehung misst 76° (DTL) bzw. 88°
(Face-on) → beim Training „zu wenig Schulterdrehung“ gibt es für die **richtige** Bewegung den Fehlton, Treffer nur bei 56–72°.
Gestreckter Arm misst 179,5° → verfehlt 168 ± 10. `flying_elbow` ist laut L4 in 2D nie messbar (Ideal 158–177°), wird aber
in der Trainingsauswahl angeboten (`TrainingPicker.tsx:58`) und ist nie erreichbar.
*Vorschlag:* einseitige Kriterien wie im Score („mindestens 76°“, „mindestens 170°“) in `TargetCriterion` einführen, oder die
Ziele an die Vorlagen angleichen (`templates.json`: Arm 175 ± 10, Drehung 85 ± 15); Fehlerbilder ohne messbare Regel aus der
Trainingsauswahl filtern.

**W3 – Linkshänder: Fehler-Farben im Skelett auf der falschen Körperseite** · `src/ui/components/SwingPlayer.tsx:279`
`skeletonStatus()` (`engine.ts:262`) liefert Linien-Schlüssel im **kanonischen** (Rechtshänder-)Index, z. B. Führungsarm
`11-13`. Der Player zeichnet aber die zurückgespiegelten Landmarken (`toDisplay`, Zeile 79), bei denen Index 11 die echte
linke Schulter ist – beim Linkshänder der **hintere** Arm. Chicken Wing, gebeugter Führungsarm, Kniebeuge usw. werden
also am falschen Arm/Bein rot. Analyse und Messwerte selbst sind korrekt (getestet).
*Vorschlag:* in `SwingPlayer` bei `mirrored` die Indizes vor dem Nachschlagen über die Partner-Tabelle aus `pose/mirror.ts`
tauschen (Tabelle exportieren) und einen Test in `PlayerGeometry.test.ts` ergänzen.

**W4 – Linkshänder: Texte nur für Rechtshänder** · `catalog.json` (28 Zeilen mit links/rechts, z. B. `:508` „rechten
Ellbogen“, `:628` „linke Schulter … linke Ferse“, `:1121`), `drills.json` (22 Zeilen), `ballflights.json` (16 EN-Zeilen
„curves to the right“ …)
Auftrag Abschnitt 3: „Rechts-/Linkshänder: alle Richtungen spiegeln“. Englisch nutzt meist lead/trail, Deutsch durchgehend
links/rechts; Ballflug-Richtungen sind in beiden Sprachen rechtshändig. `loc()` (`i18n.ts:58`) kennt keine Händigkeit.
*Vorschlag:* Platzhalter `{lead}`/`{trail}`/`{right}`/`{left}` in den JSON-Texten und Auflösung in `loc(text, lang, handedness)`;
übergangsweise ein Hinweis „Für Linkshänder links und rechts tauschen“.

**W5 – Vergleich meldet „✓ Kein klarer Fehler“ für nicht sicher erkennbare Schwünge** · `src/ui/screens/CompareScreen.tsx:174–177`
Im Smoke-Test: zwei Videos ohne erkennbare Person → Vergleich zeigt bei beiden „✓ No clear fault“. Startseite und Verlauf
machen es richtig („Nicht sicher erkennbar“). Falsche Entwarnung widerspricht Abschnitt 7.
*Vorschlag:* dieselbe Logik wie `HomeScreen.tsx:33` (`!f && checkedFaultIds.length === 0` → `common.notReliable`).

**W6 – Aufnahme-Auswahl kann von den Einstellungen überschrieben werden** · `src/ui/screens/CaptureScreen.tsx:42–60`
Der Screen startet mit Face-on/Rechtshänder und überschreibt Schlagart, Perspektive **und Händigkeit** asynchron, sobald die
Einstellungen aus IndexedDB da sind (Timeout bis 4 s, `idb.ts:73`). Tippt der Spieler vorher, wird seine Wahl still ersetzt;
lädt er vorher hoch, wird mit der Startbelegung analysiert. Im Smoke-Test so passiert: zweiter Upload als Face-on gespeichert
statt Down-the-line. Folge wäre eine falsche Analyse (falsche Ansicht oder ungespiegelter Linkshänder).
*Vorschlag:* Startwerte synchron aus `currentSettings()` (`storage/settings.ts:34`) nehmen oder nur überschreiben, solange der
Spieler nichts angetippt hat; Upload-/Kamera-Knopf erst nach dem Laden aktivieren.

**W7 – Score-Regeln Abschnitt 3/4 nur teilweise umgesetzt** · `HomeScreen.tsx:50`, `HistoryScreen.tsx:189`,
`CompareScreen.tsx:165–168` vs. `AnalysisScreen.tsx:41`
Die Analyse rechnet einen gespeicherten Score auf die aktuelle Stufe um (`rescore`), Startseite/Verlauf/Vergleich zeigen den
Score der Stufe zum Aufnahmezeitpunkt → nach einem Stufenwechsel zwei verschiedene Zahlen für denselben Schwung.
Stufenaufstieg (Median der letzten 3 Einheiten ≥ 85) und Score-Kurve „Median je Einheit“ fehlen (nicht in A–H, aber in den
verbindlichen Score-Regeln). *Vorschlag:* Helfer `displayScore(swing, level)` überall verwenden; Aufstieg/Kurve als nächsten
Schritt in `OPEN_QUESTIONS.md`/Morgenbericht aufnehmen.

### Klein

- **K1** `trainingTarget` (32×) im Katalog ohne `REVIEW(golf)`-Feld (`catalog.json`, z. B. `:641`). Sie stehen zwar in der
  generierten Liste (`decisions/faults-review-list.md`, „Trainingsziele aus Korrekturen“), der Auftrag verlangt die Markierung
  aber an jedem Wert. → `review`-Feld wie in `templates.json` ergänzen.
- **K2** Entscheidung 2 „Korrektur per Finger“: nur die neutrale Linie ist verschiebbar und bleibt reine Markierung
  (DECISIONS L2). Das sollte Sascha bewusst bestätigen, sonst Schaft-Korrektur + Neuberechnung von `shaft_plane_dev`/Score.
- **K3** Kamera-Fehler hängt die rohe Browsermeldung an („Permission denied“, auch auf Deutsch): `CaptureLive.tsx:192`.
  → bekannte Fehlernamen (`NotAllowedError`, `NotFoundError`) auf i18n-Texte abbilden.
- **K4** Neustart der Aufnahme ohne try/catch: `CaptureLive.tsx:160` und `:219`, `LiveTraining.tsx:260` (der erste Start ist
  abgesichert). → wie Zeile 144–149 absichern.
- **K5** Nur der SIMD-WASM-Build liegt bei (DECISIONS A2). Auf iOS < 16.4 fragt MediaPipe die Nicht-SIMD-Datei an → 404 →
  „Something went wrong“. → vorher `WebAssembly.validate`-Check und klare Meldung „iOS 16.4 oder neuer nötig“.
- **K6** Veraltete Doku: `decisions/faults.md` V1/V2 (Casting „< 60“, Vorzeichen-Warnung side_bend) passt nicht mehr zu
  Katalog (28°) und Tests (Reverse Pivot misst −8 und kleiner). → Abschnitt als „erledigt“ markieren.
- **K7** Synthetischer Idealschwung löst face-on `flip_at_impact` (Eisen) und `chip_scoop` (Pitch) aus – als Synth-Grenze
  dokumentiert (phases-metrics PM4: keine Schaftvorlage im Generator), aber dadurch gibt es keinen Test gegen Fehlalarme
  dieser zwei Regeln. → Generator um Schaftvorlage +5…10° ergänzen.
- **K8** Ansprech-Vorneigung: Score-Ziel 30° ± 5, Synth-Ideal misst 38°; übliche Lehrmeinung für Eisen eher 35–45°.
  → REVIEW(golf) für Chris.
- **K9** Offline-Hinweis liegt als Toast über dem Kamera-Leitfaden (`webkit_en-US_02_capture_setup.png`), schließbar.
  → unten andocken oder nach einigen Sekunden ausblenden.
- **K10** Ein Bundle mit 672 kB (Build-Warnung). Für den Prototyp ok; später MediaPipe/Training per `import()` nachladen.

## Golf-Inhalte (Stichprobe, Abschnitt 7)

Geprüft: Over the Top, Chicken Wing, Casting, Reverse Pivot, Putt-Handgelenke, zu wenig Schulterdrehung (Ursache, Korrektur,
Nutzen, EN + DE).

- **Gut:** kurz (1 Satz je Feld), Du-Form, konkrete Bilder („Gürtelschnalle zum Ziel“, „linke Schulter unter dem Kinn“,
  „Dreieck aus Armen und Schultern“), jeder Fehler mit motivierendem Nutzen („die kurzen Putts, die du früher verschoben
  hast, fallen“, „Energie wie eine Feder“). Ursache nennt oft den echten Auslöser (Beweglichkeit, Anspannung) – das ist
  Trainer-Niveau. Drills im Format „Get the Feel / Make it Real“, als Entwurf markiert (warten auf Chris, M2).
- **Fachbegriffe:** Namen wie „Over the Top“, „Chicken Wing“, „Casting“, „Reverse Pivot“ bleiben, sind aber im Deutschen in
  Klammern erklärt („Gewicht falsch herum“, „Winkel löst sich zu früh“) – vertretbar, weil Golfer diese Begriffe kennen.
  Einzelne Ausdrücke („Draw“, „Ball-dann-Rasen-Kontakt“, „Stroke“) könnten einfacher sein.
- **Schwächen:** Tempo-Fehler (W1), Linkshänder-Texte (W4).

## Nur auf einem echten iPhone prüfbar

1. Kamera in Safari über HTTPS und im Homescreen-Modus (Berechtigungsabfrage, Rückkamera, Hochformat).
2. Live-Schleife: MediaPipe-GPU-Delegate in Safari/WebGL, erreichte Bildrate mit dem lite-Modell, Wärme/Akku bei einer Ball-Serie.
3. MediaRecorder (MP4/H.264) gleichzeitig mit der Pose-Schleife; Auto-Aufnahme-Auslösung und Nachlauf.
4. Upload von iPhone-Videos: HEVC-.mov, Zeitlupe 120/240 fps (Zeitlupen-Erkennung), Dauer der Bild-für-Bild-Analyse.
5. Ton: AudioContext-Freischaltung im Tap, Stummschalter (`audioSession`), Lautstärke im Freien.
6. Erstes Öffnen lädt ~28 MB; danach Flugmodus → App vom Homescreen starten und analysieren; `persist()`-Abfrage und
   Verhalten bei wenig Speicher.
7. Bewegungssensor-Abfrage („Handy schief“), Fingerbedienung der neutralen Linie, Lesbarkeit in der Sonne, Handschuh-Tippflächen.
8. **Schaft-Erkennung und Grenzwerte auf echten Schwüngen** (größtes Risiko laut L5 und `decisions/club.md` „Grenzen auf
   echten Videos“) – braucht Saschas/Chris' Videos (M1).
