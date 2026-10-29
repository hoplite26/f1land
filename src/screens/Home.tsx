import { useMemo, type ReactNode } from 'react';
import { useLive } from '@/store/live';
import { useNav } from '@/store/nav';
import { usePools, multiplier, type LivePool } from '@/demo/poolEngine';
import { levelFromXp, useWallet } from '@/store/wallet';
import { useSettings, prefersReducedMotion } from '@/store/settings';
import { CHANNELS, type DemoChannel } from '@/demo/channels';
import { SEASON_2026, currentOrNextMeeting } from '@/data/calendar';
import { CIRCUIT_META } from '@/data/circuits';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import { flagEmoji, fmtClock, fmtCompact, fmtCountdown, fmtDate, fmtGap, fmtLap, fmtNumber, getLang, t } from '@/i18n/core';
import { Header } from '@/app/Header';
import { useMapCars, useSessionNow } from '@/app/hooks';
import { poolTexts } from '@/app/poolText';
import { Card, Section, TeamBar, TyreBadge } from '@/ui/kit';
import { TrackMap } from '@/ui/TrackMap';
import {
  IconArrow,
  IconBroadcast,
  IconCalendar,
  IconChart,
  IconChevron,
  IconCoin,
  IconBolt,
  IconGift,
  IconHelmet,
  IconSwap,
  IconTicket,
  IconTimer,
  IconTrophy,
  IconTyre,
  IconUsers,
} from '@/ui/icons';
import { msUntilLock } from '@/domain/lifecycle';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import type { LiveState } from '@/sim/types';
import '@/styles/home.css';

const QUICK_MARKETS = [
  { market: 'F1-M14', key: 'f1.market.m14.title', icon: IconTrophy },
  { market: 'F1-M11', key: 'f1.market.m11.title', icon: IconTarget2 },
  { market: 'F1-M09', key: 'f1.market.m09.title', icon: IconTimer },
  { market: 'F1-M07', key: 'f1.market.m07.title', icon: IconSwap },
  { market: 'F1-M10', key: 'f1.market.m10.title', icon: IconBolt },
  { market: 'F1-M05', key: 'f1.market.m05.title', icon: IconChart },
] as const;

