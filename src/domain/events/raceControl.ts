/**
 * Race-control transitions (F1-022, F1-QA09). Track state and local sector
 * flags are separate: a yellow sector never becomes SC. "VSC → SC" contains
 * two transitions (GREEN→VSC, VSC→SC); a repeated message (same message_id)
 * counts once.
 */
import type { AnyEvent, NormalizedEvent, TrackState } from '../types';
import { sortEvents } from './order';

export interface RaceControlTransition {
  from: TrackState;
  to: TrackState;
  message_id: string;
  source_event_id: string;
  occurred_at: string;
  leader_lap: number | null;
  event: NormalizedEvent<'RACE_CONTROL_STATE'>;
}

export const NEUTRAL_STATES: readonly TrackState[] = ['SC', 'VSC', 'RED', 'SC_ENDING', 'VSC_ENDING'];
export const NEUTRALISATION_OUTCOMES: readonly TrackState[] = ['SC', 'VSC', 'RED'];

/** Track-scope race-control messages, de-duplicated by message_id, in canonical order. */
export function trackMessages(events: readonly AnyEvent[]): NormalizedEvent<'RACE_CONTROL_STATE'>[] {
  const seen = new Set<string>();
  const out: NormalizedEvent<'RACE_CONTROL_STATE'>[] = [];
  for (const e of sortEvents(events)) {
    if (e.type !== 'RACE_CONTROL_STATE' || e.payload.scope !== 'TRACK' || !e.payload.track_state) continue;
    if (seen.has(e.payload.message_id)) continue;
    seen.add(e.payload.message_id);
    out.push(e);
  }
  return out;
}

export function raceControlTransitions(events: readonly AnyEvent[], initial: TrackState = 'GREEN'): RaceControlTransition[] {
  const out: RaceControlTransition[] = [];
  let state = initial;
  for (const e of trackMessages(events)) {
    const next = e.payload.track_state!;
    if (next === state) continue;
    out.push({
      from: state,
      to: next,
      message_id: e.payload.message_id,
      source_event_id: e.source_event_id,
      occurred_at: e.occurred_at,
      leader_lap: e.payload.leader_lap,
      event: e,
    });
    state = next;
  }
  return out;
}

/** Track state in effect at `tMs` (messages with occurred_at ≤ t). */
export function trackStateAt(events: readonly AnyEvent[], tMs: number, initial: TrackState = 'GREEN'): TrackState {
  let state = initial;
  for (const tr of raceControlTransitions(events, initial)) {
    if (Date.parse(tr.occurred_at) > tMs) break;
    state = tr.to;
  }
  return state;
}
