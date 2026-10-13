import { describe, expect, it } from 'vitest';
import { ALL_POSITIONS, ALL_SHOT_TYPES, ALL_VIEWS } from '../model/constants';
import type { BallFlight, Localized } from '../model/types';
import { loc, sides, SIDE_TOKEN } from '../i18n/i18n';
import templatesJson from '../training/templates.json';
import { BALL_FLIGHTS, DRILLS, FAULTS, getBallFlight, getDrill, getFaultDef } from './catalog';
import { METRIC_CONTRACT, metricAvailable } from './metricContract';

const ALL_FLIGHTS: BallFlight[] = [
  'pull', 'pull_hook', 'push', 'push_slice', 'slice', 'hook', 'duck_hook', 'top', 'fat', 'thin', 'shank', 'toe_heel', 'whiff',
  'skyball', 'ballooning', 'too_low', 'scoop', 'chili_dip', 'skull', 'bunker_fat', 'putt_pull', 'putt_push', 'putt_distance',
  'inconsistent_contact', 'loss_of_distance', 'yips',
];
const filled = (t: Localized | undefined) => !!t && t.en.trim().length > 3 && t.de.trim().length > 3;

describe('fault catalog schema', () => {
  it('has unique ids and the expected size', () => {
    expect(new Set(FAULTS.map((f) => f.id)).size).toBe(FAULTS.length);
    expect(FAULTS.length).toBeGreaterThanOrEqual(25);
  });

  it.each(FAULTS.map((f) => [f.id, f] as const))('%s: texts en + de, valid enums, importance', (_id, f) => {
    for (const t of [f.name, f.ballEffect, f.cause, f.correction, f.benefit]) expect(filled(t)).toBe(true);
    expect(f.shotTypes.length).toBeGreaterThan(0);
    f.shotTypes.forEach((s) => expect(ALL_SHOT_TYPES).toContain(s));
    expect(f.views.length).toBeGreaterThan(0);
    f.views.forEach((v) => expect(ALL_VIEWS).toContain(v));
    expect(ALL_POSITIONS).toContain(f.marker);
    expect(['all', 'any']).toContain(f.match);
    expect(f.importance).toBeGreaterThanOrEqual(1);
    expect(f.importance).toBeLessThanOrEqual(5);
    expect(f.rules.length).toBeGreaterThan(0);
    f.ballFlights.forEach((b) => expect(ALL_FLIGHTS).toContain(b));
  });

  it.each(FAULTS.map((f) => [f.id, f] as const))('%s: rules only use metrics/positions allowed by 02_METRICS.md', (_id, f) => {
    for (const r of f.rules) {
      expect(METRIC_CONTRACT[r.metric], `${r.metric} not in contract`).toBeDefined();
      expect(r.review.startsWith('REVIEW(golf):'), `review on ${r.metric}`).toBe(true);
      expect(r.fullSeverityAt).toBeGreaterThan(0);
      if (r.op === 'outside') expect(r.thresholdHigh).toBeGreaterThan(r.threshold);
      // the rule must exist in at least one of the fault's views, for every shot type of the fault
      for (const s of f.shotTypes) expect(f.views.some((v) => metricAvailable(r.metric, r.at, v, s)), `${r.metric}@${r.at} for ${s}`).toBe(true);
    }
    // every listed view has at least one measurable rule (otherwise the view must not be listed)
    for (const v of f.views) for (const s of f.shotTypes) expect(f.rules.some((r) => metricAvailable(r.metric, r.at, v, s)), `${v}/${s}`).toBe(true);
  });

  it('drills of every fault exist; training targets use contract metrics', () => {
    for (const f of FAULTS) {
      expect(f.drillIds.length).toBeGreaterThanOrEqual(1);
      expect(f.drillIds.length).toBeLessThanOrEqual(2);
      f.drillIds.forEach((d) => expect(getDrill(d), `${f.id} → ${d}`).toBeDefined());
      if (f.trainingTarget) {
        expect(f.views.some((v) => f.shotTypes.some((s) => metricAvailable(f.trainingTarget!.metric, f.trainingTarget!.at, v, s)))).toBe(true);
        expect(f.trainingTarget.tolerance).toBeGreaterThan(0);
        expect([undefined, 'abs', 'min', 'max']).toContain(f.trainingTarget.mode);
        expect(f.trainingTarget.review?.startsWith('REVIEW(golf):'), `${f.id} trainingTarget review`).toBe(true);
      }
    }
  });

  it('covers the brief: key faults are present', () => {
    for (const id of ['early_extension', 'head_sway', 'hip_sway', 'reverse_pivot', 'over_the_top', 'chicken_wing', 'short_shoulder_turn',
      'casting', 'tempo_fast', 'tempo_slow', 'shaft_flat_backswing9', 'shaft_steep_backswing9', 'shaft_steep_downswing9',
      'shaft_flat_downswing9', 'bent_lead_arm', 'flying_elbow', 'setup_upright', 'chip_weight_back', 'chip_scoop',
      'putt_head_movement', 'putt_body_movement', 'putt_wrist_break', 'putt_tempo'])
      expect(getFaultDef(id), id).toBeDefined();
  });
});

