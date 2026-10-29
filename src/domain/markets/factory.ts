/**
 * Pool creation and template validation (F1-005, F1-016, F1-017, F1-021,
 * F1-027, F1-035, F1-036, F1-066, F1-067, F1-QA27).
 */
import {
  DEFAULT_SHORT_WINDOW_MS,
  DEMO_POOL_OPEN_MS,
  allowedShortWindowProfiles,
  lockBufferMs,
} from '@/config/profiles';
import { capabilityLevel, marketAvailability } from '../capabilities';
import { checksum } from '../events/checksum';
import type { Capability, MarketId, Pool, SegmentId, SessionManifest, TargetParameters, TargetSpec } from '../types';
import { computeSettlementDeadline, toIso, toMs } from '../windows';
import {
  CATALOG,
  COMBO_PAIRS,
  COMPOUNDS,
  POSITION_GROUPS,
  requiredCapabilitiesFor,
  thresholdsFor,
  type MarketTemplate,
  type PoolParams,
} from './catalog';

export interface PoolTiming {
  /** Server time of creation (never the device clock). */
  created_at: string;
  opens_at: string;
  closes_at: string;
  /** Target bounds; derived from the manifest/segment for SESSION and from at_instant for AT_INSTANT when omitted. */
  not_before?: string;
  window_end?: string;
  /** Explicit planned end for M13–M18 when the manifest has none. */
  planned_end_at?: string | null;
  /** Explicit absolute UTC cutoff when no planned time exists (F1-067). */
  explicit_cutoff?: string | null;
  pool_id?: string;
}

export type ValidationCode =
  | 'SESSION_TYPE_NOT_ALLOWED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'DRIVER_REQUIRED'
  | 'DRIVER_UNKNOWN'
  | 'DRIVERS_MUST_DIFFER'
  | 'TARGET_LAP_REQUIRED'
  | 'LAP_ANCHOR_REQUIRED'
  | 'LEADER_ANCHOR_REQUIRED'
  | 'THRESHOLDS_REQUIRED'
  | 'THRESHOLDS_INVALID'
  | 'REFERENCE_REQUIRED'
  | 'SECTOR_REQUIRED'
  | 'SEGMENT_REQUIRED'
  | 'SEGMENT_NOT_ALLOWED'
  | 'SEGMENT_NOT_IN_SESSION'
  | 'M15_NO_NEXT_SEGMENT'
  | 'M16_MUST_CLOSE_BEFORE_SEGMENT'
  | 'SEGMENT_ALREADY_DECIDED'
  | 'ADMITTED_REQUIRED'
  | 'COMBO_REQUIRED'
  | 'COMBO_PAIR_NOT_ALLOWED'
  | 'COMBO_VALUE_INVALID'
  | 'COMBO_SUBJECT_MISMATCH'
  | 'INSTANT_REQUIRED'
  | 'TIMING_INVALID'
  | 'CLOSES_AFTER_TARGET_START'
  | 'WINDOW_INVALID'
  | 'WINDOW_PROFILE_NOT_ALLOWED'
  | 'NO_FINITE_DEADLINE'
  | 'TIE_PROFILE_INVALID';

export interface ValidationIssue {
  code: ValidationCode;
  message_key: string;
  params?: Record<string, string | number>;
}

export type ValidationResult = { ok: true; issues: [] } | { ok: false; issues: ValidationIssue[] };

export class PoolValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(marketId: MarketId, issues: ValidationIssue[]) {
    super(`${marketId}: ${issues.map((i) => i.code).join(', ')}`);
    this.name = 'PoolValidationError';
    this.issues = issues;
  }
}

const issue = (code: ValidationCode, params?: Record<string, string | number>): ValidationIssue => ({
  code,
  message_key: `f1.validation.${code.toLowerCase()}`,
  ...(params ? { params } : {}),
});

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

function segmentOf(manifest: SessionManifest, id: SegmentId | undefined) {
  return id ? manifest.segments?.find((s) => s.segment_id === id) : undefined;
}

