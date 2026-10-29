/**
 * Pulse Arena — Formula 1 domain contract (SRS 09, v1.0.0).
 *
 * Shared by the DEMO simulator (event producer), the event store, market
 * resolvers and the UI. Timestamps are ISO-8601 UTC strings in events;
 * durations are integer milliseconds (F1-012).
 */

/* ------------------------------------------------------------------ */
/* Sessions, manifests, capabilities                                   */
/* ------------------------------------------------------------------ */

export type SessionType = 'PRACTICE' | 'QUALIFYING' | 'SPRINT_QUALIFYING' | 'SPRINT' | 'GRAND_PRIX';

export type SegmentId = 'Q1' | 'Q2' | 'Q3' | 'SQ1' | 'SQ2' | 'SQ3';

export type Compound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET';

/** F1-009 — adapter capabilities, published separately. */
export type Capability =
  | 'session_status'
  | 'timing_order'
  | 'final_classification'
  | 'laps'
  | 'sectors'
  | 'occupancy'
  | 'pit_entry_exit'
  | 'stationary_stop'
  | 'tyre_stints'
  | 'race_control'
  | 'location'
  | 'on_track_pass'
  | 'retirement'
  | 'qualifying_progression'
  | 'aero_mode';

export type CapabilityManifest = Record<Capability, boolean>;

export type QualityLevel = 'SUPPORTED' | 'DEGRADED' | 'UNAVAILABLE';

export interface CapabilityQuality {
  level: QualityLevel;
  coverage_from: string | null;
  max_age_ms: number;
  timestamp_precision_ms: number;
  validation_suite_version: string;
}

export type QualityProfile = Record<Capability, CapabilityQuality>;

export interface SegmentManifest {
  segment_id: SegmentId;
  duration_ms: number;
  /** Number of cars eliminated at the end of this part (0 for the last part). */
  eliminated: number;
  planned_start_at: string;
  planned_end_at: string;
}

export interface SessionManifest {
  session_id: string;
  /** Session-level stream id used as `event_id` of normalized events (F1-011). */
  event_id: string;
  meeting_id: string;
  season: number;
  session_type: SessionType;
  circuit_id: string;
  circuit_layout_version: string;
  ruleset_version: string;
  provider_schema_version: string;
  participants: string[];
  planned_start_at: string;
  planned_end_at: string;
  /** Planned race distance (GP/Sprint only). */
  laps?: number;
  segments?: SegmentManifest[];
  capabilities: CapabilityManifest;
  quality: QualityProfile;
  /** Updated session time (F1-037): previous start shown as superseded. */
  rescheduled_from?: string | null;
}

/* ------------------------------------------------------------------ */
/* Normalized events (F1-011, F1-013)                                  */
/* ------------------------------------------------------------------ */

export type EventType =
  | 'SESSION_STATE'
  | 'RACE_CONTROL_STATE'
  | 'TIMING_ORDER'
  | 'LAP_COMPLETED'
  | 'LAP_INVALIDATED'
  | 'SECTOR_COMPLETED'
  | 'PIT_ENTRY'
  | 'PIT_EXIT'
  | 'TYRE_STINT_CONFIRMED'
  | 'DRIVER_STATUS'
  | 'CLASSIFICATION_PUBLISHED'
  | 'EVENT_CORRECTED'
  | 'ON_TRACK_PASS';

export const KNOWN_EVENT_TYPES: readonly EventType[] = [
  'SESSION_STATE',
  'RACE_CONTROL_STATE',
  'TIMING_ORDER',
  'LAP_COMPLETED',
  'LAP_INVALIDATED',
  'SECTOR_COMPLETED',
  'PIT_ENTRY',
  'PIT_EXIT',
  'TYRE_STINT_CONFIRMED',
  'DRIVER_STATUS',
  'CLASSIFICATION_PUBLISHED',
  'EVENT_CORRECTED',
  'ON_TRACK_PASS',
];

export type DataQuality = 'CONFIRMED' | 'PROVISIONAL';