describe('drills', () => {
  it('unique ids, texts en + de, 3–5 steps, draft', () => {
    expect(new Set(DRILLS.map((d) => d.id)).size).toBe(DRILLS.length);
    for (const d of DRILLS) {
      for (const t of [d.name, d.goal, d.equipment, d.reps]) expect(filled(t), d.id).toBe(true);
      expect(['feel', 'real']).toContain(d.kind);
      expect(d.steps.length).toBeGreaterThanOrEqual(3);
      expect(d.steps.length).toBeLessThanOrEqual(5);
      d.steps.forEach((s) => expect(filled(s)).toBe(true));
      expect(d.draft).toBe(true);
    }
  });
  it('every drill is used by a fault', () => {
    for (const d of DRILLS) expect(FAULTS.some((f) => f.drillIds.includes(d.id)), d.id).toBe(true);
  });
});

describe('ball flights', () => {
  it('cover every BallFlight once, with texts and honest causes', () => {
    expect(BALL_FLIGHTS.map((b) => b.id).sort()).toEqual([...ALL_FLIGHTS].sort());
    for (const b of BALL_FLIGHTS) {
      for (const t of [b.name, b.what, b.physics]) expect(filled(t), b.id).toBe(true);
      expect(b.causes.length).toBeGreaterThan(0);
      for (const c of b.causes) {
        expect(filled(c.text)).toBe(true);
        if (c.measurable) expect(getFaultDef(c.faultId ?? ''), `${b.id} → ${c.faultId}`).toBeDefined();
        else expect(c.faultId).toBeUndefined();
      }
    }
  });
});

describe('left/right only via side tokens (review W4)', () => {
  type Txt = { path: string; lang: 'en' | 'de'; s: string };
  const texts: Txt[] = [];
  const walk = (o: unknown, path: string) => {
    if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (o && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      if (typeof r.en === 'string' && typeof r.de === 'string') {
        texts.push({ path, lang: 'en', s: r.en }, { path, lang: 'de', s: r.de });
        return;
      }
      for (const [k, v] of Object.entries(r)) if (k !== 'review') walk(v, `${path}.${k}`);
    }
  };
  walk(FAULTS, 'catalog');
  walk(DRILLS, 'drills');
  walk(BALL_FLIGHTS, 'ballflights');
  walk(templatesJson, 'templates');
  const RAW = /\b(left|right|links|rechts|linke[nmrs]?|rechte[nmrs]?|linker|rechter)\b/i;

  it('collects all catalog texts', () => expect(texts.length).toBeGreaterThan(500));

  it('no hard-coded side words remain (en + de)', () => {
    const bad = texts.filter((x) => RAW.test(x.s.replace(SIDE_TOKEN, ''))).map((x) => `${x.path} (${x.lang}): ${x.s}`);
    expect(bad).toEqual([]);
  });

  it('every token resolves for both hands, sides swap for left-handers', () => {
    for (const x of texts)
      for (const h of ['right', 'left'] as const) {
        const out = sides(x.s, x.lang, h);
        expect(out, `${x.path} ${x.lang} ${h}`).not.toMatch(/\{\w+\}/);
      }
    const hip = getFaultDef('hip_sway')!.correction;
    expect(loc(hip, 'de', 'right')).toContain('die rechte Hüfte');
    expect(loc(hip, 'de', 'left')).toContain('die linke Hüfte');
    expect(loc(hip, 'de', 'left')).toContain('des linken Fußes');
    const ott = getFaultDef('over_the_top')!.ballEffect;
    expect(loc(ott, 'de', 'right')).toContain('Bälle links raus (Pull) oder Slices mit starker Rechtskurve');
    expect(loc(ott, 'de', 'left')).toContain('Bälle rechts raus (Pull) oder Slices mit starker Linkskurve');
    expect(loc(ott, 'en', 'left')).toContain('pulls right or slices that curve hard left');
    expect(loc(getBallFlight('hook')!.what, 'en', 'left')).toBe('Starts straight or left, then curves hard to the right.');
    expect(loc(getFaultDef('chicken_wing')!.name, 'de', 'left')).toBe('Chicken Wing (rechter Ellbogen knickt)');
  });
});
