/**
 * Ferris wheel (~60 m): rotating rims/spokes with rainbow LED rings, A-frame
 * legs, boarding station, and upright gondolas (instanced, re-posed per frame).
 * Wheel plane = XY (faces ±Z), base at y = 0.
 */
import * as THREE from 'three';
import type { TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../../types';
import { FACE, MeshBuilder, disposeProp, getVCMaterial, qPick, setPropsTimeOfDay } from '../core';
import type { LandmarkModel } from './common';

const R = 30;
const HUB_Y = 34;
const PIVOT_R = R + 2.6;
const GONDOLA_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];

export function createFerrisWheel(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const root = new THREE.Group();
  root.name = 'ferris-wheel';
  const spokes = qPick(quality, 16, 24, 32);
  const nG = qPick(quality, 16, 24, 32);
  const tubular = qPick(quality, 32, 56, 80);

  // ---- Rotating wheel ----
  const wb = new MeshBuilder();
  for (const z of [-2.6, 2.6]) {
    const rim = new THREE.TorusGeometry(R, 0.38, qPick(quality, 4, 5, 6), tubular);
    wb.geometry(rim, new THREE.Matrix4().makeTranslation(0, 0, z), '#eef1f4', [0, 0.15]);
    rim.dispose();
    const led = new THREE.TorusGeometry(R + 0.5, 0.13, 3, tubular);
    const c = new THREE.Color();
    wb.geometry(led, new THREE.Matrix4().makeTranslation(0, 0, z), '#ffffff', [0.25, 2.2], {
      vertexColorFn: (p) => c.setHSL(((Math.atan2(p.y, p.x) / (Math.PI * 2)) % 1 + 1) % 1, 0.9, 0.55).clone(),
    });
    led.dispose();
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      wb.beam(new THREE.Vector3(0, 0, z * 0.5).addScaledVector(dir, 1.8), new THREE.Vector3(0, 0, z).addScaledVector(dir, R), 0.14, 0.14, '#dfe3e8', {
        glow: [0, 0.5],
      });
    }
  }
  for (let i = 0; i < nG; i++) {
    const a = (i / nG) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const p = dir.clone().multiplyScalar(R);
    wb.beam(p.clone().setZ(-2.6), p.clone().setZ(2.6), 0.22, 0.22, '#c9ced4');
    // Gondola hanger arms out to the pivot.
    const pivot = dir.clone().multiplyScalar(PIVOT_R);
    for (const z of [-2.6, 2.6]) wb.beam(p.clone().setZ(z), pivot.clone().setZ(z * 0.55), 0.12, 0.12, '#c9ced4');
  }
  wb.prim(new THREE.CylinderGeometry(2.2, 2.2, 6.4, 12), { x: 0, y: 0, z: 0 }, '#9aa1a8', { rot: new THREE.Euler(Math.PI / 2, 0, 0) });
  wb.prim(new THREE.CylinderGeometry(1.0, 1.0, 6.6, 8), { x: 0, y: 0, z: 0 }, '#b6ff3b', { rot: new THREE.Euler(Math.PI / 2, 0, 0), glow: [0.3, 1.5] });
  const wheel = wb.mesh(getVCMaterial(quality), 'ferris-wheel-rim');
  wheel.matrixAutoUpdate = true;
  wheel.position.set(0, HUB_Y, 0);
  root.add(wheel);

  // ---- Static legs + station ----
  const sb = new MeshBuilder();
  for (const z of [-1, 1]) {
    for (const x of [-1, 1]) {
      sb.beam(new THREE.Vector3(x * 17, 0, z * 9), new THREE.Vector3(x * 0.8, HUB_Y, z * 3.6), 1.0, 1.0, '#e6e9ec');
    }
    sb.beam(new THREE.Vector3(-9, HUB_Y * 0.45, z * 6.6), new THREE.Vector3(9, HUB_Y * 0.45, z * 6.6), 0.5, 0.5, '#d4d8dc');
  }
  sb.box(0, 0.4, 0, 22, 0.8, 22, '#9aa0a6', { faces: FACE.NO_BOTTOM });
  sb.box(0, 2.2, -8, 16, 4.4, 6, '#f2f4f6', { faces: FACE.NO_BOTTOM });
  sb.box(0, 4.6, -8, 18, 0.4, 8, '#e11d48', { glow: [0.05, 0.4] });
  sb.box(0, 2.2, -4.98, 14, 2.4, 0.04, '#1b2836', { faces: FACE.PZ, glow: [0, 0.8] });
  root.add(sb.mesh(getVCMaterial(quality), 'ferris-wheel-base'));

  // ---- Gondolas ----
  const gb = new MeshBuilder({ tint: true });
  gb.tint = 1;
  gb.prim(new THREE.CylinderGeometry(1.25, 1.1, 1.0, qPick(quality, 6, 8, 10)), { x: 0, y: -0.6, z: 0 }, '#ffffff');
  gb.prim(new THREE.ConeGeometry(1.35, 0.7, qPick(quality, 6, 8, 10)), { x: 0, y: 1.25, z: 0 }, '#ffffff');
  gb.tint = 0;
  gb.prim(new THREE.CylinderGeometry(1.2, 1.2, 1.0, qPick(quality, 6, 8, 10), 1, true), { x: 0, y: 0.4, z: 0 }, '#9fd3ff', { glow: [0.05, 1.1] });
  gb.box(0, 1.9, 0, 0.12, 0.8, 0.12, '#bfc4c9');
  const gGeo = gb.build();
  const gondolas = new THREE.InstancedMesh(gGeo, getVCMaterial(quality, { tint: true }), nG);
  for (let i = 0; i < nG; i++) gondolas.setColorAt(i, new THREE.Color(GONDOLA_COLORS[i % GONDOLA_COLORS.length]!));
  gondolas.name = 'ferris-gondolas';
  root.add(gondolas);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const pose = (t: number) => {
    const ang = (t / 240) * Math.PI * 2;
    wheel.rotation.z = ang;
    for (let i = 0; i < nG; i++) {
      const a = (i / nG) * Math.PI * 2 + ang;
      p.set(Math.cos(a) * PIVOT_R, HUB_Y + Math.sin(a) * PIVOT_R - 1.9, 0);
      e.set(0, 0, Math.sin(t * 0.9 + i) * 0.04);
      m.compose(p, q.setFromEuler(e), one);
      gondolas.setMatrixAt(i, m);
    }
    gondolas.instanceMatrix.needsUpdate = true;
  };
  pose(0);
  if (gondolas.instanceColor) gondolas.instanceColor.needsUpdate = true;
  gondolas.computeBoundingSphere();
  if (gondolas.boundingSphere) gondolas.boundingSphere.radius += 4;

  return {
    root,
    update: pose,
    dispose() {
      disposeProp(root);
    },
  };
}
