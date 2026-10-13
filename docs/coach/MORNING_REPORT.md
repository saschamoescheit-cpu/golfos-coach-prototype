# Morgenbericht – Modul „Coach“

Stand 13.10.2026. Branch `feature/coach-module` im lokalen Repo `C:\Users\SMoescheit\GolfOS\coach-prototype`.
**Nichts ist veröffentlicht oder gepusht.** Für dich zum Lesen geschrieben, Sascha; Details stehen in den verlinkten Dateien.

## Kurzfassung

- Das Modul ist **funktionsfähig gebaut**, mit allen Paketen A–H. Aufnahme (live mit automatischer Aufnahme oder per Upload) → Analyse → max. 3 Fehler mit Wirkung, Korrektur und Drills → Training (Spiegel-Modus und Ball-Serie mit Tönen) → Verlauf und Fortschritt. Englisch und Deutsch, offline.
- **Alle Tests sind grün**, Typprüfung und Build sauber. Ein unabhängiger Review-Agent hat gegen deinen Auftrag geprüft: **0 kritische, 7 wichtige, 10 kleine Befunde**. Die wichtigen werden gerade behoben (Stand siehe unten).
- **Ehrlich wichtig:** Kalibriert ist bisher **nur an künstlichen Schwüngen**. Ob die Grenzwerte und vor allem die Schaft-Erkennung auf echten Videos stimmen, zeigt erst der Test mit echten Aufnahmen. Dafür brauche ich deine Testvideos (siehe „Nächste Schritte“).

| Kennzahl | Wert |
|---|---|
| Commits auf dem Branch | 68 (klein, englische Messages) |
| Code / Tests | ca. 12.700 Zeilen Code, 3.600 Zeilen Tests |
| Tests | 408+ grün (32 Testdateien), Stand vor den Review-Fixes |
| Fehlerkatalog | 32 Fehlerbilder, 41 Regeln, 35 Drill-Entwürfe, 26 Fehlschläge für die Rückwärts-Diagnose, 8 Trainings-Vorlagen |
| Offline-Paket | ca. 28 MB (App, MediaPipe-Laufzeit, 2 Körpermodelle) – einmal im WLAN laden |

## Stand je Arbeitspaket

| Paket | Stand | Was es kann | Offen |
|---|---|---|---|
| **A** Gerüst & Datenmodell | ✅ fertig | PWA (installierbar, Service Worker, Manifest), Datenmodell aller Typen, Schnittstellen `PoseProvider` und `ClubProvider`, Name nur als Konstante `APP_NAME` | – |
| **B** Aufnahme | ✅ fertig | Schlagart, Perspektive und Spielhand vorher wählen; Kamera-Hinweise mit Silhouette; Warnungen (niemand im Bild, mehrere Personen, abgeschnitten, zu weit weg, Handy schief); **automatische Aufnahme ohne Knopf**; Upload, auch Zeitlupe | Probeschwünge nur aus der Bewegung geschätzt (ohne Ballerkennung) |
| **C** Analyse | ✅ fertig | Pose je Bild, Glättung ohne Zeitversatz, 6 Schlüsselpositionen nach Chris (inkl. 9 Uhr auf/ab) je Schlagart, alle Messwerte laut Vertrag (`02_METRICS.md`), **Schaft im Bild erkannt** + neutrale Linie, Player mit Skelett, Sprungmarken, Zeitlupe, Einzelbild, Linie per Finger | Kalibrierung an echten Videos |
| **D** Fehler & Korrektur | ✅ fertig (Fixes laufen) | Katalog als JSON, je Fehler EN+DE, Ballwirkung, Ursache, Korrektur, **Wirkung in Spielersprache**, 1–2 Drills; nur in passender Perspektive geprüft; „nicht sicher erkennbar“ bei schlechter Qualität; Top 3 mit Bildmarke; **Swing-Score** nach den Regeln vom 12.10. (5 Stufen, Tour-Wert); **Rückwärts-Diagnose** („Ball geht links“ → Ursachen) | Grenzwerte → Chris; Tempo-Fehler und Linkshänder-Texte werden gerade korrigiert |
| **E** Training | ✅ fertig (Fixes laufen) | Ziel aus Korrektur, eigenem Schwung oder Vorlage; **Spiegel-Modus** (Farbverlauf, Ton beim Erreichen, zweiter Ton nach 2 s Halten); **Ball-Serie** (Ton ca. 0,5 s nach dem Treffmoment, Probeschwünge ignoriert, „4 / 6“, Liste grün/rot); Toleranzen einstellbar | einige Trainingsziele werden gerade angepasst (bestraften den Idealschwung) |
| **F** Verlauf & Fortschritt | ✅ fertig | Speicherung auf dem Gerät (IndexedDB, Notlösung im Speicher), Verlauf je Schlagart, 2 Schwünge synchron nebeneinander, Fortschritt je Fehlerbild („6 von 10 → 3 von 10“), Rohdaten für die spätere Elo-Kurve | Elo selbst nur als Idee beschrieben (bewusst) |
| **G** Mehrsprachigkeit | ✅ fertig | Englisch Basis, Deutsch (du-Form), 9 Namensräume, 453 Schlüssel deckungsgleich, Umschalter in den Einstellungen | – |
| **H** Tests | ✅ fertig | Generator für künstliche Schwünge (3D-Strichmännchen mit Stellschraube je Fehler); Tests für Messwerte, Phasen, Fehlerregeln, Score, Training, Linkshänder | echte Testvideos fehlen |

