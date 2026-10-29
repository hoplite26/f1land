/**
 * Shared, cached materials for the car models. Livery materials are cached
 * per (quality, colours); carbon/metal/dark materials are global. Per-car
 * materials (decal atlas, wheels) are created by the car builders and share
 * shader programs with each other because their parameters are identical.
 */
import * as THREE from 'three';
import type { TeamLivery } from '@/data/teams';
import type { ModelQuality, TyreLetter } from '../types';
import { brakeGlowTexture, f1EmissiveMask, tyreTexture, wheelOrmTexture } from './decals';

export const HIGHLIGHT_COLOR = new THREE.Color('#C6FF3D');

const cache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const m = make();
  m.name = key;
  cache.set(key, m);
  return m;
}

function isMetallicPaint(hex: string): boolean {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  return hsl.s < 0.12 && hsl.l > 0.18 && hsl.l < 0.8;
}

export interface PaintOptions {
  color: string;
  quality: ModelQuality;
  metallic?: boolean;
  /** Matte finish (roughness up, no clearcoat). */
  matte?: boolean;
}

export function paintMaterial(o: PaintOptions): THREE.MeshStandardMaterial {
  const metallic = o.metallic ?? isMetallicPaint(o.color);
  const key = `paint|${o.quality}|${o.color}|${metallic ? 'm' : 's'}|${o.matte ? 'mt' : 'gl'}`;
  return cached(key, () => {
    const metalness = metallic ? 0.62 : 0.18;
    const roughness = o.matte ? 0.55 : metallic ? 0.34 : 0.3;
    if (o.quality === 'high') {
      return new THREE.MeshPhysicalMaterial({
        color: o.color,
        metalness,
        roughness,
        clearcoat: o.matte ? 0.2 : 1,
        clearcoatRoughness: o.matte ? 0.4 : 0.06,
      });
    }
    return new THREE.MeshStandardMaterial({ color: o.color, metalness, roughness: roughness + 0.04 });
  });
}

export interface LiveryMaterials {
  primary: THREE.MeshStandardMaterial;
  wing: THREE.MeshStandardMaterial;
}

export function liveryMaterials(l: TeamLivery, q: ModelQuality): LiveryMaterials {
  return {
    primary: paintMaterial({ color: l.primary, quality: q }),
    wing: cached(
      `wing|${q}|${l.wing}`,
      () => new THREE.MeshStandardMaterial({ color: l.wing, roughness: 0.72, metalness: 0.1, envMapIntensity: 0.25 }),
    ),
  };
}

export function carbonMaterial(q: ModelQuality): THREE.MeshStandardMaterial {
  return cached(`carbon|${q === 'high' ? 'h' : 'l'}`, () =>
    q === 'high'
      ? new THREE.MeshPhysicalMaterial({
          color: '#111215',
          roughness: 0.5,
          metalness: 0.25,
          clearcoat: 0.5,
          clearcoatRoughness: 0.3,
          envMapIntensity: 0.6,
        })
      : new THREE.MeshStandardMaterial({ color: '#121317', roughness: 0.55, metalness: 0.25, envMapIntensity: 0.6 }),
  );
}

export function metalMaterial(): THREE.MeshStandardMaterial {
  return cached('metal', () => new THREE.MeshStandardMaterial({ color: '#A3A9B0', roughness: 0.26, metalness: 0.95 }));
}

/** Vertex-coloured dark parts (carbon/metal/wing merged into one draw call on medium/low). */
export function darkVertexMaterial(): THREE.MeshStandardMaterial {
  return cached('dark-vc', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35, envMapIntensity: 0.6 }));
}

export function glassMaterial(q: ModelQuality): THREE.MeshStandardMaterial {
  return cached(`glass|${q === 'high' ? 'h' : 'l'}`, () =>
    q === 'high'
      ? new THREE.MeshPhysicalMaterial({ color: '#07090D', roughness: 0.05, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.02 })
      : new THREE.MeshStandardMaterial({ color: '#07090D', roughness: 0.08, metalness: 0.7 }),
  );
}

/* ------------------------------------------------------------------------ */
/* Highlight rim (fresnel emissive) injection                               */
/* ------------------------------------------------------------------------ */

export interface RimUniform {
  value: number;
}

/**
 * Adds a lime fresnel rim + faint body tint driven by `level.value` (0..1).
 * All rim materials share one program variant via customProgramCacheKey.
 */
export function addRim(mat: THREE.MeshStandardMaterial, level: RimUniform): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimLevel = level;
    shader.uniforms.uRimColor = { value: HIGHLIGHT_COLOR };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRimLevel;\nuniform vec3 uRimColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if ( uRimLevel > 0.0 ) {
          float rimF = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
          totalEmissiveRadiance += uRimColor * uRimLevel * ( 0.015 + 1.1 * smoothstep( 0.6, 1.0, rimF ) );
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'pa-rim';
}

/* ------------------------------------------------------------------------ */
/* Per-car materials                                                        */
/* ------------------------------------------------------------------------ */

export function atlasMaterial(
  map: THREE.Texture,
  q: ModelQuality,
  rim: RimUniform | null,
  emissiveMap: THREE.Texture = f1EmissiveMask(),
  emissive = '#FF1A1A',
): THREE.MeshStandardMaterial {
  const params: THREE.MeshPhysicalMaterialParameters = {
    map,
    roughness: 0.3,
    metalness: 0.18,
    alphaTest: 0.5,
    emissive,
    emissiveMap,
    emissiveIntensity: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  };
  const m =
    q === 'high'
      ? new THREE.MeshPhysicalMaterial({ ...params, clearcoat: 1, clearcoatRoughness: 0.06 })
      : new THREE.MeshStandardMaterial(params);
  if (rim) addRim(m, rim);
  return m;
}

const TYRE_TEX_SIZE: Record<ModelQuality, readonly [number, number]> = {
  high: [512, 256],
  medium: [256, 128],
  low: [128, 64],
};

export function f1TyreMap(letter: TyreLetter, q: ModelQuality): THREE.Texture {
  return tyreTexture(letter, TYRE_TEX_SIZE[q]);
}

export function wheelMaterial(q: ModelQuality, letter: TyreLetter = 'M'): THREE.MeshStandardMaterial {
  const orm = wheelOrmTexture();
  return new THREE.MeshStandardMaterial({
    map: f1TyreMap(letter, q),
    roughnessMap: orm,
    metalnessMap: orm,
    roughness: 1,
    metalness: 1,
    emissive: '#FF4A0A',
    emissiveMap: brakeGlowTexture(),
    emissiveIntensity: 0,
  });
}
