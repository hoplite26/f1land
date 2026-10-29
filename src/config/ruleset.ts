/**
 * Versioned sporting ruleset configuration (F1-005, F1-006).
 *
 * Durations and elimination counts live here — never in JSX, translations or
 * animation timelines. A real session takes its durations and participants
 * from the confirmed session manifest; `buildSegments` produces the DEMO
 * manifest segments from this base configuration.
 */
import type { SegmentId, SegmentManifest, SessionType } from '@/domain/types';

const MIN = 60_000;

export interface SegmentRule {
  segment_id: SegmentId;
  duration_ms: number;
}

export interface QualifyingFormat {
  segments: readonly [SegmentRule, SegmentRule, SegmentRule];
  /** Planned pause after Q1/SQ1 and after Q2/SQ2. */
  gaps_ms: readonly [number, number];
}

export interface Ruleset {
  id: string;
  season: number;
  document: string;
  issue: string;
  published_on: string;
  source_url: string;
  qualifying: QualifyingFormat;
  sprint_qualifying: QualifyingFormat;
  /** Cars that reach the final part (Q3/SQ3). The first two parts eliminate (N − size) / 2 each. */
  final_part_size: number;
  /** Planned slot length used for DEMO manifests when no confirmed end time exists. */
  session_planned_duration_ms: Record<Exclude<SessionType, 'QUALIFYING' | 'SPRINT_QUALIFYING'>, number>;
  /** F1-007 — aero vocabulary of this ruleset. Overtake Mode needs its own confirmed signal. */
  aero_vocabulary: 'ACTIVE_AERO_2026' | 'DRS';
  overtake_mode_requires_confirmed_signal: boolean;
}

/** FIA 2026 F1 Sporting Regulations, Section B, Issue 09 (2026-10-01), B2.2.2 / B2.4.2. */
export const RULESET_2026_ISS09: Ruleset = {
  id: 'fia-2026-sb-iss09',
  season: 2026,
  document: 'FIA 2026 Formula 1 Regulations — Section B [Sporting]',
  issue: '09',
  published_on: '2026-10-01',
  source_url:
    'https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_b_sporting_-_iss_09_-_2026-10-01.pdf',
  qualifying: {
    segments: [
      { segment_id: 'Q1', duration_ms: 18 * MIN },
      { segment_id: 'Q2', duration_ms: 15 * MIN },
      { segment_id: 'Q3', duration_ms: 13 * MIN },
    ],
    gaps_ms: [7 * MIN, 8 * MIN],
  },
  sprint_qualifying: {
    segments: [
      { segment_id: 'SQ1', duration_ms: 12 * MIN },
      { segment_id: 'SQ2', duration_ms: 10 * MIN },
      { segment_id: 'SQ3', duration_ms: 8 * MIN },
    ],
    gaps_ms: [7 * MIN, 7 * MIN],
  },
  final_part_size: 10,
  session_planned_duration_ms: {
    PRACTICE: 60 * MIN,
    SPRINT: 60 * MIN,
    GRAND_PRIX: 120 * MIN,
  },
  aero_vocabulary: 'ACTIVE_AERO_2026',
  overtake_mode_requires_confirmed_signal: true,
};

export const RULESETS: Readonly<Record<string, Ruleset>> = {
  [RULESET_2026_ISS09.id]: RULESET_2026_ISS09,
};

export const DEFAULT_RULESET_VERSION = RULESET_2026_ISS09.id;

/** Replays must use the version frozen on the pool (F1-005); unknown versions are an error, never a fallback. */
export function getRuleset(version: string): Ruleset {
  const ruleset = RULESETS[version];
  if (!ruleset) throw new Error(`Unknown ruleset version: ${version}`);
  return ruleset;
}

export function qualifyingFormat(sessionType: SessionType, ruleset: Ruleset = RULESET_2026_ISS09): QualifyingFormat | null {
  if (sessionType === 'QUALIFYING') return ruleset.qualifying;
  if (sessionType === 'SPRINT_QUALIFYING') return ruleset.sprint_qualifying;
  return null;
}

