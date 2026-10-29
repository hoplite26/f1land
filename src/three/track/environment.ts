import * as THREE from 'three';
import type { CircuitData } from '@/data/circuits/types';
import type { SimFrame } from '@/sim/types';
import type { TrackModel } from '@/sim/trackModel';
import type { TrackState } from '@/domain/types';
import { TEAMS } from '@/data/teams';
import type { ModelQuality, StartGantryModel } from '@/three/models/types';
import {
  Rng,
  applyPropsTimeOfDay,
  createAdBoards,
  createBarrierRun,
  createBuildings,
  createBushes,
  createGrandstand,
  createGroundMaterial,
  createLampPosts,
  createLandmark,
  createLightTowers,
  createMarshalPosts,
  createPitComplex,
  createSkyDome,
  createSkyline,
  createStartGantry,
  createTrees,
  createTvTowers,
  disposeProp,
  updatePropsTime,
  type BuildingFootprint,
  type BuildingStyle,
  type GrandstandModel,
  type LandmarkModel,
  type PropsAtmosphere,
  type TreeKind,
} from '@/three/models/props';
import type { TrackMeshes } from './trackMesh';
import { PIT_HALF_WIDTH, ribbon, wall, yawFromHeading } from './trackMesh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildLayout, runsWhere, type TrackLayout } from './layout';

export interface TvSpot {
  s: number;
  pos: THREE.Vector3;
}

export interface EnvironmentHandle {
  group: THREE.Group;
  atmosphere: PropsAtmosphere;
  layout: TrackLayout;
  /** Elevated broadcast camera positions (on towers / stand roofs), sorted by s. */
  tvSpots: TvSpot[];
  update(time: number, excitement: number, frame: SimFrame | null): void;
  setLights(state: number | 'off' | 'green'): void;
  /** Marshal LED panels: track state + per-sector yellow flags. */
  setFlags(state: TrackState, sectorYellow: readonly boolean[]): void;
  /** Short crowd burst (overtake / win). */
  cheer(strength?: number): void;
  dispose(): void;
}

const SHIRTS = [...TEAMS.flatMap((t) => [t.color, t.livery.primary]), '#ffffff', '#1d1f24', '#e8e8e8'];

