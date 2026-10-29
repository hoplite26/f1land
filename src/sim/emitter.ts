import type { AnyEvent, EventType, NormalizedEvent, PayloadByType } from '@/domain/types';

export const SOURCE_PRODUCT = 'formula1-deterministic-v1';
export const MAPPING_VERSION = 'f1-demo-sim-v1';

/**
 * Produces normalized events (F1-011) for the DEMO contour. Times are in
 * sim-epoch milliseconds (UTC). Delivery latency is modelled as a small
 * deterministic delay so received/published differ from occurred.
 */
export class EventEmitter {
  private seq = 0n;
  private counters = new Map<string, number>();
  readonly events: AnyEvent[] = [];
  private listeners: Array<(e: AnyEvent) => void> = [];

  constructor(
    readonly eventId: string,
    private readonly latencyMs = 380,
  ) {}

  onEvent(fn: (e: AnyEvent) => void): void {
    this.listeners.push(fn);
  }

  private nextId(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${String(n).padStart(4, '0')}`;
  }

  emit<T extends EventType>(
    type: T,
    payload: PayloadByType[T],
    occurredMs: number,
    opts: {
      periodId: string;
      attemptId?: string | null;
      sourceId?: string;
      revision?: number;
      supersedes?: string | null;
      retracted?: boolean;
      uncertaintyMs?: number;
    },
  ): NormalizedEvent<T> {
    this.seq += 1n;
    const occurred = Math.round(occurredMs);
    const received = occurred + this.latencyMs;
    const ev: NormalizedEvent<T> = {
      schema_version: 'pulse.event.v1',
      event_id: this.eventId,
      stream_seq: this.seq.toString(),
      source_event_id: opts.sourceId ?? this.nextId(`src_${type.toLowerCase()}`),
      source_provider: 'demo-sim',
      source_product: SOURCE_PRODUCT,
      source_revision: String(opts.revision ?? 1),
      occurred_at: new Date(occurred).toISOString(),
      received_at: new Date(received).toISOString(),
      published_at: new Date(received + 70).toISOString(),
      timestamp_uncertainty_ms: opts.uncertaintyMs ?? 10,
      period_id: opts.periodId,
      attempt_id: opts.attemptId ?? null,
      type,
      payload,
      supersedes_source_event_id: opts.supersedes ?? null,
      is_retracted: opts.retracted ?? false,
      mapping_version: MAPPING_VERSION,
    };
    this.events.push(ev as unknown as AnyEvent);
    for (const l of this.listeners) l(ev as unknown as AnyEvent);
    return ev;
  }
}
