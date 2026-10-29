/**
 * Procedural city blocks: facade walls (window texture, lit windows at night)
 * merged into one mesh + roofs/rooftop details in a second vertex-coloured
 * mesh → 2 draw calls per call regardless of building count.
 */
import * as THREE from 'three';
import type { TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../types';
import {
  FACE,
  MeshBuilder,
  PROP_UNIFORMS,
  Rng,
  cachedMaterial,
  disposeProp,
  getVCMaterial,
  hashSeed,
  qPick,
  setPropsTimeOfDay,
  type Glow,
} from './core';
import { getFacadeTextures, type FacadeStyle } from './textures';

export type BuildingStyle = FacadeStyle;

export interface BuildingFootprint {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Rotation around Y (radians). */
  rot: number;
}

/** Facade material: window texture × vertex tint, lit-window emissive scaled by night level. */
export function getFacadeMaterial(style: BuildingStyle, quality: ModelQuality): THREE.Material {
  const key = `facade|${style}|${quality === 'high' ? 'std' : 'lam'}`;
  return cachedMaterial(key, () => {
    const t = getFacadeTextures(style);
    const common = { map: t.map, emissiveMap: t.emissiveMap, emissive: new THREE.Color('#ffffff'), vertexColors: true };
    const mat =
      quality === 'high'
        ? new THREE.MeshStandardMaterial({
            ...common,
            roughness: style === 'modern' ? 0.35 : 0.85,
            metalness: style === 'modern' ? 0.2 : 0,
          })
        : new THREE.MeshLambertMaterial(common);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = PROP_UNIFORMS.uNight;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNight * 1.35;');
    };
    mat.customProgramCacheKey = () => key;
    return mat;
  });
}

export function facadeTile(style: BuildingStyle): { w: number; h: number } {
  const t = getFacadeTextures(style);
  return { w: t.tileW, h: t.tileH };
}

/* ------------------------------------------------------------------ */
/* Geometry helpers (shared with landmarks / pit)                      */
/* ------------------------------------------------------------------ */

