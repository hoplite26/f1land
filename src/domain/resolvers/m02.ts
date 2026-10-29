/**
 * F1-M02 — who is higher at the crossing: A, B, BOTH_INACTIVE (F1-029).
 * Active beats inactive; two running positions compare integer ranks of one
 * snapshot. Contradictory simultaneous positions wait for a correction, then
 * VOID at the deadline.
 */
import type { AnyEvent, Resolver } from '../types';
import {
  firstRedOnset,
  inactiveOf,
  latestStatus,
  observed,
  resolved,
  sessionMarkers,
  tOf,
  voided,
  waitOrVoid,
  win,
  type Values,
} from './common';
import { positionAnchor } from './position';

export const resolveM02: Resolver = (ctx) => {
  const { pool } = ctx;
  const A = pool.subject.driver_a!;
  const B = pool.subject.driver_b!;
  const lap = pool.target.parameters.target_lap!;
  const w = win(ctx);
  const base: Values = { anchor_lap: lap, lap_anchor: 'LEADER' };
  const anchor = positionAnchor(ctx, lap, 'LEADER', A);

  if (anchor.kind === 'CONTRADICTORY') return waitOrVoid(ctx, 'CONTRADICTORY_DATA', anchor.snapshots, base);
  if (anchor.kind !== 'FOUND') {
    const red = firstRedOnset(ctx.events, w.start, Number.POSITIVE_INFINITY);
    if (red) return voided(ctx, 'INTERRUPTED', [red], { ...base, red_flag_at: red.occurred_at });
    const cancelled = sessionMarkers(ctx.events).cancelled;
    if (cancelled) return voided(ctx, 'TARGET_CANCELLED', [cancelled], base);
    if (ctx.now_ms >= w.end && observed(ctx, w.start, w.end)) return voided(ctx, 'TARGET_NOT_STARTED', [], base, pool.target.window_end);
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [], base);
  }

  const snap = anchor.snapshot as AnyEvent;
  const at = tOf(snap);
  if (at < w.start) return voided(ctx, 'TARGET_BOUNDARY_CONTAMINATED', [snap], base);
  const red = firstRedOnset(ctx.events, w.start, at);
  if (red) return voided(ctx, 'INTERRUPTED', [red], { ...base, red_flag_at: red.occurred_at });
  if (!observed(ctx, w.start, at + 1)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [snap], base);

  const order = anchor.snapshot.payload.order;
  const ea = order.find((o) => o.driver_id === A);
  const eb = order.find((o) => o.driver_id === B);
  const sa = latestStatus(ctx.events, A, at);
  const sb = latestStatus(ctx.events, B, at);
  const ia = inactiveOf(sa?.payload.status, ea?.activity);
  const ib = inactiveOf(sb?.payload.status, eb?.activity);
  const values: Values = {
    ...base,
    anchor_at: snap.occurred_at,
    snapshot_revision: anchor.snapshot.payload.snapshot_revision,
    position_a: ia ? null : (ea?.position ?? null),
    position_b: ib ? null : (eb?.position ?? null),
    status_a: ia ?? 'ACTIVE',
    status_b: ib ?? 'ACTIVE',
  };
  const evidence = [snap, sa, sb];
  if (ia && ib) return resolved(ctx, 'BOTH_INACTIVE', evidence, values);
  if (ia) return eb ? resolved(ctx, 'B', evidence, values) : waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', evidence, values);
  if (ib) return ea ? resolved(ctx, 'A', evidence, values) : waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', evidence, values);
  if (!ea || !eb) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', evidence, values);
  if (ea.position === eb.position) return waitOrVoid(ctx, 'CONTRADICTORY_DATA', evidence, values);
  return resolved(ctx, ea.position < eb.position ? 'A' : 'B', evidence, values);
};
