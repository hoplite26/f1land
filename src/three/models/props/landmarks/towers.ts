/**
 * Skyscraper cluster (Baku / Jeddah / Singapore skyline) and the Bahrain-style
 * Sakhir VIP tower.
 */
import * as THREE from 'three';
import type { TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../../types';
import { FACE, MeshBuilder, Rng, disposeProp, getVCMaterial, qPick, setPropsTimeOfDay } from '../core';
import { addPolygonCap, addPrismWalls, appendBuildings, facadeTile, getFacadeMaterial, type BuildingFootprint } from '../buildings';
import type { LandmarkModel } from './common';

function polyOutline(cx: number, cz: number, r: number, n: number, rot = 0, sx = 1, sz = 1): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    out.push(new THREE.Vector2(cx + Math.cos(a) * r * sx, cz + Math.sin(a) * r * sz));
  }
  return out;
}

/** Cluster of 10–20 skyscrapers (~130 m radius) incl. twisted, cylindrical and flame-shaped towers. */
export function createTowers(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const rng = new Rng('towers');
  const root = new THREE.Group();
  root.name = 'towers';
  const walls = new MeshBuilder({ uv: true });
  const roofs = new MeshBuilder();
  const tile = facadeTile('modern');
  const segs = qPick(quality, 10, 16, 24);

  // Twisted tower
  {
    const H = 210;
    const n = segs;
    for (let k = 0; k < n; k++) {
      const y0 = (k / n) * H;
      const y1 = ((k + 1) / n) * H;
      const o = polyOutline(-45, 25, 22, 4, Math.PI / 4 + k * (1.4 / n));
      addPrismWalls(walls, o, y0, y1, tile, '#e9f1fa', { vOffset: y0 });
      if (k === n - 1) addPolygonCap(roofs, o, y1, '#5d6670');
    }
    roofs.prim(new THREE.CylinderGeometry(0.3, 1.0, 36, 6, 1, true), { x: -45, y: H + 18, z: 25 }, '#cfd3d7');
    roofs.box(-45, H + 36.4, 25, 0.9, 0.9, 0.9, '#ff2a1a', { glow: [0.6, 3] });
  }
  // Cylindrical tower with LED crown
  {
    const H = 175;
    const o = polyOutline(55, -25, 17, qPick(quality, 10, 14, 20));
    addPrismWalls(walls, o, 0, H, tile, '#dfe9f2');
    addPolygonCap(roofs, o, H, '#5d6670');
    const ring = polyOutline(55, -25, 17.25, qPick(quality, 10, 14, 20));
    addPrismWalls(roofs, ring, H - 6, H - 4.5, { w: 1, h: 1 }, '#22d3ee', { glow: [0.3, 2.0] });
    roofs.prim(new THREE.CylinderGeometry(0.4, 1.2, 40, 6, 1, true), { x: 55, y: H + 20, z: -25 }, '#cfd3d7');
    roofs.box(55, H + 40.4, -25, 0.9, 0.9, 0.9, '#ff2a1a', { glow: [0.6, 3] });
  }
  // Three flame-shaped towers
  for (const [fx, fz, H, r] of [
    [-10, -85, 190, 20],
    [-42, -70, 160, 17],
    [24, -72, 150, 16],
  ] as const) {
    const n = segs;
    let prev: THREE.Vector2[] | null = null;
    for (let k = 0; k < n; k++) {
      const y0 = (k / n) * H;
      const y1 = ((k + 1) / n) * H;
      const t = (k + 0.5) / n;
      const s = Math.max(0.12, Math.sin(Math.PI * (0.18 + 0.82 * t)) * (1 - t * 0.6));
      const o = polyOutline(fx + t * 6, fz - t * 4, r * s, qPick(quality, 8, 10, 14), 0, 1, 0.75);
      addPrismWalls(walls, o, y0, y1, tile, '#d8e6f3', { vOffset: y0 });
      prev = o;
    }
    if (prev) addPolygonCap(roofs, prev, H, '#5d6670', { glow: [0.1, 1.2] });
  }
  // Regular towers around
  const fps: BuildingFootprint[] = [];
  const n = qPick(quality, 8, 12, 16);
  const taken: [number, number, number][] = [
    [-45, 25, 34],
    [55, -25, 24],
    [-10, -78, 40],
  ];
  for (let i = 0; i < n * 4 && fps.length < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(30, 135);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const w = rng.range(18, 32);
    if (taken.some(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) < tr + w * 0.8)) continue;
    taken.push([x, z, w * 0.8]);
    fps.push({ x, z, w, d: w * rng.range(0.7, 1.25), h: rng.range(55, 150) * (1.2 - d / 200), rot: rng.range(-0.4, 0.4) });
  }
  appendBuildings(walls, roofs, fps, 'modern', quality, rng, true);

  root.add(walls.mesh(getFacadeMaterial('modern', quality), 'towers-glass'));
  root.add(roofs.mesh(getVCMaterial(quality), 'towers-roofs'));
  return { root, update() {}, dispose: () => disposeProp(root) };
}

