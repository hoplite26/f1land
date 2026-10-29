import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLive } from '@/store/live';
import { useNav } from '@/store/nav';
import { usePools, multiplier, type LivePool } from '@/demo/poolEngine';
import { useWallet, type Entry } from '@/store/wallet';
import { getEngine } from '@/app/sessionService';
import { useSceneView } from '@/app/SceneHost';
import { useSessionNow } from '@/app/hooks';
import { outcomeLabel, poolTexts } from '@/app/poolText';
import { canAcceptEntry, entryBlockReason, msUntilLock } from '@/domain/lifecycle';
import { getTemplate } from '@/domain/markets/catalog';
import type { Outcome, Pool } from '@/domain/types';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import { CHANNELS } from '@/demo/channels';
import { fmtClock, fmtCountdown, fmtGap, fmtLap, fmtNumber, fmtSec, getLang, t } from '@/i18n/core';
import { SubHeader } from '@/app/Header';
import { CheckDot, Collapsible, Countdown, DriverAvatar, Help, Sheet, StakeInput, SwipeConfirm, TyreBadge } from '@/ui/kit';
import { SECTOR_COLORS } from '@/ui/TrackMap';
import { IconCheck, IconInfo, IconLock, IconPit, IconTimer } from '@/ui/icons';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import type { LiveCar } from '@/sim/types';

const drafts = new Map<string, { outcome: string | null; stake: number }>();

