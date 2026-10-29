import { describe, expect, it, vi } from 'vitest';
import { session } from '../__fixtures__/builder';
import type { AnyEvent, RawSourceRecord } from '../types';
import { checksum } from './checksum';
import { raceControlTransitions, trackStateAt } from './raceControl';
import { EventStore } from './store';

describe('EventStore revisions (F1-011)', () => {
  it('applies a higher numeric source_revision and keeps the full history', () => {
    const s = session();
    const lap = s.lap('nor', 90_000, { lap: 1, time: 90_000 });
    const rev = s.revise(lap, 95_000, { valid: false });
    const store = s.store();
    const canon = store.canonical();
    expect(canon).toHaveLength(1);
    expect(canon[0]!.source_revision).toBe('2');
    expect(canon[0]!.type === 'LAP_COMPLETED' && canon[0]!.payload.valid).toBe(false);
    const history = store.history(lap.source_event_id);
    expect(history.map((h) => h.event.source_revision)).toEqual(['1', '2']);
    expect(history[1]!.previous_revision).toBe('1');
    expect(history[1]!.transform_reason).toBe('REVISION');
    expect(history.every((h) => h.checksum.startsWith('fnv1a64:'))).toBe(true);
    expect(rev.source_event_id).toBe(lap.source_event_id);
  });

  it('compares revisions numerically ("10" > "9") and never lets an older revision win', () => {
    const s = session();
    const lap = s.lap('nor', 90_000, { lap: 1, time: 90_000 });
    const r10 = s.revise(lap, 95_000, { lap_time_ms: 90_010 }, { revision: 10 });
    const r9 = s.revise(lap, 96_000, { lap_time_ms: 90_009 }, { revision: 9 });
    const store = new EventStore();
    expect(store.ingest(lap as AnyEvent).outcome).toBe('APPLIED');
    expect(store.ingest(r10 as AnyEvent).outcome).toBe('REVISION_APPLIED');
    expect(store.ingest(r9 as AnyEvent).outcome).toBe('STALE_REVISION');
    const head = store.canonical()[0]!;
    expect(head.type === 'LAP_COMPLETED' && head.payload.lap_time_ms).toBe(90_010);
    expect(store.history(lap.source_event_id)).toHaveLength(3);
  });

  it('ignores duplicates by (source_event_id, source_revision)', () => {
    const s = session();
    const e = s.rc(1_000, 'SC');
    const store = new EventStore();
    store.ingest(e as AnyEvent);
    expect(store.ingest(e as AnyEvent).outcome).toBe('DUPLICATE');
    expect(store.size).toBe(1);
    expect(store.quarantine).toHaveLength(0);
    // Same pair, different content → conflict is quarantined for audit; canonical unchanged.
    const tampered = { ...e, payload: { ...e.payload, track_state: 'RED' as const } };
    expect(store.ingest(tampered as AnyEvent).outcome).toBe('DUPLICATE');
    expect(store.quarantine[0]!.reason).toBe('REVISION_CONFLICT');
  });

  it('removes retracted records and superseded records from the canonical set', () => {
    const s = session();
    const a = s.pitEntry('nor', 10_000, { visit: 'v1' });
    const b = s.pitEntry('lec', 11_000, { visit: 'v2' });
    s.retract(a, 12_000);
    s.pitEntry('lec', 11_005, { visit: 'v2', supersedes: b.source_event_id, id: 'src_replacement' });
    const canon = s.store().canonical();
    expect(canon.map((e) => e.source_event_id)).toEqual(['src_replacement']);
  });

  it('orders by occurred_at, then BigInt(stream_seq) beyond 2^53', () => {
    const s = session();
    const big1 = { ...s.rc(1_000, 'SC'), stream_seq: '9007199254740993' } as AnyEvent;
    const big2 = { ...s.rc(1_000, 'VSC', { id: 'x2' }), stream_seq: '9007199254740992' } as AnyEvent;
    const early = { ...s.rc(500, 'RED', { id: 'x3' }), stream_seq: '99999999999999999999' } as AnyEvent;
    const store = new EventStore();
    store.ingestMany([big1, big2, early]);
    expect(store.canonical().map((e) => e.stream_seq)).toEqual(['99999999999999999999', '9007199254740992', '9007199254740993']);
  });

  it('memoises canonical() until the next change and notifies subscribers', () => {
    const s = session();
    const store = new EventStore();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.ingest(s.rc(1_000, 'SC') as AnyEvent);
    const c1 = store.canonical();
    expect(store.canonical()).toBe(c1);
    store.ingest(s.rc(2_000, 'GREEN') as AnyEvent);
    expect(store.canonical()).not.toBe(c1);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    store.ingest(s.rc(3_000, 'VSC') as AnyEvent);
    expect(fn).toHaveBeenCalledTimes(2);
    store.ingestMany([s.rc(4_000, 'GREEN') as AnyEvent, s.rc(5_000, 'SC') as AnyEvent]);
    expect(store.version).toBe(5);
  });
});