/** Target bounds after applying template defaults (SESSION → manifest/segment, AT_INSTANT → at_instant). */
export function resolveTargetBounds(
  templ: MarketTemplate,
  params: PoolParams,
  manifest: SessionManifest,
  timing: PoolTiming,
): { not_before: string | undefined; window_end: string | undefined; planned_end: string | null } {
  if (templ.target_kind === 'SESSION') {
    const seg = segmentOf(manifest, params.segment_id);
    const plannedStart = seg?.planned_start_at ?? manifest.planned_start_at;
    const plannedEnd = timing.planned_end_at ?? seg?.planned_end_at ?? manifest.planned_end_at ?? null;
    return {
      not_before: timing.not_before ?? plannedStart,
      window_end: timing.window_end ?? plannedEnd ?? undefined,
      planned_end: plannedEnd,
    };
  }
  if (templ.target_kind === 'AT_INSTANT') {
    const at = params.at_instant ?? timing.window_end;
    return { not_before: timing.not_before ?? timing.closes_at, window_end: at, planned_end: null };
  }
  return { not_before: timing.not_before, window_end: timing.window_end, planned_end: null };
}

function validateCombo(params: PoolParams, manifest: SessionManifest, out: ValidationIssue[]): void {
  const combo = params.combo;
  if (!combo || combo.length !== 2) {
    out.push(issue('COMBO_REQUIRED'));
    return;
  }
  const [a, b] = combo;
  const allowed = COMBO_PAIRS.some(([x, y]) => (a.kind === x && b.kind === y) || (a.kind === y && b.kind === x));
  if (!allowed) out.push(issue('COMBO_PAIR_NOT_ALLOWED', { first: a.kind, second: b.kind }));
  if (a.driver_id !== b.driver_id) out.push(issue('COMBO_SUBJECT_MISMATCH'));
  if (params.driver_a && a.driver_id !== params.driver_a) out.push(issue('COMBO_SUBJECT_MISMATCH'));
  for (const part of combo) {
    if (!manifest.participants.includes(part.driver_id)) out.push(issue('DRIVER_UNKNOWN', { driver: part.driver_id }));
    let ok = true;
    switch (part.kind) {
      case 'POSITION_GROUP':
        ok = (POSITION_GROUPS as readonly string[]).includes(part.value);
        break;
      case 'TYRE_COMPOUND':
        ok = (COMPOUNDS as readonly string[]).includes(part.value);
        break;
      case 'AHEAD_OF':
        ok = manifest.participants.includes(part.value) && part.value !== part.driver_id;
        break;
      case 'ON_TRACK':
        ok = part.value === 'true';
        break;
      case 'SECTOR':
        ok = ['1', '2', '3'].includes(part.value);
        break;
    }
    if (!ok) out.push(issue('COMBO_VALUE_INVALID', { kind: part.kind, value: part.value }));
  }
}

/** M21's subject is the driver of its combo parts. */
function normalizeParams(marketId: MarketId, params: PoolParams): PoolParams {
  if (marketId === 'F1-M21' && !params.driver_a && params.combo?.[0]) return { ...params, driver_a: params.combo[0].driver_id };
  return params;
}

