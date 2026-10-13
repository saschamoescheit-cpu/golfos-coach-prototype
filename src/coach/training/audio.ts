/**
 * Training tones (Web Audio, generated – no audio files, works offline).
 * Designed to be told apart without any musical ear, also outdoors with wind:
 *   reach   – one short mid "blip"                      (mirror: you are in the position)
 *   held    – three quick rising notes "ding-ding-ding"  (mirror: held for 2 s)
 *   hit     – bright RISING two-tone "da-DING"           (series: correction reached)
 *   miss    – LOW short buzz, falling                    (series: not reached)
 *   unknown – two soft low ticks                         (series: could not be judged)
 * hit and miss differ in pitch (≈ 1 kHz vs. ≈ 150 Hz), direction (up vs. down), timbre (clean vs. buzzy) and rhythm
 * (two notes vs. one) – any one of these is enough to tell them apart.
 *
 * iOS: an AudioContext may only start inside a user gesture → call unlock() from the "Start" tap. The silent switch
 * mutes Web Audio unless navigator.audioSession.type = 'playback' (Safari 17+), which unlock() sets when available.
 * Vibration (navigator.vibrate) is used where supported (Android); iPhones ignore it.
 */
export type ToneKind = 'reach' | 'held' | 'hit' | 'miss' | 'unknown';

export interface ToneNote {
  /** start frequency (Hz) */
  f0: number;
  /** end frequency (Hz) – glide */
  f1: number;
  /** start offset (s) */
  at: number;
  /** duration (s) */
  dur: number;
  wave: OscillatorType;
  /** 0..1 */
  gain: number;
}

export const TONES: Record<ToneKind, ToneNote[]> = {
  reach: [{ f0: 784, f1: 784, at: 0, dur: 0.12, wave: 'triangle', gain: 0.8 }],
  held: [
    { f0: 784, f1: 784, at: 0, dur: 0.09, wave: 'triangle', gain: 0.8 },
    { f0: 988, f1: 988, at: 0.1, dur: 0.09, wave: 'triangle', gain: 0.8 },
    { f0: 1319, f1: 1319, at: 0.2, dur: 0.22, wave: 'triangle', gain: 0.9 },
  ],
  hit: [
    { f0: 880, f1: 880, at: 0, dur: 0.12, wave: 'triangle', gain: 0.9 },
    { f0: 1319, f1: 1397, at: 0.14, dur: 0.3, wave: 'triangle', gain: 1 },
  ],
  miss: [{ f0: 180, f1: 110, at: 0, dur: 0.4, wave: 'sawtooth', gain: 0.55 }],
  unknown: [
    { f0: 330, f1: 330, at: 0, dur: 0.05, wave: 'sine', gain: 0.4 },
    { f0: 330, f1: 330, at: 0.12, dur: 0.05, wave: 'sine', gain: 0.4 },
  ],
};

/** Vibration patterns (ms) – Android only. */
export const VIBRATION: Record<ToneKind, number[]> = {
  reach: [40],
  held: [40, 60, 40, 60, 120],
  hit: [60, 60, 160],
  miss: [400],
  unknown: [20, 80, 20],
};

type AudioCtor = typeof AudioContext;

export class TrainingAudio {
  private ctx: AudioContext | null = null;
  enabled = true;
  vibrate = true;
  volume = 1;

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Call from a user gesture (tap). Safe to call repeatedly. */
  async unlock(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      // not supported
    }
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as AudioCtor | undefined;
    if (!Ctor) return false;
    if (!this.ctx) this.ctx = new Ctor();
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      // a silent buffer inside the gesture fully unlocks older iOS versions
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start(0);
    } catch {
      return false;
    }
    return this.unlocked;
  }

  play(kind: ToneKind): void {
    if (!this.enabled) return;
    if (this.vibrate && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(VIBRATION[kind]);
      } catch {
        // ignore
      }
    }
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.01;
    for (const n of TONES[kind]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.wave;
      osc.frequency.setValueAtTime(n.f0, t0 + n.at);
      if (n.f1 !== n.f0) osc.frequency.exponentialRampToValueAtTime(n.f1, t0 + n.at + n.dur);
      const peak = Math.max(0.0001, n.gain * this.volume);
      // short attack/release – no clicks, crisp start
      g.gain.setValueAtTime(0.0001, t0 + n.at);
      g.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.01);
      g.gain.setValueAtTime(peak, t0 + n.at + Math.max(0.01, n.dur - 0.04));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
  }

  close(): void {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

let shared: TrainingAudio | null = null;
/** One audio context for the whole app (iOS limits the number of contexts). */
export function getTrainingAudio(): TrainingAudio {
  if (!shared) shared = new TrainingAudio();
  return shared;
}
