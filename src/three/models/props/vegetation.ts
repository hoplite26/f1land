/**
 * Instanced vegetation. Trunk + foliage are merged into one geometry per tree
 * kind (aTint masks foliage for per-instance tint and vertex wind sway), so a
 * kind costs ONE draw call however many trees ('mixed' = 2).
 */
import * as THREE from 'three';
import type { ModelQuality } from '../types';
import { MeshBuilder, Rng, cachedGeometry, finishInstanced, getVCMaterial, hashSeed, mix, qPick } from './core';

export type TreeKind = 'conifer' | 'deciduous' | 'palm' | 'cherry' | 'mixed';

export interface TreeOptions {
  seed?: number;
  /** Global scale multiplier (default 1). */
  scale?: number;
}

/** Radially jitters a non-indexed blob consistently for coincident vertices. */
function jitterBlob(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = hashSeed(seed, Math.round(v.x * 100), Math.round(v.y * 100), Math.round(v.z * 100));
    const k = 1 + ((h % 1000) / 1000 - 0.5) * 2 * amount;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}

function gradient(dark: string, light: string, y0: number, y1: number) {
  return (p: THREE.Vector3) => mix(dark, light, THREE.MathUtils.clamp((p.y - y0) / (y1 - y0), 0, 1));
}

function addTrunk(b: MeshBuilder, r0: number, r1: number, h: number, seg: number, color: string): void {
  b.tint = 0;
  b.prim(new THREE.CylinderGeometry(r1, r0, h, seg, 1, true), { x: 0, y: h / 2, z: 0 }, color);
}

function addBlob(
  b: MeshBuilder,
  r: number,
  detail: number,
  pos: THREE.Vector3,
  scale: THREE.Vector3,
  colorFn: (p: THREE.Vector3) => THREE.Color,
  seed: number,
): void {
  b.tint = 1;
  const g = jitterBlob(new THREE.IcosahedronGeometry(r, detail), 0.16, seed);
  const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion(), scale);
  b.geometry(g, m, '#ffffff', [0, 0], { vertexColorFn: colorFn });
  g.dispose();
}

function buildConifer(q: ModelQuality): THREE.BufferGeometry {
  const b = new MeshBuilder({ tint: true });
  const seg = qPick(q, 5, 7, 9);
  addTrunk(b, 0.28, 0.16, 2.6, qPick(q, 4, 5, 6), '#5b4330');
  const tiers = qPick(q, 2, 3, 4);
  b.tint = 1;
  for (let k = 0; k < tiers; k++) {
    const f = k / Math.max(1, tiers - 1);
    const r = 2.5 * (1 - f * 0.55);
    const h = 4.4 * (1 - f * 0.3);
    const y = 1.8 + k * (6.4 / tiers);
    const cone = new THREE.ConeGeometry(r, h, seg, 1, true);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, y + h / 2, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, k * 0.7, 0)), new THREE.Vector3(1, 1, 1));
    b.geometry(cone, m, '#ffffff', [0, 0], { vertexColorFn: gradient('#1f4a2c', '#3f7a45', y, y + h) });
    cone.dispose();
  }
  return b.build();
}

function buildDeciduous(q: ModelQuality, cherry: boolean): THREE.BufferGeometry {
  const b = new MeshBuilder({ tint: true });
  const trunk = cherry ? '#4a3328' : '#5e4632';
  addTrunk(b, 0.32, 0.2, 3.4, qPick(q, 4, 5, 6), trunk);
  if (q !== 'low') {
    b.tint = 0;
    b.beam(new THREE.Vector3(0, 2.6, 0), new THREE.Vector3(1.1, 4.2, 0.3), 0.14, 0.14, trunk);
    b.beam(new THREE.Vector3(0, 2.8, 0), new THREE.Vector3(-0.9, 4.4, -0.4), 0.13, 0.13, trunk);
  }
  const col = cherry ? gradient('#c96f92', '#f7c3d6', 3, 8) : gradient('#2f5a22', '#78a64c', 3, 8.5);
  const w = cherry ? 1.25 : 1;
  if (q === 'low') {
    addBlob(b, 2.6, 0, new THREE.Vector3(0, 5.0, 0), new THREE.Vector3(w, 0.9, w), col, 1);
  } else if (q === 'medium') {
    addBlob(b, 2.4, 0, new THREE.Vector3(0, 5.0, 0), new THREE.Vector3(w, 0.9, w), col, 1);
    addBlob(b, 1.8, 0, new THREE.Vector3(0.9 * w, 6.2, 0.5), new THREE.Vector3(w, 0.85, w), col, 2);
    if (cherry) addBlob(b, 1.6, 0, new THREE.Vector3(-1.4, 5.4, -0.6), new THREE.Vector3(1, 0.8, 1), col, 3);
  } else {
    addBlob(b, 2.6, 1, new THREE.Vector3(0, 5.1, 0), new THREE.Vector3(w, 0.88, w), col, 1);
    addBlob(b, 1.8, 0, new THREE.Vector3(1.0 * w, 6.4, 0.5), new THREE.Vector3(w, 0.85, w), col, 2);
    addBlob(b, 1.6, 0, new THREE.Vector3(-1.3 * w, 5.6, -0.6), new THREE.Vector3(1, 0.8, 1), col, 3);
  }
  return b.build();
}