describe('quarantine (F1-014)', () => {
  it('puts unknown codes and malformed bodies into quarantine', () => {
    const s = session();
    const store = new EventStore();
    const raw: RawSourceRecord = { source_event_id: 'raw1', source_revision: '1', code: 'DRS_ENABLED', received_at: s.iso(0), checksum: 'abc', body: {} };
    expect(store.ingestRaw(raw).outcome).toBe('QUARANTINED');
    expect(store.ingestRaw({ ...raw, source_event_id: 'raw2', code: 'PIT_ENTRY', body: { foo: 1 } }).outcome).toBe('QUARANTINED');
    expect(store.quarantine.map((q) => q.reason)).toEqual(['UNKNOWN_CODE', 'MALFORMED']);
    expect(store.canonical()).toHaveLength(0);
  });

  it('accepts a known code with a normalized body and keeps the source checksum', () => {
    const s = session();
    const ev = s.pitEntry('nor', 1_000, { visit: 'v1' });
    const store = new EventStore();
    const res = store.ingestRaw({ source_event_id: ev.source_event_id, source_revision: '1', code: 'PIT_ENTRY', received_at: ev.received_at, checksum: 'src-123', body: ev });
    expect(res.outcome).toBe('APPLIED');
    expect(res.checksum).toBe(checksum(ev));
    expect(store.history(ev.source_event_id)[0]!.source_checksum).toBe('src-123');
  });
});

describe('live timing snapshot (F1-058)', () => {
  it('a lower snapshot_revision never rolls back the live snapshot', () => {
    const s = session();
    const newer = s.timing(10_000, ['nor', 'lec'], { leaderLap: 5, snapshotRevision: 8 });
    const older = s.timing(9_000, ['lec', 'nor'], { leaderLap: 5, snapshotRevision: 7 });
    const store = new EventStore();
    store.ingest(newer as AnyEvent);
    expect(store.ingest(older as AnyEvent).outcome).toBe('STALE_SNAPSHOT');
    expect(store.latestTimingOrder()!.payload.snapshot_revision).toBe(8);
    // The older snapshot stays available as historical evidence.
    expect(store.canonical()).toHaveLength(2);
  });
});

describe('corrections explainer (F1-042, F1-056)', () => {
  it('lists revisions with field diffs, retractions and declared corrections', () => {
    const s = session();
    const lap = s.lap('nor', 90_000, { lap: 3, time: 84_500 });
    s.revise(lap, 100_000, { valid: false });
    const pass = s.pass(50_000, 'nor', 'lec');
    s.retract(pass, 101_000);
    s.emit('EVENT_CORRECTED', 102_000, {
      corrected_source_event_id: lap.source_event_id,
      previous_revision: '1',
      new_revision: '2',
      reason_key: 'f1.correction.revised',
      before: { valid: true },
      after: { valid: false },
    });
    const list = s.store().corrections();
    const revised = list.find((c) => c.kind === 'REVISED')!;
    expect(revised.changes).toEqual([{ field: 'payload.valid', before: true, after: false }]);
    expect(list.find((c) => c.kind === 'RETRACTED')!.source_event_id).toBe(pass.source_event_id);
    expect(list.find((c) => c.kind === 'DECLARED')!.changes).toEqual([{ field: 'valid', before: true, after: false }]);
  });
});

describe('race control transitions (F1-022, QA09)', () => {
  it('VSC → SC with a repeated message gives two transitions', () => {
    const s = session();
    s.rc(1_000, 'VSC', { messageId: 'm1' });
    s.rc(5_000, 'SC', { messageId: 'm2' });
    s.rc(5_200, 'SC', { messageId: 'm2' }); // repeated message, different source record
    s.sectorFlag(6_000, 2, 'YELLOW');
    const tr = raceControlTransitions(s.store().canonical());
    expect(tr.map((t) => `${t.from}->${t.to}`)).toEqual(['GREEN->VSC', 'VSC->SC']);
    expect(trackStateAt(s.store().canonical(), s.abs(6_500))).toBe('SC');
  });

  it('a yellow sector never becomes SC', () => {
    const s = session();
    s.sectorFlag(1_000, 1, 'DOUBLE_YELLOW');
    expect(raceControlTransitions(s.store().canonical())).toEqual([]);
  });
});
