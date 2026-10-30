import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNav, type TabId } from '@/store/nav';
import { t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { IconFlag, IconHome, IconPulse, IconTrophy, IconUser, NavCar } from './icons';
import { useSettings, prefersReducedMotion } from '@/store/settings';
import { useWallet } from '@/store/wallet';

// Screen enter transitions read the direction from <html data-nav-dir>. Zustand notifies
// synchronously inside set(), so the attribute is in place before the next screen mounts.
if (typeof document !== 'undefined') {
  document.documentElement.dataset.navDir = '0';
  useNav.subscribe((s, prev) => {
    if (s.stack !== prev.stack || s.tab !== prev.tab) document.documentElement.dataset.navDir = String(s.dir);
  });
}

const TABS: Array<{ id: TabId; icon: typeof IconHome; key: string }> = [
  { id: 'home', icon: IconHome, key: 'nav.home' },
  { id: 'races', icon: IconFlag, key: 'nav.races' },
  { id: 'live', icon: IconPulse, key: 'nav.live' },
  { id: 'pools', icon: IconTrophy, key: 'nav.pools' },
  { id: 'profile', icon: IconUser, key: 'nav.profile' },
];

/**
 * F1-style bottom navigation: a tiny race car drives along a dashed
 * "track" to the active tab with acceleration, braking and a light trail.
 * `openCount` stays accepted for compatibility; the badge counts the user's pending entries.
 */
export function NavBar({ hidden }: { hidden?: boolean; openCount?: number }) {
  const tab = useNav((s) => s.tab);
  const pending = useWallet((s) => s.entries.reduce((n, e) => n + (e.state === 'PENDING' ? 1 : 0), 0));
  const go = useNav((s) => s.go);
  const deep = useNav((s) => s.stack.length > 0);
  const motion = useSettings((s) => s.motion);
  const reduced = prefersReducedMotion(motion);
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduced);
  }, [reduced]);
  const trackRef = useRef<HTMLDivElement>(null);
  const carRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const pos = useRef<number | null>(null);
  const raf = useRef(0);
  const [, force] = useState(0);

  const targetX = () => {
    const el = trackRef.current;
    if (!el) return 0;
    const idx = TABS.findIndex((x) => x.id === tab);
    const w = el.clientWidth;
    return ((idx + 0.5) / TABS.length) * (w + 24) - 12;
  };

  useLayoutEffect(() => {
    const to = targetX();
    const car = carRef.current;
    const trail = trailRef.current;
    if (!car || !trail) return;
    if (pos.current === null || reduced) {
      pos.current = to;
      car.style.transform = `translateX(${to}px)`;
      trail.style.opacity = '0';
      return;
    }
    const from = pos.current;
    const dir = to >= from ? 1 : -1;
    const dist = Math.abs(to - from);
    const dur = Math.min(620, 260 + dist * 1.3);
    const t0 = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      // Launch hard, cruise, then brake into the "pit box".
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const x = from + (to - from) * e;
      pos.current = x;
      const speed = Math.sin(Math.PI * k);
      car.style.transform = `translateX(${x}px) scaleX(${dir}) skewX(${-dir * speed * 8}deg)`;
      trail.style.opacity = String(speed * 0.9);
      trail.style.width = `${Math.min(70, dist * speed * 0.6)}px`;
      trail.style.left = `${dir > 0 ? x - Math.min(70, dist * speed * 0.6) : x}px`;
      trail.style.transform = dir > 0 ? 'none' : 'scaleX(-1)';
      if (k < 1) raf.current = requestAnimationFrame(step);
      else {
        car.style.transform = `translateX(${to}px) scaleX(${dir})`;
        trail.style.opacity = '0';
      }
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [tab, reduced]);

  useEffect(() => {
    const onR = () => {
      pos.current = null;
      force((n) => n + 1);
    };
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  return (
    <nav className={`nav ${hidden ? 'nav--hidden' : ''} ${tab === 'live' ? 'nav--live' : ''}`} aria-label={t('nav.label')}>
      <div className="nav__track" ref={trackRef} aria-hidden="true">
        <div className="nav__asphalt" />
        <div className="nav__trail" ref={trailRef} />
        <div className="nav__car" ref={carRef}>
          <NavCar />
        </div>
      </div>
      {TABS.map(({ id, icon: Icon, key }) => {
        const active = id === tab;
        const onClick = () => {
          if (id !== tab) {
            haptic.impact(id === 'live' ? 'medium' : 'light');
            sfx.nav();
          } else if (deep) haptic.tap();
          go(id);
        };
        if (id === 'live') {
          return (
            <div className="nav__center" key={id}>
              <button className="nav__pulse" aria-label={t(key)} aria-current={active ? 'page' : undefined} onClick={onClick}>
                <span className="nav__pulse-ring" aria-hidden="true" />
                <Icon />
                <span className="nav__pulse-label">LIVE</span>
              </button>
            </div>
          );
        }
        return (
          <button
            key={id}
            className="nav__item"
            aria-current={active ? 'page' : undefined}
            aria-label={id === 'pools' && pending > 0 ? `${t(key)} (${pending})` : undefined}
            onClick={onClick}
          >
            <span className="nav__icon">
              <Icon />
              {id === 'pools' && pending > 0 && (
                <span className="nav__badge num" key={pending}>
                  {pending > 99 ? '99+' : pending}
                </span>
              )}
            </span>
            <span className="nav__label">{t(key)}</span>
          </button>
        );
      })}
    </nav>
  );
}
