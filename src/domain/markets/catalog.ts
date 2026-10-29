/**
 * Full catalog of game questions F1-M01 … F1-M21 (SRS §6, F1-003, F1-009,
 * F1-023/024, F1-062 and the family table after F1-070).
 *
 * Every template produces the COMPLETE outcome set; unknown data never
 * becomes an outcome — it is handled by VOID reasons in the resolvers.
 */
import { DEMO_PIT_THRESHOLDS, type LockSignal } from '@/config/profiles';
import type {
  Capability,
  ComboPart,
  Compound,
  InterruptionPolicy,
  MarketFamily,
  MarketId,
  Outcome,
  Pool,
  ResultDeterminant,
  SegmentId,
  SessionManifest,
  SessionType,
  TargetKind,
  WindowProfile,
} from '../types';

/** Behaviour under SC/VSC (family table after F1-070). */
export type NeutralisationRule =
  | 'CONTINUE_WITH_ANCHOR'
  | 'NORMAL_VISITS_ALLOWED'
  | 'ONLY_PASSES_OUTSIDE_NEUTRALISATION'
  | 'VOID_ON_INTERRUPTION'
  | 'VALID_LAPS_REMAIN'
  | 'OBSERVATION_CONTINUES'
  | 'WAIT_FOR_RESULT'
  | 'INHERIT_COMPATIBLE';

/** Behaviour under RED (family table after F1-070). */
export type RedFlagRule =
  | 'VOID_BEFORE_ANCHOR'
  | 'VOID_IN_AFFECTED_WINDOW'
  | 'VOID_ON_INTERRUPTION'
  | 'ORIGINAL_WINDOW_CONTINUES'
  | 'OBSERVATION_CONTINUES'
  | 'WAIT_FOR_RESULT_VOID_IF_CANCELLED'
  | 'INHERIT_COMPATIBLE';

export type SubjectKind = 'DRIVER' | 'DUEL' | 'NONE';

/** Parameters supplied when a pool is created; frozen into target.parameters (F1-027). */
export interface PoolParams {
  driver_a?: string;
  driver_b?: string;
  target_lap?: number;
  lap_anchor?: 'LEADER' | 'DRIVER';
  at_instant?: string;
  segment_id?: SegmentId;
  sector?: 1 | 2 | 3;
  t1_ms?: number;
  t2_ms?: number;
  reference_time_ms?: number;
  reference_attempt_id?: string;
  tie_profile?: { tie_precision_ms: number; tie_origin_at: string } | null;
  simultaneous_source_group?: boolean;
  combo?: [ComboPart, ComboPart];
  /** M17 — drivers admitted to Q3/SQ3 (from the confirmed Q2/SQ2 classification). */
  admitted?: string[];
  /** F1-021 — DEMO short window profile (30/60/120 s). */
  window_profile_ms?: number;
}

export interface MarketTemplate {
  id: MarketId;
  template_version: string;
  family: MarketFamily;
  title_key: string;
  question_key: string;
  rule_key: string;
  /** F1-003 — what determines the result; always printed on the card. */
  determinant: ResultDeterminant;
  window_profile: WindowProfile;
  target_kind: TargetKind;
  interruption_policy: InterruptionPolicy;
  sc_vsc: NeutralisationRule;
  red: RedFlagRule;
  green_only: boolean;
  /** Short-term pools suspend intake on a red flag (F1-023). */
  short_term: boolean;
  subject: SubjectKind;
  lock_signal: LockSignal;
  required_capabilities: readonly Capability[];
  optional_capabilities: readonly Capability[];
  allowed_session_types: readonly SessionType[];
  allowed_segments?: readonly SegmentId[];
  buildOutcomes(params: PoolParams, manifest: SessionManifest): Outcome[];
}