Unabhängige Prüfung: `docs/coach/REVIEW.md`. Alle Entscheidungen: `docs/coach/DECISIONS.md` und `docs/coach/decisions/*.md`.

## So testest du es auf dem iPhone

### Weg 1 – heute, ohne Veröffentlichung (im WLAN zu Hause)

1. Laptop und iPhone ins **selbe WLAN**.
2. Am Laptop in VS Code ein Terminal öffnen und eingeben:
   `cd C:\Users\SMoescheit\GolfOS\coach-prototype` und dann `npm run dev:https`
3. Im Terminal steht eine Zeile **„Network: https://192.168.…:5173“**. Diese Adresse am iPhone in **Safari** öffnen.
4. Safari warnt „Diese Verbindung ist nicht privat“ (selbst ausgestelltes Zertifikat, nur im Heimnetz). Tippe **„Details einblenden“ → „diese Website besuchen“** und bestätige.
5. **„Schwung analysieren“** → Schlagart, Perspektive und Spielhand wählen → Kamera erlauben → Handy aufs Stativ, Abstand ca. 3–4 m, Kamera auf Hüfthöhe, ganzer Körper plus Schläger über dem Kopf im Bild.
6. Ansprechen und schwingen, das Handy nicht berühren. Die App nimmt automatisch auf und analysiert.
7. Alternativ mit der normalen iPhone-Kamera filmen (gern 60 fps oder Zeitlupe) und in der App **hochladen**.

Grenzen von Weg 1: Er funktioniert nur, solange der Laptop läuft, und **nicht offline**. „Zum Home-Bildschirm“ und der Flugmodus-Test gehen erst mit Weg 2.

### Weg 2 – nach deinem OK: GitHub Pages (wie der Runden-Prototyp)

1. Du gibst mir das OK. Dann lege ich das öffentliche Repo `golfos-coach-prototype` an und stelle den geprüften Stand auf `main`. Interne Konzepte liegen bewusst nicht im Repo.
2. Adresse dann: **https://saschamoescheit-cpu.github.io/golfos-coach-prototype/**
3. Im **WLAN** öffnen (einmalig ca. 28 MB) → Teilen → **„Zum Home-Bildschirm“**.
4. Offline-Test: die App einmal öffnen, dann **Flugmodus an**, App schließen und neu öffnen, ein Video hochladen. Die Analyse muss funktionieren.

### Was du beim Test bitte prüfst (Checkliste)

- [ ] Erkennt die automatische Aufnahme **jeden echten Schwung genau einmal**? Werden Probeschwünge übersprungen?
- [ ] Wie lange dauert die Analyse? (Schätzung 10–40 s je nach iPhone und Cliplänge)
- [ ] Stimmen die Sprungmarken (Top, 9 Uhr, Treffmoment) mit dem Video überein?
- [ ] Liegt die **Schaftlinie** auf dem Schaft, vor allem **von hinten bei 9 Uhr**? (größtes Risiko)
- [ ] Sind die 3 gezeigten Fehler plausibel? Passen Wirkung und Korrektur?
- [ ] Training: Hörst du die Töne? Achtung: Der **Lautlos-Schalter** am iPhone kann sie stummschalten.
- [ ] Putts: Die App stellt automatisch auf „von vorne“ um (von hinten nicht messbar).

