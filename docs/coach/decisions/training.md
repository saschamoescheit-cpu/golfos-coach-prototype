# Entscheidungen – Paket E (training)

Format: Nummer · Entscheidung · Begründung. Code: `src/coach/training/*`, UI: `src/ui/screens/TrainingScreen.tsx`,
`src/ui/components/{LiveTraining,LiveOverlay,TrainingPicker,TrainingSetup,TrainingSummary}.tsx`, `src/ui/styles/training.css`.

- **E1 Annäherung in „Toleranzen“.** Abstand je Kriterium = |Messwert − Ziel| / (Toleranz × toleranceScale). ≤ 1 = Treffer.
  Annäherung 0..1 linear: 1 = genau im Ziel, 2/3 = Toleranzgrenze, 0 = ab 3 Toleranzen (`FAR_DISTANCE`). Gesamtwert =
  schwächstes Kriterium (Minimum), passend zur Treffer-Regel „alle Kriterien in der Toleranz“. Fehlende Werte → kein Treffer.
- **E2 Farben.** Außerhalb der Toleranz Verlauf Rot → Gelb, innerhalb immer Grün (iOS-Systemfarben, sonnentauglich). Der
  bewusste Sprung Gelb → Grün an der Grenze fällt mit dem „Erreicht“-Ton zusammen; Grün bedeutet so immer „im Toleranzbereich“
  (wie in US-1.3). Grau = nicht sichtbar / nicht messbar.
- **E3 Spiegel-Modus mit Hysterese.** Eintritt bei Abstand ≤ 1 für 120 ms, Austritt erst bei > 1,15 für 250 ms;
  neuer „Erreicht“-Ton frühestens 0,7 s nach dem letzten. Kein Dauerton: genau ein Ton beim Erreichen, ein anderer nach 2 s
  Halten, beim Verlassen kein Ton (US-1.9).
- **E4 Bezugsrahmen im Spiegel.** Viele Messwerte sind „Veränderung zur Ansprechhaltung“. Der Spiegel nimmt die Ansprechhaltung
  automatisch auf, sobald der Spieler 0,9 s still mit Händen unter der Hüftlinie steht (kein Knopf). Button „Neu ansprechen“.
  Ziele an der Position „Ansprechen“ brauchen keinen Bezug.
- **E5 Live-Messwerte = dieselben Definitionen.** Der Spiegel nutzt `metricsAtFrame` (phases-metrics) mit einer 2-Bild-Sequenz
  [Ansprechen, aktuelles Bild] und `trackClub` ohne Bilder (Schläger aus der Handschätzung, Konfidenz ≤ 0,4). Schläger-Ziele
  (Schaft vs. neutrale Linie, Handgelenk) sind im Spiegel daher nur grob. Werte unter Konfidenz 0,3 gelten als fehlend
  (niedriger als die 0,5 der Fehlerregeln, weil der Spieler live sofort sieht, wenn etwas nicht passt).
- **E6 Ganzschwung-Ziele nur in der Ball-Serie.** Kriterien mit `at = 'swing'` (Tempo, Chicken Wing, Putt-Körperbewegung)
  lassen sich nicht in einer gehaltenen Position prüfen; der Spiegel ist für solche Korrekturen gesperrt (Hinweis im Set-up).
- **E7 Ton ≤ 2 s nach dem Treffmoment.** Die Serie bewertet beim `impact`-Ereignis des SwingTriggers + 400 ms weiterer Bilder
  (damit die Phasenerkennung den Treffmoment sicher sieht) mit `analyzeSequence` auf den Live-Posen (kein Video-Dekodieren).
  Typische Latenz ≈ 0,5 s. Das `swing`-Ereignis (nach Finish + Nachlauf) speichert Video + Schwung; der gespeicherte Schwung
  wird über das ganze Fenster neu analysiert. Das Ergebnis der Serie (Ton, Quote) bleibt das der ersten Bewertung.
- **E8 Probeschwünge.** Der Trigger meldet `practice` erst beim `swing`-Ereignis. Bis dahin schätzt die Serie mit derselben
  Regel (Stillstand an der Ansprechposition < 1 s → Probeschwung). Widerspricht der Trigger später, wird korrigiert:
  bewertet, aber Probeschwung → aus der Quote genommen, kein Video; übersprungen, aber echt → späte Bewertung.
  Schalter „alle Schwünge bewerten“ ist in `SeriesOptions.ignorePractice` vorbereitet (UI nutzt den Standard „ignorieren“).
- **E9 „Nicht messbar“ ist kein Fehlschlag.** Kann die Korrektur in einem Schwung nicht gemessen werden, ertönt ein dritter,
  leiser Doppel-Tick, der Schlag zählt nicht in die Quote („4 / 6“) und steht grau mit „?“ in der Liste. Grund: ein falsches
  „nicht geschafft“ zerstört Vertrauen (Wettbewerbsanalyse: Zuverlässigkeit ist unser Hebel). Siehe Frage T1.
- **E10 Töne.** Erzeugt mit Web Audio (offline, keine Dateien). Treffer = heller steigender Zweiklang (880 → 1319 Hz),
  daneben = tiefer kurzer fallender Brummton (180 → 110 Hz, Sägezahn). Unterscheidbar über Tonhöhe, Richtung, Klangfarbe und
  Rhythmus – auch ohne musikalisches Gehör. Spiegel: Erreicht = ein kurzer Ton, Gehalten = drei steigende Töne.
  iOS: Freischalten im „Los geht's“-Tipp; `navigator.audioSession.type = 'playback'` (Safari 17+), damit der Stummschalter
  den Ton nicht verschluckt. Vibration nur, wo unterstützt (nicht iPhone).
- **E11 Ghost.** Zielpose wird auf den Spieler gelegt (Hüftmitte auf Hüftmitte, Rumpflänge auf Rumpflänge) – egal wo er steht.
  Quelle: Referenzschwung = echte Pose des Spielers; Korrektur/Vorlage = synthetische „Musterpose“ aus `testing/synth.ts`.
  Toleranz sichtbar als Fächer (Winkel-Kriterien, ± Toleranz um die Soll-Linie) bzw. Band (Strecken in % Rumpf).
- **E12 Toleranzen.** Je Ziel über − / + (Faktor 1,25) im Set-up, gespeichert mit dem Ziel; global über
  `Settings.toleranceScale` (Einstellungen). Wirksam = Kriterium × globaler Faktor.
- **E13 Referenzziele.** Aus einem eigenen Schwung: Position wählen, bis zu 3 Messwerte (Vorauswahl: der wichtigste nach
  `TRAINABLE_METRICS`), Zielwert = gemessener Wert, Toleranz = `DEFAULT_TOLERANCE` (alle REVIEW(golf)).
- **E14 Video in der Serie.** Wie in der Aufnahme: Recorder startet beim `address`-Ereignis, stoppt beim `swing`-Ereignis;
  Posenzeiten werden auf Videozeit verschoben (`shiftResult`). Ohne MediaRecorder wird der Schwung ohne Video gespeichert.
- **E15 Session.** `mode` = 'mirror' | 'series'; `results` nur für bewertete Schläge (hit/miss), `swingIds` für alle
  gespeicherten. Gespeichert nach jedem Schlag und am Ende (nichts geht verloren, wenn der Akku leer ist).
