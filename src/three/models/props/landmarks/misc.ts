/**
 * Observation tower (COTA-style, with the red tube "veil"), low-poly mountain
 * backdrop ring, and a branded pedestrian bridge over the track.
 */
import * as THREE from 'three';
import type { TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../../types';
import { FACE, MeshBuilder, Rng, disposeProp, getVCMaterial, mix, qPick, setPropsTimeOfDay } from '../core';
import { STAND_BANNER_PERIOD_M, getBannerTexture } from '../textures';
import type { LandmarkModel } from './common';

/* ------------------------------------------------------------------ */
/* Observation tower                                                   */
/* ------------------------------------------------------------------ */

/** ~77 m tower with observation deck and a cascading veil of red steel tubes (front = +Z). */
export function createObservationTower(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const root = new THREE.Group();
  root.name = 'observation-tower';
  const b = new MeshBuilder();
  const seg = qPick(quality, 10, 14, 20);
  const H = 70;
  b.prim(new THREE.CylinderGeometry(2.8, 3.6, H, seg, 1, true), { x: 0, y: H / 2, z: 0 }, '#dcd8d0');
  b.box(0, H / 2, -3.3, 1.6, H - 4, 0.6, '#2a4a66', { glow: [0.05, 1.0] });
  // Observation deck
  b.prim(new THREE.CylinderGeometry(8.5, 7.5, 1.0, seg * 2), { x: 0, y: H, z: 0 }, '#f1f1ef');
  b.prim(new THREE.CylinderGeometry(8.2, 8.2, 3.2, seg * 2, 1, true), { x: 0, y: H + 2.1, z: 0 }, '#2b4a66', { glow: [0.05, 1.3] });
  b.prim(new THREE.CylinderGeometry(9.2, 8.6, 0.8, seg * 2), { x: 0, y: H + 4.1, z: 0 }, '#f7f7f5');
  b.prim(new THREE.CylinderGeometry(9.25, 9.25, 0.2, seg * 2, 1, true), { x: 0, y: H + 4.2, z: 0 }, '#e10600', { glow: [0.3, 1.8] });
  b.prim(new THREE.CylinderGeometry(0.2, 0.4, 7, 6, 1, true), { x: 0, y: H + 8, z: 0 }, '#cfd3d7');
  b.box(0, H + 11.6, 0, 0.5, 0.5, 0.5, '#ff2a1a', { glow: [0.6, 3] });
  // Veil: red tubes cascading from the deck to the canopy ring.
  const tubes = qPick(quality, 12, 20, 30);
  const steps = qPick(quality, 6, 9, 12);
  const red = '#d0202a';
  const canopyR = 32;
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i < tubes; i++) {
    const t = i / (tubes - 1);
    const phi = THREE.MathUtils.lerp(-1.9, 1.9, t);
    const lean = Math.sin(t * Math.PI) * 0.25;
    let prev: THREE.Vector3 | null = null;
    for (let k = 0; k <= steps; k++) {
      const s = k / steps;
      const r = 3.4 + (canopyR - 3.4) * Math.pow(s, 1.55);
      const y = (H - 1) * Math.pow(1 - s, 1.2) + 9 * s;
      const a = phi + lean * s;
      const p = new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
      if (prev) b.beam(prev, p, 0.42, 0.42, red, { glow: [0.02, 0.55] });
      prev = p;
    }
    ring.push(prev!);
  }
  for (let i = 0; i < ring.length - 1; i++) b.beam(ring[i]!, ring[i + 1]!, 0.6, 0.6, red);
  // Canopy shell under the veil foot
  for (let i = 0; i < ring.length - 1; i++) {
    const p0 = ring[i]!;
    const p1 = ring[i + 1]!;
    const i0 = p0.clone().multiplyScalar(0.62).setY(7.2);
    const i1 = p1.clone().multiplyScalar(0.62).setY(7.2);
    b.quad(i0, i1, p1.clone().setY(8.4), p0.clone().setY(8.4), '#f4f4f2');
    b.quad(i1, i0, p0.clone().setY(8.3), p1.clone().setY(8.3), '#d8dade', [0.05, 0.7]);
    b.box(p0.x, 4.2, p0.z, 0.5, 8.4, 0.5, '#9aa0a6', { faces: FACE.SIDES });
  }
  // Plaza
  b.prim(new THREE.CylinderGeometry(40, 40, 0.3, 32), { x: 0, y: 0.15, z: 0 }, '#c9c4ba');
  b.prim(new THREE.CylinderGeometry(6, 6, 4, seg), { x: 0, y: 2, z: 0 }, '#b8b2a7');
  root.add(b.mesh(getVCMaterial(quality), 'observation-tower'));
  return { root, update() {}, dispose: () => disposeProp(root) };
}