export function validatePoolTemplate(
  marketId: MarketId,
  rawParams: PoolParams,
  manifest: SessionManifest,
  timing: PoolTiming,
): ValidationResult {
  const params = normalizeParams(marketId, rawParams);
  const templ = CATALOG[marketId];
  const out: ValidationIssue[] = [];

  if (!templ.allowed_session_types.includes(manifest.session_type)) {
    out.push(issue('SESSION_TYPE_NOT_ALLOWED', { session_type: manifest.session_type }));
  }

  // F1-009/010 — every required capability must be SUPPORTED (DEGRADED is not enough).
  const required = requiredCapabilitiesFor(templ, params);
  const availability = marketAvailability({ ...templ, required_capabilities: required }, manifest);
  for (const cap of [...availability.missing, ...availability.degraded]) {
    out.push(issue('CAPABILITY_UNAVAILABLE', { capability: cap, level: capabilityLevel(manifest, cap) }));
  }

  // Subjects
  if (templ.subject === 'DRIVER' || templ.subject === 'DUEL') {
    if (!params.driver_a) out.push(issue('DRIVER_REQUIRED', { role: 'A' }));
    else if (!manifest.participants.includes(params.driver_a)) out.push(issue('DRIVER_UNKNOWN', { driver: params.driver_a }));
  }
  if (templ.subject === 'DUEL') {
    if (!params.driver_b) out.push(issue('DRIVER_REQUIRED', { role: 'B' }));
    else if (!manifest.participants.includes(params.driver_b)) out.push(issue('DRIVER_UNKNOWN', { driver: params.driver_b }));
    if (params.driver_a && params.driver_a === params.driver_b) out.push(issue('DRIVERS_MUST_DIFFER'));
  }

  // Market-specific parameters
  switch (marketId) {
    case 'F1-M01':
    case 'F1-M02':
      if (!isPositiveInt(params.target_lap)) out.push(issue('TARGET_LAP_REQUIRED'));
      // F1-018: the anchor must say whose crossing defines the lap.
      if (!params.lap_anchor) out.push(issue('LAP_ANCHOR_REQUIRED'));
      if (marketId === 'F1-M02' && params.lap_anchor === 'DRIVER') out.push(issue('LEADER_ANCHOR_REQUIRED'));
      break;
    case 'F1-M05':
    case 'F1-M06':
    case 'F1-M19': {
      const t = marketId === 'F1-M19' ? (params.t1_ms !== undefined && params.t2_ms !== undefined ? { t1: params.t1_ms, t2: params.t2_ms } : null) : thresholdsFor(marketId, params);
      if (!t) out.push(issue('THRESHOLDS_REQUIRED'));
      else if (!isPositiveInt(t.t1) || !isPositiveInt(t.t2) || t.t1 >= t.t2) out.push(issue('THRESHOLDS_INVALID'));
      if (marketId === 'F1-M19' && !params.sector) out.push(issue('SECTOR_REQUIRED'));
      break;
    }
    case 'F1-M08':
      if (!isPositiveInt(params.reference_time_ms)) out.push(issue('REFERENCE_REQUIRED'));
      break;
    case 'F1-M11':
      if (!params.at_instant && !timing.window_end) out.push(issue('INSTANT_REQUIRED'));
      break;
    case 'F1-M12':
      if (params.tie_profile) {
        const tp = params.tie_profile;
        if (!isPositiveInt(tp.tie_precision_ms) || Number.isNaN(toMs(tp.tie_origin_at))) out.push(issue('TIE_PROFILE_INVALID'));
      }
      break;
    case 'F1-M21':
      if (!params.at_instant && !timing.window_end) out.push(issue('INSTANT_REQUIRED'));
      validateCombo(params, manifest, out);
      break;
    default:
      break;
  }

  // Qualifying segments (F1-035, F1-066, QA27)
  if (templ.allowed_segments) {
    const seg = params.segment_id;
    if (!seg) out.push(issue('SEGMENT_REQUIRED'));
    else {
      if (!templ.allowed_segments.includes(seg)) {
        out.push(issue(marketId === 'F1-M15' ? 'M15_NO_NEXT_SEGMENT' : 'SEGMENT_NOT_ALLOWED', { segment: seg }));
      }
      const owner = seg.startsWith('SQ') ? 'SPRINT_QUALIFYING' : 'QUALIFYING';
      if (owner !== manifest.session_type || (manifest.segments && !segmentOf(manifest, seg))) {
        out.push(issue('SEGMENT_NOT_IN_SESSION', { segment: seg }));
      }
      const m = segmentOf(manifest, seg);
      if (m) {
        if (marketId === 'F1-M16' && toMs(timing.closes_at) > toMs(m.planned_start_at)) {
          out.push(issue('M16_MUST_CLOSE_BEFORE_SEGMENT', { segment: seg }));
        }
        if (toMs(timing.closes_at) >= toMs(m.planned_end_at)) out.push(issue('SEGMENT_ALREADY_DECIDED', { segment: seg }));
      }
    }
  }
  if (marketId === 'F1-M17') {
    const admitted = params.admitted ?? [];
    if (admitted.length === 0) out.push(issue('ADMITTED_REQUIRED'));
    for (const d of admitted) if (!manifest.participants.includes(d)) out.push(issue('DRIVER_UNKNOWN', { driver: d }));
  }

  // Timing (F1-016, F1-017)
  const opens = toMs(timing.opens_at);
  const closes = toMs(timing.closes_at);
  const created = toMs(timing.created_at);
  if ([opens, closes, created].some(Number.isNaN) || opens >= closes) out.push(issue('TIMING_INVALID'));
  const bounds = resolveTargetBounds(templ, params, manifest, timing);
  const nb = bounds.not_before ? toMs(bounds.not_before) : NaN;
  const we = bounds.window_end ? toMs(bounds.window_end) : NaN;
  if (Number.isNaN(nb) || Number.isNaN(we)) out.push(issue('WINDOW_INVALID'));
  else {
    if (templ.target_kind === 'AT_INSTANT' ? we < nb : we <= nb) out.push(issue('WINDOW_INVALID'));
    // Short questions close before the measured target begins; session-final ones before the planned end.
    if (templ.target_kind !== 'SESSION' && closes > nb) out.push(issue('CLOSES_AFTER_TARGET_START'));
    if (templ.target_kind === 'SESSION' && closes >= we) out.push(issue('CLOSES_AFTER_TARGET_START'));
  }

  // F1-021 — DEMO short window profiles; a degraded manifest allows only longer ones.
  if (params.window_profile_ms !== undefined) {
    const worst = required.reduce(
      (acc, cap: Capability) => {
        const q = manifest.quality[cap];
        return q ? { age: Math.max(acc.age, q.max_age_ms), precision: Math.max(acc.precision, q.timestamp_precision_ms) } : acc;
      },
      { age: 0, precision: 0 },
    );
    const allowed = allowedShortWindowProfiles(worst.age, worst.precision) as number[];
    if (!allowed.includes(params.window_profile_ms)) {
      out.push(issue('WINDOW_PROFILE_NOT_ALLOWED', { profile_ms: params.window_profile_ms }));
    } else if (!Number.isNaN(nb) && !Number.isNaN(we) && templ.target_kind !== 'AT_INSTANT' && we - nb !== params.window_profile_ms) {
      out.push(issue('WINDOW_PROFILE_NOT_ALLOWED', { profile_ms: params.window_profile_ms }));
    }
  }

  // F1-067 — a finite absolute settlement deadline must exist before OPEN.
  if (!Number.isNaN(nb) && !Number.isNaN(we)) {
    const deadline =
      computeSettlementDeadline(
        marketId,
        { kind: templ.target_kind, not_before: bounds.not_before!, window_end: bounds.window_end!, parameters: { interruption_policy: templ.interruption_policy, at_instant: params.at_instant ?? (templ.target_kind === 'AT_INSTANT' ? bounds.window_end : undefined) } },
        bounds.planned_end,
      ) ?? timing.explicit_cutoff ?? null;
    if (!deadline || Number.isNaN(toMs(deadline))) out.push(issue('NO_FINITE_DEADLINE'));
  }

  return out.length === 0 ? { ok: true, issues: [] } : { ok: false, issues: out };
}

