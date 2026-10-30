import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLive } from '@/store/live';
import { useNav } from '@/store/nav';
import { usePools, type LivePool } from '@/demo/poolEngine';
import { useWallet, type Entry } from '@/store/wallet';
import { useSettings, prefersReducedMotion } from '@/store/settings';
import { getEngine } from '@/app/sessionService';
import { useSceneView } from '@/app/SceneHost';
import { useSessionNow } from '@/app/hooks';
import { layoutOf, outcomeLabel, poolTexts, type PoolLayout } from '@/app/poolText';
import { canAcceptEntry, entryBlockReason, msUntilLock } from '@/domain/lifecycle';
import type { Pool } from '@/domain/types';
import type { CameraMode } from '@/three/engine/cameraRig';
import { CHANNELS } from '@/demo/channels';
import { CIRCUIT_META } from '@/data/circuits';
import { fmtClock, fmtCountdown, fmtNumber, t } from '@/i18n/core';
import { createPortal } from 'react-dom';
import { Collapsible, Help } from '@/ui/kit';
import { PortalSheet } from '@/screens/common';
import { SECTOR_COLORS } from '@/ui/TrackMap';
import { IconCheck, IconChevron, IconClose, IconInfo, IconLock, IconPit, IconTarget, IconTimer, IconTyre, IconWarning } from '@/ui/icons';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { BetDock, Confetti, MIN_STAKE, OddsValue, oddsText, PoolMeta, type DockStatus } from '@/ui/bet/parts';
import { FamilyVisual, OutcomeGrid, outcomeIcon, outcomeOdds, sceneChip } from '@/ui/bet/poolFamilies';
import { FlagGlyph, IcLink, IcPodium, IcStopwatch, IcSwords, IcTrophy } from '@/ui/bet/icons';
import '@/styles/pool.css';

