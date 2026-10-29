import { describe, expect, it } from 'vitest';
import { ALL_DRIVERS, session } from '../__fixtures__/builder';
import type { MarketId, Pool } from '../types';
import { CATALOG, MARKET_IDS, describePool, getTemplate, listTemplates, requiredCapabilitiesFor, type PoolParams } from './catalog';
import { PoolValidationError, createPool, planPoolTiming, validatePoolTemplate } from './factory';
import { F1_I18N, formatI18n } from './i18n';

const ids = (p: Pool) => p.outcomes.map((o) => o.id);

describe('catalog F1-M01 … F1-M21', () => {
  it('has all 21 templates with versions, determinants and policies', () => {
    expect(MARKET_IDS).toHaveLength(21);
    expect(listTemplates().map((t) => t.id)).toEqual(MARKET_IDS);
    for (const t of listTemplates()) {
      expect(t.template_version).toBe(`f1-${t.id.slice(3).toLowerCase()}-v1`);
      expect(t.required_capabilities.length).toBeGreaterThan(0);
      expect(t.allowed_session_types.length).toBeGreaterThan(0);
      expect(getTemplate(t.id)).toBe(t);
    }
    expect(CATALOG['F1-M01'].determinant).toBe('TIMING_ORDER');
    expect(CATALOG['F1-M07'].determinant).toBe('TRACK_ORDER');
    expect(CATALOG['F1-M13'].determinant).toBe('OFFICIAL_CLASSIFICATION');
    expect(CATALOG['F1-M08'].interruption_policy).toBe('VOID_IF_INTERRUPTED');
    expect(CATALOG['F1-M10'].interruption_policy).toBe('CONTINUE');
    expect(CATALOG['F1-M13'].interruption_policy).toBe('WAIT_FOR_FINAL');
    expect(CATALOG['F1-M11'].target_kind).toBe('AT_INSTANT');
    expect(CATALOG['F1-M08'].target_kind).toBe('LAP');
    expect(CATALOG['F1-M09'].target_kind).toBe('WINDOW');
    expect(CATALOG['F1-M13'].target_kind).toBe('SESSION');
    expect(CATALOG['F1-M07'].required_capabilities).toContain('on_track_pass');
    expect(CATALOG['F1-M11'].required_capabilities).not.toContain('location');
  });
});

