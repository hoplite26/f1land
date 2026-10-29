import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLive, onMoment } from '@/store/live';
import { useSettings, prefersReducedMotion } from '@/store/settings';
import { usePools } from '@/demo/poolEngine';
import { useWallet } from '@/store/wallet';
import { CHANNELS } from '@/demo/channels';
import { CIRCUIT_META } from '@/data/circuits';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import type { LiveState, Moment } from '@/sim/types';
import type { CameraMode } from '@/three/engine/cameraRig';
import { flagEmoji, fmtCountdown, getLang, t } from '@/i18n/core';
import { useSceneView, getScene } from '@/app/SceneHost';
import { DriverAvatar, Sheet } from '@/ui/kit';
import { IconEye, IconFast, IconLayers, IconMap, IconPause, IconPlay, IconSettings, IconWarning, IconChevron } from '@/ui/icons';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { DragSheet, type Snap } from '@/ui/bet/DragSheet';
import { Charts, EventsFeed, FollowCard, MomentIcon, MOMENT_TONE, MyEntries, PoolsTab, TimingTable, TowerPanel, TowerStrip, momentText } from '@/ui/bet/livePanels';
import { CAMERA_ICON, FlagGlyph, IcChart, IcChat, IcCloud, IcList, IcRain, IcSun, IcTicket, IcTrophy, RcBadge } from '@/ui/bet/icons';
import '@/styles/live.css';

// Dev-only handle for scripted screenshots of pool flows.
if (import.meta.env.DEV) Object.assign(window, { __pools: usePools, __wallet: useWallet });

type Tab = 'pools' | 'timing' | 'events' | 'mine' | 'graphs';

const CAMS: CameraMode[] = ['director', 'follow', 'tv', 'heli', 'onboard', 'orbit', 'overview'];

function snapHeights(zone: number): Record<Snap, number> {
  const full = Math.max(320, zone);
  const peek = Math.round(Math.min(250, Math.max(186, zone * 0.31)));
  const half = Math.round(Math.max(peek + 90, Math.min(full - 80, zone * 0.56)));
  return { peek, half, full };
}

