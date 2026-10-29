/**
 * F1-M20 — will A's confirmed compound change before the window ends: YES, NO.
 * A transition between confirmed normal-racing stints; a new set of the same
 * compound → no change (NO unless another stint changes it). Baseline is the
 * confirmed stint in effect at not_before; unknown baseline never resolves.
 * Red flag in the affected window/visit → VOID.
 */
import { ofType } from '../events/order';
import type { AnyEvent, Resolver } from '../types';
import { inWindow, toIso } from '../windows';
import {
  confirmedStints,
  entryOfVisit,
  exitOfVisit,
  firstRedOnset,
  observed,
  resolved,
  stintEffectiveMs,
  tOf,
  voided,
  waitOrVoid,
  win,
} from './common';

export const resolveM20: Resolver = (ctx) => {
  const A = ctx.pool.subject.driver_a!;
  const w = win(ctx);
  const stints = confirmedStints(ctx.events, A);
  const baseline = stints
    .filter((s) => stintEffectiveMs(ctx.events, s) < w.start)
    .sort((a, b) => a.payload.stint_number - b.payload.stint_number)
    .pop();
  if (!baseline) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION');
  const from = baseline.payload.compound;
  const later = stints
    .filter((s) => s.payload.stint_number > baseline.payload.stint_number)
    .map((s) => ({ s, at: stintEffectiveMs(ctx.events, s) }))
    .filter((x) => inWindow(x.at, w.start, w.end))
    .sort((a, b) => a.at - b.at);

  const sameCompound: AnyEvent[] = [];
  for (const { s, at } of later) {
    const red = firstRedOnset(ctx.events, w.start, at + 1);
    if (red) return voided(ctx, 'INTERRUPTED', [red], { from_compound: from, red_flag_at: red.occurred_at });
    const entry = entryOfVisit(ctx.events, A, s.payload.pit_visit_id);
    const exit = exitOfVisit(ctx.events, A, s.payload.pit_visit_id);
    if ((entry && !entry.payload.normal_racing_visit) || (exit && (exit.payload.interrupted_by_red || !exit.payload.normal_racing_visit))) {
      return voided(ctx, 'INTERRUPTED', [s as AnyEvent, entry as AnyEvent | null, exit as AnyEvent | null], { from_compound: from });
    }
    if (s.payload.compound !== from) {
      return resolved(ctx, 'YES', [baseline as AnyEvent, s as AnyEvent, exit as AnyEvent | null], {
        from_compound: from,
        to_compound: s.payload.compound,
        stint_number: s.payload.stint_number,
        new_set: s.payload.new_set,
        change_at: toIso(at),
      });
    }
    sameCompound.push(s as AnyEvent);
  }

  // A normal pit exit in the window whose stint is not confirmed yet keeps the result open.
  const unconfirmed = ofType(ctx.events, 'PIT_EXIT').filter(
    (x) =>
      x.payload.driver_id === A &&
      x.payload.normal_racing_visit &&
      inWindow(tOf(x as AnyEvent), w.start, w.end) &&
      !stints.some((s) => s.payload.pit_visit_id === x.payload.pit_visit_id),
  );
  if (unconfirmed.length > 0) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', unconfirmed as AnyEvent[], { from_compound: from });
  const red = firstRedOnset(ctx.events, w.start, w.end);
  if (red) return voided(ctx, 'INTERRUPTED', [red], { from_compound: from, red_flag_at: red.occurred_at });
  if (!observed(ctx, w.start, w.end)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [], { from_compound: from });
  return resolved(
    ctx,
    'NO',
    [baseline as AnyEvent, ...sameCompound],
    { from_compound: from, same_compound_new_sets: sameCompound.length },
    ctx.pool.target.window_end,
  );
};
