import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CircuitData } from '@/data/circuits/types';
import type { TrackGeometry } from '@/data/circuits/geometry';
import type { TrackModel } from '@/sim/trackModel';
import { sampleArr } from '@/sim/trackModel';
import { asphaltTexture, checkerTexture, gravelTexture, kerbTexture, limitStripTexture, runoffTexture, sawtoothTexture } from './textures';
import { TEAMS } from '@/data/teams';
import type { ModelQuality } from '@/three/models/types';
import { withSiteLight } from '@/three/models/props';

/** Map circuit-plane metres (x east, y north) into world space (x, y-up, -z north). */
export function toWorld(x: number, y: number, h = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, h, -y);
}

/** Yaw for an object whose forward is +Z, given a 2D heading (atan2(dy, dx)). */
export function yawFromHeading(h: number): number {
  return Math.atan2(Math.cos(h), -Math.sin(h));
}

type LatFn = number | ((s: number) => number);
const val = (f: LatFn, s: number) => (typeof f === 'number' ? f : f(s));

interface RibbonOpts {
  geom: TrackGeometry;
  s0: number;
  s1: number;
  latA: LatFn;
  latB: LatFn;
  y: number;
  step: number;
  /** metres per texture repeat along the track */
  uScale: number;
  /** lateral subdivisions */
  cols?: number;
  /** v range */
  v0?: number;
  v1?: number;
  color?: (s: number, lat: number) => number;
  /** Height profile across the ribbon (t = 0..1 from latA to latB); overrides `y`. */
  yFn?: (s: number, t: number) => number;
}

