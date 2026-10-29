/**
 * Procedural geometry toolkit for the car models: parametric lofts with
 * per-face slot classification, aerofoil elements, lathes, plates, rods and
 * the merge/skin helpers used to collapse a car into a handful of draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export type V3 = readonly [number, number, number];
export type UVRectLike = readonly [number, number, number, number];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

/* ------------------------------------------------------------------------ */
/* Mesh builder                                                             */
/* ------------------------------------------------------------------------ */

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];

  get count(): number {
    return this.pos.length / 3;
  }

  vert(p: THREE.Vector3 | V3, n: THREE.Vector3 | V3 = [0, 1, 0], u = 0, v = 0): number {
    const P = Array.isArray(p) ? p : [(p as THREE.Vector3).x, (p as THREE.Vector3).y, (p as THREE.Vector3).z];
    const N = Array.isArray(n) ? n : [(n as THREE.Vector3).x, (n as THREE.Vector3).y, (n as THREE.Vector3).z];
    this.pos.push(P[0], P[1], P[2]);
    this.nor.push(N[0], N[1], N[2]);
    this.uv.push(u, v);
    return this.count - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  build(computeNormals = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    if (computeNormals) g.computeVertexNormals();
    return g;
  }
}

/* ------------------------------------------------------------------------ */
/* Loft: superellipse cross-sections interpolated along Z                   */
/* ------------------------------------------------------------------------ */

export interface Section {
  z: number;
  /** Section centre X. */
  cx?: number;
  /** Half width at the widest line. */
  w: number;
  yb: number;
  yt: number;
  /** Height of the widest line as a fraction of (yt - yb). */
  ym?: number;
  /** Width multiplier at the very top / bottom (tumblehome, undercut). */
  tt?: number;
  tb?: number;
  /** Superellipse exponents for the upper / lower half (2 = ellipse, higher = boxier). */
  nt?: number;
  nb?: number;
}

export interface SectionParams {
  cx: number;
  w: number;
  yb: number;
  yt: number;
  ym: number;
  tt: number;
  tb: number;
  nt: number;
  nb: number;
}

type ParamKey = keyof SectionParams;
const PARAM_KEYS: ParamKey[] = ['cx', 'w', 'yb', 'yt', 'ym', 'tt', 'tb', 'nt', 'nb'];
const PARAM_DEFAULTS: SectionParams = { cx: 0, w: 0, yb: 0, yt: 0, ym: 0.5, tt: 1, tb: 1, nt: 2, nb: 2 };

/** Fritsch–Carlson monotone cubic: smooth without overshoot (no negative widths at tips). */
export function monotoneSpline(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  const m: number[] = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[k] = t * a * d[k];
      m[k + 1] = t * b * d[k];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[k] +
      (t3 - 2 * t2 + t) * h * m[k] +
      (-2 * t3 + 3 * t2) * ys[k + 1] +
      (t3 - t2) * h * m[k + 1]
    );
  };
}

function spow(v: number, e: number): number {
  return Math.sign(v) * Math.pow(Math.abs(v), e);
}

/**
 * θ = 0 is the +X side at the widest line, π/2 the top, π the −X side,
 * 3π/2 the bottom.
 */
export function sectionPoint(p: SectionParams, z: number, th: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const ymid = p.yb + (p.yt - p.yb) * p.ym;
  let x: number;
  let y: number;
  if (s >= 0) {
    const e = 2 / p.nt;
    const py = Math.pow(s, e);
    y = ymid + (p.yt - ymid) * py;
    x = spow(c, e) * p.w * (1 + (p.tt - 1) * py);
  } else {
    const e = 2 / p.nb;
    const py = Math.pow(-s, e);
    y = ymid - (ymid - p.yb) * py;
    x = spow(c, e) * p.w * (1 + (p.tb - 1) * py);
  }
  return out.set(p.cx + x, y, z);
}

export interface Cap {
  slot: string;
  /** Push the cap centre along the axis (negative = recessed, e.g. an inlet mouth). */
  dome?: number;
  /** Planar-map the cap (x/y bounds) into this UV rect, e.g. a grille texture. */
  planarUV?: UVRectLike;
}

