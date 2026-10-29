import { create } from 'zustand';

export type TabId = 'home' | 'races' | 'live' | 'pools' | 'profile';

export type Route =
  | { name: 'tab'; tab: TabId }
  | { name: 'meeting'; meetingId: string }
  | { name: 'session'; channelId: string }
  | { name: 'pool'; channelId: string; poolId: string }
  | { name: 'entry'; entryId: string }
  | { name: 'leaderboard' }
  | { name: 'wallet' }
  | { name: 'settings' }
  | { name: 'history' }
  | { name: 'rewards' }
  | { name: 'circuit'; circuitId: string }
  | { name: 'driver'; driverId: string };

interface NavState {
  tab: TabId;
  stack: Route[];
  /** +1 push, -1 pop, 0 tab switch — drives transition direction. */
  dir: number;
  go: (tab: TabId) => void;
  push: (r: Route) => void;
  back: () => void;
  reset: (r?: Route) => void;
}

export const useNav = create<NavState>((set) => ({
  tab: 'home',
  stack: [],
  dir: 0,
  go: (tab) => set({ tab, stack: [], dir: 0 }),
  push: (r) => set((s) => ({ stack: [...s.stack, r], dir: 1 })),
  back: () => set((s) => ({ stack: s.stack.slice(0, -1), dir: -1 })),
  reset: (r) => set({ stack: r ? [r] : [], dir: 0 }),
}));

export function currentRoute(s: { tab: TabId; stack: Route[] }): Route {
  return s.stack[s.stack.length - 1] ?? { name: 'tab', tab: s.tab };
}

export function routeKey(r: Route): string {
  return JSON.stringify(r);
}
