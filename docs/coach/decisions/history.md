# Entscheidungen – history-i18n-offline (Pakete F + G + Offline)

Format: Nummer · Entscheidung · Begründung. Stand 13.10.2026.

## Speicher (F)

- **H1 IndexedDB ohne Bibliothek** (`src/coach/storage/idb.ts`). Datenbank `golfos-coach`, Version 1:
  `swings` (Index shotType, createdAt, sessionId), `videos` (eigener Schlüssel), `sessions` (Index createdAt), `targets`,
  `progress` (Index faultId, ts, swingId), `settings` (eine Zeile). Upgrades: in `upgrade()` einen neuen Block
  `if (oldVersion < N)` anhängen, alte Blöcke nie ändern – so behalten Spieler mit alten Daten ihre Schwünge.
  Grund: keine neue Laufzeit-Abhängigkeit, Ben kann das 1:1 lesen.
- **H2 Videos als Blob, Notlösung ArrayBuffer + MIME-Typ.** Ältere iOS-Safari-Versionen (≤ 13) warfen beim Speichern
  von Blobs `DataCloneError` oder lieferten leere Blobs zurück. Der erste Video-Schreibvorgang wird deshalb einmal
  zurückgelesen (Größe + erste Bytes); schlägt das fehl, speichert der Store ab dann Bytes. `QuotaExceededError` (Speicher voll)
  löst den Wechsel nicht aus, sondern geht an `persistSwing`, das die Analyse ohne Video behält.
- **H3 Rückfall auf Arbeitsspeicher.** `getStore()` versucht IndexedDB (mit 4 s Timeout, weil manche iOS-Versionen beim ersten
  `open` nie antworten, plus Probe-Lesezugriff, weil manche private Modi zwar öffnen, aber jede Transaktion scheitern lassen).
  Sonst `MemoryStore`. `store.kind === 'memory'` → Hinweis „wird nicht gespeichert“ in Verlauf, Einstellungen und als Toast.
- **H4 Löschen kaskadiert** in einer Transaktion: Schwung + Video + Fortschrittszeilen (Index `swingId`). Callback-Stil statt
  `await` innerhalb der Transaktion, weil ältere Safaris Transaktionen sonst vorzeitig schließen.
- **H5 Fortschrittszeilen mit `put`** (id = `swingId:faultId`): wird ein Schwung neu analysiert, ersetzt er seine Zeilen statt
  sie zu verdoppeln. MemoryStore verhält sich gleich.
- **H6 Additive Store-Erweiterung:** `clearAll?(): Promise<void>` (optional, damit fremde Test-Stores weiter kompilieren).
  Dazu neue Module `storage/device.ts` (persist/estimate/standalone), `storage/settings.ts` (gemeinsamer Einstellungs-Zustand
  mit `useSettings()`, `loadSettings()`, `updateSettings(patch)` – speichert sofort).
- **H7 Startsprache = Handysprache.** `defaultSettings()` setzt `lang` aus `navigator.language`; eine gespeicherte Wahl gewinnt.
  App.tsx setzt die Handysprache synchron vor dem ersten Rendern (kein englisches Aufblitzen auf deutschen Handys).
- **H8 Persistenter Speicher.** `navigator.storage.persist()` wird nach dem ersten gespeicherten Schwung einmal still angefragt
  (Safari fragt den Nutzer nicht) und in den Einstellungen mit Begründung als Knopf angeboten. Warum: Safari darf
  Website-Daten bei Platzmangel oder nach längerer Nichtnutzung löschen; Home-Bildschirm-Apps sind besser geschützt.
  Speicherbelegung über `navigator.storage.estimate()`.

## Fortschritt / „Elo“ (F)

- **H9 Zeitreihe je Fehler** (`storage/progress.ts`): `faultSeries` (erkannt/Stärke je Schwung, gleitende Quote über die letzten N),
  `faultProgress` (letzte 10 vs. die 10 davor, Trend), `progressOverview` (alle jemals erkannten Fehler, häufigste zuerst).
  Nicht prüfbare Fehler erzeugen keine Zeile – „unbekannt“ zählt nie als „behoben“.
