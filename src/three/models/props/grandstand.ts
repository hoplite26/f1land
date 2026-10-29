/**
 * Grandstand: stepped concrete/steel stand with coloured seat rows, aisles,
 * front parapet + sponsor banner, optional cable-stayed roof, and an
 * instanced crowd. 3 draw calls (structure, textured seats/banner, crowd).
 *
 * Local frame: runs along X centred at 0, spectators face +Z, front edge at
 * z = 0, tiers rise towards −Z.
 */
import * as THREE from 'three';
import type { ModelQuality } from '../types';
import { FACE, MeshBuilder, Rng, getVCMaterial, hashSeed, qPick, disposeProp } from './core';
import { createCrowd, type CrowdModelExt } from './crowd';
import { STAND_BANNER_PERIOD_M, STAND_SEAT_PERIOD_M, getGrandstandTexture } from './textures';

export interface GrandstandOptions {
  lengthM: number;
  rows: number;
  quality: ModelQuality;
  /** Shirt colours for the crowd (team colours). */
  palette: string[];
  /** Seat occupancy 0..1 (default 0.85). */
  fill?: number;
  roof?: boolean;
  seatColor?: string;
  /** Headline on the front banner / roof fascia (e.g. stand name). */
  bannerText?: string;
  /** Extra: 3D spectator density multiplier (defaults per quality: low .16, medium .3, high .85). Painted seat rows keep the stand looking full. */
  density?: number;
  /** Extra: deterministic seed (defaults to a hash of the spec). */
  seed?: number;
}

export interface GrandstandModel {
  root: THREE.Group;
  crowd: CrowdModelExt;
  depthM: number;
  heightM: number;
  update(t: number): void;
  dispose(): void;
}

export const STAND_ROW_DEPTH = 0.9;
export const STAND_ROW_RISE = 0.45;
const LIP = 0.4;
const Y0 = 1.5;

const COL = {
  concrete: '#bdb8ae',
  concreteDark: '#8f8a82',
  tread: '#a9a49b',
  steel: '#59616b',
  steelDark: '#3a4048',
  cladding: '#dfe3e8',
  plinth: '#2a2e33',
  stair: '#c9c5bd',
  nosing: '#f2c200',
  roof: '#eef1f4',
  roofUnder: '#c4cad1',
  accent: '#b6ff3b',
};

