/**
 * Overhead start-light gantry: two padded posts, box truss, 5 columns × 4 red
 * lamps on both faces (lower two rows light in sequence), amber/green side
 * lamps, sponsor sign. Lamps are one InstancedMesh (colour per state) plus
 * camera-facing glow halos. Local frame: spans X centred at 0, track runs
 * along Z (grid on −Z looking at the lights), beam ~6.3–7.5 m high.
 */
import * as THREE from 'three';
import type { StartGantryModel } from '../types';
import { FACE, MeshBuilder, createHalos, disposeProp, getVCMaterial, finishInstanced, cachedMaterial } from './core';
import { brandTileUV, canvasTexture, getBrandAtlas, getGlowTexture } from './textures';

const COLS = 5;
const ROWS = 4;
const COL_SPACING = 0.78;
const LAMP_Y = [7.7, 7.2, 6.7, 6.2];
const LIT_ROWS = [2, 3];
const FACE_Z = 0.92;

const RED_ON = new THREE.Color(3.2, 0.07, 0.03);
const RED_OFF = new THREE.Color(0.07, 0.006, 0.006);
const AMBER_OFF = new THREE.Color(0.07, 0.04, 0.0);
const GREEN_ON = new THREE.Color(0.25, 3.0, 0.6);
const GREEN_OFF = new THREE.Color(0.0, 0.05, 0.02);
const HALO_RED = new THREE.Color(1.6, 0.12, 0.05);
const HALO_GREEN = new THREE.Color(0.2, 1.5, 0.4);

function lensTexture(): THREE.Texture {
  return canvasTexture(
    'gantry-lens',
    64,
    64,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.55, '#d9d9d9');
      g.addColorStop(0.9, '#8a8a8a');
      g.addColorStop(1, '#333333');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 4; y < h; y += 6) for (let x = 4; x < w; x += 6) ctx.fillRect(x, y, 2, 2);
    },
    { mipmaps: true },
  );
}

