/**
 * Settlement (F1-054 … F1-056, F1-067, F1-017).
 *
 * LOCKED → RESOLVING → SETTLED | VOID. A result stays provisional until the
 * stream watermark has passed its determination time and the review period
 * has elapsed (or the absolute deadline is reached). Corrections before
 * finalisation recompute the provisional result; corrections after it create
 * a new settlement_revision and keep the previous record in
 * settlement_history (never a silent overwrite). A final VOID is never
 * revived by late data. Same events + same now → identical output.
 */
import { reviewPeriodMs } from '@/config/profiles';
import { stableStringify } from './events/checksum';
import { CATALOG } from './markets/catalog';
import { RESOLVERS } from './resolvers';
import type { Pool, PoolStatus, Resolver, ResolverContext, ResolverOutput, Settlement } from './types';
import { contaminated, toIso, toMs } from './windows';

export type SettlementInput = Omit<ResolverContext, 'pool'>;

export interface SettleOptions {
  /** Override the review period (ms). */
  review_ms?: number;
  /** Acceptance times of entries — F1-017 TARGET_BOUNDARY_CONTAMINATED check. */
  accepted_at_ms?: readonly number[];
  /** Resolver override (tests / replays). */
  resolver?: Resolver;
}

function withContamination(pool: Pool, input: SettlementInput, out: ResolverOutput, accepted?: readonly number[]): ResolverOutput {
  if (out.state === 'PENDING' || !accepted || accepted.length === 0) return out;
  const startIso = typeof out.values.target_start_at === 'string' ? out.values.target_start_at : pool.target.not_before;
  let uncertainty = 0;
  for (const id of out.evidence) {
    const e = input.events.find((x) => x.source_event_id === id);
    if (e) uncertainty = Math.max(uncertainty, e.timestamp_uncertainty_ms);
  }
  if (!contaminated(accepted, toMs(startIso), uncertainty)) return out;
  return {
    state: 'VOID',
    reason: 'TARGET_BOUNDARY_CONTAMINATED',
    evidence: out.evidence,
    values: { ...out.values, target_start_at: startIso, contaminated: true },
    determined_at: out.determined_at ?? toIso(toMs(startIso)),
  };
}

function resultKey(s: Pick<Settlement, 'winner_outcome_id' | 'void_reason' | 'evidence_source_event_ids' | 'evidence_revisions' | 'normalized_values'>): string {
  return stableStringify([s.winner_outcome_id, s.void_reason, s.evidence_source_event_ids, s.evidence_revisions, s.normalized_values]);
}

function finalStatus(s: Settlement): PoolStatus {
  return s.winner_outcome_id !== null ? 'SETTLED' : 'VOID';
}

export function settlePool(pool: Pool, input: SettlementInput, opts: SettleOptions = {}): Pool {
  const now = input.now_ms;
  if (pool.status === 'DRAFT' || pool.status === 'SCHEDULED') return pool;
  if (pool.status === 'OPEN' && now < toMs(pool.closes_at)) return pool;
  const current = pool.settlement;
  if (pool.status === 'VOID' && current && !current.provisional) return pool;

  const resolver = opts.resolver ?? RESOLVERS[pool.market_id];
  const out = withContamination(pool, input, resolver({ ...input, pool }), opts.accepted_at_ms);
  const waitingStatus: PoolStatus = now >= toMs(pool.target.not_before) ? 'RESOLVING' : 'LOCKED';

  if (out.state === 'PENDING') {
    if (current && !current.provisional) return pool;
    if (current) {
      // A correction withdrew the provisional result before finalisation.
      return { ...pool, status: 'RESOLVING', settlement: null, settlement_history: [...pool.settlement_history, current] };
    }
    const status = pool.status === 'RESOLVING' ? 'RESOLVING' : waitingStatus;
    return status === pool.status ? pool : { ...pool, status };
  }

  const determinedAt = out.determined_at ?? toIso(toMs(pool.target.window_end));
  const review = opts.review_ms ?? reviewPeriodMs(CATALOG[pool.market_id].family);
  const isFinal =
    now >= toMs(pool.settlement_deadline) ||
    (input.coverage.watermark_ms >= toMs(determinedAt) && now >= toMs(determinedAt) + review);

  const evidence_revisions: Record<string, string> = {};
  for (const id of out.evidence) {
    const e = input.events.find((x) => x.source_event_id === id);
    if (e) evidence_revisions[id] = e.source_revision;
  }
  const candidate = (revision: number, provisional: boolean): Settlement => ({
    pool_id: pool.pool_id,
    winner_outcome_id: out.state === 'RESOLVED' ? out.winner_outcome_id : null,
    void_reason: out.state === 'VOID' ? out.reason : null,
    evidence_source_event_ids: [...out.evidence],
    evidence_revisions,
    normalized_values: { ...out.values },
    template_version: pool.template_version,
    settlement_revision: revision,
    determined_at: toIso(toMs(determinedAt)),
    provisional,
  });

  if (!current) {
    const s = candidate(1, !isFinal);
    return { ...pool, status: isFinal ? finalStatus(s) : 'RESOLVING', settlement: s };
  }

  const same = resultKey(current) === resultKey(candidate(current.settlement_revision, current.provisional));
  if (!current.provisional) {
    if (same) return pool;
    // F1-056: correction after finalisation → linked revision, previous kept in history.
    const s = candidate(current.settlement_revision + 1, false);
    return { ...pool, status: finalStatus(s), settlement: s, settlement_history: [...pool.settlement_history, current] };
  }
  if (same) {
    if (!isFinal) return pool.status === 'RESOLVING' ? pool : { ...pool, status: 'RESOLVING' };
    const s: Settlement = { ...current, provisional: false };
    return { ...pool, status: finalStatus(s), settlement: s };
  }
  const s = candidate(current.settlement_revision + 1, !isFinal);
  return {
    ...pool,
    status: isFinal ? finalStatus(s) : 'RESOLVING',
    settlement: s,
    settlement_history: [...pool.settlement_history, current],
  };
}

export type SettlementPhase = 'NONE' | 'PROVISIONAL' | 'FINAL' | 'CORRECTED';

/** UI phase: CORRECTED when a final result was replaced by a later revision (F1-056 "Результат исправлен"). */
export function settlementPhase(pool: Pick<Pool, 'settlement' | 'settlement_history'>): SettlementPhase {
  if (!pool.settlement) return 'NONE';
  if (pool.settlement.provisional) return 'PROVISIONAL';
  return pool.settlement_history.some((s) => !s.provisional) ? 'CORRECTED' : 'FINAL';
}

/** The previous final record replaced by a correction, for the history view. */
export function previousFinalSettlement(pool: Pick<Pool, 'settlement_history'>): Settlement | null {
  for (let i = pool.settlement_history.length - 1; i >= 0; i--) {
    const s = pool.settlement_history[i]!;
    if (!s.provisional) return s;
  }
  return null;
}