describe('complete outcome sets', () => {
  const race = session();
  const nb = 600_000;
  it('M01: P1…PN + RETIRED, DNS, DSQ', () => {
    const p = race.shortPool('F1-M01', { driver_a: 'nor', target_lap: 20, lap_anchor: 'LEADER' }, nb);
    expect(ids(p)).toEqual([...ALL_DRIVERS.map((_, i) => `P${i + 1}`), 'RETIRED', 'DNS', 'DSQ']);
  });
  it('M02, M03, M04, M05, M06, M07, M08', () => {
    expect(ids(race.shortPool('F1-M02', { driver_a: 'nor', driver_b: 'lec', target_lap: 20, lap_anchor: 'LEADER' }, nb))).toEqual(['A', 'B', 'BOTH_INACTIVE']);
    expect(ids(race.shortPool('F1-M03', {}, nb))).toEqual([...ALL_DRIVERS, 'NO_ENTRY']);
    expect(ids(race.shortPool('F1-M04', { driver_a: 'nor' }, nb))).toEqual(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'OTHER_CONFIRMED', 'NO_EXIT']);
    const m05 = race.shortPool('F1-M05', { driver_a: 'nor' }, nb);
    expect(ids(m05)).toEqual(['BUCKET_1', 'BUCKET_2', 'BUCKET_3', 'NO_SERVICE']);
    expect(m05.target.parameters).toMatchObject({ t1_ms: 2500, t2_ms: 3000, threshold_units: 'ms' });
    expect(ids(race.shortPool('F1-M06', { driver_a: 'nor' }, nb))).toEqual(['BUCKET_1', 'BUCKET_2', 'BUCKET_3', 'NO_VISIT']);
    expect(ids(race.shortPool('F1-M07', { driver_a: 'nor', driver_b: 'lec' }, nb))).toEqual(['A_PASSES_B', 'B_PASSES_A', 'NO_PASS']);
    expect(ids(race.shortPool('F1-M08', { driver_a: 'nor', reference_time_ms: 84_000 }, nb))).toEqual(['FASTER', 'EQUAL', 'SLOWER', 'NO_VALID_LAP']);
  });
  it('M09–M12, M19–M21', () => {
    expect(ids(race.shortPool('F1-M09', {}, nb))).toEqual([...ALL_DRIVERS, 'TIE', 'NO_VALID_LAP']);
    expect(ids(race.shortPool('F1-M10', {}, nb))).toEqual(['SC', 'VSC', 'RED', 'NONE']);
    expect(ids(race.pool('F1-M11', { driver_a: 'nor', at_instant: race.iso(nb + 30_000) }, { closes: nb - 1_000 }))).toEqual(['S1', 'S2', 'S3', 'PIT', 'RETIRED', 'DNS', 'DSQ']);
    expect(ids(race.shortPool('F1-M12', {}, nb))).toEqual([...ALL_DRIVERS, 'NONE']);
    expect(ids(race.shortPool('F1-M12', { tie_profile: { tie_precision_ms: 1000, tie_origin_at: race.iso(0) } }, nb))).toContain('SIMULTANEOUS');
    expect(ids(race.shortPool('F1-M12', { simultaneous_source_group: true }, nb))).toContain('SIMULTANEOUS');
    expect(ids(race.shortPool('F1-M19', { driver_a: 'nor', sector: 2, t1_ms: 30_000, t2_ms: 31_000 }, nb))).toEqual(['BUCKET_1', 'BUCKET_2', 'BUCKET_3', 'NO_VALID_SECTOR']);
    expect(ids(race.shortPool('F1-M20', { driver_a: 'nor' }, nb))).toEqual(['YES', 'NO']);
    const m21 = race.pool(
      'F1-M21',
      { at_instant: race.iso(nb + 30_000), combo: [{ kind: 'POSITION_GROUP', driver_id: 'nor', value: 'P1_3' }, { kind: 'TYRE_COMPOUND', driver_id: 'nor', value: 'MEDIUM' }] },
      { closes: nb - 1_000 },
    );
    expect(ids(m21)).toEqual(['BOTH_TRUE', 'NOT_BOTH']);
    expect(m21.subject.driver_a).toBe('nor');
  });
  it('M13–M18', () => {
    expect(ids(race.pool('F1-M13', { driver_a: 'nor' }, { closes: 0 }))).toEqual(['P1', 'P2_3', 'P4_10', 'P11_PLUS', 'NOT_CLASSIFIED', 'DNS', 'DSQ']);
    expect(ids(race.pool('F1-M14', { driver_a: 'nor' }, { closes: 0 }))).toEqual(['YES', 'NO']);
    const sprint = session({ type: 'SPRINT' });
    expect(ids(sprint.pool('F1-M18', { driver_a: 'nor' }, { closes: 0 }))).toEqual(['P1', 'P2_3', 'P4_8', 'P9_PLUS', 'NOT_CLASSIFIED', 'DNS', 'DSQ']);
    const q = session({ type: 'QUALIFYING' });
    expect(ids(q.pool('F1-M15', { driver_a: 'nor', segment_id: 'Q1' }, { closes: 0 }))).toEqual(['YES', 'NO']);
    expect(ids(q.pool('F1-M16', { driver_a: 'nor', driver_b: 'lec', segment_id: 'Q2' }, { closes: 0 }))).toEqual(['A', 'B', 'TIE', 'NEITHER_VALID']);
    const admitted = ALL_DRIVERS.slice(0, 10);
    expect(ids(q.pool('F1-M17', { segment_id: 'Q3', admitted }, { closes: 0 }))).toEqual(admitted);
  });
});

