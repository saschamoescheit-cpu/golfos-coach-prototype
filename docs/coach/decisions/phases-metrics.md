# Entscheidungen – phases-metrics (Paket C3: Schlüsselpositionen + Messwerte)

Stand 13.10.2026. Code: `src/coach/analysis/phases.ts`, `metrics.ts`, `signals.ts`; Tests `phases.test.ts`, `metrics.test.ts`.
Alle Zahlen hier sind **synthetisch** (Strichmännchen aus `testing/synth.ts`, Rauschen 0,003, 60 fps) – echte Videos fehlen noch.

## PM1 Schlüsselpositionen (detectKeyframes / detectPhases)
Grundsignal = Handmitte (Mittelpunkt beider Handgelenke) in Rumpflängen, Lücken (lm = null) linear überbrückt, Gauß-geglättet
(30 ms für die Suche, 12 ms für die Feinbestimmung). Alle Zeiten werden **zwischen zwei Bildern** bestimmt (Feld `tEvent`).
1. **Anker** = schnellste Handbewegung, während die Hände seit 0,1 s nach unten gehen (= später Abschwung; schließt Durchschwung,
   Aufschwung und Waggle in beiden Ansichten aus). Putt: ohne „nach unten“-Bedingung (Hände sinken kaum).
2. **Impact** = tiefster Handpunkt nahe dem Anker (Doppel-Parabel-Fit). Putt face-on: Moment, in dem die Hände ihre
   Ansprechposition passieren („hands-return“, schärfer). **Mit Schläger (conf ≥ 0,5): Schlägerkopf zurück an seiner
   Ansprech-Position** („club-at-ball“) – nötig, weil sich der Schaft um den Treffmoment bei 60 fps ~20° pro Bild dreht;
   shaft_lean / hands_ahead sind sonst nur Zufall.
3. **Top** = Umkehrpunkt: Handweg auf die Bewegungsrichtung kurz vor dem Top projiziert, Fit „langsam ankommen, schnell
   umkehren“ (zwei Parabeln mit freiem Knickpunkt). „Hände am höchsten“ allein ist am Top zu flach (±4 Bilder).
4. **Ansprechen** = letzte ruhige Phase (≥ 0,1 s) vor dem Top, deutlich vom Top entfernt; Ruhe wird am ganzen Oberkörper
   gemessen (Handgelenke, Ellbogen, Schultern, Hüften), weil von hinten die Hände anfangs fast nur in die Tiefe gehen.
   Beginn des Rückschwungs = Einsatz-Fit (konstant, dann ~(t−t0)², Exponent 1–4 frei, 12 % des Wegs). Address-Bild = letztes
   Bild davor. Waggle davor stört nicht (Test). Clip beginnt mitten im Aufschwung → kein Address, Top-Konfidenz 0,75 statt 0,9.
5. **Finish** = erste ruhige Phase nach Impact, Ende des Ausschwungs per gespiegeltem Fit (4 % des Wegs). Ohne Halten:
   langsamster Moment des Ausschwungs (Konfidenz 0,4).
6. **9 Uhr** = Schaft waagrecht: Griff und Kopf auf gleicher Bildhöhe (funktioniert face-on **und** von hinten, solange die
   Kamera waagrecht steht), nur Schläger mit conf ≥ 0,5 und nicht aus den Händen geschätzt → Methode `club-parallel`.
   Sonst **Hand-Höhen-Proxy** (`hands-proxy`, Konfidenz 0,45): Aufschwung bei 33 % (Pitch 36 %) des Hand-Anstiegs bis zum Top,
   Abschwung bei 16 % (Pitch 20 %). REVIEW(golf): auf dem synthetischen Schwung kalibriert; echte P2-Position liegt
   vermutlich früher (Hände etwa Hüfthöhe) → mit echten Videos nachjustieren.
7. Konfidenz je Position = Basis (Methode) × Datenabdeckung ±0,1 s (Aussetzer) × fps (<25: 0,7, <50: 0,9) × Ansicht
   (Putt von hinten 0,5, Chip von hinten 0,7).

