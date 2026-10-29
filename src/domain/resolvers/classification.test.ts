import { describe, expect, it } from 'vitest';
import { ALL_DRIVERS, afterDeadline, session, type SessionBuilder } from '../__fixtures__/builder';
import { R, valuesOf } from '../__fixtures__/expect';
import type { ClassificationEntry } from '../types';

const HOUR = 3_600_000;
const finish = (driverEntry: Partial<ClassificationEntry>, position = 5): Array<Partial<ClassificationEntry> & { driver_id: string }> => {
  const others = ALL_DRIVERS.filter((d) => d !== 'nor').map((d) => ({ driver_id: d }));
  const list: Array<Partial<ClassificationEntry> & { driver_id: string }> = others.map((o, i) => ({ ...o, position: i + 1 >= position ? i + 2 : i + 1 }));
  list.push({ driver_id: 'nor', position, status: 'CLASSIFIED', ...driverEntry });
  return list;
};

describe('F1-M13 Grand Prix finishing group / F1-M14 podium', () => {
  const m13 = (s: SessionBuilder) => s.pool('F1-M13', { driver_a: 'nor' }, { closes: 0 });
  const m14 = (s: SessionBuilder) => s.pool('F1-M14', { driver_a: 'nor' }, { closes: 0 });

  it('maps official positions to groups and podium', () => {
    const cases: Array<[number, string, string]> = [[1, 'P1', 'YES'], [2, 'P2_3', 'YES'], [3, 'P2_3', 'YES'], [4, 'P4_10', 'NO'], [10, 'P4_10', 'NO'], [11, 'P11_PLUS', 'NO'], [22, 'P11_PLUS', 'NO']];
    for (const [pos, group, podium] of cases) {
      const s = session();
      s.classification(2 * HOUR, finish({}, pos));
      expect(R(s.resolve(m13(s), 2 * HOUR + 1_000))).toBe(group);
      expect(R(s.resolve(m14(s), 2 * HOUR + 1_000))).toBe(podium);
    }
  });

  it('precedence DSQ → DNS → classified → NOT_CLASSIFIED; QA15 classified retiree keeps its group', () => {
    const cases: Array<[Partial<ClassificationEntry>, string, string]> = [
      [{ status: 'DSQ', position: null }, 'DSQ', 'NO'],
      [{ status: 'DNS', position: null }, 'DNS', 'NO'],
      [{ status: 'NOT_CLASSIFIED', position: null }, 'NOT_CLASSIFIED', 'NO'],
      [{ status: 'CLASSIFIED', position: 17, laps: 55 }, 'P11_PLUS', 'NO'],
    ];
    for (const [entry, group, podium] of cases) {
      const s = session();
      s.classification(2 * HOUR, finish(entry, entry.position ?? 22));
      expect(R(s.resolve(m13(s), 2 * HOUR + 1_000))).toBe(group);
      expect(R(s.resolve(m14(s), 2 * HOUR + 1_000))).toBe(podium);
    }
  });

  it('provisional classification only → PENDING with a provisional value; QA04 revision changes the result', () => {
    const s = session();
    s.classification(2 * HOUR, finish({}, 3), { provisional: true });
    const pending = s.resolve(m13(s), 2 * HOUR + 1_000);
    expect(R(pending)).toBe('PENDING');
    expect(valuesOf(pending).provisional_outcome).toBe('P2_3');
    s.classification(2 * HOUR + 60_000, finish({}, 3), { revision: 1 });
    expect(R(s.resolve(m13(s), 2 * HOUR + 70_000))).toBe('P2_3');
    s.classification(3 * HOUR, finish({}, 4), { revision: 2 });
    const corrected = s.resolve(m13(s), 3 * HOUR + 1_000);
    expect(R(corrected)).toBe('P4_10');
    expect(valuesOf(corrected).classification_revision).toBe(2);
  });

  it('QA24: absolute cutoff exists in advance; cancelled / not started / not finished / gap reasons', () => {
    const c = session();
    c.sessionState(-60_000, 'CANCELLED');
    expect(R(c.resolve(m13(c), 0))).toBe('VOID:TARGET_CANCELLED');

    const n = session();
    const p = m13(n);
    expect(p.settlement_deadline).toBe(n.iso(2 * HOUR + 24 * HOUR));
    expect(R(n.resolve(p, 10 * HOUR))).toBe('PENDING');
    expect(R(n.resolve(p, afterDeadline(n, p)))).toBe('VOID:TARGET_NOT_STARTED');

    const st = session();
    st.sessionState(0, 'STARTED');
    expect(R(st.resolve(m13(st), afterDeadline(st, m13(st))))).toBe('VOID:RESOLUTION_DEADLINE_EXCEEDED');

    const fin = session();
    fin.sessionState(0, 'STARTED');
    fin.sessionState(2 * HOUR, 'FINISHED');
    expect(R(fin.resolve(m13(fin), afterDeadline(fin, m13(fin))))).toBe('VOID:RESOLUTION_DEADLINE_EXCEEDED');

    const g = session().gap(HOUR, HOUR + 60_000);
    expect(R(g.resolve(m13(g), afterDeadline(g, m13(g))))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('driver missing from the official classification → VOID / CONTRADICTORY_DATA at the cutoff', () => {
    const s = session();
    s.classification(2 * HOUR, ['ver', 'lec']);
    expect(R(s.resolve(m13(s), 2 * HOUR + 1_000))).toBe('PENDING');
    expect(R(s.resolve(m13(s), afterDeadline(s, m13(s))))).toBe('VOID:CONTRADICTORY_DATA');
  });
});

describe('F1-M18 Sprint finishing group', () => {
  it('uses Sprint groups P1, P2_3, P4_8, P9_PLUS', () => {
    for (const [pos, group] of [[1, 'P1'], [3, 'P2_3'], [4, 'P4_8'], [8, 'P4_8'], [9, 'P9_PLUS']] as const) {
      const s = session({ type: 'SPRINT' });
      s.classification(HOUR, finish({ laps: 19 }, pos));
      expect(R(s.resolve(s.pool('F1-M18', { driver_a: 'nor' }, { closes: 0 }), HOUR + 1_000))).toBe(group);
    }
  });
});

describe('F1-M15 progression from a qualifying part', () => {
  const q = () => session({ type: 'QUALIFYING' });
  const pool = (s: SessionBuilder, segment: 'Q1' | 'Q2' = 'Q1') => s.pool('F1-M15', { driver_a: 'nor', segment_id: segment }, { closes: 0 });
  const q1End = (s: SessionBuilder) => s.offset(s.manifest.segments![0]!.planned_end_at);

  it('uses the confirmed segment classification, incl. explicit progressed flags', () => {
    const s = q();
    s.classification(q1End(s), [{ driver_id: 'nor', position: 17, progressed: true }, { driver_id: 'lec', position: 1 }], { segment: 'Q1' });
    expect(R(s.resolve(pool(s), q1End(s) + 1_000))).toBe('YES');
    const t = q();
    t.classification(q1End(t), [{ driver_id: 'nor', position: 3, progressed: false }], { segment: 'Q1' });
    expect(R(t.resolve(pool(t), q1End(t) + 1_000))).toBe('NO');
  });

  it('derives progression from the manifest cut (16 of 22 after Q1) when the flag is absent', () => {
    for (const [pos, expected] of [[16, 'YES'], [17, 'NO']] as const) {
      const s = q();
      s.classification(q1End(s), [{ driver_id: 'nor', position: pos }], { segment: 'Q1' });
      const out = s.resolve(pool(s), q1End(s) + 1_000);
      expect(R(out)).toBe(expected);
      expect(valuesOf(out).cut_position).toBe(16);
    }
    const dns = q();
    dns.classification(q1End(dns), [{ driver_id: 'nor', status: 'DNS', position: null }], { segment: 'Q1' });
    expect(R(dns.resolve(pool(dns), q1End(dns) + 1_000))).toBe('NO');
  });

  it('provisional standing is never the result; a cancelled part without result → VOID', () => {
    const s = q();
    s.classification(q1End(s) - 60_000, [{ driver_id: 'nor', position: 5 }], { segment: 'Q1', provisional: true });
    const out = s.resolve(pool(s), q1End(s));
    expect(R(out)).toBe('PENDING');
    expect(valuesOf(out).provisional_outcome).toBe('YES');
    const c = q();
    const q2s = c.offset(c.manifest.segments![1]!.planned_start_at);
    c.segment(q2s, 'Q2', 'CANCELLED');
    expect(R(c.resolve(pool(c, 'Q2'), q2s + 1_000))).toBe('VOID:TARGET_CANCELLED');
  });
});

describe('F1-M16 qualifying duel within one segment', () => {
  const q = session({ type: 'QUALIFYING' });
  const seg = q.manifest.segments![1]!;
  const start = q.offset(seg.planned_start_at);
  const end = q.offset(seg.planned_end_at);
  const build = () => {
    const s = session({ type: 'QUALIFYING' });
    s.segment(start, 'Q2', 'STARTED');
    s.lap('nor', start + 200_000, { lap: 3, time: 80_200, segment: 'Q2' });
    s.lap('lec', start + 300_000, { lap: 3, time: 80_100, segment: 'Q2' });
    s.lap('nor', start + 400_000, { lap: 5, time: 80_000, segment: 'Q2' });
    s.lap('nor', start - 400_000, { lap: 1, time: 79_000, segment: 'Q1' });
    s.segment(end, 'Q2', 'ENDED');
    return s;
  };
  const pool = (s: SessionBuilder) => s.pool('F1-M16', { driver_a: 'nor', driver_b: 'lec', segment_id: 'Q2' }, { closes: start });

  it('compares best valid laps of the fixed segment once it is complete', () => {
    const s = build();
    expect(R(s.resolve(pool(s), end + 1_000))).toBe('PENDING');
    s.classification(end + 60_000, [{ driver_id: 'nor', position: 1 }, { driver_id: 'lec', position: 2 }], { segment: 'Q2' });
    const out = s.resolve(pool(s), end + 70_000);
    expect(R(out)).toBe('A');
    expect(valuesOf(out)).toMatchObject({ best_a_ms: 80_000, best_b_ms: 80_100, delta_ms: -100 });
  });

  it('QA13: invalidating the best lap recalculates; equal → TIE; none → NEITHER_VALID', () => {
    const s = build();
    s.invalidateLap('nor', end + 30_000, { lap: 5 });
    expect(R(s.resolve(pool(s), end + 200_000))).toBe('B');
    const t = build();
    t.lap('lec', start + 500_000, { lap: 6, time: 80_000, segment: 'Q2' });
    expect(R(t.resolve(pool(t), end + 200_000))).toBe('TIE');
    const n = session({ type: 'QUALIFYING' });
    n.segment(start, 'Q2', 'STARTED');
    n.lap('nor', start + 100_000, { lap: 2, time: 80_000, segment: 'Q2', valid: false });
    n.segment(end, 'Q2', 'ENDED');
    expect(R(n.resolve(pool(n), end + 200_000))).toBe('NEITHER_VALID');
  });

  it('cancelled segment → VOID; never started → VOID at the cutoff', () => {
    const c = session({ type: 'QUALIFYING' });
    c.segment(start, 'Q2', 'CANCELLED');
    expect(R(c.resolve(pool(c), start + 1_000))).toBe('VOID:TARGET_CANCELLED');
    const n = session({ type: 'QUALIFYING' });
    expect(R(n.resolve(pool(n), afterDeadline(n, pool(n))))).toBe('VOID:TARGET_NOT_STARTED');
  });
});

describe('F1-M17 top of the Q3/SQ3 classification', () => {
  const admitted = ALL_DRIVERS.slice(0, 10);
  const build = () => session({ type: 'QUALIFYING' });
  const pool = (s: SessionBuilder, list = admitted) => s.pool('F1-M17', { segment_id: 'Q3', admitted: list }, { closes: 0 });
  const q3End = (s: SessionBuilder) => s.offset(s.manifest.segments![2]!.planned_end_at);

  it('winner is P1 of the official part classification (grid penalties irrelevant)', () => {
    const s = build();
    s.classification(q3End(s), ['ver', 'nor', 'lec'], { segment: 'Q3' });
    const out = s.resolve(pool(s), q3End(s) + 1_000);
    expect(R(out)).toBe('ver');
    expect(valuesOf(out).classification_scope).toBe('SEGMENT');
  });

  it('winner outside the admitted list → CONTRADICTORY; no classification → VOID at the cutoff', () => {
    const s = build();
    s.classification(q3End(s), ['bot', 'nor'], { segment: 'Q3' });
    expect(R(s.resolve(pool(s), afterDeadline(s, pool(s))))).toBe('VOID:CONTRADICTORY_DATA');
    const n = build();
    n.segment(n.offset(n.manifest.segments![2]!.planned_start_at), 'Q3', 'STARTED');
    expect(R(n.resolve(pool(n), afterDeadline(n, pool(n))))).toBe('VOID:RESOLUTION_DEADLINE_EXCEEDED');
  });
});
