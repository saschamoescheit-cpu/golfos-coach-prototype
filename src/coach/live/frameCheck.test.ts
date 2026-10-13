import { describe, expect, it } from 'vitest';
import { synthSwing } from '../testing/synth';
import { cameraTilted, IssueDebouncer, liveFrameIssues } from './frameCheck';

const address = (p = {}) => synthSwing({ fps: 30, ...p }).seq.frames[0].lm!;

describe('live frame checks', () => {
  it('normal set-up has no issues', () => {
    expect(liveFrameIssues(address(), { needsHeadroom: true })).toEqual([]);
  });
  it('no person', () => {
    expect(liveFrameIssues(null)).toEqual(['no_person']);
  });
  it('feet cut off', () => {
    const lm = address().map((p) => ({ ...p, y: p.y + 0.15 }));
    expect(liveFrameIssues(lm)).toContain('body_cut_off');
  });
  it('head cut off', () => {
    const a = address();
    const lm = a.map((p) => ({ ...p, y: p.y - a[0].y - 0.02 }));
    expect(liveFrameIssues(lm)).toContain('body_cut_off');
  });
  it('too far away', () => {
    expect(liveFrameIssues(address({ zoom: 0.4 }))).toContain('too_far');
  });
  it('head close to the top edge → no room for the club (full swing only)', () => {
    const a = address();
    const lm = a.map((p) => ({ ...p, y: p.y - a[0].y + 0.1 }));
    expect(liveFrameIssues(lm, { needsHeadroom: true })).toContain('no_headroom');
    expect(liveFrameIssues(lm, { needsHeadroom: false })).not.toContain('no_headroom');
  });
  it('several people', () => {
    expect(liveFrameIssues(address(), { people: 2 })).toContain('multiple_people');
  });
  it('tilt', () => {
    expect(cameraTilted(88, 2)).toBe(false);
    expect(cameraTilted(90, 15)).toBe(true);
    expect(cameraTilted(45, 0)).toBe(true);
    expect(cameraTilted(null, null)).toBe(false);
  });
  it('debouncer shows an issue only when it lasts and hides it with a delay', () => {
    const d = new IssueDebouncer<'a' | 'b'>(500, 700);
    expect(d.push(['a'], 0)).toEqual([]);
    expect(d.push(['a', 'b'], 300)).toEqual([]);
    expect(d.push(['a'], 600)).toEqual(['a']); // b vanished before it was shown
    expect(d.push([], 1000)).toEqual(['a']);
    expect(d.push([], 1400)).toEqual([]);
  });
});
