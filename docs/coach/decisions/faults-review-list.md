# Review-Liste: alle Schwellen (REVIEW(golf))

Für Sascha und Chris. **Automatisch erzeugt** aus `src/coach/faults/catalog.json`, `score.json` und `training/templates.json` (`node scripts/review-list.mjs`, Stand 2026-10-13).
Alle Messwerte sind 2D-Näherungen aus dem Handyvideo (z. B. echte 90° Schulterdrehung ≈ 64° im Bild). Einheiten: ° = Grad, % Rumpf = Prozent der Rumpflänge (≈ 50 cm → 10 % ≈ 5 cm), ratio = Verhältnis.
„Volle Schwere bei“ = Abstand zur Schwelle, ab dem der Fehler als maximal gilt (für die Priorisierung). Kalibriert bisher nur an synthetischen Schwüngen.

## Fehlerregeln

| Fehler | Schlagarten | Messwert | Position | Ansicht | Schwelle | Volle Schwere bei | Min. Vertrauen | Wichtigkeit | Grundlage |
|---|---|---|---|---|---|---|---|---|---|
| Aufrichten im Abschwung (Early Extension) | driver, iron, pitch | hip_depth_change | impact | DTL | > 8 | ±12 | 0.5 | 5 | hips move ≥ 8 % torso (≈ 4 cm) towards the ball by impact. Sportsbox/TPI treat any forward hip thrust as early extension; 4 cm leaves room for 2D noise. Full severity at 20 % (≈ 10 cm). |
| Aufrichten im Abschwung (Early Extension) | driver, iron, pitch | spine_angle_change | impact | DTL | < -6 | ±9 | 0.5 | 5 | forward bend lost by more than 6° at impact (Swing-Score concept: hold spine angle, T = 5°). Full severity at −15°. |
| Kopf bewegt sich seitlich | driver, iron, pitch, bunker | head_shift_x | top | FO | < -25 | ±15 | 0.5 | 3 | head moving away from the target at the top by more than 25 % of the torso (~13 cm). Calibrated on the synthetic swing (ideal −17 … −19 %, sway knob −33 %, see decisions/phases-metrics.md PM4); some head movement away from the target is normal. Check with real swings. |
| Kopf bewegt sich seitlich | driver, iron, pitch, bunker | head_shift_x | impact | FO | > 10 | ±15 | 0.5 | 3 | head ahead of its address position by > 10 % torso (≈ 5 cm) at impact = upper body gets in front of the ball. Tour heads stay at or behind address at impact. Full at 25 %. |
| Kopf hebt sich vor dem Treffmoment | driver, iron, pitch, chip, bunker | head_shift_y | impact | FO+DTL | > 8 | ±12 | 0.5 | 3 | head ≥ 8 % torso (≈ 4 cm) higher at impact than at address. Source: 'Kopf und Blick heben zu früh ab' (top, thin, whiff). Full at 20 %. |
| Kopf sackt im Abschwung ab | driver, iron, pitch, chip, bunker | head_shift_y | impact | FO+DTL | < -8 | ±12 | 0.5 | 3 | head ≥ 8 % torso (≈ 4 cm) lower at impact than at address. Source: 'Körper sackt im Abschwung ab, Knie beugen sich stärker' and 'Kopf bewegt sich nach unten' (fat, chili dip). Full at 20 %. |
| Hüft-Sway im Rückschwung | driver, iron, pitch, bunker | hip_shift_x | top | FO | < -12 | ±18 | 0.5 | 4 | hip centre slides > 12 % torso (≈ 6 cm) away from the target at the top. Swing-Score concept: sway target 0 cm, T = 4 cm (≈ 8 %); the fault fires at 1.5 T to avoid noise. Full at 30 %. |
| Reverse Pivot (Gewicht falsch herum) | driver, iron | side_bend | top | FO | < -3 | ±12 | 0.5 | 4 | upper body leans towards the target at the top (side_bend is + away from the target per types.ts, so < −3° = leaning towards the target). Source: 'Oberkörper zum Ziel geneigt im Top'. Full at −15°. Sign convention must match metrics.ts (synth uses the opposite sign – see decisions). |
| Reverse Pivot (Gewicht falsch herum) | driver, iron | hip_shift_x | top | FO | > 8 | ±12 | 0.5 | 4 | hips move > 8 % torso (≈ 4 cm) towards the target during the backswing = weight goes to the lead side at the top. Full at 20 %. |
| Gewicht bleibt hinten | driver, iron, bunker | hip_shift_x | impact | FO | < 3 | ±13 | 0.5 | 4 | hip centre less than 3 % torso (≈ 1.5 cm) towards the target at impact. A good weight shift moves the hips ~5–8 cm (≈ 10–15 %) towards the target. Source: 'Gewicht bleibt auf dem rechten Bein' (fat, thin, slice, push). Bunker: same threshold, needs a check by Chris. Full at −10 %. |
| Over the Top (Abschwung von außen) | driver, iron | hand_path_shift | downswing9 | DTL | > 8 | ±17 | 0.5 | 5 | hands are > 8 % torso (≈ 4 cm) further from the body at 9 o'clock down than at 9 o'clock back. Good players drop the hands inside the backswing path (negative value). Source: 'Over the top: Abschwung mit Schultern und Armen eingeleitet'. Full at 25 %. |
| Chicken Wing (linker Ellbogen knickt) | driver, iron, pitch | lead_arm_post_impact | swing | FO | < 150 | ±30 | 0.5 | 3 | lead elbow angle shortly after impact below 150° (180 = straight). In good swings both arms are long after impact (~165–180°); 2D foreshortening costs ~10°. Full at 120°. |
| Zu wenig Schulterdrehung | driver, iron | shoulder_turn | top | FO+DTL | < 50 | ±20 | 0.5 | 3 | 2D proxy – a real 90° shoulder turn reads ~64° in the image (Ben). < 50° image ≈ < 70° real turn. Swing-Score concept: chest turn ≥ 85° real. Full at 30° image (≈ 45° real). |
| Casting (Winkel löst sich zu früh) | driver, iron, pitch | lead_wrist_hinge | downswing9 | FO | < 28 | ±15 | 0.5 | 4 | wrist hinge at 9 o'clock down below 28° = angle released early. Face-on only (from behind forearm and shaft are foreshortened, 2D angle 20–95°). Synthetic: ideal 35–45°, casting 17–22° (PM4). Needs the club found in the image. |
| Hastiger Aufschwung (Tempo zu schnell) | driver, iron, bunker | tempo_ratio | swing | FO+DTL | < 2.4 | ±0.6 | 0.5 | 3 | backswing:downswing below 2.4 : 1. Tour tempo ≈ 3 : 1 (Swing-Score concept, T = 0.3 → 2.4 = edge of yellow/red). Full at 1.8 : 1. |
| Zu langsamer Abschwung (Tempo zu träge) | driver, iron, bunker | tempo_ratio | swing | FO+DTL | > 3.6 | ±0.9 | 0.5 | 2 | backswing:downswing above 3.6 : 1 = downswing relatively slow / decelerating. Tour ≈ 3 : 1, T = 0.3 → 3.6 = edge of yellow/red. Full at 4.5 : 1. |
| 9 Uhr Aufschwung: Schaft flach | driver, iron, pitch | shaft_plane_dev | backswing9 | DTL | < -7 | ±14 | 0.5 | 3 | shaft more than 7° flat (left of the neutral line) at 9 o'clock back. Swing-Score concept T = 7° (placeholder until Chris measures 10–20 reference swings). Full at 3 T = 21°. Hand-estimated club (confidence ≤ 0.4) is never judged. |
| 9 Uhr Aufschwung: Schaft steil | driver, iron, pitch | shaft_plane_dev | backswing9 | DTL | > 7 | ±14 | 0.5 | 3 | shaft more than 7° steep (right of the neutral line) at 9 o'clock back. Swing-Score concept T = 7° (placeholder). Full at 21°. Hand-estimated club is never judged. |
| 9 Uhr Abschwung: Schaft steil | driver, iron, pitch | shaft_plane_dev | downswing9 | DTL | > 5 | ±10 | 0.5 | 5 | shaft more than 5° steep (right of the neutral line) at 9 o'clock down – the most important position (US-1.1). Swing-Score concept T = 5° (placeholder). Full at 15°. Hand-estimated club is never judged. |
| 9 Uhr Abschwung: Schaft flach (stuck) | driver, iron, pitch | shaft_plane_dev | downswing9 | DTL | < -5 | ±10 | 0.5 | 4 | shaft more than 5° flat (left of the neutral line) at 9 o'clock down = club gets stuck behind the body. Swing-Score concept T = 5° (placeholder). Full at 15°. Hand-estimated club is never judged. |
| Gebeugter linker Arm im Top | driver, iron, pitch | lead_arm_angle | top | FO | < 150 | ±30 | 0.5 | 2 | lead elbow angle below 150° at the top (180 = straight). Tour players are ~165–175°; a slight bend is fine, 2D costs some degrees. Full at 120°. Face-on only: from behind the lead arm is foreshortened (pitch read 145° on an ideal swing, PM4). |
| Fliegender rechter Ellbogen | driver, iron | trail_arm_angle | top | DTL | > 120 | ±30 | 1 | 2 | NOT RELIABLY MEASURABLE IN 2D YET – a bent trail arm looks straight from behind (ideal swing reads 157–176°, PM4). minConfidence 1 keeps it in "not checked reliably" until a 3D/elbow-direction metric exists. |
| Ansprechhaltung zu aufrecht | driver, iron, pitch, chip, bunker | spine_angle | address | DTL | < 24 | ±10 | 0.5 | 2 | forward bend below 24° at address. Swing-Score concept: ≈ 30°, T = 5° (Tour ≈ 30°; irons tend to be a bit more bent). Full at 14°. |
| Ansprechhaltung zu aufrecht | driver, iron, pitch, chip, bunker | knee_flex | address | DTL | < 10 | ±8 | 0.5 | 2 | trail knee bent less than 10° from straight at address (typical ≈ 20–25°). Full at 2° (locked). |
| Ansprechhaltung zu gebückt | driver, iron, pitch, chip, bunker | spine_angle | address | DTL | > 46 | ±10 | 0.5 | 2 | forward bend above 46° at address (concept ≈ 30°, T = 5°; irons/wedges more bent, so a wide margin). Full at 56°. |
| Ansprechhaltung zu gebückt | driver, iron, pitch, chip, bunker | knee_flex | address | DTL | > 45 | ±15 | 0.5 | 2 | trail knee bent more than 45° at address – sitting too low (typical ≈ 20–25°). Full at 60°. |
| Flip im Treffmoment (Schaft ohne Vorlage) | iron | shaft_lean | impact | FO | < 0 | ±12 | 0.5 | 4 | shaft leans backwards (handle behind the club head) at impact with an iron. Good iron players have ~5–10° forward lean. Source: 'Scoop/Flip: Hände hinter dem Schlägerkopf'. Needs the club; at 30–60 fps impact is blurred → often uncertain. Full at −12°. |
| Flip im Treffmoment (Schaft ohne Vorlage) | iron | hands_ahead | impact | FO | < -3 | ±10 | 0.5 | 4 | hands more than 3 % torso behind the ball/club head along the target line at impact. Full at −13 %. |
| Chip: Gewicht auf dem hinteren Fuß | chip | hip_shift_x | impact | FO | < -3 | ±9 | 0.5 | 4 | hips more than 3 % torso (≈ 1.5 cm) away from the target at impact. In a chip the weight stays on the lead side (~60–70 %) throughout. Source Chili Dip: 'Gewicht hinten'. Full at −12 %. |
| Chip: Gewicht auf dem hinteren Fuß | chip | hip_shift_x | top | FO | < -6 | ±9 | 0.5 | 4 | hips slide more than 6 % torso (≈ 3 cm) away from the target in the chip backswing. Full at −15 %. |
| Kurzes Spiel: Hände hinter dem Ball (Löffeln) | chip, pitch | hands_ahead | impact | FO | < 0 | ±12 | 0.5 | 4 | hands behind the ball/club head at impact (should be slightly ahead for a standard chip). Source Scoop/Flip and Skull: 'Löffeln'. Full at −12 %. |
| Kurzes Spiel: Hände hinter dem Ball (Löffeln) | chip, pitch | shaft_lean | impact | FO | < -3 | ±10 | 0.5 | 4 | shaft leans backwards by more than 3° at impact. Lob shots with deliberately neutral shaft are not separated yet (open question). Full at −13°. |
| Chip: Rückschwung zu lang | chip | swing_length | top | FO+DTL | > 55 | ±25 | 0.5 | 3 | hands go back more than 55° of arm rotation in a chip (≈ hip high; a standard chip is ~25–45°). Source Chili Dip/Skull: 'Zu langer Rückschwung mit abgebremstem Abschwung'. Only meaningful because a chip is short by definition. Full at 80°. |
| Pitch: Rückschwung zu lang | pitch | swing_length | top | FO+DTL | > 125 | ±25 | 0.5 | 2 | pitch backswing beyond 125° of arm rotation (well past lead arm parallel = a full swing). A pitch is a half to three-quarter swing (~70–110°). Distance intent is unknown, so importance is low. Full at 150°. |
| Kurzes Spiel: unruhiger Rhythmus | pitch, chip | tempo_ratio | swing | FO+DTL | außerhalb 1.4 … 2.8 | ±0.8 | 0.5 | 2 | short-game tempo outside 1.4–2.8 : 1. Target ≈ 2 : 1 (SHOT_TYPES, tolerance 0.4); fires at 1.5–2 T. Above = slow/braking forward swing, below = jabbing. Full 0.8 beyond. |
| Bunker: Rückschwung zu kurz | bunker | swing_length | top | FO+DTL | < 70 | ±30 | 0.5 | 3 | greenside bunker backswing shorter than 70° of arm rotation (lead arm clearly below parallel). The sand needs speed; source Bunker zu fett: 'Zu kurzer Rückschwung – nicht genug Tempo für den Sand'. The entry point in the sand is NOT measurable. Full at 40°. |
| Putt: Kopf bewegt sich | putt | head_shift_x | impact | FO+DTL | |x| > 4 | ±8 | 0.5 | 4 | head moves more than 4 % torso (≈ 2 cm) along the target line between address and impact. Good putters keep the head practically still. Source Putt-Fehler: 'Kopf oder Körper bewegen sich'. Full at 12 %. |
| Putt: Kopf bewegt sich | putt | head_shift_y | impact | FO+DTL | |x| > 4 | ±8 | 0.5 | 4 | head moves more than 4 % torso (≈ 2 cm) up or down during the stroke. Full at 12 %. |
| Putt: Körper bewegt sich | putt | body_motion | swing | FO+DTL | > 6 | ±9 | 0.5 | 3 | shoulder centre moves more than 6 % torso (≈ 3 cm) during the stroke. The putting stroke is a shoulder rock around a still centre. Full at 15 %. |
| Putt: Handgelenke knicken ab | putt | putter_wrist_change | swing | FO+DTL | > 22 | ±15 | 0.5 | 4 | change of the lead forearm–shaft angle during the stroke above 22°. Synthetic putt without wrist action already reads 15–16° (arm rotation in 2D), wrist-break knob 39–40° (PM4). Real calibration needed. |
| Putt: unruhiges Tempo | putt | tempo_ratio | swing | FO+DTL | außerhalb 1.5 … 2.6 | ±0.8 | 0.5 | 3 | putting tempo outside 1.5–2.6 : 1. Commonly taught ≈ 2 : 1 (backstroke twice as long as the forward stroke; SHOT_TYPES putt tolerance 0.4). Below = jab, above = braking. Full 0.8 beyond. |

