import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { HomeScreen } from '@/screens/Home';
import { LiveScreen } from '@/screens/Live';
import { MyPoolsScreen, EntryScreen } from '@/screens/MyPools';
import { PoolScreen } from '@/screens/Pool';
import { SceneHost } from '@/app/SceneHost';
import { SubHeader } from '@/app/Header';
import { startSessionService } from '@/app/sessionService';
import { useLive, startLiveLoop } from '@/store/live';
import { useNav, currentRoute } from '@/store/nav';
import { usePools } from '@/demo/poolEngine';
import { useSettings } from '@/store/settings';
import { useToasts } from '@/store/toasts';
import { NavBar } from '@/ui/NavBar';
import { registerDict, setLang } from '@/i18n/core';
import { UI_DICTS } from '@/i18n/ui';
import { F1_I18N } from '@/domain/markets/i18n';
import { initTelegram, setBackButton } from '@/telegram/sdk';
import '@/styles/app.css';
import '@/styles/restored.css';

registerDict('ru', { ...UI_DICTS.ru, ...F1_I18N.ru });
registerDict('en', { ...UI_DICTS.en, ...F1_I18N.en });
setLang(useSettings.getState().lang);
initTelegram();
startSessionService();
startLiveLoop();
void useLive.getState().open(useLive.getState().channelId);

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
  useEffect(() => { setLang(lang); }, [lang]);
  useEffect(() => { setBackButton(stack.length ? back : null); return () => setBackButton(null); }, [stack.length, back]);
  const live = route.name === 'tab' && route.tab === 'live';
  let content;
  if (route.name === 'tab' && route.tab === 'home') content = <HomeScreen />;
  else if (live) content = <LiveScreen />;
  else if (route.name === 'tab' && route.tab === 'pools') content = <MyPoolsScreen />;
  else if (route.name === 'pool') content = <PoolScreen key={route.poolId} poolId={route.poolId} />;
  else if (route.name === 'entry') content = <EntryScreen entryId={route.entryId} />;
  else content = <><SubHeader title={lang === 'ru' ? 'Раздел недоступен' : 'Section unavailable'} onBack={() => stack.length ? back() : useNav.getState().go('home')} /><p>{lang === 'ru' ? 'Этот экран отсутствует в переданных файлах проекта.' : 'This screen is missing from the supplied project files.'}</p></>;
  return <div className="app"><div className="app__bg-lines" /><SceneHost /><div className="screen-stack"><main key={JSON.stringify(route)} className={`screen ${live ? 'screen--flush' : ''}`}>{error && <div role="alert" className="statusbar statusbar--red">{error} <button onClick={() => void open(channelId)}>Retry</button></div>}{content}</main></div><NavBar openCount={openCount} /><div className="toast-wrap" aria-live="polite">{toasts.map((item) => <div className={`toast toast--${item.kind}`} key={item.id}><div><strong>{item.title}</strong>{item.body && <div>{item.body}</div>}</div>{item.action && <button onClick={item.action.run}>{item.action.label}</button>}<button aria-label="Close" onClick={() => dismiss(item.id)}>×</button></div>)}</div></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
