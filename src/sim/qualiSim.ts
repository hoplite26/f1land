import type { CircuitData } from '@/data/circuits/types';
import { sectorAt } from '@/data/circuits/geometry';
import { DRIVER_BY_ID, TEAM_BY_ID, TEAMS, type Driver, type Team } from '@/data/teams';
import type { ClassificationEntry, Compound, Occupancy, SegmentId, SegmentManifest, SessionManifest, SessionStatus, TrackState } from '@/domain/types';
import { EventEmitter } from './emitter';
import { Rng } from './rng';
import { buildTrackModel, sampleArr, zoneAt, type TrackModel } from './trackModel';
import type { CarFrame, LiveCar, LiveState, Moment, MomentKind, SimFrame } from './types';
import { SIM_DT } from './raceSim';

/**
 * Qualifying / Sprint Qualifying / Practice simulator for the DEMO contour.
 * Segment durations and eliminations come from the session manifest
 * (ruleset config), never from UI code (F1-006).
 */
export interface QualiSimConfig {
  manifest: SessionManifest;
  circuit: CircuitData;
  seed: string;
  startMs: number;
}

type Phase = 'GARAGE' | 'PIT_OUT' | 'OUT_LAP' | 'PUSH' | 'COOL' | 'PIT_IN' | 'DONE';

interface QCar {
  id: string;
  driver: Driver;
  team: Team;
  teamIdx: number;
  phase: Phase;
  s: number;
  lat: number;
  latTarget: number;
  v: number;
  pitS: number;
  perf: number;
  lapStartT: number;
  sectorStartT: number;
  sector: 1 | 2 | 3;
  lapNo: number;
  lastLapMs: number | null;
  segBest: Partial<Record<SegmentId, number>>;
  bestLapMs: number | null;
  sectorTimes: [number | null, number | null, number | null];
  sectorBest: [boolean, boolean, boolean];
  nextRunT: number;
  runs: number;
  eliminatedIn: SegmentId | null;
  invalidThisLap: boolean;
  brake: number;
  heading: number;
  steer: number;
  pushLaps: number;
  lapNoise: number;
  occupancy: Occupancy;
}

export class QualiSim {
  readonly emitter: EventEmitter;
  readonly model: TrackModel;
  readonly cfg: QualiSimConfig;
  readonly segments: SegmentManifest[];
  t = 0;
  status: SessionStatus = 'NOT_STARTED';
  trackState: TrackState = 'GREEN';
  finished = false;
  private rng: Rng;
  private cars: QCar[] = [];
  private segIdx = -1;
  private segState: 'WAITING' | 'RUNNING' | 'ENDED' = 'WAITING';
  private segEndT = 0;
  private segStartT: number[] = [];
  private moments: Moment[] = [];
  private momentSeq = 0;
  private sectorBestMs: [number, number, number] = [Infinity, Infinity, Infinity];
  private fastest: LiveState['fastestLap'] = null;
  private evolution = 1;
  private snapshotRev = 0;
  private nextTimingT = 3;
  private classifyPendingT = 0;
  private weather: LiveState['weather'];