export interface LoftBuildOptions {
  cols: number;
  ringsPerMetre: number;
  thetaBreaks?: number[];
  zBreaks?: number[];
  /** Face classifier → slot name; null drops the face (cut-outs). */
  slotOf?: (z: number, theta: number) => string | null;
  capStart?: Cap | null;
  capEnd?: Cap | null;
  /** Sample rings uniformly over the length instead of at every knot (cheap LODs). */
  uniformRings?: boolean;
}

export type SlotGeometries = Map<string, THREE.BufferGeometry>;

export class Loft {
  readonly zMin: number;
  readonly zMax: number;
  readonly knots: number[];
  private readonly fns: Record<ParamKey, (z: number) => number>;
  private readonly tmp = new SectionParamsBox();

  constructor(sections: Section[], overrides: Partial<Record<ParamKey, (z: number) => number>> = {}) {
    const sorted = [...sections].sort((a, b) => a.z - b.z);
    this.knots = sorted.map((s) => s.z);
    this.zMin = this.knots[0];
    this.zMax = this.knots[this.knots.length - 1];
    const fns = {} as Record<ParamKey, (z: number) => number>;
    for (const key of PARAM_KEYS) {
      const o = overrides[key];
      if (o) {
        fns[key] = o;
        continue;
      }
      // Inherit missing values from the previous section (or the default).
      let last = PARAM_DEFAULTS[key];
      const ys = sorted.map((s) => {
        const v = s[key as keyof Section];
        if (typeof v === 'number') last = v;
        return last;
      });
      fns[key] = monotoneSpline(this.knots, ys);
    }
    this.fns = fns;
  }

  params(z: number, out: SectionParams = this.tmp): SectionParams {
    for (const key of PARAM_KEYS) out[key] = this.fns[key](z);
    out.w = Math.max(out.w, 1e-4);
    return out;
  }

  point(z: number, th: number, out = new THREE.Vector3()): THREE.Vector3 {
    return sectionPoint(this.params(z), z, th, out);
  }

  /** Outward surface normal by central differences. */
  normal(z: number, th: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 1e-3;
    const za = Math.max(this.zMin, z - e);
    const zb = Math.min(this.zMax, z + e);
    this.point(z, th - e, _a);
    this.point(z, th + e, _b);
    this.point(za, th, _c);
    this.point(zb, th, _d);
    _b.sub(_a);
    _d.sub(_c);
    out.crossVectors(_b, _d);
    if (out.lengthSq() < 1e-14) return out.set(0, 1, 0);
    return out.normalize();
  }

  ringZs(o: LoftBuildOptions): number[] {
    const zs: number[] = [];
    if (o.uniformRings) {
      const n = Math.max(2, Math.ceil((this.zMax - this.zMin) * o.ringsPerMetre));
      for (let i = 0; i < n; i++) zs.push(this.zMin + ((this.zMax - this.zMin) * i) / n);
    } else for (let k = 0; k < this.knots.length - 1; k++) {
      const a = this.knots[k];
      const b = this.knots[k + 1];
      const n = Math.max(1, Math.round((b - a) * o.ringsPerMetre));
      for (let i = 0; i < n; i++) zs.push(a + ((b - a) * i) / n);
    }
    zs.push(this.zMax);
    for (const z of o.zBreaks ?? []) if (z > this.zMin && z < this.zMax) zs.push(z);
    zs.sort((a, b) => a - b);
    return dedupe(zs, 1e-4);
  }

