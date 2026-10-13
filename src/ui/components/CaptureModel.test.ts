import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../coach/storage/memory';
import { applyLoadedSettings, initialCaptureChoice, type CaptureField } from './CaptureModel';

const stored = { ...defaultSettings(), defaultShotType: 'driver' as const, defaultView: 'down_the_line' as const, handedness: 'left' as const };

describe('capture setup vs. late settings (review W6)', () => {
  it('start: route params win over settings, settings over defaults', () => {
    expect(initialCaptureChoice({}, null)).toEqual({ shotType: 'iron', view: 'face_on', hand: 'right' });
    expect(initialCaptureChoice({}, stored)).toEqual({ shotType: 'driver', view: 'down_the_line', hand: 'left' });
    expect(initialCaptureChoice({ shotType: 'pitch' }, stored)).toEqual({ shotType: 'pitch', view: 'down_the_line', hand: 'left' });
    // putt from the route + DTL from the settings → face-on (L3)
    expect(initialCaptureChoice({ shotType: 'putt' }, stored).view).toBe('face_on');
  });

  it('late settings fill only untouched fields', () => {
    const start = initialCaptureChoice({}, null);
    expect(applyLoadedSettings(start, new Set(), {}, stored)).toEqual({ shotType: 'driver', view: 'down_the_line', hand: 'left' });
    const tapped = { ...start, view: 'down_the_line' as const, hand: 'right' as const };
    const touched = new Set<CaptureField>(['view', 'hand']);
    expect(applyLoadedSettings(tapped, touched, {}, { ...stored, defaultView: 'face_on' })).toEqual({
      shotType: 'driver',
      view: 'down_the_line',
      hand: 'right',
    });
  });

  it('route params are never overwritten', () => {
    const start = initialCaptureChoice({ shotType: 'chip', view: 'face_on' }, null);
    expect(applyLoadedSettings(start, new Set(), { shotType: 'chip', view: 'face_on' }, stored)).toEqual({ shotType: 'chip', view: 'face_on', hand: 'left' });
  });
});
