/**
 * Dev showcase for procedural environment props.
 *   /dev/props.html?show=grandstand&tod=night&q=medium
 * Params: show, tod (day|dusk|night), q (low|medium|high), theme, lights (gantry: 0..5|off|green),
 * ex (crowd excitement 0..1), t (freeze time), cam (x,y,z,tx,ty,tz).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TEAMS } from '@/data/teams';
import type { EnvironmentTheme, LandmarkKind, TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '@/three/models/types';
import * as P from '@/three/models/props';

const params = new URLSearchParams(location.search);
const show = params.get('show') ?? 'grandstand';
const tod = (params.get('tod') ?? 'day') as TimeOfDay;
const quality = (params.get('q') ?? 'medium') as ModelQuality;
const fixedT = params.has('t') ? Number(params.get('t')) : null;
const excite = Number(params.get('ex') ?? '0.4');

const LANDMARKS: LandmarkKind[] = [
  'yas-hotel', 'ferris-wheel', 'harbour', 'marina', 'sphere', 'towers', 'sakhir-tower', 'stadium',
  'observation-tower', 'mountains', 'lake', 'bridge',
];
const SHOWS = ['all', 'crowd', 'grandstand', 'gantry', 'pit', 'barriers', 'trees', 'buildings', 'skyline', 'water', 'sky', ...LANDMARKS];

const defaultTheme: Record<string, EnvironmentTheme> = {
  'yas-hotel': 'desert', 'sakhir-tower': 'desert', sphere: 'street', towers: 'street', harbour: 'street', marina: 'desert',
  buildings: 'street', skyline: 'street', mountains: 'forest', lake: 'parkland', water: 'street', stadium: 'parkland',
};
const theme = (params.get('theme') ?? defaultTheme[show] ?? 'countryside') as EnvironmentTheme;

// ---------------------------------------------------------------- renderer
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const atm = P.applyPropsTimeOfDay(tod, theme);
renderer.toneMappingExposure = atm.exposure;
scene.fog = new THREE.FogExp2(atm.fogColor, atm.fogDensity);
const sky = P.createSkyDome(tod, theme);
scene.add(sky.mesh);
scene.add(new THREE.HemisphereLight(atm.hemiSky, atm.hemiGround, atm.hemiIntensity));
const sun = new THREE.DirectionalLight(atm.sunColor, atm.sunIntensity);
sun.position.copy(atm.sunDirection).multiplyScalar(500);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 8000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const updaters: ((t: number) => void)[] = [(t) => sky.update(t), (t) => P.updatePropsTime(t)];
const teamColors = TEAMS.map((t) => t.color);
const palette = TEAMS.flatMap((t) => [t.color, t.livery.primary]);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- helpers
function ground(size = 6000, repeat = 375): void {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), P.createGroundMaterial(theme, tod, { repeat, quality }));
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.03;
  scene.add(g);
}
function water(x: number, z: number, w: number, d: number): void {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), P.createWaterMaterial(tod, { quality }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.02, z);
  scene.add(m);
}

const asphalt = new THREE.MeshLambertMaterial({ color: '#2b2d31' });
const lineMat = new THREE.MeshLambertMaterial({ color: '#e8e8e8' });
function trackStrip(len: number, width: number, axis: 'x' | 'z', offset = 0): void {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(axis === 'x' ? len : width, axis === 'x' ? width : len), asphalt);
  g.rotation.x = -Math.PI / 2;
  g.position.set(axis === 'x' ? 0 : offset, 0.01, axis === 'x' ? offset : 0);
  scene.add(g);
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(axis === 'x' ? len : 0.25, axis === 'x' ? 0.25 : len), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(axis === 'x' ? 0 : offset + s * (width / 2 - 0.4), 0.02, axis === 'x' ? offset + s * (width / 2 - 0.4) : 0);
    scene.add(l);
  }
}

function loopPoints(rx: number, rz: number, n = 200): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = 1 + 0.12 * Math.sin(a * 3);
    pts.push(V(Math.cos(a) * rx * wob, 0, Math.sin(a) * rz * wob));
  }
  return pts;
}
/** Offset to the left of travel direction (negative = right). */
function offsetLine(pts: THREE.Vector3[], d: number, closed = true): THREE.Vector3[] {
  return pts.map((p, i) => {
    const a = pts[closed ? (i - 1 + pts.length) % pts.length : Math.max(0, i - 1)]!;
    const b = pts[closed ? (i + 1) % pts.length : Math.min(pts.length - 1, i + 1)]!;
    const t = V(b.x - a.x, 0, b.z - a.z).normalize();
    return V(p.x + t.z * d, 0, p.z - t.x * d);
  });
}
function ribbon(pts: THREE.Vector3[], width: number, closed = true): void {
  const pos: number[] = [];
  const L = offsetLine(pts, width / 2, closed);
  const R = offsetLine(pts, -width / 2, closed);
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % pts.length;
    pos.push(L[i]!.x, 0.01, L[i]!.z, R[i]!.x, 0.01, R[i]!.z, R[j]!.x, 0.01, R[j]!.z);
    pos.push(L[i]!.x, 0.01, L[i]!.z, R[j]!.x, 0.01, R[j]!.z, L[j]!.x, 0.01, L[j]!.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#2b2d31', side: THREE.DoubleSide })));
}

function frame(pos: [number, number, number], target: [number, number, number]): void {
  const cam = params.get('cam');
  if (cam) {
    const v = cam.split(',').map(Number);
    pos = [v[0]!, v[1]!, v[2]!];
    target = [v[3]!, v[4]!, v[5]!];
  }
  camera.position.set(...pos);
  controls.target.set(...target);
  controls.update();
}

function addLandmark(kind: LandmarkKind, x = 0, z = 0, rot = 0, s = 1): P.LandmarkModel {
  const lm = P.createLandmark(kind, quality, tod);
  lm.root.position.set(x, 0, z);
  lm.root.rotation.y = rot;
  lm.root.scale.setScalar(s);
  scene.add(lm.root);
  updaters.push(lm.update);
  return lm;
}

// ---------------------------------------------------------------- shows
const shows: Record<string, () => void> = {
  crowd() {
    ground();
    const seats: number[] = [];
    for (let r = 0; r < 18; r++) for (let i = 0; i < 70; i++) seats.push(-19 + i * 0.55, r * 0.45, -r * 0.9);
    const crowd = P.createCrowd({ seats: new Float32Array(seats), facing: 0, palette, quality });
    crowd.setExcitement(excite);
    scene.add(crowd.mesh);
    updaters.push((t) => crowd.update(t));
    frame([6, 6, 22], [0, 3, -6]);
  },
  grandstand() {
    ground();
    trackStrip(500, 14, 'x', 14);
    const gs = P.createGrandstand({ lengthM: 96, rows: 18, quality, palette, roof: true, bannerText: 'Main Grandstand' });
    gs.crowd.setExcitement(excite);
    scene.add(gs.root);
    updaters.push(gs.update);
    const g2 = P.createGrandstand({ lengthM: 60, rows: 12, quality, palette, roof: false, seatColor: '#b91c1c', bannerText: 'Turn 1' });
    g2.root.position.set(92, 0, 0);
    g2.root.rotation.y = -0.35;
    g2.crowd.setExcitement(excite);
    scene.add(g2.root);
    updaters.push(g2.update);
    scene.add(P.createBarrierRun([V(-140, 0, 6.5), V(160, 0, 6.5)], 'fence', quality, { trackSide: 'right' }));
    scene.add(P.createAdBoards([V(-140, 0, 6.2), V(160, 0, 6.2)], quality, { trackSide: 'right', elevation: 0.05 }));
    frame([-30, 9, 44], [6, 6, -6]);
  },
  gantry() {
    ground();
    trackStrip(400, 14, 'z');
    const g = P.createStartGantry(14);
    const l = params.get('lights') ?? '3';
    g.setLights(l === 'off' || l === 'green' ? l : Number(l));
    scene.add(g.root);
    scene.add(P.createBarrierRun([V(9, 0, -150), V(9, 0, 150)], 'concrete', quality, { trackSide: 'right' }));
    scene.add(P.createBarrierRun([V(-9, 0, 150), V(-9, 0, -150)], 'concrete', quality, { trackSide: 'right' }));
    frame([7.5, 2.4, -24], [0, 6.0, 0]);
  },
  pit() {
    ground();
    trackStrip(500, 12, 'x', 7);
    trackStrip(500, 14, 'x', 22);
    const pit = P.createPitComplex({ lengthM: 280, boxes: 11, teamColors, quality });
    scene.add(pit.root);
    scene.add(P.createPitBoxMarkings({ lengthM: 280, boxes: 11, teamColors, quality }));
    updaters.push(pit.update);
    frame([-60, 14, 70], [10, 8, 0]);
  },
  barriers() {
    ground();
    const pts = loopPoints(90, 60, 160);
    ribbon(pts, 12);
    const out = offsetLine(pts, -7.5);
    const inn = offsetLine(pts, 7.5);
    // CCW loop: track lies to the left of the outer edge (travelling along it).
    const q1 = (arr: THREE.Vector3[], a: number, b: number) => arr.slice(Math.floor(arr.length * a), Math.floor(arr.length * b));
    scene.add(P.createBarrierRun(q1(out, 0, 0.25), 'armco', quality, { trackSide: 'left' }));
    scene.add(P.createBarrierRun(q1(offsetLine(pts, -9), 0, 0.25), 'fence', quality, { trackSide: 'left' }));
    scene.add(P.createBarrierRun(q1(out, 0.25, 0.5), 'tecpro', quality, { trackSide: 'left' }));
    scene.add(P.createBarrierRun(q1(out, 0.5, 0.75), 'tyres', quality, { trackSide: 'left' }));
    scene.add(P.createBarrierRun(q1(out, 0.75, 1), 'concrete', quality, { trackSide: 'left', colors: ['#d61f26', '#f2f2f2'] }));
    scene.add(P.createBarrierRun(inn, 'armco', quality, { trackSide: 'right', closed: true }));
    scene.add(P.createAdBoards(q1(offsetLine(pts, -8.3), 0.5, 0.75), quality, { trackSide: 'left', elevation: 1.0 }));
    const lamps = q1(offsetLine(pts, -12), 0, 1).filter((_, i) => i % 6 === 0);
    scene.add(P.createLampPosts(lamps, lamps.map((p) => Math.atan2(-p.x, -p.z)), quality));
    const marsh = q1(offsetLine(pts, -13), 0, 1).filter((_, i) => i % 23 === 5);
    scene.add(P.createMarshalPosts(marsh, marsh.map((p) => Math.atan2(-p.x, -p.z)), quality));
    const tv = [V(0, 0, 80), V(-110, 0, 0)];
    scene.add(P.createTvTowers(tv, tv.map((p) => Math.atan2(-p.x, -p.z)), quality));
    const lt = [V(60, 0, 90), V(-60, 0, 90), V(115, 0, -30), V(-120, 0, 30)];
    scene.add(P.createLightTowers(lt, lt.map((p) => Math.atan2(-p.x, -p.z)), quality));
    frame([55, 22, 95], [70, 2, 20]);
  },
  trees() {
    ground();
    const kinds = ['conifer', 'deciduous', 'palm', 'cherry', 'mixed'] as const;
    kinds.forEach((k, ki) => {
      const pos: THREE.Vector3[] = [];
      for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) pos.push(V(-80 + ki * 34 + j * 9 + (i % 2) * 4, 0, -i * 9));
      scene.add(P.createTrees(pos, k, quality));
    });
    const b: THREE.Vector3[] = [];
    for (let i = 0; i < 60; i++) b.push(V(-90 + i * 3, 0, 14 + Math.sin(i) * 2));
    scene.add(P.createBushes(b, quality));
    frame([0, 22, 70], [0, 4, -20]);
  },
  buildings() {
    ground();
    const styles = ['modern', 'monaco', 'desert', 'industrial'] as const;
    styles.forEach((st, si) => {
      const fps: P.BuildingFootprint[] = [];
      const r = new P.Rng(`demo-${st}`);
      for (let i = 0; i < 9; i++) {
        const h = st === 'modern' ? r.range(20, 90) : st === 'industrial' ? r.range(8, 18) : r.range(12, 32);
        fps.push({ x: -150 + si * 100 + (i % 3) * 30, z: -Math.floor(i / 3) * 34, w: r.range(16, 24), d: r.range(14, 22), h, rot: r.range(-0.15, 0.15) });
      }
      scene.add(P.createBuildings(fps, st, tod, quality));
    });
    frame([0, 60, 150], [0, 20, -30]);
  },
  skyline() {
    ground();
    scene.add(P.createSkyline({ x: 0, z: 0 }, 700, 70, 'modern', tod, quality));
    frame([0, 30, 40], [0, 60, -600]);
  },
  water() {
    ground();
    water(0, 150, 600, 300);
    addLandmark('harbour', 0, 0);
    frame([-40, 30, -30], [20, 0, 120]);
  },
  sky() {
    ground();
    frame([0, 20, 60], [0, 30, 0]);
  },
  all() {
    // Representative full-circuit environment for budget measurement.
    ground();
    const pts = loopPoints(520, 330, 360);
    ribbon(pts, 14);
    const outer = offsetLine(pts, -8.5);
    const inner = offsetLine(pts, 8.5);
    scene.add(P.createBarrierRun(outer, 'armco', quality, { trackSide: 'left', closed: true }));
    scene.add(P.createBarrierRun(inner, 'armco', quality, { trackSide: 'right', closed: true }));
    scene.add(P.createBarrierRun(offsetLine(pts, -10).slice(0, 120), 'fence', quality, { trackSide: 'left' }));
    scene.add(P.createBarrierRun(offsetLine(pts, -9.5).slice(150, 200), 'tecpro', quality, { trackSide: 'left' }));
    scene.add(P.createBarrierRun(offsetLine(pts, -11).slice(250, 300), 'tyres', quality, { trackSide: 'left' }));
    scene.add(P.createAdBoards(offsetLine(pts, -9.2).slice(0, 180), quality, { trackSide: 'left', elevation: 1.0 }));
    scene.add(P.createAdBoards(offsetLine(pts, 9.2).slice(180, 360), quality, { trackSide: 'right', elevation: 1.0 }));
    // Grandstands
    const standAt = [0, 40, 95, 150, 230, 300];
    standAt.forEach((i, k) => {
      const p = offsetLine(pts, -16)[i]!;
      const q = pts[(i + 1) % pts.length]!;
      const gs = P.createGrandstand({ lengthM: 80 + (k % 3) * 30, rows: 12 + (k % 3) * 3, quality, palette, roof: k % 2 === 0, bannerText: `Stand ${k + 1}` });
      gs.root.position.copy(p);
      gs.root.rotation.y = Math.atan2(q.x - pts[i]!.x, q.z - pts[i]!.z) - Math.PI / 2;
      gs.crowd.setExcitement(excite);
      scene.add(gs.root);
      updaters.push(gs.update);
    });
    // Pit + gantry
    const pit = P.createPitComplex({ lengthM: 260, boxes: 11, teamColors, quality });
    pit.root.position.set(560, 0, 0);
    pit.root.rotation.y = Math.PI / 2;
    scene.add(pit.root);
    updaters.push(pit.update);
    const g = P.createStartGantry(14);
    g.setLights(3);
    g.root.position.copy(pts[0]!);
    scene.add(g.root);
    // Trackside instanced props
    const lamps = offsetLine(pts, -14).filter((_, i) => i % 6 === 0);
    scene.add(P.createLampPosts(lamps, lamps.map((p) => Math.atan2(-p.x, -p.z)), quality));
    const marsh = offsetLine(pts, -15).filter((_, i) => i % 30 === 7);
    scene.add(P.createMarshalPosts(marsh, marsh.map((p) => Math.atan2(-p.x, -p.z)), quality));
    const tv = offsetLine(pts, -20).filter((_, i) => i % 60 === 20);
    scene.add(P.createTvTowers(tv, tv.map((p) => Math.atan2(-p.x, -p.z)), quality));
    if (tod !== 'day') {
      const lt = offsetLine(pts, -30).filter((_, i) => i % 18 === 9);
      scene.add(P.createLightTowers(lt, lt.map((p) => Math.atan2(-p.x, -p.z)), quality));
    }
    // Vegetation
    const r = new P.Rng('all-veg');
    const trees: THREE.Vector3[] = [];
    while (trees.length < 450) {
      const a = r.range(0, Math.PI * 2);
      const d = r.range(1.15, 1.6);
      trees.push(V(Math.cos(a) * 520 * d, 0, Math.sin(a) * 330 * d));
    }
    scene.add(P.createTrees(trees, 'mixed', quality));
    const bushes: THREE.Vector3[] = [];
    for (let i = 0; i < 200; i++) bushes.push(V(r.range(-300, 300), 0, r.range(-150, 150)));
    scene.add(P.createBushes(bushes, quality));
    // Buildings + skyline + landmark
    const fps: P.BuildingFootprint[] = [];
    for (let i = 0; i < 40; i++) fps.push({ x: -700 + (i % 10) * 45, z: -520 - Math.floor(i / 10) * 45, w: 30, d: 28, h: r.range(14, 60), rot: 0 });
    scene.add(P.createBuildings(fps, 'modern', tod, quality));
    scene.add(P.createSkyline({ x: 0, z: 0 }, 1400, 60, 'modern', tod, quality));
    addLandmark('ferris-wheel', -200, -80, 0.3);
    frame([420, 120, 520], [100, 0, 0]);
  },
};
for (const k of LANDMARKS) {
  if (shows[k]) continue;
  shows[k] = () => {
    ground();
    const cams: Partial<Record<LandmarkKind, [[number, number, number], [number, number, number]]>> = {
      'yas-hotel': [[-150, 40, 150], [0, 30, 0]],
      'ferris-wheel': [[45, 18, 70], [0, 32, 0]],
      harbour: [[-130, 45, 20], [10, 0, 80]],
      marina: [[-80, 30, -20], [0, 0, 30]],
      sphere: [[-120, 30, 160], [0, 45, 0]],
      towers: [[-260, 50, 260], [0, 80, 0]],
      'sakhir-tower': [[-50, 18, 60], [0, 25, 0]],
      stadium: [[180, 70, 110], [0, 5, 0]],
      'observation-tower': [[-60, 25, 100], [0, 35, 0]],
      mountains: [[0, 40, 0], [0, 150, -1800]],
      lake: [[-60, 18, -40], [0, 0, 20]],
      bridge: [[14, 4, 30], [0, 7, 0]],
    };
    if (k === 'harbour' || k === 'marina' || k === 'lake') water(0, 200, 800, 400);
    if (k === 'yas-hotel') trackStrip(400, 14, 'x');
    if (k === 'bridge') trackStrip(300, 14, 'z');
    if (k === 'stadium') ribbon([...Array(60)].map((_, i) => V(-120 + i * 5, 0, Math.sin(i * 0.15) * 14)), 14, false);
    addLandmark(k);
    const c = cams[k] ?? [[100, 40, 100], [0, 20, 0]];
    frame(c[0], c[1]);
  };
}

