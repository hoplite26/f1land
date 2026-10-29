/**
 * F1-M16 — best time of A vs B inside one Q/SQ segment: A, B, TIE, NEITHER_VALID.
 * Best valid laps within the fixed segment_id (invalidated laps excluded).
 * The segment is complete when its official classification is published, or
 * when it ended and the DEMO run-out for laps in progress has elapsed.
 */
import { DEMO_SEGMENT_RUNOUT_MS } from '@/config/profiles';
import { ofType } from '../events/order';
import type { AnyEvent, NormalizedEvent, Resolver } from '../types';
import { inWindow, toIso, toMs } from '../windows';
import {
  atLeast,
  isValidLap,
  lapAttemptId,
  lapInvalidation,
  observed,
  officialClassification,
  resolved,
  sessionFinalFallback,
  sessionMarkers,
  tOf,
  waitOrVoid,
} from './common';

export const resolveM16: Resolver = (ctx) => {
  const { pool } = ctx;
  const A = pool.subject.driver_a!;
  const B = pool.subject.driver_b!;
  const segment = pool.target.parameters.segment_id!;
  const markers = sessionMarkers(ctx.events, segment);
  const cls = officialClassification(ctx.events, 'SEGMENT', segment);
  let complete: number | null = null;
  if (cls) complete = tOf(cls as AnyEvent);
  else if (markers.ended && ctx.now_ms >= tOf(markers.ended) + DEMO_SEGMENT_RUNOUT_MS) complete = tOf(markers.ended) + DEMO_SEGMENT_RUNOUT_MS;
  if (complete === null) return sessionFinalFallback(ctx, segment, { segment_id: segment });

  const startMs = markers.started ? tOf(markers.started) : toMs(pool.target.not_before);
  if (!observed(ctx, startMs, complete)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [], { segment_id: segment });

  const laps = ofType(ctx.events, 'LAP_COMPLETED').filter(
    (l) =>
      (l.payload.driver_id === A || l.payload.driver_id === B) &&
      (l.payload.segment_id ? l.payload.segment_id === segment : inWindow(tOf(l as AnyEvent), startMs, complete!)),
  );
  const best = (d: string): NormalizedEvent<'LAP_COMPLETED'> | null => {
    let b: NormalizedEvent<'LAP_COMPLETED'> | null = null;
    for (const l of laps) if (l.payload.driver_id === d && isValidLap(ctx.events, l) && (!b || l.payload.lap_time_ms < b.payload.lap_time_ms)) b = l;
    return b;
  };
  const ba = best(A);
  const bb = best(B);
  const invalidations = laps.map((l) => lapInvalidation(ctx.events, l)).filter((x): x is NormalizedEvent<'LAP_INVALIDATED'> => x !== null);
  const evidence: AnyEvent[] = [ba, bb, cls, markers.ended, ...invalidations].filter((x): x is AnyEvent => x != null);
  const values = {
    segment_id: segment,
    best_a_ms: ba?.payload.lap_time_ms ?? null,
    best_b_ms: bb?.payload.lap_time_ms ?? null,
    attempt_a: ba ? lapAttemptId(ba) : null,
    attempt_b: bb ? lapAttemptId(bb) : null,
    invalidated_laps: invalidations.length,
  };
  const at = atLeast(toIso(complete), evidence);
  if (!ba && !bb) return resolved(ctx, 'NEITHER_VALID', evidence, values, at);
  if (!bb) return resolved(ctx, 'A', evidence, values, at);
  if (!ba) return resolved(ctx, 'B', evidence, values, at);
  const da = ba.payload.lap_time_ms;
  const db = bb.payload.lap_time_ms;
  return resolved(ctx, da === db ? 'TIE' : da < db ? 'A' : 'B', evidence, { ...values, delta_ms: da - db }, at);
};