export const MARKET_IDS: readonly MarketId[] = [
  'F1-M01', 'F1-M02', 'F1-M03', 'F1-M04', 'F1-M05', 'F1-M06', 'F1-M07',
  'F1-M08', 'F1-M09', 'F1-M10', 'F1-M11', 'F1-M12', 'F1-M13', 'F1-M14',
  'F1-M15', 'F1-M16', 'F1-M17', 'F1-M18', 'F1-M19', 'F1-M20', 'F1-M21',
];

export const COMPOUNDS: readonly Compound[] = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];

export const POSITION_GROUPS = ['P1', 'P1_3', 'P2_3', 'P4_10', 'P1_10', 'P11_PLUS'] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

/** F1-036 — the only allowed M21 combinations (order-insensitive). */
export const COMBO_PAIRS: ReadonlyArray<readonly [ComboPart['kind'], ComboPart['kind']]> = [
  ['POSITION_GROUP', 'TYRE_COMPOUND'],
  ['AHEAD_OF', 'ON_TRACK'],
  ['SECTOR', 'TYRE_COMPOUND'],
];

export const COMBO_PART_CAPABILITIES: Record<ComboPart['kind'], readonly Capability[]> = {
  POSITION_GROUP: ['timing_order'],
  TYRE_COMPOUND: ['tyre_stints'],
  AHEAD_OF: ['timing_order'],
  ON_TRACK: ['occupancy'],
  SECTOR: ['occupancy', 'sectors'],
};

/* ------------------------------------------------------------------ */
/* Outcome builders                                                    */
/* ------------------------------------------------------------------ */

function outcome(id: string, label_key: string, label_params?: Record<string, string | number>, driver_id?: string): Outcome {
  const o: Outcome = { id, label_key };
  if (label_params) o.label_params = label_params;
  if (driver_id) o.driver_id = driver_id;
  return o;
}

const driverOutcomes = (drivers: readonly string[]): Outcome[] =>
  drivers.map((d) => outcome(d, 'f1.outcome.driver', { driver: d }, d));

const statusOutcomes = (): Outcome[] => [
  outcome('RETIRED', 'f1.outcome.retired'),
  outcome('DNS', 'f1.outcome.dns'),
  outcome('DSQ', 'f1.outcome.dsq'),
];

export function bucketOutcomes(t1: number, t2: number): Outcome[] {
  return [
    outcome('BUCKET_1', 'f1.outcome.bucket.low', { t1 }),
    outcome('BUCKET_2', 'f1.outcome.bucket.mid', { t1, t2 }),
    outcome('BUCKET_3', 'f1.outcome.bucket.high', { t2 }),
  ];
}

export function thresholdsFor(marketId: MarketId, params: PoolParams): { t1: number; t2: number } | null {
  const fallback = DEMO_PIT_THRESHOLDS[marketId];
  const t1 = params.t1_ms ?? fallback?.t1_ms;
  const t2 = params.t2_ms ?? fallback?.t2_ms;
  return t1 === undefined || t2 === undefined ? null : { t1, t2 };
}

function groupOutcomes(groups: ReadonlyArray<[string, string]>): Outcome[] {
  return [
    ...groups.map(([id, key]) => outcome(id, key)),
    outcome('NOT_CLASSIFIED', 'f1.outcome.not_classified'),
    outcome('DNS', 'f1.outcome.dns'),
    outcome('DSQ', 'f1.outcome.dsq'),
  ];
}

const yesNo = (): Outcome[] => [outcome('YES', 'f1.outcome.yes'), outcome('NO', 'f1.outcome.no')];

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

const RACE: readonly SessionType[] = ['GRAND_PRIX', 'SPRINT'];
const QUALI: readonly SessionType[] = ['QUALIFYING', 'SPRINT_QUALIFYING'];
const ALL_SESSIONS: readonly SessionType[] = ['PRACTICE', 'QUALIFYING', 'SPRINT_QUALIFYING', 'SPRINT', 'GRAND_PRIX'];

type TemplateSpec = Omit<MarketTemplate, 'id' | 'template_version' | 'title_key' | 'question_key' | 'rule_key'> & {
  question_key?: string;
};

