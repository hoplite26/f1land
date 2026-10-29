import type { CircuitData, Vec2 } from '@/data/circuits/types';
import type { CapabilityManifest, QualityProfile, SessionManifest, Capability } from '@/domain/types';
import { DRIVERS } from '@/data/teams';

/** Synthetic stadium-shaped circuit (two straights, a hairpin and a sweeper) for unit tests. */
export function synthCircuit(): CircuitData {
  const pts: Vec2[] = [];
  const step = 4;
  const straight = 900;
  const r1 = 60;
  const r2 = 140;
  // Straight along +x at y = -r, starting at the control line x = 0.
  for (let x = 0; x < straight; x += step) pts.push([x, -r2]);
  // Right side: large sweeper (anticlockwise as seen from above → left turns).
  for (let a = -Math.PI / 2; a < Math.PI / 2; a += step / r2) pts.push([straight + Math.cos(a) * r2, Math.sin(a) * r2]);
  // Back straight to x = 0 at y = +r2, then a tighter hairpin built from a smaller radius with a link.
  for (let x = straight; x > 0; x -= step) pts.push([x, r2]);
  for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += step / r2) pts.push([Math.cos(a) * r2 * 0.4 - 0, Math.sin(a) * r2]);
  void r1;
  const len = pts.reduce((acc, p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return acc + Math.hypot(q[0] - p[0], q[1] - p[1]);
  }, 0);
  const pit: Vec2[] = [];
  for (let x = -260; x <= 260; x += 4) {
    const off = x < -180 ? ((x + 260) / 80) * 22 : x > 180 ? ((260 - x) / 80) * 22 : 22;
    pit.push([x < 0 ? x + 0 : x, -r2 - off]);
  }
  // Pit entry is before the line: shift path so entry is on the back half of the main straight wrap.
  const pitShifted: Vec2[] = pit.map(([x, y]) => [x, y]);
  return {
    id: 'test-0001',
    layoutVersion: 'test@1',
    name: 'Test Ring',
    shortName: 'Test',
    location: 'Nowhere',
    country: 'Testland',
    countryCode: 'XX',
    timezone: 'UTC',
    lengthM: Math.round(len),
    centerlineLengthM: len,
    laps: 5,
    direction: 'CCW',
    widthM: 14,
    centerline: pts,
    spacingM: step,
    sectors: [
      { index: 1, startS: 0, endS: len / 3 },
      { index: 2, startS: len / 3, endS: (2 * len) / 3 },
      { index: 3, startS: (2 * len) / 3, endS: len },
    ],
    corners: [],
    straightZones: [{ detectionS: len - 150, startS: 20, endS: 800 }],
    pitLane: {
      path: pitShifted,
      entryS: len - 260,
      exitS: 260,
      boxesStartS: 140,
      boxesEndS: 380,
      side: 'right',
      speedLimitKph: 80,
      lengthM: 520,
    },
    grandstands: [],
    bounds: { minX: -100, maxX: straight + r2, minY: -r2 - 30, maxY: r2 },
    theme: 'countryside',
    timeOfDay: 'day',
    landmarks: [],
    hasWater: false,
    lapRecordMs: null,
  };
}

const CAPS: Capability[] = [
  'session_status', 'timing_order', 'final_classification', 'laps', 'sectors', 'occupancy', 'pit_entry_exit',
  'stationary_stop', 'tyre_stints', 'race_control', 'location', 'on_track_pass', 'retirement', 'qualifying_progression', 'aero_mode',
];

export function fullCaps(): { capabilities: CapabilityManifest; quality: QualityProfile } {
  const capabilities = Object.fromEntries(CAPS.map((c) => [c, true])) as CapabilityManifest;
  const quality = Object.fromEntries(
    CAPS.map((c) => [c, { level: 'SUPPORTED', coverage_from: null, max_age_ms: 2000, timestamp_precision_ms: 10, validation_suite_version: 'demo-1' }]),
  ) as QualityProfile;
  return { capabilities, quality };
}

export function synthManifest(startMs: number, laps = 5): SessionManifest {
  return {
    session_id: 'test-race',
    event_id: 'event_test_race',
    meeting_id: 'test',
    season: 2026,
    session_type: 'GRAND_PRIX',
    circuit_id: 'test-0001',
    circuit_layout_version: 'test@1',
    ruleset_version: 'fia-2026-sb-iss09',
    provider_schema_version: 'pulse.event.v1',
    participants: DRIVERS.map((d) => d.id),
    planned_start_at: new Date(startMs).toISOString(),
    planned_end_at: new Date(startMs + 3600_000).toISOString(),
    laps,
    ...fullCaps(),
  };
}
