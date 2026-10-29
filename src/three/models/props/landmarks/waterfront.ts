/**
 * Waterfront landmarks. Local frame: shoreline/quay along X at z = 0, water
 * towards +Z (the scene's water plane provides the surface at y = 0).
 *  - harbour: Monaco-style piers, breakwater + lighthouse, 20–40 yachts
 *  - marina: floating pontoons with fingers, speedboats / sailboats / motor yachts
 *  - lake: wooden jetties, boathouse, pedal boats, buoy line, reeds and rocks
 * Boats are instanced per size class and gently bob/roll in the vertex shader.
 */
import * as THREE from 'three';
import type { TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../../types';
import {
  FACE,
  MeshBuilder,
  Rng,
  cachedGeometry,
  disposeProp,
  finishInstanced,
  getVCMaterial,
  qPick,
  setPropsTimeOfDay,
  updatePropsTime,
} from '../core';
import type { LandmarkModel } from './common';

export type BoatKind = 'speed' | 'motor' | 'super' | 'sail' | 'row';

interface BoatSpec {
  kind: BoatKind;
  len: number;
}

const HULL_TINTS = ['#ffffff', '#f4f4f0', '#ffffff', '#1d2b4a', '#2b2f36', '#d9dde2', '#ffffff', '#0f3d5e'];

/** Yacht/boat geometry (bow +Z, waterline y = 0); aTint marks the hull for instance colour. */
export function buildBoatGeometry(spec: BoatSpec, q: ModelQuality): THREE.BufferGeometry {
  return cachedGeometry(`boat|${spec.kind}|${spec.len}|${q}`, () => {
    const b = new MeshBuilder({ tint: true });
    const L = spec.len;
    const beamK = { speed: 0.32, motor: 0.24, super: 0.17, sail: 0.3, row: 0.34 }[spec.kind];
    const B = L * beamK;
    const hd = THREE.MathUtils.clamp(L * 0.085, 0.45, 4.2);
    const st = [0, 0.18, 0.55, 0.8, 0.93, 1];
    const wf = [0.88, 1, 1, 0.8, 0.45, 0.03];
    const df = [0, 0, 0.02, 0.07, 0.13, 0.2];
    const yb = -0.35;
    const zs = st.map((t) => (t - 0.5) * L);
    const ws = wf.map((f) => (f * B) / 2);
    const ds = df.map((f) => hd * (1 + f));
    const band = Math.min(0.35, hd * 0.3);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    for (let i = 0; i < st.length - 1; i++) {
      const [z0, z1, w0, w1, d0, d1] = [zs[i]!, zs[i + 1]!, ws[i]!, ws[i + 1]!, ds[i]!, ds[i + 1]!];
      // Boot stripe (dark) + tinted topsides, both sides.
      b.tint = 0;
      b.quad(V(-w0 * 0.8, yb, z0), V(-w1 * 0.8, yb, z1), V(-w1, band, z1), V(-w0, band, z0), '#1d2733');
      b.quad(V(w1 * 0.8, yb, z1), V(w0 * 0.8, yb, z0), V(w0, band, z0), V(w1, band, z1), '#1d2733');
      b.tint = 1;
      b.quad(V(-w0, band, z0), V(-w1, band, z1), V(-w1, d1, z1), V(-w0, d0, z0), '#ffffff');
      b.quad(V(w1, band, z1), V(w0, band, z0), V(w0, d0, z0), V(w1, d1, z1), '#ffffff');
      b.tint = 0;
      b.quad(V(w0, d0, z0), V(-w0, d0, z0), V(-w1, d1, z1), V(w1, d1, z1), spec.kind === 'row' ? '#8b6a46' : '#b8946a');
    }
    b.tint = 1;
    b.quad(V(ws[0]!, yb, zs[0]!), V(-ws[0]!, yb, zs[0]!), V(-ws[0]!, ds[0]!, zs[0]!), V(ws[0]!, ds[0]!, zs[0]!), '#ffffff');
    b.tint = 0;
    const white = '#f6f7f8';
    const glass = '#18222d';
    const glassGlow = [0.04, 1.1] as const;
    const tier = (za: number, zb: number, w: number, y: number, h: number, glassRatio = 0.45) => {
      b.boxOn(0, y, (za + zb) / 2, w, h, zb - za, white, { faces: FACE.NO_BOTTOM });
      b.box(0, y + h * 0.55, (za + zb) / 2 + 0.02, w + 0.04, h * glassRatio, zb - za - 0.3, glass, {
        faces: FACE.PX | FACE.NX | FACE.PZ,
        glow: glassGlow,
      });
    };
    switch (spec.kind) {
      case 'speed': {
        b.boxOn(0, hd, -L * 0.05, B * 0.7, 0.35, L * 0.25, '#e9ecef', { faces: FACE.NO_BOTTOM });
        b.box(0, hd + 0.55, L * 0.06, B * 0.66, 0.5, 0.06, '#6a8aa6', { rx: -0.5, glow: [0.02, 0.3] });
        b.box(0, hd + 0.2, -L * 0.3, B * 0.8, 0.4, L * 0.18, '#d6c2a0', { faces: FACE.NO_BOTTOM });
        break;
      }
      case 'row': {
        b.box(0, hd * 0.7, 0, B * 0.9, 0.08, 0.3, '#6b4f33');
        break;
      }
      case 'motor': {
        tier(-L * 0.28, L * 0.18, B * 0.78, hd, 1.9);
        tier(-L * 0.2, L * 0.05, B * 0.68, hd + 1.9, 1.4, 0.35);
        b.beam(V(-B * 0.3, hd + 3.3, -L * 0.12), V(0, hd + 4.4, -L * 0.15), 0.12, 0.12, white);
        b.beam(V(B * 0.3, hd + 3.3, -L * 0.12), V(0, hd + 4.4, -L * 0.15), 0.12, 0.12, white);
        b.box(0, hd + 4.5, -L * 0.15, 0.4, 0.2, 0.4, '#ffffff', { glow: [0.4, 2.0] });
        break;
      }
      case 'super': {
        const h = 2.8;
        tier(-L * 0.36, L * 0.22, B * 0.84, hd, h, 0.4);
        tier(-L * 0.3, L * 0.12, B * 0.76, hd + h, h, 0.4);
        tier(-L * 0.22, L * 0.02, B * 0.66, hd + h * 2, h * 0.9, 0.42);
        if (q !== 'low') tier(-L * 0.14, -L * 0.02, B * 0.5, hd + h * 2.9, h * 0.7, 0.4);
        // Radar mast + helipad hint at the bow
        b.boxOn(0, hd + h * 3.6, -L * 0.08, 0.5, 4.5, 0.5, white);
        b.box(0, hd + h * 3.6 + 3.6, -L * 0.08, B * 0.5, 0.18, 0.3, white);
        b.box(0, hd + h * 3.6 + 4.6, -L * 0.08, 0.4, 0.4, 0.4, '#ffffff', { glow: [0.4, 2.5] });
        b.box(0, ds[3]! + 0.02, L * 0.33, B * 0.6, 0.04, B * 0.6, '#3a4048', { faces: FACE.PY });
        // Deck lights along the rail
        b.box(0, hd + 0.4, 0, B * 0.98, 0.06, L * 0.8, '#fff4dc', { faces: FACE.PX | FACE.NX, glow: [0, 1.2] });
        break;
      }
      case 'sail': {
        b.boxOn(0, hd, -L * 0.1, B * 0.55, 0.7, L * 0.32, white, { faces: FACE.NO_BOTTOM });
        b.box(0, hd + 0.4, -L * 0.1 + 0.02, B * 0.57, 0.22, L * 0.26, glass, { faces: FACE.PX | FACE.NX, glow: glassGlow });
        const mh = L * 1.35;
        b.boxOn(0, hd, L * 0.08, 0.18, mh, 0.18, '#dfe3e6');
        b.box(0, hd + 1.6, -L * 0.12, 0.14, 0.14, L * 0.42, '#c9ced3');
        b.box(0, hd + 1.82, -L * 0.12, 0.34, 0.3, L * 0.4, '#1e3a8a');
        b.box(0, hd + mh, L * 0.08, 0.25, 0.25, 0.25, '#ff2a1a', { glow: [0.4, 2.5] });
        break;
      }
    }
    return b.build();
  });
}

interface BoatSlot {
  x: number;
  z: number;
  rot: number;
  cls: number;
}

function boatInstances(
  classes: BoatSpec[],
  slots: BoatSlot[],
  q: ModelQuality,
  rng: Rng,
  tints = HULL_TINTS,
): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  const mat = getVCMaterial(q, { tint: true, bob: true });
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  classes.forEach((spec, ci) => {
    const mine = slots.filter((s) => s.cls === ci);
    if (!mine.length) return;
    const mesh = new THREE.InstancedMesh(buildBoatGeometry(spec, q), mat, mine.length);
    mine.forEach((s, i) => {
      quat.setFromAxisAngle(up, s.rot);
      m.compose(p.set(s.x, 0, s.z), quat, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(rng.pick(tints)));
    });
    mesh.name = `boats-${spec.kind}-${spec.len}`;
    out.push(finishInstanced(mesh));
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Harbour                                                             */
/* ------------------------------------------------------------------ */

export function createHarbour(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const rng = new Rng('harbour');
  const root = new THREE.Group();
  root.name = 'harbour';
  const sb = new MeshBuilder();
  const stone = '#cdbfa8';
  // Quay + promenade
  sb.box(0, 0.2, -5, 300, 2.8, 10, stone, { colorFace: (f) => (f === FACE.PY ? '#dcd2c2' : undefined) });
  for (let x = -145; x <= 145; x += 12) {
    sb.boxOn(x, 1.6, -1.2, 0.18, 5, 0.18, '#3b4148', { faces: FACE.SIDES });
    sb.box(x, 6.7, -0.7, 0.5, 0.25, 1.0, '#2a2e33');
    sb.box(x, 6.55, -0.7, 0.4, 0.04, 0.8, '#fff1d6', { faces: FACE.NY, glow: [0.05, 3] });
  }
  sb.box(0, 2.3, -0.25, 300, 0.08, 0.08, '#3b4148');
  // Piers
  const piers = [-110, -55, 0, 55, 110];
  const pierLen = [70, 95, 85, 100, 75];
  piers.forEach((x, i) => {
    const len = pierLen[i]!;
    sb.box(x, 0.55, len / 2, 6, 1.3, len, '#d9d2c4', { colorFace: (f) => (f === FACE.PY ? '#e5dfd3' : undefined), faces: FACE.ALL & ~FACE.NY });
    for (let z = 6; z < len; z += 10) {
      for (const s of [-1, 1]) sb.boxOn(x + s * 2.7, 1.2, z, 0.25, 0.5, 0.25, '#2b2f34', { faces: FACE.NO_BOTTOM });
      sb.box(x, 1.25, z, 0.3, 0.06, 0.3, '#fff1d6', { glow: [0, 2] });
    }
  });
  // Breakwater + lighthouse
  const bwz = 140;
  sb.box(10, 1.5, bwz, 290, 5, 14, '#bfb6a6', { faces: FACE.ALL & ~FACE.NY, colorFace: (f) => (f === FACE.PY ? '#cfc7b8' : undefined) });
  sb.box(10, 4.5, bwz + 5.5, 290, 1.4, 2.5, '#b3aa9a');
  sb.prim(new THREE.CylinderGeometry(2.2, 3, 16, 10), { x: 150, y: 12, z: bwz }, '#f4f4f4');
  sb.prim(new THREE.CylinderGeometry(2.4, 2.4, 3, 10), { x: 150, y: 21.5, z: bwz }, '#d62828', { glow: [0.1, 1.8] });
  sb.prim(new THREE.ConeGeometry(2.8, 2.4, 10), { x: 150, y: 24.2, z: bwz }, '#2b2f34');
  root.add(sb.mesh(getVCMaterial(quality), 'harbour-structure'));

  const classes: BoatSpec[] = [
    { kind: 'motor', len: 16 },
    { kind: 'motor', len: 27 },
    { kind: 'super', len: 58 },
    { kind: 'sail', len: 14 },
  ];
  const target = qPick(quality, 20, 30, 40);
  const slots: BoatSlot[] = [];
  // Superyachts alongside the breakwater (inner side).
  for (let x = -120; x < 140 && slots.length < Math.round(target * 0.2); x += 72) {
    slots.push({ x: x + rng.range(-4, 4), z: bwz - 14, rot: Math.PI / 2, cls: 2 });
  }
  // Stern-to along the piers.
  const pierSlots: BoatSlot[] = [];
  piers.forEach((px, i) => {
    const len = pierLen[i]!;
    for (const s of [-1, 1]) {
      for (let z = 8; z < len - 4; z += 7.5) {
        const big = rng.chance(0.35);
        const cls = big ? 1 : rng.chance(0.2) ? 3 : 0;
        const l = classes[cls]!.len;
        pierSlots.push({ x: px + s * (3 + l / 2 + 0.8), z: z + rng.range(-0.6, 0.6), rot: s > 0 ? Math.PI / 2 : -Math.PI / 2, cls });
      }
    }
  });
  // Keep deterministic subset spread over piers.
  pierSlots.sort((a, b) => ((a.x * 13.7 + a.z * 7.1) % 11) - ((b.x * 13.7 + b.z * 7.1) % 11));
  for (const s of pierSlots) {
    if (slots.length >= target) break;
    if (slots.some((o) => Math.abs(o.x - s.x) < 1 && Math.abs(o.z - s.z) < 5)) continue;
    slots.push(s);
  }
  for (const m of boatInstances(classes, slots, quality, rng)) root.add(m);

  return {
    root,
    update(t: number) {
      updatePropsTime(t);
    },
    dispose() {
      disposeProp(root);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Marina                                                              */
/* ------------------------------------------------------------------ */

export function createMarina(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const rng = new Rng('marina');
  const root = new THREE.Group();
  root.name = 'marina';
  const sb = new MeshBuilder();
  const deck = '#d7d2c8';
  const W = 200;
  sb.box(0, -0.3, -4, W + 40, 1.6, 8, '#c8c1b3', { colorFace: (f) => (f === FACE.PY ? '#e2ddd2' : undefined) });
  const walkZ = 26;
  sb.box(0, 0.35, walkZ, W, 0.5, 3, deck, { faces: FACE.ALL & ~FACE.NY });
  sb.box(-W / 2 + 20, 0.35, walkZ / 2, 3, 0.5, walkZ, deck, { faces: FACE.ALL & ~FACE.NY });
  sb.box(W / 2 - 20, 0.35, walkZ / 2, 3, 0.5, walkZ, deck, { faces: FACE.ALL & ~FACE.NY });
  const fingers: number[] = [];
  for (let x = -W / 2 + 6; x <= W / 2 - 6; x += 12) fingers.push(x);
  for (const x of fingers) {
    for (const s of [-1, 1]) {
      sb.box(x, 0.3, walkZ + s * 9.5, 1.4, 0.4, 16, deck, { faces: FACE.ALL & ~FACE.NY });
      sb.box(x, 0.75, walkZ + s * 17, 0.25, 0.5, 0.25, '#2b2f34', { faces: FACE.NO_BOTTOM });
      sb.box(x, 1.02, walkZ + s * 17, 0.2, 0.05, 0.2, '#fff1d6', { glow: [0, 2.2] });
    }
  }
  root.add(sb.mesh(getVCMaterial(quality), 'marina-pontoons'));

  const classes: BoatSpec[] = [
    { kind: 'speed', len: 9 },
    { kind: 'motor', len: 15 },
    { kind: 'sail', len: 12 },
    { kind: 'super', len: 42 },
  ];
  const target = qPick(quality, 16, 28, 40);
  const slots: BoatSlot[] = [];
  for (let k = 0; k < fingers.length - 1; k++) {
    for (const s of [-1, 1]) {
      if (slots.length >= target) break;
      const x = (fingers[k]! + fingers[k + 1]!) / 2;
      const r = rng.next();
      const cls = r < 0.35 ? 0 : r < 0.75 ? 1 : 2;
      const l = classes[cls]!.len;
      if (rng.chance(0.12)) continue;
      slots.push({ x: x + rng.range(-0.5, 0.5), z: walkZ + s * (1.8 + l / 2), rot: s > 0 ? 0 : Math.PI, cls });
    }
  }
  // A couple of big motor yachts on the outer T-head.
  for (let x = -60; x <= 60 && slots.length < target + 2; x += 60) slots.push({ x, z: walkZ + 26, rot: Math.PI / 2, cls: 3 });
  for (const m of boatInstances(classes, slots, quality, rng)) root.add(m);

  return {
    root,
    update(t: number) {
      updatePropsTime(t);
    },
    dispose() {
      disposeProp(root);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Lake                                                                */
/* ------------------------------------------------------------------ */

export function createLakeShore(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const rng = new Rng('lake');
  const root = new THREE.Group();
  root.name = 'lake-shore';
  const sb = new MeshBuilder();
  const wood = '#8b6a46';
  for (const [x, len] of [
    [-40, 24],
    [5, 30],
    [50, 20],
  ] as const) {
    sb.box(x, 0.6, len / 2, 2.6, 0.18, len, wood);
    for (let z = 2; z <= len; z += 3) for (const s of [-1, 1]) sb.boxOn(x + s * 1.2, -1, z, 0.18, 1.7, 0.18, '#5d4630', { faces: FACE.SIDES | FACE.PY });
    sb.boxOn(x - 1.25, 0.7, len / 2, 0.06, 0.9, len, '#5d4630', { faces: FACE.SIDES | FACE.PY });
    sb.box(x, 1.8, len - 0.5, 0.5, 0.3, 0.5, '#fff1d6', { glow: [0, 1.6] });
  }
  // Boathouse
  sb.boxOn(-72, 0, -5, 14, 4.5, 9, '#9c7a54', { faces: FACE.NO_BOTTOM });
  sb.box(-72, 2, -0.48, 5, 3.2, 0.04, '#3b2d20', { faces: FACE.PZ });
  sb.box(-66, 2.6, -0.48, 1.6, 1.2, 0.04, '#1b2430', { faces: FACE.PZ, glow: [0, 1.0] });
  {
    const y = 4.5;
    const V = (x: number, yy: number, z: number) => new THREE.Vector3(x, yy, z);
    sb.quad(V(-79.5, y, 0), V(-64.5, y, 0), V(-64.5, y + 3, -5), V(-79.5, y + 3, -5), '#2f5d46');
    sb.quad(V(-64.5, y, -10), V(-79.5, y, -10), V(-79.5, y + 3, -5), V(-64.5, y + 3, -5), '#27503c');
    sb.tri(V(-79, y, -10), V(-79, y, 0), V(-79, y + 3, -5), '#9c7a54');
    sb.tri(V(-65, y, 0), V(-65, y, -10), V(-65, y + 3, -5), '#9c7a54');
  }
  // Buoy line
  for (let x = -90; x <= 90; x += 5) {
    sb.prim(new THREE.OctahedronGeometry(0.35, 0), { x, y: 0.15, z: 70 + Math.sin(x * 0.05) * 4 }, Math.round(x / 5) % 2 ? '#e11d48' : '#f5f5f5');
  }
  // Reeds + rocks along the shore
  const reeds = qPick(quality, 30, 60, 100);
  for (let i = 0; i < reeds; i++) {
    const x = rng.range(-110, 110);
    if (Math.abs(x + 40) < 3 || Math.abs(x - 5) < 3 || Math.abs(x - 50) < 3) continue;
    const z = rng.range(-0.5, 2.5);
    const h = rng.range(0.9, 1.8);
    sb.prim(new THREE.ConeGeometry(0.35, h, 4, 1, true), { x, y: h / 2 - 0.1, z }, rng.chance(0.5) ? '#7a8f3a' : '#9aa24f');
  }
  for (let i = 0; i < qPick(quality, 10, 20, 30); i++) {
    const r = rng.range(0.4, 1.4);
    sb.prim(new THREE.IcosahedronGeometry(r, 0), { x: rng.range(-110, 110), y: r * 0.2, z: rng.range(-2, 0.5) }, '#8a8f93', {
      scale: { x: 1.2, y: 0.6, z: 1 },
    });
  }
  root.add(sb.mesh(getVCMaterial(quality), 'lake-shore'));

  const classes: BoatSpec[] = [{ kind: 'row', len: 4.5 }];
  const slots: BoatSlot[] = [];
  for (let i = 0; i < qPick(quality, 6, 10, 14); i++) {
    slots.push({ x: rng.range(-60, 70), z: rng.range(10, 45), rot: rng.range(0, Math.PI * 2), cls: 0 });
  }
  for (const m of boatInstances(classes, slots, quality, rng, ['#e11d48', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#a855f7'])) root.add(m);
  return {
    root,
    update(t: number) {
      updatePropsTime(t);
    },
    dispose() {
      disposeProp(root);
    },
  };
}
