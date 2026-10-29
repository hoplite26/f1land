import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWallet } from '@/store/wallet';
import { useRewards } from '@/store/rewards';
import { useNav } from '@/store/nav';
import { useToasts } from '@/store/toasts';
import { achievements, missions, weekStart, type AchievementState, type MissionState } from '@/demo/progress';
import { SubHeader } from '@/app/Header';
import { Card, useNow } from '@/ui/kit';
import { IconCheck, IconGift, IconPlay, IconTimer } from '@/ui/icons';
import { fmtDuration, fmtNumber, t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { AchGlyph, Bar, PageHead, Reveal, useBack, useReduced } from './common';
import { AchievementSheet, AchievementsGrid } from './Profile';

export function RewardsScreen() {
  const back = useBack();
  const entries = useWallet((s) => s.entries);
  const xp = useWallet((s) => s.xp);
  const lastDaily = useWallet((s) => s.lastDaily);
  const claimed = useRewards((s) => s.claimed);
  const go = useNav((s) => s.go);
  const toast = useToasts((s) => s.push);
  const reduced = useReduced();
  const now = useNow(30_000);
  const [ach, setAch] = useState<AchievementState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const list = missions(entries, lastDaily, now);
  const achList = useMemo(() => achievements(entries, xp), [entries, xp]);
  const claimable = list.filter((m) => m.done && !claimed[m.claimKey]);
  const doneCount = list.filter((m) => m.done).length;
  const pot = claimable.reduce((s, m) => s + m.def.reward, 0);
  const total = list.reduce((s, m) => s + m.def.reward, 0);
  const resetIn = weekStart(now) + 7 * 86_400_000 - now;

  const claim = (ms: MissionState[]) => {
    const st = useRewards.getState();
    let sum = 0;
    for (const m of ms) {
      if (st.claimed[m.claimKey]) continue;
      st.markClaimed(m.claimKey);
      useWallet.getState().credit('bonus', m.def.reward);
      sum += m.def.reward;
    }
    if (!sum) return;
    haptic.win();
    sfx.win();
    setFlash(ms.length === 1 ? ms[0]!.def.id : '*');
    setTimeout(() => setFlash(null), 1200);
    toast({ kind: 'win', title: t('scr.rewards.claimedToast', { n: fmtNumber(sum) }) });
  };

  return (
    <>
      <SubHeader onBack={back} />
      <PageHead kicker={t('scr.rewards.kicker')} title={t('rewards.title')} sub={t('rewards.sub')} />
      <Reveal i={0}>
        <Card glow pad={false} className="sc-rhero">
          <div className="sc-rhero__gift" aria-hidden="true">
            <IconGift size={46} />
          </div>
          <div className="sc-rhero__body">
            <div className="sc-kicker">{t('rewards.missions')}</div>
            <div className="sc-rhero__v">
              <b className="num">{doneCount}</b>
              <span className="num">/{list.length}</span>
            </div>
            <Bar value={doneCount} max={list.length} label={t('rewards.missions')} />
            <div className="sc-rhero__meta">
              <span>
                <IconTimer size={13} />
                {t('scr.rewards.resets', { d: fmtDuration(resetIn) })}
              </span>
              <span className="num lime">
                {t('scr.rewards.pool', { n: fmtNumber(total) })}
              </span>
            </div>
            {claimable.length > 0 && (
              <button className="btn btn--primary btn--block sc-rhero__btn" onClick={() => claim(claimable)}>
                <IconGift size={18} />
                {t('scr.rewards.claimAll', { n: fmtNumber(pot) })}
              </button>
            )}
          </div>
        </Card>
      </Reveal>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t('rewards.missions')}</h2>
          <span className="sc-note">{t('scr.rewards.weekly')}</span>
        </div>
        <div className="sc-missions">
          {list.map((m, i) => {
            const isClaimed = !!claimed[m.claimKey];
            return (
              <Reveal key={m.def.id} i={i + 1}>
                <div className="sc-mission" data-done={m.done || undefined} data-claimed={isClaimed || undefined} data-tone={m.def.tone}>
                  <span className="sc-mission__ic">
                    <AchGlyph icon={m.def.icon} size={22} />
                  </span>
                  <div className="sc-mission__body">
                    <b>{t(`scr.ms.${m.def.id}`)}</b>
                    <span className="muted">{t(`scr.ms.${m.def.id}.d`, { n: m.def.goal })}</span>
                    <div className="sc-mission__prog">
                      <Bar value={m.value} max={m.def.goal} tone={m.def.tone} />
                      <span className="num">{t('rewards.progress', { a: m.value, b: m.def.goal })}</span>
                    </div>
                  </div>
                  <div className="sc-mission__cta">
                    {isClaimed ? (
                      <span className="sc-mission__got">
                        <IconCheck size={14} />
                        {t('wallet.claimed')}
                      </span>
                    ) : m.done ? (
                      <button className="btn btn--primary btn--sm" onClick={() => claim([m])}>
                        +{m.def.reward}
                      </button>
                    ) : (
                      <span className="sc-mission__rw num">+{m.def.reward}</span>
                    )}
                  </div>
                  <AnimatePresence>
                    {!reduced && (flash === m.def.id || (flash === '*' && m.done)) && (
                      <motion.span className="sc-mission__burst" initial={{ opacity: 0.9, scale: 0.4 }} animate={{ opacity: 0, scale: 2.4 }} exit={{ opacity: 0 }} transition={{ duration: 0.9 }} />
                    )}
                  </AnimatePresence>
                </div>
              </Reveal>
            );
          })}
        </div>
        {entries.length === 0 && (
          <button className="btn btn--ghost btn--block" style={{ marginTop: 12 }} onClick={() => go('live')}>
            <IconPlay size={16} />
            {t('scr.rewards.start')}
          </button>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t('scr.rewards.badges')}</h2>
          <span className="sc-note num">
            {achList.filter((a) => a.unlocked).length}/{achList.length}
          </span>
        </div>
        <AchievementsGrid list={achList} onOpen={setAch} />
      </section>
      <p className="sc-fine">{t('scr.rewards.note')}</p>
      <AchievementSheet a={ach} onClose={() => setAch(null)} />
    </>
  );
}