## Testergebnis

| Prüfung | Ergebnis |
|---|---|
| Typprüfung `npx tsc -b` | ✅ 0 Fehler |
| Unit-Tests `npm test` | ✅ 408 grün, 0 rot, 0 übersprungen (vor den Review-Fixes) |
| Build `npm run build` | ✅ (Hinweis: ein großes JS-Paket von 672 kB wegen MediaPipe, wird vorab gecacht) |
| Browser-Test (Review-Agent) | ✅ alle Screens in WebKit (iPhone-13-Emulation, EN und DE) und Edge, **0 Fehler in der Konsole**; ohne Kamera freundlicher Hinweis plus Upload; **offline neu geladen und ein Video analysiert**; **keine einzige Anfrage nach außen** |
| Genauigkeit an künstlichen Schwüngen | Schlüsselpositionen meist auf ±1 Bild, Tempo face-on ±3 % (von hinten ±12 %), Schaftwinkel < 3° |
| Auf echtem iPhone / echten Videos | ⏳ **noch nicht geprüft** |

## Grenzwerte zur Prüfung durch dich und Chris – `REVIEW(golf)`

Die **vollständige Liste** (41 Fehlerregeln, Trainingsziele, Score-Kriterien, Vorlagen, jeweils mit Begründung) wird automatisch aus dem Katalog erzeugt:
**`docs/coach/decisions/faults-review-list.md`**. Neu erzeugen mit `node scripts/review-list.mjs`.

Diese Werte zuerst prüfen, sie wirken am stärksten:

| # | Wert | Startwert | Warum wichtig |
|---|---|---|---|
| 1 | Schaft 9 Uhr Abschwung, Toleranz | ±5° (Score) / Fehler ab 5° steil oder flach | 30 % des Swing-Scores, wichtigste Position laut Chris |
| 2 | Tempo Ziel und Toleranz | 3 : 1 ± 0,3 (voll), 2 : 1 ± 0,4 (kurzes Spiel, Putt) | 20 % des Scores; bei 30 fps ist die Messung nur auf ca. ±0,4 genau |
| 3 | Schulterdrehung im Top | Fehler unter 50° Bildwert; Score-Ziel 85° | Bildwert ≠ echter Winkel (echte 90° ≈ 64° im Bild laut Ben) – **Umrechnung offen** |
| 4 | Early Extension | Becken 8 % Rumpflänge (≈ 4 cm) Richtung Ball oder 6° Vorneigung verloren | häufigster Amateurfehler, Wichtigkeit 5 |
| 5 | Over the Top | Hände bei 9 Uhr ab 8 % Rumpf (≈ 4 cm) weiter außen als bei 9 Uhr auf | Wichtigkeit 5 |
| 6 | Kopf-Sway im Top | 25 % Rumpf (≈ 13 cm) weg vom Ziel | am künstlichen Schwung angehoben (vorher 15 %) |
| 7 | Casting | Handgelenkwinkel bei 9 Uhr ab unter 28° | nur von vorne messbar, braucht den Schaft im Bild |
| 8 | Stufenfaktoren Swing-Score | 1,0 / 1,25 / 1,5 / 1,75 / 2,0 | macht den Score für HCP 3 bis HCP 54 fair |
| 9 | Putt: Kopf / Körper / Handgelenk | 4 % / 6 % Rumpf / 22° | Putt-Fehlerbilder |
| 10 | Automatische Aufnahme | 0,5 s ruhig = bereit; unter 1 s Ruhe = Probeschwung | entscheidet über die Zuverlässigkeit auf der Range |

## Getroffene Annahmen (Auswahl)

Mit dir abgestimmt (12.10.): eigener Referenz-Prototyp für Ben; Schaft per Bilderkennung + Finger; beide Trainingsvarianten; GitHub Pages erst nach deinem OK.

