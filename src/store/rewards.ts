import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useWallet } from './wallet';

/** DEMO check-in bonus by streak day (1..7, then the cycle repeats). Shown to the user up front. */
export const STREAK_BONUS = [50, 75, 100, 125, 150, 200, 300] as const;

/** Local calendar day, `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prevDayKey(ms: number): string {
  const d = new Date(ms);
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

export function streakBonus(day: number): number {
  return STREAK_BONUS[(Math.max(1, day) - 1) % STREAK_BONUS.length]!;
}

export interface StreakView {
  /** Current run of consecutive check-in days (0 when broken). */
  count: number;
  checkedToday: boolean;
  /** Streak day the next check-in will count as. */
  nextDay: number;
  nextBonus: number;
  best: number;
}

/** Claimed weekend-mission rewards, keyed `${weekKey}:${missionId}`, plus the daily check-in streak. */
interface RewardsState {
  claimed: Record<string, number>;
  streak: number;
  bestStreak: number;
  lastCheckIn: string | null;
  /** Last level / achievement set the user has already been shown (null = not initialised yet). */
  seenLevel: number | null;
  seenAch: string[] | null;
  markClaimed: (key: string) => void;
  checkIn: (nowMs?: number) => { ok: boolean; day: number; bonus: number };
  markSeen: (p: { level?: number; ach?: string[] }) => void;
  reset: () => void;
}

export const useRewards = create<RewardsState>()(
  persist(
    (set, get) => ({
      claimed: {},
      streak: 0,
      bestStreak: 0,
      lastCheckIn: null,
      seenLevel: null,
      seenAch: null,
      markClaimed: (key) => set((s) => ({ claimed: { ...s.claimed, [key]: Date.now() } })),
      checkIn: (nowMs = Date.now()) => {
        const s = get();
        const today = dayKey(nowMs);
        if (s.lastCheckIn === today) return { ok: false, day: s.streak, bonus: 0 };
        const day = s.lastCheckIn === prevDayKey(nowMs) ? s.streak + 1 : 1;
        const bonus = streakBonus(day);
        set({ streak: day, bestStreak: Math.max(s.bestStreak, day), lastCheckIn: today });
        const w = useWallet.getState();
        w.credit('bonus', bonus);
        // Keeps the weekly "daily bonus" mission in sync with the check-in.
        useWallet.setState({ lastDaily: nowMs });
        return { ok: true, day, bonus };
      },
      markSeen: (p) => set((s) => ({ seenLevel: p.level ?? s.seenLevel, seenAch: p.ach ?? s.seenAch })),
      reset: () => set({ claimed: {}, streak: 0, bestStreak: 0, lastCheckIn: null, seenLevel: null, seenAch: null }),
    }),
    { name: 'pa-f1-rewards', version: 1 },
  ),
);

export function streakView(s: Pick<RewardsState, 'streak' | 'bestStreak' | 'lastCheckIn'>, nowMs: number): StreakView {
  const today = dayKey(nowMs);
  const checkedToday = s.lastCheckIn === today;
  const alive = checkedToday || s.lastCheckIn === prevDayKey(nowMs);
  const count = alive ? s.streak : 0;
  const nextDay = count + 1;
  return { count, checkedToday, nextDay, nextBonus: streakBonus(nextDay), best: s.bestStreak };
}

/** Subscribes to the streak; re-evaluates on day change via the caller's clock. */
export function useStreak(nowMs: number): StreakView {
  const streak = useRewards((s) => s.streak);
  const bestStreak = useRewards((s) => s.bestStreak);
  const lastCheckIn = useRewards((s) => s.lastCheckIn);
  return streakView({ streak, bestStreak, lastCheckIn }, nowMs);
}
