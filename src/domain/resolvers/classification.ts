/** Shared final-group logic for M13 (Grand Prix) and M18 (Sprint) — F1-028, QA15. */
import type { AnyEvent, ClassificationEntry, ResolverContext, ResolverOutput } from '../types';
import { entryOf, officialClassification, provisionalClassification, resolved, sessionFinalFallback, waitOrVoid, type Values } from './common';

export type GroupSpec = ReadonlyArray<readonly [id: string, from: number, to: number]>;

/** Precedence DSQ → DNS → classified position group → NOT_CLASSIFIED. A classified retiree keeps its group. */
export function groupOf(entry: ClassificationEntry, groups: GroupSpec): string {
  if (entry.status === 'DSQ') return 'DSQ';
  if (entry.status === 'DNS') return 'DNS';
  if (entry.status === 'CLASSIFIED' && entry.position !== null) {
    const g = groups.find(([, from, to]) => entry.position! >= from && entry.position! <= to);
    if (g) return g[0];
  }
  return 'NOT_CLASSIFIED';
}

function entryValues(entry: ClassificationEntry, revision: number): Values {
  return {
    classification_revision: revision,
    position: entry.position,
    classification_status: entry.status,
    laps: entry.laps,
    total_time_ms: entry.total_time_ms,
    gap_ms: entry.gap_ms,
  };
}

export function resolveSessionGroup(ctx: ResolverContext, groups: GroupSpec): ResolverOutput {
  const A = ctx.pool.subject.driver_a!;
  const cls = officialClassification(ctx.events, 'SESSION');
  if (cls) {
    const entry = entryOf(cls, A);
    if (!entry) return waitOrVoid(ctx, 'CONTRADICTORY_DATA', [cls as AnyEvent], { classification_revision: cls.payload.classification_revision });
    return resolved(ctx, groupOf(entry, groups), [cls as AnyEvent], entryValues(entry, cls.payload.classification_revision));
  }
  const prov = provisionalClassification(ctx.events, 'SESSION');
  const pe = prov ? entryOf(prov, A) : undefined;
  return sessionFinalFallback(ctx, undefined, pe && prov ? { provisional_outcome: groupOf(pe, groups), ...entryValues(pe, prov.payload.classification_revision) } : {});
}
