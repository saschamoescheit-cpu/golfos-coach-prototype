import type { FaultProgressRecord, Session, Settings, ShotType, Swing, TrainingTarget } from '../model/types';
import type { CoachStore } from './Store';

export const DEFAULT_SETTINGS: Settings = {
  lang: 'en',
  handedness: 'right',
  defaultShotType: 'iron',
  defaultView: 'down_the_line',
  toleranceScale: 1,
  sound: true,
  heightCm: 178,
};

/** In-memory store: fallback when IndexedDB is unavailable, and the store used in tests. */
export class MemoryStore implements CoachStore {
  readonly kind = 'memory' as const;
  private swings = new Map<string, Swing>();
  private videos = new Map<string, Blob>();
  private sessions = new Map<string, Session>();
  private targets = new Map<string, TrainingTarget>();
  private progress: FaultProgressRecord[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };

  async saveSwing(s: Swing) {
    this.swings.set(s.id, s);
  }
  async getSwing(id: string) {
    return this.swings.get(id);
  }
  async listSwings(f: { shotType?: ShotType; sessionId?: string; limit?: number } = {}) {
    let list = [...this.swings.values()].sort((a, b) => b.createdAt - a.createdAt);
    if (f.shotType) list = list.filter((s) => s.shotType === f.shotType);
    if (f.sessionId) list = list.filter((s) => s.sessionId === f.sessionId);
    return f.limit ? list.slice(0, f.limit) : list;
  }
  async deleteSwing(id: string) {
    const s = this.swings.get(id);
    if (s?.videoKey) this.videos.delete(s.videoKey);
    this.swings.delete(id);
    this.progress = this.progress.filter((p) => p.swingId !== id);
  }
  async saveVideo(key: string, blob: Blob) {
    this.videos.set(key, blob);
  }
  async getVideo(key: string) {
    return this.videos.get(key);
  }
  async saveSession(s: Session) {
    this.sessions.set(s.id, s);
  }
  async getSession(id: string) {
    return this.sessions.get(id);
  }
  async listSessions(limit?: number) {
    const list = [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
    return limit ? list.slice(0, limit) : list;
  }
  async saveTarget(t: TrainingTarget) {
    this.targets.set(t.id, t);
  }
  async listTargets() {
    return [...this.targets.values()];
  }
  async deleteTarget(id: string) {
    this.targets.delete(id);
  }
  async addProgress(records: FaultProgressRecord[]) {
    this.progress.push(...records);
  }
  async listProgress(f: { faultId?: string; shotType?: ShotType } = {}) {
    return this.progress
      .filter((p) => (!f.faultId || p.faultId === f.faultId) && (!f.shotType || p.shotType === f.shotType))
      .sort((a, b) => a.ts - b.ts);
  }
  async getSettings() {
    return { ...this.settings };
  }
  async saveSettings(s: Settings) {
    this.settings = { ...s };
  }
}
