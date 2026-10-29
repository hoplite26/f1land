/**
 * Pit building: garage row with lit team-coloured boxes, cantilevered glass
 * Paddock Club floors, roof signage, race-control tower, F1-style big screen,
 * and the pit wall with team timing stands.
 *
 * Local frame: garage row along X centred at 0, garage fronts at z = 0 facing
 * the pit lane on +Z. Working lane z ≈ 0.8–5.8, fast lane ≈ 6–12, pit wall at
 * z = 13–13.8. Draw calls: structure, glass, signage, screen (+0 per team).
 */
import * as THREE from 'three';
import type { ModelQuality } from '../types';
import { FACE, MeshBuilder, disposeProp, getVCMaterial, qPick, Rng } from './core';
import { addPrismWalls, facadeTile, getFacadeMaterial, rectOutline } from './buildings';
import { SCREEN_PAGES, brandTileUV, getBigScreenTexture, getBrandAtlas } from './textures';

export interface PitComplexOptions {
  lengthM: number;
  boxes: number;
  teamColors: string[];
  quality: ModelQuality;
}

export interface PitComplexModel {
  root: THREE.Group;
  /** Garage box centres (local X) in order, for placing cars / crews. */
  boxCentersX: number[];
  /** Width of one garage box (m). */
  boxWidthM: number;
  update(t: number): void;
  dispose(): void;
}

export const PIT_WALL_Z = 13;
const DEPTH = 22;