export function PoolScreen({ poolId }: { poolId: string }) {
  const back = useNav((s) => s.back);
  const push = useNav((s) => s.push);
  const go = useNav((s) => s.go);
  const pools = usePools((s) => s.pools);
  const live = useLive((s) => s.live);
  const runner = useLive((s) => s.runner);
  const setFollow = useLive((s) => s.setFollow);
  const setRival = useLive((s) => s.setRival);
  const setScene = useSceneView((s) => s.set);
  const balance = useWallet((s) => s.balance);
  const entries = useWallet((s) => s.entries);
  const now = useSessionNow();
  const lp = pools.find((p) => p.pool.pool_id === poolId) ?? null;
  const draftKey = lp ? `${lp.pool.pool_id}@${lp.pool.version}` : '';
  const [outcome, setOutcome] = useState<string | null>(() => drafts.get(draftKey)?.outcome ?? null);
  const [stake, setStake] = useState<number>(() => drafts.get(draftKey)?.stake ?? 100);
  const [confirm, setConfirm] = useState<null | { phase: 'checking' | 'ok' | 'rejected'; entry?: Entry; outcome: string; stake: number; mult: number }>(null);

  useEffect(() => {
    if (draftKey) drafts.set(draftKey, { outcome, stake });
  }, [draftKey, outcome, stake]);

  const pool = lp?.pool ?? null;
  const subjectA = pool?.subject.driver_a;
  const subjectB = pool?.subject.driver_b;

  // Scene framing for this pool (F1-050: 240–320 ms framing; frozen during confirmation).
  useEffect(() => {
    setScene({ layout: 'top', labels: [subjectA, subjectB, ...(lp?.focus ?? [])].filter(Boolean) as string[], cameraOverride: pool?.market_id === 'F1-M11' ? 'overview' : 'follow' });
    if (subjectA) setFollow(subjectA);
    setRival(subjectB ?? null);
    return () => {
      setScene({ layout: 'hidden', zone: null, frameZone: false, labels: [], cameraOverride: null, frozen: false });
      setRival(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId]);

  useEffect(() => {
    if (!pool) return;
    let zone: 1 | 2 | 3 | null = null;
    if (pool.market_id === 'F1-M11' && outcome && /^S[123]$/.test(outcome)) zone = Number(outcome[1]) as 1 | 2 | 3;
    if (pool.market_id === 'F1-M19') zone = pool.target.parameters.sector ?? null;
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

  if (!lp || !pool) {
    return (
      <>
        <SubHeader onBack={back} title={t('pool.title')} />
        <div className="empty">
          <IconLock className="empty__icon" />
          {t('pool.noPools')}
        </div>
      </>
    );
  }

  const tx = poolTexts(pool);
  const templ = getTemplate(pool.market_id);
  const myEntries = entries.filter((e) => e.poolId === pool.pool_id);
  const mult = outcome ? multiplier(lp.book, outcome, stake) : null;
  const totalPool = Object.values(lp.book.stakes).reduce((a, b) => a + b, 0);
  const lang = getLang();
  const channel = CHANNELS.find((c) => c.id === useLive.getState().channelId);

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
      drafts.delete(draftKey);
    }, 900);
  };

  return (
    <div className="pool-screen">
      <SubHeader onBack={back} title={tx.title} right={<Countdown ms={msUntilLock(pool, now)} label={t('pool.locksIn')} locked={!accept} lockedLabel={t(`pool.status.${pool.status}`)} />} />
      <div className="pool-screen__scene" aria-hidden="true">
        <div className="pool-screen__scene-tags">
          {live && live.totalLaps && (
            <span className="badge badge--ghost num">
              {t('live.lap')} {live.leaderLap}/{live.totalLaps}
            </span>
          )}
          <span className="dot-live">LIVE</span>
        </div>
      </div>

      <div className="card card--pad pool-q">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h1 className="pool-q__title">{tx.question}</h1>
            {tx.anchor && <div className="pool-q__anchor">{tx.anchor}</div>}
          </div>
          <span className={`badge ${accept ? 'badge--lime' : 'badge--ghost'}`}>{t(`pool.status.${pool.status}`)}</span>
        </div>
        <div className="pool-q__meta">
          <span className="badge badge--cyan">
            {t('pool.determinedBy')}: {tx.determinant}
          </span>
          {pool.intake_status === 'SUSPENDED' && <span className="badge badge--red">{t('pool.suspended')}</span>}
        </div>
        <div className="pool-q__window muted">
          <IconTimer size={14} /> {tx.window}
        </div>
      </div>

      <FamilyVisual lp={lp} live={live?.cars ?? []} outcome={outcome} onOutcome={(id) => accept && setOutcome(id)} />

      <div className="section__head" style={{ marginTop: 16 }}>
        <div>
          <div className="section__kicker">{t('pool.choose')}</div>
        </div>
        <Help text={t('pool.estimateHint')} />
      </div>
      <Outcomes pool={pool} lp={lp} value={outcome} disabled={!accept} onChange={(id) => setOutcome(id)} stake={stake} />

      <div className="card card--pad ticket">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>{t('pool.ticket')}</b>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('pool.prize')} <b className="num lime">{fmtNumber(totalPool)}</b> · {t('pool.participants', { n: fmtNumber(lp.book.players) })}
          </span>
        </div>
        <div className="row" style={{ margin: '10px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 12 }}>{t('confirm.outcome')}</div>
            <div className="ellipsis" style={{ fontWeight: 700 }}>{outcome ? outcomeLabel(pool.outcomes.find((o) => o.id === outcome)!, pool.market_id) : '—'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 12 }}>{t('pool.potential')}</div>
            <div className="num lime" style={{ fontWeight: 700, fontSize: 20 }}>{mult ? `${fmtNumber(Math.round(stake * mult))}` : '—'}</div>
          </div>
        </div>
        <StakeInput value={stake} onChange={setStake} max={Math.max(10, Math.min(5000, balance))} />
      </div>

      {myEntries.length > 0 && (
        <div className="card card--pad" style={{ marginTop: 10 }}>
          <div className="row" style={{ gap: 6 }}>
            <IconCheck size={16} className="icon lime" />
            <b>{t('pool.alreadyIn')}</b>
          </div>
          {myEntries.map((e) => (
            <button key={e.id} className="list-row" style={{ padding: '8px 0', width: '100%', textAlign: 'left' }} onClick={() => push({ name: 'entry', entryId: e.id })}>
              <span style={{ flex: 1 }}>{e.outcomeLabel}</span>
              <span className="num">{e.stake} PULSE</span>
            </button>
          ))}
        </div>
      )}

      <div className="pool-cta">
        <SwipeConfirm
          disabled={!accept || !outcome || balance < stake}
          label={!accept ? t(blockKey ?? 'pool.lockedNow') : !outcome ? t('pool.choose') : balance < stake ? t('pool.insufficient') : t('pool.swipe')}
          sub={outcome && mult ? `${outcomeLabel(pool.outcomes.find((o) => o.id === outcome)!, pool.market_id)} · ${stake} PULSE · ${mult.toFixed(2)}x` : undefined}
          onConfirm={submit}
        />
      </div>

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
          <dd className="num">{fmtClock(Date.parse(pool.settlement_deadline), true)} UTC{fmtOffset()}</dd>
          <dt>{t('pool.versions')}</dt>
          <dd className="num" style={{ fontSize: 11 }}>
            {pool.template_version} · {pool.ruleset_version} · {pool.circuit_layout_version} · {pool.provider_schema_version}
          </dd>
        </dl>
        <p className="muted" style={{ fontSize: 12 }}>{t('pool.dataNote')}</p>
        <p className="muted" style={{ fontSize: 12 }}>
          {templ.family} · {pool.market_id} · {lang.toUpperCase()}
        </p>
      </Collapsible>

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title={t('confirm.title')} label={t('confirm.title')}>
        {confirm && (
          <div className="confirm">
            <dl className="rules__dl">
              <dt>{t('confirm.question')}</dt>
              <dd>{tx.question}</dd>
              <dt>{t('confirm.outcome')}</dt>
              <dd>
                <b>{outcomeLabel(pool.outcomes.find((o) => o.id === confirm.outcome)!, pool.market_id)}</b>
              </dd>
              <dt>{t('confirm.window')}</dt>
              <dd>{tx.window}</dd>
              <dt>{t('confirm.amount')}</dt>
              <dd className="num">{confirm.stake} PULSE · ≈{confirm.mult.toFixed(2)}x</dd>
              <dt>{t('confirm.mode')}</dt>
              <dd>{t('confirm.modeDemo')}</dd>
            </dl>
            <AnimatePresence mode="wait">
              {confirm.phase === 'checking' && (
                <motion.div key="c" className="confirm__state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="loader-ring" /> {t('confirm.checking')}
                </motion.div>
              )}
              {confirm.phase === 'ok' && confirm.entry && (
                <motion.div key="ok" className="confirm__state confirm__state--ok" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                  <span className="confirm__check">
                    <IconCheck size={26} />
                  </span>
                  <div>
                    <b>{t('confirm.confirmed')}</b>
                    <div className="muted num" style={{ fontSize: 12 }}>
                      {t('confirm.entryId')}: {confirm.entry.id}
                    </div>
                  </div>
                </motion.div>
              )}
              {confirm.phase === 'rejected' && (
                <motion.div key="rej" className="confirm__state confirm__state--bad" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <IconLock /> {t('confirm.rejectedLocked')}
                </motion.div>
              )}
            </AnimatePresence>
            {confirm.phase === 'ok' && (
              <div className="grid-2" style={{ marginTop: 12 }}>
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    setConfirm(null);
                    go('live');
                  }}
                >
                  {t('confirm.track')}
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    setConfirm(null);
                    go('pools');
                  }}
                >
                  {t('confirm.toPools')}
                </button>
              </div>
            )}
          </div>
        )}
      </Sheet>
      {void runner}
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
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

