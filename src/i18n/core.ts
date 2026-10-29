export type Lang = 'ru' | 'en';

type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { ru: {}, en: {} };
let current: Lang = 'ru';
const listeners = new Set<() => void>();

export function registerDict(lang: Lang, d: Dict): void {
  Object.assign(dicts[lang], d);
}

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

export function getLang(): Lang {
  return current;
}

export function onLangChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function t(key: string, params?: Record<string, string | number>, lang: Lang = current): string {
  let s = dicts[lang][key] ?? dicts.en[key] ?? key;
  if (params) {
    for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
  }
  return s;
}

export function has(key: string): boolean {
  return key in dicts[current] || key in dicts.en;
}

/** Plural helper for RU/EN: forms = [one, few, many] (EN uses one/many). */
export function plural(n: number, forms: { ru: [string, string, string]; en: [string, string] }, lang: Lang = current): string {
  if (lang === 'en') return n === 1 ? forms.en[0] : forms.en[1];
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms.ru[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms.ru[1];
  return forms.ru[2];
}

/* ---------- Formatting (F1-052: separators follow the UI language) ---------- */

const locale = () => (current === 'ru' ? 'ru-RU' : 'en-GB');
const dec = () => (current === 'ru' ? ',' : '.');

export function fmtNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Lap time 1:24.532 / 1:24,532 from integer ms (no rounding of the stored value). */
export function fmtLap(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}${dec()}${String(r).padStart(3, '0')}`;
}

/** Seconds with 3 decimals: 27.854 */
export function fmtSec(ms: number | null | undefined, digits = 3): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return (ms / 1000).toFixed(digits).replace('.', dec());
}

export function fmtGap(ms: number | null | undefined, digits = 3): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const sign = ms >= 0 ? '+' : '−';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(digits).replace('.', dec())}`;
}

export function fmtOdds(x: number): string {
  return x.toFixed(2).replace('.', dec());
}

export function fmtClock(ms: number, withSeconds = false, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hour12: false, timeZone }).format(ms);
}

export function fmtDate(ms: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale(), { ...opts, timeZone }).format(ms);
}

export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtDuration(ms: number): string {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (current === 'ru') return d > 0 ? `${d}д ${h}ч ${m}м` : h > 0 ? `${h}ч ${m}м` : `${m}м`;
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function flagEmoji(cc: string): string {
  if (!/^[A-Z]{2}$/.test(cc)) return '🏁';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