  constructor(cfg: QualiSimConfig) {
    this.cfg = cfg;
    this.model = buildTrackModel(cfg.circuit);
    this.rng = new Rng(cfg.seed);
    this.emitter = new EventEmitter(cfg.manifest.event_id);
    this.segments = cfg.manifest.segments ?? [];
    const start = Date.parse(cfg.manifest.planned_start_at);
    this.segStartT = this.segments.map((s) => (Date.parse(s.planned_start_at) - start) / 1000);
    const night = cfg.circuit.timeOfDay !== 'day';
    const airC = Math.round(this.rng.range(night ? 22 : 17, night ? 28 : 30));
    this.weather = { airC, trackC: airC + Math.round(this.rng.range(4, 14)), condition: 'DRY' };
    const minCar = Math.min(...TEAMS.map((t) => t.carPace));
    const maxCar = Math.max(...TEAMS.map((t) => t.carPace));
    for (const id of cfg.manifest.participants) {
      const driver = DRIVER_BY_ID[id]!;
      const team = TEAM_BY_ID[driver.teamId]!;
      const carNorm = (team.carPace - minCar) / Math.max(1e-6, maxCar - minCar);
      const drvNorm = (driver.pace - 0.85) / 0.14;
      this.cars.push({
        id,
        driver,
        team,
        teamIdx: Math.max(0, TEAMS.findIndex((t) => t.id === team.id)),
        phase: 'GARAGE',
        s: 0,
        lat: 0,
        latTarget: 0,
        v: 0,
        pitS: 0,
        perf: 0.984 + 0.012 * carNorm + 0.006 * drvNorm,
        lapStartT: 0,
        sectorStartT: 0,
        sector: 1,
        lapNo: 0,
        lastLapMs: null,
        segBest: {},
        bestLapMs: null,
        sectorTimes: [null, null, null],
        sectorBest: [false, false, false],
        nextRunT: 0,
        runs: 0,
        eliminatedIn: null,
        invalidThisLap: false,
        brake: 0,
        heading: 0,
        steer: 0,
        pushLaps: 1,
        lapNoise: 1,
        occupancy: 'GARAGE',
      });
    }
    // Initial occupancy snapshot: everybody in the garage (F1-068, QA21).
    for (const c of this.cars) this.emitStatus(c, 0);
  }

  get nowMs(): number {
    return this.cfg.startMs + this.t * 1000;
  }

  private msAt(t: number): number {
    return this.cfg.startMs + t * 1000;
  }

  get currentSegment(): SegmentManifest | null {
    return this.segments[this.segIdx] ?? null;
  }

  advanceTo(tTarget: number): void {
    while (this.t + SIM_DT <= tTarget + 1e-9) this.step(SIM_DT);
  }

  private periodId(): string {
    return this.currentSegment?.segment_id ?? (this.cfg.manifest.session_type === 'PRACTICE' ? 'practice' : 'qualifying');
  }

  private step(dt: number): void {
    const prevT = this.t;
    this.t += dt;
    const t = this.t;
    this.updateSegments(t);
    const running = this.cars.filter((c) => c.phase !== 'GARAGE' && c.phase !== 'DONE' && c.phase !== 'PIT_OUT' && c.phase !== 'PIT_IN');
    running.sort((a, b) => a.s - b.s);
    for (const c of this.cars) this.updateCar(c, dt, prevT, running);
    if (t >= this.nextTimingT && this.segState === 'RUNNING') {
      this.nextTimingT = t + 5;
      this.emitTiming(t);
    }
  }

  private updateSegments(t: number): void {
    const next = this.segIdx + 1;
    if (this.segState !== 'RUNNING' && next < this.segments.length && t >= this.segStartT[next]!) {
      if (this.classifyPendingT > 0) this.classifySegment(t);
      this.segIdx = next;
      const seg = this.segments[next]!;
      this.segState = 'RUNNING';
      this.segEndT = this.segStartT[next]! + seg.duration_ms / 1000;
      if (this.status === 'NOT_STARTED') {
        this.status = 'STARTED';
      }
      this.emitter.emit(
        'SESSION_STATE',
        { sport: 'formula1', status: 'STARTED', segment_id: seg.segment_id, segment_state: 'STARTED', remaining_ms: seg.duration_ms },
        this.msAt(t),
        { periodId: seg.segment_id },
      );
      this.moment('SEGMENT', t, [], { segment: seg.segment_id, state: 'STARTED' });
      // Schedule runs for active cars.
      const dur = seg.duration_ms / 1000;
      for (const c of this.cars) {
        if (c.eliminatedIn) continue;
        c.runs = 0;
        c.nextRunT = t + this.rng.range(dur * 0.02, dur * 0.45);
      }
    }
    if (this.segState === 'RUNNING' && t >= this.segEndT) {
      this.segState = 'ENDED';
      const seg = this.currentSegment!;
      this.emitter.emit(
        'SESSION_STATE',
        { sport: 'formula1', status: 'STARTED', segment_id: seg.segment_id, segment_state: 'ENDED', remaining_ms: 0 },
        this.msAt(t),
        { periodId: seg.segment_id },
      );
      this.trackState = 'CHEQUERED';
      this.classifyPendingT = t;
    }
    // Classification once every car that started a lap before the flag has finished it.
    if (this.segState === 'ENDED' && this.classifyPendingT > 0) {
      const onLap = this.cars.some((c) => c.phase === 'PUSH');
      if (!onLap || t - this.classifyPendingT > 150) this.classifySegment(t);
    }
  }