function Outcomes({ pool, lp, value, onChange, disabled, stake }: { pool: Pool; lp: LivePool; value: string | null; onChange: (id: string) => void; disabled: boolean; stake: number }) {
  const many = pool.outcomes.length > 8;
  const cols = pool.outcomes.length === 2 ? 2 : pool.outcomes.length === 4 ? 2 : 3;
  const list = useMemo(() => {
    if (!many) return pool.outcomes;
    // Large sets: most backed first, statuses at the end.
    return [...pool.outcomes].sort((a, b) => multiplier(lp.book, a.id) - multiplier(lp.book, b.id));
  }, [pool.outcomes, many, lp.book]);
  return (
    <div className={many ? 'outcomes outcomes--list' : 'outcomes'} style={{ ['--cols' as string]: String(cols) }} role="radiogroup" aria-label={t('pool.choose')}>
      {list.map((o) => (
        <OutcomeCard key={o.id} o={o} pool={pool} m={multiplier(lp.book, o.id, value === o.id ? stake : 0)} checked={value === o.id} disabled={disabled} onClick={() => onChange(o.id)} compact={many} />
      ))}
    </div>
  );
}

function OutcomeCard({ o, pool, m, checked, disabled, onClick, compact }: { o: Outcome; pool: Pool; m: number; checked: boolean; disabled: boolean; onClick: () => void; compact: boolean }) {
  const d = o.driver_id ? DRIVER_BY_ID[o.driver_id] : undefined;
  const sector = pool.market_id === 'F1-M11' && /^S[123]$/.test(o.id) ? Number(o.id[1]) : null;
  return (
    <button
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled}
      className={`outcome ${compact ? 'outcome--row' : ''}`}
      style={sector ? { ['--zone' as string]: SECTOR_COLORS[sector - 1] } : undefined}
      onClick={() => {
        if (disabled) {
          haptic.notify('warning');
          return;
        }
        haptic.impact('light');
        sfx.select();
        onClick();
      }}
    >
      {checked && <CheckDot />}
      {d && <DriverAvatar id={d.id} size={compact ? 28 : 32} />}
      {sector && <span className="outcome__zone" />}
      {pool.market_id === 'F1-M04' && ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].includes(o.id) && <TyreBadge compound={o.id} size={28} />}
      <span className="outcome__label">{outcomeLabel(o, pool.market_id)}</span>
      {d && !compact && <span className="outcome__hint">{TEAM_BY_ID[d.teamId]?.shortName}</span>}
      <span className="outcome__odds">{m.toFixed(2)}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Family visuals                                                      */
