import { F1_I18N } from '@/domain/markets/i18n';
import { describePool, getTemplate } from '@/domain/markets/catalog';
import type { MarketId, Outcome, Pool } from '@/domain/types';
import { DRIVER_BY_ID } from '@/data/teams';
import { fmtClock, fmtLap, fmtNumber, fmtSec, registerDict, t } from '@/i18n/core';

registerDict('ru', F1_I18N.ru);
registerDict('en', F1_I18N.en);

const DRIVER_KEYS = new Set(['driver', 'driver_a', 'driver_b', 'passer', 'passed']);

export function driverShort(id: string): string {
  return DRIVER_BY_ID[id]?.lastName ?? id;
}

export function driverCode(id: string): string {
  return DRIVER_BY_ID[id]?.code ?? id.slice(0, 3).toUpperCase();
}

/** Map raw pool params (driver ids, ms, ISO) to display strings. Names are never translated (F1-052). */
export function formatParams(params: Record<string, string | number> | undefined, marketId?: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (DRIVER_KEYS.has(k) && typeof v === 'string') out[k] = driverShort(v);
    else if ((k === 't1' || k === 't2') && typeof v === 'number') out[k] = marketId === 'F1-M19' ? fmtSec(v) : fmtNumber(v);
    else if (k === 'reference' && typeof v === 'number') out[k] = fmtLap(v);
    else if ((k === 'at' || k === 'from' || k === 'to') && typeof v === 'string') out[k] = fmtClock(Date.parse(v), true);
    else if (k === 'value' && typeof v === 'string' && DRIVER_BY_ID[v]) out[k] = driverShort(v);
    else out[k] = v;
  }
  return out;
}

export interface PoolTexts {
  /** Short market name (kicker) — never repeats the question. */
  title: string;
  /** The one clear question with names / times filled in. */
  question: string;
  anchor: string | null;
  rule: string;
  determinant: string;
  window: string;
  interruption: string;
  scVsc: string;
  red: string;
}

const marketNo = (m: MarketId | string) => m.slice(3).toLowerCase();

/** Short market name, e.g. “Track zone”; falls back to the catalogue title. */
export function marketTitle(marketId: MarketId | string): string {
  const key = `pl.title.${marketNo(marketId)}`;
  const s = t(key);
  return s === key ? t(`f1.market.${marketNo(marketId)}.title`) : s;
}

export function poolTexts(pool: Pick<Pool, 'market_id' | 'subject' | 'target'>): PoolTexts {
  const c = describePool(pool);
  const m = pool.market_id;
  return {
    title: marketTitle(m),
    question: t(c.question.key, formatParams(c.question.params, m)),
    anchor: c.anchor ? t(c.anchor.key, formatParams(c.anchor.params, m)) : null,
    rule: t(c.rule.key, formatParams(c.rule.params, m)),
    determinant: t(c.determinant_key),
    window: t(c.window_key, formatParams({ from: pool.target.not_before, to: pool.target.window_end }, m)),
    interruption: t(c.interruption_key),
    scVsc: t(c.sc_vsc_key),
    red: t(c.red_key),
  };
}

export function outcomeLabel(o: Outcome, marketId?: string): string {
  if (o.driver_id && o.label_key === 'f1.outcome.driver') return driverShort(o.driver_id);
  return t(o.label_key, formatParams(o.label_params, marketId));
}

/** Seconds label for pit/sector thresholds: 2,5 с · 24,51 с. */
function secs(ms: number): string {
  return `${fmtSec(ms, ms >= 10_000 ? 2 : 1)} ${t('pl.unit.s')}`;
}

const SHORT_KEYS: Record<string, string> = {
  YES: 'f1.outcome.yes',
  NO: 'f1.outcome.no',
  NONE: 'pl.short.none',
  NO_PASS: 'pl.short.noPass',
  TIE: 'pl.short.tie',
  BOTH_TRUE: 'pl.short.both',
  NOT_BOTH: 'pl.short.notBoth',
  NO_ENTRY: 'pl.short.nobody',
  OTHER_CONFIRMED: 'pl.short.other',
  SIMULTANEOUS: 'pl.short.simultaneous',
  BOTH_INACTIVE: 'pl.short.bothOut',
  NO_VALID_LAP: 'pl.short.noLap',
  NO_VALID_SECTOR: 'pl.short.noSector',
  NEITHER_VALID: 'pl.short.neither',
  NO_EXIT: 'pl.short.noVisit',
  NO_VISIT: 'pl.short.noVisit',
  NO_SERVICE: 'pl.short.noService',
  FASTER: 'pl.short.faster',
  EQUAL: 'pl.short.equal',
  SLOWER: 'pl.short.slower',
  RED: 'pl.short.red',
};

