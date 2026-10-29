/**
 * DEMO classification for completed rounds. Deterministic per meeting (seeded
 * from the meeting id and the demo driver/team traits) so the calendar, the
 * driver cards and the standings always agree. Not official results.
 */
import { DRIVERS, TEAM_BY_ID } from '@/data/teams';
import { SEASON_2026, meetingStatus, type Meeting } from '@/data/calendar';
import { Rng } from '@/sim/rng';

export interface ResultRow {
  pos: number;
  driverId: string;
  /** Gap to the winner in ms (null for the winner and for DNF). */
  gapMs: number | null;
  /** Laps behind the winner (lapped cars). */
  lapsDown: number;
  dnf: boolean;
  points: number;
  fastestLap: boolean;
  grid: number;
}

const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const cache = new Map<string, ResultRow[]>();

export function demoResults(meetingId: string): ResultRow[] {
  const hit = cache.get(meetingId);
  if (hit) return hit;
  const rng = new Rng(`results:${meetingId}`);
  const scored = DRIVERS.map((d) => {
    const team = TEAM_BY_ID[d.teamId]!;
    const perf = d.pace * 0.5 + team.carPace * 0.5 + rng.gauss(0, 0.03);
    const quali = d.pace * 0.6 + team.carPace * 0.4 + rng.gauss(0, 0.025);
    const dnf = rng.chance(0.03 + (1 - d.consistency) * 0.1);
    return { d, perf, quali, dnf };
  });
  const gridOrder = [...scored].sort((a, b) => b.quali - a.quali).map((x) => x.d.id);
  const finishers = scored.filter((x) => !x.dnf).sort((a, b) => b.perf - a.perf);
  const dnfs = scored.filter((x) => x.dnf).sort((a, b) => b.perf - a.perf);
  const rows: ResultRow[] = [];
  let gap = 0;
  finishers.forEach((x, i) => {
    if (i > 0) gap += Math.round(rng.range(600, 7200) * (1 + i * 0.06));
    const lapsDown = gap > 95_000 ? Math.min(2, Math.floor(gap / 95_000)) : 0;
    rows.push({ pos: i + 1, driverId: x.d.id, gapMs: i === 0 ? null : lapsDown ? null : gap, lapsDown, dnf: false, points: POINTS[i] ?? 0, fastestLap: false, grid: gridOrder.indexOf(x.d.id) + 1 });
  });
  dnfs.forEach((x) => rows.push({ pos: rows.length + 1, driverId: x.d.id, gapMs: null, lapsDown: 0, dnf: true, points: 0, fastestLap: false, grid: gridOrder.indexOf(x.d.id) + 1 }));
  const fl = rows[Math.min(rows.length - 1, Math.floor(rng.next() * 6))];
  if (fl && !fl.dnf) fl.fastestLap = true;
  cache.set(meetingId, rows);
  return rows;
}

export function completedMeetings(nowMs: number): Meeting[] {
  return SEASON_2026.filter((m) => meetingStatus(m, nowMs) === 'COMPLETED');
}

export interface DriverSeason {
  points: number;
  wins: number;
  podiums: number;
  poles: number;
  dnfs: number;
  starts: number;
  bestFinish: number | null;
  avgFinish: number | null;
  /** Most recent first: finishing positions (0 = DNF) with meeting ids. */
  form: Array<{ meetingId: string; pos: number; dnf: boolean }>;
  rank: number;
}

export function driverStandings(nowMs: number): Array<{ driverId: string; points: number; wins: number }> {
  const done = completedMeetings(nowMs);
  const map = new Map<string, { points: number; wins: number }>();
  for (const d of DRIVERS) map.set(d.id, { points: 0, wins: 0 });
  for (const m of done) {
    for (const r of demoResults(m.id)) {
      const s = map.get(r.driverId)!;
      s.points += r.points;
      if (r.pos === 1 && !r.dnf) s.wins++;
    }
  }
  return [...map.entries()].map(([driverId, s]) => ({ driverId, ...s })).sort((a, b) => b.points - a.points || b.wins - a.wins);
}

export function driverSeason(driverId: string, nowMs: number): DriverSeason {
  const done = completedMeetings(nowMs);
  let points = 0;
  let wins = 0;
  let podiums = 0;
  let poles = 0;
  let dnfs = 0;
  let sum = 0;
  let fin = 0;
  let best: number | null = null;
  const form: DriverSeason['form'] = [];
  for (const m of done) {
    const r = demoResults(m.id).find((x) => x.driverId === driverId);
    if (!r) continue;
    points += r.points;
    if (r.grid === 1) poles++;
    if (r.dnf) dnfs++;
    else {
      if (r.pos === 1) wins++;
      if (r.pos <= 3) podiums++;
      sum += r.pos;
      fin++;
      best = best === null ? r.pos : Math.min(best, r.pos);
    }
    form.unshift({ meetingId: m.id, pos: r.dnf ? 0 : r.pos, dnf: r.dnf });
  }
  const rank = driverStandings(nowMs).findIndex((s) => s.driverId === driverId) + 1;
  return { points, wins, podiums, poles, dnfs, starts: done.length, bestFinish: best, avgFinish: fin ? sum / fin : null, form: form.slice(0, 6), rank };
}
