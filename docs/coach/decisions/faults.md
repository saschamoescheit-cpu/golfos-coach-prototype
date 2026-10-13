# Entscheidungen – Arbeitspaket D (Agent „faults“)

Stand 12.10.2026. Alle Golf-Schwellen sind Startwerte (`REVIEW(golf)`), vollständige Liste: [faults-review-list.md](faults-review-list.md).

## Katalog
- **F1 – 32 Fehlerbilder** in `src/coach/faults/catalog.json` (typisiert als `FaultDef`). Richtungen werden getrennt, wenn die Korrektur
  gegensätzlich ist (Kopf hebt/sackt ab, Setup aufrecht/gebückt, Schaft flach/steil je 9-Uhr-Position, Tempo hastig/träge).
  Grund: eine Karte = eine klare Korrektur in Spielersprache.
- **F2 – Messwert-Vertrag maschinenlesbar** (`faults/metricContract.ts`, Kopie von `02_METRICS.md`). Regeln, deren Messwert in
  Ansicht/Schlagart laut Vertrag nicht existiert, werden **übersprungen** (nicht „unsicher“). `views` eines Fehlers listet nur
  Ansichten, in denen mindestens eine Regel messbar ist – der Katalog-Test prüft das für jede Schlagart.
- **F3 – Bunker ehrlich:** nur Rückschwunglänge, Tempo, Kopf/Hüfte, Setup, Gewicht hinten. Eintrittspunkt im Sand und Schlagfläche
  sind nicht messbar und stehen als „nicht messbare Ursachen“ in der Ballflug-Liste.
- **F4 – Tempo-Fehler statisch je Schlaggruppe:** voll (Driver/Eisen/Bunker) < 2,4 hastig, > 3,6 träge; Pitch/Chip außerhalb 1,4–2,8;
  Putt außerhalb 1,5–2,6. (Regeln haben keine schlagartabhängigen Schwellen; daher eigene Fehler-Einträge.)
- **F5 – Ballflüge:** 26 (alle Fehlschläge aus dem Katalog 04.10.; `yips` additiv zum `BallFlight`-Typ ergänzt). Fade/Draw nicht
  aufgenommen – das ist eine gewollte Kurve, kein Fehlschlag.
- **F6 – Drills:** 35 Entwürfe (`draft: true`), Format „Get the Feel“ / „Make it Real“, 3–5 Schritte. Mehrere Fehler teilen sich Drills.

## Engine
- **E1 – `fullSeverityAt` = Abstand zur Schwelle** (so dokumentiert in types.ts), nicht absoluter Wert. Schwere = Abstand / fullSeverityAt, max. 1.
- **E2 – Kombination:** `match: any` → stärkster Treffer bestimmt Schwere und Vertrauen; `all` → Mittelwert der Schwere, kleinstes Vertrauen.
- **E3 – Unsicher statt „gut“:** fehlender Wert oder Vertrauen < `minConfidence` (Standard `QUALITY_MIN`) → Fehler „nicht sicher geprüft“,
  außer eine andere Regel (any) schlägt eindeutig an. Qualität < `QUALITY_MIN` → alle passenden Fehler unsicher, nichts diagnostiziert.
- **E4 – Priorität** = Schwere × Wichtigkeit × Vertrauen; Gleichstand alphabetisch (deterministisch). `topFaults` = 3.
- **E5 – Skelettfarben (US-1.3):** Messwert → Skelettlinien (`METRIC_LINES`, z. B. Vorneigung → Rumpflinien). Ein Wert „gilt“ von der
  Hälfte zur vorherigen bis zur Hälfte zur nächsten Schlüsselposition. Grün = sicher gemessen und in Toleranz, Rot = Regel eines erkannten
  Fehlers überschritten, sonst neutral. Kopf hat keine Skelettlinie → Schulter-/Rumpflinien.

## Swing-Score (verbindlich: `features/015-coach/swing-score-regeln.md`)
- **S1 – Konfiguration in `faults/score.json`**, Version `1.0` (`SCORE_VERSION`), Gewichte 30/20/18/14/10/8, Kriterien wie Abschnitt 2.
- **S2 – Gesamtscore nur bei ≥ 80 % gemessenem Gewicht** (ersetzt die zuerst genannten 50 %); darunter `total = null`, Grund `coverage`,
  Teilscores bleiben. Face-on allein = 46 % → kein Gesamtscore; Down-the-line ist Pflicht.
