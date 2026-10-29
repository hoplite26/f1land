/**
 * F1-M01 — position of A at the control crossing: P1…PN, RETIRED, DNS, DSQ.
 * TIMING_ORDER + DRIVER_STATUS at a fixed LEADER_LAP (or driver-lap) anchor.
 * Precedence DSQ → DNS → RETIRED → running position (F1-028). SC/VSC do not
 * cancel the measurement; RED before the anchor → VOID (F1-024).
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

const INF = Number.POSITIVE_INFINITY;

export const resolveM01: Resolver = (ctx) => {
  const { pool } = ctx;
  const A = pool.subject.driver_a!;
  const lap = pool.target.parameters.target_lap!;
  const kind = pool.target.parameters.lap_anchor ?? 'LEADER';
  const w = win(ctx);
  const base: Values = { anchor_lap: lap, lap_anchor: kind };
  const anchor = positionAnchor(ctx, lap, kind, A);

  if (anchor.kind === 'FOUND') {
    const snap = anchor.snapshot as AnyEvent;
    const at = tOf(snap);
    if (at < w.start) return voided(ctx, 'TARGET_BOUNDARY_CONTAMINATED', [snap], { ...base, anchor_at: snap.occurred_at });
    const red = firstRedOnset(ctx.events, w.start, at);
    if (red) return voided(ctx, 'INTERRUPTED', [red], { ...base, red_flag_at: red.occurred_at });
    if (!observed(ctx, w.start, at + 1)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [snap], base);
    const entry = anchor.snapshot.payload.order.find((o) => o.driver_id === A);
    const status = latestStatus(ctx.events, A, at);
    const values: Values = {
      ...base,
      anchor_at: snap.occurred_at,
      snapshot_revision: anchor.snapshot.payload.snapshot_revision,
      leader_lap: anchor.snapshot.payload.leader_lap,
      driver_lap: entry?.driver_laps ?? status?.payload.driver_lap ?? null,
      position: entry?.position ?? null,
    };
    const inactive = inactiveOf(status?.payload.status, entry?.activity);
    if (inactive) return resolved(ctx, inactive, [snap, status], { ...values, status: inactive });
    if (!entry) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [snap], values);
    return resolved(ctx, `P${entry.position}`, [snap, status], values);
  }

  if (anchor.kind === 'CONTRADICTORY') return waitOrVoid(ctx, 'CONTRADICTORY_DATA', anchor.snapshots, base);

  if (anchor.kind === 'INACTIVE_BEFORE') {
    const st = anchor.status;
    const red = firstRedOnset(ctx.events, w.start, tOf(st));
    if (red) return voided(ctx, 'INTERRUPTED', [red], { ...base, red_flag_at: red.occurred_at });
    const inactive = inactiveOf(st.payload.status)!;
    return resolved(ctx, inactive, [st], { ...base, status: inactive, driver_lap: st.payload.driver_lap });
  }

  const red = firstRedOnset(ctx.events, w.start, INF);
  if (red) return voided(ctx, 'INTERRUPTED', [red], { ...base, red_flag_at: red.occurred_at });
  if (anchor.kind === 'AWAITING_SNAPSHOT') return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [anchor.crossing], base);
  const cancelled = sessionMarkers(ctx.events).cancelled;
  if (cancelled) return voided(ctx, 'TARGET_CANCELLED', [cancelled], base);
  if (ctx.now_ms >= w.end && observed(ctx, w.start, w.end)) {
    return voided(ctx, 'TARGET_NOT_STARTED', [], base, pool.target.window_end);
  }
  return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [], base);
};
