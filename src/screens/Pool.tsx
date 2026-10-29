import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLive } from '@/store/live';
import { useNav } from '@/store/nav';
import { usePools, multiplier, type LivePool } from '@/demo/poolEngine';
import { useWallet, type Entry } from '@/store/wallet';
import { getEngine } from '@/app/sessionService';
import { useSceneView } from '@/app/SceneHost';
import { useSessionNow } from '@/app/hooks';
import { layoutOf, outcomeLabel, poolTexts, type PoolLayout } from '@/app/poolText';
import { canAcceptEntry, entryBlockReason, msUntilLock } from '@/domain/lifecycle';
import { getTemplate } from '@/domain/markets/catalog';
import type { Pool } from '@/domain/types';
import type { CameraMode } from '@/three/engine/cameraRig';
import { CHANNELS } from '@/demo/channels';
import { CIRCUIT_META } from '@/data/circuits';
import { fmtClock, fmtCountdown, fmtNumber, fmtOdds, getLang, t } from '@/i18n/core';
import { Collapsible, Help, Sheet, SwipeConfirm } from '@/ui/kit';
import { SECTOR_COLORS } from '@/ui/TrackMap';
import { IconCheck, IconChevron, IconInfo, IconLock, IconPit, IconTarget, IconTimer, IconTyre } from '@/ui/icons';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { Confetti, PoolMeta, StakePanel, Ticket } from '@/ui/bet/parts';
import { FamilyVisual, OutcomeGrid, outcomeIcon, sceneChip } from '@/ui/bet/poolFamilies';
import { FlagGlyph, IcLink, IcPodium, IcStopwatch, IcSwords, IcTrophy } from '@/ui/bet/icons';
import '@/styles/pool.css';

const drafts = new Map<string, { outcome: string | null; stake: number }>();

