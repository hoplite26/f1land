import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import { fmtCountdown, t } from '@/i18n/core';
import { haptic, pushOverlayBack } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { IconCheck, IconChevron, IconClose, IconInfo } from './icons';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export function Card({ children, className = '', glow, cyan, pad = true, onClick, ariaLabel }: { children: ReactNode; className?: string; glow?: boolean; cyan?: boolean; pad?: boolean; onClick?: () => void; ariaLabel?: string }) {
  const cls = `card ${glow ? 'card--glow' : ''} ${cyan ? 'card--cyan' : ''} ${pad ? 'card--pad' : ''} ${onClick ? 'card--press' : ''} ${className}`;
  if (onClick)
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        className={cls}
        onClick={() => {
          haptic.tap();
          onClick();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {children}
      </div>
    );
  return <div className={cls}>{children}</div>;
}

export function Section({ title, kicker, action, children }: { title?: ReactNode; kicker?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      {(title || action || kicker) && (
        <div className="section__head">
          <div>
            {kicker && <div className="section__kicker">{kicker}</div>}
            {title && <h2 className="section__title">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ id: T; label: ReactNode; count?: number }>; onChange: (v: T) => void; label: string }) {
  const layoutId = useId();
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          className="segmented__btn"
          onClick={() => {
            if (o.id !== value) {
              haptic.tap();
              sfx.tap();
            }
            onChange(o.id);
          }}
        >
          {o.id === value && <motion.span layoutId={`seg-${layoutId}`} className="segmented__ind" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
          {o.label}
          {o.count !== undefined && <span className="segmented__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Chip({ on, children, onClick, ariaLabel }: { on?: boolean; children: ReactNode; onClick?: () => void; ariaLabel?: string }) {
  return (
    <button
      className="chip"
      aria-pressed={on}
      aria-label={ariaLabel}
      onClick={() => {
        haptic.tap();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function Collapsible({ title, icon, defaultOpen = false, children, right }: { title: ReactNode; icon?: ReactNode; defaultOpen?: boolean; children: ReactNode; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card collapse" data-open={open}>
      <button
        className="collapse__head"
        aria-expanded={open}
        onClick={() => {
          haptic.tap();
          setOpen(!open);
        }}
      >
        {icon}
        <span>{title}</span>
        {right}
        <span className="collapse__chev">
          <IconChevron dir="down" size={18} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} style={{ overflow: 'hidden' }}>
            <div className="collapse__body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Mini-help: explains a term without leaving the page (F1-053). */
export function Help({ text, label }: { text: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);
  return (
    <div className="help" ref={ref}>
      <button className="help__btn" aria-label={label ?? t('ui.help')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconInfo size={14} />
      </button>
      {open && (
        <div className="help__pop" role="tooltip">
          {text}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Countdown({ ms, label, locked, lockedLabel }: { ms: number; label: string; locked?: boolean; lockedLabel?: string }) {
  const urgent = ms < 10_000 && !locked;
  return (
    <div className={`countdown ${urgent ? 'countdown--urgent' : ''} ${locked ? 'countdown--locked' : ''}`} role="timer" aria-live="off">
      <span className="countdown__k">{locked ? (lockedLabel ?? t('pool.locked')) : label}</span>
      <span className="countdown__v num">{locked ? '00:00' : fmtCountdown(ms)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drivers                                                             */
/* ------------------------------------------------------------------ */

/** Stylised helmet avatar in team colours (no photos). */
export function DriverAvatar({ id, size = 40, ring }: { id: string; size?: number; ring?: boolean }) {
  const d = DRIVER_BY_ID[id];
  const team = d ? TEAM_BY_ID[d.teamId] : undefined;
  const c1 = team?.livery.primary ?? '#888';
  const c2 = team?.livery.accent ?? '#fff';
  const c3 = team?.livery.secondary ?? '#222';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={d ? `${d.firstName} ${d.lastName}` : id} style={{ flex: 'none', filter: ring ? `drop-shadow(0 0 6px ${team?.color})` : undefined }}>
      <defs>
        <linearGradient id={`hg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={shade(c1, -0.35)} />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="23" fill="#0c1115" stroke={ring ? team?.color : 'rgba(255,255,255,0.1)'} strokeWidth={ring ? 2 : 1} />
      <path d="M8 29c0-10 7-17 17-17 8 0 15 6 15 14v5c0 2-1.5 3.5-3.5 3.5H15C11 34.5 8 32.5 8 29z" fill={`url(#hg-${id})`} />
      <path d="M21 21h19v6H22z" fill="#0a0d10" />
      <path d="M22 22h17v2.5H22z" fill={c2} opacity="0.85" />
      <path d="M9.5 27c4-1 8.5-1 12-0.5" stroke={c3} strokeWidth="2.2" fill="none" />
      <path d="M12 17c3-3 7-4.5 11-4.5" stroke={c2} strokeWidth="2" fill="none" opacity="0.9" />
      <text x="24" y="44.5" textAnchor="middle" fontSize="7" fontFamily="Chakra Petch, sans-serif" fontWeight="700" fill="#fff">
        {d?.number ?? ''}
      </text>
    </svg>
  );
}

export function TeamBar({ id }: { id: string }) {
  const d = DRIVER_BY_ID[id];
  const team = d ? TEAM_BY_ID[d.teamId] : undefined;
  return <span className="team-bar" style={{ background: team?.color ?? '#888' }} />;
}

export function TyreBadge({ compound, size = 22 }: { compound: string | null; size?: number }) {
  if (!compound) {
    return (
      <span className="tyre" style={{ width: size, height: size, color: 'var(--muted)' }} title={t('tyre.unknown')} aria-label={t('tyre.unknown')}>
        <span>—</span>
      </span>
    );
  }
  const letter = compound[0]!;
  return (
    <span className={`tyre tyre--${letter}`} style={{ width: size, height: size, fontSize: size * 0.46 }} aria-label={t(`tyre.${compound.toLowerCase()}`)}>
      <span>{letter}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stake & confirm                                                     */
/* ------------------------------------------------------------------ */

export function StakeInput({ value, onChange, presets = [50, 100, 250, 500], max, step = 10 }: { value: number; onChange: (v: number) => void; presets?: number[]; max: number; step?: number }) {
  const clamp = (v: number) => Math.max(step, Math.min(max, Math.round(v / step) * step));
  return (
    <div>
      <div className="stake">
        <button
          className="icon-btn"
          aria-label={t('stake.decrease')}
          onClick={() => {
            haptic.tap();
            onChange(clamp(value - step * (value > 200 ? 5 : 1)));
          }}
        >
          −
        </button>
        <div className="stake__value" aria-live="polite">
          <span>{value}</span>
          <span style={{ fontSize: 11, color: 'var(--lime)', letterSpacing: '.1em' }}>PULSE</span>
        </div>
        <button
          className="icon-btn"
          aria-label={t('stake.increase')}
          onClick={() => {
            haptic.tap();
            onChange(clamp(value + step * (value >= 200 ? 5 : 1)));
          }}
        >
          +
        </button>
      </div>
      <div className="stake__presets">
        {presets.map((p) => (
          <Chip key={p} on={value === p} onClick={() => onChange(clamp(p))}>
            {p}
          </Chip>
        ))}
        <Chip on={value === max} onClick={() => onChange(clamp(max))}>
          MAX
        </Chip>
      </div>
    </div>
  );
}

/** Swipe-to-confirm control with keyboard/click fallback for accessibility. */
export function SwipeConfirm({ label, sub, disabled, onConfirm }: { label: string; sub?: string; disabled?: boolean; onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const drag = useRef<{ start: number; max: number; moved: boolean } | null>(null);
  const done = useRef(false);
  const [hint, setHint] = useState(false);

  useLayoutEffect(() => {
    if (disabled) setX(0);
  }, [disabled]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    haptic.impact('heavy');
    onConfirm();
    setTimeout(() => {
      done.current = false;
      setX(0);
    }, 600);
  };

  return (
    <div
      ref={ref}
      className={`swipe ${disabled ? 'swipe--disabled' : ''} ${hint ? 'swipe--hint' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`${label}${sub ? `. ${sub}` : ''}`}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          finish();
        }
      }}
      onPointerDown={(e) => {
        if (disabled || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        drag.current = { start: e.clientX - x, max: rect.width - 62, moved: false };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        haptic.impact('light');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const nx = Math.max(0, Math.min(d.max, e.clientX - d.start));
        if (Math.abs(nx - x) > 2) d.moved = true;
        if (Math.floor(nx / 40) !== Math.floor(x / 40)) haptic.tap();
        setX(nx);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (x > d.max * 0.85) {
          setX(d.max);
          finish();
        } else {
          setX(0);
          // A plain tap nudges the knob to teach the swipe gesture.
          if (!d.moved && x < 8) {
            setHint(false);
            requestAnimationFrame(() => setHint(true));
          }
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        setX(0);
      }}
    >
      <div className="swipe__speed" />
      <div className="swipe__label" style={{ opacity: 1 - Math.min(0.7, x / 260) }}>
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </div>
      <div ref={knob} className="swipe__knob" onAnimationEnd={() => setHint(false)} style={{ transform: `translateX(${x}px)`, transition: drag.current ? 'none' : 'transform .35s cubic-bezier(.22,1,.36,1)' }}>
        <IconChevron size={26} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet                                                               */
/* ------------------------------------------------------------------ */

export function Sheet({ open, onClose, children, title, label }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; label: string }) {
  const drag = useDragControls();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const close = () => closeRef.current();
    const release = pushOverlayBack(close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    const id = requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(id);
      release();
      window.removeEventListener('keydown', onKey);
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            ref={ref}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            // Dragging starts only from the header so the body can scroll freely.
            drag="y"
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            <div className="sheet__head" onPointerDown={(e) => drag.start(e)}>
              <div className="sheet__grab" />
              <div className="row" style={{ padding: '0 8px 0 16px' }}>
                {title && <div className="sheet__title" style={{ flex: 1 }}>{title}</div>}
                <button className="icon-btn sheet__close" aria-label={t('ui.close')} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
                  <IconClose size={16} />
                </button>
              </div>
            </div>
            <div className="sheet__body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function CheckDot() {
  return (
    <span className="outcome__check">
      <IconCheck size={11} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Charts (SVG, lightweight)                                           */
/* ------------------------------------------------------------------ */

export function Sparkline({ values, color = 'var(--cyan)', height = 36, width = 120, fill = true }: { values: number[]; color?: string; height?: number; width?: number; fill?: boolean }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  const gid = `sg${Math.round(values[0]! * 1000) % 99999}${values.length}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ overflow: 'visible' }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.35" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d}L${width} ${height}L0 ${height}Z`} fill={`url(#${gid})`} />
        </>
      )}
      <path d={d} stroke={color} strokeWidth="1.8" fill="none" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}

export interface Series {
  id: string;
  color: string;
  values: Array<number | null>;
  label?: string;
}

/** Multi-series line chart with optional y inversion (positions). */
export function LineChart({ series, height = 150, invert = false, yLabel, xLabel, yFormat = (v: number) => String(v) }: { series: Series[]; height?: number; invert?: boolean; yLabel?: string; xLabel?: string; yFormat?: (v: number) => string }) {
  const width = 320;
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (!all.length) return <div className="empty">{t('chart.nodata')}</div>;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => {
    const f = (v - min) / span;
    return pad.t + (invert ? f : 1 - f) * (height - pad.t - pad.b);
  };
  const ticks = [0, 0.5, 1].map((f) => min + f * span);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={yLabel}>
      {ticks.map((tv, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={y(tv)} y2={y(tv)} stroke="rgba(255,255,255,0.07)" />
          <text x={pad.l - 5} y={y(tv) + 3} fontSize="8.5" textAnchor="end" fill="var(--muted)" fontFamily="Chakra Petch">
            {yFormat(tv)}
          </text>
        </g>
      ))}
      {series.map((s) => {
        let d = '';
        s.values.forEach((v, i) => {
          if (v === null) return;
          d += `${d && s.values[i - 1] !== null ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
        });
        return <path key={s.id} d={d} stroke={s.color} strokeWidth="1.8" fill="none" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 3px ${s.color})` }} />;
      })}
      {xLabel && (
        <text x={width - pad.r} y={height - 3} fontSize="8.5" textAnchor="end" fill="var(--muted)">
          {xLabel}
        </text>
      )}
    </svg>
  );
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) * (1 + amt)));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) * (1 + amt)));
  const b = Math.max(0, Math.min(255, (n & 255) * (1 + amt)));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