/** Bahrain-style VIP tower: slim shaft, flaring glazed floors, tented crown. */
export function createSakhirTower(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const root = new THREE.Group();
  root.name = 'sakhir-tower';
  const b = new MeshBuilder();
  const seg = qPick(quality, 16, 24, 36);
  const V = (r: number, y: number) => new THREE.Vector2(r, y);
  const sand = '#e6d6b8';
  // Base + shaft
  b.prim(new THREE.LatheGeometry([V(8, 0), V(8, 3.5), V(6.5, 4.2), V(5.4, 4.6), V(5.4, 18.5), V(6.8, 19.5)], seg), { x: 0, y: 0, z: 0 }, sand);
  // Vertical window slits on the shaft
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(Math.cos(a) * 5.42, 11.5, Math.sin(a) * 5.42, 0.9, 12, 0.08, '#24384d', { ry: -a + Math.PI / 2, glow: [0.02, 1.0], faces: FACE.PZ | FACE.NZ });
  }
  // Glazed flaring floors with lighter slab bands
  const bowl = [V(6.8, 19.5), V(9.5, 22), V(12.2, 25), V(14, 28), V(14.8, 31), V(15, 34), V(14.2, 36.2)];
  for (let i = 0; i < bowl.length - 1; i++) {
    const g = new THREE.LatheGeometry([bowl[i]!, bowl[i + 1]!], seg);
    b.prim(g, { x: 0, y: 0, z: 0 }, '#2a4864', { glow: [0.03, 1.2] });
    const slab = new THREE.LatheGeometry([V(bowl[i + 1]!.x + 0.25, bowl[i + 1]!.y - 0.25), V(bowl[i + 1]!.x + 0.25, bowl[i + 1]!.y + 0.25)], seg);
    b.prim(slab, { x: 0, y: 0, z: 0 }, '#f1ece2');
  }
  // Tented crown
  b.prim(new THREE.LatheGeometry([V(14.2, 36.2), V(17, 37), V(17, 37.7), V(10, 41), V(3, 46), V(0.2, 48)], seg), { x: 0, y: 0, z: 0 }, '#f7f5f0');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.beam(new THREE.Vector3(Math.cos(a) * 17, 37.6, Math.sin(a) * 17), new THREE.Vector3(0, 48, 0), 0.25, 0.25, '#d9d4c8');
  }
  b.prim(new THREE.CylinderGeometry(0.15, 0.35, 10, 6, 1, true), { x: 0, y: 53, z: 0 }, '#cfd3d7');
  b.box(0, 58.2, 0, 0.6, 0.6, 0.6, '#ff2a1a', { glow: [0.6, 3] });
  b.prim(new THREE.CylinderGeometry(17.1, 17.1, 0.25, seg, 1, true), { x: 0, y: 37.3, z: 0 }, '#b6ff3b', { glow: [0.3, 1.6] });
  // VIP pavilion + flags
  b.boxOn(0, 0, -20, 70, 7, 18, sand, { faces: FACE.NO_BOTTOM });
  b.box(0, 4.2, -10.95, 66, 3.2, 0.1, '#24384d', { faces: FACE.PZ, glow: [0.03, 1.1] });
  b.box(0, 7.3, -18, 74, 0.6, 24, '#f4efe4');
  for (let i = 0; i < 5; i++) {
    const x = -20 + i * 10;
    b.boxOn(x, 0, 6, 0.15, 14, 0.15, '#d9dde1', { faces: FACE.SIDES });
    b.box(x + 1.1, 13, 6, 2.2, 1.4, 0.04, ['#ce1126', '#ffffff', '#ce1126', '#b6ff3b', '#ce1126'][i]!);
  }
  root.add(b.mesh(getVCMaterial(quality), 'sakhir-tower'));
  return { root, update() {}, dispose: () => disposeProp(root) };
}
