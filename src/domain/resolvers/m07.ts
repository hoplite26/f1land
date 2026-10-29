/**
 * F1-M07 — first confirmed on-track pass in the duel: A_PASSES_B, B_PASSES_A, NO_PASS.
 * Only VERIFIED ON_TRACK_PASS on the same race lap (no lapping), in normal
 * racing (outside SC/VSC/RED), with neither car in the pit lane. Pit swaps,
 * race-control position returns and post-race penalties never create a pass
 * (F1-032, QA03–05). Red flag interrupting the window → VOID.
 */
import { capabilityLevel } from '../capabilities';
import { ofType } from '../events/order';
import type { AnyEvent, Resolver } from '../types';
import { inWindow } from '../windows';
import {
  firstByOrder,
  firstRedOnset,
  inPitLaneAt,
  observed,
  resolved,
  tOf,
  trackStateAtMs,
  uncertaintyOf,
  voided,
  waitOrVoid,
  win,
} from './common';

export const resolveM07: Resolver = (ctx) => {
  const A = ctx.pool.subject.driver_a!;
  const B = ctx.pool.subject.driver_b!;
  const w = win(ctx);
  const cands = ofType(ctx.events, 'ON_TRACK_PASS').filter((e) => {
    const p = e.payload;
    const t = tOf(e as AnyEvent);
    const pair = (p.passing_driver_id === A && p.passed_driver_id === B) || (p.passing_driver_id === B && p.passed_driver_id === A);
    return (
      pair &&
      inWindow(t, w.start, w.end) &&
      p.provenance === 'VERIFIED' &&
      p.cause === 'ON_TRACK' &&
      p.track_state === 'GREEN' &&
      trackStateAtMs(ctx.events, t).state === 'GREEN' &&
      p.passing_driver_lap === p.passed_driver_lap &&
      !inPitLaneAt(ctx.events, p.passing_driver_id, t) &&
      !inPitLaneAt(ctx.events, p.passed_driver_id, t)
    );
  });
  const first = cands[0] as AnyEvent | undefined;
  const red = firstRedOnset(ctx.events, w.start, first ? tOf(first) : w.end);
  if (red) return voided(ctx, 'INTERRUPTED', [red], { red_flag_at: red.occurred_at });
  if (!first) {
    if (observed(ctx, w.start, w.end)) return resolved(ctx, 'NO_PASS', [], { passes: 0 }, ctx.pool.target.window_end);
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION');
  }
  if (!observed(ctx, w.start, tOf(first) + uncertaintyOf(first) + 1)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [first]);
  const ord = firstByOrder(cands, (e) => e.payload.passing_driver_id, {
    trustSequence: capabilityLevel(ctx.manifest, 'on_track_pass') === 'SUPPORTED',
  });
  if (ord.kind === 'AMBIGUOUS') return waitOrVoid(ctx, 'AMBIGUOUS_EVENT_ORDER', ord.events);
  if (ord.kind === 'NONE') return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION');
  const p = ord.event.payload;
  return resolved(ctx, p.passing_driver_id === A ? 'A_PASSES_B' : 'B_PASSES_A', [ord.event], {
    passing_driver_id: p.passing_driver_id,
    passed_driver_id: p.passed_driver_id,
    race_lap: p.passing_driver_lap,
    leader_lap: p.leader_lap,
    sector: p.sector,
    distance_m: p.distance_m,
    pass_at: ord.event.occurred_at,
  });
};
