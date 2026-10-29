/** Shared anchor logic for M01/M02 (F1-018, F1-024, F1-028, F1-029). */
import { ofType } from '../events/order';
import type { AnyEvent, NormalizedEvent, ResolverContext } from '../types';
import { driverLapSnapshot, inactiveOf, latestStatus, leaderAnchor, tOf, type AnchorResult } from './common';

export type PositionAnchor =
  | AnchorResult
  | { kind: 'AWAITING_SNAPSHOT'; crossing: AnyEvent }
  | { kind: 'INACTIVE_BEFORE'; status: NormalizedEvent<'DRIVER_STATUS'> };

/**
 * LEADER: first confirmed leader crossing at the end of lap L.
 * DRIVER: the driver's own completion of lap L — a lapped car is never
 * given the leader's lap number (F1-018, QA14).
 */
export function positionAnchor(ctx: ResolverContext, lap: number, kind: 'LEADER' | 'DRIVER', driver: string): PositionAnchor {
  if (kind === 'LEADER') return leaderAnchor(ctx.events, lap);
  const crossing = ofType(ctx.events, 'LAP_COMPLETED').find((l) => l.payload.driver_id === driver && l.payload.driver_lap === lap);
  if (crossing) {
    const snap = driverLapSnapshot(ctx.events, driver, lap, tOf(crossing as AnyEvent));
    return snap.kind === 'NONE' ? { kind: 'AWAITING_SNAPSHOT', crossing: crossing as AnyEvent } : snap;
  }
  const status = latestStatus(ctx.events, driver, ctx.now_ms);
  if (status && inactiveOf(status.payload.status)) return { kind: 'INACTIVE_BEFORE', status };
  return { kind: 'NONE' };
}
