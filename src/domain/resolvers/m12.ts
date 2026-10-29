/**
 * F1-M12 — first official retirement in the window: each driver in N,
 * SIMULTANEOUS (only under a rule declared before OPEN), NONE.
 * DRIVER_STATUS with confirmed RETIRED. SIMULTANEOUS requires a confirmed
 * source simultaneous-group or a precision-defined tie profile whose bucket
 * floor((t − tie_origin_at) / tie_precision_ms) is provable given the source
 * uncertainty (F1-030, QA26). Lost sequence / coarse equal timestamps /
 * degraded feed → VOID / AMBIGUOUS_EVENT_ORDER, never SIMULTANEOUS (QA25).
 */
import { capabilityLevel } from '../capabilities';
import { ofType } from '../events/order';
import type { AnyEvent, NormalizedEvent, Resolver } from '../types';
import { inWindow, toMs } from '../windows';
import { atLeast, firstByOrder, observed, resolved, tOf, uncertaintyOf, waitOrVoid, win } from './common';

type Retirement = NormalizedEvent<'DRIVER_STATUS'>;

export const resolveM12: Resolver = (ctx) => {
  const w = win(ctx);
  const p = ctx.pool.target.parameters;
  const participants = new Set(ctx.manifest.participants);
  const precision = ctx.manifest.quality.retirement?.timestamp_precision_ms ?? 0;
  const firstByDriver = new Map<string, Retirement>();
  for (const e of ofType(ctx.events, 'DRIVER_STATUS')) {
    if (e.payload.status !== 'RETIRED' || e.payload.quality !== 'CONFIRMED') continue;
    if (!firstByDriver.has(e.payload.driver_id)) firstByDriver.set(e.payload.driver_id, e);
  }
  const cands = [...firstByDriver.values()]
    .filter((e) => participants.has(e.payload.driver_id) && inWindow(tOf(e as AnyEvent), w.start, w.end))
    .sort((a, b) => tOf(a as AnyEvent) - tOf(b as AnyEvent));

  if (cands.length === 0) {
    if (observed(ctx, w.start, w.end)) return resolved(ctx, 'NONE', [], { retirements: 0 }, ctx.pool.target.window_end);
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION');
  }
  const unc = (e: Retirement) => uncertaintyOf(e as AnyEvent, precision);
  const first = cands[0]!;
  if (!observed(ctx, w.start, tOf(first as AnyEvent) + unc(first) + 1)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [first as AnyEvent]);

  const simultaneous = (group: Retirement[], values: Record<string, string | number>) =>
    resolved(ctx, 'SIMULTANEOUS', group as AnyEvent[], { drivers: group.map((g) => g.payload.driver_id).sort().join(','), ...values }, atLeast(group[group.length - 1]!.occurred_at, group as AnyEvent[]));

  // Confirmed source simultaneous-group.
  if (p.simultaneous_source_group && first.payload.simultaneous_group_id) {
    const gid = first.payload.simultaneous_group_id;
    const group = cands.filter((c) => c.payload.simultaneous_group_id === gid);
    if (group.length >= 2) return simultaneous(group, { rule: 'SOURCE_GROUP', group_id: gid });
  }

  // Precision-defined tie profile.
  if (p.tie_profile) {
    const origin = toMs(p.tie_profile.tie_origin_at);
    const prec = p.tie_profile.tie_precision_ms;
    const bucket = (t: number) => Math.floor((t - origin) / prec);
    const range = (e: Retirement): [number, number] => [bucket(tOf(e as AnyEvent) - unc(e)), bucket(tOf(e as AnyEvent) + unc(e))];
    const [lo, hi] = range(first);
    const maybe = cands.slice(1).filter((c) => {
      const [a, b] = range(c);
      return a <= hi && b >= lo;
    });
    if (maybe.length > 0) {
      const sure = lo === hi ? maybe.filter((c) => range(c)[0] === lo && range(c)[1] === lo) : [];
      if (sure.length > 0) return simultaneous([first, ...sure], { rule: 'TIE_PROFILE', tie_bucket: lo, tie_precision_ms: prec });
      return waitOrVoid(ctx, 'AMBIGUOUS_EVENT_ORDER', [first, ...maybe] as AnyEvent[]);
    }
  }

  const ord = firstByOrder(cands as AnyEvent[] as Retirement[], (e) => e.payload.driver_id, {
    trustSequence: capabilityLevel(ctx.manifest, 'retirement') === 'SUPPORTED',
    precisionMs: precision,
  });
  if (ord.kind === 'AMBIGUOUS') return waitOrVoid(ctx, 'AMBIGUOUS_EVENT_ORDER', ord.events as AnyEvent[], { contenders: ord.events.length });
  if (ord.kind === 'NONE') return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION');
  const e = ord.event;
  return resolved(
    ctx,
    e.payload.driver_id,
    [e as AnyEvent],
    { driver_id: e.payload.driver_id, retired_at: e.occurred_at, driver_lap: e.payload.driver_lap, reason_key: e.payload.reason_key ?? null },
    atLeast(e.occurred_at, [e as AnyEvent]),
  );
};
