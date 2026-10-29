/**
 * F1-M11 — where A is at instant T: S1, S2, S3, PIT, RETIRED, DNS, DSQ.
 * Confirmed sector/occupancy/status valid at T with occurrence ≤ T and a
 * complete stream up to T (F1-070). PIT includes the garage and the initial
 * GARAGE/PIT_LANE snapshot (F1-068, QA21). The render coordinate is never a
 * source. Uncertainty straddling T that changes the answer → VOID.
 * RED before T → VOID (snapshot family).
 */
import type { Resolver } from '../types';
import { toMs } from '../windows';
import { atLeast, firstRedOnset, locationAt, pending, resolved, voided, waitOrVoid, win } from './common';

export const resolveM11: Resolver = (ctx) => {
  const A = ctx.pool.subject.driver_a!;
  const atIso = ctx.pool.target.parameters.at_instant ?? ctx.pool.target.window_end;
  const T = toMs(atIso);
  const w = win(ctx);
  const base = { at_instant: atIso };
  if (ctx.now_ms < T) return pending(base);
  const red = firstRedOnset(ctx.events, w.start, T + 1);
  if (red) return voided(ctx, 'INTERRUPTED', [red], { ...base, red_flag_at: red.occurred_at });
  const loc = locationAt(ctx, A, T);
  if (loc.kind === 'AMBIGUOUS') return waitOrVoid(ctx, 'AMBIGUOUS_EVENT_ORDER', loc.evidence, base);
  if (loc.kind === 'UNKNOWN') return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', loc.evidence, base);
  return resolved(ctx, loc.location, loc.evidence, { ...base, ...loc.values }, atLeast(atIso, loc.evidence));
};