/* ------------------------------------------------------------------ */
/* Mountains                                                           */
/* ------------------------------------------------------------------ */

/**
 * Low-poly backdrop ring of ridges around the origin (inner radius ~1.6 km,
 * peaks 150–480 m, snow caps, a hazier far ring). Scale the root to fit.
 */
export function createMountains(quality: ModelQuality, timeOfDay: TimeOfDay, opts: { radius?: number; seed?: string } = {}): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const root = new THREE.Group();
  root.name = 'mountains';
  const rng = new Rng(opts.seed ?? 'mountains');
  const R0 = opts.radius ?? 1600;
  const n = qPick(quality, 72, 120, 180);
  const b = new MeshBuilder();
  const centre = new THREE.Vector3();
  const quadIn = (a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, col: THREE.Color) => {
    const nrm = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(d, bb));
    const mid = a.clone().add(c).multiplyScalar(0.5);
    const toC = centre.clone().sub(mid).setY(0);
    if (nrm.dot(toC) + nrm.y * 50 >= 0) b.quad(a, bb, c, d, col);
    else b.quad(bb, a, d, c, col);
  };
  const ring = (r0: number, hScale: number, hazeK: number, phase: number) => {
    const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28), phase];
    const height = (a: number) => {
      const v =
        0.5 +
        0.28 * Math.sin(a * 3 + ph[0]!) +
        0.18 * Math.sin(a * 7 + ph[1]!) +
        0.12 * Math.sin(a * 13 + ph[2]!) +
        0.08 * Math.sin(a * 29 + ph[3]!);
      return (150 + 330 * Math.max(0, v)) * hScale;
    };
    const prof = [
      { r: 0, k: 0 },
      { r: 260, k: 0.5 },
      { r: 480, k: 1 },
      { r: 880, k: 0.45 },
      { r: 1300, k: 0 },
    ];
    const pts: THREE.Vector3[][] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = height(a);
      const jitter = rng.range(-40, 40);
      pts.push(prof.map((p, j) => new THREE.Vector3(Math.cos(a) * (r0 + p.r + (j === 2 ? jitter : 0)), h * p.k * (j === 2 ? rng.range(0.9, 1.1) : 1), Math.sin(a) * (r0 + p.r))));
    }
    const haze = new THREE.Color(timeOfDay === 'night' ? '#151b2b' : timeOfDay === 'dusk' ? '#8a6f7a' : '#9fb4c8');
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < prof.length - 1; j++) {
        const a = pts[i]![j]!;
        const bb = pts[i + 1]![j]!;
        const c = pts[i + 1]![j + 1]!;
        const d = pts[i]![j + 1]!;
        const y = (a.y + bb.y + c.y + d.y) / 4;
        const top = Math.max(a.y, bb.y, c.y, d.y);
        let col = y < 90 * hScale ? mix('#3e6236', '#4f6b3c', rng.next()) : y < 230 * hScale ? mix('#56603f', '#6f6a5e', rng.next()) : mix('#7a756c', '#8a857c', rng.next());
        if (top > 330 * hScale && j >= 1 && j <= 2) col = mix('#e9eef3', '#ffffff', rng.next());
        col.lerp(haze, hazeK);
        quadIn(a, bb, c, d, col);
      }
    }
  };
  ring(R0, 1, 0.12, 0);
  ring(R0 * 1.55, 1.45, 0.45, 1.3);
  root.add(b.mesh(getVCMaterial(quality, { lambert: true }), 'mountains'));
  return { root, update() {}, dispose: () => disposeProp(root) };
}