Genauigkeit (synthetisch, alle 6 Schlagarten, 30/60/120 fps, Rauschen 0,002–0,004, 5 % Aussetzer, Rechts- und Linkshänder):
- Face-on volle Schwünge: Address/Top/Impact/Finish meist 0, max ±1 Bild; Tempo ±3 %.
- Down-the-line volle Schwünge: Top/Impact ±1 Bild, Address bis +4–5 Bilder bei 60 fps (Rückschwung startet von hinten
  unsichtbar), Finish ±4; Tempo ±12 %.
- Chip/Putt face-on: ±1–2 Bilder, Tempo ±10–25 % (ein Bild = 8 % eines 0,2-s-Abschwungs).
- **Putt von hinten ist nicht zeitlich messbar** (Bewegung fast nur in die Bildtiefe): alle Positionen Konfidenz < 0,5,
  oft gar keine. Empfehlung an UI: Putt face-on filmen.
- 9 Uhr mit Schläger: ±1 Bild (60 fps); mit Hand-Proxy ±3 Bilder.
Test-Toleranzen (ms) stehen in `phases.test.ts` (`tolMs`, `TEMPO_TOL`).

## PM2 Messwerte (computeMetrics / metricsAtFrame)
- Welche Werte wo: `faults/metricContract.ts` (maschinenlesbare Kopie von 02_METRICS.md) – wird direkt verwendet.
  Dort ist „voll“ = driver + iron (Bunker nicht); ich folge dem.
- Werte an einer Position: Landmarken über ±20 ms gemittelt; Address = Mittel der 0,1 s vor dem Rückschwung; Impact (und der
  Schläger an allen Positionen) zum exakten Ereigniszeitpunkt interpoliert.
- Einheit `pct_torso` = Prozent der Rumpflänge **beim Ansprechen im Bild**. Face-on wirkt der Rumpf um cos(Vorneigung) kürzer
  (~0,8) – gleiche Zentimeter ergeben face-on also ~25 % größere Prozentwerte als von hinten.
- Vorzeichen (bestätigt gegenüber faults): `side_bend` + = Wirbelsäule vom Ziel weg geneigt (normal im Top/Impact);
  synth.ts benutzt für `sideBendTop` das umgekehrte Vorzeichen – das wird nur im Test berücksichtigt, synth bleibt.
  `lead_wrist_hinge` 0 = Schaft in Verlängerung des linken Unterarms, größer = mehr Winkel (Casting = klein bei downswing9).
  `shaft_plane_dev` + = Schlägerkopf rechts der neutralen Linie (steil). `hand_path_shift` + = Hände kommen weiter außen
  herunter (Over the Top). `hip_depth_change` + = Becken Richtung Ball. `spine_angle_change` − = Aufrichten.
- **2D-Näherungen der Drehung** (`shoulder_turn`, `hip_turn`, `x_factor`):
  face-on: Linie Schulter–Schulter (Hüfte–Hüfte) wird wie cos(Drehung) kürzer → Drehung = acos(Breite/Breite beim
  Ansprechen); Vorzeichen: Schulter über die linke Schulter, die im Rückschwung sinkt; Hüfte über MediaPipe-Tiefe z
  (sonst: Top = +, Impact = −). Von hinten: die Linie wird wie sin(Drehung) sichtbar; volle Breite = max(0,75 × Rumpf bzw.
  0,55 × Rumpf, 95-%-Wert der im Clip gesehenen Breite).
  Synthetisch (orthografisch) liest face-on eine echte 90°-Schulterdrehung als **87,6°**, von hinten als **76°**;
  60° → 58° / 55°. Auf echtem Video (Perspektive, MediaPipe) misst Ben für echte 90° nur ~64° → der Score-Zielwert 85°
  passt zum Synth, aber vermutlich nicht zum echten Bild. REVIEW(calibration) mit echten Videos.
- `swing_length`: face-on Winkel des Arms (Schultermitte→Hände) gegenüber dem Ansprechen (= „Uhrzeit“ der Hände: 90 = Hände
  auf Schulterhöhe hinten); von hinten über die Projektion auf die Ansprech-Richtung (acos), Konfidenz × 0,7.
