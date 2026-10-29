import { loadCircuit } from '@/data/circuits';
import type { CircuitData } from '@/data/circuits/types';
import type { AnyEvent, SessionManifest } from '@/domain/types';
import { RaceSim, SIM_DT } from '@/sim/raceSim';
import { QualiSim } from '@/sim/qualiSim';
import { buildTrackModel, type TrackModel } from '@/sim/trackModel';
import type { LiveState, SimFrame } from '@/sim/types';
import { buildManifest, channelLaps, cycleIndex, cycleLengthMs, cycleStartMs, getChannel, type DemoChannel } from './channels';

export type RunnerMode = 'live' | 'replay';

export interface RunnerSnapshot {
  live: LiveState;
  frame: SimFrame;
}

type Listener = (r: SessionRunner) => void;

/**
 * Drives one DEMO session: deterministic catch-up to the broadcast point,
 * then real-time stepping. Replay mode starts from the grid with a speed
 * multiplier and pause.
 */
export class SessionRunner {
  readonly channel: DemoChannel;
  circuit!: CircuitData;
  model!: TrackModel;
  manifest!: SessionManifest;
  sim!: RaceSim | QualiSim;
  mode: RunnerMode;
  cycle = 0;
  startMs = 0;
  cycleMs = 0;
  ready = false;
  catchingUp = true;
  progress = 0;
  speed = 1;
  paused = false;
  /** When true the adapter feed is treated as stale (F1-049 demo). */
  stale = false;
  /** Feed gaps [start, end) in session epoch ms. */
  gaps: Array<[number, number]> = [];
  private staleFrom = 0;

  setStale(on: boolean): void {
    if (on === this.stale) return;
    if (on) this.staleFrom = this.nowMs;
    else this.gaps.push([this.staleFrom, this.nowMs]);
    this.stale = on;
  }
  private replayBaseT = 0;
  private replayWall = 0;
  private lastFrameT = -1;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<(e: AnyEvent) => void>();
  private frameListeners = new Set<(f: SimFrame) => void>();
  private disposed = false;
  private liveCache: LiveState | null = null;
  private liveCacheT = -1;
  private targetT = 0;

  constructor(channelId: string, mode: RunnerMode = 'live') {
    this.channel = getChannel(channelId);
    this.mode = mode;
  }

  async init(nowMs = Date.now(), cycleOverride?: number): Promise<void> {
    this.circuit = await loadCircuit(this.channel.circuitId);
    this.model = buildTrackModel(this.circuit);
    this.cycleMs = cycleLengthMs({ ...this.channel, demoLaps: channelLaps(this.channel, this.circuit.laps, this.circuit.sprintLaps) }, this.model.lapTime);
    this.cycle = cycleOverride ?? cycleIndex(this.channel, nowMs, this.cycleMs);
    this.startMs = cycleStartMs(this.channel, this.cycle, this.cycleMs);
    const laps = this.channel.sessionType === 'GRAND_PRIX' || this.channel.sessionType === 'SPRINT' ? channelLaps(this.channel, this.circuit.laps, this.circuit.sprintLaps) : undefined;
    this.manifest = buildManifest(this.channel, this.cycle, this.startMs, this.circuit.layoutVersion, laps);
    const seed = `${this.channel.id}:${this.cycle}`;
    if (this.channel.sessionType === 'GRAND_PRIX' || this.channel.sessionType === 'SPRINT') {
      this.sim = new RaceSim({ manifest: this.manifest, circuit: this.circuit, seed, laps: laps!, startMs: this.startMs, scenario: this.channel.scenario });
    } else {
      this.sim = new QualiSim({ manifest: this.manifest, circuit: this.circuit, seed, startMs: this.startMs });
    }
    this.sim.emitter.onEvent((e) => {
      // Events produced while the feed is stale are lost (coverage gap, F1-020).
      if (!this.stale) this.eventListeners.forEach((l) => l(e));
    });
    if (this.mode === 'replay') {
      this.replayBaseT = 0;
      this.replayWall = nowMs;
      this.targetT = 0;
    } else {
      this.targetT = Math.max(0, (nowMs - this.startMs) / 1000);
    }
    this.ready = true;
  }

  /** Past events already emitted (for late subscribers such as the event store). */
  get events(): readonly AnyEvent[] {
    return this.sim.emitter.events;
  }

  onEvent(fn: (e: AnyEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onFrame(fn: (f: SimFrame) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Server "now" of the session (sim clock), epoch ms. */
  get nowMs(): number {
    return this.sim ? this.sim.nowMs : Date.now();
  }

  get t(): number {
    return this.sim ? this.sim.t : 0;
  }

  setSpeed(s: number): void {
    if (this.mode !== 'replay') return;
    this.replayBaseT = this.currentTarget(Date.now());
    this.replayWall = Date.now();
    this.speed = s;
  }

  setPaused(p: boolean): void {
    if (this.mode !== 'replay') return;
    this.replayBaseT = this.currentTarget(Date.now());
    this.replayWall = Date.now();
    this.paused = p;
  }

  private currentTarget(nowMs: number): number {
    if (this.mode === 'live') return Math.max(0, (nowMs - this.startMs) / 1000);
    if (this.paused) return this.replayBaseT;
    return this.replayBaseT + ((nowMs - this.replayWall) / 1000) * this.speed;
  }

  /** Advance the simulation; returns true when the cycle ended (live mode). */
  tick(nowMs: number, budgetMs = 10): boolean {
    if (!this.ready || this.disposed) return false;
    this.targetT = this.currentTarget(nowMs);
    const t0 = performance.now();
    const goal = this.targetT;
    if (goal - this.sim.t > 3) {
      // Catch-up in slices to keep the UI responsive.
      this.catchingUp = true;
      while (this.sim.t < goal && performance.now() - t0 < budgetMs) this.sim.advanceTo(Math.min(goal, this.sim.t + 20));
      this.progress = goal > 0 ? Math.min(1, this.sim.t / goal) : 1;
      if (goal - this.sim.t <= 3) this.catchingUp = false;
    } else {
      this.sim.advanceTo(goal);
      this.catchingUp = false;
      this.progress = 1;
    }
    if (!this.catchingUp && !this.stale && this.sim.t - this.lastFrameT >= SIM_DT * 0.999) {
      this.lastFrameT = this.sim.t;
      const f = this.sim.frame();
      this.frameListeners.forEach((l) => l(f));
    }
    this.listeners.forEach((l) => l(this));
    return this.mode === 'live' && nowMs > this.startMs + this.cycleMs;
  }

  live(): LiveState {
    if (!this.liveCache || this.liveCacheT !== this.sim.t) {
      this.liveCache = this.sim.live();
      this.liveCache.stale = this.stale;
      this.liveCacheT = this.sim.t;
    }
    return this.liveCache;
  }

  frame(): SimFrame {
    return this.sim.frame();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.eventListeners.clear();
    this.frameListeners.clear();
  }
}

/** Fast headless replay of a past cycle (used to settle entries offline). */
export async function replayToEnd(channelId: string, cycle: number, untilMs: number, onEvent: (e: AnyEvent) => void): Promise<SessionRunner> {
  const r = new SessionRunner(channelId, 'replay');
  await r.init(Date.now(), cycle);
  r.onEvent(onEvent);
  const goal = Math.max(0, (untilMs - r.startMs) / 1000);
  while (r.sim.t < goal && !r.sim.finished) {
    r.sim.advanceTo(Math.min(goal, r.sim.t + 30));
    await new Promise((res) => setTimeout(res, 0));
  }
  return r;
}
