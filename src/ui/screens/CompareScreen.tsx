import { useCallback, useEffect, useMemo, useState } from 'react';
import { skeletonStatus } from '../../coach/faults/engine';
import { formatValue, metricName } from '../../coach/faults/format';
import { t } from '../../coach/i18n/i18n';
import type { MetricUnit, Swing } from '../../coach/model/types';
import { getStore } from '../../coach/storage';
import { useSettings } from '../../coach/storage/settings';
import { approxCm, commonPositions, compareRows, faultName, formatWhen, syncedFrame, topFault } from '../components/HistoryModel';
import { SwingPlayer } from '../components/SwingPlayer';
import { TopBar } from '../components/TopBar';
import type { Route } from '../nav';
import { ScoreBadge } from './HistoryScreen';
import '../styles/history.css';

interface Loaded {
  swing: Swing;
  url?: string;
}

async function loadSide(id: string | undefined): Promise<Loaded | null> {
  if (!id) return null;
  const store = await getStore();
  const swing = await store.getSwing(id);
  if (!swing) return null;
  let url: string | undefined;
  if (swing.videoKey) {
    const blob = await store.getVideo(swing.videoKey);
    if (blob) url = URL.createObjectURL(blob);
  }
  return { swing, url };
}

/**
 * Two swings side by side (params a, b – a = the older one). Both players are driven by one position: the key-position
 * buttons set both to the matching key frame, the slider moves through both swings in sync (piecewise linear between
 * their own key frames, so different tempos still line up). Below: the measured values of both at that position.
 */
