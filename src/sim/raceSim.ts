import type { CircuitData } from '@/data/circuits/types';
import { sectorAt } from '@/data/circuits/geometry';
import { DRIVER_BY_ID, TEAM_BY_ID, TEAMS, type Driver, type Team } from '@/data/teams';
import type {
  ClassificationEntry,
  Compound,
  DriverStatus,
  Occupancy,
  PitService,
  SessionManifest,
  SessionStatus,
  TimingOrderEntry,
  TrackState,
} from '@/domain/types';
import { EventEmitter } from './emitter';
import { Rng } from './rng';
import { buildTrackModel, minSpeedAhead, sampleArr, zoneAt, type TrackModel } from './trackModel';
import type { CarFrame, CarMode, LiveCar, LiveState, Moment, MomentKind, SafetyCarFrame, SimFrame } from './types';

export const SIM_DT = 0.05;
const LOOP_M = 40;
const CAR_LEN = 5.4;
const LANE_W = 2.3;

export interface RaceScenario {
  safetyCarLap?: number;
  vscLap?: number;
  redFlagLap?: number;
  /** Multiplier on random incident probability (0 disables). */
  incidentRate?: number;
  /** Probability of a post-race time penalty that revises the classification. */
  penaltyChance?: number;
}

export interface RaceSimConfig {
  manifest: SessionManifest;
  circuit: CircuitData;
  seed: string;
  laps: number;
  /** UTC epoch ms at sim time 0 (cars on the grid). */
  startMs: number;
  /** Seconds on the grid before the light sequence starts. */
  preStartSec?: number;
  /** Starting grid order (driver ids). Defaults to a seeded pace-based order. */
  grid?: string[];
  scenario?: RaceScenario;
}

interface PlannedStop {
  lap: number;
  compound: Compound;
}

interface Car {
  id: string;
  driver: Driver;
  team: Team;
  teamIdx: number;
  gridPos: number;
  mode: CarMode;
  s: number;
  lat: number;
  latTarget: number;
  v: number;
  lapsDone: number;
  lapStartT: number;
  sectorStartT: number;
  sector: 1 | 2 | 3;
  lapNeutral: boolean;
  sectorNeutral: boolean;
  lapPitIn: boolean;
  lapPitOut: boolean;
  lastLapMs: number | null;
  bestLapMs: number | null;
  sectorTimes: [number | null, number | null, number | null];
  sectorBest: [boolean, boolean, boolean];
  tyre: Compound;
  tyreAge: number;
  wear: number;
  stintNo: number;
  stints: Array<{ compound: Compound; fromLap: number; toLap: number | null }>;
  plan: PlannedStop[];
  pitRequest: boolean;
  pitService: PitService;
  pitS: number;
  pitVisit: string | null;
  pitVisitNormal: boolean;
  pitEntryT: number;
  stopStartT: number;
  stopRemaining: number;
  stopMs: number | null;
  pitCrossedLine: boolean;
  pitStops: number;
  perf: number;
  lapNoise: number;
  reaction: number;
  launch: number;
  attempt: { target: string; side: number; t0: number } | null;
  yieldUntil: number;
  brake: number;
  prevV: number;
  heading: number;
  steer: number;
  status: DriverStatus;
  occupancy: Occupancy;
  parked: { x: number; y: number; heading: number } | null;
  stopTargetLat: number;
  finished: boolean;
  finishT: number;
  loopIdx: number;
  gapMs: number | null;
  boost: boolean;
  boostZone: number;
  penaltyMs: number;
  totalTimeMs: number | null;
  invalidPending: { lap: number; atT: number; tc: number; sourceId: string; lapMs: number; startedAt: string } | null;
  lapSourceIds: Map<number, string>;
  redQueued: boolean;
  pitRedInterrupted: boolean;
}

interface SafetyCar {
  phase: 'NONE' | 'OUT' | 'IN';
  s: number;
  lat: number;
  v: number;
  onPit: boolean;
  pitS: number;
  lights: boolean;
  lapsLed: number;
  leaderLapAtDeploy: number;
}

const COMPOUND_PACE: Record<Compound, number> = { SOFT: 1.006, MEDIUM: 1.0, HARD: 0.995, INTERMEDIATE: 0.93, WET: 0.9 };

export class RaceSim {
  readonly emitter: EventEmitter;
  readonly model: TrackModel;
  readonly cfg: RaceSimConfig;
  readonly totalLaps: number;
  t = 0;
  status: SessionStatus = 'NOT_STARTED';
  trackState: TrackState = 'GREEN';
  lights: number | 'off' = 0;
  finished = false;

  private rng: Rng;
  private cars: Car[] = [];
  private byId = new Map<string, Car>();
  private order: Car[] = [];
  private lightsOutT: number;
  private lightsStartT: number;
  private leaderTimes = new Map<number, number>();
  private snapshotRev = 0;
  private nextTimingT = 5;
  private sc: SafetyCar = { phase: 'NONE', s: 0, lat: 0, v: 0, onPit: false, pitS: 0, lights: false, lapsLed: 0, leaderLapAtDeploy: 0 };
  private vscEndT = 0;
  private vscEndingT = 0;
  private redResumeT = 0;
  private scRecoverLaps = 3;
  private fastest: { driverId: string; ms: number; lap: number } | null = null;
  private moments: Moment[] = [];
  private momentSeq = 0;
  private rcSeq = 0;
  private sectorFlagUntil: [number, number, number] = [0, 0, 0];
  private sectorFlagOn: [boolean, boolean, boolean] = [false, false, false];
  private leaderLapsDone = 0;
  private chequeredT = 0;
  private classifiedT = 0;
  private finalisedT = 0;
  private battles = new Map<string, number>();
  private incidentRng: Rng;
  private sectorBestMs: [number, number, number] = [Infinity, Infinity, Infinity];
  private lineOnPitS: number;
  private pitExitLat: number;
  private pitEntryLat: number;
  private weather: LiveState['weather'];

  constructor(cfg: RaceSimConfig) {
    this.cfg = cfg;
    this.model = buildTrackModel(cfg.circuit);
    this.totalLaps = cfg.laps;
    this.rng = new Rng(cfg.seed);
    this.incidentRng = this.rng.fork('incidents');
    this.emitter = new EventEmitter(cfg.manifest.event_id);
    const pre = cfg.preStartSec ?? 14;
    this.lightsStartT = pre;
    this.lightsOutT = pre + 5 + this.rng.range(0.4, 2.6);
    const { pit, track } = this.model;
    this.lineOnPitS = pit.project(...(track.pointAt(0) as [number, number])).s;
    const pe = pit.pointAt(pit.length);
    this.pitExitLat = track.project(pe[0], pe[1], this.cfg.circuit.pitLane.exitS).lateral;
    const ps = pit.pointAt(0);
    this.pitEntryLat = track.project(ps[0], ps[1], this.cfg.circuit.pitLane.entryS).lateral;
    const night = cfg.circuit.timeOfDay !== 'day';
    const airC = Math.round(this.rng.range(night ? 22 : 18, night ? 29 : 32));
    this.weather = { airC, trackC: airC + Math.round(this.rng.range(night ? 3 : 8, night ? 7 : 18)), condition: 'DRY' };
    this.initCars();
  }

  /* ------------------------------------------------------------ */
  /* Setup                                                         */
  /* ------------------------------------------------------------ */

