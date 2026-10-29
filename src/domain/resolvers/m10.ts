/**
 * F1-M10 — next neutralisation: SC, VSC, RED, NONE.
 * The first NEW global race-control state (a transition into SC/VSC/RED) in
 * [start, end); local yellow sectors are excluded and a repeated message
 * counts once. NONE only with full coverage of the window; a feed gap → VOID
 * (F1-020, QA11/QA12). Unresolvable order → VOID / AMBIGUOUS_EVENT_ORDER.
 */
import { capabilityLevel } from '../capabilities';
import { NEUTRALISATION_OUTCOMES, raceControlTransitions } from '../events/raceControl';
import type { AnyEvent, Resolver } from '../types';
import { inWindow, toMs } from '../windows';
import { atLeast, firstByOrder, observed, resolved, tOf, uncertaintyOf, waitOrVoid, win } from './common';

export const resolveM10: Resolver = (ctx) => {
  const w = win(ctx);
  const precision = ctx.manifest.quality.race_control?.timestamp_precision_ms ?? 0;
  const cands = raceControlTransitions(ctx.events)
    .filter((tr) => NEUTRALISATION_OUTCOMES.includes(tr.to) && inWindow(toMs(tr.occurred_at), w.start, w.end))
    .map((tr) => tr.event);
  if (cands.length === 0) {
    if (observed(ctx, w.start, w.end)) return resolved(ctx, 'NONE', [], { transitions: 0 }, ctx.pool.target.window_end);
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION');
  }
  const first = cands[0] as AnyEvent;
  if (!observed(ctx, w.start, tOf(first) + uncertaintyOf(first, precision) + 1)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [first]);
  const ord = firstByOrder(cands, (e) => e.payload.track_state!, {
    trustSequence: capabilityLevel(ctx.manifest, 'race_control') === 'SUPPORTED',
    precisionMs: precision,
  });
  if (ord.kind === 'AMBIGUOUS') return waitOrVoid(ctx, 'AMBIGUOUS_EVENT_ORDER', ord.events);
  if (ord.kind === 'NONE') return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION');
  const e = ord.event;
  return resolved(
    ctx,
    e.payload.track_state!,
    [e],
    { track_state: e.payload.track_state!, message_id: e.payload.message_id, leader_lap: e.payload.leader_lap, state_at: e.occurred_at },
    atLeast(e.occurred_at, [e]),
  );
};
