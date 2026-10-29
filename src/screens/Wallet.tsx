import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWallet, type Tx } from '@/store/wallet';
import { useNav } from '@/store/nav';
import { useToasts } from '@/store/toasts';
import { playerStats } from '@/demo/progress';
import { SubHeader } from '@/app/Header';
import { Card, useNow } from '@/ui/kit';
import { IconBolt, IconCheck, IconChevron, IconGift, IconInfo, IconTarget, IconTrophy, IconWallet } from '@/ui/icons';
import { fmtClock, fmtCountdown, fmtNumber, getLang, t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { Empty, PageHead, Reveal, groupByDay, signed, useBack, useReduced } from './common';

const DAILY_MS = 20 * 3600_000;
const DAILY_AMOUNT = 200;
const TOPUPS = [500, 1000, 2500, 5000];

/** Counts up/down to `value` on change; instant when motion is reduced. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReduced();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const a = from.current;
    const t0 = performance.now();
    const dur = 650;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * e));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, reduced]);
  return <span className={className}>{fmtNumber(shown)}</span>;
}

function TxIcon({ kind }: { kind: Tx['kind'] }) {
  switch (kind) {
    case 'stake':
      return <IconTarget size={18} />;
    case 'payout':
      return <IconTrophy size={18} />;
    case 'refund':
      return <IconCheck size={18} />;
    case 'bonus':
      return <IconGift size={18} />;
    case 'topup':
      return <IconBolt size={18} />;
  }
}

export function WalletScreen() {
  const back = useBack();
  const balance = useWallet((s) => s.balance);
  const txs = useWallet((s) => s.txs);
  const entries = useWallet((s) => s.entries);
  const lastDaily = useWallet((s) => s.lastDaily);
  const push = useNav((s) => s.push);
  const toast = useToasts((s) => s.push);
  const now = useNow(1000);
  const [limit, setLimit] = useState(40);
  const [burst, setBurst] = useState(0);
  const stats = useMemo(() => playerStats(entries), [entries]);
  const next = lastDaily + DAILY_MS;
  const ready = now >= next;
  const lang = getLang();
  const groups = useMemo(() => groupByDay(txs.slice(0, limit), (x) => x.at), [txs, limit, lang]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const claim = () => {
    if (!useWallet.getState().claimDaily()) {
      haptic.notify('error');
      sfx.lose();
      return;
    }
    haptic.win();
    sfx.win();
    setBurst((b) => b + 1);
    toast({ kind: 'win', title: t('scr.wallet.bonusToast', { n: DAILY_AMOUNT }) });
  };

  const topup = (n: number) => {
    useWallet.getState().credit('topup', n);
    haptic.notify('success');
    sfx.confirm();
    setBurst((b) => b + 1);
    toast({ kind: 'info', title: t('scr.wallet.topupToast', { n: fmtNumber(n) }) });
  };

  return (
    <>
      <SubHeader onBack={back} />
      <PageHead kicker="PULSE · DEMO" title={t('wallet.title')} sub={t('wallet.sub')} />
      <Reveal i={0}>
        <Card glow pad={false} className="sc-whero">
          <div className="sc-whero__coins" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="sc-whero__k">
            <IconWallet size={16} />
            {t('ui.balance')}
            <span className="balance-chip__mode">DEMO</span>
          </div>
          <div className="sc-whero__v">
            <AnimatedNumber value={balance} className="num" />
            <span className="sc-whero__u">PULSE</span>
            <AnimatePresence>
              {burst > 0 && (
                <motion.span key={burst} className="sc-whero__plus" initial={{ opacity: 0, y: 8, scale: 0.8 }} animate={{ opacity: [0, 1, 1, 0], y: -26, scale: 1 }} transition={{ duration: 1.3 }}>
                  ✦
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="sc-whero__stats">
            <div>
              <span className="num">{fmtNumber(stats.staked)}</span>
              <i>{t('scr.wallet.staked')}</i>
            </div>
            <div>
              <span className="num">{fmtNumber(stats.returned)}</span>
              <i>{t('scr.wallet.returned')}</i>
            </div>
            <div>
              <span className={`num ${stats.profit > 0 ? 'lime' : stats.profit < 0 ? 'red' : ''}`}>{signed(stats.profit, (n) => fmtNumber(n))}</span>
              <i>{t('profile.profit')}</i>
            </div>
          </div>
        </Card>
      </Reveal>

      <Reveal i={1} className="section">
        <Card className={`sc-daily ${ready ? 'sc-daily--ready' : ''}`} pad>
          <span className="sc-daily__ic">
            <IconGift size={24} />
          </span>
          <div className="sc-daily__txt">
            <b>{t('wallet.daily')}</b>
            <span className="muted">{ready ? t('scr.wallet.dailyReady', { n: DAILY_AMOUNT }) : t('scr.wallet.dailyNext')}</span>
          </div>
          {ready ? (
            <button className="btn btn--primary btn--sm sc-daily__btn" onClick={claim}>
              +{DAILY_AMOUNT}
              <span>{t('wallet.claim')}</span>
            </button>
          ) : (
            <span className="sc-daily__cd num" role="timer">
              <IconCheck size={14} />
              {fmtCountdown(next - now)}
            </span>
          )}
        </Card>
      </Reveal>

      <Reveal i={2} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('wallet.topup')}</h2>
          <span className="sc-note">{t('scr.wallet.topupNote')}</span>
        </div>
        <div className="sc-topups">
          {TOPUPS.map((n) => (
            <button key={n} className="sc-topup" onClick={() => topup(n)} aria-label={`${t('wallet.topup')} +${n}`}>
              <IconBolt size={14} />
              <b className="num">+{fmtNumber(n)}</b>
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal i={3} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('wallet.tx')}</h2>
          <span className="sc-note num">{txs.length}</span>
        </div>
        {txs.length === 0 ? (
          <Card>
            <Empty icon={<IconWallet size={24} />} title={t('scr.wallet.noTx')} />
          </Card>
        ) : (
          <div className="sc-txgroups">
            {groups.map((g) => (
              <div key={g.key} className="sc-txgroup">
                <div className="sc-daylabel">{g.label}</div>
                <Card pad={false} className="sc-txlist">
                  {g.items.map((tx) => {
                    const e = tx.entryId ? byId.get(tx.entryId) : undefined;
                    const Row = e ? 'button' : 'div';
                    return (
                      <Row key={tx.id} className="sc-tx" data-kind={tx.kind} {...(e ? { onClick: () => push({ name: 'entry', entryId: e.id }) } : {})}>
                        <span className="sc-tx__ic">
                          <TxIcon kind={tx.kind} />
                        </span>
                        <span className="sc-tx__txt">
                          <b>{t(`wallet.tx.${tx.kind}`)}</b>
                          <span className="muted ellipsis">{e ? `${e.outcomeLabel} · ${e.meetingName[lang]}` : tx.id === 'tx_welcome' ? t('scr.wallet.welcome') : fmtClock(tx.at)}</span>
                        </span>
                        <span className={`sc-tx__amt num ${tx.amount > 0 ? 'lime' : tx.amount < 0 ? 'sc-neg' : ''}`}>{signed(tx.amount, (n) => fmtNumber(n))}</span>
                        {e && <IconChevron size={14} className="icon muted" />}
                      </Row>
                    );
                  })}
                </Card>
              </div>
            ))}
            {txs.length > limit && (
              <button className="btn btn--ghost btn--block" onClick={() => setLimit(limit + 40)}>
                {t('scr.showMore')}
              </button>
            )}
          </div>
        )}
      </Reveal>
      <p className="sc-fine sc-fine--note">
        <IconInfo size={14} />
        <span>{t('wallet.note')}</span>
      </p>
    </>
  );
}
