import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useLive, onFrame, onMoment } from '@/store/live';
import { useSettings, prefersReducedMotion, resolveQuality } from '@/store/settings';
import { RaceScene } from '@/three/engine/RaceScene';
import type { CameraMode } from '@/three/engine/cameraRig';
import { TrackMap } from '@/ui/TrackMap';
import { useMapCars } from '@/app/hooks';
import { t } from '@/i18n/core';
import { sfx } from '@/audio/sfx';
import { haptic } from '@/telegram/sdk';
import '@/styles/scene.css';

export type SceneLayout = 'hidden' | 'full' | 'top';

interface SceneViewState {
  layout: SceneLayout;
  zone: 1 | 2 | 3 | null;
  frameZone: boolean;
  /** Extra label ids (pool subjects). */
  labels: string[];
  cameraOverride: CameraMode | null;
  frozen: boolean;
  webglLost: boolean;
  pickList: string[] | null;
  /** 3D build progress 0..1 and readiness (screens show their own loading UI from these). */
  buildProgress: number;
  sceneReady: boolean;
  /** Canvas px covered by the screen's own UI (top strip / bottom cards); framing avoids them. */
  insets: { top: number; bottom: number };
  set: (p: Partial<Omit<SceneViewState, 'set'>>) => void;
}

export const useSceneView = create<SceneViewState>((set) => ({
  layout: 'hidden',
  zone: null,
  frameZone: false,
  labels: [],
  cameraOverride: null,
  frozen: false,
  webglLost: false,
  pickList: null,
  buildProgress: 0,
  sceneReady: false,
  insets: { top: 0, bottom: 0 },
  set: (p) => set(p),
}));

let activeScene: RaceScene | null = null;
/** WebGL context losses this session: each one steps the quality tier down before the automatic retry. */
let contextLosses = 0;
let retryTimer = 0;
const QUALITY_STEPS = ['low', 'medium', 'high'] as const;

function effectiveQuality(q: ReturnType<typeof resolveQuality>): ReturnType<typeof resolveQuality> {
  const i = QUALITY_STEPS.indexOf(q);
  return QUALITY_STEPS[Math.max(0, i - contextLosses)]!;
}
export function getScene(): RaceScene | null {
  return activeScene;
}

let webglProbe: boolean | null = null;
/** Probed once: a throwaway context per render is slow and counts against the browser's live-context limit. */
function webglAvailable(): boolean {
  if (webglProbe !== null) return webglProbe;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    webglProbe = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}

/**
 * Persistent scene host: owns the single WebGL context. Screens choose the
 * layout ('full' for Live, 'top' for pool screens). Falls back to the SVG
 * map when 2D mode is chosen or the context is lost (F1-045, QA19).
 */
export function SceneHost() {
  const layout = useSceneView((s) => s.layout);
  const webglLost = useSceneView((s) => s.webglLost);
  const renderMode = useSettings((s) => s.renderMode);
  const runner = useLive((s) => s.runner);
  const use3d = renderMode === '3d' && !webglLost && webglAvailable();
  return (
    <div className={`scene-host scene-host--${layout}`} aria-hidden={layout === 'hidden'}>
      {runner && layout !== 'hidden' && (use3d ? <Scene3D key={`${runner.manifest.session_id}`} /> : <Scene2D />)}
    </div>
  );
}

function Scene2D() {
  const runner = useLive((s) => s.runner);
  const live = useLive((s) => s.live);
  const followId = useLive((s) => s.followId);
  const rivalId = useLive((s) => s.rivalId);
  const zone = useSceneView((s) => s.zone);
  const labels = useSceneView((s) => s.labels);
  const cars = useMapCars(live, followId, rivalId, labels);
  if (!runner) return null;
  return (
    <div className="scene-2d">
      <TrackMap circuit={runner.circuit} cars={cars} selectedSector={zone} width={360} height={360} padding={26} showCorners stale={live?.stale} />
    </div>
  );
}

