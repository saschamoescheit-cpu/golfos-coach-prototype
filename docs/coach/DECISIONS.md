# Entscheidungen und Annahmen – Modul Coach

Format: Nummer · Datum · Wer · Entscheidung · Begründung. Neueste Einträge je Abschnitt unten anhängen.

## Mit Sascha abgestimmt (12.10.2026)
- **S1** Eigener Referenz-Prototyp (`GolfOS\coach-prototype`) als Ideengebung für Ben; Bens Prototyp bleibt unberührt.
- **S2** Schläger: Schaft per Bilderkennung + Korrektur per Finger; Schätzung aus Händen/Unterarmen nur als Notlösung (mit Hinweis „geschätzt“). Grund: Schaft vs. neutrale Linie ist laut User Stories (US-1.1) und Swing-Score (30 % „9 Uhr Abschwung“) die wichtigste Messung; aus Handgelenken allein ist der Handgelenkwinkel unbekannt. Abweichung vom ursprünglichen Auftrag („V1 schätzt aus Händen“) bewusst.
- **S3** Trainingsmodus mit beiden Varianten der User Stories: Spiegel-Modus (ohne Ball, Farbverlauf live, kurzer Ton beim Erreichen, zweiter Ton nach 2 s Halten) und Ball-Serie (Auto-Aufnahme, binärer Ton ≤ 2 s nach dem Treffmoment, Quote, jedes Video gespeichert). Der graduelle Farbverlauf ist im Spiegel-Modus am wertvollsten, weil der Spieler beim vollen Schwung auf den Ball schaut.
- **S4** Bereitstellung über eigenes GitHub-Pages-Repo `golfos-coach-prototype` (Safari gibt die Kamera nur über HTTPS frei). Live erst nach Saschas OK.

## Lead (Paket A)
- **A1** Stack wie Runden-Prototyp: Vite 5 + React 18 + TypeScript + vite-plugin-pwa + Vitest. Grund: Ben und Sascha kennen ihn, gleiche Deploy-Pipeline.
- **A2** MediaPipe `@mediapipe/tasks-vision` 1.1.0; WASM (nur SIMD-Build) und beide Modelle (lite 5,8 MB für live, full 9,4 MB für die Analyse) liegen in `public/` und werden vom Service Worker vorab gecacht (~28 MB beim ersten Öffnen). Grund: offline auf der Range. `npm run assets` lädt sie neu.
- **A3** Kanonisches Koordinatensystem = Rechtshänder; Linkshänder werden beim Einlesen gespiegelt (x → 1 − x, links/rechts getauscht). Damit gibt es jede Regel nur einmal. Overlays werden für die Anzeige zurückgespiegelt.
- **A4** Strecken relativ zur Rumpflänge (Schultermitte–Hüftmitte, `pct_torso`), Winkel in Grad, im „Pixelraum“ (x × Seitenverhältnis). Grund: unabhängig von Zoom und Abstand der Kamera. Zentimeter-Anzeige nur ungefähr über die Körpergröße aus den Einstellungen.
- **A5** Die sechs Schlüsselpositionen nach Chris (inkl. 9 Uhr Auf-/Abschwung) statt nur der sechs Phasen des Auftrags; Phasen sind die Intervalle dazwischen.
- **A6** Fehlerkatalog-Feld `benefit` (Wirkung in Spielersprache) zusätzlich zum Auftrag – laut Wettbewerbsanalyse unser klarster Unterschied (US-1.4).
- **A7** Swing-Score (Konzept 08.10.) wird mitgebaut, alle Werte `REVIEW(golf)`.
- **A8** Analyse als reine Funktion `analyzeSequence()` – komplett in Node testbar mit dem synthetischen Generator (`testing/synth.ts`, 3D-Strichmännchen mit Stellschrauben für jeden Fehler, projiziert in Face-on/DTL).
- **A9** Quelltexte der internen Konzepte liegen außerhalb des Repos (`GolfOS\features\015-coach\quellen`), weil das Repo für GitHub Pages öffentlich wird.

## Lead (Integration, 13.10.2026)
- **L1** Pipeline: Fehler werden immer ausgewertet (die Engine setzt bei schlechter Qualität alles auf „nicht sicher erkennbar“); der Swing-Score bekommt Bildrate, Spielerstufe (aus den Einstellungen) und Qualität.
- **L2** Die per Finger verschobene neutrale Linie wird am Schwung gespeichert (`manualNeutralLine`), bleibt aber reine Markierung (Entscheidung 06.10.).
- **L3** **Putts nur von vorne (Face-on).** Von hinten bewegt sich der Putter fast nur auf die Kamera zu; weder Phasen noch automatische Aufnahme lassen sich zuverlässig bestimmen (Befund phases-metrics + capture-pose). Wählt der Spieler „Putt“, stellt die App auf Face-on um und zeigt einen Hinweis, falls er doch Down-the-line wählt.
- **L4** Grenzwerte nach Messung am synthetischen Idealschwung angepasst (decisions/phases-metrics.md PM4), alle weiter REVIEW(golf):
  - `head_sway` @ Top: −15 → **−25 %** Rumpf (Idealschwung zeigt −17 … −19 %).
  - `casting`: nur noch **Face-on**, Schwelle 60° → **28°** (ideal 35–45°, Casting 17–22°).
  - `bent_lead_arm`: nur noch **Face-on** (von hinten verkürzt).
  - `flying_elbow`: in 2D von hinten **nicht messbar** (gebeugter Arm wirkt gestreckt) → bleibt im Katalog, erscheint aber immer unter „nicht sicher geprüft“, bis es einen 3D-/Ellbogenrichtungs-Messwert gibt.
  - `putt_wrist_break`: 6° → **22°** (synthetischer Putt ohne Handgelenk zeigt schon 15–16° durch die Armdrehung im 2D-Bild).