  private classifySegment(t: number): void {
    const seg = this.currentSegment;
    this.classifyPendingT = 0;
    if (!seg) return;
    this.trackState = 'GREEN';
    const active = this.cars.filter((c) => !c.eliminatedIn);
    active.sort((a, b) => (a.segBest[seg.segment_id] ?? Infinity) - (b.segBest[seg.segment_id] ?? Infinity));
    const cut = active.length - seg.eliminated;
    const entries: ClassificationEntry[] = active.map((c, i) => ({
      driver_id: c.id,
      position: i + 1,
      status: 'CLASSIFIED',
      laps: c.lapNo,
      best_lap_ms: c.segBest[seg.segment_id] ?? null,
      total_time_ms: null,
      gap_ms: null,
      progressed: seg.eliminated > 0 ? i < cut : null,
    }));
    for (let i = cut; i < active.length && seg.eliminated > 0; i++) {
      active[i]!.eliminatedIn = seg.segment_id;
      this.moment('ELIMINATED', t, [active[i]!.id], { segment: seg.segment_id });
    }
    this.emitter.emit(
      'CLASSIFICATION_PUBLISHED',
      { sport: 'formula1', scope: 'SEGMENT', segment_id: seg.segment_id, classification_revision: 1, provisional: false, entries },
      this.msAt(t),
      { periodId: seg.segment_id, sourceId: `src_cls_${this.cfg.manifest.session_id}_${seg.segment_id}` },
    );
    if (this.segIdx === this.segments.length - 1) {
      // Final session classification: last part order, then earlier eliminations.
      const order = [...active];
      const rest = this.cars
        .filter((c) => c.eliminatedIn && !active.includes(c))
        .sort((a, b) => {
          const ia = this.segments.findIndex((s) => s.segment_id === a.eliminatedIn);
          const ib = this.segments.findIndex((s) => s.segment_id === b.eliminatedIn);
          if (ia !== ib) return ib - ia;
          return (a.segBest[a.eliminatedIn!] ?? Infinity) - (b.segBest[b.eliminatedIn!] ?? Infinity);
        });
      const all = [...order, ...rest];
      this.emitter.emit(
        'CLASSIFICATION_PUBLISHED',
        {
          sport: 'formula1',
          scope: 'SESSION',
          classification_revision: 1,
          provisional: false,
          entries: all.map((c, i) => ({ driver_id: c.id, position: i + 1, status: 'CLASSIFIED', laps: c.lapNo, best_lap_ms: c.bestLapMs, total_time_ms: null, gap_ms: null })),
        },
        this.msAt(t + 1),
        { periodId: 'qualifying', sourceId: `src_cls_${this.cfg.manifest.session_id}` },
      );
      this.emitter.emit('SESSION_STATE', { sport: 'formula1', status: 'FINISHED' }, this.msAt(t + 1), { periodId: 'qualifying' });
      this.status = 'FINISHED';
      this.finished = true;
    }
  }