- **H10 Trend-Schwellen (Statistik, nicht Golf):** Fenster 10 Schwünge, mindestens 3 je Fenster, Änderung ≥ 0,2 (2 von 10)
  = „wird besser“/„taucht öfter auf“, sonst „etwa gleich“. Bei 10 Schwüngen ist 1 Schwung Unterschied Rauschen.
- **H11 Idee für die persönliche Entwicklungskurve („Elo“) – bewusst NICHT gebaut, nur die Rohdaten:**
  Jeder geprüfte Schwung ist ein „Match“ Spieler gegen Fehler. Spieler-Rating R_s je Fehler, Fehler-Rating R_f (Schwierigkeit,
  z. B. aus `importance` und Schlagart). Erwartung E = 1 / (1 + 10^((R_f − R_s)/400)). Ergebnis S = 1 wenn der Fehler nicht
  auftrat, sonst 1 − severity (ein knapper Fehler ist ein „halber Sieg“). Update R_s += K · confidence · (S − E), K ≈ 32 am
  Anfang, später 16. Gewichtung mit `confidence`, damit unsichere Messungen die Kurve kaum bewegen.
  Gesamt-Rating = gewichteter Mittelwert über die Fehler (Gewicht `importance`). Alles nötige steht in `FaultProgressRecord`
  (faultId, ts, shotType, view, detected, severity, confidence) – die Kurve kann jederzeit rückwirkend aus der Historie
  berechnet werden. Offene Punkte: K-Faktor, Startwert je Fehler, ob Schlagarten getrennte Ratings bekommen.

## Oberfläche

- **H12 Verlauf** gruppiert bei „Alle“ nach Schlagart (je 4 Schwünge, „Alle n zeigen“ setzt den Filter); mit Filter flache Liste.
  „Auswählen“-Modus für Vergleichen (genau 2) und Löschen (mit Bestätigung). Tippen öffnet die Analyse. Reiter „Fortschritt“:
  Balken je Schwung (rot ✕ = Fehler gesehen, Höhe = Stärke; grün ✓ = nicht gesehen) + Satz „vorher 6 von 10 → 3 von den
  letzten 10“; Details (Legende, „Das üben“) erst auf Tippen.
- **H13 Vergleich**: A = älterer Schwung. Beide Player werden über eine gemeinsame Position gesteuert: Knöpfe der gemeinsamen
  Schlüsselpositionen + Regler, der stückweise linear zwischen den jeweils eigenen Schlüssel-Frames interpoliert (unterschiedliches
  Tempo bleibt synchron). Tabelle: Score, Hauptfehler, alle Werte an der Position (Confidence ≥ 0,5) und Werte des ganzen Schwungs.
  Verschiedene Kameraansichten → Warnhinweis.
- **H14 Ungefähre Zentimeter:** Rumpflänge ≈ 0,29 × Körpergröße (Schulterhöhe ≈ 0,82 H, Hüftgelenk ≈ 0,53 H).
  `REVIEW(golf)`: grober Erwachsenen-Durchschnitt, nur Anzeige.
- **H15 Handicap:** Plus-Handicaps werden negativ gespeichert (+2,3 → −2,3), passend zu `levelFromHandicap`. Weil die
  Dezimaltastatur des iPhones kein „+“ hat, gibt es einen eigenen Schalter „Plus-Handicap“. Erlaubt 0–54 bzw. +0 bis +10.
- **H16 Score-Stufe** „Auto“ (aus Handicap) oder 1–5; Bereiche und Faktoren kommen aus `faults/score.json`, nicht doppelt gepflegt.
  Erklärung im Klartext: Stufe erweitert nur Toleranzen, Ziele bleiben gleich.
