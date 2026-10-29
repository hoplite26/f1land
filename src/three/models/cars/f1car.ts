/**
 * Procedural 2026-spec Formula 1 car.
 *
 * Geometry is built once per quality and shared by every car; only the
 * decal atlas (numbers/code/helmet/stripes), the wheel material and an
 * optional highlight material are per car. Static parts are merged per
 * material group; moving parts (wheels, steering, active-aero flaps) are
 * bones of a per-car Skeleton, so a whole car is 4–6 draw calls.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CarModelOptions, F1CarModel, ModelQuality, TyreLetter } from '../types';
import {
  HALF_PI,
  Loft,
  MeshBuilder,
  TAU,
  finPath,
  fixWinding,
  latheX,
  lerp,
  merge,
  mirrorStations,
  mirrorX,
  plateXZ,
  plateZY,
  preparePart,
  resampleStations,
  rod,
  transformed,
  triangleCount,
  tube,
  wingElement,
  type LoftBuildOptions,
  type Part,
  type ProfilePoint,
  type Section,
  type SlotGeometries,
  type UVRectLike,
  type V3,
  type WingStation,
} from './geom';
import { F1_ATLAS, F1_SWATCH, F1_SWATCH_ROW, HELMET_THETA, cellUV, createF1AtlasTexture } from './decals';
import {
  addRim,
  atlasMaterial,
  carbonMaterial,
  darkVertexMaterial,
  f1TyreMap,
  liveryMaterials,
  metalMaterial,
  wheelMaterial,
  type RimUniform,
} from './materials';

/* ------------------------------------------------------------------------ */
/* Dimensions                                                               */
/* ------------------------------------------------------------------------ */

const WHEEL_R = 0.36;
const FRONT_Z = 1.7;
const REAR_Z = -1.7;
const FRONT_X = 0.8;
const REAR_X = 0.76;
const FRONT_W = 0.3;
const REAR_W = 0.38;

export const F1_DIMENSIONS = {
  length: 5.27,
  width: 1.904,
  height: 0.955,
  wheelbase: FRONT_Z - REAR_Z,
  wheelRadius: WHEEL_R,
  frontAxleZ: FRONT_Z,
  rearAxleZ: REAR_Z,
  /** Nose (front wing leading edge) and tail (rear wing endplate) Z. */
  noseZ: 2.745,
  tailZ: -2.527,
} as const;

/** Bone indices (order of `createBones`). */
const B = { root: 0, steerL: 1, steerR: 2, wFL: 3, wFR: 4, wRL: 5, wRR: 6, ffMount: 7, ff: 8, rfMount: 9, rf: 10 } as const;

/** Flap hinges sit at the trailing edge, like a real DRS / X-mode actuator. */
const FF_HINGE: V3 = [0, 0.29, 2.262];
const RF_HINGE: V3 = [0, 0.905, -2.434];

/* ------------------------------------------------------------------------ */
/* Quality tiers                                                            */
/* ------------------------------------------------------------------------ */

interface QualityParams {
  rings: number;
  cols: number;
  detail: 0 | 1 | 2;
  wheelSeg: number;
  wheelDetail: 0 | 1 | 2;
  wingSpan: number;
  aero: number;
  tube: readonly [number, number];
  helmet: readonly [number, number];
  ellipseSeg: number;
  atlas: readonly [number, number];
}

const QUALITY: Record<ModelQuality, QualityParams> = {
  high: {
    rings: 8,
    cols: 20,
    detail: 2,
    wheelSeg: 20,
    wheelDetail: 2,
    wingSpan: 7,
    aero: 6,
    tube: [16, 6],
    helmet: [16, 8],
    ellipseSeg: 18,
    atlas: [1024, 512],
  },
  medium: {
    rings: 4,
    cols: 12,
    detail: 1,
    wheelSeg: 12,
    wheelDetail: 1,
    wingSpan: 3,
    aero: 4,
    tube: [12, 5],
    helmet: [10, 5],
    ellipseSeg: 10,
    atlas: [512, 256],
  },
  low: {
    rings: 1.6,
    cols: 8,
    detail: 0,
    wheelSeg: 8,
    wheelDetail: 0,
    wingSpan: 1,
    aero: 2,
    tube: [6, 3],
    helmet: [6, 3],
    ellipseSeg: 6,
    atlas: [512, 256],
  },
};

/** Logical part slot → mesh group per quality. */
const GROUP_OF: Record<ModelQuality, Record<string, string>> = {
  high: {
    primary: 'primary',
    secondary: 'atlas',
    accent: 'atlas',
    light: 'atlas',
    tcam: 'atlas',
    decal: 'atlas',
    wing: 'wing',
    carbon: 'carbon',
    metal: 'metal',
    wheel: 'wheel',
  },
  medium: {
    primary: 'primary',
    secondary: 'atlas',
    accent: 'atlas',
    light: 'atlas',
    tcam: 'atlas',
    decal: 'atlas',
    wing: 'wing',
    carbon: 'dark',
    metal: 'dark',
    wheel: 'wheel',
  },
  low: {
    primary: 'primary',
    secondary: 'atlas',
    accent: 'atlas',
    light: 'atlas',
    tcam: 'atlas',
    decal: 'atlas',
    wing: 'dark',
    carbon: 'dark',
    metal: 'dark',
    wheel: 'wheel',
  },
};

