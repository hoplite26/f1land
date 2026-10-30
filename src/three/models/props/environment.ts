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
  /** Horizon-glow azimuth when it differs from the key light (blue hour). */
  glowDirection?: THREE.Vector3;
  /** Cloud amount 0..1 painted in the sky dome. */
  clouds?: number;
}

/** Recommended sky/fog/light settings for a circuit's theme and time of day. */
export function getAtmosphere(tod: TimeOfDay, theme: EnvironmentTheme): PropsAtmosphere {
  const desert = theme === 'desert' || theme === 'dunes';
  const city = theme === 'street';
  const c = (h: string) => new THREE.Color(h);
  if (tod === 'day') {
    // Cinematic afternoon: deep zenith, hazy horizon, warm low-ish sun for long shadows.
    return {
      skyTop: c(desert ? '#2a6fc4' : '#1f5fb6'),
      skyHorizon: c(desert ? '#e6d8bc' : theme === 'forest' ? '#c2d6e2' : '#c4d8e8'),
      skyGround: c(desert ? '#b9a27c' : '#7d8a7c'),
      glow: c('#ffe6bf'),
      glowStrength: desert ? 0.3 : 0.16,
      fogColor: c(desert ? '#d8cbb0' : theme === 'forest' ? '#b4c7d2' : '#b9cddd'),
      fogDensity: desert ? 0.0005 : 0.00042,
      sunDirection: new THREE.Vector3(0.52, 0.6, 0.6).normalize(),
      sunColor: c('#fff0d8'),
      sunIntensity: 2.9,
      hemiSky: c('#cfe0ff'),
      hemiGround: c(desert ? '#a88f68' : city ? '#6c6a66' : '#4f5c3e'),
      hemiIntensity: 1.1,
      stars: 0,
      exposure: 0.96,
      clouds: theme === 'desert' ? 0.35 : theme === 'forest' || theme === 'dunes' ? 0.8 : 0.6,
    };
  }
  if (tod === 'dusk') {
    // Blue hour (Yas Marina twilight race): indigo zenith, ember band on the western
    // horizon, floodlights doing the work. Key light comes from above (floodlights),
    // the horizon glow uses its own direction.
    return {
      skyTop: c('#030719'),
      skyHorizon: c('#231d44'),
      skyGround: c('#06070d'),
      glow: c('#ff6a32'),
      glowStrength: 0.5,
      glowDirection: new THREE.Vector3(-0.92, 0.04, 0.38).normalize(),
      fogColor: c('#17152a'),
      fogDensity: 0.00052,
      sunDirection: new THREE.Vector3(-0.3, 0.86, 0.42).normalize(),
      sunColor: c('#c6cdea'),
      sunIntensity: 1.6,
      hemiSky: c('#6273b0'),
      hemiGround: c('#241f2e'),
      hemiIntensity: 0.85,
      stars: 0.4,
      exposure: 1.0,
      clouds: 0.32,
    };
  }
  return {
    skyTop: c('#01030a'),
    skyHorizon: c(city ? '#1d1830' : desert ? '#141a30' : '#0b1328'),
    skyGround: c('#04050a'),
    glow: c(city ? '#ff8a3c' : desert ? '#ff9a58' : '#3a5a9a'),
    glowStrength: city ? 0.55 : desert ? 0.32 : 0.15,
    fogColor: c(city ? '#14111d' : desert ? '#0e1122' : '#0a0f1d'),
    fogDensity: 0.0006,
    sunDirection: new THREE.Vector3(0.3, 0.62, -0.72).normalize(),
    sunColor: c('#c8d6ff'),
    sunIntensity: 0.8,
    hemiSky: c('#6a7aa8'),
    hemiGround: c('#24242c'),
    hemiIntensity: 0.9,
    stars: city ? 0.4 : 1,
    exposure: 1.0,
    clouds: city ? 0.35 : 0.25,
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
  const day = timeOfDay === 'day';
  const dusk = timeOfDay === 'dusk';
  const uniforms = {
    uTop: { value: a.skyTop },
    uHorizon: { value: a.skyHorizon },
    uGround: { value: a.skyGround },
    uGlow: { value: a.glow },
    uGlowStrength: { value: a.glowStrength },
    uSunDir: { value: a.sunDirection.clone() },
    uGlowDir: { value: (a.glowDirection ?? a.sunDirection).clone() },
    uSunColor: { value: a.sunColor },
    // Blue hour: the sun has set (no disc), the ember band carries the colour.
    uSunSize: { value: timeOfDay === 'night' ? 0.00035 : dusk ? 0 : 0.0011 },
    uSunGlow: { value: timeOfDay === 'night' ? 0.08 : dusk ? 0 : 0.55 },
    uStars: { value: a.stars },
    uClouds: { value: a.clouds ?? 0 },
    uCloudLit: { value: new THREE.Color(day ? '#ffffff' : dusk ? '#7a4a58' : '#3a2f3a') },
    uCloudShade: { value: new THREE.Color(day ? '#9fb0c4' : dusk ? '#0c0b1c' : '#07080d') },
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
      uniform float uGlowStrength; uniform vec3 uSunDir; uniform vec3 uGlowDir; uniform vec3 uSunColor;
      uniform float uSunSize; uniform float uSunGlow; uniform float uStars; uniform float uTime;
      uniform float uClouds; uniform vec3 uCloudLit; uniform vec3 uCloudShade;
      varying vec3 vDir;
      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // Two-stage gradient: hazy band near the horizon, deep zenith.
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.42));
        col = mix(col, uHorizon * 1.08, exp(-max(h, 0.0) * 28.0) * 0.6);
        col = mix(col, uGround, smoothstep(0.0, -0.1, h));
        vec3 sd = normalize(uSunDir);
        vec3 gd = normalize(uGlowDir);
        float s = max(dot(d, sd), 0.0);
        float az = max(dot(normalize(vec2(d.x, d.z) + 1e-5), normalize(vec2(gd.x, gd.z) + 1e-5)), 0.0);
        float band = exp(-abs(h) * 7.0);
        col += uGlow * uGlowStrength * band * (0.25 + 0.75 * az * az * az);
        col += uGlow * uGlowStrength * 0.6 * exp(-abs(h) * 30.0) * az * az;
        col += uSunColor * (pow(s, 6.0) * 0.22 + pow(s, 64.0) * 0.6) * uSunGlow;
        col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.55, s) * 3.0;
        if (uClouds > 0.0 && h > 0.0) {
          vec2 cp = d.xz / (h + 0.16) * 1.35 + vec2(uTime * 0.0035, uTime * 0.001);
          float cn = vnoise(cp) * 0.52 + vnoise(cp * 2.07 + 1.7) * 0.3 + vnoise(cp * 4.3 + 5.1) * 0.18;
          float cov = smoothstep(0.78 - uClouds * 0.32, 0.98 - uClouds * 0.25, cn);
          cov *= smoothstep(0.015, 0.16, h) * (1.0 - smoothstep(0.55, 0.95, h) * 0.6);
          float lit = clamp(0.35 + 0.65 * (cn - 0.5) * 2.0, 0.0, 1.0);
          vec3 cc = mix(uCloudShade, uCloudLit, lit);
          cc += uGlow * uGlowStrength * band * az * 1.4;
          cc += uSunColor * pow(s, 8.0) * uSunGlow * 0.8;
          col = mix(col, cc, cov * 0.85);
        }
        if (uStars > 0.0 && h > 0.0) {
          vec3 p = d * 260.0;
          vec3 cell = floor(p);
          float r = hash13(cell);
          vec3 f = fract(p) - 0.5;
          float star = step(0.992, r) * smoothstep(0.22, 0.0, length(f));
          star *= 0.55 + 0.45 * sin(uTime * (0.8 + r * 3.0) + r * 60.0);
          col += vec3(0.9, 0.95, 1.0) * star * uStars * smoothstep(0.04, 0.35, h) * (0.6 + 2.0 * fract(r * 31.0));
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
