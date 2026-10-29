/**
 * Atmosphere helpers: gradient sky dome (sun glow, stars, city glow), animated
 * water material, procedural ground material and recommended light/fog presets.
 */
import * as THREE from 'three';
import type { EnvironmentTheme, TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../types';
import { PROP_UNIFORMS, nightLevel, setPropsTimeOfDay } from './core';
import { getGroundTexture } from './textures';

/* ------------------------------------------------------------------ */
/* Atmosphere presets                                                  */
/* ------------------------------------------------------------------ */

export interface PropsAtmosphere {
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  skyGround: THREE.Color;
  /** Horizon glow colour (dusk afterglow / city light pollution). */
  glow: THREE.Color;
  glowStrength: number;
  fogColor: THREE.Color;
  /** For THREE.FogExp2. */
  fogDensity: number;
  /** Direction *towards* the sun/moon (normalised). */
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  stars: number;
  /** Suggested renderer.toneMappingExposure. */
  exposure: number;
}

/** Recommended sky/fog/light settings for a circuit's theme and time of day. */
export function getAtmosphere(tod: TimeOfDay, theme: EnvironmentTheme): PropsAtmosphere {
  const desert = theme === 'desert' || theme === 'dunes';
  const city = theme === 'street';
  const c = (h: string) => new THREE.Color(h);
  if (tod === 'day') {
    return {
      skyTop: c(desert ? '#3f86d6' : '#2f74d0'),
      skyHorizon: c(desert ? '#e9dcc0' : theme === 'forest' ? '#c6dbe9' : '#cfe3f3'),
      skyGround: c(desert ? '#cdb790' : '#9fb1a0'),
      glow: c('#fff1d0'),
      glowStrength: desert ? 0.25 : 0.1,
      fogColor: c(desert ? '#e2d6bd' : '#c9dbe8'),
      fogDensity: desert ? 0.00055 : 0.00042,
      sunDirection: new THREE.Vector3(0.45, 0.78, 0.35).normalize(),
      sunColor: c('#fff3dd'),
      sunIntensity: 2.6,
      hemiSky: c('#d7e8ff'),
      hemiGround: c(desert ? '#b8986a' : '#5d6b4a'),
      hemiIntensity: 1.25,
      stars: 0,
      exposure: 1.0,
    };
  }
  if (tod === 'dusk') {
    return {
      skyTop: c('#24306e'),
      skyHorizon: c('#ff9a5c'),
      skyGround: c('#3a2f3a'),
      glow: c('#ff6a3d'),
      glowStrength: 0.65,
      fogColor: c('#b07a6a'),
      fogDensity: 0.00055,
      sunDirection: new THREE.Vector3(-0.85, 0.1, 0.45).normalize(),
      sunColor: c('#ffb27a'),
      sunIntensity: 1.6,
      hemiSky: c('#9aa4e0'),
      hemiGround: c('#5a3f3a'),
      hemiIntensity: 0.85,
      stars: 0.25,
      exposure: 1.05,
    };
  }
  return {
    skyTop: c('#02040b'),
    skyHorizon: c(city ? '#1b1a2c' : desert ? '#13182c' : '#0b1428'),
    skyGround: c('#05070c'),
    glow: c(city ? '#ff8a3c' : desert ? '#ffb070' : '#3a5a9a'),
    glowStrength: city ? 0.55 : desert ? 0.3 : 0.15,
    fogColor: c(city ? '#1a1822' : '#0b1020'),
    fogDensity: 0.00065,
    sunDirection: new THREE.Vector3(0.3, 0.75, -0.55).normalize(),
    sunColor: c('#c8d6ff'),
    sunIntensity: 0.8,
    hemiSky: c('#6a7aa8'),
    hemiGround: c('#2a2a30'),
    hemiIntensity: 0.9,
    stars: city ? 0.45 : 1,
    exposure: 1.1,
  };
}

/* ------------------------------------------------------------------ */
/* Sky dome                                                            */
/* ------------------------------------------------------------------ */

export interface SkyDome {
  mesh: THREE.Mesh;
  /** Recommended scene fog colour matching the horizon. */
  fogColor: THREE.Color;
  sunDirection: THREE.Vector3;
  setSunDirection(dir: THREE.Vector3): void;
  update(timeSec: number): void;
  dispose(): void;
}

/**
 * Gradient sky dome that always renders behind everything (depth forced to
 * the far plane, follows the camera). Stars at night, sun/moon glow, horizon
 * glow for dusk and city light pollution.
 */
export function createSkyDome(timeOfDay: TimeOfDay, theme: EnvironmentTheme): SkyDome {
  const a = getAtmosphere(timeOfDay, theme);
  const uniforms = {
    uTop: { value: a.skyTop },
    uHorizon: { value: a.skyHorizon },
    uGround: { value: a.skyGround },
    uGlow: { value: a.glow },
    uGlowStrength: { value: a.glowStrength },
    uSunDir: { value: a.sunDirection.clone() },
    uSunColor: { value: a.sunColor },
    uSunSize: { value: timeOfDay === 'night' ? 0.0009 : timeOfDay === 'dusk' ? 0.0016 : 0.0012 },
    uSunGlow: { value: timeOfDay === 'night' ? 0.12 : timeOfDay === 'dusk' ? 0.9 : 0.5 },
    uStars: { value: a.stars },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
        gl_Position.z = p.w * 0.99999;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uGlow;
      uniform float uGlowStrength; uniform vec3 uSunDir; uniform vec3 uSunColor;
      uniform float uSunSize; uniform float uSunGlow; uniform float uStars; uniform float uTime;
      varying vec3 vDir;
      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, uGround, smoothstep(0.0, -0.12, h));
        vec3 sd = normalize(uSunDir);
        float s = max(dot(d, sd), 0.0);
        // Horizon glow, stronger towards the sun azimuth.
        float az = max(dot(normalize(vec2(d.x, d.z) + 1e-5), normalize(vec2(sd.x, sd.z) + 1e-5)), 0.0);
        col += uGlow * uGlowStrength * exp(-abs(h) * 9.0) * (0.45 + 0.55 * az * az);
        col += uSunColor * (pow(s, 6.0) * 0.25 + pow(s, 48.0) * 0.6) * uSunGlow;
        col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.55, s) * 3.0;
        if (uStars > 0.0 && h > 0.0) {
          vec3 p = d * 260.0;
          vec3 cell = floor(p);
          float r = hash13(cell);
          vec3 f = fract(p) - 0.5;
          float star = step(0.992, r) * smoothstep(0.22, 0.0, length(f));
          star *= 0.55 + 0.45 * sin(uTime * (0.8 + r * 3.0) + r * 60.0);
          col += vec3(0.9, 0.95, 1.0) * star * uStars * smoothstep(0.02, 0.3, h) * (0.6 + 2.0 * fract(r * 31.0));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
  };
  return {
    mesh,
    fogColor: a.fogColor.clone(),
    sunDirection: uniforms.uSunDir.value,
    setSunDirection(dir: THREE.Vector3) {
      uniforms.uSunDir.value.copy(dir).normalize();
    },
    update(timeSec: number) {
      uniforms.uTime.value = timeSec;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Water                                                               */
/* ------------------------------------------------------------------ */

export type AnimatedMaterial<T extends THREE.Material = THREE.Material> = T & {
  /** Advances the animation (also writes the shared props clock). */
  update(timeSec: number): void;
};

/**
 * Cheap animated water: analytic multi-octave ripple normals, fresnel sky
 * reflection and sparkles (sun glints by day, warm city reflections by night).
 * Uses world XZ, so any plane/mesh works without UVs.
 */
export function createWaterMaterial(
  timeOfDay: TimeOfDay,
  opts: { quality?: ModelQuality; deep?: THREE.ColorRepresentation; sky?: THREE.ColorRepresentation } = {},
): AnimatedMaterial<THREE.MeshStandardMaterial> {
  const night = nightLevel(timeOfDay);
  const deep = new THREE.Color(opts.deep ?? (timeOfDay === 'night' ? '#031522' : timeOfDay === 'dusk' ? '#13314a' : '#0d4a66'));
  const sky = new THREE.Color(opts.sky ?? (timeOfDay === 'night' ? '#14203a' : timeOfDay === 'dusk' ? '#c98a72' : '#9cc8e6'));
  const sparkle = new THREE.Color(timeOfDay === 'night' ? '#ffb46a' : timeOfDay === 'dusk' ? '#ffc08a' : '#ffffff');
  const mat = new THREE.MeshStandardMaterial({
    color: deep,
    roughness: 0.18,
    metalness: 0.05,
  });
  const uniforms = {
    uTime: PROP_UNIFORMS.uTime,
    uSky: { value: sky },
    uDeep: { value: deep.clone().multiplyScalar(0.6) },
    uSparkle: { value: sparkle },
    uSparkleAmt: { value: 0.35 + night * 0.4 },
    uOctaves: { value: opts.quality === 'low' ? 2 : 3 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 wpW = modelMatrix * vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  wpW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#endif
vWPos = wpW.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
uniform float uTime; uniform vec3 uSky; uniform vec3 uDeep; uniform vec3 uSparkle;
uniform float uSparkleAmt; uniform float uOctaves;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec2 wp = vWPos.xz;
float wt = uTime;
vec2 wg = vec2(cos(wp.x * 0.21 + wt * 1.1), cos(wp.y * 0.17 + wt * 0.9)) * 0.16;
wg += vec2(cos((wp.x + wp.y) * 0.43 - wt * 1.7), cos((wp.x - wp.y) * 0.37 + wt * 1.3)) * 0.1;
if (uOctaves > 2.5) wg += vec2(cos(wp.x * 1.13 + wp.y * 0.7 + wt * 2.3), cos(wp.y * 1.21 - wp.x * 0.6 - wt * 2.1)) * 0.05;
vec3 wn = normalize(vec3(-wg.x, 1.0, -wg.y));
normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
totalEmissiveRadiance += mix(uDeep, uSky, fres) * 0.6;
float glint = sin(wp.x * 2.9 + wt * 2.0 + wg.x * 8.0) * sin(wp.y * 2.3 - wt * 1.6 + wg.y * 8.0);
totalEmissiveRadiance += uSparkle * pow(max(glint, 0.0), 28.0) * uSparkleAmt * (0.4 + fres);`,
      );
  };
  mat.customProgramCacheKey = () => `pulse-water|${uniforms.uOctaves.value}`;
  const out = mat as AnimatedMaterial<THREE.MeshStandardMaterial>;
  out.update = (t: number) => {
    PROP_UNIFORMS.uTime.value = t;
  };
  return out;
}

/* ------------------------------------------------------------------ */
/* Ground                                                              */
/* ------------------------------------------------------------------ */

/**
 * Tiled procedural ground (mown grass stripes / desert sand / dunes / city
 * concrete). `repeat` = texture repeats across the mesh UV range.
 */
export function createGroundMaterial(
  theme: EnvironmentTheme,
  timeOfDay: TimeOfDay,
  opts: { repeat?: number | [number, number]; quality?: ModelQuality } = {},
): THREE.MeshLambertMaterial | THREE.MeshStandardMaterial {
  const tex = getGroundTexture(theme).clone();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const r = opts.repeat ?? 64;
  if (typeof r === 'number') tex.repeat.set(r, r);
  else tex.repeat.set(r[0], r[1]);
  tex.needsUpdate = true;
  const tint = timeOfDay === 'night' ? '#c9d2e6' : timeOfDay === 'dusk' ? '#f2dccb' : '#ffffff';
  const mat =
    opts.quality === 'high'
      ? new THREE.MeshStandardMaterial({ map: tex, color: tint, roughness: 0.95, metalness: 0 })
      : new THREE.MeshLambertMaterial({ map: tex, color: tint });
  mat.userData.owned = true;
  mat.addEventListener('dispose', () => tex.dispose());
  return mat;
}

/** Convenience: applies a time of day to every prop material + returns the atmosphere preset. */
export function applyPropsTimeOfDay(tod: TimeOfDay, theme: EnvironmentTheme): PropsAtmosphere {
  setPropsTimeOfDay(tod);
  return getAtmosphere(tod, theme);
}