export type SessionStatus =
  | 'NOT_STARTED'
  | 'FORMATION'
  | 'STARTED'
  | 'SUSPENDED'
  | 'RESUMED'
  | 'FINISHED'
  | 'FINALISED'
  | 'CANCELLED';

export interface SessionStatePayload {
  sport: 'formula1';
  status: SessionStatus;
  /** Qualifying part transitions. */
  segment_id?: SegmentId | null;
  segment_state?: 'STARTED' | 'ENDED' | 'CANCELLED' | null;
  /** Server remaining time for the current segment at occurred_at. */
  remaining_ms?: number | null;
  leader_lap?: number | null;
}

/** F1-022 — global race control state; local sector flags are separate. */
export type TrackState = 'GREEN' | 'SC' | 'VSC' | 'RED' | 'SC_ENDING' | 'VSC_ENDING' | 'CHEQUERED';
export type SectorFlag = 'CLEAR' | 'YELLOW' | 'DOUBLE_YELLOW';

export interface RaceControlStatePayload {
  sport: 'formula1';
  scope: 'TRACK' | 'SECTOR';
  /** Present when scope === 'TRACK'. */
  track_state?: TrackState;
  /** Present when scope === 'SECTOR'. */
  sector?: 1 | 2 | 3;
  sector_flag?: SectorFlag;
  /** Stable message id; a repeated message has the same id (F1-QA09). */
  message_id: string;
  leader_lap: number | null;
  message_key?: string;
}

export type DriverActivity = 'RUNNING' | 'PIT' | 'RETIRED' | 'DNS' | 'DSQ' | 'GARAGE';

export interface TimingOrderEntry {
  driver_id: string;
  position: number;
  gap_to_leader_ms: number | null;
  interval_ms: number | null;
  /** Laps completed by this driver (lapped cars have fewer — F1-018, F1-QA14). */
  driver_laps: number;
  activity: DriverActivity;
  best_lap_ms?: number | null;
}

export interface TimingOrderPayload {
  sport: 'formula1';
  leader_lap: number;
  snapshot_revision: number;
  order: TimingOrderEntry[];
  /** Set when the snapshot is taken at a control-line crossing anchor. */
  anchor?: { kind: 'LEADER_LAP_COMPLETED'; lap: number } | null;
}

export interface LapCompletedPayload {
  sport: 'formula1';
  driver_id: string;
  driver_lap: number;
  leader_lap: number;
  lap_time_ms: number;
  valid: boolean;
  started_at: string;
  /** True when SC/VSC/RED was active at any time during the lap. */
  neutralised: boolean;
  pit_in_lap: boolean;
  pit_out_lap: boolean;
  segment_id?: SegmentId | null;
}

export interface LapInvalidatedPayload {
  sport: 'formula1';
  driver_id: string;
  driver_lap: number;
  /** attempt_id of the lap that was invalidated. */
  lap_attempt_id: string;
  reason: 'TRACK_LIMITS' | 'STEWARDS' | 'OTHER';
  segment_id?: SegmentId | null;
}

export interface SectorCompletedPayload {
  sport: 'formula1';
  driver_id: string;
  driver_lap: number;
  sector: 1 | 2 | 3;
  sector_time_ms: number;
  valid: boolean;
  started_at: string;
  neutralised: boolean;
  segment_id?: SegmentId | null;
}

export interface PitEntryPayload {
  sport: 'formula1';
  driver_id: string;
  driver_lap: number;
  leader_lap: number;
  pit_visit_id: string;
  /** F1-025 — false for the mandatory return under a red flag. */
  normal_racing_visit: boolean;
  quality: DataQuality;
}

export type PitService = 'TYRES' | 'DRIVE_THROUGH' | 'STOP_GO' | 'REPAIR';

