/**
 * Shared resolver helpers. Resolvers are pure and deterministic: the same
 * ResolverContext always yields the same output. They return PENDING while a
 * result is undecidable before the absolute deadline and never guess.
 */
import { advancingCount, buildSegments } from '@/config/ruleset';
import { NEUTRAL_STATES, raceControlTransitions } from '../events/raceControl';
import { compareSeq, ofType, sortEvents } from '../events/order';
import type {
  AnyEvent,
  ClassificationEntry,
  DriverActivity,
  DriverStatus,
  NormalizedEvent,
  Occupancy,
  ResolverContext,
  ResolverOutput,
  SegmentId,
  TrackState,
  VoidReason,
} from '../types';
import { inWindow, isFullyObserved, toIso, toMs } from '../windows';

export type Values = Record<string, string | number | boolean | null>;

export const tOf = (e: AnyEvent): number => toMs(e.occurred_at);
const INF = Number.POSITIVE_INFINITY;

export interface Win {
  start: number;
  end: number;
  deadline: number;
}

export function win(ctx: ResolverContext): Win {
  return {
    start: toMs(ctx.pool.target.not_before),
    end: toMs(ctx.pool.target.window_end),
    deadline: toMs(ctx.pool.settlement_deadline),
  };
}

export function observed(ctx: ResolverContext, startMs: number, endMs: number): boolean {
  return isFullyObserved(ctx.coverage, startMs, endMs);
}

export function pastDeadline(ctx: ResolverContext): boolean {
  return ctx.now_ms >= toMs(ctx.pool.settlement_deadline);
}

function evidenceIds(events: ReadonlyArray<AnyEvent | null | undefined>): string[] {
  const out: string[] = [];
  for (const e of events) if (e && !out.includes(e.source_event_id)) out.push(e.source_event_id);
  return out;
}

function maxReceived(events: ReadonlyArray<AnyEvent | null | undefined>): string | undefined {
  let best: number | undefined;
  for (const e of events) {
    if (!e) continue;
    const r = toMs(e.received_at);
    if (best === undefined || r > best) best = r;
  }
  return best === undefined ? undefined : toIso(best);
}

/** Latest of an ISO instant and the evidence receive times. */
export function atLeast(iso: string, events: ReadonlyArray<AnyEvent | null | undefined>): string {
  const r = maxReceived(events);
  return r && toMs(r) > toMs(iso) ? r : toIso(toMs(iso));
}

export function pending(values?: Values): ResolverOutput {
  return values && Object.keys(values).length > 0 ? { state: 'PENDING', values } : { state: 'PENDING' };
}

export function voided(
  ctx: ResolverContext,
  reason: VoidReason,
  evidence: ReadonlyArray<AnyEvent | null | undefined>,
  values: Values = {},
  determinedAt?: string,
): ResolverOutput {
  return {
    state: 'VOID',
    reason,
    evidence: evidenceIds(evidence),
    values,
    determined_at: determinedAt ?? maxReceived(evidence) ?? toIso(toMs(ctx.pool.target.window_end)),
  };
}

/** PENDING before the absolute deadline; VOID(reason) at/after it (F1-067). */
export function waitOrVoid(
  ctx: ResolverContext,
  reason: VoidReason,
  evidence: ReadonlyArray<AnyEvent | null | undefined> = [],
  values: Values = {},
): ResolverOutput {
  if (pastDeadline(ctx)) return voided(ctx, reason, evidence, values, toIso(toMs(ctx.pool.settlement_deadline)));
  return pending(values);
}

export function resolved(
  ctx: ResolverContext,
  outcomeId: string,
  evidence: ReadonlyArray<AnyEvent | null | undefined>,
  values: Values = {},
  determinedAt?: string,
): ResolverOutput {
  // A value outside the frozen outcome set is a data contradiction, never a new outcome.
  if (!ctx.pool.outcomes.some((o) => o.id === outcomeId)) {
    return waitOrVoid(ctx, 'CONTRADICTORY_DATA', evidence, { ...values, unexpected_outcome: outcomeId });
  }
  return {
    state: 'RESOLVED',
    winner_outcome_id: outcomeId,
    evidence: evidenceIds(evidence),
    values,
    determined_at: determinedAt ?? maxReceived(evidence) ?? toIso(toMs(ctx.pool.target.window_end)),
  };
}

/* ------------------------------------------------------------------ */
/* Race control / red flag                                             */
/* ------------------------------------------------------------------ */