  private updateCar(c: QCar, dt: number, prevT: number, running: QCar[]): void {
    const { model } = this;
    const t = this.t;
    const pl = this.cfg.circuit.pitLane;
    const boxS = model.boxS[c.teamIdx % model.boxS.length]!;
    switch (c.phase) {
      case 'GARAGE': {
        if (this.segState === 'RUNNING' && !c.eliminatedIn && t >= c.nextRunT && t < this.segEndT - 70 && c.runs < 3) {
          c.phase = 'PIT_OUT';
          c.pitS = boxS;
          c.v = 0;
          c.runs++;
          c.pushLaps = this.rng.chance(0.25) ? 2 : 1;
          this.emitStatus(c, t);
        }
        return;
      }
      case 'PIT_OUT':
      case 'PIT_IN': {
        const target = c.phase === 'PIT_IN' && c.pitS < boxS ? Math.min(model.pitLimit, Math.sqrt(2 * 6 * Math.max(0, boxS - c.pitS)) + 0.3) : model.pitLimit;
        c.v += clamp(target - c.v, -12 * dt, 7 * dt);
        c.pitS += c.v * dt;
        c.heading = model.pit.headingAt(c.pitS);
        c.brake = target < c.v ? 0.6 : 0;
        if (c.phase === 'PIT_IN' && c.pitS >= boxS - 0.5) {
          c.phase = 'GARAGE';
          c.v = 0;
          const dur = (this.currentSegment?.duration_ms ?? 600000) / 1000;
          c.nextRunT = t + this.rng.range(dur * 0.12, dur * 0.3);
          if (this.segState !== 'RUNNING') c.nextRunT = Infinity;
          this.emitStatus(c, t);
        } else if (c.phase === 'PIT_OUT' && c.pitS >= model.pit.length) {
          c.phase = 'OUT_LAP';
          c.s = pl.exitS;
          c.lat = 0;
          c.sector = sectorAt(this.cfg.circuit, c.s);
          this.emitStatus(c, t);
        }
        return;
      }
      default:
        break;
    }
    // On track.
    const sPrev = c.s;
    const factor = c.phase === 'PUSH' ? c.perf * this.evolution * c.lapNoise : c.phase === 'OUT_LAP' ? 0.8 : 0.72;
    let vt = sampleArr(model.vmax, model, c.s) * factor * (c.phase === 'PUSH' ? 1.012 : 1);
    if (c.phase === 'PUSH' && zoneAt(model, c.s)) vt *= 1.004;
    // Follow cars in the same lane; slow cars move aside for pushing cars.
    const idx = running.indexOf(c);
    for (let k = 1; k < Math.min(6, running.length); k++) {
      const o = running[(idx + k) % running.length]!;
      const gap = model.track.delta(c.s, o.s);
      if (gap <= 0 || gap > 80) continue;
      if (c.phase === 'PUSH' && o.phase !== 'PUSH') {
        o.latTarget = (c.lat >= 0 ? -1 : 1) * (model.halfWidth - 1.6);
        continue;
      }
      if (Math.abs(o.lat - c.lat) < 2.3) vt = Math.min(vt, o.v + (gap - 14) * 1.3);
    }
    if (c.phase === 'PUSH' || c.latTarget === 0 || Math.abs(c.latTarget) < model.halfWidth - 2) c.latTarget = sampleArr(model.line, model, c.s) * (c.phase === 'PUSH' ? 1 : 0.5);
    const acc = c.v < vt ? Math.min((13.5 - 0.115 * c.v) * dt, vt - c.v) : -Math.min((22 + 0.0042 * c.v * c.v) * dt, c.v - vt);
    c.v = Math.max(0, c.v + acc);
    c.brake = acc < -4 * dt ? Math.min(1, -acc / (30 * dt)) : 0;
    c.s = model.track.wrap(c.s + c.v * dt);
    c.lat += clamp(c.latTarget - c.lat, -2.4 * dt, 2.4 * dt);
    c.heading = model.track.headingAt(c.s);
    c.steer = clamp(Math.atan(3.4 * sampleArr(model.curv, model, c.s)) * 1.6, -0.5, 0.5);

    // Pit entry at the end of the cool-down lap.
    if (c.phase === 'COOL' && crossedS(sPrev, c.s, pl.entryS, model.L)) {
      c.phase = 'PIT_IN';
      c.pitS = 0;
      this.emitStatus(c, t);
      return;
    }
    const sec = this.cfg.circuit.sectors;
    const tAt = (b: number) => {
      const d = model.track.delta(sPrev, b);
      const tr = model.track.delta(sPrev, c.s);
      return prevT + (tr > 0 ? (d / tr) * dt : 0);
    };
    for (const b of [sec[1].startS, sec[2].startS]) {
      if (crossedS(sPrev, c.s, b, model.L)) {
        const tc = tAt(b);
        const n = (b === sec[1].startS ? 1 : 2) as 1 | 2;
        this.sectorDone(c, n, tc);
        c.sector = (n + 1) as 2 | 3;
        this.emitStatus(c, tc);
      }
    }
    if (crossedS(sPrev, c.s, 0, model.L)) {
      const tc = tAt(0);
      this.lineCrossed(c, tc);
    }
  }