export function createGrandstand(spec: GrandstandOptions): GrandstandModel {
  const L = Math.max(6, spec.lengthM);
  const R = Math.max(2, Math.round(spec.rows));
  const q = spec.quality;
  const fill = THREE.MathUtils.clamp(spec.fill ?? 0.85, 0, 1);
  const roof = spec.roof ?? R >= 14;
  const seatColor = spec.seatColor ?? '#1f3f94';
  const palette = spec.palette.length ? spec.palette : ['#e10600', '#ff8000', '#27f4d2', '#3671c6'];
  const density = spec.density ?? qPick(q, 0.16, 0.3, 0.85);
  const rng = new Rng(spec.seed ?? hashSeed('stand', L, R, seatColor, spec.bannerText ?? ''));

  const zf = (i: number) => -LIP - i * STAND_ROW_DEPTH;
  const yt = (i: number) => Y0 + i * STAND_ROW_RISE;
  const zBack = zf(R);
  const yTop = yt(R);
  const zEnd = zBack - 1.6;
  const backTop = yTop + 1.3;
  const hx = L / 2;

  const root = new THREE.Group();
  root.name = 'grandstand';

  const sb = new MeshBuilder();
  const tb = new MeshBuilder({ uv: true });

  // ---- Blocks & aisles -------------------------------------------------
  const aisleW = 1.2;
  const margin = 0.5;
  const nb = Math.max(1, Math.round(L / 14));
  const blockW = (L - 2 * margin - (nb - 1) * aisleW) / nb;
  const blocks: [number, number][] = [];
  for (let k = 0; k < nb; k++) {
    const x0 = -hx + margin + k * (blockW + aisleW);
    blocks.push([x0, x0 + blockW]);
  }

  // ---- Stepped tiers ---------------------------------------------------
  for (let i = 0; i < R; i++) {
    const z0 = zf(i);
    const z1 = zf(i + 1);
    const y = yt(i);
    const h = STAND_ROW_RISE + 0.3;
    sb.box(0, y - h / 2, (z0 + z1) / 2, L, h, z0 - z1, COL.tread, {
      faces: FACE.ALL & ~FACE.NY,
      colorFace: (f) => (f === FACE.PY ? COL.tread : f === FACE.PZ ? COL.concreteDark : COL.concrete),
      glow: [0, 0.1],
    });
  }
  // Rear walkway + back wall
  sb.box(0, yTop - 0.2, (zBack + zEnd) / 2, L, 0.4, zBack - zEnd, COL.tread, { faces: FACE.ALL & ~FACE.NY });
  sb.box(0, backTop / 2, zEnd + 0.15, L + 0.2, backTop, 0.3, COL.cladding, {
    colorFace: (f) => (f === FACE.PY ? COL.concreteDark : undefined),
  });
  // Back cladding ribs + accent stripe (outer face, −Z)
  const ribStep = qPick(q, 6, 4, 3);
  for (let x = -hx; x <= hx + 0.01; x += ribStep) {
    sb.box(x, backTop / 2, zEnd - 0.05, 0.18, backTop, 0.12, COL.steel, { faces: FACE.ALL & ~FACE.PZ });
  }
  sb.box(0, backTop - 0.5, zEnd - 0.03, L + 0.2, 0.22, 0.08, COL.accent, { faces: FACE.NZ | FACE.PY, glow: [0.15, 0.9] });
  // Back light boxes at night over the walkway
  for (let x = -hx + 4; x < hx - 2; x += 10) {
    sb.box(x, backTop + 0.06, zEnd + 0.4, 1.2, 0.12, 0.4, '#fff4dc', { glow: [0, 1.6] });
  }

  // ---- Front parapet ---------------------------------------------------
  const parTop = Y0 + 1.0;
  sb.box(0, parTop / 2, -LIP / 2, L, parTop, LIP, COL.plinth, {
    colorFace: (f) => (f === FACE.PY ? COL.concrete : f === FACE.PZ ? COL.plinth : COL.concreteDark),
  });
  // Cap + rail
  sb.box(0, parTop + 0.04, -LIP / 2, L + 0.1, 0.08, LIP + 0.1, COL.concrete);
  if (q !== 'low') {
    sb.box(0, parTop + 0.95, -0.1, L, 0.06, 0.06, COL.steelDark);
    for (let x = -hx; x <= hx + 0.01; x += 2.5) sb.box(x, parTop + 0.5, -0.1, 0.05, 0.9, 0.05, COL.steelDark);
  }
  // Banner on the parapet face
  const bv0 = 0.502;
  const bv1 = 0.998;
  tb.quad(
    new THREE.Vector3(-hx, Y0 - 0.02, 0.012),
    new THREE.Vector3(hx, Y0 - 0.02, 0.012),
    new THREE.Vector3(hx, Y0 + 0.98, 0.012),
    new THREE.Vector3(-hx, Y0 + 0.98, 0.012),
    '#ffffff',
    [0.08, 0.75],
    [-hx / STAND_BANNER_PERIOD_M, bv0, hx / STAND_BANNER_PERIOD_M, bv1],
  );
  // Lime LED edge under the banner
  sb.box(0, Y0 - 0.1, 0.03, L, 0.06, 0.06, COL.accent, { glow: [0.4, 1.2] });

  // ---- Seats (painted rows with seated spectators) ----------------------
  for (let i = 0; i < R; i++) {
    const z = zf(i) - 0.62;
    const y = yt(i);
    const off = rng.range(0, STAND_SEAT_PERIOD_M);
    for (const [x0, x1] of blocks) {
      tb.quad(
        new THREE.Vector3(x0, y, z),
        new THREE.Vector3(x1, y, z),
        new THREE.Vector3(x1, y + 1.0, z),
        new THREE.Vector3(x0, y + 1.0, z),
        '#ffffff',
        [0, 0.3],
        [(x0 + off) / STAND_SEAT_PERIOD_M, 0.004, (x1 + off) / STAND_SEAT_PERIOD_M, 0.496],
      );
    }
  }

  // ---- Aisle stairs ------------------------------------------------------
  for (let k = 1; k < nb; k++) {
    const ax = blocks[k]![0] - aisleW / 2;
    for (let i = 0; i < R; i++) {
      const z0 = zf(i);
      const y = yt(i);
      for (let s = 0; s < 2; s++) {
        const zz = z0 - s * (STAND_ROW_DEPTH / 2);
        const yy = y + (s + 1) * (STAND_ROW_RISE / 2);
        sb.box(ax, yy - 0.12, zz - STAND_ROW_DEPTH / 4, aisleW, 0.24, STAND_ROW_DEPTH / 2, COL.stair, {
          faces: FACE.PY | FACE.PZ,
        });
        sb.box(ax, yy + 0.004, zz - 0.04, aisleW, 0.01, 0.08, COL.nosing, { faces: FACE.PY });
      }
    }
    if (q === 'high') {
      for (const side of [-1, 1]) {
        sb.beam(
          new THREE.Vector3(ax + side * 0.55, Y0 + 0.9, zf(0)),
          new THREE.Vector3(ax + side * 0.55, yTop + 0.9, zBack),
          0.05,
          0.05,
          COL.steelDark,
        );
      }
    }
  }

  // ---- Side stringers + steel frame -------------------------------------
  for (const side of [-1, 1]) {
    const x = side * (hx + 0.15);
    sb.beam(new THREE.Vector3(x, parTop + 0.2, -0.05), new THREE.Vector3(x, backTop + 0.1, zEnd + 0.1), 0.3, 1.5, COL.concrete);
  }
  const colStep = qPick(q, 12, 7.5, 6);
  const rowStep = Math.max(3, Math.round(R / qPick(q, 2, 3, 4)));
  for (let x = -hx + 0.4; x <= hx - 0.39; x += colStep) {
    for (let i = rowStep; i < R; i += rowStep) {
      const z = zf(i) - STAND_ROW_DEPTH / 2;
      const top = yt(i) - STAND_ROW_RISE - 0.3;
      if (top > 0.3) sb.box(x, top / 2, z, 0.28, top, 0.28, COL.steel, { faces: FACE.SIDES });
    }
    // Raker beam under the tiers
    sb.beam(new THREE.Vector3(x, Y0 - 0.9, -LIP - 0.2), new THREE.Vector3(x, yTop - 0.9, zBack), 0.3, 0.45, COL.steelDark);
  }
  if (q !== 'low') {
    // Cross bracing behind the back wall line (visible from the sides/behind).
    for (let x = -hx + 0.4; x < hx - colStep + 0.4; x += colStep) {
      sb.beam(new THREE.Vector3(x, 0.2, zEnd + 0.6), new THREE.Vector3(x + colStep, backTop - 1.5, zEnd + 0.6), 0.12, 0.12, COL.steel);
    }
  }

  // ---- Roof --------------------------------------------------------------
  let heightM = backTop;
  if (roof) {
    const roofBackY = backTop + 3.6;
    const roofFrontY = roofBackY + 1.3;
    const zRoofFront = zf(Math.min(2, R - 1));
    const zRoofBack = zEnd - 0.4;
    const mastTop = roofBackY + 6;
    const mastStep = qPick(q, 16, 12, 10);
    const masts: number[] = [];
    for (let x = -hx + 1; x <= hx - 0.99; x += mastStep) masts.push(x);
    if (masts[masts.length - 1]! < hx - 3) masts.push(hx - 1);
    for (const x of masts) {
      sb.box(x, mastTop / 2, zEnd - 0.3, 0.45, mastTop, 0.45, COL.steel, { faces: FACE.SIDES | FACE.PY });
      // Stays from mast top to the roof front edge and to a back anchor.
      sb.beam(new THREE.Vector3(x, mastTop, zEnd - 0.3), new THREE.Vector3(x, roofFrontY + 0.2, zRoofFront + 1), 0.08, 0.08, COL.steelDark);
      sb.beam(new THREE.Vector3(x, mastTop, zEnd - 0.3), new THREE.Vector3(x, roofBackY, zRoofBack - 3), 0.08, 0.08, COL.steelDark);
    }
    // Roof plate (sloping up to the front)
    const a = new THREE.Vector3(0, roofBackY, zRoofBack);
    const b = new THREE.Vector3(0, roofFrontY, zRoofFront);
    const len = a.distanceTo(b);
    const ang = Math.atan2(roofFrontY - roofBackY, zRoofBack - zRoofFront);
    const m = new THREE.Matrix4().compose(
      a.clone().add(b).multiplyScalar(0.5),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, 0, 0)),
      new THREE.Vector3(L + 1.2, 0.35, len),
    );
    sb.boxM(m, COL.roof, { colorFace: (f) => (f === FACE.NY ? COL.roofUnder : undefined) });
    // Under-roof light strips
    for (let k = 0; k < 3; k++) {
      const t = 0.2 + k * 0.3;
      const p = a.clone().lerp(b, t);
      sb.box(0, p.y - 0.25, p.z, L - 1, 0.06, 0.25, '#fff7e6', { glow: [0.2, 2.2] });
    }
    // Fascia with banner
    tb.quad(
      new THREE.Vector3(-hx - 0.6, roofFrontY - 0.75, zRoofFront + 0.02),
      new THREE.Vector3(hx + 0.6, roofFrontY - 0.75, zRoofFront + 0.02),
      new THREE.Vector3(hx + 0.6, roofFrontY + 0.45, zRoofFront + 0.02),
      new THREE.Vector3(-hx - 0.6, roofFrontY + 0.45, zRoofFront + 0.02),
      '#ffffff',
      [0.1, 0.8],
      [(-hx - 0.6) / (STAND_BANNER_PERIOD_M * 1.2), bv0, (hx + 0.6) / (STAND_BANNER_PERIOD_M * 1.2), bv1],
    );
    sb.box(0, roofFrontY - 0.15, zRoofFront - 0.1, L + 1.2, 1.3, 0.18, COL.steelDark);
    sb.box(0, roofFrontY + 0.5, zRoofFront + 0.02, L + 1.2, 0.08, 0.1, COL.accent, { glow: [0.3, 1.4] });
    heightM = mastTop;
  }

  const structure = sb.mesh(getVCMaterial(q), 'grandstand-structure');
  root.add(structure);
  const tex = getGrandstandTexture(seatColor, palette, Math.min(1, fill + 0.05), spec.bannerText);
  const textured = tb.mesh(getVCMaterial(q, { map: tex, alphaTest: 0.5 }), 'grandstand-seats');
  root.add(textured);

  // ---- Crowd -------------------------------------------------------------
  const seats: number[] = [];
  const p = fill * density;
  for (let i = 0; i < R; i++) {
    const y = yt(i);
    const z = zf(i) - 0.34;
    for (const [x0, x1] of blocks) {
      for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.55) {
        if (rng.next() > p) continue;
        seats.push(x + rng.range(-0.06, 0.06), y, z + rng.range(-0.05, 0.05));
      }
    }
  }
  const crowd = createCrowd({ seats: new Float32Array(seats), facing: 0, palette, quality: q });
  root.add(crowd.mesh);

  return {
    root,
    crowd,
    depthM: -zEnd + 0.4,
    heightM,
    update(t: number) {
      crowd.update(t);
    },
    dispose() {
      crowd.dispose();
      disposeProp(root);
    },
  };
}
