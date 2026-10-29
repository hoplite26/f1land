import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterDeadline, session } from './__fixtures__/builder';
import { previousFinalSettlement, settlePool, settlementPhase } from './settlement';

const NB = 600_000;

function m05() {
  const s = session();
  const pool = s.shortPool('F1-M05', { driver_a: 'nor' }, NB);
  return { s, pool };
}

afterEach(() => vi.useRealTimers());

describe('settlePool lifecycle (F1-054, F1-055)', () => {
  it('OPEN → LOCKED → RESOLVING → provisional → SETTLED after watermark + review period', () => {
    const { s, pool } = m05();
    expect(settlePool(pool, s.input(NB - 2_000))).toBe(pool);
    expect(settlePool(pool, s.input(NB - 500)).status).toBe('LOCKED');
    const waiting = settlePool(pool, s.input(NB + 5_000));
    expect(waiting).toMatchObject({ status: 'RESOLVING', settlement: null });

    const entry = s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    const exit = s.pitExit('nor', NB + 32_000, { visit: 'v1', stop: 2_600 });
    const p1 = settlePool(waiting, s.input(NB + 33_000));
    expect(p1.status).toBe('RESOLVING');
    expect(p1.settlement).toEqual({
      pool_id: pool.pool_id,
      winner_outcome_id: 'BUCKET_2',
      void_reason: null,
      evidence_source_event_ids: [entry.source_event_id, exit.source_event_id],
      evidence_revisions: { [entry.source_event_id]: '1', [exit.source_event_id]: '1' },
      normalized_values: expect.objectContaining({ stop_duration_ms: 2_600, t1_ms: 2_500, t2_ms: 3_000, service: 'TYRES' }),
      template_version: 'f1-m05-v1',
      settlement_revision: 1,
      determined_at: exit.received_at,
      provisional: true,
    });
    expect(settlePool(p1, s.input(NB + 40_000))).toBe(p1);
    const p2 = settlePool(p1, s.input(NB + 48_000));
    expect(p2.status).toBe('SETTLED');
    expect(p2.settlement).toMatchObject({ provisional: false, settlement_revision: 1 });
    expect(settlementPhase(p2)).toBe('FINAL');
  });

  it('is deterministic: same events → identical result, independent of the wall clock', () => {
    const { s, pool } = m05();
    s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    s.pitExit('nor', NB + 32_000, { visit: 'v1', stop: 2_600 });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const a = settlePool(pool, s.input(NB + 60_000));
    vi.setSystemTime(new Date('2031-06-01T00:00:00Z'));
    const b = settlePool(pool, s.input(NB + 60_000));
    expect(a).toEqual(b);
    // Reaching the same final state through a provisional step gives the same record.
    const stepped = settlePool(settlePool(pool, s.input(NB + 33_000)), s.input(NB + 60_000));
    expect(stepped).toEqual(a);
  });

  it('correction before finalisation recomputes the provisional result (F1-056)', () => {
    const { s, pool } = m05();
    s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    const exit = s.pitExit('nor', NB + 32_000, { visit: 'v1', stop: 2_600 });
    const p1 = settlePool(pool, s.input(NB + 33_000));
    s.revise(exit, NB + 35_000, { stop_duration_ms: 2_400 });
    const p2 = settlePool(p1, s.input(NB + 36_000));
    expect(p2.settlement).toMatchObject({ winner_outcome_id: 'BUCKET_1', settlement_revision: 2, provisional: true });
    expect(p2.settlement!.evidence_revisions[exit.source_event_id]).toBe('2');
    expect(p2.settlement_history.map((h) => h.winner_outcome_id)).toEqual(['BUCKET_2']);
    expect(settlementPhase(p2)).toBe('PROVISIONAL');
  });

  it('QA18: correction after SETTLED creates a new revision and keeps the previous in history', () => {
    const { s, pool } = m05();
    s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    const exit = s.pitExit('nor', NB + 32_000, { visit: 'v1', stop: 2_600 });
    const settled = settlePool(pool, s.input(NB + 60_000));
    expect(settled.settlement).toMatchObject({ provisional: false, winner_outcome_id: 'BUCKET_2' });
    s.revise(exit, NB + 100_000, { stop_duration_ms: 3_100 });
    const corrected = settlePool(settled, s.input(NB + 101_000));
    expect(corrected.status).toBe('SETTLED');
    expect(corrected.settlement).toMatchObject({ winner_outcome_id: 'BUCKET_3', settlement_revision: 2, provisional: false });
    expect(corrected.settlement_history).toHaveLength(1);
    expect(previousFinalSettlement(corrected)!.winner_outcome_id).toBe('BUCKET_2');
    expect(settlementPhase(corrected)).toBe('CORRECTED');
    expect(settlePool(corrected, s.input(NB + 102_000))).toBe(corrected);
  });

  it('a withdrawn provisional result returns to RESOLVING with history', () => {
    const { s, pool } = m05();
    s.pitEntry('nor', NB + 10_000, { visit: 'v1' });
    const exit = s.pitExit('nor', NB + 32_000, { visit: 'v1', stop: 2_600 });
    const p1 = settlePool(pool, s.input(NB + 33_000));
    s.retract(exit, NB + 34_000);
    const p2 = settlePool(p1, s.input(NB + 35_000));
    expect(p2).toMatchObject({ status: 'RESOLVING', settlement: null });
    expect(p2.settlement_history).toHaveLength(1);
  });

  it('after a final VOID late data never revives the pool (F1-067)', () => {
    const s = session().gap(NB + 30_000, NB + 31_000);
    const pool = s.shortPool('F1-M03', {}, NB);
    const voided = settlePool(pool, s.input(afterDeadline(s, pool)));
    expect(voided.status).toBe('VOID');
    expect(voided.settlement).toMatchObject({ void_reason: 'INCOMPLETE_OBSERVATION', provisional: false, determined_at: pool.settlement_deadline });
    s.pitEntry('lec', NB + 10_000, { visit: 'late' });
    expect(settlePool(voided, s.input(afterDeadline(s, pool, 60_000)))).toBe(voided);
  });

  it('F1-017: acceptance overlapping the actual target start voids the whole pool', () => {
    const { s, pool } = m05();
    s.pitEntry('nor', NB, { visit: 'v1', uncertainty: 1_500 });
    s.pitExit('nor', NB + 22_000, { visit: 'v1', stop: 2_600 });
    const clean = settlePool(pool, s.input(NB + 60_000), { accepted_at_ms: [s.abs(NB - 30_000)] });
    expect(clean.settlement!.winner_outcome_id).toBe('BUCKET_2');
    const dirty = settlePool(pool, s.input(NB + 60_000), { accepted_at_ms: [s.abs(NB - 30_000), s.abs(NB - 1_200)] });
    expect(dirty.status).toBe('VOID');
    expect(dirty.settlement!.void_reason).toBe('TARGET_BOUNDARY_CONTAMINATED');
  });
});
