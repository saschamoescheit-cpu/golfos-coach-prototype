# Fachfragen – Agent „capture-pose"

Für Sascha / Chris (Golf) und Ben (Technik). Stand 13.10.2026.

## Golf (Chris)
1. **Vor- und Nachlauf der Aufnahme** (US-1.0 „[X] Sekunden"): jetzt 1,2 s vor dem Rückschwung und 0,8 s nach dem Finish. Passt das?
2. **Ruhiges Ansprechen:** Die App erkennt „bereit", wenn die Hände 0,5 s ruhig sind. Wie lange steht ein typischer Amateur vor dem Rückschwung wirklich still (nach dem Waggle)? Unter 1 s Stillstand werten wir den Schwung aktuell als Probeschwung.
3. **Probeschwünge:** Macht der typische Spieler den Probeschwung neben dem Ball ohne echtes Ansprechen, oder auch mit vollem Ansprechen? Im zweiten Fall können wir ihn ohne Ballerkennung nicht unterscheiden. Reicht „überspringen, aber mit Knopf ‚trotzdem analysieren'"?
4. **Mindest-Ausholbewegung je Schlagart** (darunter = Waggle/Probeschwung): Putt 0,15 / Chip 0,3 / Pitch 0,6 / voller Schwung 1,2 Rumpflängen Handweg. Plausibel? Gibt es sehr kurze Putts (< 30 cm Rückschwung), die wir damit verlieren?
5. **Tempo-Regel:** Wir verlangen, dass der Abschwung schneller ist als der Rückschwung (sonst „Probe-Bewegung"). Gibt es Spieler oder Schläge (z. B. sehr kurze Chips, Bunker), bei denen das nicht gilt?
6. **Fußbewegung:** Ab 30 % Rumpflänge Fußbewegung melden wir „Kamera bewegt". Ist ein Schritt im Finish (Driver) bei manchen Spielern normal?

## Technik (Ben)
7. **Frontkamera-Bildrate:** Der Trigger kommt mit 15 fps aus, die Analyse profitiert von 60 fps. Liefert die iPhone-Frontkamera in Safari 60 fps bei 1080p, und wie viele Bilder schafft MediaPipe lite parallel zur Aufnahme?
8. **Zeitlupen-Upload:** Was liefert iOS bei `<input type=file>` für ein Slo-Mo-Video – Original mit 240-fps-Zeitstempeln oder einen 30-fps-Export? (Die App kann beides, fragt im zweiten Fall nach.)
9. **MediaPipe-3D-Tiefe (DTL):** Der Trigger nutzt DTL die Weltkoordinaten. Wie stark rauschen sie auf echten Videos? Bei Putts DTL ist das der kritische Punkt.
10. **Native App:** In Bens App wäre die Aufnahme mit AVFoundation + Vision/MediaPipe nativ deutlich robuster (echte 120/240 fps, Hardware-Encoder). Der Zustandsautomat `SwingTrigger` ist reine Logik und lässt sich 1:1 übertragen.
