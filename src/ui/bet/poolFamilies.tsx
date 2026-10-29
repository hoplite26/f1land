/* Pool screen layouts per market family (workstream D): context visual + outcome grid. */
import { useMemo, useState, type ReactNode } from 'react';
import { useLive } from '@/store/live';
import { multiplier, type LivePool } from '@/demo/poolEngine';
import type { Outcome, Pool } from '@/domain/types';
import type { LiveCar, Moment } from '@/sim/types';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import { fmtCountdown, fmtGap, fmtLap, fmtNumber, fmtSec, t } from '@/i18n/core';
import { comboParts, driverCode, outcomeLabel, outcomeShort, type PoolLayout } from '@/app/poolText';
import { DriverAvatar, Sparkline, TyreBadge } from '@/ui/kit';
import { SECTOR_COLORS } from '@/ui/TrackMap';
import { IconPit } from '@/ui/icons';
import { OutcomeTile, type TileVariant } from './parts';
import { MomentIcon, momentText } from './livePanels';
import { FlagGlyph, IcArrowDown, IcArrowUp, IcEqual, IcLink, IcNo, IcPass, IcPodium, IcRetire, IcStopwatch, IcSwapCar, IcYes, RcBadge, TyreRing } from './icons';

const teamOf = (id?: string) => (id ? TEAM_BY_ID[DRIVER_BY_ID[id]?.teamId ?? ''] : undefined);
const teamColor = (id?: string) => teamOf(id)?.color ?? '#888';

/* ------------------------------------------------------------------ */
/* Outcome specs                                                       */
/* ------------------------------------------------------------------ */

interface TileSpec {
  o: Outcome;
  variant: TileVariant;
  label: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  color?: string;
  /** Secondary outcomes (statuses, “no event”) render in a compact list. */
  minor?: boolean;
}

const MINOR_IDS = new Set(['RETIRED', 'DNS', 'DSQ', 'NOT_CLASSIFIED', 'BOTH_INACTIVE', 'NO_VALID_LAP', 'NO_VALID_SECTOR', 'NEITHER_VALID', 'OTHER_CONFIRMED', 'NO_EXIT', 'NO_SERVICE', 'NO_VISIT', 'TIE', 'SIMULTANEOUS']);

const BUCKET_HINT: Record<string, string> = { BUCKET_1: 'pl.bucket.low', BUCKET_2: 'pl.bucket.mid', BUCKET_3: 'pl.bucket.high' };

