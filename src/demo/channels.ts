import type { Capability, CapabilityManifest, QualityProfile, SessionManifest, SessionType } from '@/domain/types';
import { DRIVERS } from '@/data/teams';
import { buildSegments, DEFAULT_RULESET_VERSION, plannedSessionEnd } from '@/config/ruleset';
import type { RaceScenario } from '@/sim/raceSim';

/**
 * DEMO contour broadcast channels. Each channel loops deterministic
 * sessions (seed per cycle), so every viewer sees the same race state.
 */
export interface DemoChannel {
  id: string;
  circuitId: string;
  meetingRound: number;
  sessionType: SessionType;
  laps?: number;
  title: { ru: string; en: string };
  /** Offset of the loop so channels are at different phases. */
  offsetMin: number;
  scenario?: RaceScenario;
  featured?: boolean;
  /** Fewer laps than the full distance for a watchable DEMO cycle. */
  demoLaps?: number;
}

export const CHANNELS: DemoChannel[] = [
  { id: 'mx-gp', circuitId: 'mx-1962', meetingRound: 20, sessionType: 'GRAND_PRIX', demoLaps: 34, title: { ru: 'Гран-при Мехико', en: 'Mexico City Grand Prix' }, offsetMin: 0, featured: true, scenario: { incidentRate: 1.6 } },
  { id: 'ae-gp', circuitId: 'ae-2009', meetingRound: 24, sessionType: 'GRAND_PRIX', demoLaps: 30, title: { ru: 'Гран-при Абу-Даби', en: 'Abu Dhabi Grand Prix' }, offsetMin: 17, scenario: { incidentRate: 1.4 } },
  { id: 'mc-gp', circuitId: 'mc-1929', meetingRound: 8, sessionType: 'GRAND_PRIX', demoLaps: 36, title: { ru: 'Гран-при Монако', en: 'Monaco Grand Prix' }, offsetMin: 29, scenario: { incidentRate: 1.8 } },
  { id: 'jp-q', circuitId: 'jp-1962', meetingRound: 3, sessionType: 'QUALIFYING', title: { ru: 'Гран-при Японии · Квалификация', en: 'Japanese GP · Qualifying' }, offsetMin: 8 },
  { id: 'gb-sprint', circuitId: 'gb-1948', meetingRound: 11, sessionType: 'SPRINT', title: { ru: 'Гран-при Великобритании · Спринт', en: 'British GP · Sprint' }, offsetMin: 4, scenario: { incidentRate: 1.2 } },
  { id: 'lv-gp', circuitId: 'us-2023', meetingRound: 22, sessionType: 'GRAND_PRIX', demoLaps: 28, title: { ru: 'Гран-при Лас-Вегаса', en: 'Las Vegas Grand Prix' }, offsetMin: 41, scenario: { incidentRate: 1.5 } },
  { id: 'it-gp', circuitId: 'it-1922', meetingRound: 15, sessionType: 'GRAND_PRIX', demoLaps: 30, title: { ru: 'Гран-при Италии', en: 'Italian Grand Prix' }, offsetMin: 23 },
  { id: 'bh-sq', circuitId: 'cn-2004', meetingRound: 2, sessionType: 'SPRINT_QUALIFYING', title: { ru: 'Гран-при Китая · Спринт-квалификация', en: 'Chinese GP · Sprint Qualifying' }, offsetMin: 12 },
];

export function getChannel(id: string): DemoChannel {
  const c = CHANNELS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown channel ${id}`);
  return c;
}

const ALL_CAPS: Capability[] = [
  'session_status', 'timing_order', 'final_classification', 'laps', 'sectors', 'occupancy', 'pit_entry_exit',
  'stationary_stop', 'tyre_stints', 'race_control', 'location', 'on_track_pass', 'retirement', 'qualifying_progression', 'aero_mode',
];

export function demoCapabilities(sessionType: SessionType): { capabilities: CapabilityManifest; quality: QualityProfile } {
  const quali = sessionType === 'QUALIFYING' || sessionType === 'SPRINT_QUALIFYING' || sessionType === 'PRACTICE';
  const capabilities = Object.fromEntries(
    ALL_CAPS.map((c) => [c, quali ? !['pit_entry_exit', 'stationary_stop', 'tyre_stints', 'on_track_pass', 'retirement'].includes(c) : c !== 'qualifying_progression']),
  ) as CapabilityManifest;
  const quality = Object.fromEntries(
    ALL_CAPS.map((c) => [
      c,
      {
        level: capabilities[c] ? 'SUPPORTED' : 'UNAVAILABLE',
        coverage_from: null,
        max_age_ms: c === 'location' ? 1500 : 1000,
        timestamp_precision_ms: 10,
        validation_suite_version: 'demo-sim-1',
      },
    ]),
  ) as QualityProfile;
  return { capabilities, quality };
}

/** Planned length of one DEMO cycle (session + break) in ms. */
export function cycleLengthMs(ch: DemoChannel, lapTimeSec: number): number {
  if (ch.sessionType === 'QUALIFYING' || ch.sessionType === 'SPRINT_QUALIFYING') {
    const segs = buildSegments(ch.sessionType, new Date(0).toISOString(), 22);
    const end = Date.parse(segs[segs.length - 1]!.planned_end_at);
    return end + 5 * 60_000;
  }
  const laps = channelLaps(ch, 0);
  return Math.round((20 + laps * lapTimeSec * 1.04 + 240) * 1000);
}

export function channelLaps(ch: DemoChannel, circuitLaps: number, sprintLaps?: number): number {
  if (ch.sessionType === 'SPRINT') return sprintLaps ?? ch.laps ?? 17;
  return ch.demoLaps ?? ch.laps ?? circuitLaps;
}

export function cycleIndex(ch: DemoChannel, nowMs: number, cycleMs: number): number {
  return Math.floor((nowMs - ch.offsetMin * 60_000) / cycleMs);
}

export function cycleStartMs(ch: DemoChannel, index: number, cycleMs: number): number {
  return index * cycleMs + ch.offsetMin * 60_000;
}

export function buildManifest(ch: DemoChannel, cycle: number, startMs: number, circuitLayout: string, laps: number | undefined): SessionManifest {
  const sid = `demo-${ch.id}-${cycle}`;
  const startIso = new Date(startMs).toISOString();
  const segments = buildSegments(ch.sessionType, startIso, DRIVERS.length);
  const { capabilities, quality } = demoCapabilities(ch.sessionType);
  return {
    session_id: sid,
    event_id: `event_${sid.replace(/-/g, '_')}`,
    meeting_id: `2026-${String(ch.meetingRound).padStart(2, '0')}`,
    season: 2026,
    session_type: ch.sessionType,
    circuit_id: ch.circuitId,
    circuit_layout_version: circuitLayout,
    ruleset_version: DEFAULT_RULESET_VERSION,
    provider_schema_version: 'pulse.event.v1',
    participants: DRIVERS.map((d) => d.id),
    planned_start_at: startIso,
    planned_end_at: segments.length ? segments[segments.length - 1]!.planned_end_at : plannedSessionEnd(ch.sessionType, startIso),
    laps,
    segments: segments.length ? segments : undefined,
    capabilities,
    quality,
  };
}
