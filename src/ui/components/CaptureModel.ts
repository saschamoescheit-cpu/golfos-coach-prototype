import type { CameraView, Handedness, Settings, ShotType } from '../../coach/model/types';

/**
 * Pure helpers of the capture setup (review W6): the player's choice of shot type, view and handedness must never be
 * overwritten by settings that arrive later from IndexedDB. Route params win over settings, a tap wins over both.
 */
export interface CaptureChoice {
  shotType: ShotType;
  view: CameraView;
  hand: Handedness;
}
export type CaptureField = keyof CaptureChoice;
export interface CaptureParams {
  shotType?: ShotType;
  view?: CameraView;
}

/** Putts can only be timed face-on (DECISIONS L3). */
function puttRule(c: CaptureChoice): CaptureChoice {
  return c.shotType === 'putt' && c.view !== 'face_on' ? { ...c, view: 'face_on' } : c;
}

/** Start values: route params, then the (possibly not yet loaded) settings, then the defaults. */
export function initialCaptureChoice(params: CaptureParams, st: Partial<Settings> | null | undefined): CaptureChoice {
  const c: CaptureChoice = {
    shotType: params.shotType ?? st?.defaultShotType ?? 'iron',
    view: params.view ?? st?.defaultView ?? 'face_on',
    hand: st?.handedness ?? 'right',
  };
  return params.view ? c : puttRule(c);
}

/**
 * Settings loaded after the screen opened: only fields the player has not touched and no route param fixed are taken
 * over. The putt rule is applied only when the view itself comes from the settings.
 */
export function applyLoadedSettings(cur: CaptureChoice, touched: ReadonlySet<CaptureField>, params: CaptureParams, st: Settings): CaptureChoice {
  const next: CaptureChoice = {
    shotType: touched.has('shotType') || params.shotType ? cur.shotType : (st.defaultShotType ?? cur.shotType),
    view: touched.has('view') || params.view ? cur.view : (st.defaultView ?? cur.view),
    hand: touched.has('hand') ? cur.hand : st.handedness,
  };
  return touched.has('view') || params.view ? next : puttRule(next);
}
