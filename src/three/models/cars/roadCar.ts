/**
 * Procedural Safety Car / Medical Car models (Mercedes-AMG GT Black Series,
 * Aston Martin Vantage, AMG C 63 S Estate and DBX-like silhouettes).
 *
 * Body = lower loft with wheel-arch cut-outs + greenhouse loft whose faces are
 * classified into paint / glass (pillars fall out of the classification).
 * Geometry is cached per (kind, quality); lamps flash via a tiny per-car
 * emissive DataTexture so the whole car is 4–5 draw calls.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ModelQuality, RoadCarModel, SafetyCarKind } from '../types';
import {
  HALF_PI,
  Loft,
  MeshBuilder,
  fixWinding,
  latheX,
  merge,
  mirrorX,
  monotoneSpline,
  plateXZ,
  plateZY,
  preparePart,
  rod,
  transformed,
  triangleCount,
  wingElement,
  type Part,
  type ProfilePoint,
  type Section,
  type UVRectLike,
  type V3,
} from './geom';
import {
  GRID_COLS,
  GRID_ROWS,
  ROAD_ATLAS,
  ROAD_CELL,
  ROAD_CELL_ROW,
  cellUV,
  maskTexture,
  roadAtlasTexture,
  roadWheelOrmTexture,
  roadWheelTexture,
  type RoadCell,
} from './decals';
import { atlasMaterial, carbonMaterial, darkVertexMaterial, glassMaterial, paintMaterial } from './materials';

/* ------------------------------------------------------------------------ */
/* Specs                                                                    */
/* ------------------------------------------------------------------------ */

interface GlassZones {
  screen: readonly [number, number];
  side: readonly [number, number];
  rear: readonly [number, number];
  /** Paint bands splitting the side glass (B/C pillars). */
  pillars?: ReadonlyArray<readonly [number, number]>;
  /** Rear glass also on the cabin end cap (estates / SUVs). */
  rearCap?: boolean;
}

interface Patch {
  z: readonly [number, number];
  th: readonly [number, number];
}

interface RoadSpec {
  wheelbase: number;
  wheelR: number;
  rimR: number;
  tyreW: readonly [number, number];
  trackX: readonly [number, number];
  body: Section[];
  cabin: Section[];
  glass: GlassZones;
  paint: string;
  metallic: boolean;
  accentA: string;
  accentB: string;
  spoke: string;
  text: string;
  textColor: string;
  textStroke: string;
  pattern: 'chequer' | 'stripe';
  grille: 'slats' | 'mesh';
  sillY: number;
  barZ: number;
  barW: number;
  aero: 'gt' | 'duck' | 'roof';
  sideText: Patch;
  stripe: Patch & { kind: 'pattern' | 'accentA' };
  bonnetStripes?: boolean;
  head: Patch;
  tail: Patch;
  /** Rear text quad: y range on the tail cap. */
  rearText: readonly [number, number, number];
}