const drafts = new Map<string, { outcome: string | null; stake: number }>();

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
  const draftKey = lp ? `${lp.pool.pool_id}@${lp.pool.version}` : '';
  const [outcome, setOutcome] = useState<string | null>(() => drafts.get(draftKey)?.outcome ?? null);
  const [stake, setStake] = useState<number>(() => drafts.get(draftKey)?.stake ?? Math.min(100, Math.max(10, Math.floor(useWallet.getState().balance))));
  const [confirm, setConfirm] = useState<null | { phase: 'checking' | 'ok' | 'rejected'; reason?: 'locked' | 'balance' | 'error'; entry?: Entry; outcome: string; stake: number; mult: number }>(null);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  const cfRef = useRef<HTMLDivElement>(null);
  const [fire, setFire] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draftKey) drafts.set(draftKey, { outcome, stake });
  }, [draftKey, outcome, stake]);

  // A stake above the balance (e.g. after another entry) would dead-end the swipe: follow the balance down.
  useEffect(() => {
    if (balance >= MIN_STAKE && stake > Math.floor(balance)) setStake(Math.floor(balance));
  }, [balance, stake]);

  const pool = lp?.pool ?? null;
  const layout: PoolLayout = pool ? layoutOf(pool) : 'position';
  const subjectA = pool?.subject.driver_a;
  const subjectB = pool?.subject.driver_b;

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

  // Bring the result and its buttons into view once the check finishes (the sheet body scrolls on short screens).
  const phase = confirm?.phase;
  useEffect(() => {
    if (phase !== 'ok' && phase !== 'rejected') return;
    const id = requestAnimationFrame(() => {
      const body = cfRef.current?.closest<HTMLElement>('.sheet__body');
      body?.scrollTo({ top: body.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [phase, reduced]);

  const accept = pool ? canAcceptEntry(pool, now) : false;
  const blockKey = pool ? entryBlockReason(pool, now) : null;
  const wasOpen = useRef(accept);
  useEffect(() => {
    if (wasOpen.current && !accept && outcome) {
      haptic.notify('warning');
      sfx.lock();
    }
    wasOpen.current = accept;
  }, [accept, outcome]);

  const myEntries = useMemo(() => entries.filter((e) => e.poolId === poolId), [entries, poolId]);
  // Celebrate a win that lands while the screen is open (haptics/sfx come from the settlement service).
  const prevStates = useRef<Map<string, Entry['state']>>(new Map(myEntries.map((e) => [e.id, e.state])));
  useEffect(() => {
    let won = false;
    for (const e of myEntries) {
      const prev = prevStates.current.get(e.id);
      if (prev && prev !== 'WON' && e.state === 'WON') won = true;
      prevStates.current.set(e.id, e.state);
    }
    if (won) setFire((n) => n + 1);
  }, [myEntries]);

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
  const mult = outcome ? outcomeOdds(lp, outcome, stake) : null;
  const totalPool = Object.values(lp.book.stakes).reduce((a, b) => a + b, 0);
  const channel = CHANNELS.find((c) => c.id === useLive.getState().channelId);
  const meta = channel ? CIRCUIT_META.find((c) => c.id === channel.circuitId) : undefined;
  const selected = outcome ? pool.outcomes.find((o) => o.id === outcome) ?? null : null;
  const myPicks = new Set(myEntries.map((e) => e.outcomeId));
  const msLeft = msUntilLock(pool, now);
  const suspended = pool.status === 'OPEN' && pool.intake_status === 'SUSPENDED';

  const pick = (id: string) => {
    if (!accept) return;
    if (outcome === id) {
      setOutcome(null);
      return;
    }
    setOutcome(id);
    // The dock grows once an outcome is picked; keep the tapped tile visible above it.
    window.setTimeout(() => {
      const root = rootRef.current;
      const tile = root?.querySelector<HTMLElement>('.og [aria-checked="true"]');
      const dock = root?.querySelector<HTMLElement>('.bd');
      const scroller = root?.closest<HTMLElement>('.screen');
      if (!tile || !dock || !scroller) return;
      const overlap = tile.getBoundingClientRect().bottom + 12 - dock.getBoundingClientRect().top;
      if (overlap > 0) scroller.scrollBy({ top: overlap, behavior: reduced ? 'auto' : 'smooth' });
    }, 260);
  };

  const submit = () => {
    if (!outcome) return;
    const m = outcomeOdds(lp, outcome, stake);
    setConfirm({ phase: 'checking', outcome, stake, mult: m });
    sfx.confirm();
    setTimeout(() => {
      const engine = getEngine();
      const r = useLive.getState().runner;
      const serverNow = r?.nowMs ?? Date.now();
      const current = usePools.getState().pools.find((p) => p.pool.pool_id === pool.pool_id)?.pool ?? pool;
      // Server-side check with server time: a pool locked during the open sheet is rejected (QA17).
      const reason = !engine || !r ? 'error' : !canAcceptEntry(current, serverNow) ? 'locked' : useWallet.getState().balance < stake ? 'balance' : null;
      if (reason || !engine!.placeEntry(pool.pool_id, outcome, stake, serverNow)) {
        haptic.notify('error');
        sfx.lose();
        setConfirm((c) => (c ? { ...c, phase: 'rejected', reason: reason ?? 'error' } : c));
        return;
      }
      const o = pool.outcomes.find((x) => x.id === outcome)!;
      const entry: Entry = {
        id: `E-${pool.pool_id.split(':').slice(-2).join('-')}-${Math.floor(serverNow / 1000) % 100000}`,
        poolId: pool.pool_id,
        channelId: r!.channel.id,
        cycle: r!.cycle,
        sessionId: r!.manifest.session_id,
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
        circuitId: r!.circuit.id,
        meetingName: channel?.title ?? { ru: '', en: '' },
        seen: true,
      };
      useWallet.getState().addEntry(entry);
      prevStates.current.set(entry.id, 'PENDING');
      haptic.notify('success');
      setConfirm((c) => (c ? { ...c, phase: 'ok', entry } : c));
      setOutcome(null);
      drafts.delete(draftKey);
    }, 900);
  };

  const toOpenPools = { label: t('pd.allPools'), onClick: () => go('live') };
  const dockStatus: DockStatus | null = accept
    ? null
    : suspended
      ? { icon: <FlagGlyph color="#ffd12e" size={20} />, title: t('pd.closed.suspended'), sub: t(blockKey ?? 'pd.closed.suspendedSub'), tone: 'yellow', action: toOpenPools }
      : pool.status === 'RESOLVING'
        ? { icon: <span className="cf__spin" />, title: t('pd.closed.resolving'), sub: t('pd.closed.resolvingSub'), tone: 'cyan', action: toOpenPools }
        : pool.status === 'SETTLED'
          ? { icon: <IcTrophy size={20} />, title: t('pd.closed.settled'), sub: t('pd.closed.settledSub'), tone: 'lime', action: toOpenPools }
          : pool.status === 'VOID'
            ? { icon: <IconInfo size={20} />, title: t('pd.closed.void'), sub: t('pd.closed.voidSub'), tone: 'yellow', action: toOpenPools }
            : { icon: <IconLock size={18} />, title: t('pd.closed.locked'), sub: t('pd.closed.lockedSub'), tone: 'muted', action: toOpenPools };
  const rejectedText = confirm?.reason === 'balance' ? t('pd.rejected.balance') : confirm?.reason === 'error' ? t('pd.rejected.error') : t('confirm.rejectedLocked');

  return (
    <div className="pl" ref={rootRef}>
      <PoolHead
        onBack={back}
        layout={layout}
        title={tx.title}
        right={<LockBox ms={msLeft} accept={accept} status={pool.status} suspended={suspended} />}
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
          {meta && (
            <span className="num">
              {fmtNumber(meta.lengthM / 1000, 3)} {t('pd.unit.km')}
            </span>
          )}
        </div>
        {layout === 'zone' && (
          <div className="pl-hud pl-hud--br">
            {(['S1', 'S2', 'S3'] as const).map((s, i) => (
              <span key={s} className={`pl-zchip ${outcome === s ? 'pl-zchip--on' : ''}`} style={{ ['--zc' as string]: SECTOR_COLORS[i] }}>
                {s} <OddsValue value={outcomeOdds(lp, s, stake)} />
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Question */}
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
          <span className={`pl-chip pl-chip--${suspended ? 'paused' : accept ? 'open' : pool.status.toLowerCase()}`}>{suspended ? t('pool.suspended') : t(`pool.status.${pool.status}`)}</span>
          <span className="pl-chip pl-chip--ghost">
            {t('pool.determinedBy')}: {tx.determinant}
          </span>
          <PoolMeta total={totalPool} players={lp.book.players} />
        </div>
      </section>

      <StateBanner lp={lp} />
      {myEntries.length > 0 && <MyResult lp={lp} entries={myEntries} onOpen={(id) => push({ name: 'entry', entryId: id })} />}

      <FamilyVisual lp={lp} layout={layout} />

      <section className="pl-pick">
        <div className="pl-sec">
          <span className="pl-sec__t">{accept ? t('pool.choose') : pool.status === 'SETTLED' ? t('pl.result') : t('pl.outcomes')}</span>
          <span className="pl-sec__r">
            {accept ? t('pl.liveOdds') : lp.book.finalMultipliers ? t('pl.finalOdds') : ''}
            <Help text={t('pd.capHint')} />
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
          <dd className="num rules__ver">
            {pool.market_id} · {pool.template_version} · {pool.ruleset_version} · {pool.circuit_layout_version} · {pool.provider_schema_version}
          </dd>
        </dl>
        <p className="muted rules__note">{t('pool.dataNote')}</p>
      </Collapsible>

      <BetDock
        status={dockStatus}
        pick={selected ? { label: outcomeLabel(selected, pool.market_id), icon: outcomeIcon(selected, pool, 22) } : null}
        odds={mult}
        stake={stake}
        onStake={setStake}
        balance={balance}
        onConfirm={submit}
        onWallet={() => push({ name: 'wallet' })}
      />

      {/* Portaled: inside the scrolling page an absolute sheet would anchor to the page bottom, not the screen. */}
      <PortalSheet open={confirm !== null} onClose={() => confirm?.phase !== 'checking' && setConfirm(null)} title={t('confirm.title')} label={t('confirm.title')}>
        {confirm && (
          <div className="cf" ref={cfRef}>
            <div className="cf__q">
              <span className="cf__k">{t('confirm.question')}</span>
              <b>{tx.question}</b>
              <span className="cf__when">
                <IconTimer size={13} /> {tx.anchor ?? tx.window}
              </span>
            </div>
            <div className="cf__pick">
              <span className="cf__pick-icon">{outcomeIcon(pool.outcomes.find((o) => o.id === confirm.outcome)!, pool, 22)}</span>
              <div className="cf__pick-text">
                <span className="cf__k">{t('confirm.outcome')}</span>
                <b>{outcomeLabel(pool.outcomes.find((o) => o.id === confirm.outcome)!, pool.market_id)}</b>
              </div>
              <OddsValue value={confirm.mult} className="cf__odds" />
            </div>
            <div className="cf__sum">
              <div>
                <span className="cf__k">{t('pd.stake')}</span>
                <b className="num">{fmtNumber(confirm.stake)} PULSE</b>
              </div>
              <div>
                <span className="cf__k">{t('pool.potential')}</span>
                <b className="num lime">≈ {fmtNumber(Math.round(confirm.stake * confirm.mult))} PULSE</b>
              </div>
              <span className="cf__demo" title={t('confirm.modeDemo')}>
                DEMO
              </span>
            </div>
            <AnimatePresence mode="wait">
              {confirm.phase === 'checking' && (
                <motion.div key="c" className="cf__state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <span className="cf__spin" /> {t('confirm.checking')}
                </motion.div>
              )}
              {confirm.phase === 'ok' && confirm.entry && (
                <motion.div key="ok" className="cf__state cf__state--ok" initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }}>
                  <span className="cf__check">
                    <IconCheck size={24} />
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
                <motion.div key="rej" className="cf__state cf__state--bad" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {confirm.reason === 'locked' ? <IconLock size={20} /> : <IconWarning size={20} />} <span>{rejectedText}</span>
                </motion.div>
              )}
            </AnimatePresence>
            {confirm.phase === 'ok' && (
              <div className="cf__btns">
                <button
                  type="button"
                  className="pl-btn pl-btn--primary"
                  onClick={() => {
                    haptic.tap();
                    setConfirm(null);
                    go('live');
                  }}
                >
                  {t('confirm.track')}
                </button>
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost"
                  onClick={() => {
                    const id = confirm.entry!.id;
                    haptic.tap();
                    setConfirm(null);
                    push({ name: 'entry', entryId: id });
                  }}
                >
                  {t('pd.viewTicket')}
                </button>
              </div>
            )}
            {confirm.phase === 'rejected' && (
              <div className="cf__btns">
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost"
                  onClick={() => {
                    haptic.tap();
                    setConfirm(null);
                  }}
                >
                  {t('ui.close')}
                </button>
              </div>
            )}
          </div>
        )}
      </PortalSheet>
      {createPortal(<Confetti fire={fire} />, document.querySelector('.app') ?? document.body)}
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
      <div className="pl-head__title">{title}</div>
      {right}
    </header>
  );
}

function LockBox({ ms, accept, status, suspended }: { ms: number; accept: boolean; status: Pool['status']; suspended: boolean }) {
  if (!accept) {
    return (
      <div className={`pl-lock pl-lock--closed pl-lock--${status.toLowerCase()}`}>
        <IconLock size={14} />
        <span>{suspended && status === 'OPEN' ? t('pool.suspended') : t(`pool.status.${status}`)}</span>
      </div>
    );
  }
  return (
    <div className={`pl-lock ${ms < 10_000 ? 'pl-lock--urgent' : ''}`} role="timer" aria-label={`${t('pool.locksIn')} ${fmtCountdown(ms)}`}>
      <IcStopwatch size={16} />
      <span className="pl-lock__text">
        <small>{t('pd.lockIn')}</small>
        <b className="num">{fmtCountdown(ms)}</b>
      </span>
    </div>
  );
}

/** Result context at the top of the page; locked / resolving / paused states live in the bet dock. */
function StateBanner({ lp }: { lp: LivePool }) {
  const pool = lp.pool;
  if (pool.status === 'VOID') {
    const reason = pool.settlement?.void_reason;
    return (
      <div className="pl-banner pl-banner--yellow" role="status">
        <IconInfo size={18} />
        <div>
          <b>{t('f1.void.title')}</b>
          <span>{reason ? t(`f1.void.${reason.toLowerCase()}`) : t('pl.state.refund')}</span>
        </div>
      </div>
    );
  }
  if (pool.status === 'SETTLED') {
    const w = pool.outcomes.find((o) => o.id === pool.settlement?.winner_outcome_id);
    return (
      <div className="pl-banner pl-banner--lime" role="status">
        <IcTrophy size={18} />
        <div>
          <b>{w ? t('pl.state.winner', { o: outcomeLabel(w, pool.market_id) }) : t('pool.settled')}</b>
          <span>{pool.settlement?.provisional ? t('entries.provisional') : t('pl.state.settledSub')}</span>
        </div>
      </div>
    );
  }
  return null;
}

function MyResult({ lp, entries, onOpen }: { lp: LivePool; entries: Entry[]; onOpen: (id: string) => void }) {
  const pool = lp.pool;
  const won = entries.filter((e) => e.state === 'WON');
  const lost = entries.filter((e) => e.state === 'LOST');
  const voided = entries.filter((e) => e.state === 'VOID');
  const pending = entries.filter((e) => e.state === 'PENDING');
  const payout = won.reduce((a, e) => a + e.payout, 0);
  const kind = won.length ? 'won' : pending.length ? 'pending' : voided.length && !lost.length ? 'void' : 'lost';
  return (
    <motion.section className={`pl-res pl-res--${kind}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="pl-res__head">
        <span className="pl-res__icon">{kind === 'won' ? <IcTrophy size={22} /> : kind === 'pending' ? <IconCheck size={20} /> : kind === 'void' ? <IconInfo size={20} /> : <IconClose size={18} />}</span>
        <div className="pl-res__t">
          <b>{kind === 'won' ? t('pl.res.won') : kind === 'pending' ? (pool.status === 'OPEN' ? t('lv.youreIn') : t('pl.res.pending')) : kind === 'void' ? t('pl.res.void') : t('pl.res.lost')}</b>
          <span>{kind === 'won' ? t('pl.res.wonSub') : kind === 'pending' ? t('pl.res.pendingSub') : kind === 'void' ? t('pl.state.refund') : t('pl.res.lostSub')}</span>
        </div>
        {kind === 'won' && <span className="pl-res__amt num">+{fmtNumber(payout)}</span>}
      </div>
      <div className="pl-res__list">
        {entries.map((e) => {
          const fm = lp.book.finalMultipliers?.[e.outcomeId] ?? e.finalMultiplier ?? e.estimate;
          return (
            <button key={e.id} type="button" className="pl-res__row" onClick={() => onOpen(e.id)}>
              <span className="pl-res__pick ellipsis">{e.outcomeLabel}</span>
              <span className="num pl-res__stake">
                {fmtNumber(e.stake)} · {oddsText(fm)}
              </span>
              <b className={`num pl-res__val pl-res__val--${e.state.toLowerCase()}`}>
                {e.state === 'WON' ? `+${fmtNumber(e.payout)}` : e.state === 'LOST' ? `−${fmtNumber(e.stake)}` : e.state === 'VOID' ? `↺ ${fmtNumber(e.payout)}` : `≈${fmtNumber(Math.round(e.stake * fm))}`}
              </b>
              <IconChevron size={14} />
            </button>
          );
        })}
      </div>
    </motion.section>
  );
}