/**
 * Cars eliminated after each part. With N cars the first two parts eliminate
 * (N − final_part_size) / 2 each (22 → 6, 6). For an odd remainder the first
 * part takes the extra car.
 */
export function eliminationPlan(participantsCount: number, ruleset: Ruleset = RULESET_2026_ISS09): [number, number, number] {
  const surplus = Math.max(0, participantsCount - ruleset.final_part_size);
  return [Math.ceil(surplus / 2), Math.floor(surplus / 2), 0];
}

export function segmentRule(segmentId: SegmentId, ruleset: Ruleset = RULESET_2026_ISS09): SegmentRule {
  const all = [...ruleset.qualifying.segments, ...ruleset.sprint_qualifying.segments];
  const rule = all.find((s) => s.segment_id === segmentId);
  if (!rule) throw new Error(`Unknown segment ${segmentId}`);
  return rule;
}

export function segmentDurationMs(segmentId: SegmentId, ruleset: Ruleset = RULESET_2026_ISS09): number {
  return segmentRule(segmentId, ruleset).duration_ms;
}

/** Index 0/1/2 of a segment inside its qualifying format. */
export function segmentIndex(segmentId: SegmentId): 0 | 1 | 2 {
  return (Number(segmentId.slice(-1)) - 1) as 0 | 1 | 2;
}

export function nextSegment(segmentId: SegmentId): SegmentId | null {
  const map: Partial<Record<SegmentId, SegmentId>> = { Q1: 'Q2', Q2: 'Q3', SQ1: 'SQ2', SQ2: 'SQ3' };
  return map[segmentId] ?? null;
}

/** Session type that owns a segment id. */
export function sessionTypeOfSegment(segmentId: SegmentId): 'QUALIFYING' | 'SPRINT_QUALIFYING' {
  return segmentId.startsWith('SQ') ? 'SPRINT_QUALIFYING' : 'QUALIFYING';
}

/** DEMO segment manifest for a qualifying-type session (empty for other session types). */
export function buildSegments(
  sessionType: SessionType,
  plannedStartIso: string,
  participantsCount: number,
  ruleset: Ruleset = RULESET_2026_ISS09,
): SegmentManifest[] {
  const format = qualifyingFormat(sessionType, ruleset);
  if (!format) return [];
  const elim = eliminationPlan(participantsCount, ruleset);
  let cursor = Date.parse(plannedStartIso);
  if (Number.isNaN(cursor)) throw new Error(`Invalid planned start: ${plannedStartIso}`);
  return format.segments.map((rule, i) => {
    const start = cursor;
    const end = start + rule.duration_ms;
    cursor = end + (i < 2 ? format.gaps_ms[i as 0 | 1] : 0);
    return {
      segment_id: rule.segment_id,
      duration_ms: rule.duration_ms,
      eliminated: elim[i] ?? 0,
      planned_start_at: new Date(start).toISOString(),
      planned_end_at: new Date(end).toISOString(),
    };
  });
}

/** Planned end of a session: last segment end for qualifying formats, slot length otherwise. */
export function plannedSessionEnd(
  sessionType: SessionType,
  plannedStartIso: string,
  participantsCount = 22,
  ruleset: Ruleset = RULESET_2026_ISS09,
): string {
  const segments = buildSegments(sessionType, plannedStartIso, participantsCount, ruleset);
  if (segments.length > 0) return segments[segments.length - 1]!.planned_end_at;
  const slot = ruleset.session_planned_duration_ms[sessionType as keyof Ruleset['session_planned_duration_ms']];
  return new Date(Date.parse(plannedStartIso) + slot).toISOString();
}

/** Cars that progress from `segmentId` into the next part, given the manifest segments. */
export function advancingCount(segments: readonly SegmentManifest[], segmentId: SegmentId, participantsCount: number): number {
  let remaining = participantsCount;
  for (const seg of segments) {
    if (seg.segment_id === segmentId) return remaining - seg.eliminated;
    remaining -= seg.eliminated;
  }
  return remaining;
}

/** Initial segment clock text, e.g. 13:00 for Q3 (F1-QA01). */
export function formatSegmentClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
