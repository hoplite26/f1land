import { create } from 'zustand';
import { EventStore } from '@/domain/events/store';
import { createPool, planPoolTiming } from '@/domain/markets/factory';
import { getTemplate, type PoolParams } from '@/domain/markets/catalog';
import { isMarketAvailable } from '@/domain/capabilities';
import { advancePool, canAcceptEntry } from '@/domain/lifecycle';
import { settlePool } from '@/domain/settlement';
import type { AnyEvent, FeedCoverage, MarketId, Pool, SessionManifest } from '@/domain/types';
import type { LiveState } from '@/sim/types';
import { Rng } from '@/sim/rng';
import type { SessionRunner } from './runner';
import { RaceSim } from '@/sim/raceSim';
import { QualiSim } from '@/sim/qualiSim';

/**
 * DEMO pool service. Generates pools from the live situation, simulates
 * other players' stakes (shared pool model → multiplier estimate), drives
 * lifecycle via the domain core and settles from the canonical event store.
 */

export interface PoolBook {
  /** Stake per outcome (PULSE), including simulated players and the user. */
  stakes: Record<string, number>;
  players: number;
  /** Frozen at lock — final multipliers. */
  finalMultipliers: Record<string, number> | null;
}

export interface LivePool {
  pool: Pool;
  book: PoolBook;
  /** Display priority (featured first). */
  priority: number;
  /** Ids of drivers relevant to the pool (for the 3D focus). */
  focus: string[];
  sector?: 1 | 2 | 3;
  createdSimT: number;
  /** User's entry acceptance instants (for F1-017 contamination check). */
  acceptedAt: number[];
}

const RAKE = 0.06;

export function multiplier(book: PoolBook, outcomeId: string, extraStake = 0): number {
  const total = Object.values(book.stakes).reduce((a, b) => a + b, 0) + extraStake;
  const mine = (book.stakes[outcomeId] ?? 0) + extraStake;
  if (mine <= 0) return 50;
  return Math.max(1.02, Math.min(50, (total * (1 - RAKE)) / mine));
}

interface PoolStoreState {
  sessionId: string | null;
  pools: LivePool[];
  rev: number;
}

export const usePools = create<PoolStoreState>(() => ({ sessionId: null, pools: [], rev: 0 }));

export class PoolEngine {
  readonly runner: SessionRunner;
  readonly store = new EventStore();
  private pools: LivePool[] = [];
  private seq = 0;
  private rng: Rng;
  private lastGenT = -999;
  private sessionPoolsDone = new Set<string>();
  private settleListeners = new Set<(lp: LivePool, prev: Pool) => void>();
  private lastPublish = 0;
  private gaps: Array<[number, number]> = [];
  private disposed = false;

  constructor(runner: SessionRunner) {
    this.runner = runner;
    this.rng = new Rng(`${runner.manifest.session_id}:pools`);
    this.store.ingestMany(runner.events as AnyEvent[]);
    runner.onEvent((e) => this.store.ingest(e));
    usePools.setState({ sessionId: runner.manifest.session_id, pools: [], rev: 0 });
  }

  get manifest(): SessionManifest {
    return this.runner.manifest;
  }

  onSettle(fn: (lp: LivePool, prev: Pool) => void): () => void {
    this.settleListeners.add(fn);
    return () => this.settleListeners.delete(fn);
  }

  addGap(startMs: number, endMs: number): void {
    this.gaps.push([startMs, endMs]);
  }

  coverage(nowMs: number): FeedCoverage {
    const start = Date.parse(this.manifest.planned_start_at) - 60_000;
    const intervals: Array<[number, number]> = [];
    let cur = start;
    const gaps = [...this.gaps, ...this.runner.gaps];
    if (this.runner.stale) gaps.push([this.runner.nowMs - 1, nowMs + 1]);
    for (const [a, b] of gaps.sort((x, y) => x[0] - y[0])) {
      if (a > cur) intervals.push([cur, Math.min(a, nowMs)]);
      cur = Math.max(cur, b);
    }
    if (cur < nowMs) intervals.push([cur, nowMs]);
    return { intervals, watermark_ms: nowMs };
  }

  /** Restore a pool from a persisted entry snapshot (same session after reload). */
  adopt(pool: Pool): void {
    if (this.pools.some((p) => p.pool.pool_id === pool.pool_id)) return;
    this.pools.push({ pool, book: this.makeBook(pool, null), priority: 0, focus: [pool.subject.driver_a, pool.subject.driver_b].filter(Boolean) as string[], createdSimT: this.runner.t, acceptedAt: [] });
  }

