import { describe, expect, it } from 'vitest';
import { afterDeadline, session } from '../__fixtures__/builder';
import { R, valuesOf } from '../__fixtures__/expect';
import type { ComboPart } from '../types';

const NB = 600_000;
const ORDER = ['ver', 'lec', 'nor', 'pia', 'ham'];

describe('F1-M01 position at the crossing', () => {
  const pool = (s = session(), anchor: 'LEADER' | 'DRIVER' = 'LEADER') =>
    s.shortPool('F1-M01', { driver_a: 'nor', target_lap: 20, lap_anchor: anchor }, NB);

  it('resolves P{n} from the leader-lap anchor snapshot', () => {
    const s = session();
    const p = pool(s);
    s.timing(NB + 10_000, ORDER, { leaderLap: 20, anchorLap: 20 });
    const out = s.resolve(p, NB + 20_000);
    expect(R(out)).toBe('P3');
    expect(valuesOf(out)).toMatchObject({ position: 3, anchor_lap: 20, leader_lap: 20, driver_lap: 20 });
    expect(out.state === 'RESOLVED' && out.evidence.length).toBeGreaterThan(0);
  });

  it('status precedence DSQ → DNS → RETIRED → position (F1-028)', () => {
    const cases: Array<[string, () => ReturnType<typeof session>]> = [
      ['RETIRED', () => { const s = session(); s.timing(NB + 10_000, ['ver', { driver_id: 'nor', activity: 'RETIRED' }], { leaderLap: 20, anchorLap: 20 }); return s; }],
      ['DNS', () => { const s = session(); s.status('nor', 0, { status: 'DNS', occupancy: 'GARAGE', sector: null }); s.timing(NB + 10_000, ['ver', 'nor'], { leaderLap: 20, anchorLap: 20 }); return s; }],
      ['DSQ', () => { const s = session(); s.status('nor', NB + 1_000, { status: 'DSQ' }); s.timing(NB + 10_000, ['ver', { driver_id: 'nor', activity: 'RETIRED' }], { leaderLap: 20, anchorLap: 20 }); return s; }],
      ['DSQ', () => { const s = session(); s.status('nor', NB + 1_000, { status: 'RETIRED' }); s.timing(NB + 10_000, ['ver', { driver_id: 'nor', activity: 'DSQ' }], { leaderLap: 20, anchorLap: 20 }); return s; }],
    ];
    for (const [expected, build] of cases) {
      const s = build();
      expect(R(s.resolve(pool(s), NB + 20_000))).toBe(expected);
    }
  });

  it('QA14: a lapped driver keeps their own driver_lap; DRIVER anchor waits for their own lap', () => {
    const s = session();
    const lapped = { driver_id: 'nor', driver_laps: 19, position: 15 };
    s.timing(NB + 10_000, ['ver', 'lec', lapped], { leaderLap: 20, anchorLap: 20 });
    s.lap('nor', NB + 40_000, { lap: 20, time: 90_000, leaderLap: 21 });
    s.timing(NB + 40_000, ['ver', 'lec', { driver_id: 'nor', driver_laps: 20, position: 14 }], { leaderLap: 21 });
    const leader = s.resolve(pool(s), NB + 50_000);
    expect(R(leader)).toBe('P15');
    expect(valuesOf(leader)).toMatchObject({ driver_lap: 19, leader_lap: 20 });
    const own = s.resolve(pool(s, 'DRIVER'), NB + 50_000);
    expect(R(own)).toBe('P14');
    expect(valuesOf(own)).toMatchObject({ driver_lap: 20, leader_lap: 21, lap_anchor: 'DRIVER' });
  });

  it('keeps the first leader crossing as anchor even if the leader changes later', () => {
    const s = session();
    s.timing(NB + 10_000, ORDER, { leaderLap: 20, anchorLap: 20 });
    s.timing(NB + 11_000, ['lec', 'ver', 'pia', 'nor'], { leaderLap: 20, anchorLap: 20 });
    expect(R(s.resolve(pool(s), NB + 20_000))).toBe('P3');
  });

  it('SC/VSC keep the measurement; RED before the anchor → VOID (F1-024)', () => {
    const s1 = session();
    s1.rc(NB + 5_000, 'SC');
    s1.timing(NB + 10_000, ORDER, { leaderLap: 20, anchorLap: 20 });
    expect(R(s1.resolve(pool(s1), NB + 20_000))).toBe('P3');
    const s2 = session();
    s2.rc(NB + 5_000, 'RED');
    s2.timing(NB + 10_000, ORDER, { leaderLap: 20, anchorLap: 20 });
    expect(R(s2.resolve(pool(s2), NB + 20_000))).toBe('VOID:INTERRUPTED');
    const s3 = session();
    s3.rc(NB + 5_000, 'RED');
    expect(R(s3.resolve(pool(s3), NB + 6_000))).toBe('VOID:INTERRUPTED');
  });

  it('anchor never reached: full observation → TARGET_NOT_STARTED; feed gap → PENDING then INCOMPLETE_OBSERVATION', () => {
    const s = session();
    const p = pool(s);
    expect(R(s.resolve(p, NB + 30_000))).toBe('PENDING');
    expect(R(s.resolve(p, NB + 60_001))).toBe('VOID:TARGET_NOT_STARTED');
    const g = session().gap(NB + 10_000, NB + 11_000);
    const pg = pool(g);
    expect(R(g.resolve(pg, NB + 60_001))).toBe('PENDING');
    expect(R(g.resolve(pg, afterDeadline(g, pg)))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('contradictory simultaneous snapshots wait, then VOID by deadline (F1-029)', () => {
    const s = session();
    const p = pool(s);
    s.timing(NB + 10_000, ORDER, { leaderLap: 20, anchorLap: 20, snapshotRevision: 5 });
    s.timing(NB + 10_000, ['nor', 'ver', 'lec'], { leaderLap: 20, anchorLap: 20, snapshotRevision: 5 });
    expect(R(s.resolve(p, NB + 20_000))).toBe('PENDING');
    expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:CONTRADICTORY_DATA');
  });

  it('applies a corrected snapshot revision', () => {
    const s = session();
    const p = pool(s);
    const snap = s.timing(NB + 10_000, ORDER, { leaderLap: 20, anchorLap: 20 });
    expect(R(s.resolve(p, NB + 20_000))).toBe('P3');
    s.revise(snap, NB + 30_000, {
      order: snap.payload.order.map((o) => (o.driver_id === 'nor' ? { ...o, position: 2 } : o.driver_id === 'lec' ? { ...o, position: 3 } : o)),
    });
    expect(R(s.resolve(p, NB + 40_000))).toBe('P2');
  });

  it('an anchor before the window start → TARGET_BOUNDARY_CONTAMINATED; inactive before own lap → status', () => {
    const s = session();
    s.timing(NB - 5_000, ORDER, { leaderLap: 20, anchorLap: 20 });
    expect(R(s.resolve(pool(s), NB + 20_000))).toBe('VOID:TARGET_BOUNDARY_CONTAMINATED');
    const d = session();
    d.status('nor', NB + 5_000, { status: 'RETIRED', occupancy: 'GARAGE', sector: null });
    expect(R(d.resolve(pool(d, 'DRIVER'), NB + 20_000))).toBe('RETIRED');
  });

  it('driver missing from the snapshot never becomes a position', () => {
    const s = session();
    const p = pool(s);
    s.timing(NB + 10_000, ['ver', 'lec'], { leaderLap: 20, anchorLap: 20 });
    expect(R(s.resolve(p, NB + 20_000))).toBe('PENDING');
    expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });
});

describe('F1-M02 who is ahead at the crossing', () => {
  const pool = (s: ReturnType<typeof session>) =>
    s.shortPool('F1-M02', { driver_a: 'nor', driver_b: 'lec', target_lap: 20, lap_anchor: 'LEADER' }, NB);

  it('compares integer ranks of one snapshot', () => {
    const s = session();
    s.timing(NB + 10_000, ORDER, { leaderLap: 20, anchorLap: 20 });
    expect(R(s.resolve(pool(s), NB + 20_000))).toBe('B');
    const t = session();
    t.timing(NB + 10_000, ['nor', 'lec'], { leaderLap: 20, anchorLap: 20 });
    expect(R(t.resolve(pool(t), NB + 20_000))).toBe('A');
  });

  it('active beats inactive; both inactive → BOTH_INACTIVE', () => {
    const s = session();
    s.status('lec', NB + 1_000, { status: 'RETIRED' });
    s.timing(NB + 10_000, ['ver', 'lec', 'nor'], { leaderLap: 20, anchorLap: 20 });
    expect(R(s.resolve(pool(s), NB + 20_000))).toBe('A');
    const b = session();
    b.timing(NB + 10_000, ['ver', { driver_id: 'nor', activity: 'DSQ' }, { driver_id: 'lec', activity: 'RETIRED' }], { leaderLap: 20, anchorLap: 20 });
    expect(R(b.resolve(pool(b), NB + 20_000))).toBe('BOTH_INACTIVE');
  });

  it('equal positions are contradictory → VOID at deadline; RED before anchor → VOID', () => {
    const s = session();
    const p = pool(s);
    s.timing(NB + 10_000, [{ driver_id: 'nor', position: 2 }, { driver_id: 'lec', position: 2 }], { leaderLap: 20, anchorLap: 20 });
    expect(R(s.resolve(p, NB + 20_000))).toBe('PENDING');
    expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:CONTRADICTORY_DATA');
    const r = session();
    r.rc(NB + 1_000, 'RED');
    expect(R(r.resolve(pool(r), NB + 20_000))).toBe('VOID:INTERRUPTED');
  });
});

describe('F1-M11 where is A at T', () => {
  const T = 120_000;
  const pool = (s: ReturnType<typeof session>) => s.pool('F1-M11', { driver_a: 'nor', at_instant: s.iso(T) }, { closes: 60_000 });

  it('QA21: initial GARAGE snapshot without PIT_ENTRY → PIT (garage included)', () => {
    const s = session({ type: 'QUALIFYING' });
    s.initialStatuses(0, 'GARAGE');
    const p = pool(s);
    expect(R(s.resolve(p, T + 1))).toBe('PIT');
    expect(p.outcomes.find((o) => o.id === 'PIT')!.label_key).toBe('f1.location.pit');
  });

  it('follows confirmed sector transitions; later sporting values are not carried back', () => {
    const s = session();
    s.status('nor', 0, { occupancy: 'ON_TRACK', sector: 1 });
    s.sector('nor', 100_000, { lap: 1, sector: 1, time: 30_000 });
    s.sector('nor', 125_000, { lap: 1, sector: 2, time: 25_000 });
    expect(R(s.resolve(pool(s), T + 10_000))).toBe('S2');
    const l = session();
    l.status('nor', 0, { occupancy: 'ON_TRACK', sector: 3 });
    l.lap('nor', 110_000, { lap: 1, time: 90_000 });
    expect(R(l.resolve(pool(l), T + 1))).toBe('S1');
  });

  it('a late-received packet proves the earlier state (F1-070)', () => {
    const s = session();
    s.status('nor', 0, { occupancy: 'ON_TRACK', sector: 1 });
    s.sector('nor', 100_000, { lap: 1, sector: 1, time: 30_000, delay: 50_000 });
    expect(R(s.resolve(pool(s), T + 60_000))).toBe('S2');
  });

  it('PIT from PIT_ENTRY; RETIRED/DNS/DSQ keep priority over PIT; stopped car stays in its sector', () => {
    const s = session();
    s.status('nor', 0, { occupancy: 'ON_TRACK', sector: 2 });
    s.pitEntry('nor', 110_000, { visit: 'v1' });
    expect(R(s.resolve(pool(s), T + 1))).toBe('PIT');
    for (const st of ['RETIRED', 'DNS', 'DSQ'] as const) {
      const r = session();
      r.status('nor', 0, { status: st, occupancy: 'GARAGE', sector: null });
      expect(R(r.resolve(pool(r), T + 1))).toBe(st);
    }
    const stopped = session();
    stopped.status('nor', 0, { occupancy: 'ON_TRACK', sector: 3 });
    expect(R(stopped.resolve(pool(stopped), T + 1))).toBe('S3');
  });

  it('unknown occupancy is never PIT; after pit exit the sector is unknown until confirmed', () => {
    const s = session();
    const p = pool(s);
    s.status('nor', 0, { occupancy: 'UNKNOWN', sector: null });
    expect(R(s.resolve(p, T + 1))).toBe('PENDING');
    expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:INCOMPLETE_OBSERVATION');
    const x = session();
    x.status('nor', 0, { occupancy: 'PIT_LANE', sector: null });
    x.pitExit('nor', 100_000, { visit: 'v0' });
    expect(R(x.resolve(pool(x), afterDeadline(x, pool(x))))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('uncertainty straddling T that changes the answer → VOID; gap before T → VOID', () => {
    const s = session();
    const p = pool(s);
    s.status('nor', 0, { occupancy: 'ON_TRACK', sector: 2 });
    s.sector('nor', T - 5, { lap: 1, sector: 2, time: 25_000, uncertainty: 10 });
    expect(R(s.resolve(p, T + 1))).toBe('PENDING');
    expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:AMBIGUOUS_EVENT_ORDER');
    const g = session().gap(100_000, 110_000);
    g.status('nor', 0, { occupancy: 'ON_TRACK', sector: 2 });
    expect(R(g.resolve(pool(g), afterDeadline(g, pool(g))))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('PENDING before T; RED before T → VOID', () => {
    const s = session();
    s.status('nor', 0, { occupancy: 'ON_TRACK', sector: 2 });
    expect(R(s.resolve(pool(s), T - 1))).toBe('PENDING');
    s.rc(80_000, 'RED');
    expect(R(s.resolve(pool(s), T + 1))).toBe('VOID:INTERRUPTED');
  });
});

describe('F1-M21 two conditions of one snapshot', () => {
  const T = 700_000;
  const pool = (s: ReturnType<typeof session>, combo: [ComboPart, ComboPart]) => s.pool('F1-M21', { combo, at_instant: s.iso(T) }, { closes: 600_000 });
  const grp = (v: string): ComboPart => ({ kind: 'POSITION_GROUP', driver_id: 'nor', value: v });
  const tyre = (v: string): ComboPart => ({ kind: 'TYRE_COMPOUND', driver_id: 'nor', value: v });

  it('position group + compound', () => {
    const s = session();
    s.stint('nor', 10_000, { number: 1, compound: 'MEDIUM' });
    s.timing(650_000, ['ver', 'nor', 'lec'], { leaderLap: 10 });
    expect(R(s.resolve(pool(s, [grp('P1_3'), tyre('MEDIUM')]), T + 1))).toBe('BOTH_TRUE');
    expect(R(s.resolve(pool(s, [grp('P1_3'), tyre('HARD')]), T + 1))).toBe('NOT_BOTH');
    expect(R(s.resolve(pool(s, [grp('P4_10'), tyre('MEDIUM')]), T + 1))).toBe('NOT_BOTH');
  });

  it('A ahead of B + A on track; sector + compound', () => {
    const s = session();
    s.status('nor', 0, { occupancy: 'ON_TRACK', sector: 2 });
    s.stint('nor', 10_000, { number: 1, compound: 'SOFT' });
    s.timing(650_000, ['ver', 'nor', 'lec'], { leaderLap: 10 });
    const duel: [ComboPart, ComboPart] = [{ kind: 'AHEAD_OF', driver_id: 'nor', value: 'lec' }, { kind: 'ON_TRACK', driver_id: 'nor', value: 'true' }];
    expect(R(s.resolve(pool(s, duel), T + 1))).toBe('BOTH_TRUE');
    expect(R(s.resolve(pool(s, [{ kind: 'SECTOR', driver_id: 'nor', value: '2' }, tyre('SOFT')]), T + 1))).toBe('BOTH_TRUE');
    expect(R(s.resolve(pool(s, [{ kind: 'SECTOR', driver_id: 'nor', value: '3' }, tyre('SOFT')]), T + 1))).toBe('NOT_BOTH');
    s.pitEntry('nor', 690_000, { visit: 'v1' });
    expect(R(s.resolve(pool(s, duel), T + 1))).toBe('NOT_BOTH');
  });

  it('unknown required part → PENDING, then VOID / UNKNOWN_REQUIRED_PART; RED before T → VOID', () => {
    const s = session();
    s.timing(650_000, ['ver', 'nor'], { leaderLap: 10 });
    const p = pool(s, [grp('P1_3'), tyre('MEDIUM')]);
    expect(R(s.resolve(p, T + 1))).toBe('PENDING');
    expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:UNKNOWN_REQUIRED_PART');
    s.rc(650_000, 'RED');
    expect(R(s.resolve(p, T + 1))).toBe('VOID:INTERRUPTED');
  });
});