  private sectorDone(c: QCar, sector: 1 | 2 | 3, tc: number): void {
    const ms = Math.round((tc - c.sectorStartT) * 1000);
    if (c.phase === 'PUSH') {
      c.sectorTimes[sector - 1] = ms;
      if (sector === 1) {
        c.sectorTimes[1] = null;
        c.sectorTimes[2] = null;
      }
      const best = ms < this.sectorBestMs[sector - 1]!;
      if (best) this.sectorBestMs[sector - 1] = ms;
      c.sectorBest[sector - 1] = best;
      this.emitter.emit(
        'SECTOR_COMPLETED',
        {
          sport: 'formula1',
          driver_id: c.id,
          driver_lap: c.lapNo + 1,
          sector,
          sector_time_ms: ms,
          valid: !c.invalidThisLap,
          started_at: new Date(Math.round(this.msAt(c.sectorStartT))).toISOString(),
          neutralised: false,
          segment_id: this.currentSegment?.segment_id ?? null,
        },
        this.msAt(tc),
        { periodId: this.periodId(), attemptId: `${c.id}_l${c.lapNo + 1}_s${sector}` },
      );
    }
    c.sectorStartT = tc;
  }

  private lineCrossed(c: QCar, tc: number): void {
    if (c.phase === 'OUT_LAP') {
      c.phase = this.segState === 'RUNNING' ? 'PUSH' : 'COOL';
      c.lapStartT = tc;
      c.sectorStartT = tc;
      c.sector = 1;
      c.invalidThisLap = this.rng.chance(0.07);
      c.lapNoise = 1 + this.rng.gauss(0, 0.0028 * (1.3 - c.driver.consistency));
      this.emitStatus(c, tc);
      return;
    }
    if (c.phase === 'PUSH') {
      this.sectorDone(c, 3, tc);
      const ms = Math.round((tc - c.lapStartT) * 1000);
      c.lapNo++;
      c.lastLapMs = ms;
      const seg = this.currentSegment;
      const valid = !c.invalidThisLap;
      this.emitter.emit(
        'LAP_COMPLETED',
        {
          sport: 'formula1',
          driver_id: c.id,
          driver_lap: c.lapNo,
          leader_lap: c.lapNo,
          lap_time_ms: ms,
          valid,
          started_at: new Date(Math.round(this.msAt(c.lapStartT))).toISOString(),
          neutralised: false,
          pit_in_lap: false,
          pit_out_lap: false,
          segment_id: seg?.segment_id ?? null,
        },
        this.msAt(tc),
        { periodId: this.periodId(), attemptId: `${c.id}_l${c.lapNo}` },
      );
      if (!valid) {
        this.emitter.emit(
          'LAP_INVALIDATED',
          { sport: 'formula1', driver_id: c.id, driver_lap: c.lapNo, lap_attempt_id: `${c.id}_l${c.lapNo}`, reason: 'TRACK_LIMITS', segment_id: seg?.segment_id ?? null },
          this.msAt(tc + 4),
          { periodId: this.periodId(), attemptId: `${c.id}_l${c.lapNo}` },
        );
        this.moment('TRACK_LIMITS', tc, [c.id], { ms });
      } else if (seg) {
        const prev = c.segBest[seg.segment_id];
        if (prev === undefined || ms < prev) c.segBest[seg.segment_id] = ms;
        if (c.bestLapMs === null || ms < c.bestLapMs) c.bestLapMs = ms;
        if (!this.fastest || ms < this.fastest.ms) {
          this.fastest = { driverId: c.id, ms, lap: c.lapNo };
          this.moment('FASTEST_LAP', tc, [c.id], { ms });
        }
      }
      this.evolution = Math.min(1.006, this.evolution + 0.00012);
      c.pushLaps--;
      if (c.pushLaps > 0 && this.segState === 'RUNNING') {
        c.lapStartT = tc;
        c.sectorStartT = tc;
        c.invalidThisLap = this.rng.chance(0.07);
        c.lapNoise = 1 + this.rng.gauss(0, 0.0028 * (1.3 - c.driver.consistency));
      } else {
        c.phase = 'COOL';
      }
      c.sector = 1;
      this.emitStatus(c, tc);
    }
  }

