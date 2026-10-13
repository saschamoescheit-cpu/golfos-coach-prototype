# Offene Fragen – Trainingsmodus (Paket E)

Für Sascha / Chris. Alle Werte im Code mit `REVIEW(golf)` markiert.

- **T1 (Sascha)** Ein Schlag, bei dem die Korrektur nicht messbar war: dritter leiser Ton und zählt nicht in die Quote
  (so umgesetzt) – oder lieber wie „nicht geschafft“ behandeln, damit es strikt nur zwei Töne gibt (US-1.10)?
- **T2 (Chris)** Vorlagen-Ziele (`src/coach/training/templates.json`): Sind die Werte sinnvoll? Top linker Arm 170° ± 10°,
  volle Schulterdrehung 75° ± 12° (2D-Bildwert), 9 Uhr Abschwung Schaft ± 5°, Treffmoment Becken ± 6 % Rumpf / Wirbelsäule ± 6°,
  Finish Hüfte 20 % Rumpf Richtung Ziel, Putt Kopf ± 3 %, Ansprechen Vorbeuge 32° ± 6° und Knie 25° ± 10°.
  Welche Positionen fehlen für den US-Test?
- **T3 (Chris)** Standard-Toleranzen für „meine Position aus einem guten Schwung wiederholen“ (`DEFAULT_TOLERANCE` in
  `metricInfo.ts`): z. B. Schulterdrehung ± 12°, Vorbeuge ± 5°, Kopf ± 6 % Rumpf. Zu eng / zu weit für Amateure?
- **T4 (Chris)** Spiegel-Modus: reichen 2 s Halten? Soll der Spieler vorher ansprechen müssen (so umgesetzt, weil viele Werte
  „Veränderung zur Ansprechhaltung“ sind), oder lieber absolute Ziele (Winkel ohne Bezug)?
- **T5 (Sascha)** Serie: Soll die Serie nach einer Zahl Bälle automatisch enden (Auswahl 5/10/20/offen, Standard 10) oder immer
  offen bis „Beenden“?
- **T6 (Ben/Sascha)** Schläger im Spiegel-Modus: Ziele zum Schaft (9 Uhr auf der Linie) sind live nur aus der Handschätzung
  möglich. Reicht das als Gefühl-Übung, oder soll der Spiegel Schaft-Ziele ausblenden, bis die Schaft-Erkennung live läuft?
