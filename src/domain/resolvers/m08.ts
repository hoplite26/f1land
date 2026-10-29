/**
 * F1-M08 — next clean lap of A vs a frozen reference: FASTER, EQUAL, SLOWER, NO_VALID_LAP.
 * The first lap fully started inside [not_before, window_end) is fixed as the
 * attempt; if it is invalidated the result is NO_VALID_LAP (no substitution).
 * No suitable start with full observation → VOID / TARGET_NOT_STARTED; unknown
 * start/end by the deadline → VOID / INCOMPLETE_OBSERVATION. SC/VSC/RED during
 * the measurement → VOID / INTERRUPTED. Integer comparison (F1-012).
 */
import { ofType } from '../events/order';
import type { AnyEvent, Resolver } from '../types';
import { toMs } from '../windows';
import { firstStart, type AttemptStart } from './attempt';
import {
  inactiveOf,
  lapAttemptId,
  lapInvalidation,
  latestStatus,
  neutralisedDuring,
  observed,
  resolved,
  tOf,
  voided,
  waitOrVoid,
  win,
  type Values,
} from './common';

export const resolveM08: Resolver = (ctx) => {
  const { pool } = ctx;
  const A = pool.subject.driver_a!;
  const p = pool.target.parameters;
  const ref = p.reference_time_ms!;
  const w = win(ctx);
  const base: Values = { reference_time_ms: ref };

  // F1-027: after lock an invalidated reference voids the pool; no silent substitution.
  if (p.reference_attempt_id) {
    const inv = ofType(ctx.events, 'LAP_INVALIDATED').find((i) => i.payload.lap_attempt_id === p.reference_attempt_id);
    if (inv) return voided(ctx, 'REFERENCE_INVALID', [inv as AnyEvent], { ...base, reference_attempt_id: p.reference_attempt_id });
  }

  const laps = ofType(ctx.events, 'LAP_COMPLETED').filter((l) => l.payload.driver_id === A);
  const starts: AttemptStart[] = [];
  for (const l of laps) {
    starts.push({ at: toMs(l.payload.started_at), lap: l.payload.driver_lap, evidence: l as AnyEvent });
    starts.push({ at: tOf(l as AnyEvent), lap: l.payload.driver_lap + 1, evidence: l as AnyEvent });
  }
  const start = firstStart(starts, w.start, w.end);
  if (!start) {
    if (ctx.now_ms >= w.end && observed(ctx, w.start, w.end)) return voided(ctx, 'TARGET_NOT_STARTED', [], base, pool.target.window_end);
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [], base);
  }
  if (!observed(ctx, w.start, start.at + 1)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [start.evidence], base);

  const attempt = laps.find((l) => l.payload.driver_lap === start.lap) ?? null;
  const startedAt = new Date(start.at).toISOString();
  const pendingValues: Values = { ...base, attempt_lap: start.lap, attempt_started_at: startedAt, target_start_at: startedAt };

  if (!attempt) {
    const neutral = neutralisedDuring(ctx.events, start.at, ctx.now_ms + 1);
    if (neutral && observed(ctx, start.at, tOf(neutral) + 1)) return voided(ctx, 'INTERRUPTED', [start.evidence, neutral], pendingValues);
    const status = latestStatus(ctx.events, A, ctx.now_ms);
    if (status && inactiveOf(status.payload.status) && tOf(status as AnyEvent) >= start.at && observed(ctx, start.at, tOf(status as AnyEvent) + 1)) {
      return resolved(ctx, 'NO_VALID_LAP', [start.evidence, status], { ...pendingValues, status: status.payload.status });
    }
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [start.evidence], pendingValues);
  }

  const lap = attempt.payload;
  const attemptEv = attempt as AnyEvent;
  const values: Values = {
    ...pendingValues,
    attempt_id: lapAttemptId(attempt),
    driver_lap: lap.driver_lap,
    leader_lap: lap.leader_lap,
    lap_time_ms: lap.lap_time_ms,
    delta_ms: lap.lap_time_ms - ref,
  };
  const neutral = lap.neutralised ? attemptEv : neutralisedDuring(ctx.events, toMs(lap.started_at), tOf(attemptEv));
  if (neutral) return voided(ctx, 'INTERRUPTED', [attemptEv, neutral], { ...values, neutralised: true });
  const inv = lapInvalidation(ctx.events, attempt);
  if (!lap.valid || inv || lap.pit_in_lap || lap.pit_out_lap) {
    return resolved(ctx, 'NO_VALID_LAP', [attemptEv, inv as AnyEvent | null], {
      ...values,
      valid: false,
      invalidation_reason: inv?.payload.reason ?? (lap.pit_in_lap || lap.pit_out_lap ? 'PIT_LAP' : 'INVALID'),
    });
  }
  const outcome = lap.lap_time_ms < ref ? 'FASTER' : lap.lap_time_ms === ref ? 'EQUAL' : 'SLOWER';
  return resolved(ctx, outcome, [attemptEv], { ...values, valid: true });
};
