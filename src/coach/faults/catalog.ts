import type { BallFlight, Drill, FaultDef, Localized } from '../model/types';
import catalogJson from './catalog.json';
import drillsJson from './drills.json';
import ballFlightsJson from './ballflights.json';

/**
 * Typed access to the content files (fault catalog, drills, ball flights).
 * Texts are English base + German (du-Form); all golf thresholds carry a REVIEW(golf) note.
 */

/** One possible cause of a ball flight. measurable = we can see it in the video (then faultId points to the catalog). */
export interface BallFlightCause {
  faultId?: string;
  measurable: boolean;
  text: Localized;
}

export type BallFlightGroup = 'direction' | 'contact' | 'height' | 'short_game' | 'putting';

export interface BallFlightDef {
  id: BallFlight;
  group: BallFlightGroup;
  name: Localized;
  /** what the ball does, in player words */
  what: Localized;
  /** the physics in one sentence */
  physics: Localized;
  causes: BallFlightCause[];
}

export const FAULTS: FaultDef[] = catalogJson as FaultDef[];
export const DRILLS: Drill[] = drillsJson as Drill[];
export const BALL_FLIGHTS: BallFlightDef[] = ballFlightsJson as BallFlightDef[];

const faultById = new Map(FAULTS.map((f) => [f.id, f]));
const drillById = new Map(DRILLS.map((d) => [d.id, d]));
const flightById = new Map(BALL_FLIGHTS.map((b) => [b.id, b]));

export function getFaultDef(id: string): FaultDef | undefined {
  return faultById.get(id);
}
export function getDrill(id: string): Drill | undefined {
  return drillById.get(id);
}
export function getBallFlight(id: BallFlight): BallFlightDef | undefined {
  return flightById.get(id);
}
/** Drills of a fault (unknown ids are skipped). */
export function drillsFor(faultId: string): Drill[] {
  return (getFaultDef(faultId)?.drillIds ?? []).map(getDrill).filter((d): d is Drill => !!d);
}