function buildPalm(q: ModelQuality): THREE.BufferGeometry {
  const b = new MeshBuilder({ tint: true });
  const segs = qPick(q, 3, 5, 7);
  const sides = qPick(q, 4, 5, 7);
  const H = 8.5;
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.4, H * 0.55, 0), new THREE.Vector3(1.5, H, 0.2));
  b.tint = 0;
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPoint(t);
    const r = THREE.MathUtils.lerp(0.3, 0.17, t);
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      ring.push(new THREE.Vector3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r));
    }
    rings.push(ring);
  }
  for (let i = 0; i < segs; i++) {
    const col = i % 2 ? '#8a6f4e' : '#74593c';
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      b.quad(rings[i]![k2]!, rings[i]![k]!, rings[i + 1]![k]!, rings[i + 1]![k2]!, col);
    }
  }
  // Fronds
  const top = curve.getPoint(1);
  const n = qPick(q, 5, 7, 9);
  b.tint = 1;
  for (let f = 0; f < n; f++) {
    const a = (f / n) * Math.PI * 2 + 0.3;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const droop = 0.8 + (f % 3) * 0.35;
    const spine = [
      top.clone(),
      top.clone().addScaledVector(dir, 1.6).add(new THREE.Vector3(0, 0.55, 0)),
      top.clone().addScaledVector(dir, 3.3).add(new THREE.Vector3(0, -0.2 * droop, 0)),
      top.clone().addScaledVector(dir, 4.5).add(new THREE.Vector3(0, -1.5 * droop, 0)),
    ];
    const widths = [0.05, 0.75, 0.55, 0.02];
    const last = q === 'low' ? 2 : 3;
    for (let i = 0; i < last; i++) {
      const s0 = spine[i]!;
      const s1 = spine[i + 1]!;
      const w0 = widths[i]!;
      const w1 = i + 1 === last ? 0.02 : widths[i + 1]!;
      const lift = new THREE.Vector3(0, 0.18, 0);
      const l0 = s0.clone().addScaledVector(side, w0).add(lift);
      const l1 = s1.clone().addScaledVector(side, w1).add(lift);
      const r0 = s0.clone().addScaledVector(side, -w0).add(lift);
      const r1 = s1.clone().addScaledVector(side, -w1).add(lift);
      const c0 = i === 0 ? '#3f6e2a' : '#5c9038';
      const c1 = '#4f8231';
      b.quad(s0, s1, l1, l0, c0);
      b.quad(s1, s0, l0, l1, c1);
      b.quad(r0, r1, s1, s0, c0);
      b.quad(r1, r0, s0, s1, c1);
    }
  }
  if (q === 'high') {
    b.tint = 0;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      b.prim(new THREE.IcosahedronGeometry(0.2, 0), { x: top.x + Math.cos(a) * 0.3, y: top.y - 0.25, z: top.z + Math.sin(a) * 0.3 }, '#6b4a26');
    }
  }
  return b.build();
}

function treeGeometry(kind: Exclude<TreeKind, 'mixed'>, q: ModelQuality): THREE.BufferGeometry {
  return cachedGeometry(`tree|${kind}|${q}`, () => {
    switch (kind) {
      case 'conifer':
        return buildConifer(q);
      case 'deciduous':
        return buildDeciduous(q, false);
      case 'cherry':
        return buildDeciduous(q, true);
      case 'palm':
        return buildPalm(q);
    }
  });
}