/** Icon used for an outcome everywhere (tiles, ticket, confirmation). */
export function outcomeIcon(o: Outcome, pool: Pick<Pool, 'market_id' | 'subject'>, size = 26): ReactNode {
  const id = o.id;
  if (o.driver_id) return <DriverAvatar id={o.driver_id} size={size + 4} />;
  if (/^S[123]$/.test(id)) return <span className="zone-dot" style={{ background: SECTOR_COLORS[Number(id[1]) - 1] }} />;
  if (id === 'PIT') return <IconPit size={size - 4} className="icon" />;
  if (['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].includes(id)) return <TyreRing compound={id} size={size + 10} />;
  if (id.startsWith('BUCKET_')) return <IcStopwatch size={size - 2} />;
  switch (id) {
    case 'SC':
      return <RcBadge text="SC" size={size - 4} />;
    case 'VSC':
      return <RcBadge text="VSC" size={size - 4} />;
    case 'RED':
      return <FlagGlyph color="#ff3b47" size={size} />;
    case 'NONE':
      return pool.market_id === 'F1-M12' ? <IcYes size={size - 4} /> : <FlagGlyph color="#3ddc84" size={size} />;
    case 'FASTER':
      return <IcArrowUp size={size - 4} />;
    case 'SLOWER':
      return <IcArrowDown size={size - 4} />;
    case 'EQUAL':
      return <IcEqual size={size - 4} />;
    case 'NO_PASS':
      return <IcNo size={size - 4} />;
    case 'YES':
      return pool.market_id === 'F1-M14' ? <IcPodium size={size - 2} /> : pool.market_id === 'F1-M20' ? <IcSwapCar size={size - 4} /> : <IcYes size={size - 4} />;
    case 'NO':
      return <IcNo size={size - 4} />;
    case 'BOTH_TRUE':
      return <IcLink size={size - 4} />;
    case 'NOT_BOTH':
      return <IcNo size={size - 4} />;
    case 'RETIRED':
      return <IcRetire size={size - 6} />;
    default:
      return null;
  }
}

function specsFor(pool: Pool, layout: PoolLayout, circuitKm: number[]): TileSpec[] {
  const m = pool.market_id;
  const a = pool.subject.driver_a;
  const b = pool.subject.driver_b;
  return pool.outcomes.map((o): TileSpec => {
    const id = o.id;
    const minor = MINOR_IDS.has(id) || (m === 'F1-M03' && id === 'NO_ENTRY');
    const base: TileSpec = { o, variant: minor ? 'row' : 'tile', label: outcomeShort(o, pool), icon: outcomeIcon(o, pool), minor };
    if (minor) return { ...base, label: outcomeLabel(o, m) };
    if (layout === 'zone') {
      if (/^S[123]$/.test(id)) {
        const s = Number(id[1]);
        return { ...base, variant: 'zone', label: t('f1.outcome.sector', { sector: s }), sub: circuitKm[s - 1] ? `${circuitKm[s - 1]!.toFixed(1)} km` : undefined, color: SECTOR_COLORS[s - 1], icon: undefined };
      }
      return { ...base, variant: 'zone', label: t('pl.pitLane'), sub: t('pl.pitSub'), color: 'var(--cyan)', icon: undefined };
    }
    if (o.driver_id && (m === 'F1-M03' || m === 'F1-M09' || m === 'F1-M12' || m === 'F1-M17')) {
      return { ...base, variant: 'driver', label: driverCode(o.driver_id), sub: teamOf(o.driver_id)?.shortName, color: teamColor(o.driver_id) };
    }
    if (id === 'A_PASSES_B' || id === 'B_PASSES_A') {
      const passer = id === 'A_PASSES_B' ? a : b;
      return { ...base, icon: <IcPass size={22} />, color: teamColor(passer), sub: t('pl.sub.passes') };
    }
    if (m === 'F1-M02' && (id === 'A' || id === 'B')) return { ...base, sub: t('pl.sub.ahead'), color: teamColor(o.driver_id) };
    if (m === 'F1-M16' && (id === 'A' || id === 'B')) return { ...base, sub: t('pl.sub.faster'), color: teamColor(o.driver_id) };
    if (id === 'NO_PASS') return { ...base, sub: t('pl.sub.noPass') };
    if (id.startsWith('BUCKET_')) return { ...base, sub: t(BUCKET_HINT[id]!) };
    if (['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].includes(id)) return { ...base, sub: undefined };
    if (m === 'F1-M08' && ['FASTER', 'EQUAL', 'SLOWER'].includes(id)) return { ...base, sub: t('pl.sub.vsRef') };
    if (m === 'F1-M10') return { ...base, label: id === 'NONE' ? t('pl.short.none') : id === 'RED' ? t('pl.short.red') : id === 'SC' ? 'Safety Car' : 'Virtual SC', sub: id === 'NONE' ? t('pl.sub.noNeutral') : t('pl.sub.nextOnTrack') };
    if (m === 'F1-M12' && id === 'NONE') return { ...base, variant: 'wide', label: outcomeLabel(o, m), sub: t('pl.sub.window') };
    if (m === 'F1-M01' && /^P\d+$/.test(id)) return { ...base, variant: 'num', icon: undefined };
    if ((m === 'F1-M13' || m === 'F1-M18') && !minor) return { ...base, sub: t(`pl.group.${id.toLowerCase()}`), icon: <span className="grp-ico num">{id === 'P1' ? '1' : id.replace('P', '').replace('_PLUS', '+').replace('_', '–')}</span> };
    if (id === 'YES' || id === 'NO') {
      const subKey = m === 'F1-M14' ? (id === 'YES' ? 'pl.sub.podiumYes' : 'pl.sub.podiumNo') : m === 'F1-M15' ? (id === 'YES' ? 'pl.sub.progressYes' : 'pl.sub.progressNo') : m === 'F1-M20' ? (id === 'YES' ? 'pl.sub.changeYes' : 'pl.sub.changeNo') : undefined;
      return { ...base, sub: subKey ? t(subKey) : undefined };
    }
    if (id === 'BOTH_TRUE' || id === 'NOT_BOTH') return { ...base, sub: id === 'BOTH_TRUE' ? t('pl.sub.bothTrue') : t('pl.sub.notBoth') };
    return base;
  });
}

/* ------------------------------------------------------------------ */
/* Outcome grid                                                        */
/* ------------------------------------------------------------------ */

export function OutcomeGrid({
  lp,
  layout,
  value,
  onChange,
  disabled,
  stake,
  myPicks,
}: {
  lp: LivePool;
  layout: PoolLayout;
  value: string | null;
  onChange: (id: string) => void;
  disabled: boolean;
  stake: number;
  myPicks: Set<string>;
}) {
  const pool = lp.pool;
  const runner = useLive((s) => s.runner);
  const live = useLive((s) => s.live);
  const [showAll, setShowAll] = useState(false);
  const km = useMemo(() => {
    const c = runner?.circuit;
    if (!c) return [];
    return c.sectors.map((s) => (((s.endS - s.startS + c.centerlineLengthM) % c.centerlineLengthM) || c.centerlineLengthM) / 1000);
  }, [runner]);
  const specs = specsFor(pool, layout, km);
  const locked = pool.status !== 'OPEN';
  const winner = pool.status === 'SETTLED' ? pool.settlement?.winner_outcome_id ?? null : null;
  const oddsOf = (id: string) => (locked && lp.book.finalMultipliers?.[id] ? lp.book.finalMultipliers[id]! : multiplier(lp.book, id, value === id ? stake : 0));
  const tile = (s: TileSpec) => (
    <OutcomeTile
      key={s.o.id}
      variant={s.variant}
      label={s.label}
      sub={s.sub}
      icon={s.icon}
      color={s.color}
      odds={oddsOf(s.o.id)}
      checked={value === s.o.id}
      disabled={disabled}
      mine={myPicks.has(s.o.id)}
      result={winner ? (winner === s.o.id ? 'win' : 'lose') : null}
      ariaLabel={`${outcomeLabel(s.o, pool.market_id)} · ${oddsOf(s.o.id).toFixed(2)}x`}
      onSelect={() => onChange(s.o.id)}
    />
  );

  const major = specs.filter((s) => !s.minor);
  const minor = specs.filter((s) => s.minor);
  const drivers = major.filter((s) => s.variant === 'driver');
  const others = major.filter((s) => s.variant !== 'driver');

  // Driver lists: focus drivers first, then the crowd favourites; collapsed after 9.
  let driverList = drivers;
  if (drivers.length) {
    const focus = new Set(lp.focus);
    const posOf = (id?: string) => live?.cars.find((c) => c.id === id)?.position ?? 99;
    driverList = [...drivers].sort((x, y) => Number(focus.has(y.o.driver_id!)) - Number(focus.has(x.o.driver_id!)) || oddsOf(x.o.id) - oddsOf(y.o.id) || posOf(x.o.driver_id) - posOf(y.o.driver_id));
    if (value && !showAll) {
      const i = driverList.findIndex((s) => s.o.id === value);
      if (i >= 9) driverList = [driverList[i]!, ...driverList.filter((_, k) => k !== i)];
    }
  }
  const visibleDrivers = showAll ? driverList : driverList.slice(0, 9);
  const nums = others.filter((s) => s.variant === 'num');
  const wide = others.filter((s) => s.variant === 'wide');
  const rest = others.filter((s) => s.variant !== 'num' && s.variant !== 'wide');
  const cols = layout === 'zone' ? rest.length : rest.length === 4 ? 2 : rest.length === 2 ? 2 : 3;

  return (
    <div className="og" role="radiogroup" aria-label={t('pool.choose')}>
      {wide.length > 0 && <div className="og__wide">{wide.map(tile)}</div>}
      {rest.length > 0 && (
        <div className={`og__grid og__grid--${layout}`} style={{ ['--cols' as string]: String(cols) }}>
          {rest.map(tile)}
        </div>
      )}
      {nums.length > 0 && (
        <div className="og__nums">
          {[...nums].sort((x, y) => Number(x.o.id.slice(1)) - Number(y.o.id.slice(1))).map(tile)}
        </div>
      )}
      {visibleDrivers.length > 0 && (
        <>
          <div className="og__drivers">{visibleDrivers.map(tile)}</div>
          {driverList.length > 9 && (
            <button type="button" className="og__more" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
              {showAll ? t('ui.collapse') : t('pl.showAll', { n: driverList.length })}
            </button>
          )}
        </>
      )}
      {minor.length > 0 && (
        <>
          <div className="og__minor-k">{t('pl.otherOutcomes')}</div>
          <div className="og__minor">{minor.map(tile)}</div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Visuals                                                             */
/* ------------------------------------------------------------------ */

export function FamilyVisual({ lp, layout }: { lp: LivePool; layout: PoolLayout }) {
  const live = useLive((s) => s.live);
  const pool = lp.pool;
  const cars = live?.cars ?? [];
  const a = cars.find((c) => c.id === pool.subject.driver_a);
  const b = cars.find((c) => c.id === pool.subject.driver_b);
  switch (layout) {
    case 'zone':
      return a ? <ZoneVisual car={a} /> : null;
    case 'duel':
      return pool.subject.driver_a && pool.subject.driver_b ? <DuelVisual a={pool.subject.driver_a} b={pool.subject.driver_b} ca={a} cb={b} quali={pool.market_id === 'F1-M16'} /> : null;
    case 'pit':
      return <PitVisual pool={pool} car={a} focus={lp.focus} cars={cars} />;
    case 'tyre':
      return a ? <TyreVisual car={a} totalLaps={live?.totalLaps ?? null} /> : null;
    case 'pace':
      return <PaceVisual pool={pool} car={a} />;
    case 'incident':
      return <IncidentVisual />;
    case 'position':
      return a ? <PositionVisual pool={pool} car={a} cars={cars} /> : null;
    case 'quali':
      return <QualiVisual pool={pool} />;
    case 'combo':
      return <ComboVisual pool={pool} cars={cars} />;
    default:
      return null;
  }
}

function DriverCard({ car, right, sub }: { car: LiveCar; right?: ReactNode; sub?: ReactNode }) {
  const d = DRIVER_BY_ID[car.id]!;
  const team = TEAM_BY_ID[d.teamId]!;
  return (
    <div className="pv-driver" style={{ ['--team' as string]: team.color }}>
      <DriverAvatar id={car.id} size={46} ring />
      <div className="pv-driver__who">
        <div className="pv-driver__name">
          <span className="pv-driver__num num">#{d.number}</span>
          <b className="ellipsis">
            {d.firstName} {d.lastName}
          </b>
        </div>
        <div className="pv-driver__sub ellipsis">{sub ?? `${team.shortName} · P${car.position}`}</div>
      </div>
      {right}
    </div>
  );
}

function ZoneVisual({ car }: { car: LiveCar }) {
  const runner = useLive((s) => s.runner);
  const c = runner?.circuit;
  const bounds = useMemo(() => {
    if (!c) return [1 / 3, 2 / 3];
    const L = c.centerlineLengthM;
    const s1 = c.sectors[0];
    const s2 = c.sectors[1];
    return [(((s1.endS - s1.startS) + L) % L) / L, (((s2.endS - s1.startS) + L) % L) / L];
  }, [c]);
  const where = car.occupancy !== 'ON_TRACK' ? t(`occ.${car.occupancy}`) : t('f1.outcome.sector', { sector: car.sector });
  return (
    <div className="pv">
      <DriverCard
        car={car}
        right={
          <div className="pv-now">
            <span className="pv-now__k">{t('pl.now')}</span>
            <span className="pv-now__v" style={{ color: car.occupancy === 'ON_TRACK' ? SECTOR_COLORS[car.sector - 1] : 'var(--cyan)' }}>
              {where}
            </span>
          </div>
        }
      />
      <div className="lapbar" aria-hidden="true">
        <span className="lapbar__seg" style={{ left: 0, width: `${bounds[0]! * 100}%`, background: SECTOR_COLORS[0] }} />
        <span className="lapbar__seg" style={{ left: `${bounds[0]! * 100}%`, width: `${(bounds[1]! - bounds[0]!) * 100}%`, background: SECTOR_COLORS[1] }} />
        <span className="lapbar__seg" style={{ left: `${bounds[1]! * 100}%`, right: 0, background: SECTOR_COLORS[2] }} />
        {car.occupancy === 'ON_TRACK' && <span className="lapbar__car" style={{ left: `${Math.max(0, Math.min(1, car.lapFraction)) * 100}%`, ['--team' as string]: teamColor(car.id) }} />}
        <span className="lapbar__k" style={{ left: `${(bounds[0]! / 2) * 100}%` }}>S1</span>
        <span className="lapbar__k" style={{ left: `${((bounds[0]! + bounds[1]!) / 2) * 100}%` }}>S2</span>
        <span className="lapbar__k" style={{ left: `${((bounds[1]! + 1) / 2) * 100}%` }}>S3</span>
      </div>
      <p className="pv-hint">{t('pool.zoneHint')}</p>
    </div>
  );
}

/** Two stable A/B blocks — order never follows the race (F1-039). */
function DuelVisual({ a, b, ca, cb, quali }: { a: string; b: string; ca?: LiveCar; cb?: LiveCar; quali: boolean }) {
  const gap = ca && cb && ca.gapMs !== null && cb.gapMs !== null ? ca.gapMs - cb.gapMs : null;
  const ahead = gap === null ? null : gap < 0 ? 'A' : 'B';
  return (
    <div className="duel2">
      {[
        { id: a, c: ca, tag: 'A' },
        { id: b, c: cb, tag: 'B' },
      ].map(({ id, c, tag }) => {
        const d = DRIVER_BY_ID[id]!;
        const team = TEAM_BY_ID[d.teamId]!;
        return (
          <div key={id} className={`duel2__card duel2__card--${tag.toLowerCase()}`} style={{ ['--team' as string]: team.color }}>
            <span className="duel2__tag">{tag}</span>
            <span className="duel2__num num">{d.number}</span>
            <DriverAvatar id={id} size={50} ring />
            <div className="duel2__first">{d.firstName}</div>
            <div className="duel2__last">{d.lastName}</div>
            <div className="duel2__team">{team.shortName}</div>
            <div className="duel2__meta">
              <span className="num duel2__pos">{c ? `P${c.position}` : '—'}</span>
              {c && !quali && <TyreBadge compound={c.tyre} size={18} />}
              {c?.boost && <span className="duel2__boost">OVERTAKE</span>}
            </div>
          </div>
        );
      })}
      <div className="duel2__gap">
        <span className="duel2__gap-k">{quali ? t('live.bestLap') : t('live.gap')}</span>
        <span className="num duel2__gap-v">{quali ? (ca?.segmentBestMs && cb?.segmentBestMs ? fmtGap(ca.segmentBestMs - cb.segmentBestMs) : '—') : gap !== null ? fmtGap(Math.abs(gap)) : '—'}</span>
        {ahead && !quali && <span className="duel2__gap-who">{driverCode(ahead === 'A' ? a : b)} ▲</span>}
      </div>
    </div>
  );
}

function PitLane({ mode }: { mode: 'entry' | 'service' | 'lane' }) {
  const on = (k: 'in' | 'box' | 'out') => mode === 'lane' || (mode === 'service' && k === 'box') || (mode === 'entry' && k === 'in');
  return (
    <div className={`pitlane pitlane--${mode}`} aria-hidden="true">
      <div className="pitlane__road">
        <span className={`pitlane__line ${mode === 'lane' ? 'pitlane__line--on' : ''}`} />
        {(['in', 'box', 'out'] as const).map((k) => (
          <span key={k} className={`pitlane__node pitlane__node--${k} ${on(k) ? 'pitlane__node--on' : ''}`}>
            <span className="pitlane__dot">{k === 'box' ? <IconPit size={15} className="icon" /> : k === 'in' ? '↘' : '↗'}</span>
            <span className="pitlane__label">{k === 'in' ? 'PIT IN' : k === 'out' ? 'PIT OUT' : t('pl.pitBox')}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PitVisual({ pool, car, focus, cars }: { pool: Pool; car?: LiveCar; focus: string[]; cars: LiveCar[] }) {
  const m = pool.market_id;
  const p = pool.target.parameters;
  if (m === 'F1-M03') {
    const cands = focus.map((id) => cars.find((c) => c.id === id)).filter(Boolean) as LiveCar[];
    return (
      <div className="pv">
        <PitLane mode="entry" />
        {cands.length > 0 && (
          <div className="pv-cands">
            <div className="pv-k">{t('pl.pitCandidates')}</div>
            {cands.map((c) => (
              <div key={c.id} className="pv-cand">
                <span className="pv-cand__bar" style={{ background: teamColor(c.id) }} />
                <b>{driverCode(c.id)}</b>
                <TyreBadge compound={c.tyre} size={18} />
                <span className="num pv-cand__age">
                  {c.tyreAgeLaps} {t('live.lapsShort')}
                </span>
                <span className="wear" title={t('pl.wear')}>
                  <span style={{ width: `${Math.round(Math.min(1, c.tyreWear) * 100)}%` }} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="pv">
      {car && (
        <DriverCard
          car={car}
          right={
            <div className="pv-tyre">
              <TyreRing compound={car.tyre} size={38} />
              <span className="num">
                {car.tyreAgeLaps} {t('live.lapsShort')}
              </span>
            </div>
          }
          sub={`${teamOf(car.id)?.shortName} · P${car.position} · ${t('live.stops')}: ${car.pitStops}`}
        />
      )}
      <PitLane mode={m === 'F1-M05' ? 'service' : 'lane'} />
      {p.t1_ms !== undefined && p.t2_ms !== undefined && (
        <div className="pv-band">
          <IcStopwatch size={16} />
          <span>{m === 'F1-M05' ? t('f1.pit.stationary') : t('f1.pit.lane')}</span>
          <b className="num">
            {fmtSec(p.t1_ms, 1)} – {fmtSec(p.t2_ms, 1)} {t('pl.unit.s')}
          </b>
        </div>
      )}
    </div>
  );
}

function TyreVisual({ car, totalLaps }: { car: LiveCar; totalLaps: number | null }) {
  const total = Math.max(totalLaps ?? 0, car.driverLaps + 1, ...car.stints.map((s) => s.toLap ?? car.driverLaps + 1));
  return (
    <div className="pv">
      <DriverCard
        car={car}
        right={
          <div className="pv-tyre">
            <TyreRing compound={car.tyre} size={38} />
            <span className="num">
              {car.tyreAgeLaps} {t('live.lapsShort')}
            </span>
          </div>
        }
      />
      <div className="stint">
        <div className="stint__k">
          <span>{t('pl.strategy')}</span>
          <span className="num muted">
            {t('live.lap')} {car.driverLaps + 1}
            {totalLaps ? `/${totalLaps}` : ''}
          </span>
        </div>
        <div className="stint__bar">
          {car.stints.map((s, i) => {
            const from = Math.max(0, s.fromLap - 1);
            const to = s.toLap ?? car.driverLaps + 1;
            return (
              <span key={i} className={`stint__seg stint__seg--${s.compound[0]} ${s.toLap === null ? 'stint__seg--now' : ''}`} style={{ left: `${(from / total) * 100}%`, width: `${(Math.max(0.6, to - from) / total) * 100}%` }}>
                <span className="stint__l">{s.compound[0]}</span>
              </span>
            );
          })}
          <span className="stint__now" style={{ left: `${((car.driverLaps + 1) / total) * 100}%` }} />
        </div>
        <div className="stint__wear">
          <span>{t('pl.wear')}</span>
          <span className="wear wear--lg">
            <span style={{ width: `${Math.round(Math.min(1, car.tyreWear) * 100)}%` }} />
          </span>
          <b className="num">{Math.round(Math.min(1, car.tyreWear) * 100)}%</b>
        </div>
      </div>
    </div>
  );
}

function useLapHistory(id?: string): number[] {
  const runner = useLive((s) => s.runner);
  const rev = useLive((s) => s.eventRev);
  return useMemo(() => {
    if (!runner || !id) return [];
    const out: number[] = [];
    for (const e of runner.events) {
      if (e.type === 'LAP_COMPLETED' && e.payload.driver_id === id && !e.payload.pit_in_lap && !e.payload.pit_out_lap && !e.payload.neutralised) out.push(e.payload.lap_time_ms / 1000);
    }
    return out.slice(-12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, id, Math.floor(rev / 20)]);
}

function PaceVisual({ pool, car }: { pool: Pool; car?: LiveCar }) {
  const live = useLive((s) => s.live);
  const laps = useLapHistory(car?.id);
  const m = pool.market_id;
  const p = pool.target.parameters;
  const fl = live?.fastestLap ?? null;
  const top = useMemo(() => [...(live?.cars ?? [])].filter((c) => c.bestLapMs).sort((x, y) => x.bestLapMs! - y.bestLapMs!).slice(0, 4), [live]);
  return (
    <div className="pv">
      <div className="pace">
        <div className="pace__cell">
          <span className="pace__k">
            <IcStopwatch size={14} /> {t('pl.fastestSoFar')}
          </span>
          <b className="num pace__v purple">{fmtLap(fl?.ms ?? null)}</b>
          <span className="pace__sub">{fl ? `${DRIVER_BY_ID[fl.driverId]?.lastName ?? ''} · ${t('live.lap')} ${fl.lap}` : '—'}</span>
        </div>
        {m === 'F1-M08' && p.reference_time_ms !== undefined && (
          <div className="pace__cell">
            <span className="pace__k">{t('pl.reference')}</span>
            <b className="num pace__v">{fmtLap(p.reference_time_ms)}</b>
            <span className="pace__sub">{car ? `${t('live.lastLap')} ${fmtLap(car.lastLapMs)}` : ''}</span>
          </div>
        )}
        {m === 'F1-M19' && p.sector && (
          <div className="pace__cell">
            <span className="pace__k">
              <span className="zone-dot zone-dot--sm" style={{ background: SECTOR_COLORS[p.sector - 1] }} /> {t('f1.outcome.sector', { sector: p.sector })}
            </span>
            <b className="num pace__v" style={{ color: SECTOR_COLORS[p.sector - 1] }}>
              {fmtSec(p.t1_ms ?? null, 2)}–{fmtSec(p.t2_ms ?? null, 2)}
            </b>
            <span className="pace__sub">{t('pl.band')}</span>
          </div>
        )}
        {laps.length > 1 && (
          <div className="pace__spark">
            <Sparkline values={laps} color="var(--cyan)" width={96} height={34} />
            <span className="pace__sub">{car ? driverCode(car.id) : ''}</span>
          </div>
        )}
      </div>
      {m === 'F1-M19' && car && (
        <div className="sectors3">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`sectors3__c ${p.sector === s ? 'sectors3__c--on' : ''}`} style={{ ['--zc' as string]: SECTOR_COLORS[s - 1] }}>
              <span className="sectors3__k">S{s}</span>
              <b className="num">{fmtSec(car.sectorTimes[s - 1] ?? null)}</b>
              {car.sectorBest[s - 1] && <span className="sectors3__pb">PB</span>}
            </div>
          ))}
        </div>
      )}
      {m === 'F1-M09' && top.length > 0 && (
        <div className="pv-cands">
          <div className="pv-k">{t('pl.bestLaps')}</div>
          {top.map((c, i) => (
            <div key={c.id} className="pv-cand">
              <span className="num muted">{i + 1}</span>
              <span className="pv-cand__bar" style={{ background: teamColor(c.id) }} />
              <b>{driverCode(c.id)}</b>
              <span className={`num pv-cand__age ${i === 0 ? 'purple' : ''}`}>{fmtLap(c.bestLapMs)}</span>
            </div>
          ))}
        </div>
      )}
      {car && m !== 'F1-M09' && <DriverCard car={car} sub={`${teamOf(car.id)?.shortName} · P${car.position} · ${t('live.bestLap')} ${fmtLap(car.bestLapMs)}`} />}
    </div>
  );
}

const RC_KINDS = new Set<Moment['kind']>(['SC', 'VSC', 'RED', 'GREEN', 'RETIREMENT', 'TRACK_LIMITS', 'START']);

function IncidentVisual() {
  const live = useLive((s) => s.live);
  if (!live) return null;
  const items = [...live.moments].filter((m) => RC_KINDS.has(m.kind)).slice(-4).reverse();
  const left = live.totalLaps ? Math.max(0, live.totalLaps - live.leaderLap) : null;
  return (
    <div className="pv inc">
      <div className="inc__state">
        <div className={`inc__badge inc__badge--${live.trackState.toLowerCase()}`}>
          {live.trackState === 'RED' ? <FlagGlyph color="#ff3b47" size={18} /> : live.trackState.startsWith('SC') ? <RcBadge text="SC" size={16} /> : live.trackState.startsWith('VSC') ? <RcBadge text="VSC" size={16} /> : <FlagGlyph color="#3ddc84" size={18} />}
          <span>{t(`rc.${live.trackState}`)}</span>
        </div>
        {left !== null && (
          <div className="inc__left">
            <b className="num">{left}</b>
            <span>{t('pl.lapsLeft')}</span>
          </div>
        )}
      </div>
      <ol className="inc__log">
        {items.length === 0 && <li className="inc__empty">{t('pl.noIncidents')}</li>}
        {items.map((m) => (
          <li key={m.id} className="inc__row">
            <span className="num inc__lap">{m.lap > 0 ? `L${m.lap}` : '—'}</span>
            <span className="inc__icon">
              <MomentIcon kind={m.kind} size={16} />
            </span>
            <span className="inc__text">{momentText(m)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PositionVisual({ pool, car, cars }: { pool: Pool; car: LiveCar; cars: LiveCar[] }) {
  const live = useLive((s) => s.live);
  const n = cars.length || 20;
  const lap = pool.target.parameters.target_lap;
  return (
    <div className="pv">
      <DriverCard
        car={car}
        right={
          <div className="pv-now">
            <span className="pv-now__k">{t('pl.now')}</span>
            <span className="pv-now__v num">P{car.position}</span>
          </div>
        }
        sub={`${teamOf(car.id)?.shortName} · ${t('pl.grid')} P${car.gridPosition} · ${car.position === 1 ? t('lv.leader') : fmtGap(car.gapMs, 1)}`}
      />
      <div className="ladder" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => i + 1).map((p) => (
          <span key={p} className={`ladder__p ${p === car.position ? 'ladder__p--now' : ''} ${p === car.gridPosition ? 'ladder__p--grid' : ''} ${p <= 3 ? 'ladder__p--pod' : ''}`} style={p === car.position ? { ['--team' as string]: teamColor(car.id) } : undefined}>
            {p === car.position || p === 1 || p === n || p % 5 === 0 ? p : ''}
          </span>
        ))}
      </div>
      <div className="pv-foot">
        {lap !== undefined && live && (
          <span>
            {t('pl.anchorLap')} <b className="num">{lap}</b> · {t('pl.inLaps', { n: Math.max(0, lap - live.leaderLap) })}
          </span>
        )}
        {lap === undefined && live?.totalLaps && (
          <span>
            {t('pl.lapsLeft')}: <b className="num">{Math.max(0, live.totalLaps - live.leaderLap)}</b>
          </span>
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
  const active = live.cars.filter((c) => !c.eliminatedIn);
  const around = active.slice(Math.max(0, seg.cutPosition - 4), seg.cutPosition + 3);
  return (
    <div className="pv quali2">
      <div className="quali2__head">
        <span className="quali2__seg">{seg.id}</span>
        <span className="muted">{t('live.remaining')}</span>
        <b className="num quali2__time">{fmtCountdown(seg.remainingMs)}</b>
      </div>
      <div className="quali2__list">
        {around.map((c) => (
          <div key={c.id} className={`quali2__row ${c.id === subject ? 'quali2__row--on' : ''} ${c.position > seg.cutPosition ? 'quali2__row--out' : ''}`}>
            <span className="num">{c.position}</span>
            <span className="quali2__bar" style={{ background: teamColor(c.id) }} />
            <b>{driverCode(c.id)}</b>
            <span className="num quali2__lap">{fmtLap(c.segmentBestMs ?? null)}</span>
            {c.position === seg.cutPosition && seg.cutPosition < active.length && <span className="quali2__cut">{t('live.cut')}</span>}
          </div>
        ))}
      </div>
      <div className="pv-hint">{t('f1.quali.provisional')}</div>
    </div>
  );
}

function legHolds(kind: string, driver: string, value: string, cars: LiveCar[]): boolean | null {
  const c = cars.find((x) => x.id === driver);
  if (!c) return null;
  switch (kind) {
    case 'POSITION_GROUP': {
      const [lo, hi] = value === 'P1' ? [1, 1] : value === 'P1_3' ? [1, 3] : value === 'P2_3' ? [2, 3] : value === 'P4_10' ? [4, 10] : value === 'P1_10' ? [1, 10] : [11, 99];
      return c.position >= lo! && c.position <= hi!;
    }
    case 'TYRE_COMPOUND':
      return c.tyre === value;
    case 'AHEAD_OF': {
      const o = cars.find((x) => x.id === value);
      return o ? c.position < o.position : null;
    }
    case 'ON_TRACK':
      return c.occupancy === 'ON_TRACK';
    case 'SECTOR':
      return c.occupancy === 'ON_TRACK' && String(c.sector) === value;
    default:
      return null;
  }
}

function ComboVisual({ pool, cars }: { pool: Pool; cars: LiveCar[] }) {
  const legs = comboParts(pool);
  const raw = pool.target.parameters.combo ?? [];
  return (
    <div className="pv combo">
      {legs.map((l, i) => {
        const holds = legHolds(raw[i]!.kind, raw[i]!.driver_id, raw[i]!.value, cars);
        return (
          <div key={i} className="combo__leg">
            <span className="combo__n num">{i + 1}</span>
            <DriverAvatar id={l.driver} size={36} />
            <div className="combo__text">
              <span className="combo__kind">{t(`pl.combo.${l.kind.toLowerCase()}`)}</span>
              <b>{l.text}</b>
            </div>
            <span className={`combo__now ${holds === true ? 'combo__now--yes' : holds === false ? 'combo__now--no' : ''}`}>
              {holds === null ? '—' : holds ? <IcYes size={14} /> : <IcNo size={14} />}
              <small>{t('pl.now')}</small>
            </span>
          </div>
        );
      })}
      <div className="combo__join">
        <IcLink size={14} /> {t('pl.comboHint')}
      </div>
    </div>
  );
}

/** Live context chip for the scene HUD (e.g. gap in a duel). */
export function sceneChip(pool: Pool, cars: LiveCar[]): string | null {
  const a = cars.find((c) => c.id === pool.subject.driver_a);
  if (!a) return null;
  return `${driverCode(a.id)} · P${a.position}${a.occupancy === 'ON_TRACK' ? ` · S${a.sector}` : ''}`;
}

export function fmtPulse(n: number): string {
  return `${fmtNumber(n)} PULSE`;
}
