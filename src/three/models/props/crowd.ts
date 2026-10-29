/**
 * Instanced low-poly spectators. One draw call per crowd; idle sway, cheering
 * (arm raise + jumps), flag waving and a travelling Mexican wave are all done
 * in the vertex shader, driven by `uTime` / `uExcitement`.
 *
 * Triangles per person: low 18, medium 34, high 66.
 */
import * as THREE from 'three';
import type { CrowdModel, CrowdOptions, ModelQuality } from '../types';
import { FACE, MeshBuilder, PROP_UNIFORMS, Rng, C, cachedGeometry, hashSeed } from './core';

/* Channel ids written to `aTint` (material) and `aPart` (rig). */
const M_PANTS = 0;
const M_SHIRT = 1;
const M_SKIN = 2;
const M_HAIR = 3;
const P_BODY = 0;
const P_ARM_L = 1;
const P_ARM_R = 2;
const P_FLAG = 3;

const SHOULDER_X = 0.24;
const SHOULDER_Y = 1.33;

function headGeometry(quality: ModelQuality): THREE.BufferGeometry {
  return quality === 'high' ? new THREE.IcosahedronGeometry(0.125, 0) : new THREE.OctahedronGeometry(0.13, 0);
}

function buildPerson(quality: ModelQuality): THREE.BufferGeometry {
  const b = new MeshBuilder({ tint: true, part: true });
  const pants = '#2b3242';
  b.part = P_BODY;
  if (quality === 'low') {
    b.tint = M_SHIRT;
    b.box(0, 0.72, 0, 0.42, 1.44, 0.24, '#ffffff', { faces: FACE.NO_BOTTOM });
  } else if (quality === 'medium') {
    b.tint = M_PANTS;
    b.box(0, 0.4, 0, 0.34, 0.8, 0.2, pants, { faces: FACE.SIDES });
    b.tint = M_SHIRT;
    b.box(0, 1.08, 0, 0.44, 0.56, 0.25, '#ffffff', { faces: FACE.NO_BOTTOM });
  } else {
    b.tint = M_PANTS;
    b.box(-0.09, 0.42, 0, 0.15, 0.84, 0.18, pants, { faces: FACE.SIDES });
    b.box(0.09, 0.42, 0, 0.15, 0.84, 0.18, pants, { faces: FACE.SIDES });
    b.tint = M_SHIRT;
    b.box(0, 1.08, 0, 0.44, 0.56, 0.25, '#ffffff', { faces: FACE.NO_BOTTOM });
  }
  // Head: lower half skin, upper half hair / cap.
  const head = headGeometry(quality);
  const hm = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 1.52, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
    new THREE.Vector3(1, 1.18, 1),
  );
  const tmp = new MeshBuilder();
  tmp.geometry(head, hm, '#ffffff');
  head.dispose();
  const hg = tmp.build();
  const hp = hg.getAttribute('position');
  for (let i = 0; i < hp.count; i += 3) {
    const cy = (hp.getY(i) + hp.getY(i + 1) + hp.getY(i + 2)) / 3;
    b.tint = cy > 1.53 ? M_HAIR : M_SKIN;
    const a = new THREE.Vector3().fromBufferAttribute(hp, i);
    const bb = new THREE.Vector3().fromBufferAttribute(hp, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(hp, i + 2);
    b.tri(a, bb, c, '#ffffff');
  }
  hg.dispose();

  if (quality !== 'low') {
    // Arms hang from the shoulders; rotated about (±SHOULDER_X, SHOULDER_Y) in the shader.
    for (const side of [-1, 1] as const) {
      b.part = side < 0 ? P_ARM_L : P_ARM_R;
      b.tint = M_SHIRT;
      const top = new THREE.Vector3(side * SHOULDER_X, SHOULDER_Y, 0);
      const bot = new THREE.Vector3(side * (SHOULDER_X + 0.03), 0.8, 0.02);
      if (quality === 'high') {
        b.beam(top, bot, 0.11, 0.11, '#ffffff');
      } else {
        // Flat double-sided strip facing ±Z (4 tris): reads as an arm at stand distances.
        const w = 0.06;
        const a0 = new THREE.Vector3(top.x - w, top.y, 0.06);
        const a1 = new THREE.Vector3(top.x + w, top.y, 0.06);
        const b0 = new THREE.Vector3(bot.x - w, bot.y, 0.06);
        const b1 = new THREE.Vector3(bot.x + w, bot.y, 0.06);
        b.quad(b0, b1, a1, a0, '#ffffff');
        b.quad(b1, b0, a0, a1, '#ffffff');
      }
    }
    // Flag (double-sided quad) held in the right hand; collapsed for non-holders.
    b.part = P_FLAG;
    b.tint = M_SHIRT;
    const x0 = SHOULDER_X + 0.04;
    const fa = new THREE.Vector3(x0, 0.78, 0.03);
    const fb = new THREE.Vector3(x0 + 0.55, 0.78, 0.03);
    const fc = new THREE.Vector3(x0 + 0.55, 0.42, 0.03);
    const fd = new THREE.Vector3(x0, 0.42, 0.03);
    b.quad(fd, fc, fb, fa, '#ffffff');
    b.quad(fc, fd, fa, fb, '#ffffff');
  }
  return b.build();
}

