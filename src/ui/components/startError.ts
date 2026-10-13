import { t } from '../../coach/i18n/i18n';

/**
 * Player-language text for a failed camera / body-detection start (review K3, K5). Known DOMException names map to
 * clear hints; unknown errors give '' so the raw (often English) browser message is never shown.
 */
export function startErrorText(e: unknown): string {
  switch ((e as { name?: string } | null)?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return t('capture.error.cameraDenied');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return t('capture.error.cameraNotFound');
    case 'NotReadableError':
    case 'AbortError':
      return t('capture.error.cameraBusy');
    case 'PoseUnsupportedError':
      return t('capture.error.unsupported');
    default:
      return '';
  }
}
