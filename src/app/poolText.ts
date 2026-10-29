import { F1_I18N } from '@/domain/markets/i18n';
import { describePool, getTemplate } from '@/domain/markets/catalog';
import type { Outcome, Pool } from '@/domain/types';
import { DRIVER_BY_ID } from '@/data/teams';
import { fmtClock, fmtLap, fmtNumber, fmtSec, registerDict, t } from '@/i18n/core';

registerDict('ru', F1_I18N.ru);
registerDict('en', F1_I18N.en);

const DRIVER_KEYS = new Set(['driver', 'driver_a', 'driver_b', 'passer', 'passed']);

export function driverShort(id: string): string {
  return DRIVER_BY_ID[id]?.lastName ?? id;
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
  title: string;
  question: string;
  anchor: string | null;
  rule: string;
  determinant: string;
  window: string;
  interruption: string;
  scVsc: string;
  red: string;
}

export function poolTexts(pool: Pick<Pool, 'market_id' | 'subject' | 'target'>): PoolTexts {
  const c = describePool(pool);
  const m = pool.market_id;
  return {
    title: t(c.title_key),
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

export function questionParts(pool: Pool): { key: string; params: Record<string, string | number> } {
  const c = describePool(pool);
  return { key: c.question.key, params: c.question.params };
}

export function familyOf(pool: Pick<Pool, 'market_id'>): string {
  return getTemplate(pool.market_id).family;
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
