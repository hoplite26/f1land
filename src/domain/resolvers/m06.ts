/**
 * F1-M06 — pit lane visit time of A (PIT_ENTRY → PIT_EXIT): [0,t1), [t1,t2),
 * [t2,∞) ms, NO_VISIT. t1/t2 frozen on the card. A drive-through is measurable.
 */
import type { AnyEvent, Resolver } from '../types';
import { bucketOf, firstNormalVisit, resolved, waitOrVoid } from './common';

export const resolveM06: Resolver = (ctx) => {
  const A = ctx.pool.subject.driver_a!;
  const { t1_ms, t2_ms } = ctx.pool.target.parameters;
  const visit = firstNormalVisit(ctx, A);
  if (visit.kind === 'DONE') return visit.output;
  if (visit.kind === 'NONE') return resolved(ctx, 'NO_VISIT', [], { visits: 0 }, ctx.pool.target.window_end);

  const { entry, exit } = visit;
  const evidence: AnyEvent[] = [entry as AnyEvent, exit as AnyEvent];
  const values = { ...visit.values, service: exit.payload.service, t1_ms: t1_ms!, t2_ms: t2_ms! };
  const lane = exit.payload.lane_duration_ms;
  if (lane === null || !Number.isInteger(lane) || lane < 0) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', evidence, values);
  return resolved(ctx, bucketOf(lane, t1_ms!, t2_ms!), evidence, { ...values, lane_duration_ms: lane });
};