describe('createPool (F1-005, F1-027, F1-067)', () => {
  it('stores manifest versions, frozen parameters, an absolute deadline and SCHEDULED/OPEN status', () => {
    const s = session();
    const p = s.pool('F1-M08', { driver_a: 'nor', reference_time_ms: 84_321, reference_attempt_id: 'nor:lap:3' }, { opens: 0, created: -5_000, closes: 60_000, notBefore: 62_000, windowEnd: 122_000 });
    expect(p).toMatchObject({
      season: 2026,
      session_type: 'GRAND_PRIX',
      ruleset_version: 'fia-2026-sb-iss09',
      template_version: 'f1-m08-v1',
      status: 'SCHEDULED',
      intake_status: 'ACCEPTING',
      settlement: null,
      settlement_history: [],
      version: 1,
    });
    expect(p.target.parameters).toMatchObject({ reference_time_ms: 84_321, reference_attempt_id: 'nor:lap:3', green_only: true, interruption_policy: 'VOID_IF_INTERRUPTED' });
    expect(p.settlement_deadline).toBe(s.iso(122_000 + 600_000));
    expect(s.pool('F1-M08', { driver_a: 'nor', reference_time_ms: 84_321 }, { closes: 60_000, notBefore: 62_000, windowEnd: 122_000 }).status).toBe('OPEN');
  });

  it('is deterministic for identical inputs', () => {
    const s = session();
    const a = s.shortPool('F1-M05', { driver_a: 'nor' }, 100_000);
    const b = s.shortPool('F1-M05', { driver_a: 'nor' }, 100_000);
    expect(a).toEqual(b);
  });

  it('session-final pools derive bounds from the manifest; M13 deadline = planned end + 24 h', () => {
    const s = session();
    const p = s.pool('F1-M13', { driver_a: 'ver' }, { closes: 0 });
    expect(p.target.not_before).toBe(s.manifest.planned_start_at);
    expect(p.settlement_deadline).toBe(new Date(Date.parse(s.manifest.planned_end_at) + 86_400_000).toISOString());
  });
});