/** Red-flag onsets: race-control transitions into RED and SESSION_STATE SUSPENDED. */
export function redOnsets(events: readonly AnyEvent[]): AnyEvent[] {
  const out: AnyEvent[] = raceControlTransitions(events)
    .filter((tr) => tr.to === 'RED')
    .map((tr) => tr.event as AnyEvent);
  for (const e of ofType(events, 'SESSION_STATE')) if (e.payload.status === 'SUSPENDED') out.push(e as AnyEvent);
  return sortEvents(out);
}

export function firstRedOnset(events: readonly AnyEvent[], startMs: number, endMs: number): AnyEvent | null {
  return redOnsets(events).find((e) => inWindow(tOf(e), startMs, endMs)) ?? null;
}

export function trackStateAtMs(events: readonly AnyEvent[], tMs: number): { state: TrackState; event: AnyEvent | null } {
  let state: TrackState = 'GREEN';
  let event: AnyEvent | null = null;
  for (const tr of raceControlTransitions(events)) {
    if (toMs(tr.occurred_at) > tMs) break;
    state = tr.to;
    event = tr.event as AnyEvent;
  }
  return { state, event };
}

function sessionSuspendedAt(events: readonly AnyEvent[], tMs: number): AnyEvent | null {
  let last: AnyEvent | null = null;
  for (const e of ofType(events, 'SESSION_STATE')) {
    if (tOf(e as AnyEvent) > tMs) break;
    if (e.payload.segment_id && e.payload.segment_state) continue;
    last = e as AnyEvent;
  }
  return last && last.type === 'SESSION_STATE' && last.payload.status === 'SUSPENDED' ? last : null;
}

export function redActiveAt(events: readonly AnyEvent[], tMs: number): boolean {
  return trackStateAtMs(events, tMs).state === 'RED' || sessionSuspendedAt(events, tMs) !== null;
}

/** Evidence event when SC/VSC/RED (or a session suspension) overlapped [start, end), else null. */
export function neutralisedDuring(events: readonly AnyEvent[], startMs: number, endMs: number): AnyEvent | null {
  const atStart = trackStateAtMs(events, startMs);
  if (NEUTRAL_STATES.includes(atStart.state) && atStart.event) return atStart.event;
  const suspended = sessionSuspendedAt(events, startMs);
  if (suspended) return suspended;
  for (const tr of raceControlTransitions(events)) {
    const t = toMs(tr.occurred_at);
    if (t > startMs && t < endMs && NEUTRAL_STATES.includes(tr.to)) return tr.event as AnyEvent;
  }
  return firstRedOnset(events, startMs, endMs);
}

/* ------------------------------------------------------------------ */
/* Ordering (F1-030)                                                   */
/* ------------------------------------------------------------------ */

export type Ordered<E> = { kind: 'NONE' } | { kind: 'FIRST'; event: E } | { kind: 'AMBIGUOUS'; events: E[] };

/**
 * First candidate by occurrence. Candidates whose uncertainty intervals
 * overlap the earliest one and map to a different outcome are resolved only
 * by a trustworthy source sequence; otherwise the order is ambiguous.
 */
export function firstByOrder<E extends AnyEvent>(
  cands: readonly E[],
  keyOf: (e: E) => string,
  opts: { trustSequence: boolean; precisionMs?: number },
): Ordered<E> {
  if (cands.length === 0) return { kind: 'NONE' };
  const sorted = sortEvents(cands);
  const first = sorted[0]!;
  const unc = (e: E) => Math.max(e.timestamp_uncertainty_ms, opts.precisionMs ?? 0);
  const contenders = sorted.filter((e) => tOf(e) - unc(e) <= tOf(first) + unc(first));
  if (new Set(contenders.map(keyOf)).size === 1) return { kind: 'FIRST', event: first };
  const sameSource = new Set(contenders.map((e) => `${e.source_provider}/${e.source_product}`)).size === 1;
  if (opts.trustSequence && sameSource && contenders.every((e) => e.source_sequence != null && e.source_sequence !== '')) {
    const bySource = [...contenders].sort((a, b) => compareSeq(a.source_sequence!, b.source_sequence!));
    return { kind: 'FIRST', event: bySource[0]! };
  }
  return { kind: 'AMBIGUOUS', events: contenders };
}

export function uncertaintyOf(e: AnyEvent, precisionMs = 0): number {
  return Math.max(e.timestamp_uncertainty_ms, precisionMs);
}