function Scene3D() {
  const host = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const runner = useLive((s) => s.runner);
  const live = useLive((s) => s.live);
  const followId = useLive((s) => s.followId);
  const rivalId = useLive((s) => s.rivalId);
  const quality = useSettings((s) => s.quality);
  const motion = useSettings((s) => s.motion);
  const camera = useSettings((s) => s.camera);
  const showZones = useSettings((s) => s.showZones);
  const view = useSceneView();
  const [ready, setReady] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const sceneRef = useRef<RaceScene | null>(null);

  // Build scene for this session.
  useEffect(() => {
    if (!host.current || !labelsRef.current || !runner) return;
    let disposed = false;
    setReady(false);
    setBuildProgress(0);
    useSceneView.getState().set({ sceneReady: false, buildProgress: 0 });
    const scene = new RaceScene(host.current, {
      quality: effectiveQuality(resolveQuality(quality)),
      reducedMotion: prefersReducedMotion(motion),
      labelLayer: labelsRef.current,
      onContextLost: () => {
        contextLosses++;
        useSceneView.getState().set({ webglLost: true });
        // Recover automatically (once or twice) on a lower tier; the 2D map covers the gap.
        window.clearTimeout(retryTimer);
        if (contextLosses <= 2) retryTimer = window.setTimeout(() => useSceneView.getState().set({ webglLost: false }), 2500);
      },
      onPick: (ids) => {
        haptic.tap();
        if (ids.length === 1) useLive.getState().setFollow(ids[0]!);
        else useSceneView.getState().set({ pickList: ids });
      },
    });
    sceneRef.current = scene;
    activeScene = scene;
    if (import.meta.env.DEV) Object.assign(window, { __scene: scene });
    const progress = (p: number) => {
      if (disposed) return;
      setBuildProgress(p);
      useSceneView.getState().set({ buildProgress: p });
    };
    void scene.load(runner.circuit, runner.model, runner.manifest.participants, progress).then(() => {
      if (disposed) return;
      setReady(true);
      useSceneView.getState().set({ sceneReady: true, buildProgress: 1 });
    });
    const offFrame = onFrame((f) => scene.pushFrame(f));
    const offMoment = onMoment((m) => {
      scene.onMoment(m);
      if (m.kind === 'OVERTAKE' && m.drivers.includes(useLive.getState().followId ?? '')) sfx.overtake();
    });
    let raf = 0;
    let last = performance.now();
    let nextPoster = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = useLive.getState();
      // While the feed catches up nothing moves: refresh a still establishing frame now and then
      // (rarer when frames are expensive) and leave the main thread to the catch-up.
      const syncing = !st.live || st.loading;
      if ((!syncing || now >= nextPoster) && document.visibilityState !== 'hidden' && useSceneView.getState().layout !== 'hidden') {
        scene.render(dt, st.live?.stale ?? false);
        if (syncing) nextPoster = now + Math.max(1200, (performance.now() - now) * 20);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      offFrame();
      offMoment();
      scene.dispose();
      if (activeScene === scene) activeScene = null;
      sceneRef.current = null;
      useSceneView.getState().set({ sceneReady: false, buildProgress: 0 });
    };
    // Quality change rebuilds the scene; the selection lives in stores and survives (F1-045).
  }, [runner, quality]);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(prefersReducedMotion(motion));
  }, [motion]);

  useEffect(() => {
    sceneRef.current?.follow(followId);
  }, [followId, ready]);
  useEffect(() => {
    sceneRef.current?.setRival(rivalId);
  }, [rivalId, ready]);
  useEffect(() => {
    sceneRef.current?.setCameraMode(view.cameraOverride ?? camera);
  }, [camera, view.cameraOverride, ready]);
  useEffect(() => {
    sceneRef.current?.freezeCamera(view.frozen);
  }, [view.frozen]);
  useEffect(() => {
    sceneRef.current?.setInsets(view.insets.top, view.insets.bottom);
  }, [view.insets, ready]);
  useEffect(() => {
    sceneRef.current?.setZone(view.zone, view.frameZone);
  }, [view.zone, view.frameZone, ready]);
  useEffect(() => {
    sceneRef.current?.showZones(showZones || view.zone !== null);
  }, [showZones, view.zone]);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !live) return;
    s.setTrackState(live.trackState);
    // Labels: followed, rival, two nearest neighbours + pool subjects (F1-048).
    const ids = new Set<string>();
    if (followId) ids.add(followId);
    if (rivalId) ids.add(rivalId);
    view.labels.forEach((id) => ids.add(id));
    const idx = live.cars.findIndex((c) => c.id === followId);
    if (idx >= 0) {
      if (live.cars[idx - 1]) ids.add(live.cars[idx - 1]!.id);
      if (live.cars[idx + 1]) ids.add(live.cars[idx + 1]!.id);
    }
    s.setLabelIds([...ids]);
    s.setPositions(new Map(live.cars.map((c) => [c.id, c.position])));
    s.setSectorFlags(live.sectorFlags);
  }, [live, followId, rivalId, view.labels]);

  return (
    <>
      <div ref={host} className="scene-canvas-wrap" />
      <div className="scene-vignette" />
      <div ref={labelsRef} className="label-layer" />
      {/* Live renders one combined build + sync status card; other layouts use this one. */}
      {!ready && view.layout !== 'full' && (
        <div className="scene-loading">
          <div className="loader-ring" />
          <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            {t('ui.building')} {Math.round(buildProgress * 100)}%
          </div>
        </div>
      )}
    </>
  );
}