- **H17 Toleranz-Skala** 0,5–2,0× in 0,1-Schritten (Regler), Ton an/aus als Schalter, Größe mit −/+ (Handschuh-tauglich).

## i18n (G)

- **H18 Vollständigkeits-Tests** (`i18n.test.ts`): gleiche Namespace-Dateien in en/de, jeder Schlüssel in beiden Sprachen,
  identische Platzhalter, keine leeren Texte, alle `{en, de}`-Texte in Katalog-JSONs vollständig, und jeder im Code
  wörtlich verwendete Schlüssel `t('ns.key')` existiert. Prüft automatisch jeden Namespace, der dazukommt.
- **H19** Neue Schlüssel in `common`: `shotType`, `viewShort.*` (kurz „Von vorne/Von hinten“ für Listen), `home.latest…`,
  `offline.*`. Bestehende Texte nicht geändert.

## Offline / PWA

- **H20 `registerType: 'prompt'` statt `autoUpdate`.** Ein automatisches Neuladen könnte mitten in einer Aufnahme oder
  Ball-Serie passieren. Stattdessen Toast „Eine neue Version ist da – Neu laden“; außerdem einmalig „Bereit für offline“,
  sobald alles gecacht ist. Beim Zurückkehren in den Vordergrund prüft die App auf Updates (Home-Bildschirm-Apps werden selten neu geladen).
- **H21 Precache geprüft (Build 13.10.):** 17 Einträge, **28 681 KiB ≈ 29,4 MB** (nach Merge von club + training): `mediapipe/vision_wasm_internal.wasm` (13,0 MB),
  `vision_wasm_internal.js`, `models/pose_landmarker_full.task` (9,4 MB), `pose_landmarker_lite.task` (5,8 MB), App-JS/CSS,
  Schriften (woff2), Icons, Manifest. Größte Einzeldatei 13 MB < Limit 16 MB. Doppelte Icon-Einträge entfernt
  (`includeManifestIcons: false`, `includeAssets` weg – die Glob-Muster erfassen sie schon).
- **H22 Name aus `APP_NAME`:** Manifest-Name, `<title>` und `apple-mobile-web-app-title` kommen aus `constants.ts`
  (`%APP_TITLE%` in index.html wird beim Build ersetzt). Version aus package.json als `__APP_VERSION__` (build.d.ts additiv).

## Offline auf dem iPhone prüfen (für den Morgenbericht)

1. iPhone online, Safari: die HTTPS-Adresse der App öffnen (GitHub Pages, siehe S4). Warten, bis unten
   „✓ Bereit für offline“ erscheint (lädt ~29 MB – im WLAN machen).
2. Teilen ↑ → „Zum Home-Bildschirm“. App vom Home-Bildschirm einmal öffnen (eigener Speicher für Home-Bildschirm-Apps –
   der Cache aus Schritt 1 gilt dort ggf. nicht; dann erneut auf den Hinweis „Bereit für offline“ warten).
3. In der App: Einstellungen → „Deine Daten“ → sollte „✓ Schwünge werden auf diesem Handy gespeichert“ zeigen; „Meine Schwünge schützen“ tippen.
4. Flugmodus an (WLAN auch aus). App komplett schließen (App-Umschalter hochwischen) und vom Home-Bildschirm neu starten.
5. Erwartung: App startet, Schriften stimmen, „Schwung analysieren“ → Kamera → Körpererkennung läuft (Skelett erscheint),
   Analyse fertig, Schwung erscheint unter „Meine Schwünge“. Neustart im Flugmodus: Schwung ist noch da.
6. Fehlerbild: weißer Bildschirm oder „Safari kann die Seite nicht öffnen“ → Service Worker nicht installiert (Schritt 1/2
   wiederholen). Skelett erscheint nicht → MediaPipe-WASM/Modell fehlt im Cache (am Mac: Safari → Entwickler → iPhone →
   Web-Inspektor → Speicher → Cache Storage prüfen, ob `workbox-precache…` die `.wasm`/`.task` enthält).
