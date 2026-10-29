import { describe, expect, it } from 'vitest';
import { afterDeadline, session, type SessionBuilder } from '../__fixtures__/builder';
import { R, valuesOf } from '../__fixtures__/expect';
import { COMPOUNDS } from '../markets/catalog';
import type { Compound, MarketId } from '../types';

const NB = 600_000;
const END = NB + 60_000;
const short = (s: SessionBuilder, id: MarketId, params = {}) => s.shortPool(id, { driver_a: 'nor', ...params }, NB);

describe('F1-M03 next pit-lane entry', () => {
  const pool = (s: SessionBuilder) => s.shortPool('F1-M03', {}, NB);

  it('first normal confirmed entry in [start, end) wins', () => {
    const s = session();
    s.pitEntry('ham', NB + 2_000, { visit: 'h0', normal: false });
    s.pitEntry('pia', NB + 3_000, { visit: 'p0', quality: 'PROVISIONAL' });
    s.pitEntry('lec', NB + 10_000, { visit: 'l1' });
    s.pitEntry('nor', NB + 20_000, { visit: 'n1' });
    const out = s.resolve(pool(s), NB + 15_000);
    expect(R(out)).toBe('lec');
    expect(valuesOf(out)).toMatchObject({ driver_id: 'lec', pit_visit_id: 'l1' });
  });

  it('QA16: an entry at window_end is outside → NO_ENTRY with full coverage', () => {
    const s = session();
    s.pitEntry('lec', END, { visit: 'l1' });
    expect(R(s.resolve(pool(s), END + 1))).toBe('NO_ENTRY');
  });

  it('QA11/QA12: NO_ENTRY only with full coverage; a feed gap → VOID', () => {
    const s = session();
    expect(R(s.resolve(pool(s), END - 1))).toBe('PENDING');
    expect(R(s.resolve(pool(s), END + 1))).toBe('NO_ENTRY');
    const g = session().gap(NB + 30_000, NB + 31_000);
    expect(R(g.resolve(pool(g), END + 1))).toBe('PENDING');
    expect(R(g.resolve(pool(g), afterDeadline(g, pool(g))))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('equal timestamps need a trustworthy source sequence (F1-030)', () => {
    const s = session();
    s.pitEntry('lec', NB + 10_000, { visit: 'l1' });
    s.pitEntry('nor', NB + 10_000, { visit: 'n1' });
    expect(R(s.resolve(pool(s), NB + 20_000))).toBe('PENDING');
    expect(R(s.resolve(pool(s), afterDeadline(s, pool(s))))).toBe('VOID:AMBIGUOUS_EVENT_ORDER');
    const q = session();
    q.pitEntry('lec', NB + 10_000, { visit: 'l1', sourceSequence: '7' });
    q.pitEntry('nor', NB + 10_000, { visit: 'n1', sourceSequence: '6' });
    expect(R(q.resolve(pool(q), NB + 20_000))).toBe('nor');
  });

  it('red flag before the first entry → VOID; an entry decided before the red stands', () => {
    const s = session();
    s.rc(NB + 5_000, 'RED');
    s.pitEntry('lec', NB + 10_000, { visit: 'l1' });
    expect(R(s.resolve(pool(s), NB + 20_000))).toBe('VOID:INTERRUPTED');
    const t = session();
    t.pitEntry('lec', NB + 10_000, { visit: 'l1' });
    t.rc(NB + 20_000, 'RED');
    expect(R(t.resolve(pool(t), NB + 30_000))).toBe('lec');
  });
});

describe('F1-M04 compound at the exit after the next entry', () => {
  it.each(COMPOUNDS.map((c) => [c]))('resolves %s from the confirmed stint linked to the exit', (c) => {
    const s = session();
    s.pitStop('nor', NB + 10_000, { visit: 'v1', compound: c as Compound });
    expect(R(s.resolve(short(s, 'F1-M04'), NB + 40_000))).toBe(c);
  });

  it('OTHER_CONFIRMED for a confirmed compound outside the list', () => {
    const s = session();
    s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    s.pitExit('nor', NB + 32_000, { visit: 'v1', compound: null });
    s.stint('nor', NB + 33_000, { number: 2, compound: 'HYPERSOFT' as Compound, visit: 'v1' });
    expect(R(s.resolve(short(s, 'F1-M04'), NB + 40_000))).toBe('OTHER_CONFIRMED');
  });

  it('a visit begun before the window never becomes the target → NO_EXIT with full observation', () => {
    const s = session();
    s.pitEntry('nor', NB - 5_000, { visit: 'v0' });
    s.pitExit('nor', NB + 17_000, { visit: 'v0', compound: 'SOFT' });
    s.stint('nor', NB + 17_500, { number: 2, compound: 'SOFT', visit: 'v0' });
    expect(R(s.resolve(short(s, 'F1-M04'), END + 1))).toBe('NO_EXIT');
  });

  it('entry without exit by the deadline → VOID; exit without stint → VOID; conflicting compounds → VOID', () => {
    const a = session();
    a.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    const pa = short(a, 'F1-M04');
    expect(R(a.resolve(pa, END + 1))).toBe('PENDING');
    expect(R(a.resolve(pa, afterDeadline(a, pa)))).toBe('VOID:RESOLUTION_DEADLINE_EXCEEDED');
    const b = session();
    b.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    b.pitExit('nor', NB + 32_000, { visit: 'v1', compound: 'HARD' });
    const pb = short(b, 'F1-M04');
    expect(R(b.resolve(pb, END + 1))).toBe('PENDING');
    expect(R(b.resolve(pb, afterDeadline(b, pb)))).toBe('VOID:INCOMPLETE_OBSERVATION');
    b.stint('nor', NB + 33_000, { number: 2, compound: 'SOFT', visit: 'v1' });
    expect(R(b.resolve(pb, afterDeadline(b, pb)))).toBe('VOID:CONTRADICTORY_DATA');
  });
});

describe('F1-M05 stationary stop / F1-M06 pit-lane time', () => {
  const visit = (stop: number | null, o: { service?: 'TYRES' | 'DRIVE_THROUGH' | 'STOP_GO' | 'REPAIR'; lane?: number; red?: boolean } = {}) => {
    const s = session();
    s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    s.pitExit('nor', NB + 10_000 + (o.lane ?? 22_000), { visit: 'v1', stop, lane: o.lane ?? 22_000, service: o.service, red: o.red });
    return s;
  };

  it('QA06: 2500 ms → second bucket, 3000 ms → third bucket', () => {
    const cases: Array<[number, string]> = [[0, 'BUCKET_1'], [2_499, 'BUCKET_1'], [2_500, 'BUCKET_2'], [2_999, 'BUCKET_2'], [3_000, 'BUCKET_3'], [9_999, 'BUCKET_3']];
    for (const [stop, expected] of cases) {
      const s = visit(stop);
      const out = s.resolve(short(s, 'F1-M05'), NB + 40_000);
      expect(R(out)).toBe(expected);
      expect(valuesOf(out).stop_duration_ms).toBe(stop);
    }
  });

  it('QA07: drive-through → M05 NO_SERVICE, M06 still measurable; stop-go has no service', () => {
    const s = visit(null, { service: 'DRIVE_THROUGH', lane: 18_000 });
    expect(R(s.resolve(short(s, 'F1-M05'), NB + 40_000))).toBe('NO_SERVICE');
    const m06 = s.resolve(short(s, 'F1-M06'), NB + 40_000);
    expect(R(m06)).toBe('BUCKET_1');
    expect(valuesOf(m06).lane_duration_ms).toBe(18_000);
    const sg = visit(5_000, { service: 'STOP_GO' });
    expect(R(sg.resolve(short(sg, 'F1-M05'), NB + 40_000))).toBe('NO_SERVICE');
  });

  it('a missing stationary-stop value is not NO_SERVICE', () => {
    const s = visit(null, { service: 'TYRES' });
    const p = short(s, 'F1-M05');
    expect(R(s.resolve(p, NB + 40_000))).toBe('PENDING');
    expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('QA08: red flag inside the visit → M05 and M06 VOID', () => {
    const flagged = visit(2_400, { red: true });
    expect(R(flagged.resolve(short(flagged, 'F1-M05'), NB + 40_000))).toBe('VOID:INTERRUPTED');
    expect(R(flagged.resolve(short(flagged, 'F1-M06'), NB + 40_000))).toBe('VOID:INTERRUPTED');
    const s = session();
    s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    s.rc(NB + 15_000, 'RED');
    expect(R(s.resolve(short(s, 'F1-M05'), NB + 20_000))).toBe('VOID:INTERRUPTED');
    s.pitExit('nor', NB + 40_000, { visit: 'v1' });
    expect(R(s.resolve(short(s, 'F1-M06'), NB + 50_000))).toBe('VOID:INTERRUPTED');
  });

  it('the exit may arrive after window_end within the deadline (F1-064)', () => {
    const s = session();
    s.pitEntry('nor', NB + 55_000, { visit: 'v1' });
    expect(R(s.resolve(short(s, 'F1-M05'), NB + 61_000))).toBe('PENDING');
    expect(R(s.resolve(short(s, 'F1-M06'), NB + 61_000))).toBe('PENDING');
    s.pitExit('nor', NB + 78_000, { visit: 'v1', stop: 2_600, lane: 23_000 });
    expect(R(s.resolve(short(s, 'F1-M05'), NB + 80_000))).toBe('BUCKET_2');
    const laneResult = s.resolve(short(s, 'F1-M06'), NB + 80_000);
    expect(R(laneResult)).toBe('BUCKET_2'); // 23 s falls in the frozen [21 s, 24 s) bucket.
    expect(valuesOf(laneResult)).toMatchObject({ lane_duration_ms: 23_000, t1_ms: 21_000, t2_ms: 24_000 });
  });

  it('no qualifying visit with full observation → NO_SERVICE / NO_VISIT; M06 buckets use frozen t1/t2', () => {
    const s = session();
    expect(R(s.resolve(short(s, 'F1-M05'), END + 1))).toBe('NO_SERVICE');
    expect(R(s.resolve(short(s, 'F1-M06'), END + 1))).toBe('NO_VISIT');
    for (const [lane, expected] of [[20_999, 'BUCKET_1'], [21_000, 'BUCKET_2'], [23_999, 'BUCKET_2'], [24_000, 'BUCKET_3']] as const) {
      const v = visit(2_400, { lane });
      expect(R(v.resolve(short(v, 'F1-M06'), NB + 60_000))).toBe(expected);
    }
    const custom = visit(2_400, { lane: 19_500 });
    expect(R(custom.resolve(short(custom, 'F1-M06', { t1_ms: 19_000, t2_ms: 20_000 }), NB + 60_000))).toBe('BUCKET_2');
  });
});

describe('F1-M20 confirmed compound change', () => {
  const base = () => {
    const s = session();
    s.stint('nor', 10_000, { number: 1, compound: 'MEDIUM' });
    return s;
  };

  it('YES on a confirmed change; a new set of the same compound is NO', () => {
    const s = base();
    s.pitStop('nor', NB + 10_000, { visit: 'v1', compound: 'HARD', stint: 2 });
    const out = s.resolve(short(s, 'F1-M20'), NB + 40_000);
    expect(R(out)).toBe('YES');
    expect(valuesOf(out)).toMatchObject({ from_compound: 'MEDIUM', to_compound: 'HARD' });
    const same = base();
    same.pitStop('nor', NB + 10_000, { visit: 'v1', compound: 'MEDIUM', stint: 2, newSet: true });
    expect(R(same.resolve(short(same, 'F1-M20'), NB + 40_000))).toBe('PENDING');
    expect(R(same.resolve(short(same, 'F1-M20'), END + 1))).toBe('NO');
  });

  it('a pit exit awaiting stint confirmation keeps the result open', () => {
    const s = base();
    s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    s.pitExit('nor', NB + 32_000, { visit: 'v1', compound: 'HARD' });
    const p = short(s, 'F1-M20');
    expect(R(s.resolve(p, END + 1))).toBe('PENDING');
    expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:INCOMPLETE_OBSERVATION');
    s.stint('nor', NB + 70_000, { number: 2, compound: 'HARD', visit: 'v1' });
    expect(R(s.resolve(p, END + 20_000))).toBe('YES');
  });

  it('unknown baseline, feed gaps and red flags never resolve to NO', () => {
    const none = session();
    const p = short(none, 'F1-M20');
    expect(R(none.resolve(p, afterDeadline(none, p)))).toBe('VOID:INCOMPLETE_OBSERVATION');
    const g = base().gap(NB + 1_000, NB + 2_000);
    expect(R(g.resolve(short(g, 'F1-M20'), afterDeadline(g, short(g, 'F1-M20'))))).toBe('VOID:INCOMPLETE_OBSERVATION');
    const r = base();
    r.rc(NB + 20_000, 'RED');
    expect(R(r.resolve(short(r, 'F1-M20'), END + 1))).toBe('VOID:INTERRUPTED');
  });

  it('a change effective after the window (exit after window_end) does not count', () => {
    const s = base();
    s.pitStop('nor', NB + 50_000, { visit: 'v1', compound: 'HARD', stint: 2, lane: 22_000 });
    expect(R(s.resolve(short(s, 'F1-M20'), NB + 90_000))).toBe('NO');
  });
});
