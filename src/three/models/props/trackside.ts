/**
 * Trackside props that follow the circuit (barriers, ad boards) plus instanced
 * point props (lamp posts, marshal posts, TV towers, floodlight pylons).
 *
 * Polylines are world-space points along the track edge. `trackSide` tells on
 * which side of the travel direction the racing surface lies (default 'left'),
 * so barrier faces / boards look at the track.
 */
import * as THREE from 'three';
import type { ModelQuality } from '../types';
import {
  FACE,
  MeshBuilder,
  Rng,
  cachedGeometry,
  createHalos,
  finishInstanced,
  getVCMaterial,
  hashSeed,
  polylineFrames,
  qPick,
  resamplePolyline,
  type Glow,
  type UvRect,
} from './core';
import { BRAND_COUNT, BRAND_DARK_TILE, brandTileUV, getBrandAtlas, getGlowTexture, getTyreTexture, getWireFenceTexture } from './textures';

export type BarrierKind = 'armco' | 'concrete' | 'tecpro' | 'tyres' | 'fence';

export interface TracksideRunOptions {
  /** Side of the polyline (in travel direction) where the track is. Default 'left'. */
  trackSide?: 'left' | 'right';
  /** Treat the polyline as a closed loop. */
  closed?: boolean;
  /** Paint colours (tecpro blocks, tyre belts, concrete wall stripes). */
  colors?: string[];
  seed?: number;
}

interface ProfilePt {
  s: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* Sweep                                                               */
/* ------------------------------------------------------------------ */

interface SweepOpts {
  color: (seg: number, edge: number) => THREE.ColorRepresentation;
  glow?: (seg: number, edge: number) => Glow;
  uv?: (seg: number, edge: number, u0: number, u1: number) => UvRect;
  uScale?: number;
  caps?: boolean;
}

/**
 * Sweeps a 2D profile (s = lateral towards the track, h = up), listed
 * clockwise (back-bottom → back-top → front-top → front-bottom), along points.
 */
function sweep(
  b: MeshBuilder,
  pts: readonly THREE.Vector3[],
  lateral: readonly THREE.Vector3[],
  flip: boolean,
  profile: readonly ProfilePt[],
  o: SweepOpts,
): void {
  const up = new THREE.Vector3(0, 1, 0);
  const P = (i: number, k: number) =>
    pts[i]!.clone().addScaledVector(lateral[i]!, profile[k]!.s).addScaledVector(up, profile[k]!.h);
  let arc = 0;
  const uScale = o.uScale ?? 1;
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = pts[i]!.distanceTo(pts[i + 1]!);
    const u0 = arc / uScale;
    const u1 = (arc + segLen) / uScale;
    arc += segLen;
    for (let k = 0; k < profile.length - 1; k++) {
      const a = P(i, k);
      const bb = P(i + 1, k);
      const c = P(i + 1, k + 1);
      const d = P(i, k + 1);
      const col = o.color(i, k);
      const glow = o.glow?.(i, k) ?? [0, 0];
      const uv = o.uv?.(i, k, u0, u1);
      if (!flip) b.quad(a, bb, c, d, col, glow, uv);
      else b.quad(bb, a, d, c, col, glow, uv ? [uv[2], uv[1], uv[0], uv[3]] : undefined);
    }
  }
  if (o.caps && pts.length > 1) {
    // Fan-triangulated end caps (profiles are convex).
    for (const [i, dirSign] of [
      [0, -1],
      [pts.length - 1, 1],
    ] as const) {
      const tdir = new THREE.Vector3().subVectors(pts[Math.min(i + 1, pts.length - 1)]!, pts[Math.max(i - 1, 0)]!).setY(0).normalize();
      const want = tdir.multiplyScalar(dirSign);
      const p0 = P(i, 0);
      for (let k = 1; k < profile.length - 1; k++) {
        const p1 = P(i, k);
        const p2 = P(i, k + 1);
        const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
        const col = o.color(i === 0 ? 0 : pts.length - 2, 0);
        if (n.dot(want) >= 0) b.tri(p0, p1, p2, col, [0, 0], o.uv ? [0, 0, 0, 0, 0, 0] : undefined);
        else b.tri(p0, p2, p1, col, [0, 0], o.uv ? [0, 0, 0, 0, 0, 0] : undefined);
      }
    }
  }
}