const SWATCH_OF: Record<string, number> = {
  secondary: F1_SWATCH.secondary,
  accent: F1_SWATCH.accent,
  light: F1_SWATCH.light,
  tcam: F1_SWATCH.tcam,
};

const DARK_VC: Record<string, THREE.Color> = {
  carbon: new THREE.Color('#16181C'),
  metal: new THREE.Color('#80868D'),
  wing: new THREE.Color('#1B1E24'),
};

/* ------------------------------------------------------------------------ */
/* Shape tables                                                             */
/* ------------------------------------------------------------------------ */

const CHASSIS: Section[] = [
  { z: -0.4, w: 0.345, yb: 0.06, yt: 0.585, ym: 0.45, tt: 0.78, tb: 0.86, nt: 3.2, nb: 3.6 },
  { z: -0.05, w: 0.355, yb: 0.06, yt: 0.59 },
  { z: 0.28, w: 0.34, yb: 0.06, yt: 0.625 },
  { z: 0.55, w: 0.3, yb: 0.075, yt: 0.665, tt: 0.72 },
  { z: 0.95, w: 0.235, yb: 0.115, yt: 0.625, tb: 0.8, nt: 3.0, nb: 3.0 },
  { z: 1.35, w: 0.185, yb: 0.165, yt: 0.555 },
  { z: 1.75, w: 0.152, yb: 0.185, yt: 0.47, nt: 2.8, nb: 2.6 },
  { z: 2.1, w: 0.122, yb: 0.135, yt: 0.37, nt: 2.6, nb: 2.4 },
  { z: 2.4, w: 0.095, yb: 0.105, yt: 0.285, nt: 2.4, nb: 2.2 },
  { z: 2.58, w: 0.065, yb: 0.098, yt: 0.225 },
  { z: 2.68, w: 0.032, yb: 0.11, yt: 0.18, tt: 0.9, tb: 0.9 },
];

const ENGINE_COVER: Section[] = [
  { z: -2.3, w: 0.05, yb: 0.255, yt: 0.355, ym: 0.5, tt: 1, tb: 1, nt: 3, nb: 3 },
  { z: -2.12, w: 0.065, yb: 0.235, yt: 0.385 },
  { z: -1.95, w: 0.1, yb: 0.18, yt: 0.43, ym: 0.4, tt: 0.6, nt: 2.4, nb: 4 },
  { z: -1.7, w: 0.16, yb: 0.11, yt: 0.52, ym: 0.35, tt: 0.45 },
  { z: -1.35, w: 0.22, yb: 0.07, yt: 0.66, tt: 0.38 },
  { z: -1.0, w: 0.27, yb: 0.06, yt: 0.78, tt: 0.32 },
  { z: -0.72, w: 0.3, yb: 0.06, yt: 0.84, tt: 0.3 },
  { z: -0.52, w: 0.32, yb: 0.06, yt: 0.83, tt: 0.32 },
  { z: -0.4, w: 0.33, yb: 0.06, yt: 0.72, tt: 0.4 },
  { z: -0.3, w: 0.32, yb: 0.06, yt: 0.56, tt: 0.6 },
];

const AIRBOX: Section[] = [
  { z: -1.3, w: 0.025, yb: 0.6, yt: 0.66, ym: 0.3, tt: 0.5, tb: 1, nt: 2.2, nb: 3 },
  { z: -1.0, w: 0.065, yb: 0.64, yt: 0.84 },
  { z: -0.66, w: 0.1, yb: 0.66, yt: 0.945 },
  { z: -0.48, w: 0.115, yb: 0.66, yt: 0.955 },
  { z: -0.41, w: 0.12, yb: 0.665, yt: 0.95 },
];

const SIDEPOD: Section[] = [
  { z: -1.4, cx: 0.215, w: 0.04, yb: 0.075, yt: 0.19, ym: 0.55, tt: 0.85, tb: 0.5, nt: 2.6, nb: 2.2 },
  { z: -1.15, cx: 0.27, w: 0.09, yb: 0.075, yt: 0.3 },
  { z: -0.85, cx: 0.34, w: 0.15, yb: 0.075, yt: 0.42 },
  { z: -0.45, cx: 0.405, w: 0.19, yb: 0.09, yt: 0.52 },
  { z: -0.1, cx: 0.435, w: 0.2, yb: 0.13, yt: 0.555 },
  { z: 0.1, cx: 0.445, w: 0.19, yb: 0.2, yt: 0.57 },
  { z: 0.2, cx: 0.45, w: 0.175, yb: 0.27, yt: 0.57 },
];

