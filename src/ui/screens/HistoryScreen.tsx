import { useCallback, useEffect, useMemo, useState } from 'react';
import { scoreColor } from '../../coach/faults/score';
import { t } from '../../coach/i18n/i18n';
import { ALL_SHOT_TYPES } from '../../coach/model/constants';
import type { FaultProgressRecord, ShotType, Swing } from '../../coach/model/types';
import { getStore } from '../../coach/storage';
import { progressOverview, type FaultProgress } from '../../coach/storage/progress';
import { HistoryConfirmSheet } from '../components/HistoryConfirmSheet';
import { faultName, formatWhen, groupByShotType, progressSentence, shotTypeCounts, topFault } from '../components/HistoryModel';
import { ProgressBars } from '../components/ProgressBars';
import { TopBar } from '../components/TopBar';
import { go, type Route } from '../nav';
import '../styles/history.css';

const GROUP_PREVIEW = 4;

/** Swing history (work package F): list by shot type, select 2 → compare, delete, per-fault progress. */
export function HistoryScreen({ route }: { route: Route }) {
  const initialShot = ALL_SHOT_TYPES.includes(route.params.shotType as ShotType) ? (route.params.shotType as ShotType) : undefined;
  const [swings, setSwings] = useState<Swing[] | null>(null);
  const [progress, setProgress] = useState<FaultProgressRecord[]>([]);
  const [memoryMode, setMemoryMode] = useState(false);
  const [filter, setFilter] = useState<ShotType | undefined>(initialShot);
  const [tab, setTab] = useState<'swings' | 'progress'>(route.params.tab === 'progress' ? 'progress' : 'swings');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    const store = await getStore();
    setMemoryMode(store.kind === 'memory');
    const [list, rows] = await Promise.all([store.listSwings(), store.listProgress()]);
    setSwings(list);
    setProgress(rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => shotTypeCounts(swings ?? []), [swings]);
  const visible = useMemo(() => (swings ?? []).filter((s) => !filter || s.shotType === filter), [swings, filter]);
  const faults = useMemo(() => progressOverview(progress, { shotType: filter }), [progress, filter]);

  const toggle = (id: string) => setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  const endSelect = () => {
    setSelecting(false);
    setSelected([]);
  };

  const doDelete = async () => {
    const store = await getStore();
    for (const id of selected) await store.deleteSwing(id);
    setConfirm(false);
    endSelect();
    await load();
  };

  const item = (s: Swing) => <SwingRow key={s.id} swing={s} selecting={selecting} selected={selected.includes(s.id)} onTap={() => (selecting ? toggle(s.id) : go('analysis', { swingId: s.id }))} />;

  return (
    <div className="screen history">
      <TopBar
        title={t('history.title')}
        right={
          tab === 'swings' && swings?.length ? (
            <button className="btn-ghost" onClick={() => (selecting ? endSelect() : setSelecting(true))}>
              {selecting ? t('common.done') : t('history.select')}
            </button>
          ) : undefined
        }
      />

      {memoryMode && <p className="card hint-bad small">{t('history.memoryMode')}</p>}

      {swings && swings.length > 0 && (
        <>
          <div className="segmented" role="tablist">
            {(['swings', 'progress'] as const).map((x) => (
              <button key={x} role="tab" aria-pressed={tab === x} aria-selected={tab === x} onClick={() => setTab(x)}>
                {t(x === 'swings' ? 'history.tabSwings' : 'history.tabProgress')}
              </button>
            ))}
          </div>
          {counts.length > 1 && (
            <div className="chip-row" role="group" aria-label={t('common.shotType')}>
              <button className="chip" aria-pressed={!filter} onClick={() => setFilter(undefined)}>
                {t('history.all')} <span className="n">{swings.length}</span>
              </button>
              {counts.map((c) => (
                <button key={c.shotType} className="chip" aria-pressed={filter === c.shotType} onClick={() => setFilter(c.shotType)}>
                  {t(`common.shot.${c.shotType}`)} <span className="n">{c.count}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {swings === null && <p className="muted">{t('common.loading')}</p>}

      {swings?.length === 0 && (
        <div className="card empty-state">
          <h2>{t('history.empty.title')}</h2>
          <p className="muted">{t('history.empty.text')}</p>
          <button className="btn-primary" onClick={() => go('capture')}>
            {t('history.empty.cta')}
          </button>
        </div>
      )}

      {tab === 'swings' && swings && swings.length > 0 && (
        <>
          {selecting && <p className="muted small" style={{ margin: 0 }}>{t('history.selectHint')}</p>}
          {filter ? (
            <ul className="list">{visible.map(item)}</ul>
          ) : (
            groupByShotType(visible).map((g) => (
              <section key={g.shotType} className="history-group">
                <h2>
                  {t(`common.shot.${g.shotType}`)} <span className="muted small">· {g.swings.length}</span>
                </h2>
                <ul className="list">{g.swings.slice(0, selecting ? undefined : GROUP_PREVIEW).map(item)}</ul>
                {!selecting && g.swings.length > GROUP_PREVIEW && (
                  <button className="btn-ghost" onClick={() => setFilter(g.shotType)}>
                    {t('history.showAll', { n: g.swings.length })}
                  </button>
                )}
              </section>
            ))
          )}
        </>
      )}

      {tab === 'progress' && swings && swings.length > 0 && <ProgressList faults={faults} />}

      {selecting && (
        <div className="action-bar">
          <span className="small muted">{t('history.selected', { n: selected.length })}</span>
          <div className="action-bar-buttons">
            <button className="btn-secondary btn-danger" disabled={!selected.length} onClick={() => setConfirm(true)}>
              {t('history.deleteN', { n: selected.length })}
            </button>
            <button
              className="btn-primary"
              disabled={selected.length !== 2}
              title={selected.length !== 2 ? t('history.compareTwo') : undefined}
              onClick={() => {
                const [a, b] = [...selected].sort((x, y) => (swings!.find((s) => s.id === x)!.createdAt - swings!.find((s) => s.id === y)!.createdAt));
                endSelect();
                go('compare', { a, b });
              }}
            >
              {t('history.compare')}
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <HistoryConfirmSheet
          title={selected.length === 1 ? t('history.confirmDelete.titleOne') : t('history.confirmDelete.titleMany', { n: selected.length })}
          text={t('history.confirmDelete.text')}
          okLabel={t('history.confirmDelete.ok')}
          danger
          onOk={() => void doDelete()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  const has = score !== null && score !== undefined && Number.isFinite(score);
  return (
    <span className={`score-badge score-${scoreColor(score)}`} aria-label={has ? t('history.scoreLabel', { n: Math.round(score!) }) : undefined}>
      {has ? Math.round(score!) : t('history.noScore')}
    </span>
  );
}

function SwingRow({ swing, selecting, selected, onTap }: { swing: Swing; selecting: boolean; selected: boolean; onTap: () => void }) {
  const f = topFault(swing);
  const uncertain = !f && swing.checkedFaultIds.length === 0;
  return (
    <li>
      <button className={`list-item swing-row${selected ? ' selected' : ''}`} onClick={onTap} aria-pressed={selecting ? selected : undefined}>
        <ScoreBadge score={swing.score?.total} />
        <span className="grow">
          <span className={`title${f ? '' : uncertain ? ' muted' : ' status-ok'}`}>{f ? faultName(f.defId) : uncertain ? t('history.notReliable') : t('history.noFault')}</span>
          <span className="small muted">
            {formatWhen(swing.createdAt)} · {t(`common.shot.${swing.shotType}`)} · {t(`common.viewShort.${swing.view}`)}
          </span>
        </span>
        {selecting ? <span className={`check${selected ? ' on' : ''}`} aria-hidden="true">{selected ? '✓' : ''}</span> : <span className="chev" aria-hidden="true">›</span>}
      </button>
    </li>
  );
}

function ProgressList({ faults }: { faults: FaultProgress[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!faults.length) return <p className="card muted">{t('history.progress.empty')}</p>;
  return (
    <>
      <p className="muted small" style={{ margin: 0 }}>
        {t('history.progress.intro')}
      </p>
      <ul className="list">
        {faults.map((p) => {
          const name = faultName(p.faultId);
          const isOpen = open === p.faultId;
          return (
            <li key={p.faultId} className="card progress-card">
              <button className="progress-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.faultId)}>
                <span className="grow">
                  <span className="title">{name}</span>
                  <span className={`small trend-${p.trend}`}>{t(`history.progress.trend.${p.trend}`)}</span>
                </span>
                <span className="chev" aria-hidden="true">
                  {isOpen ? '⌃' : '⌄'}
                </span>
              </button>
              <ProgressBars points={p.points} ariaLabel={`${name}: ${progressSentence(p)}`} />
              <p className="small" style={{ margin: 0 }}>
                {progressSentence(p)}
              </p>
              {isOpen && (
                <div className="progress-detail">
                  <p className="muted small" style={{ margin: 0 }}>
                    {t('history.progress.legend')} {t('history.progress.swingsChecked', { n: p.points.length })}
                  </p>
                  <button className="btn-secondary" onClick={() => go('training', { faultId: p.faultId })}>
                    🎯 {t('history.progress.train')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