function prepare(points: readonly THREE.Vector3[], spacing: number, opts: TracksideRunOptions) {
  const pts = resamplePolyline(points, spacing, !!opts.closed);
  const { t, n } = polylineFrames(pts);
  if (opts.closed && pts.length > 2) {
    // Smooth the seam frame.
    const tn = t[0]!.clone().add(t[t.length - 1]!).normalize();
    t[0]!.copy(tn);
    t[t.length - 1]!.copy(tn);
    n[0]!.set(tn.z, 0, -tn.x);
    n[n.length - 1]!.copy(n[0]!);
  }
  const right = opts.trackSide === 'right';
  const lateral = n.map((v) => (right ? v.clone().negate() : v));
  return { pts, t, lateral, flip: right };
}

/* ------------------------------------------------------------------ */
/* Barriers                                                            */
/* ------------------------------------------------------------------ */

const ARMCO_FRONT = '#c7ccd2';
const ARMCO_BACK = '#9aa1a8';

function wProfile(hc: number): ProfilePt[] {
  return [
    { s: 0, h: hc + 0.16 },
    { s: 0.07, h: hc + 0.11 },
    { s: 0.07, h: hc + 0.05 },
    { s: 0.025, h: hc },
    { s: 0.07, h: hc - 0.05 },
    { s: 0.07, h: hc - 0.11 },
    { s: 0, h: hc - 0.16 },
  ];
}

/**
 * One merged mesh per barrier run (fence: alpha-tested wire on posts).
 * Track-facing side is `opts.trackSide` (default left of travel direction).
 */
