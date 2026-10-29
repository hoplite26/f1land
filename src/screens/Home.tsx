import { useMemo } from 'react';
import { useLive } from '@/store/live';
import { useNav } from '@/store/nav';
import { usePools, multiplier } from '@/demo/poolEngine';
import { useWallet } from '@/store/wallet';
import { CHANNELS } from '@/demo/channels';
import { SEASON_2026, currentOrNextMeeting } from '@/data/calendar';
import { CIRCUIT_META } from '@/data/circuits';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import { flagEmoji, fmtClock, fmtCompact, fmtCountdown, fmtDate, fmtGap, fmtLap, fmtNumber, getLang, t } from '@/i18n/core';
import { Header } from '@/app/Header';
import { useMapCars, useSessionNow } from '@/app/hooks';
import { poolTexts } from '@/app/poolText';
import { Card, Section, TeamBar, TyreBadge } from '@/ui/kit';
import { TrackMap } from '@/ui/TrackMap';
import { IconChart, IconChevron, IconGift, IconPulse, IconTimer, IconTrophy, IconUsers, IconCalendar, IconBolt, IconTyre, IconSwap } from '@/ui/icons';
import { msUntilLock } from '@/domain/lifecycle';
import { haptic } from '@/telegram/sdk';

export function HomeScreen() {
  const live = useLive((s) => s.live);
  const runner = useLive((s) => s.runner);
  const loading = useLive((s) => s.loading);
  const progress = useLive((s) => s.progress);
  const channelId = useLive((s) => s.channelId);
  const followId = useLive((s) => s.followId);
  const open = useLive((s) => s.open);
  const go = useNav((s) => s.go);
  const push = useNav((s) => s.push);
  const pools = usePools((s) => s.pools);
  const balance = useWallet((s) => s.balance);
  const now = useSessionNow();
  const lang = getLang();
  const channel = CHANNELS.find((c) => c.id === channelId)!;
  const circuit = runner?.circuit;
  const mapCars = useMapCars(live, followId, null, live?.cars.slice(0, 3).map((c) => c.id) ?? []);

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

  const leader = live?.cars[0];
  const battle = useMemo(() => {
    if (!live) return null;
    let best: { a: string; b: string; gap: number; pos: number } | null = null;
    for (let i = 1; i < Math.min(10, live.cars.length); i++) {
      const c = live.cars[i]!;
      if (c.intervalMs === null || c.status !== 'ACTIVE') continue;
      if (!best || c.intervalMs < best.gap) best = { a: live.cars[i - 1]!.id, b: c.id, gap: c.intervalMs, pos: i };
    }
    return best;
  }, [live]);

  const watching = useMemo(() => 18000 + ((channelId.length * 7919 + Math.floor(Date.now() / 60000) * 37) % 9000), [channelId, live?.leaderLap]);
  const isQuali = channel.sessionType === 'QUALIFYING' || channel.sessionType === 'SPRINT_QUALIFYING';

  return (
    <>
      <Header />
      <Card glow pad={false} className="hero" onClick={() => go('live')} ariaLabel={t('home.liveNow')}>
        <div className="hero__head">
          <span className="badge badge--live">LIVE</span>
          <div style={{ minWidth: 0 }}>
            <div className="hero__title">{channel.title[lang]}</div>
            <div className="hero__sub">{circuit?.name ?? CIRCUIT_META.find((c) => c.id === channel.circuitId)?.name}</div>
          </div>
          {live && !isQuali && (
            <div className="lap-pill">
              {t('live.lap').toUpperCase()} <b className="num">{live.leaderLap}</b> / {live.totalLaps}
            </div>
          )}
          {live?.segment && (
            <div className="lap-pill">
              {live.segment.id} <b className="num">{fmtCountdown(live.segment.remainingMs)}</b>
            </div>
          )}
        </div>
        {live && live.trackState !== 'GREEN' && live.trackState !== 'CHEQUERED' && (
          <div className={`statusbar ${live.trackState === 'RED' ? 'statusbar--red' : 'statusbar--sc'}`} style={{ marginTop: 10 }}>
            {t(`rc.${live.trackState}`)}
          </div>
        )}
        <div className="hero__body">
          <div className="mini-tower" aria-label={t('home.liveTiming')}>
            {(live?.cars.slice(0, 5) ?? []).map((c) => (
              <div className="mini-tower__row" key={c.id}>
                <span className="num">{c.position}</span>
                <TeamBar id={c.id} />
                <span>{DRIVER_BY_ID[c.id]?.code}</span>
                <span className="num">{c.position === 1 ? (isQuali ? fmtLap(c.segmentBestMs ?? null) : '') : c.gapMs !== null ? fmtGap(c.gapMs, 1) : '—'}</span>
              </div>
            ))}
            {!live && [0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 22, margin: '2px 0' }} />)}
            <button
              className="chip"
              style={{ marginTop: 'auto', height: 30, fontSize: 12 }}
              onClick={(e) => {
                e.stopPropagation();
                haptic.tap();
                go('live');
              }}
            >
              {t('home.liveTiming')} <IconChevron size={14} />
            </button>
          </div>
          <div className="hero__map">
            {circuit ? (
              <TrackMap circuit={circuit} cars={mapCars} width={220} height={190} padding={12} stale={live?.stale} />
            ) : (
              <div className="center-fill">
                <div className="loader-ring" />
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {loading ? `${t('ui.syncing')} ${Math.round(progress * 100)}%` : t('ui.loading')}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="hero__foot">
          <span>{t('app.tagline')}</span>
          <span className="row" style={{ gap: 5, letterSpacing: '.05em' }}>
            <IconUsers size={14} /> {t('ui.watching', { n: fmtCompact(watching) })}
          </span>
        </div>
      </Card>

      {featured && (
        <Card
          className="featured"
          cyan
          onClick={() => push({ name: 'pool', channelId, poolId: featured.pool.pool_id })}
          ariaLabel={poolTexts(featured.pool).title}
        >
          <div className="featured__bg" aria-hidden="true" />
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="section__kicker row" style={{ gap: 6, color: 'var(--lime)' }}>
                <IconTrophy size={15} /> {t('home.featuredPool')}
              </div>
              <div className="featured__title">{poolTexts(featured.pool).title}</div>
              <div className="featured__q">{poolTexts(featured.pool).question}</div>
            </div>
            <div className="countdown">
              <span className="countdown__k">{t('home.locksIn')}</span>
              <span className="countdown__v num">{fmtCountdown(msUntilLock(featured.pool, now))}</span>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div className="featured__prize">
              <span className="kv__k">{t('pool.prize')}</span>
              <span className="num lime" style={{ fontSize: 22, fontWeight: 700 }}>
                {fmtNumber(Object.values(featured.book.stakes).reduce((a, b) => a + b, 0))}
              </span>
            </div>
            <div className="muted row" style={{ gap: 5, fontSize: 12 }}>
              <IconUsers size={14} /> {t('ui.joined', { n: fmtNumber(featured.book.players) })}
            </div>
            <button className="btn btn--primary btn--sm" style={{ marginLeft: 'auto' }}>
              {t('home.joinPool')} →
            </button>
          </div>
        </Card>
      )}

      {live && !isQuali && (
        <div className="grid-3" style={{ marginTop: 10 }}>
          <Card>
            <div className="kv__k row" style={{ gap: 5 }}>
              <IconTimer size={14} className="icon purple" /> {t('home.fastest')}
            </div>
            <div style={{ fontWeight: 700, marginTop: 6, fontSize: 13 }}>{live.fastestLap ? DRIVER_BY_ID[live.fastestLap.driverId]?.lastName : '—'}</div>
            <div className="num purple" style={{ fontSize: 17, fontWeight: 700 }}>{fmtLap(live.fastestLap?.ms ?? null)}</div>
          </Card>
          <Card>
            <div className="kv__k row" style={{ gap: 5 }}>
              <IconTyre size={14} /> {t('home.tyres')}
            </div>
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <TyreBadge compound={leader?.tyre ?? null} size={26} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{leader ? t(`tyre.${leader.tyre.toLowerCase()}`) : '—'}</div>
                <div className="muted num" style={{ fontSize: 12 }}>
                  {leader?.tyreAgeLaps ?? 0} {t('live.lapsShort')}
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="kv__k row" style={{ gap: 5 }}>
              <IconSwap size={14} className="icon cyan" /> {t('home.battle', { p: battle ? battle.pos : 2 })}
            </div>
            <div style={{ fontWeight: 700, marginTop: 6, fontSize: 13 }}>{battle ? `${DRIVER_BY_ID[battle.b]?.code} vs ${DRIVER_BY_ID[battle.a]?.code}` : '—'}</div>
            <div className="num cyan" style={{ fontSize: 17, fontWeight: 700 }}>{battle ? `${(battle.gap / 1000).toFixed(1)}s` : '—'}</div>
          </Card>
        </div>
      )}

      <Section title={t('home.liveRaces')} kicker={t('home.liveRacesSub')}>
        <div className="hscroll">
          {CHANNELS.map((ch) => {
            const meta = CIRCUIT_META.find((c) => c.id === ch.circuitId);
            const active = ch.id === channelId;
            return (
              <Card
                key={ch.id}
                className={`channel ${active ? 'channel--on' : ''}`}
                glow={active}
                onClick={() => {
                  void open(ch.id, 'live');
                  go('live');
                }}
                ariaLabel={ch.title[lang]}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="flag">{flagEmoji(meta?.countryCode ?? '')}</span>
                  <span className="dot-live">LIVE</span>
                </div>
                <div className="channel__map">{meta && <svg viewBox="0 0 100 100" className="channel__svg"><path d={meta.svgPath} /></svg>}</div>
                <div className="channel__title">{ch.title[lang]}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t(`session.${ch.sessionType}`)} · {meta?.shortName}
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      <div className="grid-2">
        <Card onClick={() => push({ name: 'meeting', meetingId: meeting.id })} ariaLabel={t('home.upcoming')}>
          <div className="row" style={{ gap: 8 }}>
            <IconCalendar className="icon lime" />
            <div style={{ fontWeight: 700 }}>{t('home.upcoming')}</div>
          </div>
          <div className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
            {t('home.upcomingSub')}
          </div>
          {upcoming.slice(0, 2).map(({ meeting: m, session: s }) => (
            <div key={s.id} className="upcoming-row">
              <span className="flag" style={{ width: 26, height: 18, fontSize: 15 }}>
                {flagEmoji(m.countryCode)}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ellipsis" style={{ fontSize: 12, fontWeight: 700 }}>
                  {m.name[lang]}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {t(`session.${s.kind}`)}
                </div>
              </div>
              <div className="num" style={{ fontSize: 11, textAlign: 'right' }}>
                <div>{fmtDate(Date.parse(s.startsAt), { weekday: 'short', day: 'numeric' })}</div>
                <div className="lime">{fmtClock(Date.parse(s.startsAt))}</div>
              </div>
            </div>
          ))}
        </Card>
        <Card onClick={() => push({ name: 'rewards' })} ariaLabel={t('home.rewards')}>
          <div className="row" style={{ gap: 8 }}>
            <IconGift className="icon lime" />
            <div style={{ fontWeight: 700 }}>{t('home.rewards')}</div>
          </div>
          <div className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
            {t('home.rewardsSub')}
          </div>
          <div className="coins" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="kv" style={{ marginTop: 6 }}>
            <span className="kv__k">{t('home.yourPoints')}</span>
            <span className="kv__v num">{fmtNumber(balance)}</span>
          </div>
        </Card>
      </div>

      <Section title={t('home.quick')} kicker={t('home.quickSub')}>
        <div className="grid-3">
          {[
            { icon: <IconTrophy />, label: t('f1.market.m14.title'), market: 'F1-M14' },
            { icon: <IconTarget2 />, label: t('f1.market.m11.title'), market: 'F1-M11' },
            { icon: <IconTimer />, label: t('f1.market.m09.title'), market: 'F1-M09' },
            { icon: <IconSwap />, label: t('f1.market.m07.title'), market: 'F1-M07' },
            { icon: <IconBolt />, label: t('f1.market.m10.title'), market: 'F1-M10' },
            { icon: <IconChart />, label: t('f1.market.m05.title'), market: 'F1-M05' },
          ].map((q) => {
            const lp = pools.find((p) => p.pool.market_id === q.market && p.pool.status === 'OPEN');
            const best = lp ? Math.max(...lp.pool.outcomes.map((o) => multiplier(lp.book, o.id))) : null;
            return (
              <Card
                key={q.market}
                className="quick"
                onClick={() => (lp ? push({ name: 'pool', channelId, poolId: lp.pool.pool_id }) : go('live'))}
                ariaLabel={q.label}
              >
                <span className="quick__icon">{q.icon}</span>
                <span className="quick__label">{q.label}</span>
                <span className={`num ${lp ? 'lime' : 'muted'}`} style={{ fontSize: 12 }}>
                  {lp ? `${t('pool.open')} · ${best ? `≤${best.toFixed(1)}x` : ''}` : '—'}
                </span>
              </Card>
            );
          })}
        </div>
      </Section>

      <Card className="promo" onClick={() => push({ name: 'leaderboard' })} ariaLabel={t('lb.title')}>
        <div className="promo__helmet" aria-hidden="true">
          <IconPulse size={48} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="promo__title">{t('home.promoTitle')}</div>
          <div className="section__kicker" style={{ marginTop: 6 }}>
            PULSE ARENA · {t('lb.title')}
          </div>
        </div>
        <IconChevron />
      </Card>
      <p className="muted" style={{ fontSize: 11, textAlign: 'center', margin: '16px 8px 0' }}>
        {t('app.demoNote')}
      </p>
    </>
  );
}

function IconTarget2() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

export { TEAM_BY_ID };