export function createPitComplex(spec: PitComplexOptions): PitComplexModel {
  const L = Math.max(60, spec.lengthM);
  const B = Math.max(1, Math.round(spec.boxes));
  const q = spec.quality;
  const colors = spec.teamColors.length ? spec.teamColors : ['#e10600'];
  const rng = new Rng(`pit-${L}-${B}`);
  const gW = Math.min(18, (L * 0.8) / B);
  const gTotal = gW * B;
  const gx0 = -gTotal / 2;
  const hx = L / 2;
  const root = new THREE.Group();
  root.name = 'pit-complex';

  const s = new MeshBuilder();
  const glass = new MeshBuilder({ uv: true });
  const sign = new MeshBuilder({ uv: true });
  const white = '#e9edf1';
  const grey = '#c3c9cf';
  const dark = '#2b3036';
  const boxCentersX: number[] = [];

  // ---- Ground floor: garages --------------------------------------------
  const gfH = 6;
  const doorH = 4.9;
  const inner = -9;
  for (let i = 0; i < B; i++) {
    const xa = gx0 + i * gW;
    const xb = xa + gW;
    const xc = (xa + xb) / 2;
    boxCentersX.push(xc);
    const team = colors[i % colors.length]!;
    const teamDark = new THREE.Color(team).multiplyScalar(0.35);
    // Pillars
    s.box(xa, gfH / 2, -0.6, 1.0, gfH, 1.2, white, { faces: FACE.NO_BOTTOM });
    // Header fascia
    s.box(xc, (doorH + gfH) / 2, -0.25, gW - 1.0, gfH - doorH, 0.5, team, {
      colorFace: (f) => (f === FACE.NY ? '#dfe3e7' : undefined),
      glow: [0.12, 0.35],
    });
    s.box(xc, doorH + 0.12, 0.01, gW - 1.0, 0.1, 0.02, '#ffffff', { faces: FACE.PZ, glow: [0.3, 0.8] });
    // Interior (lit)
    const iw = gW - 1.0;
    s.quad(
      new THREE.Vector3(xa + 0.5, 0, inner),
      new THREE.Vector3(xb - 0.5, 0, inner),
      new THREE.Vector3(xb - 0.5, doorH, inner),
      new THREE.Vector3(xa + 0.5, doorH, inner),
      '#f4f6f8',
      [0.35, 0.75],
    );
    s.box(xc, 0.9, inner + 0.3, iw - 0.6, 1.8, 0.6, teamDark, { faces: FACE.PZ | FACE.PY, glow: [0.05, 0.2] });
    s.box(xc, 2.6, inner + 0.02, iw, 0.5, 0.04, team, { faces: FACE.PZ, glow: [0.3, 0.8] });
    for (const sx of [xa + 0.5, xb - 0.5]) {
      const facing = sx < xc ? 1 : -1;
      const p0 = new THREE.Vector3(sx, 0, 0 - 1.2);
      const p1 = new THREE.Vector3(sx, 0, inner);
      const p2 = new THREE.Vector3(sx, doorH, inner);
      const p3 = new THREE.Vector3(sx, doorH, -1.2);
      if (facing > 0) s.quad(p1, p0, p3, p2, '#dde2e7', [0.18, 0.4]);
      else s.quad(p0, p1, p2, p3, '#dde2e7', [0.18, 0.4]);
    }
    s.quad(
      new THREE.Vector3(xa + 0.5, doorH, -0.2),
      new THREE.Vector3(xb - 0.5, doorH, -0.2),
      new THREE.Vector3(xb - 0.5, doorH, inner),
      new THREE.Vector3(xa + 0.5, doorH, inner),
      '#cfd5db',
      [0.1, 0.25],
    );
    for (let k = 0; k < 3; k++) {
      s.box(xc, doorH - 0.03, inner + 1.5 + k * 2.6, iw * 0.8, 0.04, 0.35, '#ffffff', { faces: FACE.NY, glow: [1.4, 2.0] });
    }
    s.quad(
      new THREE.Vector3(xa + 0.5, 0.015, 0),
      new THREE.Vector3(xb - 0.5, 0.015, 0),
      new THREE.Vector3(xb - 0.5, 0.015, inner),
      new THREE.Vector3(xa + 0.5, 0.015, inner),
      '#6b7178',
      [0.06, 0.18],
    );
    // Tyre stacks + tool carts
    if (q !== 'low') {
      for (let k = 0; k < 2; k++) {
        const tx = xa + 1.5 + k * 0.8;
        s.prim(new THREE.CylinderGeometry(0.33, 0.33, 1.2, 8), { x: tx, y: 0.6, z: inner + 2 }, '#18191b');
      }
      s.boxOn(xb - 2, 0, inner + 1.5, 1.2, 1.1, 0.6, team, { glow: [0.05, 0.1] });
    }
  }
  s.box(gx0 + gTotal, gfH / 2, -0.6, 1.0, gfH, 1.2, white, { faces: FACE.NO_BOTTOM });
  // Back wall of garages + end blocks (solid ground floor)
  s.box(0, gfH / 2, -DEPTH / 2 - 0.5, gTotal, gfH, DEPTH - 1, grey, { faces: FACE.NZ });
  for (const side of [-1, 1]) {
    const xs = side < 0 ? -hx : gx0 + gTotal;
    const xe = side < 0 ? gx0 : hx;
    if (xe - xs < 1) continue;
    addPrismWalls(glass, rectOutline((xs + xe) / 2, -DEPTH / 2, xe - xs, DEPTH, 0), 0, gfH, facadeTile('modern'), '#ffffff', {
      vOffset: 0,
    });
  }

  // ---- Canopy slab over the pit lane --------------------------------------
  const slabY = gfH;
  s.box(0, slabY + 0.35, (4 - DEPTH) / 2, L + 1, 0.7, DEPTH + 4, white, {
    colorFace: (f) => (f === FACE.NY ? '#d5dadf' : undefined),
  });
  for (const z of [1.2, 3.0]) s.box(0, slabY - 0.02, z, L - 2, 0.05, 0.25, '#ffffff', { faces: FACE.NY, glow: [0.8, 2.0] });
  // Balcony glass balustrade + handrail
  s.box(0, slabY + 1.25, 3.9, L, 1.1, 0.06, '#86aabf', { glow: [0.05, 0.12] });
  s.box(0, slabY + 1.82, 3.9, L, 0.06, 0.1, '#e8eaec');

  // ---- Upper floors: glass curtain walls ---------------------------------
  const f1 = [slabY + 0.7, 10.5] as const;
  const f2 = [10.5, 14.3] as const;
  const tile = facadeTile('modern');
  addPrismWalls(glass, rectOutline(0, -DEPTH / 2, L, DEPTH, 0), f1[0], f1[1], tile, '#ffffff');
  addPrismWalls(glass, rectOutline(0, -DEPTH / 2 + 1, L, DEPTH + 2, 0), f2[0] + 0.5, f2[1], tile, '#eef4ff', { vOffset: 1.8 });
  s.box(0, f2[0] + 0.25, -DEPTH / 2 + 1, L + 0.4, 0.5, DEPTH + 2.4, white);
  // Fins
  const finStep = qPick(q, 12, 6, 4);
  for (let x = -hx; x <= hx + 0.01; x += finStep) {
    s.box(x, (f1[0] + f2[1]) / 2, 2.2, 0.25, f2[1] - f1[0], 0.6, white);
  }
  // Roof
  const roofY = f2[1];
  s.box(0, roofY + 0.4, -DEPTH / 2 + 0.5, L + 3, 0.8, DEPTH + 6, white, {
    colorFace: (f) => (f === FACE.PY ? '#9ea5ac' : f === FACE.NY ? '#d9dee3' : undefined),
  });
  s.box(0, roofY + 0.04, 3.4, L + 2, 0.06, 0.2, '#b6ff3b', { faces: FACE.PZ | FACE.NY, glow: [0.4, 1.6] });
  // Rooftop plant
  const units = qPick(q, 4, 8, 12);
  for (let k = 0; k < units; k++) {
    s.boxOn(rng.range(-hx + 6, hx - 30), roofY + 0.8, rng.range(-DEPTH + 4, -6), rng.range(2, 5), rng.range(1.2, 2.4), rng.range(2, 4), '#a3aab1', {
      faces: FACE.NO_BOTTOM,
    });
  }

  // ---- Race control tower (+X end) --------------------------------------
  const rcX = hx - 14;
  const rcW = Math.min(22, L * 0.12);
  addPrismWalls(glass, rectOutline(rcX, -8, rcW, 14, 0), roofY + 0.8, roofY + 9, tile, '#d8ecff', { vOffset: 0.6 });
  s.box(rcX, roofY + 9.3, -8, rcW + 2, 0.6, 16, white);
  s.box(rcX + rcW / 2 - 2, roofY + 13, -10, 0.2, 7, 0.2, '#c0c4c8');
  s.box(rcX + rcW / 2 - 2, roofY + 16.6, -10, 0.5, 0.5, 0.5, '#ff2a1a', { glow: [0.5, 3] });
  s.box(rcX, roofY + 9.62, -1.2, rcW + 2, 0.1, 0.15, '#b6ff3b', { glow: [0.4, 1.5] });

  // ---- Rooftop sign ------------------------------------------------------
  const signW = Math.min(36, L * 0.3);
  const signX = -signW / 2 - 6;
  const sy0 = roofY + 1.6;
  const sy1 = sy0 + signW / 8;
  for (let k = 0; k < 2; k++) {
    const xa = signX - signW / 2 + (k * signW) / 2;
    sign.quad(
      new THREE.Vector3(xa, sy0, 1.0),
      new THREE.Vector3(xa + signW / 2, sy0, 1.0),
      new THREE.Vector3(xa + signW / 2, sy1, 1.0),
      new THREE.Vector3(xa, sy1, 1.0),
      '#ffffff',
      [0.25, 1.1],
      brandTileUV(k === 0 ? 0 : 14),
    );
  }
  s.box(signX, (sy0 + sy1) / 2, 0.8, signW + 0.6, sy1 - sy0 + 0.6, 0.3, dark);
  for (const dx of [-signW / 3, 0, signW / 3]) s.box(signX + dx, (roofY + 0.8 + sy0) / 2, 0.6, 0.2, sy0 - roofY - 0.8, 0.2, '#555b62');

  // ---- Big screen -------------------------------------------------------
  const scrW = 16;
  const scrH = 9;
  const scrX = -hx + scrW / 2 + 6;
  const scrY0 = roofY + 3;
  s.box(scrX, scrY0 + scrH / 2, -1.4, scrW + 0.8, scrH + 0.8, 0.8, '#121417');
  for (const dx of [-scrW / 3, scrW / 3]) {
    s.box(scrX + dx, (roofY + 0.8 + scrY0) / 2, -1.8, 0.4, scrY0 - roofY - 0.8, 0.4, '#3a3f45');
    s.beam(new THREE.Vector3(scrX + dx, roofY + 0.8, -6), new THREE.Vector3(scrX + dx, scrY0 + scrH * 0.7, -1.9), 0.25, 0.25, '#3a3f45');
  }
  const screenTex = getBigScreenTexture(colors).clone();
  screenTex.repeat.set(1, 1 / SCREEN_PAGES);
  screenTex.offset.set(0, 1 - 1 / SCREEN_PAGES);
  screenTex.needsUpdate = true;
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
  screenMat.color.setScalar(0.92);
  screenMat.userData.owned = true;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(scrW, scrH), screenMat);
  screen.position.set(scrX, scrY0 + scrH / 2, -0.98);
  screen.name = 'pit-screen';
  root.add(screen);

  // ---- Pit wall + timing stands ------------------------------------------
  const wz = PIT_WALL_Z;
  s.box(0, 0.55, wz + 0.4, L + 30, 1.1, 0.8, '#eceff2', {
    colorFace: (f) => (f === FACE.PY ? '#b6ff3b' : undefined),
    glow: [0, 0],
    glowFace: (f) => (f === FACE.PY ? ([0.25, 0.8] as const) : undefined),
  });
  for (let i = 0; i < B; i++) {
    const xc = boxCentersX[i]!;
    const team = colors[i % colors.length]!;
    const w = Math.min(6, gW * 0.5);
    s.boxOn(xc, 0, wz - 1.1, w, 0.5, 2.2, '#3a3f46', { faces: FACE.NO_BOTTOM });
    for (const dx of [-w / 2 + 0.2, w / 2 - 0.2]) s.boxOn(xc + dx, 0.5, wz - 0.3, 0.12, 2.8, 0.12, '#30353b', { faces: FACE.SIDES });
    s.box(xc, 3.4, wz - 1.0, w + 0.4, 0.25, 2.8, team, { glow: [0.08, 0.3] });
    s.box(xc, 3.25, wz - 1.0, w, 0.05, 2.4, '#ffffff', { faces: FACE.NY, glow: [0.4, 1.2] });
    // Monitor bank (lit) facing the pit lane side
    s.box(xc, 1.75, wz - 0.25, w - 0.6, 0.6, 0.1, '#0b1220', {
      colorFace: (f) => (f === FACE.NZ ? '#3a7bd5' : undefined),
      glowFace: (f) => (f === FACE.NZ ? ([0.6, 1.0] as const) : undefined),
    });
    if (q !== 'low') {
      for (let k = 0; k < 3; k++) s.boxOn(xc - w / 3 + (k * w) / 3, 0.5, wz - 1.2, 0.45, 0.75, 0.45, '#222');
    }
  }

  root.add(s.mesh(getVCMaterial(q), 'pit-structure'));
  root.add(glass.mesh(getFacadeMaterial('modern', q), 'pit-glass'));
  root.add(sign.mesh(getVCMaterial(q, { map: getBrandAtlas() }), 'pit-sign'));

  let page = 0;
  return {
    root,
    boxCentersX,
    boxWidthM: gW,
    update(t: number) {
      const p = Math.floor(t / 6) % SCREEN_PAGES;
      if (p !== page) {
        page = p;
        screenTex.offset.y = 1 - (p + 1) / SCREEN_PAGES;
      }
    },
    dispose() {
      screenTex.dispose();
      disposeProp(root);
    },
  };
}

