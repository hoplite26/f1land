import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useSettings, prefersReducedMotion } from '@/store/settings';
import { useNav } from '@/store/nav';
import { getCachedCircuit, getCircuitMeta, loadCircuit, type CircuitData, type CircuitMeta } from '@/data/circuits';
import type { Meeting, MeetingStatus } from '@/data/calendar';
import { fmtDate, getLang, t } from '@/i18n/core';
import { Sheet } from '@/ui/kit';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { IconBolt, IconChevron, IconFire, IconFlag, IconGlobe, IconHelmet, IconPit, IconStar, IconSwap, IconTarget, IconTrophy, IconTyre, IconWarning } from '@/ui/icons';
import type { AchIcon, Tone } from '@/demo/progress';
import type { Entry } from '@/store/wallet';
import '@/styles/screens.css';

export function useReduced(): boolean {
  const m = useSettings((s) => s.motion);
  return prefersReducedMotion(m);
}

/** Staggered fade-up on mount; a plain div when motion is reduced. */
export function Reveal({ children, i = 0, className, style }: { children: ReactNode; i?: number; className?: string; style?: CSSProperties }) {
  const reduced = useReduced();
  if (reduced) return <div className={className} style={style}>{children}</div>;
  return (
    <motion.div className={className} style={style} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, delay: Math.min(i, 12) * 0.045, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

/** Kit Sheet rendered into `.app` so it is not clipped by the scrolled screen. */
export function PortalSheet(props: Parameters<typeof Sheet>[0]) {
  const host = typeof document !== 'undefined' ? document.querySelector('.app') : null;
  return host ? createPortal(<Sheet {...props} />, host) : <Sheet {...props} />;
}

export function useBack(): () => void {
  return () => {
    const s = useNav.getState();
    if (s.stack.length) s.back();
    else s.go('home');
  };
}

export function PageHead({ kicker, title, sub, right }: { kicker?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="sc-head">
      <div className="sc-head__txt">
        {kicker && <div className="sc-kicker">{kicker}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Circuits                                                            */
/* ------------------------------------------------------------------ */

export function useCircuit(id: string | undefined): CircuitData | null {
  const [data, setData] = useState<CircuitData | null>(() => (id ? (getCachedCircuit(id) ?? null) : null));
  useEffect(() => {
    if (!id) return;
    const hit = getCachedCircuit(id);
    if (hit) {
      setData(hit);
      return;
    }
    let alive = true;
    loadCircuit(id).then(
      (c) => alive && setData(c),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [id]);
  return data && data.id === id ? data : null;
}

export function safeMeta(id: string): CircuitMeta | null {
  try {
    return getCircuitMeta(id);
  } catch {
    return null;
  }
}

function firstPoint(path: string): [number, number] | null {
  const m = /^M\s*(-?[\d.]+)[ ,](-?[\d.]+)/.exec(path);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Lightweight outline from CircuitMeta.svgPath (viewBox 0..100). */
export function CircuitThumb({ id, size = 56, draw, className = '', cars }: { id: string; size?: number; draw?: boolean; className?: string; cars?: string[] }) {
  const meta = safeMeta(id);
  const reduced = useReduced();
  if (!meta) return <span style={{ width: size, height: size }} />;
  const start = firstPoint(meta.svgPath);
  return (
    <svg className={`sc-thumb ${draw && !reduced ? 'sc-thumb--draw' : ''} ${className}`} viewBox="-4 -4 108 108" width={size} height={size} aria-hidden="true">
      <path d={meta.svgPath} className="sc-thumb__base" />
      <path d={meta.svgPath} className="sc-thumb__line" pathLength={1} />
      {start && <circle cx={start[0]} cy={start[1]} r={3.2} className="sc-thumb__start" />}
      {!reduced &&
        cars?.map((color, i) => (
          <circle key={i} r={2.6} fill={color} className="sc-thumb__car">
            <animateMotion dur={`${7 + i * 0.35}s`} begin={`${-i * 0.55}s`} repeatCount="indefinite" path={meta.svgPath} />
          </circle>
        ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar helpers                                                    */
/* ------------------------------------------------------------------ */

export function meetingName(m: Meeting): string {
  return m.name[getLang()];
}

export function meetingDates(m: Meeting): string {
  const a = Date.parse(m.sessions[0]!.startsAt);
  const b = Date.parse(m.sessions[m.sessions.length - 1]!.startsAt);
  const da = new Date(a);
  const db = new Date(b);
  if (da.getMonth() === db.getMonth()) return `${da.getDate()}–${fmtDate(b, { day: 'numeric', month: 'short' })}`;
  return `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(b, { day: 'numeric', month: 'short' })}`;
}

const STATUS_KEY: Record<MeetingStatus, string> = { COMPLETED: 'races.completed', LIVE: 'races.live', NEXT: 'races.next', UPCOMING: 'races.upcoming' };

export function StatusPill({ status }: { status: MeetingStatus }) {
  return (
    <span className={`sc-pill sc-pill--${status.toLowerCase()}`}>
      {status === 'LIVE' && <span className="dot-live" />}
      {t(STATUS_KEY[status])}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Small UI                                                            */
/* ------------------------------------------------------------------ */

export function Bar({ value, max = 1, tone = 'lime', label }: { value: number; max?: number; tone?: Tone | 'cyan'; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1e-9, max)) * 100));
  return (
    <div className="sc-bar" data-tone={tone} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="sc-toggle"
      data-on={on}
      onClick={() => {
        haptic.tap();
        sfx.tap();
        onChange(!on);
      }}
    >
      <span className="sc-toggle__knob" />
    </button>
  );
}

export function MenuRow({ icon, title, sub, value, badge, tone = 'lime', onClick }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; value?: ReactNode; badge?: ReactNode; tone?: Tone; onClick: () => void }) {
  return (
    <button
      className="sc-menu"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
    >
      <span className={`sc-ic sc-ic--${tone}`}>{icon}</span>
      <span className="sc-menu__txt">
        <span className="sc-menu__t">{title}</span>
        {sub && <span className="sc-menu__s">{sub}</span>}
      </span>
      {badge}
      {value !== undefined && <span className="sc-menu__v num">{value}</span>}
      <IconChevron size={16} className="icon sc-menu__chev" />
    </button>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="sc-empty">
      <div className="sc-empty__ic">{icon}</div>
      <div className="sc-empty__t">{title}</div>
      {body && <div className="sc-empty__b">{body}</div>}
      {action}
    </div>
  );
}

export function AchGlyph({ icon, size = 22 }: { icon: AchIcon; size?: number }) {
  const p = { size };
  switch (icon) {
    case 'flag':
      return <IconFlag {...p} />;
    case 'trophy':
      return <IconTrophy {...p} />;
    case 'fire':
      return <IconFire {...p} />;
    case 'swap':
      return <IconSwap {...p} />;
    case 'pit':
      return <IconPit {...p} />;
    case 'tyre':
      return <IconTyre {...p} />;
    case 'target':
      return <IconTarget {...p} />;
    case 'warning':
      return <IconWarning {...p} />;
    case 'globe':
      return <IconGlobe {...p} />;
    case 'bolt':
      return <IconBolt {...p} />;
    case 'star':
      return <IconStar {...p} />;
    case 'helmet':
      return <IconHelmet {...p} />;
  }
}

/* ------------------------------------------------------------------ */
/* Dates & entries                                                     */
/* ------------------------------------------------------------------ */

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayLabel(ms: number, nowMs = Date.now()): string {
  const d = new Date(ms);
  if (sameDay(d, new Date(nowMs))) return t('ui.today');
  if (sameDay(d, new Date(nowMs - 86_400_000))) return t('scr.yesterday');
  if (sameDay(d, new Date(nowMs + 86_400_000))) return t('ui.tomorrow');
  return fmtDate(ms, { weekday: 'short', day: 'numeric', month: 'long' });
}

export function groupByDay<T>(items: T[], at: (x: T) => number): Array<{ key: string; label: string; items: T[] }> {
  const out: Array<{ key: string; label: string; items: T[] }> = [];
  for (const it of items) {
    const d = new Date(at(it));
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(at(it)), items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

export function EntryBadge({ e }: { e: Entry }) {
  const cls = e.state === 'WON' ? 'badge--lime' : e.state === 'LOST' ? 'badge--red' : e.state === 'VOID' ? 'badge--yellow' : e.settlement?.provisional ? 'badge--cyan' : 'badge--ghost';
  const key = e.state === 'WON' ? 'entries.won' : e.state === 'LOST' ? 'entries.lost' : e.state === 'VOID' ? 'entries.void' : e.settlement?.provisional ? 'entries.provisional' : 'entries.pending';
  return <span className={`badge ${cls}`}>{t(key)}</span>;
}

export function signed(n: number, fmt: (n: number) => string): string {
  if (n > 0) return `+${fmt(n)}`;
  if (n < 0) return `−${fmt(-n)}`;
  return fmt(0);
}
