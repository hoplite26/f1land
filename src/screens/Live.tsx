import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLive, onMoment } from '@/store/live';
import { useNav } from '@/store/nav';
import { useSettings } from '@/store/settings';
import { usePools, multiplier, type LivePool } from '@/demo/poolEngine';
import { useWallet } from '@/store/wallet';
import { CHANNELS } from '@/demo/channels';
import { CIRCUIT_META } from '@/data/circuits';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import type { LiveCar, Moment } from '@/sim/types';
import type { CameraMode } from '@/three/engine/cameraRig';
import { flagEmoji, fmtClock, fmtCountdown, fmtGap, fmtLap, fmtSec, getLang, t } from '@/i18n/core';
import { useSceneView, getScene } from '@/app/SceneHost';
import { useSessionNow } from '@/app/hooks';
import { outcomeLabel, poolTexts } from '@/app/poolText';
import { msUntilLock } from '@/domain/lifecycle';
import { DriverAvatar, LineChart, Segmented, Sheet, TeamBar, TyreBadge, Sparkline, Help } from '@/ui/kit';
import { IconCamera, IconChevron, IconEye, IconFast, IconLayers, IconMap, IconPause, IconPlay, IconSettings, IconSwap, IconWarning } from '@/ui/icons';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';

type Tab = 'pools' | 'timing' | 'events' | 'mine' | 'graphs';

const CAMS: CameraMode[] = ['director', 'follow', 'tv', 'heli', 'onboard', 'orbit', 'overview'];

