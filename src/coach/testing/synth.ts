/**
 * Synthetic swing generator (work package H). Builds a simple 3D stick figure that swings a club, projects it into a
 * face-on or down-the-line camera and returns MediaPipe-style landmarks plus the true club and key frames.
 * Every fault of the catalog has a knob here, so rules can be tested without a camera.
 *
 * World frame: X = towards the target, Y = up, Z = towards the ball (the player faces +Z). Metres, degrees.
 * Output is in the canonical right-handed frame unless handedness = 'left' (then it looks like a left-hander's video,
 * i.e. mirrored – exactly what the app receives from a real left-handed player).
 */
import { LANDMARK_COUNT, LM, SHOT_TYPES } from '../model/constants';
import type {
  CameraView,
  ClubEstimate,
  Handedness,
  KeyPosition,
  Landmark,
  PoseFrame,
  PoseSequence,
  ShotType,
} from '../model/types';
import { mirrorLandmarks, mirrorWorld } from '../pose/mirror';

type V3 = [number, number, number];

export interface SynthParams {
  view: CameraView;
  shotType: ShotType;
  handedness: Handedness;
  fps: number;
  width: number;
  height: number;
  /** still at address before the takeaway */
  addressMs: number;
  backswingMs: number;
  downswingMs: number;
  followMs: number;
  /** still in the finish */
  finishHoldMs: number;
  /** hand-arc angle at the top (deg); 0 = address, 90 = hands at shoulder-centre height behind, ~150 full swing */
  armArcTop: number;
  /** hand-arc angle in the finish (deg, positive number = through the ball) */
  armArcFinish: number;
  /** wrist hinge at the top (deg between arm-arc and shaft) */
  hingeTop: number;
  /** 0 = lag held until late (good); 1 = full early release / casting */
  casting: number;
  /** 3D shoulder turn at the top (deg) */
  shoulderTurnTop: number;
  hipTurnTop: number;
  /** turn at impact (negative = open towards the target) */
  shoulderTurnImpact: number;
  hipTurnImpact: number;
  /** forward bend of the spine at address (deg from vertical) */
  spineTilt: number;
  /** change of forward bend at impact (deg, negative = standing up = early extension) */
  spineTiltImpactDelta: number;
  /** hips move towards the ball at impact (m, + = early extension) */
  hipDepthImpact: number;
  /** hip centre along the target line at the top (m, negative = sway away from target) */
  hipShiftTop: number;
  /** hip centre along the target line at impact (m, + = weight shift towards the target, normal ~0.06) */
  hipShiftImpact: number;
  /** extra head movement on top of the body (m) */
  headShiftTopX: number;
  headShiftImpactX: number;
  headLiftImpact: number;
  /** side bend of the spine at the top (deg, + = towards the target – reverse pivot when > 0) */
  sideBendTop: number;
  /** side bend at impact (deg, negative = away from target, normal ~ −15) */
  sideBendImpact: number;
  /** elbow bend in deg (0 = straight) */
  leadElbowTop: number;
  leadElbowImpact: number;
  /** lead elbow bend right after impact (chicken wing when large) */
  leadElbowFollow: number;
  trailElbowTop: number;
  /** hands pushed out towards the ball during the early downswing (m) – over the top */
  overTheTop: number;
  /** extra rotation of the shaft about the vertical axis at the 9 o'clock positions (deg, + = club head outside = steep) */
  shaftPlaneDevBack: number;
  shaftPlaneDevDown: number;
  /** putting: change of wrist angle during the stroke (deg) */
  puttWristBreak: number;
  /** putting/chipping: extra shoulder-centre sway during the stroke (m) */
  strokeBodySway: number;
  /** waggle before the swing: hand-arc amplitude (deg) of a club wiggle that ends 0.35 s before the takeaway (0 = none) */
  waggle: number;
  /** Gaussian landmark noise (normalized units) and share of frames without detection */
  noise: number;
  dropout: number;
  /** multiply all visibilities (e.g. 0.4 to simulate a dark video) */
  visibility: number;
  /** player height relative to 1.8 m in the frame (0.5 = player far away) */
  zoom: number;
  seed: number;
}

const FULL: Partial<SynthParams> = {
  armArcTop: 150, armArcFinish: 200, hingeTop: 90, shoulderTurnTop: 90, hipTurnTop: 45,
  shoulderTurnImpact: -20, hipTurnImpact: -40, backswingMs: 750, downswingMs: 250, followMs: 450,
};