const LAYOUT_ICON: Record<PoolLayout, (p: { size?: number }) => React.ReactNode> = {
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
  const [confirm, setConfirm] = useState<null | { phase: 'checking' | 'ok' | 'rejected'; entry?: Entry; outcome: string; stake: number; mult: number }>(null);
  const [fire, setFire] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draftKey) drafts.set(draftKey, { outcome, stake });
  }, [draftKey, outcome, stake]);

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
  const templ = getTemplate(pool.market_id);
  const mult = outcome ? multiplier(lp.book, outcome, stake) : null;
  const totalPool = Object.values(lp.book.stakes).reduce((a, b) => a + b, 0);
  const lang = getLang();
  const channel = CHANNELS.find((c) => c.id === useLive.getState().channelId);
  const meta = channel ? CIRCUIT_META.find((c) => c.id === channel.circuitId) : undefined;
  const selected = outcome ? pool.outcomes.find((o) => o.id === outcome) ?? null : null;
  const myPicks = new Set(myEntries.map((e) => e.outcomeId));
  const total = Date.parse(pool.closes_at) - Date.parse(pool.opens_at);
  const msLeft = msUntilLock(pool, now);
  const insufficient = balance < stake || balance < 10;

  const pick = (id: string) => {
    if (!accept) return;
    const first = outcome === null;
    setOutcome(id);
    if (first) requestAnimationFrame(() => ticketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const submit = () => {
    if (!outcome) return;
    const m = multiplier(lp.book, outcome, stake);
    setConfirm({ phase: 'checking', outcome, stake, mult: m });
    sfx.confirm();
    setTimeout(() => {
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
      prevStates.current.set(entry.id, 'PENDING');
      haptic.notify('success');
      setConfirm((c) => (c ? { ...c, phase: 'ok', entry } : c));
      setOutcome(null);
      drafts.delete(draftKey);
    }, 900);
  };

  const ctaLabel = !accept ? t(blockKey ?? 'pool.lockedNow') : !outcome ? t('pool.choose') : insufficient ? t('pool.insufficient') : t('pool.swipe');
  const ctaSub = selected && mult ? `${outcomeLabel(selected, pool.market_id)} · ${stake} PULSE · ${fmtOdds(mult)}x` : undefined;

  return (
    <div className="pl" ref={rootRef}>
      <PoolHead
        onBack={back}
        layout={layout}
        title={tx.title}
        right={<LockBox ms={msLeft} accept={accept} status={pool.status} suspended={pool.intake_status === 'SUSPENDED'} />}
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
              <span key={s} className={`pl-zchip ${outcome === s ? 'pl-zchip--on' : ''}`} style={{ ['--zc' as string]: SECTOR_COLORS[i] }}>
                {s} <b className="num">{fmtOdds(multiplier(lp.book, s))}x</b>
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
          <span className={`pl-chip pl-chip--${accept ? 'open' : pool.status.toLowerCase()}`}>{pool.intake_status === 'SUSPENDED' && pool.status === 'OPEN' ? t('pool.suspended') : t(`pool.status.${pool.status}`)}</span>
          <span className="pl-chip pl-chip--ghost">
            {t('pool.determinedBy')}: {tx.determinant}
          </span>
          <PoolMeta total={totalPool} players={lp.book.players} />
        </div>
      </section>

      <StateBanner lp={lp} blockKey={blockKey} accept={accept} />
      {myEntries.length > 0 && <MyResult lp={lp} entries={myEntries} onOpen={(id) => push({ name: 'entry', entryId: id })} />}

      <FamilyVisual lp={lp} layout={layout} />

      <section className="pl-pick">
        <div className="pl-sec">
          <span className="pl-sec__t">{accept ? t('pool.choose') : pool.status === 'SETTLED' ? t('pl.result') : t('pl.outcomes')}</span>
          <span className="pl-sec__r">
            {accept ? t('pl.liveOdds') : lp.book.finalMultipliers ? t('pl.finalOdds') : ''}
            <Help text={t('pool.estimateHint')} />
          </span>
        </div>
        <OutcomeGrid lp={lp} layout={layout} value={accept ? outcome : null} onChange={pick} disabled={!accept} stake={stake} myPicks={myPicks} />
      </section>

      {accept && (
        <div ref={ticketRef}>
          <Ticket pick={selected ? outcomeLabel(selected, pool.market_id) : null} pickIcon={selected ? outcomeIcon(selected, pool, 20) : undefined} odds={mult} stake={stake} onClear={selected ? () => (haptic.tap(), setOutcome(null)) : undefined}>
            <StakePanel value={stake} onChange={setStake} balance={balance} />
          </Ticket>
          <div className="pl-cta">
            <SwipeConfirm disabled={!accept || !outcome || insufficient} label={ctaLabel} sub={ctaSub} onConfirm={submit} />
          </div>
        </div>
      )}

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

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title={t('confirm.title')} label={t('confirm.title')}>
        {confirm && (
          <div className="cf">
            <div className="cf__q">
              <span className="cf__k">{t('confirm.question')}</span>
              <b>{tx.question}</b>
            </div>
            <div className="cf__pick">
              <span className="cf__pick-icon">{outcomeIcon(pool.outcomes.find((o) => o.id === confirm.outcome)!, pool, 22)}</span>
              <div className="cf__pick-text">
                <span className="cf__k">{t('confirm.outcome')}</span>
                <b>{outcomeLabel(pool.outcomes.find((o) => o.id === confirm.outcome)!, pool.market_id)}</b>
              </div>
              <span className="cf__odds num">{fmtOdds(confirm.mult)}x</span>
            </div>
            <dl className="cf__dl">
              <dt>{t('confirm.window')}</dt>
              <dd>{tx.window}</dd>
              <dt>{t('confirm.amount')}</dt>
              <dd className="num">{fmtNumber(confirm.stake)} PULSE</dd>
              <dt>{t('pool.potential')}</dt>
              <dd className="num lime">≈ {fmtNumber(Math.round(confirm.stake * confirm.mult))} PULSE</dd>
              <dt>{t('confirm.mode')}</dt>
              <dd>
                <span className="cf__demo">DEMO</span> {t('confirm.modeDemo')}
              </dd>
            </dl>
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
                <motion.div key="rej" className="cf__state cf__state--bad" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <IconLock size={20} /> {t('confirm.rejectedLocked')}
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
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost"
                  onClick={() => {
                    setConfirm(null);
                    go('pools');
                  }}
                >
                  {t('confirm.toPools')}
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
      <Confetti fire={fire} />
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

function PoolHead({ onBack, layout, title, right }: { onBack: () => void; layout: PoolLayout; title: string; right?: React.ReactNode }) {
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
      <div className="pl-head__title ellipsis">{title}</div>
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
    <div className={`pl-lock ${ms < 10_000 ? 'pl-lock--urgent' : ''}`} role="timer">
      <IcStopwatch size={16} />
      <span className="pl-lock__text">
        <small>{t('pool.locksIn')}</small>
        <b className="num">{fmtCountdown(ms)}</b>
      </span>
    </div>
  );
}

function StateBanner({ lp, blockKey, accept }: { lp: LivePool; blockKey: string | null; accept: boolean }) {
  const pool = lp.pool;
  if (accept) return null;
  if (pool.status === 'OPEN' && pool.intake_status === 'SUSPENDED') {
    return (
      <div className="pl-banner pl-banner--red" role="status">
        <FlagGlyph color="#ff3b47" size={20} />
        <div>
          <b>{t('pool.suspended')}</b>
          <span>{t(blockKey ?? 'pool.lockedNow')}</span>
        </div>
      </div>
    );
  }
  if (pool.status === 'LOCKED' || pool.status === 'OPEN') {
    return (
      <div className="pl-banner" role="status">
        <IconLock size={18} />
        <div>
          <b>{t('pl.state.locked')}</b>
          <span>{t('pl.state.lockedSub')}</span>
        </div>
      </div>
    );
  }
  if (pool.status === 'RESOLVING') {
    return (
      <div className="pl-banner pl-banner--cyan" role="status">
        <span className="cf__spin" />
        <div>
          <b>{t('pl.state.resolving')}</b>
          <span>{t('pl.state.resolvingSub')}</span>
        </div>
      </div>
    );
  }
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
        <span className="pl-res__icon">{kind === 'won' ? <IcTrophy size={22} /> : kind === 'pending' ? <IconCheck size={20} /> : kind === 'void' ? <IconInfo size={20} /> : <IconLock size={18} />}</span>
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
                {fmtNumber(e.stake)} · {fmtOdds(fm)}x
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
