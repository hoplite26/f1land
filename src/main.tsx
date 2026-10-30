import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'motion/react';
import { HomeScreen } from '@/screens/Home';
import { LiveScreen } from '@/screens/Live';
import { MyPoolsScreen, EntryScreen } from '@/screens/MyPools';
import { PoolScreen } from '@/screens/Pool';
import { RacesScreen, MeetingScreen, SessionScreen } from '@/screens/Races';
import { CircuitScreen } from '@/screens/Circuit';
import { DriverScreen } from '@/screens/Driver';
import { ProfileScreen } from '@/screens/Profile';
import { WalletScreen } from '@/screens/Wallet';
import { LeaderboardScreen } from '@/screens/Leaderboard';
import { RewardsScreen } from '@/screens/Rewards';
import { HistoryScreen } from '@/screens/History';
import { SettingsScreen, useApplySettings } from '@/screens/Settings';
import { Onboarding } from '@/screens/Onboarding';
import { SceneHost } from '@/app/SceneHost';
import { startSessionService } from '@/app/sessionService';
import { useLive, startLiveLoop } from '@/store/live';
import { useNav, currentRoute, type Route } from '@/store/nav';
import { usePools } from '@/demo/poolEngine';
import { useSettings } from '@/store/settings';
import { useToasts, type Toast } from '@/store/toasts';
import { NavBar } from '@/ui/NavBar';
import { registerDict, setLang, t } from '@/i18n/core';
import { UI_DICTS } from '@/i18n/ui';
import { F1_I18N } from '@/domain/markets/i18n';
import { registerFeatureDicts } from '@/i18n/extra';
import { haptic, initTelegram, setBackButton } from '@/telegram/sdk';
import '@/styles/app.css';
import '@/styles/restored.css';
// After app.css so screen styles win ties in the cascade.
import '@/styles/screens.css';

registerDict('ru', { ...UI_DICTS.ru, ...F1_I18N.ru });
registerDict('en', { ...UI_DICTS.en, ...F1_I18N.en });
registerFeatureDicts();
setLang(useSettings.getState().lang);
initTelegram();
startSessionService();
startLiveLoop();
void useLive.getState().open(useLive.getState().channelId);
// Dev-only handles for scripted screenshots and debugging.
if (import.meta.env.DEV) Object.assign(window, { __nav: useNav, __live: useLive, __settings: useSettings, __pools: usePools });

function routeContent(route: Route) {
  switch (route.name) {
    case 'tab':
      switch (route.tab) {
        case 'home':
          return <HomeScreen />;
        case 'races':
          return <RacesScreen />;
        case 'live':
          return <LiveScreen />;
        case 'pools':
          return <MyPoolsScreen />;
        case 'profile':
          return <ProfileScreen />;
      }
      break;
    case 'meeting':
      return <MeetingScreen meetingId={route.meetingId} />;
    case 'session':
      return <SessionScreen channelId={route.channelId} />;
    case 'pool':
      return <PoolScreen key={route.poolId} poolId={route.poolId} />;
    case 'entry':
      return <EntryScreen entryId={route.entryId} />;
    case 'circuit':
      return <CircuitScreen circuitId={route.circuitId} />;
    case 'driver':
      return <DriverScreen driverId={route.driverId} />;
    case 'leaderboard':
      return <LeaderboardScreen />;
    case 'wallet':
      return <WalletScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'history':
      return <HistoryScreen />;
    case 'rewards':
      return <RewardsScreen />;
  }
  return <HomeScreen />;
}

function App() {
  const tab = useNav((s) => s.tab);
  const stack = useNav((s) => s.stack);
  const back = useNav((s) => s.back);
  const route = currentRoute({ tab, stack });
  const openCount = usePools((s) => s.pools.filter((p) => p.pool.status === 'OPEN').length);
  const toasts = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  const error = useLive((s) => s.error);
  const open = useLive((s) => s.open);
  const channelId = useLive((s) => s.channelId);
  const lang = useSettings((s) => s.lang);
  useEffect(() => { setLang(lang); document.documentElement.lang = lang; }, [lang]);
  useApplySettings();
  useEffect(() => { setBackButton(stack.length ? back : null); return () => setBackButton(null); }, [stack.length, back]);
  const live = route.name === 'tab' && route.tab === 'live';
  // Pool screens carry their own sticky bet dock in the thumb zone instead of the tab bar.
  const noNav = route.name === 'pool';
  const content = routeContent(route);
  return (
    <div className="app">
      <div className="app__bg-lines" />
      <SceneHost />
      <div className="screen-stack">
        <main key={JSON.stringify(route)} className={`screen ${live ? 'screen--flush' : ''} ${noNav ? 'screen--nonav' : ''}`}>
          {error && (
            <div role="alert" className="statusbar statusbar--red">
              {error}{' '}
              <button type="button" onClick={() => void open(channelId)}>
                {t('ui.retry')}
              </button>
            </div>
          )}
          {content}
        </main>
      </div>
      <NavBar openCount={openCount} hidden={noNav} />
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
      <Onboarding />
    </div>
  );
}

/** Toasts can be flicked up (or sideways) to dismiss; running the action also dismisses. */
function ToastView({ item, onDismiss }: { item: Toast; onDismiss: () => void }) {
  return (
    <motion.div
      className={`toast toast--${item.kind}`}
      drag
      dragSnapToOrigin
      dragElastic={0.4}
      onDragEnd={(_, info) => {
        if (info.offset.y < -30 || Math.abs(info.offset.x) > 90) onDismiss();
      }}
    >
      <div>
        <strong>{item.title}</strong>
        {item.body && <div>{item.body}</div>}
      </div>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            item.action!.run();
            onDismiss();
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" aria-label={t('ui.close')} onClick={onDismiss}>
        ×
      </button>
    </motion.div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