const FW_MAIN: WingStation[] = [
  { x: 0, z: 2.745, y: 0.072, chord: 0.25, angle: -2, thick: 0.09, camber: 0.03 },
  { x: 0.25, z: 2.745, y: 0.072, chord: 0.25, angle: -1, thick: 0.09, camber: 0.03 },
  { x: 0.55, z: 2.725, y: 0.085, chord: 0.27, angle: 4, thick: 0.09, camber: 0.035 },
  { x: 0.84, z: 2.68, y: 0.105, chord: 0.28, angle: 7, thick: 0.09, camber: 0.04 },
];
const FW_FLAP2: WingStation[] = [
  { x: 0.09, z: 2.5, y: 0.118, chord: 0.15, angle: 16, thick: 0.1, camber: 0.05 },
  { x: 0.45, z: 2.495, y: 0.13, chord: 0.155, angle: 19, thick: 0.1, camber: 0.05 },
  { x: 0.84, z: 2.46, y: 0.155, chord: 0.16, angle: 23, thick: 0.1, camber: 0.05 },
];
const FW_FLAP3: WingStation[] = [
  { x: 0.09, z: 2.385, y: 0.212, chord: 0.13, angle: 30, thick: 0.1, camber: 0.05 },
  { x: 0.84, z: 2.36, y: 0.245, chord: 0.13, angle: 32, thick: 0.1, camber: 0.05 },
];
const RW_MAIN: WingStation[] = [
  { x: 0, z: -2.16, y: 0.735, chord: 0.27, angle: 9, thick: 0.12, camber: 0.05 },
  { x: 0.3, z: -2.165, y: 0.745, chord: 0.27, angle: 10, thick: 0.12, camber: 0.05 },
  { x: 0.47, z: -2.18, y: 0.77, chord: 0.26, angle: 13, thick: 0.12, camber: 0.05 },
];
const RW_FLAP: WingStation[] = [
  { x: 0, z: -2.3, y: 0.8, chord: 0.17, angle: 38, thick: 0.11, camber: 0.05 },
  { x: 0.47, z: -2.3, y: 0.8, chord: 0.17, angle: 38, thick: 0.11, camber: 0.05 },
];

type Pt2 = readonly [number, number];

const FLOOR_HALF: Pt2[] = [
  [0.26, 1.18],
  [0.46, 1.02],
  [0.63, 0.74],
  [0.715, 0.42],
  [0.735, 0.05],
  [0.735, -0.55],
  [0.7, -0.9],
  [0.62, -1.12],
  [0.545, -1.32],
];

const DIFFUSER_Y = (z: number) => {
  const t = THREE.MathUtils.clamp((-1.3 - z) / 0.72, 0, 1);
  return 0.055 + 0.19 * Math.pow(t, 1.7);
};

/** Suspension (left side): pairs of [inboard, outboard]. */
const SUSP_FRONT: Array<[V3, V3, number]> = [
  [[0.12, 0.4, 1.92], [0.585, 0.475, 1.725], 0],
  [[0.17, 0.47, 1.45], [0.585, 0.475, 1.725], 1],
  [[0.1, 0.2, 2.0], [0.625, 0.205, 1.7], 0],
  [[0.15, 0.2, 1.4], [0.625, 0.205, 1.7], 1],
  [[0.6, 0.225, 1.69], [0.14, 0.45, 1.62], 1],
  [[0.12, 0.3, 1.86], [0.61, 0.3, 1.86], 2],
];
const SUSP_REAR: Array<[V3, V3, number]> = [
  [[0.15, 0.44, -1.42], [0.545, 0.47, -1.7], 0],
  [[0.08, 0.38, -1.9], [0.545, 0.47, -1.7], 1],
  [[0.17, 0.16, -1.38], [0.565, 0.17, -1.7], 0],
  [[0.11, 0.18, -1.96], [0.565, 0.17, -1.7], 1],
  [[0.545, 0.45, -1.69], [0.15, 0.19, -1.55], 1],
  [[0.08, 0.3, -1.93], [0.55, 0.31, -1.93], 2],
];

/* ------------------------------------------------------------------------ */
/* Part helpers                                                             */
/* ------------------------------------------------------------------------ */

function uvRemap(g: THREE.BufferGeometry, r: UVRectLike): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(r[0], r[2], uv.getX(i)), lerp(r[1], r[3], uv.getY(i)));
  return g;
}

/** Flat decal quad: corners bottom-left, bottom-right, top-right, top-left. */
function quad(c: [V3, V3, V3, V3], n: V3, r: UVRectLike): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const off = 0.0;
  mb.vert([c[0][0] + n[0] * off, c[0][1], c[0][2]], n, r[0], r[1]);
  mb.vert(c[1], n, r[2], r[1]);
  mb.vert(c[2], n, r[2], r[3]);
  mb.vert(c[3], n, r[0], r[3]);
  mb.tri(0, 1, 2);
  mb.tri(0, 2, 3);
  return fixWinding(mb.build());
}

/** Two-sided curved sheet y = yFn(z) over an x/z rectangle (diffuser roof). */
function heightSheet(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  yFn: (z: number) => number,
  nu: number,
  nv: number,
  thick: number,
): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  for (const side of [1, -1] as const) {
    const base = mb.count;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const x = lerp(x0, x1, i / nu);
        const z = lerp(z0, z1, j / nv);
        mb.vert([x, yFn(z) - (side > 0 ? 0 : thick), z], [0, side, 0]);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i;
        const b = a + 1;
        const d = a + nu + 1;
        const c = d + 1;
        mb.tri(a, b, c);
        mb.tri(a, c, d);
      }
    }
  }
  const g = fixWinding(mb.build());
  g.computeVertexNormals();
  return g;
}

