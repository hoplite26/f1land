import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from '@/i18n/core';
import type { CameraMode } from '@/three/engine/cameraRig';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type MotionSetting = 'system' | 'reduced' | 'full';
export type RenderMode = '3d' | '2d';

interface SettingsState {
  lang: Lang;
  quality: QualitySetting;
  motion: MotionSetting;
  haptics: boolean;
  sound: boolean;
  renderMode: RenderMode;
  camera: CameraMode;
  showZones: boolean;
  favoriteDriver: string | null;
  onboarded: boolean;
  set: (p: Partial<Omit<SettingsState, 'set'>>) => void;
}

function defaultLang(): Lang {
  const tgLang = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } }).Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  const l = (tgLang ?? navigator.language ?? 'ru').toLowerCase();
  return l.startsWith('ru') || l.startsWith('uk') || l.startsWith('be') || l.startsWith('kk') ? 'ru' : 'en';
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      lang: defaultLang(),
      quality: 'auto',
      motion: 'system',
      haptics: true,
      sound: true,
      renderMode: '3d',
      camera: 'director',
      showZones: true,
      favoriteDriver: null,
      onboarded: false,
      set: (p) => set(p),
    }),
    { name: 'pa-f1-settings', version: 1 },
  ),
);

export function prefersReducedMotion(m: MotionSetting): boolean {
  if (m === 'reduced') return true;
  if (m === 'full') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Device heuristic for the 'auto' quality level. */
export function resolveQuality(q: QualitySetting): 'low' | 'medium' | 'high' {
  if (q !== 'auto') return q;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (cores <= 4 || mem <= 3) return 'low';
  if (mobile) return 'medium';
  return cores >= 8 && mem >= 8 ? 'high' : 'medium';
}
