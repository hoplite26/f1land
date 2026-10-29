import { describe, expect, it } from 'vitest';
import { session } from './__fixtures__/builder';
import { advancePool, canAcceptEntry, canResumeDraft, entryBlockReason, msUntilLock, type RaceState } from './lifecycle';

const GREEN: RaceState = { trackState: 'GREEN', sessionStatus: 'STARTED' };
const RED: RaceState = { trackState: 'RED', sessionStatus: 'SUSPENDED' };

describe('advancePool (F1-015, F1-016)', () => {
  it('SCHEDULED → OPEN at opens_at → LOCKED at closes_at → RESOLVING at not_before', () => {
    const s = session();
    const p = s.pool('F1-M05', { driver_a: 'nor' }, { created: -10_000, opens: 0, closes: 60_000, notBefore: 63_000, windowEnd: 123_000 });
    expect(p.status).toBe('SCHEDULED');
    expect(advancePool(p, s.abs(-1), GREEN)).toBe(p);
    const open = advancePool(p, s.abs(0), GREEN);
    expect(open.status).toBe('OPEN');
    expect(advancePool(open, s.abs(59_999), GREEN)).toBe(open);
    expect(advancePool(open, s.abs(60_000), GREEN).status).toBe('LOCKED');
    expect(advancePool(open, s.abs(63_000), GREEN).status).toBe('RESOLVING');
    expect(advancePool(p, s.abs(61_000), GREEN).status).toBe('LOCKED');
  });

  it('QA17: entries are accepted strictly before closes_at, by server time', () => {
    const s = session();
    const p = s.pool('F1-M05', { driver_a: 'nor' }, { opens: 0, closes: 60_000, notBefore: 63_000, windowEnd: 123_000 });
    expect(canAcceptEntry(p, s.abs(59_999))).toBe(true);
    // Even before advancePool runs, the confirm button is disabled at closes_at.
    expect(canAcceptEntry(p, s.abs(60_000))).toBe(false);
    expect(entryBlockReason(p, s.abs(60_000))).toBe('f1.entry.closed');
    expect(entryBlockReason(p, s.abs(-1))).toBe('f1.entry.not_open');
    expect(msUntilLock(p, s.abs(59_000))).toBe(1_000);
    expect(msUntilLock(p, s.abs(70_000))).toBe(0);
  });

  it('RED suspends short-term intake (sticky), never re-opens or extends a closed pool (F1-023, F1-026)', () => {
    const s = session();
    const short = s.pool('F1-M03', {}, { opens: 0, closes: 60_000, notBefore: 63_000, windowEnd: 123_000 });
    const final = s.pool('F1-M13', { driver_a: 'nor' }, { opens: 0, closes: 60_000 });
    const red = advancePool(short, s.abs(10_000), RED);
    expect(red).toMatchObject({ status: 'OPEN', intake_status: 'SUSPENDED', suspend_reason: 'RED_FLAG' });
    expect(canAcceptEntry(red, s.abs(10_000))).toBe(false);
    expect(entryBlockReason(red, s.abs(10_000))).toBe('f1.entry.suspended.red_flag');
    const resumed = advancePool(red, s.abs(20_000), GREEN);
    expect(resumed.intake_status).toBe('SUSPENDED');
    expect(advancePool(final, s.abs(10_000), RED).intake_status).toBe('ACCEPTING');
    const locked = advancePool(red, s.abs(61_000), GREEN);
    expect(locked.status).toBe('LOCKED');
    expect(locked.closes_at).toBe(short.closes_at);
    expect(advancePool(locked, s.abs(10_000), GREEN).status).toBe('LOCKED');
  });

  it('F1-010: a lost required signal suspends only affected pools and resumes when restored', () => {
    const s = session();
    const m05 = s.pool('F1-M05', { driver_a: 'nor' }, { opens: 0, closes: 60_000, notBefore: 63_000, windowEnd: 123_000 });
    const m06 = s.pool('F1-M06', { driver_a: 'nor' }, { opens: 0, closes: 60_000, notBefore: 63_000, windowEnd: 123_000 });
    const lost: RaceState = { ...GREEN, signalsLost: ['stationary_stop'] };
    expect(advancePool(m05, s.abs(1_000), lost)).toMatchObject({ intake_status: 'SUSPENDED', suspend_reason: 'SIGNAL_LOST' });
    expect(advancePool(m06, s.abs(1_000), lost).intake_status).toBe('ACCEPTING');
    const back = advancePool(advancePool(m05, s.abs(1_000), lost), s.abs(2_000), GREEN);
    expect(back).toMatchObject({ intake_status: 'ACCEPTING', suspend_reason: null });
  });

  it('F1-044: drafts resume only for the same session, pool, version and an accepting pool', () => {
    const s = session();
    const p = s.pool('F1-M05', { driver_a: 'nor' }, { opens: 0, closes: 60_000, notBefore: 63_000, windowEnd: 123_000 });
    const draft = { session_id: p.session_id, pool_id: p.pool_id, version: p.version };
    expect(canResumeDraft(draft, p, s.abs(1_000))).toBe(true);
    expect(canResumeDraft({ ...draft, version: 2 }, p, s.abs(1_000))).toBe(false);
    expect(canResumeDraft({ ...draft, session_id: 'other' }, p, s.abs(1_000))).toBe(false);
    expect(canResumeDraft(draft, p, s.abs(60_000))).toBe(false);
  });
});