- `lead_arm_post_impact`: linker Ellbogenwinkel an der „3-Uhr“-Stelle (Hände 90° durch), sonst 0,12 s nach Impact.
- `hands_ahead` ohne Schläger: Hände gegenüber ihrer Ansprechposition, Konfidenz 0,3 (nur Anzeige, nie Diagnose).
- `putter_wrist_change`: max. Änderung des Winkels linker Unterarm↔Schaft (ohne Schläger: Unterarm↔Hand, Konfidenz 0,4)
  über den Schlag; `body_motion`: max. Weg der Schultermitte über den Schlag (40 ms geglättet).
- Konfidenz = Sichtbarkeit (0,3→0, ≥0,8→1, schwächster Punkt) × Ansicht (z. B. Schulterdrehung face-on 0,8 / hinten 0,7,
  Hüftdrehung 0,7/0,6, Handgelenk von hinten 0,5, Putt-Werte von hinten 0,5–0,6) × (0,7 + 0,3 × Positions-Konfidenz)
  × Schlägerquelle (aus Händen geschätzt ≤ 0,4, Handgelenk ≤ 0,3).
- Keine Keyframes übergeben → computeMetrics erkennt sie selbst (für den Integrationstest der faults).
- `metricsAtFrame` (Training live): ein Bild gegen das gemittelte Ansprechen, gleiche Definitionen; ohne Tempo, Chicken
  Wing, Handweg. Von hinten nutzt es für die Drehungen nur die Standard-Breiten (Abweichung zu computeMetrics bis ~8°).

## PM3 Standardwerte des synthetischen Schwungs (für Schwellen – SYNTHETISCH)
Ideal-Schwung je Schlagart/Ansicht mit echtem Schläger (truth.club), Rauschen 0,003; `*` = Konfidenz < 0,5.