function buildParameters(templ: MarketTemplate, params: PoolParams, windowEnd: string): TargetParameters {
  const p: TargetParameters = { interruption_policy: templ.interruption_policy };
  if (templ.green_only) p.green_only = true;
  if (params.lap_anchor) p.lap_anchor = params.lap_anchor;
  if (params.target_lap !== undefined) p.target_lap = params.target_lap;
  if (params.segment_id) p.segment_id = params.segment_id;
  if (params.sector !== undefined) p.sector = params.sector;
  if (params.reference_time_ms !== undefined) {
    p.reference_time_ms = params.reference_time_ms;
    p.threshold_units = 'ms';
  }
  if (params.reference_attempt_id) p.reference_attempt_id = params.reference_attempt_id;
  if (templ.id === 'F1-M05' || templ.id === 'F1-M06' || templ.id === 'F1-M19') {
    const t = templ.id === 'F1-M19' ? { t1: params.t1_ms!, t2: params.t2_ms! } : thresholdsFor(templ.id, params)!;
    p.t1_ms = t.t1;
    p.t2_ms = t.t2;
    p.threshold_units = 'ms';
  }
  if (templ.target_kind === 'AT_INSTANT') p.at_instant = params.at_instant ?? windowEnd;
  if (params.tie_profile) p.tie_profile = { ...params.tie_profile };
  if (params.simultaneous_source_group) p.simultaneous_source_group = true;
  if (params.window_profile_ms !== undefined) p.window_profile_ms = params.window_profile_ms;
  if (params.combo) p.combo = [{ ...params.combo[0] }, { ...params.combo[1] }];
  return p;
}

/**
 * Creates a validated pool. Versions come from the manifest (F1-005);
 * thresholds/reference are frozen (F1-027); the absolute settlement deadline
 * is fixed now (F1-067). Status is OPEN when created_at ≥ opens_at, else SCHEDULED.
 * Throws PoolValidationError with every issue found.
 */