Von mir bzw. den Agents entschieden (Details in `DECISIONS.md`):
- **Putts nur von vorne** (L3): Von hinten bewegt sich der Putter fast nur auf die Kamera zu und ist nicht messbar.
- **Schaftebene bei 9 Uhr von hinten** wird am nächsten Bild gemessen, auf dem der Schaft sicher erkannt ist, höchstens ±50 ms entfernt (L5). Grund: Genau bei 9 Uhr zeigt der Schaft fast in die Kamera.
- **Fliegender rechter Ellbogen** ist in 2D nicht messbar und erscheint immer unter „nicht sicher geprüft“ (L4).
- Die per Finger verschobene neutrale Linie wird gespeichert, ist aber **nur eine Markierung**. Messwerte basieren immer auf der KI (Entscheidung vom 06.10.).
- Linkshänder werden intern gespiegelt, damit jede Regel nur einmal existiert. Texte richten sich nach der Spielhand (Fix läuft).
- Drills sind **Entwürfe** im Format „Get the Feel / Make it Real“, bis Chris freigibt.
- App-Update nur auf Tipp („Neue Version – neu laden“), damit nie mitten in einer Aufnahme neu geladen wird.

## Offene Fragen

Gesammelt in `docs/coach/OPEN_QUESTIONS.md` und `docs/coach/questions/*.md`. Die wichtigsten:

**An dich**
1. **GitHub-Pages-Repo anlegen?** Damit sind der Offline-Test und „Zum Home-Bildschirm“ möglich.
2. **Testvideos:** 10–20 echte Schwünge, beide Perspektiven, mehrere Schlagarten, am besten mit Chris' Urteil. Ideal wäre ein Teil der 50–70 bereits beurteilten Amateurschwünge, plus jeweils das **Handicap** des Spielers (für die Stufenfaktoren).
3. **Ball-Serie:** automatisch nach N Bällen enden (Standard 10) oder offen?
4. **Speicher:** Videos brauchen 10–30 MB je Schwung. Sollen alte Videos automatisch gelöscht werden (z. B. nach 30 Tagen, Analyse bleibt)?

**An Chris**
5. Grenzwerte und Wichtigkeit (Liste oben), **Drills** freigeben oder ersetzen, **Wirkungs-Texte** in Spielersprache prüfen.
6. Schulterdrehung: Zielwert auf den Bildwert umrechnen oder anders messen?
7. Pitch/Bunker: eigener Score oder nur volle Schwünge? Lob/Flop als Ausnahme vom „Löffeln“?
8. Probeschwünge: Machen Amateure sie mit vollem Ansprechen? Dann ist die Unterscheidung ohne Ballerkennung nicht möglich.

**An Ben**
9. Liefert die Frontkamera in Safari 60 fps, und was schafft MediaPipe nebenbei? Wie rauschen die 3D-Weltkoordinaten (wichtig für die Aufnahme von hinten)?
10. Ein trainierter Schläger-Detektor (Griff und Schlägerkopf) als echter `ClubProvider`. Ticket-Entwurf mit Abnahmekriterien in `docs/coach/decisions/club.md`.

## Empfohlene nächste Schritte bis zum USA-Test (05.11.2026)

| Wann | Was | Wer |
|---|---|---|
| bis 15.10. | OK für GitHub Pages → Prototyp live; erster Test zu Hause über Weg 1 oder 2 | Sascha, Claude |
| bis 17.10. | **Testvideos** bereitstellen (10–20, mit Urteil und Handicap) | Sascha, Chris |
| 17.–22.10. | **Kalibrierung an echten Videos:** eine Kalibrier-Ansicht, die Messwerte als Tabelle exportiert; Abgleich mit Chris' Urteil; Grenzwerte und Score-Faktoren anpassen; Schaftebene bei 9 Uhr von hinten prüfen | Claude, Chris |
| bis 24.10. | Chris prüft Review-Liste, Drills und Wirkungstexte; offene Fachfragen entscheiden | Chris, Sascha |
| 20.–27.10. | **Range-Tests** von Sascha: Zuverlässigkeit der automatischen Aufnahme, Dauer der Analyse, Töne im Freien, Sonne/Handschuh-Bedienung | Sascha |
| bis 29.10. | Ticket-Entwürfe für Ben (was übernehmen: Fehlerkatalog-JSON, Score, Metrik-Vertrag, Aufnahme-Automat; was nativ besser geht: 120/240 fps, Schläger-Detektor) | Claude, Sascha |
| ab 01.11. | **Stand einfrieren** für den USA-Test, nur noch Fehlerbehebungen; englische Texte gegenlesen | alle |

Puffer-Themen, falls Zeit bleibt: Ballerkennung für sichere Probeschwung-Erkennung; Ghost-Silhouette im Sucher verfeinern; Brücke zur Rundenanalyse (die Rückwärts-Diagnose ist als Schnittstelle schon da).