/* ------------------------------------------------------------------ */

function FamilyVisual({ lp, live, outcome, onOutcome }: { lp: LivePool; live: LiveCar[]; outcome: string | null; onOutcome: (id: string) => void }) {
  const pool = lp.pool;
  const fam = getTemplate(pool.market_id).family;
  const a = live.find((c) => c.id === pool.subject.driver_a);
  const b = live.find((c) => c.id === pool.subject.driver_b);
  if (pool.market_id === 'F1-M11') return <ZoneVisual lp={lp} car={a} outcome={outcome} onOutcome={onOutcome} />;
  if (fam === 'DUEL' || pool.market_id === 'F1-M02' || pool.market_id === 'F1-M16') return <DuelVisual a={pool.subject.driver_a!} b={pool.subject.driver_b!} ca={a} cb={b} />;
  if (fam === 'PIT' || fam === 'TYRES') return <PitVisual pool={pool} car={a} />;
  if (fam === 'QUALIFYING') return <QualiVisual pool={pool} />;
  if (a) return <DriverStrip car={a} />;
  return null;
}

function DriverStrip({ car }: { car: LiveCar }) {
  const d = DRIVER_BY_ID[car.id]!;
  return (
    <div className="card card--pad row" style={{ marginTop: 10 }}>
      <DriverAvatar id={car.id} size={46} ring />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>
          {d.firstName} {d.lastName}
        </b>
        <div className="muted" style={{ fontSize: 12 }}>
          #{d.number} · {TEAM_BY_ID[d.teamId]!.shortName} · P{car.position}
        </div>
      </div>
      <div className="num" style={{ textAlign: 'right' }}>
        <div>{fmtLap(car.lastLapMs)}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          {t('live.bestLap')} {fmtLap(car.bestLapMs)}
        </div>
      </div>
    </div>
  );
}

