import { describe, expect, it } from 'vitest';
import { RaceSim } from './raceSim';
import { synthCircuit, synthManifest } from './testing/synthCircuit';

describe('RaceSim (DEMO contour)', () => {
  const start = Date.parse('2026-10-08T15:00:00Z');
  const make = (seed = 'seed-a', laps = 6) =>
    new RaceSim({ manifest: synthManifest(start, laps), circuit: synthCircuit(), seed, laps, startMs: start, scenario: { incidentRate: 0 } });

  it('runs a full race deterministically and publishes a classification', () => {
    const a = make();
    a.advanceTo(60 * 20);
    const b = make();
    b.advanceTo(60 * 20);
    expect(a.finished).toBe(true);
    expect(a.emitter.events.length).toBe(b.emitter.events.length);
    expect(JSON.stringify(a.live().cars.map((c) => c.id))).toBe(JSON.stringify(b.live().cars.map((c) => c.id)));
    const cls = a.emitter.events.filter((e) => e.type === 'CLASSIFICATION_PUBLISHED');
    expect(cls.length).toBeGreaterThanOrEqual(2);
    const types = new Set(a.emitter.events.map((e) => e.type));
    for (const t of ['SESSION_STATE', 'RACE_CONTROL_STATE', 'TIMING_ORDER', 'LAP_COMPLETED', 'SECTOR_COMPLETED', 'DRIVER_STATUS']) expect(types.has(t as never)).toBe(true);
  });

  it('produces realistic lap times and stream_seq strings', () => {
    const s = make('seed-b');
    s.advanceTo(400);
    const laps = s.emitter.events.filter((e) => e.type === 'LAP_COMPLETED');
    expect(laps.length).toBeGreaterThan(20);
    for (const e of laps) {
      if (e.type !== 'LAP_COMPLETED') continue;
      expect(e.payload.lap_time_ms).toBeGreaterThan(20_000);
      expect(e.payload.lap_time_ms).toBeLessThan(120_000);
    }
    expect(typeof s.emitter.events[0]!.stream_seq).toBe('string');
    const live = s.live();
    expect(live.cars).toHaveLength(22);
    expect(new Set(live.cars.map((c) => c.position)).size).toBe(22);
  });

  it('only emits verified same-lap ON_TRACK_PASS events under green', () => {
    const s = make('seed-c', 8);
    s.advanceTo(60 * 25);
    const passes = s.emitter.events.filter((e) => e.type === 'ON_TRACK_PASS');
    for (const e of passes) {
      if (e.type !== 'ON_TRACK_PASS') continue;
      expect(e.payload.passing_driver_lap).toBe(e.payload.passed_driver_lap);
      expect(e.payload.track_state).toBe('GREEN');
    }
  });

  it('handles safety car, pit visits and red flag triggers', () => {
    const s = make('seed-d', 10);
    s.advanceTo(200);
    s.trigger('SC');
    s.advanceTo(420);
    s.trigger('RED');
    s.advanceTo(900);
    const rc = s.emitter.events.filter((e) => e.type === 'RACE_CONTROL_STATE').map((e) => (e.type === 'RACE_CONTROL_STATE' ? e.payload.track_state : null));
    expect(rc).toContain('SC');
    expect(rc).toContain('RED');
    const entries = s.emitter.events.filter((e) => e.type === 'PIT_ENTRY');
    const exits = s.emitter.events.filter((e) => e.type === 'PIT_EXIT');
    expect(entries.length).toBeGreaterThan(0);
    expect(exits.length).toBeGreaterThan(0);
  });
});