const SHOT_DEFAULTS: Record<ShotType, Partial<SynthParams>> = {
  driver: { ...FULL, spineTilt: 32, backswingMs: 780, downswingMs: 260 },
  iron: { ...FULL },
  bunker: { ...FULL, armArcTop: 130, shoulderTurnTop: 80 },
  pitch: {
    armArcTop: 95, armArcFinish: 110, hingeTop: 80, shoulderTurnTop: 55, hipTurnTop: 25, shoulderTurnImpact: -10,
    hipTurnImpact: -25, backswingMs: 600, downswingMs: 300, followMs: 400,
  },
  chip: {
    armArcTop: 35, armArcFinish: 40, hingeTop: 10, shoulderTurnTop: 20, hipTurnTop: 5, shoulderTurnImpact: -5,
    hipTurnImpact: -10, backswingMs: 450, downswingMs: 225, followMs: 300, hipShiftImpact: 0.01,
  },
  putt: {
    armArcTop: 18, armArcFinish: 22, hingeTop: 0, shoulderTurnTop: 8, hipTurnTop: 0, shoulderTurnImpact: -4,
    hipTurnImpact: 0, backswingMs: 600, downswingMs: 300, followMs: 400, hipShiftImpact: 0, sideBendImpact: 0,
    leadElbowTop: 25, leadElbowImpact: 25, leadElbowFollow: 25, trailElbowTop: 30, spineTilt: 45,
  },
};

export const SYNTH_DEFAULTS: SynthParams = {
  view: 'face_on', shotType: 'iron', handedness: 'right', fps: 60, width: 1080, height: 1920,
  addressMs: 700, backswingMs: 750, downswingMs: 250, followMs: 450, finishHoldMs: 700,
  armArcTop: 150, armArcFinish: 200, hingeTop: 90, casting: 0,
  shoulderTurnTop: 90, hipTurnTop: 45, shoulderTurnImpact: -20, hipTurnImpact: -40,
  spineTilt: 38, spineTiltImpactDelta: 0, hipDepthImpact: 0,
  hipShiftTop: -0.01, hipShiftImpact: 0.06, headShiftTopX: 0, headShiftImpactX: 0, headLiftImpact: 0,
  sideBendTop: -5, sideBendImpact: -15,
  leadElbowTop: 8, leadElbowImpact: 5, leadElbowFollow: 15, trailElbowTop: 90,
  overTheTop: 0, shaftPlaneDevBack: 0, shaftPlaneDevDown: 0, puttWristBreak: 0, strokeBodySway: 0, waggle: 0,
  noise: 0, dropout: 0, visibility: 1, zoom: 1, seed: 1,
};

export interface SynthTruth {
  /** true key frame indices (only the positions that exist for this shot) */
  keyframes: Partial<Record<KeyPosition, number>>;
  tempo: number;
  /** canonical-frame club of each frame (normalized image coordinates) */
  club: ClubEstimate[];
}

export interface SynthSwing {
  seq: PoseSequence;
  truth: SynthTruth;
  params: SynthParams;
}

// ------------------------------------------------------------------ small math