## Trainingsziele aus Korrekturen

| Fehler | Messwert | Position | Ziel | Toleranz |
|---|---|---|---|---|
| Aufrichten im Abschwung (Early Extension) | hip_depth_change | impact | 0 | ±6 |
| Kopf bewegt sich seitlich | head_shift_x | top | -10 | ±12 |
| Kopf hebt sich vor dem Treffmoment | head_shift_y | impact | 0 | ±5 |
| Kopf sackt im Abschwung ab | head_shift_y | impact | 0 | ±5 |
| Hüft-Sway im Rückschwung | hip_shift_x | top | 0 | ±8 |
| Reverse Pivot (Gewicht falsch herum) | side_bend | top | 5 | ±6 |
| Gewicht bleibt hinten | hip_shift_x | impact | 12 | ±6 |
| Over the Top (Abschwung von außen) | hand_path_shift | downswing9 | 0 | ±6 |
| Chicken Wing (linker Ellbogen knickt) | lead_arm_post_impact | swing | 170 | ±12 |
| Zu wenig Schulterdrehung | shoulder_turn | top | 64 | ±8 |
| Casting (Winkel löst sich zu früh) | lead_wrist_hinge | downswing9 | 40 | ±10 |
| Hastiger Aufschwung (Tempo zu schnell) | tempo_ratio | swing | 3 | ±0.3 |
| Zu langsamer Abschwung (Tempo zu träge) | tempo_ratio | swing | 3 | ±0.3 |
| 9 Uhr Aufschwung: Schaft flach | shaft_plane_dev | backswing9 | 0 | ±7 |
| 9 Uhr Aufschwung: Schaft steil | shaft_plane_dev | backswing9 | 0 | ±7 |
| 9 Uhr Abschwung: Schaft steil | shaft_plane_dev | downswing9 | 0 | ±5 |
| 9 Uhr Abschwung: Schaft flach (stuck) | shaft_plane_dev | downswing9 | 0 | ±5 |
| Gebeugter linker Arm im Top | lead_arm_angle | top | 168 | ±10 |
| Fliegender rechter Ellbogen | trail_arm_angle | top | 90 | ±15 |
| Ansprechhaltung zu aufrecht | spine_angle | address | 30 | ±5 |
| Ansprechhaltung zu gebückt | spine_angle | address | 30 | ±5 |
| Flip im Treffmoment (Schaft ohne Vorlage) | shaft_lean | impact | 6 | ±5 |
| Chip: Gewicht auf dem hinteren Fuß | hip_shift_x | impact | 3 | ±4 |
| Kurzes Spiel: Hände hinter dem Ball (Löffeln) | hands_ahead | impact | 5 | ±5 |
| Chip: Rückschwung zu lang | swing_length | top | 35 | ±12 |
| Pitch: Rückschwung zu lang | swing_length | top | 90 | ±15 |
| Kurzes Spiel: unruhiger Rhythmus | tempo_ratio | swing | 2 | ±0.4 |
| Bunker: Rückschwung zu kurz | swing_length | top | 95 | ±15 |
| Putt: Kopf bewegt sich | head_shift_x | impact | 0 | ±3 |
| Putt: Körper bewegt sich | body_motion | swing | 0 | ±4 |
| Putt: Handgelenke knicken ab | putter_wrist_change | swing | 12 | ±10 |
| Putt: unruhiges Tempo | tempo_ratio | swing | 2 | ±0.4 |