export function createBarrierRun(
  points: THREE.Vector3[],
  kind: BarrierKind,
  quality: ModelQuality,
  opts: TracksideRunOptions = {},
): THREE.Mesh {
  const rng = new Rng(opts.seed ?? hashSeed('barrier', kind, points.length, points[0]?.x ?? 0, points[0]?.z ?? 0));
  const yAxis = (t: THREE.Vector3) => Math.atan2(t.x, t.z);
  switch (kind) {
    case 'armco': {
      const { pts, t, lateral, flip } = prepare(points, qPick(quality, 4, 2.5, 2), opts);
      const b = new MeshBuilder();
      for (const hc of [0.78, 0.44]) {
        const prof = wProfile(hc);
        sweep(b, pts, lateral, flip, prof, { color: () => ARMCO_FRONT });
        const back = prof.map((p) => ({ s: p.s - 0.006, h: p.h })).reverse();
        sweep(b, pts, lateral, flip, back, { color: () => ARMCO_BACK });
      }
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!.clone().addScaledVector(lateral[i]!, -0.16);
        b.box(p.x, 0.48, p.z, 0.1, 0.96, 0.12, '#7d848b', { ry: yAxis(t[i]!), faces: FACE.NO_BOTTOM });
        if (quality !== 'low') {
          const sp = pts[i]!.clone().addScaledVector(lateral[i]!, -0.05);
          for (const hc of [0.78, 0.44]) b.box(sp.x, hc, sp.z, 0.08, 0.2, 0.1, '#6c7279', { ry: yAxis(t[i]!) + Math.PI / 2, faces: FACE.SIDES });
        }
      }
      return b.mesh(getVCMaterial(quality), 'barrier-armco');
    }
    case 'concrete': {
      const { pts, lateral, flip } = prepare(points, 4, opts);
      const b = new MeshBuilder();
      const prof: ProfilePt[] = [
        { s: -0.6, h: 0 },
        { s: -0.46, h: 0.3 },
        { s: -0.4, h: 1.05 },
        { s: -0.18, h: 1.05 },
        { s: -0.12, h: 0.3 },
        { s: 0, h: 0 },
      ];
      const shades = pts.map(() => 0.88 + rng.next() * 0.12);
      const paint = opts.colors;
      sweep(b, pts, lateral, flip, prof, {
        caps: !opts.closed,
        color: (i, k) => {
          const base = new THREE.Color('#dad8d2').multiplyScalar(shades[i]!);
          if (paint && paint.length && (k === 2 || k === 3)) return new THREE.Color(paint[i % paint.length]!).multiplyScalar(shades[i]!);
          if (k === 4) return base.multiplyScalar(0.7);
          return base;
        },
      });
      return b.mesh(getVCMaterial(quality), 'barrier-concrete');
    }
    case 'tecpro': {
      const { pts, lateral, flip } = prepare(points, 1.5, opts);
      const b = new MeshBuilder();
      const cols = opts.colors?.length ? opts.colors : ['#1d4ed8', '#dc2626'];
      const prof: ProfilePt[] = [
        { s: -1.0, h: 0 },
        { s: -1.0, h: 1.02 },
        { s: -0.9, h: 1.14 },
        { s: -0.1, h: 1.14 },
        { s: 0, h: 1.02 },
        { s: 0, h: 0 },
      ];
      sweep(b, pts, lateral, flip, prof, {
        caps: !opts.closed,
        color: (i, k) => {
          const c = new THREE.Color(cols[i % cols.length]!);
          return k === 2 ? c.multiplyScalar(1.1) : c;
        },
      });
      // White straps on the front faces.
      if (quality !== 'low') {
        for (let i = 0; i < pts.length - 1; i++) {
          const m = pts[i]!.clone().lerp(pts[i + 1]!, 0.5);
          const lat = lateral[i]!.clone().lerp(lateral[i + 1]!, 0.5).normalize();
          const p = m.clone().addScaledVector(lat, 0.005);
          const tt = new THREE.Vector3().subVectors(pts[i + 1]!, pts[i]!).normalize();
          b.box(p.x, 0.75, p.z, 0.02, 0.08, 1.2, '#f1f1f1', { ry: Math.atan2(tt.x, tt.z), faces: FACE.ALL & ~FACE.NY });
        }
      }
      return b.mesh(getVCMaterial(quality), 'barrier-tecpro');
    }
    case 'tyres': {
      const { pts, lateral, flip } = prepare(points, 2.4, opts);
      const b = new MeshBuilder({ uv: true });
      const cols = opts.colors?.length ? opts.colors : ['#dc2626', '#f2f2f2'];
      const prof: ProfilePt[] = [
        { s: -1.0, h: 0 },
        { s: -1.0, h: 0.98 },
        { s: 0, h: 0.98 },
        { s: 0, h: 0 },
      ];
      sweep(b, pts, lateral, flip, prof, {
        caps: !opts.closed,
        uScale: 1,
        color: (i, k) => (k === 2 ? cols[i % cols.length]! : '#ffffff'),
        uv: (_i, k, u0, u1) => (k === 2 ? [u0, 0.56, u1, 0.94] : [u0, 0.02, u1, 0.48]),
      });
      return b.mesh(getVCMaterial(quality, { map: getTyreTexture() }), 'barrier-tyres');
    }
    case 'fence': {
      const { pts, t, lateral, flip } = prepare(points, 4, opts);
      const b = new MeshBuilder({ uv: true });
      const main: ProfilePt[] = [
        { s: 0, h: 0.15 },
        { s: 0, h: 3.8 },
        { s: 0.55, h: 4.4 },
      ];
      sweep(b, pts, lateral, flip, main, {
        color: () => '#ffffff',
        uv: (_i, k, u0, u1) => (k === 0 ? [u0, 0.0, u1, 0.62] : [u0, 0.62, u1, 0.745]),
      });
      const solid: UvRect = [0.1, 0.8, 0.9, 0.98];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!.clone().addScaledVector(lateral[i]!, -0.06);
        const ry = Math.atan2(t[i]!.x, t[i]!.z);
        b.box(p.x, 1.95, p.z, 0.1, 3.9, 0.1, '#ffffff', { ry, uv: solid, faces: FACE.SIDES | FACE.PY });
        const top0 = pts[i]!.clone().addScaledVector(lateral[i]!, -0.04).setY(3.8);
        const top1 = pts[i]!.clone().addScaledVector(lateral[i]!, 0.55).setY(4.42);
        b.beam(top0, top1, 0.08, 0.08, '#ffffff', { uv: solid });
      }
      return b.mesh(
        getVCMaterial(quality, { map: getWireFenceTexture(), alphaTest: 0.45, side: THREE.DoubleSide }),
        'barrier-fence',
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Advertising boards                                                  */
/* ------------------------------------------------------------------ */

class PolylineSampler {
  readonly cum: number[] = [0];
  constructor(readonly pts: readonly THREE.Vector3[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + pts[i - 1]!.distanceTo(pts[i]!));
  }
  get length(): number {
    return this.cum[this.cum.length - 1]!;
  }
  at(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.cum;
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const seg = c[hi]! - c[lo]! || 1;
    return out.lerpVectors(this.pts[lo]!, this.pts[hi]!, THREE.MathUtils.clamp((s - c[lo]!) / seg, 0, 1));
  }
}

export interface AdBoardOptions extends TracksideRunOptions {
  /** Board height (default 1.0 m). */
  height?: number;
  /** Bottom edge height above ground (default 0.05 m; set ~1.1 to sit on a wall). */
  elevation?: number;
  /** Board length (default 4 m — matches the 4:1 brand tiles). */
  boardLength?: number;
  gap?: number;
  /** Lateral offset from the polyline towards the track (default 0). */
  offset?: number;
}

/** LED/printed perimeter boards with invented brands (single draw call, glows at night). */
export function createAdBoards(points: THREE.Vector3[], quality: ModelQuality, opts: AdBoardOptions = {}): THREE.Mesh {
  const h = opts.height ?? 1.0;
  const bl = opts.boardLength ?? h * 4;
  const gap = opts.gap ?? 0.12;
  const y0 = opts.elevation ?? 0.05;
  const rng = new Rng(opts.seed ?? hashSeed('ads', points.length, points[0]?.x ?? 0));
  const src = opts.closed ? [...points, points[0]!] : points;
  const sampler = new PolylineSampler(src);
  const b = new MeshBuilder({ uv: true });
  const dark = brandTileUV(BRAND_DARK_TILE);
  const side = opts.trackSide === 'right' ? -1 : 1;
  const th = 0.08;
  let prev = -1;
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  for (let s = 0; s + bl <= sampler.length + 1e-3; s += bl + gap) {
    sampler.at(s, p0);
    sampler.at(s + bl, p1);
    const dir = new THREE.Vector3().subVectors(p1, p0).setY(0);
    const len = dir.length();
    if (len < 0.5) continue;
    dir.normalize();
    const left = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(side);
    const off = opts.offset ?? 0;
    const mid = p0.clone().add(p1).multiplyScalar(0.5).addScaledVector(left, off);
    let brand = rng.int(0, BRAND_COUNT - 1);
    if (brand === prev) brand = (brand + 1) % BRAND_COUNT;
    prev = brand;
    // Box basis: X = along, Z = towards track.
    const ry = Math.atan2(left.x, left.z);
    const front = brandTileUV(brand);
    b.box(mid.x, y0 + h / 2, mid.z, len, h, th, '#ffffff', {
      ry,
      uvFace: (f) => (f === FACE.PZ ? front : dark),
      glowFace: (f) => (f === FACE.PZ ? ([0.14, 0.9] as const) : ([0, 0] as const)),
      faces: FACE.ALL & ~FACE.NY,
    });
    if (quality !== 'low') {
      for (const k of [-0.42, 0.42]) {
        const lp = mid.clone().addScaledVector(dir, k * len).addScaledVector(left, -0.25);
        b.box(lp.x, (y0 + h * 0.5) / 2, lp.z, 0.06, y0 + h * 0.5, 0.5, '#ffffff', { ry, uv: dark, faces: FACE.SIDES });
      }
    }
  }
  return b.mesh(getVCMaterial(quality, { map: getBrandAtlas() }), 'ad-boards');
}

/* ------------------------------------------------------------------ */
/* Instanced point props                                               */
/* ------------------------------------------------------------------ */

function facingAt(facing: readonly number[] | number, i: number): number {
  return typeof facing === 'number' ? facing : facing[i] ?? 0;
}

function instanced(
  geo: THREE.BufferGeometry,
  quality: ModelQuality,
  positions: readonly THREE.Vector3[],
  facing: readonly number[] | number,
  name: string,
  scaleFn?: (i: number) => number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, getVCMaterial(quality), Math.max(1, positions.length));
  mesh.count = positions.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  positions.forEach((p, i) => {
    q.setFromAxisAngle(up, facingAt(facing, i));
    const k = scaleFn ? scaleFn(i) : 1;
    m.compose(p, q, s.set(k, k, k));
    mesh.setMatrixAt(i, m);
  });
  mesh.name = name;
  return finishInstanced(mesh);
}

/** World positions of a local point for every instance (for halos). */
function localPoints(positions: readonly THREE.Vector3[], facing: readonly number[] | number, local: readonly THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  positions.forEach((p, i) => {
    const a = facingAt(facing, i);
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const l of local) out.push(new THREE.Vector3(p.x + l.x * c + l.z * s, p.y + l.y, p.z - l.x * s + l.z * c));
  });
  return out;
}

