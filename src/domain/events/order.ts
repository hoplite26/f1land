import type { AnyEvent, EventType, NormalizedEvent } from '../types';

function seq(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Compares numeric strings safely beyond 2^53 (F1-012). */
export function compareSeq(a: string, b: string): number {
  const x = seq(a);
  const y = seq(b);
  if (x !== null && y !== null) return x < y ? -1 : x > y ? 1 : 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical order: occurred_at, then stream_seq (F1-011). */
export function compareEvents(a: AnyEvent, b: AnyEvent): number {
  const d = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  if (d !== 0) return d;
  return compareSeq(a.stream_seq, b.stream_seq);
}

export function sortEvents<E extends AnyEvent>(events: readonly E[]): E[] {
  return [...events].sort(compareEvents);
}

export function ofType<T extends EventType>(events: readonly AnyEvent[], type: T): NormalizedEvent<T>[] {
  return events.filter((e) => e.type === type) as unknown as NormalizedEvent<T>[];
}

export function isEventOf<T extends EventType>(e: AnyEvent, type: T): e is Extract<AnyEvent, { type: T }> {
  return e.type === type;
}