## Swing-Score (Version 1.0)

Toleranz wirksam = T × Stufenfaktor (Stufe 1: ×1, Stufe 2: ×1.25, Stufe 3: ×1.5, Stufe 4: ×1.75, Stufe 5: ×2). Gesamtscore nur bei ≥ 80 % gemessenem Gewicht, nur für driver/iron.

| Teil | Gewicht | Messwert | Position | Art | Ziel | T (Basis) | Messfehler-Boden | Grundlage |
|---|---|---|---|---|---|---|---|---|
| downswing9 | 30 % | shaft_plane_dev | downswing9 | Abweichung | 0 | 5 | 3 | concept T = 5° (placeholder, no public reference values); measurement floor 3° until Chris/Ben have measured. |
| tempo | 20 % | tempo_ratio | swing | Abweichung | shotTypeTempo | 0.3 | tempoFrames | target 3 : 1 from SHOT_TYPES (tour measurements ~21/7 to 27/9 frames), T = 0.3 (green 2.7–3.3). Floor = target × (1000/fps) / downswing_ms (one frame of uncertainty). |
| body | 18 % | shoulder_turn | top | mindestens | 85 | 10 | – | concept chest turn ≥ 85° (tour ~98°), T = 10°. shoulder_turn is a 2D image value (real 90° ≈ 64° in the image per Ben) – the target must be recalibrated to the measuring method of metrics.ts. |
| body | 18 % | hip_shift_x | top | Abweichung | 0 | 8 | – | pelvis sway at the top, concept 0 cm, T = 4 cm ≈ 8 % torso. |
| body | 18 % | spine_angle_change | impact | Abweichung | 0 | 5 | – | hold the forward bend from address to impact, concept change 0°, T = 5°. |
| body | 18 % | hip_turn | impact | Abweichung | -35 | 10 | – | pelvis open at impact, concept 35° (negative = open per score rules 12.10.), T = 10°. 2D proxy – check sign/scale against metrics.ts. |
| top | 14 % | shaft_plane_dev | top | Abweichung | 0 | 10 | 3 | concept T = 10° (placeholder); floor 3°. |
| backswing9 | 10 % | shaft_plane_dev | backswing9 | Abweichung | 0 | 7 | 3 | concept T = 7° (placeholder); floor 3°. |
| setup | 8 % | spine_angle | address | Abweichung | 30 | 5 | – | forward bend at address, concept 30° (tour ~30°), T = 5°. |
| setup | 8 % | side_bend | address | Abweichung | 15 | 5 | – | side bend away from the target at address, concept 15°, T = 5°. types.ts defines side_bend as tilt AWAY from the target, so +15 is correct; the synthetic generator uses the opposite sign (see decisions). |

