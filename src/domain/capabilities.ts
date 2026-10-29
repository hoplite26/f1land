/**
 * Capability matrix (F1-009, F1-010, F1-032).
 *
 * A market is available only when every required capability is published as
 * `true` AND its quality level is SUPPORTED. DEGRADED never counts as
 * available for a market that requires it. Losing a required signal suspends
 * only the pools whose templates require that signal.
 */
import type { Capability, CapabilityManifest, CapabilityQuality, Pool, QualityLevel, QualityProfile, SessionManifest } from './types';
import type { MarketTemplate } from './markets/catalog';

export const ALL_CAPABILITIES: readonly Capability[] = [
  'session_status',
  'timing_order',
  'final_classification',
  'laps',
  'sectors',
  'occupancy',
  'pit_entry_exit',
  'stationary_stop',
  'tyre_stints',
  'race_control',
  'location',
  'on_track_pass',
  'retirement',
  'qualifying_progression',
  'aero_mode',
];

export const DEMO_VALIDATION_SUITE = 'f1-demo-validation-v1';

export function capabilityLevel(
  manifest: Pick<SessionManifest, 'capabilities' | 'quality'>,
  cap: Capability,
): QualityLevel {
  if (!manifest.capabilities[cap]) return 'UNAVAILABLE';
  return manifest.quality[cap]?.level ?? 'SUPPORTED';
}

/** Supported = boolean true and SUPPORTED quality, and not currently lost. */
export function isCapabilitySupported(
  manifest: Pick<SessionManifest, 'capabilities' | 'quality'>,
  cap: Capability,
  signalsLost: readonly Capability[] = [],
): boolean {
  return capabilityLevel(manifest, cap) === 'SUPPORTED' && !signalsLost.includes(cap);
}

export interface MarketAvailability {
  available: boolean;
  /** Required capabilities that are UNAVAILABLE or lost. */
  missing: Capability[];
  /** Required capabilities that are only DEGRADED. */
  degraded: Capability[];
  session_type_allowed: boolean;
  reason_key: string | null;
}

export function marketAvailability(
  template: Pick<MarketTemplate, 'required_capabilities' | 'allowed_session_types'>,
  manifest: Pick<SessionManifest, 'capabilities' | 'quality' | 'session_type'>,
  signalsLost: readonly Capability[] = [],
  extraRequired: readonly Capability[] = [],
): MarketAvailability {
  const required = [...new Set([...template.required_capabilities, ...extraRequired])];
  const missing: Capability[] = [];
  const degraded: Capability[] = [];
  for (const cap of required) {
    const level = capabilityLevel(manifest, cap);
    if (level === 'UNAVAILABLE' || signalsLost.includes(cap)) missing.push(cap);
    else if (level === 'DEGRADED') degraded.push(cap);
  }
  const sessionOk = template.allowed_session_types.includes(manifest.session_type);
  const available = sessionOk && missing.length === 0 && degraded.length === 0;
  return {
    available,
    missing,
    degraded,
    session_type_allowed: sessionOk,
    reason_key: available
      ? null
      : !sessionOk
        ? 'f1.availability.session_type'
        : missing.length > 0
          ? 'f1.availability.missing_signal'
          : 'f1.availability.degraded_signal',
  };
}

export function isMarketAvailable(
  template: Pick<MarketTemplate, 'required_capabilities' | 'allowed_session_types'>,
  manifest: Pick<SessionManifest, 'capabilities' | 'quality' | 'session_type'>,
  signalsLost: readonly Capability[] = [],
): boolean {
  return marketAvailability(template, manifest, signalsLost).available;
}

/** F1-010 — pools whose template requires a lost signal (only these are suspended). */
export function affectedPools<P extends Pick<Pool, 'market_id'>>(
  pools: readonly P[],
  lost: readonly Capability[],
  requiredOf: (marketId: Pool['market_id']) => readonly Capability[],
): P[] {
  if (lost.length === 0) return [];
  return pools.filter((p) => requiredOf(p.market_id).some((c) => lost.includes(c)));
}

/* ------------------------------------------------------------------ */
/* DEMO manifests                                                      */
/* ------------------------------------------------------------------ */

export interface DemoCapabilityOptions {
  degraded?: readonly Capability[];
  unavailable?: readonly Capability[];
  coverage_from?: string | null;
  max_age_ms?: number;
  timestamp_precision_ms?: number;
}

/**
 * DEMO capability manifest + F1 quality profile. aero_mode is UNAVAILABLE by
 * default: Overtake Mode is shown only from a separate confirmed signal (F1-007).
 */
export function buildDemoCapabilities(opts: DemoCapabilityOptions = {}): {
  capabilities: CapabilityManifest;
  quality: QualityProfile;
} {
  const unavailable = new Set<Capability>(opts.unavailable ?? ['aero_mode']);
  const degraded = new Set<Capability>(opts.degraded ?? []);
  const capabilities = {} as CapabilityManifest;
  const quality = {} as QualityProfile;
  for (const cap of ALL_CAPABILITIES) {
    const level: QualityLevel = unavailable.has(cap) ? 'UNAVAILABLE' : degraded.has(cap) ? 'DEGRADED' : 'SUPPORTED';
    // The boolean manifest says "published"; DEGRADED stays published but never satisfies a market.
    capabilities[cap] = level !== 'UNAVAILABLE';
    const q: CapabilityQuality = {
      level,
      coverage_from: level === 'UNAVAILABLE' ? null : (opts.coverage_from ?? null),
      max_age_ms: level === 'DEGRADED' ? 4 * (opts.max_age_ms ?? 1_000) : (opts.max_age_ms ?? 1_000),
      timestamp_precision_ms: level === 'DEGRADED' ? 250 : (opts.timestamp_precision_ms ?? 10),
      validation_suite_version: DEMO_VALIDATION_SUITE,
    };
    quality[cap] = q;
  }
  return { capabilities, quality };
}

export function fullDemoCapabilities(coverageFrom: string | null = null) {
  return buildDemoCapabilities({ coverage_from: coverageFrom });
}

export function degradedDemoCapabilities(degraded: readonly Capability[], unavailable: readonly Capability[] = ['aero_mode']) {
  return buildDemoCapabilities({ degraded, unavailable });
}
