import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Claimed weekend-mission rewards, keyed `${weekKey}:${missionId}`. */
interface RewardsState {
  claimed: Record<string, number>;
  markClaimed: (key: string) => void;
  reset: () => void;
}

export const useRewards = create<RewardsState>()(
  persist(
    (set) => ({
      claimed: {},
      markClaimed: (key) => set((s) => ({ claimed: { ...s.claimed, [key]: Date.now() } })),
      reset: () => set({ claimed: {} }),
    }),
    { name: 'pa-f1-rewards', version: 1 },
  ),
);