  private initCars(): void {
    const participants = this.cfg.manifest.participants;
    const carPaces = TEAMS.map((t) => t.carPace);
    const minCar = Math.min(...carPaces);
    const maxCar = Math.max(...carPaces);
    let grid = this.cfg.grid;
    if (!grid) {
      const scored = participants.map((id) => {
        const d = DRIVER_BY_ID[id]!;
        const tm = TEAM_BY_ID[d.teamId]!;
        return { id, score: tm.carPace * 0.65 + d.pace * 0.35 + this.rng.gauss(0, 0.012) };
      });
      scored.sort((a, b) => b.score - a.score);
      grid = scored.map((x) => x.id);
    }
    const N = this.totalLaps;
    grid.forEach((id, slot) => {
      const driver = DRIVER_BY_ID[id]!;
      const team = TEAM_BY_ID[driver.teamId]!;
      const carNorm = (team.carPace - minCar) / Math.max(1e-6, maxCar - minCar);
      const drvNorm = (driver.pace - 0.85) / 0.14;
      const perf = 0.981 + 0.0125 * carNorm + 0.0055 * drvNorm;
      const s = this.model.gridS(slot);
      const side = slot % 2 === 0 ? 1 : -1;
      const strat = this.planStrategy(slot, N);
      const car: Car = {
        id,
        driver,
        team,
        teamIdx: Math.max(0, TEAMS.findIndex((t) => t.id === team.id)),
        gridPos: slot + 1,
        mode: 'GRID',
        s,
        lat: side * 2.2,
        latTarget: side * 2.2,
        v: 0,
        lapsDone: -1,
        lapStartT: 0,
        sectorStartT: 0,
        sector: 3,
        lapNeutral: false,
        sectorNeutral: false,
        lapPitIn: false,
        lapPitOut: false,
        lastLapMs: null,
        bestLapMs: null,
        sectorTimes: [null, null, null],
        sectorBest: [false, false, false],
        tyre: strat.start,
        tyreAge: strat.used ? 3 : 0,
        wear: strat.used ? 0.06 : 0,
        stintNo: 1,
        stints: [{ compound: strat.start, fromLap: 1, toLap: null }],
        plan: strat.stops,
        pitRequest: false,
        pitService: 'TYRES',
        pitS: 0,
        pitVisit: null,
        pitVisitNormal: true,
        pitEntryT: 0,
        stopStartT: 0,
        stopRemaining: 0,
        stopMs: null,
        pitCrossedLine: false,
        pitStops: 0,
        perf,
        lapNoise: 1,
        reaction: this.rng.range(0.17, 0.33),
        launch: this.rng.range(0.9, 1.07),
        attempt: null,
        yieldUntil: 0,
        brake: 0,
        prevV: 0,
        heading: this.model.track.headingAt(s),
        steer: 0,
        status: 'ACTIVE',
        occupancy: 'ON_TRACK',
        parked: null,
        stopTargetLat: 0,
        finished: false,
        finishT: 0,
        loopIdx: Math.floor((s - this.model.L) / LOOP_M),
        gapMs: null,
        boost: false,
        boostZone: -1,
        penaltyMs: 0,
        totalTimeMs: null,
        invalidPending: null,
        lapSourceIds: new Map(),
        redQueued: false,
        pitRedInterrupted: false,
      };
      this.cars.push(car);
      this.byId.set(id, car);
    });
    this.order = [...this.cars];
  }

  private planStrategy(slot: number, N: number): { start: Compound; used: boolean; stops: PlannedStop[] } {
    if (this.cfg.manifest.session_type === 'SPRINT') {
      return { start: slot < 14 ? 'MEDIUM' : this.rng.pick(['SOFT', 'MEDIUM'] as const), used: false, stops: [] };
    }
    const r = this.rng.next();
    if (slot < 10) {
      if (r < 0.62) return { start: 'MEDIUM', used: true, stops: [{ lap: Math.round(N * this.rng.range(0.36, 0.5)), compound: 'HARD' }] };
      if (r < 0.85)
        return {
          start: 'SOFT',
          used: true,
          stops: [
            { lap: Math.round(N * this.rng.range(0.22, 0.3)), compound: 'MEDIUM' },
            { lap: Math.round(N * this.rng.range(0.6, 0.7)), compound: 'HARD' },
          ],
        };
      return { start: 'MEDIUM', used: true, stops: [{ lap: Math.round(N * this.rng.range(0.42, 0.55)), compound: 'HARD' }] };
    }
    if (r < 0.4) return { start: 'HARD', used: false, stops: [{ lap: Math.round(N * this.rng.range(0.55, 0.7)), compound: 'MEDIUM' }] };
    if (r < 0.75) return { start: 'MEDIUM', used: false, stops: [{ lap: Math.round(N * this.rng.range(0.35, 0.5)), compound: 'HARD' }] };
    return {
      start: 'SOFT',
      used: false,
      stops: [
        { lap: Math.round(N * this.rng.range(0.2, 0.28)), compound: 'HARD' },
        { lap: Math.round(N * this.rng.range(0.6, 0.72)), compound: 'MEDIUM' },
      ],
    };
  }

  /* ------------------------------------------------------------ */
  /* Public API                                                    */
  /* ------------------------------------------------------------ */

  get nowMs(): number {
    return this.cfg.startMs + this.t * 1000;
  }

  private msAt(t: number): number {
    return this.cfg.startMs + t * 1000;
  }

  advanceTo(tTarget: number): void {
    while (this.t + SIM_DT <= tTarget + 1e-9) this.step(SIM_DT);
  }

  /** Manual race-control trigger used by the DEMO director panel. */
  trigger(kind: 'SC' | 'VSC' | 'RED' | 'RETIRE', driverId?: string): void {
    if (this.status !== 'STARTED' && this.status !== 'RESUMED') return;
    if (kind === 'RETIRE') {
      const c = driverId ? this.byId.get(driverId) : this.rng.pick(this.cars.filter((x) => x.mode === 'RACING'));
      if (c && c.mode === 'RACING') this.retire(c, 'mechanical', 'NONE');
      return;
    }
    if (kind === 'SC') this.deploySC();
    else if (kind === 'VSC') this.deployVSC();
    else this.redFlag();
  }

  /* ------------------------------------------------------------ */
  /* Main step                                                     */
  /* ------------------------------------------------------------ */

  private step(dt: number): void {
    const prevT = this.t;
    this.t += dt;
    const t = this.t;

    // Start light sequence.
    if (this.status === 'NOT_STARTED') {
      if (t >= this.lightsStartT && t < this.lightsOutT) {
        this.lights = Math.min(5, Math.floor(t - this.lightsStartT) + 1);
      }
      if (t >= this.lightsOutT) {
        this.lights = 'off';
        this.status = 'STARTED';
        this.emitSession('STARTED', this.lightsOutT);
        this.emitTrack('GREEN', this.lightsOutT);
        for (const c of this.cars) {
          c.lapStartT = this.lightsOutT;
          c.sectorStartT = this.lightsOutT;
        }
        this.moment('START', this.lightsOutT, 0, []);
      } else {
        return;
      }
    }

    this.updateRaceControl(t);
    this.sortOrder();

    const physical = this.cars.filter((c) => c.mode !== 'PIT_LANE' && c.mode !== 'PIT_STOP' && c.mode !== 'GARAGE' && c.mode !== 'FINISHED' && c.parked === null);
    physical.sort((a, b) => a.s - b.s);

    for (const c of this.cars) this.updateCar(c, dt, prevT, physical);
    this.updateSafetyCar(dt);
    this.processInvalidations();
    this.updateGaps(t);
    this.detectBattles(t);

    if (t >= this.nextTimingT && !this.finished) {
      this.nextTimingT = t + 5;
      this.emitTiming(t, null);
    }
    this.updateFinish(t);
  }

  /* ------------------------------------------------------------ */
  /* Race control                                                  */
  /* ------------------------------------------------------------ */

  private emitSession(status: SessionStatus, at: number): void {
    this.status = status;
    this.emitter.emit(
      'SESSION_STATE',
      { sport: 'formula1', status, leader_lap: this.leaderLapsDone + 1 },
      this.msAt(at),
      { periodId: this.periodId() },
    );
  }

  private periodId(): string {
    return this.cfg.manifest.session_type === 'SPRINT' ? 'sprint' : 'race';
  }

  private emitTrack(state: TrackState, at: number): void {
    this.trackState = state;
    this.rcSeq++;
    this.emitter.emit(
      'RACE_CONTROL_STATE',
      { sport: 'formula1', scope: 'TRACK', track_state: state, message_id: `rc_${this.rcSeq}`, leader_lap: this.leaderLapsDone + 1, message_key: `rc.${state.toLowerCase()}` },
      this.msAt(at),
      { periodId: this.periodId() },
    );
    if (state === 'SC' || state === 'VSC' || state === 'RED') {
      for (const c of this.cars) {
        c.lapNeutral = true;
        c.sectorNeutral = true;
      }
    }
  }

  private emitSectorFlag(sector: 1 | 2 | 3, on: boolean, at: number): void {
    this.rcSeq++;
    this.sectorFlagOn[sector - 1] = on;
    this.emitter.emit(
      'RACE_CONTROL_STATE',
      { sport: 'formula1', scope: 'SECTOR', sector, sector_flag: on ? 'YELLOW' : 'CLEAR', message_id: `rc_${this.rcSeq}`, leader_lap: this.leaderLapsDone + 1 },
      this.msAt(at),
      { periodId: this.periodId() },
    );
  }