const r = (d: number) => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const v3add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const v3sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const v3len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const v3norm = (a: V3): V3 => v3scale(a, 1 / (v3len(a) || 1));
const v3cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** rotate about the vertical axis; positive angle moves +X towards +Z (backswing turn of a right-hander) */
const rotY = (p: V3, deg: number): V3 => {
  const c = Math.cos(r(deg));
  const s = Math.sin(r(deg));
  return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
};
/** Rodrigues rotation of v about unit axis k */
const rotAxis = (v: V3, k: V3, deg: number): V3 => {
  const c = Math.cos(r(deg));
  const s = Math.sin(r(deg));
  return v3add(v3add(v3scale(v, c), v3scale(v3cross(k, v), s)), v3scale(k, v3dot(k, v) * (1 - c)));
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ swing timeline

type Stage = 'address' | 'back' | 'down' | 'follow' | 'finish';

interface Kin {
  stage: Stage;
  /** hand-arc angle (deg) – positive backswing, negative follow-through */
  arc: number;
  hinge: number;
  /** 0 at address/top start … 1 at the end of the stage */
  s: number;
}

function kinematics(p: SynthParams, t: number): Kin {
  const A = p.addressMs;
  const B = A + p.backswingMs;
  const D = B + p.downswingMs;
  const F = D + p.followMs;
  if (t < A) {
    // optional waggle (arms and wrists only), then a still address of 0.35 s before the takeaway
    const wEnd = A - 350;
    if (p.waggle > 0 && t < wEnd) {
      const w = p.waggle * Math.sin((2 * Math.PI * t) / 500) * Math.sin((Math.PI * t) / wEnd);
      return { stage: 'address', arc: w, hinge: 1.5 * w, s: 0 };
    }
    return { stage: 'address', arc: 0, hinge: 0, s: 0 };
  }
  if (t < B) {
    const s = (t - A) / p.backswingMs;
    const e = (1 - Math.cos(Math.PI * s)) / 2; // slow start, slow arrival at the top
    // hinge sets mostly in the second half of the backswing
    const h = p.hingeTop * Math.pow(e, 1.3);
    return { stage: 'back', arc: p.armArcTop * e, hinge: h, s };
  }
  if (t < D) {
    const s = (t - B) / p.downswingMs;
    const arc = p.armArcTop * (1 - s * s); // accelerating
    // good: lag held until late (release ∝ s^4); casting: released linearly from the top
    const release = lerp(Math.pow(s, 4), s, p.casting);
    return { stage: 'down', arc, hinge: p.hingeTop * (1 - release), s };
  }
  if (t < F) {
    const s = (t - D) / p.followMs;
    const e = 1 - (1 - s) * (1 - s); // decelerating
    return { stage: 'follow', arc: -p.armArcFinish * e, hinge: -p.hingeTop * 0.9 * e, s };
  }
  return { stage: 'finish', arc: -p.armArcFinish, hinge: -p.hingeTop * 0.9, s: 1 };
}

/** Blend a body value through the stages: address → top → impact → finish. */
function bodyValue(k: Kin, p: SynthParams, top: number, impact: number, finish: number, leadHips = false): number {
  const prog = p.armArcTop > 0 ? Math.max(0, k.arc) / p.armArcTop : 0;
  switch (k.stage) {
    case 'address':
      return 0;
    case 'back':
      return top * prog;
    case 'down': {
      // hips lead the downswing (unwind earlier than shoulders)
      const q = leadHips ? Math.pow(k.s, 0.6) : k.s;
      return lerp(top, impact, q);
    }
    case 'follow':
      return lerp(impact, finish, k.s);
    case 'finish':
      return finish;
  }
}

// ------------------------------------------------------------------ body model

interface Body3 {
  pts: V3[];
  clubGrip: V3;
  clubHead: V3;
}

const ADDRESS_HANDS: V3 = [0.03, 0.8, 0.36];
const BALL: V3 = [0.0, 0.02, 0.78];
const CLUB_LEN: Record<ShotType, number> = { driver: 1.1, iron: 0.94, bunker: 0.89, pitch: 0.89, chip: 0.89, putt: 0.86 };

function buildBody(p: SynthParams, t: number): Body3 {
  const k = kinematics(p, t);
  const pts: V3[] = Array.from({ length: LANDMARK_COUNT }, () => [0, 0, 0] as V3);

  const shTurn = bodyValue(k, p, p.shoulderTurnTop, p.shoulderTurnImpact, -100);
  const hipTurn = bodyValue(k, p, p.hipTurnTop, p.hipTurnImpact, -80, true);
  const hipX = bodyValue(k, p, p.hipShiftTop, p.hipShiftImpact, p.hipShiftImpact + 0.04, true);
  const hipZ = bodyValue(k, p, 0, p.hipDepthImpact, p.hipDepthImpact);
  const tilt = p.spineTilt + bodyValue(k, p, 0, p.spineTiltImpactDelta, p.spineTiltImpactDelta - 25);
  const side = bodyValue(k, p, p.sideBendTop, p.sideBendImpact, -5);
  const headX = bodyValue(k, p, p.headShiftTopX, p.headShiftImpactX, p.headShiftImpactX);
  const headY = bodyValue(k, p, 0, p.headLiftImpact, p.headLiftImpact + 0.05);
  // putting / chipping: extra sway of the upper body during the stroke
  const sway = p.strokeBodySway * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - p.addressMs) / (p.backswingMs + p.downswingMs))));

  // feet and legs (static stance)
  const stance = p.shotType === 'putt' || p.shotType === 'chip' ? 0.16 : p.shotType === 'driver' ? 0.24 : 0.2;
  pts[LM.LEFT_ANKLE] = [stance, 0.08, 0];
  pts[LM.RIGHT_ANKLE] = [-stance, 0.08, 0];
  pts[LM.LEFT_HEEL] = [stance, 0.03, -0.05];
  pts[LM.RIGHT_HEEL] = [-stance, 0.03, -0.05];
  pts[LM.LEFT_FOOT] = [stance + 0.03, 0.02, 0.17];
  pts[LM.RIGHT_FOOT] = [-stance - 0.01, 0.02, 0.17];

  // pelvis
  const hipC: V3 = [hipX, 0.92 + hipZ * 0.3, -0.04 + hipZ];
  pts[LM.LEFT_HIP] = v3add(hipC, rotY([0.15, 0, 0], hipTurn));
  pts[LM.RIGHT_HIP] = v3add(hipC, rotY([-0.15, 0, 0], hipTurn));
  // knees between hips and ankles, pushed forward (flex)
  for (const [hip, knee, ankle] of [
    [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
    [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  ] as const) {
    const m = v3scale(v3add(pts[hip], pts[ankle]), 0.5);
    pts[knee] = v3add(m, [0, 0.02, 0.1 - hipZ * 0.5]);
  }

  // spine and shoulders
  const up: V3 = v3norm([Math.sin(r(side)) + sway * 2, Math.cos(r(tilt)), Math.sin(r(tilt))]);
  const torso = 0.52;
  const shC = v3add(v3add(hipC, v3scale(up, torso)), [sway, 0, 0]);
  const e1 = v3norm(v3sub([1, 0, 0], v3scale(up, v3dot([1, 0, 0], up))));
  const e2 = v3cross(up, e1); // ≈ −Z at address
  const shoulderDir = v3add(v3scale(e1, Math.cos(r(shTurn))), v3scale(e2, -Math.sin(r(shTurn))));
  pts[LM.LEFT_SHOULDER] = v3add(shC, v3scale(shoulderDir, 0.19));
  pts[LM.RIGHT_SHOULDER] = v3add(shC, v3scale(shoulderDir, -0.19));

  // head
  const headC = v3add(v3add(shC, v3scale(up, 0.24)), [headX, headY, 0]);
  const face: V3 = v3norm([0, -0.6, 1]);
  pts[LM.NOSE] = v3add(headC, v3scale(face, 0.1));
  const headSide = rotY([1, 0, 0], shTurn * 0.3);
  for (const [i, s, f] of [
    [1, 0.025, 0.09], [2, 0.035, 0.09], [3, 0.045, 0.09], [4, -0.025, 0.09], [5, -0.035, 0.09], [6, -0.045, 0.09],
    [7, 0.075, 0.02], [8, -0.075, 0.02], [9, 0.02, 0.1], [10, -0.02, 0.1],
  ] as const) {
    pts[i] = v3add(v3add(headC, v3scale(headSide, s)), v3scale(face, f));
  }
  pts[9] = v3add(pts[9], [0, -0.03, 0]);
  pts[10] = v3add(pts[10], [0, -0.03, 0]);

  // hands on the swing arc: plane through the shoulder centre spanned by −X (backswing) and "down to the hands"
  const center = shC;
  const toHands0 = v3sub(ADDRESS_HANDS, [0, 0.92 + 0.52 * Math.cos(r(p.spineTilt)), -0.04 + 0.52 * Math.sin(r(p.spineTilt))]);
  const radius = v3len(toHands0);
  const down0 = v3norm([0, toHands0[1], toHands0[2]]);
  const X: V3 = [1, 0, 0];
  const arc = k.arc;
  let hands = v3add(center, v3add(v3scale(down0, radius * Math.cos(r(arc))), v3scale(X, -radius * Math.sin(r(arc)))));
  hands = v3add(hands, [ADDRESS_HANDS[0], 0, 0]);
  if (k.stage === 'down' && p.overTheTop) hands = v3add(hands, [0, 0, p.overTheTop * Math.sin(Math.PI * k.s)]);

  // club: address shaft direction rotated in its own plane by (arc + hinge)
  const clubLen = CLUB_LEN[p.shotType];
  const dc0 = v3norm(v3sub(BALL, ADDRESS_HANDS));
  const planeNormal = v3norm(v3cross(dc0, X));
  let dir = rotAxis(dc0, planeNormal, -(arc + k.hinge));
  // make sure positive rotation moves the club head away from the target in the backswing
  if (arc > 0 && dir[0] > 0) dir = rotAxis(dc0, planeNormal, arc + k.hinge);
  if (p.shotType === 'putt' && p.puttWristBreak) {
    const wb = p.puttWristBreak * Math.max(0, Math.min(1, (t - p.addressMs - p.backswingMs) / p.downswingMs));
    dir = rotAxis(dir, planeNormal, k.stage === 'down' || k.stage === 'follow' || k.stage === 'finish' ? wb : 0);
  }
  // plane deviation at the 9 o'clock region: rotate about the vertical axis (+ = club head outside = steep)
  const near9 = Math.max(0, 1 - Math.abs(arc + k.hinge - 90) / 45);
  const dev = k.stage === 'back' ? p.shaftPlaneDevBack : k.stage === 'down' ? p.shaftPlaneDevDown : 0;
  if (dev && near9 > 0) dir = rotY(dir, -dev * near9);
  const clubGrip = v3add(hands, v3scale(dir, -0.08));
  const clubHead = v3add(hands, v3scale(dir, clubLen - 0.08));

  // wrists on the grip (lead hand above the trail hand)
  pts[LM.LEFT_WRIST] = v3add(hands, v3scale(dir, -0.045));
  pts[LM.RIGHT_WRIST] = v3add(hands, v3scale(dir, 0.045));
  for (const [w, a, b, c] of [
    [LM.LEFT_WRIST, LM.LEFT_PINKY, LM.LEFT_INDEX, LM.LEFT_THUMB],
    [LM.RIGHT_WRIST, LM.RIGHT_PINKY, LM.RIGHT_INDEX, LM.RIGHT_THUMB],
  ] as const) {
    pts[a] = v3add(pts[w], v3scale(dir, 0.06));
    pts[b] = v3add(pts[w], v3add(v3scale(dir, 0.07), [0, 0, 0.02]));
    pts[c] = v3add(pts[w], v3add(v3scale(dir, 0.04), [0, 0, 0.03]));
  }

  // elbows: two-link arms with a chosen bend
  const leadBend =
    k.stage === 'follow' ? lerp(p.leadElbowImpact, p.leadElbowFollow, Math.min(1, k.s * 2.5)) :
    k.stage === 'finish' ? p.leadElbowFollow : bodyValue(k, p, p.leadElbowTop, p.leadElbowImpact, p.leadElbowFollow);
  const trailBend =
    k.stage === 'follow' || k.stage === 'finish' ? lerp(20, 10, k.s) : bodyValue(k, p, p.trailElbowTop, 20, 10) + (k.stage === 'address' ? 15 : 0);
  pts[LM.LEFT_ELBOW] = elbow(pts[LM.LEFT_SHOULDER], pts[LM.LEFT_WRIST], leadBend, [0.3, -1, -0.3]);
  pts[LM.RIGHT_ELBOW] = elbow(pts[LM.RIGHT_SHOULDER], pts[LM.RIGHT_WRIST], trailBend, [-0.2, -1, -0.2]);

  return { pts, clubGrip, clubHead };
}

function elbow(shoulder: V3, wrist: V3, bendDeg: number, bendDir: V3): V3 {
  const m = v3scale(v3add(shoulder, wrist), 0.5);
  const axis = v3norm(v3sub(wrist, shoulder));
  const n = v3norm(v3sub(bendDir, v3scale(axis, v3dot(bendDir, axis))));
  const upper = 0.3;
  return v3add(m, v3scale(n, upper * Math.sin(r(Math.max(0, bendDeg)) / 2)));
}

// ------------------------------------------------------------------ camera

function project(p: SynthParams, w: V3): { x: number; y: number; z: number } {
  const aspect = p.width / p.height;
  const k = (0.72 / 1.8) * p.zoom; // 1.8 m ≈ 72 % of the frame height
  const u = p.view === 'face_on' ? w[0] : w[2] - 0.3;
  const depth = p.view === 'face_on' ? -w[2] : w[0];
  return { x: 0.5 + (u * k) / aspect, y: 0.9 - w[1] * k, z: depth * k };
}

// ------------------------------------------------------------------ public API

export function synthSwing(overrides: Partial<SynthParams> = {}): SynthSwing {
  const shot = overrides.shotType ?? SYNTH_DEFAULTS.shotType;
  const p: SynthParams = { ...SYNTH_DEFAULTS, ...SHOT_DEFAULTS[shot], ...overrides, shotType: shot };
  const rand = mulberry32(p.seed);
  const gauss = () => {
    const u = Math.max(1e-9, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const total = p.addressMs + p.backswingMs + p.downswingMs + p.followMs + p.finishHoldMs;
  const n = Math.floor((total / 1000) * p.fps) + 1;
  const aspect = p.width / p.height;
  const frames: PoseFrame[] = [];
  const club: ClubEstimate[] = [];

  for (let i = 0; i < n; i++) {
    const t = (i * 1000) / p.fps;
    const b = buildBody(p, t);
    const hipC = v3scale(v3add(b.pts[LM.LEFT_HIP], b.pts[LM.RIGHT_HIP]), 0.5);
    let lm: Landmark[] = b.pts.map((w, idx) => {
      const q = project(p, w);
      let v = 0.97;
      // down-the-line: the lead arm is partly hidden behind the body
      if (p.view === 'down_the_line' && (idx === LM.LEFT_ELBOW || idx === LM.LEFT_WRIST)) v = 0.75;
      return { x: q.x + gauss() * p.noise, y: q.y + gauss() * p.noise, z: q.z, v: Math.min(1, v * p.visibility) };
    });
    const hipU = p.view === 'face_on' ? hipC[0] : hipC[2];
    let world: Landmark[] = b.pts.map((w) => {
      const u = p.view === 'face_on' ? w[0] : w[2];
      const depth = p.view === 'face_on' ? -w[2] : w[0];
      return { x: u - hipU, y: -(w[1] - hipC[1]), z: depth, v: 0.97 };
    });
    const g = project(p, b.clubGrip);
    const h = project(p, b.clubHead);
    const ang = (Math.atan2(h.y - g.y, (h.x - g.x) * aspect) * 180) / Math.PI;
    club.push({ grip: { x: g.x, y: g.y }, head: { x: h.x, y: h.y }, angleDeg: ang, source: 'image', confidence: 1 });

    if (p.handedness === 'left') {
      lm = mirrorLandmarks(lm);
      world = mirrorWorld(world);
    }
    const dropped = p.dropout > 0 && rand() < p.dropout;
    frames.push({ t, lm: dropped ? null : lm, world: dropped ? null : world });
  }

  // true key frames
  const fi = (ms: number) => Math.min(n - 1, Math.round((ms * p.fps) / 1000));
  const A = p.addressMs;
  const B = A + p.backswingMs;
  const D = B + p.downswingMs;
  const F = D + p.followMs;
  const kf: Partial<Record<KeyPosition, number>> = {
    address: Math.max(0, fi(A) - 1),
    top: fi(B),
    impact: fi(D),
    finish: fi(F),
  };
  const positions = SHOT_TYPES[p.shotType].positions;
  if (positions.includes('backswing9')) {
    for (let i = fi(A); i <= fi(B); i++) {
      const k = kinematics(p, (i * 1000) / p.fps);
      if (k.arc + k.hinge >= 90) {
        kf.backswing9 = i;
        break;
      }
    }
    for (let i = fi(B); i <= fi(D); i++) {
      const k = kinematics(p, (i * 1000) / p.fps);
      if (k.arc + k.hinge <= 90) {
        kf.downswing9 = i;
        break;
      }
    }
  }

  return {
    seq: { width: p.width, height: p.height, fps: p.fps, frames, mirrored: false },
    truth: { keyframes: kf, tempo: p.backswingMs / p.downswingMs, club },
    params: p,
  };
}

/**
 * Rasterize a synthetic grayscale frame (background + body blobs + a dark shaft line) for club-detector tests.
 * Coordinates are canonical normalized image coordinates.
 */
export function synthGrayFrame(
  club: ClubEstimate | null,
  opts: { width?: number; height?: number; background?: number; shaft?: number; shaftWidthPx?: number; noise?: number; seed?: number } = {},
): { width: number; height: number; data: Uint8ClampedArray } {
  const width = opts.width ?? 203;
  const height = opts.height ?? 360;
  const bg = opts.background ?? 170;
  const shaftV = opts.shaft ?? 40;
  const wpx = opts.shaftWidthPx ?? 2;
  const rand = mulberry32(opts.seed ?? 7);
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, bg + (opts.noise ? (rand() - 0.5) * 2 * opts.noise : 0)));
  if (club) {
    const x0 = club.grip.x * width;
    const y0 = club.grip.y * height;
    const x1 = club.head.x * width;
    const y1 = club.head.y * height;
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let s = 0; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      for (let dx = -wpx; dx <= wpx; dx++)
        for (let dy = -wpx; dy <= wpx; dy++) {
          const px = Math.round(x + dx / 2);
          const py = Math.round(y + dy / 2);
          if (px >= 0 && py >= 0 && px < width && py < height) data[py * width + px] = shaftV;
        }
    }
  }
  return { width, height, data };
}
