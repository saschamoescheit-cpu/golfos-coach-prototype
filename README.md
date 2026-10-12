# GolfOS Coach – Prototyp

Prototyp des Moduls **Coach** (Schwunganalyse mit Korrektur und Training). Ideengebung für die Produktentwicklung.
Läuft als PWA im Safari auf dem iPhone, offline, ohne Server. Pose-Erkennung mit MediaPipe auf dem Gerät.

- `npm install && npm run assets` – Abhängigkeiten, MediaPipe-Runtime und Modelle nach `public/`
- `npm run dev` – Entwicklungsserver
- `npm test` – Unit-Tests (Node, synthetische Schwünge)
- `npm run build` – Produktionsbuild nach `dist/`

Plan und Entscheidungen: `docs/coach/`.
