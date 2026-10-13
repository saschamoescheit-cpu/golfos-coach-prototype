# Entscheidungen – Arbeitspaket C2 (Agent „club“): Schläger / Schaft

Stand 13.10.2026. Code: `src/coach/club/*`. Alle Golf- und Tuning-Schwellen tragen `REVIEW(golf)`.

## Was gebaut ist

| Datei | Inhalt |
|---|---|
| `shaft.ts` | `ImageShaftProvider` / `detectShaft()` – findet den Schaft als Linie im Graubild neben den Händen (Entscheidung S2) |
| `hands.ts` | `HandClubProvider` – Schätzung aus Handgelenken/Unterarm (Fallback), `CLUB_TORSO_RATIO`, `bodyFrame()` |
| `track.ts` | `trackClub()` – pro Frame Bild zuerst, sonst Hände; Ausreißer, Lücken, Glättung, neutrale Linie; `findAddressStill()` |
| `lines.ts` | Helfer für Metriken/UI (auch über `track.ts` re-exportiert) |
| `image.ts` | `mirrorGray`, `rgbaToGray`, **neu** `grayFrameFrom(video, w, h)` (Browser: Videobild → 360-px-Graubild) |
| `testutil.ts` | Testhelfer (Störlinien, Bewegungsunschärfe) – nicht in der App verwendet |

## Konventionen (verbindlich für Metriken/UI)

- **C1 – `grip` = Griffende** (Butt-End, knapp oberhalb der Führhand), `head` = sichtbares Schaftende Richtung Schlägerkopf,
  `angleDeg` = Richtung grip → head im Pixelraum (0° = rechts, 90° = unten). Kanonisches Bild (Linkshänder gespiegelt).
- **C2 – Quelle und Vertrauen.** `source: 'image'` = im Bild gefunden (Vertrauen bis 0,95). `source: 'hands'` = geschätzt, Vertrauen
  **≤ 0,4** (`HANDS_MAX_CONFIDENCE`). **Gemessen** gilt ein Wert nur mit `isMeasuredClub(c)`: Quelle ≠ hands und Vertrauen ≥ 0,45
  (`CLUB_MEASURED_MIN`). Hand-Werte dürfen nie in Fehler/Score einfließen, nur als „geschätzt“ angezeigt werden.
- **C3 – Interpolierte Frames** (kurze Lücke ≤ 70 ms zwischen zwei sicheren Bild-Treffern, ≤ 120° Drehung) bekommen `source: 'image'`
  mit reduziertem Vertrauen (min(Nachbarn) × (1 − 0,08 × Lückenlänge)). Begründung: der Wert ist aus Bildmessungen abgeleitet;
  längere Lücken behalten die Hand-Schätzung.
- **C4 – Neutrale Linie** = Median-Schaft der ruhigen Ansprechphase, verlängert über die Hände hinaus: `a` = Schlägerkopf (Ball),
  `b` = eine Schlägerlänge über das Griffende hinaus. **Nur aus Bild-Treffern**; ohne Bild → `null` (keine Linie aus Hand-Schätzung).
  `ClubTrack` liefert zusätzlich `addressFrames`, `neutralConfidence`, `imageRatio` (für Qualitätshinweis `club_not_found`).
- **C5 – Ansprechphase** wird aus der Handgeschwindigkeit gefunden (Phasen kommen erst nach dem Schläger): letzte Ruhephase
  (< 0,35 Torso/s, ≥ 150 ms, Hände im unteren 40-%-Bereich ihrer Höhe) vor der schnellsten Handbewegung; Ende = Hände verlassen
  einen Kreis von 0,05 Torso um ihre Ansprechposition; Fenster = letzte 0,5 s. Geschwindigkeit über ±50 ms gemittelt (Landmarken-Rauschen).
  Down-the-line bewegen sich die Hände in den ersten ~0,15 s des Rückschwungs fast nur Richtung Kamera – das Ende wird dort bis zu
  ~9 Frames (60 fps) zu spät erkannt; unkritisch, der Schaft liegt in dieser Zeit noch auf der Linie.
- **C6 – Vorzeichen Schaft vs. neutrale Linie** (`shaftVsNeutralDeg`, DTL, kanonisch): Betrag = Winkel zwischen den Linien;
  **+ = steil** = Schlägerkopf rechts/oberhalb der Linie, **− = flach** = links/unterhalb. Das Vorzeichen hängt davon ab, auf welcher
  Seite der Hände der Kopf liegt (früher Rückschwung: untere Hälfte der Linie; P6/Top: obere Hälfte) – eine reine Drehrichtung der
  Linie würde zwischen den Hälften das Vorzeichen wechseln. Gegen den Synth-Parameter `shaftPlaneDev*` (+ = Kopf außen = steil) geprüft.
