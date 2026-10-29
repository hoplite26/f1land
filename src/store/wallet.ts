import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Pool, Settlement } from '@/domain/types';

export type EntryState = 'PENDING' | 'WON' | 'LOST' | 'VOID';

export interface Entry {
  id: string;
  poolId: string;
  channelId: string;
  cycle: number;
  sessionId: string;
  marketId: Pool['market_id'];
  outcomeId: string;
  /** Snapshot of the pool at confirmation (immutable terms, F1-005). */
  pool: Pool;
  questionKey: string;
  questionParams: Record<string, string | number>;
  outcomeLabel: string;
  stake: number;
  /** Pool multiplier estimate at confirmation (display only). */
  estimate: number;
  createdAt: number;
  state: EntryState;
  payout: number;
  settlement: Settlement | null;
  settlementHistory: Settlement[];
  /** Final multiplier at lock (shared pool model). */
  finalMultiplier: number | null;
  circuitId: string;
  meetingName: { ru: string; en: string };
  seen: boolean;
}

export interface Tx {
  id: string;
  at: number;
  kind: 'stake' | 'payout' | 'refund' | 'bonus' | 'topup';
  amount: number;
  entryId?: string;
}

interface WalletState {
  balance: number;
  entries: Entry[];
  txs: Tx[];
  xp: number;
  lastDaily: number;
  addEntry: (e: Entry) => void;
  updateEntry: (id: string, patch: Partial<Entry>) => void;
  settleEntry: (id: string, state: EntryState, payout: number, settlement: Settlement, finalMultiplier: number | null) => void;
  credit: (kind: Tx['kind'], amount: number, entryId?: string) => void;
  claimDaily: () => boolean;
  reset: () => void;
}

const START_BALANCE = 1250;

let txSeq = 0;
const txId = () => `tx_${Date.now().toString(36)}_${(txSeq++).toString(36)}`;

export const useWallet = create<WalletState>()(
  persist(
    (set, get) => ({
      balance: START_BALANCE,
      entries: [],
      txs: [{ id: 'tx_welcome', at: Date.now(), kind: 'bonus', amount: START_BALANCE }],
      xp: 340,
      lastDaily: 0,
      addEntry: (e) =>
        set((s) => ({
          entries: [e, ...s.entries],
          balance: s.balance - e.stake,
          xp: s.xp + 15,
          txs: [{ id: txId(), at: Date.now(), kind: 'stake' as const, amount: -e.stake, entryId: e.id }, ...s.txs].slice(0, 200),
        })),
      updateEntry: (id, patch) => set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      settleEntry: (id, state, payout, settlement, finalMultiplier) => {
        const e = get().entries.find((x) => x.id === id);
        if (!e) return;
        const prevPayout = e.state === 'PENDING' ? 0 : e.payout;
        const delta = payout - prevPayout;
        set((s) => ({
          entries: s.entries.map((x) =>
            x.id === id
              ? {
                  ...x,
                  state,
                  payout,
                  finalMultiplier,
                  settlementHistory: x.settlement && x.settlement.settlement_revision !== settlement.settlement_revision ? [...x.settlementHistory, x.settlement] : x.settlementHistory,
                  settlement,
                  seen: false,
                }
              : x,
          ),
          balance: s.balance + delta,
          xp: s.xp + (state === 'WON' ? 60 : 10),
          txs: delta !== 0 ? [{ id: txId(), at: Date.now(), kind: (state === 'VOID' ? 'refund' : 'payout') as Tx['kind'], amount: delta, entryId: id }, ...s.txs].slice(0, 200) : s.txs,
        }));
      },
      credit: (kind, amount, entryId) =>
        set((s) => ({ balance: s.balance + amount, txs: [{ id: txId(), at: Date.now(), kind, amount, entryId }, ...s.txs].slice(0, 200) })),
      claimDaily: () => {
        const now = Date.now();
        if (now - get().lastDaily < 20 * 3600_000) return false;
        set((s) => ({ lastDaily: now, balance: s.balance + 200, txs: [{ id: txId(), at: now, kind: 'bonus' as const, amount: 200 }, ...s.txs] }));
        return true;
      },
      reset: () => set({ balance: START_BALANCE, entries: [], txs: [{ id: 'tx_welcome', at: Date.now(), kind: 'bonus', amount: START_BALANCE }], xp: 340, lastDaily: 0 }),
    }),
    { name: 'pa-f1-wallet', version: 1 },
  ),
);

export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let need = 200;
  let rest = xp;
  while (rest >= need) {
    rest -= need;
    level++;
    need = Math.round(need * 1.18);
  }
  return { level, into: rest, need };
}