/* ------------------------------------------------------------------ */
/* Driver status (F1-028)                                              */
/* ------------------------------------------------------------------ */

export type InactiveStatus = 'DSQ' | 'DNS' | 'RETIRED';

/** Latest CONFIRMED DRIVER_STATUS of a driver with occurred_at ≤ t. */
export function latestStatus(events: readonly AnyEvent[], driver: string, tMs: number): NormalizedEvent<'DRIVER_STATUS'> | null {
  let last: NormalizedEvent<'DRIVER_STATUS'> | null = null;
  for (const e of ofType(events, 'DRIVER_STATUS')) {
    if (tOf(e as AnyEvent) > tMs) break;
    if (e.payload.driver_id === driver && e.payload.quality === 'CONFIRMED') last = e;
  }
  return last;
}

/** Precedence DSQ → DNS → RETIRED over any running position. */
export function inactiveOf(status: DriverStatus | null | undefined, activity?: DriverActivity | null): InactiveStatus | null {
  if (status === 'DSQ' || activity === 'DSQ') return 'DSQ';
  if (status === 'DNS' || activity === 'DNS') return 'DNS';
  if (status === 'RETIRED' || activity === 'RETIRED') return 'RETIRED';
  return null;
}

/* ------------------------------------------------------------------ */
/* Classification / session markers                                    */
/* ------------------------------------------------------------------ */

function classifications(events: readonly AnyEvent[], scope: 'SESSION' | 'SEGMENT', segmentId?: SegmentId) {
  return ofType(events, 'CLASSIFICATION_PUBLISHED').filter(
    (e) => e.payload.scope === scope && (scope === 'SESSION' || e.payload.segment_id === segmentId),
  );
}

function latestByRevision(list: NormalizedEvent<'CLASSIFICATION_PUBLISHED'>[]) {
  let best: NormalizedEvent<'CLASSIFICATION_PUBLISHED'> | null = null;
  for (const e of list) if (!best || e.payload.classification_revision >= best.payload.classification_revision) best = e;
  return best;
}

/** Official (non-provisional) classification with the highest classification_revision. */
export function officialClassification(events: readonly AnyEvent[], scope: 'SESSION' | 'SEGMENT', segmentId?: SegmentId) {
  return latestByRevision(classifications(events, scope, segmentId).filter((e) => !e.payload.provisional));
}

export function provisionalClassification(events: readonly AnyEvent[], scope: 'SESSION' | 'SEGMENT', segmentId?: SegmentId) {
  return latestByRevision(classifications(events, scope, segmentId).filter((e) => e.payload.provisional));
}

export function entryOf(cls: NormalizedEvent<'CLASSIFICATION_PUBLISHED'>, driver: string): ClassificationEntry | undefined {
  return cls.payload.entries.find((x) => x.driver_id === driver);
}

export interface SessionMarkers {
  started: AnyEvent | null;
  ended: AnyEvent | null;
  cancelled: AnyEvent | null;
}

/** Start/end/cancel markers of the session (no segment) or of one qualifying segment. */
export function sessionMarkers(events: readonly AnyEvent[], segmentId?: SegmentId): SessionMarkers {
  const m: SessionMarkers = { started: null, ended: null, cancelled: null };
  for (const e of ofType(events, 'SESSION_STATE')) {
    const p = e.payload;
    const ev = e as AnyEvent;
    if (segmentId) {
      if (p.segment_id !== segmentId) {
        if (p.status === 'CANCELLED' && !p.segment_id) m.cancelled ??= ev;
        continue;
      }
      if (p.segment_state === 'STARTED') m.started ??= ev;
      else if (p.segment_state === 'ENDED') m.ended ??= ev;
      else if (p.segment_state === 'CANCELLED') m.cancelled ??= ev;
    } else {
      if (p.status === 'STARTED') m.started ??= ev;
      else if (p.status === 'FINISHED' || p.status === 'FINALISED') m.ended ??= ev;
      else if (p.status === 'CANCELLED') m.cancelled ??= ev;
    }
  }
  return m;
}

/**
 * M13–M18 without an official result (F1-067, QA24): cancelled → TARGET_CANCELLED;
 * otherwise wait until the absolute cutoff, then TARGET_NOT_STARTED /
 * RESOLUTION_DEADLINE_EXCEEDED with full observation, INCOMPLETE_OBSERVATION otherwise.
 */