function ZoneVisual({ lp, car, outcome, onOutcome }: { lp: LivePool; car?: LiveCar; outcome: string | null; onOutcome: (id: string) => void }) {
  const runner = useLive((s) => s.runner);
  const setFollow = useLive((s) => s.setFollow);
  const [pick, setPick] = useState(false);
  const live = useLive((s) => s.live);
  const c = runner?.circuit;
  if (!car) return null;
  const d = DRIVER_BY_ID[car.id]!;
  return (
    <>
      <div className="card card--pad row" style={{ marginTop: 10 }}>
        <DriverAvatar id={car.id} size={46} ring />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>
            {d.firstName} {d.lastName}
          </b>
          <div className="muted" style={{ fontSize: 12 }}>
            #{d.number} · {TEAM_BY_ID[d.teamId]!.shortName} · P{car.position} · {t(`occ.${car.occupancy}`)} {car.occupancy === 'ON_TRACK' ? `S${car.sector}` : ''}
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => setPick(true)}>
          {t('live.follow')}
        </button>
      </div>
      <div className="zones">
        {([1, 2, 3] as const).map((s) => {
          const id = `S${s}`;
          const sec = c?.sectors[s - 1];
          const len = sec && c ? ((sec.endS - sec.startS + c.centerlineLengthM) % c.centerlineLengthM) / 1000 : 0;
          return (
            <button key={s} className={`zone-card ${outcome === id ? 'zone-card--on' : ''}`} style={{ ['--zone' as string]: SECTOR_COLORS[s - 1] }} onClick={() => onOutcome(id)} aria-pressed={outcome === id}>
              <span className="zone-card__name">
                {t('f1.outcome.sector', { sector: s })}
              </span>
              <span className="muted num" style={{ fontSize: 11 }}>{len.toFixed(1)} km</span>
              <span className="zone-card__odds num">{multiplier(lp.book, id).toFixed(2)}x</span>
            </button>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 2px 0' }}>{t('pool.zoneHint')}</p>
      <Sheet open={pick} onClose={() => setPick(false)} title={t('live.pickDriver')} label={t('live.pickDriver')}>
        <div className="driver-grid">
          {(live?.cars ?? []).map((x) => (
            <button
              key={x.id}
              className="driver-pick"
              onClick={() => {
                setFollow(x.id);
                setPick(false);
              }}
            >
              <span className="num muted">{x.position}</span>
              <DriverAvatar id={x.id} size={30} />
              <b>{DRIVER_BY_ID[x.id]?.code}</b>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

/** Two stable A/B blocks — order never follows the race (F1-039). */
function DuelVisual({ a, b, ca, cb }: { a: string; b: string; ca?: LiveCar; cb?: LiveCar }) {
  const gap = ca && cb && ca.gapMs !== null && cb.gapMs !== null ? ca.gapMs - cb.gapMs : null;
  return (
    <div className="duel">
      {[
        { id: a, c: ca, tag: 'A', color: 'var(--lime)' },
        { id: b, c: cb, tag: 'B', color: 'var(--cyan)' },
      ].map(({ id, c, tag, color }) => {
        const d = DRIVER_BY_ID[id]!;
        const team = TEAM_BY_ID[d.teamId]!;
        return (
          <div key={id} className="duel__card card" style={{ ['--team' as string]: team.color, ['--tag' as string]: color }}>
            <span className="duel__tag">{tag}</span>
            <span className="duel__num num" style={{ color: team.color }}>
              {d.number}
            </span>
            <DriverAvatar id={id} size={54} ring />
            <div className="duel__first">{d.firstName}</div>
            <div className="duel__last">{d.lastName}</div>
            <div className="duel__team">{team.shortName}</div>
            <div className="duel__pos num">{c ? `P${c.position}` : '—'}</div>
            {c?.boost && <span className="badge badge--cyan" title="Overtake Mode">OVERTAKE MODE</span>}
          </div>
        );
      })}
      <div className="duel__gap">
        <span className="muted" style={{ fontSize: 10, letterSpacing: '.14em' }}>
          {t('live.gap').toUpperCase()}
        </span>
        <span className="num" style={{ fontWeight: 700, fontSize: 17 }}>
          {gap !== null ? fmtGap(Math.abs(gap)) : '—'}
        </span>
      </div>
    </div>
  );
}

/** Pit infographic: entry → service → exit (F1-040). */
function PitVisual({ pool, car }: { pool: Pool; car?: LiveCar }) {
  const m = pool.market_id;
  const serviceOnly = m === 'F1-M05';
  const whole = m === 'F1-M06';
  return (
    <div className="card card--pad pit">
      {car && (
        <div className="row" style={{ marginBottom: 12 }}>
          <DriverAvatar id={car.id} size={40} ring />
          <div style={{ flex: 1 }}>
            <b>{DRIVER_BY_ID[car.id]?.lastName}</b>
            <div className="muted" style={{ fontSize: 12 }}>
              P{car.position} · {t('live.stops')}: {car.pitStops}
            </div>
          </div>
          <TyreBadge compound={car.tyre} size={30} />
          <div className="num muted" style={{ fontSize: 12, marginLeft: 6 }}>
            {car.tyreAgeLaps} {t('live.lapsShort')}
          </div>
        </div>
      )}
      <div className="pit__flow">
        {[
          { k: 'in', label: 'PIT IN', on: whole },
          { k: 'svc', label: t('f1.pit.stationary').split(' ')[0]!.toUpperCase(), on: serviceOnly || whole },
          { k: 'out', label: 'PIT OUT', on: whole },
        ].map((s, i) => (
          <div key={s.k} className={`pit__step ${s.on ? 'pit__step--on' : ''}`}>
            <span className="pit__dot">{s.k === 'svc' ? <IconPit size={16} /> : i === 0 ? '↘' : '↗'}</span>
            <span className="pit__label">{s.label}</span>
          </div>
        ))}
        <div className={`pit__line ${whole ? 'pit__line--on' : ''}`} />
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {serviceOnly ? t('f1.pit.stationary') : whole ? t('f1.pit.lane') : t(`f1.market.${m.slice(3).toLowerCase().replace('m', 'm')}.title`)}
        {pool.target.parameters.t1_ms !== undefined && (
          <>
            {' '}
            · {fmtSec(pool.target.parameters.t1_ms, 1)} / {fmtSec(pool.target.parameters.t2_ms ?? 0, 1)} s
          </>
        )}
      </div>
    </div>
  );
}

function QualiVisual({ pool }: { pool: Pool }) {
  const live = useLive((s) => s.live);
  const seg = live?.segment;
  if (!live || !seg) return null;
  const subject = pool.subject.driver_a;
  const around = live.cars.filter((c) => !c.eliminatedIn).slice(Math.max(0, seg.cutPosition - 4), seg.cutPosition + 3);
  return (
    <div className="card card--pad">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="badge badge--lime">{seg.id}</span>
        <span className="num" style={{ fontWeight: 700, fontSize: 22 }}>{fmtCountdown(seg.remainingMs)}</span>
      </div>
      <div className="quali-list">
        {around.map((c) => (
          <div key={c.id} className={`quali-row ${c.id === subject ? 'quali-row--on' : ''}`}>
            <span className="num">{c.position}</span>
            <span>{DRIVER_BY_ID[c.id]?.code}</span>
            <span className="num">{fmtLap(c.segmentBestMs ?? null)}</span>
            {c.position === seg.cutPosition && seg.cutPosition < live.cars.filter((x) => !x.eliminatedIn).length && <span className="quali-cut">{t('live.cut')}</span>}
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {t('f1.quali.provisional')} · {t('f1.quali.confirmed')} — {t('pool.determinedBy').toLowerCase()} {t('f1.determinant.official_classification').toLowerCase()}
      </div>
    </div>
  );
}