function personGeometry(quality: ModelQuality): THREE.BufferGeometry {
  return cachedGeometry(`crowd-person|${quality}`, () => buildPerson(quality));
}

const NEUTRALS = ['#f5f5f5', '#1c1c1e', '#6b7280', '#1e3a8a', '#9ca3af', '#7f1d1d'];

function crowdMaterial(): { material: THREE.MeshLambertMaterial; uniforms: Record<string, THREE.IUniform> } {
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uExcitement: { value: 0 },
    uWave: { value: 0 },
    uWaveDir: { value: new THREE.Vector2(1, 0) },
  };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.userData.owned = true;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aTint;
attribute float aPart;
attribute float aPhase;
uniform float uTime;
uniform float uExcitement;
uniform float uWave;
uniform vec2 uWaveDir;
float crowdH1; float crowdH2; float crowdH3;`,
      )
      .replace(
        '#include <color_vertex>',
        `crowdH1 = fract(aPhase * 7.31 + 0.13);
crowdH2 = fract(aPhase * 13.73 + 0.71);
crowdH3 = fract(aPhase * 3.17 + 0.37);
vec3 crowdSkin = mix(vec3(0.86, 0.58, 0.42), vec3(0.16, 0.08, 0.045), crowdH2 * crowdH2);
vec3 crowdHair = mix(vec3(0.015, 0.011, 0.008), vec3(0.42, 0.27, 0.11), crowdH3 * crowdH3 * crowdH3);
vec3 crowdShirt = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  crowdShirt = instanceColor.rgb;
#endif
vec3 crowdC = color * (0.55 + 0.9 * crowdH1);
if (aTint > 0.5 && aTint < 1.5) crowdC = crowdShirt;
else if (aTint > 1.5 && aTint < 2.5) crowdC = crowdSkin;
else if (aTint > 2.5) crowdC = crowdH3 < 0.3 ? crowdShirt : crowdHair;
vColor = vec4(crowdC, 1.0);`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
float ex = clamp(uExcitement, 0.0, 1.0);
vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
float ph = aPhase * 6.2831853;
float flagger = step(0.9, fract(aPhase * 5.71 + 0.3));
// Fraction of fans cheering grows with excitement.
float cheer = smoothstep(crowdH1 - 0.12, crowdH1 + 0.12, ex * 1.15);
// Travelling Mexican wave (~140 m wavelength).
float wc = dot(ip.xz, uWaveDir) * 0.045 - uTime * 0.85;
float crest = pow(max(0.0, sin(wc)), 10.0) * uWave;
float jump = cheer * max(0.0, sin(uTime * (6.0 + crowdH2 * 3.5) + ph * 7.0)) * 0.2 * ex + crest * 0.32;
float armUp = cheer * (0.55 + 0.45 * sin(uTime * (3.5 + crowdH3 * 2.5) + ph * 5.0));
armUp = max(armUp, crest * 1.15);
armUp = max(armUp, step(0.985, crowdH2) * (0.5 + 0.5 * sin(uTime * 0.7 + ph)));
armUp = clamp(armUp, 0.0, 1.0);
float armR = mix(armUp, max(armUp, 0.82 + 0.12 * sin(uTime * 6.0 + ph * 3.0)), flagger);
if (aPart > 0.5) {
  float side = aPart < 1.5 ? -1.0 : 1.0;
  float up = side < 0.0 ? armUp : armR;
  if (aPart > 2.5) {
    // Flag cloth flutter; collapse for non flag holders.
    transformed.z += sin(uTime * 9.0 + position.x * 9.0 + ph) * 0.06 * (position.x - ${SHOULDER_X.toFixed(2)});
    transformed *= flagger;
    transformed.y += (1.0 - flagger) * 1.0;
  }
  vec2 sh = vec2(side * ${SHOULDER_X.toFixed(2)}, ${SHOULDER_Y.toFixed(2)});
  float ang = side * up * 2.75;
  float cs = cos(ang);
  float sn = sin(ang);
  vec2 rel = transformed.xy - sh;
  transformed.xy = sh + vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
  transformed.z += up * 0.1;
}
// Idle sway / lean.
float sway = sin(uTime * (0.6 + crowdH1 * 0.8) + ph * 3.0) * (0.025 + 0.04 * ex);
transformed.x += sway * position.y;
transformed.z += sin(uTime * (0.5 + crowdH3) + ph) * 0.015 * position.y;
transformed.y += jump;`,
      );
    shader.uniforms.uNight = PROP_UNIFORMS.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace(
        '#include <emissivemap_fragment>',
        // Stand floodlighting at night (emissive fill so crowds read on dark circuits).
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * 0.32;',
      );
  };
  material.customProgramCacheKey = () => 'pulse-crowd-v1';
  return { material, uniforms };
}