| Messwert | FO driver | FO iron | FO pitch | FO chip | FO bunker | FO putt | DTL driver | DTL iron | DTL pitch | DTL chip | DTL bunker | DTL putt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| backswing_ms@swing (ms) | 778.3 | 746.7 | 588.3 | 453.3 | 746.7 | 568.3 | 721.7 | 700 | 561.7 | 395 | 708.3 |  |
| body_motion@swing (pct_torso) |  |  |  | 12.3 |  | 2.1 |  |  |  | 13.3 |  |  |
| downswing_ms@swing (ms) | 260.7 | 251 | 308.9 | 228.2 | 251.1 | 315 | 260 | 255.4 | 302.7 | 234 | 253.8 |  |
| hand_depth@backswing9 (pct_torso) |  |  |  |  |  |  | -11.7 | -8.5 |  |  |  |  |
| hand_depth@downswing9 (pct_torso) |  |  |  |  |  |  | -7.8 | -5.1 |  |  |  |  |
| hand_depth@top (pct_torso) |  |  |  |  |  |  | -45 | -28 |  |  |  |  |
| hand_path_shift@downswing9 (pct_torso) |  |  |  |  |  |  | 3.9 | 3.4 |  |  |  |  |
| hands_ahead@impact (pct_torso) | -0.7 | -3.8 | -6.4 | 0.2 | -4 |  |  |  |  |  |  |  |
| head_shift_x@impact (pct_torso) | -28.9 | -31.5 | -31.8 | -16.8 | -31.5 | -0.1 |  |  |  |  |  |  |
| head_shift_x@top (pct_torso) | -16.9 | -18.5 | -19 | -8.8 | -18.5 | -0.9 |  |  |  |  |  |  |
| head_shift_y@impact (pct_torso) | -3.7 | -4.2 | -4.2 | 1.3 | -4.2 | -0.3 | -3.7 | -3.1 | -3.7 | 0.6 | -3.1 |  |
| head_shift_y@top (pct_torso) | -0.7 | 0.3 | 0 | 0.4 | 0.3 | 1.2 | -0.6 | 0.3 | 0.2 | 0 | 0.3 |  |
| hip_depth_change@impact (pct_torso) |  |  |  |  |  |  | 0.1 | -0.5 | 0.4 |  |  |  |
| hip_depth_change@top (pct_torso) |  |  |  |  |  |  | 0.1 | -0.3 | 0.1 |  |  |  |
| hip_shift_x@finish (pct_torso) | 21.9 | 23 | 24.3 | 5.3 | 23 |  |  |  |  |  |  |  |
| hip_shift_x@impact (pct_torso) | 13.8 | 13.7 | 14.9 | 1.6 | 13.7 |  |  |  |  |  |  |  |
| hip_shift_x@top (pct_torso) | -0.7 | -2 | -1.5 | -1.5 | -2 |  |  |  |  |  |  |  |
| hip_turn@impact (deg) | -41.5 | -38.3 |  |  |  |  | -39.5 | -37.5 |  |  |  |  |
| hip_turn@top (deg) | 38.2 | 40.1 |  |  |  |  | 36.3 | 38.9 |  |  |  |  |
| knee_flex@address (deg) |  |  |  |  |  |  | 26.4 | 26.5 | 26.5 | 26.5 | 26.5 |  |
| lead_arm_angle@impact (deg) | 177.4 | 176.4 | 172.6 |  |  |  |  |  |  |  |  |  |
| lead_arm_angle@top (deg) | 180 | 179.3 | 171 |  |  |  | 173.3 | 172.3 | 145.3 |  |  |  |
| lead_arm_post_impact@swing (deg) | 169.5 | 165.3 | 165.9 |  |  |  |  |  |  |  |  |  |
| lead_wrist_hinge@downswing9 (deg) | 39.4 | 44.7 | 43.6 |  |  |  | 166.7* | 95.5* | 157.1* |  |  |  |
| lead_wrist_hinge@top (deg) | 38.6 | 41.4 | 72.6 |  |  |  | 6.8* | 12.4* | 4.6* |  |  |  |
| putter_wrist_change@swing (deg) |  |  |  |  |  | 15.1 |  |  |  |  |  |  |
| shaft_lean@impact (deg) | -0.3 | -1.4 | -1.8 | 0 | -1.6 | 2.2 |  |  |  |  |  |  |
| shaft_plane_dev@backswing9 (deg) |  |  |  |  |  |  | 0 | 0 | 0 |  |  |  |
| shaft_plane_dev@downswing9 (deg) |  |  |  |  |  |  | 0 | 0 | 0 |  |  |  |
| shaft_plane_dev@top (deg) |  |  |  |  |  |  | 0 | 0 | 0 |  |  |  |
| shoulder_turn@top (deg) | 87.8 | 87.6 | 54.2 |  |  |  | 70.2 | 76.1 | 53 |  |  |  |
| side_bend@address (deg) | -0.3 | -0.3 |  |  |  |  |  |  |  |  |  |  |
| side_bend@impact (deg) | 17 | 17.5 |  |  |  |  |  |  |  |  |  |  |
| side_bend@top (deg) | 6.5 | 6.6 |  |  |  |  |  |  |  |  |  |  |
| spine_angle@address (deg) |  |  |  |  |  |  | 32.2 | 38.1 | 38.4 | 38.1 | 38.1 |  |
| spine_angle@impact (deg) |  |  |  |  |  |  | 31.3 | 37.6 | 37.9 | 36.9 | 37.6 |  |
| spine_angle@top (deg) |  |  |  |  |  |  | 31.9 | 38.4 | 38.6 | 38.1 | 38.4 |  |
| spine_angle_change@impact (deg) |  |  |  |  |  |  | -0.9 | -0.5 | -0.5 |  |  |  |
| spine_angle_change@top (deg) |  |  |  |  |  |  | -0.2 | 0.2 | 0.2 |  |  |  |
| stance_width@address (ratio) | 1.3 | 1 | 1 | 0.8 | 1 | 0.8 |  |  |  |  |  |  |
| swing_length@top (deg) | 154.4 | 156.1 | 99 | 35.6 | 135.5 | 17.7 | 150.1 | 151.3 | 95.8 | 34.4 | 130.7 |  |
| tempo_ratio@swing (ratio) | 3 | 3 | 1.9 | 2 | 3 | 1.8 | 2.8 | 2.7 | 1.9 | 1.7 | 2.8 |  |
| trail_arm_angle@top (deg) |  |  |  |  |  |  | 157.4 | 175.7 |  |  |  |  |
| x_factor@top (deg) | 49.6 | 47.4 |  |  |  |  | 33.9 | 37.2 |  |  |  |  |

