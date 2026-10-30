/**
 * Thin wrapper over the Telegram Mini Apps JS API (telegram-web-app.js).
 * Every call degrades gracefully outside Telegram (browser preview / tests).
 */
type HapticImpact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type HapticNotice = 'error' | 'success' | 'warning';

interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; last_name?: string; username?: string; language_code?: string; photo_url?: string; is_premium?: boolean }; start_param?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  setBottomBarColor?(c: string): void;
  enableClosingConfirmation?(): void;
  disableVerticalSwipes?(): void;
  requestFullscreen?(): void;
  isVersionAtLeast?(v: string): boolean;
  onEvent(e: string, cb: (...a: unknown[]) => void): void;
  offEvent(e: string, cb: (...a: unknown[]) => void): void;
  openLink?(url: string): void;
  openTelegramLink?(url: string): void;
  showConfirm?(msg: string, cb: (ok: boolean) => void): void;
  HapticFeedback?: {
    impactOccurred(s: HapticImpact): void;
    notificationOccurred(s: HapticNotice): void;
    selectionChanged(): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void; isVisible: boolean };
  CloudStorage?: { setItem(k: string, v: string, cb?: (e: unknown, ok?: boolean) => void): void; getItem(k: string, cb: (e: unknown, v?: string) => void): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export function tg(): TgWebApp | null {
  const w = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  // telegram-web-app.js defines WebApp even outside Telegram; initData is empty there.
  return w ?? null;
}

function supports(version: string): boolean {
  return tg()?.isVersionAtLeast?.(version) === true;
}

export function insideTelegram(): boolean {
  const w = tg();
  return !!w && (!!w.initData || w.platform !== 'unknown');
}

export function initTelegram(): void {
  const w = tg();
  if (!w) return;
  try {
    w.ready();
    w.expand();
    // Older clients log a warning for every unsupported call, so gate by API version.
    if (supports('6.1')) {
      w.setHeaderColor?.('#07090B');
      w.setBackgroundColor?.('#07090B');
    }
    if (supports('7.10')) w.setBottomBarColor?.('#07090B');
    if (supports('7.7')) w.disableVerticalSwipes?.();
  } catch {
    /* outside Telegram */
  }
  const applyInsets = () => {
    const root = document.documentElement;
    const sa = w.safeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
    const csa = w.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
    root.style.setProperty('--tg-safe-top', `${(sa.top ?? 0) + (csa.top ?? 0)}px`);
    root.style.setProperty('--tg-safe-bottom', `${sa.bottom ?? 0}px`);
    if (w.viewportStableHeight) root.style.setProperty('--tg-vh', `${w.viewportStableHeight}px`);
  };
  applyInsets();
  w.onEvent('safeAreaChanged', applyInsets);
  w.onEvent('contentSafeAreaChanged', applyInsets);
  w.onEvent('viewportChanged', applyInsets);
}

export function telegramUser(): { id: number; name: string; username?: string; lang?: string; photo?: string; premium?: boolean } | null {
  const u = tg()?.initDataUnsafe?.user;
  if (!u) return null;
  return { id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' '), username: u.username, lang: u.language_code, photo: u.photo_url, premium: u.is_premium };
}

export function startParam(): string | null {
  const w = tg();
  const p = w?.initDataUnsafe?.start_param;
  if (p) return p;
  const q = new URLSearchParams(window.location.search);
  return q.get('tgWebAppStartParam') ?? q.get('startapp');
}

let hapticsEnabled = true;
export function setHapticsEnabled(on: boolean): void {
  hapticsEnabled = on;
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

export const haptic = {
  tap(): void {
    if (!hapticsEnabled) return;
    const h = tg()?.HapticFeedback;
    if (h && insideTelegram() && supports('6.1')) h.selectionChanged();
    else vibrate(6);
  },
  impact(style: HapticImpact = 'light'): void {
    if (!hapticsEnabled) return;
    const h = tg()?.HapticFeedback;
    if (h && insideTelegram() && supports('6.1')) h.impactOccurred(style);
    else vibrate(style === 'heavy' || style === 'rigid' ? 22 : style === 'medium' ? 14 : 8);
  },
  notify(kind: HapticNotice): void {
    if (!hapticsEnabled) return;
    const h = tg()?.HapticFeedback;
    if (h && insideTelegram() && supports('6.1')) h.notificationOccurred(kind);
    else vibrate(kind === 'success' ? [12, 60, 24] : kind === 'error' ? [30, 40, 30, 40, 30] : [18, 50, 18]);
  },
  /** Celebratory rumble for a winning settlement. */
  win(): void {
    if (!hapticsEnabled) return;
    const h = tg()?.HapticFeedback;
    if (h && insideTelegram() && supports('6.1')) {
      h.notificationOccurred('success');
      setTimeout(() => h.impactOccurred('heavy'), 180);
      setTimeout(() => h.impactOccurred('medium'), 320);
      setTimeout(() => h.impactOccurred('rigid'), 470);
    } else vibrate([20, 60, 30, 60, 60]);
  },
};

type BackHandler = () => void;
let baseBack: BackHandler | null = null;
// Open overlays (sheets, dialogs) take the Back button first, newest on top.
const overlayBacks: BackHandler[] = [];
let currentBack: BackHandler | null = null;
const backListener = () => currentBack?.();

function syncBackButton(): void {
  const handler: BackHandler | null = overlayBacks.length ? overlayBacks[overlayBacks.length - 1]! : baseBack;
  const b = tg()?.BackButton;
  if (!b || !insideTelegram() || !supports('6.1')) {
    currentBack = handler;
    return;
  }
  b.offClick(backListener);
  currentBack = handler;
  if (handler) {
    b.onClick(backListener);
    b.show();
  } else b.hide();
}

export function setBackButton(handler: BackHandler | null): void {
  baseBack = handler;
  syncBackButton();
}

/** Routes the Telegram Back button to an overlay until the returned release function is called. */
export function pushOverlayBack(handler: BackHandler): () => void {
  overlayBacks.push(handler);
  syncBackButton();
  return () => {
    const i = overlayBacks.lastIndexOf(handler);
    if (i >= 0) overlayBacks.splice(i, 1);
    syncBackButton();
  };
}
