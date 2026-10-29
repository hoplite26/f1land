import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSettings } from '@/store/settings';
import { CHANNELS } from '@/demo/channels';
import { IconChevron, LogoPulse } from '@/ui/icons';
import { t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { CircuitThumb, useReduced } from './common';

const STEPS = 3;

function LightsVisual() {
  const circuit = CHANNELS.find((c) => c.featured)?.circuitId ?? CHANNELS[0]!.circuitId;
  return (
    <div className="sc-onb__vis">
      <div className="sc-onb__lights" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ animationDelay: `${0.25 + i * 0.32}s` }}>
            <i />
            <i />
          </span>
        ))}
      </div>
      <CircuitThumb id={circuit} size={210} draw cars={['#ff8000', '#e8002d', '#27f4d2', '#3671c6']} className="sc-onb__track" />
    </div>
  );
}

function ZonesVisual() {
  return (
    <div className="sc-onb__vis">
      <CircuitThumb id="jp-1962" size={220} draw className="sc-onb__track sc-onb__track--dim" />
      <div className="sc-onb__zones" aria-hidden="true">
        <span style={{ ['--c' as string]: 'var(--cyan)', left: '6%', top: '22%' }}>
          S1 <b>×2.8</b>
        </span>
        <span data-on style={{ ['--c' as string]: 'var(--lime)', left: '40%', top: '6%' }}>
          S2 <b>×1.9</b>
        </span>
        <span style={{ ['--c' as string]: 'var(--purple)', right: '4%', top: '54%' }}>
          S3 <b>×3.4</b>
        </span>
      </div>
    </div>
  );
}

function SwipeVisual() {
  return (
    <div className="sc-onb__vis sc-onb__vis--swipe">
      <div className="sc-onb__ticket" aria-hidden="true">
        <span className="sc-onb__tk">{t('scr.onb.ticket')}</span>
        <b>NOR → LEC</b>
        <span className="num lime">×1.85</span>
      </div>
      <div className="sc-onb__swipe" aria-hidden="true">
        <span className="sc-onb__knob">
          <IconChevron size={20} />
        </span>
        <span className="sc-onb__slabel">{t('scr.onb.swipe')}</span>
      </div>
    </div>
  );
}

export function Onboarding() {
  const onboarded = useSettings((s) => s.onboarded);
  const set = useSettings((s) => s.set);
  const reduced = useReduced();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);

  useEffect(() => {
    if (!onboarded) setStep(0);
  }, [onboarded]);

  const finish = () => {
    haptic.notify('success');
    sfx.confirm();
    set({ onboarded: true });
  };
  const goTo = (n: number) => {
    if (n < 0 || n >= STEPS || n === step) return;
    haptic.tap();
    sfx.tap();
    setDir(n > step ? 1 : -1);
    setStep(n);
  };
  const next = () => (step < STEPS - 1 ? goTo(step + 1) : finish());

  const heads = ['scr.onb.h1', 'scr.onb.h2', 'scr.onb.h3'];
  const bodies = ['onb.s1', 'onb.s2', 'onb.s3'];
  const slide = reduced ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : { initial: { opacity: 0, x: 60 * dir }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -60 * dir } };

  return (
    <AnimatePresence>
      {!onboarded && (
        <motion.div className="sc-onb" role="dialog" aria-modal="true" aria-label={t('onb.title')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : 1.04 }} transition={{ duration: 0.35 }}>
          <div className="sc-onb__bg" aria-hidden="true" />
          <div className="sc-onb__top">
            <div className="brand">
              <LogoPulse className="brand__logo" />
              <div className="brand__text">
                <span className="brand__name">
                  PULSE <b>ARENA</b>
                </span>
                <span className="brand__sub">{t('app.module')}</span>
              </div>
            </div>
            <button className="sc-onb__skip" onClick={finish}>
              {t('scr.onb.skip')}
            </button>
          </div>
          <motion.div
            className="sc-onb__stage"
            drag={reduced ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            onDragEnd={(_, info) => {
              if (info.offset.x < -60 || info.velocity.x < -400) goTo(step + 1);
              else if (info.offset.x > 60 || info.velocity.x > 400) goTo(step - 1);
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={step} className="sc-onb__slide" {...slide} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                {step === 0 ? <LightsVisual /> : step === 1 ? <ZonesVisual /> : <SwipeVisual />}
                <div className="sc-onb__copy">
                  <div className="sc-onb__k num">
                    0{step + 1} <i>/ 0{STEPS}</i>
                  </div>
                  {step === 0 && <div className="sc-onb__welcome">{t('onb.title')}</div>}
                  <h2 className="sc-onb__h">{t(heads[step]!)}</h2>
                  <p className="sc-onb__p">{t(bodies[step]!)}</p>
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>
          <div className="sc-onb__foot">
            <div className="sc-onb__dots" role="tablist" aria-label={t('onb.title')}>
              {Array.from({ length: STEPS }, (_, i) => (
                <button key={i} role="tab" aria-selected={i === step} aria-label={`${i + 1} / ${STEPS}`} onClick={() => goTo(i)}>
                  <span />
                </button>
              ))}
            </div>
            <button className="btn btn--primary btn--lg btn--block sc-onb__go" onClick={next}>
              {step < STEPS - 1 ? t('scr.onb.next') : t('onb.go')}
              <IconChevron size={18} />
            </button>
            <p className="sc-onb__demo">{t('app.demoNote')}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
