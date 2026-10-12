import type { BallFlight, CameraView, Fault, Localized } from '../model/types';
import { BALL_FLIGHTS, type BallFlightCause, FAULTS, getBallFlight, getFaultDef } from './catalog';

/**
 * Reverse diagnosis (US-1.12): "my typical miss is X" → the most likely causes in MY swings.
 * Pure function; the interface is meant to be reused by the later Rounds module (miss logged on the course →
 * causes from the swing history). History = analysed swings (only the fields used here are required).
 */
export interface DiagnosisSwing {
  faults: Pick<Fault, 'defId' | 'severity'>[];
  checkedFaultIds: string[];
}

export interface DiagnosisCause {
  faultId: string;
  /** cause text from the ball flight catalog (falls back to the fault name) */
  text: Localized;
  /** swings in which this fault could be checked */
  checked: number;
  /** swings in which it was found */
  detected: number;
  /** detected / checked; null when it was never checkable (e.g. needs the other camera view) */
  frequency: number | null;
  /** mean severity in the swings where it was found */
  meanSeverity: number | null;
  /** ranking value (frequency × severity weighting, importance as tie-breaker) */
  score: number;
  importance: number;
  /** views in which the fault can be measured – to tell the player which video to take */
  views: CameraView[];
}

export interface DiagnosisResult {
  ballFlight: BallFlight;
  /** number of swings considered */
  swings: number;
  /** enough swings for a personal ranking (MIN_SWINGS_FOR_DIAGNOSIS) */
  enoughData: boolean;
  /** all measurable causes, ranked (most likely first) */
  causes: DiagnosisCause[];
  /** the cards to show: top 3 causes that actually occur in the swings (or by catalog order without data) */
  top: DiagnosisCause[];
  /** causes the camera cannot see (grip, clubface, equipment, alignment, mind) – shown separately and honestly */
  unmeasurable: BallFlightCause[];
}

/** REVIEW(golf): US-1.12 says "at least [X] analysed swings" – 5 as a start value. */
export const MIN_SWINGS_FOR_DIAGNOSIS = 5;
export const DIAGNOSIS_TOP_N = 3;

/** Measurable causes of a ball flight: from ballflights.json plus faults that list this flight (union, catalog order first). */
export function measurableCauses(flight: BallFlight): { faultId: string; text: Localized }[] {
  const def = getBallFlight(flight);
  const out = new Map<string, Localized>();
  for (const c of def?.causes ?? []) if (c.measurable && c.faultId && !out.has(c.faultId)) out.set(c.faultId, c.text);
  for (const f of FAULTS) if (f.ballFlights.includes(flight) && !out.has(f.id)) out.set(f.id, f.name);
  return [...out].map(([faultId, text]) => ({ faultId, text }));
}

export function diagnose(ballFlight: BallFlight, history: DiagnosisSwing[] = []): DiagnosisResult {
  const def = getBallFlight(ballFlight);
  const causes: DiagnosisCause[] = measurableCauses(ballFlight).map(({ faultId, text }, order) => {
    const fd = getFaultDef(faultId);
    let checked = 0;
    let detected = 0;
    let sev = 0;
    for (const s of history) {
      const found = s.faults.find((f) => f.defId === faultId);
      if (found || s.checkedFaultIds.includes(faultId)) checked++;
      if (found) {
        detected++;
        sev += found.severity;
      }
    }
    const frequency = checked ? detected / checked : null;
    const meanSeverity = detected ? sev / detected : null;
    const importance = fd?.importance ?? 1;
    // with data: how often × how strong (severity counts half, so frequent mild faults still rank);
    // without data: catalog order of the source (most common causes first) and importance.
    const score =
      frequency !== null && detected > 0
        ? frequency * (0.5 + 0.5 * (meanSeverity ?? 0)) + importance * 1e-3
        : -order * 1e-3 + importance * 1e-4 - 1;
    return { faultId, text, checked, detected, frequency, meanSeverity, score, importance, views: fd?.views ?? [] };
  });
  causes.sort((a, b) => b.score - a.score || a.faultId.localeCompare(b.faultId));
  const enoughData = history.length >= MIN_SWINGS_FOR_DIAGNOSIS;
  const occurring = causes.filter((c) => c.detected > 0);
  const top = (enoughData && occurring.length ? occurring : causes).slice(0, DIAGNOSIS_TOP_N);
  return {
    ballFlight,
    swings: history.length,
    enoughData,
    causes,
    top,
    unmeasurable: (def?.causes ?? []).filter((c) => !c.measurable),
  };
}

/** Ball flights in display order, grouped. */
export function ballFlightGroups() {
  const groups = ['direction', 'contact', 'height', 'short_game', 'putting'] as const;
  return groups.map((g) => ({ group: g, flights: BALL_FLIGHTS.filter((b) => b.group === g) }));
}