function f1WheelProfile(W: number, detail: number): ProfilePoint[] {
  const hw = W / 2;
  const pts: Array<ProfilePoint & { d: number }> = [
    { r: 0.0, x: -hw + 0.07, v: 0.0, d: 0 },
    { r: 0.232, x: -hw + 0.008, v: 0.06, d: 0 },
    { r: 0.29, x: -hw - 0.003, v: 0.1, d: 1 },
    { r: 0.345, x: -hw + 0.008, v: 0.128, d: 2 },
    { r: 0.36, x: -hw + 0.04, v: 0.14, d: 0 },
    { r: 0.36, x: hw - 0.04, v: 0.32, d: 0 },
    { r: 0.345, x: hw - 0.008, v: 0.335, d: 1 },
    { r: 0.31, x: hw + 0.003, v: 0.45, d: 2 },
    { r: 0.27, x: hw + 0.001, v: 0.58, d: 1 },
    { r: 0.232, x: hw - 0.008, v: 0.7, d: 0 },
    { r: 0.226, x: hw - 0.014, v: 0.72, d: 2 },
    { r: 0.214, x: hw - 0.03, v: 0.74, d: 1 },
    { r: 0.2, x: hw - 0.034, v: 0.78, d: 0 },
    { r: 0.12, x: hw - 0.04, v: 0.87, d: 2 },
    { r: 0.055, x: hw - 0.042, v: 0.95, d: 1 },
    { r: 0.0, x: hw - 0.024, v: 1.0, d: 0 },
  ];
  return pts.filter((p) => p.d <= detail);
}

/* ------------------------------------------------------------------------ */
/* Build all parts for one quality                                          */
/* ------------------------------------------------------------------------ */

