import { onRunner, useLive } from '@/store/live';
import { PoolEngine, type LivePool } from '@/demo/poolEngine';
import { replayToEnd, type SessionRunner } from '@/demo/runner';
import { useWallet, type Entry, type EntryState } from '@/store/wallet';
import { useToasts } from '@/store/toasts';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { t } from '@/i18n/core';
import { EventStore } from '@/domain/events/store';
import { settlePool } from '@/domain/settlement';
import { advancePool } from '@/domain/lifecycle';
import type { Pool, Settlement } from '@/domain/types';
import { buildManifest, channelLaps, getChannel } from '@/demo/channels';
import { poolTexts } from './poolText';

let engine: PoolEngine | null = null;

export function getEngine(): PoolEngine | null {
  return engine;
}

function outcomeState(entry: Entry, s: Settlement): EntryState {
  if (s.winner_outcome_id === null) return 'VOID';
  return s.winner_outcome_id === entry.outcomeId ? 'WON' : 'LOST';
}

/** Apply a (final) settlement to the user's entries, including later corrections (F1-056). */
export function applySettlement(entry: Entry, pool: Pool, finalMultiplier: number | null, silent = false): void {
  const s = pool.settlement;
  if (!s) return;
  const wallet = useWallet.getState();
  if (s.provisional) {
    wallet.updateEntry(entry.id, { settlement: s, pool });
    return;
  }
  const prev = entry.settlement;
  if (prev && !prev.provisional && prev.settlement_revision === s.settlement_revision && entry.state !== 'PENDING') return;
  const state = outcomeState(entry, s);
  const mult = finalMultiplier ?? entry.finalMultiplier ?? entry.estimate;
  const payout = state === 'WON' ? Math.round(entry.stake * mult) : state === 'VOID' ? entry.stake : 0;
  const corrected = entry.state !== 'PENDING' && prev && !prev.provisional && prev.settlement_revision !== s.settlement_revision;
  wallet.settleEntry(entry.id, state, payout, s, mult);
  wallet.updateEntry(entry.id, { pool });
  if (silent) return;
  const toasts = useToasts.getState();
  const q = poolTexts(pool).title;
  if (corrected) {
    toasts.push({ kind: 'warn', title: t('entries.corrected'), body: q });
    haptic.notify('warning');
    return;
  }
  if (state === 'WON') {
    toasts.push({ kind: 'win', title: t('toast.won', { n: payout }), body: q }, 5200);
    haptic.win();
    sfx.win();
  } else if (state === 'LOST') {
    toasts.push({ kind: 'lose', title: t('toast.lost'), body: q });
    haptic.notify('error');
    sfx.lose();
  } else {
    toasts.push({ kind: 'warn', title: t('toast.void', { n: payout }), body: q });
    haptic.notify('warning');
  }
}

function attach(r: SessionRunner): void {
  engine?.dispose();
  const e = new PoolEngine(r);
  engine = e;
  // Restore pools of pending entries from the same session (reload).
  for (const en of useWallet.getState().entries) {
    if (en.sessionId === r.manifest.session_id && (en.state === 'PENDING' || en.settlement?.provisional)) e.adopt(en.pool);
  }
  e.onSettle((lp: LivePool) => {
    const entries = useWallet.getState().entries.filter((x) => x.poolId === lp.pool.pool_id);
    for (const en of entries) applySettlement(en, lp.pool, lp.book.finalMultipliers?.[en.outcomeId] ?? null);
    if (lp.pool.status === 'LOCKED' && entries.length) sfx.lock();
  });
}

let started = false;
export function startSessionService(): void {
  if (started) return;
  started = true;
  onRunner(attach);
  let lastLive: unknown = null;
  useLive.subscribe((s) => {
    if (s.live && s.live !== lastLive && engine && s.runner === engine.runner) {
      lastLive = s.live;
      engine.tick(s.live);
    }
  });
  // Settle entries of sessions that are no longer live from deterministic replays.
  setTimeout(() => void settleStaleEntries(), 6000);
}

const replaying = new Set<string>();

export async function settleFromReplay(entry: Entry): Promise<boolean> {
  if (replaying.has(entry.id)) return false;
  replaying.add(entry.id);
  try {
    const deadline = Date.parse(entry.pool.settlement_deadline);
    const store = new EventStore();
    const r = await replayToEnd(entry.channelId, entry.cycle, deadline + 1000, (ev) => store.ingest(ev));
    store.ingestMany(r.events);
    const ch = getChannel(entry.channelId);
    const laps = ch.sessionType === 'GRAND_PRIX' || ch.sessionType === 'SPRINT' ? channelLaps(ch, r.circuit.laps, r.circuit.sprintLaps) : undefined;
    const manifest = buildManifest(ch, entry.cycle, r.startMs, r.circuit.layoutVersion, laps);
    const now = Math.max(deadline + 600_000, r.nowMs);
    let pool = advancePool(entry.pool, now, { trackState: 'GREEN', sessionStatus: 'FINISHED' });
    if (pool.status === 'OPEN') pool = { ...pool, status: 'LOCKED' };
    pool = settlePool(pool, { events: store.canonical(), coverage: { intervals: [[r.startMs - 60_000, now]], watermark_ms: now }, manifest, now_ms: now }, { accepted_at_ms: [entry.createdAt] });
    pool = settlePool(pool, { events: store.canonical(), coverage: { intervals: [[r.startMs - 60_000, now]], watermark_ms: now }, manifest, now_ms: now + 600_000 }, { accepted_at_ms: [entry.createdAt] });
    r.dispose();
    const fresh = useWallet.getState().entries.find((x) => x.id === entry.id);
    if (fresh) applySettlement(fresh, pool, fresh.finalMultiplier ?? fresh.estimate);
    return true;
  } catch (err) {
    console.warn('replay settle failed', err);
    return false;
  } finally {
    replaying.delete(entry.id);
  }
}

async function settleStaleEntries(): Promise<void> {
  const live = useLive.getState();
  const activeSession = live.runner?.manifest.session_id;
  const list = useWallet.getState().entries.filter((e) => e.state === 'PENDING' && e.sessionId !== activeSession && Date.parse(e.pool.settlement_deadline) < Date.now());
  for (const e of list.slice(0, 4)) await settleFromReplay(e);
}