export function createStartGantry(trackWidthM: number): StartGantryModel {
  const half = trackWidthM / 2 + 1.6;
  const root = new THREE.Group();
  root.name = 'start-gantry';
  const b = new MeshBuilder();
  const graphite = '#2a2d33';
  const truss = '#40464f';
  const housing = '#0b0c0e';

  // Posts with chequered bands and foam padding.
  const postH = 9.2;
  for (const s of [-1, 1]) {
    const x = s * half;
    b.box(x, postH / 2, 0, 0.6, postH, 0.6, graphite);
    b.box(x, 0.05, 0, 1.3, 0.1, 1.3, '#55595f');
    b.box(x, 1.15, 0, 1.0, 2.2, 1.0, '#1e40af', { faces: FACE.NO_BOTTOM });
    b.box(x, 2.27, 0, 1.02, 0.08, 1.02, '#ffffff');
    for (let k = 0; k < 8; k++) {
      const yy = 3.0 + k * 0.3;
      for (const zf of [-1, 1]) {
        b.box(x + (k % 2 ? 0.15 : -0.15), yy, zf * 0.305, 0.3, 0.3, 0.01, '#ffffff', { faces: zf < 0 ? FACE.NZ : FACE.PZ });
      }
    }
  }
  // Box truss.
  const y0 = 6.3;
  const y1 = 7.5;
  const zt = 0.5;
  for (const yy of [y0, y1]) for (const zz of [-zt, zt]) b.box(0, yy, zz, half * 2, 0.16, 0.16, truss);
  const nodes = Math.max(4, Math.round((half * 2) / 1.25));
  for (let i = 0; i <= nodes; i++) {
    const x = -half + (i / nodes) * half * 2;
    for (const zz of [-zt, zt]) {
      b.beam(new THREE.Vector3(x, y0, zz), new THREE.Vector3(x, y1, zz), 0.08, 0.08, truss);
      if (i < nodes) {
        const x2 = -half + ((i + 1) / nodes) * half * 2;
        const up = i % 2 === 0;
        b.beam(new THREE.Vector3(x, up ? y0 : y1, zz), new THREE.Vector3(x2, up ? y1 : y0, zz), 0.06, 0.06, truss);
      }
    }
    for (const yy of [y0, y1]) b.beam(new THREE.Vector3(x, yy, -zt), new THREE.Vector3(x, yy, zt), 0.06, 0.06, truss);
  }
  // LED strip under the beam.
  b.box(0, y0 - 0.12, 0, half * 2 - 0.8, 0.05, 0.1, '#b6ff3b', { glow: [0.6, 1.4] });

  // Lamp housings, visors (both faces).
  const lampPos: THREE.Vector3[] = [];
  const lampFace: number[] = [];
  const lampKind: ('r' | 'a' | 'g')[] = [];
  const lampCol: number[] = [];
  const lampRow: number[] = [];
  for (const fz of [-1, 1]) {
    for (let c = 0; c < COLS; c++) {
      const x = (c - (COLS - 1) / 2) * COL_SPACING;
      b.box(x, 6.95, fz * 0.72, 0.62, 2.3, 0.36, housing);
      for (let r = 0; r < ROWS; r++) {
        const y = LAMP_Y[r]!;
        b.box(x, y + 0.2, fz * (FACE_Z + 0.1), 0.42, 0.03, 0.22, '#050506', { rx: fz * -0.25 });
        b.box(x, y, fz * (FACE_Z - 0.004), 0.38, 0.38, 0.01, '#1a1b1e', { faces: fz < 0 ? FACE.NZ : FACE.PZ });
        lampPos.push(new THREE.Vector3(x, y, fz * (FACE_Z + 0.002)));
        lampFace.push(fz);
        lampKind.push('r');
        lampCol.push(c);
        lampRow.push(r);
      }
    }
    // Side panels: amber over green.
    for (const s of [-1, 1]) {
      const x = s * (COL_SPACING * 3.1);
      b.box(x, 6.95, fz * 0.72, 0.62, 1.4, 0.36, housing);
      for (const [k, y] of [
        ['a', 7.25],
        ['g', 6.65],
      ] as const) {
        b.box(x, y + 0.2, fz * (FACE_Z + 0.1), 0.42, 0.03, 0.22, '#050506', { rx: fz * -0.25 });
        lampPos.push(new THREE.Vector3(x, y, fz * (FACE_Z + 0.002)));
        lampFace.push(fz);
        lampKind.push(k);
        lampCol.push(-1);
        lampRow.push(-1);
      }
    }
  }
  // Sign frame above the truss.
  const signW = Math.min(half * 2 - 1.5, 7.2);
  b.box(0, 8.55, 0, signW + 0.2, 1.1, 0.3, '#0e1012');
  for (const s of [-1, 1]) b.box(s * (signW / 2 - 0.3), 7.95, 0, 0.12, 0.6, 0.12, truss);
  const structure = b.mesh(getVCMaterial('medium'), 'gantry-structure');
  root.add(structure);

  // Sign faces (brand atlas).
  const tb = new MeshBuilder({ uv: true });
  for (const fz of [-1, 1]) {
    const z = fz * 0.16;
    const xa = fz < 0 ? signW / 2 : -signW / 2;
    const xb = -xa;
    tb.quad(
      new THREE.Vector3(xa, 8.05, z),
      new THREE.Vector3(xb, 8.05, z),
      new THREE.Vector3(xb, 9.05, z),
      new THREE.Vector3(xa, 9.05, z),
      '#ffffff',
      [0.25, 0.9],
      brandTileUV(0),
    );
  }
  root.add(tb.mesh(getVCMaterial('medium', { map: getBrandAtlas() }), 'gantry-sign'));

  // Lamps (single instanced draw).
  const lampGeo = new THREE.CircleGeometry(0.155, 18);
  const lampMat = cachedMaterial(
    'gantry-lamp',
    () => new THREE.MeshBasicMaterial({ map: lensTexture(), toneMapped: false, fog: false }),
  );
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampPos.length);
  const m = new THREE.Matrix4();
  const flip = new THREE.Matrix4().makeRotationY(Math.PI);
  lampPos.forEach((p, i) => {
    m.identity();
    if (lampFace[i]! < 0) m.multiply(flip);
    m.setPosition(p);
    lamps.setMatrixAt(i, m);
    lamps.setColorAt(i, RED_OFF);
  });
  lamps.name = 'gantry-lamps';
  finishInstanced(lamps);
  root.add(lamps);

  // Halos follow the lit lamps.
  const haloPts = lampPos.map((p, i) => new THREE.Vector3(p.x, p.y, p.z + lampFace[i]! * 0.08));
  const halos = createHalos(haloPts, 0, HALO_RED, false, getGlowTexture());
  halos.frustumCulled = false;
  root.add(halos);

  const setLamp = (i: number, color: THREE.Color, haloColor: THREE.Color | null): void => {
    lamps.setColorAt(i, color);
    const s = haloColor ? 1.5 : 0;
    m.makeScale(s, s, s).setPosition(haloPts[i]!);
    halos.setMatrixAt(i, m);
    if (haloColor) halos.setColorAt(i, haloColor);
  };

  const setLights = (state: number | 'off' | 'green'): void => {
    const n = typeof state === 'number' ? Math.max(0, Math.min(COLS, Math.floor(state))) : 0;
    for (let i = 0; i < lampPos.length; i++) {
      const k = lampKind[i]!;
      if (k === 'r') {
        const on = typeof state === 'number' && lampCol[i]! < n && LIT_ROWS.includes(lampRow[i]!);
        setLamp(i, on ? RED_ON : RED_OFF, on ? HALO_RED : null);
      } else if (k === 'g') {
        const on = state === 'green';
        setLamp(i, on ? GREEN_ON : GREEN_OFF, on ? HALO_GREEN : null);
      } else {
        setLamp(i, AMBER_OFF, null);
      }
    }
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
  };
  setLights('off');

  return {
    root,
    setLights,
    dispose() {
      lampGeo.dispose();
      disposeProp(root);
    },
  };
}