function buildParts(q: ModelQuality): Part[] {
  const P = QUALITY[q];
  const hi = P.detail >= 2;
  const mid = P.detail >= 1;
  const parts: Part[] = [];
  const add = (geo: THREE.BufferGeometry, slot: string, bone: number = B.root) => {
    parts.push({ geo, slot, bone });
  };
  const addBoth = (geo: THREE.BufferGeometry, slot: string, bone: number = B.root) => {
    add(geo, slot, bone);
    add(mirrorX(geo), slot, bone);
  };
  const addMap = (m: SlotGeometries, mirror = false) => {
    for (const [slot, g] of m) {
      add(g, slot);
      if (mirror) add(mirrorX(g), slot);
    }
  };
  const lo = (extra: Partial<LoftBuildOptions>): LoftBuildOptions => ({
    cols: P.cols,
    ringsPerMetre: P.rings,
    uniformRings: !mid,
    ...extra,
  });
  const NUM = F1_ATLAS.number;
  const NUM2 = F1_ATLAS.number2;

  /* --- Survival cell + nose ------------------------------------------- */
  const chassis = new Loft(CHASSIS);
  addMap(
    chassis.build(
      lo({
        thetaBreaks: mid ? [HALF_PI - 0.11, HALF_PI + 0.11] : [],
        zBreaks: mid ? [2.47, 2.43, 0.62, 0.25, 1.3] : [2.47],
        slotOf: (z, th) => {
          if (z > 2.47) return 'secondary';
          if (hi && z > 2.43) return 'accent';
          if (mid && z > 0.62 && Math.abs(th - HALF_PI) < 0.11) return 'secondary';
          if (mid && th > Math.PI && z > 0.25 && z < 1.3) return 'carbon';
          return 'primary';
        },
        capStart: { slot: 'primary' },
        capEnd: { slot: 'secondary', dome: 0.012 },
      }),
    ),
  );
  // Cockpit opening + padded coaming.
  const cz = 0.0;
  const az = 0.37;
  const ath = 0.62;
  add(
    chassis.patch(
      (s, t) => [cz + s * az * Math.cos(t * TAU), HALF_PI + s * ath * Math.sin(t * TAU)],
      mid ? 2 : 1,
      P.ellipseSeg,
      0.003,
    ),
    'carbon',
  );
  if (mid) {
    const rim: V3[] = [];
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let k = 0; k < P.ellipseSeg; k++) {
      const a = (k / P.ellipseSeg) * TAU;
      const z = cz + az * Math.cos(a);
      const th = HALF_PI + ath * Math.sin(a);
      chassis.point(z, th, p);
      chassis.normal(z, th, n);
      p.addScaledVector(n, 0.01);
      rim.push([p.x, p.y, p.z]);
    }
    add(tube(rim, 0.016, P.ellipseSeg * 2, P.tube[1] - 2, true), 'carbon');
  }
  // Nose number (reads from the front / top-down) and chassis-side code.
  add(chassis.patch((s, t) => [lerp(2.335, 2.165, t), HALF_PI + (0.5 - s) * 1.8], mid ? 6 : 2, mid ? 3 : 1, 0.0035, NUM), 'decal');
  if (mid) {
    const CODE = F1_ATLAS.code;
    add(chassis.patch((s, t) => [lerp(0.95, 0.6, s), 0.16 + t * 0.3], 5, 2, 0.0035, CODE), 'decal');
    add(chassis.patch((s, t) => [lerp(0.6, 0.95, s), Math.PI - 0.16 - t * 0.3], 5, 2, 0.0035, CODE), 'decal');
  }

  /* --- Driver: helmet + halo ------------------------------------------ */
  const helmet = new THREE.SphereGeometry(0.122, P.helmet[0], P.helmet[1], 0, TAU, 0, Math.PI * HELMET_THETA);
  uvRemap(helmet, F1_ATLAS.helmet);
  transformed(helmet, { pos: [0, 0.665, -0.1], rot: [-0.12, 0, 0], scale: [0.96, 1, 1.1] });
  add(helmet, 'decal');

  const haloHalf: V3[] = [
    [0.235, 0.58, -0.33],
    [0.255, 0.7, -0.24],
    [0.25, 0.79, -0.08],
    [0.205, 0.832, 0.1],
    [0.11, 0.847, 0.215],
    [0, 0.852, 0.258],
  ];
  const mirrorPts = (half: V3[]): V3[] => [...half, ...half.slice(0, -1).reverse().map(([x, y, z]) => [-x, y, z] as V3)];
  add(tube(mirrorPts(haloHalf), 0.024, P.tube[0] * 2, P.tube[1]), 'metal');
  add(
    tube(
      [
        [0, 0.852, 0.258],
        [0, 0.82, 0.36],
        [0, 0.74, 0.45],
        [0, 0.655, 0.53],
      ],
      0.021,
      Math.max(3, P.tube[0] / 2),
      P.tube[1],
    ),
    'metal',
  );
  if (mid) {
    const stripe = haloHalf.slice(2).map(([x, y, z]) => [x * 0.99, y + 0.021, z] as V3);
    add(tube(mirrorPts(stripe), 0.0095, P.tube[0], 4), 'accent');
  }

  /* --- Engine cover, airbox, T-cam, shark fin -------------------------- */
  const cover = new Loft(ENGINE_COVER);
  addMap(
    cover.build(
      lo({
        thetaBreaks: hi ? [HALF_PI - 0.3, HALF_PI + 0.3, HALF_PI - 0.35, HALF_PI + 0.35] : mid ? [HALF_PI - 0.3, HALF_PI + 0.3] : [],
        zBreaks: mid ? [-0.66, -2.02, -2.1] : [-2.1],
        slotOf: (z, th) => {
          const top = Math.abs(th - HALF_PI);
          if (z < -2.1) return 'carbon';
          if (mid && z < -0.66 && z > -2.02 && top < 0.3) return 'secondary';
          if (hi && z < -0.66 && z > -2.02 && top < 0.35) return 'accent';
          return 'primary';
        },
        capStart: { slot: 'carbon' },
      }),
    ),
  );
  add(cover.patch((s, t) => [lerp(-1.02, -1.34, s), 0.45 + t * 0.5], mid ? 5 : 2, mid ? 3 : 1, 0.0035, NUM2), 'decal');
  add(cover.patch((s, t) => [lerp(-1.34, -1.02, s), Math.PI - 0.45 - t * 0.5], mid ? 5 : 2, mid ? 3 : 1, 0.0035, NUM2), 'decal');

  const airbox = new Loft(AIRBOX);
  addMap(
    airbox.build({
      cols: Math.max(6, Math.round(P.cols * 0.75)),
      ringsPerMetre: P.rings * 1.2,
      uniformRings: !mid,
      zBreaks: hi ? [-0.45] : [],
      slotOf: (z) => (hi && z > -0.45 ? 'accent' : 'primary'),
      capEnd: { slot: 'carbon', dome: -0.035 },
    }),
  );
  const tcam = hi ? new RoundedBoxGeometry(0.05, 0.034, 0.12, 1, 0.012) : new THREE.BoxGeometry(0.05, 0.034, 0.12);
  add(transformed(tcam, { pos: [0, 0.978, -0.53] }), 'tcam');
  if (mid) {
    add(transformed(new THREE.BoxGeometry(0.012, 0.03, 0.04), { pos: [0, 0.955, -0.53] }), 'carbon');
    add(
      plateZY(
        [
          [-0.95, 0.83],
          [-1.95, 0.66],
          [-2.06, 0.6],
          [-2.06, 0.38],
          [-1.7, 0.5],
          [-1.35, 0.63],
          [-0.95, 0.77],
        ],
        0.008,
        0,
      ),
      'primary',
    );
    const ex = new THREE.CylinderGeometry(0.034, 0.038, 0.11, hi ? 12 : 8, 1, true);
    add(transformed(ex, { pos: [0, 0.43, -2.1], rot: [HALF_PI, 0, 0] }), 'metal');
  }

  /* --- Sidepods -------------------------------------------------------- */
  const pod = new Loft(SIDEPOD);
  const podBreaks = [0.12, 0.8, Math.PI * 1.08, Math.PI * 1.92];
  if (hi) podBreaks.push(0.88);
  addMap(
    pod.build(
      lo({
        thetaBreaks: mid ? podBreaks : [],
        zBreaks: mid ? [0.14, -1.22] : [],
        slotOf: (z, th) => {
          const inZ = z < 0.14 && z > -1.22;
          if (mid && inZ && th > 0.12 && th < 0.8) return 'secondary';
          if (hi && inZ && th >= 0.8 && th < 0.88) return 'accent';
          if (mid && th > Math.PI * 1.08 && th < Math.PI * 1.92) return 'carbon';
          return 'primary';
        },
        capEnd: { slot: 'carbon', dome: -0.05 },
      }),
    ),
    true,
  );

  /* --- Mirrors --------------------------------------------------------- */
  if (mid) {
    const housing = hi ? new RoundedBoxGeometry(0.14, 0.055, 0.06, 1, 0.016) : new THREE.BoxGeometry(0.14, 0.055, 0.06);
    addBoth(transformed(housing, { pos: [0.43, 0.668, 0.34] }), 'primary');
    addBoth(transformed(new THREE.PlaneGeometry(0.12, 0.04), { pos: [0.43, 0.668, 0.308], rot: [0, Math.PI, 0] }), 'metal');
    addBoth(rod([0.27, 0.615, 0.4], [0.4, 0.66, 0.35], 0.008, 4, 2), 'carbon');
    if (hi) addBoth(rod([0.29, 0.6, 0.3], [0.41, 0.655, 0.33], 0.006, 4, 2), 'carbon');
  }

  /* --- Floor, edge wings, fences, diffuser ----------------------------- */
  const outline: Pt2[] = [...FLOOR_HALF, ...[...FLOOR_HALF].reverse().map(([x, z]) => [-x, z] as Pt2)];
  add(plateXZ(outline, 0.022, 0.055), 'wing');
  if (mid) {
    addBoth(
      plateZY(
        [
          [0.55, 0.055],
          [0.4, 0.105],
          [-0.75, 0.105],
          [-0.92, 0.055],
        ],
        0.01,
        0.728,
      ),
      'carbon',
    );
  }
  if (hi) {
    for (const [x0, x1, h] of [
      [0.2, 0.3, 0.11],
      [0.3, 0.42, 0.09],
      [0.41, 0.55, 0.07],
    ] as const) {
      const path: Pt2[] = [
        [x0, 1.12],
        [x0 + 0.03, 0.95],
        [(x0 + x1) / 2, 0.75],
        [x1, 0.55],
      ];
      addBoth(finPath(path, 0.055, [h * 0.6, h, h, h * 0.7], 0.008), 'carbon');
    }
  }
  add(heightSheet(-0.5, 0.5, -1.3, -2.02, DIFFUSER_Y, hi ? 4 : 1, hi ? 8 : mid ? 4 : 2, 0.012), 'carbon');
  if (mid) {
    const fence = (x: number, top: number) => {
      const pts: Pt2[] = [[-1.3, 0.035]];
      for (let k = 0; k <= 4; k++) {
        const z = lerp(-1.3, -2.02, k / 4);
        pts.push([z, DIFFUSER_Y(z) + top]);
      }
      pts.push([-2.02, 0.035]);
      return plateZY(pts.reverse(), 0.012, x);
    };
    addBoth(fence(0.5, 0.012), 'carbon');
    if (hi) addBoth(fence(0.24, 0.0), 'carbon');
  }

  /* --- Front wing ------------------------------------------------------ */
  const span = Math.max(1, P.wingSpan);
  add(wingElement(mirrorStations(resampleStations(FW_MAIN, 0, 0.84, span + 1)), P.aero), 'wing');
  if (mid) addBoth(wingElement(resampleStations(FW_FLAP2, 0.09, 0.84, span), P.aero), 'wing');
  addBoth(wingElement(resampleStations(FW_FLAP3, 0.09, 0.84, Math.max(1, span - 1)), P.aero), 'primary', B.ff);
  const fwEndplate: Pt2[] = [
    [2.75, 0.04],
    [2.752, 0.14],
    [2.72, 0.215],
    [2.64, 0.262],
    [2.5, 0.29],
    [2.3, 0.305],
    [2.235, 0.29],
    [2.25, 0.16],
    [2.32, 0.09],
    [2.36, 0.04],
  ];
  addBoth(plateZY(fwEndplate, 0.012, 0.846), 'accent');

  /* --- Rear wing, beam wing, pylons ------------------------------------ */
  add(wingElement(mirrorStations(resampleStations(RW_MAIN, 0, 0.47, span + 1)), P.aero), 'wing');
  add(wingElement(mirrorStations(resampleStations(RW_FLAP, 0, 0.47, Math.max(1, span))), P.aero), 'primary', B.rf);
  const rwEndplate: Pt2[] = [
    [-2.13, 0.64],
    [-2.125, 0.86],
    [-2.16, 0.925],
    [-2.24, 0.958],
    [-2.45, 0.958],
    [-2.515, 0.93],
    [-2.525, 0.62],
    [-2.47, 0.54],
    [-2.36, 0.52],
    [-2.24, 0.56],
  ];
  addBoth(plateZY(rwEndplate, 0.012, 0.476), 'accent');
  addBoth(
    plateZY(
      [
        [-2.02, 0.37],
        [-2.2, 0.37],
        [-2.33, 0.745],
        [-2.2, 0.75],
      ],
      0.012,
      0.055,
    ),
    'carbon',
  );
  if (mid) {
    add(
      wingElement(
        [
          { x: -0.4, z: -2.08, y: 0.345, chord: 0.12, angle: 10, thick: 0.1 },
          { x: 0.4, z: -2.08, y: 0.345, chord: 0.12, angle: 10, thick: 0.1 },
        ],
        P.aero,
      ),
      'wing',
    );
    add(
      wingElement(
        [
          { x: -0.4, z: -2.19, y: 0.385, chord: 0.1, angle: 26, thick: 0.1 },
          { x: 0.4, z: -2.19, y: 0.385, chord: 0.1, angle: 26, thick: 0.1 },
        ],
        P.aero,
      ),
      'wing',
    );
  }
  if (hi) {
    const SP = F1_ATLAS.sponsor;
    const x = 0.4846;
    add(
      quad(
        [
          [x, 0.8, -2.15],
          [x, 0.8, -2.47],
          [x, 0.84, -2.47],
          [x, 0.84, -2.15],
        ],
        [1, 0, 0],
        SP,
      ),
      'decal',
    );
    add(
      quad(
        [
          [-x, 0.8, -2.47],
          [-x, 0.8, -2.15],
          [-x, 0.84, -2.15],
          [-x, 0.84, -2.47],
        ],
        [-1, 0, 0],
        SP,
      ),
      'decal',
    );
  }

  /* --- Lights ---------------------------------------------------------- */
  add(transformed(new THREE.BoxGeometry(0.07, 0.045, 0.02), { pos: [0, 0.305, -2.305] }), 'light');
  if (mid) addBoth(transformed(new THREE.BoxGeometry(0.016, 0.26, 0.012), { pos: [0.476, 0.77, -2.528] }), 'light');

  /* --- Suspension ------------------------------------------------------ */
  const suspR = 0.011;
  const radial = hi ? 6 : mid ? 4 : 3;
  for (const set of [SUSP_FRONT, SUSP_REAR]) {
    for (const [a, b, lvl] of set) {
      if (lvl > P.detail) continue;
      addBoth(rod(a, b, suspR, radial, 1.8), 'carbon');
    }
  }

  /* --- Wheels ---------------------------------------------------------- */
  const wheel = (x: number, z: number, w: number, bone: number) => {
    const side = x > 0 ? 1 : -1;
    const g = latheX(f1WheelProfile(w, P.wheelDetail), P.wheelSeg, side as 1 | -1);
    g.translate(x, WHEEL_R, z);
    add(g, 'wheel', bone);
  };
  wheel(FRONT_X, FRONT_Z, FRONT_W, B.wFL);
  wheel(-FRONT_X, FRONT_Z, FRONT_W, B.wFR);
  wheel(REAR_X, REAR_Z, REAR_W, B.wRL);
  wheel(-REAR_X, REAR_Z, REAR_W, B.wRR);

  return parts;
}

