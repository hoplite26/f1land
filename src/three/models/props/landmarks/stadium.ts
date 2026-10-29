/**
 * Foro Sol-style bowl stadium: horseshoe of stands open towards +X (the track
 * runs through the arena), painted seat rows + instanced crowd facing the
 * centre, partial roof, big screens and floodlight masts.
 */
import * as THREE from 'three';
import type { TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../../types';
import { TEAMS } from '@/data/teams';
import { FACE, MeshBuilder, Rng, disposeProp, getVCMaterial, qPick, setPropsTimeOfDay } from '../core';
import { createCrowd } from '../crowd';
import { STAND_SEAT_PERIOD_M, getBigScreenTexture, getGrandstandTexture } from '../textures';
import type { LandmarkModel } from './common';

const A = 74;
const B = 54;
const ROW_D = 0.9;
const RISE = 0.48;
const Y0 = 2.2;

export function createStadium(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const rng = new Rng('stadium');
  const root = new THREE.Group();
  root.name = 'stadium';
  const rows = qPick(quality, 14, 18, 24);
  const segs = qPick(quality, 36, 56, 84);
  const a0 = Math.PI * 0.2;
  const a1 = Math.PI * 1.8;
  const sb = new MeshBuilder();
  const tb = new MeshBuilder({ uv: true });
  const palette = TEAMS.map((t) => t.color);
  const P = (a: number, k: number, y: number) => new THREE.Vector3(Math.cos(a) * (A + k), y, Math.sin(a) * (B + k));

  const yRow = (i: number) => Y0 + i * RISE;
  const kRow = (i: number) => 1 + i * ROW_D;
  const kBack = kRow(rows) + 1.5;
  const yTop = yRow(rows) + 1.2;
  let arc = 0;
  for (let s = 0; s < segs; s++) {
    const aa = a0 + ((a1 - a0) * s) / segs;
    const ab = a0 + ((a1 - a0) * (s + 1)) / segs;
    const segLen = P(aa, kRow(rows / 2), 0).distanceTo(P(ab, kRow(rows / 2), 0));
    const off = rng.range(0, STAND_SEAT_PERIOD_M);
    for (let i = 0; i < rows; i++) {
      const y = yRow(i);
      const k0 = kRow(i);
      const k1 = kRow(i + 1);
      // Tread (top) + riser (facing the centre)
      sb.quad(P(aa, k0, y), P(ab, k0, y), P(ab, k1, y), P(aa, k1, y), '#a7a29a', [0, 0.08]);
      sb.quad(P(aa, k1, y), P(ab, k1, y), P(ab, k1, y + RISE), P(aa, k1, y + RISE), '#8c877f');
      // Painted seat row billboard
      const ks = k0 + 0.62;
      tb.quad(
        P(aa, ks, y),
        P(ab, ks, y),
        P(ab, ks, y + 1.0),
        P(aa, ks, y + 1.0),
        '#ffffff',
        [0, 0.3],
        [(arc + off) / STAND_SEAT_PERIOD_M, 0.004, (arc + segLen + off) / STAND_SEAT_PERIOD_M, 0.496],
      );
    }
    arc += segLen;
    // Front wall (facing the centre) with LED ribbon
    sb.quad(P(aa, 0, 0), P(ab, 0, 0), P(ab, 0, Y0 + 0.9), P(aa, 0, Y0 + 0.9), '#24282d');
    sb.quad(P(aa, -0.02, Y0 - 0.4), P(ab, -0.02, Y0 - 0.4), P(ab, -0.02, Y0 + 0.2), P(aa, -0.02, Y0 + 0.2), s % 4 < 2 ? '#b6ff3b' : '#22d3ee', [0.4, 1.4]);
    sb.quad(P(aa, 0, Y0 + 0.9), P(ab, 0, Y0 + 0.9), P(ab, 1, Y0 + 0.9), P(aa, 1, Y0 + 0.9), '#bdb8ae');
    // Back wall (outside)
    sb.quad(P(ab, kBack, 0), P(aa, kBack, 0), P(aa, kBack, yTop), P(ab, kBack, yTop), '#d9dde2');
    sb.quad(P(aa, kRow(rows), yRow(rows)), P(ab, kRow(rows), yRow(rows)), P(ab, kBack, yRow(rows)), P(aa, kBack, yRow(rows)), '#a7a29a');
    sb.quad(P(aa, kBack - 0.05, yRow(rows)), P(ab, kBack - 0.05, yRow(rows)), P(ab, kBack - 0.05, yTop), P(aa, kBack - 0.05, yTop), '#cfd4d9');
    // Roof canopy over the top third
    {
      const ry = yTop + 6;
      const kIn = kRow(Math.floor(rows * 0.55));
      sb.quad(P(aa, kIn, ry + 1.2), P(ab, kIn, ry + 1.2), P(ab, kBack + 1, ry), P(aa, kBack + 1, ry), '#eef1f4');
      sb.quad(P(ab, kIn, ry + 1.15), P(aa, kIn, ry + 1.15), P(aa, kBack + 1, ry - 0.05), P(ab, kBack + 1, ry - 0.05), '#c4cad1', [0.05, 0.6]);
      if (s % 3 === 0) {
        const base = P(aa, kBack + 0.6, 0);
        sb.box(base.x, (ry + 1) / 2, base.z, 0.6, ry + 1, 0.6, '#59616b', { faces: FACE.SIDES });
      }
    }
  }
  // End caps
  for (const a of [a0, a1]) {
    const pts: THREE.Vector3[] = [P(a, 0, 0), P(a, kBack, 0), P(a, kBack, yTop), P(a, kRow(rows), yTop), P(a, 0, Y0 + 0.9)];
    const n = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(a === a0 ? -1 : 1);
    for (let k = 1; k < pts.length - 1; k++) {
      const p0 = pts[0]!;
      const p1 = pts[k]!;
      const p2 = pts[k + 1]!;
      const nn = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
      if (nn.dot(n) >= 0) sb.tri(p0, p1, p2, '#bdb8ae');
      else sb.tri(p0, p2, p1, '#bdb8ae');
    }
  }
  // Floodlight masts
  for (const a of [Math.PI * 0.45, Math.PI * 0.85, Math.PI * 1.15, Math.PI * 1.55]) {
    const p = P(a, kBack + 6, 0);
    sb.box(p.x, 24, p.z, 1.0, 48, 1.0, '#8a9097', { faces: FACE.SIDES });
    const toC = Math.atan2(-p.x, -p.z);
    sb.box(p.x, 48.5, p.z, 7, 3.5, 0.6, '#2b2f34', { ry: toC });
    const f = new THREE.Vector3(Math.sin(toC), 0, Math.cos(toC)).multiplyScalar(0.32);
    sb.box(p.x + f.x, 48.5, p.z + f.z, 6.4, 2.9, 0.02, '#f4f7ff', { ry: toC, faces: FACE.PZ, glow: [0.1, 3.2] });
  }
  root.add(sb.mesh(getVCMaterial(quality, { side: THREE.FrontSide }), 'stadium-structure'));
  root.add(tb.mesh(getVCMaterial(quality, { map: getGrandstandTexture('#c62828', palette, 0.9), alphaTest: 0.5 }), 'stadium-seats'));

  // Big screens at the open ends
  const scr = getBigScreenTexture(palette);
  const scrMat = new THREE.MeshBasicMaterial({ map: scr, toneMapped: false });
  scrMat.userData.owned = true;
  for (const a of [a0 + 0.15, a1 - 0.15]) {
    const p = P(a, kBack + 2, yTop + 8);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(18, 30), scrMat);
    plane.scale.set(1, 0.33, 1);
    plane.position.copy(p);
    plane.lookAt(0, p.y, 0);
    root.add(plane);
  }

  // Crowd facing the centre
  const density = qPick(quality, 0.06, 0.12, 0.45);
  const seats: number[] = [];
  const facing: number[] = [];
  for (let i = 0; i < rows; i++) {
    const k = kRow(i) + 0.32;
    const y = yRow(i);
    const per = (((A + B) / 2 + k) * (a1 - a0)) / 0.55;
    for (let j = 0; j < per; j++) {
      if (rng.next() > density * 0.9) continue;
      const a = a0 + ((a1 - a0) * (j + rng.range(0.2, 0.8))) / per;
      const p = P(a, k, y);
      seats.push(p.x, p.y, p.z);
      facing.push(Math.atan2(-p.x, -p.z));
    }
  }
  const crowd = createCrowd({ seats: new Float32Array(seats), facing: new Float32Array(facing), palette, quality });
  crowd.setExcitement(0.45);
  root.add(crowd.mesh);

  return {
    root,
    update(t: number) {
      crowd.update(t);
    },
    dispose() {
      crowd.dispose();
      disposeProp(root);
    },
  };
}
