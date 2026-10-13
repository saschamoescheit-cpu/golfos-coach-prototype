import { t } from '../../coach/i18n/i18n';

/** Bottom sheet "are you sure?" – used for deleting swings and for "delete all data". */
export function HistoryConfirmSheet(props: {
  title: string;
  text: string;
  okLabel: string;
  danger?: boolean;
  onOk: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={props.onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {props.text}
        </p>
        <div className="sheet-actions">
          <button className={props.danger ? 'btn-primary btn-danger-fill' : 'btn-primary'} onClick={props.onOk}>
            {props.okLabel}
          </button>
          <button className="btn-secondary" onClick={props.onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
