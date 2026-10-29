/**
 * Car-model preview: all 11 team cars + 4 road cars under night lighting.
 * Query params:
 *   q=low|medium|high   quality (default high)
 *   focus=<teamId|safety-mercedes|safety-aston|medical-mercedes|medical-aston>
 *   view=34|side|top|rear|front   camera for focus mode (default 34 = 3/4 front)
 *   spin=0|1            turntable (default 1)
 *   tyre=S|M|H|I|W  brake=0..1  rain=1  hl=0..1  flap=rad  steer=rad  bar=0|1  zoom=1
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DRIVERS, TEAMS } from '@/data/teams';
import type { F1CarModel, ModelQuality, RoadCarModel, SafetyCarKind, TyreLetter } from '@/three/models/types';
import { createCarShadow, createF1Car, createRaceEnvironment, createRoadCar, f1CarStats, roadCarStats } from '@/three/models/cars';

const params = new URLSearchParams(location.search);
const quality = (params.get('q') ?? 'high') as ModelQuality;
const focus = params.get('focus');
const view = params.get('view') ?? '34';
const spin = params.get('spin') !== '0';
const zoom = Number(params.get('zoom') ?? '1');
const ROAD_KINDS: SafetyCarKind[] = ['safety-mercedes', 'safety-aston', 'medical-mercedes', 'medical-aston'];
const TYRES: TyreLetter[] = ['S', 'M', 'H', 'I', 'W'];

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#06080b');
scene.fog = new THREE.Fog('#06080b', 40, 110);
scene.environment = createRaceEnvironment(renderer);
scene.environmentIntensity = Number(params.get('env') ?? '1');

scene.add(new THREE.HemisphereLight('#5d6f93', '#0b0c0e', 0.9));
const key = new THREE.DirectionalLight('#fff3e2', 2.6);
key.position.set(8, 14, 10);
scene.add(key);
const rim = new THREE.DirectionalLight('#7fb2ff', 2.2);
rim.position.set(-6, 16, -12);
scene.add(rim);
const fill = new THREE.DirectionalLight('#c6ff3d', 0.25);
fill.position.set(-6, 2, 8);
scene.add(fill);

// Asphalt with lane markings.
function asphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b1d21';
  ctx.fillRect(0, 0, 512, 512);
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(30, 30);
  t.anisotropy = 8;
  return t;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, metalness: 0.05, color: '#8a8f97' }),
);
scene.add(ground);
for (let i = -6; i <= 6; i++) {
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(0.08, 200).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#3b4048' }),
  );
  line.position.set(i * 3.2 + 1.6, 0.002, 0);
  scene.add(line);
}

const camera = new THREE.PerspectiveCamera(focus ? 32 : 40, innerWidth / innerHeight, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

interface Entry {
  holder: THREE.Group;
  f1?: F1CarModel;
  road?: RoadCarModel;
}
const entries: Entry[] = [];

function applyState(car: F1CarModel, i: number) {
  car.setTyre((params.get('tyre') as TyreLetter | null) ?? TYRES[i % TYRES.length]);
  car.setBrake(Number(params.get('brake') ?? '0'));
  car.setRainLight(params.get('rain') === '1');
  car.setHighlight(Number(params.get('hl') ?? '0'));
  const flap = Number(params.get('flap') ?? '0');
  car.rearFlap.rotation.x = flap;
  car.frontFlap.rotation.x = flap;
  const steer = Number(params.get('steer') ?? '0');
  car.steerPivots[0].rotation.y = steer;
  car.steerPivots[1].rotation.y = steer;
}

function addF1(teamIndex: number, pos: THREE.Vector3): Entry {
  const team = TEAMS[teamIndex];
  const drv = DRIVERS.filter((d) => d.teamId === team.id);
  const d = drv[0];
  const car = createF1Car({ livery: team.livery, number: d.number, code: d.code, quality, tcam: teamIndex % 2 ? 'yellow' : 'black' });
  applyState(car, teamIndex);
  const holder = new THREE.Group();
  holder.position.copy(pos);
  holder.add(car.root, createCarShadow());
  scene.add(holder);
  const e = { holder, f1: car };
  entries.push(e);
  return e;
}

function addRoad(kind: SafetyCarKind, pos: THREE.Vector3): Entry {
  const car = createRoadCar(kind, quality);
  car.setLightBar(params.get('bar') !== '0');
  const holder = new THREE.Group();
  holder.position.copy(pos);
  const sh = createCarShadow();
  sh.scale.set(1.0, 1, 0.85);
  holder.add(car.root, sh);
  scene.add(holder);
  const e = { holder, road: car };
  entries.push(e);
  return e;
}

const target = new THREE.Vector3();
if (focus) {
  const ti = TEAMS.findIndex((t) => t.id === focus);
  if (ti >= 0) addF1(ti, new THREE.Vector3());
  else addRoad(focus as SafetyCarKind, new THREE.Vector3());
  const isRoad = ti < 0;
  target.set(0, isRoad ? 0.65 : 0.42, 0);
  const d = (isRoad ? 8.2 : 7.4) * zoom;
  const cams: Record<string, [number, number, number]> = {
    '34': [d * 0.62, d * 0.24, d * 0.78],
    side: [d, d * 0.08, 0],
    top: [0, d * 1.25, 0.001],
    rear: [-d * 0.35, d * 0.22, -d * 0.93],
    front: [0, d * 0.16, d],
    low: [d * 0.5, d * 0.06, d * 0.6],
  };
  const c = cams[view] ?? cams['34'];
  camera.position.set(c[0], c[1] + target.y, c[2]);
} else {
  TEAMS.forEach((_, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    addF1(i, new THREE.Vector3((col - 1.5) * 3.2, 0, 6 - row * 7));
  });
  ROAD_KINDS.forEach((k, i) => addRoad(k, new THREE.Vector3((i - 1.5) * 3.2, 0, -16)));
  target.set(0, 0, -4);
  camera.position.set(14 * zoom, 13 * zoom, 22 * zoom);
}
controls.target.copy(target);
controls.update();

// Per-quality cost table.
const hud = document.getElementById('hud')!;
const qs: ModelQuality[] = ['low', 'medium', 'high'];
const statLines = qs.map((qq) => {
  const f = f1CarStats(qq);
  const r = roadCarStats('safety-mercedes', qq);
  return `${qq.padEnd(6)}  F1 ${String(f.drawCalls).padStart(2)} dc ${String(f.triangles).padStart(6)} tri   SC ${String(r.drawCalls).padStart(2)} dc ${String(r.triangles).padStart(6)} tri`;
});

function measureSingle(): string {
  // renderer.info for one isolated car per quality (validates the static numbers).
  const out: string[] = [];
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  cam.position.set(4, 2, 5);
  cam.lookAt(0, 0.4, 0);
  for (const qq of qs) {
    const s = new THREE.Scene();
    const car = createF1Car({ livery: TEAMS[0].livery, number: 4, code: 'NOR', quality: qq });
    s.add(car.root);
    renderer.render(s, cam);
    out.push(`${qq}: ${renderer.info.render.calls} calls / ${renderer.info.render.triangles} tris`);
    car.dispose();
  }
  return out.join('  |  ');
}
const measured = measureSingle();

const clock = new THREE.Clock();
let frames = 0;
function frame() {
  const t = clock.getElapsedTime();
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const [i, e] of entries.entries()) {
    if (spin) e.holder.rotation.y = t * 0.25 + i * 0.4;
    e.road?.update(t);
    if (params.get('roll') === '1') {
      for (const w of e.f1?.wheels ?? e.road?.wheels ?? []) w.rotation.x += dt * 20;
    }
  }
  controls.update();
  renderer.render(scene, camera);
  frames++;
  if (frames % 10 === 1) {
    hud.innerHTML =
      `<b>Pulse Arena car models</b>  q=${quality}${focus ? `  focus=${focus}  view=${view}` : ''}\n` +
      `scene: ${renderer.info.render.calls} draw calls, ${renderer.info.render.triangles} tris, programs ${renderer.info.programs?.length ?? 0}\n` +
      `per car (static):\n${statLines.join('\n')}\nmeasured single F1: ${measured}`;
    document.title = `cars q=${quality} dc=${renderer.info.render.calls}`;
  }
  requestAnimationFrame(frame);
}
frame();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
