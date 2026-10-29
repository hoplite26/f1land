/**
 * Fluent fixture builder for sessions, manifests and normalized events.
 * Times are offsets in ms from the session start (t0); stream_seq is
 * assigned automatically. Coverage is full unless gaps are declared, and the
 * watermark never passes the context's `now`. Every emitted event counts as
 * delivered — emit later events after asserting the earlier state.
 */
import { DRIVERS } from '@/data/teams';
import { DEFAULT_RULESET_VERSION, buildSegments, plannedSessionEnd } from '@/config/ruleset';
import { buildDemoCapabilities } from '../capabilities';
import { EventStore } from '../events/store';
import { createPool, type PoolTiming } from '../markets/factory';
import type { PoolParams } from '../markets/catalog';
import { RESOLVERS } from '../resolvers';
import type {
  AnyEvent,
  Capability,
  ClassificationEntry,
  Compound,
  DataQuality,
  DriverStatus,
  EventType,
  FeedCoverage,
  MarketId,
  NormalizedEvent,
  Occupancy,
  PayloadByType,
  PitService,
  Pool,
  ResolverContext,
  ResolverOutput,
  SegmentId,
  SessionManifest,
  SessionStatus,
  SessionType,
  TimingOrderEntry,
  TrackState,
} from '../types';

export const DEFAULT_T0 = '2026-10-08T15:00:00.000Z';
export const ALL_DRIVERS: string[] = DRIVERS.map((d) => d.id);
const DAY = 86_400_000;

type PayloadIn<T extends EventType> = Omit<PayloadByType[T], 'sport'>;

export interface EmitOptions {
  id?: string;
  revision?: number;
  attempt?: string | null;
  uncertainty?: number;
  /** Delivery delay (received_at − occurred_at). */
  delay?: number;
  supersedes?: string | null;
  retracted?: boolean;
  sourceSequence?: string | null;
  period?: string;
}

export interface SessionOptions {
  type?: SessionType;
  start?: string;
  participants?: string[];
  sessionId?: string;
  degraded?: Capability[];
  unavailable?: Capability[];
  laps?: number;
}

export class SessionBuilder {
  readonly manifest: SessionManifest;
  readonly t0: number;
  readonly events: AnyEvent[] = [];
  private seq = 0n;
  private counters = new Map<string, number>();
  private gaps: Array<[number, number]> = [];
  private watermarkAt: number | null = null;

  constructor(opts: SessionOptions = {}) {
    const type = opts.type ?? 'GRAND_PRIX';
    const start = opts.start ?? DEFAULT_T0;
    const participants = opts.participants ?? ALL_DRIVERS;
    this.t0 = Date.parse(start);
    const caps = buildDemoCapabilities({ degraded: opts.degraded, unavailable: opts.unavailable ?? ['aero_mode'] });
    const segments = buildSegments(type, start, participants.length);
    this.manifest = {
      session_id: opts.sessionId ?? `demo-${type.toLowerCase()}`,
      event_id: `event_f1_demo_${type.toLowerCase()}`,
      meeting_id: 'demo-2026-abu-dhabi',
      season: 2026,
      session_type: type,
      circuit_id: 'yas_marina',
      circuit_layout_version: 'yas-marina-2021-v1',
      ruleset_version: DEFAULT_RULESET_VERSION,
      provider_schema_version: 'pulse.event.v1',
      participants: [...participants],
      planned_start_at: start,
      planned_end_at: plannedSessionEnd(type, start, participants.length),
      ...(type === 'GRAND_PRIX' || type === 'SPRINT' ? { laps: opts.laps ?? (type === 'SPRINT' ? 19 : 58) } : {}),
      ...(segments.length > 0 ? { segments } : {}),
      capabilities: caps.capabilities,
      quality: caps.quality,
    };
  }

  iso(offsetMs: number): string {
    return new Date(this.t0 + offsetMs).toISOString();
  }

  abs(offsetMs: number): number {
    return this.t0 + offsetMs;
  }

  private nextId(type: EventType): string {
    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    return `src_${type.toLowerCase()}_${String(n).padStart(4, '0')}`;
  }