const SPECS: Record<SafetyCarKind, RoadSpec> = {
  'safety-mercedes': {
    wheelbase: 2.63,
    wheelR: 0.345,
    rimR: 0.254,
    tyreW: [0.285, 0.33],
    trackX: [0.83, 0.815],
    body: [
      { z: -2.31, w: 0.62, yb: 0.36, yt: 0.82, ym: 0.5, tt: 0.85, tb: 0.9, nt: 3.5, nb: 5 },
      { z: -2.27, w: 0.84, yb: 0.27, yt: 0.95 },
      { z: -2.12, w: 0.94, yb: 0.2, yt: 1.01 },
      { z: -1.75, w: 0.985, yb: 0.14, yt: 1.0 },
      { z: -1.25, w: 0.985, yb: 0.13, yt: 0.96 },
      { z: -0.55, w: 0.95, yb: 0.13, yt: 0.91 },
      { z: 0.15, w: 0.955, yb: 0.13, yt: 0.875 },
      { z: 0.85, w: 0.975, yb: 0.13, yt: 0.835, nt: 4.2 },
      { z: 1.55, w: 0.965, yb: 0.13, yt: 0.785 },
      { z: 2.0, w: 0.91, yb: 0.14, yt: 0.705 },
      { z: 2.22, w: 0.78, yb: 0.17, yt: 0.625 },
      { z: 2.31, w: 0.44, yb: 0.24, yt: 0.52, nt: 4, nb: 4, tt: 0.95, tb: 0.95 },
    ],
    cabin: [
      { z: -1.85, w: 0.55, yb: 0.86, yt: 1.0, ym: 0.2, tt: 0.7, tb: 1, nt: 3, nb: 4 },
      { z: -1.4, w: 0.66, yb: 0.86, yt: 1.11 },
      { z: -0.8, w: 0.71, yb: 0.86, yt: 1.245 },
      { z: -0.4, w: 0.72, yb: 0.86, yt: 1.285 },
      { z: -0.05, w: 0.73, yb: 0.86, yt: 1.25 },
      { z: 0.25, w: 0.74, yb: 0.84, yt: 1.1 },
      { z: 0.62, w: 0.72, yb: 0.76, yt: 0.82 },
    ],
    glass: { screen: [-0.02, 0.6], side: [-1.35, 0.2], rear: [-1.8, -0.75] },
    paint: '#D8301A',
    metallic: true,
    accentA: '#111214',
    accentB: '#F4F5F7',
    spoke: '#2C2F34',
    text: 'SAFETY CAR',
    textColor: '#FFFFFF',
    textStroke: '#111214',
    pattern: 'stripe',
    grille: 'slats',
    sillY: 0.27,
    barZ: -0.42,
    barW: 1.0,
    aero: 'gt',
    sideText: { z: [-0.95, 0.62], th: [-0.06, 0.27] },
    stripe: { z: [-1.6, 1.6], th: [-0.2, -0.1], kind: 'accentA' },
    head: { z: [2.15, 2.27], th: [0.18, 0.62] },
    tail: { z: [-2.29, -2.21], th: [0.3, 0.85] },
    rearText: [0.4, 0.56, 0.66],
  },
  'safety-aston': {
    wheelbase: 2.7,
    wheelR: 0.345,
    rimR: 0.254,
    tyreW: [0.275, 0.325],
    trackX: [0.84, 0.825],
    body: [
      { z: -2.3, w: 0.6, yb: 0.38, yt: 0.86, ym: 0.5, tt: 0.85, tb: 0.9, nt: 3, nb: 5 },
      { z: -2.24, w: 0.86, yb: 0.28, yt: 0.98 },
      { z: -2.05, w: 0.95, yb: 0.2, yt: 1.02 },
      { z: -1.7, w: 0.99, yb: 0.14, yt: 1.0 },
      { z: -1.2, w: 0.99, yb: 0.13, yt: 0.95 },
      { z: -0.5, w: 0.95, yb: 0.13, yt: 0.9 },
      { z: 0.2, w: 0.955, yb: 0.13, yt: 0.86 },
      { z: 0.9, w: 0.975, yb: 0.13, yt: 0.825, nt: 3.8 },
      { z: 1.55, w: 0.96, yb: 0.14, yt: 0.77 },
      { z: 2.0, w: 0.88, yb: 0.16, yt: 0.69 },
      { z: 2.22, w: 0.72, yb: 0.2, yt: 0.6 },
      { z: 2.3, w: 0.5, yb: 0.22, yt: 0.52, nt: 4, nb: 4, tt: 0.88, tb: 0.95 },
    ],
    cabin: [
      { z: -1.8, w: 0.58, yb: 0.86, yt: 1.02, ym: 0.2, tt: 0.68, tb: 1, nt: 2.8, nb: 4 },
      { z: -1.3, w: 0.68, yb: 0.86, yt: 1.14 },
      { z: -0.7, w: 0.72, yb: 0.86, yt: 1.255 },
      { z: -0.3, w: 0.73, yb: 0.86, yt: 1.27 },
      { z: 0.05, w: 0.74, yb: 0.86, yt: 1.22 },
      { z: 0.35, w: 0.75, yb: 0.85, yt: 1.08 },
      { z: 0.7, w: 0.74, yb: 0.74, yt: 0.8 },
    ],
    glass: { screen: [0.05, 0.68], side: [-1.25, 0.3], rear: [-1.75, -0.65] },
    paint: '#00594F',
    metallic: true,
    accentA: '#CEDC00',
    accentB: '#0E2A26',
    spoke: '#B9BEC4',
    text: 'SAFETY CAR',
    textColor: '#FFFFFF',
    textStroke: '#0B2B26',
    pattern: 'stripe',
    grille: 'mesh',
    sillY: 0.25,
    barZ: -0.32,
    barW: 1.0,
    aero: 'duck',
    sideText: { z: [-0.9, 0.62], th: [-0.06, 0.27] },
    stripe: { z: [-1.62, 1.75], th: [0.42, 0.48], kind: 'accentA' },
    bonnetStripes: true,
    head: { z: [2.12, 2.25], th: [0.15, 0.6] },
    tail: { z: [-2.27, -2.22], th: [0.55, Math.PI - 0.55] },
    rearText: [0.4, 0.58, 0.68],
  },
  'medical-mercedes': {
    wheelbase: 2.84,
    wheelR: 0.335,
    rimR: 0.241,
    tyreW: [0.245, 0.265],
    trackX: [0.795, 0.785],
    body: [
      { z: -2.375, w: 0.66, yb: 0.36, yt: 0.92, ym: 0.5, tt: 0.88, tb: 0.9, nt: 3.5, nb: 5 },
      { z: -2.33, w: 0.84, yb: 0.27, yt: 0.99 },
      { z: -2.15, w: 0.905, yb: 0.2, yt: 1.01 },
      { z: -1.5, w: 0.92, yb: 0.15, yt: 0.99 },
      { z: -0.5, w: 0.91, yb: 0.15, yt: 0.96 },
      { z: 0.4, w: 0.91, yb: 0.15, yt: 0.95 },
      { z: 1.1, w: 0.915, yb: 0.15, yt: 0.9, nt: 4.2 },
      { z: 1.75, w: 0.9, yb: 0.16, yt: 0.84 },
      { z: 2.15, w: 0.83, yb: 0.18, yt: 0.75 },
      { z: 2.32, w: 0.68, yb: 0.22, yt: 0.67 },
      { z: 2.375, w: 0.4, yb: 0.32, yt: 0.58, nt: 4, nb: 4, tt: 0.95, tb: 0.95 },
    ],
    cabin: [
      { z: -2.3, w: 0.66, yb: 0.92, yt: 1.36, ym: 0.15, tt: 0.78, tb: 1, nt: 3.5, nb: 4 },
      { z: -2.18, w: 0.72, yb: 0.92, yt: 1.42 },
      { z: -1.4, w: 0.76, yb: 0.92, yt: 1.455 },
      { z: -0.3, w: 0.775, yb: 0.92, yt: 1.46 },
      { z: 0.15, w: 0.78, yb: 0.92, yt: 1.42 },
      { z: 0.55, w: 0.79, yb: 0.92, yt: 1.22 },
      { z: 1.0, w: 0.78, yb: 0.82, yt: 0.88 },
    ],
    glass: {
      screen: [0.18, 0.98],
      side: [-2.05, 0.45],
      rear: [-2.3, -2.2],
      pillars: [
        [-0.5, -0.4],
        [-1.48, -1.38],
      ],
      rearCap: true,
    },
    paint: '#C5C9CE',
    metallic: true,
    accentA: '#E10600',
    accentB: '#FFD100',
    spoke: '#BFC3C9',
    text: 'MEDICAL CAR',
    textColor: '#E10600',
    textStroke: '#FFFFFF',
    pattern: 'chequer',
    grille: 'slats',
    sillY: 0.25,
    barZ: -0.7,
    barW: 1.05,
    aero: 'roof',
    sideText: { z: [-1.25, 0.55], th: [0.02, 0.32] },
    stripe: { z: [-1.95, 1.95], th: [-0.3, -0.1], kind: 'pattern' },
    head: { z: [2.25, 2.35], th: [0.12, 0.6] },
    tail: { z: [-2.36, -2.29], th: [0.3, 0.85] },
    rearText: [0.42, 0.6, 0.72],
  },
  'medical-aston': {
    wheelbase: 3.06,
    wheelR: 0.37,
    rimR: 0.279,
    tyreW: [0.285, 0.325],
    trackX: [0.85, 0.83],
    body: [
      { z: -2.45, w: 0.7, yb: 0.45, yt: 1.02, ym: 0.5, tt: 0.88, tb: 0.9, nt: 3.2, nb: 5 },
      { z: -2.4, w: 0.88, yb: 0.36, yt: 1.08 },
      { z: -2.2, w: 0.97, yb: 0.27, yt: 1.1 },
      { z: -1.6, w: 0.995, yb: 0.21, yt: 1.09 },
      { z: -0.5, w: 0.98, yb: 0.2, yt: 1.06 },
      { z: 0.5, w: 0.98, yb: 0.2, yt: 1.04 },
      { z: 1.2, w: 0.99, yb: 0.2, yt: 1.0, nt: 4.5 },
      { z: 1.85, w: 0.97, yb: 0.21, yt: 0.95 },
      { z: 2.25, w: 0.88, yb: 0.24, yt: 0.86 },
      { z: 2.4, w: 0.72, yb: 0.28, yt: 0.78 },
      { z: 2.45, w: 0.52, yb: 0.33, yt: 0.7, nt: 4, nb: 4, tt: 0.88, tb: 0.95 },
    ],
    cabin: [
      { z: -2.3, w: 0.66, yb: 1.04, yt: 1.48, ym: 0.15, tt: 0.75, tb: 1, nt: 3, nb: 4 },
      { z: -2.05, w: 0.76, yb: 1.04, yt: 1.6 },
      { z: -1.2, w: 0.8, yb: 1.04, yt: 1.66 },
      { z: -0.2, w: 0.81, yb: 1.04, yt: 1.68 },
      { z: 0.3, w: 0.82, yb: 1.04, yt: 1.63 },
      { z: 0.75, w: 0.83, yb: 1.04, yt: 1.38 },
      { z: 1.2, w: 0.82, yb: 0.9, yt: 0.97 },
    ],
    glass: {
      screen: [0.32, 1.18],
      side: [-1.95, 0.6],
      rear: [-2.3, -1.95],
      pillars: [
        [-0.38, -0.27],
        [-1.32, -1.2],
      ],
    },
    paint: '#00594F',
    metallic: true,
    accentA: '#CEDC00',
    accentB: '#0E2A26',
    spoke: '#B9BEC4',
    text: 'MEDICAL CAR',
    textColor: '#FFFFFF',
    textStroke: '#0B2B26',
    pattern: 'stripe',
    grille: 'mesh',
    sillY: 0.33,
    barZ: -0.55,
    barW: 1.1,
    aero: 'roof',
    sideText: { z: [-1.3, 0.75], th: [0.0, 0.3] },
    stripe: { z: [-2.0, 2.05], th: [-0.24, -0.15], kind: 'accentA' },
    head: { z: [2.33, 2.43], th: [0.12, 0.58] },
    tail: { z: [-2.44, -2.36], th: [0.35, 0.9] },
    rearText: [0.46, 0.64, 0.78],
  },
};

