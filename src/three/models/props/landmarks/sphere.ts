/**
 * Las Vegas-style LED Sphere (~110 m diameter) on a plaza. The exosphere
 * shader cycles through content (eye, chequered flag, neon plasma, scrolling
 * logo) with crossfades and an LED dot-matrix that fades out with distance.
 */
import * as THREE from 'three';
import type { TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../../types';
import { FACE, MeshBuilder, disposeProp, getVCMaterial, qPick, setPropsTimeOfDay } from '../core';
import { getLedLogoTexture } from '../textures';
import { HSV_GLSL, type LandmarkModel } from './common';

const RADIUS = 55;
const CUT = 0.72;

export function createSphere(quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  setPropsTimeOfDay(timeOfDay);
  const root = new THREE.Group();
  root.name = 'sphere';
  const thetaMax = Math.acos(-CUT);
  const geo = new THREE.SphereGeometry(RADIUS, qPick(quality, 40, 64, 96), qPick(quality, 22, 36, 54), 0, Math.PI * 2, 0, thetaMax);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uLogo: { value: getLedLogoTexture() },
      uBright: { value: timeOfDay === 'day' ? 0.85 : 1.15 },
      uDots: { value: quality === 'low' ? 0 : 1 },
    },
  ]);
  uniforms.uLogo!.value = getLedLogoTexture();
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vN = normalize(position);
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform sampler2D uLogo;
      uniform float uBright;
      uniform float uDots;
      varying vec3 vN;
      varying vec2 vUv;
      ${HSV_GLSL}
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        float a = pulseHash(i), b = pulseHash(i + vec2(1.0, 0.0));
        float c = pulseHash(i + vec2(0.0, 1.0)), d = pulseHash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      vec3 sceneEye(vec3 n, float t) {
        vec3 d0 = normalize(vec3(0.35 * sin(t * 0.37), 0.12 + 0.1 * sin(t * 0.23), 1.0));
        float a = acos(clamp(dot(n, d0), -1.0, 1.0));
        vec3 side = normalize(cross(d0, vec3(0.0, 1.0, 0.0)));
        vec3 upv = cross(side, d0);
        float ang = atan(dot(n, upv), dot(n, side));
        vec3 sclera = vec3(0.95, 0.93, 0.9);
        float vein = smoothstep(0.92, 1.0, vnoise(vec2(ang * 6.0, a * 14.0))) * smoothstep(0.5, 1.4, a);
        sclera = mix(sclera, vec3(0.8, 0.1, 0.08), vein * 0.6);
        float streak = 0.6 + 0.4 * vnoise(vec2(ang * 18.0, a * 6.0));
        vec3 iris = mix(vec3(0.05, 0.35, 0.55), vec3(0.45, 0.85, 0.35), smoothstep(0.1, 0.46, a)) * streak;
        vec3 c = mix(iris, sclera, smoothstep(0.44, 0.47, a));
        c = mix(vec3(0.0), c, smoothstep(0.17, 0.2, a));
        c += vec3(1.0) * smoothstep(0.06, 0.03, distance(n, normalize(d0 + vec3(0.1, 0.12, 0.0))));
        return c;
      }
      vec3 sceneFlag(vec2 uv, float t) {
        vec2 p = vec2(uv.x * 28.0 + t * 0.6, uv.y * 14.0);
        p.y += sin(p.x * 0.45 - t * 2.2) * 0.9;
        float chk = mod(floor(p.x) + floor(p.y), 2.0);
        float shade = 0.75 + 0.25 * sin(p.x * 0.45 - t * 2.2 + 1.2);
        vec3 c = mix(vec3(0.03), vec3(0.96), chk) * shade;
        float band = smoothstep(0.02, 0.0, abs(uv.y - 0.36)) + smoothstep(0.02, 0.0, abs(uv.y - 0.64));
        return mix(c, vec3(0.71, 1.0, 0.23), clamp(band, 0.0, 1.0));
      }
      vec3 scenePlasma(vec2 uv, float t) {
        vec2 p = uv * vec2(12.0, 6.0);
        float v = sin(p.x + t) + sin(p.y * 1.3 - t * 0.8) + sin((p.x + p.y) * 0.7 + t * 1.3) + sin(length(p - vec2(6.0, 3.0)) * 1.5 - t * 2.0);
        float h = 0.25 + 0.2 * sin(v * 0.8 + t * 0.2);
        return pulseHsv(fract(h + 0.5 * step(0.0, sin(v * 1.7))), 0.85, 0.55 + 0.45 * sin(v * 2.0));
      }
      vec3 sceneLogo(vec2 uv, float t) {
        float y = (uv.y - 0.4) / 0.26;
        vec3 bg = mix(vec3(0.02, 0.05, 0.03), vec3(0.0, 0.18, 0.1), uv.y);
        float line = smoothstep(0.012, 0.0, abs(uv.y - (0.32 + 0.03 * sin(uv.x * 60.0 - t * 4.0))));
        bg += vec3(0.71, 1.0, 0.23) * line;
        if (y > 0.0 && y < 1.0) {
          vec3 logo = texture2D(uLogo, vec2(uv.x * 3.0 - t * 0.03, y)).rgb;
          bg = max(bg, logo);
        }
        return bg;
      }
      void main() {
        float t = uTime;
        float cycle = mod(t, 36.0);
        vec3 c0 = sceneEye(vN, t);
        vec3 c1 = sceneFlag(vUv, t);
        vec3 c2 = scenePlasma(vUv, t);
        vec3 c3 = sceneLogo(vUv, t);
        float w1 = smoothstep(8.0, 9.5, cycle) - smoothstep(17.0, 18.5, cycle);
        float w2 = smoothstep(17.0, 18.5, cycle) - smoothstep(26.0, 27.5, cycle);
        float w3 = smoothstep(26.0, 27.5, cycle) - smoothstep(34.5, 36.0, cycle);
        float w0 = clamp(1.0 - w1 - w2 - w3, 0.0, 1.0);
        vec3 col = c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3;
        if (uDots > 0.5) {
          vec2 grid = vUv * vec2(900.0, 360.0);
          vec2 g = fract(grid) - 0.5;
          float dotm = smoothstep(0.5, 0.25, length(g));
          float fw = clamp(max(fwidth(grid.x), fwidth(grid.y)) - 0.5, 0.0, 1.0);
          col *= mix(0.35 + 0.9 * dotm, 0.8, fw);
        }
        gl_FragColor = vec4(col * uBright, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.userData.owned = true;
  const sphere = new THREE.Mesh(geo, mat);
  sphere.position.y = RADIUS * CUT;
  sphere.rotation.y = -Math.PI / 2;
  sphere.name = 'sphere-led';
  root.add(sphere);

  const b = new MeshBuilder();
  b.prim(new THREE.CylinderGeometry(RADIUS * 0.72, RADIUS * 0.76, 3, 32), { x: 0, y: 1.5, z: 0 }, '#22252a');
  b.prim(new THREE.CylinderGeometry(RADIUS * 0.735, RADIUS * 0.735, 0.4, 32, 1, true), { x: 0, y: 3.1, z: 0 }, '#b6ff3b', { glow: [0.4, 1.6] });
  b.prim(new THREE.CylinderGeometry(RADIUS * 1.15, RADIUS * 1.15, 0.3, 40), { x: 0, y: 0.15, z: 0 }, '#5a5f66');
  b.box(0, 4.5, RADIUS * 0.8, 36, 0.6, 16, '#2a2d33', { colorFace: (f) => (f === FACE.NY ? '#fff1d6' : undefined), glowFace: (f) => (f === FACE.NY ? ([0.2, 1.4] as const) : undefined) });
  for (const x of [-16, 0, 16]) b.boxOn(x, 0, RADIUS * 0.8 + 7, 0.6, 4.2, 0.6, '#3a3f46', { faces: FACE.SIDES });
  root.add(b.mesh(getVCMaterial(quality), 'sphere-plaza'));

  return {
    root,
    update(t: number) {
      uniforms.uTime!.value = t;
    },
    dispose() {
      disposeProp(root);
    },
  };
}
