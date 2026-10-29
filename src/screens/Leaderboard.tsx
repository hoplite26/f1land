import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useWallet } from '@/store/wallet';
import { leaderboardWithYou, userPoints, type LbPeriod, type LbPlayer } from '@/demo/leaderboard';
import { weekStart } from '@/demo/progress';
import { SubHeader } from '@/app/Header';
import { Card, DriverAvatar, Segmented, useNow } from '@/ui/kit';
import { IconTimer } from '@/ui/icons';
import { flagEmoji, fmtDuration, fmtNumber, t } from '@/i18n/core';
import { PageHead, Reveal, useBack, useReduced } from './common';
import { useYou } from './Profile';

function Trend({ n }: { n: number }) {
  if (n === 0) return <span className="sc-trend">–</span>;
  return (
    <span className={`sc-trend ${n > 0 ? 'sc-trend--up' : 'sc-trend--down'}`}>
      {n > 0 ? '▲' : '▼'}
      {Math.abs(n)}
    </span>
  );
}

function Avatar({ p, size }: { p: LbPlayer & { photo?: string } }) {
  return p.photo ? <img src={p.photo} alt="" className="sc-lbimg" style={{ width: size, height: size }} /> : <DriverAvatar id={p.driverId} size={size} />;
}

function Podium({ top, reduced }: { top: Array<LbPlayer & { photo?: string }>; reduced: boolean }) {
  const order = [top[1], top[0], top[2]].filter(Boolean) as Array<LbPlayer & { photo?: string }>;
  const place = (p: LbPlayer) => top.indexOf(p) + 1;
  const heights: Record<number, number> = { 1: 92, 2: 66, 3: 50 };
  return (
    <div className="sc-podium" role="list">
      {order.map((p, i) => {
        const n = place(p);
        return (
          <div key={p.id} className="sc-podium__col" data-place={n} data-you={p.you || undefined} role="listitem">
            <motion.div className="sc-podium__who" initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.08, type: 'spring', stiffness: 260, damping: 22 }}>
              {n === 1 && <span className="sc-podium__crown">👑</span>}
              <span className="sc-podium__av">
                <Avatar p={p} size={n === 1 ? 62 : 50} />
              </span>
              <b className="sc-podium__name ellipsis">{p.you ? t('lb.you') : p.name}</b>
              <span className="sc-podium__pts num">
                {fmtNumber(p.points)} <i>{t('lb.points')}</i>
              </span>
            </motion.div>
            <motion.div
              className="sc-podium__bar"
              style={{ height: heights[n], transformOrigin: 'bottom' }}
              initial={reduced ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: 0.1 + (3 - n) * 0.06, type: 'spring', stiffness: 180, damping: 20 }}
            >
              <span className="num">{n}</span>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ p, rank }: { p: LbPlayer & { photo?: string }; rank: number }) {
  return (
    <div className="sc-lb" data-you={p.you || undefined}>
      <span className="sc-lb__rank num">{rank}</span>
      <Trend n={p.trend} />
      <Avatar p={p} size={34} />
      <span className="sc-lb__name">
        <b className="ellipsis">{p.you ? `${p.name} · ${t('lb.you')}` : p.name}</b>
        <span className="muted">
          {p.countryCode ? `${flagEmoji(p.countryCode)} ` : ''}
          {p.you ? t('scr.lb.yourScore') : t('scr.lb.acc', { n: Math.round(p.winRate * 100) })}
        </span>
      </span>
      <span className="sc-lb__pts num">
        {fmtNumber(p.points)}
        <i>{t('lb.points')}</i>
      </span>
    </div>
  );
}

export function LeaderboardScreen() {
  const back = useBack();
  const entries = useWallet((s) => s.entries);
  const xp = useWallet((s) => s.xp);
  const you = useYou();
  const reduced = useReduced();
  const [period, setPeriod] = useState<LbPeriod>('week');
  const now = useNow(30_000);
  const day = Math.floor(now / 3_600_000);
  const { list, rank } = useMemo(() => {
    const r = leaderboardWithYou(period, now, you, userPoints(entries, xp, period, now));
    return { list: r.list.map((p) => (p.you ? { ...p, photo: you.photo } : p)), rank: r.rank };
  }, [period, day, entries, xp, you.name, you.driverId, you.photo]);
  const top = list.slice(0, 3);
  const rest = list.slice(3, 50);
  const me = list[rank - 1]!;
  const resetIn = weekStart(now) + 7 * 86_400_000 - now;
  const pct = Math.max(1, Math.round((rank / list.length) * 100));
  return (
    <>
      <SubHeader onBack={back} />
      <PageHead kicker={t('scr.lb.kicker')} title={t('lb.title')} sub={t('lb.sub')} />
      <Segmented<LbPeriod>
        label={t('lb.title')}
        value={period}
        onChange={setPeriod}
        options={[
          { id: 'week', label: t('lb.week') },
          { id: 'season', label: t('lb.season') },
          { id: 'friends', label: t('lb.friends') },
        ]}
      />
      <div className="sc-lbmeta">
        <span>
          <IconTimer size={13} />
          {period === 'week' ? t('scr.lb.resets', { d: fmtDuration(resetIn) }) : period === 'season' ? t('scr.lb.seasonNote') : t('scr.lb.friendsNote')}
        </span>
        <span className="num">{t('scr.lb.players', { n: fmtNumber(list.length) })}</span>
      </div>
      <Card glow pad={false} className="sc-podium-card" key={period}>
        <Podium top={top} reduced={reduced} />
      </Card>
      <div className="sc-lblist" key={`l-${period}`}>
        {rest.map((p, i) => (
          <Reveal key={p.id} i={i}>
            <Row p={p} rank={i + 4} />
          </Reveal>
        ))}
      </div>
      {rank > 3 && (
        <div className="sc-lbpin">
          <Row p={me} rank={rank} />
          <div className="sc-lbpin__note">
            {rank <= 50 ? t('scr.lb.inTop') : t('scr.lb.topPct', { n: pct })}
          </div>
        </div>
      )}
      <p className="sc-fine">{t('scr.lb.demoNote')}</p>
    </>
  );
}
