/**
 * F1-M15 — A progresses from the fixed Q1/Q2/SQ1/SQ2 part into the next: YES, NO.
 * Only the confirmed segment classification decides — never the approximate
 * live position (F1-035). A participant without a time gets a result only from
 * that classification. A cancelled part without a result → VOID.
 */
import type { AnyEvent, ClassificationEntry, Resolver, ResolverContext, SegmentId } from '../types';
import {
  advancingFrom,
  entryOf,
  officialClassification,
  provisionalClassification,
  resolved,
  sessionFinalFallback,
  waitOrVoid,
} from './common';

function progressed(ctx: ResolverContext, entry: ClassificationEntry, segment: SegmentId): boolean {
  if (entry.progressed === true || entry.progressed === false) return entry.progressed;
  if (entry.status !== 'CLASSIFIED' || entry.position === null) return false;
  return entry.position <= advancingFrom(ctx, segment);
}

export const resolveM15: Resolver = (ctx) => {
  const A = ctx.pool.subject.driver_a!;
  const segment = ctx.pool.target.parameters.segment_id!;
  const cls = officialClassification(ctx.events, 'SEGMENT', segment);
  if (cls) {
    const entry = entryOf(cls, A);
    if (!entry) return waitOrVoid(ctx, 'CONTRADICTORY_DATA', [cls as AnyEvent], { segment_id: segment });
    const yes = progressed(ctx, entry, segment);
    return resolved(ctx, yes ? 'YES' : 'NO', [cls as AnyEvent], {
      segment_id: segment,
      classification_revision: cls.payload.classification_revision,
      position: entry.position,
      classification_status: entry.status,
      best_lap_ms: entry.best_lap_ms,
      progressed: yes,
      cut_position: advancingFrom(ctx, segment),
    });
  }
  const prov = provisionalClassification(ctx.events, 'SEGMENT', segment);
  const pe = prov ? entryOf(prov, A) : undefined;
  // "Currently above the cut" is provisional only (f1.quali.provisional).
  return sessionFinalFallback(
    ctx,
    segment,
    pe ? { segment_id: segment, provisional_outcome: progressed(ctx, pe, segment) ? 'YES' : 'NO', position: pe.position } : { segment_id: segment },
  );
};