/* ------------------------------------------------------------------------ */
/* Shared geometry cache                                                    */
/* ------------------------------------------------------------------------ */

interface SharedGroup {
  name: string;
  geo: THREE.BufferGeometry;
  skinned: boolean;
  triangles: number;
}

const GROUP_ORDER = ['primary', 'wing', 'carbon', 'metal', 'dark', 'atlas', 'wheel'];
const sharedCache = new Map<ModelQuality, SharedGroup[]>();

function sharedGroups(q: ModelQuality): SharedGroup[] {
  const hit = sharedCache.get(q);
  if (hit) return hit;
  const parts = buildParts(q);
  const groupOf = GROUP_OF[q];
  const byGroup = new Map<string, Part[]>();
  for (const p of parts) {
    const g = groupOf[p.slot];
    if (!g) throw new Error(`f1car: no group for slot "${p.slot}"`);
    let list = byGroup.get(g);
    if (!list) byGroup.set(g, (list = []));
    list.push(p);
  }
  const out: SharedGroup[] = [];
  for (const name of GROUP_ORDER) {
    const list = byGroup.get(name);
    if (!list) continue;
    const skinned = list.some((p) => p.bone !== B.root);
    const geos = list.map((p) => {
      const sw = SWATCH_OF[p.slot];
      return preparePart(p, {
        uv: sw !== undefined ? cellUV(sw, F1_SWATCH_ROW) : null,
        skin: skinned,
        color: name === 'dark' ? DARK_VC[p.slot] : null,
      });
    });
    const geo = merge(geos);
    geo.name = `f1car-${q}-${name}`;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    out.push({ name, geo, skinned, triangles: triangleCount(geo) });
  }
  for (const p of parts) p.geo.dispose();
  sharedCache.set(q, out);
  return out;
}