export interface LampPostOptions {
  height?: number;
  /** Two arms (central reservation style). */
  double?: boolean;
  /** Night halos (default true on medium/high). */
  halos?: boolean;
}

/**
 * Street lamp posts; the arm reaches along local +Z rotated by `facing`
 * (radians around Y) — point it at the track. Lenses glow at night.
 */
export function createLampPosts(
  positions: THREE.Vector3[],
  facing: number[] | number,
  quality: ModelQuality,
  opts: LampPostOptions = {},
): THREE.Group {
  const H = opts.height ?? 10;
  const dbl = !!opts.double;
  const geo = cachedGeometry(`lamp|${quality}|${H}|${dbl}`, () => {
    const b = new MeshBuilder();
    const seg = qPick(quality, 5, 6, 8);
    b.box(0, 0.3, 0, 0.45, 0.6, 0.45, '#5b6168', { faces: FACE.NO_BOTTOM });
    b.prim(new THREE.CylinderGeometry(0.08, 0.13, H, seg, 1, true), { x: 0, y: H / 2, z: 0 }, '#6b7178');
    for (const dz of dbl ? [1, -1] : [1]) {
      b.beam(new THREE.Vector3(0, H - 0.6, 0), new THREE.Vector3(0, H, dz * 1.2), 0.08, 0.08, '#6b7178');
      b.beam(new THREE.Vector3(0, H, dz * 1.2), new THREE.Vector3(0, H + 0.05, dz * 2.0), 0.08, 0.08, '#6b7178');
      b.box(0, H + 0.02, dz * 2.35, 0.42, 0.16, 0.85, '#3b4046');
      b.box(0, H - 0.07, dz * 2.35, 0.32, 0.02, 0.7, '#fff1d6', { glow: [0.05, 3.2], faces: FACE.NY });
    }
    return b.build();
  });
  const group = new THREE.Group();
  group.name = 'lamp-posts';
  group.add(instanced(geo, quality, positions, facing, 'lamp-post-mesh'));
  if ((opts.halos ?? quality !== 'low') && positions.length) {
    const local = (dbl ? [1, -1] : [1]).map((dz) => new THREE.Vector3(0, H - 0.2, dz * 2.35));
    group.add(createHalos(localPoints(positions, facing, local), 4.5, '#ffd9a8', true, getGlowTexture()));
  }
  return group;
}