  private updateRaceControl(t: number): void {
    // Local yellow flags expire.
    for (let i = 0; i < 3; i++) {
      if (this.sectorFlagOn[i] && t > this.sectorFlagUntil[i]!) this.emitSectorFlag((i + 1) as 1 | 2 | 3, false, t);
    }
    if (this.trackState === 'VSC' && t >= this.vscEndingT) {
      this.emitTrack('VSC_ENDING', t);
    } else if (this.trackState === 'VSC_ENDING' && t >= this.vscEndT) {
      this.emitTrack('GREEN', t);
      this.moment('GREEN', t, this.leaderLapsDone + 1, []);
    }
    if (this.trackState === 'RED' && t >= this.redResumeT && this.redResumeT > 0) {
      this.redResumeT = 0;
      this.emitSession('RESUMED', t);
      this.deploySC(true);
      for (const c of this.cars) {
        if (c.redQueued) {
          c.redQueued = false;
          c.stopRemaining = 0;
        }
      }
    }
  }

  private deploySC(afterRed = false): void {
    if (this.sc.phase !== 'NONE' || this.trackState === 'RED') {
      if (!afterRed) return;
    }
    const leader = this.order[0];
    if (!leader) return;
    this.emitTrack('SC', this.t);
    this.moment('SC', this.t, this.leaderLapsDone + 1, []);
    const pl = this.cfg.circuit.pitLane;
    this.sc = {
      phase: 'OUT',
      s: afterRed ? this.model.track.wrap(leader.s + 60) : pl.exitS,
      lat: 0,
      v: 30,
      onPit: false,
      pitS: 0,
      lights: true,
      lapsLed: 0,
      leaderLapAtDeploy: this.leaderLapsDone,
    };
    // If the leader is just past the pit exit, the SC joins ahead of it.
    if (!afterRed && this.model.track.delta(leader.s, pl.exitS) < 0 && this.model.track.delta(leader.s, pl.exitS) > -400) {
      this.sc.s = this.model.track.wrap(leader.s + 80);
    }
    this.scRecoverLaps = 2 + this.incidentRng.int(0, 2);
    // Cheap stops under SC.
    for (const c of this.cars) {
      if (c.mode !== 'RACING') continue;
      const life = this.tyreLife(c.tyre);
      const remaining = this.totalLaps - c.lapsDone;
      if (c.tyreAge > life * 0.35 && remaining > 6 && this.cfg.manifest.session_type !== 'SPRINT') {
        c.pitRequest = true;
        const next = c.plan[0];
        if (next) c.plan.shift();
        const compound = next?.compound ?? (remaining > this.tyreLife('MEDIUM') ? 'HARD' : 'MEDIUM');
        c.plan.unshift({ lap: c.lapsDone + 1, compound });
        if (remaining < this.tyreLife(compound) * 0.95) c.plan = c.plan.slice(0, 1);
      }
    }
  }

  private deployVSC(): void {
    if (this.trackState !== 'GREEN') return;
    this.emitTrack('VSC', this.t);
    this.moment('VSC', this.t, this.leaderLapsDone + 1, []);
    const dur = this.incidentRng.range(35, 85);
    this.vscEndingT = this.t + dur;
    this.vscEndT = this.t + dur + 10;
  }

