import { describe, expect, it } from 'vitest';
import { setLang } from '../../coach/i18n/i18n';
import { PoseUnsupportedError, wasmSimdSupported } from '../../coach/pose/wasmSupport';
import { startErrorText } from './startError';

describe('camera / detection start errors (review K3, K5)', () => {
  it('known errors map to player-language texts, unknown ones to nothing', () => {
    setLang('de');
    expect(startErrorText({ name: 'NotAllowedError', message: 'Permission denied' })).toContain('Kamerazugriff');
    expect(startErrorText(new PoseUnsupportedError())).toContain('iOS 16.4');
    expect(startErrorText(new Error('Permission denied'))).toBe('');
    setLang('en');
    expect(startErrorText({ name: 'NotFoundError' })).toContain('No suitable camera');
  });
  it('the SIMD probe module is valid (Node supports WebAssembly SIMD)', () => {
    expect(wasmSimdSupported()).toBe(true);
  });
});
