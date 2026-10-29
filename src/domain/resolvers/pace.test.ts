import { describe, expect, it } from 'vitest';
import { afterDeadline, session, type SessionBuilder } from '../__fixtures__/builder';
import { R, valuesOf } from '../__fixtures__/expect';

const NB = 600_000;
const END = NB + 60_000;

describe('F1-M07 first confirmed on-track pass', () => {
  const pool = (s: SessionBuilder) => s.shortPool('F1-M07', { driver_a: 'nor', driver_b: 'lec' }, NB);

  it('A_PASSES_B / B_PASSES_A from verified ON_TRACK_PASS on the same lap', () => {
    const a = session();
    a.pass(NB + 10_000, 'nor', 'lec');
    a.pass(NB + 20_000, 'lec', 'nor');
    const out = a.resolve(pool(a), NB + 15_000);
    expect(R(out)).toBe('A_PASSES_B');
    expect(valuesOf(out)).toMatchObject({ passing_driver_id: 'nor', race_lap: 20 });
    const b = session();
    b.pass(NB + 10_000, 'lec', 'nor');
    expect(R(b.resolve(pool(b), NB + 15_000))).toBe('B_PASSES_A');
  });

  it('excludes unverified passes, lapping, neutralisation, pit swaps and other pairs (QA03, QA05)', () => {
    const s = session();
    s.pass(NB + 1_000, 'nor', 'lec', { provenance: 'UNVERIFIED' });
    s.pass(NB + 2_000, 'nor', 'lec', { lap: 21, passedLap: 20 });
    s.pass(NB + 3_000, 'nor', 'lec', { trackState: 'VSC' });
    s.pass(NB + 4_000, 'nor', 'ver');
    s.pitEntry('lec', NB + 30_000, { visit: 'l1' });
    s.pass(NB + 35_000, 'nor', 'lec');
    s.pitExit('lec', NB + 52_000, { visit: 'l1' });
    s.rc(NB + 54_000, 'SC');
    s.pass(NB + 56_000, 'nor', 'lec');
    expect(R(s.resolve(pool(s), END + 1))).toBe('NO_PASS');
  });

  it('red flag interrupting the window → VOID; gap → VOID, never NO_PASS', () => {
    const s = session();
    s.rc(NB + 5_000, 'RED');
    expect(R(s.resolve(pool(s), END + 1))).toBe('VOID:INTERRUPTED');
    const g = session().gap(NB + 10_000, NB + 12_000);
    expect(R(g.resolve(pool(g), END + 1))).toBe('PENDING');
    expect(R(g.resolve(pool(g), afterDeadline(g, pool(g))))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });
});

describe('F1-M08 next clean lap vs reference', () => {
  const REF = 85_000;
  const pool = (s: SessionBuilder, extra = {}) => s.shortPool('F1-M08', { driver_a: 'nor', reference_time_ms: REF, ...extra }, NB);
  /** Lap 5 runs across not_before; lap 6 is the first lap fully started in the window. */
  const running = () => {
    const s = session();
    s.lap('nor', NB + 5_000, { lap: 5, time: 85_000 });
    return s;
  };

  it('FASTER / EQUAL / SLOWER by integer comparison; the running lap is excluded', () => {
    for (const [time, expected] of [[84_999, 'FASTER'], [85_000, 'EQUAL'], [85_001, 'SLOWER']] as const) {
      const s = running();
      s.lap('nor', NB + 5_000 + time, { lap: 6, time });
      const out = s.resolve(pool(s), NB + 100_000);
      expect(R(out)).toBe(expected);
      expect(valuesOf(out)).toMatchObject({ lap_time_ms: time, delta_ms: time - REF, driver_lap: 6, attempt_id: 'nor:lap:6' });
    }
  });

  it('invalidated attempt → NO_VALID_LAP with no substitution of a later lap', () => {
    const s = running();
    s.lap('nor', NB + 90_000, { lap: 6, time: 85_000, valid: false });
    s.lap('nor', NB + 170_000, { lap: 7, time: 80_000 });
    expect(R(s.resolve(pool(s), NB + 200_000))).toBe('NO_VALID_LAP');
    const late = running();
    late.lap('nor', NB + 90_000, { lap: 6, time: 84_000 });
    expect(R(late.resolve(pool(late), NB + 95_000))).toBe('FASTER');
    late.invalidateLap('nor', NB + 120_000, { lap: 6 });
    expect(R(late.resolve(pool(late), NB + 130_000))).toBe('NO_VALID_LAP');
    const pit = running();
    pit.lap('nor', NB + 90_000, { lap: 6, time: 84_000, pitIn: true });
    expect(R(pit.resolve(pool(pit), NB + 95_000))).toBe('NO_VALID_LAP');
  });

  it('SC/VSC/RED during the measurement → VOID / INTERRUPTED', () => {
    const flagged = running();
    flagged.lap('nor', NB + 90_000, { lap: 6, time: 85_000, neutralised: true });
    expect(R(flagged.resolve(pool(flagged), NB + 95_000))).toBe('VOID:INTERRUPTED');
    const rc = running();
    rc.rc(NB + 40_000, 'VSC');
    rc.lap('nor', NB + 90_000, { lap: 6, time: 85_000 });
    expect(R(rc.resolve(pool(rc), NB + 95_000))).toBe('VOID:INTERRUPTED');
    const red = running();
    red.rc(NB + 40_000, 'RED');
    expect(R(red.resolve(pool(red), NB + 50_000))).toBe('VOID:INTERRUPTED');
  });

  it('QA22: no attempt started in a fully observed window → TARGET_NOT_STARTED (not NO_VALID_LAP)', () => {
    const s = session();
    s.lap('nor', NB - 30_000, { lap: 5, time: 85_000 });
    expect(R(s.resolve(pool(s), END - 1))).toBe('PENDING');
    expect(R(s.resolve(pool(s), END + 1))).toBe('VOID:TARGET_NOT_STARTED');
    const g = session().gap(NB + 10_000, NB + 20_000);
    expect(R(g.resolve(pool(g), END + 1))).toBe('PENDING');
    expect(R(g.resolve(pool(g), afterDeadline(g, pool(g))))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('QA23: attempt started but no end signal → VOID no later than the fixed cutoff', () => {
    const s = running();
    const p = pool(s);
    expect(p.settlement_deadline).toBe(s.iso(END + 600_000));
    expect(R(s.resolve(p, NB + 200_000))).toBe('PENDING');
    expect(R(s.resolve(p, afterDeadline(s, p)))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('retirement during the attempt → NO_VALID_LAP; invalidated reference after lock → REFERENCE_INVALID', () => {
    const s = running();
    s.status('nor', NB + 40_000, { status: 'RETIRED', occupancy: 'ON_TRACK', sector: 2 });
    expect(R(s.resolve(pool(s), NB + 50_000))).toBe('NO_VALID_LAP');
    const r = running();
    r.lap('nor', NB + 90_000, { lap: 6, time: 84_000 });
    r.invalidateLap('nor', NB + 20_000, { lap: 3 });
    expect(R(r.resolve(pool(r, { reference_attempt_id: 'nor:lap:3' }), NB + 95_000))).toBe('VOID:REFERENCE_INVALID');
  });
});

describe('F1-M09 best valid lap in the window', () => {
  const pool = (s: SessionBuilder) => s.shortPool('F1-M09', {}, NB);

  it('minimum valid time wins; a lap started before the window but completed inside counts', () => {
    const s = session();
    s.lap('ver', NB + 10_000, { lap: 5, time: 84_100 });
    s.lap('nor', NB + 20_000, { lap: 5, time: 84_000 });
    s.lap('lec', NB + 30_000, { lap: 5, time: 84_500 });
    s.lap('ham', END, { lap: 5, time: 83_000 });
    s.lap('pia', NB - 1, { lap: 5, time: 82_000 });
    const out = s.resolve(pool(s), END + 1);
    expect(R(out)).toBe('nor');
    expect(valuesOf(out)).toMatchObject({ best_lap_ms: 84_000 });
  });

  it('equal measured minimum → TIE (never completion order)', () => {
    const s = session();
    s.lap('ver', NB + 10_000, { lap: 5, time: 84_000 });
    s.lap('nor', NB + 20_000, { lap: 5, time: 84_000 });
    expect(R(s.resolve(pool(s), END + 1))).toBe('TIE');
  });

  it('QA13: an invalidated best lap is recalculated deterministically', () => {
    const s = session();
    s.lap('ver', NB + 10_000, { lap: 5, time: 84_100 });
    s.lap('nor', NB + 20_000, { lap: 5, time: 84_000 });
    expect(R(s.resolve(pool(s), END + 1))).toBe('nor');
    s.invalidateLap('nor', END + 5_000, { lap: 5 });
    const a = s.resolve(pool(s), END + 10_000);
    const b = s.resolve(pool(s), END + 10_000);
    expect(R(a)).toBe('ver');
    expect(a).toEqual(b);
  });

  it('NO_VALID_LAP only with full observation', () => {
    const s = session();
    s.lap('ver', NB + 10_000, { lap: 5, time: 84_100, valid: false });
    expect(R(s.resolve(pool(s), END + 1))).toBe('NO_VALID_LAP');
    const g = session().gap(NB + 1_000, NB + 2_000);
    expect(R(g.resolve(pool(g), afterDeadline(g, pool(g))))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });
});

describe('F1-M19 next clean sector', () => {
  const pool = (s: SessionBuilder, sector: 1 | 2 | 3 = 2) => s.shortPool('F1-M19', { driver_a: 'nor', sector, t1_ms: 30_000, t2_ms: 31_000 }, NB);
  const enteredS2 = () => {
    const s = session();
    s.sector('nor', NB + 20_000, { lap: 5, sector: 2, time: 30_000 }); // running sector, started before not_before
    s.sector('nor', NB + 5_000, { lap: 6, sector: 1, time: 29_000 });
    return s;
  };

  it('measures only the next entry into the sector; buckets are half-open', () => {
    for (const [time, expected] of [[29_999, 'BUCKET_1'], [30_000, 'BUCKET_2'], [30_999, 'BUCKET_2'], [31_000, 'BUCKET_3']] as const) {
      const s = enteredS2();
      s.sector('nor', NB + 5_000 + time, { lap: 6, sector: 2, time });
      const out = s.resolve(pool(s), NB + 50_000);
      expect(R(out)).toBe(expected);
      expect(valuesOf(out)).toMatchObject({ sector_time_ms: time, driver_lap: 6 });
    }
  });

  it('sector 1 starts at the line crossing', () => {
    const s = session();
    s.lap('nor', NB + 5_000, { lap: 5, time: 85_000 });
    s.sector('nor', NB + 35_500, { lap: 6, sector: 1, time: 30_500 });
    expect(R(s.resolve(pool(s, 1), NB + 40_000))).toBe('BUCKET_2');
  });

  it('invalid or via the pit lane → NO_VALID_SECTOR; neutralised → VOID', () => {
    const inv = enteredS2();
    inv.sector('nor', NB + 35_000, { lap: 6, sector: 2, time: 30_000, valid: false });
    expect(R(inv.resolve(pool(inv), NB + 50_000))).toBe('NO_VALID_SECTOR');
    const pit = enteredS2();
    pit.pitEntry('nor', NB + 20_000, { visit: 'v1' });
    pit.sector('nor', NB + 35_000, { lap: 6, sector: 2, time: 30_000 });
    expect(R(pit.resolve(pool(pit), NB + 50_000))).toBe('NO_VALID_SECTOR');
    const sc = enteredS2();
    sc.rc(NB + 10_000, 'SC');
    sc.sector('nor', NB + 35_000, { lap: 6, sector: 2, time: 30_000 });
    expect(R(sc.resolve(pool(sc), NB + 50_000))).toBe('VOID:INTERRUPTED');
  });

  it('QA22/QA23: not started → TARGET_NOT_STARTED; started without end → VOID at the cutoff', () => {
    const none = session();
    expect(R(none.resolve(pool(none), END + 1))).toBe('VOID:TARGET_NOT_STARTED');
    const open = enteredS2();
    const p = pool(open);
    expect(p.settlement_deadline).toBe(open.iso(END + 120_000));
    expect(R(open.resolve(p, END + 1))).toBe('PENDING');
    expect(R(open.resolve(p, afterDeadline(open, p)))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });
});