/** Assemble the procedural surroundings from the circuit's own layout. */
export function buildEnvironment({ circuit, model, track, quality, renderer }: {
  circuit: CircuitData;
  model: TrackModel;
  track: TrackMeshes;
  quality: ModelQuality;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
}): EnvironmentHandle {
  const group = new THREE.Group();
  group.name = 'environment';
  const owned: Array<{ dispose(): void }> = [];
  const props: THREE.Object3D[] = [];
  const addProp = (o: THREE.Object3D) => {
    group.add(o);
    props.push(o);
  };
  const tod = circuit.timeOfDay;
  const night = tod !== 'day';
  const atmosphere = applyPropsTimeOfDay(tod, circuit.theme);
  const rng = new Rng(`env-${circuit.id}`);
  const q = (low: number, med: number, high: number) => (quality === 'low' ? low : quality === 'medium' ? med : high);

  const sky = createSkyDome(tod, circuit.theme);
  group.add(sky.mesh);

  // --- ground: tiled texture + world-space macro variation (no visible tiling) ---
  const bounds = circuit.bounds;
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1000) + 5000;
  const groundGeometry = new THREE.PlaneGeometry(size, size);
  const groundMaterial = createGroundMaterial(circuit.theme, tod, { quality, repeat: size / 34 });
  if (groundMaterial.map) groundMaterial.map.anisotropy = Math.min(quality === 'low' ? 2 : 8, renderer.capabilities.getMaxAnisotropy());
  patchGroundMacro(groundMaterial, circuit.theme === 'desert' || circuit.theme === 'dunes');
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, -0.08, -(bounds.minY + bounds.maxY) / 2);
  ground.receiveShadow = quality === 'high';
  group.add(ground);
  owned.push(groundGeometry, groundMaterial);

  const layout = buildLayout(circuit, model, track);
  const { L, street } = layout;
  const geom = model.track;
  const tmp = new THREE.Vector3();

  // --- start gantry ---
  const gantry: StartGantryModel = createStartGantry(circuit.widthM);
  layout.world(0, 0, 0, gantry.root.position);
  gantry.root.rotation.y = yawFromHeading(geom.headingAt(0));
  group.add(gantry.root);

  // --- pit complex (garages, paddock club, race control, big screen) ---
  const garageSide: 1 | -1 = circuit.pitLane.side === 'left' ? 1 : -1;
  const pit = model.pit;
  const boxSpan = Math.max(60, circuit.pitLane.boxesEndS - circuit.pitLane.boxesStartS);
  const pitMid = (circuit.pitLane.boxesStartS + circuit.pitLane.boxesEndS) / 2;
  const complexLen = Math.min(pit.length - 60, boxSpan * 1.2 + 24);
  const pitComplex = createPitComplex({ lengthM: complexLen, boxes: 11, teamColors: TEAMS.map((t) => t.color), quality });
  {
    const p = pit.pointAt(pitMid, garageSide * (PIT_HALF_WIDTH + 0.4));
    pitComplex.root.position.set(p[0], 0, -p[1]);
    const yaw = yawFromHeading(pit.headingAt(pitMid));
    pitComplex.root.rotation.y = yaw + (garageSide > 0 ? -Math.PI / 2 : Math.PI / 2);
    addProp(pitComplex.root);
    // Pit wall beyond the building (the complex brings its own along the boxes).
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xd2d6da });
    const lat = -garageSide * (PIT_HALF_WIDTH + 0.4);
    const lat2 = -garageSide * (PIT_HALF_WIDTH + 0.9);
    const parts: THREE.BufferGeometry[] = [];
    const a0 = 30;
    const a1 = pitMid - complexLen / 2;
    const b0 = pitMid + complexLen / 2;
    const b1 = pit.length - 30;
    for (const [s0, s1] of [[a0, a1], [b0, b1]] as const) {
      if (s1 - s0 < 6) continue;
      parts.push(wall(pit, s0, s1, lat, 0, 1.1, 3), wall(pit, s0, s1, lat2, 0, 1.1, 3));
      parts.push(ribbon({ geom: pit, s0, s1, latA: Math.min(lat, lat2), latB: Math.max(lat, lat2), y: 1.1, step: 3, uScale: 6 }));
    }
    if (parts.length) {
      const g = mergeGeometries(parts)!;
      parts.forEach((x) => x.dispose());
      group.add(new THREE.Mesh(g, wallMat));
      owned.push(g, wallMat);
    }
  }

  // --- barriers: concrete walls (street) / painted walls + tecpro at slow corners; catch fences ---
  const barrierObjs: THREE.Object3D[] = [];
  const ds = q(10, 8, 6);
  for (const side of [1, -1] as const) {
    const runs = runsWhere(L, ds, (s) => !layout.pitBeside(s, side));
    for (const [s0, s1] of runs) {
      const pts: THREE.Vector3[] = [];
      for (let s = s0; s <= s1 + 0.01; s += ds) pts.push(layout.world(s, side * layout.barrier(s, side)));
      if (pts.length < 2) continue;
      const trackSide = side > 0 ? 'right' : 'left';
      const colors = street ? ['#d61f26', '#f2f2f2'] : ['#e8e9ea', '#2a62b8'];
      barrierObjs.push(createBarrierRun(pts, 'concrete', quality, { trackSide, colors, seed: Math.round(s0) }));
      if (quality !== 'low' && street) {
        const fp = pts.map((_, i) => {
          const s = Math.min(s1, s0 + i * ds);
          return layout.world(s, side * (layout.barrier(s, side) + 0.6));
        });
        barrierObjs.push(createBarrierRun(fp, 'fence', quality, { trackSide }));
      }
    }
  }
  // TecPro / tyre walls at the outside of slow corners (high + medium).
  if (quality !== 'low' && !street) {
    for (const c of circuit.corners) {
      if (c.severity < 4) continue;
      const side: 1 | -1 = c.direction === 'L' ? -1 : 1;
      const pts: THREE.Vector3[] = [];
      for (let s = c.s - 30; s <= c.s + 40; s += 3) pts.push(layout.world(s, side * (layout.barrier(s, side) - 0.9)));
      barrierObjs.push(createBarrierRun(pts, c.severity >= 5 ? 'tecpro' : 'tyres', quality, { trackSide: side > 0 ? 'right' : 'left', colors: ['#e10600', '#f2f2f2', '#1f6fe0'] }));
    }
  }
  for (const o of barrierObjs) addProp(o);

  // --- grandstands: front edge behind the barrier, facing the track, crowd animated ---
  const stands: Array<{ model: GrandstandModel; s: number; side: 1 | -1; pos: THREE.Vector3; height: number }> = [];
  const fenceRuns: THREE.Vector3[][] = [];
  circuit.grandstands.forEach((spec, i) => {
    const side: 1 | -1 = spec.side === 'left' ? 1 : -1;
    // Shorten stands on curved sections so the straight stand does not cut the corner.
    let len = spec.lengthM;
    const turn = Math.abs(wrapPi(geom.headingAt(spec.s + len / 2) - geom.headingAt(spec.s - len / 2)));
    if (turn > 0.5) len = Math.max(60, len * (0.5 / turn));
    const rows = spec.rows;
    const depth = rows * 0.9 + 4;
    let off = layout.barrier(spec.s, side) + 7;
    const yaw = layout.facingTrack(spec.s, side);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    let placed = false;
    for (let k = 0; k < 24; k++, off += 4) {
      layout.world(spec.s, side * off, 0, tmp);
      const cx = tmp.x - fwd.x * (depth / 2 + 1);
      const cz = tmp.z - fwd.z * (depth / 2 + 1);
      if (layout.rectFree(cx, cz, yaw, len, depth)) {
        layout.occupyRect(cx, cz, yaw, len + 6, depth + 4);
        placed = true;
        break;
      }
    }
    if (!placed) return;
    const main = i === 0 || /main/i.test(spec.name ?? '');
    const model = createGrandstand({
      lengthM: len,
      rows,
      quality,
      palette: SHIRTS,
      roof: main || rows >= 18 || i % 2 === 0,
      seatColor: main ? '#1b2a3a' : ['#2453a6', '#b91c1c', '#1d7f4a', '#4b4f57'][i % 4],
      bannerText: spec.name ?? 'Grandstand',
      seed: i * 31 + 7,
    });
    model.root.position.copy(tmp);
    model.root.rotation.y = yaw;
    model.crowd.setWaveDirection(1, 0);
    addProp(model.root);
    stands.push({ model, s: spec.s, side, pos: tmp.clone(), height: model.heightM });
    // Catch fence in front of each stand.
    const fp: THREE.Vector3[] = [];
    for (let s = spec.s - len / 2; s <= spec.s + len / 2; s += 4) fp.push(layout.world(s, side * (layout.barrier(s, side) + 0.6)));
    fenceRuns.push(fp);
    if (quality !== 'low') addProp(createBarrierRun(fp, 'fence', quality, { trackSide: side > 0 ? 'right' : 'left' }));
  });

  // --- ad boards along the straights (on top of the wall) ---
  {
    const maxRuns = q(2, 6, 10);
    const straightRuns: Array<{ s0: number; s1: number; side: 1 | -1 }> = [];
    for (const side of [1, -1] as const) {
      for (const [s0, s1] of runsWhere(L, 10, (s) => Math.abs(geom.curvatureAt(s)) < 1 / 500 && !layout.pitBeside(s, side))) {
        if (s1 - s0 > 120) straightRuns.push({ s0: s0 + 15, s1: Math.min(s1 - 15, s0 + 15 + 320), side });
      }
    }
    straightRuns.sort((a, b) => b.s1 - b.s0 - (a.s1 - a.s0));
    for (const r of straightRuns.slice(0, maxRuns)) {
      const pts: THREE.Vector3[] = [];
      for (let s = r.s0; s <= r.s1; s += 8) pts.push(layout.world(s, r.side * (layout.barrier(s, r.side) + 0.05)));
      if (pts.length >= 2) addProp(createAdBoards(pts, quality, { trackSide: r.side > 0 ? 'right' : 'left', elevation: 1.06, height: 1.1, offset: 0.1 }));
    }
  }

  // --- elevated TV camera spots (towers, or stand roofs where a stand is in the way) ---
  const tvSpots: TvSpot[] = [];
  const towerPos: THREE.Vector3[] = [];
  const towerFacing: number[] = [];
  {
    const n = Math.max(8, Math.round(L / 320));
    for (let i = 0; i < n; i++) {
      const s = (i * L) / n + 40;
      let k = 0;
      for (let d = 20; d <= 140; d += 20) k += geom.curvatureAt(s + d);
      const side: 1 | -1 = k > 0 ? -1 : 1; // outside of the upcoming corner
      let lat = layout.barrier(s, side) + 5;
      layout.world(s, side * lat, 0, tmp);
      const stand = stands.find((st) => st.side === side && Math.abs(geom.delta(st.s, s)) < 80);
      let h = 13 + rng.range(0, 7);
      if (stand) {
        h = stand.height + 5;
        lat += 6;
      } else {
        towerPos.push(tmp.clone());
        towerFacing.push(layout.facingTrack(s, side));
        layout.occupyCircle(tmp.x, tmp.z, 4);
      }
      tvSpots.push({ s, pos: layout.world(s, side * lat, h) });
    }
    if (towerPos.length) addProp(createTvTowers(towerPos, towerFacing, quality, { height: 11 }));
  }

  // --- marshal posts with LED flag panels ---
  const marshal = new MarshalPanels(circuit, layout, quality);
  if (marshal.posts.length) {
    addProp(createMarshalPosts(marshal.posts.map((p) => p.pos), marshal.posts.map((p) => p.yaw), quality));
    group.add(marshal.mesh);
  }

  // --- lighting props: street lamps (street circuits), floodlight pylons (night) ---
  if (street) {
    const pos: THREE.Vector3[] = [];
    const face: number[] = [];
    const spacing = q(60, 42, 32);
    for (const side of [1, -1] as const) {
      for (let s = 10 + (side > 0 ? 0 : spacing / 2); s < L; s += spacing) {
        if (layout.pitBeside(s, side)) continue;
        pos.push(layout.world(s, side * (layout.barrier(s, side) + 1.6)));
        face.push(layout.facingTrack(s, side));
      }
    }
    addProp(createLampPosts(pos, face, quality, { height: 11, halos: night && quality !== 'low' }));
  } else if (night) {
    const pos: THREE.Vector3[] = [];
    const face: number[] = [];
    const spacing = q(150, 110, 85);
    let k = 0;
    for (let s = 30; s < L; s += spacing, k++) {
      const side: 1 | -1 = k % 2 === 0 ? 1 : -1;
      if (layout.pitBeside(s, side)) continue;
      const p = layout.world(s, side * (layout.barrier(s, side) + 12));
      if (!layout.isFree(p.x, p.z)) continue;
      layout.occupyCircle(p.x, p.z, 4);
      pos.push(p);
      face.push(layout.facingTrack(s, side));
    }
    addProp(createLightTowers(pos, face, quality, { height: 30, halos: quality !== 'low' }));
  }

  // --- vegetation ---
  {
    const treeKinds = treeKindsFor(circuit);
    const total = q(260, 650, 1300) * (street ? 0.35 : circuit.theme === 'desert' ? 0.45 : 1);
    const byKind = new Map<TreeKind, THREE.Vector3[]>();
    const bushes: THREE.Vector3[] = [];
    let tries = 0;
    let placed = 0;
    // Clustered stands of trees near the track + sparse scatter further out.
    while (placed < total && tries < total * 12) {
      tries++;
      const s = rng.range(0, L);
      const side: 1 | -1 = rng.next() < 0.5 ? 1 : -1;
      const near = rng.next() < 0.65;
      const lat = layout.barrier(s, side) + (near ? rng.range(14, 70) : rng.range(70, 420));
      layout.world(s, side * lat, 0, tmp);
      const cluster = 1 + Math.floor(rng.range(0, near ? 6 : 10));
      for (let c = 0; c < cluster && placed < total; c++) {
        const x = tmp.x + rng.range(-1, 1) * 14 * Math.sqrt(c);
        const z = tmp.z + rng.range(-1, 1) * 14 * Math.sqrt(c);
        if (!layout.isFree(x, z)) continue;
        const kind = treeKinds[Math.floor(rng.next() * treeKinds.length)]!;
        let arr = byKind.get(kind);
        if (!arr) byKind.set(kind, (arr = []));
        arr.push(new THREE.Vector3(x, 0, z));
        placed++;
      }
    }
    for (const [kind, pos] of byKind) addProp(createTrees(pos, kind, quality, { seed: pos.length }));
    const nb = q(80, 220, 420) * (street ? 0.3 : 1);
    for (let i = 0; i < nb * 6 && bushes.length < nb; i++) {
      const s = rng.range(0, L);
      const side: 1 | -1 = rng.next() < 0.5 ? 1 : -1;
      layout.world(s, side * (layout.barrier(s, side) + rng.range(7, 30)), 0, tmp);
      if (layout.isFree(tmp.x, tmp.z)) bushes.push(tmp.clone());
    }
    if (bushes.length) addProp(createBushes(bushes, quality, { color: circuit.theme === 'desert' || circuit.theme === 'dunes' ? '#7a8a4a' : '#4a7a32' }));
  }

  // --- buildings: street circuits get a city around the walls; others a paddock/hospitality cluster ---
  {
    const style = buildingStyle(circuit);
    const fps: BuildingFootprint[] = [];
    const count = street ? q(50, 110, 180) : q(8, 16, 24);
    for (let i = 0; i < count * 8 && fps.length < count; i++) {
      const s = street ? rng.range(0, L) : circuit.pitLane.entryS + rng.range(-200, 250);
      const side: 1 | -1 = street ? (rng.next() < 0.5 ? 1 : -1) : (garageSide as 1 | -1);
      const w = rng.range(16, 36);
      const d = rng.range(14, 30);
      const lat = layout.barrier(s, side) + (street ? rng.range(6, 40) : rng.range(55, 120)) + d / 2;
      layout.world(s, side * lat, 0, tmp);
      const yaw = layout.facingTrack(s, side);
      if (!layout.rectFree(tmp.x, tmp.z, yaw, w, d)) continue;
      layout.occupyRect(tmp.x, tmp.z, yaw, w + 4, d + 4);
      const h = street ? (style === 'monaco' ? rng.range(12, 34) : rng.range(14, 70)) : rng.range(8, 16);
      fps.push({ x: tmp.x, z: tmp.z, w, d, h, rot: yaw });
    }
    if (fps.length) addProp(createBuildings(fps, style, tod, quality, { details: quality !== 'low' }));
    const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    if (street || night) {
      const c = { x: (bounds.minX + bounds.maxX) / 2, z: -(bounds.minY + bounds.maxY) / 2 };
      addProp(createSkyline(c, extent * 0.7 + 650, q(24, 48, 80), street ? 'modern' : 'desert', tod, quality, { spread: 0.35 }));
    }
  }

  // --- landmarks ---
  const landmarks: LandmarkModel[] = circuit.landmarks.map((spec) => {
    const landmark = createLandmark(spec.kind, quality, tod);
    landmark.root.position.set(spec.position[0], 0, -spec.position[1]);
    landmark.root.rotation.y = yawFromHeading(spec.rotation);
    landmark.root.scale.setScalar(spec.scale);
    group.add(landmark.root);
    return landmark;
  });

  // Static props never move: skip per-frame matrix recomputation.
  group.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
  // Animated / camera-following children keep auto matrices.
  for (const o of [sky.mesh, pitComplex.root, ...stands.map((st) => st.model.root), ...landmarks.map((l) => l.root)]) o.traverse((c) => (c.matrixAutoUpdate = true));

  return {
    group,
    atmosphere,
    layout,
    tvSpots: tvSpots.sort((a, b) => a.s - b.s),
    update(time, excitement) {
      updatePropsTime(time);
      sky.update(time);
      for (const st of stands) {
        st.model.crowd.setExcitement(excitement);
        st.model.update(time);
      }
      pitComplex.update(time);
      for (const landmark of landmarks) landmark.update(time);
      marshal.update(time);
    },
    setLights: (state) => gantry.setLights(state),
    setFlags: (state, sectorYellow) => marshal.setState(state, sectorYellow),
    cheer(strength = 1) {
      for (const st of stands) st.model.crowd.pulse(strength, 3);
    },
    dispose() {
      sky.dispose();
      owned.forEach((o) => o.dispose());
      gantry.dispose();
      pitComplex.dispose();
      for (const st of stands) st.model.dispose();
      for (const landmark of landmarks) landmark.dispose();
      for (const p of props) disposeProp(p);
      marshal.dispose();
      group.removeFromParent();
    },
  };
}