export function createPool(marketId: MarketId, rawParams: PoolParams, manifest: SessionManifest, timing: PoolTiming): Pool {
  const params = normalizeParams(marketId, rawParams);
  const result = validatePoolTemplate(marketId, params, manifest, timing);
  if (!result.ok) throw new PoolValidationError(marketId, result.issues);
  const templ = CATALOG[marketId];
  const bounds = resolveTargetBounds(templ, params, manifest, timing);
  const parameters = buildParameters(templ, params, bounds.window_end!);
  const target: TargetSpec = {
    kind: templ.target_kind,
    not_before: toIso(toMs(bounds.not_before!)),
    window_end: toIso(toMs(bounds.window_end!)),
    parameters,
  };
  const deadline = computeSettlementDeadline(marketId, target, bounds.planned_end) ?? timing.explicit_cutoff!;
  const subject: Pool['subject'] = {};
  if (params.driver_a) subject.driver_a = params.driver_a;
  if (params.driver_b) subject.driver_b = params.driver_b;
  else if (params.combo?.some((c) => c.kind === 'AHEAD_OF')) subject.driver_b = params.combo.find((c) => c.kind === 'AHEAD_OF')!.value;

  const pool_id =
    timing.pool_id ??
    `${manifest.session_id}-${marketId.slice(3).toLowerCase()}-${checksum({ params, closes: timing.closes_at, nb: target.not_before }).slice(-10)}`;

  return {
    season: manifest.season,
    meeting_id: manifest.meeting_id,
    session_id: manifest.session_id,
    session_type: manifest.session_type,
    circuit_layout_version: manifest.circuit_layout_version,
    ruleset_version: manifest.ruleset_version,
    provider_schema_version: manifest.provider_schema_version,
    template_version: templ.template_version,
    pool_id,
    version: 1,
    market_id: marketId,
    status: toMs(timing.created_at) >= toMs(timing.opens_at) ? 'OPEN' : 'SCHEDULED',
    intake_status: 'ACCEPTING',
    suspend_reason: null,
    created_at: toIso(toMs(timing.created_at)),
    opens_at: toIso(toMs(timing.opens_at)),
    closes_at: toIso(toMs(timing.closes_at)),
    target,
    settlement_deadline: toIso(toMs(deadline)),
    subject,
    outcomes: templ.buildOutcomes(params, manifest),
    settlement: null,
    settlement_history: [],
  };
}

export interface PlanTimingOptions {
  /** Short window length (DEMO 30/60/120 s). */
  windowMs?: number;
  /** How long the pool accepts entries. */
  openForMs?: number;
  /** Snapshot instant for AT_INSTANT markets; defaults to window end. */
  atInstantMs?: number;
  segmentId?: SegmentId;
}

/**
 * Suggested DEMO timing: open now, close after `openForMs`, then the lock
 * buffer (F1-017), then the target window. Session-final markets use the
 * manifest/segment plan (M16 closes no later than the segment start).
 */
export function planPoolTiming(
  marketId: MarketId,
  nowMs: number,
  manifest: SessionManifest,
  opts: PlanTimingOptions = {},
): PoolTiming {
  const templ = CATALOG[marketId];
  const openFor = opts.openForMs ?? DEMO_POOL_OPEN_MS;
  const windowMs = opts.windowMs ?? DEFAULT_SHORT_WINDOW_MS;
  const created_at = toIso(nowMs);
  if (templ.target_kind === 'SESSION') {
    const seg = segmentOf(manifest, opts.segmentId);
    const start = toMs(seg?.planned_start_at ?? manifest.planned_start_at);
    const end = toMs(seg?.planned_end_at ?? manifest.planned_end_at);
    let closes = nowMs + openFor;
    if (marketId === 'F1-M16') closes = Math.min(closes, start);
    else closes = Math.min(closes, end - 1);
    return { created_at, opens_at: created_at, closes_at: toIso(closes) };
  }
  const precision = Math.max(
    0,
    ...templ.required_capabilities.map((c) => manifest.quality[c]?.timestamp_precision_ms ?? 0),
  );
  const closes = nowMs + openFor;
  const notBefore = closes + lockBufferMs(templ.lock_signal, precision);
  if (templ.target_kind === 'AT_INSTANT') {
    const at = opts.atInstantMs ?? notBefore + windowMs;
    return { created_at, opens_at: created_at, closes_at: toIso(closes), not_before: toIso(notBefore), window_end: toIso(at) };
  }
  return {
    created_at,
    opens_at: created_at,
    closes_at: toIso(closes),
    not_before: toIso(notBefore),
    window_end: toIso(notBefore + windowMs),
  };
}
