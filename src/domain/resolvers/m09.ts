/**
 * F1-M09 — best valid lap time in the window: each driver in N, TIE, NO_VALID_LAP.
 * All valid laps completed inside [start, end) — a lap started earlier is
 * allowed (F1-065). Invalidated laps are excluded first, then minimum times
 * compare; equal minimum for several drivers → TIE (never completion order,
 * never the broadcast "purple" colour — F1-034). SC/VSC laps stay eligible.
 */
import { ofType } from '../events/order';
import type { AnyEvent, Resolver } from '../types';
import { inWindow } from '../windows';
import { atLeast, lapAttemptId, lapInvalidation, observed, resolved, tOf, waitOrVoid, win } from './common';

export const resolveM09: Resolver = (ctx) => {
  const w = win(ctx);
  const participants = new Set(ctx.manifest.participants);
  const laps = ofType(ctx.events, 'LAP_COMPLETED').filter(
    (l) => participants.has(l.payload.driver_id) && inWindow(tOf(l as AnyEvent), w.start, w.end),
  );
  if (!observed(ctx, w.start, w.end)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [], { laps_seen: laps.length });

  const invalidations: AnyEvent[] = [];
  const valid = laps.filter((l) => {
    const inv = lapInvalidation(ctx.events, l);
    if (inv) invalidations.push(inv as AnyEvent);
    return l.payload.valid && !inv;
  });
  const windowEnd = ctx.pool.target.window_end;
  if (valid.length === 0) {
    return resolved(ctx, 'NO_VALID_LAP', invalidations, { laps_considered: laps.length }, atLeast(windowEnd, invalidations));
  }
  const best = Math.min(...valid.map((l) => l.payload.lap_time_ms));
  const top = valid.filter((l) => l.payload.lap_time_ms === best);
  const drivers = [...new Set(top.map((l) => l.payload.driver_id))].sort();
  // Invalidations of laps that would otherwise have been best explain the recalculation (QA13).
  const relevantInv = invalidations.filter((i) => {
    const lap = laps.find((l) => i.type === 'LAP_INVALIDATED' && (i.payload.lap_attempt_id === lapAttemptId(l) || (i.payload.driver_id === l.payload.driver_id && i.payload.driver_lap === l.payload.driver_lap)));
    return lap !== undefined && lap.payload.lap_time_ms <= best;
  });
  const evidence = [...(top as AnyEvent[]), ...relevantInv];
  const values = {
    best_lap_ms: best,
    drivers: drivers.join(','),
    attempt_ids: top.map(lapAttemptId).join(','),
    laps_considered: laps.length,
    invalidated_laps: invalidations.length,
  };
  return resolved(ctx, drivers.length > 1 ? 'TIE' : drivers[0]!, evidence, values, atLeast(windowEnd, evidence));
};