  build(o: LoftBuildOptions): SlotGeometries {
    const ths: number[] = [];
    for (let j = 0; j < o.cols; j++) ths.push((j / o.cols) * TAU);
    for (const b of o.thetaBreaks ?? []) ths.push(((b % TAU) + TAU) % TAU);
    ths.sort((a, b) => a - b);
    let thetas = dedupe(ths, 2e-3);
    if (thetas.length > 1 && TAU - thetas[thetas.length - 1] < 2e-3) thetas = thetas.slice(0, -1);
    const zs = this.ringZs(o);
    const R = zs.length;
    const C = thetas.length;

    const pos = new Float32Array(R * C * 3);
    const uv = new Float32Array(R * C * 2);
    const p = new THREE.Vector3();
    for (let i = 0; i < R; i++) {
      const prm = this.params(zs[i]);
      for (let j = 0; j < C; j++) {
        sectionPoint(prm, zs[i], thetas[j], p);
        const k = i * C + j;
        pos[k * 3] = p.x;
        pos[k * 3 + 1] = p.y;
        pos[k * 3 + 2] = p.z;
        uv[k * 2] = thetas[j] / TAU;
        uv[k * 2 + 1] = (zs[i] - this.zMin) / (this.zMax - this.zMin);
      }
    }

    const tris: number[] = [];
    const triSlots: string[] = [];
    for (let i = 0; i < R - 1; i++) {
      const zMid = (zs[i] + zs[i + 1]) / 2;
      for (let j = 0; j < C; j++) {
        const j1 = (j + 1) % C;
        const thMid = (thetas[j] + (j1 === 0 ? TAU : thetas[j1])) / 2;
        const slot = o.slotOf ? o.slotOf(zMid, thMid) : 'body';
        if (slot === null) continue;
        const a = i * C + j;
        const b = (i + 1) * C + j;
        const c = i * C + j1;
        const d = (i + 1) * C + j1;
        tris.push(a, c, b, c, d, b);
        triSlots.push(slot, slot);
      }
    }

    const full = new THREE.BufferGeometry();
    full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    full.setIndex(tris);
    full.computeVertexNormals();
    const nor = full.getAttribute('normal').array as Float32Array;
    const out = splitBySlot(pos, nor, uv, tris, triSlots);

    const addCap = (cap: Cap | null | undefined, ring: number, dir: 1 | -1) => {
      if (!cap) return;
      const mb = new MeshBuilder();
      const z = zs[ring];
      const centre = new THREE.Vector3();
      for (let j = 0; j < C; j++) {
        const k = (ring * C + j) * 3;
        centre.x += pos[k];
        centre.y += pos[k + 1];
      }
      centre.set(centre.x / C, centre.y / C, z + dir * (cap.dome ?? 0));
      const ci = mb.vert(centre, [0, 0, dir], 0.5, 0.5);
      for (let j = 0; j < C; j++) {
        const k = (ring * C + j) * 3;
        mb.vert([pos[k], pos[k + 1], pos[k + 2]], [0, 0, dir], thetas[j] / TAU, 0);
      }
      for (let j = 0; j < C; j++) {
        const a = ci + 1 + j;
        const b = ci + 1 + ((j + 1) % C);
        if (dir > 0) mb.tri(ci, a, b);
        else mb.tri(ci, b, a);
      }
      const g = mb.build(Math.abs(cap.dome ?? 0) > 1e-4);
      if (cap.planarUV) {
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        const r = cap.planarUV;
        const P = g.getAttribute('position');
        const U = g.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < P.count; i++) {
          const u = (P.getX(i) - bb.min.x) / Math.max(1e-6, bb.max.x - bb.min.x);
          const v = (P.getY(i) - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y);
          // Seen from −Z (tail cap) the image would be mirrored.
          U.setXY(i, lerp(r[0], r[2], dir > 0 ? u : 1 - u), lerp(r[1], r[3], v));
        }
      }
      appendSlot(out, cap.slot, g);
    };
    addCap(o.capStart, 0, -1);
    addCap(o.capEnd, R - 1, 1);
    return out;
  }

  /**
   * Conforming patch over the surface (decals, overlays). `fn(s, t)` maps the
   * unit square to (z, θ); UVs go from (u0, v0) at s=t=0 to (u1, v1).
   */
  patch(
    fn: (s: number, t: number) => [number, number],
    segS: number,
    segT: number,
    offset: number,
    uvRect: UVRectLike = [0, 0, 1, 1],
  ): THREE.BufferGeometry {
    const mb = new MeshBuilder();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let t = 0; t <= segT; t++) {
      for (let s = 0; s <= segS; s++) {
        const [z, th] = fn(s / segS, t / segT);
        const zc = Math.min(this.zMax, Math.max(this.zMin, z));
        this.point(zc, th, p);
        this.normal(zc, th, n);
        p.addScaledVector(n, offset);
        mb.vert(p, n, lerp(uvRect[0], uvRect[2], s / segS), lerp(uvRect[1], uvRect[3], t / segT));
      }
    }
    orientGrid(mb, segS, segT);
    return mb.build();
  }
}