export function LiveScreen() {
  const live = useLive((s) => s.live);
  const runner = useLive((s) => s.runner);
  const loading = useLive((s) => s.loading);
  const progress = useLive((s) => s.progress);
  const channelId = useLive((s) => s.channelId);
  const mode = useLive((s) => s.mode);
  const open = useLive((s) => s.open);
  const followId = useLive((s) => s.followId);
  const rivalId = useLive((s) => s.rivalId);
  const setFollow = useLive((s) => s.setFollow);
  const setRival = useLive((s) => s.setRival);
  const setSceneView = useSceneView((s) => s.set);
  const webglLost = useSceneView((s) => s.webglLost);
  const pickList = useSceneView((s) => s.pickList);
  const motionPref = useSettings((s) => s.motion);
  const reduced = prefersReducedMotion(motionPref);
  const openPools = usePools((s) => s.pools.filter((p) => p.pool.status === 'OPEN').length);
  const pendingMine = useWallet((s) => s.entries.filter((e) => e.state === 'PENDING' && e.sessionId === runner?.manifest.session_id).length);
  const [tab, setTab] = useState<Tab>('pools');
  const [snap, setSnap] = useState<Snap>('peek');
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [driverPicker, setDriverPicker] = useState(false);
  const [director, setDirector] = useState(false);
  const [towerOpen, setTowerOpen] = useState(false);
  const [heights, setHeights] = useState<Record<Snap, number>>(() => snapHeights(640));
  const rootRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const aboveRef = useRef<HTMLDivElement>(null);
  const lang = getLang();
  const channel = CHANNELS.find((c) => c.id === channelId)!;
  const meta = CIRCUIT_META.find((c) => c.id === channel.circuitId);
  const isQuali = channel.sessionType === 'QUALIFYING' || channel.sessionType === 'SPRINT_QUALIFYING';

  useEffect(() => {
    if (!runner && !loading) void open(channelId, mode);
  }, [runner, loading, channelId, mode, open]);

  useEffect(() => {
    setSceneView({ layout: 'full', zone: null, frameZone: false, labels: [], cameraOverride: null, frozen: false });
    return () => {
      setSceneView({ layout: 'hidden' });
      document.documentElement.style.removeProperty('--lv-scene-cut');
    };
  }, [setSceneView]);

  // Snap points follow the space between the top bar and the nav bar.
  useLayoutEffect(() => {
    const z = zoneRef.current;
    if (!z) return;
    const apply = () => setHeights(snapHeights(z.clientHeight));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(z);
    return () => ro.disconnect();
  }, []);

  // The 3D viewport ends just under the peek sheet so the camera centre stays visible.
  useEffect(() => {
    document.documentElement.style.setProperty('--lv-scene-cut', `${heights.peek - 18}px`);
  }, [heights.peek]);

  useLayoutEffect(() => {
    const a = aboveRef.current;
    const root = rootRef.current;
    if (!a || !root) return;
    const ro = new ResizeObserver(() => root.style.setProperty('--lv-above', `${a.offsetHeight}px`));
    ro.observe(a);
    return () => ro.disconnect();
  }, []);

  const onSheetHeight = useCallback((px: number) => {
    rootRef.current?.style.setProperty('--lv-sheet', `${Math.round(px)}px`);
  }, []);

  const follow = live?.cars.find((c) => c.id === followId) ?? null;
  const flags = live ? flagItems(live) : [];

  const pickTab = (v: Tab) => {
    if (v !== tab) {
      haptic.tap();
      sfx.tap();
    }
    setTab(v);
    if (snap === 'peek' && v !== 'pools') setSnap('half');
  };

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'pools', label: t('lv.tab.pools'), icon: <IcTicket size={16} />, count: openPools || undefined },
    { id: 'timing', label: t('lv.tab.timing'), icon: <IcList size={16} /> },
    { id: 'events', label: t('lv.tab.events'), icon: <IcChat size={16} /> },
    { id: 'mine', label: t('lv.tab.mine'), icon: <IcTrophy size={16} />, count: pendingMine || undefined },
    { id: 'graphs', label: t('lv.tab.charts'), icon: <IcChart size={16} /> },
  ];

  return (
    <div ref={rootRef} className={`live lv lv--${snap} ${flags.length ? 'lv--flags' : ''} ${towerOpen ? 'lv--tower' : ''}`}>
      <div ref={zoneRef} className="lv-zone" aria-hidden="true" />

      {/* Top bar */}
      <div className="lv-top">
        <button
          type="button"
          className="lv-session"
          onClick={() => {
            haptic.tap();
            setChannelsOpen(true);
          }}
          aria-label={t('home.channels')}
        >
          <span className="lv-session__flag">{flagEmoji(meta?.countryCode ?? '')}</span>
          <span className="lv-session__text">
            <span className="lv-session__title ellipsis">{channel.title[lang]}</span>
            <span className="lv-session__sub ellipsis">
              {meta?.shortName ?? meta?.name}
              {live && (
                <>
                  <span className="lv-dot-sep" />
                  <WeatherIcon c={live.weather.condition} />
                  <span className="num">{Math.round(live.weather.airC)}°</span>
                  <span className="lv-session__track num">
                    {t('lv.trackShort')} {Math.round(live.weather.trackC)}°
                  </span>
                </>
              )}
            </span>
          </span>
          <IconChevron dir="down" size={14} />
        </button>
        <div className={`lv-status ${mode === 'replay' ? 'lv-status--replay' : ''}`}>
          <span className="lv-status__mode">
            {mode === 'live' ? (
              <>
                <i className="lv-live-dot" /> LIVE
              </>
            ) : (
              t('races.replay')
            )}
          </span>
          {live && !isQuali && live.totalLaps && (
            <span className="lv-status__lap num">
              <small>{t('lv.lapShort')}</small> <b>{Math.min(live.leaderLap, live.totalLaps)}</b>
              <small>/{live.totalLaps}</small>
            </span>
          )}
          {live?.segment && (
            <span className="lv-status__lap num">
              <small>{live.segment.id}</small> <b>{fmtCountdown(live.segment.remainingMs)}</b>
            </span>
          )}
        </div>
      </div>

      {/* Timing strip */}
      {live && (
        <TowerStrip
          cars={live.cars}
          followId={followId}
          quali={isQuali}
          cut={live.segment?.cutPosition ?? null}
          open={towerOpen}
          onToggle={() => {
            haptic.tap();
            setTowerOpen(!towerOpen);
          }}
          onPick={(id) => {
            haptic.impact('light');
            setFollow(id);
          }}
        />
      )}

      {flags.length > 0 && (
        <div className="lv-flags" role="status">
          {flags.map((f) => (
            <span key={f.key} className={`lv-flag lv-flag--${f.tone}`}>
              {f.icon}
              {f.text}
            </span>
          ))}
        </div>
      )}

      {live && towerOpen && (
        <TowerPanel
          cars={live.cars}
          followId={followId}
          quali={isQuali}
          cut={live.segment?.cutPosition ?? null}
          onClose={() => setTowerOpen(false)}
          onPick={(id) => {
            haptic.impact('light');
            setFollow(id);
          }}
        />
      )}

      {webglLost && (
        <div className="lv-notice" role="alert">
          <IconWarning size={18} />
          <div>
            <b>{t('live.webglLost')}</b>
            <span>{t('live.webglLostHint')}</span>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSceneView({ webglLost: false })}>
            {t('ui.retry')}
          </button>
        </div>
      )}

      <Rail onDirector={() => setDirector(true)} />

      {live && <StartLights lights={live.lights} />}

      {/* Overlays stacked above the sheet: moments → replay → followed driver */}
      <div ref={aboveRef} className="lv-above">
        <MomentStack />
        {mode === 'replay' && runner && <ReplayBar />}
        {follow && live && <FollowCard car={follow} cars={live.cars} quali={isQuali} rivalId={rivalId} onSwap={() => (haptic.tap(), setDriverPicker(true))} onRival={setRival} />}
      </div>

      {(loading || !live) && (
        <div className="lv-loading">
          <div className="lv-loading__ring" />
          <div className="lv-loading__t">{t('ui.syncing')}</div>
          <div className="lv-progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}

      <DragSheet
        snap={snap}
        heights={heights}
        onSnap={setSnap}
        onHeight={onSheetHeight}
        reduced={reduced}
        header={
          <div className="lv-tabs" role="tablist" aria-label={t('live.pools')}>
            {tabs.map((o) => (
              <button key={o.id} type="button" role="tab" aria-selected={tab === o.id} className={`lv-tab ${tab === o.id ? 'lv-tab--on' : ''}`} onClick={() => pickTab(o.id)}>
                {tab === o.id && !reduced && <motion.span layoutId="lv-tab-ind" className="lv-tab__ind" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                {tab === o.id && reduced && <span className="lv-tab__ind" />}
                <span className="lv-tab__icon">{o.icon}</span>
                <span className="lv-tab__label">{o.label}</span>
                {o.count !== undefined && <span className="lv-tab__count num">{o.count}</span>}
              </button>
            ))}
          </div>
        }
      >
        {tab === 'pools' && <PoolsTab layout={snap === 'peek' ? 'strip' : 'list'} />}
        {tab === 'timing' && live && (
          <TimingTable
            cars={live.cars}
            quali={isQuali}
            followId={followId}
            onPick={(id) => {
              haptic.impact('light');
              setFollow(id);
            }}
          />
        )}
        {tab === 'events' && live && <EventsFeed moments={live.moments} />}
        {tab === 'mine' && <MyEntries />}
        {tab === 'graphs' && <Charts />}
      </DragSheet>

      <Sheet open={channelsOpen} onClose={() => setChannelsOpen(false)} title={t('home.channels')} label={t('home.channels')}>
        <div className="lv-channels">
          {CHANNELS.map((ch) => {
            const m = CIRCUIT_META.find((c) => c.id === ch.circuitId);
            const active = ch.id === channelId;
            return (
              <div key={ch.id} className={`lv-ch ${active ? 'lv-ch--on' : ''}`}>
                <span className="lv-ch__flag">{flagEmoji(m?.countryCode ?? '')}</span>
                <div className="lv-ch__text">
                  <div className="lv-ch__title ellipsis">{ch.title[lang]}</div>
                  <div className="lv-ch__sub ellipsis">
                    {t(`session.${ch.sessionType}`)} · {m?.shortName ?? m?.name}
                  </div>
                </div>
                <button
                  type="button"
                  className="lv-ch__btn lv-ch__btn--live"
                  onClick={() => {
                    haptic.impact('medium');
                    setChannelsOpen(false);
                    setFollow(null);
                    void open(ch.id, 'live');
                  }}
                >
                  <i className="lv-live-dot" /> LIVE
                </button>
                <button
                  type="button"
                  className="lv-ch__btn"
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

      <Sheet
        open={driverPicker || !!pickList}
        onClose={() => (setDriverPicker(false), setSceneView({ pickList: null }))}
        title={pickList ? t('live.overlap') : t('live.pickDriver')}
        label={t('live.pickDriver')}
      >
        <div className="lv-drivers">
          {(live?.cars ?? [])
            .filter((c) => !pickList || pickList.includes(c.id))
            .map((c) => (
              <button
                key={c.id}
                type="button"
                className={`lv-drv ${c.id === followId ? 'lv-drv--on' : ''}`}
                style={{ ['--team' as string]: TEAM_BY_ID[DRIVER_BY_ID[c.id]!.teamId]!.color }}
                onClick={() => {
                  haptic.impact('light');
                  setFollow(c.id);
                  setDriverPicker(false);
                  setSceneView({ pickList: null });
                }}
              >
                <span className="lv-drv__pos num">{c.position}</span>
                <DriverAvatar id={c.id} size={32} />
                <span className="lv-drv__text">
                  <b className="ellipsis">{DRIVER_BY_ID[c.id]?.lastName}</b>
                  <small className="ellipsis">{TEAM_BY_ID[DRIVER_BY_ID[c.id]!.teamId]!.shortName}</small>
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

function WeatherIcon({ c }: { c: LiveState['weather']['condition'] }) {
  if (c === 'WET') return <IcRain size={13} />;
  if (c === 'CLOUDY') return <IcCloud size={13} />;
  return <IcSun size={13} style={{ color: 'var(--yellow)' }} />;
}

function flagItems(live: LiveState): Array<{ key: string; tone: 'sc' | 'red' | 'stale' | 'chequered'; icon: React.ReactNode; text: string }> {
  const out: Array<{ key: string; tone: 'sc' | 'red' | 'stale' | 'chequered'; icon: React.ReactNode; text: string }> = [];
  if (live.stale) out.push({ key: 'stale', tone: 'stale', icon: <IconWarning size={14} />, text: t('live.stale') });
  const ts = live.trackState;
  if (ts === 'RED') out.push({ key: 'red', tone: 'red', icon: <FlagGlyph color="#ff3b47" size={16} />, text: t('rc.RED') });
  else if (ts === 'SC' || ts === 'SC_ENDING') out.push({ key: 'sc', tone: 'sc', icon: <RcBadge text="SC" size={15} />, text: t(`rc.${ts}`) });
  else if (ts === 'VSC' || ts === 'VSC_ENDING') out.push({ key: 'vsc', tone: 'sc', icon: <RcBadge text="VSC" size={15} />, text: t(`rc.${ts}`) });
  else if (ts === 'CHEQUERED') out.push({ key: 'cheq', tone: 'chequered', icon: <FlagGlyph chequered size={16} />, text: t('rc.CHEQUERED') });
  if (ts === 'GREEN') live.sectorFlags.forEach((on, i) => on && out.push({ key: `y${i}`, tone: 'sc', icon: <FlagGlyph color="#ffd12e" size={15} />, text: t('rc.yellow', { s: i + 1 }) }));
  return out;
}

function Rail({ onDirector }: { onDirector: () => void }) {
  const camera = useSettings((s) => s.camera);
  const renderMode = useSettings((s) => s.renderMode);
  const showZones = useSettings((s) => s.showZones);
  const setSettings = useSettings((s) => s.set);
  const [camMenu, setCamMenu] = useState(false);
  const CamIcon = CAMERA_ICON[camera];
  return (
    <>
      <div className="lv-rail">
        <button type="button" className={`lv-rail__btn ${camMenu ? 'lv-rail__btn--on' : ''}`} aria-label={t('live.camera')} aria-expanded={camMenu} onClick={() => (haptic.tap(), setCamMenu(!camMenu))}>
          {CamIcon && <CamIcon size={20} />}
        </button>
        <button
          type="button"
          className={`lv-rail__btn ${showZones ? 'lv-rail__btn--on' : ''}`}
          aria-label={t('live.zones')}
          aria-pressed={showZones}
          onClick={() => {
            haptic.tap();
            setSettings({ showZones: !showZones });
          }}
        >
          <IconLayers size={20} />
        </button>
        <button
          type="button"
          className="lv-rail__btn"
          aria-label={renderMode === '3d' ? t('live.view2d') : t('live.view3d')}
          onClick={() => {
            haptic.tap();
            setSettings({ renderMode: renderMode === '3d' ? '2d' : '3d' });
          }}
        >
          {renderMode === '3d' ? <IconMap size={20} /> : <span className="lv-rail__txt">3D</span>}
        </button>
        <button type="button" className="lv-rail__btn" aria-label={t('live.directorPanel')} onClick={() => (haptic.tap(), onDirector())}>
          <IconSettings size={20} />
        </button>
      </div>
      <AnimatePresence>
        {camMenu && (
          <>
            <motion.button type="button" key="bd" className="lv-cam-bd" aria-label={t('ui.close')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCamMenu(false)} />
            <motion.div key="menu" className="lv-cam" initial={{ opacity: 0, x: 16, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 16, scale: 0.96 }} transition={{ duration: 0.18 }} role="menu" aria-label={t('live.camera')}>
              <div className="lv-cam__title">{t('live.camera')}</div>
              <div className="lv-cam__grid">
                {CAMS.map((c) => {
                  const I = CAMERA_ICON[c];
                  return (
                    <button
                      key={c}
                      type="button"
                      role="menuitemradio"
                      aria-checked={camera === c}
                      className={`lv-cam__item ${camera === c ? 'lv-cam__item--on' : ''}`}
                      onClick={() => {
                        haptic.impact('light');
                        sfx.select();
                        setSettings({ camera: c });
                        setCamMenu(false);
                      }}
                    >
                      {I && <I size={22} />}
                      <span>{t(`live.cam.${c}`)}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

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
        <div className="lv-lights" role="img" aria-label={`${n}/5`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="lv-lights__col">
              <span className={i <= n ? 'on' : ''} />
              <span className={i <= n ? 'on' : ''} />
            </div>
          ))}
        </div>
      )}
      <AnimatePresence>
        {splash && (
          <motion.div className="lv-splash" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.4, opacity: 0 }}>
            {t('live.lightsOut')}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const BIG_KINDS = new Set<Moment['kind']>(['SC', 'VSC', 'RED', 'FINISH']);

function MomentStack() {
  const [items, setItems] = useState<Array<Moment & { big: boolean; tag: string | null }>>([]);
  const battles = useRef(0);
  useEffect(
    () =>
      onMoment((m) => {
        const { followId, rivalId } = useLive.getState();
        const involved = m.drivers.some((d) => d === followId || d === rivalId);
        if (m.kind === 'BATTLE' && !involved && battles.current++ % 2 === 1) return;
        if (m.kind === 'TRACK_LIMITS' && !involved) return;
        const big = (m.kind === 'OVERTAKE' && involved) || BIG_KINDS.has(m.kind);
        let tag: string | null = null;
        if (m.kind === 'OVERTAKE' && involved) {
          tag = t('lv.tag.overtake');
          haptic.impact('medium');
        } else if (m.kind === 'SC' || m.kind === 'VSC' || m.kind === 'RED') {
          tag = m.kind === 'RED' ? t('lv.tag.red') : m.kind;
          haptic.notify('warning');
          sfx.warn();
        } else if (m.kind === 'FASTEST_LAP') {
          tag = t('lv.tag.fastest');
          if (involved) haptic.impact('light');
        } else if (m.kind === 'BATTLE') tag = t('lv.tag.battle');
        else if (m.kind === 'PIT' && involved) haptic.impact('light');
        setItems((x) => [...x.slice(-1), { ...m, big, tag }]);
        setTimeout(() => setItems((x) => x.filter((i) => i.id !== m.id)), big ? 4200 : 3200);
      }),
    [],
  );
  return (
    <div className="lv-moments" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((m) => (
          <motion.div
            key={m.id}
            layout
            className={`lv-moment ${m.big ? 'lv-moment--big' : ''} lv-moment--${m.kind.toLowerCase()}`}
            style={{ ['--tone' as string]: MOMENT_TONE[m.kind] ?? 'var(--stroke-2)' }}
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <span className="lv-moment__icon">
              <MomentIcon kind={m.kind} size={18} />
            </span>
            <span className="lv-moment__text">{momentText(m)}</span>
            {m.tag && <span className="lv-moment__tag">{m.tag}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
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
    <div className="lv-replay">
      <button
        type="button"
        className="lv-replay__play"
        aria-label={runner.paused ? t('live.play') : t('live.pause')}
        onClick={() => {
          haptic.tap();
          runner.setPaused(!runner.paused);
          force((n) => n + 1);
        }}
      >
        {runner.paused ? <IconPlay size={18} /> : <IconPause size={18} />}
      </button>
      <div className="lv-replay__speeds" role="radiogroup" aria-label={t('live.replaySpeed')}>
        {speeds.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={runner.speed === s}
            className={`lv-replay__speed num ${runner.speed === s ? 'lv-replay__speed--on' : ''}`}
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
      <button type="button" className="lv-replay__live" onClick={() => void open(channelId, 'live')}>
        <IconFast size={14} /> {t('live.goLive')}
      </button>
    </div>
  );
}

function DirectorPanel({ onClose }: { onClose: () => void }) {
  const runner = useLive((s) => s.runner);
  const sim = runner?.sim as unknown as { trigger?: (k: 'SC' | 'VSC' | 'RED' | 'RETIRE') => void } | undefined;
  return (
    <div className="lv-dir">
      <p className="lv-dir__note">{t('app.demoNote')}</p>
      <div className="lv-dir__grid">
        {(['SC', 'VSC', 'RED'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="lv-dir__btn"
            disabled={!sim?.trigger}
            onClick={() => {
              haptic.impact('medium');
              sim?.trigger?.(k);
              onClose();
            }}
          >
            {k === 'RED' ? <FlagGlyph color="#ff3b47" size={20} /> : <RcBadge text={k} size={18} />}
            <span>{t(`live.trigger.${k.toLowerCase()}`)}</span>
          </button>
        ))}
        <button
          type="button"
          className="lv-dir__btn"
          onClick={() => {
            haptic.impact('medium');
            runner?.setStale(true);
            setTimeout(() => runner?.setStale(false), 12000);
            onClose();
          }}
        >
          <IconWarning size={20} />
          <span>{t('live.trigger.stale')}</span>
        </button>
        <button
          type="button"
          className="lv-dir__btn"
          onClick={() => {
            getScene()?.loseContext();
            onClose();
          }}
        >
          <IconEye size={20} />
          <span>{t('live.trigger.webgl')}</span>
        </button>
      </div>
      <div className="lv-dir__foot">
        <IconEye size={14} /> {t('live.approxNote')}
      </div>
    </div>
  );
}