/** Build a flat ribbon between two lateral offsets over [s0, s1] (wraps on closed tracks). */
export function ribbon(o: RibbonOpts): THREE.BufferGeometry {
  const cols = o.cols ?? 1;
  let len = o.s1 - o.s0;
  if (o.geom.closed && len <= 0) len += o.geom.length;
  const rows = Math.max(1, Math.ceil(len / o.step));
  const pos = new Float32Array((rows + 1) * (cols + 1) * 3);
  const uv = new Float32Array((rows + 1) * (cols + 1) * 2);
  const col = o.color ? new Float32Array((rows + 1) * (cols + 1) * 3) : null;
  const p: [number, number] = [0, 0];
  let k = 0;
  let ku = 0;
  for (let r = 0; r <= rows; r++) {
    const d = (len * r) / rows;
    const s = o.s0 + d;
    const a = val(o.latA, s);
    const b = val(o.latB, s);
    for (let c = 0; c <= cols; c++) {
      const lat = a + ((b - a) * c) / cols;
      o.geom.pointAt(s, lat, p);
      pos[k] = p[0];
      pos[k + 1] = o.yFn ? o.yFn(s, c / cols) : o.y;
      pos[k + 2] = -p[1];
      if (col && o.color) {
        const shade = o.color(s, lat);
        col[k] = shade;
        col[k + 1] = shade;
        col[k + 2] = shade;
      }
      k += 3;
      uv[ku++] = d / o.uScale;
      uv[ku++] = (o.v0 ?? 0) + (((o.v1 ?? 1) - (o.v0 ?? 0)) * c) / cols;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = i0 + (cols + 1);
      const i3 = i2 + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Ensure normals face up regardless of winding.
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** Vertical wall ribbon (for zone corridors / pit wall). */
export function wall(geom: TrackGeometry, s0: number, s1: number, lat: LatFn, y0: number, y1: number, step: number, uScale = 10): THREE.BufferGeometry {
  let len = s1 - s0;
  if (geom.closed && len <= 0) len += geom.length;
  const rows = Math.max(1, Math.ceil(len / step));
  const pos = new Float32Array((rows + 1) * 2 * 3);
  const uv = new Float32Array((rows + 1) * 2 * 2);
  const p: [number, number] = [0, 0];
  for (let r = 0; r <= rows; r++) {
    const d = (len * r) / rows;
    const s = s0 + d;
    geom.pointAt(s, val(lat, s), p);
    const i = r * 6;
    pos.set([p[0], y0, -p[1], p[0], y1, -p[1]], i);
    uv.set([d / uScale, 0, d / uScale, 1], r * 4);
  }
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const a = r * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Half width of the pit lane ribbon (working + fast lane ≈ 12 m, matches the pit complex frame). */
export const PIT_HALF_WIDTH = 6;

function isStreet(c: CircuitData): boolean {
  return c.theme === 'street';
}

export interface TrackMeshes {
  group: THREE.Group;
  /** Sector zone overlay meshes (index 0..2) with shader uniforms. */
  zones: ZoneOverlay[];
  /** Overtake-zone chevrons. */
  straights: THREE.Mesh | null;
  /** World-space anchor (centre of each sector) for DOM labels. */
  sectorAnchors: THREE.Vector3[];
  /** Runoff extents per sample for barriers (lateral distance from centre). */
  barrierLat: (s: number, side: 1 | -1) => number;
  dispose(): void;
}

export interface ZoneOverlay {
  floor: THREE.Mesh;
  walls: THREE.Mesh;
  /** Glowing gate across the track at the sector start. */
  gate: THREE.Mesh;
  uniforms: ZoneUniforms;
  sector: 1 | 2 | 3;
}

export interface ZoneUniforms {
  uColor: { value: THREE.Color };
  uTime: { value: number };
  /** Resting visibility (RaceScene: ~0.24 none selected, ~0.08 another selected). */
  uIntensity: { value: number };
  /** 0..1 selection blend. */
  uSelected: { value: number };
  /** Track half width (m) — the glowing edge line sits on it. */
  uHalf: { value: number };
  /** Half width covered by the floor ribbon (m). */
  uExt: { value: number };
  /** Sector length (m) for soft ends. */
  uLen: { value: number };
}

/** Sector colours (mockups / UI chips): S1 cyan, S2 lime, S3 violet. */
export const ZONE_COLORS = ['#2fe6ff', '#c6ff3d', '#b26bff'];

/** Lateral reach of the zone floor beyond the track edge (m): room for the outer glow. */
const ZONE_SPILL = 7;

const ZONE_VERT = /* glsl */ `
  uniform float uSelected;
  uniform float uWallH0;
  uniform float uWallH1;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
#ifdef ZONE_WALL
    // Curtain height grows with the selection (geometry is built 0..1 tall).
    p.y = uv.y * mix(uWallH0, uWallH1, uSelected);
#endif
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const ZONE_HEAD = /* glsl */ `
  uniform vec3 uColor; uniform float uTime; uniform float uIntensity; uniform float uSelected;
  uniform float uHalf; uniform float uExt; uniform float uLen;
  varying vec2 vUv;
  // Soft fade at the sector ends (u is in metres along the sector).
  float zoneEnds() { return smoothstep(0.0, 5.0, vUv.x) * smoothstep(uLen, uLen - 5.0, vUv.x); }`;
const ZONE_OUT = /* glsl */ `
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>`;
const ZONE_FRAG = {
  // Floor: neon edge line held ≥ ~1.5 px wide at any distance (fwidth), soft outer
  // spill, faint fill; selected adds flowing chevrons in the race direction.
  floor: /* glsl */ `${ZONE_HEAD}
  void main() {
    float lat = abs(vUv.y - 0.5) * 2.0 * uExt;
    float px = max(fwidth(lat), 1e-4);
    float ed = abs(lat - uHalf);
    float coreW = max(0.16, px * 0.75);
    float core = 1.0 - smoothstep(coreW, coreW + px * 1.25, ed);
    float halo = exp(-ed / max(0.45, px * 1.8));
    float inside = 1.0 - smoothstep(uHalf - 0.4, uHalf + 0.4, lat);
    float spill = (1.0 - inside) * exp(-max(lat - uHalf, 0.0) / max(1.6, px * 3.0));
    float k = clamp(uIntensity * 2.7, 0.0, 1.0);
    float sel = clamp(uSelected, 0.0, 1.0);
    float ch = fract((vUv.x - lat * 0.55) / 13.0 - uTime * 0.85);
    float chev = smoothstep(0.0, 0.05, ch) * (1.0 - smoothstep(0.1, 0.26, ch)) * inside * (1.0 - smoothstep(4.0, 30.0, px * 40.0));
    float breathe = 0.85 + 0.15 * sin(uTime * 2.6);
    float a = k * (core * 0.85 + halo * 0.2 + inside * 0.03 + spill * 0.08)
            + sel * (core * 0.8 * breathe + halo * 0.28 + inside * (0.07 + chev * 0.22) + spill * 0.18);
    a = clamp(a * zoneEnds(), 0.0, 1.0);
    ${ZONE_OUT}
  }`,
  // Curtains: translucent light walls fading upwards, slow vertical shimmer, crisp top line.
  wall: /* glsl */ `${ZONE_HEAD}
  void main() {
    float v = vUv.y;
    float fade = pow(1.0 - v, 1.8);
    float shimmer = 0.62 + 0.38 * sin(vUv.x * 0.45 - uTime * 1.8) * sin(vUv.x * 0.11 + uTime * 0.7);
    float pv = max(fwidth(v), 1e-4);
    float top = 1.0 - smoothstep(pv * 0.6, pv * 2.0, abs(v - 0.985));
    float foot = 1.0 - smoothstep(0.0, 0.08, v);
    float k = clamp(uIntensity * 2.7, 0.0, 1.0);
    float sel = clamp(uSelected, 0.0, 1.0);
    float a = (fade * 0.3 * shimmer + top * 0.45 + foot * 0.35) * (k * 0.35 + sel * 1.15);
    a = clamp(a * zoneEnds(), 0.0, 1.0);
    ${ZONE_OUT}
  }`,
  // Gate: crisp frame + vertical scan, visible from afar.
  gate: /* glsl */ `${ZONE_HEAD}
  void main() {
    vec2 dd = min(vUv, 1.0 - vUv);
    vec2 pw = max(fwidth(vUv), vec2(1e-4));
    float frame = 1.0 - smoothstep(0.0, 1.0, min(dd.x / max(0.012, pw.x * 1.4), dd.y / max(0.02, pw.y * 1.4)));
    float fill = 0.1 * (1.0 - vUv.y);
    float scan = 1.0 - smoothstep(0.0, 0.03, abs(fract(vUv.y * 1.5 - uTime * 0.35) - 0.5));
    float k = clamp(uIntensity * 2.7, 0.0, 1.0);
    float a = (frame * 0.95 + fill + scan * 0.18) * (k * 0.75 + uSelected * 1.1);
    a = clamp(a, 0.0, 1.0);
    ${ZONE_OUT}
  }`,
};

function zoneMaterial(kind: keyof typeof ZONE_FRAG, uniforms: ZoneUniforms, wallH: [number, number] = [1.6, 5.5]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uWallH0: { value: wallH[0] }, uWallH1: { value: wallH[1] } },
    defines: kind === 'wall' ? { ZONE_WALL: 1 } : {},
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    polygonOffset: kind === 'floor',
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    vertexShader: ZONE_VERT,
    fragmentShader: ZONE_FRAG[kind],
  });
}

/** Vertical quad across the track at arc length s (for sector gates). */
function gateGeometry(geom: TrackGeometry, s: number, half: number, h: number): THREE.BufferGeometry {
  const a = geom.pointAt(s, -half);
  const b = geom.pointAt(s, half);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([a[0], 0, -a[1], b[0], 0, -b[1], a[0], h, -a[1], b[0], h, -b[1]]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}

export function buildTrackMeshes(circuit: CircuitData, model: TrackModel, quality: ModelQuality): TrackMeshes {
  const group = new THREE.Group();
  group.name = 'track';
  const geom = model.track;
  const L = geom.length;
  const hw = circuit.widthM / 2;
  const step = quality === 'low' ? 6 : quality === 'medium' ? 4 : 3;
  const street = isStreet(circuit);
  const disposables: Array<{ dispose(): void }> = [];

  // Braking intensity per profile step (speed drop over the next ~70 m).
  const brake = new Float32Array(model.n);
  {
    const ahead = Math.max(1, Math.round(70 / model.step));
    for (let i = 0; i < model.n; i++) {
      let vMin = model.vmax[i]!;
      for (let k = 1; k <= ahead; k++) vMin = Math.min(vMin, model.vmax[(i + k) % model.n]!);
      brake[i] = THREE.MathUtils.clamp((model.vmax[i]! - vMin) / 28, 0, 1);
    }
  }

  // --- Road surface with rubbered racing line (vertex colours) ---
  const roadMat = withSiteLight(new THREE.MeshStandardMaterial({ map: asphaltTexture(), vertexColors: true, roughness: 0.8, metalness: 0.0, color: 0xffffff }), 'road', { dark: 0.16, pool: 0.22 });
  const roadGeo = ribbon({
    geom,
    s0: 0,
    s1: L,
    latA: -hw,
    latB: hw,
    y: 0,
    step,
    uScale: 14,
    cols: quality === 'low' ? 4 : 10,
    color: (s, lat) => {
      // Rubbered racing line (darker in braking zones), dusty edges off-line.
      const line = sampleArr(model.line, model, s);
      const d = lat - line;
      const rub = Math.exp(-(d * d) / 4.5);
      const br = brake[Math.floor((((s % L) + L) % L) / model.step) % model.n]!;
      const edge = THREE.MathUtils.smoothstep(Math.abs(lat), hw - 2.4, hw - 0.3);
      return (1 - rub * (0.34 + 0.18 * br)) * (1 + edge * 0.12);
    },
  });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = quality === 'high';
  group.add(road);
  disposables.push(roadGeo, roadMat);

  // --- White edge lines ---
  const lineMat = withSiteLight(new THREE.MeshLambertMaterial({ color: 0xe9ecef, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'line', { dark: 0.16, pool: 0.22 });
  const lines = mergeGeometries([
    ribbon({ geom, s0: 0, s1: L, latA: hw - 0.42, latB: hw - 0.14, y: 0.01, step, uScale: 10 }),
    ribbon({ geom, s0: 0, s1: L, latA: -hw + 0.14, latB: -hw + 0.42, y: 0.01, step, uScale: 10 }),
  ])!;
  group.add(new THREE.Mesh(lines, lineMat));
  disposables.push(lines, lineMat);

  // --- Kerbs + runoff per corner ---
  const kerbGeos: THREE.BufferGeometry[] = [];
  const gravelGeos: THREE.BufferGeometry[] = [];
  const runoffGeos: THREE.BufferGeometry[] = [];
  const kThreshold = 1 / 260;
  const segs: Array<{ s0: number; s1: number; side: 1 | -1; k: number }> = [];
  {
    let inSeg = false;
    let s0 = 0;
    let side: 1 | -1 = 1;
    let kMax = 0;
    const dstep = 4;
    for (let d = 0; d <= L + dstep; d += dstep) {
      const s = d % L;
      const k = sampleArr(model.curv, model, s);
      const on = Math.abs(k) > kThreshold;
      if (on && !inSeg) {
        inSeg = true;
        s0 = s;
        side = k > 0 ? 1 : -1;
        kMax = Math.abs(k);
      } else if (on && inSeg) {
        kMax = Math.max(kMax, Math.abs(k));
        if ((k > 0 ? 1 : -1) !== side) {
          segs.push({ s0, s1: s, side, k: kMax });
          s0 = s;
          side = k > 0 ? 1 : -1;
          kMax = Math.abs(k);
        }
      } else if (!on && inSeg) {
        inSeg = false;
        segs.push({ s0, s1: s, side, k: kMax });
      }
    }
  }
  const runoffWidth = new Float32Array(model.n * 2); // [left, right] per profile step
  const sawGeos: THREE.BufferGeometry[] = [];
  const stripGeos: THREE.BufferGeometry[] = [];
  // Raised, crowned kerb profile (t across the kerb).
  const kerbY = (_s: number, t: number) => 0.016 + 0.05 * Math.sin(Math.PI * t);
  const sawY = (_s: number, t: number) => 0.03 + 0.085 * Math.sin(Math.PI * Math.min(1, t * 1.2));
  const kerbCols = quality === 'low' ? 1 : 4;
  for (const sg of segs) {
    let len = sg.s1 - sg.s0;
    if (len <= 0) len += L;
    if (len < 10) continue;
    // Inside kerb around the apex.
    kerbGeos.push(ribbon({ geom, s0: sg.s0 - 4, s1: sg.s1 + 4, latA: sg.side * hw, latB: sg.side * (hw + 1.1), y: 0.02, yFn: kerbCols > 1 ? kerbY : undefined, step: 2, uScale: 4, cols: kerbCols }));
    // Sawtooth "sausage" kerb behind the apex of tight corners.
    if (sg.k > 1 / 70 && quality !== 'low') {
      const mid = sg.s0 + len / 2;
      sawGeos.push(ribbon({ geom, s0: mid - Math.min(12, len / 3), s1: mid + Math.min(12, len / 3), latA: sg.side * (hw + 1.15), latB: sg.side * (hw + 1.85), y: 0.03, yFn: sawY, step: 1, uScale: 1.2, cols: 3 }));
    }
    // Outside kerb on the exit (+ green track-limit strip beyond it on permanent circuits).
    const exitStart = sg.s0 + len * 0.45;
    kerbGeos.push(ribbon({ geom, s0: exitStart, s1: sg.s1 + 22, latA: -sg.side * (hw + 1.1), latB: -sg.side * hw, y: 0.02, yFn: kerbCols > 1 ? kerbY : undefined, step: 2, uScale: 4, cols: kerbCols }));
    if (!street) {
      stripGeos.push(ribbon({ geom, s0: exitStart + 2, s1: sg.s1 + 26, latA: -sg.side * (hw + 3.1), latB: -sg.side * (hw + 1.1), y: 0.012, step: 3, uScale: 4 }));
      const speedHere = sampleArr(model.vmax, model, (sg.s0 + len / 2) % L);
      const depth = Math.min(48, 8 + speedHere * 0.45);
      const fn = (s: number) => {
        const d = geom.delta(sg.s0, s);
        const tt = Math.min(1, Math.max(0, d / Math.max(1, len + 50)));
        const bell = Math.sin(Math.PI * tt);
        return -sg.side * (hw + 3.1 + depth * (0.25 + 0.75 * bell));
      };
      const inner = -sg.side * (hw + 3.1);
      const geo = ribbon({ geom, s0: sg.s0, s1: sg.s1 + 50, latA: (s) => Math.min(inner, fn(s)), latB: (s) => Math.max(inner, fn(s)), y: 0.006, step: 4, uScale: 8, cols: 1 });
      // Fast corners → tarmac run-off, slow → gravel trap.
      if (speedHere > 45) runoffGeos.push(geo);
      else gravelGeos.push(geo);
      for (let d = 0; d <= len + 50; d += model.step) {
        const s = (sg.s0 + d) % L;
        const i = Math.floor(s / model.step) % model.n;
        const w = Math.abs(fn(s)) - hw;
        const slot = i * 2 + (sg.side > 0 ? 1 : 0);
        runoffWidth[slot] = Math.max(runoffWidth[slot]!, w);
      }
    }
  }
  const site = { dark: 0.15, pool: 0.24 };
  if (kerbGeos.length) {
    const kerbMat = withSiteLight(new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 'kerb', site);
    const kg = mergeGeometries(kerbGeos)!;
    kerbGeos.forEach((g) => g.dispose());
    group.add(new THREE.Mesh(kg, kerbMat));
    disposables.push(kg, kerbMat);
  }
  if (sawGeos.length) {
    const sm = withSiteLight(new THREE.MeshStandardMaterial({ map: sawtoothTexture(), roughness: 0.5 }), 'saw', site);
    const sgeo = mergeGeometries(sawGeos)!;
    sawGeos.forEach((g) => g.dispose());
    group.add(new THREE.Mesh(sgeo, sm));
    disposables.push(sgeo, sm);
  }
  if (stripGeos.length) {
    const lm = withSiteLight(new THREE.MeshLambertMaterial({ map: limitStripTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 'limit', site);
    const lg = mergeGeometries(stripGeos)!;
    stripGeos.forEach((g) => g.dispose());
    group.add(new THREE.Mesh(lg, lm));
    disposables.push(lg, lm);
  }
  if (gravelGeos.length) {
    const gm = withSiteLight(new THREE.MeshLambertMaterial({ map: gravelTexture() }), 'gravel', { dark: 0.12, pool: 0.25 });
    const gg = mergeGeometries(gravelGeos)!;
    gravelGeos.forEach((g) => g.dispose());
    group.add(new THREE.Mesh(gg, gm));
    disposables.push(gg, gm);
  }
  if (runoffGeos.length) {
    const rm = withSiteLight(new THREE.MeshStandardMaterial({ map: runoffTexture(), roughness: 0.85 }), 'runoff', site);
    const rg = mergeGeometries(runoffGeos)!;
    runoffGeos.forEach((g) => g.dispose());
    group.add(new THREE.Mesh(rg, rm));
    disposables.push(rg, rm);
  }

  // Street circuits: concrete sidewalk between the kerb line and the wall.
  if (street) {
    const vergeMat = withSiteLight(new THREE.MeshLambertMaterial({ map: asphaltTexture(), color: 0xb9bcc2 }), 'sidewalk', site);
    const vg = mergeGeometries([
      ribbon({ geom, s0: 0, s1: L, latA: hw, latB: hw + 2.2, y: 0.004, step: 6, uScale: 10 }),
      ribbon({ geom, s0: 0, s1: L, latA: -hw - 2.2, latB: -hw, y: 0.004, step: 6, uScale: 10 }),
    ])!;
    group.add(new THREE.Mesh(vg, vergeMat));
    disposables.push(vg, vergeMat);
  }

  // --- Start/finish line + grid boxes ---
  {
    const cm = withSiteLight(new THREE.MeshLambertMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 'checker', { dark: 0.2, pool: 0.2 });
    const cg = ribbon({ geom, s0: L - 0.9, s1: L + 0.9, latA: -hw, latB: hw, y: 0.015, step: 1, uScale: 1.8, v0: 0, v1: hw });
    // Rotate UVs so checkers run across the track.
    const uv = cg.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, v / 1.6, u);
    }
    group.add(new THREE.Mesh(cg, cm));
    disposables.push(cg, cm);

    const gridGeos: THREE.BufferGeometry[] = [];
    for (let slot = 0; slot < 22; slot++) {
      const s = model.gridS(slot);
      const side = slot % 2 === 0 ? 1 : -1;
      const c = side * 2.2;
      gridGeos.push(ribbon({ geom, s0: s + 2.6, s1: s + 2.9, latA: c - 1.3, latB: c + 1.3, y: 0.012, step: 1, uScale: 1 }));
      gridGeos.push(ribbon({ geom, s0: s - 0.5, s1: s + 2.9, latA: c - 1.3, latB: c - 1.08, y: 0.012, step: 1, uScale: 1 }));
      gridGeos.push(ribbon({ geom, s0: s - 0.5, s1: s + 2.9, latA: c + 1.08, latB: c + 1.3, y: 0.012, step: 1, uScale: 1 }));
    }
    const gg = mergeGeometries(gridGeos)!;
    group.add(new THREE.Mesh(gg, lineMat));
    disposables.push(gg);
  }

  // --- Pit lane ---
  {
    const pit = model.pit;
    const pw = PIT_HALF_WIDTH;
    const pitMat = withSiteLight(new THREE.MeshStandardMaterial({ map: asphaltTexture(), color: 0xb9bdc2, roughness: 0.8 }), 'pitlane', { dark: 0.2, pool: 0.22 });
    const pg = ribbon({ geom: pit, s0: 0, s1: pit.length, latA: -pw, latB: pw, y: 0.004, step: 2, uScale: 14 });
    group.add(new THREE.Mesh(pg, pitMat));
    disposables.push(pg, pitMat);
    const garageSide = circuit.pitLane.side === 'left' ? 1 : -1;
    const pl = [
      ribbon({ geom: pit, s0: 4, s1: pit.length - 4, latA: -pw + 0.15, latB: -pw + 0.4, y: 0.012, step: 2, uScale: 10 }),
      ribbon({ geom: pit, s0: 4, s1: pit.length - 4, latA: pw - 0.4, latB: pw - 0.15, y: 0.012, step: 2, uScale: 10 }),
      // fast lane / working lane divider (dashed approximated by thin line)
      ribbon({ geom: pit, s0: circuit.pitLane.boxesStartS - 10, s1: circuit.pitLane.boxesEndS + 10, latA: garageSide * 1.2 - 0.08, latB: garageSide * 1.2 + 0.08, y: 0.012, step: 2, uScale: 10 }),
      // speed limit lines
      ribbon({ geom: pit, s0: 58, s1: 59.5, latA: -pw, latB: pw, y: 0.013, step: 1, uScale: 1 }),
      ribbon({ geom: pit, s0: pit.length - 60, s1: pit.length - 58.5, latA: -pw, latB: pw, y: 0.013, step: 1, uScale: 1 }),
    ];
    const plg = mergeGeometries(pl)!;
    group.add(new THREE.Mesh(plg, lineMat));
    disposables.push(plg);
    // Team pit boxes (coloured rectangles in the working lane).
    const boxGeos: THREE.BufferGeometry[] = [];
    const boxSpan = (circuit.pitLane.boxesEndS - circuit.pitLane.boxesStartS) / 11;
    for (let b = 0; b < 11; b++) {
      const sMid = model.boxS[b]!;
      const a = garageSide * 1.4;
      const bb = garageSide * pw * 0.95;
      boxGeos.push(ribbon({ geom: pit, s0: sMid - boxSpan * 0.38, s1: sMid + boxSpan * 0.38, latA: Math.min(a, bb), latB: Math.max(a, bb), y: 0.011, step: 2, uScale: 4 }));
    }
    const bg = mergeGeometries(boxGeos)!;
    const boxMat = withSiteLight(new THREE.MeshStandardMaterial({ color: 0x27323a, roughness: 0.7, emissive: 0x0b1215 }), 'pitbox', { dark: 0.3, pool: 0.2 });
    group.add(new THREE.Mesh(bg, boxMat));
    disposables.push(bg, boxMat);
    // Team-coloured stop line + side markers per box.
    const markGeos: THREE.BufferGeometry[] = [];
    for (let b = 0; b < 11; b++) {
      const sMid = model.boxS[b]!;
      const a = garageSide * 1.6;
      const bb = garageSide * pw * 0.9;
      const g = ribbon({ geom: pit, s0: sMid + boxSpan * 0.3, s1: sMid + boxSpan * 0.34, latA: Math.min(a, bb), latB: Math.max(a, bb), y: 0.013, step: 1, uScale: 1 });
      const col = new THREE.Color(TEAMS[b % TEAMS.length]!.color);
      const n = g.getAttribute('position').count;
      const ca = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) col.toArray(ca, k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
      markGeos.push(g);
    }
    const mg = mergeGeometries(markGeos)!;
    markGeos.forEach((g) => g.dispose());
    const markMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    group.add(new THREE.Mesh(mg, markMat));
    disposables.push(mg, markMat);
    // The pit wall is built by the environment (merged with the pit complex).
  }

  // --- Sector zone overlays (glowing edge floor + light curtains + start gate) ---
  const zones: ZoneOverlay[] = [];
  const sectorAnchors: THREE.Vector3[] = [];
  const zStep = quality === 'low' ? 6 : 4;
  circuit.sectors.forEach((sec, i) => {
    let len = sec.endS - sec.startS;
    if (len <= 0) len += L;
    const uniforms: ZoneUniforms = {
      uColor: { value: new THREE.Color(ZONE_COLORS[i]!) },
      uTime: { value: 0 },
      uIntensity: { value: 0.24 },
      uSelected: { value: 0 },
      uHalf: { value: hw + 0.15 },
      uExt: { value: hw + ZONE_SPILL },
      uLen: { value: len },
    };
    const fmat = zoneMaterial('floor', uniforms);
    const fg = ribbon({ geom, s0: sec.startS, s1: sec.startS + len, latA: -hw - ZONE_SPILL, latB: hw + ZONE_SPILL, y: 0.035, step: zStep, uScale: 1 });
    const floor = new THREE.Mesh(fg, fmat);
    floor.renderOrder = 5;
    floor.name = `zone-floor-${i + 1}`;
    const wmat = zoneMaterial('wall', uniforms);
    const wgeo = mergeGeometries([
      wall(geom, sec.startS, sec.startS + len, hw + 1.25, 0, 1, zStep + 2, 1),
      wall(geom, sec.startS, sec.startS + len, -hw - 1.25, 0, 1, zStep + 2, 1),
    ])!;
    const walls = new THREE.Mesh(wgeo, wmat);
    walls.renderOrder = 6;
    walls.name = `zone-walls-${i + 1}`;
    const gmat = zoneMaterial('gate', uniforms);
    const ggeo = gateGeometry(geom, sec.startS + 0.5, hw + 1.3, 6);
    const gate = new THREE.Mesh(ggeo, gmat);
    gate.renderOrder = 6;
    gate.name = `zone-gate-${i + 1}`;
    group.add(floor, walls, gate);
    disposables.push(fg, fmat, wgeo, wmat, ggeo, gmat);
    zones.push({ floor, walls, gate, uniforms, sector: (i + 1) as 1 | 2 | 3 });
    const mid = (sec.startS + len / 2) % L;
    const p = geom.pointAt(mid);
    sectorAnchors.push(new THREE.Vector3(p[0], 6, -p[1]));
  });

  // --- Overtake / straight-mode zones: cyan chevrons on the edges ---
  let straights: THREE.Mesh | null = null;
  if (circuit.straightZones.length) {
    const geos: THREE.BufferGeometry[] = [];
    for (const z of circuit.straightZones) {
      geos.push(ribbon({ geom, s0: z.startS, s1: z.endS, latA: -hw + 0.6, latB: -hw + 1.0, y: 0.014, step: 4, uScale: 6 }));
      geos.push(ribbon({ geom, s0: z.startS, s1: z.endS, latA: hw - 1.0, latB: hw - 0.6, y: 0.014, step: 4, uScale: 6 }));
      geos.push(ribbon({ geom, s0: z.detectionS - 0.6, s1: z.detectionS + 0.6, latA: -hw, latB: hw, y: 0.014, step: 1, uScale: 1 }));
    }
    const sg = mergeGeometries(geos)!;
    const sm = new THREE.MeshBasicMaterial({ color: 0x7ff3ff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    straights = new THREE.Mesh(sg, sm);
    group.add(straights);
    disposables.push(sg, sm);
  }

  const barrierLat = (s: number, side: 1 | -1) => {
    const i = Math.floor((((s % L) + L) % L) / model.step) % model.n;
    const run = runoffWidth[i * 2 + (side > 0 ? 1 : 0)]!;
    return hw + (street ? 2.4 : Math.max(9, run + 4));
  };

  return {
    group,
    zones,
    straights,
    sectorAnchors,
    barrierLat,
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