class SectionParamsBox implements SectionParams {
  cx = 0;
  w = 0;
  yb = 0;
  yt = 0;
  ym = 0.5;
  tt = 1;
  tb = 1;
  nt = 2;
  nb = 2;
}

/** Adds quads over a (segS+1)×(segT+1) vertex grid, wound to agree with the vertex normals. */
function orientGrid(mb: MeshBuilder, segS: number, segT: number): void {
  const W = segS + 1;
  const P = mb.pos;
  const N = mb.nor;
  for (let t = 0; t < segT; t++) {
    for (let s = 0; s < segS; s++) {
      const a = t * W + s;
      const b = a + 1;
      const d = a + W;
      const c = d + 1;
      _a.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
      _b.set(P[d * 3] - P[b * 3], P[d * 3 + 1] - P[b * 3 + 1], P[d * 3 + 2] - P[b * 3 + 2]);
      _c.crossVectors(_a, _b);
      const nx = N[a * 3] + N[c * 3];
      const ny = N[a * 3 + 1] + N[c * 3 + 1];
      const nz = N[a * 3 + 2] + N[c * 3 + 2];
      if (_c.x * nx + _c.y * ny + _c.z * nz >= 0) {
        mb.tri(a, b, c);
        mb.tri(a, c, d);
      } else {
        mb.tri(a, c, b);
        mb.tri(a, d, c);
      }
    }
  }
}