function signedArea(outline: readonly THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!;
    const q = outline[(i + 1) % outline.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Returns the outline (x, z) ordered so walls face outwards. */
export function orientOutline(outline: readonly THREE.Vector2[]): THREE.Vector2[] {
  const o = outline.map((p) => p.clone());
  if (signedArea(o) > 0) o.reverse();
  return o;
}

/**
 * Extruded walls of a polygon outline (x, z) from y0 to y1 with facade UVs
 * (u = perimeter metres / tileW, v = height / tileH). Builder needs uv.
 */
export function addPrismWalls(
  b: MeshBuilder,
  outline: readonly THREE.Vector2[],
  y0: number,
  y1: number,
  tile: { w: number; h: number },
  color: THREE.ColorRepresentation,
  opts: { glow?: Glow; vOffset?: number; uOffset?: number; closed?: boolean } = {},
): void {
  const o = orientOutline(outline);
  let u = opts.uOffset ?? 0;
  const v0 = (opts.vOffset ?? 0) / tile.h;
  const v1 = v0 + (y1 - y0) / tile.h;
  const n = opts.closed === false ? o.length - 1 : o.length;
  for (let i = 0; i < n; i++) {
    const p = o[i]!;
    const q = o[(i + 1) % o.length]!;
    const len = p.distanceTo(q);
    // Snap each wall to whole half-bays so windows don't get sliced at corners.
    const du = Math.max(0.5, Math.round((len / tile.w) * 8) / 8);
    b.quad(
      new THREE.Vector3(p.x, y0, p.y),
      new THREE.Vector3(q.x, y0, q.y),
      new THREE.Vector3(q.x, y1, q.y),
      new THREE.Vector3(p.x, y1, p.y),
      color,
      opts.glow ?? [0, 0],
      [u, v0, u + du, v1],
    );
    u += du;
  }
}

/** Horizontal polygon cap at height y (facing up, or down when `down`). */
export function addPolygonCap(
  b: MeshBuilder,
  outline: readonly THREE.Vector2[],
  y: number,
  color: THREE.ColorRepresentation,
  opts: { glow?: Glow; down?: boolean } = {},
): void {
  const o = orientOutline(outline);
  const tris = THREE.ShapeUtils.triangulateShape(o, []);
  const up = new THREE.Vector3(0, opts.down ? -1 : 1, 0);
  for (const [i, j, k] of tris) {
    const a = new THREE.Vector3(o[i!]!.x, y, o[i!]!.y);
    const bb = new THREE.Vector3(o[j!]!.x, y, o[j!]!.y);
    const c = new THREE.Vector3(o[k!]!.x, y, o[k!]!.y);
    const nrm = new THREE.Vector3().subVectors(bb, a).cross(new THREE.Vector3().subVectors(c, a));
    if ((nrm.y > 0) === !opts.down) b.tri(a, bb, c, color, opts.glow ?? [0, 0], undefined, up);
    else b.tri(a, c, bb, color, opts.glow ?? [0, 0], undefined, up);
  }
}

export function rectOutline(x: number, z: number, w: number, d: number, rot: number): THREE.Vector2[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([lx, lz]) => new THREE.Vector2(x + lx! * c + lz! * s, z - lx! * s + lz! * c));
}

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

const TINTS: Record<BuildingStyle, string[]> = {
  modern: ['#ffffff', '#e8eef5', '#dfe8f0', '#f4f4f4', '#e6ecef', '#d9e4ea'],
  monaco: ['#f7e7c6', '#f3d2b2', '#efc3ab', '#f8f0e2', '#ead6a3', '#f1cbc2', '#e9e2d1', '#f5dcb8'],
  desert: ['#f3e5c8', '#ebd5af', '#f7eedb', '#dfc69e', '#f0dcc0'],
  industrial: ['#e2e5e8', '#cdd2d7', '#bfcad2', '#e8e8e8', '#a9bccd', '#d8cfc0'],
};
const ROOF: Record<BuildingStyle, string> = {
  modern: '#6c737b',
  monaco: '#b5563d',
  desert: '#e2d0ad',
  industrial: '#7f8992',
};
const LED_COLORS = ['#22d3ee', '#b6ff3b', '#f472b6', '#a78bfa', '#fbbf24'];

export interface BuildingsOptions {
  seed?: number;
  /** Adds tall-building crowns, spires and aviation lights (default true). */
  details?: boolean;
}

export function createBuildings(
  footprints: readonly BuildingFootprint[],
  style: BuildingStyle,
  timeOfDay: TimeOfDay,
  quality: ModelQuality,
  opts: BuildingsOptions = {},
): THREE.Group {
  setPropsTimeOfDay(timeOfDay);
  const rng = new Rng(opts.seed ?? hashSeed('bld', style, footprints.length, footprints[0]?.x ?? 0));
  const walls = new MeshBuilder({ uv: true });
  const roofs = new MeshBuilder();
  appendBuildings(walls, roofs, footprints, style, quality, rng, opts.details ?? true);
  const group = new THREE.Group();
  group.name = `buildings-${style}`;
  group.add(walls.mesh(getFacadeMaterial(style, quality), 'building-walls'));
  group.add(roofs.mesh(getVCMaterial(quality), 'building-roofs'));
  return group;
}

/** Appends buildings into existing builders (walls: uv builder for the facade material, roofs: VC). */
export function appendBuildings(
  walls: MeshBuilder,
  roofs: MeshBuilder,
  footprints: readonly BuildingFootprint[],
  style: BuildingStyle,
  quality: ModelQuality,
  rng: Rng,
  details = true,
): void {
  const tile = facadeTile(style);
  for (const f of footprints) {
    const tint = rng.pick(TINTS[style]);
    const outline = rectOutline(f.x, f.z, f.w, f.d, f.rot);
    addPrismWalls(walls, outline, 0, f.h, tile, tint, { uOffset: rng.int(0, 3) * 0.25 });
    const cx = f.x;
    const cz = f.z;
    if (style === 'monaco') {
      addHipRoof(roofs, f, ROOF.monaco);
      // Eaves band
      roofs.box(cx, f.h - 0.15, cz, f.w + 0.5, 0.3, f.d + 0.5, '#efe6d6', { ry: f.rot, faces: FACE.SIDES | FACE.NY });
      continue;
    }
    if (style === 'industrial' && f.h < 18 && rng.chance(0.6)) {
      addGableRoof(roofs, f, ROOF.industrial);
      continue;
    }
    addPolygonCap(roofs, outline, f.h, ROOF[style]);
    // Parapet
    if (quality !== 'low') {
      const pc = new THREE.Color(tint).multiplyScalar(0.82);
      roofs.box(cx, f.h + 0.45, cz, f.w + 0.2, 0.9, f.d + 0.2, pc, { ry: f.rot, faces: FACE.SIDES });
      roofs.box(cx, f.h + 0.45, cz, f.w - 0.3, 0.9, f.d - 0.3, pc.clone().multiplyScalar(0.8), { ry: f.rot, faces: FACE.SIDES });
    }
    // Rooftop plant
    const units = qPick(quality, 1, 2, 3);
    for (let k = 0; k < units; k++) {
      const uw = Math.min(f.w, f.d) * rng.range(0.15, 0.3);
      const ox = rng.range(-0.3, 0.3) * f.w;
      const oz = rng.range(-0.3, 0.3) * f.d;
      const c = Math.cos(f.rot);
      const s = Math.sin(f.rot);
      roofs.boxOn(cx + ox * c + oz * s, f.h, cz - ox * s + oz * c, uw, rng.range(1.2, 3), uw * rng.range(0.8, 1.4), '#9aa1a8', {
        ry: f.rot,
        faces: FACE.NO_BOTTOM,
      });
    }
    if (style === 'desert' && rng.chance(0.25)) {
      const r = Math.min(f.w, f.d) * 0.28;
      roofs.prim(
        new THREE.SphereGeometry(r, qPick(quality, 6, 8, 12), qPick(quality, 3, 4, 6), 0, Math.PI * 2, 0, Math.PI / 2),
        { x: cx, y: f.h, z: cz },
        rng.chance(0.5) ? '#f8f4ea' : '#2aa7a0',
      );
    }
    if (details && style === 'modern' && f.h > 60) {
      // Setback crown + LED band + spire + aviation light.
      const cw = f.w * 0.62;
      const cd = f.d * 0.62;
      const ch = Math.min(14, f.h * 0.08);
      roofs.boxOn(cx, f.h, cz, cw, ch, cd, '#5d6670', { ry: f.rot, faces: FACE.NO_BOTTOM });
      if (rng.chance(0.55)) {
        const led = rng.pick(LED_COLORS);
        roofs.box(cx, f.h - 1.2, cz, f.w + 0.15, 0.7, f.d + 0.15, led, { ry: f.rot, faces: FACE.SIDES, glow: [0.25, 1.8] });
      }
      let top = f.h + ch;
      if (rng.chance(0.5)) {
        const sh = rng.range(12, 30);
        roofs.prim(new THREE.CylinderGeometry(0.25, 0.7, sh, 6, 1, true), { x: cx, y: top + sh / 2, z: cz }, '#c8ccd0');
        top += sh;
      }
      roofs.box(cx, top + 0.4, cz, 0.8, 0.8, 0.8, '#ff2a1a', { glow: [0.6, 3.0] });
    }
  }
}

function localToWorld(f: BuildingFootprint, lx: number, y: number, lz: number): THREE.Vector3 {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  return new THREE.Vector3(f.x + lx * c + lz * s, y, f.z - lx * s + lz * c);
}

function addHipRoof(b: MeshBuilder, f: BuildingFootprint, color: string): void {
  const e = 0.35;
  const hw = f.w / 2 + e;
  const hd = f.d / 2 + e;
  const y = f.h;
  const rise = Math.min(f.w, f.d) * 0.28;
  const along = f.w >= f.d;
  const r = along ? Math.max(0, hw - hd) : Math.max(0, hd - hw);
  const P = (x: number, yy: number, z: number) => localToWorld(f, x, yy, z);
  const c0 = P(-hw, y, -hd);
  const c1 = P(hw, y, -hd);
  const c2 = P(hw, y, hd);
  const c3 = P(-hw, y, hd);
  const shadeA = new THREE.Color(color);
  const shadeB = new THREE.Color(color).multiplyScalar(0.86);
  if (along) {
    const r0 = P(-r, y + rise, 0);
    const r1 = P(r, y + rise, 0);
    b.quad(c3, c2, r1, r0, shadeA);
    b.quad(c1, c0, r0, r1, shadeB);
    b.tri(c0, c3, r0, shadeB);
    b.tri(c2, c1, r1, shadeA);
  } else {
    const r0 = P(0, y + rise, -r);
    const r1 = P(0, y + rise, r);
    b.quad(c2, c1, r0, r1, shadeA);
    b.quad(c0, c3, r1, r0, shadeB);
    b.tri(c1, c0, r0, shadeB);
    b.tri(c3, c2, r1, shadeA);
  }
}

function addGableRoof(b: MeshBuilder, f: BuildingFootprint, color: string): void {
  const hw = f.w / 2 + 0.3;
  const hd = f.d / 2 + 0.3;
  const y = f.h;
  const rise = Math.min(f.w, f.d) * 0.18;
  const P = (x: number, yy: number, z: number) => localToWorld(f, x, yy, z);
  const along = f.w >= f.d;
  if (along) {
    b.quad(P(-hw, y, hd), P(hw, y, hd), P(hw, y + rise, 0), P(-hw, y + rise, 0), color);
    b.quad(P(hw, y, -hd), P(-hw, y, -hd), P(-hw, y + rise, 0), P(hw, y + rise, 0), new THREE.Color(color).multiplyScalar(0.85));
    b.tri(P(-hw, y, -hd), P(-hw, y, hd), P(-hw, y + rise, 0), '#c9ced3');
    b.tri(P(hw, y, hd), P(hw, y, -hd), P(hw, y + rise, 0), '#c9ced3');
  } else {
    b.quad(P(hw, y, hd), P(hw, y, -hd), P(0, y + rise, -hd), P(0, y + rise, hd), color);
    b.quad(P(-hw, y, -hd), P(-hw, y, hd), P(0, y + rise, hd), P(0, y + rise, -hd), new THREE.Color(color).multiplyScalar(0.85));
    b.tri(P(hw, y, -hd), P(-hw, y, -hd), P(0, y + rise, -hd), '#c9ced3');
    b.tri(P(-hw, y, hd), P(hw, y, hd), P(0, y + rise, hd), '#c9ced3');
  }
}

/* ------------------------------------------------------------------ */
/* Skyline                                                             */
/* ------------------------------------------------------------------ */

export interface SkylineOptions {
  seed?: number;
  minH?: number;
  maxH?: number;
  /** Radial thickness of the ring as a fraction of radius (default 0.25). */
  spread?: number;
  /** Only place buildings within this angular range [start, end] (radians). */
  arc?: [number, number];
}

const SKY_H: Record<BuildingStyle, [number, number]> = {
  modern: [35, 230],
  monaco: [14, 55],
  desert: [12, 160],
  industrial: [8, 28],
};

/** Distant ring of towers around `center` (2 draw calls). */
export function createSkyline(
  center: THREE.Vector3 | { x: number; z: number },
  radius: number,
  count: number,
  style: BuildingStyle,
  timeOfDay: TimeOfDay,
  quality: ModelQuality,
  opts: SkylineOptions = {},
): THREE.Group {
  const rng = new Rng(opts.seed ?? hashSeed('skyline', style, radius, count));
  const [minH, maxH] = [opts.minH ?? SKY_H[style][0], opts.maxH ?? SKY_H[style][1]];
  const spread = opts.spread ?? 0.25;
  const [a0, a1] = opts.arc ?? [0, Math.PI * 2];
  const fps: BuildingFootprint[] = [];
  for (let i = 0; i < count; i++) {
    const a = a0 + ((i + rng.range(0.1, 0.9)) / count) * (a1 - a0);
    const r = radius * (1 + rng.range(-spread / 2, spread / 2));
    const k = Math.pow(rng.next(), style === 'modern' ? 2.2 : 1.6);
    const h = minH + (maxH - minH) * k;
    const w = style === 'industrial' ? rng.range(25, 60) : rng.range(16, 34) + h * 0.06;
    fps.push({
      x: center.x + Math.cos(a) * r,
      z: center.z + Math.sin(a) * r,
      w,
      d: style === 'industrial' ? rng.range(20, 45) : w * rng.range(0.7, 1.2),
      h,
      rot: -a + rng.range(-0.2, 0.2),
    });
  }
  const g = createBuildings(fps, style, timeOfDay, quality, { seed: opts.seed });
  g.name = `skyline-${style}`;
  return g;
}

export { disposeProp as disposeBuildings };
