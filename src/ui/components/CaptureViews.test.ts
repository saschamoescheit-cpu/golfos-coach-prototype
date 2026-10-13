import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyzeSequence, buildSwing } from '../../coach/analysis/analyze';
import { keysOf, setLang } from '../../coach/i18n/i18n';
import type { Swing } from '../../coach/model/types';
import { synthSwing } from '../../coach/testing/synth';
import { CaptureScreen } from '../screens/CaptureScreen';
import { SwingPlayer } from './SwingPlayer';

function demoSwing(view: Swing['view'] = 'down_the_line', handedness: Swing['handedness'] = 'right'): Swing {
  const s = synthSwing({ view, handedness, fps: 30, noise: 0.002 });
  const ctx = { shotType: 'iron' as const, view, handedness };
  const r = analyzeSequence({ raw: s.seq, ctx });
  const swing = buildSwing(r, { id: 'x', sessionId: 's', ctx, source: 'upload' });
  // key frames and a neutral line from the generator truth (phases/club packages are separate)
  swing.keyframes = Object.entries(s.truth.keyframes).map(([position, frameIndex]) => ({
    position: position as Swing['keyframes'][number]['position'],
    frameIndex: frameIndex!,
    t: s.seq.frames[frameIndex!].t,
    confidence: 1,
    method: 'truth',
  }));
  const c0 = s.truth.club[s.truth.keyframes.address!];
  swing.neutralLine = { a: c0.grip, b: c0.head };
  swing.club = s.truth.club;
  return swing;
}

describe('capture / player UI (static render)', () => {
  it('SwingPlayer renders controls, key positions and toggles without a video', () => {
    setLang('en');
    const html = renderToStaticMarkup(createElement(SwingPlayer, { swing: demoSwing() }));
    expect(html).toContain('No video saved');
    expect(html).toContain('Play');
    expect(html).toContain('9 o&#x27;clock back');
    expect(html).toContain('Impact');
    expect(html).toContain('Club line');
    expect(html).toContain('½×');
  });

  it('SwingPlayer compact mode hides toggles; face-on has no neutral line toggle', () => {
    const compact = renderToStaticMarkup(createElement(SwingPlayer, { swing: demoSwing(), compact: true }));
    expect(compact).not.toContain('Body lines');
    const fo = renderToStaticMarkup(createElement(SwingPlayer, { swing: demoSwing('face_on', 'left') }));
    expect(fo).toContain('Body lines');
    expect(fo).not.toContain('Club line');
  });

  it('CaptureScreen setup renders choices and the camera guide in German', () => {
    setLang('de');
    const html = renderToStaticMarkup(createElement(CaptureScreen, { route: { name: 'capture', params: {} } }));
    expect(html).toContain('Was schlägst du?');
    expect(html).toContain('Putt');
    expect(html).toContain('Hüfthöhe');
    expect(html).toContain('Video hochladen');
    setLang('en');
  });

  it('capture and player texts exist in English and German', () => {
    const mine = (lang: 'en' | 'de') => keysOf(lang).filter((k) => k.startsWith('capture.') || k.startsWith('player.')).sort();
    expect(mine('de')).toEqual(mine('en'));
    expect(mine('en').length).toBeGreaterThan(40);
  });
});