export function CompareScreen({ route }: { route: Route }) {
  const [sides, setSides] = useState<[Loaded, Loaded] | null | 'missing'>(null);
  const [u, setU] = useState(0);
  const settings = useSettings();

  useEffect(() => {
    let alive = true;
    let urls: (string | undefined)[] = [];
    void Promise.all([loadSide(route.params.a), loadSide(route.params.b)]).then(([a, b]) => {
      urls = [a?.url, b?.url];
      if (!alive) return urls.forEach((x) => x && URL.revokeObjectURL(x));
      if (!a || !b) return setSides('missing');
      setSides([a, b]);
      const pos = commonPositions(a.swing, b.swing);
      const top = pos.indexOf('top');
      setU(top >= 0 ? top : 0);
    });
    return () => {
      alive = false;
      urls.forEach((x) => x && URL.revokeObjectURL(x));
    };
  }, [route.params.a, route.params.b]);

  const positions = useMemo(() => (sides && sides !== 'missing' ? commonPositions(sides[0].swing, sides[1].swing) : []), [sides]);
  const statusA = useCallback((i: number) => (sides && sides !== 'missing' ? skeletonStatus(sides[0].swing, i) : {}), [sides]);
  const statusB = useCallback((i: number) => (sides && sides !== 'missing' ? skeletonStatus(sides[1].swing, i) : {}), [sides]);

  if (sides === null) {
    return (
      <div className="screen">
        <TopBar title={t('history.compareScreen.title')} />
        <p className="muted">{t('common.loading')}</p>
      </div>
    );
  }
  if (sides === 'missing') {
    return (
      <div className="screen">
        <TopBar title={t('history.compareScreen.title')} />
        <p className="card">{t('history.compareScreen.notFound')}</p>
      </div>
    );
  }

  const [A, B] = sides;
  const exact = Number.isInteger(u) ? positions[u] : undefined;
  const fa = positions.length ? syncedFrame(A.swing, positions, u) : undefined;
  const fb = positions.length ? syncedFrame(B.swing, positions, u) : undefined;
  const rowsAt = exact ? compareRows(A.swing, B.swing, exact) : [];
  const rowsSwing = compareRows(A.swing, B.swing, 'swing');

  return (
    <div className="screen compare">
      <TopBar title={t('history.compareScreen.title')} />

      {A.swing.view !== B.swing.view && <p className="card hint-bad small">✕ {t('history.compareScreen.differentView')}</p>}
      {A.swing.shotType !== B.swing.shotType && (
        <p className="muted small" style={{ margin: 0 }}>
          {t('history.compareScreen.differentShot', { a: t(`common.shot.${A.swing.shotType}`), b: t(`common.shot.${B.swing.shotType}`) })}
        </p>
      )}

      <div className="compare-players">
        {[A, B].map((s, k) => (
          <div className="side" key={s.swing.id}>
            <div className="side-label">
              <span className="tag">{k === 0 ? t('history.compareScreen.a') : t('history.compareScreen.b')}</span>
              <span>{formatWhen(s.swing.createdAt)}</span>
            </div>
            <SwingPlayer
              swing={s.swing}
              videoUrl={s.url}
              compact
              showKeyBar={false}
              editableLine={false}
              frameIndex={k === 0 ? fa : fb}
              lineStatus={k === 0 ? statusA : statusB}
            />
          </div>
        ))}
      </div>

      {positions.length > 0 && (
        <>
          <div className="pos-bar" role="group" aria-label={t('history.compareScreen.slider')}>
            {positions.map((p, i) => (
              <button key={p} className="chip" aria-pressed={u === i} onClick={() => setU(i)}>
                {t(`common.pos.${p}`)}
              </button>
            ))}
          </div>
          {positions.length > 1 && (
            <input
              className="sync-slider"
              type="range"
              min={0}
              max={positions.length - 1}
              step={0.02}
              value={u}
              aria-label={t('history.compareScreen.slider')}
              onChange={(e) => {
                const v = Number(e.target.value);
                // snap onto a key position when close, so the table shows its values
                const r = Math.round(v);
                setU(Math.abs(v - r) < 0.05 ? r : v);
              }}
            />
          )}
          <p className="muted small" style={{ margin: 0 }}>
            {t('history.compareScreen.syncHint')}
          </p>
        </>
      )}

      <section className="card">
        <table className="compare-table">
          <thead>
            <tr>
              <th>{exact ? t('history.compareScreen.atPosition', { pos: t(`common.pos.${exact}`) }) : t('history.compareScreen.table')}</th>
              <th>{t('history.compareScreen.a')}</th>
              <th>{t('history.compareScreen.b')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('history.compareScreen.score')}</td>
              <td>
                <ScoreBadge score={A.swing.score?.total} />
              </td>
              <td>
                <ScoreBadge score={B.swing.score?.total} />
              </td>
            </tr>
            <tr>
              <td>{t('history.compareScreen.topFault')}</td>
              {[A, B].map((s) => {
                const f = topFault(s.swing);
                return (
                  <td key={s.swing.id} className={f ? 'status-bad' : 'status-ok'}>
                    {f ? `✕ ${faultName(f.defId)}` : t('history.noFault')}
                  </td>
                );
              })}
            </tr>
            {exact && rowsAt.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  {t('history.compareScreen.noValues')}
                </td>
              </tr>
            )}
            {rowsAt.map((r) => (
              <MetricRow key={r.metric} label={metricName(r.metric)} unit={r.unit} a={r.a} b={r.b} heightCm={settings.heightCm} />
            ))}
            {rowsSwing.length > 0 && (
              <tr>
                <th colSpan={3} style={{ paddingTop: 16 }}>
                  {t('history.compareScreen.wholeSwing')}
                </th>
              </tr>
            )}
            {rowsSwing.map((r) => (
              <MetricRow key={r.metric} label={metricName(r.metric)} unit={r.unit} a={r.a} b={r.b} heightCm={settings.heightCm} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function MetricRow({ label, unit, a, b, heightCm }: { label: string; unit: MetricUnit; a?: number; b?: number; heightCm: number }) {
  const cell = (v?: number) =>
    v === undefined ? (
      <span className="muted">{t('history.metric.noValue')}</span>
    ) : (
      <>
        {formatValue(v, unit)}
        {unit === 'pct_torso' && <span className="sub">{t('history.metric.approxCm', { cm: approxCm(v, heightCm) })}</span>}
      </>
    );
  return (
    <tr>
      <td>{label}</td>
      <td>{cell(a)}</td>
      <td>{cell(b)}</td>
    </tr>
  );
}
