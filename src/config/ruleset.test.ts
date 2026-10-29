import { describe, expect, it } from 'vitest';
import {
  RULESET_2026_ISS09,
  advancingCount,
  buildSegments,
  eliminationPlan,
  formatSegmentClock,
  getRuleset,
  nextSegment,
  plannedSessionEnd,
  segmentDurationMs,
} from './ruleset';

const START = '2026-10-08T14:00:00.000Z';
const MIN = 60_000;

describe('ruleset fia-2026-sb-iss09 (F1-006)', () => {
  it('is versioned and resolvable', () => {
    expect(RULESET_2026_ISS09.id).toBe('fia-2026-sb-iss09');
    expect(getRuleset('fia-2026-sb-iss09')).toBe(RULESET_2026_ISS09);
    expect(() => getRuleset('fia-2025-legacy')).toThrow(/Unknown ruleset/);
  });

  it('Q1/Q2/Q3 = 18/15/13 min and SQ1/SQ2/SQ3 = 12/10/8 min', () => {
    expect(['Q1', 'Q2', 'Q3'].map((s) => segmentDurationMs(s as 'Q1') / MIN)).toEqual([18, 15, 13]);
    expect(['SQ1', 'SQ2', 'SQ3'].map((s) => segmentDurationMs(s as 'SQ1') / MIN)).toEqual([12, 10, 8]);
  });

  it('22 cars → first two parts eliminate six each; odd counts give the first part the extra car', () => {
    expect(eliminationPlan(22)).toEqual([6, 6, 0]);
    expect(eliminationPlan(20)).toEqual([5, 5, 0]);
    expect(eliminationPlan(21)).toEqual([6, 5, 0]);
    expect(eliminationPlan(10)).toEqual([0, 0, 0]);
  });

  it('buildSegments produces contiguous planned parts with 7–8 min gaps', () => {
    const q = buildSegments('QUALIFYING', START, 22);
    expect(q.map((s) => s.segment_id)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(q.map((s) => s.eliminated)).toEqual([6, 6, 0]);
    expect(q[0]!.planned_start_at).toBe(START);
    const gap1 = Date.parse(q[1]!.planned_start_at) - Date.parse(q[0]!.planned_end_at);
    const gap2 = Date.parse(q[2]!.planned_start_at) - Date.parse(q[1]!.planned_end_at);
    expect([gap1, gap2].every((g) => g >= 7 * MIN && g <= 8 * MIN)).toBe(true);
    for (const s of q) expect(Date.parse(s.planned_end_at) - Date.parse(s.planned_start_at)).toBe(s.duration_ms);
    expect(buildSegments('SPRINT_QUALIFYING', START, 22).map((s) => s.duration_ms / MIN)).toEqual([12, 10, 8]);
    expect(buildSegments('GRAND_PRIX', START, 22)).toEqual([]);
  });

  it('planned session end and progression counts derive from the manifest segments', () => {
    const q = buildSegments('QUALIFYING', START, 22);
    expect(plannedSessionEnd('QUALIFYING', START, 22)).toBe(q[2]!.planned_end_at);
    expect(plannedSessionEnd('GRAND_PRIX', START)).toBe('2026-10-08T16:00:00.000Z');
    expect(advancingCount(q, 'Q1', 22)).toBe(16);
    expect(advancingCount(q, 'Q2', 22)).toBe(10);
    expect(nextSegment('Q2')).toBe('Q3');
    expect(nextSegment('Q3')).toBeNull();
    expect(nextSegment('SQ3')).toBeNull();
  });

  it('formats the initial segment clock', () => {
    expect(formatSegmentClock(segmentDurationMs('Q3'))).toBe('13:00');
    expect(formatSegmentClock(segmentDurationMs('Q1'))).toBe('18:00');
    expect(formatSegmentClock(segmentDurationMs('SQ3'))).toBe('08:00');
    expect(formatSegmentClock(61_200)).toBe('01:02');
  });
});