  emit<T extends EventType>(type: T, atMs: number, payload: PayloadIn<T>, opts: EmitOptions = {}): NormalizedEvent<T> {
    this.seq += 1n;
    const occurred = this.t0 + atMs;
    const received = occurred + (opts.delay ?? 300);
    const ev = {
      schema_version: 'pulse.event.v1',
      event_id: this.manifest.event_id,
      stream_seq: this.seq.toString(),
      source_event_id: opts.id ?? this.nextId(type),
      source_provider: 'fixture',
      source_product: 'formula1-deterministic-v1',
      source_revision: String(opts.revision ?? 1),
      occurred_at: new Date(occurred).toISOString(),
      received_at: new Date(received).toISOString(),
      published_at: new Date(received + 50).toISOString(),
      timestamp_uncertainty_ms: opts.uncertainty ?? 0,
      period_id: opts.period ?? this.manifest.session_type.toLowerCase(),
      attempt_id: opts.attempt ?? null,
      type,
      payload: { sport: 'formula1', ...payload } as PayloadByType[T],
      supersedes_source_event_id: opts.supersedes ?? null,
      is_retracted: opts.retracted ?? false,
      mapping_version: 'f1-fixture-v1',
      ...(opts.sourceSequence !== undefined ? { source_sequence: opts.sourceSequence } : {}),
    } as NormalizedEvent<T>;
    this.events.push(ev as unknown as AnyEvent);
    return ev;
  }

  /* ---------------- event helpers ---------------- */

  sessionState(at: number, status: SessionStatus, extra: Partial<PayloadIn<'SESSION_STATE'>> = {}, opts?: EmitOptions) {
    return this.emit('SESSION_STATE', at, { status, ...extra }, opts);
  }

  segment(at: number, segment: SegmentId, state: 'STARTED' | 'ENDED' | 'CANCELLED', opts?: EmitOptions) {
    return this.emit('SESSION_STATE', at, { status: 'STARTED', segment_id: segment, segment_state: state }, opts);
  }

  rc(at: number, state: TrackState, o: { messageId?: string; leaderLap?: number | null } & EmitOptions = {}) {
    const messageId = o.messageId ?? `rc_${at}_${state}`;
    return this.emit('RACE_CONTROL_STATE', at, { scope: 'TRACK', track_state: state, message_id: messageId, leader_lap: o.leaderLap ?? null }, o);
  }

  sectorFlag(at: number, sector: 1 | 2 | 3, flag: 'CLEAR' | 'YELLOW' | 'DOUBLE_YELLOW', o: EmitOptions = {}) {
    return this.emit('RACE_CONTROL_STATE', at, { scope: 'SECTOR', sector, sector_flag: flag, message_id: `flag_${at}_${sector}`, leader_lap: null }, o);
  }

  timing(
    at: number,
    order: ReadonlyArray<string | (Partial<TimingOrderEntry> & { driver_id: string })>,
    o: { leaderLap: number; anchorLap?: number | null; snapshotRevision?: number } & EmitOptions,
  ) {
    const entries: TimingOrderEntry[] = order.map((x, i) => {
      const base = typeof x === 'string' ? { driver_id: x } : x;
      return {
        driver_id: base.driver_id,
        position: base.position ?? i + 1,
        gap_to_leader_ms: base.gap_to_leader_ms ?? i * 1000,
        interval_ms: base.interval_ms ?? (i === 0 ? null : 1000),
        driver_laps: base.driver_laps ?? o.leaderLap,
        activity: base.activity ?? 'RUNNING',
        best_lap_ms: base.best_lap_ms ?? null,
      };
    });
    return this.emit(
      'TIMING_ORDER',
      at,
      {
        leader_lap: o.leaderLap,
        snapshot_revision: o.snapshotRevision ?? this.events.filter((e) => e.type === 'TIMING_ORDER').length + 1,
        order: entries,
        anchor: o.anchorLap != null ? { kind: 'LEADER_LAP_COMPLETED', lap: o.anchorLap } : null,
      },
      o,
    );
  }