function template(id: MarketId, spec: TemplateSpec): MarketTemplate {
  const n = id.slice(3).toLowerCase(); // 'm01'
  return {
    id,
    template_version: `f1-${n}-v1`,
    title_key: `f1.market.${n}.title`,
    question_key: spec.question_key ?? `f1.market.${n}.question`,
    rule_key: `f1.market.${n}.rule`,
    ...spec,
  };
}

const SNAPSHOT_FAMILY = { sc_vsc: 'CONTINUE_WITH_ANCHOR', red: 'VOID_BEFORE_ANCHOR' } as const;
const PIT_FAMILY = { sc_vsc: 'NORMAL_VISITS_ALLOWED', red: 'VOID_IN_AFFECTED_WINDOW' } as const;
const FINAL_FAMILY = { sc_vsc: 'WAIT_FOR_RESULT', red: 'WAIT_FOR_RESULT_VOID_IF_CANCELLED' } as const;

export const CATALOG: Readonly<Record<MarketId, MarketTemplate>> = {
  'F1-M01': template('F1-M01', {
    family: 'POSITION',
    question_key: 'f1.position.question',
    determinant: 'TIMING_ORDER',
    window_profile: 'LEADER_LAP_RANGE',
    target_kind: 'LAP',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    ...SNAPSHOT_FAMILY,
    green_only: false,
    short_term: true,
    subject: 'DRIVER',
    lock_signal: 'LAP',
    required_capabilities: ['timing_order', 'session_status', 'race_control'],
    optional_capabilities: ['location', 'retirement'],
    allowed_session_types: RACE,
    buildOutcomes: (_p, m) => [
      ...m.participants.map((_, i) => outcome(`P${i + 1}`, 'f1.outcome.position', { position: i + 1 })),
      ...statusOutcomes(),
    ],
  }),
  'F1-M02': template('F1-M02', {
    family: 'DUEL',
    determinant: 'TIMING_ORDER',
    window_profile: 'LEADER_LAP_RANGE',
    target_kind: 'LAP',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    ...SNAPSHOT_FAMILY,
    green_only: false,
    short_term: true,
    subject: 'DUEL',
    lock_signal: 'LAP',
    required_capabilities: ['timing_order', 'session_status', 'race_control'],
    optional_capabilities: ['location'],
    allowed_session_types: RACE,
    buildOutcomes: (p) => [
      outcome('A', 'f1.outcome.driver_ahead', { driver: p.driver_a ?? '' }, p.driver_a),
      outcome('B', 'f1.outcome.driver_ahead', { driver: p.driver_b ?? '' }, p.driver_b),
      outcome('BOTH_INACTIVE', 'f1.outcome.both_inactive'),
    ],
  }),
  'F1-M03': template('F1-M03', {
    family: 'PIT',
    determinant: 'PIT_TIMING',
    window_profile: 'NEXT_EVENT',
    target_kind: 'NEXT_EVENT',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    ...PIT_FAMILY,
    green_only: false,
    short_term: true,
    subject: 'NONE',
    lock_signal: 'WINDOW',
    required_capabilities: ['pit_entry_exit', 'race_control'],
    optional_capabilities: ['location'],
    allowed_session_types: RACE,
    buildOutcomes: (_p, m) => [...driverOutcomes(m.participants), outcome('NO_ENTRY', 'f1.outcome.no_entry')],
  }),
  'F1-M04': template('F1-M04', {
    family: 'TYRES',
    determinant: 'TYRE_STINTS',
    window_profile: 'NEXT_EVENT',
    target_kind: 'NEXT_EVENT',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    ...PIT_FAMILY,
    green_only: false,
    short_term: true,
    subject: 'DRIVER',
    lock_signal: 'PIT_VISIT',
    required_capabilities: ['pit_entry_exit', 'tyre_stints', 'race_control'],
    optional_capabilities: ['location'],
    allowed_session_types: RACE,
    buildOutcomes: () => [
      ...COMPOUNDS.map((c) => outcome(c, `f1.outcome.compound.${c.toLowerCase()}`)),
      outcome('OTHER_CONFIRMED', 'f1.outcome.other_confirmed'),
      outcome('NO_EXIT', 'f1.outcome.no_exit'),
    ],
  }),
  'F1-M05': template('F1-M05', {
    family: 'PIT',
    determinant: 'PIT_TIMING',
    window_profile: 'NEXT_EVENT',
    target_kind: 'NEXT_EVENT',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    ...PIT_FAMILY,
    green_only: false,
    short_term: true,
    subject: 'DRIVER',
    lock_signal: 'PIT_VISIT',
    required_capabilities: ['pit_entry_exit', 'stationary_stop', 'race_control'],
    optional_capabilities: ['location'],
    allowed_session_types: RACE,
    buildOutcomes: (p) => {
      const t = thresholdsFor('F1-M05', p)!;
      return [...bucketOutcomes(t.t1, t.t2), outcome('NO_SERVICE', 'f1.outcome.no_service')];
    },
  }),
  'F1-M06': template('F1-M06', {
    family: 'PIT',
    determinant: 'PIT_TIMING',
    window_profile: 'NEXT_EVENT',
    target_kind: 'NEXT_EVENT',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    ...PIT_FAMILY,
    green_only: false,
    short_term: true,
    subject: 'DRIVER',
    lock_signal: 'PIT_VISIT',
    required_capabilities: ['pit_entry_exit', 'race_control'],
    optional_capabilities: ['location'],
    allowed_session_types: RACE,
    buildOutcomes: (p) => {
      const t = thresholdsFor('F1-M06', p)!;
      return [...bucketOutcomes(t.t1, t.t2), outcome('NO_VISIT', 'f1.outcome.no_visit')];
    },
  }),
  'F1-M07': template('F1-M07', {
    family: 'DUEL',
    determinant: 'TRACK_ORDER',
    window_profile: 'NEXT_EVENT',
    target_kind: 'NEXT_EVENT',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    sc_vsc: 'ONLY_PASSES_OUTSIDE_NEUTRALISATION',
    red: 'VOID_ON_INTERRUPTION',
    green_only: false,
    short_term: true,
    subject: 'DUEL',
    lock_signal: 'WINDOW',
    required_capabilities: ['on_track_pass', 'race_control', 'laps'],
    optional_capabilities: ['location'],
    allowed_session_types: RACE,
    buildOutcomes: (p) => [
      outcome('A_PASSES_B', 'f1.outcome.passes', { passer: p.driver_a ?? '', passed: p.driver_b ?? '' }, p.driver_a),
      outcome('B_PASSES_A', 'f1.outcome.passes', { passer: p.driver_b ?? '', passed: p.driver_a ?? '' }, p.driver_b),
      outcome('NO_PASS', 'f1.outcome.no_pass'),
    ],
  }),
  'F1-M08': template('F1-M08', {
    family: 'PACE',
    determinant: 'LAP_TIMING',
    window_profile: 'NEXT_DRIVER_LAP',
    target_kind: 'LAP',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    sc_vsc: 'VOID_ON_INTERRUPTION',
    red: 'VOID_ON_INTERRUPTION',
    green_only: true,
    short_term: true,
    subject: 'DRIVER',
    lock_signal: 'LAP',
    required_capabilities: ['laps', 'race_control'],
    optional_capabilities: ['sectors', 'location'],
    allowed_session_types: ALL_SESSIONS,
    buildOutcomes: () => [
      outcome('FASTER', 'f1.outcome.faster'),
      outcome('EQUAL', 'f1.outcome.equal'),
      outcome('SLOWER', 'f1.outcome.slower'),
      outcome('NO_VALID_LAP', 'f1.outcome.no_valid_lap'),
    ],
  }),
  'F1-M09': template('F1-M09', {
    family: 'PACE',
    determinant: 'LAP_TIMING',
    window_profile: 'WALL_CLOCK',
    target_kind: 'WINDOW',
    interruption_policy: 'CONTINUE',
    sc_vsc: 'VALID_LAPS_REMAIN',
    red: 'ORIGINAL_WINDOW_CONTINUES',
    green_only: false,
    short_term: true,
    subject: 'NONE',
    lock_signal: 'WINDOW',
    required_capabilities: ['laps'],
    optional_capabilities: ['race_control', 'location'],
    allowed_session_types: ALL_SESSIONS,
    buildOutcomes: (_p, m) => [
      ...driverOutcomes(m.participants),
      outcome('TIE', 'f1.outcome.tie'),
      outcome('NO_VALID_LAP', 'f1.outcome.no_valid_lap'),
    ],
  }),
  'F1-M10': template('F1-M10', {
    family: 'NEUTRALISATION',
    determinant: 'RACE_CONTROL',
    window_profile: 'NEXT_EVENT',
    target_kind: 'NEXT_EVENT',
    interruption_policy: 'CONTINUE',
    sc_vsc: 'OBSERVATION_CONTINUES',
    red: 'OBSERVATION_CONTINUES',
    green_only: false,
    short_term: true,
    subject: 'NONE',
    lock_signal: 'WINDOW',
    required_capabilities: ['race_control'],
    optional_capabilities: ['location'],
    allowed_session_types: ALL_SESSIONS,
    buildOutcomes: () => [
      outcome('SC', 'f1.outcome.sc'),
      outcome('VSC', 'f1.outcome.vsc'),
      outcome('RED', 'f1.outcome.red'),
      outcome('NONE', 'f1.outcome.no_neutralisation'),
    ],
  }),
  'F1-M11': template('F1-M11', {
    family: 'POSITION',
    determinant: 'OCCUPANCY',
    window_profile: 'WALL_CLOCK',
    target_kind: 'AT_INSTANT',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    ...SNAPSHOT_FAMILY,
    green_only: false,
    short_term: true,
    subject: 'DRIVER',
    lock_signal: 'INSTANT',
    required_capabilities: ['occupancy', 'sectors', 'session_status', 'race_control'],
    // F1-068: the rendered coordinate is never the source of M11.
    optional_capabilities: ['location'],
    allowed_session_types: ALL_SESSIONS,
    buildOutcomes: () => [
      outcome('S1', 'f1.outcome.sector', { sector: 1 }),
      outcome('S2', 'f1.outcome.sector', { sector: 2 }),
      outcome('S3', 'f1.outcome.sector', { sector: 3 }),
      outcome('PIT', 'f1.location.pit'),
      ...statusOutcomes(),
    ],
  }),
  'F1-M12': template('F1-M12', {
    family: 'RETIREMENT',
    determinant: 'RACE_CONTROL',
    window_profile: 'NEXT_EVENT',
    target_kind: 'NEXT_EVENT',
    interruption_policy: 'CONTINUE',
    sc_vsc: 'OBSERVATION_CONTINUES',
    red: 'OBSERVATION_CONTINUES',
    green_only: false,
    short_term: true,
    subject: 'NONE',
    lock_signal: 'WINDOW',
    required_capabilities: ['retirement'],
    optional_capabilities: ['race_control', 'location'],
    allowed_session_types: RACE,
    buildOutcomes: (p, m) => [
      ...driverOutcomes(m.participants),
      // F1-030: SIMULTANEOUS exists only when a tie rule was declared before OPEN.
      ...(p.tie_profile || p.simultaneous_source_group ? [outcome('SIMULTANEOUS', 'f1.outcome.simultaneous')] : []),
      outcome('NONE', 'f1.outcome.no_retirement'),
    ],
  }),
  'F1-M13': template('F1-M13', {
    family: 'CLASSIFICATION',
    determinant: 'OFFICIAL_CLASSIFICATION',
    window_profile: 'SESSION_FINAL',
    target_kind: 'SESSION',
    interruption_policy: 'WAIT_FOR_FINAL',
    ...FINAL_FAMILY,
    green_only: false,
    short_term: false,
    subject: 'DRIVER',
    lock_signal: 'SESSION',
    required_capabilities: ['final_classification', 'session_status'],
    optional_capabilities: ['timing_order', 'location'],
    allowed_session_types: ['GRAND_PRIX'],
    buildOutcomes: () =>
      groupOutcomes([
        ['P1', 'f1.outcome.group.p1'],
        ['P2_3', 'f1.outcome.group.p2_3'],
        ['P4_10', 'f1.outcome.group.p4_10'],
        ['P11_PLUS', 'f1.outcome.group.p11_plus'],
      ]),
  }),
  'F1-M14': template('F1-M14', {
    family: 'CLASSIFICATION',
    determinant: 'OFFICIAL_CLASSIFICATION',
    window_profile: 'SESSION_FINAL',
    target_kind: 'SESSION',
    interruption_policy: 'WAIT_FOR_FINAL',
    ...FINAL_FAMILY,
    green_only: false,
    short_term: false,
    subject: 'DRIVER',
    lock_signal: 'SESSION',
    required_capabilities: ['final_classification', 'session_status'],
    optional_capabilities: ['timing_order', 'location'],
    allowed_session_types: ['GRAND_PRIX'],
    buildOutcomes: yesNo,
  }),
  'F1-M15': template('F1-M15', {
    family: 'QUALIFYING',
    determinant: 'OFFICIAL_CLASSIFICATION',
    window_profile: 'SESSION_FINAL',
    target_kind: 'SESSION',
    interruption_policy: 'WAIT_FOR_FINAL',
    ...FINAL_FAMILY,
    green_only: false,
    short_term: false,
    subject: 'DRIVER',
    lock_signal: 'SESSION',
    required_capabilities: ['qualifying_progression', 'session_status'],
    optional_capabilities: ['timing_order', 'laps', 'location'],
    allowed_session_types: QUALI,
    // F1-035 / QA27: Q3 and SQ3 have no next part.
    allowed_segments: ['Q1', 'Q2', 'SQ1', 'SQ2'],
    buildOutcomes: yesNo,
  }),
  'F1-M16': template('F1-M16', {
    family: 'QUALIFYING',
    determinant: 'LAP_TIMING',
    window_profile: 'SESSION_FINAL',
    target_kind: 'SESSION',
    interruption_policy: 'WAIT_FOR_FINAL',
    ...FINAL_FAMILY,
    green_only: false,
    short_term: false,
    subject: 'DUEL',
    lock_signal: 'SESSION',
    required_capabilities: ['laps', 'session_status'],
    optional_capabilities: ['final_classification', 'location'],
    allowed_session_types: QUALI,
    allowed_segments: ['Q1', 'Q2', 'Q3', 'SQ1', 'SQ2', 'SQ3'],
    buildOutcomes: (p) => [
      outcome('A', 'f1.outcome.driver_faster', { driver: p.driver_a ?? '' }, p.driver_a),
      outcome('B', 'f1.outcome.driver_faster', { driver: p.driver_b ?? '' }, p.driver_b),
      outcome('TIE', 'f1.outcome.tie'),
      outcome('NEITHER_VALID', 'f1.outcome.neither_valid'),
    ],
  }),
  'F1-M17': template('F1-M17', {
    family: 'QUALIFYING',
    determinant: 'OFFICIAL_CLASSIFICATION',
    window_profile: 'SESSION_FINAL',
    target_kind: 'SESSION',
    interruption_policy: 'WAIT_FOR_FINAL',
    ...FINAL_FAMILY,
    green_only: false,
    short_term: false,
    subject: 'NONE',
    lock_signal: 'SESSION',
    required_capabilities: ['final_classification', 'session_status'],
    optional_capabilities: ['qualifying_progression', 'location'],
    allowed_session_types: QUALI,
    allowed_segments: ['Q3', 'SQ3'],
    buildOutcomes: (p) => driverOutcomes(p.admitted ?? []),
  }),
  'F1-M18': template('F1-M18', {
    family: 'CLASSIFICATION',
    determinant: 'OFFICIAL_CLASSIFICATION',
    window_profile: 'SESSION_FINAL',
    target_kind: 'SESSION',
    interruption_policy: 'WAIT_FOR_FINAL',
    ...FINAL_FAMILY,
    green_only: false,
    short_term: false,
    subject: 'DRIVER',
    lock_signal: 'SESSION',
    required_capabilities: ['final_classification', 'session_status'],
    optional_capabilities: ['timing_order', 'location'],
    allowed_session_types: ['SPRINT'],
    buildOutcomes: () =>
      groupOutcomes([
        ['P1', 'f1.outcome.group.p1'],
        ['P2_3', 'f1.outcome.group.p2_3'],
        ['P4_8', 'f1.outcome.group.p4_8'],
        ['P9_PLUS', 'f1.outcome.group.p9_plus'],
      ]),
  }),
  'F1-M19': template('F1-M19', {
    family: 'PACE',
    determinant: 'LAP_TIMING',
    window_profile: 'NEXT_DRIVER_LAP',
    target_kind: 'LAP',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    sc_vsc: 'VOID_ON_INTERRUPTION',
    red: 'VOID_ON_INTERRUPTION',
    green_only: true,
    short_term: true,
    subject: 'DRIVER',
    lock_signal: 'SECTOR',
    required_capabilities: ['sectors', 'race_control'],
    optional_capabilities: ['laps', 'location'],
    allowed_session_types: ALL_SESSIONS,
    buildOutcomes: (p) => [
      ...bucketOutcomes(p.t1_ms ?? 0, p.t2_ms ?? 0),
      outcome('NO_VALID_SECTOR', 'f1.outcome.no_valid_sector'),
    ],
  }),
  'F1-M20': template('F1-M20', {
    family: 'TYRES',
    determinant: 'TYRE_STINTS',
    window_profile: 'WALL_CLOCK',
    target_kind: 'WINDOW',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    ...PIT_FAMILY,
    green_only: false,
    short_term: true,
    subject: 'DRIVER',
    lock_signal: 'WINDOW',
    required_capabilities: ['tyre_stints', 'pit_entry_exit', 'race_control'],
    optional_capabilities: ['location'],
    allowed_session_types: RACE,
    buildOutcomes: yesNo,
  }),
  'F1-M21': template('F1-M21', {
    family: 'COMBO',
    determinant: 'TIMING_ORDER',
    window_profile: 'WALL_CLOCK',
    target_kind: 'AT_INSTANT',
    interruption_policy: 'VOID_IF_INTERRUPTED',
    sc_vsc: 'INHERIT_COMPATIBLE',
    red: 'INHERIT_COMPATIBLE',
    green_only: false,
    short_term: true,
    subject: 'DRIVER',
    lock_signal: 'INSTANT',
    required_capabilities: ['session_status', 'race_control'],
    optional_capabilities: ['location'],
    allowed_session_types: RACE,
    buildOutcomes: () => [outcome('BOTH_TRUE', 'f1.outcome.both_true'), outcome('NOT_BOTH', 'f1.outcome.not_both')],
  }),
};

