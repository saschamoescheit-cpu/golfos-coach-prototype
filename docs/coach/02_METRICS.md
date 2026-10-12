# Messwert-Vertrag (Metrics Contract)

Verbindlich für **phases-metrics** (berechnet) und **faults** (Regeln im Katalog) und **training** (Ziele).
Definitionen und Einheiten: `src/coach/model/types.ts` (`MetricId`, `MetricUnit`). Kanonischer Rechtshänder-Rahmen.
Vorzeichen: siehe Kommentare in types.ts. FO = face-on, DTL = down-the-line. `swing` = über die ganze Bewegung.

| MetricId | Einheit | FO an | DTL an | Schlagarten | Wofür (Fehlerbild) |
|---|---|---|---|---|---|
| tempo_ratio | ratio | swing | swing | alle | Tempo zu schnell aus dem Top / Rhythmus (Ziel je Schlagart in SHOT_TYPES) |
| backswing_ms, downswing_ms | ms | swing | swing | alle | Anzeige |
| swing_length | deg | top | top | alle | Pitch/Chip zu lang/kurz, Overswing |
| head_shift_x | pct_torso | top, impact | – | alle | Kopf-Sway, Putt Kopfbewegung |
| head_shift_y | pct_torso | top, impact | top, impact | alle | Kopf hebt/senkt sich |
| hip_shift_x | pct_torso | top, impact, finish | – | voll, pitch, chip, bunker | Hüft-Sway, Reverse Pivot, Gewicht hinten (Chip) |
| side_bend | deg | address, top, impact | – | voll | Reverse Pivot (Oberkörper zum Ziel geneigt im Top) |
| shoulder_turn | deg | top | top | voll, pitch | zu wenig Schulterdrehung (2D-Näherung, kalibriert auf „Bildwert“) |
| hip_turn | deg | top, impact | top, impact | voll | Hüftdrehung |
| x_factor | deg | top | top | voll | Anzeige |
| lead_arm_angle | deg | top, impact | top | voll, pitch | gebeugter linker Arm im Top |
| lead_arm_post_impact | deg | swing | – | voll, pitch | Chicken Wing |
| trail_arm_angle | deg | – | top | voll | fliegender rechter Ellbogen |
| lead_wrist_hinge | deg | top, downswing9 | top, downswing9 | voll, pitch | Casting (Winkel geht im Abschwung früh verloren) – braucht Schläger |
| hands_ahead | pct_torso | impact | – | alle außer putt | Löffeln/Scoop, Chip mit Händen hinter dem Ball |
| shaft_lean | deg | impact | – | alle | Scoop (Schaft nach hinten geneigt), Chip |
| stance_width | ratio | address | – | alle | Setup |
| spine_angle | deg | – | address, top, impact | alle | Setup-Haltung |
| spine_angle_change | deg | – | top, impact | voll, pitch | Early Extension / Aufrichten |
| hip_depth_change | pct_torso | – | top, impact | voll, pitch | Early Extension (Becken Richtung Ball) |
| knee_flex | deg | – | address | alle | Setup (Knie zu gestreckt / zu tief) – Hinterknie |
| hand_depth | pct_torso | – | backswing9, top, downswing9 | voll | Anzeige |
| hand_path_shift | pct_torso | – | downswing9 | voll | Over the Top |
| shaft_plane_dev | deg | – | backswing9, top, downswing9 | voll, pitch | Schaft flach/steil zur neutralen Linie (US-1.1, Swing-Score) |
| body_motion | pct_torso | swing | swing | putt, chip | Körperbewegung beim Putt/Chip |
| putter_wrist_change | deg | swing | swing | putt | Handgelenke brechen beim Putt (braucht Schläger; ohne → Unterarm-Hand-Winkel) |

Regeln:
- Jeder Wert bekommt `confidence` 0..1 (Sichtbarkeit der beteiligten Punkte, Perspektive, Schlägerquelle image/hands, fps).
  Schläger aus der Handschätzung → confidence ≤ 0.4; Fehlerregeln verlangen standardmäßig ≥ 0.5 → solche Werte erscheinen als „nicht sicher erkennbar“.
- Werte, die in einer Perspektive nicht sinnvoll sind, werden dort **nicht** berechnet (lieber fehlen als falsch).
- Neue MetricIds nur additiv in types.ts + diese Tabelle (im Bericht melden).