/* ------------------------------------------------------------------------ */
/* Quality                                                                  */
/* ------------------------------------------------------------------------ */

interface RoadQuality {
  rings: number;
  cols: number;
  detail: 0 | 1 | 2;
  wheelSeg: number;
  atlas: readonly [number, number];
}

const RQ: Record<ModelQuality, RoadQuality> = {
  high: { rings: 7, cols: 24, detail: 2, wheelSeg: 24, atlas: [1024, 512] },
  medium: { rings: 4, cols: 14, detail: 1, wheelSeg: 14, atlas: [512, 256] },
  low: { rings: 2, cols: 10, detail: 0, wheelSeg: 10, atlas: [512, 256] },
};

const GROUP_OF: Record<ModelQuality, Record<string, string>> = {
  high: { paint: 'paint', dark: 'dark', glass: 'glass', decal: 'atlas', wheel: 'wheel' },
  medium: { paint: 'paint', dark: 'dark', glass: 'glass', decal: 'atlas', wheel: 'wheel' },
  low: { paint: 'paint', dark: 'darkvc', glass: 'darkvc', decal: 'atlas', wheel: 'wheel' },
};

const VC: Record<string, THREE.Color> = {
  dark: new THREE.Color('#121317'),
  glass: new THREE.Color('#0A0D12'),
};