export interface PitExitPayload {
  sport: 'formula1';
  driver_id: string;
  driver_lap: number;
  leader_lap: number;
  pit_visit_id: string;
  quality: DataQuality;
  /** Compound fitted at exit; null when unknown (F1-057: never assume Medium). */
  compound: Compound | null;
  /** PIT_ENTRY → PIT_EXIT (M06). */
  lane_duration_ms: number | null;
  /** Stationary part (M05); null for drive-through or unknown. */
  stop_duration_ms: number | null;
  service: PitService;
  normal_racing_visit: boolean;
  /** True when a red flag interrupted this visit (F1-025). */
  interrupted_by_red: boolean;
}

export interface TyreStintPayload {
  sport: 'formula1';
  driver_id: string;
  stint_number: number;
  compound: Compound;
  supplier_spec: string | null;
  new_set: boolean;
  start_driver_lap: number;
  pit_visit_id: string | null;
  quality: DataQuality;
}

export type DriverStatus = 'ACTIVE' | 'RETIRED' | 'DNS' | 'DSQ';
export type Occupancy = 'ON_TRACK' | 'PIT_LANE' | 'GARAGE' | 'UNKNOWN';

export interface DriverStatusPayload {
  sport: 'formula1';
  driver_id: string;
  status: DriverStatus;
  occupancy: Occupancy;
  /** Confirmed current sector while ON_TRACK. */
  sector: 1 | 2 | 3 | null;
  driver_lap: number;
  quality: DataQuality;
  reason_key?: string | null;
  /** F1-030 — confirmed source simultaneous-group id (M12 SIMULTANEOUS when declared before OPEN). */
  simultaneous_group_id?: string | null;
}

export type ClassificationStatus = 'CLASSIFIED' | 'NOT_CLASSIFIED' | 'DNS' | 'DSQ';

export interface ClassificationEntry {
  driver_id: string;
  position: number | null;
  status: ClassificationStatus;
  laps: number;
  best_lap_ms: number | null;
  total_time_ms: number | null;
  gap_ms: number | null;
  /** Qualifying segment classification: progressed to the next part. */
  progressed?: boolean | null;
}

export interface ClassificationPayload {
  sport: 'formula1';
  scope: 'SESSION' | 'SEGMENT';
  segment_id?: SegmentId | null;
  classification_revision: number;
  provisional: boolean;
  entries: ClassificationEntry[];
}

export interface EventCorrectedPayload {
  sport: 'formula1';
  corrected_source_event_id: string;
  previous_revision: string;
  new_revision: string;
  reason_key: string;
  /** Human-readable diff values for the "what changed" explainer (F1-042). */
  before?: Record<string, string | number | boolean | null>;
  after?: Record<string, string | number | boolean | null>;
}

export interface OnTrackPassPayload {
  sport: 'formula1';
  passing_driver_id: string;
  passed_driver_id: string;
  /** Race lap of both cars — must be equal for M07 (no lapping, F1-032). */
  passing_driver_lap: number;
  passed_driver_lap: number;
  leader_lap: number;
  sector: 1 | 2 | 3;
  distance_m: number;
  provenance: 'VERIFIED' | 'UNVERIFIED';
  track_state: TrackState;
  /** Passes caused by pit stops or penalties never appear as ON_TRACK_PASS. */
  cause: 'ON_TRACK';
}

export interface PayloadByType {
  SESSION_STATE: SessionStatePayload;
  RACE_CONTROL_STATE: RaceControlStatePayload;
  TIMING_ORDER: TimingOrderPayload;
  LAP_COMPLETED: LapCompletedPayload;
  LAP_INVALIDATED: LapInvalidatedPayload;
  SECTOR_COMPLETED: SectorCompletedPayload;
  PIT_ENTRY: PitEntryPayload;
  PIT_EXIT: PitExitPayload;
  TYRE_STINT_CONFIRMED: TyreStintPayload;
  DRIVER_STATUS: DriverStatusPayload;
  CLASSIFICATION_PUBLISHED: ClassificationPayload;
  EVENT_CORRECTED: EventCorrectedPayload;
  ON_TRACK_PASS: OnTrackPassPayload;
}