  lap(
    driver: string,
    at: number,
    o: {
      lap: number;
      time: number;
      valid?: boolean;
      startedAt?: number;
      neutralised?: boolean;
      pitIn?: boolean;
      pitOut?: boolean;
      segment?: SegmentId | null;
      leaderLap?: number;
    } & EmitOptions,
  ) {
    return this.emit(
      'LAP_COMPLETED',
      at,
      {
        driver_id: driver,
        driver_lap: o.lap,
        leader_lap: o.leaderLap ?? o.lap,
        lap_time_ms: o.time,
        valid: o.valid ?? true,
        started_at: this.iso(o.startedAt ?? at - o.time),
        neutralised: o.neutralised ?? false,
        pit_in_lap: o.pitIn ?? false,
        pit_out_lap: o.pitOut ?? false,
        segment_id: o.segment ?? null,
      },
      { attempt: o.attempt ?? `${driver}:lap:${o.lap}`, ...o },
    );
  }

  invalidateLap(driver: string, at: number, o: { lap: number; attempt?: string; reason?: 'TRACK_LIMITS' | 'STEWARDS' | 'OTHER'; segment?: SegmentId | null } & EmitOptions) {
    return this.emit(
      'LAP_INVALIDATED',
      at,
      { driver_id: driver, driver_lap: o.lap, lap_attempt_id: o.attempt ?? `${driver}:lap:${o.lap}`, reason: o.reason ?? 'TRACK_LIMITS', segment_id: o.segment ?? null },
      o,
    );
  }

  sector(driver: string, at: number, o: { lap: number; sector: 1 | 2 | 3; time: number; valid?: boolean; startedAt?: number; neutralised?: boolean } & EmitOptions) {
    return this.emit(
      'SECTOR_COMPLETED',
      at,
      {
        driver_id: driver,
        driver_lap: o.lap,
        sector: o.sector,
        sector_time_ms: o.time,
        valid: o.valid ?? true,
        started_at: this.iso(o.startedAt ?? at - o.time),
        neutralised: o.neutralised ?? false,
        segment_id: null,
      },
      o,
    );
  }

  pitEntry(driver: string, at: number, o: { visit: string; normal?: boolean; lap?: number; quality?: DataQuality } & EmitOptions) {
    return this.emit(
      'PIT_ENTRY',
      at,
      { driver_id: driver, driver_lap: o.lap ?? 10, leader_lap: o.lap ?? 10, pit_visit_id: o.visit, normal_racing_visit: o.normal ?? true, quality: o.quality ?? 'CONFIRMED' },
      { attempt: o.visit, ...o },
    );
  }

  pitExit(
    driver: string,
    at: number,
    o: {
      visit: string;
      compound?: Compound | null;
      lane?: number | null;
      stop?: number | null;
      service?: PitService;
      normal?: boolean;
      red?: boolean;
      lap?: number;
      quality?: DataQuality;
    } & EmitOptions,
  ) {
    return this.emit(
      'PIT_EXIT',
      at,
      {
        driver_id: driver,
        driver_lap: o.lap ?? 10,
        leader_lap: o.lap ?? 10,
        pit_visit_id: o.visit,
        quality: o.quality ?? 'CONFIRMED',
        compound: o.compound === undefined ? 'HARD' : o.compound,
        lane_duration_ms: o.lane === undefined ? 22_000 : o.lane,
        stop_duration_ms: o.stop === undefined ? 2_400 : o.stop,
        service: o.service ?? 'TYRES',
        normal_racing_visit: o.normal ?? true,
        interrupted_by_red: o.red ?? false,
      },
      { attempt: o.visit, ...o },
    );
  }

  /** Convenience: entry + exit + confirmed stint. */
  pitStop(driver: string, entryAt: number, o: { visit: string; lane?: number; stop?: number; compound?: Compound; stint?: number; service?: PitService; newSet?: boolean }) {
    const lane = o.lane ?? 22_000;
    const entry = this.pitEntry(driver, entryAt, { visit: o.visit });
    const exit = this.pitExit(driver, entryAt + lane, { visit: o.visit, lane, stop: o.stop, compound: o.compound ?? 'HARD', service: o.service });
    const stint = this.stint(driver, entryAt + lane + 500, { number: o.stint ?? 2, compound: o.compound ?? 'HARD', visit: o.visit, newSet: o.newSet });
    return { entry, exit, stint };
  }

  stint(driver: string, at: number, o: { number: number; compound: Compound; newSet?: boolean; visit?: string | null; startLap?: number; quality?: DataQuality } & EmitOptions) {
    return this.emit(
      'TYRE_STINT_CONFIRMED',
      at,
      {
        driver_id: driver,
        stint_number: o.number,
        compound: o.compound,
        supplier_spec: null,
        new_set: o.newSet ?? true,
        start_driver_lap: o.startLap ?? 1,
        pit_visit_id: o.visit ?? null,
        quality: o.quality ?? 'CONFIRMED',
      },
      o,
    );
  }

