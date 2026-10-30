import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLive } from '@/store/live';
import { useNav } from '@/store/nav';
import { usePools, multiplier } from '@/demo/poolEngine';
import { useWallet, type Entry } from '@/store/wallet';
import { getEngine } from '@/app/sessionService';
import { useSceneView } from '@/app/SceneHost';
import { useSessionNow } from '@/app/hooks';
import { layoutOf, outcomeLabel, poolTexts, type PoolLayout } from '@/app/poolText';
import { canAcceptEntry, canResumeDraft, entryBlockReason, msUntilLock } from '@/domain/lifecycle';
import { getTemplate } from '@/domain/markets/catalog';
import type { Pool } from '@/domain/types';
import type { CameraMode } from '@/three/engine/cameraRig';
import { CHANNELS } from '@/demo/channels';
import { CIRCUIT_META } from '@/data/circuits';
import { fmtClock, fmtCountdown, fmtNumber, fmtOdds, getLang, t } from '@/i18n/core';
import { Collapsible, Help, Sheet } from '@/ui/kit';
import { SECTOR_COLORS } from '@/ui/TrackMap';
import { IconCheck, IconChevron, IconInfo, IconLock, IconPit, IconTarget, IconTimer, IconTyre, IconUsers } from '@/ui/icons';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { FamilyVisual, OutcomeGrid, outcomeIcon, sceneChip } from '@/ui/bet/poolFamilies';
import { FlagGlyph, IcCoins, IcLink, IcPodium, IcStopwatch, IcSwords } from '@/ui/bet/icons';
import { MIN_STAKE, TicketDock, URGENT_MS } from '@/ui/bet/TicketDock';
import { InPlayCard, PoolStateCard } from '@/ui/bet/ResultCard';
import { CountUp, Sparks } from '@/ui/bet/motionBits';
import '@/styles/pool.css';

/** Unsent selection per pool. Restored only for the same session, pool and version while accepting (F1-044). */
interface Draft {
  session_id: string;
  pool_id: string;
  version: number;
  outcome: string | null;
  stake: number;
}
const drafts = new Map<string, Draft>();

const LAYOUT_ICON: Record<PoolLayout, (p: { size?: number }) => ReactNode> = {
  zone: (p) => <IconTarget size={p.size} />,
  duel: (p) => <IcSwords size={p.size} />,
  pit: (p) => <IconPit size={p.size} />,
  tyre: (p) => <IconTyre size={p.size} />,
  pace: (p) => <IcStopwatch size={p.size} />,
  incident: (p) => <FlagGlyph color="#ffd12e" size={p.size} />,
  position: (p) => <IcPodium size={p.size} />,
  quali: (p) => <IconTimer size={p.size} />,
  combo: (p) => <IcLink size={p.size} />,
};

function cameraFor(pool: Pool, layout: PoolLayout): CameraMode {
  if (layout === 'zone') return 'overview';
  if (!pool.subject.driver_a) return 'director';
  return 'follow';
}

type ConfirmState = { phase: 'checking' | 'ok' | 'rejected'; entry?: Entry; outcome: string; stake: number; mult: number };

