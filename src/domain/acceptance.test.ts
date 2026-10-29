/**
 * SRS §11 acceptance items with domain scope (F1-QA01 … QA18, QA21 … QA27).
 * QA19 (WebGL context loss) and QA20 (RU/EN layouts) are UI-level checks.
 */
import { describe, expect, it } from 'vitest';
import { RULESET_2026_ISS09, formatSegmentClock, segmentDurationMs } from '@/config/ruleset';
import { ALL_DRIVERS, afterDeadline, session } from './__fixtures__/builder';
import { R } from './__fixtures__/expect';
import { isMarketAvailable } from './capabilities';
import { raceControlTransitions } from './events/raceControl';
import { CATALOG } from './markets/catalog';
import { PoolValidationError } from './markets/factory';
import { F1_I18N } from './markets/i18n';
import { canAcceptEntry, advancePool } from './lifecycle';
import { settlePool, settlementPhase } from './settlement';

const NB = 600_000;
const END = NB + 60_000;
const HOUR = 3_600_000;

describe('SRS §11 acceptance (domain)', () => {
  it('F1-QA01: DEMO Q3 timer is 13:00; nothing presents 12:00 as the Q3 duration', () => {
    const q = session({ type: 'QUALIFYING' });
    const q3 = q.manifest.segments!.find((s) => s.segment_id === 'Q3')!;
    expect(formatSegmentClock(q3.duration_ms)).toBe('13:00');
    expect(formatSegmentClock(segmentDurationMs('Q3'))).toBe('13:00');
    expect(RULESET_2026_ISS09.qualifying.segments.find((s) => s.segment_id === 'Q3')!.duration_ms).not.toBe(12 * 60_000);
    for (const dict of [F1_I18N.ru, F1_I18N.en]) expect(Object.values(dict).some((v) => v.includes('12:00'))).toBe(false);
  });

  it('F1-QA02: 22 cars — Q1 and SQ1 durations differ; six are eliminated per manifest', () => {
    const q = session({ type: 'QUALIFYING' }).manifest.segments!;
    const sq = session({ type: 'SPRINT_QUALIFYING' }).manifest.segments!;
    expect(q[0]!.duration_ms).toBe(18 * 60_000);
    expect(sq[0]!.duration_ms).toBe(12 * 60_000);
    expect(q[0]!.duration_ms).not.toBe(sq[0]!.duration_ms);
    expect(q.map((x) => x.eliminated)).toEqual([6, 6, 0]);
    expect(sq.map((x) => x.eliminated)).toEqual([6, 6, 0]);
  });

  it('F1-QA03: an A/B swap through a pit stop updates M01 but gives M07 no ON_TRACK_PASS', () => {
    const s = session();
    const m01 = s.shortPool('F1-M01', { driver_a: 'nor', target_lap: 20, lap_anchor: 'LEADER' }, NB);
    const m07 = s.shortPool('F1-M07', { driver_a: 'nor', driver_b: 'lec' }, NB);
    s.timing(NB - 30_000, ['ver', 'lec', 'nor'], { leaderLap: 19 });
    s.pitStop('lec', NB + 2_000, { visit: 'l1', compound: 'HARD' });
    s.timing(NB + 40_000, ['ver', 'nor', 'lec'], { leaderLap: 20, anchorLap: 20 });
    expect(R(s.resolve(m01, END + 1))).toBe('P2');
    expect(R(s.resolve(m07, END + 1))).toBe('NO_PASS');
  });

  it('F1-QA04: a post-race penalty changes the classification revision, never creates a pass', () => {
    const s = session();
    const m13 = s.pool('F1-M13', { driver_a: 'nor' }, { closes: 0 });
    const order = ['nor', ...ALL_DRIVERS.filter((d) => d !== 'nor')];
    s.classification(2 * HOUR, order, { revision: 1 });
    expect(R(s.resolve(m13, 2 * HOUR + 1_000))).toBe('P1');
    const penalised = [order[1]!, order[2]!, order[3]!, order[0]!, ...order.slice(4)];
    s.classification(2 * HOUR + 1_800_000, penalised, { revision: 2 });
    expect(R(s.resolve(m13, 2 * HOUR + 1_900_000))).toBe('P4_10');
    expect(s.store().canonical().some((e) => e.type === 'ON_TRACK_PASS')).toBe(false);
  });

  it('F1-QA05: a lapped car physically passed → no M07 event', () => {
    const s = session();
    const m07 = s.shortPool('F1-M07', { driver_a: 'nor', driver_b: 'lec' }, NB);
    s.pass(NB + 10_000, 'nor', 'lec', { lap: 30, passedLap: 29 });
    expect(R(s.resolve(m07, END + 1))).toBe('NO_PASS');
  });

  it('F1-QA06 / QA07 / QA08: stop buckets, drive-through and red-flag interruption', () => {
    const stop = (ms: number | null, service: 'TYRES' | 'DRIVE_THROUGH' = 'TYRES', red = false) => {
      const s = session();
      s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
      if (red) s.rc(NB + 15_000, 'RED');
      s.pitExit('nor', NB + 30_000, { visit: 'v1', stop: ms, lane: 20_000, service, red });
      return { m05: R(s.resolve(s.shortPool('F1-M05', { driver_a: 'nor' }, NB), END)), m06: R(s.resolve(s.shortPool('F1-M06', { driver_a: 'nor' }, NB), END)) };
    };
    expect(stop(2_500).m05).toBe('BUCKET_2');
    expect(stop(3_000).m05).toBe('BUCKET_3');
    expect(stop(null, 'DRIVE_THROUGH')).toEqual({ m05: 'NO_SERVICE', m06: 'BUCKET_1' });
    expect(stop(2_400, 'TYRES', true)).toEqual({ m05: 'VOID:INTERRUPTED', m06: 'VOID:INTERRUPTED' });
  });

  it('F1-QA09: VSC → SC with a repeated message is two transitions', () => {
    const s = session();
    s.rc(1_000, 'VSC', { messageId: 'rc-17' });
    s.rc(9_000, 'SC', { messageId: 'rc-18' });
    s.rc(9_400, 'SC', { messageId: 'rc-18' });
    expect(raceControlTransitions(s.store().canonical())).toHaveLength(2);
  });

  it('F1-QA10: without location, classification and timing markets keep working', () => {
    const s = session({ unavailable: ['location', 'aero_mode'] });
    for (const id of ['F1-M01', 'F1-M11', 'F1-M13'] as const) expect(isMarketAvailable(CATALOG[id], s.manifest)).toBe(true);
    const m13 = s.pool('F1-M13', { driver_a: 'nor' }, { closes: 0 });
    s.classification(2 * HOUR, ['ver', 'nor']);
    expect(R(s.resolve(m13, 2 * HOUR + 1_000))).toBe('P2_3');
  });

  it('F1-QA11 / QA12: NONE only with full coverage; a feed gap → VOID', () => {
    const full = session();
    const p = full.shortPool('F1-M10', {}, NB);
    expect(R(full.resolve(p, END + 1))).toBe('NONE');
    const gap = session().gap(NB + 5_000, NB + 6_000);
    const g = gap.shortPool('F1-M10', {}, NB);
    expect(R(gap.resolve(g, afterDeadline(gap, g)))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('F1-QA13: invalidating the best lap recalculates M09 and M16 deterministically', () => {
    const s = session();
    const m09 = s.shortPool('F1-M09', {}, NB);
    s.lap('nor', NB + 10_000, { lap: 8, time: 83_900 });
    s.lap('lec', NB + 12_000, { lap: 8, time: 84_000 });
    s.invalidateLap('nor', NB + 40_000, { lap: 8 });
    const a = s.resolve(m09, END + 1);
    expect(R(a)).toBe('lec');
    expect(s.resolve(m09, END + 1)).toEqual(a);
  });

  it('F1-QA14: a lapped driver keeps driver_lap distinct from leader_lap', () => {
    const s = session();
    const m01 = s.shortPool('F1-M01', { driver_a: 'nor', target_lap: 25, lap_anchor: 'LEADER' }, NB);
    s.timing(NB + 5_000, ['ver', 'lec', { driver_id: 'nor', driver_laps: 24, position: 12 }], { leaderLap: 25, anchorLap: 25 });
    const out = s.resolve(m01, NB + 10_000);
    expect(out.state === 'RESOLVED' && out.values).toMatchObject({ driver_lap: 24, leader_lap: 25, position: 12 });
  });

  it('F1-QA15: retirement with a final classification → M01 RETIRED, M13 positional group', () => {
    const s = session();
    const m01 = s.shortPool('F1-M01', { driver_a: 'nor', target_lap: 50, lap_anchor: 'LEADER' }, NB);
    const m13 = s.pool('F1-M13', { driver_a: 'nor' }, { closes: 0 });
    s.status('nor', NB + 1_000, { status: 'RETIRED', occupancy: 'GARAGE', sector: null });
    s.timing(NB + 5_000, ['ver', 'lec', { driver_id: 'nor', activity: 'RETIRED' }], { leaderLap: 50, anchorLap: 50 });
    s.classification(2 * HOUR, [...ALL_DRIVERS.filter((d) => d !== 'nor').slice(0, 15), { driver_id: 'nor', status: 'CLASSIFIED', position: 16, laps: 53 }]);
    expect(R(s.resolve(m01, NB + 10_000))).toBe('RETIRED');
    expect(R(s.resolve(m13, 2 * HOUR + 1_000))).toBe('P11_PLUS');
  });

  it('F1-QA16: an event at target.window_end is not in the window', () => {
    const s = session();
    s.pitEntry('nor', END, { visit: 'v1' });
    expect(R(s.resolve(s.shortPool('F1-M03', {}, NB), END + 1))).toBe('NO_ENTRY');
  });

  it('F1-QA17: a pool locked while the sheet is open disables confirm immediately', () => {
    const s = session();
    const p = s.pool('F1-M03', {}, { opens: 0, closes: 60_000, notBefore: 62_000, windowEnd: 122_000 });
    expect(canAcceptEntry(p, s.abs(59_999))).toBe(true);
    expect(canAcceptEntry(p, s.abs(60_000))).toBe(false);
    const suspended = advancePool(p, s.abs(30_000), { trackState: 'RED', sessionStatus: 'SUSPENDED' });
    expect(canAcceptEntry(suspended, s.abs(30_000))).toBe(false);
  });

  it('F1-QA18: a correction after SETTLED creates a new revision with visible history', () => {
    const s = session();
    const pool = s.shortPool('F1-M06', { driver_a: 'nor' }, NB);
    s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    const exit = s.pitExit('nor', NB + 30_000, { visit: 'v1', lane: 20_000 });
    const settled = settlePool(pool, s.input(END + 30_000));
    s.revise(exit, END + 60_000, { lane_duration_ms: 21_500 });
    const corrected = settlePool(settled, s.input(END + 61_000));
    expect(corrected.settlement!.settlement_revision).toBe(2);
    expect(corrected.settlement_history[0]!.winner_outcome_id).toBe('BUCKET_1');
    expect(corrected.settlement!.winner_outcome_id).toBe('BUCKET_2');
    expect(settlementPhase(corrected)).toBe('CORRECTED');
  });

  it('F1-QA21: initial Q1 snapshot with an active driver in GARAGE → M11 PIT labelled with the garage', () => {
    const s = session({ type: 'QUALIFYING' });
    s.initialStatuses(-60_000, 'GARAGE');
    const p = s.pool('F1-M11', { driver_a: 'ham', at_instant: s.iso(90_000) }, { closes: 30_000 });
    expect(R(s.resolve(p, 90_001))).toBe('PIT');
    expect(F1_I18N.ru['f1.location.pit']).toBe('Боксы / пит-лейн');
    expect(F1_I18N.en['f1.location.pit']).toBe('Garage / pit lane');
  });

  it('F1-QA22: M08/M19 target not started in a fully observed window → TARGET_NOT_STARTED', () => {
    const s = session();
    const m08 = s.shortPool('F1-M08', { driver_a: 'nor', reference_time_ms: 85_000 }, NB);
    const m19 = s.shortPool('F1-M19', { driver_a: 'nor', sector: 2, t1_ms: 30_000, t2_ms: 31_000 }, NB);
    expect(R(s.resolve(m08, END + 1))).toBe('VOID:TARGET_NOT_STARTED');
    expect(R(s.resolve(m19, END + 1))).toBe('VOID:TARGET_NOT_STARTED');
  });

  it('F1-QA23: M08/M19 without an end signal → VOID no later than the cutoff fixed before OPEN', () => {
    const s = session();
    const m08 = s.shortPool('F1-M08', { driver_a: 'nor', reference_time_ms: 85_000 }, NB);
    const m19 = s.shortPool('F1-M19', { driver_a: 'nor', sector: 2, t1_ms: 30_000, t2_ms: 31_000 }, NB);
    s.lap('nor', NB + 3_000, { lap: 4, time: 85_000 });
    s.sector('nor', NB + 4_000, { lap: 5, sector: 1, time: 28_000 });
    for (const p of [m08, m19]) {
      expect(R(s.resolve(p, afterDeadline(s, p, -1)))).toBe('PENDING');
      expect(R(s.resolve(p, afterDeadline(s, p, 0)))).toBe('VOID:INCOMPLETE_OBSERVATION');
    }
  });

  it('F1-QA24: M13–M18 have an absolute cutoff in advance and VOID without waiting for start/end signals', () => {
    const gp = session();
    const sprint = session({ type: 'SPRINT' });
    const q = session({ type: 'QUALIFYING' });
    const pools = [
      [gp, gp.pool('F1-M13', { driver_a: 'nor' }, { closes: 0 })],
      [gp, gp.pool('F1-M14', { driver_a: 'nor' }, { closes: 0 })],
      [sprint, sprint.pool('F1-M18', { driver_a: 'nor' }, { closes: 0 })],
      [q, q.pool('F1-M15', { driver_a: 'nor', segment_id: 'Q1' }, { closes: 0 })],
      [q, q.pool('F1-M16', { driver_a: 'nor', driver_b: 'lec', segment_id: 'Q1' }, { closes: 0 })],
      [q, q.pool('F1-M17', { segment_id: 'Q3', admitted: ALL_DRIVERS.slice(0, 10) }, { closes: 0 })],
    ] as const;
    for (const [s, p] of pools) {
      expect(Number.isFinite(Date.parse(p.settlement_deadline))).toBe(true);
      expect(R(s.resolve(p, afterDeadline(s, p, -1)))).toBe('PENDING');
      expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:TARGET_NOT_STARTED');
    }
  });

  it('F1-QA25 / QA26: SIMULTANEOUS only from a rule declared before OPEN with sufficient evidence', () => {
    const coarse = session();
    coarse.status('gas', NB + 10_000, { status: 'RETIRED', uncertainty: 1_000 });
    coarse.status('oco', NB + 10_000, { status: 'RETIRED', uncertainty: 1_000 });
    const plain = coarse.shortPool('F1-M12', {}, NB);
    expect(plain.outcomes.some((o) => o.id === 'SIMULTANEOUS')).toBe(false);
    expect(R(coarse.resolve(plain, afterDeadline(coarse, plain)))).toBe('VOID:AMBIGUOUS_EVENT_ORDER');
    const precise = session();
    precise.status('gas', NB + 10_100, { status: 'RETIRED', uncertainty: 10 });
    precise.status('oco', NB + 10_300, { status: 'RETIRED', uncertainty: 10 });
    const tie = precise.shortPool('F1-M12', { tie_profile: { tie_precision_ms: 1_000, tie_origin_at: precise.iso(0) } }, NB);
    expect(R(precise.resolve(tie, NB + 20_000))).toBe('SIMULTANEOUS');
  });

  it('F1-QA27: creating M15 for Q3 or SQ3 is rejected; M17 is available for the final classification', () => {
    const q = session({ type: 'QUALIFYING' });
    expect(() => q.pool('F1-M15', { driver_a: 'nor', segment_id: 'Q3' }, { closes: 0 })).toThrow(PoolValidationError);
    const sq = session({ type: 'SPRINT_QUALIFYING' });
    expect(() => sq.pool('F1-M15', { driver_a: 'nor', segment_id: 'SQ3' }, { closes: 0 })).toThrow(/M15_NO_NEXT_SEGMENT/);
    expect(() => sq.pool('F1-M17', { segment_id: 'SQ3', admitted: ALL_DRIVERS.slice(0, 10) }, { closes: 0 })).not.toThrow();
  });
});