Wirkung der Fehler-Stellschrauben (synthetisch, iron sofern nicht anders, mit Schläger):

| Stellschraube | Messwert | Standard | mit Fehler |
|---|---|---|---|
| hipDepthImpact 0.08 | hip_depth_change@impact | -0.5 | 14.8 |
| spineTiltImpactDelta −12 | spine_angle_change@impact | -0.5 | -12.3 |
| headShiftTopX −0.06 | head_shift_x@top | -18.5 | -32.8 |
| hipShiftTop −0.08 | hip_shift_x@top | -2.0 | -14.4 |
| sideBendTop +10 & hipShiftTop +0.05 | side_bend@top | 6.6 | -11.9 |
| sideBendTop +10 & hipShiftTop +0.05 | hip_shift_x@top | -2.0 | 11.6 |
| leadElbowFollow 70 | lead_arm_post_impact@swing | 165.3 | 117.7 |
| overTheTop 0.12 | hand_path_shift@downswing9 | 3.4 | 12.6 |
| casting 1 (FO, Schläger) | lead_wrist_hinge@downswing9 | 44.7 | 17.5 |
| casting 1 (DTL, Schläger) | lead_wrist_hinge@downswing9 | 95.5 | 42.1 |
| shoulderTurnTop 60 (FO) | shoulder_turn@top | 87.6 | 58.4 |
| shoulderTurnTop 60 (DTL) | shoulder_turn@top | 76.1 | 55.4 |
| shaftPlaneDevDown +15 | shaft_plane_dev@downswing9 | 0.0 | 8.6 |
| shaftPlaneDevDown −15 | shaft_plane_dev@downswing9 | 0.0 | -8.6 |
| shaftPlaneDevBack +15 | shaft_plane_dev@backswing9 | 0.0 | 12.4 |
| puttWristBreak 20 (Putt FO, Schläger) | putter_wrist_change@swing | 15.1 | 38.7 |
| puttWristBreak 20 (Putt FO, ohne Schläger) | putter_wrist_change@swing | 16.0 | 39.9 |
| strokeBodySway 0.05 (Putt FO) | body_motion@swing | 2.1 | 26.7 |

## PM4 Abgleich mit dem Fehlerkatalog (für faults / Sascha)
Ideal-Schwung (synthetisch, mit Schläger) löst laut aktuellem Katalog aus:

- FO driver: casting, head_sway
- FO iron: casting, head_sway, flip_at_impact
- FO pitch: casting, chip_scoop, head_sway
- FO chip: –
- FO bunker: head_sway
- FO putt: putt_wrist_break
- DTL driver: flying_elbow
- DTL iron: flying_elbow
- DTL pitch: bent_lead_arm
- DTL chip: –
- DTL bunker: –
- DTL putt: –

Konkret (Messwert des Ideal-Schwungs → Regel im Katalog):
- `casting`: lead_wrist_hinge@downswing9 face-on 35–45° (Ideal) / 17–22° (casting 1) vs. Regel < 60 → Schwelle ~28–30
  (face-on). Von hinten ist der 2D-Winkel unbrauchbar (Ideal 20–95°, Konfidenz 0,5 × …) – Regel nur face-on empfohlen.
- `head_sway`: head_shift_x@top Ideal −17…−19 (Kopf folgt im Synth der Seitneigung −5°; 7 cm), headShiftTopX −0,06 → −33;
  Regel < −15 → Schwelle ~ −25. head_shift_x@impact Ideal −29…−31 (Seitneigung −15°); Regel „> 10“ trifft nie, ok.
- `flying_elbow`: trail_arm_angle@top von hinten Ideal 157–176° (90° gebeugter Arm wirkt im 2D-Bild von hinten gestreckt);
  Regel > 120 feuert immer → Messgröße für den fliegenden Ellbogen ungeeignet; Vorschlag: Regel vorerst aus oder auf
  Ellbogen-Position relativ zur Schulterlinie umstellen (neue Metrik nötig).