- **S3 – Nur Driver/Eisen:** andere Schlagarten liefern ein Score-Objekt mit `total = null`, `noTotalReason = 'shot_type'`
  (statt `null`, damit die App den Grund zeigen kann).
- **S4 – Stufen** 1–5 (Faktor 1,0–2,0) verändern nur die Toleranz; ohne Angabe Stufe 3. `levelFromHandicap`, `levelFromSettings`
  (Einstellungen: `handicap`, `scoreLevel` additiv in types.ts). `tourTotal` (Stufe 1, Standardziele) wird immer mitgerechnet.
- **S5 – Persönliche Ziele** (später TPI-Beweglichkeit) über `opts.personalTargets` mit Schlüssel `"metric@at"`; gelten nie für `tourTotal`.
  TPI bleibt ein eigenes Profil, nicht Teil des Scores.
- **S6 – Messfehler-Boden:** Schaft 3°, Tempo = Ziel × (1000/fps) / downswing_ms. Ohne `fps` kein Tempo-Boden (Pipeline muss `fps` übergeben).
- **S7 – Rohwerte + rescore:** jedes Kriterium speichert Messwert, Vertrauen, Ziel, Basis-Toleranz, Art, Boden → `rescore(score, ctx, {level})`
  ist identisch mit einer frischen Berechnung (getestet). Der Analyse-Screen rechnet einen gespeicherten Score auf die aktuelle Stufe um.
- **S8 – Teilscores** werden auf ganze Zahlen gerundet, der Gesamtscore aus diesen gewichtet und gerundet (Konzeptbeispiel → 77).
- **S9 – Impact** ist kein eigener Baustein (offene Frage im Konzept, Schläger bei 30–60 fps nicht sicher messbar).
- **S10 – Verlauf:** Trend über den **Median je Einheit** (≥ 5 Schwünge), „besser/schlechter“ erst ab 5 Punkten. Nächster Schritt:
  Validierung gegen Chris’ Bewertung der 50–70 Amateurschwünge (inkl. Handicap der Spieler, um die Stufenfaktoren zu kalibrieren).

## Vorzeichen / Abhängigkeiten zu metrics.ts (bitte prüfen)
- **V1 – side_bend:** types.ts definiert „Neigung **weg** vom Ziel“ → positiv = weg. Reverse Pivot = `side_bend@top < −3`, Setup-Ziel +15°.
  **Der Synth-Generator nutzt das umgekehrte Vorzeichen** (`sideBendTop` + = zum Ziel, `sideBendImpact` normal −15). Wenn metrics.ts dem
  Generator folgt, müssen Reverse-Pivot-Regel und Setup-Ziel gespiegelt werden.
  **Erledigt (Review K6):** metrics.ts misst nach types.ts; Reverse Pivot misst im Test −8 und kleiner, die Regel „< −3“ passt.
- **V2 – lead_wrist_hinge:** angenommen wie im Generator: 0 = Schaft in Verlängerung des Arms, ~90 = „L“. Casting = `< 60` bei 9 Uhr Abschwung.
  Falls metrics.ts den Innenwinkel misst (180 = gestreckt), dreht sich die Regel um.
  **Erledigt (Review K6):** Schwelle nach Messung am Synth auf **< 28°** gesenkt und nur noch Face-on (DECISIONS L4); „< 60“ ist überholt.
- **V3 – hip_turn @ impact:** negativ = Becken offen (Score-Regeln 12.10.), Ziel −35°.
- **V4 – shoulder_turn:** 2D-Bildwert (echt 90° ≈ 64°). Fehler-Schwelle < 50° (Bild); Score-Ziel laut Regeln 85° – muss auf die Messart
  von metrics.ts kalibriert werden, sonst verliert fast jeder Schwung Körper-Punkte.

## Rückwärts-Diagnose
- **R1 – Ursachen** = messbare Ursachen aus `ballflights.json` ∪ Fehler, die den Ballflug in `ballFlights` nennen (Quelle zuerst).
- **R2 – Rangfolge** mit Daten: Häufigkeit × (0,5 + 0,5 × mittlere Schwere), Wichtigkeit als Tiebreaker; ohne genug Daten (< 5 Schwünge):
  Reihenfolge der Quelle. Nie geprüfte Ursachen (andere Kameraperspektive) zeigen „Noch nicht geprüft – filme …“.
- **R3 – Schnittstelle** `diagnose(ballFlight, history)` ist rein und braucht pro Schwung nur `faults` + `checkedFaultIds` → später für das
  Runden-Modul nutzbar (Fehlschlag auf dem Platz erfasst → Ursachen aus der Schwung-Historie).