const GREEN_TINTS = ['#ffffff', '#e8f4d8', '#f6ffe2', '#d6e6c4', '#fff2d6', '#e2ecd2', '#f0e8c8'];
const PINK_TINTS = ['#ffffff', '#ffe4ee', '#ffd6e6', '#fff2f6', '#f8e0ff'];

function instancedTrees(
  kind: Exclude<TreeKind, 'mixed'>,
  positions: readonly THREE.Vector3[],
  q: ModelQuality,
  rng: Rng,
  scale: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(treeGeometry(kind, q), getVCMaterial(q, { tint: true, wind: true }), Math.max(1, positions.length));
  mesh.count = positions.length;
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const tints = kind === 'cherry' ? PINK_TINTS : GREEN_TINTS;
  positions.forEach((p, i) => {
    quat.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
    const k = rng.range(0.72, 1.3) * scale;
    m.compose(p, quat, s.set(k, k * rng.range(0.88, 1.15), k));
    mesh.setMatrixAt(i, m);
    c.set(rng.pick(tints)).multiplyScalar(rng.range(0.82, 1.08));
    mesh.setColorAt(i, c);
  });
  mesh.name = `trees-${kind}`;
  return finishInstanced(mesh);
}

/** Instanced trees at ground positions (deterministic random scale/rotation/tint). */
export function createTrees(positions: THREE.Vector3[], kind: TreeKind, quality: ModelQuality, opts: TreeOptions = {}): THREE.Group {
  const rng = new Rng(opts.seed ?? hashSeed('trees', kind, positions.length, positions[0]?.x ?? 0));
  const group = new THREE.Group();
  group.name = `trees-${kind}`;
  const scale = opts.scale ?? 1;
  if (kind === 'mixed') {
    const a: THREE.Vector3[] = [];
    const b: THREE.Vector3[] = [];
    for (const p of positions) (rng.chance(0.5) ? a : b).push(p);
    if (a.length) group.add(instancedTrees('conifer', a, quality, rng, scale));
    if (b.length) group.add(instancedTrees('deciduous', b, quality, rng, scale));
  } else if (positions.length) {
    group.add(instancedTrees(kind, positions, quality, rng, scale));
  }
  return group;
}

export interface BushOptions {
  seed?: number;
  scale?: number;
  /** Base foliage colour (e.g. flowering hedges). */
  color?: string;
}

/** Instanced low shrubs / hedges (one draw call). */
export function createBushes(positions: THREE.Vector3[], quality: ModelQuality, opts: BushOptions = {}): THREE.Group {
  const base = opts.color ?? '#4a7a32';
  const geo = cachedGeometry(`bush|${quality}|${base}`, () => {
    const b = new MeshBuilder({ tint: true });
    const dark = new THREE.Color(base).multiplyScalar(0.6).getStyle();
    const col = gradient(dark, base, 0, 1.4);
    addBlob(b, 0.9, 0, new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(1.3, 0.75, 1.3), col, 7);
    if (quality !== 'low') addBlob(b, 0.65, 0, new THREE.Vector3(0.7, 0.45, 0.3), new THREE.Vector3(1.2, 0.8, 1.2), col, 8);
    return b.build();
  });
  const rng = new Rng(opts.seed ?? hashSeed('bush', positions.length, positions[0]?.x ?? 0));
  const mesh = new THREE.InstancedMesh(geo, getVCMaterial(quality, { tint: true, wind: true }), Math.max(1, positions.length));
  mesh.count = positions.length;
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const sc = opts.scale ?? 1;
  positions.forEach((p, i) => {
    quat.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
    const k = rng.range(0.7, 1.35) * sc;
    m.compose(p, quat, s.set(k, k * rng.range(0.8, 1.2), k));
    mesh.setMatrixAt(i, m);
    c.set(rng.pick(GREEN_TINTS)).multiplyScalar(rng.range(0.85, 1.1));
    mesh.setColorAt(i, c);
  });
  mesh.name = 'bushes';
  const group = new THREE.Group();
  group.name = 'bushes';
  group.add(finishInstanced(mesh));
  return group;
}
