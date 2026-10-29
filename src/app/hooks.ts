import { useEffect, useMemo, useState } from 'react';
import { useLive, onFrame } from '@/store/live';
import type { SimFrame, LiveState } from '@/sim/types';
import type { MapCar } from '@/ui/TrackMap';

let latestFrame: SimFrame | null = null;
onFrame((f) => {
  latestFrame = f;
});

export function getLatestFrame(): SimFrame | null {
  return latestFrame;
}

/** Car dots for the SVG map from the latest confirmed sample. */
export function useMapCars(live: LiveState | null, followId: string | null, rivalId: string | null, extraLabels: string[] = []): MapCar[] {
  return useMemo(() => {
    const f = latestFrame;
    if (!f || !live) return [];
    const posById = new Map(live.cars.map((c) => [c.id, c.position]));
    const followPos = followId ? posById.get(followId) : undefined;
    return f.cars
      .filter((c) => c.visible)
      .map((c) => {
        const p = posById.get(c.id);
        let kind: MapCar['kind'] = 'other';
        if (c.id === followId) kind = 'follow';
        else if (c.id === rivalId) kind = 'rival';
        else if (extraLabels.includes(c.id) || (followPos && p && Math.abs(p - followPos) === 1)) kind = 'near';
        return { id: c.id, x: c.x, y: c.y, inPit: c.inPit, kind, position: p };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, followId, rivalId, extraLabels.join(',')]);
}

/** Re-render on a fixed cadence (for countdowns tied to the sim clock). */
export function useTicker(ms = 250): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

/** Server time of the active session (sim clock) or wall clock. */
export function useSessionNow(): number {
  useTicker(250);
  const r = useLive.getState().runner;
  return r && r.ready ? r.nowMs : Date.now();
}
