import { describe, expect, it } from 'vitest';
import { session } from './__fixtures__/builder';
import { affectedPools, buildDemoCapabilities, capabilityLevel, isMarketAvailable, marketAvailability } from './capabilities';
import { CATALOG, MARKET_IDS, requiredCapabilitiesFor } from './markets/catalog';

describe('capabilities (F1-009, F1-010, F1-032)', () => {
  it('DEGRADED never counts as available for a market requiring it', () => {
    const s = session({ degraded: ['stationary_stop'] });
    expect(capabilityLevel(s.manifest, 'stationary_stop')).toBe('DEGRADED');
    expect(s.manifest.capabilities.stationary_stop).toBe(true);
    const a = marketAvailability(CATALOG['F1-M05'], s.manifest);
    expect(a).toMatchObject({ available: false, degraded: ['stationary_stop'], reason_key: 'f1.availability.degraded_signal' });
    expect(isMarketAvailable(CATALOG['F1-M06'], s.manifest)).toBe(true);
  });

  it('M07 is unavailable without on_track_pass while position markets stay', () => {
    const s = session({ unavailable: ['on_track_pass', 'aero_mode'] });
    expect(isMarketAvailable(CATALOG['F1-M07'], s.manifest)).toBe(false);
    expect(isMarketAvailable(CATALOG['F1-M01'], s.manifest)).toBe(true);
    expect(isMarketAvailable(CATALOG['F1-M02'], s.manifest)).toBe(true);
  });

  it('losing location keeps classification and timing markets (QA10)', () => {
    const s = session({ unavailable: ['location', 'aero_mode'] });
    for (const id of ['F1-M01', 'F1-M02', 'F1-M11', 'F1-M13', 'F1-M14'] as const) expect(isMarketAvailable(CATALOG[id], s.manifest)).toBe(true);
  });

  it('a lost required signal suspends only the affected pools', () => {
    const s = session();
    const pools = MARKET_IDS.map((market_id) => ({ market_id }));
    const affected = affectedPools(pools, ['stationary_stop'], (id) => requiredCapabilitiesFor(CATALOG[id]));
    expect(affected.map((p) => p.market_id)).toEqual(['F1-M05']);
    expect(isMarketAvailable(CATALOG['F1-M05'], s.manifest, ['stationary_stop'])).toBe(false);
    expect(affectedPools(pools, [], () => [])).toEqual([]);
  });

  it('session type gating and DEMO manifest defaults', () => {
    const q = session({ type: 'QUALIFYING' });
    expect(marketAvailability(CATALOG['F1-M13'], q.manifest).reason_key).toBe('f1.availability.session_type');
    const caps = buildDemoCapabilities();
    expect(caps.capabilities.aero_mode).toBe(false);
    expect(caps.quality.aero_mode.level).toBe('UNAVAILABLE');
    expect(caps.quality.laps.level).toBe('SUPPORTED');
  });
});