function dedupe(sorted: number[], eps: number): number[] {
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || v - out[out.length - 1] > eps) out.push(v);
  return out;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function splitBySlot(
  pos: Float32Array,
  nor: Float32Array,
  uv: Float32Array,
  tris: number[],
  triSlots: string[],
): SlotGeometries {
  const out: SlotGeometries = new Map();
  const bySlot = new Map<string, number[]>();
  for (let t = 0; t < triSlots.length; t++) {
    let list = bySlot.get(triSlots[t]);
    if (!list) bySlot.set(triSlots[t], (list = []));
    list.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  }
  for (const [slot, list] of bySlot) {
    const remap = new Map<number, number>();
    const P: number[] = [];
    const Nn: number[] = [];
    const U: number[] = [];
    const I: number[] = [];
    for (const v of list) {
      let ni = remap.get(v);
      if (ni === undefined) {
        ni = remap.size;
        remap.set(v, ni);
        P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        Nn.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
        U.push(uv[v * 2], uv[v * 2 + 1]);
      }
      I.push(ni);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    out.set(slot, g);
  }
  return out;
}

function appendSlot(map: SlotGeometries, slot: string, g: THREE.BufferGeometry): void {
  const prev = map.get(slot);
  if (!prev) {
    map.set(slot, g);
    return;
  }
  const merged = mergeGeometries([normalizeAttrs(prev), normalizeAttrs(g)], false);
  map.set(slot, merged ?? prev);
}

/* ------------------------------------------------------------------------ */
/* Aerofoil wing elements                                                   */
/* ------------------------------------------------------------------------ */

export interface WingStation {
  x: number;
  /** Leading edge position. */
  z: number;
  y: number;
  chord: number;
  /** Degrees, positive = trailing edge up (more downforce). */
  angle: number;
  thick?: number;
  camber?: number;
}

function nacaHalf(c: number): number {
  return 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
}

/** Sweeps a cambered aerofoil through stations (ascending x). Chord runs towards −Z. */
export function wingElement(stations: WingStation[], ptsPerSide: number, capEnds = true): THREE.BufferGeometry {
  const N = Math.max(2, ptsPerSide);
  const cs: number[] = [];
  for (let k = 0; k <= N; k++) cs.push(0.5 * (1 - Math.cos((Math.PI * k) / N)));
  // Loop: upper TE→LE, then lower LE→TE (exclusive of LE).
  const loop: Array<[number, 1 | -1]> = [];
  for (let k = N; k >= 0; k--) loop.push([cs[k], 1]);
  for (let k = 1; k <= N; k++) loop.push([cs[k], -1]);
  const P = loop.length;
  const mb = new MeshBuilder();
  const centres: THREE.Vector3[] = [];
  for (const st of stations) {
    const a = THREE.MathUtils.degToRad(st.angle);
    const dz = -Math.cos(a);
    const dy = Math.sin(a);
    const uz = Math.sin(a);
    const uy = Math.cos(a);
    const t = st.thick ?? 0.1;
    const cam = st.camber ?? 0.04;
    const centre = new THREE.Vector3();
    for (const [c, side] of loop) {
      const h = cam * 4 * c * (1 - c) + side * t * nacaHalf(c);
      const y = st.y + dy * c * st.chord + uy * h * st.chord;
      const z = st.z + dz * c * st.chord + uz * h * st.chord;
      mb.vert([st.x, y, z]);
      centre.x += st.x;
      centre.y += y;
      centre.z += z;
    }
    centres.push(centre.divideScalar(P));
  }
  for (let k = 0; k < stations.length - 1; k++) {
    for (let p = 0; p < P; p++) {
      const p1 = (p + 1) % P;
      const a = k * P + p;
      const b = k * P + p1;
      const c = (k + 1) * P + p;
      const d = (k + 1) * P + p1;
      mb.tri(a, b, c);
      mb.tri(b, d, c);
    }
  }
  if (capEnds) {
    for (const [k, dir] of [
      [0, -1],
      [stations.length - 1, 1],
    ] as const) {
      const ci = mb.vert(centres[k]);
      for (let p = 0; p < P; p++) {
        const a = k * P + p;
        const b = k * P + ((p + 1) % P);
        if (dir > 0) mb.tri(ci, a, b);
        else mb.tri(ci, b, a);
      }
    }
  }
  return mb.build(true);
}

/** Symmetric span stations from a half-span table (|x| ascending), mirrored about x = 0. */
export function mirrorStations(half: WingStation[], minX = 0): WingStation[] {
  const pos = half.filter((s) => s.x >= minX);
  const neg = [...pos].reverse().map((s) => ({ ...s, x: -s.x }));
  if (minX === 0 && pos.length && pos[0].x === 0) neg.pop();
  return [...neg, ...pos];
}

/** Linear resample of a half-span table to `segs` segments between x0 and x1. */
export function resampleStations(table: WingStation[], x0: number, x1: number, segs: number): WingStation[] {
  const out: WingStation[] = [];
  const keys: Array<keyof WingStation> = ['z', 'y', 'chord', 'angle', 'thick', 'camber'];
  for (let i = 0; i <= segs; i++) {
    const x = lerp(x0, x1, i / segs);
    let k = 0;
    while (k < table.length - 2 && x > table[k + 1].x) k++;
    const A = table[k];
    const B = table[Math.min(k + 1, table.length - 1)];
    const t = B.x === A.x ? 0 : THREE.MathUtils.clamp((x - A.x) / (B.x - A.x), 0, 1);
    const st: WingStation = { x, z: 0, y: 0, chord: 0, angle: 0 };
    for (const key of keys) {
      const av = (A[key] as number | undefined) ?? (key === 'thick' ? 0.1 : key === 'camber' ? 0.04 : 0);
      const bv = (B[key] as number | undefined) ?? av;
      (st as unknown as Record<string, number>)[key] = lerp(av, bv, t);
    }
    out.push(st);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Lathe around the X axis (wheels)                                          */
/* ------------------------------------------------------------------------ */

export interface ProfilePoint {
  /** Radius from the axle. */
  r: number;
  /** Lateral offset; +x = outer face for side = 1. */
  x: number;
  /** Texture V coordinate. */
  v: number;
}

export function latheX(profile: ProfilePoint[], segments: number, side: 1 | -1): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const K = profile.length;
  const cols = segments + 1;
  for (let k = 0; k < K; k++) {
    const prev = profile[Math.max(0, k - 1)];
    const next = profile[Math.min(K - 1, k + 1)];
    let tx = next.x - prev.x;
    let tr = next.r - prev.r;
    const tl = Math.hypot(tx, tr) || 1;
    tx /= tl;
    tr /= tl;
    const nx = -tr;
    const nr = tx;
    const pt = profile[k];
    for (let j = 0; j < cols; j++) {
      const phi = (j / segments) * TAU;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      mb.vert([side * pt.x, pt.r * c, pt.r * s], [side * nx, nr * c, nr * s], j / segments, pt.v);
    }
  }
  for (let k = 0; k < K - 1; k++) {
    for (let j = 0; j < segments; j++) {
      const a = k * cols + j;
      const b = (k + 1) * cols + j;
      const c = k * cols + j + 1;
      const d = (k + 1) * cols + j + 1;
      if (side > 0) {
        mb.tri(a, c, b);
        mb.tri(c, d, b);
      } else {
        mb.tri(a, b, c);
        mb.tri(c, b, d);
      }
    }
  }
  return mb.build();
}

/* ------------------------------------------------------------------------ */
/* Primitive helpers                                                        */
/* ------------------------------------------------------------------------ */

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

/** Open cylinder between two points; `flat` squashes the section (aero wishbones). */
export function rod(a: V3, b: V3, r: number, radial: number, flat = 1): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1, true);
  if (flat !== 1) g.scale(flat, 1, 1 / flat);
  _q.setFromUnitVectors(_up, dir.normalize());
  g.applyQuaternion(_q);
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

export function tube(points: V3[], radius: number, tubular: number, radial: number, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular, radius, Math.max(3, radial), closed);
}