  private redFlag(): void {
    if (this.trackState === 'RED') return;
    this.sc.phase = 'NONE';
    this.emitTrack('RED', this.t);
    this.emitSession('SUSPENDED', this.t);
    this.moment('RED', this.t, this.leaderLapsDone + 1, []);
    this.redResumeT = this.t + 150;
    for (const c of this.cars) {
      if (c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP') c.pitRedInterrupted = true;
      if (c.mode === 'RACING') c.redQueued = true;
    }
  }

  private retire(c: Car, reason: string, neutralise: 'NONE' | 'SC' | 'VSC' | 'AUTO'): void {
    c.mode = 'STOPPING';
    c.attempt = null;
    const side = c.lat >= 0 ? 1 : -1;
    c.stopTargetLat = side * (this.model.halfWidth + 7);
    this.moment('RETIREMENT', this.t, c.lapsDone + 1, [c.id], { reason });
    const sec = sectorAt(this.cfg.circuit, c.s);
    this.sectorFlagUntil[sec - 1] = this.t + 70;
    if (!this.sectorFlagOn[sec - 1]) this.emitSectorFlag(sec, true, this.t);
    let mode = neutralise;
    if (mode === 'AUTO') {
      const r = this.incidentRng.next();
      mode = r < 0.38 ? 'SC' : r < 0.78 ? 'VSC' : 'NONE';
    }
    if (mode === 'SC') this.pendingNeutral = { kind: 'SC', at: this.t + this.incidentRng.range(4, 9) };
    if (mode === 'VSC') this.pendingNeutral = { kind: 'VSC', at: this.t + this.incidentRng.range(3, 7) };
  }

  private pendingNeutral: { kind: 'SC' | 'VSC'; at: number } | null = null;

  private onLeaderLap(lap: number, t: number): void {
    this.leaderLapsDone = lap;
    const sc = this.cfg.scenario ?? {};
    if (sc.safetyCarLap === lap) this.deploySC();
    if (sc.vscLap === lap) this.deployVSC();
    if (sc.redFlagLap === lap) this.redFlag();
    if (this.sc.phase === 'OUT') {
      this.sc.lapsLed++;
      if (this.sc.lapsLed >= this.scRecoverLaps && this.trackState === 'SC') {
        this.emitTrack('SC_ENDING', t);
        this.sc.lights = false;
      }
    } else if (this.trackState === 'SC_ENDING') {
      this.emitTrack('GREEN', t);
      this.moment('GREEN', t, lap + 1, []);
    }
    // Random incidents.
    const rate = sc.incidentRate ?? 1;
    if (rate > 0 && lap >= 1 && lap < this.totalLaps - 1 && this.trackState === 'GREEN') {
      for (const c of this.cars) {
        if (c.mode === 'RACING' && this.incidentRng.chance(0.0009 * rate)) {
          this.retire(c, this.incidentRng.pick(['power_unit', 'hydraulics', 'gearbox', 'damage']), 'AUTO');
          break;
        }
      }
    }
    this.emitTiming(t, lap);
  }

  /* ------------------------------------------------------------ */
  /* Cars                                                          */
  /* ------------------------------------------------------------ */

  private tyreLife(c: Compound): number {
    const N = this.totalLaps;
    return c === 'SOFT' ? N * 0.34 : c === 'MEDIUM' ? N * 0.52 : c === 'HARD' ? N * 0.72 : N * 0.5;
  }

  private progress(c: Car): number {
    const L = this.model.L;
    if (c.finished) return c.lapsDone * L + L - c.finishT * 1e-4;
    if (c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP') {
      const pl = this.cfg.circuit.pitLane;
      let span = this.model.track.delta(pl.entryS, pl.exitS);
      if (span <= 0) span += L;
      const f = this.model.pit.length > 0 ? c.pitS / this.model.pit.length : 0;
      let sm = pl.entryS + span * f;
      if (!c.pitCrossedLine) {
        if (sm >= L) sm = L - 0.5;
        return c.lapsDone * L + sm;
      }
      sm = sm >= L ? sm - L : 0.5;
      return c.lapsDone * L + sm;
    }
    return c.lapsDone * L + c.s;
  }

  private sortOrder(): void {
    const prog = new Map<Car, number>();
    for (const c of this.cars) prog.set(c, this.progress(c));
    this.order.sort((a, b) => {
      const ra = rankClass(a);
      const rb = rankClass(b);
      if (ra !== rb) return ra - rb;
      return prog.get(b)! - prog.get(a)!;
    });
  }

  private updateCar(c: Car, dt: number, prevT: number, physical: Car[]): void {
    const { model } = this;
    const t = this.t;
    if (c.mode === 'RETIRED') return;
    if (c.mode === 'FINISHED') {
      // Cool-down: slow lap then park in the pit lane exit area (hidden).
      c.v = Math.max(0, Math.min(c.v, sampleArr(model.vmax, model, c.s) * 0.5));
      c.s = model.track.wrap(c.s + c.v * dt);
      c.latTarget = (c.lat >= 0 ? 1 : -1) * (model.halfWidth - 1.6);
      c.lat += clamp(c.latTarget - c.lat, -1.5 * dt, 1.5 * dt);
      this.updatePose(c, dt);
      return;
    }
    if (c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP') {
      this.updatePitCar(c, dt, prevT);
      return;
    }
    if (c.mode === 'GRID') {
      if (t < this.lightsOutT + c.reaction) return;
      c.mode = 'RACING';
    }

    const sPrev = c.s;
    const neutral = this.trackState === 'SC' || this.trackState === 'VSC' || this.trackState === 'SC_ENDING' || this.trackState === 'VSC_ENDING' || this.trackState === 'RED';

    // --- target speed ---
    let base = sampleArr(model.vmax, model, c.s) * c.perf * c.lapNoise * this.tyreFactor(c) * this.fuelFactor(c);
    if (c.mode === 'STOPPING') {
      c.latTarget = c.stopTargetLat;
      base = Math.max(0, c.v - 9 * dt);
      if (c.v < 0.5) {
        c.v = 0;
        c.mode = 'RETIRED';
        c.status = 'RETIRED';
        c.occupancy = 'ON_TRACK';
        const p = model.track.pointAt(c.s, c.lat);
        c.parked = { x: p[0], y: p[1], heading: c.heading };
        this.emitStatus(c, t);
        if (this.pendingNeutral) {
          if (this.pendingNeutral.kind === 'SC') this.deploySC();
          else this.deployVSC();
          this.pendingNeutral = null;
        }
        return;
      }
    }
    const inZone = zoneAt(model, c.s);
    if (c.boost && inZone && !neutral) base *= 1.022;
    else if (c.boost && !inZone) c.boost = false;
    if (this.trackState === 'RED' || c.redQueued) base = Math.min(base, sampleArr(model.vmax, model, c.s) * 0.45);
    // Launch phase
    if (t - this.lightsOutT < 8) base *= c.launch;

    // --- obstacles (same physical lane ahead) ---
    let follow = Infinity;
    let blocker: Car | null = null;
    let blockerGap = Infinity;
    const myIdx = physical.indexOf(c);
    if (myIdx >= 0) {
      for (let k = 1; k < Math.min(physical.length, 8); k++) {
        const o = physical[(myIdx + k) % physical.length]!;
        if (o === c) continue;
        const gap = model.track.delta(c.s, o.s);
        if (gap <= 0 || gap > 90) {
          if (gap > 90) break;
          continue;
        }
        const dl = Math.abs(o.lat - c.lat);
        if (dl > LANE_W) continue;
        const minGap = CAR_LEN + 1.2 + c.v * (neutral ? 0.35 : 0.16);
        const allowed = o.v + (gap - minGap) * 1.6;
        if (allowed < follow) {
          follow = allowed;
          blocker = o;
          blockerGap = gap;
        }
      }
    }
    // Safety car as obstacle.
    if (this.sc.phase === 'OUT' && !this.sc.onPit) {
      const gap = model.track.delta(c.s, this.sc.s);
      if (gap > 0 && gap < 140) {
        const allowed = this.sc.v + (gap - 14) * 1.2;
        if (allowed < follow) {
          follow = allowed;
          blocker = null;
          blockerGap = gap;
        }
      }
    }

    // --- neutralisation caps ---
    if (neutral && c.mode === 'RACING') {
      const prof = sampleArr(model.vmax, model, c.s);
      if (this.trackState === 'VSC' || this.trackState === 'VSC_ENDING') base = Math.min(base, prof * 0.6);
      else if (this.trackState === 'SC' || this.trackState === 'SC_ENDING') {
        const closing = blockerGap > 45;
        base = Math.min(base, prof * (closing ? 0.74 : 0.6));
      }
      c.attempt = null;
    }

    // --- overtaking ---
    if (c.mode === 'RACING' && !neutral) this.handleOvertaking(c, blocker, blockerGap, base, t);
    else if (!neutral) c.attempt = null;

    // Blue flags: a car being lapped yields.
    if (blocker && blocker.lapsDone < c.lapsDone && blocker.mode === 'RACING' && blockerGap < 60 && !neutral) {
      blocker.yieldUntil = t + 4;
      const side = c.lat >= blocker.lat ? -1 : 1;
      blocker.latTarget = clamp(c.lat + side * 3.2, -model.halfWidth + 1.2, model.halfWidth - 1.2);
    }

    let vt = Math.min(base, follow);
    if (c.yieldUntil > t) vt *= 0.97;
    // Side-by-side into a braking zone: the outside car lifts.
    if (c.attempt === null && blocker === null && this.isOutsideAlongside(c, physical, myIdx)) vt *= 0.975;

    // Pit lane entry
    const pl = this.cfg.circuit.pitLane;
    const nextLap = c.lapsDone + 1;
    if (!c.pitRequest && c.plan[0] && c.plan[0].lap <= nextLap && this.status !== 'FINISHED' && !this.finishedLeader()) c.pitRequest = true;
    if (c.redQueued && this.trackState === 'RED') c.pitRequest = true;
    if (c.pitRequest && c.mode === 'RACING') {
      const toEntry = model.track.delta(c.s, pl.entryS);
      if (toEntry > 0 && toEntry < 260) {
        c.latTarget = clamp(this.pitEntryLat, -model.halfWidth + 1, model.halfWidth - 1);
        vt = Math.min(vt, Math.sqrt(model.pitLimit * model.pitLimit + 2 * 22 * Math.max(0, toEntry - 10)));
      }
    }

    // --- integrate speed ---
    const acc = c.v < vt ? Math.min((13.5 - 0.115 * c.v) * dt, vt - c.v) : -Math.min((22 + 0.0042 * c.v * c.v) * dt, c.v - vt);
    c.prevV = c.v;
    c.v = Math.max(0, c.v + acc);
    c.brake = acc < -4 * dt ? Math.min(1, -acc / (30 * dt)) : 0;
    c.s = model.track.wrap(c.s + c.v * dt);

    // --- lateral ---
    if (c.mode === 'RACING' && !c.attempt && c.yieldUntil < t && !(c.pitRequest && model.track.delta(c.s, pl.entryS) > 0 && model.track.delta(c.s, pl.entryS) < 260)) {
      c.latTarget = sampleArr(model.line, model, c.s) * (neutral ? 0.3 : 1);
      if (t - c.pitEntryT < 40 && c.lapPitOut) c.latTarget = c.latTarget * 0.5 + this.pitExitLat * 0.5;
    }
    const latRate = c.attempt ? 3.4 : 2.2;
    c.lat += clamp(c.latTarget - c.lat, -latRate * dt, latRate * dt);

    // --- crossings ---
    if (c.pitRequest && c.mode === 'RACING' && crossed(sPrev, c.s, pl.entryS, model.L)) {
      this.enterPit(c, prevT, sPrev);
      return;
    }
    this.handleCrossings(c, sPrev, prevT, dt);
    this.updatePose(c, dt);
  }

  private isOutsideAlongside(c: Car, physical: Car[], myIdx: number): boolean {
    if (myIdx < 0) return false;
    const k = sampleArr(this.model.curv, this.model, c.s + 40);
    if (Math.abs(k) < 0.01) return false;
    for (let j = -2; j <= 2; j++) {
      if (j === 0) continue;
      const o = physical[(myIdx + j + physical.length) % physical.length]!;
      if (o === c) continue;
      const d = this.model.track.delta(c.s, o.s);
      if (Math.abs(d) < CAR_LEN && Math.abs(o.lat - c.lat) < 4) {
        // Outside = lateral opposite to curvature sign.
        const outside = k > 0 ? c.lat < o.lat : c.lat > o.lat;
        if (outside && o.driver.racecraft >= c.driver.racecraft - 0.05) return true;
      }
    }
    return false;
  }

  private handleOvertaking(c: Car, blocker: Car | null, gap: number, base: number, t: number): void {
    const { model } = this;
    if (c.attempt) {
      const target = this.byId.get(c.attempt.target);
      if (!target || target.mode !== 'RACING') {
        c.attempt = null;
        return;
      }
      const d = model.track.delta(target.s, c.s);
      if (d > CAR_LEN + 0.8) {
        // Completed.
        c.attempt = null;
        if (target.lapsDone === c.lapsDone && this.trackState === 'GREEN') this.recordPass(c, target, t);
        return;
      }
      const braking = minSpeedAhead(model, c.s, 55) < c.v * 0.78;
      if ((braking && d < -CAR_LEN * 0.5) || t - c.attempt.t0 > 7) {
        c.attempt = null;
        return;
      }
      c.latTarget = c.attempt.side;
      return;
    }
    if (!blocker || gap > 38 || blocker.mode !== 'RACING') return;
    if (blocker.lapsDone < c.lapsDone) return; // blue flag handles lapping
    const approachingStraight = zoneAt(model, c.s) || zoneAt(model, c.s + 80);
    const pace = base - blocker.v;
    const boosted = c.boost;
    if (!approachingStraight && pace < 2.5) return;
    if (pace < 0.25 && !boosted) return;
    const p = (0.012 + 0.03 * c.driver.racecraft) * (boosted ? 1.8 : 1) * (approachingStraight ? 1 : 0.35);
    if (!this.rng.chance(p)) return;
    const hw = model.halfWidth - 1.15;
    const left = clamp(blocker.lat + 3.1, -hw, hw);
    const right = clamp(blocker.lat - 3.1, -hw, hw);
    const kAhead = sampleArr(model.curv, model, c.s + 140);
    let side: number;
    const roomL = Math.abs(left - blocker.lat);
    const roomR = Math.abs(right - blocker.lat);
    if (roomL < LANE_W && roomR < LANE_W) return;
    if (roomL >= LANE_W && roomR >= LANE_W) side = kAhead > 0 ? left : right;
    else side = roomL >= LANE_W ? left : right;
    c.attempt = { target: blocker.id, side, t0: t };
    c.latTarget = side;
  }

  private recordPass(c: Car, o: Car, t: number): void {
    const sector = sectorAt(this.cfg.circuit, c.s);
    this.emitter.emit(
      'ON_TRACK_PASS',
      {
        sport: 'formula1',
        passing_driver_id: c.id,
        passed_driver_id: o.id,
        passing_driver_lap: c.lapsDone + 1,
        passed_driver_lap: o.lapsDone + 1,
        leader_lap: this.leaderLapsDone + 1,
        sector,
        distance_m: Math.round(c.s),
        provenance: 'VERIFIED',
        track_state: this.trackState,
        cause: 'ON_TRACK',
      },
      this.msAt(t),
      { periodId: this.periodId() },
    );
    this.moment('OVERTAKE', t, c.lapsDone + 1, [c.id, o.id], { sector });
  }

  private tyreFactor(c: Car): number {
    const life = this.tyreLife(c.tyre);
    const wear = c.tyreAge / life;
    let f = COMPOUND_PACE[c.tyre] - 0.0016 * c.tyreAge * (this.totalLaps > 30 ? 1 : 1.6) * (c.tyre === 'SOFT' ? 1.4 : c.tyre === 'HARD' ? 0.7 : 1);
    if (wear > 0.9) f -= (wear - 0.9) * 0.06;
    if (c.lapPitOut && c.sector === 1) f -= 0.015;
    return Math.max(0.9, f);
  }

  private fuelFactor(c: Car): number {
    return 1 - 0.011 * (1 - Math.max(0, c.lapsDone) / this.totalLaps);
  }

  private handleCrossings(c: Car, sPrev: number, prevT: number, dt: number): void {
    const { model } = this;
    const sec = this.cfg.circuit.sectors;
    const tCross = (boundary: number) => {
      const d = model.track.delta(sPrev, boundary);
      const travel = model.track.delta(sPrev, c.s);
      return prevT + (travel > 0 ? (d / travel) * dt : 0);
    };
    // Sector 1 → 2, 2 → 3
    for (const boundary of [sec[1].startS, sec[2].startS]) {
      if (crossed(sPrev, c.s, boundary, model.L) && c.lapsDone >= 0) {
        const tc = tCross(boundary);
        const finishedSector = (boundary === sec[1].startS ? 1 : 2) as 1 | 2;
        this.completeSector(c, finishedSector, tc);
        c.sector = (finishedSector + 1) as 2 | 3;
        this.emitStatus(c, tc);
      }
    }
    if (crossed(sPrev, c.s, 0, model.L)) {
      const tc = tCross(0);
      this.crossLine(c, tc);
    }
  }

  private completeSector(c: Car, sector: 1 | 2 | 3, tc: number): void {
    const ms = Math.round((tc - c.sectorStartT) * 1000);
    const valid = true;
    c.sectorTimes[sector - 1] = ms;
    if (sector === 1) {
      c.sectorTimes[1] = null;
      c.sectorTimes[2] = null;
    }
    const best = ms < this.sectorBestMs[sector - 1]! && !c.sectorNeutral && !c.lapPitOut && !(sector === 3 && c.lapPitIn);
    if (best) this.sectorBestMs[sector - 1] = ms;
    c.sectorBest[sector - 1] = best;
    this.emitter.emit(
      'SECTOR_COMPLETED',
      {
        sport: 'formula1',
        driver_id: c.id,
        driver_lap: c.lapsDone + 1,
        sector,
        sector_time_ms: ms,
        valid,
        started_at: new Date(Math.round(this.msAt(c.sectorStartT))).toISOString(),
        neutralised: c.sectorNeutral,
      },
      this.msAt(tc),
      { periodId: this.periodId(), attemptId: `${c.id}_l${c.lapsDone + 1}_s${sector}` },
    );
    c.sectorStartT = tc;
    c.sectorNeutral = this.isNeutral();
  }

  private isNeutral(): boolean {
    return this.trackState !== 'GREEN' && this.trackState !== 'CHEQUERED';
  }

  private crossLine(c: Car, tc: number): void {
    if (c.lapsDone < 0) {
      c.lapsDone = 0;
      c.lapStartT = this.lightsOutT;
      c.sectorStartT = this.lightsOutT;
      c.sector = 1;
      this.emitStatus(c, tc);
      return;
    }
    this.completeSector(c, 3, tc);
    const lapMs = Math.round((tc - c.lapStartT) * 1000);
    const lapNo = c.lapsDone + 1;
    c.lapsDone = lapNo;
    c.lastLapMs = lapMs;
    c.tyreAge++;
    const invalid = !c.lapNeutral && !c.lapPitIn && !c.lapPitOut && this.rng.chance(0.012);
    const startedAt = new Date(Math.round(this.msAt(c.lapStartT))).toISOString();
    const lapEv = this.emitter.emit(
      'LAP_COMPLETED',
      {
        sport: 'formula1',
        driver_id: c.id,
        driver_lap: lapNo,
        leader_lap: Math.max(this.leaderLapsDone, lapNo),
        lap_time_ms: lapMs,
        valid: true,
        started_at: startedAt,
        neutralised: c.lapNeutral,
        pit_in_lap: c.lapPitIn,
        pit_out_lap: c.lapPitOut,
      },
      this.msAt(tc),
      { periodId: this.periodId(), attemptId: `${c.id}_l${lapNo}` },
    );
    c.lapSourceIds.set(lapNo, lapEv.source_event_id);
    if (invalid) {
      c.invalidPending = { lap: lapNo, atT: tc + this.rng.range(6, 18), tc, sourceId: lapEv.source_event_id, lapMs, startedAt };
    } else if (!c.lapNeutral && !c.lapPitIn && !c.lapPitOut) {
      if (c.bestLapMs === null || lapMs < c.bestLapMs) c.bestLapMs = lapMs;
      if (!this.fastest || lapMs < this.fastest.ms) {
        const had = this.fastest !== null;
        this.fastest = { driverId: c.id, ms: lapMs, lap: lapNo };
        if (had && lapNo > 3) this.moment('FASTEST_LAP', tc, lapNo, [c.id], { ms: lapMs });
      }
    }
    // Per-lap noise for the next lap (driver consistency).
    c.lapNoise = 1 + this.rng.gauss(0, 0.0035 * (1.25 - c.driver.consistency));
    c.lapStartT = tc;
    c.sectorStartT = tc;
    c.sector = 1;
    c.lapNeutral = this.isNeutral();
    c.sectorNeutral = c.lapNeutral;
    c.lapPitIn = false;
    c.lapPitOut = false;
    if (lapNo > this.leaderLapsDone) this.onLeaderLap(lapNo, tc);
    this.emitStatus(c, tc);
    this.checkFinish(c, tc);
  }

  private processInvalidations(): void {
    for (const c of this.cars) {
      const p = c.invalidPending;
      if (!p || this.t < p.atT) continue;
      c.invalidPending = null;
      this.emitter.emit(
        'LAP_INVALIDATED',
        { sport: 'formula1', driver_id: c.id, driver_lap: p.lap, lap_attempt_id: `${c.id}_l${p.lap}`, reason: 'TRACK_LIMITS' },
        this.msAt(this.t),
        { periodId: this.periodId(), attemptId: `${c.id}_l${p.lap}` },
      );
      this.emitter.emit(
        'LAP_COMPLETED',
        {
          sport: 'formula1',
          driver_id: c.id,
          driver_lap: p.lap,
          leader_lap: this.leaderLapsDone,
          lap_time_ms: p.lapMs,
          valid: false,
          started_at: p.startedAt,
          neutralised: false,
          pit_in_lap: false,
          pit_out_lap: false,
        },
        this.msAt(p.tc),
        { periodId: this.periodId(), attemptId: `${c.id}_l${p.lap}`, sourceId: p.sourceId, revision: 2 },
      );
      this.emitter.emit(
        'EVENT_CORRECTED',
        {
          sport: 'formula1',
          corrected_source_event_id: p.sourceId,
          previous_revision: '1',
          new_revision: '2',
          reason_key: 'correction.track_limits',
          before: { valid: true, lap_time_ms: p.lapMs },
          after: { valid: false, lap_time_ms: p.lapMs },
        },
        this.msAt(this.t),
        { periodId: this.periodId() },
      );
      this.moment('TRACK_LIMITS', this.t, p.lap, [c.id], { ms: p.lapMs });
    }
  }

  private checkFinish(c: Car, tc: number): void {
    if (this.chequeredT === 0 && c.lapsDone >= this.totalLaps) {
      this.chequeredT = tc;
      this.emitTrack('CHEQUERED', tc);
      this.moment('FINISH', tc, this.totalLaps, [c.id]);
    }
    if (this.chequeredT > 0 && !c.finished) {
      c.finished = true;
      c.finishT = tc;
      c.mode = 'FINISHED';
      c.totalTimeMs = Math.round((tc - this.lightsOutT) * 1000);
    }
  }

  private finishedLeader(): boolean {
    return this.chequeredT > 0;
  }

  private enterPit(c: Car, prevT: number, sPrev: number): void {
    const pl = this.cfg.circuit.pitLane;
    const d = this.model.track.delta(sPrev, pl.entryS);
    const travel = this.model.track.delta(sPrev, c.s);
    const te = prevT + (travel > 0 ? (d / travel) * SIM_DT : 0);
    c.mode = 'PIT_LANE';
    c.pitS = 0;
    c.attempt = null;
    c.pitRequest = false;
    c.pitCrossedLine = false;
    c.pitEntryT = te;
    c.stopMs = null;
    c.stopRemaining = 0;
    const normal = this.trackState !== 'RED' && !c.redQueued;
    c.pitVisitNormal = normal;
    c.pitRedInterrupted = false;
    c.pitService = c.redQueued ? 'REPAIR' : this.rng.chance(0.015) ? 'DRIVE_THROUGH' : 'TYRES';
    c.pitStops++;
    c.pitVisit = `${c.id}_pit_${String(c.pitStops).padStart(2, '0')}`;
    c.lapPitIn = true;
    c.occupancy = 'PIT_LANE';
    this.emitter.emit(
      'PIT_ENTRY',
      {
        sport: 'formula1',
        driver_id: c.id,
        driver_lap: c.lapsDone + 1,
        leader_lap: this.leaderLapsDone + 1,
        pit_visit_id: c.pitVisit,
        normal_racing_visit: normal,
        quality: 'CONFIRMED',
      },
      this.msAt(te),
      { periodId: this.periodId(), attemptId: c.pitVisit },
    );
    this.emitStatus(c, te);
  }

  private updatePitCar(c: Car, dt: number, prevT: number): void {
    const { model } = this;
    const pit = model.pit;
    const t = this.t;
    const boxS = model.boxS[c.teamIdx % model.boxS.length]!;
    const limit = model.pitLimit;
    if (c.mode === 'PIT_STOP') {
      c.v = 0;
      c.brake = 1;
      if (c.redQueued && this.trackState === 'RED') return;
      c.stopRemaining -= dt;
      if (c.stopRemaining <= 0) {
        c.mode = 'PIT_LANE';
        c.stopMs = Math.round((t - c.stopStartT) * 1000);
        if (c.pitService === 'TYRES' || c.pitService === 'REPAIR') this.fitTyres(c);
      }
      this.updatePose(c, dt);
      return;
    }
    const pPrev = c.pitS;
    // Red flag queue: stop near the pit exit in order.
    let vt = limit;
    const entryRamp = 60;
    if (c.pitS < entryRamp) vt = Math.max(limit, c.v - 18 * dt);
    const needsStop = c.pitService !== 'DRIVE_THROUGH' && c.stopMs === null;
    if (needsStop) {
      const toBox = boxS - c.pitS;
      if (toBox > 0) vt = Math.min(vt, Math.sqrt(2 * 7 * toBox) + 0.3);
      if (toBox <= 0.4) {
        c.mode = 'PIT_STOP';
        c.v = 0;
        c.stopStartT = t;
        const crew = c.team.pitCrewMs / 1000;
        const r = this.rng.next();
        c.stopRemaining = c.pitService === 'REPAIR' ? (this.trackState === 'RED' ? 1e9 : 8) : r < 0.008 ? this.rng.range(9, 14) : r < 0.05 ? this.rng.range(3.4, 6.5) : Math.max(1.85, crew + this.rng.gauss(0, 0.18));
        this.updatePose(c, dt);
        return;
      }
    }
    // Avoid driving through the car ahead in the pit lane.
    for (const o of this.cars) {
      if (o === c || (o.mode !== 'PIT_LANE' && o.mode !== 'PIT_STOP')) continue;
      const gap = o.pitS - c.pitS;
      if (gap > 0 && gap < 12 && Math.abs(boxS - c.pitS) > 14) vt = Math.min(vt, o.v + (gap - 8) * 1.2);
    }
    const acc = c.v < vt ? Math.min(9 * dt, vt - c.v) : -Math.min(14 * dt, c.v - vt);
    c.v = Math.max(0, c.v + acc);
    c.brake = acc < 0 ? 0.6 : 0;
    c.pitS = Math.min(pit.length, c.pitS + c.v * dt);
    if (!c.pitCrossedLine && pPrev < this.lineOnPitS && c.pitS >= this.lineOnPitS) {
      c.pitCrossedLine = true;
      const tc = prevT + (c.v > 0 ? ((this.lineOnPitS - pPrev) / Math.max(0.01, c.pitS - pPrev)) * dt : 0);
      // Lap completes in the pit lane (in-lap).
      const wasLapPitIn = c.lapPitIn;
      this.crossLine(c, tc);
      c.lapPitIn = false;
      c.lapPitOut = true;
      void wasLapPitIn;
    }
    if (c.pitS >= pit.length - 0.01) this.exitPit(c, t);
    else this.updatePose(c, dt);
  }

  private fitTyres(c: Car): void {
    const next = c.plan.shift();
    let compound: Compound = next?.compound ?? (c.tyre === 'HARD' ? 'MEDIUM' : 'HARD');
    if (c.redQueued) compound = c.tyre === 'HARD' ? 'MEDIUM' : 'HARD';
    if (c.stints.length) c.stints[c.stints.length - 1]!.toLap = c.lapsDone;
    c.tyre = compound;
    c.tyreAge = 0;
    c.wear = 0;
    c.stintNo++;
    c.stints.push({ compound, fromLap: c.lapsDone + 1, toLap: null });
  }

  private exitPit(c: Car, t: number): void {
    const pl = this.cfg.circuit.pitLane;
    c.mode = 'RACING';
    c.s = pl.exitS;
    c.lat = this.pitExitLat;
    c.latTarget = this.pitExitLat;
    c.occupancy = 'ON_TRACK';
    c.sector = sectorAt(this.cfg.circuit, c.s);
    const laneMs = Math.round((t - c.pitEntryT) * 1000);
    const visit = c.pitVisit!;
    const service = c.pitService;
    this.emitter.emit(
      'PIT_EXIT',
      {
        sport: 'formula1',
        driver_id: c.id,
        driver_lap: c.lapsDone + 1,
        leader_lap: this.leaderLapsDone + 1,
        pit_visit_id: visit,
        quality: 'CONFIRMED',
        compound: c.tyre,
        lane_duration_ms: laneMs,
        stop_duration_ms: service === 'DRIVE_THROUGH' ? null : c.stopMs,
        service,
        normal_racing_visit: c.pitVisitNormal,
        interrupted_by_red: c.pitRedInterrupted,
      },
      this.msAt(t),
      { periodId: this.periodId(), attemptId: visit },
    );
    if (service === 'TYRES' || service === 'REPAIR') {
      this.emitter.emit(
        'TYRE_STINT_CONFIRMED',
        {
          sport: 'formula1',
          driver_id: c.id,
          stint_number: c.stintNo,
          compound: c.tyre,
          supplier_spec: supplierSpec(this.cfg.circuit.id, c.tyre),
          new_set: true,
          start_driver_lap: c.lapsDone + 1,
          pit_visit_id: visit,
          quality: 'CONFIRMED',
        },
        this.msAt(t + 0.8),
        { periodId: this.periodId(), attemptId: visit },
      );
    }
    this.moment('PIT', t, c.lapsDone + 1, [c.id], {
      stopMs: c.stopMs ?? 0,
      laneMs,
      compound: c.tyre,
      service,
    });
    this.emitStatus(c, t);
  }

  private updatePose(c: Car, dt: number): void {
    const { model } = this;
    let heading: number;
    if (c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP') {
      heading = model.pit.headingAt(c.pitS);
      const k = model.pit.curvatureAt(c.pitS);
      c.steer = clamp(Math.atan(3.4 * k) * 1.4, -0.45, 0.45);
    } else if (c.parked) {
      return;
    } else {
      const latV = (c.latTarget - c.lat) * 0.8;
      heading = model.track.headingAt(c.s) + (c.v > 1 ? Math.atan2(clamp(latV, -3, 3), c.v) : 0);
      const k = sampleArr(model.curv, model, c.s);
      c.steer = clamp(Math.atan(3.4 * k) * 1.6 + (c.v > 1 ? clamp(latV / c.v, -0.1, 0.1) : 0), -0.5, 0.5);
    }
    void dt;
    c.heading = heading;
  }

  private emitStatus(c: Car, at: number): void {
    const status = c.status;
    const occupancy: Occupancy = c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP' ? 'PIT_LANE' : c.mode === 'GARAGE' ? 'GARAGE' : 'ON_TRACK';
    c.occupancy = occupancy;
    this.emitter.emit(
      'DRIVER_STATUS',
      {
        sport: 'formula1',
        driver_id: c.id,
        status,
        occupancy,
        sector: occupancy === 'ON_TRACK' ? c.sector : null,
        driver_lap: Math.max(1, c.lapsDone + 1),
        quality: 'CONFIRMED',
        reason_key: status === 'RETIRED' ? 'status.retired' : null,
      },
      this.msAt(at),
      { periodId: this.periodId() },
    );
  }

  /* ------------------------------------------------------------ */
  /* Safety car                                                    */
  /* ------------------------------------------------------------ */

  private updateSafetyCar(dt: number): void {
    const sc = this.sc;
    if (sc.phase === 'NONE') return;
    const { model } = this;
    const pl = this.cfg.circuit.pitLane;
    if (sc.onPit) {
      sc.v = Math.min(model.pitLimit, sc.v);
      sc.pitS += sc.v * dt;
      if (sc.pitS >= model.circuit.pitLane.boxesStartS) {
        sc.phase = 'NONE';
        sc.onPit = false;
      }
      return;
    }
    const prof = sampleArr(model.vmax, model, sc.s);
    const leader = this.order.find((c) => c.mode === 'RACING');
    let vt = prof * 0.6;
    if (leader) {
      const gap = model.track.delta(leader.s, sc.s);
      // Wait for the leader to catch up when it is far behind.
      if (gap > 260) vt = prof * 0.45;
    }
    sc.v += clamp(vt - sc.v, -18 * dt, 8 * dt);
    const sPrev = sc.s;
    sc.s = model.track.wrap(sc.s + sc.v * dt);
    sc.lat += clamp(sampleArr(model.line, model, sc.s) * 0.3 - sc.lat, -1.5 * dt, 1.5 * dt);
    if (this.trackState === 'SC_ENDING' && crossed(sPrev, sc.s, pl.entryS, model.L)) {
      sc.onPit = true;
      sc.pitS = 0;
      sc.phase = 'IN';
    }
  }

  /* ------------------------------------------------------------ */
  /* Timing                                                        */
  /* ------------------------------------------------------------ */

  private updateGaps(t: number): void {
    for (const c of this.cars) {
      if (c.mode === 'RETIRED' || c.mode === 'STOPPING' || c.finished || c.lapsDone < 0) continue;
      const idx = Math.floor(this.progress(c) / LOOP_M);
      if (idx <= c.loopIdx) continue;
      for (let k = c.loopIdx + 1; k <= idx; k++) {
        const lt = this.leaderTimes.get(k);
        if (lt === undefined) {
          this.leaderTimes.set(k, t);
          c.gapMs = 0;
        } else c.gapMs = Math.round((t - lt) * 1000);
      }
      c.loopIdx = idx;
      // Overtake Mode detection (within 1 s of the car ahead at a zone's detection point).
      const zones = this.cfg.circuit.straightZones;
      for (let z = 0; z < zones.length; z++) {
        const zz = zones[z]!;
        if (Math.abs(this.model.track.delta(zz.detectionS, c.s)) < LOOP_M / 2 + 1 && c.boostZone !== z * 1000 + c.lapsDone) {
          c.boostZone = z * 1000 + c.lapsDone;
          const ahead = this.order[this.order.indexOf(c) - 1];
          c.boost = !!ahead && ahead.gapMs !== null && c.gapMs !== null && c.gapMs - ahead.gapMs < 1000 && this.trackState === 'GREEN' && c.lapsDone >= 2;
        }
      }
    }
  }

  private emitTiming(t: number, anchorLap: number | null): void {
    this.snapshotRev++;
    const order: TimingOrderEntry[] = this.order.map((c, i) => ({
      driver_id: c.id,
      position: i + 1,
      gap_to_leader_ms: i === 0 ? 0 : c.gapMs,
      interval_ms: i === 0 ? null : c.gapMs !== null && this.order[i - 1]!.gapMs !== null ? c.gapMs - this.order[i - 1]!.gapMs! : null,
      driver_laps: Math.max(0, c.lapsDone),
      activity: c.mode === 'RETIRED' || c.mode === 'STOPPING' ? 'RETIRED' : c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP' ? 'PIT' : 'RUNNING',
      best_lap_ms: c.bestLapMs,
    }));
    this.emitter.emit(
      'TIMING_ORDER',
      {
        sport: 'formula1',
        leader_lap: anchorLap ?? this.leaderLapsDone + 1,
        snapshot_revision: this.snapshotRev,
        order,
        anchor: anchorLap !== null ? { kind: 'LEADER_LAP_COMPLETED', lap: anchorLap } : null,
      },
      this.msAt(t),
      { periodId: this.periodId() },
    );
  }

  private detectBattles(t: number): void {
    if (Math.floor(t * 2) === Math.floor((t - SIM_DT) * 2)) return;
    if (this.trackState !== 'GREEN') return;
    for (let i = 1; i < this.order.length; i++) {
      const a = this.order[i - 1]!;
      const b = this.order[i]!;
      if (a.mode !== 'RACING' || b.mode !== 'RACING' || a.gapMs === null || b.gapMs === null) continue;
      const key = `${a.id}:${b.id}`;
      if (b.gapMs - a.gapMs < 700 && a.lapsDone === b.lapsDone) {
        const since = this.battles.get(key);
        if (since === undefined) this.battles.set(key, t);
        else if (t - since > 6 && t - since < 6.6) this.moment('BATTLE', t, a.lapsDone + 1, [b.id, a.id]);
      } else this.battles.delete(key);
    }
  }

  private updateFinish(t: number): void {
    if (this.chequeredT === 0 || this.finished) return;
    const running = this.cars.filter((c) => !c.finished && (c.mode === 'RACING' || c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP'));
    if ((running.length === 0 || t - this.chequeredT > 150) && this.classifiedT === 0) {
      for (const c of running) {
        c.finished = true;
        c.finishT = t;
        c.mode = 'FINISHED';
      }
      this.classifiedT = t;
      this.emitSession('FINISHED', t);
      this.emitTiming(t, null);
      this.publishClassification(t, 1, true);
    }
    if (this.classifiedT > 0 && this.finalisedT === 0 && t - this.classifiedT > 45) {
      this.finalisedT = t;
      let rev = 1;
      const chance = this.cfg.scenario?.penaltyChance ?? 0.35;
      if (this.rng.chance(chance)) {
        const candidates = this.order.filter((c) => c.status === 'ACTIVE' && c.totalTimeMs !== null).slice(2, 12);
        const pen = candidates.length ? this.rng.pick(candidates) : null;
        if (pen) {
          pen.penaltyMs = 5000;
          rev = 2;
        }
      }
      this.publishClassification(t, rev, false);
      this.emitSession('FINALISED', t);
      this.finished = true;
    }
  }

  private classificationEntries(): ClassificationEntry[] {
    const L = this.totalLaps;
    const list = [...this.order];
    const finishedCars = list.filter((c) => c.finished && c.status === 'ACTIVE');
    // Apply time penalties among cars on the same lap count.
    finishedCars.sort((a, b) => {
      if (a.lapsDone !== b.lapsDone) return b.lapsDone - a.lapsDone;
      return a.finishT + a.penaltyMs / 1000 - (b.finishT + b.penaltyMs / 1000);
    });
    const rest = list.filter((c) => !finishedCars.includes(c));
    rest.sort((a, b) => b.lapsDone - a.lapsDone);
    const leaderTime = finishedCars[0] ? (finishedCars[0].finishT - this.lightsOutT) * 1000 : 0;
    const entries: ClassificationEntry[] = [];
    let pos = 1;
    for (const c of [...finishedCars, ...rest]) {
      const classified = c.lapsDone >= Math.ceil(L * 0.9);
      const total = c.finished ? Math.round((c.finishT - this.lightsOutT) * 1000 + c.penaltyMs) : null;
      entries.push({
        driver_id: c.id,
        position: classified ? pos++ : null,
        status: classified ? 'CLASSIFIED' : 'NOT_CLASSIFIED',
        laps: Math.max(0, c.lapsDone),
        best_lap_ms: c.bestLapMs,
        total_time_ms: total,
        gap_ms: total !== null && c.lapsDone === finishedCars[0]?.lapsDone ? Math.round(total - leaderTime) : null,
      });
    }
    return entries;
  }

  private publishClassification(t: number, revision: number, provisional: boolean): void {
    const entries = this.classificationEntries();
    const ev = this.emitter.emit(
      'CLASSIFICATION_PUBLISHED',
      { sport: 'formula1', scope: 'SESSION', classification_revision: revision, provisional, entries },
      this.msAt(t),
      { periodId: this.periodId(), sourceId: `src_classification_${this.cfg.manifest.session_id}`, revision: provisional ? 1 : revision + 1 },
    );
    if (!provisional && revision > 1) {
      const pen = this.cars.find((c) => c.penaltyMs > 0);
      this.emitter.emit(
        'EVENT_CORRECTED',
        {
          sport: 'formula1',
          corrected_source_event_id: ev.source_event_id,
          previous_revision: '1',
          new_revision: ev.source_revision,
          reason_key: 'correction.time_penalty',
          before: { driver: pen?.id ?? null },
          after: { driver: pen?.id ?? null, penalty_ms: pen?.penaltyMs ?? 0 },
        },
        this.msAt(t),
        { periodId: this.periodId() },
      );
    }
  }

  /* ------------------------------------------------------------ */
  /* Moments + snapshots                                           */
  /* ------------------------------------------------------------ */

  private moment(kind: MomentKind, t: number, lap: number, drivers: string[], data?: Moment['data']): void {
    this.momentSeq++;
    this.moments.push({ id: `m${this.momentSeq}`, kind, t, atMs: this.msAt(t), lap, drivers, data });
    if (this.moments.length > 200) this.moments.splice(0, this.moments.length - 200);
  }

  frame(): SimFrame {
    const { model } = this;
    const cars: CarFrame[] = this.cars.map((c) => {
      let x: number;
      let y: number;
      if (c.parked) {
        x = c.parked.x;
        y = c.parked.y;
      } else if (c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP') {
        const p = model.pit.pointAt(c.pitS, 0);
        x = p[0];
        y = p[1];
      } else {
        const p = model.track.pointAt(c.s, c.lat);
        x = p[0];
        y = p[1];
      }
      const inZone = zoneAt(model, c.s);
      const visible = !(c.finished && this.t - c.finishT > 50);
      return {
        id: c.id,
        x,
        y,
        heading: c.parked ? c.parked.heading : c.heading,
        speed: c.v,
        brake: c.brake,
        steer: c.steer,
        aeroOpen: inZone && c.v > 45 && this.trackState === 'GREEN' && c.mode === 'RACING',
        boost: c.boost,
        tyre: c.tyre,
        visible,
        inPit: c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP',
        s: c.s,
      };
    });
    let safetyCar: SafetyCarFrame | null = null;
    if (this.sc.phase !== 'NONE') {
      const p = this.sc.onPit ? model.pit.pointAt(this.sc.pitS) : model.track.pointAt(this.sc.s, this.sc.lat);
      safetyCar = {
        kind: 'SC',
        x: p[0],
        y: p[1],
        heading: this.sc.onPit ? model.pit.headingAt(this.sc.pitS) : model.track.headingAt(this.sc.s),
        speed: this.sc.v,
        lights: this.sc.lights,
        visible: true,
      };
    }
    return { t: this.t, cars, safetyCar, lights: this.lights };
  }

  live(): LiveState {
    const lapL = this.model.L;
    const cars: LiveCar[] = this.order.map((c, i) => {
      const ahead = this.order[i - 1];
      return {
        id: c.id,
        position: i + 1,
        driverLaps: Math.max(0, c.lapsDone),
        gapMs: i === 0 ? 0 : c.gapMs,
        intervalMs: i === 0 || !ahead || ahead.gapMs === null || c.gapMs === null ? null : c.gapMs - ahead.gapMs,
        lastLapMs: c.lastLapMs,
        bestLapMs: c.bestLapMs,
        sectorTimes: [...c.sectorTimes] as LiveCar['sectorTimes'],
        sectorBest: [...c.sectorBest] as LiveCar['sectorBest'],
        sector: c.sector,
        status: c.status,
        occupancy: c.occupancy,
        mode: c.mode,
        tyre: c.tyre,
        tyreAgeLaps: c.tyreAge,
        tyreWear: Math.min(1, c.tyreAge / this.tyreLife(c.tyre)),
        stints: c.stints.map((s) => ({ ...s })),
        pitStops: c.pitStops,
        speedKph: Math.round(c.v * 3.6),
        gridPosition: c.gridPos,
        boost: c.boost,
        lapFraction: c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP' ? (((this.progress(c) % lapL) + lapL) % lapL) / lapL : c.s / lapL,
      };
    });
    return {
      sessionId: this.cfg.manifest.session_id,
      t: this.t,
      nowMs: this.nowMs,
      status: this.status,
      trackState: this.trackState,
      sectorFlags: [...this.sectorFlagOn] as [boolean, boolean, boolean],
      leaderLap: Math.min(this.totalLaps, this.leaderLapsDone + 1),
      totalLaps: this.totalLaps,
      cars,
      fastestLap: this.fastest,
      segment: null,
      weather: this.weather,
      lights: this.lights,
      moments: this.moments.slice(-40),
      stale: false,
    };
  }
}

function rankClass(c: Car): number {
  if (c.status === 'DSQ') return 3;
  if (c.mode === 'RETIRED' || c.mode === 'STOPPING') return 2;
  return 0;
}

function crossed(sPrev: number, sNow: number, boundary: number, L: number): boolean {
  if (sPrev === sNow) return false;
  if (sNow >= sPrev) return sPrev < boundary && sNow >= boundary;
  // Wrapped past the control line (only plausible for small forward steps).
  if (sPrev - sNow < L / 2) return false;
  return boundary > sPrev || boundary <= sNow;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function supplierSpec(circuitId: string, compound: Compound): string | null {
  const hard: Record<string, [string, string, string]> = {
    'bh-2002': ['C3', 'C2', 'C1'],
    'gb-1948': ['C3', 'C2', 'C1'],
    'jp-1962': ['C3', 'C2', 'C1'],
    'mc-1929': ['C6', 'C5', 'C4'],
    'sg-2008': ['C5', 'C4', 'C3'],
    'us-2023': ['C5', 'C4', 'C3'],
  };
  const set = hard[circuitId] ?? ['C4', 'C3', 'C2'];
  if (compound === 'SOFT') return set[0];
  if (compound === 'MEDIUM') return set[1];
  if (compound === 'HARD') return set[2];
  return null;
}
