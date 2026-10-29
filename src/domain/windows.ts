/**
 * Time-window helpers (F1-016, F1-017, F1-020, F1-067).
 *
 * Every event interval is half-open [start, end): the start is included and
 * the end is excluded, so an event at exactly target.window_end is outside
 * the window (F1-QA16).
 */
import { DEADLINE_PROFILE, type DeadlineProfile } from '@/config/profiles';
import type { FeedCoverage, MarketId, TargetSpec } from './types';

export const toMs = (iso: string): number => Date.parse(iso);
export const toIso = (ms: number): string => new Date(ms).toISOString();

/** start ≤ t < end. */
export function inWindow(tMs: number, startMs: number, endMs: number): boolean {
  return tMs >= startMs && tMs < endMs;
}

export function inTargetWindow(occurredAtIso: string, target: Pick<TargetSpec, 'not_before' | 'window_end'>): boolean {
  return inWindow(toMs(occurredAtIso), toMs(target.not_before), toMs(target.window_end));
}

export function mergeIntervals(intervals: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const sorted = intervals
    .filter(([a, b]) => b > a)
    .map(([a, b]) => [a, b] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** First unobserved sub-interval of [start, end), or null when fully covered. */
export function firstGap(coverage: FeedCoverage, startMs: number, endMs: number): [number, number] | null {
  if (endMs <= startMs) return null;
  let cursor = startMs;
  for (const [a, b] of mergeIntervals(coverage.intervals)) {
    if (b <= cursor) continue;
    if (a > cursor) return [cursor, Math.min(a, endMs)];
    cursor = b;
    if (cursor >= endMs) break;
  }
  if (cursor < endMs) return [cursor, endMs];
  if (coverage.watermark_ms < endMs) return [Math.max(startMs, coverage.watermark_ms), endMs];
  return null;
}

/**
 * True when [start, end) lies inside the observed intervals and the stream
 * watermark has passed `end` (F1-020: only then can "no event" be claimed).
 */
export function isFullyObserved(coverage: FeedCoverage, startMs: number, endMs: number): boolean {
  if (endMs <= startMs) return coverage.watermark_ms >= startMs;
  return firstGap(coverage, startMs, endMs) === null;
}

/**
 * F1-017 — TARGET_BOUNDARY_CONTAMINATED: any accepted entry whose acceptance
 * time, widened by the timestamp uncertainty, reaches the actual target start.
 * The whole pool is voided; selective removal of entries is forbidden.
 */
export function contaminated(acceptedAtMs: readonly number[], targetStartMs: number, uncertaintyMs: number): boolean {
  return acceptedAtMs.some((t) => t + uncertaintyMs >= targetStartMs);
}

export type DeadlineRule = 'SHORT' | 'PIT_VISIT' | 'M08' | 'M19' | 'SESSION_FINAL' | 'SNAPSHOT';

const SESSION_FINAL_MARKETS: readonly MarketId[] = ['F1-M13', 'F1-M14', 'F1-M15', 'F1-M16', 'F1-M17', 'F1-M18'];

export function deadlineRuleFor(marketId: MarketId, targetKind?: TargetSpec['kind']): DeadlineRule {
  if (SESSION_FINAL_MARKETS.includes(marketId)) return 'SESSION_FINAL';
  if (marketId === 'F1-M04' || marketId === 'F1-M05' || marketId === 'F1-M06') return 'PIT_VISIT';
  if (marketId === 'F1-M08') return 'M08';
  if (marketId === 'F1-M19') return 'M19';
  if (marketId === 'F1-M11' || targetKind === 'AT_INSTANT') return 'SNAPSHOT';
  return 'SHORT';
}

/**
 * F1-067 — immutable absolute settlement deadline, fixed before OPEN.
 * Returns null when no finite cutoff can be derived (M13–M18 without a planned
 * end): such a pool must receive an explicit UTC cutoff or never open.
 */
export function computeSettlementDeadline(
  marketId: MarketId,
  target: Pick<TargetSpec, 'kind' | 'not_before' | 'window_end' | 'parameters'>,
  plannedEnd?: string | null,
  profile: DeadlineProfile = DEADLINE_PROFILE,
): string | null {
  const rule = deadlineRuleFor(marketId, target.kind);
  const end = toMs(target.window_end);
  switch (rule) {
    case 'SESSION_FINAL': {
      if (!plannedEnd) return null;
      const planned = toMs(plannedEnd);
      return Number.isFinite(planned) ? toIso(planned + profile.session_final_ms) : null;
    }
    case 'SNAPSHOT': {
      const t = toMs(target.parameters.at_instant ?? target.window_end);
      return Number.isFinite(t) ? toIso(t + profile.snapshot_ms) : null;
    }
    case 'PIT_VISIT':
      return Number.isFinite(end) ? toIso(end + profile.pit_visit_ms) : null;
    case 'M08':
      return Number.isFinite(end) ? toIso(end + profile.m08_ms) : null;
    case 'M19':
      return Number.isFinite(end) ? toIso(end + profile.m19_ms) : null;
    case 'SHORT':
      return Number.isFinite(end) ? toIso(end + profile.short_window_ms) : null;
  }
}

/** effective_deadline = min(local_deadline, settlement_deadline); the outer deadline never moves. */
export function effectiveDeadline(localMs: number | null | undefined, settlementMs: number): number {
  if (localMs == null || !Number.isFinite(localMs)) return settlementMs;
  return Math.min(localMs, settlementMs);
}
