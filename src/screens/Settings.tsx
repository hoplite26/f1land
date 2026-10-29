import { useEffect, useState, type ReactNode } from 'react';
import { useSettings, resolveQuality, type MotionSetting, type QualitySetting, type RenderMode } from '@/store/settings';
import { useWallet } from '@/store/wallet';
import { useRewards } from '@/store/rewards';
import { useToasts } from '@/store/toasts';
import { SubHeader } from '@/app/Header';
import { Card, Segmented } from '@/ui/kit';
import { IconEye, IconGlobe, IconInfo, IconLayers, IconMap, IconPlay, IconSound, IconSpark, IconVibrate, IconWarning, LogoPulse } from '@/ui/icons';
import { t, type Lang } from '@/i18n/core';
import { haptic, insideTelegram, setHapticsEnabled } from '@/telegram/sdk';
import { setSoundEnabled, sfx } from '@/audio/sfx';
import { PageHead, PortalSheet, Reveal, Toggle, useBack } from './common';

/** Applies persisted preferences to the haptics/sfx modules and the motion CSS hooks. */
export function useApplySettings(): void {
  const haptics = useSettings((s) => s.haptics);
  const sound = useSettings((s) => s.sound);
  const motion = useSettings((s) => s.motion);
  useEffect(() => setHapticsEnabled(haptics), [haptics]);
  useEffect(() => setSoundEnabled(sound), [sound]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('reduce-motion', motion === 'reduced');
    root.classList.toggle('motion-auto', motion === 'system');
  }, [motion]);
}

function Row({ icon, title, sub, children, tone = 'lime' }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <div className="sc-set">
      <span className={`sc-ic sc-ic--${tone}`}>{icon}</span>
      <span className="sc-set__txt">
        <b>{title}</b>
        {sub && <span className="muted">{sub}</span>}
      </span>
      {children}
    </div>
  );
}

function Block({ icon, title, sub, children, tone = 'lime' }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <div className="sc-set sc-set--block">
      <div className="sc-set__head">
        <span className={`sc-ic sc-ic--${tone}`}>{icon}</span>
        <span className="sc-set__txt">
          <b>{title}</b>
          {sub && <span className="muted">{sub}</span>}
        </span>
      </div>
      {children}
    </div>
  );
}

