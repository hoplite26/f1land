import { useWallet } from '@/store/wallet';
import { useNav } from '@/store/nav';
import { t, fmtNumber } from '@/i18n/core';
import { telegramUser, haptic } from '@/telegram/sdk';
import { IconCoin, IconPlus, LogoPulse } from '@/ui/icons';
import { DriverAvatar } from '@/ui/kit';
import { useSettings } from '@/store/settings';

export function Header({ right }: { right?: React.ReactNode }) {
  const balance = useWallet((s) => s.balance);
  const push = useNav((s) => s.push);
  const go = useNav((s) => s.go);
  const fav = useSettings((s) => s.favoriteDriver);
  const user = telegramUser();
  return (
    <header className="topbar">
      <div className="brand">
        <LogoPulse className="brand__logo" />
        <div className="brand__text">
          <span className="brand__name">
            PULSE <b>ARENA</b>
          </span>
          <span className="brand__sub">{t('app.module')}</span>
        </div>
      </div>
      <div className="topbar__spacer" />
      {right}
      <button
        className="balance-chip"
        aria-label={`${t('shell.demoBalance')}: ${fmtNumber(balance)}`}
        onClick={() => {
          haptic.tap();
          push({ name: 'wallet' });
        }}
      >
        <span className="balance-chip__mode" aria-hidden="true">
          {t('app.demo')}
        </span>
        <IconCoin size={16} className="icon balance-chip__coin" />
        <span className="balance-chip__val num" key={balance}>
          {fmtNumber(balance)}
        </span>
        <span className="balance-chip__plus" aria-hidden="true">
          <IconPlus size={13} />
        </span>
      </button>
      <button
        className="avatar-btn"
        aria-label={t('nav.profile')}
        onClick={() => {
          haptic.tap();
          go('profile');
        }}
      >
        {user?.photo ? <img src={user.photo} alt="" /> : <DriverAvatar id={fav ?? 'nor'} size={36} />}
        <span className="avatar-btn__dot" />
      </button>
    </header>
  );
}

export function SubHeader({ title, onBack, right }: { title?: React.ReactNode; onBack: () => void; right?: React.ReactNode }) {
  return (
    <header className="topbar topbar--sub">
      <button
        className="icon-btn"
        aria-label={t('ui.back')}
        onClick={() => {
          haptic.tap();
          onBack();
        }}
      >
        <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
      {title && <div className="topbar__title">{title}</div>}
      {!title && <div className="topbar__spacer" />}
      {right}
    </header>
  );
}