  get(poolId: string): LivePool | undefined {
    return this.pools.find((p) => p.pool.pool_id === poolId);
  }

  all(): LivePool[] {
    return this.pools;
  }

  /** Register a confirmed user entry in the shared pool. */
  placeEntry(poolId: string, outcomeId: string, stake: number, nowMs: number): boolean {
    const lp = this.get(poolId);
    if (!lp || !canAcceptEntry(lp.pool, nowMs)) return false;
    lp.book.stakes[outcomeId] = (lp.book.stakes[outcomeId] ?? 0) + stake;
    lp.book.players += 1;
    lp.acceptedAt.push(nowMs);
    this.publish(true);
    return true;
  }

  tick(live: LiveState): void {
    if (this.disposed || this.runner.catchingUp) return;
    const now = this.runner.nowMs;
    const t = this.runner.t;
    const sessionStatus = live.status;
    // Generate.
    if (t - this.lastGenT > 14) {
      this.lastGenT = t;
      this.generate(live, now);
    }
    // Crowd joins & lifecycle.
    const canonical = this.store.canonical();
    const coverage = this.coverage(now);
    let changed = false;
    for (const lp of this.pools) {
      const prev = lp.pool;
      let p = advancePool(prev, now, { trackState: live.trackState, sessionStatus });
      if (p.status === 'OPEN' && p.intake_status === 'ACCEPTING' && this.rng.chance(0.25)) this.crowdJoin(lp, live);
      if ((p.status === 'LOCKED' || p.status === 'RESOLVING' || p.status === 'SETTLED' || p.status === 'VOID') && !lp.book.finalMultipliers) {
        lp.book.finalMultipliers = Object.fromEntries(p.outcomes.map((o) => [o.id, multiplier(lp.book, o.id)]));
      }
      if (p.status === 'LOCKED' || p.status === 'RESOLVING' || p.status === 'SETTLED' || (p.status === 'VOID' && p.settlement?.provisional)) {
        try {
          p = settlePool(p, { events: canonical, coverage, manifest: this.manifest, now_ms: now }, { accepted_at_ms: lp.acceptedAt });
        } catch (err) {
          console.warn('settle failed', p.pool_id, err);
        }
      }
      if (p !== prev) {
        lp.pool = p;
        changed = true;
        const revChanged = (p.settlement?.settlement_revision ?? 0) !== (prev.settlement?.settlement_revision ?? 0) || p.settlement?.provisional !== prev.settlement?.provisional || p.status !== prev.status;
        if (revChanged) this.settleListeners.forEach((l) => l(lp, prev));
      }
    }
    // Drop old finished pools without user interest (keep last 30).
    const finished = this.pools.filter((p) => p.pool.status === 'SETTLED' || p.pool.status === 'VOID');
    if (finished.length > 40) {
      const drop = new Set(finished.slice(0, finished.length - 30).filter((p) => p.acceptedAt.length === 0).map((p) => p.pool.pool_id));
      this.pools = this.pools.filter((p) => !drop.has(p.pool.pool_id));
      changed = true;
    }
    this.publish(changed);
  }