/* ------------------------------------------------------------------ */

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function treeKindsFor(c: CircuitData): TreeKind[] {
  const cc = c.countryCode.toUpperCase();
  if (c.theme === 'desert') return ['palm'];
  if (c.theme === 'street') return ['SG', 'MC', 'US', 'SA', 'AE', 'ES'].includes(cc) ? ['palm', 'palm', 'deciduous'] : ['deciduous'];
  if (c.theme === 'forest') return ['conifer', 'conifer', 'deciduous'];
  if (c.theme === 'parkland') return cc === 'MX' ? ['deciduous', 'palm'] : ['deciduous', 'deciduous', 'conifer'];
  if (c.theme === 'dunes') return ['conifer', 'deciduous'];
  if (cc === 'JP') return ['cherry', 'deciduous', 'conifer'];
  return ['mixed'];
}

function buildingStyle(c: CircuitData): BuildingStyle {
  const cc = c.countryCode.toUpperCase();
  if (cc === 'MC') return 'monaco';
  if (c.theme === 'desert') return 'desert';
  if (c.theme === 'street') return 'modern';
  return 'industrial';
}

/**
 * Low-frequency world-space tint variation for the ground (breaks texture
 * tiling and gives the infield patchy, mown-grass depth).
 */
function patchGroundMacro(mat: THREE.Material, sandy: boolean): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vGW;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float gm = gNoise(vGW * 0.004) * 0.55 + gNoise(vGW * 0.017) * 0.3 + gNoise(vGW * 0.09) * 0.15;
${sandy ? 'diffuseColor.rgb *= mix(0.82, 1.12, gm);' : `diffuseColor.rgb *= mix(0.7, 1.18, gm);
float stripe = step(0.5, fract(vGW.x / 18.0 + vGW.y / 47.0));
diffuseColor.rgb *= mix(0.93, 1.05, stripe);`}`,
      );
  };
  mat.customProgramCacheKey = () => `pulse-ground|${sandy}`;
}

/* ------------------------------------------------------------------ */
/* Marshal LED flag panels                                             */
/* ------------------------------------------------------------------ */

const PANEL_OFF = new THREE.Color('#14181d');
const PANEL_YELLOW = new THREE.Color('#ffd21f').multiplyScalar(2.2);
const PANEL_RED = new THREE.Color('#ff2a2a').multiplyScalar(2.2);
const PANEL_GREEN = new THREE.Color('#3dff6a').multiplyScalar(2.0);
const PANEL_WHITE = new THREE.Color('#ffffff').multiplyScalar(1.8);

class MarshalPanels {
  readonly posts: Array<{ pos: THREE.Vector3; yaw: number; sector: number }> = [];
  readonly mesh: THREE.InstancedMesh;
  private state: TrackState = 'GREEN';
  private yellow: boolean[] = [false, false, false];
  private greenUntil = -1;
  private lastKey = '';
  private time = 0;

  constructor(circuit: CircuitData, layout: TrackLayout, quality: ModelQuality) {
    const spacing = quality === 'low' ? 420 : 300;
    const L = layout.L;
    let k = 0;
    for (let s = 120; s < L - 40; s += spacing, k++) {
      const side: 1 | -1 = k % 2 === 0 ? 1 : -1;
      if (layout.pitBeside(s, side)) continue;
      const pos = layout.world(s, side * (layout.barrier(s, side) + 2.2));
      const sec = circuit.sectors.findIndex((x) => (x.startS <= x.endS ? s >= x.startS && s < x.endS : s >= x.startS || s < x.endS));
      this.posts.push({ pos, yaw: layout.facingTrack(s, side), sector: Math.max(0, sec) });
    }
    const geo = new THREE.BoxGeometry(1.7, 1.0, 0.12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.posts.length));
    this.mesh.count = this.posts.length;
    const m = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    this.posts.forEach((post, i) => {
      e.set(0, post.yaw, 0);
      qt.setFromEuler(e);
      // Panel sits on a mast beside the post, facing the drivers.
      p.set(Math.sin(post.yaw), 0, Math.cos(post.yaw)).multiplyScalar(0.9).add(post.pos).setY(3.4);
      m.compose(p, qt, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, PANEL_OFF);
    });
    this.mesh.frustumCulled = false;
    this.mesh.name = 'marshal-panels';
  }

  setState(state: TrackState, yellow: readonly boolean[]): void {
    if (state === 'GREEN' && this.state !== 'GREEN' && this.state !== 'CHEQUERED') this.greenUntil = this.time + 8;
    this.state = state;
    this.yellow = [!!yellow[0], !!yellow[1], !!yellow[2]];
  }

  update(time: number): void {
    this.time = time;
    const blink = Math.floor(time * 2.5) % 2 === 0;
    const st = this.state;
    const key = `${st}|${this.yellow.join()}|${blink}|${time < this.greenUntil}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (let i = 0; i < this.posts.length; i++) {
      const sec = this.posts[i]!.sector;
      let c = PANEL_OFF;
      if (st === 'RED') c = PANEL_RED;
      else if (st === 'SC' || st === 'SC_ENDING') c = blink ? PANEL_YELLOW : PANEL_OFF;
      else if (st === 'VSC' || st === 'VSC_ENDING') c = blink ? PANEL_YELLOW : PANEL_WHITE;
      else if (st === 'CHEQUERED') c = (i + (blink ? 1 : 0)) % 2 === 0 ? PANEL_WHITE : PANEL_OFF;
      else if (this.yellow[sec]) c = blink ? PANEL_YELLOW : PANEL_OFF;
      else if (time < this.greenUntil) c = PANEL_GREEN;
      this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
