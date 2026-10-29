import { describe, expect, it } from 'vitest';
import {
  DEADLINE_PROFILE,
  DEMO_LOCK_BUFFER_PROFILE,
  DEMO_PIT_THRESHOLDS,
  DEMO_REVIEW_PROFILE,
  DEMO_SHORT_WINDOW_PROFILES_MS,
  allowedShortWindowProfiles,
  lockBufferMs,
  reviewPeriodMs,
} from './profiles';

describe('project profiles', () => {
  it('DEMO short windows are 30/60/120 s (F1-021); degraded data allows only longer ones', () => {
    expect([...DEMO_SHORT_WINDOW_PROFILES_MS]).toEqual([30_000, 60_000, 120_000]);
    expect(allowedShortWindowProfiles(1_000, 10)).toEqual([30_000, 60_000, 120_000]);
    expect(allowedShortWindowProfiles(4_000, 250)).toEqual([120_000]);
    expect(allowedShortWindowProfiles(10_000)).toEqual([]);
  });

  it('lock buffer is configurable, documented as DEMO and depends on signal character (F1-017)', () => {
    expect(DEMO_LOCK_BUFFER_PROFILE.demo).toBe(true);
    expect(lockBufferMs('PIT_VISIT', 10)).toBeGreaterThan(lockBufferMs('SECTOR', 10));
    expect(lockBufferMs('LAP', 250)).toBeGreaterThan(lockBufferMs('LAP', 10));
    expect(lockBufferMs('LAP', 10, { ...DEMO_LOCK_BUFFER_PROFILE, measured_latency_ms: 0, signal_margin_ms: { ...DEMO_LOCK_BUFFER_PROFILE.signal_margin_ms, LAP: 0 } })).toBe(10);
  });

  it('settlement deadline offsets follow F1-067', () => {
    expect(DEADLINE_PROFILE).toMatchObject({
      short_window_ms: 120_000,
      pit_visit_ms: 180_000,
      m08_ms: 600_000,
      m19_ms: 120_000,
      session_final_ms: 24 * 3_600_000,
      snapshot_ms: 120_000,
    });
  });

  it('DEMO pit thresholds and review period', () => {
    expect(DEMO_PIT_THRESHOLDS['F1-M05']).toEqual({ t1_ms: 2_500, t2_ms: 3_000 });
    expect(DEMO_PIT_THRESHOLDS['F1-M06']!.t1_ms).toBeLessThan(DEMO_PIT_THRESHOLDS['F1-M06']!.t2_ms);
    expect(DEMO_REVIEW_PROFILE.demo).toBe(true);
    expect(reviewPeriodMs('CLASSIFICATION')).toBeGreaterThan(reviewPeriodMs('PIT'));
  });
});