  private publish(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastPublish < 500) return;
    this.lastPublish = now;
    usePools.setState((s) => ({ pools: [...this.pools], rev: s.rev + 1, sessionId: this.manifest.session_id }));
  }

  /* ------------------------------------------------------------ */
  /* Generation                                                    */
  /* ------------------------------------------------------------ */

  private nextId(market: MarketId): string {
    this.seq++;
    return `${this.manifest.session_id}:${market.slice(3)}:${String(this.seq).padStart(3, '0')}`;
  }

  private openCount(market: MarketId): number {
    return this.pools.filter((p) => p.pool.market_id === market && (p.pool.status === 'OPEN' || p.pool.status === 'SCHEDULED')).length;
  }

  private tryCreate(market: MarketId, params: PoolParams, live: LiveState, now: number, opts: { windowMs?: number; openForMs?: number; atInstantMs?: number; segmentId?: PoolParams['segment_id']; priority?: number; focus?: string[]; sector?: 1 | 2 | 3 } = {}): LivePool | null {
    const templ = getTemplate(market);
    if (!templ.allowed_session_types.includes(this.manifest.session_type)) return null;
    if (!isMarketAvailable(templ, this.manifest)) return null;
    try {
      const timing = planPoolTiming(market, now, this.manifest, { windowMs: opts.windowMs, openForMs: opts.openForMs, atInstantMs: opts.atInstantMs, segmentId: opts.segmentId });
      const pool = createPool(market, { ...params, window_profile_ms: opts.windowMs }, this.manifest, { ...timing, pool_id: this.nextId(market) });
      const lp: LivePool = {
        pool,
        book: this.makeBook(pool, live),
        priority: opts.priority ?? 1,
        focus: opts.focus ?? ([params.driver_a, params.driver_b].filter(Boolean) as string[]),
        sector: opts.sector,
        createdSimT: this.runner.t,
        acceptedAt: [],
      };
      this.pools.push(lp);
      return lp;
    } catch (err) {
      if (import.meta.env.DEV) console.debug('pool skipped', market, (err as Error).message);
      return null;
    }
  }

  private generate(live: LiveState, now: number): void {
    const st = this.manifest.session_type;
    const running = live.cars.filter((c) => c.status === 'ACTIVE' && c.mode !== 'GARAGE');
    if (!running.length) return;
    const sim = this.runner.sim;
    const isRace = sim instanceof RaceSim;
    const started = live.status === 'STARTED' || live.status === 'RESUMED';
    const pick = <T,>(arr: T[]) => arr[Math.floor(this.rng.next() * arr.length)]!;

    // Whole-session markets (once).
    if (isRace && !this.sessionPoolsDone.has('final') && live.status !== 'FINISHED' && live.status !== 'FINALISED') {
      this.sessionPoolsDone.add('final');
      const top = live.cars.slice(0, 6);
      const d1 = top[0]?.id;
      const d2 = top[Math.min(3, top.length - 1)]?.id;
      if (st === 'GRAND_PRIX') {
        if (d1) this.tryCreate('F1-M14', { driver_a: d1 }, live, now, { openForMs: 15 * 60_000, priority: 5, focus: [d1] });
        if (d2) this.tryCreate('F1-M13', { driver_a: d2 }, live, now, { openForMs: 15 * 60_000, priority: 4, focus: [d2] });
      } else if (st === 'SPRINT' && d2) {
        this.tryCreate('F1-M18', { driver_a: d2 }, live, now, { openForMs: 8 * 60_000, priority: 4, focus: [d2] });
      }
    }
    if (sim instanceof QualiSim) {
      this.generateQuali(live, now, sim);
      return;
    }
    if (!started) return;
    const leaderLap = live.leaderLap;
    const totalLaps = live.totalLaps ?? 50;
    if (leaderLap >= totalLaps) return;

    const follow = running.find((c) => c.occupancy === 'ON_TRACK') ?? running[0]!;
    // Zone pool (M11) — the hero "where will he be" market; keep one open.
    if (this.openCount('F1-M11') < 1) {
      const subj = this.rng.chance(0.5) ? follow : pick(running.slice(0, Math.min(10, running.length)));
      this.tryCreate('F1-M11', { driver_a: subj.id }, live, now, { windowMs: pick([30_000, 60_000]), openForMs: 40_000, priority: 6, focus: [subj.id] });
    }
    // Duel (M07) + who's ahead (M02) for the closest battle.
    const battles = [];
    for (let i = 1; i < live.cars.length; i++) {
      const a = live.cars[i - 1]!;
      const b = live.cars[i]!;
      if (a.status !== 'ACTIVE' || b.status !== 'ACTIVE' || b.intervalMs === null) continue;
      if (b.driverLaps !== a.driverLaps || a.mode !== 'RACING' || b.mode !== 'RACING') continue;
      battles.push({ ahead: a, behind: b, gap: b.intervalMs });
    }
    battles.sort((x, y) => x.gap - y.gap);
    const duel = battles[0];
    if (duel && duel.gap < 2500 && this.openCount('F1-M07') < 1 && live.trackState === 'GREEN') {
      this.tryCreate('F1-M07', { driver_a: duel.behind.id, driver_b: duel.ahead.id }, live, now, { windowMs: 120_000, openForMs: 35_000, priority: 5 });
    }
    if (duel && this.openCount('F1-M02') < 1 && leaderLap + 2 <= totalLaps) {
      this.tryCreate('F1-M02', { driver_a: duel.behind.id, driver_b: duel.ahead.id, target_lap: leaderLap + 2, lap_anchor: 'LEADER' }, live, now, { openForMs: 30_000, priority: 3 });
    }
    // Position at leader lap anchor (M01).
    if (this.openCount('F1-M01') < 1 && leaderLap + 2 <= totalLaps) {
      const subj = pick(running.slice(0, Math.min(12, running.length)));
      this.tryCreate('F1-M01', { driver_a: subj.id, target_lap: leaderLap + 2, lap_anchor: 'LEADER' }, live, now, { openForMs: 30_000, priority: 2 });
    }
    // Pit markets when tyres are getting old.
    const pitCandidates = running.filter((c) => c.tyreWear > 0.42 && c.mode === 'RACING').sort((a, b) => b.tyreWear - a.tyreWear);
    if (this.openCount('F1-M03') < 1 && pitCandidates.length >= 2) {
      this.tryCreate('F1-M03', {}, live, now, { windowMs: 120_000, openForMs: 35_000, priority: 4, focus: pitCandidates.slice(0, 3).map((c) => c.id) });
    }
    const pitSubj = pitCandidates[0];
    if (pitSubj && this.openCount('F1-M05') < 1) this.tryCreate('F1-M05', { driver_a: pitSubj.id }, live, now, { windowMs: 120_000, openForMs: 30_000, priority: 4 });
    if (pitSubj && this.openCount('F1-M04') < 1) this.tryCreate('F1-M04', { driver_a: pitSubj.id }, live, now, { windowMs: 120_000, openForMs: 30_000, priority: 3 });
    if (pitCandidates[1] && this.openCount('F1-M06') < 1) this.tryCreate('F1-M06', { driver_a: pitCandidates[1].id }, live, now, { windowMs: 120_000, openForMs: 30_000, priority: 2 });
    if (pitCandidates[2] && this.openCount('F1-M20') < 1) this.tryCreate('F1-M20', { driver_a: pitCandidates[2].id }, live, now, { windowMs: 120_000, openForMs: 30_000, priority: 2 });
    // Pace markets.
    const paceSubj = pick(running.filter((c) => c.bestLapMs !== null && c.mode === 'RACING').slice(0, 10).concat([follow]));
    if (paceSubj?.bestLapMs && this.openCount('F1-M08') < 1 && live.trackState === 'GREEN') {
      this.tryCreate('F1-M08', { driver_a: paceSubj.id, reference_time_ms: Math.round((paceSubj.lastLapMs ?? paceSubj.bestLapMs) + 150) }, live, now, { windowMs: 120_000, openForMs: 30_000, priority: 3 });
    }
    if (this.openCount('F1-M09') < 1 && live.trackState === 'GREEN') this.tryCreate('F1-M09', {}, live, now, { windowMs: 120_000, openForMs: 35_000, priority: 2 });
    const secSubj = running.find((c) => c.sectorTimes.some((x) => x !== null) && c.mode === 'RACING');
    if (secSubj && this.openCount('F1-M19') < 1 && live.trackState === 'GREEN') {
      const sector = (((secSubj.sector % 3) + 1) as 1 | 2 | 3);
      const ref = secSubj.sectorTimes[sector - 1] ?? null;
      if (ref) this.tryCreate('F1-M19', { driver_a: secSubj.id, sector, t1_ms: Math.round(ref - 250), t2_ms: Math.round(ref + 250) }, live, now, { windowMs: 120_000, openForMs: 25_000, priority: 3, sector });
    }
    // Neutralisation / retirement.
    if (this.openCount('F1-M10') < 1) this.tryCreate('F1-M10', {}, live, now, { windowMs: 120_000, openForMs: 40_000, priority: 2 });
    if (this.openCount('F1-M12') < 1) this.tryCreate('F1-M12', {}, live, now, { windowMs: 120_000, openForMs: 40_000, priority: 1 });
    // Combo (M21): position group + compound at T.
    if (this.openCount('F1-M21') < 1) {
      const subj = pick(running.slice(0, Math.min(8, running.length)));
      this.tryCreate(
        'F1-M21',
        { driver_a: subj.id, combo: [{ kind: 'POSITION_GROUP', driver_id: subj.id, value: subj.position <= 3 ? 'P1_3' : 'P4_10' }, { kind: 'TYRE_COMPOUND', driver_id: subj.id, value: subj.tyre }] },
        live,
        now,
        { windowMs: 60_000, openForMs: 30_000, priority: 2 },
      );
    }
  }

  private generateQuali(live: LiveState, now: number, sim: QualiSim): void {
    const seg = live.segment;
    if (!seg) return;
    const segId = seg.id;
    const key = `seg:${segId}`;
    const active = live.cars.filter((c) => !c.eliminatedIn);
    if (!this.sessionPoolsDone.has(key) && seg.state === 'RUNNING') {
      this.sessionPoolsDone.add(key);
      if (segId !== 'Q3' && segId !== 'SQ3') {
        const bubble = active.slice(Math.max(0, seg.cutPosition - 3), seg.cutPosition + 2);
        for (const c of bubble.slice(0, 2)) this.tryCreate('F1-M15', { driver_a: c.id, segment_id: segId }, live, now, { openForMs: Math.min(6 * 60_000, Math.max(30_000, seg.remainingMs - 120_000)), segmentId: segId, priority: 5 });
      } else {
        this.tryCreate('F1-M17', { segment_id: segId, admitted: active.map((c) => c.id) }, live, now, { openForMs: Math.min(5 * 60_000, Math.max(30_000, seg.remainingMs - 90_000)), segmentId: segId, priority: 6 });
      }
    }
    // M16 needs to close before the next segment starts.
    const segs = sim.segments;
    const idx = segs.findIndex((s) => s.segment_id === segId);
    const next = segs[idx + 1];
    if (next && seg.state !== 'RUNNING' && !this.sessionPoolsDone.has(`m16:${next.segment_id}`)) {
      this.sessionPoolsDone.add(`m16:${next.segment_id}`);
      const ids = active.slice(0, 6).map((c) => c.id);
      if (ids.length >= 2) this.tryCreate('F1-M16', { driver_a: ids[0], driver_b: ids[1], segment_id: next.segment_id }, live, now, { openForMs: Math.max(20_000, Date.parse(next.planned_start_at) - now - 5000), segmentId: next.segment_id, priority: 4 });
    }
    // Live zone pool for a car on track.
    const onTrack = active.filter((c) => c.occupancy === 'ON_TRACK');
    if (onTrack.length && this.openCount('F1-M11') < 1) {
      const subj = onTrack[Math.floor(this.rng.next() * onTrack.length)]!;
      this.tryCreate('F1-M11', { driver_a: subj.id }, live, now, { windowMs: 60_000, openForMs: 35_000, priority: 6, focus: [subj.id] });
    }
    if (this.openCount('F1-M09') < 1 && seg.state === 'RUNNING') this.tryCreate('F1-M09', {}, live, now, { windowMs: 120_000, openForMs: 35_000, priority: 3 });
  }

  /* ------------------------------------------------------------ */
  /* Shared pool model (simulated players)                         */
  /* ------------------------------------------------------------ */

  private weights(pool: Pool, live: LiveState | null): Record<string, number> {
    const w: Record<string, number> = {};
    const outs = pool.outcomes.map((o) => o.id);
    outs.forEach((o) => (w[o] = 0.4));
    const car = (id?: string) => (id ? live?.cars.find((c) => c.id === id) : undefined);
    const a = car(pool.subject.driver_a);
    const b = car(pool.subject.driver_b);
    switch (pool.market_id) {
      case 'F1-M01': {
        const p = a?.position ?? 10;
        for (const o of outs) if (/^P\d+$/.test(o)) w[o] = Math.exp(-Math.abs(Number(o.slice(1)) - p) * 0.9) * 10;
        w.RETIRED = 0.3;
        break;
      }
      case 'F1-M02':
        w.A = a && b && a.position < b.position ? 7 : 4;
        w.B = a && b && b.position < a.position ? 7 : 4;
        w.BOTH_INACTIVE = 0.2;
        break;
      case 'F1-M03':
        for (const c of live?.cars ?? []) if (w[c.id] !== undefined) w[c.id] = 0.3 + c.tyreWear * 4;
        w.NO_ENTRY = 6;
        break;
      case 'F1-M04':
        w.HARD = a?.tyre === 'HARD' ? 2 : 6;
        w.MEDIUM = a?.tyre === 'MEDIUM' ? 2 : 5;
        w.SOFT = 2.5;
        w.INTERMEDIATE = 0.2;
        w.WET = 0.1;
        w.OTHER_CONFIRMED = 0.1;
        w.NO_EXIT = 5;
        break;
      case 'F1-M05':
      case 'F1-M06':
        w.BUCKET_1 = 6;
        w.BUCKET_2 = 4.5;
        w.BUCKET_3 = 2;
        w.NO_SERVICE = 4;
        w.NO_VISIT = 4;
        break;
      case 'F1-M07': {
        const gap = b?.intervalMs ?? a?.intervalMs ?? 1500;
        w.A_PASSES_B = Math.max(1, 6 - gap / 400);
        w.B_PASSES_A = 1;
        w.NO_PASS = 6;
        break;
      }
      case 'F1-M08':
        w.FASTER = 5;
        w.EQUAL = 0.6;
        w.SLOWER = 5;
        w.NO_VALID_LAP = 1;
        break;
      case 'F1-M09':
        for (const c of live?.cars ?? []) if (w[c.id] !== undefined) w[c.id] = Math.max(0.2, 8 - c.position * 0.5);
        w.TIE = 0.3;
        w.NO_VALID_LAP = 0.4;
        break;
      case 'F1-M10':
        w.NONE = 12;
        w.VSC = 1.6;
        w.SC = 1.2;
        w.RED = 0.3;
        break;
      case 'F1-M11': {
        const sec = a?.sector ?? 2;
        w.S1 = sec === 3 ? 7 : sec === 1 ? 5 : 3;
        w.S2 = sec === 1 ? 7 : sec === 2 ? 5 : 3;
        w.S3 = sec === 2 ? 7 : sec === 3 ? 5 : 3;
        w.PIT = 1 + (a?.tyreWear ?? 0) * 2;
        w.RETIRED = 0.2;
        w.DNS = 0.05;
        w.DSQ = 0.05;
        break;
      }
      case 'F1-M12':
        for (const c of live?.cars ?? []) if (w[c.id] !== undefined) w[c.id] = 0.15;
        w.NONE = 14;
        break;
      case 'F1-M13':
      case 'F1-M18': {
        const p = a?.position ?? 8;
        for (const o of outs) {
          const m = o.match(/^P(\d+)(?:_(\d+|PLUS))?$/);
          if (!m) continue;
          const lo = Number(m[1]);
          const hi = m[2] === 'PLUS' ? 22 : m[2] ? Number(m[2]) : lo;
          w[o] = p >= lo && p <= hi ? 8 : Math.max(0.5, 5 - Math.min(Math.abs(p - lo), Math.abs(p - hi)));
        }
        w.NOT_CLASSIFIED = 0.6;
        break;
      }
      case 'F1-M14':
        w.YES = a && a.position <= 3 ? 7 : 2;
        w.NO = a && a.position <= 3 ? 3 : 7;
        break;
      case 'F1-M15':
        w.YES = 5;
        w.NO = 5;
        break;
      case 'F1-M17':
        for (const c of live?.cars ?? []) if (w[c.id] !== undefined) w[c.id] = Math.max(0.3, 10 - c.position);
        break;
      case 'F1-M19':
        w.BUCKET_1 = 3;
        w.BUCKET_2 = 6;
        w.BUCKET_3 = 4;
        w.NO_VALID_SECTOR = 1;
        break;
      case 'F1-M20':
        w.YES = 2 + (a?.tyreWear ?? 0) * 6;
        w.NO = 6;
        break;
      case 'F1-M21':
        w.BOTH_TRUE = 4;
        w.NOT_BOTH = 6;
        break;
      default:
        break;
    }
    return w;
  }

  private makeBook(pool: Pool, live: LiveState | null): PoolBook {
    const w = this.weights(pool, live);
    const total = Object.values(w).reduce((x, y) => x + y, 0) || 1;
    const size = Math.round(this.rng.range(2500, 9000) * (pool.target.kind === 'SESSION' ? 4 : 1));
    const stakes: Record<string, number> = {};
    for (const o of pool.outcomes) stakes[o.id] = Math.max(10, Math.round(((w[o.id] ?? 0.3) / total) * size * this.rng.range(0.85, 1.15)));
    return { stakes, players: Math.round(size / this.rng.range(40, 90)), finalMultipliers: null };
  }

  private crowdJoin(lp: LivePool, live: LiveState): void {
    const w = this.weights(lp.pool, live);
    const total = Object.values(w).reduce((x, y) => x + y, 0) || 1;
    let r = this.rng.next() * total;
    for (const o of lp.pool.outcomes) {
      r -= w[o.id] ?? 0.3;
      if (r <= 0) {
        lp.book.stakes[o.id] = (lp.book.stakes[o.id] ?? 0) + Math.round(this.rng.range(20, 300));
        lp.book.players += 1;
        break;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.settleListeners.clear();
  }
}