/** Marshal posts (hut, light panel, marshal in orange with a yellow flag). Facing = towards the track (+Z local). */
export function createMarshalPosts(positions: THREE.Vector3[], facing: number[] | number, quality: ModelQuality): THREE.Group {
  const geo = cachedGeometry(`marshal|${quality}`, () => {
    const b = new MeshBuilder();
    b.box(0, 0.08, 0, 3.2, 0.16, 2.6, '#9ea3a8', { faces: FACE.NO_BOTTOM });
    b.box(-0.4, 1.31, -0.3, 2.0, 2.3, 1.6, '#f4f5f6', { faces: FACE.NO_BOTTOM });
    b.box(-0.4, 1.9, -0.3, 2.02, 0.28, 1.62, '#f97316', { faces: FACE.SIDES });
    b.box(-0.4, 2.52, -0.2, 2.5, 0.12, 2.0, '#d4d7da');
    b.box(-0.4, 1.4, 0.505, 1.4, 0.7, 0.02, '#1b2530', { faces: FACE.PZ, glow: [0, 0.4] });
    // Light panel on a post
    b.box(0.95, 1.5, 0.6, 0.1, 3.0, 0.1, '#50565c', { faces: FACE.SIDES });
    b.box(0.95, 3.05, 0.6, 1.0, 0.7, 0.14, '#111');
    b.box(0.95, 3.05, 0.68, 0.84, 0.54, 0.02, '#22c55e', { faces: FACE.PZ, glow: [0.7, 1.5] });
    if (quality !== 'low') {
      // Marshal
      b.box(0.9, 0.45, 1.0, 0.32, 0.9, 0.2, '#f97316', { faces: FACE.SIDES });
      b.box(0.9, 1.15, 1.0, 0.42, 0.55, 0.24, '#f97316', { faces: FACE.NO_BOTTOM });
      b.box(0.9, 1.55, 1.0, 0.2, 0.24, 0.2, '#e0ac85', { faces: FACE.NO_BOTTOM });
      b.box(1.15, 1.0, 1.05, 0.04, 1.3, 0.04, '#333', { faces: FACE.SIDES });
      b.box(1.45, 1.45, 1.05, 0.56, 0.4, 0.01, '#ffd400');
      // Extinguisher
      b.prim(new THREE.CylinderGeometry(0.1, 0.1, 0.55, 6), { x: -1.3, y: 0.45, z: 0.8 }, '#d32f2f');
    }
    return b.build();
  });
  const group = new THREE.Group();
  group.name = 'marshal-posts';
  group.add(instanced(geo, quality, positions, facing, 'marshal-mesh'));
  return group;
}