/** Build shared geometry ahead of time (avoids a hitch when the first car spawns). */
export function preloadF1Car(quality: ModelQuality): void {
  sharedGroups(quality);
}

/** Static per-car cost for a quality tier (meshes = draw calls without shadows). */
export function f1CarStats(quality: ModelQuality): { drawCalls: number; triangles: number } {
  const groups = sharedGroups(quality);
  return { drawCalls: groups.length, triangles: groups.reduce((s, g) => s + g.triangles, 0) };
}

/* ------------------------------------------------------------------------ */
/* Car instance                                                             */
/* ------------------------------------------------------------------------ */

function createBones(): THREE.Bone[] {
  const mk = (name: string, parent: THREE.Bone | null, pos?: V3) => {
    const b = new THREE.Bone();
    b.name = name;
    if (pos) b.position.set(pos[0], pos[1], pos[2]);
    parent?.add(b);
    return b;
  };
  const root = mk('carRoot', null);
  const steerL = mk('steerFL', root, [FRONT_X, WHEEL_R, FRONT_Z]);
  const steerR = mk('steerFR', root, [-FRONT_X, WHEEL_R, FRONT_Z]);
  const wFL = mk('wheelFL', steerL);
  const wFR = mk('wheelFR', steerR);
  const wRL = mk('wheelRL', root, [REAR_X, WHEEL_R, REAR_Z]);
  const wRR = mk('wheelRR', root, [-REAR_X, WHEEL_R, REAR_Z]);
  // Mounts are yawed 180° so a positive flap rotation.x opens (flattens) the flap.
  const ffMount = mk('frontFlapMount', root, FF_HINGE);
  ffMount.rotation.y = Math.PI;
  const ff = mk('frontFlap', ffMount);
  const rfMount = mk('rearFlapMount', root, RF_HINGE);
  rfMount.rotation.y = Math.PI;
  const rf = mk('rearFlap', rfMount);
  return [root, steerL, steerR, wFL, wFR, wRL, wRR, ffMount, ff, rfMount, rf];
}