- **C7 – Weitere Helfer:** `lineFromPoints`, `clubLine`, `lineAngleDeg`, `undirectedDiff`, `angleVsNeutralDeg`, `shaftToHorizontalDeg`
  (0 = 9 Uhr), `extendLine`, `mirrorAngle`/`mirrorClub`/`mirrorLine` (Anzeige auf dem Originalvideo), `clubFromPoints` (auch für manuell
  gesetzte Schäfte, `source: 'manual'`).
- **C8 – Vertrag additiv:** `ClubFrameInput.predictedAngleDeg?` (Tracker-Vorhersage aus den letzten zwei Frames, weicher Prior).

## Bild-Detektor (ImageShaftProvider)

1. Körpermaß aus Landmarken: Handmitte (Mitte der Handgelenke), Torsolänge; erwartete Schlägerlänge = `CLUB_TORSO_RATIO` × Torso
   (Driver 2,1 · Eisen 1,8 · Wedges 1,7 · Putter 1,65; face-on × 1,25, weil der Torso dort durch die Vorneigung kürzer erscheint) –
   nur **Obergrenze**, der Schaft ist oft verkürzt.
2. **Grat-Karten** für beide Polaritäten (dunkler Schaft vor hellem Himmel/Wand, heller Schaft vor dunklem Gras/Schatten):
   min(Seite A, Seite B) − Mitte über 4 Richtungen, 3 px Abstand bei 360 px. Stufenkanten (Arm, Bein, Wand) liefern 0 – nur dünne
   Linien antworten. 3×3 dilatiert, damit Strahlen 1 px daneben liegen dürfen.
3. **Körpermaske:** Grate in Kapseln um Unterarme und Beine × 0,35 (Hemdfalten, Spalt zwischen den Armen, Hosenfalte).
4. **Liniensuche** durch einen Punkt nahe der Hände (Querversatz ±0,08 Torso, weil das Handgelenk nicht auf dem Schaft liegt), 1,5°-Raster.
   Länge = maximale Präfixsumme der Treffer (Treffer +1, Fehlstelle −0,5) von den Händen nach außen. Strafen: Belege **auf der
   Gegenseite** der Hände (ein Schaft endet an den Händen, Horizont/Türrahmen nicht; über ±3° und alle Versätze), Belege weit über die
   Schlägerlänge hinaus. Richtungen zum Ellbogen (±30°) sind ausgeschlossen.
5. Weiche Prioren: Winkel des Vorframes (σ 45°) und Vorhersage des Trackers (σ 30°), jeweils höchstens −30 %.
6. Verfeinerung auf dem Rohbild (bilinear, zwei Stufen bis 0,2°/0,25 px); bei kurzen sichtbaren Stücken weiterer Suchbereich (±10°).
7. Vertrauen = Abdeckung der erwarteten (im Bild liegenden) Länge × Kontrast × Eindeutigkeit (zweitbeste Linie ≥ 12° entfernt).
   Unter 0,15 → `null`; `trackClub` verwirft Bild-Treffer unter 0,25.

Laufzeit (Node, 203×360): ~6 ms/Frame → 170 Frames ≈ 1–1,5 s inkl. Tracking. Auf dem iPhone grob ×1,5–2 erwartet.

## Synthetische Ergebnisse (Vitest, `shaft.test.ts`, `track.test.ts`)

- Saubere Frames (Schaft ≥ 60 % im Bild, nicht zur Kamera zeigend): max. Fehler 2,2° face-on, 0,3° DTL; keine Aussetzer.
- Jeder Wert mit Vertrauen ≥ 0,45 – auch wenn der Schaft das Bild verlässt: max. 2,5°.
- Helle Schäfte, Rauschen ±25 bei Kontrast 70, Bewegungsunschärfe 4 px, Lücke im Schaft, Beine als Stufenkanten, Alignment-Stick am
  Boden, dunkle Linie entlang des Unterarms, horizontale Linie quer durch die Hände: p90 ≤ 1,3°.
- Ohne Schaft im Bild: Vertrauen 0 (→ Hände). Ohne Bilder: nur `hands`, Vertrauen ≤ 0,4, keine neutrale Linie.
- Ganzer Schwung (60 fps, Rechts- und Linkshänder, DTL und face-on): Median 0,1°, p95 ≤ 0,7°; neutrale Linie ≤ 0,2° Abweichung.
- Plane-Abweichung ±15° (Synth): Vorzeichen stimmt, Messwert ≤ 1,8° neben der Wahrheit.
- **Achtung:** Die Hand-Schätzung wirkt im Synth zu gut (Median ~5°, ganze Spur ~1°), weil dort beide Handgelenke exakt auf dem Schaft
  liegen. Auf echten Videos ist mit 10–30° Fehler zu rechnen – deshalb Vertrauen ≤ 0,4.

## Grenzen auf echten Videos (ehrlich)