## Trainings-Vorlagen

| Vorlage | Messwert | Position | Ziel | Toleranz | Grundlage |
|---|---|---|---|---|---|
| Top: linker Arm gestreckt | lead_arm_angle | top | 175 | ±10 | 175° ± 10° = straight or nearly straight (165–185°); synthetic ideal face-on 179° (PM3); catalog bent_lead_arm uses 168 ± 10 |
| Top: volle Schulterdrehung | shoulder_turn | top | 85 | ±15 | 2D image shoulder-turn proxy; synthetic 90° turn measures 88 face-on / 76 DTL (PM3); catalog short_shoulder_turn uses 64 ± 8 as the minimum |
| Top: volle Schulterdrehung | head_shift_x | top | -10 | ±12 | head may drift a little away from the target while turning (synthetic ideal −18 % torso face-on, PM3/PM4); beyond ≈ −22 % = sway |
| 9 Uhr Abschwung: auf der Linie | shaft_plane_dev | downswing9 | 0 | ±5 | shaft on the neutral line ± 5°, same as catalog shaft_steep/flat_downswing9; live without club detection only a rough hand estimate |
| 9 Uhr Aufschwung: auf der Linie | shaft_plane_dev | backswing9 | 0 | ±7 | shaft on the neutral line ± 7°, same as catalog shaft_flat/steep_backswing9 |
| Treffmoment: Haltung behalten | hip_depth_change | impact | 0 | ±6 | hips do not move towards the ball (early extension), catalog early_extension 0 ± 6 % torso |
| Treffmoment: Haltung behalten | spine_angle_change | impact | 0 | ±6 | forward bend kept within ± 6° of address |
| Finish: Gewicht vorne, im Gleichgewicht | hip_shift_x | finish | 20 | ±10 | hips clearly over the lead foot in the finish (~20 % torso towards the target) – guess, no source value |
| Putt: Kopf ruhig | head_shift_x | impact | 0 | ±3 | head within ± 3 % torso (≈ 1.5 cm) of address at impact, same as catalog putt_head_movement |
| Putt: Kopf ruhig | body_motion | swing | 0 | ±4 | body sway during the stroke, catalog putt_body_movement 0 ± 4 – series only |
| Ansprechhaltung | spine_angle | address | 35 | ±7 | forward bend ~30–40° for irons (synthetic iron 38°, driver 32°, PM3); catalog setup_upright/crouched uses 30 ± 5 |
| Ansprechhaltung | knee_flex | address | 25 | ±10 | 'soft knees' ~20–30° flex – guess |

## Weitere Startwerte

- Reverse-Diagnose: persönliche Reihenfolge ab **5** analysierten Schwüngen (US-1.12 „[X]“).
- Fehler werden nur bewertet, wenn die Analysequalität ≥ 0,5 ist und der Messwert ein Vertrauen ≥ 0,5 hat (Schläger aus Handschätzung ≤ 0,4 → nie bewertet).
- Max. 3 Fehler pro Schwung, sortiert nach Schwere × Wichtigkeit × Vertrauen.
- Weitere Werte im Code mit `REVIEW(golf)`: automatische Aufnahme (live/swingTrigger.ts), Qualitätsprüfung (analysis/quality.ts), 9-Uhr-Näherung über die Handhöhe (analysis/phases.ts), Schlägerverfolgung (club/*), Tempo je Schlagart (model/constants.ts).
