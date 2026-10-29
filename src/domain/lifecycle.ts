/**
 * Pool lifecycle (F1-015, F1-016, F1-023, F1-010, F1-026, F1-044, F1-058).
 *
 * DRAFT → SCHEDULED → OPEN → LOCKED → RESOLVING → SETTLED | VOID, plus the
 * parallel intake_status ACCEPTING | SUSPENDED. Entries are accepted strictly
 * before closes_at by server time; a closed pool is never re-opened or
 * silently extended. A red flag suspends intake of short-term pools and the
 * suspension is not lifted automatically — resumption creates new pools.
 */
import { CATALOG, requiredCapabilitiesFor } from './markets/catalog';
import type { Capability, Pool, PoolStatus, SessionStatus, TrackState } from './types';
import { toMs } from './windows';

export interface RaceState {
  trackState: TrackState;
  sessionStatus: SessionStatus;
  signalsLost?: Capability[];
}

export function advancePool(pool: Pool, nowMs: number, race: RaceState): Pool {
  let status: PoolStatus = pool.status;
  if (status === 'SCHEDULED' && nowMs >= toMs(pool.opens_at)) status = 'OPEN';
  if (status === 'OPEN' && nowMs >= toMs(pool.closes_at)) status = 'LOCKED';
  if (status === 'LOCKED' && nowMs >= toMs(pool.target.not_before)) status = 'RESOLVING';

  let intake = pool.intake_status;
  let reason = pool.suspend_reason ?? null;
  if (status === 'OPEN' || status === 'SCHEDULED') {
    const templ = CATALOG[pool.market_id];
    const required = requiredCapabilitiesFor(templ, pool.target.parameters);
    const lost = (race.signalsLost ?? []).some((c) => required.includes(c));
    const redNow = race.trackState === 'RED' || race.sessionStatus === 'SUSPENDED';
    const redSticky = reason === 'RED_FLAG' || reason === 'SESSION_SUSPENDED';
    if (templ.short_term && (redNow || redSticky)) {
      intake = 'SUSPENDED';
      reason = redSticky ? reason : race.trackState === 'RED' ? 'RED_FLAG' : 'SESSION_SUSPENDED';
    } else if (race.sessionStatus === 'CANCELLED') {
      intake = 'SUSPENDED';
      reason = 'SESSION_SUSPENDED';
    } else if (lost) {
      intake = 'SUSPENDED';
      reason = 'SIGNAL_LOST';
    } else {
      intake = 'ACCEPTING';
      reason = null;
    }
  }

  if (status === pool.status && intake === pool.intake_status && reason === (pool.suspend_reason ?? null)) return pool;
  return { ...pool, status, intake_status: intake, suspend_reason: reason };
}

export function advancePools(pools: readonly Pool[], nowMs: number, race: RaceState): Pool[] {
  return pools.map((p) => advancePool(p, nowMs, race));
}

/** True only while OPEN, ACCEPTING and opens_at ≤ now < closes_at (server time) — QA17. */
export function canAcceptEntry(pool: Pool, nowMs: number): boolean {
  return (
    pool.status === 'OPEN' &&
    pool.intake_status === 'ACCEPTING' &&
    nowMs >= toMs(pool.opens_at) &&
    nowMs < toMs(pool.closes_at)
  );
}

/** i18n key explaining why the confirm button is disabled, or null when entries are accepted. */
export function entryBlockReason(pool: Pool, nowMs: number): string | null {
  if (canAcceptEntry(pool, nowMs)) return null;
  if (pool.status === 'DRAFT' || pool.status === 'SCHEDULED' || nowMs < toMs(pool.opens_at)) return 'f1.entry.not_open';
  if (pool.status === 'OPEN' && pool.intake_status === 'SUSPENDED') {
    return `f1.entry.suspended.${(pool.suspend_reason ?? 'SIGNAL_LOST').toLowerCase()}`;
  }
  return 'f1.entry.closed';
}

export function msUntilLock(pool: Pool, nowMs: number): number {
  return Math.max(0, toMs(pool.closes_at) - nowMs);
}

/** F1-044 — a saved draft is reusable only for the same session, pool, version and an accepting pool. */
export function canResumeDraft(
  draft: { session_id: string; pool_id: string; version: number },
  pool: Pool,
  nowMs: number,
): boolean {
  return draft.session_id === pool.session_id && draft.pool_id === pool.pool_id && draft.version === pool.version && canAcceptEntry(pool, nowMs);
}
