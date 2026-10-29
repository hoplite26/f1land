/**
 * F1-M03 — who enters the pit lane next: each driver in N, NO_ENTRY.
 * First NORMAL_RACING_VISIT PIT_ENTRY in [start, end) (F1-063). Equal or
 * overlapping timestamps need a trustworthy source sequence, otherwise
 * VOID / AMBIGUOUS_EVENT_ORDER (F1-030). Red flag in the affected window → VOID.
 */
import { capabilityLevel } from '../capabilities';
import { ofType } from '../events/order';
import type { AnyEvent, Resolver } from '../types';
import { inWindow } from '../windows';
import {
  atLeast,
  firstByOrder,
  firstRedOnset,
  observed,
  redActiveAt,
  resolved,
  tOf,
  uncertaintyOf,
  voided,
  waitOrVoid,
  win,
} from './common';

export const resolveM03: Resolver = (ctx) => {
  const w = win(ctx);
  const participants = new Set(ctx.manifest.participants);
  const precision = ctx.manifest.quality.pit_entry_exit?.timestamp_precision_ms ?? 0;
  const cands = ofType(ctx.events, 'PIT_ENTRY').filter(
    (e) =>
      participants.has(e.payload.driver_id) &&
      e.payload.normal_racing_visit &&
      e.payload.quality === 'CONFIRMED' &&
      inWindow(tOf(e as AnyEvent), w.start, w.end) &&
      !redActiveAt(ctx.events, tOf(e as AnyEvent)),
  );
  const first = cands[0] as AnyEvent | undefined;
  const red = firstRedOnset(ctx.events, w.start, first ? tOf(first) : w.end);
  if (red) return voided(ctx, 'INTERRUPTED', [red], { red_flag_at: red.occurred_at });

  if (!first) {
    if (observed(ctx, w.start, w.end)) return resolved(ctx, 'NO_ENTRY', [], { entries: 0 }, ctx.pool.target.window_end);
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION');
  }
  if (!observed(ctx, w.start, tOf(first) + uncertaintyOf(first, precision) + 1)) {
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [first]);
  }
  const trust = capabilityLevel(ctx.manifest, 'pit_entry_exit') === 'SUPPORTED';
  const ord = firstByOrder(cands, (e) => e.payload.driver_id, { trustSequence: trust, precisionMs: precision });
  if (ord.kind === 'AMBIGUOUS') return waitOrVoid(ctx, 'AMBIGUOUS_EVENT_ORDER', ord.events, { contenders: ord.events.length });
  if (ord.kind === 'NONE') return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION');
  const e = ord.event;
  return resolved(
    ctx,
    e.payload.driver_id,
    [e],
    { driver_id: e.payload.driver_id, entry_at: e.occurred_at, driver_lap: e.payload.driver_lap, pit_visit_id: e.payload.pit_visit_id },
    atLeast(e.occurred_at, [e]),
  );
};
