/**
 * Project profiles for game windows, lock buffers, deadlines and review
 * periods. Every value marked `demo: true` is a DEMO-contour decision of
 * Pulse Arena (SRS §12 note): it is not an FIA requirement, a provider
 * guarantee, or proof that information is not yet available to anyone.
 */
import type { MarketFamily, MarketId } from '@/domain/types';

/* ------------------------------------------------------------------ */
/* F1-021 — short pool window profiles                                 */
/* ------------------------------------------------------------------ */

export const DEMO_SHORT_WINDOW_PROFILES_MS = [30_000, 60_000, 120_000] as const;
export type ShortWindowMs = (typeof DEMO_SHORT_WINDOW_PROFILES_MS)[number];
export const DEFAULT_SHORT_WINDOW_MS: ShortWindowMs = 60_000;

/**
 * A profile is allowed only when it is at least `freshness_factor` times the
 * worst max-age/precision of the required signals: a degraded manifest can
 * therefore permit only the longer profiles (F1-021).
 */
export const SHORT_WINDOW_FRESHNESS_FACTOR = 20;

export function allowedShortWindowProfiles(worstMaxAgeMs: number, worstPrecisionMs = 0): ShortWindowMs[] {
  const floor = SHORT_WINDOW_FRESHNESS_FACTOR * Math.max(worstMaxAgeMs, worstPrecisionMs);
  return DEMO_SHORT_WINDOW_PROFILES_MS.filter((p) => p >= floor);
}

/** How long a DEMO pool stays open before closes_at. */
export const DEMO_POOL_OPEN_MS = 45_000;

/* ------------------------------------------------------------------ */
/* F1-017 — lock buffer                                                */
/* ------------------------------------------------------------------ */

export type LockSignal = 'LAP' | 'SECTOR' | 'PIT_VISIT' | 'WINDOW' | 'INSTANT' | 'SESSION';

export interface LockBufferProfile {
  id: string;
  demo: boolean;
  /** Measured delivery latency of the feed (occurred → published). */
  measured_latency_ms: number;
  /** Additional margin by signal character. */
  signal_margin_ms: Record<LockSignal, number>;
  note: string;
}

export const DEMO_LOCK_BUFFER_PROFILE: LockBufferProfile = {
  id: 'demo-lock-buffer-v1',
  demo: true,
  measured_latency_ms: 450,
  signal_margin_ms: { LAP: 1_500, SECTOR: 1_000, PIT_VISIT: 2_000, WINDOW: 1_000, INSTANT: 1_000, SESSION: 0 },
  note: 'DEMO only: production sizes the buffer from measured latency, timestamp precision and signal character.',
};

/** closes_at precedes the measured target start by this many ms. */
export function lockBufferMs(
  signal: LockSignal,
  timestampPrecisionMs = 10,
  profile: LockBufferProfile = DEMO_LOCK_BUFFER_PROFILE,
): number {
  return profile.measured_latency_ms + timestampPrecisionMs + profile.signal_margin_ms[signal];
}

/* ------------------------------------------------------------------ */
/* F1-067 — absolute settlement deadlines                              */
/* ------------------------------------------------------------------ */

export interface DeadlineProfile {
  id: string;
  /** Short windows: target.window_end + this. */
  short_window_ms: number;
  /** M04–M06: target.window_end + this. */
  pit_visit_ms: number;
  /** M08: target.window_end + this. */
  m08_ms: number;
  /** M19: target.window_end + this. */
  m19_ms: number;
  /** M13–M18: planned session/segment end + this. */
  session_final_ms: number;
  /** Snapshot at T: T + this. */
  snapshot_ms: number;
}

export const DEADLINE_PROFILE: DeadlineProfile = {
  id: 'f1-deadline-v1',
  short_window_ms: 120_000,
  pit_visit_ms: 180_000,
  m08_ms: 600_000,
  m19_ms: 120_000,
  session_final_ms: 24 * 60 * 60 * 1000,
  snapshot_ms: 120_000,
};

/* ------------------------------------------------------------------ */
/* F1-054 — review period before a result becomes final                */
/* ------------------------------------------------------------------ */

export interface ReviewProfile {
  id: string;
  demo: boolean;
  default_ms: number;
  by_family: Partial<Record<MarketFamily, number>>;
}

export const DEMO_REVIEW_PROFILE: ReviewProfile = {
  id: 'demo-review-v1',
  demo: true,
  default_ms: 15_000,
  by_family: { CLASSIFICATION: 60_000, QUALIFYING: 30_000, PACE: 20_000 },
};

export function reviewPeriodMs(family: MarketFamily, profile: ReviewProfile = DEMO_REVIEW_PROFILE): number {
  return profile.by_family[family] ?? profile.default_ms;
}

/* ------------------------------------------------------------------ */
/* F1-031 / F1-027 — DEMO thresholds frozen at pool creation           */
/* ------------------------------------------------------------------ */

export interface BucketThresholds {
  t1_ms: number;
  t2_ms: number;
}

/** DEMO: M05 buckets [0,2500), [2500,3000), [3000,∞); M06 whole-visit buckets. */
export const DEMO_PIT_THRESHOLDS: Readonly<Partial<Record<MarketId, BucketThresholds>>> = {
  'F1-M05': { t1_ms: 2_500, t2_ms: 3_000 },
  'F1-M06': { t1_ms: 21_000, t2_ms: 24_000 },
};

/** DEMO: after a qualifying part's chequered flag, laps already started may still complete (M16). */
export const DEMO_SEGMENT_RUNOUT_MS = 180_000;