export function SettingsScreen() {
  const back = useBack();
  const s = useSettings();
  const toast = useToasts((x) => x.push);
  const [confirm, setConfirm] = useState(false);
  const resolved = resolveQuality(s.quality);

  const reset = () => {
    useWallet.getState().reset();
    useRewards.getState().reset();
    haptic.notify('warning');
    sfx.warn();
    setConfirm(false);
    toast({ kind: 'warn', title: t('settings.resetDone') });
  };

  return (
    <>
      <SubHeader onBack={back} />
      <PageHead kicker={t('scr.settings.kicker')} title={t('settings.title')} />

      <Reveal i={0} className="section">
        <div className="sc-set-group">
          <Block icon={<IconGlobe size={18} />} title={t('settings.language')} tone="cyan">
            <Segmented<Lang>
              label={t('settings.language')}
              value={s.lang}
              onChange={(lang) => s.set({ lang })}
              options={[
                { id: 'ru', label: 'Русский' },
                { id: 'en', label: 'English' },
              ]}
            />
          </Block>
        </div>
      </Reveal>

      <Reveal i={1} className="section">
        <div className="sc-set-title">{t('settings.graphics')}</div>
        <div className="sc-set-group">
          <Block icon={<IconLayers size={18} />} title={t('settings.quality')} sub={s.quality === 'auto' ? t('scr.settings.autoIs', { q: t(`settings.q.${resolved}`) }) : t('scr.settings.qualitySub')}>
            <Segmented<QualitySetting>
              label={t('settings.quality')}
              value={s.quality}
              onChange={(quality) => s.set({ quality })}
              options={(['auto', 'low', 'medium', 'high'] as const).map((q) => ({ id: q, label: t(`settings.q.${q}`) }))}
            />
          </Block>
          <Block icon={<IconMap size={18} />} title={t('settings.render')} sub={s.renderMode === '3d' ? t('scr.settings.render3d') : t('scr.settings.render2d')} tone="cyan">
            <Segmented<RenderMode>
              label={t('settings.render')}
              value={s.renderMode}
              onChange={(renderMode) => s.set({ renderMode })}
              options={[
                { id: '3d', label: '3D' },
                { id: '2d', label: '2D' },
              ]}
            />
          </Block>
          <Block icon={<IconSpark size={18} />} title={t('settings.motion')} sub={`${t(`settings.m.${s.motion}`)} · ${t('scr.settings.motionSub')}`} tone="purple">
            <Segmented<MotionSetting>
              label={t('settings.motion')}
              value={s.motion}
              onChange={(motion) => s.set({ motion })}
              options={(['system', 'reduced', 'full'] as const).map((m) => ({ id: m, label: t(`scr.settings.m.${m}`) }))}
            />
          </Block>
        </div>
      </Reveal>

      <Reveal i={2} className="section">
        <div className="sc-set-title">{t('scr.settings.feedback')}</div>
        <div className="sc-set-group">
          <Row icon={<IconVibrate size={18} />} title={t('settings.haptics')} sub={t('scr.settings.hapticsSub')} tone="orange">
            <Toggle
              on={s.haptics}
              label={t('settings.haptics')}
              onChange={(haptics) => {
                s.set({ haptics });
                setHapticsEnabled(haptics);
                if (haptics) haptic.impact('medium');
              }}
            />
          </Row>
          <Row icon={<IconSound size={18} />} title={t('settings.sound')} sub={t('scr.settings.soundSub')} tone="cyan">
            <Toggle
              on={s.sound}
              label={t('settings.sound')}
              onChange={(sound) => {
                s.set({ sound });
                setSoundEnabled(sound);
                if (sound) sfx.confirm();
              }}
            />
          </Row>
          <Row icon={<IconEye size={18} />} title={t('settings.zones')} sub={t('scr.settings.zonesSub')}>
            <Toggle on={s.showZones} label={t('settings.zones')} onChange={(showZones) => s.set({ showZones })} />
          </Row>
        </div>
      </Reveal>

      <Reveal i={3} className="section">
        <div className="sc-set-title">{t('settings.about')}</div>
        <Card className="sc-about" pad>
          <div className="sc-about__brand">
            <LogoPulse className="brand__logo" />
            <div>
              <b>
                PULSE <span className="lime">ARENA</span>
              </b>
              <span className="muted">
                {t('app.module')} · DEMO · v1.0.0
              </span>
            </div>
            <span className={`badge ${insideTelegram() ? 'badge--cyan' : 'badge--ghost'}`}>{insideTelegram() ? 'Telegram' : t('scr.settings.browser')}</span>
          </div>
          <p>{t('app.demoNote')}</p>
          <p className="muted">{t('settings.attribution')}</p>
        </Card>
        <button
          className="sc-menu"
          onClick={() => {
            haptic.tap();
            s.set({ onboarded: false });
          }}
        >
          <span className="sc-ic sc-ic--lime">
            <IconPlay size={18} />
          </span>
          <span className="sc-menu__txt">
            <span className="sc-menu__t">{t('scr.settings.tour')}</span>
            <span className="sc-menu__s">{t('scr.settings.tourSub')}</span>
          </span>
        </button>
      </Reveal>

      <Reveal i={4} className="section">
        <button
          className="sc-danger"
          onClick={() => {
            haptic.impact('medium');
            setConfirm(true);
          }}
        >
          <IconWarning size={18} />
          {t('settings.reset')}
        </button>
        <p className="sc-fine">
          <IconInfo size={12} /> {t('scr.settings.resetHint')}
        </p>
      </Reveal>

      <PortalSheet open={confirm} onClose={() => setConfirm(false)} label={t('settings.reset')} title={t('settings.reset')}>
        <div className="sc-confirm">
          <span className="sc-confirm__ic">
            <IconWarning size={28} />
          </span>
          <p>{t('scr.settings.resetBody')}</p>
          <div className="sc-btnrow sc-btnrow--split">
            <button className="btn btn--ghost" onClick={() => setConfirm(false)}>
              {t('ui.cancel')}
            </button>
            <button className="btn sc-btn-danger" onClick={reset}>
              {t('scr.settings.resetConfirm')}
            </button>
          </div>
        </div>
      </PortalSheet>
    </>
  );
}