export interface NormalizedEvent<T extends EventType = EventType> {
  schema_version: 'pulse.event.v1';
  /** Session stream id (not the source record id). */
  event_id: string;
  /** Canonical stream position, string to stay safe beyond 2^53 (F1-012). */
  stream_seq: string;
  source_event_id: string;
  source_provider: 'fixture' | 'demo-sim';
  source_product: string;
  source_revision: string;
  occurred_at: string;
  received_at: string;
  published_at: string;
  timestamp_uncertainty_ms: number;
  period_id: string;
  attempt_id: string | null;
  type: T;
  payload: PayloadByType[T];
  supersedes_source_event_id: string | null;
  is_retracted: boolean;
  mapping_version: string;
  /**
   * F1-030 — the source's own ordering sequence. Resolves equal/overlapping
   * timestamps; absent (lost) sequence plus overlapping times → AMBIGUOUS_EVENT_ORDER.
   */
  source_sequence?: string | null;
}

export type AnyEvent = { [K in EventType]: NormalizedEvent<K> }[EventType];

/** Raw (pre-normalization) record with an unknown/unsupported code goes to quarantine (F1-014). */
export interface RawSourceRecord {
  source_event_id: string;
  source_revision: string;
  code: string;
  received_at: string;
  checksum: string;
  body: unknown;
}

/**
 * Feed coverage: half-open UTC intervals [start,end) in epoch ms that were
 * fully observed (no gaps). Used to distinguish NO_EVENT from VOID (F1-020).
 */
export interface FeedCoverage {
  intervals: Array<[number, number]>;
  /** Everything before this instant has been received (stream watermark). */
  watermark_ms: number;
}

/* ------------------------------------------------------------------ */
/* Markets and pools (F1-015 … F1-036, F1-062 … F1-070)                */
/* ------------------------------------------------------------------ */

export type MarketId =
  | 'F1-M01' | 'F1-M02' | 'F1-M03' | 'F1-M04' | 'F1-M05' | 'F1-M06' | 'F1-M07'
  | 'F1-M08' | 'F1-M09' | 'F1-M10' | 'F1-M11' | 'F1-M12' | 'F1-M13' | 'F1-M14'
  | 'F1-M15' | 'F1-M16' | 'F1-M17' | 'F1-M18' | 'F1-M19' | 'F1-M20' | 'F1-M21';

export type PoolStatus = 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'LOCKED' | 'RESOLVING' | 'SETTLED' | 'VOID';
export type IntakeStatus = 'ACCEPTING' | 'SUSPENDED';

export type WindowProfile = 'WALL_CLOCK' | 'NEXT_DRIVER_LAP' | 'LEADER_LAP_RANGE' | 'NEXT_EVENT' | 'SESSION_FINAL';
export type InterruptionPolicy = 'CONTINUE' | 'VOID_IF_INTERRUPTED' | 'WAIT_FOR_FINAL';
export type TargetKind = 'AT_INSTANT' | 'NEXT_EVENT' | 'WINDOW' | 'LAP' | 'SESSION';

/** F1-003 — what determines the result; always printed on the card. */
export type ResultDeterminant =
  | 'TRACK_ORDER'
  | 'TIMING_ORDER'
  | 'OFFICIAL_CLASSIFICATION'
  | 'STARTING_GRID'
  | 'RACE_CONTROL'
  | 'PIT_TIMING'
  | 'LAP_TIMING'
  | 'OCCUPANCY'
  | 'TYRE_STINTS';

export type MarketFamily = 'POSITION' | 'DUEL' | 'PIT' | 'TYRES' | 'PACE' | 'NEUTRALISATION' | 'RETIREMENT' | 'CLASSIFICATION' | 'QUALIFYING' | 'COMBO';

export interface ComboPart {
  kind: 'POSITION_GROUP' | 'TYRE_COMPOUND' | 'AHEAD_OF' | 'ON_TRACK' | 'SECTOR';
  driver_id: string;
  /** e.g. position group 'P1_3', compound 'MEDIUM', other driver id, sector '2'. */
  value: string;
}

