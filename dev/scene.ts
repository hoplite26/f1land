/**
 * Standalone race-scene harness (independent of the app screens):
 *   /dev/scene.html?ch=ae-gp&q=high&cam=director&zone=2&follow=VER&rival=LEC&hud=1
 *   &idle=1       withhold sim frames (the pre-live "syncing" state: grid + flyover)
 *   &colliders=1  draw the camera-occlusion proxies
 *   &lang=ru      label language (default en)
 * Exposes window.__scene / __live / __setCam / __feed(on) for screenshot scripts.
 */
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@/styles/scene.css';
import { useLive, onFrame, onMoment, startLiveLoop } from '@/store/live';
import { setLang } from '@/i18n/core';
import { registerFeatureDicts } from '@/i18n/extra';
import { RaceScene } from '@/three/engine/RaceScene';
import type { CameraMode } from '@/three/engine/cameraRig';
import type { ModelQuality } from '@/three/models/types';

const params = new URLSearchParams(location.search);
const ch = params.get('ch') ?? 'ae-gp';
const quality = (params.get('q') ?? 'medium') as ModelQuality;
const cam = (params.get('cam') ?? 'director') as CameraMode;
const zone = params.get('zone') ? (Number(params.get('zone')) as 1 | 2 | 3) : null;
const hud = document.getElementById('hud')!;
if (!params.get('hud')) hud.style.display = 'none';

registerFeatureDicts();
setLang(params.get('lang') === 'ru' ? 'ru' : 'en');

let scene: RaceScene | null = null;
let builtFor: unknown = null;
let feed = params.get('idle') !== '1';
startLiveLoop();
// Replay mode starts at the session start; ?t=<seconds> seeks (fast catch-up below).
const seekT = Number(params.get('t') ?? '0');
void useLive.getState().open(ch, params.get('mode') === 'live' ? 'live' : 'replay').then(() => {
  const r = useLive.getState().runner as unknown as { replayBaseT: number; replayWall: number } | null;
  if (r && seekT > 0) {
    r.replayBaseT = seekT;
    r.replayWall = Date.now();
  }
});
onFrame((f) => feed && scene?.pushFrame(f));
onMoment((m) => feed && scene?.onMoment(m));

useLive.subscribe((st) => {
  const r = st.runner;
  if (r && r !== builtFor) {
    builtFor = r;
    scene?.dispose();
    const s = new RaceScene(document.getElementById('wrap')!, {
      quality,
      reducedMotion: params.get('reduced') === '1',
      labelLayer: document.getElementById('labels')!,
      onContextLost: () => console.warn('[scene] context lost'),
      onPick: (ids) => useLive.getState().setFollow(ids[0]!),
    });
    scene = s;
    Object.assign(window, { __scene: s });
    void s.load(r.circuit, r.model, r.manifest.participants).then(() => {
      s.setCameraMode(cam);
      s.showZones(true);
      s.setZone(zone, params.get('frameZone') === '1');
      if (params.get('colliders') === '1') s.scene.add(s.colliders.debugMesh());
      (window as unknown as { __ready: boolean }).__ready = true;
    });
  }
  const s = scene;
  const live = st.live;
  if (!s || !live) return;
  const follow = params.get('follow') ?? st.followId;
  if (follow && st.followId !== follow && live.cars.some((c) => c.id === follow)) st.setFollow(follow);
  const rival = params.get('rival');
  if (rival && st.rivalId !== rival) st.setRival(rival);
  s.follow(st.followId);
  s.setRival(st.rivalId);
  s.setTrackState(live.trackState);
  s.setSectorFlags(live.sectorFlags);
  s.setPositions(new Map(live.cars.map((c) => [c.id, c.position])));
  const ids = new Set<string>();
  if (st.followId) ids.add(st.followId);
  if (st.rivalId) ids.add(st.rivalId);
  const idx = live.cars.findIndex((c) => c.id === st.followId);
  if (idx >= 0) {
    if (live.cars[idx - 1]) ids.add(live.cars[idx - 1]!.id);
    if (live.cars[idx + 1]) ids.add(live.cars[idx + 1]!.id);
  }
  s.setLabelIds([...ids]);
});

Object.assign(window, {
  __live: useLive,
  __setCam: (m: CameraMode) => scene?.setCameraMode(m),
  __feed: (on: boolean) => (feed = on),
});

let last = performance.now();
let frames = 0;
let acc = 0;
const loop = (now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const runner = useLive.getState().runner;
  // While the sim catches up, give it the CPU instead of rendering (SwiftShader is slow).
  if (runner?.catchingUp) runner.tick(Date.now(), 250);
  else scene?.render(dt, useLive.getState().live?.stale ?? false);
  frames++;
  acc += dt;
  if (acc > 1 && scene) {
    const st = scene.stats();
    hud.textContent = `${(frames / acc).toFixed(0)} fps  calls ${st.calls}  tris ${(st.triangles / 1000).toFixed(0)}k  ${st.shot}`;
    frames = 0;
    acc = 0;
  }
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