  status(
    driver: string,
    at: number,
    o: { status?: DriverStatus; occupancy?: Occupancy; sector?: 1 | 2 | 3 | null; lap?: number; quality?: DataQuality; group?: string | null } & EmitOptions = {},
  ) {
    return this.emit(
      'DRIVER_STATUS',
      at,
      {
        driver_id: driver,
        status: o.status ?? 'ACTIVE',
        occupancy: o.occupancy ?? 'ON_TRACK',
        sector: o.sector === undefined ? 1 : o.sector,
        driver_lap: o.lap ?? 1,
        quality: o.quality ?? 'CONFIRMED',
        ...(o.group !== undefined ? { simultaneous_group_id: o.group } : {}),
      },
      o,
    );
  }

  /** Initial snapshot: every participant ACTIVE in the given occupancy. */
  initialStatuses(at: number, occupancy: Occupancy = 'ON_TRACK') {
    for (const d of this.manifest.participants) this.status(d, at, { occupancy, sector: occupancy === 'ON_TRACK' ? 1 : null, lap: 0 });
    return this;
  }

  classification(
    at: number,
    entries: ReadonlyArray<string | (Partial<ClassificationEntry> & { driver_id: string })>,
    o: { scope?: 'SESSION' | 'SEGMENT'; segment?: SegmentId; revision?: number; provisional?: boolean } & EmitOptions = {},
  ) {
    const list: ClassificationEntry[] = entries.map((x, i) => {
      const b = typeof x === 'string' ? { driver_id: x } : x;
      const status = b.status ?? 'CLASSIFIED';
      return {
        driver_id: b.driver_id,
        position: b.position !== undefined ? b.position : status === 'CLASSIFIED' ? i + 1 : null,
        status,
        laps: b.laps ?? 58,
        best_lap_ms: b.best_lap_ms ?? null,
        total_time_ms: b.total_time_ms ?? null,
        gap_ms: b.gap_ms ?? null,
        ...(b.progressed !== undefined ? { progressed: b.progressed } : {}),
      };
    });
    return this.emit(
      'CLASSIFICATION_PUBLISHED',
      at,
      {
        scope: o.scope ?? (o.segment ? 'SEGMENT' : 'SESSION'),
        segment_id: o.segment ?? null,
        classification_revision: o.revision ?? 1,
        provisional: o.provisional ?? false,
        entries: list,
      },
      o,
    );
  }

  pass(
    at: number,
    passer: string,
    passed: string,
    o: { lap?: number; passedLap?: number; provenance?: 'VERIFIED' | 'UNVERIFIED'; trackState?: TrackState; sector?: 1 | 2 | 3 } & EmitOptions = {},
  ) {
    return this.emit(
      'ON_TRACK_PASS',
      at,
      {
        passing_driver_id: passer,
        passed_driver_id: passed,
        passing_driver_lap: o.lap ?? 20,
        passed_driver_lap: o.passedLap ?? o.lap ?? 20,
        leader_lap: o.lap ?? 20,
        sector: o.sector ?? 1,
        distance_m: 1200,
        provenance: o.provenance ?? 'VERIFIED',
        track_state: o.trackState ?? 'GREEN',
        cause: 'ON_TRACK',
      },
      o,
    );
  }

  /** New revision of the same source record (F1-011); payload patched, received at `receivedAt`. */
  revise<T extends EventType>(ev: NormalizedEvent<T>, receivedAt: number, patch: Partial<PayloadIn<T>> = {}, o: { occurredAt?: number; revision?: number; retracted?: boolean } = {}): NormalizedEvent<T> {
    this.seq += 1n;
    const next = {
      ...ev,
      stream_seq: this.seq.toString(),
      source_revision: String(o.revision ?? Number(ev.source_revision) + 1),
      occurred_at: o.occurredAt !== undefined ? this.iso(o.occurredAt) : ev.occurred_at,
      received_at: this.iso(receivedAt),
      published_at: this.iso(receivedAt + 50),
      payload: { ...ev.payload, ...patch },
      is_retracted: o.retracted ?? false,
    } as NormalizedEvent<T>;
    this.events.push(next as unknown as AnyEvent);
    return next;
  }

