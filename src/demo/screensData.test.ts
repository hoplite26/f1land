import { describe, expect, it } from 'vitest';
import { demoResults, driverSeason, driverStandings } from './results';
import { leaderboard, leaderboardWithYou } from './leaderboard';
import { achievements, missions, playerStats, weekStart } from './progress';
import { DRIVERS } from '@/data/teams';
import type { Entry } from '@/store/wallet';

const NOW = Date.UTC(2026, 9, 29, 12);

function entry(p: Partial<Entry>): Entry {
  return {
    id: p.id ?? 'e',
    poolId: 'pool',
    channelId: 'mx-gp',
    cycle: 0,
    sessionId: 's',
    marketId: p.marketId ?? 'F1-M02',
    outcomeId: 'A',
    pool: {} as Entry['pool'],
    questionKey: 'q',
    questionParams: {},
    outcomeLabel: 'A',
    stake: p.stake ?? 100,
    estimate: 2,
    createdAt: p.createdAt ?? NOW,
    state: p.state ?? 'PENDING',
    payout: p.payout ?? 0,
    settlement: null,
    settlementHistory: [],
    finalMultiplier: null,
    circuitId: p.circuitId ?? 'mx-1962',
    meetingName: { ru: '', en: '' },
    seen: true,
  };
}

describe('demo results', () => {
  it('is deterministic and complete', () => {
    const a = demoResults('2026-05');
    const b = demoResults('2026-05');
    expect(a).toBe(b);
    expect(a).toHaveLength(DRIVERS.length);
    expect(new Set(a.map((r) => r.driverId)).size).toBe(DRIVERS.length);
    expect(a[0]!.points).toBe(25);
    expect(a.filter((r) => r.fastestLap).length).toBeLessThanOrEqual(1);
  });

  it('standings sum the per-round points', () => {
    const st = driverStandings(NOW);
    const season = driverSeason(st[0]!.driverId, NOW);
    expect(season.points).toBe(st[0]!.points);
    expect(season.rank).toBe(1);
  });
});

describe('progress', () => {
  it('computes stats, streaks and profit', () => {
    const es = [
      entry({ id: '1', state: 'WON', payout: 300, createdAt: NOW - 3000 }),
      entry({ id: '2', state: 'WON', payout: 250, createdAt: NOW - 2000 }),
      entry({ id: '3', state: 'LOST', createdAt: NOW - 1000 }),
      entry({ id: '4', state: 'VOID', payout: 100, createdAt: NOW - 500 }),
      entry({ id: '5' }),
    ];
    const s = playerStats(es);
    expect(s.total).toBe(5);
    expect(s.pending).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.profit).toBe(300 + 250 - 400);
    expect(s.bestStreak).toBe(2);
    expect(s.streak).toBe(0);
    expect(s.bestWin).toBe(200);
  });

  it('unlocks achievements and counts weekly missions', () => {
    const es = [entry({ id: '1', state: 'WON', payout: 300 }), entry({ id: '2', createdAt: weekStart(NOW) - 1 })];
    const ach = achievements(es, 340);
    expect(ach.find((a) => a.def.id === 'rookie')!.unlocked).toBe(true);
    expect(ach.find((a) => a.def.id === 'firstWin')!.unlocked).toBe(true);
    expect(ach.find((a) => a.def.id === 'jackpot')!.unlocked).toBe(false);
    const ms = missions(es, 0, NOW);
    expect(ms.find((m) => m.def.id === 'predict3')!.value).toBe(1);
    expect(ms.find((m) => m.def.id === 'daily')!.done).toBe(false);
  });
});

describe('leaderboard', () => {
  it('is deterministic per period and inserts the player', () => {
    expect(leaderboard('week', NOW)).toEqual(leaderboard('week', NOW));
    const { list, rank } = leaderboardWithYou('season', NOW, { id: 'me', name: 'Me', driverId: 'nor', countryCode: 'GB', winRate: 0 }, 0);
    expect(list[rank - 1]!.you).toBe(true);
    expect(rank).toBe(list.length);
    const sorted = [...list].sort((a, b) => b.points - a.points);
    expect(sorted.map((p) => p.points)).toEqual(list.map((p) => p.points));
  });
});
