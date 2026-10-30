import { create } from 'zustand';
import type { AnyEvent } from '@/domain/types';
import type { LiveState, Moment, SimFrame } from '@/sim/types';
import { SessionRunner, type RunnerMode } from '@/demo/runner';
import { CHANNELS } from '@/demo/channels';

/**
 * Active DEMO broadcast. One runner is active at a time; a global RAF loop
 * (see `startLiveLoop`) advances it so Home and Live share one snapshot
 * revision (F1-058).
 */
interface LiveStore {
  channelId: string;
  mode: RunnerMode;
  runner: SessionRunner | null;
  live: LiveState | null;
  loading: boolean;
  progress: number;
  error: string | null;
  followId: string | null;
  rivalId: string | null;
  /** Monotonic counter bumped when new events arrive (cheap subscription). */
  eventRev: number;
  open: (channelId: string, mode?: RunnerMode) => Promise<void>;
  setFollow: (id: string | null) => void;
  setRival: (id: string | null) => void;
}

type FrameListener = (f: SimFrame) => void;
type MomentListener = (m: Moment) => void;
type EventListener = (e: AnyEvent) => void;
const frameListeners = new Set<FrameListener>();
const momentListeners = new Set<MomentListener>();
const eventListeners = new Set<EventListener>();
const runnerListeners = new Set<(r: SessionRunner) => void>();

export function onFrame(fn: FrameListener): () => void {
  frameListeners.add(fn);
  return () => frameListeners.delete(fn);
}
export function onMoment(fn: MomentListener): () => void {
  momentListeners.add(fn);
  return () => momentListeners.delete(fn);
}
export function onSessionEvent(fn: EventListener): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
/** Called when a new runner becomes active (after init, before catch-up). */
export function onRunner(fn: (r: SessionRunner) => void): () => void {
  runnerListeners.add(fn);
  return () => runnerListeners.delete(fn);
}

let openSeq = 0;
let lastMomentId = '';

export const useLive = create<LiveStore>((set, get) => ({
  channelId: CHANNELS[0]!.id,
  mode: 'live',
  runner: null,
  live: null,
  loading: false,
  progress: 0,
  error: null,
  followId: null,
  rivalId: null,
  eventRev: 0,
  open: async (channelId, mode = 'live') => {
    const cur = get();
    if (cur.runner && cur.channelId === channelId && cur.mode === mode && !cur.error) return;
    const seq = ++openSeq;
    cur.runner?.dispose();
    set({ channelId, mode, runner: null, live: null, loading: true, progress: 0, error: null });
    try {
      const r = new SessionRunner(channelId, mode);
      await r.init();
      if (seq !== openSeq) {
        r.dispose();
        return;
      }
      r.onFrame((f) => frameListeners.forEach((l) => l(f)));
      r.onEvent((e) => {
        eventListeners.forEach((l) => l(e));
      });
      lastMomentId = '';
      runnerListeners.forEach((l) => l(r));
      set({ runner: r });
    } catch (e) {
      console.error(e);
      if (seq === openSeq) set({ loading: false, error: String((e as Error).message ?? e) });
    }
  },
  setFollow: (id) => set({ followId: id }),
  setRival: (id) => set({ rivalId: id }),
}));

let loopStarted = false;
let lastPublish = 0;

/**
 * Catch-up pump: while the runner is behind the broadcast it is advanced in
 * ~24 ms macrotask slices (MessageChannel), independent of the frame rate.
 * Driving it from requestAnimationFrame alone left the main thread mostly idle
 * whenever frames were expensive (heavy compositing, shader compiles), which
 * stretched the "syncing" phase from seconds to minutes.
 */
let pumping = false;
let pumpPort: MessagePort | null = null;
function pumpCatchUp(): void {
  const r = useLive.getState().runner;
  if (!r || !r.catchingUp || document.visibilityState === 'hidden') {
    pumping = false;
    return;
  }
  r.tick(Date.now(), 24);
  const now = performance.now();
  if (r.catchingUp && now - lastPublish > 120) {
    lastPublish = now;
    useLive.setState({ loading: true, progress: r.progress });
  }
  pumpPort!.postMessage(0);
}

/** Global sim loop: advances the active runner and publishes UI snapshots at ~6 Hz. */
export function startLiveLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  if (typeof MessageChannel !== 'undefined') {
    const ch = new MessageChannel();
    ch.port1.onmessage = pumpCatchUp;
    pumpPort = ch.port2;
  }
  const step = () => {
    const st = useLive.getState();
    const r = st.runner;
    if (r && document.visibilityState !== 'hidden') {
      if (r.catchingUp && pumpPort && !pumping) {
        pumping = true;
        pumpPort.postMessage(0);
      }
      const ended = r.tick(Date.now(), st.live ? 8 : 12);
      const now = performance.now();
      if (r.catchingUp) {
        if (now - lastPublish > 120) {
          lastPublish = now;
          useLive.setState({ loading: true, progress: r.progress });
        }
      } else if (r.stale) {
        if (st.live && !st.live.stale) useLive.setState({ live: { ...st.live, stale: true } });
      } else if (now - lastPublish > 160 || st.loading) {
        lastPublish = now;
        const live = r.live();
        const patch: Partial<LiveStore> = { live, loading: false, progress: 1, eventRev: r.events.length };
        if (!st.followId && live.cars[0]) patch.followId = live.cars[0].id;
        useLive.setState(patch);
        // Moments since last publish.
        const ms = live.moments;
        const idx = lastMomentId ? ms.findIndex((m) => m.id === lastMomentId) : ms.length - 1;
        const fresh = idx >= 0 ? ms.slice(idx + 1) : ms.slice(-3);
        if (ms.length) lastMomentId = ms[ms.length - 1]!.id;
        fresh.forEach((m) => momentListeners.forEach((l) => l(m)));
      }
      if (ended) {
        // Next DEMO cycle of the same channel.
        const { channelId, mode } = st;
        useLive.setState({ runner: null, followId: null, rivalId: null });
        r.dispose();
        void useLive.getState().open(channelId, mode);
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