export function LiveScreen() {
  const live = useLive((s) => s.live);
  const runner = useLive((s) => s.runner);
  const loading = useLive((s) => s.loading);
  const progress = useLive((s) => s.progress);
  const channelId = useLive((s) => s.channelId);
  const mode = useLive((s) => s.mode);
  const open = useLive((s) => s.open);
  const followId = useLive((s) => s.followId);
  const setFollow = useLive((s) => s.setFollow);
  const setSceneView = useSceneView((s) => s.set);
  const webglLost = useSceneView((s) => s.webglLost);
  const pickList = useSceneView((s) => s.pickList);
  const camera = useSettings((s) => s.camera);
  const renderMode = useSettings((s) => s.renderMode);
  const showZones = useSettings((s) => s.showZones);
  const setSettings = useSettings((s) => s.set);
  const [tab, setTab] = useState<Tab>('pools');
  const [expanded, setExpanded] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [driverPicker, setDriverPicker] = useState(false);
  const [camMenu, setCamMenu] = useState(false);
  const [director, setDirector] = useState(false);
  const [towerOpen, setTowerOpen] = useState(true);
  const lang = getLang();
  const channel = CHANNELS.find((c) => c.id === channelId)!;
  const isQuali = channel.sessionType === 'QUALIFYING' || channel.sessionType === 'SPRINT_QUALIFYING';

  useEffect(() => {
    if (!runner && !loading) void open(channelId, mode);
  }, [runner, loading, channelId, mode, open]);

  useEffect(() => {
    setSceneView({ layout: 'full', zone: null, frameZone: false, labels: [], cameraOverride: null, frozen: false });
    return () => setSceneView({ layout: 'hidden' });
  }, [setSceneView]);

  const follow = live?.cars.find((c) => c.id === followId) ?? null;

  return (
    <div className="live">
      <div className="live__top">
        <button
          className="live__session"
          onClick={() => {
            haptic.tap();
            setChannelsOpen(true);
          }}
          aria-label={t('home.channels')}
        >
          <span className="flag" style={{ width: 28, height: 20, fontSize: 16 }}>
            {flagEmoji(CIRCUIT_META.find((c) => c.id === channel.circuitId)?.countryCode ?? '')}
          </span>
          <span className="ellipsis" style={{ fontWeight: 700 }}>
            {channel.title[lang]}
          </span>
          <IconChevron dir="down" size={16} />
        </button>
        <div className="live__status">
          {mode === 'live' ? <span className="dot-live">LIVE</span> : <span className="badge badge--cyan">{t('races.replay')}</span>}
          {live && !isQuali && (
            <span className="num live__lap">
              {t('live.lap')} <b>{live.leaderLap}</b>/{live.totalLaps}
            </span>
          )}
          {live?.segment && (
            <span className="num live__lap">
              {live.segment.id} <b>{fmtCountdown(live.segment.remainingMs)}</b>
            </span>
          )}
        </div>
      </div>

      {live && (live.trackState !== 'GREEN' || live.sectorFlags.some(Boolean) || live.stale) && (
        <div className="live__flags">
          {live.stale && (
            <div className="statusbar statusbar--stale" role="status">
              <IconWarning size={16} /> {t('live.stale')}
            </div>
          )}
          {live.trackState !== 'GREEN' && live.trackState !== 'CHEQUERED' && (
            <div className={`statusbar ${live.trackState === 'RED' ? 'statusbar--red' : 'statusbar--sc'}`} role="status">
              {live.trackState === 'RED' ? '🟥' : '🟨'} {t(`rc.${live.trackState}`)}
            </div>
          )}
          {live.trackState === 'CHEQUERED' && (
            <div className="statusbar statusbar--stale" role="status">
              🏁 {t('rc.CHEQUERED')}
            </div>
          )}
          {live.trackState === 'GREEN' &&
            live.sectorFlags.map((on, i) =>
              on ? (
                <div key={i} className="statusbar statusbar--sc" role="status">
                  🟨 {t('rc.yellow', { s: i + 1 })}
                </div>
              ) : null,
            )}
        </div>
      )}

      {webglLost && (
        <div className="live__notice" role="alert">
          <b>{t('live.webglLost')}</b>
          <span>{t('live.webglLostHint')}</span>
          <button className="btn btn--ghost btn--sm" onClick={() => setSceneView({ webglLost: false })}>
            {t('ui.retry')}
          </button>
        </div>
      )}

      {live && <StartLights lights={live.lights} />}
      <MomentBanner />

      {live && (
        <Tower
          cars={live.cars}
          open={towerOpen}
          quali={isQuali}
          cut={live.segment?.cutPosition ?? null}
          onToggle={() => setTowerOpen(!towerOpen)}
          followId={followId}
          onPick={(id) => {
            haptic.tap();
            setFollow(id);
          }}
        />
      )}

      <div className="live__rail">
        <button className="icon-btn" aria-label={t('live.camera')} aria-expanded={camMenu} onClick={() => setCamMenu(!camMenu)}>
          <IconCamera />
        </button>
        <button
          className="icon-btn"
          aria-label={t('live.zones')}
          aria-pressed={showZones}
          style={showZones ? { color: 'var(--lime)', borderColor: 'rgba(198,255,61,.5)' } : undefined}
          onClick={() => {
            haptic.tap();
            setSettings({ showZones: !showZones });
          }}
        >
          <IconLayers />
        </button>
        <button
          className="icon-btn"
          aria-label={renderMode === '3d' ? t('live.view2d') : t('live.view3d')}
          onClick={() => {
            haptic.tap();
            setSettings({ renderMode: renderMode === '3d' ? '2d' : '3d' });
          }}
        >
          {renderMode === '3d' ? <IconMap /> : <span style={{ fontWeight: 800, fontSize: 12 }}>3D</span>}
        </button>
        <button className="icon-btn" aria-label={t('live.directorPanel')} onClick={() => setDirector(true)}>
          <IconSettings />
        </button>
      </div>

      <AnimatePresence>
        {camMenu && (
          <motion.div className="cam-menu" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} role="menu">
            {CAMS.map((c) => (
              <button
                key={c}
                role="menuitemradio"
                aria-checked={camera === c}
                className={`cam-menu__item ${camera === c ? 'cam-menu__item--on' : ''}`}
                onClick={() => {
                  haptic.tap();
                  sfx.select();
                  setSettings({ camera: c });
                  setCamMenu(false);
                }}
              >
                {t(`live.cam.${c}`)}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {mode === 'replay' && runner && <ReplayBar />}

      {(loading || !live) && (
        <div className="live__loading">
          <div className="loader-ring" />
          <div style={{ marginTop: 12, fontWeight: 600 }}>{t('ui.syncing')}</div>
          <div className="progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}

      <div className={`live__dock ${expanded ? 'live__dock--open' : ''}`}>
        {follow && !expanded && <FollowCard car={follow} quali={isQuali} onChange={() => setDriverPicker(true)} />}
        <div className="dock card">
          <button className="dock__grab" aria-label={expanded ? t('ui.collapse') : t('ui.expand')} onClick={() => setExpanded(!expanded)}>
            <span />
          </button>
          <div className="dock__tabs">
            <Segmented<Tab>
              label={t('live.pools')}
              value={tab}
              onChange={(v) => {
                setTab(v);
                if (!expanded && v !== 'pools') setExpanded(true);
              }}
              options={[
                { id: 'pools', label: t('live.pools') },
                { id: 'timing', label: t('live.timing') },
                { id: 'events', label: t('live.events') },
                { id: 'mine', label: t('live.myEntries') },
                { id: 'graphs', label: t('live.graphs') },
              ]}
            />
          </div>
          <div className="dock__body">
            {tab === 'pools' && <PoolsStrip expanded={expanded} />}
            {tab === 'timing' && live && <TimingTable cars={live.cars} quali={isQuali} followId={followId} onPick={setFollow} />}
            {tab === 'events' && live && <EventsFeed moments={live.moments} />}
            {tab === 'mine' && <MyEntries />}
            {tab === 'graphs' && <Graphs />}
          </div>
        </div>
      </div>

      <Sheet open={channelsOpen} onClose={() => setChannelsOpen(false)} title={t('home.channels')} label={t('home.channels')}>
        <div className="list" style={{ paddingBottom: 12 }}>
          {CHANNELS.map((ch) => {
            const meta = CIRCUIT_META.find((c) => c.id === ch.circuitId);
            return (
              <div key={ch.id} className={`card list-row ${ch.id === channelId ? 'card--glow' : ''}`}>
                <span className="flag">{flagEmoji(meta?.countryCode ?? '')}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }} className="ellipsis">
                    {ch.title[lang]}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {t(`session.${ch.sessionType}`)} · {meta?.name}
                  </div>
                </div>
                <button
                  className="btn btn--sm btn--primary"
                  onClick={() => {
                    haptic.impact('medium');
                    setChannelsOpen(false);
                    setFollow(null);
                    void open(ch.id, 'live');
                  }}
                >
                  LIVE
                </button>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => {
                    haptic.tap();
                    setChannelsOpen(false);
                    setFollow(null);
                    void open(ch.id, 'replay');
                  }}
                >
                  {t('races.replay')}
                </button>
              </div>
            );
          })}
        </div>
      </Sheet>

      <Sheet open={driverPicker || !!pickList} onClose={() => (setDriverPicker(false), setSceneView({ pickList: null }))} title={pickList ? t('live.overlap') : t('live.pickDriver')} label={t('live.pickDriver')}>
        <div className="driver-grid">
          {(live?.cars ?? [])
            .filter((c) => !pickList || pickList.includes(c.id))
            .map((c) => (
              <button
                key={c.id}
                className={`driver-pick ${c.id === followId ? 'driver-pick--on' : ''}`}
                onClick={() => {
                  haptic.impact('light');
                  setFollow(c.id);
                  setDriverPicker(false);
                  setSceneView({ pickList: null });
                }}
              >
                <span className="num muted" style={{ width: 18 }}>
                  {c.position}
                </span>
                <DriverAvatar id={c.id} size={34} />
                <span style={{ textAlign: 'left', minWidth: 0 }}>
                  <b className="ellipsis" style={{ display: 'block' }}>
                    {DRIVER_BY_ID[c.id]?.lastName}
                  </b>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {TEAM_BY_ID[DRIVER_BY_ID[c.id]!.teamId]!.shortName}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </Sheet>

      <Sheet open={director} onClose={() => setDirector(false)} title={t('live.directorPanel')} label={t('live.directorPanel')}>
        <DirectorPanel onClose={() => setDirector(false)} />
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StartLights({ lights }: { lights: number | 'off' }) {
  const [splash, setSplash] = useState(false);
  const prev = useRef<number | 'off'>(lights);
  useEffect(() => {
    if (typeof lights === 'number' && lights > 0 && prev.current !== lights) {
      sfx.light();
      haptic.impact('rigid');
    }
    if (lights === 'off' && typeof prev.current === 'number' && prev.current > 0) {
      setSplash(true);
      sfx.lightsOut();
      haptic.impact('heavy');
      setTimeout(() => setSplash(false), 1800);
    }
    prev.current = lights;
  }, [lights]);
  const n = typeof lights === 'number' ? lights : 0;
  return (
    <>
      {n > 0 && (
        <div className="start-lights" role="img" aria-label={`${n}/5`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="start-lights__col">
              <span className={i <= n ? 'on' : ''} />
              <span className={i <= n ? 'on' : ''} />
            </div>
          ))}
        </div>
      )}
      <AnimatePresence>
        {splash && (
          <motion.div className="splash" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.4, opacity: 0 }}>
            {t('live.lightsOut')}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function momentText(m: Moment): string {
  const a = m.drivers[0] ? DRIVER_BY_ID[m.drivers[0]]?.lastName ?? m.drivers[0] : '';
  const b = m.drivers[1] ? DRIVER_BY_ID[m.drivers[1]]?.lastName ?? m.drivers[1] : '';
  switch (m.kind) {
    case 'PIT':
      return m.data?.service === 'DRIVE_THROUGH' ? t('moment.PIT_DT', { a }) : t('moment.PIT', { a, stop: fmtSec(Number(m.data?.stopMs ?? 0), 1), tyre: t(`tyre.${String(m.data?.compound ?? 'medium').toLowerCase()}`) });
    case 'FASTEST_LAP':
      return t('moment.FASTEST_LAP', { a, time: fmtLap(Number(m.data?.ms ?? 0)) });
    case 'ELIMINATED':
      return t('moment.ELIMINATED', { a, seg: String(m.data?.segment ?? '') });
    case 'SEGMENT':
      return t('moment.SEGMENT', { seg: String(m.data?.segment ?? '') });
    default:
      return t(`moment.${m.kind}`, { a, b });
  }
}

const MOMENT_ICON: Partial<Record<Moment['kind'], string>> = {
  OVERTAKE: '⚡',
  PIT: '🔧',
  FASTEST_LAP: '⏱',
  SC: '🟨',
  VSC: '🟨',
  RED: '🟥',
  GREEN: '🟩',
  RETIREMENT: '⚠️',
  START: '🚦',
  FINISH: '🏁',
  TRACK_LIMITS: '🚫',
  BATTLE: '⚔️',
  ELIMINATED: '✂️',
  SEGMENT: '⏲',
};

function MomentBanner() {
  const [items, setItems] = useState<Array<Moment & { big: boolean }>>([]);
  useEffect(
    () =>
      onMoment((m) => {
        if (m.kind === 'BATTLE' && Math.random() < 0.5) return;
        const follow = useLive.getState().followId;
        const big = m.kind === 'OVERTAKE' && m.drivers.includes(follow ?? '');
        if (big) haptic.impact('medium');
        setItems((x) => [...x.slice(-2), { ...m, big }]);
        setTimeout(() => setItems((x) => x.filter((i) => i.id !== m.id)), big ? 3600 : 3000);
      }),
    [],
  );
  return (
    <div className="moments" aria-live="polite">
      <AnimatePresence>
        {items.map((m) => (
          <motion.div key={m.id} className={`moment ${m.big ? 'moment--big' : ''} moment--${m.kind.toLowerCase()}`} initial={{ opacity: 0, y: -12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }}>
            <span className="moment__icon">{MOMENT_ICON[m.kind] ?? '•'}</span>
            <span>{momentText(m)}</span>
            {m.big && <span className="moment__tag">OVERTAKE!</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Tower({ cars, open, onToggle, followId, onPick, quali, cut }: { cars: LiveCar[]; open: boolean; onToggle: () => void; followId: string | null; onPick: (id: string) => void; quali: boolean; cut: number | null }) {
  const rows = open ? cars.slice(0, 10) : cars.slice(0, 3);
  return (
    <div className="tower" aria-label={t('live.timing')}>
      {rows.map((c) => (
        <button key={c.id} className={`tower__row ${c.id === followId ? 'tower__row--on' : ''} ${quali && cut !== null && c.position > cut && !c.eliminatedIn ? 'tower__row--cut' : ''}`} onClick={() => onPick(c.id)}>
          <span className="num tower__pos">{c.position}</span>
          <TeamBar id={c.id} />
          <span className="tower__code">{DRIVER_BY_ID[c.id]?.code}</span>
          <span className="num tower__gap">
            {c.status !== 'ACTIVE'
              ? 'OUT'
              : c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP'
                ? 'PIT'
                : quali
                  ? c.position === 1
                    ? fmtLap(c.segmentBestMs ?? null)
                    : c.gapMs !== null
                      ? fmtGap(c.gapMs)
                      : '—'
                  : c.position === 1
                    ? t('live.lap').slice(0, 3).toUpperCase() + ' ' + (c.driverLaps + 1)
                    : c.intervalMs !== null
                      ? fmtGap(c.intervalMs, 1)
                      : '—'}
          </span>
          {c.boost && <span className="tower__boost" title="Overtake Mode">⚡</span>}
        </button>
      ))}
      <button className="tower__more" onClick={onToggle} aria-label={open ? t('ui.collapse') : t('ui.expand')}>
        <IconChevron dir={open ? 'up' : 'down'} size={14} />
      </button>
    </div>
  );
}

function FollowCard({ car, quali, onChange }: { car: LiveCar; quali: boolean; onChange: () => void }) {
  const d = DRIVER_BY_ID[car.id]!;
  const team = TEAM_BY_ID[d.teamId]!;
  return (
    <div className="follow card card--glow">
      <DriverAvatar id={car.id} size={44} ring />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <span className="follow__pos num">P{car.position}</span>
          <b className="ellipsis">{d.firstName[0]}. {d.lastName}</b>
        </div>
        <div className="muted ellipsis" style={{ fontSize: 12 }}>
          #{d.number} · {team.shortName} · {car.status !== 'ACTIVE' ? t(`status.${car.status}`) : t(`occ.${car.occupancy}`)}
        </div>
      </div>
      <div className="follow__stats">
        {!quali && <TyreBadge compound={car.tyre} />}
        <div className="num" style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{car.speedKph}<span className="muted" style={{ fontSize: 10 }}> km/h</span></div>
          <div className="muted" style={{ fontSize: 11 }}>{fmtLap(quali ? car.segmentBestMs ?? null : car.lastLapMs)}</div>
        </div>
      </div>
      <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label={t('live.changeDriver')} onClick={onChange}>
        <IconSwap size={18} />
      </button>
    </div>
  );
}

function ReplayBar() {
  const runner = useLive((s) => s.runner)!;
  const open = useLive((s) => s.open);
  const channelId = useLive((s) => s.channelId);
  const [, force] = useState(0);
  const speeds = [1, 2, 4, 8, 16];
  return (
    <div className="replay card">
      <button
        className="icon-btn"
        aria-label={runner.paused ? t('live.play') : t('live.pause')}
        onClick={() => {
          haptic.tap();
          runner.setPaused(!runner.paused);
          force((n) => n + 1);
        }}
      >
        {runner.paused ? <IconPlay /> : <IconPause />}
      </button>
      <div className="row" style={{ gap: 4 }} role="radiogroup" aria-label={t('live.replaySpeed')}>
        {speeds.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={runner.speed === s}
            className={`chip ${runner.speed === s ? 'chip--on' : ''}`}
            style={{ height: 30, padding: '0 9px' }}
            onClick={() => {
              haptic.tap();
              runner.setSpeed(s);
              force((n) => n + 1);
            }}
          >
            {s}×
          </button>
        ))}
      </div>
      <button className="btn btn--sm btn--ghost" onClick={() => void open(channelId, 'live')}>
        <IconFast size={14} /> {t('live.goLive')}
      </button>
    </div>
  );
}

function PoolsStrip({ expanded }: { expanded: boolean }) {
  const pools = usePools((s) => s.pools);
  const channelId = useLive((s) => s.channelId);
  const push = useNav((s) => s.push);
  const now = useSessionNow();
  const open = pools.filter((p) => p.pool.status === 'OPEN').sort((a, b) => b.priority - a.priority);
  const locked = pools.filter((p) => p.pool.status === 'LOCKED' || p.pool.status === 'RESOLVING').slice(-4);
  if (!open.length && !locked.length) return <div className="empty">{t('pool.noPools')}</div>;
  return (
    <div className={expanded ? 'list' : 'hscroll hscroll--pools'}>
      {[...open, ...(expanded ? locked : [])].map((lp) => (
        <PoolCard key={lp.pool.pool_id} lp={lp} now={now} onOpen={() => push({ name: 'pool', channelId, poolId: lp.pool.pool_id })} />
      ))}
    </div>
  );
}

export function PoolCard({ lp, now, onOpen }: { lp: LivePool; now: number; onOpen: () => void }) {
  const tx = poolTexts(lp.pool);
  const entries = useWallet((s) => s.entries);
  const mine = entries.some((e) => e.poolId === lp.pool.pool_id);
  const top = [...lp.pool.outcomes]
    .map((o) => ({ o, m: multiplier(lp.book, o.id) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, 3);
  const ms = msUntilLock(lp.pool, now);
  const isOpen = lp.pool.status === 'OPEN';
  return (
    <div
      className={`pool-card card ${mine ? 'card--glow' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        haptic.tap();
        onOpen();
      }}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pool-card__title">{tx.title}</div>
          <div className="pool-card__q">{tx.question}</div>
        </div>
        <div className={`pool-card__timer num ${!isOpen ? 'muted' : ms < 10000 ? 'yellow' : 'lime'}`}>{isOpen ? fmtCountdown(ms) : t(`pool.status.${lp.pool.status}`)}</div>
      </div>
      <div className="pool-card__outs">
        {top.map(({ o, m }) => (
          <span key={o.id} className="pool-card__out">
            <span className="ellipsis">{outcomeLabel(o, lp.pool.market_id)}</span>
            <b className="num">{m.toFixed(2)}</b>
          </span>
        ))}
      </div>
      {mine && <span className="badge badge--lime pool-card__mine">{t('pool.alreadyIn')}</span>}
    </div>
  );
}

function TimingTable({ cars, quali, followId, onPick }: { cars: LiveCar[]; quali: boolean; followId: string | null; onPick: (id: string) => void }) {
  return (
    <div className="timing" role="table" aria-label={t('live.timing')}>
      <div className="timing__head" role="row">
        <span>#</span>
        <span>{t('live.pickDriver').split(' ')[0]}</span>
        <span>{quali ? t('live.bestLap') : t('live.interval')}</span>
        <span>{t('live.lastLap')}</span>
        <span>{quali ? '' : t('live.tyre')}</span>
      </div>
      {cars.map((c) => (
        <button key={c.id} role="row" className={`timing__row ${c.id === followId ? 'timing__row--on' : ''} ${c.eliminatedIn ? 'timing__row--out' : ''}`} onClick={() => onPick(c.id)}>
          <span className="num">{c.position}</span>
          <span className="row" style={{ gap: 6, minWidth: 0 }}>
            <TeamBar id={c.id} />
            <b>{DRIVER_BY_ID[c.id]?.code}</b>
            {c.pitStops > 0 && !quali && <span className="muted num" style={{ fontSize: 10 }}>{c.pitStops}×</span>}
          </span>
          <span className="num">
            {c.status !== 'ACTIVE' ? t(`status.${c.status}`).split(' ')[0] : quali ? fmtLap(c.segmentBestMs ?? null) : c.position === 1 ? '—' : c.intervalMs !== null ? fmtGap(c.intervalMs) : '—'}
          </span>
          <span className="num" style={{ color: c.lastLapMs && c.bestLapMs === c.lastLapMs ? 'var(--green)' : undefined }}>
            {fmtLap(c.lastLapMs)}
          </span>
          <span>{!quali && <TyreBadge compound={c.tyre} size={18} />}</span>
        </button>
      ))}
    </div>
  );
}

function EventsFeed({ moments }: { moments: Moment[] }) {
  const list = [...moments].reverse().filter((m) => m.kind !== 'BATTLE');
  if (!list.length) return <div className="empty">{t('live.noEvents')}</div>;
  return (
    <div className="feed">
      {list.map((m) => (
        <div key={m.id} className={`feed__row feed__row--${m.kind.toLowerCase()}`}>
          <span className="feed__icon">{MOMENT_ICON[m.kind] ?? '•'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="feed__text">{momentText(m)}</div>
            <div className="muted num" style={{ fontSize: 11 }}>
              {m.lap > 0 ? `${t('live.lap')} ${m.lap} · ` : ''}
              {fmtClock(m.atMs, true)}
            </div>
          </div>
          {m.kind === 'TRACK_LIMITS' && <span className="badge badge--yellow">{t('entries.corrected')}</span>}
        </div>
      ))}
    </div>
  );
}

function MyEntries() {
  const runner = useLive((s) => s.runner);
  const entries = useWallet((s) => s.entries).filter((e) => e.sessionId === runner?.manifest.session_id);
  const push = useNav((s) => s.push);
  if (!entries.length) return <div className="empty">{t('live.noEntries')}</div>;
  return (
    <div className="list">
      {entries.map((e) => (
        <button key={e.id} className="card list-row" style={{ textAlign: 'left' }} onClick={() => push({ name: 'entry', entryId: e.id })}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 700 }}>
              {poolTexts(e.pool).title}
            </div>
            <div className="muted ellipsis" style={{ fontSize: 12 }}>
              {e.outcomeLabel} · {e.stake} PULSE
            </div>
          </div>
          <span className={`badge ${e.state === 'WON' ? 'badge--lime' : e.state === 'LOST' ? 'badge--red' : e.state === 'VOID' ? 'badge--yellow' : 'badge--ghost'}`}>{t(`entries.${e.state === 'PENDING' ? 'pending' : e.state === 'WON' ? 'won' : e.state === 'LOST' ? 'lost' : 'void'}`)}</span>
        </button>
      ))}
    </div>
  );
}

function Graphs() {
  const runner = useLive((s) => s.runner);
  const live = useLive((s) => s.live);
  const followId = useLive((s) => s.followId);
  const rev = useLive((s) => s.eventRev);
  const data = useMemo(() => {
    if (!runner || !live) return null;
    const laps = new Map<string, number[]>();
    const positions = new Map<string, Array<number | null>>();
    const sectors = new Map<string, [number[], number[], number[]]>();
    for (const e of runner.events) {
      if (e.type === 'LAP_COMPLETED' && e.source_revision === '1' && !e.payload.pit_in_lap && !e.payload.pit_out_lap && !e.payload.neutralised) {
        const arr = laps.get(e.payload.driver_id) ?? [];
        arr.push(e.payload.lap_time_ms / 1000);
        laps.set(e.payload.driver_id, arr);
      } else if (e.type === 'TIMING_ORDER' && e.payload.anchor) {
        for (const o of e.payload.order) {
          const arr = positions.get(o.driver_id) ?? [];
          arr[e.payload.anchor.lap - 1] = o.position;
          positions.set(o.driver_id, arr);
        }
      } else if (e.type === 'SECTOR_COMPLETED' && !e.payload.neutralised) {
        const s = sectors.get(e.payload.driver_id) ?? [[], [], []];
        s[e.payload.sector - 1].push(e.payload.sector_time_ms);
        sectors.set(e.payload.driver_id, s);
      }
    }
    return { laps, positions, sectors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, Math.floor(rev / 40)]);
  if (!data || !live) return null;
  const top = live.cars.slice(0, 5).map((c) => c.id);
  const ids = followId && !top.includes(followId) ? [...top.slice(0, 4), followId] : top;
  const color = (id: string) => TEAM_BY_ID[DRIVER_BY_ID[id]!.teamId]!.color;
  const best = (arr: number[]) => (arr.length ? Math.min(...arr) : null);
  const bestSector = [0, 1, 2].map((i) => Math.min(...[...data.sectors.values()].map((s) => best(s[i]) ?? Infinity)));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card card--pad">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>{t('live.lapChart')}</b>
          <Help text={t('pool.dataNote')} />
        </div>
        <LineChart invert series={ids.map((id) => ({ id, color: color(id), values: (data.positions.get(id) ?? []).map((v) => v ?? null) }))} yFormat={(v) => `P${Math.round(v)}`} xLabel={t('live.lap')} />
        <Legend ids={ids} />
      </div>
      <div className="card card--pad">
        <b>{t('live.lapTimes')}</b>
        <LineChart series={ids.map((id) => ({ id, color: color(id), values: (data.laps.get(id) ?? []).slice(-25) }))} yFormat={(v) => v.toFixed(1)} xLabel={t('live.lap')} />
        <Legend ids={ids} />
      </div>
      <div className="card card--pad">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>{t('live.sectorHeat')}</b>
          <Help text={t('live.sectorHeat')} />
        </div>
        <div className="heat">
          {live.cars.slice(0, 10).map((c) => {
            const s = data.sectors.get(c.id);
            return (
              <div key={c.id} className="heat__row">
                <span className="num" style={{ width: 34 }}>{DRIVER_BY_ID[c.id]?.code}</span>
                {[0, 1, 2].map((i) => {
                  const b = s ? best(s[i]) : null;
                  const delta = b !== null && Number.isFinite(bestSector[i]!) ? b - bestSector[i]! : null;
                  const k = delta === null ? 0 : Math.max(0, 1 - delta / 600);
                  return (
                    <span key={i} className="heat__cell num" style={{ background: delta === null ? 'rgba(255,255,255,.04)' : `rgba(${delta === 0 ? '178,107,255' : '198,255,61'},${0.12 + k * 0.5})` }}>
                      {delta === null ? '—' : delta === 0 ? fmtSec(b!) : `+${fmtSec(delta)}`}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          S1 · S2 · S3 — {t('live.bestLap')} / Δ
        </div>
      </div>
      {followId && data.laps.get(followId) && (
        <div className="card card--pad row">
          <DriverAvatar id={followId} size={34} />
          <div style={{ flex: 1 }}>
            <b>{DRIVER_BY_ID[followId]?.lastName}</b>
            <div className="muted" style={{ fontSize: 12 }}>{t('live.lapTimes')}</div>
          </div>
          <Sparkline values={(data.laps.get(followId) ?? []).slice(-15)} color="var(--lime)" />
        </div>
      )}
    </div>
  );
}

function Legend({ ids }: { ids: string[] }) {
  return (
    <div className="legend">
      {ids.map((id) => (
        <span key={id}>
          <i style={{ background: TEAM_BY_ID[DRIVER_BY_ID[id]!.teamId]!.color }} />
          {DRIVER_BY_ID[id]?.code}
        </span>
      ))}
    </div>
  );
}

function DirectorPanel({ onClose }: { onClose: () => void }) {
  const runner = useLive((s) => s.runner);
  const sim = runner?.sim as unknown as { trigger?: (k: 'SC' | 'VSC' | 'RED' | 'RETIRE') => void } | undefined;
  return (
    <div className="col" style={{ gap: 10, paddingBottom: 10 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('app.demoNote')}</p>
      <div className="grid-2">
        {(['SC', 'VSC', 'RED'] as const).map((k) => (
          <button
            key={k}
            className="btn btn--ghost"
            disabled={!sim?.trigger}
            onClick={() => {
              haptic.impact('medium');
              sim?.trigger?.(k);
              onClose();
            }}
          >
            {t(`live.trigger.${k.toLowerCase()}`)}
          </button>
        ))}
        <button
          className="btn btn--ghost"
          onClick={() => {
            haptic.impact('medium');
            runner?.setStale(true);
            setTimeout(() => runner?.setStale(false), 12000);
            onClose();
          }}
        >
          {t('live.trigger.stale')}
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => {
            getScene()?.loseContext();
            onClose();
          }}
        >
          {t('live.trigger.webgl')}
        </button>
      </div>
      <div className="muted row" style={{ fontSize: 12, gap: 6 }}>
        <IconEye size={14} /> {t('live.approxNote')}
      </div>
    </div>
  );
}