const B_ROOT = 0;

/* ------------------------------------------------------------------------ */
/* Build                                                                    */
/* ------------------------------------------------------------------------ */

function roadWheelProfile(R: number, rimR: number, W: number, detail: number): ProfilePoint[] {
  const hw = W / 2;
  const mid = (rimR + R) / 2;
  const pts: Array<ProfilePoint & { d: number }> = [
    { r: 0, x: -hw + 0.06, v: 0, d: 0 },
    { r: rimR - 0.01, x: -hw + 0.02, v: 0.05, d: 1 },
    { r: rimR, x: -hw + 0.01, v: 0.06, d: 0 },
    { r: mid, x: -hw - 0.005, v: 0.1, d: 1 },
    { r: R - 0.012, x: -hw + 0.01, v: 0.13, d: 2 },
    { r: R, x: -hw + 0.035, v: 0.14, d: 0 },
    { r: R, x: hw - 0.035, v: 0.3, d: 0 },
    { r: R - 0.012, x: hw - 0.01, v: 0.32, d: 2 },
    { r: mid, x: hw + 0.005, v: 0.42, d: 1 },
    { r: rimR, x: hw - 0.008, v: 0.52, d: 0 },
    { r: rimR - 0.012, x: hw - 0.012, v: 0.56, d: 2 },
    { r: rimR - 0.03, x: hw - 0.045, v: 0.6, d: 0 },
    { r: rimR * 0.5, x: hw - 0.03, v: 0.86, d: 1 },
    { r: rimR * 0.22, x: hw - 0.022, v: 0.94, d: 0 },
    { r: 0, x: hw - 0.02, v: 1, d: 0 },
  ];
  return pts.filter((p) => p.d <= detail);
}

interface BuiltParts {
  parts: Part[];
}