export function getTemplate(id: MarketId): MarketTemplate {
  const t = CATALOG[id];
  if (!t) throw new Error(`Unknown market ${id}`);
  return t;
}

export function listTemplates(): MarketTemplate[] {
  return MARKET_IDS.map((id) => CATALOG[id]);
}

/** Template + combo-part capabilities (M21 parts add their own signals). */
export function requiredCapabilitiesFor(templ: MarketTemplate, params?: Pick<PoolParams, 'combo'>): Capability[] {
  const caps = new Set<Capability>(templ.required_capabilities);
  for (const part of params?.combo ?? []) for (const c of COMBO_PART_CAPABILITIES[part.kind]) caps.add(c);
  return [...caps];
}

export function isShortTerm(marketId: MarketId): boolean {
  return CATALOG[marketId].short_term;
}

/* ------------------------------------------------------------------ */
/* Card copy                                                           */
/* ------------------------------------------------------------------ */

export interface CopyRef {
  key: string;
  params: Record<string, string | number>;
}

export interface PoolCopy {
  title_key: string;
  question: CopyRef;
  anchor: CopyRef | null;
  rule: CopyRef;
  determinant_key: string;
  window_key: string;
  interruption_key: string;
  sc_vsc_key: string;
  red_key: string;
}

/**
 * i18n references for a pool card. Driver params hold driver ids — the UI
 * maps them to names (names are never machine-translated, F1-052). Params
 * named t1/t2/reference are integer milliseconds.
 */
