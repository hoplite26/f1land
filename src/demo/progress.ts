/**
 * Player progress derived from wallet entries: profile stats, achievements
 * and weekend missions. Pure functions so screens, tests and the rewards store
 * agree on the same numbers.
 */
import type { Entry } from '@/store/wallet';
import { getTemplate } from '@/domain/markets/catalog';
import type { MarketFamily } from '@/domain/types';
import { levelFromXp } from '@/store/wallet';

export function familyOfEntry(e: Pick<Entry, 'marketId'>): MarketFamily | null {
  try {
    return getTemplate(e.marketId).family;
  } catch {
    return null;
  }
}

export interface PlayerStats {
  total: number;
  pending: number;
  won: number;
  lost: number;
  void: number;
  /** Share of decided (won+lost) entries that won, 0..1; null when nothing is decided. */
  winRate: number | null;
  staked: number;
  returned: number;
  /** Net result of settled entries (payout − stake). */
  profit: number;
  streak: number;
  bestStreak: number;
  bestWin: number;
  /** Cumulative profit after each settled entry, oldest first. */
  profitSeries: number[];
}

export function playerStats(entries: Entry[]): PlayerStats {
  const chrono = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  let won = 0;
  let lost = 0;
  let voids = 0;
  let pending = 0;
  let staked = 0;
  let returned = 0;
  let profit = 0;
  let run = 0;
  let bestStreak = 0;
  let bestWin = 0;
  const series: number[] = [0];
  for (const e of chrono) {
    staked += e.stake;
    if (e.state === 'PENDING') {
      pending++;
      continue;
    }
    returned += e.payout;
    profit += e.payout - e.stake;
    series.push(profit);
    if (e.state === 'WON') {
      won++;
      run++;
      bestStreak = Math.max(bestStreak, run);
      bestWin = Math.max(bestWin, e.payout - e.stake);
    } else if (e.state === 'LOST') {
      lost++;
      run = 0;
    } else voids++;
  }
  const decided = won + lost;
  return { total: entries.length, pending, won, lost, void: voids, winRate: decided ? won / decided : null, staked, returned, profit, streak: run, bestStreak, bestWin, profitSeries: series };
}

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */

export type AchIcon = 'flag' | 'trophy' | 'fire' | 'swap' | 'pit' | 'tyre' | 'target' | 'warning' | 'globe' | 'bolt' | 'star' | 'helmet';
export type Tone = 'lime' | 'cyan' | 'purple' | 'yellow' | 'red' | 'orange';

export interface AchievementDef {
  id: string;
  icon: AchIcon;
  tone: Tone;
  goal: number;
  value: (ctx: AchContext) => number;
}

export interface AchContext {
  entries: Entry[];
  stats: PlayerStats;
  level: number;
}

const wonIn = (es: Entry[], fam: MarketFamily) => es.filter((e) => e.state === 'WON' && familyOfEntry(e) === fam).length;
const inFam = (es: Entry[], fam: MarketFamily) => es.filter((e) => familyOfEntry(e) === fam).length;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'rookie', icon: 'flag', tone: 'lime', goal: 1, value: (c) => c.stats.total },
  { id: 'firstWin', icon: 'trophy', tone: 'yellow', goal: 1, value: (c) => c.stats.won },
  { id: 'hatTrick', icon: 'fire', tone: 'orange', goal: 3, value: (c) => c.stats.bestStreak },
  { id: 'duelist', icon: 'swap', tone: 'cyan', goal: 3, value: (c) => wonIn(c.entries, 'DUEL') },
  { id: 'pitWall', icon: 'pit', tone: 'purple', goal: 5, value: (c) => inFam(c.entries, 'PIT') },
  { id: 'strategist', icon: 'tyre', tone: 'red', goal: 1, value: (c) => wonIn(c.entries, 'TYRES') },
  { id: 'sectorAce', icon: 'target', tone: 'lime', goal: 2, value: (c) => wonIn(c.entries, 'POSITION') },
  { id: 'safetyFirst', icon: 'warning', tone: 'yellow', goal: 1, value: (c) => inFam(c.entries, 'NEUTRALISATION') },
  { id: 'globetrotter', icon: 'globe', tone: 'cyan', goal: 3, value: (c) => new Set(c.entries.map((e) => e.circuitId)).size },
  { id: 'highRoller', icon: 'bolt', tone: 'orange', goal: 500, value: (c) => c.entries.reduce((m, e) => Math.max(m, e.stake), 0) },
  { id: 'jackpot', icon: 'star', tone: 'purple', goal: 1000, value: (c) => c.entries.reduce((m, e) => Math.max(m, e.state === 'WON' ? e.payout : 0), 0) },
  { id: 'veteran', icon: 'helmet', tone: 'lime', goal: 5, value: (c) => c.level },
];

export interface AchievementState {
  def: AchievementDef;
  value: number;
  unlocked: boolean;
  /** 0..1 */
  progress: number;
}

export function achievements(entries: Entry[], xp: number): AchievementState[] {
  const ctx: AchContext = { entries, stats: playerStats(entries), level: levelFromXp(xp).level };
  return ACHIEVEMENTS.map((def) => {
    const value = def.value(ctx);
    return { def, value, unlocked: value >= def.goal, progress: Math.min(1, value / def.goal) };
  });
}

/* ------------------------------------------------------------------ */
/* Weekend missions                                                    */
/* ------------------------------------------------------------------ */

/** Monday 00:00 local time of the week containing `nowMs`. */
export function weekStart(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

export function weekKey(nowMs: number): string {
  const d = new Date(weekStart(nowMs));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface MissionDef {
  id: string;
  icon: AchIcon;
  tone: Tone;
  goal: number;
  reward: number;
  value: (week: Entry[], ctx: { lastDaily: number; weekStartMs: number }) => number;
}

export const MISSIONS: MissionDef[] = [
  { id: 'predict3', icon: 'target', tone: 'lime', goal: 3, reward: 150, value: (w) => w.length },
  { id: 'pitCall', icon: 'pit', tone: 'purple', goal: 1, reward: 100, value: (w) => inFam(w, 'PIT') },
  { id: 'duelWin', icon: 'swap', tone: 'cyan', goal: 1, reward: 200, value: (w) => wonIn(w, 'DUEL') },
  { id: 'variety', icon: 'star', tone: 'yellow', goal: 3, reward: 150, value: (w) => new Set(w.map(familyOfEntry).filter(Boolean)).size },
  { id: 'win2', icon: 'trophy', tone: 'orange', goal: 2, reward: 250, value: (w) => w.filter((e) => e.state === 'WON').length },
  { id: 'daily', icon: 'bolt', tone: 'lime', goal: 1, reward: 50, value: (_w, c) => (c.lastDaily >= c.weekStartMs ? 1 : 0) },
];

export interface MissionState {
  def: MissionDef;
  value: number;
  done: boolean;
  claimKey: string;
}

export function missions(entries: Entry[], lastDaily: number, nowMs: number): MissionState[] {
  const ws = weekStart(nowMs);
  const wk = weekKey(nowMs);
  const week = entries.filter((e) => e.createdAt >= ws);
  return MISSIONS.map((def) => {
    const value = Math.min(def.goal, def.value(week, { lastDaily, weekStartMs: ws }));
    return { def, value, done: value >= def.goal, claimKey: `${wk}:${def.id}` };
  });
}