function buildRoadParts(kind: SafetyCarKind, q: ModelQuality): BuiltParts {
  const S = SPECS[kind];
  const Q = RQ[q];
  const hi = Q.detail >= 2;
  const mid = Q.detail >= 1;
  const parts: Part[] = [];
  const add = (geo: THREE.BufferGeometry, slot: string, bone = B_ROOT) => parts.push({ geo, slot, bone });
  const addBoth = (geo: THREE.BufferGeometry, slot: string) => {
    add(geo, slot);
    add(mirrorX(geo), slot);
  };
  const cell = (c: RoadCell): string => `cell:${c}`;

  const halfWB = S.wheelbase / 2;
  const axles = [halfWB, -halfWB];
  const Ra = S.wheelR + 0.045;
  const archTop = S.wheelR + Ra;

  /* --- Lower body with arch cut-outs ----------------------------------- */
  const sorted = [...S.body].sort((a, b) => a.z - b.z);
  const baseYb = monotoneSpline(
    sorted.map((s) => s.z),
    sorted.map((s) => s.yb),
  );
  const ybFn = (z: number) => {
    let y = baseYb(z);
    for (const zw of axles) {
      const dz = Math.abs(z - zw);
      if (dz < Ra) y = Math.max(y, S.wheelR + Math.sqrt(Ra * Ra - dz * dz));
    }
    return y;
  };
  const body = new Loft(S.body, { yb: ybFn });
  const archRings: number[] = [];
  const arcN = hi ? 10 : mid ? 6 : 4;
  for (const zw of axles) {
    archRings.push(zw + Ra, zw - Ra, zw + Ra - 0.004, zw - Ra + 0.004);
    for (let k = 1; k < arcN; k++) archRings.push(zw + Ra * Math.cos((k / arcN) * Math.PI));
  }
  const tmp = new THREE.Vector3();
  const zFront = body.zMax;
  const zRear = body.zMin;
  const bodyMap = body.build({
    cols: Q.cols,
    ringsPerMetre: Q.rings,
    zBreaks: archRings,
    thetaBreaks: [Math.PI * 1.04, Math.PI * 1.96],
    slotOf: (z, th) => {
      const inArch = axles.some((zw) => Math.abs(z - zw) < Ra - 0.002);
      if (th > Math.PI && inArch) return 'dark';
      if (th > Math.PI * 1.04 && th < Math.PI * 1.96) return 'dark';
      body.point(z, th, tmp);
      if (tmp.y < S.sillY) return 'dark';
      if ((z > zFront - 0.2 || z < zRear + 0.25) && tmp.y < S.sillY + 0.08) return 'dark';
      return 'paint';
    },
    capEnd: { slot: 'decal', dome: -0.03, planarUV: ROAD_ATLAS.grille },
    capStart: { slot: 'paint' },
  });
  for (const [slot, g] of bodyMap) add(g, slot);

  // Wheel-well liners stop the arch tunnels from being see-through.
  for (const [i, zw] of axles.entries()) {
    const inner = S.trackX[i] - S.tyreW[i] / 2 - 0.03;
    const h = archTop - 0.16;
    add(transformed(new THREE.BoxGeometry(inner * 2, h, Ra * 1.7), { pos: [0, 0.16 + h / 2, zw] }), 'dark');
  }

  /* --- Greenhouse ------------------------------------------------------ */
  const cabin = new Loft(S.cabin);
  const G = S.glass;
  const inR = (v: number, r: readonly [number, number]) => v > r[0] && v < r[1];
  const sideTh = (th: number) => inR(th, [0.1, 0.7]) || inR(th, [Math.PI - 0.7, Math.PI - 0.1]);
  const cabinMap = cabin.build({
    cols: Q.cols,
    ringsPerMetre: Q.rings * 1.3,
    thetaBreaks: [0.1, 0.7, 0.82, Math.PI - 0.82, Math.PI - 0.7, Math.PI - 0.1, HALF_PI - 0.62, HALF_PI + 0.62],
    zBreaks: [...G.screen, ...G.side, ...G.rear, ...(G.pillars ?? []).flat()],
    slotOf: (z, th) => {
      const top = Math.abs(th - HALF_PI);
      if (inR(z, G.screen) && top < 0.75) return 'glass';
      if (inR(z, G.rear) && top < 0.62) return 'glass';
      if (inR(z, G.side) && sideTh(th) && !(G.pillars ?? []).some((p) => inR(z, p))) return 'glass';
      return 'paint';
    },
    capStart: G.rearCap ? { slot: 'glass' } : null,
  });
  for (const [slot, g] of cabinMap) add(g, slot);

  /* --- Decals, stripes, lights ----------------------------------------- */
  const SIDE = ROAD_ATLAS.textSide;
  const lerp = THREE.MathUtils.lerp;
  const { z: tz, th: tth } = S.sideText;
  const tSeg = hi ? 6 : mid ? 4 : 2;
  add(body.patch((s, t) => [lerp(tz[1], tz[0], s), lerp(tth[0], tth[1], t)], hi ? 12 : 6, tSeg, 0.006, SIDE), 'decal');
  add(body.patch((s, t) => [lerp(tz[0], tz[1], s), Math.PI - lerp(tth[0], tth[1], t)], hi ? 12 : 6, tSeg, 0.006, SIDE), 'decal');
  if (mid) {
    const st = S.stripe;
    const slot = st.kind === 'pattern' ? 'decal' : cell('accentA');
    const r = ROAD_ATLAS.pattern;
    for (const side of [0, 1]) {
      add(
        body.patch(
          (s, t) => {
            const th = lerp(st.th[0], st.th[1], t);
            return [lerp(st.z[1], st.z[0], s), side ? Math.PI - th : th];
          },
          hi ? 24 : 10,
          1,
          0.0035,
          st.kind === 'pattern' ? r : ([0, 0, 1, 1] as UVRectLike),
        ),
        slot,
      );
    }
    if (S.bonnetStripes) {
      for (const off of [0.07, -0.07]) {
        add(body.patch((s, t) => [lerp(0.75, 2.2, s), HALF_PI + off + lerp(-0.025, 0.025, t)], 8, 1, 0.0035), cell('accentA'));
        add(cabin.patch((s, t) => [lerp(-1.75, 0.66, s), HALF_PI + off + lerp(-0.03, 0.03, t)], 12, 1, 0.0035), cell('accentA'));
      }
    }
  }
  // Rear text on the tail cap (reads from behind: +u towards −X).
  {
    const [y0, y1] = [S.rearText[1], S.rearText[2]];
    const x = S.rearText[0];
    const z = zRear - 0.004;
    const R = ROAD_ATLAS.textRear;
    add(
      quadGeo(
        [
          [x, y0, z],
          [-x, y0, z],
          [-x, y1, z],
          [x, y1, z],
        ],
        [0, 0, -1],
        R,
      ),
      'decal',
    );
  }
  const H = S.head;
  add(body.patch((s, t) => [lerp(H.z[0], H.z[1], s), lerp(H.th[0], H.th[1], t)], 3, 2, 0.005), cell('head'));
  add(body.patch((s, t) => [lerp(H.z[0], H.z[1], s), Math.PI - lerp(H.th[0], H.th[1], t)], 3, 2, 0.005), cell('head'));
  const T = S.tail;
  if (T.th[1] > HALF_PI) {
    add(body.patch((s, t) => [lerp(T.z[0], T.z[1], s), lerp(T.th[0], T.th[1], t)], 2, hi ? 12 : 6, 0.005), cell('tail'));
  } else {
    add(body.patch((s, t) => [lerp(T.z[0], T.z[1], s), lerp(T.th[0], T.th[1], t)], 2, 3, 0.005), cell('tail'));
    add(body.patch((s, t) => [lerp(T.z[0], T.z[1], s), Math.PI - lerp(T.th[0], T.th[1], t)], 2, 3, 0.005), cell('tail'));
  }

  /* --- Light bar ------------------------------------------------------- */
  const roofY = cabin.point(S.barZ, HALF_PI, tmp).y;
  const barY = roofY + 0.035;
  const housing = hi ? new RoundedBoxGeometry(S.barW, 0.065, 0.2, 1, 0.02) : new THREE.BoxGeometry(S.barW, 0.065, 0.2);
  add(transformed(housing, { pos: [0, barY, S.barZ] }), 'dark');
  const lampW = S.barW * 0.24;
  const lamp = (x: number, c: RoadCell) =>
    add(transformed(new THREE.BoxGeometry(lampW, 0.045, 0.212), { pos: [x, barY + 0.002, S.barZ] }), cell(c));
  lamp(S.barW * 0.355, 'amberL');
  lamp(-S.barW * 0.355, 'amberR');
  lamp(S.barW * 0.1, 'green');
  lamp(-S.barW * 0.1, 'green');
  for (const x of [S.barW * 0.38, -S.barW * 0.38]) add(rod([x, barY - 0.03, S.barZ], [x, roofY - 0.01, S.barZ], 0.012, 4), 'dark');

  /* --- Mirrors, splitter, exhausts ------------------------------------- */
  if (mid) {
    const zm = G.screen[0] + (G.screen[1] - G.screen[0]) * 0.55;
    const bodyTop = body.point(zm, 0.9, tmp);
    const mx = Math.abs(bodyTop.x) + 0.1;
    const my = bodyTop.y + 0.12;
    const housing2 = hi ? new RoundedBoxGeometry(0.2, 0.11, 0.09, 2, 0.03) : new THREE.BoxGeometry(0.2, 0.11, 0.09);
    addBoth(transformed(housing2, { pos: [mx, my, zm] }), kind === 'safety-mercedes' ? 'dark' : 'paint');
    addBoth(rod([mx - 0.12, my - 0.06, zm], [mx - 0.02, my - 0.02, zm], 0.012, 4, 2), 'dark');
  }
  add(
    plateXZ(
      [
        [-0.55, zFront - 0.05],
        [0.55, zFront - 0.05],
        [0.7, zFront - 0.32],
        [-0.7, zFront - 0.32],
      ],
      0.018,
      0.16,
    ),
    'dark',
  );
  if (mid) {
    for (const x of [0.29, 0.41, -0.29, -0.41]) {
      const ex = new THREE.CylinderGeometry(0.042, 0.042, 0.12, hi ? 12 : 8, 1, true);
      add(transformed(ex, { pos: [x, S.sillY + 0.04, zRear + 0.02], rot: [HALF_PI, 0, 0] }), cell('chrome'));
    }
  }

  /* --- Aero ------------------------------------------------------------ */
  const aeroPts = hi ? 6 : mid ? 4 : 2;
  if (S.aero === 'gt') {
    const tailTop = body.point(-2.05, HALF_PI, tmp).y;
    const wy = tailTop + 0.17;
    add(
      wingElement(
        [
          { x: -0.8, z: -1.98, y: wy, chord: 0.3, angle: 10, thick: 0.1 },
          { x: 0.8, z: -1.98, y: wy, chord: 0.3, angle: 10, thick: 0.1 },
        ],
        aeroPts,
      ),
      'dark',
    );
    if (mid) {
      add(
        wingElement(
          [
            { x: -0.8, z: -2.13, y: wy + 0.07, chord: 0.16, angle: 26, thick: 0.1 },
            { x: 0.8, z: -2.13, y: wy + 0.07, chord: 0.16, angle: 26, thick: 0.1 },
          ],
          aeroPts,
        ),
        'dark',
      );
    }
    addBoth(
      plateZY(
        [
          [-1.94, wy - 0.07],
          [-1.94, wy + 0.12],
          [-2.32, wy + 0.16],
          [-2.34, wy - 0.07],
        ],
        0.012,
        0.806,
      ),
      'dark',
    );
    addBoth(
      plateZY(
        [
          [-1.98, tailTop - 0.04],
          [-2.16, tailTop - 0.04],
          [-2.12, wy + 0.01],
          [-1.99, wy + 0.01],
        ],
        0.014,
        0.34,
      ),
      'dark',
    );
  } else if (S.aero === 'duck') {
    const ty = body.point(-2.1, HALF_PI, tmp).y;
    add(
      wingElement(
        [
          { x: -0.62, z: -2.06, y: ty - 0.015, chord: 0.15, angle: 12, thick: 0.08 },
          { x: 0.62, z: -2.06, y: ty - 0.015, chord: 0.15, angle: 12, thick: 0.08 },
        ],
        aeroPts,
      ),
      'paint',
    );
  } else {
    const zEnd = S.cabin[0].z;
    const ry = cabin.point(zEnd + 0.14, HALF_PI, tmp).y;
    const hw = cabin.params(zEnd + 0.14).w * 0.88;
    add(
      wingElement(
        [
          { x: -hw, z: zEnd + 0.2, y: ry - 0.005, chord: 0.24, angle: -7, thick: 0.08 },
          { x: hw, z: zEnd + 0.2, y: ry - 0.005, chord: 0.24, angle: -7, thick: 0.08 },
        ],
        aeroPts,
      ),
      'paint',
    );
  }

  /* --- Wheels ---------------------------------------------------------- */
  const wheelSet: Array<[number, number, number]> = [
    [S.trackX[0], halfWB, 0],
    [-S.trackX[0], halfWB, 0],
    [S.trackX[1], -halfWB, 1],
    [-S.trackX[1], -halfWB, 1],
  ];
  wheelSet.forEach(([x, z, axle], i) => {
    const g = latheX(roadWheelProfile(S.wheelR, S.rimR, S.tyreW[axle], Q.detail), Q.wheelSeg, x > 0 ? 1 : -1);
    g.translate(x, S.wheelR, z);
    add(g, 'wheel', i + 1);
  });

  return { parts };
}

