// Regenerates docs/coach/decisions/faults-review-list.md from the fault catalog and the score config,
// so the REVIEW(golf) list for Sascha/Chris never goes stale. Run: node scripts/review-list.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync('src/coach/faults/catalog.json', 'utf8'));
const score = JSON.parse(readFileSync('src/coach/faults/score.json', 'utf8'));
const templates = JSON.parse(readFileSync('src/coach/training/templates.json', 'utf8'));

const VIEW = { face_on: 'FO', down_the_line: 'DTL' };
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').replace(/^REVIEW\(golf\):\s*/, '').trim();
const views = (v) => v.map((x) => VIEW[x]).join('+');
const cond = (r) =>
  r.op === 'outside' ? `außerhalb ${r.threshold} … ${r.thresholdHigh}` : r.op === 'abs>' ? `|x| > ${r.threshold}` : `${r.op} ${r.threshold}`;

const out = [];
out.push('# Review-Liste: alle Schwellen (REVIEW(golf))', '');
out.push(
  `Für Sascha und Chris. **Automatisch erzeugt** aus \`src/coach/faults/catalog.json\`, \`score.json\` und \`training/templates.json\` (\`node scripts/review-list.mjs\`, Stand ${new Date().toISOString().slice(0, 10)}).`,
);
out.push(
  'Alle Messwerte sind 2D-Näherungen aus dem Handyvideo (z. B. echte 90° Schulterdrehung ≈ 64° im Bild). Einheiten: ° = Grad, % Rumpf = Prozent der Rumpflänge (≈ 50 cm → 10 % ≈ 5 cm), ratio = Verhältnis.',
);
out.push('„Volle Schwere bei“ = Abstand zur Schwelle, ab dem der Fehler als maximal gilt (für die Priorisierung). Kalibriert bisher nur an synthetischen Schwüngen.', '');

out.push('## Fehlerregeln', '');
out.push('| Fehler | Schlagarten | Messwert | Position | Ansicht | Schwelle | Volle Schwere bei | Min. Vertrauen | Wichtigkeit | Grundlage |');
out.push('|---|---|---|---|---|---|---|---|---|---|');
for (const f of catalog)
  for (const r of f.rules)
    out.push(
      `| ${cell(f.name.de)} | ${f.shotTypes.join(', ')} | ${r.metric} | ${r.at} | ${views(f.views)} | ${cond(r)} | ±${r.fullSeverityAt} | ${r.minConfidence ?? 0.5} | ${f.importance} | ${cell(r.review)} |`,
    );

out.push('', '## Trainingsziele aus Korrekturen', '');
out.push('| Fehler | Messwert | Position | Ziel | Toleranz | Grundlage |', '|---|---|---|---|---|---|');
for (const f of catalog)
  if (f.trainingTarget) {
    const t = f.trainingTarget;
    const mode = t.mode === 'min' ? 'mindestens ' : t.mode === 'max' ? 'höchstens ' : '';
    out.push(`| ${cell(f.name.de)} | ${t.metric} | ${t.at} | ${mode}${t.target} | ±${t.tolerance} | ${cell(t.review ?? '–')} |`);
  }

out.push('', `## Swing-Score (Version ${score.version})`, '');
out.push(
  `Toleranz wirksam = T × Stufenfaktor (${score.levels.map((l) => `Stufe ${l.level}: ×${l.factor}`).join(', ')}). Gesamtscore nur bei ≥ ${Math.round(score.minCoverage * 100)} % gemessenem Gewicht, nur für ${score.shotTypes.join('/')}.`,
  '',
);
out.push('| Teil | Gewicht | Messwert | Position | Art | Ziel | T (Basis) | Messfehler-Boden | Grundlage |', '|---|---|---|---|---|---|---|---|---|');
const MODE = { abs: 'Abweichung', min: 'mindestens', max: 'höchstens' };
for (const p of score.parts)
  for (const c of p.criteria)
    out.push(
      `| ${p.id} | ${Math.round(p.weight * (p.weight <= 1 ? 100 : 1))} % | ${c.metric} | ${c.at} | ${MODE[c.mode] ?? c.mode} | ${c.target} | ${c.tolerance} | ${c.floor ?? '–'} | ${cell(c.review)} |`,
    );

out.push('', '## Trainings-Vorlagen', '');
out.push('| Vorlage | Messwert | Position | Ziel | Toleranz | Grundlage |', '|---|---|---|---|---|---|');
for (const t of Array.isArray(templates) ? templates : templates.templates ?? [])
  for (const c of t.criteria ?? [])
    out.push(`| ${cell(t.label?.de ?? t.id)} | ${c.metric} | ${c.at} | ${c.target} | ±${c.tolerance} | ${cell(c.review ?? t.review)} |`);

out.push('', '## Weitere Startwerte', '');
out.push('- Reverse-Diagnose: persönliche Reihenfolge ab **5** analysierten Schwüngen (US-1.12 „[X]“).');
out.push('- Fehler werden nur bewertet, wenn die Analysequalität ≥ 0,5 ist und der Messwert ein Vertrauen ≥ 0,5 hat (Schläger aus Handschätzung ≤ 0,4 → nie bewertet).');
out.push('- Max. 3 Fehler pro Schwung, sortiert nach Schwere × Wichtigkeit × Vertrauen.');
out.push('- Weitere Werte im Code mit `REVIEW(golf)`: automatische Aufnahme (live/swingTrigger.ts), Qualitätsprüfung (analysis/quality.ts), 9-Uhr-Näherung über die Handhöhe (analysis/phases.ts), Schlägerverfolgung (club/*), Tempo je Schlagart (model/constants.ts).');

writeFileSync('docs/coach/decisions/faults-review-list.md', out.join('\n') + '\n');
console.log('rules', catalog.reduce((s, f) => s + f.rules.length, 0));