export function PoolScreen({ poolId }: { poolId: string }) {
  const back = useNav((s) => s.back);
  const push = useNav((s) => s.push);
  const go = useNav((s) => s.go);
  const pools = usePools((s) => s.pools);
  const live = useLive((s) => s.live);
  const setFollow = useLive((s) => s.setFollow);
  const setRival = useLive((s) => s.setRival);
  const setScene = useSceneView((s) => s.set);
  const balance = useWallet((s) => s.balance);
  const entries = useWallet((s) => s.entries);
  const now = useSessionNow();
  const lp = pools.find((p) => p.pool.pool_id === poolId) ?? null;
  const [outcome, setOutcome] = useState<string | null>(() => {
    const d = drafts.get(poolId);
    const lp0 = usePools.getState().pools.find((p) => p.pool.pool_id === poolId);
    const r = useLive.getState().runner;
    return d && lp0 && canResumeDraft(d, lp0.pool, r?.ready ? r.nowMs : Date.now()) ? d.outcome : null;
  });
  const [stake, setStake] = useState<number>(() => drafts.get(poolId)?.stake ?? Math.min(25, Math.max(MIN_STAKE, Math.floor(useWallet.getState().balance))));
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [lockedPick, setLockedPick] = useState(false);
  const submitting = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const pool = lp?.pool ?? null;
  const layout: PoolLayout = pool ? layoutOf(pool) : 'position';
  const subjectA = pool?.subject.driver_a;
  const subjectB = pool?.subject.driver_b;

  useEffect(() => {
    if (pool) drafts.set(poolId, { session_id: pool.session_id, pool_id: pool.pool_id, version: pool.version, outcome, stake });
  }, [poolId, pool, outcome, stake]);

  // Scene framing for this pool (F1-050); frozen during confirmation.
  useEffect(() => {
    setScene({ layout: 'top', labels: [subjectA, subjectB, ...(lp?.focus ?? [])].filter(Boolean) as string[], cameraOverride: pool ? cameraFor(pool, layout) : 'follow' });
    if (subjectA) setFollow(subjectA);
    else if (lp?.focus[0]) setFollow(lp.focus[0]);
    setRival(subjectB ?? null);
    return () => {
      setScene({ layout: 'hidden', zone: null, frameZone: false, labels: [], cameraOverride: null, frozen: false });
      setRival(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId]);

  // The 3D section scrolls with the page (transform only — no canvas resize).
  useEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>('.screen');
    const host = document.querySelector<HTMLElement>('.scene-host');
    if (!scroller || !host) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const y = Math.min(scroller.scrollTop, host.offsetHeight + 80);
      host.style.transform = y > 0 ? `translate3d(0, ${-y}px, 0)` : '';
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    apply();
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
      host.style.transform = '';
    };
  }, [poolId]);

  useEffect(() => {
    if (!pool) return;
    let zone: 1 | 2 | 3 | null = null;
    if (pool.market_id === 'F1-M11' && outcome && /^S[123]$/.test(outcome)) zone = Number(outcome[1]) as 1 | 2 | 3;
    if (pool.market_id === 'F1-M19') zone = pool.target.parameters.sector ?? null;
    if (pool.target.parameters.combo) {
      const sec = pool.target.parameters.combo.find((c) => c.kind === 'SECTOR');
      if (sec) zone = Number(sec.value) as 1 | 2 | 3;
    }
    setScene({ zone, frameZone: zone !== null && pool.market_id === 'F1-M11' });
  }, [outcome, pool, setScene]);

  useEffect(() => {
    setScene({ frozen: confirm !== null });
  }, [confirm, setScene]);

  const accept = pool ? canAcceptEntry(pool, now) : false;
  const blockKey = pool ? entryBlockReason(pool, now) : null;
  const wasOpen = useRef(accept);
  useEffect(() => {
    if (wasOpen.current && !accept && outcome) {
      haptic.notify('warning');
      sfx.lock();
      setLockedPick(true);
    }
    wasOpen.current = accept;
  }, [accept, outcome]);
  // The "locked" dock explains a lost selection for a moment, then gets out of the way.
  useEffect(() => {
    if (!lockedPick) return;
    const id = setTimeout(() => setLockedPick(false), 8000);
    return () => clearTimeout(id);
  }, [lockedPick]);

  const myEntries = useMemo(() => entries.filter((e) => e.poolId === poolId), [entries, poolId]);

  if (!lp || !pool) {
    return (
      <div className="pl">
        <PoolHead onBack={back} layout="position" title={t('pool.title')} />
        <div className="pl-gone">
          <IconLock size={28} />
          <p>{t('pool.noPools')}</p>
          <button type="button" className="pl-btn pl-btn--ghost" onClick={() => go('live')}>
            {t('confirm.track')}
          </button>
        </div>
      </div>
    );
  }

  const tx = poolTexts(pool);
  const templ = getTemplate(pool.market_id);
  const mult = outcome ? multiplier(lp.book, outcome, stake) : null;
  const totalPool = Object.values(lp.book.stakes).reduce((a, b) => a + b, 0);
  const lang = getLang();
  const channel = CHANNELS.find((c) => c.id === useLive.getState().channelId);
  const meta = channel ? CIRCUIT_META.find((c) => c.id === channel.circuitId) : undefined;
  const selected = accept && outcome ? (pool.outcomes.find((o) => o.id === outcome) ?? null) : null;
  const myPicks = new Set(myEntries.map((e) => e.outcomeId));
  const msLeft = msUntilLock(pool, now);
  const totalMs = Date.parse(pool.closes_at) - Date.parse(pool.opens_at);
  const insufficient = balance < stake || balance < MIN_STAKE;

  const pick = (id: string) => {
    if (!accept) return;
    setOutcome(id);
    // Keep the chosen card visible above the (expanding) ticket dock.
    window.setTimeout(() => {
      const tile = rootRef.current?.querySelector<HTMLElement>('.ot--on');
      const dock = rootRef.current?.querySelector<HTMLElement>('.tdock');
      const scroller = rootRef.current?.closest<HTMLElement>('.screen');
      if (!tile || !dock || !scroller) return;
      const over = tile.getBoundingClientRect().bottom - dock.getBoundingClientRect().top + 12;
      if (over > 0) scroller.scrollBy({ top: over, behavior: 'smooth' });
    }, 300);
  };

  const submit = () => {
    if (!outcome || submitting.current || confirm) return;
    // Local guard with server time: a pool that just locked never opens the sheet (QA17).
    if (!canAcceptEntry(pool, useLive.getState().runner?.nowMs ?? now)) return;
    submitting.current = true;
    const m = multiplier(lp.book, outcome, stake);
    setConfirm({ phase: 'checking', outcome, stake, mult: m });
    sfx.confirm();
    window.setTimeout(() => {
      submitting.current = false;
      const engine = getEngine();
      const r = useLive.getState().runner;
      const serverNow = r?.nowMs ?? Date.now();
      const current = usePools.getState().pools.find((p) => p.pool.pool_id === pool.pool_id)?.pool ?? pool;
      // Server-side check with server time: a pool locked during the open sheet is rejected (QA17).
      if (!engine || !r || !canAcceptEntry(current, serverNow) || useWallet.getState().balance < stake || !engine.placeEntry(pool.pool_id, outcome, stake, serverNow)) {
        haptic.notify('error');
        sfx.lose();
        setConfirm((c) => (c ? { ...c, phase: 'rejected' } : c));
        return;
      }
      const o = pool.outcomes.find((x) => x.id === outcome)!;
      const entry: Entry = {
        id: `E-${pool.pool_id.split(':').slice(-2).join('-')}-${Math.floor(serverNow / 1000) % 100000}`,
        poolId: pool.pool_id,
        channelId: r.channel.id,
        cycle: r.cycle,
        sessionId: r.manifest.session_id,
        marketId: pool.market_id,
        outcomeId: outcome,
        pool: current,
        questionKey: '',
        questionParams: {},
        outcomeLabel: outcomeLabel(o, pool.market_id),
        stake,
        estimate: m,
        createdAt: serverNow,
        state: 'PENDING',
        payout: 0,
        settlement: null,
        settlementHistory: [],
        finalMultiplier: null,
        circuitId: r.circuit.id,
        meetingName: channel?.title ?? { ru: '', en: '' },
        seen: true,
      };
      useWallet.getState().addEntry(entry);
      haptic.notify('success');
      setConfirm((c) => (c ? { ...c, phase: 'ok', entry } : c));
      setOutcome(null);
      drafts.delete(poolId);
    }, 900);
  };

  const ctaLabel = insufficient ? t('pool.insufficient') : t('pool.swipe');
  const ctaSub = selected && mult ? t('pool2.swipeSub', { stake: fmtNumber(stake), ret: fmtNumber(Math.round(stake * mult)) }) : undefined;
  const showDock = accept || lockedPick;
  const confirmOutcome = confirm ? pool.outcomes.find((o) => o.id === confirm.outcome) : undefined;

  return (
    <div className={`pl ${showDock ? 'pl--dock' : ''}`} ref={rootRef}>
      <PoolHead
        onBack={back}
        layout={layout}
        title={tx.title}
        right={<LockBox ms={msLeft} total={totalMs} accept={accept} status={pool.status} suspended={pool.intake_status === 'SUSPENDED'} />}
      />

      {/* 3D section (scene host shows through) */}
      <div className="pl-scene" aria-hidden="true">
        <div className="pl-hud pl-hud--tl">
          <span className="pl-hud__live">
            <i /> LIVE
          </span>
          {live?.totalLaps && (
            <span className="num">
              {t('lv.lapShort')} <b>{Math.min(live.leaderLap, live.totalLaps)}</b>/{live.totalLaps}
            </span>
          )}
          {live?.segment && <span className="num">{live.segment.id}</span>}
        </div>
        {live && sceneChip(pool, live.cars) && <div className="pl-hud pl-hud--tr num">{sceneChip(pool, live.cars)}</div>}
        <div className="pl-hud pl-hud--bl">
          <b>{meta?.shortName ?? meta?.name}</b>
          {meta && <span className="num">{(meta.lengthM / 1000).toFixed(3)} km</span>}
        </div>
        {layout === 'zone' && (
          <div className="pl-hud pl-hud--br">
            {(['S1', 'S2', 'S3'] as const).map((s, i) => (
              <span key={s} className={`pl-zchip ${outcome === s && accept ? 'pl-zchip--on' : ''}`} style={{ ['--zc' as string]: SECTOR_COLORS[i] }}>
                {s} <b className="num">{fmtOdds(multiplier(lp.book, s))}x</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Question + anchor (never truncated — QA20) */}
      <section className="pl-q">
        <div className="pl-q__kicker">
          {LAYOUT_ICON[layout]({ size: 14 })}
          <span>{t(`pl.layout.${layout}`)}</span>
          <span className="pl-q__demo">DEMO</span>
        </div>
        <h1 className="pl-q__title">{tx.question}</h1>
        <div className="pl-q__line">
          <IconTimer size={14} />
          <span>{tx.anchor ?? tx.window}</span>
        </div>
        <div className="pl-q__meta">
          <span className={`pl-chip pl-chip--${accept ? 'open' : pool.status.toLowerCase()}`}>
            {accept && <i className="pl-chip__dot" />}
            {pool.intake_status === 'SUSPENDED' && pool.status === 'OPEN' ? t('pool.suspended') : t(`pool.status.${pool.status}`)}
          </span>
          <span className="pl-chip pl-chip--ghost">
            {t('pool.determinedBy')}: {tx.determinant}
          </span>
        </div>
        <PoolPulse players={lp.book.players} total={totalPool} live={accept} />
      </section>

      {accept ? <InPlayCard lp={lp} entries={myEntries} onOpen={(id) => push({ name: 'entry', entryId: id })} /> : <PoolStateCard lp={lp} entries={myEntries} blockKey={blockKey} onOpen={(id) => push({ name: 'entry', entryId: id })} />}

      <FamilyVisual lp={lp} layout={layout} />

      <section className="pl-pick">
        <div className="pl-sec">
          <span className="pl-sec__t">{accept ? t('pool.choose') : pool.status === 'SETTLED' ? t('pl.result') : t('pl.outcomes')}</span>
          <span className="pl-sec__r">
            {accept ? (
              <span className="pl-sec__live">
                <i /> {t('pl.liveOdds')}
              </span>
            ) : lp.book.finalMultipliers ? (
              t('pl.finalOdds')
            ) : (
              ''
            )}
            <Help text={t('pool.estimateHint')} />
          </span>
        </div>
        <OutcomeGrid lp={lp} layout={layout} value={accept ? outcome : null} onChange={pick} disabled={!accept} stake={stake} myPicks={myPicks} />
      </section>

      <Collapsible title={t('pool.rules')} icon={<IconInfo size={18} />}>
        <p className="rules__text">{tx.rule}</p>
        <dl className="rules__dl">
          <dt>{t('pool.determinedBy')}</dt>
          <dd>{tx.determinant}</dd>
          <dt>{t('pool.window')}</dt>
          <dd>{tx.window}</dd>
          {tx.anchor && (
            <>
              <dt>{t('pool.anchor')}</dt>
              <dd>{tx.anchor}</dd>
            </>
          )}
          <dt>SC / VSC</dt>
          <dd>{tx.scVsc}</dd>
          <dt>RED</dt>
          <dd>{tx.red}</dd>
          <dt>{t('pool.deadline')}</dt>
          <dd className="num">
            {fmtClock(Date.parse(pool.settlement_deadline), true)} UTC{fmtOffset()}
          </dd>
          <dt>{t('pool.versions')}</dt>
          <dd className="num" style={{ fontSize: 11 }}>
            {pool.template_version} · {pool.ruleset_version} · {pool.circuit_layout_version} · {pool.provider_schema_version}
          </dd>
        </dl>
        <p className="muted" style={{ fontSize: 12 }}>
          {t('pool.dataNote')}
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          {templ.family} · {pool.market_id} · {lang.toUpperCase()}
        </p>
      </Collapsible>

      {showDock && (
        <TicketDock
          locked={!accept}
          pick={selected && mult ? { label: outcomeLabel(selected, pool.market_id), icon: outcomeIcon(selected, pool, 20), odds: mult, share: totalPool > 0 ? (lp.book.stakes[selected.id] ?? 0) / totalPool : null } : null}
          stake={stake}
          onStake={setStake}
          balance={balance}
          msLeft={msLeft}
          totalMs={totalMs}
          ctaLabel={!accept ? t('pool2.headerLocked') : ctaLabel}
          ctaSub={ctaSub}
          canConfirm={accept && !!selected && !insufficient && confirm === null}
          onConfirm={submit}
          onClear={() => {
            haptic.tap();
            setOutcome(null);
          }}
          lockedText={t(blockKey ?? 'pool2.lockedPick')}
        />
      )}

      <Sheet open={confirm !== null} onClose={() => confirm?.phase !== 'checking' && setConfirm(null)} title={t('confirm.title')} label={t('confirm.title')}>
        {confirm && confirmOutcome && (
          <div className={`cf cf--${confirm.phase}`}>
            <div className="cf__ticket">
              <div className="cf__q">
                <span className="cf__k">{t('confirm.question')}</span>
                <b>{tx.question}</b>
                {tx.anchor && (
                  <span className="cf__anchor">
                    <IconTimer size={13} /> {tx.anchor}
                  </span>
                )}
              </div>
              <div className="cf__perf" aria-hidden="true" />
              <div className="cf__pick">
                <span className="cf__pick-icon">{outcomeIcon(confirmOutcome, pool, 22)}</span>
                <div className="cf__pick-text">
                  <span className="cf__k">{t('confirm.outcome')}</span>
                  <b>{outcomeLabel(confirmOutcome, pool.market_id)}</b>
                </div>
                <span className="cf__odds num">{fmtOdds(confirm.mult)}x</span>
              </div>
              <dl className="cf__grid">
                <div>
                  <dt>{t('confirm.window')}</dt>
                  <dd>{tx.window}</dd>
                </div>
                <div>
                  <dt>{t('confirm.amount')}</dt>
                  <dd className="num">{fmtNumber(confirm.stake)} PULSE</dd>
                </div>
                <div>
                  <dt>{t('pool.potential')}</dt>
                  <dd className="num lime">≈ {fmtNumber(Math.round(confirm.stake * confirm.mult))} PULSE</dd>
                </div>
                <div>
                  <dt>{t('confirm.mode')}</dt>
                  <dd>
                    <span className="cf__demo">DEMO</span> {t('confirm.modeDemo')}
                  </dd>
                </div>
              </dl>
              <AnimatePresence>
                {confirm.phase === 'ok' && confirm.entry && (
                  <motion.div
                    key="stamp"
                    className="cf__stamp"
                    initial={{ scale: 2.4, opacity: 0, rotate: -24 }}
                    animate={{ scale: 1, opacity: 1, rotate: -9 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 22, mass: 0.8 }}
                  >
                    <span>{t('pool2.stamp')}</span>
                    <small className="num">{confirm.entry.id}</small>
                  </motion.div>
                )}
              </AnimatePresence>
              <Sparks fire={confirm.phase === 'ok' ? 1 : 0} count={22} spread={110} />
            </div>
            <AnimatePresence mode="wait">
              {confirm.phase === 'checking' && (
                <motion.div key="c" className="cf__state" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} role="status">
                  <span className="cf__spin" />
                  <span>{t('confirm.checking')}</span>
                  <span className="cf__bar" aria-hidden="true" />
                </motion.div>
              )}
              {confirm.phase === 'ok' && confirm.entry && (
                <motion.div key="ok" className="cf__state cf__state--ok" initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} role="status">
                  <span className="cf__check">
                    <IconCheck size={22} />
                  </span>
                  <div>
                    <b>{t('confirm.confirmed')}</b>
                    <div className="cf__id num">
                      {t('confirm.entryId')}: {confirm.entry.id}
                    </div>
                  </div>
                </motion.div>
              )}
              {confirm.phase === 'rejected' && (
                <motion.div key="rej" className="cf__state cf__state--bad" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert">
                  <IconLock size={20} /> <span>{t('confirm.rejectedLocked')}</span>
                </motion.div>
              )}
            </AnimatePresence>
            {confirm.phase === 'ok' && (
              <div className="cf__btns">
                <button
                  type="button"
                  className="pl-btn pl-btn--primary"
                  onClick={() => {
                    setConfirm(null);
                    go('live');
                  }}
                >
                  {t('confirm.track')}
                </button>
                <button type="button" className="pl-btn pl-btn--ghost" onClick={() => setConfirm(null)}>
                  {t('pool2.stay')}
                </button>
              </div>
            )}
            {confirm.phase === 'rejected' && (
              <div className="cf__btns">
                <button type="button" className="pl-btn pl-btn--ghost" onClick={() => setConfirm(null)}>
                  {t('ui.close')}
                </button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function fmtOffset(): string {
  const off = -new Date().getTimezoneOffset();
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return off === 0 ? '' : ` ${off > 0 ? '+' : '−'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/* ------------------------------------------------------------------ */

function PoolHead({ onBack, layout, title, right }: { onBack: () => void; layout: PoolLayout; title: string; right?: ReactNode }) {
  return (
    <header className="pl-head">
      <button
        type="button"
        className="pl-head__back"
        aria-label={t('ui.back')}
        onClick={() => {
          haptic.tap();
          onBack();
        }}
      >
        <IconChevron dir="left" size={20} />
      </button>
      <span className="pl-head__icon">{LAYOUT_ICON[layout]({ size: 18 })}</span>
      <div className={`pl-head__title ${title.length > 16 ? 'pl-head__title--long' : ''}`}>{title}</div>
      {right}
    </header>
  );
}

/** Lock chip: real lock time only; amber pulse ≤ 30 s, red heartbeat ≤ 10 s, instant grey lock on close (QA17). */
function LockBox({ ms, total, accept, status, suspended }: { ms: number; total: number; accept: boolean; status: Pool['status']; suspended: boolean }) {
  if (!accept) {
    return (
      <div className={`pl-lock pl-lock--closed pl-lock--${status.toLowerCase()}`} role="status">
        <IconLock size={14} />
        <span>{suspended && status === 'OPEN' ? t('pool.suspended') : status === 'OPEN' ? t('pool2.headerLocked') : t(`pool.status.${status}`)}</span>
      </div>
    );
  }
  const frac = Math.max(0, Math.min(1, total > 0 ? ms / total : 0));
  const tone = ms <= 10_000 ? 'urgent' : ms <= URGENT_MS ? 'warn' : '';
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <div className={`pl-lock ${tone ? `pl-lock--${tone}` : ''}`} role="timer" aria-label={`${t('pool.locksIn')} ${fmtCountdown(ms)}`}>
      <span className="pl-lock__ring" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r={r} className="pl-lock__track" />
          <circle cx="16" cy="16" r={r} className="pl-lock__arc" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 16 16)" />
        </svg>
        <IcStopwatch size={14} />
      </span>
      <span className="pl-lock__text">
        <small>{tone ? t('pool2.closing') : t('pool.locksIn')}</small>
        <b className="num">{fmtCountdown(ms)}</b>
      </span>
    </div>
  );
}

/** Truthful social proof from the DEMO pool book. */
function PoolPulse({ players, total, live }: { players: number; total: number; live: boolean }) {
  return (
    <div className="pl-pulse" aria-label={`${t('pool.participants', { n: fmtNumber(players) })} · ${fmtNumber(total)} PULSE ${t('pool2.inPool')}`}>
      <span className={`pl-pulse__dot ${live ? 'pl-pulse__dot--live' : ''}`} aria-hidden="true" />
      <span className="pl-pulse__item">
        <IconUsers size={14} />
        <CountUp className="num" value={players} />
        <small>{t('pool2.playing')}</small>
      </span>
      <span className="pl-pulse__sep" aria-hidden="true" />
      <span className="pl-pulse__item">
        <IcCoins size={14} />
        <CountUp className="num" value={total} />
        <small>PULSE {t('pool2.inPool')}</small>
      </span>
      <span className="pl-pulse__tag">{t('pool2.liveBook')}</span>
    </div>
  );
}