- **Bewegungsunschärfe:** Im Abschwung bewegt sich die Schaftmitte mit 10–20 m/s. Bei 30 fps und Innenlicht (Belichtung ~1/60 s) wird
  der Schaft zu einem breiten, blassen Fächer – der Grat-Detektor findet ihn dann nicht. Bei 60 fps und Tageslicht (iPhone belichtet
  draußen oft 1/500 s und kürzer) bleibt er meist eine Linie. Folge: in Abschwung/Treffmoment häufiger Lücken → Interpolation oder
  Hand-Schätzung (nicht gemessen). Rückschwung, Top und Ansprechen sind langsam und gut messbar.
- **Verkürzung DTL:** Bei 9 Uhr (P2/P6) zeigt der Schaft parallel zur Ziellinie, also fast in die Kamera – im Bild nur ein kurzes
  Stück. Genau dort misst `shaft_plane_dev`. Der Detektor liefert dann niedriges Vertrauen; Messung eher etwas vor/nach P2/P6 oder am
  Top. Im Synth (Orthografie) ist der Schaft dort fast ein Punkt; echte Perspektive hilft etwas.
- **Bildrand:** Hochkant-Video, face-on bei 9 Uhr ragt der Schaft oft aus dem Bild → kurzes Stück, Vertrauen < 0,45.
- **Störer:** Netze der Driving Range (viele dünne Linien!), Abschlagmatten-Kanten, Alignment-Sticks, Nachbarboxen, Fahnenstangen,
  Türrahmen, Horizont. Die Gegenseiten-Strafe und die Bindung an die Hände helfen, ein Netz direkt hinter den Händen kann aber gewinnen.
- **Geringer Kontrast / Polaritätswechsel:** schwarzer Graphitschaft vor dunklen Bäumen; Schaft, der vor Himmel dunkel und vor Gras
  hell ist – pro Linie wird nur eine Polarität ausgewertet.
- **Handgelenk-Landmarken:** DTL ist das Führ-Handgelenk oft verdeckt; MediaPipe springt dann. Der Querversatz (±0,08 Torso) fängt
  kleine Fehler ab, große nicht.
- **Kein Schlägerkopf-Detektor:** `head` ist das Ende der sichtbaren Linie, nicht sicher der Kopf (Unschärfe, Bildrand).
- **Wer liefert die Bilder?** `analyzeSequence` nimmt `images` an, die Upload-/Aufnahme-Pipeline muss sie mit `grayFrameFrom()` pro
  analysiertem Frame erzeugen (offen, nicht Teil von C2). Live-Modus: ohne Bilder → Hand-Schätzung.

## Ticket (Vorschlag für Ben): trainierter Schläger-Detektor

**Ziel:** `ClubProvider` mit `id: 'model'`, der Griffende, Schaftlinie und Schlägerkopf direkt aus dem Bild schätzt und den heuristischen
`ImageShaftProvider` ersetzt oder ergänzt. Analyse-Code bleibt unverändert (`trackClub` nimmt jeden `ClubProvider`, Option `imageProvider`).

**Umfang**
1. Datensatz: 3–5 k Frames aus eigenen Videos (iPhone, hochkant, 30/60 fps), beide Ansichten, Driver/Eisen/Wedge/Putter, Range und
   Platz, Rechts- und Linkshänder, mit Bewegungsunschärfe. Labels: Griffende, Schlägerkopf (Mitte Hosel/Kopf), Sichtbarkeit je Punkt.
   Die synthetischen Frames (`synthGrayFrame`) taugen nur für Smoke-Tests.
2. Modell: kleines Keypoint-Netz (z. B. YOLO-Pose-n / RTMPose-t, 2 Punkte) oder Linien-Segmentierung; Eingabe 256–320 px, Crop um die
   Hände aus den MediaPipe-Landmarken; Augmentierung: Unschärfe entlang der Bewegungsrichtung, Helligkeit, Spiegelung.
3. Laufzeit offline im Safari (TF.js WebGL/WebGPU, ONNX Runtime Web oder MediaPipe Custom Task), < 30 ms/Frame auf iPhone 12,
   Modell < 10 MB, im Service Worker gecacht.
4. Ausgabe als `ClubEstimate` mit kalibriertem Vertrauen (`source: 'image'`), `null` bei unsichtbarem Schaft. Hand-Fallback bleibt.

**Akzeptanz**
- Winkelfehler ≤ 3° in 90 % der Frames an Ansprechen, P2, Top, P6 (gelabeltes Test-Set, getrennt nach Ansicht).
- Kopfposition ≤ 5 % der Körpergröße in 85 % der Frames mit sichtbarem Kopf.
- Vertrauen kalibriert: Werte ≥ 0,45 haben ≤ 5° Fehler in 95 % der Fälle.
- Bestehende Tests in `src/coach/club` grün; `trackClub` mit `{ imageProvider: new ModelClubProvider() }` liefert auf dem Test-Set
  bessere Abdeckung (`imageRatio`) als der heuristische Detektor.