/** Scaffold TV camera towers with operator and umbrella; camera looks along local +Z. */
export function createTvTowers(
  positions: THREE.Vector3[],
  facing: number[] | number,
  quality: ModelQuality,
  opts: { height?: number } = {},
): THREE.Group {
  const H = opts.height ?? 6;
  const geo = cachedGeometry(`tvtower|${quality}|${H}`, () => {
    const b = new MeshBuilder();
    const steel = '#8a9097';
    const w = 1.0;
    const legs = [
      [-w, -w],
      [w, -w],
      [w, w],
      [-w, w],
    ] as const;
    for (const [x, z] of legs) b.box(x, H / 2, z, 0.08, H, 0.08, steel, { faces: FACE.SIDES });
    const levels = Math.max(1, Math.round(H / qPick(quality, 3, 2, 1.5)));
    for (let l = 0; l < levels; l++) {
      const ya = (l / levels) * H;
      const yb = ((l + 1) / levels) * H;
      for (let k = 0; k < 4; k++) {
        const [x0, z0] = legs[k]!;
        const [x1, z1] = legs[(k + 1) % 4]!;
        b.beam(new THREE.Vector3(x0, l % 2 ? ya : yb, z0), new THREE.Vector3(x1, l % 2 ? yb : ya, z1), 0.05, 0.05, steel);
        b.beam(new THREE.Vector3(x0, yb, z0), new THREE.Vector3(x1, yb, z1), 0.05, 0.05, steel);
      }
    }
    b.box(0, H + 0.05, 0, 2.4, 0.1, 2.4, '#4a4f55');
    for (const [x, z] of legs) b.box(x * 1.15, H + 0.55, z * 1.15, 0.05, 1.0, 0.05, '#c9a400', { faces: FACE.SIDES });
    b.box(0, H + 1.05, -1.15, 2.3, 0.05, 0.05, '#c9a400');
    b.box(-1.15, H + 1.05, 0, 0.05, 0.05, 2.3, '#c9a400');
    b.box(1.15, H + 1.05, 0, 0.05, 0.05, 2.3, '#c9a400');
    // Camera on tripod
    b.box(0, H + 0.75, 0.3, 0.12, 1.3, 0.12, '#222', { faces: FACE.SIDES });
    b.box(0, H + 1.5, 0.35, 0.42, 0.36, 0.8, '#1b1d20');
    b.prim(new THREE.CylinderGeometry(0.13, 0.15, 0.6, 8, 1), { x: 0, y: H + 1.5, z: 0.95 }, '#0e0f10', { rot: new THREE.Euler(Math.PI / 2, 0, 0) });
    // Operator
    b.box(0, H + 0.55, -0.35, 0.34, 0.9, 0.22, '#1f2a44', { faces: FACE.SIDES });
    b.box(0, H + 1.25, -0.35, 0.44, 0.55, 0.26, '#1f2a44', { faces: FACE.NO_BOTTOM });
    b.box(0, H + 1.65, -0.35, 0.2, 0.24, 0.2, '#e0ac85', { faces: FACE.NO_BOTTOM });
    // Umbrella
    b.box(0.6, H + 1.4, -0.6, 0.04, 2.6, 0.04, '#333', { faces: FACE.SIDES });
    b.prim(new THREE.ConeGeometry(1.5, 0.6, qPick(quality, 6, 8, 10), 1, true), { x: 0.6, y: H + 2.75, z: -0.6 }, '#f4f4f4');
    return b.build();
  });
  const group = new THREE.Group();
  group.name = 'tv-towers';
  group.add(instanced(geo, quality, positions, facing, 'tv-tower-mesh'));
  return group;
}

