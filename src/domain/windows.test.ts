import { describe, expect, it } from 'vitest';
import type { MarketId, TargetSpec } from './types';
import {
  computeSettlementDeadline,
  contaminated,
  effectiveDeadline,
  firstGap,
  inTargetWindow,
  inWindow,
  isFullyObserved,
  mergeIntervals,
} from './windows';

const target = (nb: string, we: string, at?: string): TargetSpec => ({
  kind: at ? 'AT_INSTANT' : 'WINDOW',
  not_before: nb,
  window_end: we,
  parameters: { interruption_policy: 'CONTINUE', ...(at ? { at_instant: at } : {}) },
});

describe('half-open windows (F1-016, QA16)', () => {
  it('includes the start and excludes the end', () => {
    expect(inWindow(10, 10, 20)).toBe(true);
    expect(inWindow(19, 10, 20)).toBe(true);
    expect(inWindow(20, 10, 20)).toBe(false);
    expect(inWindow(9, 10, 20)).toBe(false);
    const t = target('2026-10-08T15:00:00.000Z', '2026-10-08T15:01:00.000Z');
    expect(inTargetWindow('2026-10-08T15:01:00.000Z', t)).toBe(false);
    expect(inTargetWindow('2026-10-08T15:00:59.999Z', t)).toBe(true);
  });
});

describe('coverage', () => {
  it('merges intervals and finds gaps', () => {
    expect(mergeIntervals([[5, 10], [0, 6], [12, 15]])).toEqual([[0, 10], [12, 15]]);
    const cov = { intervals: [[0, 10], [12, 30]] as Array<[number, number]>, watermark_ms: 30 };
    expect(isFullyObserved(cov, 0, 10)).toBe(true);
    expect(isFullyObserved(cov, 5, 15)).toBe(false);
    expect(firstGap(cov, 5, 15)).toEqual([10, 12]);
    expect(isFullyObserved(cov, 12, 30)).toBe(true);
  });

  it('requires the watermark to pass the window end', () => {
    expect(isFullyObserved({ intervals: [[0, 100]], watermark_ms: 50 }, 0, 80)).toBe(false);
    expect(isFullyObserved({ intervals: [[0, 100]], watermark_ms: 100 }, 0, 80)).toBe(true);
  });
});

describe('contamination (F1-017)', () => {
  it('flags acceptance overlapping the target start within uncertainty', () => {
    expect(contaminated([1000, 1990], 2000, 5)).toBe(false);
    expect(contaminated([1000, 1996], 2000, 5)).toBe(true);
    expect(contaminated([2000], 2000, 0)).toBe(true);
    expect(contaminated([], 2000, 1000)).toBe(false);
  });
});

describe('settlement deadline (F1-067)', () => {
  const nb = '2026-10-08T15:00:00.000Z';
  const we = '2026-10-08T15:01:00.000Z';
  const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
  it.each<[MarketId, number]>([
    ['F1-M03', 120_000],
    ['F1-M07', 120_000],
    ['F1-M09', 120_000],
    ['F1-M10', 120_000],
    ['F1-M12', 120_000],
    ['F1-M20', 120_000],
    ['F1-M01', 120_000],
    ['F1-M04', 180_000],
    ['F1-M05', 180_000],
    ['F1-M06', 180_000],
    ['F1-M08', 600_000],
    ['F1-M19', 120_000],
  ])('%s → window_end + %i ms', (id, offset) => {
    expect(computeSettlementDeadline(id, target(nb, we))).toBe(plus(we, offset));
  });

  it('snapshot at T → T + 120 s', () => {
    const at = '2026-10-08T15:05:00.000Z';
    expect(computeSettlementDeadline('F1-M11', target(nb, at, at))).toBe(plus(at, 120_000));
    expect(computeSettlementDeadline('F1-M21', target(nb, at, at))).toBe(plus(at, 120_000));
  });

  it('M13–M18 → planned end + 24 h, null without a planned time', () => {
    const planned = '2026-10-08T17:00:00.000Z';
    for (const id of ['F1-M13', 'F1-M14', 'F1-M15', 'F1-M16', 'F1-M17', 'F1-M18'] as MarketId[]) {
      expect(computeSettlementDeadline(id, target(nb, we), planned)).toBe(plus(planned, 86_400_000));
      expect(computeSettlementDeadline(id, target(nb, we), null)).toBeNull();
    }
  });

  it('effective deadline never exceeds the outer deadline', () => {
    expect(effectiveDeadline(500, 1000)).toBe(500);
    expect(effectiveDeadline(5000, 1000)).toBe(1000);
    expect(effectiveDeadline(null, 1000)).toBe(1000);
  });
});
