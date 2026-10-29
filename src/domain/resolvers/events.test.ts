import { describe, expect, it } from 'vitest';
import { afterDeadline, session, type SessionBuilder } from '../__fixtures__/builder';
import { R, valuesOf } from '../__fixtures__/expect';
import { RESOLVERS } from './index';

const NB = 600_000;
const END = NB + 60_000;

describe('F1-M10 next neutralisation', () => {
  const pool = (s: SessionBuilder) => s.shortPool('F1-M10', {}, NB);

  it('first new global state wins: SC, VSC, RED', () => {
    for (const st of ['SC', 'VSC', 'RED'] as const) {
      const s = session();
      s.rc(NB + 10_000, st);
      expect(R(s.resolve(pool(s), NB + 20_000))).toBe(st);
    }
    const seq = session();
    seq.rc(NB + 10_000, 'VSC', { messageId: 'm1' });
    seq.rc(NB + 20_000, 'SC', { messageId: 'm2' });
    const out = seq.resolve(pool(seq), NB + 30_000);
    expect(R(out)).toBe('VSC');
    expect(valuesOf(out).message_id).toBe('m1');
  });

  it('QA11: local yellows are excluded; no new state with full coverage → NONE', () => {
    const s = session();
    s.sectorFlag(NB + 10_000, 2, 'YELLOW');
    s.sectorFlag(NB + 12_000, 3, 'DOUBLE_YELLOW');
    expect(R(s.resolve(pool(s), END + 1))).toBe('NONE');
  });

  it('QA12: no events because of a feed gap → VOID, not NONE', () => {
    const s = session().gap(NB + 20_000, NB + 25_000);
    expect(R(s.resolve(pool(s), END + 1))).toBe('PENDING');
    expect(R(s.resolve(pool(s), afterDeadline(s, pool(s))))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('a state already active before the window (repeated message) is not new; a fresh deployment is', () => {
    const s = session();
    s.rc(NB - 10_000, 'SC', { messageId: 'sc1' });
    s.rc(NB + 5_000, 'SC', { messageId: 'sc1' });
    expect(R(s.resolve(pool(s), END + 1))).toBe('NONE');
    s.rc(NB + 20_000, 'SC_ENDING', { messageId: 'e1' });
    s.rc(NB + 30_000, 'GREEN', { messageId: 'g1' });
    s.rc(NB + 40_000, 'VSC', { messageId: 'v1' });
    expect(R(s.resolve(pool(s), END + 1))).toBe('VSC');
  });

  it('unresolvable order between different states → VOID / AMBIGUOUS_EVENT_ORDER', () => {
    const s = session();
    s.rc(NB + 10_000, 'VSC', { messageId: 'a' });
    s.rc(NB + 10_000, 'SC', { messageId: 'b' });
    expect(R(s.resolve(pool(s), afterDeadline(s, pool(s))))).toBe('VOID:AMBIGUOUS_EVENT_ORDER');
  });
});

describe('F1-M12 first official retirement', () => {
  const pool = (s: SessionBuilder, params = {}) => s.shortPool('F1-M12', params, NB);
  const retire = (s: SessionBuilder, d: string, at: number, o: { uncertainty?: number; group?: string; sourceSequence?: string } = {}) =>
    s.status(d, at, { status: 'RETIRED', occupancy: 'ON_TRACK', sector: 2, ...o });

  it('first confirmed retirement in the window; earlier and provisional ones are ignored', () => {
    const s = session();
    retire(s, 'alo', NB - 1_000);
    s.status('str', NB + 1_000, { status: 'RETIRED', quality: 'PROVISIONAL' });
    retire(s, 'gas', NB + 10_000);
    retire(s, 'oco', NB + 20_000);
    const out = s.resolve(pool(s), NB + 15_000);
    expect(R(out)).toBe('gas');
    expect(valuesOf(out).driver_id).toBe('gas');
  });

  it('NONE with full coverage; gap → VOID', () => {
    const s = session();
    expect(R(s.resolve(pool(s), END + 1))).toBe('NONE');
    const g = session().gap(NB + 1, NB + 2);
    expect(R(g.resolve(pool(g), afterDeadline(g, pool(g))))).toBe('VOID:INCOMPLETE_OBSERVATION');
  });

  it('QA25: equal coarse timestamps with lost sequence → AMBIGUOUS_EVENT_ORDER, never SIMULTANEOUS', () => {
    const s = session();
    retire(s, 'gas', NB + 10_000, { uncertainty: 500 });
    retire(s, 'oco', NB + 10_000, { uncertainty: 500 });
    expect(R(s.resolve(pool(s), NB + 20_000))).toBe('PENDING');
    expect(R(s.resolve(pool(s), afterDeadline(s, pool(s))))).toBe('VOID:AMBIGUOUS_EVENT_ORDER');
    const declared = pool(s, { simultaneous_source_group: true });
    expect(R(s.resolve(declared, afterDeadline(s, declared)))).toBe('VOID:AMBIGUOUS_EVENT_ORDER');
    const seq = session();
    retire(seq, 'gas', NB + 10_000, { uncertainty: 500, sourceSequence: '41' });
    retire(seq, 'oco', NB + 10_000, { uncertainty: 500, sourceSequence: '40' });
    expect(R(seq.resolve(pool(seq), NB + 20_000))).toBe('oco');
  });

  it('QA26: confirmed source group or the declared tie profile → SIMULTANEOUS', () => {
    const g = session();
    retire(g, 'gas', NB + 10_000, { group: 'g1' });
    retire(g, 'oco', NB + 10_000, { group: 'g1' });
    const out = g.resolve(pool(g, { simultaneous_source_group: true }), NB + 20_000);
    expect(R(out)).toBe('SIMULTANEOUS');
    expect(valuesOf(out)).toMatchObject({ rule: 'SOURCE_GROUP', drivers: 'gas,oco' });
    // Without a declared rule the same evidence cannot produce SIMULTANEOUS.
    expect(R(g.resolve(pool(g), afterDeadline(g, pool(g))))).toBe('VOID:AMBIGUOUS_EVENT_ORDER');

    const tie = { tie_profile: { tie_precision_ms: 1_000, tie_origin_at: session().iso(0) } };
    const t = session();
    retire(t, 'gas', NB + 10_100, { uncertainty: 50 });
    retire(t, 'oco', NB + 10_700, { uncertainty: 50 });
    const tied = t.resolve(pool(t, tie), NB + 20_000);
    expect(R(tied)).toBe('SIMULTANEOUS');
    expect(valuesOf(tied)).toMatchObject({ rule: 'TIE_PROFILE', tie_bucket: 610 });

    const straddle = session();
    retire(straddle, 'gas', NB + 10_100, { uncertainty: 50 });
    retire(straddle, 'oco', NB + 10_980, { uncertainty: 50 });
    expect(R(straddle.resolve(pool(straddle, tie), afterDeadline(straddle, pool(straddle, tie))))).toBe('VOID:AMBIGUOUS_EVENT_ORDER');

    const apart = session();
    retire(apart, 'gas', NB + 10_100, { uncertainty: 50 });
    retire(apart, 'oco', NB + 12_500, { uncertainty: 50 });
    expect(R(apart.resolve(pool(apart, tie), NB + 20_000))).toBe('gas');
  });

  it('a degraded feed never trusts the source sequence (F1-030)', () => {
    const s = session();
    retire(s, 'gas', NB + 10_000, { uncertainty: 500, sourceSequence: '2' });
    retire(s, 'oco', NB + 10_000, { uncertainty: 500, sourceSequence: '1' });
    const p = pool(s);
    const ctx = s.ctx(p, afterDeadline(s, p));
    const degraded = { ...ctx, manifest: { ...ctx.manifest, quality: { ...ctx.manifest.quality, retirement: { ...ctx.manifest.quality.retirement, level: 'DEGRADED' as const } } } };
    expect(R(RESOLVERS['F1-M12'](degraded))).toBe('VOID:AMBIGUOUS_EVENT_ORDER');
  });
});