  retract<T extends EventType>(ev: NormalizedEvent<T>, receivedAt: number): NormalizedEvent<T> {
    return this.revise(ev, receivedAt, {}, { retracted: true });
  }

  /* ---------------- coverage ---------------- */

  gap(fromMs: number, toMs: number): this {
    this.gaps.push([this.t0 + fromMs, this.t0 + toMs]);
    return this;
  }

  watermark(atMs: number): this {
    this.watermarkAt = this.t0 + atMs;
    return this;
  }

  coverage(nowAbsMs: number = Number.POSITIVE_INFINITY): FeedCoverage {
    const watermark = Math.min(this.watermarkAt ?? Number.POSITIVE_INFINITY, nowAbsMs);
    let intervals: Array<[number, number]> = [[this.t0 - DAY, Math.min(this.t0 + 30 * DAY, watermark)]];
    for (const [a, b] of this.gaps) {
      const next: Array<[number, number]> = [];
      for (const [x, y] of intervals) {
        if (b <= x || a >= y) next.push([x, y]);
        else {
          if (a > x) next.push([x, a]);
          if (b < y) next.push([b, y]);
        }
      }
      intervals = next;
    }
    return { intervals: intervals.filter(([x, y]) => y > x), watermark_ms: Number.isFinite(watermark) ? watermark : this.t0 + 30 * DAY };
  }

  /* ---------------- store / pools / contexts ---------------- */

  store(events: readonly AnyEvent[] = this.events): EventStore {
    const store = new EventStore();
    store.ingestMany(events);
    return store;
  }

  pool(
    marketId: MarketId,
    params: PoolParams,
    t: { closes: number; opens?: number; created?: number; notBefore?: number; windowEnd?: number; plannedEnd?: number; cutoff?: number; id?: string },
  ): Pool {
    const timing: PoolTiming = {
      created_at: this.iso(t.created ?? t.opens ?? t.closes - 60_000),
      opens_at: this.iso(t.opens ?? t.closes - 60_000),
      closes_at: this.iso(t.closes),
      ...(t.notBefore !== undefined ? { not_before: this.iso(t.notBefore) } : {}),
      ...(t.windowEnd !== undefined ? { window_end: this.iso(t.windowEnd) } : {}),
      ...(t.plannedEnd !== undefined ? { planned_end_at: this.iso(t.plannedEnd) } : {}),
      ...(t.cutoff !== undefined ? { explicit_cutoff: this.iso(t.cutoff) } : {}),
      ...(t.id ? { pool_id: t.id } : {}),
    };
    return createPool(marketId, params, this.manifest, timing);
  }

  /** Short-window pool: closes at `closes`, target window [notBefore, notBefore + windowMs). */
  shortPool(marketId: MarketId, params: PoolParams, notBefore: number, windowMs = 60_000): Pool {
    return this.pool(marketId, params, { closes: notBefore - 1_000, notBefore, windowEnd: notBefore + windowMs });
  }

  ctx(pool: Pool, nowOffsetMs: number, events?: readonly AnyEvent[]): ResolverContext {
    const now = this.t0 + nowOffsetMs;
    return {
      pool,
      events: this.store(events).canonical(),
      coverage: this.coverage(now),
      manifest: this.manifest,
      now_ms: now,
    };
  }

  /** Context input for settlePool (without the pool). */
  input(nowOffsetMs: number, events?: readonly AnyEvent[]) {
    const now = this.t0 + nowOffsetMs;
    return { events: this.store(events).canonical(), coverage: this.coverage(now), manifest: this.manifest, now_ms: now };
  }

  resolve(pool: Pool, nowOffsetMs: number): ResolverOutput {
    return RESOLVERS[pool.market_id](this.ctx(pool, nowOffsetMs));
  }

  /** Offset (ms from t0) of an ISO instant. */
  offset(iso: string): number {
    return Date.parse(iso) - this.t0;
  }
}

export function session(opts: SessionOptions = {}): SessionBuilder {
  return new SessionBuilder(opts);
}

/** Offset just past a pool's absolute settlement deadline. */
export function afterDeadline(s: SessionBuilder, pool: Pool, extraMs = 1): number {
  return s.offset(pool.settlement_deadline) + extraMs;
}
