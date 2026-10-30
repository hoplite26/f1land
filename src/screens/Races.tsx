import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SEASON_2026, currentOrNextMeeting, meetingStatus, type CalendarSession, type Meeting, type MeetingStatus } from '@/data/calendar';
import { CHANNELS, channelLaps, getChannel, type DemoChannel } from '@/demo/channels';
import { usePools, multiplier, type LivePool } from '@/demo/poolEngine';
import { demoResults } from '@/demo/results';
import { previousStart } from '@/demo/schedule';
import { DRIVER_BY_ID } from '@/data/teams';
import { useNav } from '@/store/nav';
import { useLive } from '@/store/live';
import { Header, SubHeader } from '@/app/Header';
import { useSessionNow } from '@/app/hooks';
import { poolTexts } from '@/app/poolText';
import { msUntilLock } from '@/domain/lifecycle';
import { Card, DriverAvatar, Segmented, TeamBar, useNow } from '@/ui/kit';
import { TrackMap } from '@/ui/TrackMap';
import { IconCalendar, IconCheck, IconChevron, IconMap, IconPlay, IconTimer, IconTrophy, IconUsers } from '@/ui/icons';
import { flagEmoji, fmtClock, fmtCountdown, fmtDate, fmtDuration, fmtGap, fmtLap, fmtNumber, fmtOdds, getLang, t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { CircuitThumb, Empty, PageHead, Reveal, StatusPill, meetingDates, meetingName, safeMeta, useBack, useCircuit } from './common';

type Filter = 'all' | 'upcoming' | 'completed';

const pad2 = (n: number) => String(n).padStart(2, '0');

export function channelFor(m: Meeting, s?: CalendarSession): DemoChannel | undefined {
  return CHANNELS.find((c) => c.meetingRound === m.round && (!s || c.sessionType === s.sessionType));
}

export function watchChannel(ch: DemoChannel): void {
  haptic.impact('medium');
  sfx.nav();
  void useLive.getState().open(ch.id);
  useNav.getState().go('live');
}

type SessState = 'done' | 'live' | 'upcoming';
function sessState(s: CalendarSession, now: number): SessState {
  if (now >= Date.parse(s.endsAt)) return 'done';
  if (now >= Date.parse(s.startsAt)) return 'live';
  return 'upcoming';
}

/** Live session of the meeting, else the next one not yet started. */
function focusSession(m: Meeting, now: number): { s: CalendarSession; live: boolean } | null {
  const live = m.sessions.find((s) => sessState(s, now) === 'live');
  if (live) return { s: live, live: true };
  const next = m.sessions.find((s) => sessState(s, now) === 'upcoming');
  return next ? { s: next, live: false } : null;
}

function BigCountdown({ ms }: { ms: number }) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const parts: Array<[number, string]> = [
    [Math.floor(total / 86400), 'scr.cd.d'],
    [Math.floor((total % 86400) / 3600), 'scr.cd.h'],
    [Math.floor((total % 3600) / 60), 'scr.cd.m'],
    [total % 60, 'scr.cd.s'],
  ];
  return (
    <div className="sc-cd" role="timer" aria-label={fmtDuration(ms)}>
      {parts.map(([v, k]) => (
        <div className="sc-cd__box" key={k}>
          <b className="num">{pad2(v)}</b>
          <span>{t(k)}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Races tab                                                           */
/* ------------------------------------------------------------------ */

export function RacesScreen() {
  const now = useNow(1000);
  const push = useNav((s) => s.push);
  const [filter, setFilter] = useState<Filter>('all');
  const minute = Math.floor(now / 60_000);
  const statuses = useMemo(() => new Map(SEASON_2026.map((m) => [m.id, meetingStatus(m, minute * 60_000 + 30_000)])), [minute]);
  const current = currentOrNextMeeting(now);
  const done = SEASON_2026.filter((m) => statuses.get(m.id) === 'COMPLETED').length;
  const list = SEASON_2026.filter((m) => {
    const st = statuses.get(m.id)!;
    return filter === 'all' || (filter === 'completed' ? st === 'COMPLETED' : st !== 'COMPLETED');
  });
  const currentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollTo = (mode: 'current' | 'list', smooth: boolean) => {
    const anchor = mode === 'current' ? currentRef.current : listRef.current;
    const sc = anchor?.closest('.screen') as HTMLElement | null;
    if (!anchor || !sc) return;
    const sticky = sc.querySelector('.sc-sticky') as HTMLElement | null;
    // Keep the previous round peeking above the current one so the list reads as a timeline.
    const peek = mode === 'current' && anchor.previousElementSibling ? 46 : 0;
    const top = anchor.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (sticky?.offsetHeight ?? 0) - 10 - peek;
    if (mode === 'list' && sc.scrollTop < top) return;
    sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    scrollTo('current', false);
  }, []);

  const changeFilter = (f: Filter) => {
    setFilter(f);
    requestAnimationFrame(() => scrollTo(f === 'all' ? 'current' : 'list', true));
  };

  return (
    <>
      <Header />
      <PageHead kicker={`F1 · ${t('scr.races.kicker')}`} title={t('races.title')} sub={t('races.sub')} />
      <div className="sc-sticky">
        <div className="sc-season">
          <div className="sc-season__k">
            <span>{t('scr.races.progress')}</span>
            <b className="num">
              {done}
              <i>/{SEASON_2026.length}</i>
            </b>
          </div>
          <div className="sc-season__bar" aria-hidden="true">
            {SEASON_2026.map((m) => (
              <span key={m.id} data-st={statuses.get(m.id)} data-cur={m.id === current.id || undefined} />
            ))}
          </div>
        </div>
        <Segmented<Filter>
          label={t('races.title')}
          value={filter}
          onChange={changeFilter}
          options={[
            { id: 'all', label: t('ui.all'), count: SEASON_2026.length },
            { id: 'upcoming', label: t('races.upcoming'), count: SEASON_2026.length - done },
            { id: 'completed', label: t('races.completed'), count: done },
          ]}
        />
      </div>
      <div className="sc-rounds" ref={listRef}>
        {list.length === 0 && (
          <Card>
            <Empty icon={<IconCalendar size={26} />} title={t('scr.races.empty')} />
          </Card>
        )}
        {list.map((m, i) => {
          const st = statuses.get(m.id)!;
          const isCurrent = m.id === current.id;
          if (isCurrent && st !== 'COMPLETED')
            return (
              <div key={m.id} ref={currentRef} className="sc-round-wrap sc-round-wrap--hero" data-st={st}>
                <RaceHero m={m} status={st} now={now} />
              </div>
            );
          return (
            <div key={m.id} ref={isCurrent ? currentRef : undefined} className="sc-round-wrap" data-st={st}>
              <Reveal i={i % 10}>
                <RoundRow
                  m={m}
                  status={st}
                  onOpen={() => {
                    haptic.tap();
                    push({ name: 'meeting', meetingId: m.id });
                  }}
                />
              </Reveal>
            </div>
          );
        })}
      </div>
    </>
  );
}

function RoundRow({ m, status, onOpen }: { m: Meeting; status: MeetingStatus; onOpen: () => void }) {
  const meta = safeMeta(m.circuitId);
  const winner = status === 'COMPLETED' ? demoResults(m.id)[0] : undefined;
  const wd = winner ? DRIVER_BY_ID[winner.driverId] : undefined;
  return (
    <button className="sc-round" data-st={status} onClick={onOpen} aria-label={`${t('races.round', { n: m.round })}. ${meetingName(m)}`}>
      <span className="sc-round__no">
        <span>{t('scr.rnd')}</span>
        <b className="num">{pad2(m.round)}</b>
      </span>
      <span className="sc-round__main">
        <span className="sc-round__name">
          <span className="flag">{flagEmoji(m.countryCode)}</span>
          <span className="sc-round__nm">{meetingName(m)}</span>
        </span>
        <span className="sc-round__meta">
          {meetingDates(m)} · {meta?.shortName ?? ''}
        </span>
        <span className="sc-round__tags">
          <StatusPill status={status} />
          {m.sprint && <span className="sc-pill sc-pill--sprint">{t('scr.sprint')}</span>}
          {wd && (
            <span className="sc-round__win">
              <IconTrophy size={12} />
              {wd.code}
            </span>
          )}
        </span>
      </span>
      <CircuitThumb id={m.circuitId} size={54} />
    </button>
  );
}

function RaceHero({ m, status, now }: { m: Meeting; status: MeetingStatus; now: number }) {
  const push = useNav((s) => s.push);
  const meta = safeMeta(m.circuitId);
  const focus = focusSession(m, now);
  const ch = channelFor(m, focus?.s) ?? channelFor(m);
  const cars = ['#ff8000', '#e8002d', '#3671c6'];
  return (
    <Card glow pad={false} className="sc-hero">
      <div className="sc-hero__map" aria-hidden="true">
        <CircuitThumb id={m.circuitId} size={190} draw cars={cars} />
      </div>
      <div className="sc-hero__body">
        <div className="sc-hero__top">
          <span className="sc-hero__round">{t('races.round', { n: m.round })}</span>
          <StatusPill status={status} />
          {m.sprint && <span className="sc-pill sc-pill--sprint">{t('scr.sprint')}</span>}
        </div>
        <div className="sc-hero__name">
          <span className="flag">{flagEmoji(m.countryCode)}</span>
          <span>{meetingName(m)}</span>
        </div>
        <div className="sc-hero__circuit">
          {meta?.name}
          {meta?.location ? ` · ${meta.location}` : ''}
        </div>
        <div className="sc-hero__dates">
          <IconCalendar size={14} /> {meetingDates(m)}
        </div>
        {focus && (
          <div className="sc-hero__next">
            {focus.live ? (
              <>
                <span className="badge badge--live">LIVE</span>
                <b>{t(`session.${focus.s.kind}`)}</b>
              </>
            ) : (
              <>
                <span className="sc-hero__nextk">{t('scr.races.startsIn', { s: t(`session.${focus.s.kind}`) })}</span>
                <span className="sc-hero__nextt num">
                  {fmtDate(Date.parse(focus.s.startsAt), { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtClock(Date.parse(focus.s.startsAt))}
                </span>
              </>
            )}
          </div>
        )}
        {focus && !focus.live && <BigCountdown ms={Date.parse(focus.s.startsAt) - now} />}
        <div className="sc-hero__actions">
          <button
            className="btn btn--primary"
            onClick={() => {
              haptic.tap();
              push({ name: 'meeting', meetingId: m.id });
            }}
          >
            {t('scr.races.weekend')}
            <IconChevron size={16} />
          </button>
          {ch && (
            <button className="btn btn--ghost" onClick={() => watchChannel(ch)}>
              <IconPlay size={16} />
              {t('races.watchDemo')}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Meeting                                                             */
/* ------------------------------------------------------------------ */

export function MeetingScreen({ meetingId }: { meetingId: string }) {
  const back = useBack();
  const m = SEASON_2026.find((x) => x.id === meetingId);
  if (!m) return <NotFound onBack={back} />;
  return <MeetingBody m={m} />;
}

function MeetingBody({ m }: { m: Meeting }) {
  const back = useBack();
  const push = useNav((s) => s.push);
  const now = useNow(1000);
  const status = meetingStatus(m, now);
  const meta = safeMeta(m.circuitId);
  const circuit = useCircuit(m.circuitId);
  const channels = CHANNELS.filter((c) => c.meetingRound === m.round);
  const activeId = useLive((s) => s.channelId);
  const loading = useLive((s) => s.loading);
  const activeHere = channels.find((c) => c.id === activeId);
  const [showAll, setShowAll] = useState(false);
  const results = status === 'COMPLETED' ? demoResults(m.id) : null;
  let i = 0;
  return (
    <>
      <SubHeader title={meetingName(m)} onBack={back} />
      <Reveal i={i++}>
        <Card glow={status === 'LIVE' || status === 'NEXT'} pad={false} className="sc-mhero">
          <div className="sc-mhero__map" aria-hidden="true">
            <CircuitThumb id={m.circuitId} size={170} draw />
          </div>
          <div className="sc-mhero__body">
            <div className="sc-hero__top">
              <span className="sc-hero__round">{t('races.round', { n: m.round })}</span>
              <StatusPill status={status} />
              {m.sprint && <span className="sc-pill sc-pill--sprint">{t('scr.sprint')}</span>}
            </div>
            <div className="sc-mhero__flag">{flagEmoji(m.countryCode)}</div>
            <h1 className="sc-mhero__name">{meetingName(m)}</h1>
            <div className="sc-hero__circuit">
              {meta?.name}
              {meta?.location ? ` · ${meta.location}` : ''}
            </div>
            <div className="sc-hero__dates">
              <IconCalendar size={14} /> {meetingDates(m)} · {m.season}
            </div>
          </div>
        </Card>
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('races.sessions')}</h2>
          <span className="sc-note">{t('races.localTime')}</span>
        </div>
        <Card pad={false} className="sc-sess-list">
          {m.sessions.map((s) => (
            <SessionRow key={s.id} m={m} s={s} now={now} />
          ))}
        </Card>
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('races.circuit')}</h2>
        </div>
        <Card onClick={() => push({ name: 'circuit', circuitId: m.circuitId })} ariaLabel={meta?.name ?? t('races.circuit')} className="sc-ccard">
          <div className="sc-ccard__top">
            <CircuitThumb id={m.circuitId} size={86} />
            <div className="sc-ccard__txt">
              <div className="sc-ccard__name">{meta?.name}</div>
              <div className="muted sc-ccard__loc">
                {flagEmoji(m.countryCode)} {meta?.location}, {meta?.country}
              </div>
              <span className="link-btn">
                <IconMap size={14} />
                {t('scr.circuit.open')}
              </span>
            </div>
            <IconChevron size={16} />
          </div>
          <div className="sc-kvgrid">
            <KV k={t('races.length')} v={meta ? `${fmtNumber(meta.lengthM / 1000, 3)} ${t('scr.km')}` : '—'} />
            <KV k={t('races.laps')} v={meta ? String(meta.laps) : '—'} />
            <KV k={t('races.record')} v={circuit ? fmtLap(circuit.lapRecordMs) : '—'} />
            <KV k={t('races.direction')} v={meta ? t(meta.direction === 'CW' ? 'races.cw' : 'races.ccw') : '—'} text />
            <KV k={t('scr.circuit.turns')} v={circuit ? String(circuit.corners.length) : '—'} />
            <KV k={t('scr.circuit.distance')} v={meta ? `${fmtNumber((meta.lengthM * meta.laps) / 1000, 1)} ${t('scr.km')}` : '—'} />
          </div>
        </Card>
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('races.pools')}</h2>
          {activeHere && <span className="sc-note">DEMO · {t(`session.${activeHere.sessionType}`)}</span>}
        </div>
        {activeHere ? (
          <MeetingPools channel={activeHere} />
        ) : channels.length ? (
          <Card>
            <Empty
              icon={<IconUsers size={24} />}
              title={t('scr.meeting.poolsDemo')}
              body={t('scr.meeting.poolsDemoSub')}
              action={
                <div className="sc-btnrow">
                  {channels.map((c) => (
                    <button
                      key={c.id}
                      className="btn btn--ghost btn--sm"
                      disabled={loading}
                      onClick={() => {
                        haptic.tap();
                        void useLive.getState().open(c.id);
                      }}
                    >
                      <IconPlay size={14} />
                      {t(`session.${c.sessionType}`)}
                    </button>
                  ))}
                </div>
              }
            />
          </Card>
        ) : (
          <Card>
            <Empty icon={<IconTimer size={24} />} title={t('races.noPools')} body={t('scr.meeting.noDemo')} />
          </Card>
        )}
      </Reveal>

      {results && (
        <Reveal i={i++} className="section">
          <div className="section__head">
            <h2 className="section__title">{t('races.results')}</h2>
            <span className="sc-note">{t(`session.GRAND_PRIX`)}</span>
          </div>
          <Card pad={false} className="sc-results">
            {(showAll ? results : results.slice(0, 10)).map((r) => {
              const d = DRIVER_BY_ID[r.driverId];
              return (
                <button
                  key={r.driverId}
                  className="sc-res"
                  data-pos={r.pos}
                  onClick={() => {
                    haptic.tap();
                    push({ name: 'driver', driverId: r.driverId });
                  }}
                >
                  <span className="sc-res__pos num">{r.dnf ? 'DNF' : r.pos}</span>
                  <TeamBar id={r.driverId} />
                  <DriverAvatar id={r.driverId} size={28} />
                  <span className="sc-res__name">
                    <b>{d?.code}</b>
                    <span className="muted ellipsis">{d ? `${d.firstName} ${d.lastName}` : r.driverId}</span>
                  </span>
                  {r.fastestLap && <span className="sc-pill sc-pill--fl">{t('scr.fl')}</span>}
                  <span className="sc-res__gap num">{r.pos === 1 ? t('scr.winner') : r.dnf ? '—' : r.lapsDown ? t('scr.lapsDown', { n: r.lapsDown }) : fmtGap(r.gapMs, 3)}</span>
                  <span className="sc-res__pts num">{r.points ? `+${r.points}` : ''}</span>
                </button>
              );
            })}
            <button
              className="sc-res__more"
              onClick={() => {
                haptic.tap();
                setShowAll(!showAll);
              }}
            >
              {showAll ? t('ui.collapse') : t('scr.meeting.fullResults')}
              <IconChevron size={14} dir={showAll ? 'up' : 'down'} />
            </button>
          </Card>
          <p className="sc-fine">{t('scr.demoResultsNote')}</p>
        </Reveal>
      )}
    </>
  );
}

function KV({ k, v, tone, text }: { k: string; v: string; tone?: string; text?: boolean }) {
  return (
    <div className="sc-kv">
      <span className={`sc-kv__v ${text ? 'sc-kv__v--txt' : 'num'} ${tone ?? ''}`}>{v}</span>
      <span className="sc-kv__k">{k}</span>
    </div>
  );
}

function SessionRow({ m, s, now }: { m: Meeting; s: CalendarSession; now: number }) {
  const st = sessState(s, now);
  const start = Date.parse(s.startsAt);
  const end = Date.parse(s.endsAt);
  const prev = previousStart(s.id);
  const ch = channelFor(m, s);
  const major = s.kind === 'GRAND_PRIX' || s.kind === 'SPRINT';
  return (
    <div className="sc-sess" data-st={st} data-major={major || undefined}>
      <div className="sc-sess__day">
        <span>{fmtDate(start, { weekday: 'short' })}</span>
        <b className="num">{new Date(start).getDate()}</b>
      </div>
      <div className="sc-sess__main">
        <div className="sc-sess__name">{t(`session.${s.kind}`)}</div>
        <div className="sc-sess__time num">
          {fmtClock(start)}–{fmtClock(end)}
        </div>
        {prev && (
          <div className="sc-sess__resched">
            <span className="badge badge--yellow">{t('races.rescheduled')}</span>
            <s className="muted">{t('races.wasAt', { time: fmtClock(Date.parse(prev)) })}</s>
          </div>
        )}
      </div>
      <div className="sc-sess__right">
        {st === 'done' && (
          <span className="sc-sess__done">
            <IconCheck size={14} />
            {t('session.status.FINISHED')}
          </span>
        )}
        {st === 'live' && (
          <span className="badge badge--live">LIVE</span>
        )}
        {st === 'upcoming' && <span className="sc-sess__in num">{t('scr.in', { d: start - now < 86_400_000 ? fmtCountdown(start - now) : fmtDuration(start - now) })}</span>}
        {ch && (
          <button className="sc-sess__watch" onClick={() => watchChannel(ch)} aria-label={`${t('races.watchDemo')}: ${t(`session.${s.kind}`)}`}>
            <IconPlay size={12} />
            {t('races.watchDemo')}
          </button>
        )}
      </div>
    </div>
  );
}

function MeetingPools({ channel }: { channel: DemoChannel }) {
  const pools = usePools((s) => s.pools);
  const push = useNav((s) => s.push);
  const loading = useLive((s) => s.loading);
  const now = useSessionNow();
  const open = pools.filter((p) => p.pool.status === 'OPEN').sort((a, b) => b.priority - a.priority);
  if (!open.length)
    return (
      <Card>
        <Empty
          icon={<IconTimer size={24} />}
          title={loading ? t('ui.syncing') : t('races.noPools')}
          action={
            <button className="btn btn--ghost btn--sm" onClick={() => watchChannel(channel)}>
              <IconPlay size={14} />
              {t('races.watchDemo')}
            </button>
          }
        />
      </Card>
    );
  return (
    <div className="sc-pools">
      {open.slice(0, 6).map((lp) => (
        <PoolRow key={lp.pool.pool_id} lp={lp} now={now} onOpen={() => push({ name: 'pool', channelId: channel.id, poolId: lp.pool.pool_id })} />
      ))}
    </div>
  );
}

function PoolRow({ lp, now, onOpen }: { lp: LivePool; now: number; onOpen: () => void }) {
  const tx = poolTexts(lp.pool);
  // Outcomes nobody has backed yet report the 50× cap; keep the range to priced outcomes.
  const xs = lp.pool.outcomes.map((o) => multiplier(lp.book, o.id)).filter((x) => x < 50);
  const lo = xs.length ? Math.min(...xs) : null;
  const hi = xs.length ? Math.max(...xs) : null;
  const ms = msUntilLock(lp.pool, now);
  return (
    <Card onClick={onOpen} ariaLabel={tx.question} className="sc-pool">
      <div className="sc-pool__top">
        <span className="sc-pool__fam">{tx.title}</span>
        <span className="sc-pool__lock num">
          <IconTimer size={12} />
          {fmtCountdown(ms)}
        </span>
      </div>
      <div className="sc-pool__q">{tx.question}</div>
      <div className="sc-pool__foot">
        <span className="muted">
          <IconUsers size={12} /> {t('ui.joined', { n: fmtNumber(lp.book.players) })}
        </span>
        {lo !== null && hi !== null && <span className="sc-pool__x num">{lo === hi ? `×${fmtOdds(lo)}` : `×${fmtOdds(lo)}–${fmtOdds(hi)}`}</span>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Session (DEMO channel)                                              */
/* ------------------------------------------------------------------ */

export function SessionScreen({ channelId }: { channelId: string }) {
  const back = useBack();
  let ch: DemoChannel;
  try {
    ch = getChannel(channelId);
  } catch {
    return <NotFound onBack={back} />;
  }
  return <SessionBody ch={ch} />;
}

function SessionBody({ ch }: { ch: DemoChannel }) {
  const back = useBack();
  const push = useNav((s) => s.push);
  const lang = getLang();
  const circuit = useCircuit(ch.circuitId);
  const meta = safeMeta(ch.circuitId);
  const meeting = SEASON_2026.find((m) => m.round === ch.meetingRound);
  const activeId = useLive((s) => s.channelId);
  const live = useLive((s) => (s.channelId === ch.id ? s.live : null));
  const isActive = activeId === ch.id;
  const laps = meta ? channelLaps(ch, meta.laps, circuit?.sprintLaps) : null;
  const leader = live?.cars[0];
  const quali = ch.sessionType === 'QUALIFYING' || ch.sessionType === 'SPRINT_QUALIFYING';
  return (
    <>
      <SubHeader title={meeting ? meetingName(meeting) : ch.title[lang]} onBack={back} />
      <Reveal i={0}>
        <Card glow pad={false} className="sc-sesshero">
          <div className="sc-sesshero__map">
            {circuit ? <TrackMap circuit={circuit} width={332} height={200} padding={18} showZones={false} /> : <div className="skeleton" style={{ height: 200 }} />}
          </div>
          <div className="sc-sesshero__body">
            <div className="sc-hero__top">
              <span className="sc-pill sc-pill--demo">DEMO</span>
              <span className="sc-hero__round">{t(`session.${ch.sessionType}`)}</span>
              {isActive && live && (
                <span className="badge badge--live">LIVE</span>
              )}
            </div>
            <div className="sc-hero__name">
              <span className="flag">{flagEmoji(meta?.countryCode ?? '')}</span>
              <span>{meeting ? meetingName(meeting) : ch.title[lang]}</span>
            </div>
            <div className="sc-hero__circuit">{meta?.name}</div>
            <div className="sc-kvgrid sc-kvgrid--3">
              <KV k={quali ? t('scr.session.format') : t('races.laps')} v={quali ? (ch.sessionType === 'QUALIFYING' ? 'Q1·Q2·Q3' : 'SQ1·SQ2·SQ3') : String(laps ?? '—')} />
              <KV k={t('races.length')} v={meta ? `${fmtNumber(meta.lengthM / 1000, 3)} ${t('scr.km')}` : '—'} />
              <KV k={isActive && live ? t('scr.session.lap') : t('scr.session.status')} v={isActive && live ? `${live.leaderLap}/${live.totalLaps ?? '—'}` : t('scr.session.loop')} tone={isActive && live ? 'lime' : ''} />
            </div>
            {isActive && leader && (
              <div className="sc-sesshero__leader">
                <span className="muted">P1</span>
                <TeamBar id={leader.id} />
                <DriverAvatar id={leader.id} size={24} />
                <b>{DRIVER_BY_ID[leader.id]?.code}</b>
                <span className="muted num">{fmtLap(leader.bestLapMs)}</span>
              </div>
            )}
            <p className="sc-fine">{t('scr.session.about')}</p>
            <button className="btn btn--primary btn--block btn--lg" onClick={() => watchChannel(ch)}>
              <IconPlay size={18} />
              {isActive ? t('scr.session.backToLive') : t('scr.session.openLive')}
            </button>
          </div>
        </Card>
      </Reveal>
      <Reveal i={1} className="section">
        <div className="sc-btnrow sc-btnrow--split">
          {meeting && (
            <button
              className="btn btn--ghost"
              onClick={() => {
                haptic.tap();
                push({ name: 'meeting', meetingId: meeting.id });
              }}
            >
              <IconCalendar size={16} />
              {t('scr.races.weekend')}
            </button>
          )}
          <button
            className="btn btn--ghost"
            onClick={() => {
              haptic.tap();
              push({ name: 'circuit', circuitId: ch.circuitId });
            }}
          >
            <IconMap size={16} />
            {t('races.circuit')}
          </button>
        </div>
      </Reveal>
      <Reveal i={2} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('scr.session.others')}</h2>
        </div>
        <div className="sc-chlist">
          {CHANNELS.filter((c) => c.id !== ch.id).map((c) => (
            <button
              key={c.id}
              className="sc-ch"
              onClick={() => {
                haptic.tap();
                push({ name: 'session', channelId: c.id });
              }}
            >
              <CircuitThumb id={c.circuitId} size={40} />
              <span className="sc-ch__txt">
                <span>{SEASON_2026.find((m) => m.round === c.meetingRound)?.name[lang] ?? c.title[lang]}</span>
                <span className="muted">{t(`session.${c.sessionType}`)}</span>
              </span>
              {c.id === activeId && <span className="dot-live" />}
              <IconChevron size={14} />
            </button>
          ))}
        </div>
      </Reveal>
    </>
  );
}

export function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <>
      <SubHeader title={t('scr.notFound')} onBack={onBack} />
      <Card>
        <Empty icon={<IconMap size={24} />} title={t('scr.notFound')} body={t('scr.notFoundSub')} />
      </Card>
    </>
  );
}

