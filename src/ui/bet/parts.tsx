/* Prediction UI building blocks (workstream D): countdown ring, multiplier, outcome tiles, stake, bet dock, confetti. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { fmtCountdown, fmtNumber, fmtOdds, t } from '@/i18n/core';
import { useSettings, prefersReducedMotion } from '@/store/settings';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { SwipeConfirm } from '@/ui/kit';
import { IcCoins, IcMinus, IcPlus, IcTicket, IcTrophy, IcYes } from './icons';
import '@/styles/pool.css';

/* ------------------------------------------------------------------ */
/* Countdown ring                                                      */
/* ------------------------------------------------------------------ */

export function CountdownRing({ ms, totalMs, size = 44, locked, label }: { ms: number; totalMs: number; size?: number; locked?: boolean; label?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const frac = locked ? 0 : Math.max(0, Math.min(1, totalMs > 0 ? ms / totalMs : 0));
  // Urgency is amber, not red: red is reserved for errors and losses.
  const color = locked ? 'var(--muted)' : ms < 10_000 ? 'var(--orange)' : frac < 0.3 ? 'var(--yellow)' : 'var(--lime)';
  const secs = Math.ceil(ms / 1000);
  return (
    <span className={`cd-ring ${!locked && ms < 10_000 ? 'cd-ring--urgent' : ''}`} style={{ width: size, height: size }} role="timer" aria-label={label ?? fmtCountdown(ms)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="rgba(8,12,14,.6)" stroke="rgba(255,255,255,.08)" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .25s linear, stroke .3s' }}
        />
      </svg>
      <span className="cd-ring__v num" style={{ color, fontSize: size < 40 ? 10 : 12 }}>
        {locked ? '—' : secs >= 600 ? fmtCountdown(ms).replace(/:\d\d$/, '′') : secs >= 100 ? fmtCountdown(ms) : secs}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Multiplier                                                          */
/* ------------------------------------------------------------------ */

/** Mirrors the payout cap in demo/poolEngine `multiplier()`. */
export const MULT_CAP = 50;

/** Multiplier text; a capped estimate reads “50x макс.” instead of a bare, broken-looking 50,00x. */
export function OddsValue({ value, className = '' }: { value: number | null; className?: string }) {
  if (value === null) return <span className={`odds num ${className}`}>—</span>;
  if (value >= MULT_CAP) {
    return (
      <span className={`odds odds--cap num ${className}`}>
        {MULT_CAP}x<small>{t('pd.cap')}</small>
      </span>
    );
  }
  return <span className={`odds num ${className}`}>{fmtOdds(value)}x</span>;
}

export function oddsText(value: number): string {
  return value >= MULT_CAP ? `${MULT_CAP}x ${t('pd.cap')}` : `${fmtOdds(value)}x`;
}

/* ------------------------------------------------------------------ */
/* Outcome tile                                                        */
/* ------------------------------------------------------------------ */

export type TileVariant = 'tile' | 'driver' | 'row' | 'num' | 'zone' | 'wide';

export interface OutcomeTileProps {
  variant?: TileVariant;
  label: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  odds: number | null;
  checked: boolean;
  disabled?: boolean;
  /** Settled state: winner/loser, and whether it was the user's pick. */
  result?: 'win' | 'lose' | null;
  mine?: boolean;
  color?: string;
  ariaLabel?: string;
  /** Tile sits in a 3+ column grid: shrink long single words instead of breaking them. */
  compact?: boolean;
  onSelect: () => void;
}

/** Longest word decides the label size, so long single words shrink instead of breaking mid-word. */
function fitClass(label: ReactNode): string {
  if (typeof label !== 'string') return '';
  const longest = Math.max(...label.split(/[\s–—/-]+/).map((w) => w.length));
  return longest >= 11 ? 'ot--xlong' : longest >= 8 ? 'ot--long' : '';
}

export function OutcomeTile({ variant = 'tile', label, sub, icon, odds, checked, disabled, result, mine, color, ariaLabel, compact, onSelect }: OutcomeTileProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled}
      aria-label={ariaLabel}
      className={`ot ot--${variant} ${compact ? fitClass(label) : ''} ${checked ? 'ot--on' : ''} ${disabled ? 'ot--off' : ''} ${result ? `ot--${result}` : ''} ${mine ? 'ot--mine' : ''}`}
      style={color ? ({ ['--ot-c' as string]: color } as CSSProperties) : undefined}
      onClick={() => {
        if (disabled) {
          haptic.notify('warning');
          return;
        }
        haptic.impact('light');
        sfx.select();
        onSelect();
      }}
    >
      {checked && !result && (
        <span className="ot__check" aria-hidden="true">
          <IcYes size={11} />
        </span>
      )}
      {result === 'win' && (
        <span className="ot__trophy" aria-hidden="true">
          <IcTrophy size={13} />
        </span>
      )}
      {icon && <span className="ot__icon">{icon}</span>}
      <span className="ot__text">
        <span className="ot__label">{label}</span>
        {sub && <span className="ot__sub">{sub}</span>}
      </span>
      <OddsValue value={odds} className="ot__odds" />
      {mine && <span className="ot__mine">{t('pl.yourPick')}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Stake                                                               */
/* ------------------------------------------------------------------ */

export const MIN_STAKE = 10;
const MAX_STAKE = 5000;
const CHIPS = [10, 50, 100, 250, 500];

const stakeCap = (balance: number) => Math.max(MIN_STAKE, Math.min(MAX_STAKE, Math.floor(balance)));
const stakeStep = (v: number) => (v >= 500 ? 50 : v >= 100 ? 25 : 5);

export function StakePanel({ value, onChange, balance, disabled, onDone }: { value: number; onChange: (v: number) => void; balance: number; disabled?: boolean; onDone?: () => void }) {
  const cap = stakeCap(balance);
  const clamp = (v: number) => Math.max(MIN_STAKE, Math.min(cap, Math.round(v)));
  const [draft, setDraft] = useState<string | null>(null);
  const step = stakeStep(value);
  const set = (v: number) => {
    const n = clamp(v);
    if (n !== value) haptic.tap();
    onChange(n);
  };
  return (
    <div className={`stk ${disabled ? 'stk--off' : ''}`}>
      <div className="stk__head">
        <span className="stk__k">{t('pool.stake')}</span>
        <span className="stk__bal num">
          <IcCoins size={13} /> {t('pl.balance')} <b>{fmtNumber(Math.floor(balance))}</b>
        </span>
        {onDone && (
          <button
            type="button"
            className="stk__done"
            onClick={() => {
              haptic.tap();
              onDone();
            }}
          >
            {t('pd.done')}
          </button>
        )}
      </div>
      <div className="stk__row">
        <button type="button" className="stk__btn" aria-label={t('stake.decrease')} disabled={disabled || value <= MIN_STAKE} onClick={() => set(value - step)}>
          <IcMinus size={18} />
        </button>
        <label className="stk__val">
          <input
            className="num"
            inputMode="numeric"
            enterKeyHint="done"
            aria-label={t('pool.stake')}
            disabled={disabled}
            value={draft ?? String(value)}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
            onBlur={() => {
              if (draft !== null) set(Number(draft) || MIN_STAKE);
              setDraft(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="stk__unit">PULSE</span>
        </label>
        <button type="button" className="stk__btn" aria-label={t('stake.increase')} disabled={disabled || value >= cap} onClick={() => set(value + step)}>
          <IcPlus size={18} />
        </button>
      </div>
      <div className="stk__chips" role="group" aria-label={t('pool.stake')}>
        {CHIPS.map((c) => (
          <button type="button" key={c} className={`stk__chip num ${value === c ? 'stk__chip--on' : ''}`} disabled={disabled || c > balance} onClick={() => set(c)}>
            {c}
          </button>
        ))}
        <button type="button" className={`stk__chip stk__chip--max ${value === cap && cap > MIN_STAKE ? 'stk__chip--on' : ''}`} disabled={disabled || balance < MIN_STAKE} onClick={() => set(cap)}>
          MAX
        </button>
      </div>
    </div>
  );
}

/** Compact − value + control; the value opens the full stake editor. */
function StakeStepper({ value, onChange, balance, onOpen }: { value: number; onChange: (v: number) => void; balance: number; onOpen: () => void }) {
  const cap = stakeCap(balance);
  const step = stakeStep(value);
  const nudge = (dir: 1 | -1) => {
    const n = Math.max(MIN_STAKE, Math.min(cap, value + dir * step));
    if (n === value) {
      // At the minimum stake or the balance cap: tell the thumb, not just the eye.
      haptic.notify('warning');
      return;
    }
    haptic.tap();
    onChange(n);
  };
  return (
    <div className="bd__stk" role="group" aria-label={t('pd.stake')}>
      <button type="button" className={`bd__stk-btn ${value <= MIN_STAKE ? 'is-off' : ''}`} aria-label={t('pd.decrease')} aria-disabled={value <= MIN_STAKE} onClick={() => nudge(-1)}>
        <IcMinus size={16} />
      </button>
      <button
        type="button"
        className="bd__stk-val"
        aria-label={`${t('pd.editStake')}: ${fmtNumber(value)} PULSE`}
        aria-expanded={false}
        onClick={() => {
          haptic.tap();
          onOpen();
        }}
      >
        <span className="num">{fmtNumber(value)}</span>
        <small>PULSE</small>
      </button>
      <button type="button" className={`bd__stk-btn ${value >= cap ? 'is-off' : ''}`} aria-label={t('pd.increase')} aria-disabled={value >= cap} onClick={() => nudge(1)}>
        <IcPlus size={16} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bet dock (sticky, thumb zone)                                       */
/* ------------------------------------------------------------------ */

export interface DockStatus {
  icon: ReactNode;
  title: string;
  sub?: string;
  tone?: 'muted' | 'cyan' | 'lime' | 'yellow';
  action?: { label: string; onClick: () => void };
}

export function BetDock({
  status,
  pick,
  odds,
  stake,
  onStake,
  balance,
  onConfirm,
  onWallet,
}: {
  /** Entries are not accepted: show why and where to go next. */
  status?: DockStatus | null;
  pick: { label: string; icon?: ReactNode } | null;
  odds: number | null;
  stake: number;
  onStake: (v: number) => void;
  balance: number;
  onConfirm: () => void;
  onWallet: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  if (status) {
    return (
      <div className={`bd bd--status bd--${status.tone ?? 'muted'}`} role="status">
        <div className="bd__status">
          <span className="bd__status-icon">{status.icon}</span>
          <div className="bd__status-t">
            <b>{status.title}</b>
            {status.sub && <span>{status.sub}</span>}
          </div>
          {status.action && (
            <button
              type="button"
              className="bd__action"
              onClick={() => {
                haptic.tap();
                status.action!.onClick();
              }}
            >
              {status.action.label}
            </button>
          )}
        </div>
      </div>
    );
  }
  const noFunds = balance < MIN_STAKE;
  const potential = odds ? Math.round(stake * odds) : null;
  const reveal = reduced ? { initial: false as const } : { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: 'auto' }, exit: { opacity: 0, height: 0 }, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const } };
  return (
    <section className={`bd ${pick ? 'bd--ready' : 'bd--empty'}`} aria-label={t('pool.ticket')}>
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div key="stk" className="bd__editor" {...reveal}>
            <StakePanel value={stake} onChange={onStake} balance={balance} onDone={() => setEditing(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="bd__main">
        <div className="bd__pick" aria-live="polite">
          <span className={`bd__pick-icon ${pick ? '' : 'bd__pick-icon--empty'}`}>{pick ? (pick.icon ?? <IcTicket size={20} />) : <IcTicket size={20} />}</span>
          {pick ? (
            <div className="bd__pick-t">
              <span className="bd__pick-k">{t('pd.yourPick')}</span>
              <b className="bd__pick-l">{pick.label}</b>
              <OddsValue value={odds} className="bd__odds" />
            </div>
          ) : (
            <div className="bd__pick-t">
              <b className="bd__pick-l">{t('pd.hintTitle')}</b>
              <span className="bd__pick-s">{t('pd.hintSub')}</span>
            </div>
          )}
        </div>
        {!editing &&
          (pick ? (
            <StakeStepper value={stake} onChange={onStake} balance={balance} onOpen={() => setEditing(true)} />
          ) : (
            <button
              type="button"
              className="bd__pill"
              aria-label={`${t('pd.editStake')}: ${fmtNumber(stake)} PULSE`}
              onClick={() => {
                haptic.tap();
                setEditing(true);
              }}
            >
              <span className="bd__pill-k">{t('pd.stake')}</span>
              <span className="bd__pill-v num">
                {fmtNumber(stake)} <small>PULSE</small>
              </span>
            </button>
          ))}
      </div>
      <AnimatePresence initial={false}>
        {pick && (
          <motion.div key="cta" className="bd__cta" {...reveal}>
            {noFunds ? (
              <div className="bd__nofunds" role="alert">
                <IcCoins size={18} />
                <div>
                  <b>{t('pd.noFunds')}</b>
                  <span>{t('pd.noFundsSub', { min: MIN_STAKE })}</span>
                </div>
                <button
                  type="button"
                  className="bd__action"
                  onClick={() => {
                    haptic.tap();
                    onWallet();
                  }}
                >
                  {t('pd.wallet')}
                </button>
              </div>
            ) : (
              <SwipeConfirm label={t('pd.swipe')} sub={potential !== null ? t('pd.swipeSub', { stake: fmtNumber(stake), win: fmtNumber(potential) }) : undefined} onConfirm={onConfirm} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Confetti (canvas burst, reduced-motion aware)                       */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = ['#c6ff3d', '#2fe6ff', '#ffffff', '#ffd12e', '#b26bff'];

export function Confetti({ fire }: { fire: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const motion = useSettings((s) => s.motion);
  useEffect(() => {
    if (!fire || !ref.current) return;
    const reduced = prefersReducedMotion(motion);
    const cv = ref.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = (cv.width = cv.clientWidth * dpr);
    const h = (cv.height = cv.clientHeight * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const n = reduced ? 36 : 150;
    const parts = Array.from({ length: n }, (_, i) => {
      const left = i % 2 === 0;
      return {
        x: w * (left ? 0.12 : 0.88),
        y: h * 0.64,
        vx: (left ? 1 : -1) * (1.5 + Math.random() * 7) * dpr,
        vy: -(11 + Math.random() * 10) * dpr,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        s: (5 + Math.random() * 6) * dpr,
        c: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
      };
    });
    let raf = 0;
    const t0 = performance.now();
    const dur = reduced ? 900 : 2600;
    const step = (now: number) => {
      const k = (now - t0) / dur;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        if (!reduced) {
          p.vy += 0.32 * dpr;
          p.vx *= 0.99;
          p.x += p.vx;
          p.y += p.vy;
          p.r += p.vr;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (k < 1) raf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fire, motion]);
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function StatCell({ k, v, sub, accent }: { k: ReactNode; v: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="stat">
      <span className="stat__k">{k}</span>
      <span className="stat__v num" style={accent ? { color: accent } : undefined}>
        {v}
      </span>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

/** Pool size / participants line. */
export function PoolMeta({ total, players }: { total: number; players: number }) {
  return (
    <span className="pmeta num">
      <IcCoins size={13} /> {fmtNumber(total)}
      <span className="pmeta__sep" />
      {t('pool.participants', { n: fmtNumber(players) })}
    </span>
  );
}
