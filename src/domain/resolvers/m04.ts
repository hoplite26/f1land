/**
 * F1-M04 — compound of A at the exit after the next pit-lane entry:
 * SOFT, MEDIUM, HARD, INTERMEDIATE, WET, OTHER_CONFIRMED, NO_EXIT.
 * The first normal PIT_ENTRY after the window start, then its PIT_EXIT linked
 * to a confirmed stint (not "a change happened"). Entry without exit by the
 * deadline → VOID; NO_EXIT only with full observation and no visit (F1-063).
 */
import { ofType } from '../events/order';
import type { AnyEvent, Resolver } from '../types';
import { COMPOUNDS } from '../markets/catalog';
import { firstNormalVisit, resolved, waitOrVoid } from './common';

export const resolveM04: Resolver = (ctx) => {
  const A = ctx.pool.subject.driver_a!;
  const visit = firstNormalVisit(ctx, A);
  if (visit.kind === 'DONE') return visit.output;
  if (visit.kind === 'NONE') return resolved(ctx, 'NO_EXIT', [], { visits: 0 }, ctx.pool.target.window_end);

  const { entry, exit } = visit;
  const stint =
    ofType(ctx.events, 'TYRE_STINT_CONFIRMED').find(
      (s) => s.payload.driver_id === A && s.payload.quality === 'CONFIRMED' && s.payload.pit_visit_id === entry.payload.pit_visit_id,
    ) ?? null;
  const values = { ...visit.values, compound_at_exit: exit.payload.compound };
  const evidence: AnyEvent[] = [entry as AnyEvent, exit as AnyEvent];
  if (!stint) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', evidence, values);
  evidence.push(stint as AnyEvent);
  if (exit.payload.compound !== null && exit.payload.compound !== stint.payload.compound) {
    return waitOrVoid(ctx, 'CONTRADICTORY_DATA', evidence, { ...values, compound_stint: stint.payload.compound });
  }
  const compound = stint.payload.compound as string;
  const outcome = (COMPOUNDS as readonly string[]).includes(compound) ? compound : 'OTHER_CONFIRMED';
  return resolved(ctx, outcome, evidence, {
    ...values,
    compound,
    new_set: stint.payload.new_set,
    stint_number: stint.payload.stint_number,
    supplier_spec: stint.payload.supplier_spec,
  });
};
