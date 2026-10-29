/**
 * F1-M17 — first in the official Q3/SQ3 classification: each admitted driver.
 * Not the starting grid: a later grid penalty never changes the winner
 * (F1-035). No classification → VOID by the cutoff; cancelled part → VOID.
 */
import type { AnyEvent, Resolver } from '../types';
import { officialClassification, resolved, sessionFinalFallback, waitOrVoid } from './common';

export const resolveM17: Resolver = (ctx) => {
  const segment = ctx.pool.target.parameters.segment_id!;
  const cls = officialClassification(ctx.events, 'SEGMENT', segment) ?? officialClassification(ctx.events, 'SESSION');
  if (cls) {
    const winner = cls.payload.entries.find((e) => e.position === 1 && e.status === 'CLASSIFIED');
    if (!winner) return waitOrVoid(ctx, 'CONTRADICTORY_DATA', [cls as AnyEvent], { segment_id: segment });
    return resolved(ctx, winner.driver_id, [cls as AnyEvent], {
      segment_id: segment,
      driver_id: winner.driver_id,
      best_lap_ms: winner.best_lap_ms,
      classification_revision: cls.payload.classification_revision,
      classification_scope: cls.payload.scope,
    });
  }
  return sessionFinalFallback(ctx, segment, { segment_id: segment });
};
