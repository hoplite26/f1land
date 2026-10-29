/**
 * F1-M19 — next clean sector of A: [0,t1), [t1,t2), [t2,∞) ms, NO_VALID_SECTOR.
 * Measurement starts only on the next entry into the selected sector after
 * not_before (F1-065); compared before rounding; GREEN_ONLY: SC/VSC/RED during
 * the sector → VOID. Not started with full observation → TARGET_NOT_STARTED.
 */
import { ofType } from '../events/order';
import type { AnyEvent, Resolver } from '../types';
import { inWindow, toIso, toMs } from '../windows';
import { firstStart, type AttemptStart } from './attempt';
import {
  bucketOf,
  inactiveOf,
  latestStatus,
  neutralisedDuring,
  observed,
  resolved,
  tOf,
  voided,
  waitOrVoid,
  win,
  type Values,
} from './common';

export const resolveM19: Resolver = (ctx) => {
  const { pool } = ctx;
  const A = pool.subject.driver_a!;
  const { sector: S, t1_ms, t2_ms } = pool.target.parameters;
  const sector = S!;
  const w = win(ctx);
  const base: Values = { sector, t1_ms: t1_ms!, t2_ms: t2_ms! };
  const sectors = ofType(ctx.events, 'SECTOR_COMPLETED').filter((s) => s.payload.driver_id === A);
  const prev = sector === 1 ? 3 : sector - 1;

  const starts: AttemptStart[] = [];
  for (const s of sectors) {
    if (s.payload.sector === sector) starts.push({ at: toMs(s.payload.started_at), lap: s.payload.driver_lap, evidence: s as AnyEvent });
    if (s.payload.sector === prev) {
      starts.push({ at: tOf(s as AnyEvent), lap: sector === 1 ? s.payload.driver_lap + 1 : s.payload.driver_lap, evidence: s as AnyEvent });
    }
  }
  if (sector === 1) {
    for (const l of ofType(ctx.events, 'LAP_COMPLETED')) {
      if (l.payload.driver_id === A) starts.push({ at: tOf(l as AnyEvent), lap: l.payload.driver_lap + 1, evidence: l as AnyEvent });
    }
  }
  const start = firstStart(starts, w.start, w.end);
  if (!start) {
    if (ctx.now_ms >= w.end && observed(ctx, w.start, w.end)) return voided(ctx, 'TARGET_NOT_STARTED', [], base, pool.target.window_end);
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [], base);
  }
  if (!observed(ctx, w.start, start.at + 1)) return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [start.evidence], base);

  const startedAt = toIso(start.at);
  const pendingValues: Values = { ...base, attempt_lap: start.lap, attempt_started_at: startedAt, target_start_at: startedAt };
  const attempt = sectors.find((s) => s.payload.sector === sector && s.payload.driver_lap === start.lap) ?? null;
  if (!attempt) {
    const neutral = neutralisedDuring(ctx.events, start.at, ctx.now_ms + 1);
    if (neutral && observed(ctx, start.at, tOf(neutral) + 1)) return voided(ctx, 'INTERRUPTED', [start.evidence, neutral], pendingValues);
    const status = latestStatus(ctx.events, A, ctx.now_ms);
    if (status && inactiveOf(status.payload.status) && tOf(status as AnyEvent) >= start.at && observed(ctx, start.at, tOf(status as AnyEvent) + 1)) {
      return resolved(ctx, 'NO_VALID_SECTOR', [start.evidence, status], { ...pendingValues, status: status.payload.status });
    }
    return waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [start.evidence], pendingValues);
  }

  const ev = attempt as AnyEvent;
  const sp = attempt.payload;
  const values: Values = { ...pendingValues, driver_lap: sp.driver_lap, sector_time_ms: sp.sector_time_ms };
  const neutral = sp.neutralised ? ev : neutralisedDuring(ctx.events, toMs(sp.started_at), tOf(ev));
  if (neutral) return voided(ctx, 'INTERRUPTED', [ev, neutral], { ...values, neutralised: true });
  const pitEntry = ofType(ctx.events, 'PIT_ENTRY').find(
    (e) => e.payload.driver_id === A && inWindow(tOf(e as AnyEvent), toMs(sp.started_at), tOf(ev) + 1),
  );
  if (!sp.valid || pitEntry) {
    return resolved(ctx, 'NO_VALID_SECTOR', [ev, pitEntry as AnyEvent | undefined], { ...values, valid: false, via_pit_lane: pitEntry !== undefined });
  }
  return resolved(ctx, bucketOf(sp.sector_time_ms, t1_ms!, t2_ms!), [ev], { ...values, valid: true });
};