export function sessionFinalFallback(ctx: ResolverContext, segmentId?: SegmentId, values: Values = {}): ResolverOutput {
  const m = sessionMarkers(ctx.events, segmentId);
  if (m.cancelled) return voided(ctx, 'TARGET_CANCELLED', [m.cancelled], values);
  if (!pastDeadline(ctx)) return pending(values);
  const w = win(ctx);
  const deadline = ctx.pool.settlement_deadline;
  if (!m.started) {
    return voided(ctx, observed(ctx, w.start, w.deadline) ? 'TARGET_NOT_STARTED' : 'INCOMPLETE_OBSERVATION', [], values, deadline);
  }
  if (!m.ended) {
    const full = observed(ctx, tOf(m.started), w.deadline);
    return voided(ctx, full ? 'RESOLUTION_DEADLINE_EXCEEDED' : 'INCOMPLETE_OBSERVATION', [m.started], values, deadline);
  }
  return voided(ctx, 'RESOLUTION_DEADLINE_EXCEEDED', [m.started, m.ended], values, deadline);
}

/** Cars progressing from a segment, using manifest segments or the ruleset default. */
export function advancingFrom(ctx: ResolverContext, segmentId: SegmentId): number {
  const n = ctx.manifest.participants.length;
  const segments =
    ctx.manifest.segments && ctx.manifest.segments.length > 0
      ? ctx.manifest.segments
      : buildSegments(ctx.manifest.session_type, ctx.manifest.planned_start_at, n);
  return advancingCount(segments, segmentId, n);
}

/* ------------------------------------------------------------------ */
/* Laps                                                                */
/* ------------------------------------------------------------------ */

export function lapAttemptId(e: NormalizedEvent<'LAP_COMPLETED'>): string {
  return e.attempt_id ?? `${e.payload.driver_id}:lap:${e.payload.driver_lap}`;
}

export function lapInvalidation(events: readonly AnyEvent[], lap: NormalizedEvent<'LAP_COMPLETED'>): NormalizedEvent<'LAP_INVALIDATED'> | null {
  const id = lapAttemptId(lap);
  return (
    ofType(events, 'LAP_INVALIDATED').find(
      (i) =>
        i.payload.lap_attempt_id === id ||
        (i.payload.driver_id === lap.payload.driver_id && i.payload.driver_lap === lap.payload.driver_lap),
    ) ?? null
  );
}

export function isValidLap(events: readonly AnyEvent[], lap: NormalizedEvent<'LAP_COMPLETED'>): boolean {
  return lap.payload.valid && lapInvalidation(events, lap) === null;
}

export function bucketOf(valueMs: number, t1: number, t2: number): 'BUCKET_1' | 'BUCKET_2' | 'BUCKET_3' {
  if (valueMs < t1) return 'BUCKET_1';
  if (valueMs < t2) return 'BUCKET_2';
  return 'BUCKET_3';
}

/* ------------------------------------------------------------------ */
/* Timing snapshots (F1-018, F1-058)                                   */
/* ------------------------------------------------------------------ */

export type AnchorResult =
  | { kind: 'NONE' }
  | { kind: 'FOUND'; snapshot: NormalizedEvent<'TIMING_ORDER'> }
  | { kind: 'CONTRADICTORY'; snapshots: NormalizedEvent<'TIMING_ORDER'>[] };

function pickSnapshot(list: NormalizedEvent<'TIMING_ORDER'>[]): AnchorResult {
  if (list.length === 0) return { kind: 'NONE' };
  const t0 = Math.min(...list.map((e) => tOf(e as AnyEvent)));
  const atFirst = list.filter((e) => tOf(e as AnyEvent) === t0);
  const maxRev = Math.max(...atFirst.map((e) => e.payload.snapshot_revision));
  const top = atFirst.filter((e) => e.payload.snapshot_revision === maxRev);
  const orders = new Set(top.map((e) => e.payload.order.map((o) => `${o.driver_id}:${o.position}:${o.activity}`).join('|')));
  if (orders.size > 1) return { kind: 'CONTRADICTORY', snapshots: top };
  return { kind: 'FOUND', snapshot: top[top.length - 1]! };
}

/** First confirmed leader crossing at the end of lap L — kept even if the leader later changes. */
export function leaderAnchor(events: readonly AnyEvent[], lap: number): AnchorResult {
  return pickSnapshot(
    ofType(events, 'TIMING_ORDER').filter((e) => e.payload.anchor?.kind === 'LEADER_LAP_COMPLETED' && e.payload.anchor.lap === lap),
  );
}