/**
 * Night-race floodlight pylons (lattice mast + light bank) — Bahrain, Qatar,
 * Singapore, Las Vegas. The light bank faces local +Z tilted down.
 */
export function createLightTowers(
  positions: THREE.Vector3[],
  facing: number[] | number,
  quality: ModelQuality,
  opts: { height?: number; halos?: boolean } = {},
): THREE.Group {
  const H = opts.height ?? 38;
  const geo = cachedGeometry(`lighttower|${quality}|${H}`, () => {
    const b = new MeshBuilder();
    const steel = '#9aa1a8';
    const wb = 1.5;
    const wt = 0.6;
    const corner = (k: number, y: number) => {
      const w = THREE.MathUtils.lerp(wb, wt, y / H);
      const sx = k === 0 || k === 3 ? -1 : 1;
      const sz = k < 2 ? -1 : 1;
      return new THREE.Vector3(sx * w, y, sz * w);
    };
    for (let k = 0; k < 4; k++) b.beam(corner(k, 0), corner(k, H), 0.16, 0.16, steel);
    const step = qPick(quality, 8, 5, 3.5);
    const levels = Math.max(2, Math.round(H / step));
    for (let l = 0; l < levels; l++) {
      const ya = (l / levels) * H;
      const yb = ((l + 1) / levels) * H;
      for (let k = 0; k < 4; k++) {
        b.beam(corner(k, ya), corner((k + 1) % 4, yb), 0.07, 0.07, steel);
        if (quality === 'high') b.beam(corner((k + 1) % 4, ya), corner(k, yb), 0.07, 0.07, steel);
        b.beam(corner(k, yb), corner((k + 1) % 4, yb), 0.07, 0.07, steel);
      }
    }
    // Head frame + flood bank tilted down towards +Z.
    b.box(0, H + 0.1, 0, 2.6, 0.2, 2.6, '#6b7178');
    const tilt = 0.42;
    const rows = qPick(quality, 3, 4, 4);
    const cols = qPick(quality, 4, 6, 6);
    const bankW = 7.2;
    const bankH = 4.2;
    const centre = new THREE.Vector3(0, H + 2.4, 1.0);
    const m = new THREE.Matrix4().makeRotationX(tilt).setPosition(centre);
    const panel = new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeScale(bankW + 0.4, bankH + 0.4, 0.25));
    b.boxM(panel, '#2b2f34');
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lx = (c - (cols - 1) / 2) * (bankW / cols);
        const ly = (r - (rows - 1) / 2) * (bankH / rows);
        const lm = new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(lx, ly, 0.3));
        b.boxM(new THREE.Matrix4().multiplyMatrices(lm, new THREE.Matrix4().makeScale(0.95, 0.8, 0.45)), '#3a3f45', {
          faces: FACE.ALL & ~FACE.PZ,
        });
        b.boxM(new THREE.Matrix4().multiplyMatrices(lm, new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0.23), new THREE.Quaternion(), new THREE.Vector3(0.8, 0.65, 0.01))), '#f4f7ff', {
          faces: FACE.PZ,
          glow: [0.08, 3.4],
        });
      }
    }
    // Support struts from mast to bank.
    b.beam(new THREE.Vector3(-0.6, H + 0.2, 0.6), centre.clone().add(new THREE.Vector3(-2.5, -1.2, -0.3)), 0.12, 0.12, steel);
    b.beam(new THREE.Vector3(0.6, H + 0.2, 0.6), centre.clone().add(new THREE.Vector3(2.5, -1.2, -0.3)), 0.12, 0.12, steel);
    // Aviation light
    b.box(0, H + 4.9, 0.6, 0.4, 0.4, 0.4, '#ff2a1a', { glow: [0.5, 3] });
    return b.build();
  });
  const group = new THREE.Group();
  group.name = 'light-towers';
  group.add(instanced(geo, quality, positions, facing, 'light-tower-mesh'));
  if ((opts.halos ?? quality !== 'low') && positions.length) {
    const local = [new THREE.Vector3(0, H + 2.4, 1.6)];
    group.add(createHalos(localPoints(positions, facing, local), 18, '#dfe8ff', true, getGlowTexture()));
  }
  return group;
}
