/**
 * Yas-style hotel: two curved towers straddling the circuit (road along X,
 * z ∈ [−7, 7]) joined by a link bridge, under a ~210 m sweeping gridshell
 * whose diamond LED panels slowly cycle colours (bright at night).
 */
import * as THREE from 'three';
import type { TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../../types';
import { FACE, MeshBuilder, PROP_UNIFORMS, disposeProp, getVCMaterial, qPick, setPropsTimeOfDay } from '../core';
import { addPolygonCap, addPrismWalls, facadeTile, getFacadeMaterial, rectOutline } from '../buildings';
import { HSV_GLSL, type LandmarkModel } from './common';

const SHELL_L = 210;

function lensOutline(x0: number, x1: number, zInner: number, depth: number, n: number): THREE.Vector2[] {
  const sign = Math.sign(zInner);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = THREE.MathUtils.lerp(x0, x1, t);
    const bulge = Math.pow(Math.sin(Math.PI * t), 0.55);
    pts.push(new THREE.Vector2(x, zInner + sign * (2 + depth * bulge)));
  }
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    const x = THREE.MathUtils.lerp(x0, x1, t);
    const pinch = Math.pow(Math.sin(Math.PI * t), 0.35);
    pts.push(new THREE.Vector2(x, zInner + sign * (2 - 2 * pinch)));
  }
  return pts;
}

function shellPoint(u: number, v: number): THREE.Vector3 {
  const s = Math.sin(Math.PI * u);
  const hw = 4 + 47 * Math.pow(s, 0.55);
  const x = (u - 0.5) * SHELL_L;
  const vv = v * 2 - 1;
  const z = vv * hw;
  const yEdge = 21 + 5 * s;
  const yTop = 30 + 35 * Math.pow(s, 0.5);
  const dome = 1 - Math.pow(Math.abs(vv), 2.2);
  const y = yEdge + (yTop - yEdge) * dome + 2.5 * Math.sin(u * Math.PI * 3) * dome;
  return new THREE.Vector3(x, y, z);
}

export function createYasHotel(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const root = new THREE.Group();
  root.name = 'yas-hotel';
  const glass = new MeshBuilder({ uv: true });
  const solid = new MeshBuilder();
  const tile = facadeTile('modern');
  const H = 38;

  const towers = [lensOutline(-96, 58, -12, 27, 14), lensOutline(-58, 96, 12, 27, 14)];
  for (const o of towers) {
    addPrismWalls(glass, o, 6, H, tile, '#f2f6fb', { vOffset: 0.4 });
    addPrismWalls(glass, o, 0, 6, { w: tile.w, h: tile.h }, '#cfd6dd');
    addPolygonCap(solid, o, H, '#8c949c');
    addPolygonCap(solid, o, 6.05, '#e8ecef', { down: true });
  }
  // Link bridge over the track
  addPrismWalls(glass, rectOutline(0, 0, 24, 26, 0), 23, 29.5, tile, '#e4f0ff', { vOffset: 1.2 });
  solid.box(0, 29.8, 0, 25, 0.6, 27, '#d9dee3');
  solid.box(0, 22.7, 0, 25, 0.6, 27, '#d9dee3', { colorFace: (f) => (f === FACE.NY ? '#fff4e0' : undefined), glowFace: (f) => (f === FACE.NY ? ([0.2, 1.6] as const) : undefined) });
  // Shell support columns rising from roofs
  for (let k = 0; k < 10; k++) {
    const u = 0.12 + (k / 9) * 0.76;
    for (const v of [0.12, 0.88]) {
      const p = shellPoint(u, v);
      // Only where a tower roof is underneath.
      if ((v < 0.5 && (p.x < -88 || p.x > 50)) || (v > 0.5 && (p.x < -50 || p.x > 88))) continue;
      solid.beam(new THREE.Vector3(p.x, H - 1, p.z * 0.8), p, 0.6, 0.6, '#c9ced4');
    }
  }

  root.add(glass.mesh(getFacadeMaterial('modern', quality), 'yas-towers'));
  root.add(solid.mesh(getVCMaterial(quality), 'yas-structure'));

  // Gridshell surface
  const nu = qPick(quality, 40, 64, 96);
  const nv = qPick(quality, 14, 20, 28);
  const pos: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const p = shellPoint(u, v);
      pos.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const uTime = { value: 0 };
  const shellMat =
    quality === 'high'
      ? new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.35, metalness: 0.3 })
      : new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  shellMat.userData.owned = true;
  shellMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uNight = PROP_UNIFORMS.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vShellUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShellUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vShellUv;\nuniform float uTime;\nuniform float uNight;\n${HSV_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 g = vShellUv * vec2(${(SHELL_L / 4.5).toFixed(1)}, 24.0);
vec2 r = vec2(g.x + g.y, g.x - g.y);
vec2 fr = abs(fract(r) - 0.5);
float frame = smoothstep(0.38, 0.47, max(fr.x, fr.y));
float pid = pulseHash(floor(r));
diffuseColor.rgb = mix(vec3(0.78, 0.82, 0.86) * (0.9 + 0.1 * pid), vec3(0.28, 0.3, 0.33), frame);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float hue = fract(uTime * 0.025 + vShellUv.x * 0.9 + sin(vShellUv.y * 5.0 + uTime * 0.35) * 0.06);
vec3 led = pulseHsv(hue, 0.8, 1.0);
float wave = 0.55 + 0.45 * sin(uTime * 1.2 + vShellUv.x * 40.0 - pid * 5.0);
totalEmissiveRadiance += led * (1.0 - frame) * wave * (0.04 + uNight * 1.25);`,
      );
  };
  shellMat.customProgramCacheKey = () => `yas-shell|${quality}`;
  const shell = new THREE.Mesh(geo, shellMat);
  shell.name = 'yas-gridshell';
  root.add(shell);

  return {
    root,
    update(t: number) {
      uTime.value = t;
    },
    dispose() {
      disposeProp(root);
    },
  };
}