/** First snapshot at/after `fromMs` in which the driver has completed `lap` of their own laps. */
export function driverLapSnapshot(events: readonly AnyEvent[], driver: string, lap: number, fromMs: number): AnchorResult {
  const after = ofType(events, 'TIMING_ORDER').filter((e) => {
    if (tOf(e as AnyEvent) < fromMs) return false;
    const entry = e.payload.order.find((o) => o.driver_id === driver);
    return entry !== undefined && entry.driver_laps >= lap;
  });
  if (after.length === 0) return { kind: 'NONE' };
  const t0 = tOf(after[0] as AnyEvent);
  return pickSnapshot(after.filter((e) => tOf(e as AnyEvent) === t0));
}

/** Snapshot valid at T: highest snapshot_revision among occurred_at ≤ T (stale ones never roll back). */
export function snapshotAt(events: readonly AnyEvent[], tMs: number): NormalizedEvent<'TIMING_ORDER'> | null {
  let best: NormalizedEvent<'TIMING_ORDER'> | null = null;
  for (const e of ofType(events, 'TIMING_ORDER')) {
    if (tOf(e as AnyEvent) > tMs) continue;
    if (!best || e.payload.snapshot_revision >= best.payload.snapshot_revision) best = e;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Location at T (F1-068, F1-070)                                      */
/* ------------------------------------------------------------------ */

export type Location = 'S1' | 'S2' | 'S3' | 'PIT' | InactiveStatus;

export type LocationResult =
  | { kind: 'KNOWN'; location: Location; evidence: AnyEvent[]; values: Values }
  | { kind: 'UNKNOWN'; evidence: AnyEvent[] }
  | { kind: 'AMBIGUOUS'; evidence: AnyEvent[] };

interface LocState {
  status: DriverStatus | null;
  occupancy: Occupancy | null;
  sector: 1 | 2 | 3 | null;
  driver_lap: number | null;
  statusEvent: AnyEvent | null;
  locationEvent: AnyEvent | null;
}

function isLocationEvent(e: AnyEvent, driver: string): boolean {
  switch (e.type) {
    case 'DRIVER_STATUS':
      return e.payload.driver_id === driver && e.payload.quality === 'CONFIRMED';
    case 'SECTOR_COMPLETED':
    case 'LAP_COMPLETED':
      return e.payload.driver_id === driver;
    case 'PIT_ENTRY':
    case 'PIT_EXIT':
      return e.payload.driver_id === driver && e.payload.quality === 'CONFIRMED';
    default:
      return false;
  }
}

function foldLocation(events: readonly AnyEvent[]): LocState {
  const s: LocState = { status: null, occupancy: null, sector: null, driver_lap: null, statusEvent: null, locationEvent: null };
  for (const e of events) {
    switch (e.type) {
      case 'DRIVER_STATUS':
        s.status = e.payload.status;
        s.occupancy = e.payload.occupancy;
        s.sector = e.payload.occupancy === 'ON_TRACK' ? e.payload.sector : null;
        s.driver_lap = e.payload.driver_lap;
        s.statusEvent = e;
        s.locationEvent = e;
        break;
      case 'SECTOR_COMPLETED':
        if (s.occupancy === 'ON_TRACK') {
          s.sector = e.payload.sector === 3 ? 1 : ((e.payload.sector + 1) as 2 | 3);
          s.locationEvent = e;
        }
        break;
      case 'LAP_COMPLETED':
        s.driver_lap = e.payload.driver_lap;
        if (s.occupancy === 'ON_TRACK' && !e.payload.pit_in_lap) {
          s.sector = 1;
          s.locationEvent = e;
        }
        break;
      case 'PIT_ENTRY':
        s.occupancy = 'PIT_LANE';
        s.sector = null;
        s.locationEvent = e;
        break;
      case 'PIT_EXIT':
        // The exact sector after pit exit is unknown until the next confirmed sector signal.
        s.occupancy = 'ON_TRACK';
        s.sector = null;
        s.locationEvent = e;
        break;
      default:
        break;
    }
  }
  return s;
}

function locationOf(s: LocState): Location | null {
  const inactive = inactiveOf(s.status);
  if (inactive) return inactive;
  if (s.status === null) return null;
  if (s.occupancy === 'GARAGE' || s.occupancy === 'PIT_LANE') return 'PIT';
  if (s.occupancy === 'ON_TRACK' && s.sector) return `S${s.sector}` as Location;
  return null;
}

/**
 * Confirmed location of a driver at T: priority DSQ → DNS → RETIRED → PIT
 * (garage or pit lane, incl. the initial GARAGE snapshot) → sector. Unknown
 * occupancy is never replaced by PIT. A state change whose timestamp
 * uncertainty straddles T and would change the answer is AMBIGUOUS.
 */
export function locationAt(ctx: ResolverContext, driver: string, tMs: number): LocationResult {
  const rel = ctx.events.filter((e) => isLocationEvent(e, driver));
  const before = rel.filter((e) => tOf(e) <= tMs);
  const after = rel.filter((e) => tOf(e) > tMs);
  const state = foldLocation(before);
  const loc = locationOf(state);
  const evidence = [state.statusEvent, state.locationEvent].filter((e): e is AnyEvent => e !== null);
  if (!loc || before.length === 0) return { kind: 'UNKNOWN', evidence };
  const last = before[before.length - 1]!;
  if (!observed(ctx, tOf(last), tMs + 1)) return { kind: 'UNKNOWN', evidence };
  if (tOf(last) + uncertaintyOf(last) > tMs && locationOf(foldLocation(before.slice(0, -1))) !== loc) {
    return { kind: 'AMBIGUOUS', evidence: [...evidence, last] };
  }
  const next = after[0];
  if (next && tOf(next) - uncertaintyOf(next) <= tMs && locationOf(foldLocation([...before, next])) !== loc) {
    return { kind: 'AMBIGUOUS', evidence: [...evidence, next] };
  }
  return {
    kind: 'KNOWN',
    location: loc,
    evidence,
    values: {
      location: loc,
      status: state.status,
      occupancy: state.occupancy,
      sector: state.sector,
      driver_lap: state.driver_lap,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pit visits (F1-025, F1-063, F1-064)                                 */
/* ------------------------------------------------------------------ */

export type VisitResult =
  | { kind: 'DONE'; output: ResolverOutput }
  | { kind: 'NONE' }
  | { kind: 'VISIT'; entry: NormalizedEvent<'PIT_ENTRY'>; exit: NormalizedEvent<'PIT_EXIT'>; values: Values };

/**
 * First NORMAL_RACING_VISIT of a driver whose PIT_ENTRY falls in [start, end).
 * A visit begun before the window never becomes the target by a late exit.
 * The exit may arrive after window_end, within the settlement deadline.
 * A red flag before the visit (in the window) or inside it → VOID INTERRUPTED.
 */
export function firstNormalVisit(ctx: ResolverContext, driver: string): VisitResult {
  const w = win(ctx);
  const entry =
    ofType(ctx.events, 'PIT_ENTRY').find(
      (e) =>
        e.payload.driver_id === driver &&
        e.payload.normal_racing_visit &&
        e.payload.quality === 'CONFIRMED' &&
        inWindow(tOf(e as AnyEvent), w.start, w.end) &&
        !redActiveAt(ctx.events, tOf(e as AnyEvent)),
    ) ?? null;
  const decisive = entry ? tOf(entry as AnyEvent) : w.end;
  const red = firstRedOnset(ctx.events, w.start, decisive);
  if (red) return { kind: 'DONE', output: voided(ctx, 'INTERRUPTED', [red], { red_flag_at: red.occurred_at }) };
  if (!entry) {
    if (observed(ctx, w.start, w.end)) return { kind: 'NONE' };
    return { kind: 'DONE', output: waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION') };
  }
  const entryEv = entry as AnyEvent;
  const values: Values = {
    pit_visit_id: entry.payload.pit_visit_id,
    entry_at: entry.occurred_at,
    target_start_at: entry.occurred_at,
    driver_lap: entry.payload.driver_lap,
  };
  if (!observed(ctx, w.start, decisive + 1)) return { kind: 'DONE', output: waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [entryEv], values) };
  const exit =
    ofType(ctx.events, 'PIT_EXIT').find(
      (x) => x.payload.driver_id === driver && x.payload.pit_visit_id === entry.payload.pit_visit_id,
    ) ?? null;
  if (exit) {
    const exitEv = exit as AnyEvent;
    const redIn = firstRedOnset(ctx.events, decisive, tOf(exitEv) + 1);
    const v = { ...values, exit_at: exit.occurred_at };
    if (exit.payload.interrupted_by_red || !exit.payload.normal_racing_visit || redIn) {
      return { kind: 'DONE', output: voided(ctx, 'INTERRUPTED', [entryEv, exitEv, redIn], { ...v, interrupted_by_red: true }) };
    }
    if (exit.payload.quality !== 'CONFIRMED') return { kind: 'DONE', output: waitOrVoid(ctx, 'INCOMPLETE_OBSERVATION', [entryEv, exitEv], v) };
    return { kind: 'VISIT', entry, exit, values: v };
  }
  const redAfter = firstRedOnset(ctx.events, decisive, INF);
  if (redAfter) return { kind: 'DONE', output: voided(ctx, 'INTERRUPTED', [entryEv, redAfter], { ...values, interrupted_by_red: true }) };
  const reason: VoidReason = observed(ctx, decisive, w.deadline) ? 'RESOLUTION_DEADLINE_EXCEEDED' : 'INCOMPLETE_OBSERVATION';
  return { kind: 'DONE', output: waitOrVoid(ctx, reason, [entryEv], values) };
}

/** Open pit visit (entry without exit) of a driver at t. */
export function inPitLaneAt(events: readonly AnyEvent[], driver: string, tMs: number): boolean {
  let open: string | null = null;
  for (const e of events) {
    if (tOf(e) > tMs) break;
    if (e.type === 'PIT_ENTRY' && e.payload.driver_id === driver) open = e.payload.pit_visit_id;
    else if (e.type === 'PIT_EXIT' && e.payload.driver_id === driver && e.payload.pit_visit_id === open) open = null;
  }
  return open !== null;
}

/* ------------------------------------------------------------------ */
/* Tyre stints                                                         */
/* ------------------------------------------------------------------ */

export function confirmedStints(events: readonly AnyEvent[], driver: string): NormalizedEvent<'TYRE_STINT_CONFIRMED'>[] {
  return ofType(events, 'TYRE_STINT_CONFIRMED').filter((s) => s.payload.driver_id === driver && s.payload.quality === 'CONFIRMED');
}

export function exitOfVisit(events: readonly AnyEvent[], driver: string, visitId: string | null): NormalizedEvent<'PIT_EXIT'> | null {
  if (!visitId) return null;
  return ofType(events, 'PIT_EXIT').find((x) => x.payload.driver_id === driver && x.payload.pit_visit_id === visitId) ?? null;
}

export function entryOfVisit(events: readonly AnyEvent[], driver: string, visitId: string | null): NormalizedEvent<'PIT_ENTRY'> | null {
  if (!visitId) return null;
  return ofType(events, 'PIT_ENTRY').find((x) => x.payload.driver_id === driver && x.payload.pit_visit_id === visitId) ?? null;
}

/** When a stint took effect: its pit exit if linked, otherwise the confirmation time. */
export function stintEffectiveMs(events: readonly AnyEvent[], stint: NormalizedEvent<'TYRE_STINT_CONFIRMED'>): number {
  const exit = exitOfVisit(events, stint.payload.driver_id, stint.payload.pit_visit_id);
  return exit ? tOf(exit as AnyEvent) : tOf(stint as AnyEvent);
}

/** Confirmed compound fitted at T, or null when unknown (never assumed — F1-057). */
export function compoundAt(events: readonly AnyEvent[], driver: string, tMs: number): { compound: string; stint: NormalizedEvent<'TYRE_STINT_CONFIRMED'> } | null {
  let best: NormalizedEvent<'TYRE_STINT_CONFIRMED'> | null = null;
  for (const s of confirmedStints(events, driver)) {
    if (stintEffectiveMs(events, s) > tMs) continue;
    if (!best || s.payload.stint_number >= best.payload.stint_number) best = s;
  }
  if (!best) return null;
  const since = stintEffectiveMs(events, best);
  // A later exit at or before T without a confirmed stint means the fitted compound is unknown.
  const laterExit = ofType(events, 'PIT_EXIT').some(
    (x) => x.payload.driver_id === driver && tOf(x as AnyEvent) > since && tOf(x as AnyEvent) <= tMs && x.payload.pit_visit_id !== best!.payload.pit_visit_id,
  );
  if (laterExit || inPitLaneAt(events, driver, tMs)) return null;
  return { compound: best.payload.compound, stint: best };
}