(shows[show] ?? shows.grandstand!)();

// ---------------------------------------------------------------- HUD + loop
const hud = document.getElementById('hud')!;
const nav = document.getElementById('nav')!;
for (const s of SHOWS) {
  const a = document.createElement('a');
  const p = new URLSearchParams(location.search);
  p.set('show', s);
  p.delete('cam');
  a.href = `?${p.toString()}`;
  a.textContent = s;
  if (s === show) a.className = 'on';
  nav.appendChild(a);
}
const clock = new THREE.Clock();
let frames = 0;
let lastHud = performance.now();
function loop(): void {
  const t = fixedT ?? clock.getElapsedTime();
  for (const u of updaters) u(t);
  controls.update();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - lastHud > 500) {
    const fps = (frames * 1000) / (now - lastHud);
    frames = 0;
    lastHud = now;
    const i = renderer.info;
    hud.innerHTML =
      `<b>${show}</b>  q=${quality}  tod=${tod}  theme=${theme}\n` +
      `draw calls: <b>${i.render.calls}</b>\ntriangles:  <b>${i.render.triangles.toLocaleString()}</b>\n` +
      `geometries: ${i.memory.geometries}  textures: ${i.memory.textures}  programs: ${i.programs?.length ?? 0}\n` +
      `fps: ${fps.toFixed(0)}`;
    (window as unknown as { __stats: unknown }).__stats = { calls: i.render.calls, triangles: i.render.triangles };
  }
  requestAnimationFrame(loop);
}
loop();
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