type Pt2 = readonly [number, number];

function shapeFrom(points: Pt2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

/** Flat plate in the Z/Y plane (endplates, fins), centred on x = xCenter. Points are (z, y). */
export function plateZY(points: Pt2[], thickness: number, xCenter: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapeFrom(points), { depth: thickness, bevelEnabled: false, steps: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(xCenter + thickness / 2, 0, 0);
  return indexify(g);
}

/** Flat plate in the X/Z plane (floor), top face at y = yTop. Points are (x, z). */
export function plateXZ(points: Pt2[], thickness: number, yTop: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapeFrom(points), { depth: thickness, bevelEnabled: false, steps: 1 });
  g.rotateX(Math.PI / 2);
  g.translate(0, yTop, 0);
  return indexify(g);
}

/** Thin vertical fin following an XZ polyline, rising from yBase by heights[i]. */
export function finPath(path: Pt2[], yBase: number | number[], heights: number[], thickness: number): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const n = path.length;
  const L: THREE.Vector3[] = [];
  const R: THREE.Vector3[] = [];
  const nrm: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = path[Math.max(0, i - 1)];
    const p1 = path[Math.min(n - 1, i + 1)];
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const l = Math.hypot(dx, dz) || 1;
    // Horizontal normal (rotate tangent by −90° around Y).
    const nx = dz / l;
    const nz = -dx / l;
    nrm.push(new THREE.Vector3(nx, 0, nz));
    const yb = Array.isArray(yBase) ? yBase[i] : yBase;
    L.push(new THREE.Vector3(path[i][0] + (nx * thickness) / 2, yb, path[i][1] + (nz * thickness) / 2));
    R.push(new THREE.Vector3(path[i][0] - (nx * thickness) / 2, yb, path[i][1] - (nz * thickness) / 2));
  }
  const face = (side: THREE.Vector3[], sign: 1 | -1) => {
    const base = mb.count;
    for (let i = 0; i < n; i++) {
      const nn = nrm[i].clone().multiplyScalar(sign);
      mb.vert(side[i], nn);
      mb.vert([side[i].x, side[i].y + heights[i], side[i].z], nn);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (sign > 0) {
        mb.tri(a, c, b);
        mb.tri(b, c, d);
      } else {
        mb.tri(a, b, c);
        mb.tri(b, d, c);
      }
    }
  };
  face(L, 1);
  face(R, -1);
  // Top edge strip.
  const base = mb.count;
  for (let i = 0; i < n; i++) {
    mb.vert([L[i].x, L[i].y + heights[i], L[i].z], [0, 1, 0]);
    mb.vert([R[i].x, R[i].y + heights[i], R[i].z], [0, 1, 0]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    mb.tri(a, a + 1, a + 2);
    mb.tri(a + 1, a + 3, a + 2);
  }
  const g = mb.build();
  return fixWinding(g);
}