function quadGeo(c: [V3, V3, V3, V3], n: V3, r: UVRectLike): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  mb.vert(c[0], n, r[0], r[1]);
  mb.vert(c[1], n, r[2], r[1]);
  mb.vert(c[2], n, r[2], r[3]);
  mb.vert(c[3], n, r[0], r[3]);
  mb.tri(0, 1, 2);
  mb.tri(0, 2, 3);
  return fixWinding(mb.build());
}

/* ------------------------------------------------------------------------ */
/* Shared cache + instances                                                 */
/* ------------------------------------------------------------------------ */

interface SharedGroup {
  name: string;
  geo: THREE.BufferGeometry;
  skinned: boolean;
  triangles: number;
}

const ORDER = ['paint', 'dark', 'darkvc', 'glass', 'atlas', 'wheel'];
const cache = new Map<string, SharedGroup[]>();

function sharedRoad(kind: SafetyCarKind, q: ModelQuality): SharedGroup[] {
  const key = `${kind}|${q}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { parts } = buildRoadParts(kind, q);
  const groupOf = GROUP_OF[q];
  const byGroup = new Map<string, Part[]>();
  for (const p of parts) {
    const g = p.slot.startsWith('cell:') ? 'atlas' : groupOf[p.slot];
    if (!g) throw new Error(`roadCar: no group for slot ${p.slot}`);
    let list = byGroup.get(g);
    if (!list) byGroup.set(g, (list = []));
    list.push(p);
  }
  const out: SharedGroup[] = [];
  for (const name of ORDER) {
    const list = byGroup.get(name);
    if (!list) continue;
    const skinned = list.some((p) => p.bone !== B_ROOT);
    const geo = merge(
      list.map((p) => {
        const cellName = p.slot.startsWith('cell:') ? (p.slot.slice(5) as RoadCell) : null;
        return preparePart(p, {
          uv: cellName ? cellUV(ROAD_CELL[cellName], ROAD_CELL_ROW) : null,
          skin: skinned,
          color: name === 'darkvc' ? VC[p.slot] : null,
        });
      }),
    );
    geo.name = `road-${key}-${name}`;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    out.push({ name, geo, skinned, triangles: triangleCount(geo) });
  }
  for (const p of parts) p.geo.dispose();
  cache.set(key, out);
  return out;
}

export function roadCarStats(kind: SafetyCarKind, quality: ModelQuality): { drawCalls: number; triangles: number } {
  const g = sharedRoad(kind, quality);
  return { drawCalls: g.length, triangles: g.reduce((s, x) => s + x.triangles, 0) };
}

const roadWheelMats = new Map<string, THREE.MeshStandardMaterial>();
function roadWheelMaterial(spoke: string, q: ModelQuality): THREE.MeshStandardMaterial {
  const size: readonly [number, number] = q === 'high' ? [512, 256] : [256, 128];
  const key = `${spoke}|${size[0]}`;
  let m = roadWheelMats.get(key);
  if (!m) {
    const orm = roadWheelOrmTexture();
    m = new THREE.MeshStandardMaterial({
      map: roadWheelTexture(spoke, size),
      roughnessMap: orm,
      metalnessMap: orm,
      roughness: 1,
      metalness: 1,
    });
    roadWheelMats.set(key, m);
  }
  return m;
}

const IDENTITY = new THREE.Matrix4();

interface Lamp {
  cell: number;
  color: readonly [number, number, number];
}

const LAMPS: Record<'head' | 'tail' | 'amberL' | 'amberR' | 'green', Lamp> = {
  head: { cell: ROAD_CELL.head, color: [1, 0.97, 0.92] },
  tail: { cell: ROAD_CELL.tail, color: [1, 0.02, 0.01] },
  amberL: { cell: ROAD_CELL.amberL, color: [1, 0.34, 0.0] },
  amberR: { cell: ROAD_CELL.amberR, color: [1, 0.34, 0.0] },
  green: { cell: ROAD_CELL.green, color: [0.05, 1, 0.25] },
};

export function createRoadCar(kind: SafetyCarKind, quality: ModelQuality): RoadCarModel {
  const S = SPECS[kind];
  const groups = sharedRoad(kind, quality);
  const root = new THREE.Group();
  root.name = kind;

  const bones: THREE.Bone[] = [new THREE.Bone()];
  bones[0].name = 'carRoot';
  const halfWB = S.wheelbase / 2;
  const wheelPos: V3[] = [
    [S.trackX[0], S.wheelR, halfWB],
    [-S.trackX[0], S.wheelR, halfWB],
    [S.trackX[1], S.wheelR, -halfWB],
    [-S.trackX[1], S.wheelR, -halfWB],
  ];
  for (const [i, p] of wheelPos.entries()) {
    const b = new THREE.Bone();
    b.name = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'][i];
    b.position.set(p[0], p[1], p[2]);
    bones[0].add(b);
    bones.push(b);
  }
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  const emissiveData = new Uint8Array(GRID_COLS * GRID_ROWS * 4);
  const emissiveTex = maskTexture(emissiveData);
  const atlasTex = roadAtlasTexture({
    key: kind,
    text: S.text,
    textColor: S.textColor,
    textStroke: S.textStroke,
    paint: S.paint,
    accentA: S.accentA,
    accentB: S.accentB,
    grille: S.grille,
    pattern: S.pattern,
    size: RQ[quality].atlas,
  });
  const atlasMat = atlasMaterial(atlasTex, quality, null, emissiveTex, '#FFFFFF');
  atlasMat.emissiveIntensity = 2.6;

  for (const g of groups) {
    let mat: THREE.Material;
    switch (g.name) {
      case 'paint':
        mat = paintMaterial({ color: S.paint, quality, metallic: S.metallic });
        break;
      case 'dark':
        mat = carbonMaterial(quality);
        break;
      case 'darkvc':
        mat = darkVertexMaterial();
        break;
      case 'glass':
        mat = glassMaterial(quality);
        break;
      case 'atlas':
        mat = atlasMat;
        break;
      default:
        mat = roadWheelMaterial(S.spoke, quality);
    }
    let mesh: THREE.Mesh;
    if (g.skinned) {
      const sm = new THREE.SkinnedMesh(g.geo, mat);
      sm.bind(skeleton, IDENTITY);
      sm.boundingSphere = g.geo.boundingSphere!.clone();
      mesh = sm;
    } else {
      mesh = new THREE.Mesh(g.geo, mat);
    }
    mesh.name = g.name;
    mesh.castShadow = true;
    root.add(mesh);
  }

  const levels = new Map<number, number>();
  const setLamp = (l: Lamp, level: number) => {
    if (levels.get(l.cell) === level) return false;
    levels.set(l.cell, level);
    const i = (ROAD_CELL_ROW * GRID_COLS + l.cell) * 4;
    emissiveData[i] = Math.round(255 * l.color[0] * level);
    emissiveData[i + 1] = Math.round(255 * l.color[1] * level);
    emissiveData[i + 2] = Math.round(255 * l.color[2] * level);
    emissiveData[i + 3] = 255;
    return true;
  };

  let barOn = false;
  const apply = (t: number) => {
    let dirty = false;
    dirty = setLamp(LAMPS.head, 0.85) || dirty;
    dirty = setLamp(LAMPS.tail, 0.6) || dirty;
    if (barOn) {
      const ph = Math.floor(t * 3.2) % 2;
      dirty = setLamp(LAMPS.amberL, ph ? 1 : 0.04) || dirty;
      dirty = setLamp(LAMPS.amberR, ph ? 0.04 : 1) || dirty;
      dirty = setLamp(LAMPS.green, Math.floor(t * 1.6) % 2 ? 0.9 : 0.12) || dirty;
    } else {
      dirty = setLamp(LAMPS.amberL, 0) || dirty;
      dirty = setLamp(LAMPS.amberR, 0) || dirty;
      dirty = setLamp(LAMPS.green, 0) || dirty;
    }
    if (dirty) emissiveTex.needsUpdate = true;
  };
  apply(0);

  return {
    root,
    wheels: bones.slice(1),
    wheelRadius: S.wheelR,
    setLightBar(on: boolean) {
      barOn = on;
    },
    update(timeSec: number) {
      apply(timeSec);
    },
    dispose() {
      root.removeFromParent();
      emissiveTex.dispose();
      atlasMat.dispose();
      skeleton.dispose();
    },
  };
}

/** Road-car dimensions (metres) for placement/collision. */
export function roadCarDimensions(kind: SafetyCarKind): { length: number; width: number; wheelbase: number } {
  const S = SPECS[kind];
  const zs = S.body.map((s) => s.z);
  const w = Math.max(...S.body.map((s) => s.w));
  return { length: Math.max(...zs) - Math.min(...zs), width: w * 2, wheelbase: S.wheelbase };
}