describe('validatePoolTemplate', () => {
  const q = session({ type: 'QUALIFYING' });
  const codes = (marketId: MarketId, params: PoolParams, s = q, closes = 0, extra: Record<string, number> = {}) => {
    try {
      s.pool(marketId, params, { closes, ...extra });
      return [];
    } catch (e) {
      return (e as PoolValidationError).issues.map((i) => i.code);
    }
  };

  it('QA27: M15 for Q3/SQ3 is rejected; M17 is available for the final part', () => {
    expect(codes('F1-M15', { driver_a: 'nor', segment_id: 'Q3' })).toContain('M15_NO_NEXT_SEGMENT');
    const sq = session({ type: 'SPRINT_QUALIFYING' });
    expect(codes('F1-M15', { driver_a: 'nor', segment_id: 'SQ3' }, sq)).toContain('M15_NO_NEXT_SEGMENT');
    expect(codes('F1-M17', { segment_id: 'Q3', admitted: ALL_DRIVERS.slice(0, 10) })).toEqual([]);
    expect(codes('F1-M17', { segment_id: 'Q2', admitted: ALL_DRIVERS.slice(0, 10) })).toContain('SEGMENT_NOT_ALLOWED');
    expect(codes('F1-M17', { segment_id: 'Q3' })).toContain('ADMITTED_REQUIRED');
  });

  it('M16 must close before its segment starts; M15 cannot open on a decided part', () => {
    const q2Start = q.offset(q.manifest.segments![1]!.planned_start_at);
    expect(codes('F1-M16', { driver_a: 'nor', driver_b: 'lec', segment_id: 'Q2' }, q, q2Start + 1)).toContain('M16_MUST_CLOSE_BEFORE_SEGMENT');
    expect(codes('F1-M16', { driver_a: 'nor', driver_b: 'lec', segment_id: 'Q2' }, q, q2Start)).toEqual([]);
    const q1End = q.offset(q.manifest.segments![0]!.planned_end_at);
    expect(codes('F1-M15', { driver_a: 'nor', segment_id: 'Q1' }, q, q1End - 60_000)).toEqual([]);
    expect(codes('F1-M15', { driver_a: 'nor', segment_id: 'Q1' }, q, q1End)).toContain('SEGMENT_ALREADY_DECIDED');
    expect(codes('F1-M15', { driver_a: 'nor', segment_id: 'SQ1' })).toContain('SEGMENT_NOT_IN_SESSION');
  });

  it('M21 only accepts explicit F1-036 pairs with one subject', () => {
    const r = session();
    const at = { windowEnd: 120_000 };
    const ok = (combo: PoolParams['combo']) => codes('F1-M21', { combo, at_instant: r.iso(120_000) }, r, 60_000, at);
    expect(ok([{ kind: 'AHEAD_OF', driver_id: 'nor', value: 'lec' }, { kind: 'ON_TRACK', driver_id: 'nor', value: 'true' }])).toEqual([]);
    expect(ok([{ kind: 'SECTOR', driver_id: 'nor', value: '2' }, { kind: 'TYRE_COMPOUND', driver_id: 'nor', value: 'SOFT' }])).toEqual([]);
    expect(ok([{ kind: 'POSITION_GROUP', driver_id: 'nor', value: 'P1_3' }, { kind: 'SECTOR', driver_id: 'nor', value: '1' }])).toContain('COMBO_PAIR_NOT_ALLOWED');
    expect(ok([{ kind: 'POSITION_GROUP', driver_id: 'nor', value: 'P1_3' }, { kind: 'TYRE_COMPOUND', driver_id: 'lec', value: 'SOFT' }])).toContain('COMBO_SUBJECT_MISMATCH');
    expect(ok([{ kind: 'POSITION_GROUP', driver_id: 'nor', value: 'P5' }, { kind: 'TYRE_COMPOUND', driver_id: 'nor', value: 'C3' }])).toContain('COMBO_VALUE_INVALID');
    expect(codes('F1-M21', { at_instant: r.iso(120_000) }, r, 60_000, at)).toContain('COMBO_REQUIRED');
  });

  it('rejects pools without a finite settlement deadline and accepts an explicit cutoff', () => {
    const s = session();
    const manifest = { ...s.manifest, planned_end_at: '' };
    const timing = { created_at: s.iso(-60_000), opens_at: s.iso(-60_000), closes_at: s.iso(0), window_end: s.iso(7_200_000) };
    const res = validatePoolTemplate('F1-M13', { driver_a: 'nor' }, manifest, timing);
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain('NO_FINITE_DEADLINE');
    const p = createPool('F1-M13', { driver_a: 'nor' }, manifest, { ...timing, explicit_cutoff: s.iso(9_000_000) });
    expect(p.settlement_deadline).toBe(s.iso(9_000_000));
  });

  it('validates subjects, anchors, thresholds, session types, timing and capabilities', () => {
    const r = session();
    const sc = (id: MarketId, params: PoolParams, s = r) => codes(id, params, s, 59_000, { notBefore: 60_000, windowEnd: 120_000 });
    expect(sc('F1-M01', { driver_a: 'nor', target_lap: 10 })).toContain('LAP_ANCHOR_REQUIRED');
    expect(sc('F1-M02', { driver_a: 'nor', driver_b: 'nor', target_lap: 10, lap_anchor: 'DRIVER' })).toEqual(expect.arrayContaining(['DRIVERS_MUST_DIFFER', 'LEADER_ANCHOR_REQUIRED']));
    expect(sc('F1-M05', { driver_a: 'nor', t1_ms: 3000, t2_ms: 2500 })).toContain('THRESHOLDS_INVALID');
    expect(sc('F1-M19', { driver_a: 'nor', sector: 1 })).toContain('THRESHOLDS_REQUIRED');
    expect(sc('F1-M08', { driver_a: 'xyz' })).toEqual(expect.arrayContaining(['DRIVER_UNKNOWN', 'REFERENCE_REQUIRED']));
    expect(sc('F1-M13', { driver_a: 'nor' }, session({ type: 'SPRINT' }))).toContain('SESSION_TYPE_NOT_ALLOWED');
    expect(codes('F1-M03', {}, r, 61_000, { notBefore: 60_000, windowEnd: 120_000 })).toContain('CLOSES_AFTER_TARGET_START');
    expect(sc('F1-M07', { driver_a: 'nor', driver_b: 'lec' }, session({ unavailable: ['on_track_pass', 'aero_mode'] }))).toContain('CAPABILITY_UNAVAILABLE');
    expect(sc('F1-M05', { driver_a: 'nor' }, session({ degraded: ['stationary_stop'] }))).toContain('CAPABILITY_UNAVAILABLE');
    expect(sc('F1-M03', { window_profile_ms: 60_000 })).toEqual([]);
    expect(sc('F1-M03', { window_profile_ms: 45_000 })).toContain('WINDOW_PROFILE_NOT_ALLOWED');
    expect(sc('F1-M03', { window_profile_ms: 60_000 }, session({ degraded: ['pit_entry_exit'] }))).toEqual(expect.arrayContaining(['WINDOW_PROFILE_NOT_ALLOWED']));
    expect(sc('F1-M12', { tie_profile: { tie_precision_ms: 0, tie_origin_at: 'nope' } })).toContain('TIE_PROFILE_INVALID');
  });

  it('requiredCapabilitiesFor adds M21 part capabilities', () => {
    expect(requiredCapabilitiesFor(CATALOG['F1-M21'], { combo: [{ kind: 'SECTOR', driver_id: 'a', value: '1' }, { kind: 'TYRE_COMPOUND', driver_id: 'a', value: 'SOFT' }] })).toEqual(
      expect.arrayContaining(['occupancy', 'sectors', 'tyre_stints', 'race_control']),
    );
  });
});