export interface TargetParameters {
  lap_anchor?: 'LEADER' | 'DRIVER';
  target_lap?: number;
  interruption_policy: InterruptionPolicy;
  threshold_units?: 'ms';
  /** Bucket thresholds frozen at pool creation (F1-027). */
  t1_ms?: number;
  t2_ms?: number;
  reference_time_ms?: number;
  reference_attempt_id?: string;
  at_instant?: string;
  segment_id?: SegmentId;
  sector?: 1 | 2 | 3;
  green_only?: boolean;
  /** F1-030 precision-defined tie profile for M12. */
  tie_profile?: { tie_precision_ms: number; tie_origin_at: string } | null;
  /** F1-030 — M12: confirmed source simultaneous-groups count as SIMULTANEOUS (declared before OPEN). */
  simultaneous_source_group?: boolean;
  /** F1-021 — DEMO short window profile frozen at creation (30/60/120 s). */
  window_profile_ms?: number;
  combo?: [ComboPart, ComboPart];
}

export interface TargetSpec {
  kind: TargetKind;
  not_before: string;
  window_end: string;
  parameters: TargetParameters;
}

export interface Outcome {
  id: string;
  /** i18n key for the outcome label. */
  label_key: string;
  label_params?: Record<string, string | number>;
  driver_id?: string;
}

export interface PoolVersions {
  season: number;
  meeting_id: string;
  session_id: string;
  session_type: SessionType;
  circuit_layout_version: string;
  ruleset_version: string;
  provider_schema_version: string;
  template_version: string;
}

export type VoidReason =
  | 'INCOMPLETE_OBSERVATION'
  | 'TARGET_NOT_STARTED'
  | 'TARGET_CANCELLED'
  | 'RESOLUTION_DEADLINE_EXCEEDED'
  | 'TARGET_BOUNDARY_CONTAMINATED'
  | 'AMBIGUOUS_EVENT_ORDER'
  | 'INTERRUPTED'
  | 'REFERENCE_INVALID'
  | 'UNKNOWN_REQUIRED_PART'
  | 'CONTRADICTORY_DATA';

export interface Settlement {
  pool_id: string;
  winner_outcome_id: string | null;
  void_reason: VoidReason | null;
  evidence_source_event_ids: string[];
  evidence_revisions: Record<string, string>;
  normalized_values: Record<string, string | number | boolean | null>;
  template_version: string;
  settlement_revision: number;
  determined_at: string;
  provisional: boolean;
}

export interface Pool extends PoolVersions {
  pool_id: string;
  version: number;
  market_id: MarketId;
  status: PoolStatus;
  intake_status: IntakeStatus;
  suspend_reason?: 'RED_FLAG' | 'SIGNAL_LOST' | 'SESSION_SUSPENDED' | null;
  created_at: string;
  opens_at: string;
  closes_at: string;
  target: TargetSpec;
  settlement_deadline: string;
  subject: { driver_a?: string; driver_b?: string };
  outcomes: Outcome[];
  settlement: Settlement | null;
  /** Previous settlement revisions — corrections never silently overwrite (F1-056). */
  settlement_history: Settlement[];
}

/** Canonical event after revisions/retractions are applied (what resolvers consume). */
export type CanonicalEvent = AnyEvent;

export interface ResolverContext {
  pool: Pool;
  /** Canonical events of the session sorted by (occurred_at, stream_seq). */
  events: readonly CanonicalEvent[];
  coverage: FeedCoverage;
  manifest: SessionManifest;
  /** Current server time, epoch ms. */
  now_ms: number;
}

export type ResolverOutput =
  | { state: 'PENDING'; values?: Record<string, string | number | boolean | null> }
  | {
      state: 'RESOLVED';
      winner_outcome_id: string;
      evidence: string[];
      values: Record<string, string | number | boolean | null>;
      /** When the result became determinable (from evidence/ctx, never the wall clock). */
      determined_at?: string;
    }
  | {
      state: 'VOID';
      reason: VoidReason;
      evidence: string[];
      values: Record<string, string | number | boolean | null>;
      determined_at?: string;
    };

export type Resolver = (ctx: ResolverContext) => ResolverOutput;
