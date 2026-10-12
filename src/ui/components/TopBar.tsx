import type { ReactNode } from 'react';
import { back } from '../nav';
import { t } from '../../coach/i18n/i18n';

export function TopBar({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="topbar">
      <button className="icon-btn" onClick={back} aria-label={t('common.back')}>
        ←
      </button>
      <h1>{title}</h1>
      {right}
    </div>
  );
}
