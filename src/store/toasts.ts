import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'info' | 'win' | 'warn' | 'lose';
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

interface ToastState {
  items: Toast[];
  push: (t: Omit<Toast, 'id'>, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t, ttlMs = 3800) => {
    const id = ++seq;
    set({ items: [...get().items.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
}));