/** Flips any triangle whose winding disagrees with its vertex normals. */
export function fixWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.getIndex();
  if (!idx) return g;
  const P = g.getAttribute('position');
  const N = g.getAttribute('normal');
  const arr = idx.array as Uint16Array | Uint32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const a = arr[i];
    const b = arr[i + 1];
    const c = arr[i + 2];
    _a.fromBufferAttribute(P, a);
    _b.fromBufferAttribute(P, b).sub(_a);
    _c.fromBufferAttribute(P, c).sub(_a);
    _d.crossVectors(_b, _c);
    const nx = N.getX(a) + N.getX(b) + N.getX(c);
    const ny = N.getY(a) + N.getY(b) + N.getY(c);
    const nz = N.getZ(a) + N.getZ(b) + N.getZ(c);
    if (_d.x * nx + _d.y * ny + _d.z * nz < 0) {
      arr[i + 1] = c;
      arr[i + 2] = b;
    }
  }
  idx.needsUpdate = true;
  return g;
}

export function indexify(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.getIndex()) return g;
  const n = g.getAttribute('position').count;
  const idx: number[] = new Array<number>(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(idx);
  return g;
}

/** Mirror across X = 0 (keeps outward winding). */
export function mirrorX(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = indexify(src.clone());
  const P = g.getAttribute('position');
  const N = g.getAttribute('normal');
  for (let i = 0; i < P.count; i++) {
    P.setX(i, -P.getX(i));
    if (N) N.setX(i, -N.getX(i));
  }
  const idx = g.getIndex()!;
  const arr = idx.array as Uint16Array | Uint32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const t = arr[i + 1];
    arr[i + 1] = arr[i + 2];
    arr[i + 2] = t;
  }
  return g;
}

export function transformed(
  g: THREE.BufferGeometry,
  opts: { pos?: V3; rot?: V3; scale?: V3 },
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...(opts.pos ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opts.rot ?? [0, 0, 0]))),
    new THREE.Vector3(...(opts.scale ?? [1, 1, 1])),
  );
  g.applyMatrix4(m);
  return g;
}

/* ------------------------------------------------------------------------ */
/* Finalise + merge                                                         */
/* ------------------------------------------------------------------------ */

/** Fresh geometry with exactly position/normal/uv as Float32 and an index. */
export function normalizeAttrs(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = indexify(src);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  const copy = (name: string, size: number) => {
    const a = g.getAttribute(name);
    const arr = new Float32Array(n * size);
    if (a) for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) arr[i * size + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  };
  copy('position', 3);
  copy('normal', 3);
  copy('uv', 2);
  const idx = g.getIndex()!;
  const I: number[] = new Array<number>(idx.count);
  for (let i = 0; i < idx.count; i++) I[i] = idx.getX(i);
  out.setIndex(I);
  return out;
}

export interface Part {
  geo: THREE.BufferGeometry;
  slot: string;
  bone: number;
}

export interface PrepareOptions {
  /** Force every UV to a single atlas texel (swatch colour). */
  uv?: readonly [number, number] | null;
  skin: boolean;
  color?: THREE.Color | null;
}

export function preparePart(part: Part, o: PrepareOptions): THREE.BufferGeometry {
  const g = normalizeAttrs(part.geo);
  const n = g.getAttribute('position').count;
  if (o.uv) {
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) uv.setXY(i, o.uv[0], o.uv[1]);
  }
  if (o.skin) {
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = part.bone;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  if (o.color) {
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = o.color.r;
      col[i * 3 + 1] = o.color.g;
      col[i * 3 + 2] = o.color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return g;
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 1) return geos[0];
  const m = mergeGeometries(geos, false);
  if (!m) throw new Error('cars/geom: mergeGeometries failed (incompatible attributes)');
  for (const g of geos) g.dispose();
  return m;
}

export function triangleCount(g: THREE.BufferGeometry): number {
  const idx = g.getIndex();
  return idx ? idx.count / 3 : g.getAttribute('position').count / 3;
}
