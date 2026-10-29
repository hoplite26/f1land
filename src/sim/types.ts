import type { Compound, DriverStatus, Occupancy, SegmentId, SessionStatus, TrackState } from '@/domain/types';

export type CarMode =
  | 'GRID'
  | 'RACING'
  | 'PIT_LANE'
  | 'PIT_STOP'
  | 'GARAGE'
  | 'STOPPING'
  | 'RETIRED'
  | 'FINISHED';

/** Render sample for one car (interpolated by the 3D/SVG layers). */
export interface CarFrame {
  id: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** Braking level 0..1 */
  brake: number;
  /** Steering angle (rad, + = left). */
  steer: number;
  /** Active aero straight mode (rear/front flaps open). */
  aeroOpen: boolean;
  /** Overtake Mode energy boost active (only shown when the signal exists). */
  boost: boolean;
  tyre: Compound;
  visible: boolean;
  inPit: boolean;
  /** Main-track arc length (approximate position). */
  s: number;
}

export interface SafetyCarFrame {
  kind: 'SC' | 'MEDICAL';
  x: number;
  y: number;
  heading: number;
  speed: number;
  lights: boolean;
  visible: boolean;
}

export interface SimFrame {
  t: number;
  cars: CarFrame[];
  safetyCar: SafetyCarFrame | null;
  /** Start lights: number of red columns lit; 'off' after lights out. */
  lights: number | 'off';
}

export interface LiveCar {
  id: string;
  position: number;
  driverLaps: number;
  gapMs: number | null;
  intervalMs: number | null;
  lastLapMs: number | null;
  bestLapMs: number | null;
  sectorTimes: [number | null, number | null, number | null];
  sectorBest: [boolean, boolean, boolean];
  sector: 1 | 2 | 3;
  status: DriverStatus;
  occupancy: Occupancy;
  mode: CarMode;
  tyre: Compound;
  tyreAgeLaps: number;
  tyreWear: number;
  stints: Array<{ compound: Compound; fromLap: number; toLap: number | null }>;
  pitStops: number;
  speedKph: number;
  /** Position at the start (grid). */
  gridPosition: number;
  /** Qualifying: best time in the current segment; eliminated flag. */
  segmentBestMs?: number | null;
  eliminatedIn?: SegmentId | null;
  boost: boolean;
  /** Progress along the lap 0..1 */
  lapFraction: number;
}

export interface LiveState {
  sessionId: string;
  t: number;
  nowMs: number;
  status: SessionStatus;
  trackState: TrackState;
  sectorFlags: [boolean, boolean, boolean];
  leaderLap: number;
  totalLaps: number | null;
  cars: LiveCar[];
  fastestLap: { driverId: string; ms: number; lap: number } | null;
  segment: { id: SegmentId; remainingMs: number; cutPosition: number; state: 'RUNNING' | 'ENDED' | 'WAITING' } | null;
  weather: { airC: number; trackC: number; condition: 'DRY' | 'CLOUDY' | 'WET' };
  lights: number | 'off';
  /** Recent notable moments for the feed/director. */
  moments: Moment[];
  /** Stale feed flag (F1-049) — markers must stop. */
  stale: boolean;
}

export type MomentKind =
  | 'OVERTAKE'
  | 'PIT'
  | 'FASTEST_LAP'
  | 'SC'
  | 'VSC'
  | 'RED'
  | 'GREEN'
  | 'RETIREMENT'
  | 'START'
  | 'FINISH'
  | 'TRACK_LIMITS'
  | 'BATTLE'
  | 'ELIMINATED'
  | 'SEGMENT';

export interface Moment {
  id: string;
  kind: MomentKind;
  t: number;
  atMs: number;
  lap: number;
  drivers: string[];
  /** Extra values (e.g. stop duration, lap time, sector). */
  data?: Record<string, string | number | boolean>;
}
