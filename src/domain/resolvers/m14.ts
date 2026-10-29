/**
 * F1-M14 — A in the official top three of the Grand Prix: YES, NO.
 * Final classification; DNS/DSQ/NOT_CLASSIFIED → NO.
 */
import type { AnyEvent, Resolver } from '../types';
import { entryOf, officialClassification, provisionalClassification, resolved, sessionFinalFallback, waitOrVoid } from './common';

const podium = (status: string, position: number | null) => status === 'CLASSIFIED' && position !== null && position <= 3;

export const resolveM14: Resolver = (ctx) => {
  const A = ctx.pool.subject.driver_a!;
  const cls = officialClassification(ctx.events, 'SESSION');
  if (cls) {
    const entry = entryOf(cls, A);
    if (!entry) return waitOrVoid(ctx, 'CONTRADICTORY_DATA', [cls as AnyEvent]);
    return resolved(ctx, podium(entry.status, entry.position) ? 'YES' : 'NO', [cls as AnyEvent], {
      classification_revision: cls.payload.classification_revision,
      position: entry.position,
      classification_status: entry.status,
    });
  }
  const prov = provisionalClassification(ctx.events, 'SESSION');
  const pe = prov ? entryOf(prov, A) : undefined;
  return sessionFinalFallback(ctx, undefined, pe ? { provisional_outcome: podium(pe.status, pe.position) ? 'YES' : 'NO', position: pe.position } : {});
};
