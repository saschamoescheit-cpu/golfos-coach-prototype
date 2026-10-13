import { useEffect, useRef, useState } from 'react';
import { getFaultDef } from '../../coach/faults/catalog';
import { t } from '../../coach/i18n/i18n';
import type { Session, Settings, TrainingTarget } from '../../coach/model/types';
import { getStore } from '../../coach/storage';
import { DEFAULT_SETTINGS } from '../../coach/storage/memory';
import { newId } from '../../coach/storage/save';
import { getTrainingAudio } from '../../coach/training/audio';
import { saveTarget, supportsMirror, targetFromFault } from '../../coach/training/targets';
import { LiveTraining, type LiveTrainingResult, type TrainingMode } from '../components/LiveTraining';
import { TopBar } from '../components/TopBar';
import { TrainingPicker } from '../components/TrainingPicker';
import { TrainingSetup } from '../components/TrainingSetup';
import { TrainingSummary } from '../components/TrainingSummary';
import { back, type Route } from '../nav';
import '../styles/training.css';

/**
 * Training mode (US-1.9 mirror, US-1.10 ball series). OWNER: agent "training".
 * Route params: faultId (train this correction; with swingId its shot type/view are used), swingId (pre-select this
 * swing as reference), targetId (a saved target).
 * Flow: pick target → set-up (mode, tolerance, camera hint) → live → summary. The Session (with series results) is
 * saved after every swing and at the end.
 */
type Step = 'loading' | 'pick' | 'setup' | 'live' | 'summary';

export function TrainingScreen({ route }: { route: Route }) {
  const { faultId, swingId, targetId } = route.params;
  const [step, setStep] = useState<Step>('loading');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [target, setTarget] = useState<TrainingTarget | null>(null);
  const [mode, setMode] = useState<TrainingMode>('mirror');
  const [ballGoal, setBallGoal] = useState<number | null>(10);
  const [result, setResult] = useState<LiveTrainingResult | null>(null);
  const session = useRef<Session | null>(null);

  useEffect(() => {
    let off = false;
    void (async () => {
      const store = await getStore();
      const st = await store.getSettings();
      if (off) return;
      setSettings(st);
      let tg: TrainingTarget | null = null;
      if (targetId) tg = (await store.listTargets()).find((x) => x.id === targetId) ?? null;
      if (!tg && faultId) {
        const def = getFaultDef(faultId);
        const sw = swingId ? await store.getSwing(swingId) : undefined;
        if (def) tg = targetFromFault(def, { shotType: sw?.shotType ?? st.defaultShotType, view: sw?.view ?? st.defaultView });
      }
      if (off) return;
      if (tg) choose(tg);
      else setStep('pick');
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faultId, swingId, targetId]);

  const choose = (tg: TrainingTarget) => {
    setTarget(tg);
    setMode(supportsMirror(tg) ? 'mirror' : 'series');
    setStep('setup');
  };

  const saveSession = async (r: LiveTrainingResult) => {
    const s = session.current;
    if (!s) return;
    const withSwing = r.shots.filter((x) => x.swingId);
    const next: Session = {
      ...s,
      swingIds: withSwing.map((x) => x.swingId!),
      results:
        s.mode === 'series'
          ? withSwing.filter((x) => x.outcome !== 'unknown').map((x) => ({ swingId: x.swingId!, hit: x.outcome === 'hit', proximity: x.proximity ?? 0 }))
          : undefined,
    };
    session.current = next;
    try {
      await (await getStore()).saveSession(next);
    } catch {
      // storage problems must not stop the training
    }
  };

  const start = () => {
    if (!target) return;
    // iOS: audio may only be unlocked inside this tap
    const audio = getTrainingAudio();
    audio.enabled = settings.sound;
    void audio.unlock();
    void saveTarget(target).catch(() => {});
    session.current = {
      id: newId('ses'),
      createdAt: Date.now(),
      mode,
      shotType: target.shotType,
      view: target.view,
      handedness: settings.handedness,
      swingIds: [],
      targetId: target.id,
      results: mode === 'series' ? [] : undefined,
    };
    void saveSession({ shots: [], tally: { hits: 0, judged: 0, unknown: 0, practice: 0 }, mirror: { reached: 0, held: 0 } });
    setResult(null);
    setStep('live');
  };

  const end = (r: LiveTrainingResult) => {
    setResult(r);
    void saveSession(r);
    setStep('summary');
  };

  if (step === 'live' && target && session.current) {
    return (
      <LiveTraining
        target={target}
        mode={mode}
        ctx={{ shotType: target.shotType, view: target.view, handedness: settings.handedness }}
        toleranceScale={settings.toleranceScale}
        sound={settings.sound}
        ballGoal={mode === 'series' ? ballGoal : null}
        sessionId={session.current.id}
        onProgress={(r) => void saveSession(r)}
        onEnd={end}
      />
    );
  }

  return (
    <div className="screen">
      <TopBar title={t('training.title')} />
      {step === 'loading' && <p className="muted">{t('common.loading')}</p>}
      {step === 'pick' && <TrainingPicker settings={settings} initialSwingId={faultId ? undefined : swingId} onPick={choose} />}
      {step === 'setup' && target && (
        <TrainingSetup
          target={target}
          settings={settings}
          mode={mode}
          ballGoal={ballGoal}
          onTarget={setTarget}
          onMode={setMode}
          onBallGoal={setBallGoal}
          onStart={start}
          onChangeTarget={() => setStep('pick')}
        />
      )}
      {step === 'summary' && target && result && (
        <TrainingSummary target={target} mode={mode} result={result} onAgain={() => setStep('setup')} onDone={back} />
      )}
    </div>
  );
}