- `bent_lead_arm` (DTL pitch): lead_arm_angle@top von hinten 145° bei gestrecktem Arm (Verkürzung) → Regel nur face-on.
- `putt_wrist_break`: putter_wrist_change Ideal 15–16° (der Synth-Putt ist kein starres Pendel), puttWristBreak 20 → 39–40°.
  Regel > 6 → für den Synth Schwelle ~25; auf echtem Video vermutlich kleiner (echtes Pendel).
- `flip_at_impact` / `chip_scoop`: der Synth hat am Treffmoment **keine Schaftvorlage** (shaft_lean −2…0°,
  hands_ahead −7…0 %); echte Eisen haben +5…+10°. Regeln sind fachlich plausibel, der Synth ist hier unrealistisch.
  **Erledigt (Review K7, DECISIONS R2):** Synth-Parameter `shaftLeanImpact` (Eisen 8°, Pitch/Chip 6°, Casting nimmt ihn weg); Fehlalarm-Test in `faults/integration.test.ts`.
- `putt_tempo` (Integrationstest Putt): Synth-Putt-Tempo misst 1,8–2,0 (Ziel 2) – feuert nur, wenn die Messung < 1,5.
- Funktionieren wie gedacht: early_extension (hip_depth_change 15 / spine_angle_change −12), hip_sway (−14),
  reverse_pivot (side_bend −12, hip_shift_x +12), chicken_wing (118 vs 165), over_the_top (12,6 vs 3,4),
  short_shoulder_turn (58 vs 88), shaft_steep/flat (±8,6 vs 0), putt_body_movement (27 vs 2).
- Integrationstest `faults/integration.test.ts`: läuft jetzt (computeMetrics liefert Werte). Er scheitert, solange
  `club/track.ts` noch ein Stub ist (kein Schläger → kein shaft_plane_dev / Score-Teil 9 Uhr, Putt-Handgelenk nur
  Konfidenz 0,38). Mit echtem Schläger (truth.club) laufen die gleichen Erwartungen in `metrics.test.ts` grün bis auf die
  oben genannten Schwellen.

## PM5 Änderungen an gemeinsamen Dateien
- `model/types.ts` (additiv): `PhaseKeyframe.tEvent?: number` – Ereigniszeit zwischen zwei Bildern (ms); bei `address` der
  Beginn des Rückschwungs. Wird für Tempo und für Schlägerwerte am Treffmoment benutzt.
- `testing/synth.ts` (additiv, synth.test.ts grün): Stellschraube `waggle` (Grad, Standard 0) und `followBody` (0..1,
  Standard 1 = bisheriges Verhalten). Geändert für **putt/chip-Standards** (Fehler im Synth): der Putt drehte die
  Schultern im Ausschwung auf −100°, richtete sich um 25° auf und hatte die Seitneigung des vollen Schwungs (−5° Top);
  jetzt Putt `followBody 0, sideBendTop 0, hipShiftTop 0`, Chip `followBody 0.3, sideBendTop −2, sideBendImpact −6`.
  Sonst wäre body_motion beim idealen Putt 32 % statt 2 %.

## PM6 Risiken auf echtem Video
- MediaPipe-Handgelenke sind im Treffmoment verwischt / springen → Impact über Hände ±1 Bild, Schlägerwerte brauchen den
  Schläger-Tracker (club-at-ball).
- Perspektive: Kamera nicht waagrecht → 9-Uhr über „Griff und Kopf gleich hoch“ verschiebt sich; Kamera nicht genau
  hinter dem Spieler → DTL-Drehungen und hand_depth verfälscht.
- 2D-Drehungen lesen auf echtem Video kleiner (Ben: 90° → ~64°); Schwellen müssen am Bildwert kalibriert werden.
- Probeschwung im Clip / mehrere Schwünge: es wird der schnellste Abschwung genommen.
- Hand-Proxy für 9 Uhr ist nur auf den Synth kalibriert.