  private emitStatus(c: QCar, at: number): void {
    const occupancy: Occupancy = c.phase === 'GARAGE' || c.phase === 'DONE' ? 'GARAGE' : c.phase === 'PIT_OUT' || c.phase === 'PIT_IN' ? 'PIT_LANE' : 'ON_TRACK';
    c.occupancy = occupancy;
    this.emitter.emit(
      'DRIVER_STATUS',
      { sport: 'formula1', driver_id: c.id, status: 'ACTIVE', occupancy, sector: occupancy === 'ON_TRACK' ? c.sector : null, driver_lap: c.lapNo + 1, quality: 'CONFIRMED' },
      this.msAt(at),
      { periodId: this.periodId() },
    );
  }

  private sortedCars(): QCar[] {
    const seg = this.currentSegment?.segment_id;
    const segOrder = (c: QCar) => (c.eliminatedIn ? this.segments.findIndex((s) => s.segment_id === c.eliminatedIn) : 99);
    return [...this.cars].sort((a, b) => {
      const ea = segOrder(a);
      const eb = segOrder(b);
      if (ea !== eb) return eb - ea;
      const key = a.eliminatedIn ?? seg;
      const ta = key ? a.segBest[key] ?? Infinity : Infinity;
      const tb = key ? b.segBest[key] ?? Infinity : Infinity;
      if (ta !== tb) return ta - tb;
      return a.driver.number - b.driver.number;
    });
  }

  private emitTiming(t: number): void {
    this.snapshotRev++;
    const sorted = this.sortedCars();
    const seg = this.currentSegment?.segment_id;
    const best0 = seg ? sorted[0]?.segBest[seg] ?? null : null;
    this.emitter.emit(
      'TIMING_ORDER',
      {
        sport: 'formula1',
        leader_lap: 0,
        snapshot_revision: this.snapshotRev,
        order: sorted.map((c, i) => {
          const b = seg ? c.segBest[c.eliminatedIn ?? seg] ?? null : null;
          return {
            driver_id: c.id,
            position: i + 1,
            gap_to_leader_ms: b !== null && best0 !== null ? b - best0 : null,
            interval_ms: null,
            driver_laps: c.lapNo,
            activity: c.occupancy === 'GARAGE' ? 'GARAGE' : c.occupancy === 'PIT_LANE' ? 'PIT' : 'RUNNING',
            best_lap_ms: c.bestLapMs,
          };
        }),
      },
      this.msAt(t),
      { periodId: this.periodId() },
    );
  }

  private moment(kind: MomentKind, t: number, drivers: string[], data?: Moment['data']): void {
    this.momentSeq++;
    this.moments.push({ id: `q${this.momentSeq}`, kind, t, atMs: this.msAt(t), lap: 0, drivers, data });
    if (this.moments.length > 200) this.moments.splice(0, this.moments.length - 200);
  }

