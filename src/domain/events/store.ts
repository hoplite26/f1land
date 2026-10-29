/**
 * Canonical event store (F1-011, F1-014, F1-056, F1-058).
 *
 * - Keeps every revision of every source record (audit + "what changed").
 * - The canonical set holds the highest numeric source_revision per
 *   source_event_id, minus retracted heads and records superseded via
 *   supersedes_source_event_id.
 * - Duplicates by (source_event_id, source_revision) are ignored.
 * - Unknown raw codes go to quarantine.
 * - A TIMING_ORDER with a lower snapshot_revision never rolls back the live snapshot.
 */
import { KNOWN_EVENT_TYPES, type AnyEvent, type CanonicalEvent, type EventType, type NormalizedEvent, type RawSourceRecord } from '../types';
import { checksum, stableStringify } from './checksum';
import { compareEvents, compareSeq } from './order';

export type TransformReason = 'NEW' | 'REVISION' | 'SUPERSEDES' | 'RETRACTION' | 'STALE_REVISION';

export interface StoredMessage {
  event: AnyEvent;
  checksum: string;
  /** Checksum supplied by the raw source record, when ingested through ingestRaw. */
  source_checksum: string | null;
  /** Local ingestion order. */
  ingest_seq: number;
  /** Highest revision known for this source_event_id before this message. */
  previous_revision: string | null;
  transform_reason: TransformReason;
}

export type IngestOutcome =
  | 'APPLIED'
  | 'REVISION_APPLIED'
  | 'RETRACTED'
  | 'DUPLICATE'
  | 'STALE_REVISION'
  | 'STALE_SNAPSHOT'
  | 'QUARANTINED';

export interface IngestResult {
  outcome: IngestOutcome;
  source_event_id: string;
  source_revision: string;
  checksum: string | null;
}

export type QuarantineReason = 'UNKNOWN_CODE' | 'MALFORMED' | 'REVISION_CONFLICT';

export interface QuarantineRecord {
  raw: RawSourceRecord;
  reason: QuarantineReason;
  quarantined_at: string;
}

export type FieldValue = string | number | boolean | null;

export interface FieldChange {
  field: string;
  before: FieldValue;
  after: FieldValue;
}

export interface CorrectionRecord {
  source_event_id: string;
  type: EventType;
  kind: 'REVISED' | 'RETRACTED' | 'SUPERSEDED' | 'DECLARED';
  previous_revision: string | null;
  new_revision: string | null;
  previous: AnyEvent | null;
  current: AnyEvent | null;
  changes: FieldChange[];
  reason_key: string;
  occurred_at: string;
  received_at: string;
}

export interface StoreChange {
  result: IngestResult;
  /** Increments whenever the canonical set changes. */
  version: number;
}

export type StoreListener = (change: StoreChange) => void;

function flatten(value: unknown, prefix: string, out: Record<string, FieldValue>): void {
  if (value === null || value === undefined) {
    out[prefix] = null;
  } else if (Array.isArray(value)) {
    out[prefix] = stableStringify(value);
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out[prefix] = value;
  }
}

