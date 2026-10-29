import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useWallet, levelFromXp } from '@/store/wallet';
import { useSettings } from '@/store/settings';
import { useNav } from '@/store/nav';
import { useRewards } from '@/store/rewards';
import { DRIVERS, DRIVER_BY_ID, TEAMS, TEAM_BY_ID } from '@/data/teams';
import { achievements, missions, playerStats, type AchievementState } from '@/demo/progress';
import { leaderboardWithYou, userPoints } from '@/demo/leaderboard';
import { Header } from '@/app/Header';
import { Card, DriverAvatar, Sparkline } from '@/ui/kit';
import { IconCheck, IconChevron, IconGift, IconHistory, IconLock, IconSettings, IconStar, IconTrophy, IconWallet } from '@/ui/icons';
import { fmtNumber, t } from '@/i18n/core';
import { telegramUser, haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { AchGlyph, Bar, MenuRow, PortalSheet, Reveal, signed, useReduced } from './common';

export function useYou() {
  const user = telegramUser();
  const fav = useSettings((s) => s.favoriteDriver);
  return { id: 'you', name: user?.name || t('profile.guest'), username: user?.username, photo: user?.photo, premium: user?.premium, driverId: fav ?? 'nor', countryCode: '', winRate: 0 };
}

function LevelRing({ value, size = 92, children }: { value: number; size?: number; children: React.ReactNode }) {
  const reduced = useReduced();
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <div className="sc-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="sc-ring__bg" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="sc-ring__fg"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduced ? c * (1 - value) : c }}
          animate={{ strokeDashoffset: c * (1 - value) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        />
      </svg>
      <div className="sc-ring__in">{children}</div>
    </div>
  );
}

export function AchievementsGrid({ list, onOpen }: { list: AchievementState[]; onOpen: (a: AchievementState) => void }) {
  return (
    <div className="sc-ach-grid">
      {list.map((a, i) => (
        <Reveal key={a.def.id} i={i}>
          <button className="sc-ach" data-on={a.unlocked || undefined} data-tone={a.def.tone} onClick={() => onOpen(a)} aria-label={`${t(`scr.ach.${a.def.id}`)}${a.unlocked ? '' : ` — ${t('scr.locked')}`}`}>
            <span className="sc-ach__ic">
              <AchGlyph icon={a.def.icon} size={22} />
              {!a.unlocked && (
                <span className="sc-ach__lock">
                  <IconLock size={10} />
                </span>
              )}
            </span>
            <span className="sc-ach__t">{t(`scr.ach.${a.def.id}`)}</span>
            {!a.unlocked && (
              <span className="sc-ach__p">
                <i style={{ width: `${Math.round(a.progress * 100)}%` }} />
              </span>
            )}
          </button>
        </Reveal>
      ))}
    </div>
  );
}

export function AchievementSheet({ a, onClose }: { a: AchievementState | null; onClose: () => void }) {
  return (
    <PortalSheet open={!!a} onClose={onClose} label={t('profile.achievements')} title={t('profile.achievements')}>
      {a && (
        <div className="sc-achd" data-tone={a.def.tone} data-on={a.unlocked || undefined}>
          <span className="sc-achd__ic">
            <AchGlyph icon={a.def.icon} size={40} />
          </span>
          <h3>{t(`scr.ach.${a.def.id}`)}</h3>
          <p>{t(`scr.ach.${a.def.id}.d`, { n: a.def.goal })}</p>
          <Bar value={Math.min(a.value, a.def.goal)} max={a.def.goal} tone={a.def.tone} />
          <div className="sc-achd__p num">{t('rewards.progress', { a: fmtNumber(Math.min(a.value, a.def.goal)), b: fmtNumber(a.def.goal) })}</div>
          <span className={`badge ${a.unlocked ? 'badge--lime' : 'badge--ghost'}`}>
            {a.unlocked ? <IconCheck size={12} /> : <IconLock size={12} />}
            {a.unlocked ? t('scr.unlocked') : t('scr.locked')}
          </span>
        </div>
      )}
    </PortalSheet>
  );
}

export function DriverPickerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fav = useSettings((s) => s.favoriteDriver);
  const set = useSettings((s) => s.set);
  const pick = (id: string | null) => {
    haptic.impact('light');
    sfx.select();
    set({ favoriteDriver: id });
    onClose();
  };
  return (
    <PortalSheet open={open} onClose={onClose} label={t('profile.favorite')} title={t('profile.favorite')}>
      <p className="sc-fine" style={{ marginTop: 0 }}>
        {t('scr.profile.favHint')}
      </p>
      <div className="sc-pick">
        {TEAMS.map((team) => (
          <div key={team.id} className="sc-pick__team">
            <div className="sc-pick__tname" style={{ ['--team' as string]: team.color }}>
              {team.name}
            </div>
            <div className="sc-pick__row">
              {DRIVERS.filter((d) => d.teamId === team.id).map((d) => (
                <button key={d.id} className="sc-pick__d" aria-pressed={fav === d.id} onClick={() => pick(d.id)} style={{ ['--team' as string]: team.color }}>
                  <DriverAvatar id={d.id} size={34} />
                  <span className="sc-pick__txt">
                    <b>{d.code}</b>
                    <span className="ellipsis">{d.lastName}</span>
                  </span>
                  {fav === d.id && <IconCheck size={14} className="icon lime" />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {fav && (
        <button className="btn btn--ghost btn--block" style={{ marginTop: 12 }} onClick={() => pick(null)}>
          {t('scr.profile.noFav')}
        </button>
      )}
    </PortalSheet>
  );
}

export function ProfileScreen() {
  const entries = useWallet((s) => s.entries);
  const xp = useWallet((s) => s.xp);
  const balance = useWallet((s) => s.balance);
  const lastDaily = useWallet((s) => s.lastDaily);
  const claimed = useRewards((s) => s.claimed);
  const fav = useSettings((s) => s.favoriteDriver);
  const push = useNav((s) => s.push);
  const you = useYou();
  const [pickOpen, setPickOpen] = useState(false);
  const [ach, setAch] = useState<AchievementState | null>(null);
  const stats = useMemo(() => playerStats(entries), [entries]);
  const lvl = levelFromXp(xp);
  const achList = useMemo(() => achievements(entries, xp), [entries, xp]);
  const unlocked = achList.filter((a) => a.unlocked).length;
  const now = useMemo(() => Date.now(), []);
  const rank = useMemo(() => leaderboardWithYou('season', now, you, userPoints(entries, xp, 'season', now)).rank, [entries, xp, now, you.name, you.driverId]);
  const claimable = missions(entries, lastDaily, now).filter((m) => m.done && !claimed[m.claimKey]).length;
  const favD = fav ? DRIVER_BY_ID[fav] : undefined;
  const favTeam = favD ? TEAM_BY_ID[favD.teamId] : undefined;
  const profitTone = stats.profit > 0 ? 'lime' : stats.profit < 0 ? 'red' : '';
  let i = 0;
  return (
    <>
      <Header />
      <Reveal i={i++}>
        <Card glow pad={false} className="sc-phero">
          <div className="sc-phero__glow" aria-hidden="true" />
          <div className="sc-phero__row">
            <LevelRing value={lvl.into / lvl.need}>{you.photo ? <img src={you.photo} alt="" className="sc-phero__img" /> : <DriverAvatar id={you.driverId} size={70} />}</LevelRing>
            <div className="sc-phero__txt">
              <div className="sc-phero__name">
                <span className="ellipsis">{you.name}</span>
                {you.premium && <IconStar size={14} className="icon yellow" />}
              </div>
              <div className="sc-phero__user muted ellipsis">{you.username ? `@${you.username}` : t('scr.profile.demoAccount')}</div>
              <div className="sc-phero__badges">
                <span className="sc-lvl">
                  <span>LVL</span>
                  <b className="num">{lvl.level}</b>
                </span>
                <span className="sc-phero__rank num">
                  <IconTrophy size={12} /> #{rank}
                </span>
              </div>
            </div>
          </div>
          <div className="sc-phero__xp">
            <Bar value={lvl.into} max={lvl.need} label={t('profile.level', { n: lvl.level })} />
            <div className="sc-phero__xpt">
              <span>{t('profile.xp', { n: fmtNumber(lvl.need - lvl.into) })}</span>
              <span className="num">
                {fmtNumber(lvl.into)} / {fmtNumber(lvl.need)} XP
              </span>
            </div>
          </div>
        </Card>
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('profile.stats')}</h2>
          <span className="sc-note">DEMO</span>
        </div>
        <div className="sc-statgrid">
          <div className="sc-stat">
            <span className="sc-stat__v num">{stats.total}</span>
            <span className="sc-stat__k">{t('profile.entries')}</span>
          </div>
          <div className="sc-stat">
            <span className="sc-stat__v num cyan">{stats.winRate === null ? '—' : `${Math.round(stats.winRate * 100)}%`}</span>
            <span className="sc-stat__k">{t('profile.winRate')}</span>
          </div>
          <div className="sc-stat">
            <span className={`sc-stat__v num ${profitTone}`}>{signed(stats.profit, (n) => fmtNumber(n))}</span>
            <span className="sc-stat__k">{t('profile.profit')}</span>
          </div>
          <div className="sc-stat">
            <span className="sc-stat__v num">
              {stats.streak}
              {stats.streak >= 2 && <i className="sc-fire">🔥</i>}
            </span>
            <span className="sc-stat__k">{t('profile.streak')}</span>
          </div>
          <div className="sc-stat">
            <span className="sc-stat__v num lime">{stats.bestWin ? `+${fmtNumber(stats.bestWin)}` : '—'}</span>
            <span className="sc-stat__k">{t('profile.best')}</span>
          </div>
          <div className="sc-stat">
            <span className="sc-stat__v num">{stats.pending}</span>
            <span className="sc-stat__k">{t('scr.profile.inPlay')}</span>
          </div>
        </div>
        {stats.profitSeries.length > 2 && (
          <Card className="sc-spark">
            <div>
              <div className="sc-spark__k">{t('scr.profile.profitCurve')}</div>
              <div className={`sc-spark__v num ${profitTone}`}>{signed(stats.profit, (n) => fmtNumber(n))} PULSE</div>
            </div>
            <Sparkline values={stats.profitSeries} color={stats.profit >= 0 ? 'var(--lime)' : 'var(--red)'} width={130} height={42} />
          </Card>
        )}
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('profile.achievements')}</h2>
          <span className="sc-note num">
            {unlocked}/{achList.length}
          </span>
        </div>
        <AchievementsGrid list={achList} onOpen={setAch} />
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('profile.favorite')}</h2>
        </div>
        <Card onClick={() => setPickOpen(true)} ariaLabel={t('profile.favorite')} className="sc-fav" pad>
          <div className="sc-fav__row" style={favTeam ? { ['--team' as string]: favTeam.color } : undefined}>
            {favD ? <DriverAvatar id={favD.id} size={48} ring /> : <span className="sc-fav__empty"><IconStar size={22} /></span>}
            <div className="sc-fav__txt">
              <b>{favD ? `${favD.firstName} ${favD.lastName}` : t('scr.profile.pickFav')}</b>
              <span className="muted">{favD ? `${favTeam?.name} · #${favD.number}` : t('scr.profile.favHint')}</span>
            </div>
            {favD && (
              <button
                className="sc-fav__open"
                onClick={(e) => {
                  e.stopPropagation();
                  haptic.tap();
                  push({ name: 'driver', driverId: favD.id });
                }}
              >
                {t('scr.profile.card')}
              </button>
            )}
            <IconChevron size={16} />
          </div>
        </Card>
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="sc-menu-list">
          <MenuRow icon={<IconWallet size={20} />} title={t('profile.wallet')} sub={t('wallet.sub')} value={fmtNumber(balance)} onClick={() => push({ name: 'wallet' })} />
          <MenuRow icon={<IconHistory size={20} />} tone="cyan" title={t('profile.history')} sub={t('scr.profile.historySub')} value={stats.total} onClick={() => push({ name: 'history' })} />
          <MenuRow icon={<IconTrophy size={20} />} tone="yellow" title={t('profile.leaderboard')} sub={t('lb.sub')} value={`#${rank}`} onClick={() => push({ name: 'leaderboard' })} />
          <MenuRow
            icon={<IconGift size={20} />}
            tone="purple"
            title={t('profile.rewards')}
            sub={t('rewards.sub')}
            badge={claimable > 0 ? <span className="sc-dotbadge num">{claimable}</span> : undefined}
            onClick={() => push({ name: 'rewards' })}
          />
          <MenuRow icon={<IconSettings size={20} />} tone="orange" title={t('profile.settings')} sub={t('scr.profile.settingsSub')} onClick={() => push({ name: 'settings' })} />
        </div>
        <p className="sc-fine">{t('app.demoNote')}</p>
      </Reveal>

      <DriverPickerSheet open={pickOpen} onClose={() => setPickOpen(false)} />
      <AchievementSheet a={ach} onClose={() => setAch(null)} />
    </>
  );
}
