/**
 * Start-anchor logic shared by M08 (next lap) and M19 (next sector) — F1-033,
 * F1-065. The measurement starts on the next suitable start anchor after
 * not_before; an already running lap/sector is excluded.
 */
import type { AnyEvent } from '../types';

export interface AttemptStart {
  at: number;
  /** Driver lap number of the attempt. */
  lap: number;
  evidence: AnyEvent;
}

/** Earliest start in [start, end), or null. */
export function firstStart(starts: AttemptStart[], startMs: number, endMs: number): AttemptStart | null {
  let best: AttemptStart | null = null;
  for (const s of starts) {
    if (s.at < startMs || s.at >= endMs) continue;
    if (!best || s.at < best.at || (s.at === best.at && s.lap < best.lap)) best = s;
  }
  return best;
}
