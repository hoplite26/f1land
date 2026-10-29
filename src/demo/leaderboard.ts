/**
 * DEMO leaderboard: deterministic simulated players (seeded per period) plus
 * the local player's score derived from their wallet entries and XP.
 */
import { DRIVERS } from '@/data/teams';
import { Rng } from '@/sim/rng';
import type { Entry } from '@/store/wallet';
import { playerStats, weekKey, weekStart } from './progress';

export type LbPeriod = 'week' | 'season' | 'friends';

export interface LbPlayer {
  id: string;
  name: string;
  /** Helmet avatar (favourite driver). */
  driverId: string;
  countryCode: string;
  points: number;
  /** Rank change vs the previous snapshot (+ = climbed). */
  trend: number;
  winRate: number;
  you?: boolean;
}

const NAMES = [
  'apex_hunter', 'boxbox', 'drs_open', 'gridwalker', 'late_braker', 'undercut_king', 'pitwall_pro', 'tifosi_88', 'papaya_rush',
  'silver_arrow', 'slipstream', 'chicane_kid', 'kerb_rider', 'purple_sector', 'lights_out', 'flat_out', 'parc_ferme', 'pole_sitter',
  'hairpin_hero', 'eau_rouge', 'monza_mike', 'maggotts', 'tyre_whisperer', 'sector3', 'blue_flag', 'vsc_ninja', 'turn1_hero',
  'dirty_air', 'Алекс_Апекс', 'Дима_DRS', 'Ксюша_Пит', 'Никита_Монца', 'Лёша_Слипстрим', 'Маша_Шикана', 'Гоша_Поул', 'Оля_Сектор',
  'Катя_Андеркат', 'Ваня_Финиш', 'Тёма_Болид', 'Саня_Боксбокс', 'mika_flying', 'senna_soul', 'kimi_bwoah', 'ice_cool', 'carbon_fibre',
  'quali_queen', 'race_engineer', 'pit_lane_pete', 'grip_level', 'downforce', 'gravel_trap', 'track_limits', 'the_undercut',
  'overcut_owl', 'tow_hunter', 'wet_master', 'inter_rain', 'soft_shoe', 'medium_rare', 'hard_charger',
];
const COUNTRIES = ['GB', 'NL', 'IT', 'ES', 'DE', 'FR', 'BR', 'MX', 'US', 'AU', 'JP', 'MC', 'KZ', 'AE', 'PL', 'FI', 'AT', 'CA'];
const RU_COUNTRIES = ['KZ', 'AM', 'GE', 'UZ', 'RS', 'BY'];

function roster(): Array<{ id: string; name: string; driverId: string; countryCode: string; skill: number }> {
  const rng = new Rng('lb-roster-v1');
  return NAMES.map((name, i) => ({
    id: `p${i}`,
    name,
    driverId: rng.pick(DRIVERS).id,
    countryCode: /[а-яё]/i.test(name) ? rng.pick(RU_COUNTRIES) : rng.pick(COUNTRIES),
    skill: rng.range(0.35, 1),
  }));
}

const ROSTER = roster();

function scored(seed: string, scale: number, pool = ROSTER) {
  const rng = new Rng(seed);
  return pool.map((p) => {
    const luck = rng.range(0.55, 1.35);
    const points = Math.round(scale * p.skill * luck);
    return { ...p, points, winRate: Math.min(0.82, 0.32 + p.skill * 0.38 + rng.gauss(0, 0.04)) };
  });
}

function withTrend(cur: ReturnType<typeof scored>, prev: ReturnType<typeof scored>): LbPlayer[] {
  const prevRank = new Map([...prev].sort((a, b) => b.points - a.points).map((p, i) => [p.id, i]));
  return [...cur]
    .sort((a, b) => b.points - a.points)
    .map((p, i) => ({ id: p.id, name: p.name, driverId: p.driverId, countryCode: p.countryCode, points: p.points, winRate: p.winRate, trend: (prevRank.get(p.id) ?? i) - i }));
}

/** User score: XP-like points from entries (15 per prediction, +60 per win, +10 per settled loss/void, + profit/10). */
export function userPoints(entries: Entry[], xp: number, period: LbPeriod, nowMs: number): number {
  if (period === 'season') return Math.max(0, Math.round(xp + Math.max(0, playerStats(entries).profit) / 10));
  const ws = weekStart(nowMs);
  const week = period === 'week' ? entries.filter((e) => e.createdAt >= ws) : entries;
  let pts = 0;
  for (const e of week) {
    pts += 15;
    if (e.state === 'WON') pts += 60 + Math.max(0, Math.round((e.payout - e.stake) / 10));
    else if (e.state !== 'PENDING') pts += 10;
  }
  return period === 'friends' ? Math.round(xp + pts / 4) : pts;
}

export function leaderboard(period: LbPeriod, nowMs: number): LbPlayer[] {
  const wk = weekKey(nowMs);
  const prevWk = weekKey(nowMs - 7 * 86_400_000);
  if (period === 'week') return withTrend(scored(`lb-week-${wk}`, 980), scored(`lb-week-${prevWk}`, 980));
  // Season totals grow with the number of weeks elapsed since the opener (6 Mar 2026).
  const weeks = Math.max(1, Math.floor((nowMs - Date.UTC(2026, 2, 2)) / (7 * 86_400_000)));
  if (period === 'season') return withTrend(scored(`lb-season-${weeks}`, 420 * weeks), scored(`lb-season-${weeks - 1}`, 420 * (weeks - 1)));
  const friends = new Rng('lb-friends').shuffle([...ROSTER]).slice(0, 9);
  return withTrend(scored(`lb-friends-${wk}`, 160 * weeks, friends), scored(`lb-friends-${prevWk}`, 160 * Math.max(1, weeks - 1), friends));
}

/** Leaderboard with the local player inserted; returns the list and the user's 1-based rank. */
export function leaderboardWithYou(period: LbPeriod, nowMs: number, you: Omit<LbPlayer, 'points' | 'trend' | 'you'>, points: number): { list: LbPlayer[]; rank: number } {
  const list = leaderboard(period, nowMs);
  const me: LbPlayer = { ...you, points, trend: 0, you: true };
  let idx = list.findIndex((p) => p.points < points);
  if (idx < 0) idx = list.length;
  list.splice(idx, 0, me);
  return { list, rank: idx + 1 };
}