describe('planPoolTiming', () => {
  it('produces valid timing with the lock buffer before the target', () => {
    const s = session();
    for (const id of MARKET_IDS) {
      const t = planPoolTiming(id, s.abs(600_000), s.manifest, { segmentId: undefined });
      if (CATALOG[id].target_kind !== 'SESSION') expect(Date.parse(t.not_before!)).toBeGreaterThan(Date.parse(t.closes_at));
    }
    const t = planPoolTiming('F1-M05', s.abs(600_000), s.manifest, { windowMs: 30_000 });
    const p = createPool('F1-M05', { driver_a: 'nor', window_profile_ms: 30_000 }, s.manifest, t);
    expect(Date.parse(p.target.window_end) - Date.parse(p.target.not_before)).toBe(30_000);
    const q = session({ type: 'QUALIFYING' });
    const t16 = planPoolTiming('F1-M16', q.abs(-600_000), q.manifest, { segmentId: 'Q1' });
    expect(() => createPool('F1-M16', { driver_a: 'nor', driver_b: 'lec', segment_id: 'Q1' }, q.manifest, t16)).not.toThrow();
  });
});

describe('i18n dictionary', () => {
  it('RU and EN have the same keys and include the SRS dictionary values', () => {
    expect(Object.keys(F1_I18N.ru).sort()).toEqual(Object.keys(F1_I18N.en).sort());
    expect(F1_I18N.ru['f1.location.pit']).toBe('Боксы / пит-лейн');
    expect(F1_I18N.en['f1.location.pit']).toBe('Garage / pit lane');
    expect(F1_I18N.ru['f1.position.question']).toBe('Какую позицию займёт {driver}?');
    expect(F1_I18N.en['f1.anchor.leader_lap']).toBe('When the leader completes lap {lap}');
    for (const k of ['f1.pit.stationary', 'f1.pit.lane', 'f1.pass.confirmed', 'f1.quali.provisional', 'f1.quali.confirmed', 'f1.data.approximate', 'f1.result.none', 'f1.result.unknown']) {
      expect(F1_I18N.ru[k]).toBeTruthy();
      expect(F1_I18N.en[k]).toBeTruthy();
    }
    expect(formatI18n('ru', 'f1.outcome.bucket.mid', { t1: 2500, t2: 3000 })).toBe('От 2500 до 3000 мс');
  });

  it('every key referenced by templates, outcomes, describePool and VOID reasons exists in both locales', () => {
    const s = session();
    const q = session({ type: 'QUALIFYING' });
    const keys = new Set<string>();
    const pools: Pool[] = [
      s.shortPool('F1-M01', { driver_a: 'nor', target_lap: 5, lap_anchor: 'DRIVER' }, 600_000),
      s.shortPool('F1-M02', { driver_a: 'nor', driver_b: 'lec', target_lap: 5, lap_anchor: 'LEADER' }, 600_000),
      s.shortPool('F1-M03', {}, 600_000),
      s.shortPool('F1-M04', { driver_a: 'nor' }, 600_000),
      s.shortPool('F1-M05', { driver_a: 'nor' }, 600_000),
      s.shortPool('F1-M06', { driver_a: 'nor' }, 600_000),
      s.shortPool('F1-M07', { driver_a: 'nor', driver_b: 'lec' }, 600_000),
      s.shortPool('F1-M08', { driver_a: 'nor', reference_time_ms: 80_000 }, 600_000),
      s.shortPool('F1-M09', {}, 600_000),
      s.shortPool('F1-M10', {}, 600_000),
      s.pool('F1-M11', { driver_a: 'nor', at_instant: s.iso(700_000) }, { closes: 600_000 }),
      s.shortPool('F1-M12', { simultaneous_source_group: true }, 600_000),
      s.pool('F1-M13', { driver_a: 'nor' }, { closes: 0 }),
      s.pool('F1-M14', { driver_a: 'nor' }, { closes: 0 }),
      q.pool('F1-M15', { driver_a: 'nor', segment_id: 'Q1' }, { closes: 0 }),
      q.pool('F1-M16', { driver_a: 'nor', driver_b: 'lec', segment_id: 'Q1' }, { closes: 0 }),
      q.pool('F1-M17', { segment_id: 'Q3', admitted: ALL_DRIVERS.slice(0, 10) }, { closes: 0 }),
      session({ type: 'SPRINT' }).pool('F1-M18', { driver_a: 'nor' }, { closes: 0 }),
      s.shortPool('F1-M19', { driver_a: 'nor', sector: 3, t1_ms: 20_000, t2_ms: 21_000 }, 600_000),
      s.shortPool('F1-M20', { driver_a: 'nor' }, 600_000),
      s.pool('F1-M21', { at_instant: s.iso(700_000), combo: [{ kind: 'AHEAD_OF', driver_id: 'nor', value: 'lec' }, { kind: 'ON_TRACK', driver_id: 'nor', value: 'true' }] }, { closes: 600_000 }),
    ];
    for (const p of pools) {
      for (const o of p.outcomes) keys.add(o.label_key);
      const c = describePool(p);
      [c.title_key, c.question.key, c.rule.key, c.determinant_key, c.window_key, c.interruption_key, c.sc_vsc_key, c.red_key, c.anchor?.key].forEach((k) => k && keys.add(k));
    }
    for (const r of ['INCOMPLETE_OBSERVATION', 'TARGET_NOT_STARTED', 'TARGET_CANCELLED', 'RESOLUTION_DEADLINE_EXCEEDED', 'TARGET_BOUNDARY_CONTAMINATED', 'AMBIGUOUS_EVENT_ORDER', 'INTERRUPTED', 'REFERENCE_INVALID', 'UNKNOWN_REQUIRED_PART', 'CONTRADICTORY_DATA']) {
      keys.add(`f1.void.${r.toLowerCase()}`);
    }
    for (const st of ['draft', 'scheduled', 'open', 'locked', 'resolving', 'settled', 'void']) keys.add(`f1.pool.status.${st}`);
    const missing = [...keys].filter((k) => !F1_I18N.ru[k] || !F1_I18N.en[k]);
    expect(missing).toEqual([]);
  });

  it('every validation code has a message', () => {
    const codesList = [
      'SESSION_TYPE_NOT_ALLOWED', 'CAPABILITY_UNAVAILABLE', 'DRIVER_REQUIRED', 'DRIVER_UNKNOWN', 'DRIVERS_MUST_DIFFER', 'TARGET_LAP_REQUIRED',
      'LAP_ANCHOR_REQUIRED', 'LEADER_ANCHOR_REQUIRED', 'THRESHOLDS_REQUIRED', 'THRESHOLDS_INVALID', 'REFERENCE_REQUIRED', 'SECTOR_REQUIRED',
      'SEGMENT_REQUIRED', 'SEGMENT_NOT_ALLOWED', 'SEGMENT_NOT_IN_SESSION', 'M15_NO_NEXT_SEGMENT', 'M16_MUST_CLOSE_BEFORE_SEGMENT',
      'SEGMENT_ALREADY_DECIDED', 'ADMITTED_REQUIRED', 'COMBO_REQUIRED', 'COMBO_PAIR_NOT_ALLOWED', 'COMBO_VALUE_INVALID', 'COMBO_SUBJECT_MISMATCH',
      'INSTANT_REQUIRED', 'TIMING_INVALID', 'CLOSES_AFTER_TARGET_START', 'WINDOW_INVALID', 'WINDOW_PROFILE_NOT_ALLOWED', 'NO_FINITE_DEADLINE', 'TIE_PROFILE_INVALID',
    ];
    for (const c of codesList) expect(F1_I18N.en[`f1.validation.${c.toLowerCase()}`]).toBeTruthy();
  });
});