export interface CrowdModelExt extends CrowdModel {
  /** Number of spectators. */
  readonly count: number;
  /**
   * Short burst of extra excitement (overtake, win…) that decays over
   * `durationSec`. Optional extra on top of the contract.
   */
  pulse(strength?: number, durationSec?: number): void;
  /** Direction of the Mexican wave in the crowd's local XZ plane. */
  setWaveDirection(dx: number, dz: number): void;
}

export function createCrowd(opts: CrowdOptions): CrowdModelExt {
  const count = Math.floor(opts.seats.length / 3);
  const base = personGeometry(opts.quality);
  // Per-crowd geometry sharing the cached base attributes + its own phases.
  const geo = new THREE.BufferGeometry();
  for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.getAttribute(name));
  geo.boundingSphere = base.boundingSphere?.clone() ?? null;
  geo.boundingBox = base.boundingBox?.clone() ?? null;

  const seed = hashSeed(count, opts.seats[0] ?? 0, opts.seats[1] ?? 0, opts.seats[2] ?? 0);
  const rng = new Rng(seed);
  const phases = new Float32Array(Math.max(1, count));
  for (let i = 0; i < count; i++) phases[i] = rng.next();
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

  const { material, uniforms } = crowdMaterial();
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, count));
  mesh.count = count;
  mesh.name = 'crowd';
  const palette = opts.palette.length ? opts.palette : ['#e10600', '#ffffff', '#1e40af'];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const facing = typeof opts.facing === 'number' ? opts.facing : opts.facing[i] ?? 0;
    q.setFromAxisAngle(up, facing + (rng.next() - 0.5) * 0.5);
    const sc = 0.9 + rng.next() * 0.2;
    m.compose(p.set(opts.seats[i * 3]!, opts.seats[i * 3 + 1]!, opts.seats[i * 3 + 2]!), q, s.set(sc, sc * (0.94 + rng.next() * 0.12), sc));
    mesh.setMatrixAt(i, m);
    const c = rng.chance(0.8) ? palette[Math.floor(rng.next() * palette.length) % palette.length]! : NEUTRALS[Math.floor(rng.next() * NEUTRALS.length) % NEUTRALS.length]!;
    col.copy(C(c)).multiplyScalar(0.8 + rng.next() * 0.35);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (count > 0) {
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 1.5;
  }
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  let baseExcitement = 0;
  let pulseStart = -1;
  let pulseDur = 2.5;
  let pulseStrength = 0;
  let pulseArmed = false;
  let lastT = 0;

  return {
    mesh,
    count,
    setExcitement(level: number) {
      baseExcitement = THREE.MathUtils.clamp(level, 0, 1);
      uniforms.uExcitement!.value = baseExcitement;
      uniforms.uWave!.value = THREE.MathUtils.smoothstep(baseExcitement, 0.55, 0.92);
    },
    pulse(strength = 1, durationSec = 2.5) {
      pulseStrength = THREE.MathUtils.clamp(strength, 0, 1);
      pulseDur = Math.max(0.3, durationSec);
      pulseArmed = true;
    },
    setWaveDirection(dx: number, dz: number) {
      (uniforms.uWaveDir!.value as THREE.Vector2).set(dx, dz).normalize();
    },
    update(timeSec: number) {
      lastT = timeSec;
      if (pulseArmed) {
        pulseStart = timeSec;
        pulseArmed = false;
      }
      let e = baseExcitement;
      if (pulseStart >= 0) {
        const k = (lastT - pulseStart) / pulseDur;
        if (k >= 1) pulseStart = -1;
        else e = Math.max(e, pulseStrength * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85));
      }
      uniforms.uTime!.value = timeSec;
      uniforms.uExcitement!.value = e;
      uniforms.uWave!.value = THREE.MathUtils.smoothstep(e, 0.55, 0.92);
    },
    dispose() {
      mesh.dispose();
      // Detach the shared base attributes first so only this crowd's buffers are freed.
      for (const name of Object.keys(base.attributes)) geo.deleteAttribute(name);
      geo.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
