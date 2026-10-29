/**
 * F1-M05 — stationary stop time of A: [0,t1), [t1,t2), [t2,∞) ms, NO_SERVICE.
 * Measures only the stationary part (never lane_duration — F1-031). 2500 ms
 * belongs to the second bucket, 3000 ms to the third (DEMO thresholds).
 * A confirmed drive-through (or stop-go, where no work is allowed) → NO_SERVICE;
 * a missing stationary-stop feed is NOT NO_SERVICE (F1-064).
 */
import type { AnyEvent, Resolver } from '../types';
import { bucketOf, firstNormalVisit, resolved, waitOrVoid } from './common';

export const resolveM05: Resolver = (ctx) => {
  const A = ctx.pool.subject.driver_a!;
  const { t1_ms, t2_ms } = ctx.pool.target.parameters;
  const visit = firstNormalVisit(ctx, A);
  if (visit.kind === 'DONE') return visit.output;
  if (visit.kind === 'NONE') return resolved(ctx, 'NO_SERVICE', [], { visits: 0 }, ctx.pool.target.window_end);

  const { entry, exit } = visit;
  const evidence: AnyEvent[] = [entry as AnyEvent, exit as AnyEvent];
  const values = { ...visit.values, service: exit.payload.service, t1_ms: t1_ms!, t2_ms: t2_ms! };
  if (exit.payload.service === 'DRIVE_THROUGH' || exit.payload.service === 'STOP_GO') {
    return resolved(ctx, 'NO_SERVICE', evidence, { ...values, lane_duration_ms: exit.payload.lane_duration_ms });
  }
  const stop = exit.payload.stop_duration_ms;
  if (stop === null || !Number.isInteger(stop) || stop < 0) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', evidence, values);
  return resolved(ctx, bucketOf(stop, t1_ms!, t2_ms!), evidence, { ...values, stop_duration_ms: stop });
};