const STATUS_SHORT: Record<string, string> = { RETIRED: 'RET', DNS: 'DNS', DSQ: 'DSQ', NOT_CLASSIFIED: 'NC', SC: 'SC', VSC: 'VSC', PIT: 'PIT' };
const GROUP_SHORT: Record<string, string> = { P1: 'P1', P2_3: 'P2–3', P4_10: 'P4–10', P11_PLUS: 'P11+', P4_8: 'P4–8', P9_PLUS: 'P9+', P1_3: 'P1–3', P1_10: 'P1–10' };

/** Compact, never-wrapping outcome label for chips and tiles (≤ ~10 chars). */
export function outcomeShort(o: Outcome, pool: Pick<Pool, 'market_id' | 'subject' | 'target'>): string {
  const id = o.id;
  const p = pool.target.parameters;
  if (id === 'A_PASSES_B' && pool.subject.driver_a && pool.subject.driver_b) return `${driverCode(pool.subject.driver_a)} › ${driverCode(pool.subject.driver_b)}`;
  if (id === 'B_PASSES_A' && pool.subject.driver_a && pool.subject.driver_b) return `${driverCode(pool.subject.driver_b)} › ${driverCode(pool.subject.driver_a)}`;
  if (o.driver_id) return driverCode(o.driver_id);
  if (/^S[123]$/.test(id)) return id;
  if (/^P\d+$/.test(id) && pool.market_id === 'F1-M01') return id;
  if (GROUP_SHORT[id]) return GROUP_SHORT[id];
  if (STATUS_SHORT[id]) return STATUS_SHORT[id];
  if (['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].includes(id)) return t(`tyre.${id.toLowerCase()}`);
  if (id.startsWith('BUCKET_')) {
    const t1 = p.t1_ms ?? Number(o.label_params?.t1 ?? 0);
    const t2 = p.t2_ms ?? Number(o.label_params?.t2 ?? 0);
    if (id === 'BUCKET_1') return `< ${secs(t1)}`;
    if (id === 'BUCKET_3') return `≥ ${secs(t2)}`;
    return `${fmtSec(t1, t1 >= 10_000 ? 2 : 1)}–${secs(t2)}`;
  }
  if (SHORT_KEYS[id]) return t(SHORT_KEYS[id]);
  return outcomeLabel(o, pool.market_id);
}

/** Human-readable legs of an M21 combo. */
export function comboParts(pool: Pick<Pool, 'target'>): Array<{ kind: string; driver: string; text: string }> {
  return (pool.target.parameters.combo ?? []).map((part) => {
    let value = part.value;
    if (part.kind === 'POSITION_GROUP') value = t(`f1.combo.group.${part.value.toLowerCase()}`);
    else if (part.kind === 'TYRE_COMPOUND') value = t(`tyre.${part.value.toLowerCase()}`);
    else if (part.kind === 'AHEAD_OF') value = driverShort(part.value);
    return { kind: part.kind, driver: part.driver_id, text: t(`f1.combo.part.${part.kind.toLowerCase()}`, { driver: driverShort(part.driver_id), value }) };
  });
}

export function questionParts(pool: Pool): { key: string; params: Record<string, string | number> } {
  const c = describePool(pool);
  return { key: c.question.key, params: c.question.params };
}

export function familyOf(pool: Pick<Pool, 'market_id'>): string {
  return getTemplate(pool.market_id).family;
}

/** Visual layout family of the pool screen for each of the 21 markets. */
export type PoolLayout = 'zone' | 'duel' | 'pit' | 'tyre' | 'pace' | 'incident' | 'position' | 'quali' | 'combo';

export const POOL_LAYOUT: Record<MarketId, PoolLayout> = {
  'F1-M01': 'position',
  'F1-M02': 'duel',
  'F1-M03': 'pit',
  'F1-M04': 'tyre',
  'F1-M05': 'pit',
  'F1-M06': 'pit',
  'F1-M07': 'duel',
  'F1-M08': 'pace',
  'F1-M09': 'pace',
  'F1-M10': 'incident',
  'F1-M11': 'zone',
  'F1-M12': 'incident',
  'F1-M13': 'position',
  'F1-M14': 'position',
  'F1-M15': 'quali',
  'F1-M16': 'duel',
  'F1-M17': 'quali',
  'F1-M18': 'position',
  'F1-M19': 'pace',
  'F1-M20': 'tyre',
  'F1-M21': 'combo',
};

export function layoutOf(pool: Pick<Pool, 'market_id'>): PoolLayout {
  return POOL_LAYOUT[pool.market_id] ?? 'position';
}

/** Short visual hint for an outcome card (2nd line). */
export function outcomeHint(o: Outcome, pool: Pool): string | null {
  if (o.driver_id) {
    const d = DRIVER_BY_ID[o.driver_id];
    return d ? d.code : null;
  }
  if (pool.market_id === 'F1-M11' && o.id === 'PIT') return t('f1.location.pit');
  return null;
}
