import type { FaultProgressRecord, Session, Settings, ShotType, Swing, TrainingTarget } from '../model/types';

/**
 * Local persistence (no server, no accounts). Implementation: IndexedDB with an in-memory fallback
 * (Safari private mode, tests). Videos are stored as Blobs under their own key.
 */
export interface CoachStore {
  saveSwing(swing: Swing): Promise<void>;
  getSwing(id: string): Promise<Swing | undefined>;
  listSwings(filter?: { shotType?: ShotType; sessionId?: string; limit?: number }): Promise<Swing[]>;
  deleteSwing(id: string): Promise<void>;

  saveVideo(key: string, blob: Blob): Promise<void>;
  getVideo(key: string): Promise<Blob | undefined>;

  saveSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  listSessions(limit?: number): Promise<Session[]>;

  saveTarget(target: TrainingTarget): Promise<void>;
  listTargets(): Promise<TrainingTarget[]>;
  deleteTarget(id: string): Promise<void>;

  addProgress(records: FaultProgressRecord[]): Promise<void>;
  listProgress(filter?: { faultId?: string; shotType?: ShotType }): Promise<FaultProgressRecord[]>;

  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  /** 'indexeddb' or 'memory' (fallback – data lost on reload; the UI shows a hint) */
  readonly kind: 'indexeddb' | 'memory';
}