export function HomeScreen() {
  const live = useLive((s) => s.live);
  const runner = useLive((s) => s.runner);
  const loading = useLive((s) => s.loading);
  const progress = useLive((s) => s.progress);
  const channelId = useLive((s) => s.channelId);
  const followId = useLive((s) => s.followId);
  const go = useNav((s) => s.go);
  const push = useNav((s) => s.push);
  const pools = usePools((s) => s.pools);
  const balance = useWallet((s) => s.balance);
  const xp = useWallet((s) => s.xp);
  const entries = useWallet((s) => s.entries);
  const now = useSessionNow();
  const lang = getLang();
  const channel = CHANNELS.find((c) => c.id === channelId)!;
  const meta = CIRCUIT_META.find((c) => c.id === channel.circuitId);
  const circuit = runner?.circuit;
  const mapCars = useMapCars(live, followId, null, live?.cars.slice(0, 3).map((c) => c.id) ?? []);
  const isQuali = channel.sessionType === 'QUALIFYING' || channel.sessionType === 'SPRINT_QUALIFYING';

  const featured = useMemo(() => {
    const open = pools.filter((p) => p.pool.status === 'OPEN' && p.pool.intake_status === 'ACCEPTING');
    return open.sort((a, b) => b.priority - a.priority)[0] ?? null;
  }, [pools]);

  const meeting = currentOrNextMeeting(Date.now());
  const upcoming = useMemo(() => {
    const nowMs = Date.now();
    const list: Array<{ meeting: (typeof SEASON_2026)[number]; session: (typeof SEASON_2026)[number]['sessions'][number] }> = [];
    for (const m of SEASON_2026) for (const s of m.sessions) if (Date.parse(s.endsAt) > nowMs) list.push({ meeting: m, session: s });
    return list.slice(0, 3);
  }, []);

  const pending = entries.filter((e) => e.state === 'PENDING');
  const pendingStake = pending.reduce((a, e) => a + e.stake, 0);
  const lvl = levelFromXp(xp);
  const watching = useMemo(() => 18000 + ((channelId.length * 7919 + Math.floor(Date.now() / 60000) * 37) % 9000), [channelId, live?.leaderLap]);

  return (
    <div className="home">
      <Header />

      {/* ---------------- Live hero ---------------- */}
      <Card glow pad={false} className="hero" onClick={() => go('live')} ariaLabel={`${t('home.liveNow')}: ${channel.title[lang]}`}>
        <div className="hero__head">
          <span className="badge badge--live">LIVE</span>
          <div className="hero__titles">
            <div className="hero__title clamp-2">{channel.title[lang]}</div>
            <div className="hero__sub ellipsis">{circuit?.name ?? meta?.name}</div>
          </div>
          {live && !isQuali && live.totalLaps !== null && (
            <div className="lap-pill">
              <span>{t('live.lap')}</span> <b className="num">{Math.max(1, Math.min(live.leaderLap, live.totalLaps))}</b>
              <span className="num">/{live.totalLaps}</span>
            </div>
          )}
          {live?.segment && (
            <div className="lap-pill">
              <span>{live.segment.id}</span> <b className="num">{fmtCountdown(live.segment.remainingMs)}</b>
            </div>
          )}
        </div>
        {live && live.trackState !== 'GREEN' && live.trackState !== 'CHEQUERED' && (
          <div className={`statusbar ${live.trackState === 'RED' ? 'statusbar--red' : 'statusbar--sc'} hero__status`}>{t(`rc.${live.trackState}`)}</div>
        )}
        <div className="hero__body">
          <div className="mini-tower" aria-label={t('home.liveTiming')}>
            {live
              ? live.cars.slice(0, 5).map((c) => (
                  <div className={`mini-tower__row ${c.id === followId ? 'mini-tower__row--follow' : ''}`} key={c.id}>
                    <span className="num mini-tower__pos">{c.position}</span>
                    <TeamBar id={c.id} />
                    <span className="mini-tower__code">{DRIVER_BY_ID[c.id]?.code}</span>
                    <span className="num mini-tower__gap">
                      {c.position === 1 ? (isQuali ? fmtLap(c.segmentBestMs ?? null) : t('home2.leader')) : c.gapMs !== null ? fmtGap(c.gapMs, 1) : '—'}
                    </span>
                  </div>
                ))
              : [0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton mini-tower__skel" />)}
            <button
              className="mini-tower__btn"
              onClick={(e) => {
                e.stopPropagation();
                haptic.tap();
                go('live');
              }}
            >
              <span className="ellipsis">{t('home.liveTiming')}</span>
              <IconChevron size={14} />
            </button>
          </div>
          <div className="hero__map">
            {circuit ? (
              <>
                <TrackMap circuit={circuit} cars={mapCars} width={220} height={190} padding={14} stale={live?.stale} showZones={false} />
                {!live && (
                  <span className="hero__sync">
                    <span>{t('ui.syncing')}</span>
                    <b className="num">{Math.round(progress * 100)}%</b>
                    <span className="hero__sync-bar">
                      <span style={{ width: `${Math.round(progress * 100)}%` }} />
                    </span>
                  </span>
                )}
                {live && (
                  <span className="hero__temp num">
                    {t('live.trackTemp')} {Math.round(live.weather.trackC)}°C
                  </span>
                )}
                {meta && (
                  <span className="hero__circuit">
                    <b>{meta.shortName}</b>
                    <span className="num">
                      {(meta.lengthM / 1000).toFixed(3)} km · {live?.totalLaps ?? meta.laps} {t('live.lapsShort')}
                    </span>
                  </span>
                )}
              </>
            ) : (
              <div className="center-fill">
                <div className="loader-ring" />
                <div className="muted hero__loading">{loading ? `${t('ui.syncing')} ${Math.round(progress * 100)}%` : t('home2.loadingSession')}</div>
              </div>
            )}
          </div>
        </div>
        <div className="hero__foot">
          <span className="ellipsis">{t('app.tagline')}</span>
          <span className="hero__watch">
            <IconUsers size={14} /> {t('ui.watching', { n: fmtCompact(watching) })}
          </span>
        </div>
      </Card>

      {/* ---------------- Featured pool ---------------- */}
      {featured ? (
        <FeaturedPool lp={featured} now={now} onOpen={() => push({ name: 'pool', channelId, poolId: featured.pool.pool_id })} />
      ) : live ? (
        <Card className="featured featured--empty" onClick={() => go('live')} ariaLabel={t('pool.liveMarkets')}>
          <span className="featured__coin">
            <IconTrophy size={18} />
          </span>
          <div className="featured__main">
            <div className="featured__kicker">{t('home.featuredPool')}</div>
            <div className="featured__desc">{t('pool.noPools')}</div>
          </div>
          <IconChevron size={16} />
        </Card>
      ) : (
        <div className="skeleton featured-skel" aria-hidden="true" />
      )}

      {/* ---------------- Race stats ---------------- */}
      {live && <StatTiles live={live} isQuali={isQuali} />}

      {/* ---------------- Active picks ---------------- */}
      {pending.length > 0 && (
        <Card className="picks" onClick={() => go('pools')} ariaLabel={t('home2.yourPicks')}>
          <span className="picks__icon">
            <IconTicket size={22} />
          </span>
          <div className="picks__text">
            <div className="picks__title">{t('home2.yourPicks')}</div>
            <div className="muted picks__sub">{t('home2.yourPicksSub', { n: pending.length, s: fmtNumber(pendingStake) })}</div>
          </div>
          <span className="picks__count num">{pending.length}</span>
          <IconChevron size={16} />
        </Card>
      )}

      {/* ---------------- Live channels ---------------- */}
      <Section
        kicker={
          <span className="sec-kicker">
            <IconBroadcast size={14} /> {t('home.liveRacesSub')}
          </span>
        }
        title={t('home.liveRaces')}
        action={<span className="muted num home__count">{CHANNELS.length}</span>}
      >
        <div className="hscroll channels">
          {CHANNELS.map((ch) => (
            <ChannelCard key={ch.id} ch={ch} active={ch.id === channelId} live={ch.id === channelId ? live : null} />
          ))}
        </div>
      </Section>

      {/* ---------------- Upcoming + rewards ---------------- */}
      <div className="grid-2 home__pair">
        <Card className="tile" onClick={() => push({ name: 'meeting', meetingId: meeting.id })} ariaLabel={t('home.upcoming')}>
          <div className="tile__head">
            <span className="tile__icon">
              <IconCalendar size={18} />
            </span>
            <IconChevron size={16} className="icon muted" />
          </div>
          <div className="tile__title">{t('home.upcoming')}</div>
          <div className="tile__sub muted">{t('home.upcomingSub')}</div>
          <div className="upcoming">
            {upcoming.slice(0, 2).map(({ meeting: m, session: s }, i, arr) => (
              <div key={s.id} className="upcoming__item">
                {arr[i - 1]?.meeting.id !== m.id && (
                  <div className="upcoming__meeting">
                    <span className="upcoming__flag">{flagEmoji(m.countryCode)}</span>
                    <span className="ellipsis">{m.name[lang]}</span>
                  </div>
                )}
                <div className="upcoming-row">
                  <span className="upcoming-row__kind ellipsis">{t(`session.${s.kind}`)}</span>
                  <span className="num upcoming-row__when">
                    {dayLabel(Date.parse(s.startsAt))} <b className="lime">{fmtClock(Date.parse(s.startsAt))}</b>
                  </span>
                </div>
              </div>
            ))}
            {upcoming.length === 0 && <div className="muted">—</div>}
          </div>
        </Card>
        <Card className="tile tile--rewards" onClick={() => push({ name: 'rewards' })} ariaLabel={t('home.rewards')}>
          <div className="tile__head">
            <span className="tile__icon">
              <IconGift size={18} />
            </span>
            <span className="badge badge--lime tile__lvl">{t('shell.level', { n: lvl.level })}</span>
          </div>
          <div className="tile__title">{t('home.rewards')}</div>
          <div className="tile__sub muted">{t('home.rewardsSub')}</div>
          <CoinStack />
          <div className="points">
            <span className="kv__k">{t('home.yourPoints')}</span>
            <span className="points__v num">
              <IconCoin size={15} className="icon lime" /> {fmtNumber(balance)}
            </span>
            <span className="points__bar" aria-hidden="true">
              <span style={{ width: `${Math.round((lvl.into / Math.max(1, lvl.need)) * 100)}%` }} />
            </span>
          </div>
        </Card>
      </div>

      {/* ---------------- Quick markets ---------------- */}
      <Section
        kicker={
          <span className="sec-kicker">
            <IconBolt size={14} /> {t('home.quickSub')}
          </span>
        }
        title={t('home.quick')}
      >
        <div className="grid-3 quick-grid">
          {QUICK_MARKETS.map((q) => {
            const lp = pools.find((p) => p.pool.market_id === q.market && p.pool.status === 'OPEN');
            // Only outcomes that already hold stakes give a meaningful "up to" multiplier.
            const staked = lp ? lp.pool.outcomes.filter((o) => (lp.book.stakes[o.id] ?? 0) > 0) : [];
            const best = lp && staked.length ? Math.max(...staked.map((o) => multiplier(lp.book, o.id))) : null;
            const label = t(q.key);
            const Icon = q.icon;
            return (
              <Card
                key={q.market}
                className={`quick ${lp ? 'quick--open' : ''}`}
                onClick={() => (lp ? push({ name: 'pool', channelId, poolId: lp.pool.pool_id }) : go('live'))}
                ariaLabel={label}
              >
                <span className="quick__icon">
                  <Icon size={22} />
                </span>
                <span className="quick__label clamp-2">{label}</span>
                <span className={`quick__state num ${lp ? 'lime' : 'muted'}`}>
                  {lp ? (best ? t('home2.upTo', { x: best.toFixed(1) }) : t('pool.open')) : t('home2.soon')}
                </span>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* ---------------- Promo ---------------- */}
      <Card className="promo" onClick={() => push({ name: 'leaderboard' })} ariaLabel={t('lb.title')}>
        <HelmetArt className="promo__helmet" />
        <div className="promo__body">
          <div className="promo__title">{t('home.promoTitle')}</div>
          <div className="promo__script">{t('home2.promoScript')}</div>
          <div className="promo__kicker">PULSE ARENA · {t('lb.title')}</div>
        </div>
        <IconChevron size={18} className="icon promo__chev" />
      </Card>
      <p className="home__note muted">{t('app.demoNote')}</p>
    </div>
  );
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return t('ui.today');
  if (diff === 1) return t('ui.tomorrow');
  return fmtDate(ms, { weekday: 'short', day: 'numeric' });
}

function splitHms(ms: number): [string, string, string] {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return [p(Math.min(99, Math.floor(s / 3600))), p(Math.floor((s % 3600) / 60)), p(s % 60)];
}

function FeaturedPool({ lp, now, onOpen }: { lp: LivePool; now: number; onOpen: () => void }) {
  const tx = poolTexts(lp.pool);
  const ms = msUntilLock(lp.pool, now);
  const [h, m, s] = splitHms(ms);
  const prize = Object.values(lp.book.stakes).reduce((a, b) => a + b, 0);
  const urgent = ms < 10_000;
  return (
    <Card className="featured" onClick={onOpen} ariaLabel={`${t('home.featuredPool')}: ${tx.question}`}>
      <div className="featured__bg" aria-hidden="true">
        <IconHelmet size={170} />
      </div>
      <div className="featured__top">
        <div className="featured__main">
          <div className="featured__kicker">
            <IconTrophy size={15} /> {t('home.featuredPool')}
          </div>
          <div className="featured__tag ellipsis">{tx.title}</div>
          <div className="featured__title">{tx.question}</div>
          <div className="featured__desc">{t('home2.featuredDesc')}</div>
        </div>
        <div className={`lockbox ${urgent ? 'lockbox--urgent' : ''}`} role="timer" aria-label={`${t('home.locksIn')} ${h}:${m}:${s}`}>
          <span className="lockbox__k">{t('home.locksIn')}</span>
          <div className="lockbox__cells">
            {[
              [h, 'home2.hrs'],
              [m, 'home2.min'],
              [s, 'home2.sec'],
            ].map(([v, k]) => (
              <span className="lockbox__cell" key={k}>
                <b className="num">{v}</b>
                <small>{t(k!)}</small>
              </span>
            ))}
          </div>
          <span className="lockbox__joined">
            <IconUsers size={13} /> {t('ui.joined', { n: fmtNumber(lp.book.players) })}
          </span>
        </div>
      </div>
      <div className="featured__bottom">
        <div className="featured__prize">
          <span className="featured__coin">
            <IconCoin size={18} />
          </span>
          <span className="featured__prize-text">
            <span className="kv__k">{t('pool.prize')}</span>
            <b className="num">{fmtNumber(prize)}</b>
          </span>
        </div>
        <button
          className="btn btn--primary featured__cta"
          onClick={(e) => {
            e.stopPropagation();
            haptic.impact('medium');
            sfx.select();
            onOpen();
          }}
        >
          {t('home.joinPool')} <IconArrow size={18} />
        </button>
      </div>
    </Card>
  );
}

function StatTiles({ live, isQuali }: { live: LiveState; isQuali: boolean }) {
  const leader = live.cars[0];
  const battle = useMemo(() => {
    let best: { a: string; b: string; gap: number; pos: number } | null = null;
    for (let i = 1; i < Math.min(10, live.cars.length); i++) {
      const c = live.cars[i]!;
      if (c.intervalMs === null || c.status !== 'ACTIVE') continue;
      if (!best || c.intervalMs < best.gap) best = { a: live.cars[i - 1]!.id, b: c.id, gap: c.intervalMs, pos: i };
    }
    return best && best.gap < 5000 ? best : null;
  }, [live]);

  if (isQuali) {
    const cut = live.segment ? live.cars[live.segment.cutPosition - 1] : undefined;
    return (
      <div className="grid-3 stats">
        <StatTile icon={<IconTimer size={15} />} tone="purple" label={t('live.bestLap')}>
          {leader?.segmentBestMs ? (
            <>
              <span className="stat__who ellipsis">{DRIVER_BY_ID[leader.id]?.lastName}</span>
              <span className="stat__v num purple">{fmtLap(leader.segmentBestMs)}</span>
            </>
          ) : (
            <StatEmpty text={t('home2.awaitLap')} />
          )}
        </StatTile>
        <StatTile icon={<IconChart size={15} />} tone="lime" label={t('live.segment')}>
          {live.segment ? (
            <>
              <span className="stat__who">{live.segment.id}</span>
              <span className="stat__v num lime">{fmtCountdown(live.segment.remainingMs)}</span>
            </>
          ) : (
            <StatEmpty text="—" />
          )}
        </StatTile>
        <StatTile icon={<IconSwap size={15} />} tone="cyan" label={t('live.cut')}>
          {cut && live.segment ? (
            <>
              <span className="stat__who">P{live.segment.cutPosition}</span>
              <span className="stat__v num cyan">{DRIVER_BY_ID[cut.id]?.code}</span>
            </>
          ) : (
            <StatEmpty text="—" />
          )}
        </StatTile>
      </div>
    );
  }

  return (
    <div className="grid-3 stats">
      <StatTile icon={<IconTimer size={15} />} tone="purple" label={t('home.fastest')}>
        {live.fastestLap ? (
          <>
            <span className="stat__who ellipsis">{DRIVER_BY_ID[live.fastestLap.driverId]?.lastName}</span>
            <span className="stat__v num purple">{fmtLap(live.fastestLap.ms)}</span>
          </>
        ) : (
          <StatEmpty text={t('home2.awaitLap')} />
        )}
      </StatTile>
      <StatTile icon={<IconTyre size={15} />} tone="yellow" label={t('home.tyres')}>
        {leader ? (
          <>
            <span className="stat__tyre">
              <TyreBadge compound={leader.tyre} size={26} />
              <span className="muted num stat__small">
                {leader.tyreAgeLaps} {t('live.lapsShort')}
              </span>
            </span>
            <span className="stat__who ellipsis">{t(`tyre.${leader.tyre.toLowerCase()}`)}</span>
          </>
        ) : (
          <StatEmpty text="—" />
        )}
      </StatTile>
      <StatTile icon={<IconSwap size={15} />} tone="cyan" label={t('home.battle', { p: battle ? battle.pos : 2 })}>
        {battle ? (
          <>
            <span className="stat__who">
              {DRIVER_BY_ID[battle.b]?.code} <small className="muted">vs</small> {DRIVER_BY_ID[battle.a]?.code}
            </span>
            <span className="stat__v num cyan">{(battle.gap / 1000).toFixed(1)}s</span>
          </>
        ) : (
          <StatEmpty text={t('home2.noBattle')} />
        )}
      </StatTile>
    </div>
  );
}

function StatTile({ icon, label, tone, children }: { icon: ReactNode; label: string; tone: 'purple' | 'cyan' | 'lime' | 'yellow'; children: ReactNode }) {
  return (
    <div className={`card stat stat--${tone}`}>
      <div className="stat__k">
        <span className="stat__icon">{icon}</span>
        <span className="clamp-2">{label}</span>
      </div>
      <div className="stat__body">{children}</div>
    </div>
  );
}

function StatEmpty({ text }: { text: string }) {
  return (
    <span className="stat__empty">
      <span className="stat__dash num">–:––.–––</span>
      <span className="muted stat__small">{text}</span>
    </span>
  );
}

function ChannelCard({ ch, active, live }: { ch: DemoChannel; active: boolean; live: LiveState | null }) {
  const lang = getLang();
  const open = useLive((s) => s.open);
  const go = useNav((s) => s.go);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  const meta = CIRCUIT_META.find((c) => c.id === ch.circuitId);
  const isQuali = ch.sessionType === 'QUALIFYING' || ch.sessionType === 'SPRINT_QUALIFYING';
  const laps = ch.sessionType === 'SPRINT' ? (ch.laps ?? 17) : (ch.demoLaps ?? ch.laps ?? meta?.laps ?? 0);
  const leader = live?.cars[0];
  // Each card gets its own lap pace so the outline dots don't move in lockstep.
  const dur = `${6 + ((ch.offsetMin * 7) % 5)}s`;
  return (
    <Card
      className={`channel ${active ? 'channel--on' : ''}`}
      glow={active}
      onClick={() => {
        sfx.nav();
        void open(ch.id, 'live');
        go('live');
      }}
      ariaLabel={`${ch.title[lang]} · ${t(`session.${ch.sessionType}`)}`}
    >
      <div className="channel__top">
        <span className="channel__flag">{flagEmoji(meta?.countryCode ?? '')}</span>
        {active ? <span className="badge badge--lime channel__watch">{t('home2.nowWatching')}</span> : <span className="dot-live">LIVE</span>}
      </div>
      <div className="channel__map">
        {meta && (
          <svg viewBox="-4 -4 108 108" className="channel__svg" aria-hidden="true">
            <path d={meta.svgPath} className="channel__glow" />
            <path d={meta.svgPath} className="channel__line" />
            {!reduced && (
              <circle r="3.2" className="channel__car">
                <animateMotion dur={dur} repeatCount="indefinite" path={meta.svgPath} />
              </circle>
            )}
          </svg>
        )}
      </div>
      <div className="channel__title clamp-2">{ch.title[lang]}</div>
      <div className="channel__meta muted ellipsis">
        {t(`session.${ch.sessionType}`)} · {meta?.shortName}
      </div>
      <div className="channel__foot num">
        {active && live && !isQuali && live.totalLaps !== null ? (
          <>
            <span>
              {t('live.lap')} <b className="lime">{Math.max(1, Math.min(live.leaderLap, live.totalLaps))}</b>/{live.totalLaps}
            </span>
            {leader && (
              <span className="channel__leader">
                <TeamBar id={leader.id} />
                {DRIVER_BY_ID[leader.id]?.code}
              </span>
            )}
          </>
        ) : active && live?.segment ? (
          <>
            <span>{live.segment.id}</span>
            <b className="lime">{fmtCountdown(live.segment.remainingMs)}</b>
          </>
        ) : (
          <>
            <span>{isQuali ? 'Q1 · Q2 · Q3' : t('home2.laps', { n: laps })}</span>
            <span className="muted">{meta ? t('home2.km', { n: (meta.lengthM / 1000).toFixed(1) }) : ''}</span>
          </>
        )}
      </div>
    </Card>
  );
}

/** Stack of PULSE coins with the heartbeat mark. */
function CoinStack() {
  const coin = (x: number, y: number, s: number, o: number, cls = '') => (
    <g className={cls} transform={`translate(${x} ${y}) scale(${s})`} opacity={o}>
      <ellipse cx="0" cy="5" rx="20" ry="6" fill="#0a1004" />
      <rect x="-20" y="-1" width="40" height="6" fill="#3d5a12" />
      <ellipse cx="0" cy="-1" rx="20" ry="6" fill="url(#cs-face)" stroke="#c6ff3d" strokeWidth="1.2" />
      <path d="M-11 -1h5l2-4 3 8 3-6 1.5 2H11" fill="none" stroke="#0b1200" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
  return (
    <svg className="coins" viewBox="0 0 120 52" aria-hidden="true">
      <defs>
        <radialGradient id="cs-face" cx="0.4" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#efffb8" />
          <stop offset="1" stopColor="#8fd11a" />
        </radialGradient>
      </defs>
      {coin(78, 40, 1, 0.9)}
      {coin(78, 31, 1, 0.95)}
      {coin(46, 42, 0.8, 0.7)}
      {coin(78, 22, 1, 1, 'coins__top')}
    </svg>
  );
}

/** Decorative side-view race helmet in the brand palette. */
function HelmetArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 96" aria-hidden="true">
      <defs>
        <linearGradient id="ha-shell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2c3d18" />
          <stop offset="1" stopColor="#060805" />
        </linearGradient>
        <linearGradient id="ha-visor" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c6ff3d" />
          <stop offset="1" stopColor="#2fe6ff" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <path d="M14 62C14 32 36 12 66 12c24 0 42 16 42 40v14c0 6-5 11-11 11H38C24 77 14 71 14 62z" fill="url(#ha-shell)" stroke="#c6ff3d" strokeWidth="1.6" />
      <path d="M50 35h55c2.2 4.6 3 10.4 3 17H54c-4 0-6-3-6-6v-5c0-3 .8-6 2-6z" fill="#04060a" stroke="#c6ff3d" strokeWidth="1.2" />
      <path d="M55 39.5h48" stroke="url(#ha-visor)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M18 58c10-3 24-3 34 0" stroke="#c6ff3d" strokeWidth="2.4" fill="none" opacity="0.85" />
      <path d="M25 30c8-9 20-14 32-14" stroke="#2fe6ff" strokeWidth="2" fill="none" opacity="0.7" />
      <path d="M38 77l-3 8h60l3-8" fill="#0b0f12" stroke="rgba(198,255,61,.5)" strokeWidth="1.2" />
      <circle cx="96" cy="62" r="3" fill="#c6ff3d" />
    </svg>
  );
}

function IconTarget2({ size = 20 }: { size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

export { TEAM_BY_ID };