export function describePool(pool: Pick<Pool, 'market_id' | 'subject' | 'target'>): PoolCopy {
  const t = CATALOG[pool.market_id];
  const p = pool.target.parameters;
  const params: Record<string, string | number> = {};
  if (pool.subject.driver_a) {
    params.driver = pool.subject.driver_a;
    params.driver_a = pool.subject.driver_a;
  }
  if (pool.subject.driver_b) params.driver_b = pool.subject.driver_b;
  if (p.target_lap !== undefined) params.lap = p.target_lap;
  if (p.segment_id) params.segment = p.segment_id;
  if (p.sector !== undefined) params.sector = p.sector;
  if (p.at_instant) params.at = p.at_instant;
  if (p.t1_ms !== undefined) params.t1 = p.t1_ms;
  if (p.t2_ms !== undefined) params.t2 = p.t2_ms;
  if (p.reference_time_ms !== undefined) params.reference = p.reference_time_ms;
  params.from = pool.target.not_before;
  params.to = pool.target.window_end;

  let anchor: CopyRef | null;
  switch (pool.market_id) {
    case 'F1-M01':
    case 'F1-M02':
      anchor =
        p.lap_anchor === 'DRIVER'
          ? { key: 'f1.anchor.driver_lap', params: { driver: params.driver ?? '', lap: params.lap ?? 0 } }
          : { key: 'f1.anchor.leader_lap', params: { lap: params.lap ?? 0 } };
      break;
    case 'F1-M11':
    case 'F1-M21':
      anchor = { key: 'f1.anchor.instant', params: { at: params.at ?? pool.target.window_end } };
      break;
    case 'F1-M08':
      anchor = { key: 'f1.anchor.next_lap', params: { driver: params.driver ?? '' } };
      break;
    case 'F1-M19':
      anchor = { key: 'f1.anchor.next_sector', params: { driver: params.driver ?? '', sector: params.sector ?? 0 } };
      break;
    case 'F1-M15':
    case 'F1-M16':
    case 'F1-M17':
      anchor = { key: 'f1.anchor.segment', params: { segment: params.segment ?? '' } };
      break;
    case 'F1-M13':
    case 'F1-M14':
    case 'F1-M18':
      anchor = { key: 'f1.anchor.session_final', params: {} };
      break;
    default:
      anchor = { key: 'f1.anchor.window', params: { from: params.from!, to: params.to! } };
  }

  return {
    title_key: t.title_key,
    question: { key: t.question_key, params },
    anchor,
    rule: { key: t.rule_key, params },
    determinant_key: `f1.determinant.${t.determinant.toLowerCase()}`,
    window_key: `f1.window.${t.window_profile.toLowerCase()}`,
    interruption_key: `f1.interruption.${t.interruption_policy.toLowerCase()}`,
    sc_vsc_key: `f1.neutralisation.${t.sc_vsc.toLowerCase()}`,
    red_key: `f1.red.${t.red.toLowerCase()}`,
  };
}