/** Field-level diff of two event revisions (occurred_at + payload). */
export function diffEvents(before: AnyEvent | null, after: AnyEvent | null): FieldChange[] {
  const a: Record<string, FieldValue> = {};
  const b: Record<string, FieldValue> = {};
  if (before) {
    a.occurred_at = before.occurred_at;
    flatten(before.payload, 'payload', a);
  }
  if (after) {
    b.occurred_at = after.occurred_at;
    flatten(after.payload, 'payload', b);
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const changes: FieldChange[] = [];
  for (const k of keys) {
    const x = a[k] ?? null;
    const y = b[k] ?? null;
    if (x !== y) changes.push({ field: k, before: x, after: y });
  }
  return changes;
}

const ENVELOPE_FIELDS = ['schema_version', 'event_id', 'stream_seq', 'source_event_id', 'source_revision', 'occurred_at', 'type', 'payload'] as const;

function looksNormalized(body: unknown): body is AnyEvent {
  if (!body || typeof body !== 'object') return false;
  const obj = body as Record<string, unknown>;
  return ENVELOPE_FIELDS.every((f) => obj[f] !== undefined) && obj.schema_version === 'pulse.event.v1';
}

export class EventStore {
  private readonly revisions = new Map<string, StoredMessage[]>();
  private readonly quarantined: QuarantineRecord[] = [];
  private readonly listeners = new Set<StoreListener>();
  private ingestCounter = 0;
  private canonicalCache: readonly CanonicalEvent[] | null = null;
  private liveSnapshot: NormalizedEvent<'TIMING_ORDER'> | null = null;
  private batchDepth = 0;
  private batchResults: IngestResult[] = [];
  private _version = 0;

  get version(): number {
    return this._version;
  }

  get quarantine(): readonly QuarantineRecord[] {
    return this.quarantined;
  }

  /** Number of stored messages (all revisions). */
  get size(): number {
    let n = 0;
    for (const list of this.revisions.values()) n += list.length;
    return n;
  }

  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  ingest(event: AnyEvent): IngestResult {
    const result = this.ingestOne(event, null);
    this.emit(result);
    return result;
  }

  /** Ingests a batch and notifies subscribers once with the last result. */
  ingestMany(events: readonly AnyEvent[]): IngestResult[] {
    this.batchDepth++;
    try {
      for (const e of events) this.batchResults.push(this.ingestOne(e, null));
    } finally {
      this.batchDepth--;
    }
    const results = this.batchResults;
    this.batchResults = [];
    const last = results[results.length - 1];
    if (last) this.emit(last);
    return results;
  }

  /** Raw source record path: unknown codes and malformed bodies go to quarantine (F1-014). */
  ingestRaw(raw: RawSourceRecord): IngestResult {
    let result: IngestResult;
    if (!(KNOWN_EVENT_TYPES as readonly string[]).includes(raw.code)) {
      result = this.toQuarantine(raw, 'UNKNOWN_CODE');
    } else if (
      !looksNormalized(raw.body) ||
      raw.body.type !== raw.code ||
      raw.body.source_event_id !== raw.source_event_id ||
      raw.body.source_revision !== raw.source_revision
    ) {
      result = this.toQuarantine(raw, 'MALFORMED');
    } else {
      result = this.ingestOne(raw.body, raw);
    }
    this.emit(result);
    return result;
  }

  /** Canonical events sorted by (occurred_at, stream_seq); memoised until the next change. */
  canonical(): readonly CanonicalEvent[] {
    if (this.canonicalCache) return this.canonicalCache;
    const heads = new Map<string, AnyEvent>();
    for (const [id, list] of this.revisions) {
      const head = list[list.length - 1]!.event;
      if (!head.is_retracted) heads.set(id, head);
    }
    for (const head of [...heads.values()]) {
      const target = head.supersedes_source_event_id;
      if (target && target !== head.source_event_id) heads.delete(target);
    }
    this.canonicalCache = Object.freeze([...heads.values()].sort(compareEvents));
    return this.canonicalCache;
  }

  /** Full revision history of one source record, oldest revision first. */
  history(sourceEventId: string): readonly StoredMessage[] {
    return this.revisions.get(sourceEventId) ?? [];
  }

  /** Current head (may be retracted) of a source record. */
  head(sourceEventId: string): AnyEvent | null {
    const list = this.revisions.get(sourceEventId);
    return list ? list[list.length - 1]!.event : null;
  }

  /** Live timing snapshot: highest snapshot_revision applied so far (F1-058). */
  latestTimingOrder(): NormalizedEvent<'TIMING_ORDER'> | null {
    const current = this.liveSnapshot;
    if (!current) return null;
    // A retraction/supersession of the live snapshot falls back to the best remaining one.
    const canonical = this.canonical();
    if (canonical.includes(current as AnyEvent)) return current;
    let best: NormalizedEvent<'TIMING_ORDER'> | null = null;
    for (const e of canonical) {
      if (e.type !== 'TIMING_ORDER') continue;
      if (!best || e.payload.snapshot_revision >= best.payload.snapshot_revision) best = e;
    }
    return best;
  }

  /** Corrections for the UI "what changed" explainer (F1-042, F1-056), newest last. */
  corrections(): CorrectionRecord[] {
    const out: CorrectionRecord[] = [];
    for (const [id, list] of this.revisions) {
      const applied = list.filter((m) => m.transform_reason !== 'STALE_REVISION');
      for (let i = 1; i < applied.length; i++) {
        const prev = applied[i - 1]!.event;
        const next = applied[i]!.event;
        out.push({
          source_event_id: id,
          type: next.type,
          kind: next.is_retracted ? 'RETRACTED' : 'REVISED',
          previous_revision: prev.source_revision,
          new_revision: next.source_revision,
          previous: prev,
          current: next.is_retracted ? null : next,
          changes: next.is_retracted ? [] : diffEvents(prev, next),
          reason_key: next.is_retracted ? 'f1.correction.retracted' : 'f1.correction.revised',
          occurred_at: next.occurred_at,
          received_at: next.received_at,
        });
      }
      const head = list[list.length - 1]!.event;
      const target = head.supersedes_source_event_id;
      if (target && target !== id && !head.is_retracted) {
        const replaced = this.head(target);
        out.push({
          source_event_id: target,
          type: head.type,
          kind: 'SUPERSEDED',
          previous_revision: replaced?.source_revision ?? null,
          new_revision: head.source_revision,
          previous: replaced,
          current: head,
          changes: diffEvents(replaced, head),
          reason_key: 'f1.correction.superseded',
          occurred_at: head.occurred_at,
          received_at: head.received_at,
        });
      }
    }
    for (const e of this.canonical()) {
      if (e.type !== 'EVENT_CORRECTED') continue;
      const p = e.payload;
      const keys = [...new Set([...Object.keys(p.before ?? {}), ...Object.keys(p.after ?? {})])].sort();
      out.push({
        source_event_id: p.corrected_source_event_id,
        type: this.head(p.corrected_source_event_id)?.type ?? 'EVENT_CORRECTED',
        kind: 'DECLARED',
        previous_revision: p.previous_revision,
        new_revision: p.new_revision,
        previous: null,
        current: null,
        changes: keys
          .map((k) => ({ field: k, before: p.before?.[k] ?? null, after: p.after?.[k] ?? null }))
          .filter((c) => c.before !== c.after),
        reason_key: p.reason_key,
        occurred_at: e.occurred_at,
        received_at: e.received_at,
      });
    }
    return out.sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  }

  /* ---------------------------------------------------------------- */

  private ingestOne(event: AnyEvent, raw: RawSourceRecord | null): IngestResult {
    const sum = checksum(event);
    const id = event.source_event_id;
    const list = this.revisions.get(id) ?? [];
    const base = { source_event_id: id, source_revision: event.source_revision, checksum: sum };

    const duplicate = list.find((m) => m.event.source_revision === event.source_revision);
    if (duplicate) {
      if (duplicate.checksum !== sum) {
        this.quarantined.push({
          raw: raw ?? {
            source_event_id: id,
            source_revision: event.source_revision,
            code: event.type,
            received_at: event.received_at,
            checksum: sum,
            body: event,
          },
          reason: 'REVISION_CONFLICT',
          quarantined_at: event.received_at,
        });
      }
      return { ...base, outcome: 'DUPLICATE' };
    }

    const head = list[list.length - 1]?.event ?? null;
    const isStale = head !== null && compareSeq(event.source_revision, head.source_revision) < 0;
    const reason: TransformReason = isStale
      ? 'STALE_REVISION'
      : event.is_retracted
        ? 'RETRACTION'
        : head
          ? 'REVISION'
          : event.supersedes_source_event_id
            ? 'SUPERSEDES'
            : 'NEW';
    const stored: StoredMessage = {
      event,
      checksum: sum,
      source_checksum: raw?.checksum ?? null,
      ingest_seq: ++this.ingestCounter,
      previous_revision: head?.source_revision ?? null,
      transform_reason: reason,
    };
    list.push(stored);
    list.sort((a, b) => compareSeq(a.event.source_revision, b.event.source_revision));
    this.revisions.set(id, list);

    if (isStale) return { ...base, outcome: 'STALE_REVISION' };

    this.canonicalCache = null;
    this._version++;

    let outcome: IngestOutcome = event.is_retracted ? 'RETRACTED' : head ? 'REVISION_APPLIED' : 'APPLIED';
    if (event.type === 'TIMING_ORDER' && !event.is_retracted) {
      const live = this.liveSnapshot;
      if (!live || event.payload.snapshot_revision >= live.payload.snapshot_revision || live.source_event_id === id) {
        this.liveSnapshot = event;
      } else if (outcome === 'APPLIED') {
        outcome = 'STALE_SNAPSHOT';
      }
    }
    return { ...base, outcome };
  }

  private toQuarantine(raw: RawSourceRecord, reason: QuarantineReason): IngestResult {
    this.quarantined.push({ raw, reason, quarantined_at: raw.received_at });
    return { outcome: 'QUARANTINED', source_event_id: raw.source_event_id, source_revision: raw.source_revision, checksum: null };
  }

  private emit(result: IngestResult): void {
    if (this.batchDepth > 0) return;
    const change: StoreChange = { result, version: this._version };
    for (const fn of [...this.listeners]) fn(change);
  }
}