  frame(): SimFrame {
    const { model } = this;
    const cars: CarFrame[] = this.cars.map((c) => {
      const onPit = c.phase === 'PIT_IN' || c.phase === 'PIT_OUT';
      const p = onPit ? model.pit.pointAt(c.pitS) : c.phase === 'GARAGE' || c.phase === 'DONE' ? model.pit.pointAt(model.boxS[c.teamIdx % model.boxS.length]!, -9) : model.track.pointAt(c.s, c.lat);
      return {
        id: c.id,
        x: p[0],
        y: p[1],
        heading: c.phase === 'GARAGE' ? model.pit.headingAt(model.boxS[c.teamIdx % model.boxS.length]!) + Math.PI / 2 : c.heading,
        speed: c.v,
        brake: c.brake,
        steer: c.steer,
        aeroOpen: !onPit && c.phase !== 'GARAGE' && zoneAt(model, c.s) && c.v > 45,
        boost: false,
        tyre: 'SOFT' as Compound,
        visible: c.phase !== 'GARAGE' && c.phase !== 'DONE',
        inPit: onPit || c.phase === 'GARAGE',
        s: c.s,
      };
    });
    return { t: this.t, cars, safetyCar: null, lights: 'off' };
  }

  live(): LiveState {
    const sorted = this.sortedCars();
    const seg = this.currentSegment;
    const remainingMs = seg ? Math.max(0, Math.round((this.segEndT - this.t) * 1000)) : 0;
    const active = this.cars.filter((c) => !c.eliminatedIn).length;
    const best0 = seg ? sorted[0]?.segBest[seg.segment_id] ?? null : null;
    const cars: LiveCar[] = sorted.map((c, i) => {
      const key = c.eliminatedIn ?? seg?.segment_id;
      const b = key ? c.segBest[key] ?? null : null;
      return {
        id: c.id,
        position: i + 1,
        driverLaps: c.lapNo,
        gapMs: b !== null && best0 !== null ? b - best0 : null,
        intervalMs: null,
        lastLapMs: c.lastLapMs,
        bestLapMs: c.bestLapMs,
        sectorTimes: [...c.sectorTimes] as LiveCar['sectorTimes'],
        sectorBest: [...c.sectorBest] as LiveCar['sectorBest'],
        sector: c.sector,
        status: 'ACTIVE',
        occupancy: c.occupancy,
        mode: c.phase === 'GARAGE' ? 'GARAGE' : c.phase === 'PIT_IN' || c.phase === 'PIT_OUT' ? 'PIT_LANE' : 'RACING',
        tyre: 'SOFT',
        tyreAgeLaps: 0,
        tyreWear: 0,
        stints: [],
        pitStops: 0,
        speedKph: Math.round(c.v * 3.6),
        gridPosition: i + 1,
        segmentBestMs: b,
        eliminatedIn: c.eliminatedIn,
        boost: false,
        lapFraction: c.s / this.model.L,
      };
    });
    return {
      sessionId: this.cfg.manifest.session_id,
      t: this.t,
      nowMs: this.nowMs,
      status: this.status,
      trackState: this.trackState,
      sectorFlags: [false, false, false],
      leaderLap: 0,
      totalLaps: null,
      cars,
      fastestLap: this.fastest,
      segment: seg
        ? {
            id: seg.segment_id,
            remainingMs,
            cutPosition: seg.eliminated > 0 ? active - seg.eliminated : active,
            state: this.segState === 'RUNNING' ? 'RUNNING' : this.segState === 'ENDED' ? 'ENDED' : 'WAITING',
          }
        : null,
      weather: this.weather,
      lights: 'off',
      moments: this.moments.slice(-40),
      stale: false,
    };
  }
}

function crossedS(sPrev: number, sNow: number, b: number, L: number): boolean {
  if (sNow >= sPrev) return sPrev < b && sNow >= b;
  if (sPrev - sNow < L / 2) return false;
  return b > sPrev || b <= sNow;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