/**
 * Painted pit-box markings on the working lane (same local frame as
 * `createPitComplex`): white box outlines, team-tinted fill, yellow stop line.
 */
export function createPitBoxMarkings(spec: {
  lengthM: number;
  boxes: number;
  teamColors: string[];
  quality: ModelQuality;
  laneZ0?: number;
  laneZ1?: number;
}): THREE.Mesh {
  const L = Math.max(60, spec.lengthM);
  const B = Math.max(1, Math.round(spec.boxes));
  const gW = Math.min(18, (L * 0.8) / B);
  const gx0 = -(gW * B) / 2;
  const z0 = spec.laneZ0 ?? 0.8;
  const z1 = spec.laneZ1 ?? 5.8;
  const colors = spec.teamColors.length ? spec.teamColors : ['#e10600'];
  const b = new MeshBuilder();
  const y = 0.02;
  const line = (xa: number, za: number, xb: number, zb: number, c: string) =>
    b.quad(new THREE.Vector3(xa, y, zb), new THREE.Vector3(xb, y, zb), new THREE.Vector3(xb, y, za), new THREE.Vector3(xa, y, za), c);
  for (let i = 0; i < B; i++) {
    const xa = gx0 + i * gW + 1.5;
    const xb = xa + gW - 3;
    const team = new THREE.Color(colors[i % colors.length]!).multiplyScalar(0.55);
    b.quad(new THREE.Vector3(xa, y - 0.004, z1), new THREE.Vector3(xb, y - 0.004, z1), new THREE.Vector3(xb, y - 0.004, z0), new THREE.Vector3(xa, y - 0.004, z0), team);
    const t = 0.14;
    line(xa, z0, xb, z0 + t, '#f2f2f2');
    line(xa, z1 - t, xb, z1, '#f2f2f2');
    line(xa, z0, xa + t, z1, '#f2f2f2');
    line(xb - t, z0, xb, z1, '#f2f2f2');
    line(xa + gW * 0.62, z0 + 0.4, xa + gW * 0.62 + 0.25, z1 - 0.4, '#ffd400');
  }
  return b.mesh(getVCMaterial(spec.quality, { polygonOffset: -2 }), 'pit-markings');
}