export interface F1CarOptions extends CarModelOptions {
  /** T-cam colour (teammates are told apart by yellow vs black). Default black. */
  tcam?: 'black' | 'yellow';
  /** Override the generated helmet base colour. */
  helmetColor?: string;
  /** Initial tyre compound (default 'M'). */
  tyre?: TyreLetter;
  /** Set castShadow on the car meshes (default true). */
  castShadow?: boolean;
}

const IDENTITY = new THREE.Matrix4();
const CAR_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.45, 0.1), 2.85);

export function createF1Car(opts: F1CarOptions): F1CarModel {
  const q = opts.quality;
  const groups = sharedGroups(q);
  const root = new THREE.Group();
  root.name = `f1car-${opts.code}`;

  const bones = createBones();
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  const livery = liveryMaterials(opts.livery, q);
  const atlasTex = createF1AtlasTexture({
    livery: opts.livery,
    number: opts.number,
    code: opts.code,
    tcam: opts.tcam ?? 'black',
    size: QUALITY[q].atlas,
    helmetColor: opts.helmetColor,
  });
  const atlasRim: RimUniform = { value: 0 };
  const atlasMat = atlasMaterial(atlasTex, q, atlasRim);
  const wheelMat = wheelMaterial(q, opts.tyre ?? 'M');

  let primaryMesh: THREE.Mesh | null = null;
  let atlasMesh: THREE.Mesh | null = null;
  for (const g of groups) {
    let mat: THREE.Material;
    switch (g.name) {
      case 'primary':
        mat = livery.primary;
        break;
      case 'wing':
        mat = livery.wing;
        break;
      case 'carbon':
        mat = carbonMaterial(q);
        break;
      case 'metal':
        mat = metalMaterial();
        break;
      case 'dark':
        mat = darkVertexMaterial();
        break;
      case 'atlas':
        mat = atlasMat;
        break;
      default:
        mat = wheelMat;
    }
    let mesh: THREE.Mesh;
    if (g.skinned) {
      const sm = new THREE.SkinnedMesh(g.geo, mat);
      sm.bind(skeleton, IDENTITY);
      sm.boundingSphere = CAR_BOUNDS.clone();
      mesh = sm;
    } else {
      mesh = new THREE.Mesh(g.geo, mat);
    }
    mesh.name = g.name;
    mesh.castShadow = opts.castShadow ?? true;
    root.add(mesh);
    if (g.name === 'primary') primaryMesh = mesh;
    if (g.name === 'atlas') atlasMesh = mesh;
  }

  let rain = false;
  if (atlasMesh) {
    atlasMesh.onBeforeRender = () => {
      if (!rain) {
        atlasMat.emissiveIntensity = 0;
        return;
      }
      const phase = (performance.now() / 1000) * 3;
      atlasMat.emissiveIntensity = phase % 1 < 0.5 ? 8 : 0.5;
    };
  }

  let rimPrimary: THREE.MeshStandardMaterial | null = null;
  const primaryRim: RimUniform = { value: 0 };

  return {
    root,
    wheels: [bones[B.wFL], bones[B.wFR], bones[B.wRL], bones[B.wRR]],
    steerPivots: [bones[B.steerL], bones[B.steerR]],
    rearFlap: bones[B.rf],
    frontFlap: bones[B.ff],
    wheelRadius: WHEEL_R,
    setBrake(level: number) {
      wheelMat.emissiveIntensity = THREE.MathUtils.clamp(level, 0, 1) * 3.5;
    },
    setRainLight(on: boolean) {
      rain = on;
    },
    setTyre(letter: TyreLetter) {
      wheelMat.map = f1TyreMap(letter, q);
    },
    setHighlight(level: number) {
      const l = THREE.MathUtils.clamp(level, 0, 1);
      atlasRim.value = l;
      primaryRim.value = l;
      if (!primaryMesh) return;
      if (l > 0.001) {
        if (!rimPrimary) {
          rimPrimary = livery.primary.clone();
          addRim(rimPrimary, primaryRim);
        }
        primaryMesh.material = rimPrimary;
      } else {
        primaryMesh.material = livery.primary;
      }
    },
    dispose() {
      root.removeFromParent();
      atlasTex.dispose();
      atlasMat.dispose();
      wheelMat.dispose();
      rimPrimary?.dispose();
      skeleton.dispose();
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Blob shadow                                                              */
/* ------------------------------------------------------------------------ */

export { createCarShadow } from './shadow';