/* ------------------------------------------------------------------ */
/* Bridge                                                              */
/* ------------------------------------------------------------------ */

/** Branded pedestrian bridge spanning ~18 m over a track running along Z; stair towers at both ends. */
export function createBridge(quality: ModelQuality, timeOfDay: TimeOfDay, opts: { span?: number; text?: string } = {}): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const root = new THREE.Group();
  root.name = 'bridge';
  const span = opts.span ?? 18;
  const hx = span / 2 + 1;
  const y0 = 6.4;
  const y1 = 9.6;
  const zw = 1.9;
  const b = new MeshBuilder();
  const steel = '#2e3238';
  // Deck + roof
  b.box(0, y0 - 0.3, 0, hx * 2, 0.6, zw * 2 + 0.4, steel, {
    colorFace: (f) => (f === FACE.NY ? '#fff1d6' : undefined),
    glowFace: (f) => (f === FACE.NY ? ([0.1, 1.2] as const) : undefined),
  });
  b.box(0, y1 + 0.25, 0, hx * 2 + 0.6, 0.5, zw * 2 + 0.8, steel);
  b.box(0, y1 + 0.52, 0, hx * 2 + 0.6, 0.05, zw * 2 + 0.8, '#b6ff3b', { faces: FACE.PZ | FACE.NZ | FACE.PY, glow: [0.4, 1.5] });
  // Truss posts
  const nPost = Math.max(4, Math.round(span / 3));
  for (let i = 0; i <= nPost; i++) {
    const x = -hx + (i / nPost) * hx * 2;
    for (const z of [-zw, zw]) b.box(x, (y0 + y1) / 2, z, 0.25, y1 - y0, 0.25, steel, { faces: FACE.SIDES });
  }
  // Stair towers
  for (const s of [-1, 1]) {
    const tx = s * (hx + 3.2);
    b.boxOn(tx, 0, 0, 5.6, y1 + 0.5, 5.6, '#d9dde2', { faces: FACE.NO_BOTTOM });
    b.box(tx, y1 + 0.75, 0, 6.2, 0.5, 6.2, steel);
    b.box(tx + s * 2.81, (y1 + 0.5) / 2, 0, 0.04, y1 - 1, 3.6, '#24384d', { faces: s > 0 ? FACE.PX : FACE.NX, glow: [0.03, 1.0] });
    for (let k = 0; k < 10; k++) {
      b.box(tx, 0.4 + k * 0.62, 2.85 + 0.05, 5.0 - k * 0.3, 0.12, 0.1, '#b6ff3b', { faces: FACE.PZ, glow: k % 3 === 0 ? [0.3, 1.2] : [0, 0] });
    }
  }
  root.add(b.mesh(getVCMaterial(quality), 'bridge-structure'));

  // Banner panels on both faces
  const tb = new MeshBuilder({ uv: true });
  const bh = y1 - y0 - 0.3;
  const period = STAND_BANNER_PERIOD_M * bh;
  for (const z of [-zw - 0.14, zw + 0.14]) {
    const front = z > 0;
    const xa = front ? -hx : hx;
    const xb = -xa;
    tb.quad(
      new THREE.Vector3(xa, y0 + 0.15, z),
      new THREE.Vector3(xb, y0 + 0.15, z),
      new THREE.Vector3(xb, y0 + 0.15 + bh, z),
      new THREE.Vector3(xa, y0 + 0.15 + bh, z),
      '#ffffff',
      [0.15, 0.9],
      [0.5 - hx / period, 0, 0.5 + hx / period, 1],
    );
  }
  root.add(tb.mesh(getVCMaterial(quality, { map: getBannerTexture(opts.text ?? 'Pulse Arena') }), 'bridge-banner'));
  return { root, update() {}, dispose: () => disposeProp(root) };
}
