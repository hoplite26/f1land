/**
 * Shared infrastructure for procedural environment props: seeded RNG, global
 * prop uniforms (time / night level), a fast flat-shaded mesh builder that
 * bakes vertex colours + per-vertex glow, and cached materials.
 *
 * Draw-call strategy: almost every static prop is baked into ONE vertex
 * coloured geometry rendered with a shared material. Lit windows, LEDs and
 * lamps live in the same geometry: the `aGlow` attribute (x = always-on,
 * y = night-only) feeds the emissive term, scaled by `PROP_UNIFORMS.uNight`.
 */
import * as THREE from 'three';
import type { ModelQuality } from '../types';
import type { TimeOfDay } from '@/data/circuits/types';

/* ------------------------------------------------------------------ */
/* Global prop uniforms                                                */
/* ------------------------------------------------------------------ */

/** 1×1 "fully lit" site map used until a circuit bakes its own (no night falloff). */
const BLANK_SITE = new THREE.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1);
BLANK_SITE.needsUpdate = true;

export const PROP_UNIFORMS = {
  uTime: { value: 0 },
  /** 0 = day, ~0.85 = dusk (blue hour), 1 = night. Scales night-only glow (windows, lamps, halos). */
  uNight: { value: 0 },
  /**
   * Baked circuit site map (see track/site.ts), sampled in world XZ:
   * r = track proximity, g = night light (floodlight pools), b = paved ground, a = city light.
   */
  uSiteMap: { value: BLANK_SITE as THREE.Texture },
  /** xy = world XZ of the map origin, zw = 1 / world size. */
  uSiteRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  /** Strength of the night light falloff (0 = off, 1 = full night). */
  uSiteNight: { value: 0 },
};

/** Restores the neutral site map (no night falloff); called when a circuit environment is disposed. */
export function resetSiteMap(): void {
  PROP_UNIFORMS.uSiteMap.value = BLANK_SITE;
  PROP_UNIFORMS.uSiteRect.value.set(0, 0, 1, 1);
  PROP_UNIFORMS.uSiteNight.value = 0;
}

/**
 * GLSL for the baked night lighting. Surfaces away from floodlights fall to
 * `dark` × albedo, lit areas get a warm emissive pool — one texture fetch, no
 * real lights. Inject into lit (Lambert / Standard) materials with `injectSiteLight`.
 */
const SITE_VERT_PARS = /* glsl */ `varying vec2 vSiteXZ;`;
const SITE_VERT = /* glsl */ `
{
  vec4 siteW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  siteW = instanceMatrix * siteW;
#endif
  vSiteXZ = (modelMatrix * siteW).xz;
}`;
export const SITE_FRAG_PARS = /* glsl */ `
varying vec2 vSiteXZ;
uniform sampler2D uSiteMap;
uniform vec4 uSiteRect;
uniform float uSiteNight;
vec4 siteSample() { return texture2D(uSiteMap, (vSiteXZ - uSiteRect.xy) * uSiteRect.zw); }`;

export interface SiteLightOptions {
  /** Albedo multiplier far from any light at full night (default 0.13). */
  dark?: number;
  /** Warm emissive gain inside light pools (default 0.32). */
  pool?: number;
  /** Extra GLSL run after the falloff (has `siteS` = map sample, `siteK` = night strength). */
  extra?: string;
  /** Fragment line after which the falloff is inserted (default the emissive map include). */
  anchor?: string;
}

function siteApply(o: SiteLightOptions): string {
  const dark = (o.dark ?? 0.13).toFixed(3);
  const pool = (o.pool ?? 0.32).toFixed(3);
  return /* glsl */ `
{
  vec4 siteS = siteSample();
  float siteK = uSiteNight;
  float siteLit = siteS.g;
  diffuseColor.rgb *= mix(1.0, mix(${dark}, 1.0, siteLit), siteK);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.9, 0.78) * (siteLit * siteLit * ${pool} * siteK);
  ${o.extra ?? ''}
}`;
}

/**
 * Patches a Lambert/Standard/Phong shader (inside onBeforeCompile) with the
 * baked site lighting, applied after `o.anchor` (default: after the emissive
 * map include, where `diffuseColor` and `totalEmissiveRadiance` exist).
 */
export function injectSiteLight(shader: THREE.WebGLProgramParametersWithUniforms, o: SiteLightOptions = {}): void {
  shader.uniforms.uSiteMap = PROP_UNIFORMS.uSiteMap;
  shader.uniforms.uSiteRect = PROP_UNIFORMS.uSiteRect;
  shader.uniforms.uSiteNight = PROP_UNIFORMS.uSiteNight;
  if (!shader.vertexShader.includes('varying vec2 vSiteXZ;')) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SITE_VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${SITE_VERT}`);
  }
  if (!shader.fragmentShader.includes('uniform sampler2D uSiteMap;')) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${SITE_FRAG_PARS}`);
  }
  const anchor = o.anchor ?? '#include <emissivemap_fragment>';
  shader.fragmentShader = shader.fragmentShader.replace(anchor, `${anchor}\n${siteApply(o)}`);
}

/** Convenience: material whose shader gets the site lighting (chains an existing onBeforeCompile). */
export function withSiteLight<T extends THREE.Material>(mat: T, key: string, o: SiteLightOptions = {}): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    injectSiteLight(shader, o);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|site|${key}`;
  return mat;
}

const NIGHT_LEVEL: Record<TimeOfDay, number> = { day: 0, dusk: 0.85, night: 1 };

export function nightLevel(tod: TimeOfDay): number {
  return NIGHT_LEVEL[tod];
}

/** Sets the global night level for every prop material (accepts a 0..1 blend for transitions). */
export function setPropsTimeOfDay(tod: TimeOfDay | number): void {
  PROP_UNIFORMS.uNight.value =
    typeof tod === 'number' ? THREE.MathUtils.clamp(tod, 0, 1) : NIGHT_LEVEL[tod];
}

/** Advances the shared animation clock (vegetation wind, boat bobbing, water). Call once per frame. */
export function updatePropsTime(timeSec: number): void {
  PROP_UNIFORMS.uTime.value = timeSec;
}

/* ------------------------------------------------------------------ */
/* RNG                                                                 */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private readonly f: () => number;
  constructor(seed: number | string) {
    this.f = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed);
  }
  next(): number {
    return this.f();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.f();
  }
  /** Inclusive integer range. */
  int(a: number, b: number): number {
    return Math.min(b, Math.floor(a + (b - a + 1) * this.f()));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.f() * arr.length))] as T;
  }
  chance(p: number): boolean {
    return this.f() < p;
  }
}

/* ------------------------------------------------------------------ */
/* Colours                                                             */
/* ------------------------------------------------------------------ */

const colorCache = new Map<string, THREE.Color>();

/** Cached THREE.Color (linear working space). Do not mutate the result. */
export function C(c: THREE.ColorRepresentation): THREE.Color {
  if (c instanceof THREE.Color) return c;
  const key = String(c);
  let v = colorCache.get(key);
  if (!v) {
    v = new THREE.Color(c);
    colorCache.set(key, v);
  }
  return v;
}

/** New colour = c * k (not cached). */
export function shade(c: THREE.ColorRepresentation, k: number): THREE.Color {
  return C(c).clone().multiplyScalar(k);
}

export function mix(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number): THREE.Color {
  return C(a).clone().lerp(C(b), t);
}

/* ------------------------------------------------------------------ */
/* Quality helpers                                                     */
/* ------------------------------------------------------------------ */

export function qPick<T>(quality: ModelQuality, low: T, medium: T, high: T): T {
  return quality === 'low' ? low : quality === 'medium' ? medium : high;
}

/* ------------------------------------------------------------------ */
/* Mesh builder                                                        */
/* ------------------------------------------------------------------ */

export type Glow = readonly [number, number];
export const NO_GLOW: Glow = [0, 0];
/** UV rectangle [u0, v0, u1, v1]. */
export type UvRect = readonly [number, number, number, number];

export const FACE = { PX: 1, NX: 2, PY: 4, NY: 8, PZ: 16, NZ: 32, ALL: 63, NO_BOTTOM: 55, SIDES: 51 } as const;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());

// Unit cube faces as corner indices (bit0 = x+, bit1 = y+, bit2 = z+), CCW from outside: a,b,c,d.
const CUBE_FACES: [number, number, number, number, number][] = [
  [FACE.PX, 5, 1, 3, 7],
  [FACE.NX, 0, 4, 6, 2],
  [FACE.PY, 6, 7, 3, 2],
  [FACE.NY, 0, 1, 5, 4],
  [FACE.PZ, 4, 5, 7, 6],
  [FACE.NZ, 1, 0, 2, 3],
];

export interface BoxOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  glow?: Glow;
  faces?: number;
  /** UV rect applied to every face (builder must have uv enabled). */
  uv?: UvRect;
  /** Per-face UV rect; return undefined to fall back to `uv`. */
  uvFace?: (face: number) => UvRect | undefined;
  /** Per-face colour override. */
  colorFace?: (face: number) => THREE.ColorRepresentation | undefined;
  /** Per-face glow override. */
  glowFace?: (face: number) => Glow | undefined;
}

export interface BuilderOptions {
  uv?: boolean;
  /** Adds the `aTint` attribute (instance-colour mask / wind sway mask). */
  tint?: boolean;
  /** Extra per-vertex float attribute (`aPart`). */
  part?: boolean;
}

/**
 * Accumulates non-indexed, flat-shaded triangles with colour, glow (+uv/tint).
 * Much faster and lighter than merging hundreds of THREE.BufferGeometry parts.
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private glw: number[] = [];
  private readonly uvs: number[] | null;
  private readonly tints: number[] | null;
  private readonly parts: number[] | null;
  /** Current value written to `aTint` for new vertices. */
  tint = 0;
  /** Current value written to `aPart` for new vertices. */
  part = 0;

  constructor(opts: BuilderOptions = {}) {
    this.uvs = opts.uv ? [] : null;
    this.tints = opts.tint ? [] : null;
    this.parts = opts.part ? [] : null;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get triangleCount(): number {
    return this.pos.length / 9;
  }
  get hasUv(): boolean {
    return this.uvs !== null;
  }

  private vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, g: Glow, u: number, v: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    this.glw.push(g[0], g[1]);
    if (this.uvs) this.uvs.push(u, v);
    if (this.tints) this.tints.push(this.tint);
    if (this.parts) this.parts.push(this.part);
  }

  /** Triangle (CCW = front). Optional uv: [ua,va, ub,vb, uc,vc]. */
  tri(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    color: THREE.ColorRepresentation,
    glow: Glow = NO_GLOW,
    uv?: readonly number[],
    normal?: THREE.Vector3,
  ): void {
    const col = C(color);
    if (normal) _n.copy(normal);
    else _n.subVectors(b, a).cross(_d.subVectors(c, a)).normalize();
    this.vert(a, _n, col, glow, uv ? uv[0]! : 0, uv ? uv[1]! : 0);
    this.vert(b, _n, col, glow, uv ? uv[2]! : 0, uv ? uv[3]! : 0);
    this.vert(c, _n, col, glow, uv ? uv[4]! : 0, uv ? uv[5]! : 0);
  }

  /** Quad a(bottom-left) b(bottom-right) c(top-right) d(top-left), CCW seen from the front. */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.ColorRepresentation,
    glow: Glow = NO_GLOW,
    uv?: UvRect,
  ): void {
    const col = C(color);
    // Newell-ish normal robust to slightly non-planar quads.
    _n.subVectors(c, a).cross(_p.subVectors(d, b)).normalize();
    if (_n.lengthSq() === 0) _n.set(0, 1, 0);
    const u0 = uv ? uv[0] : 0;
    const v0 = uv ? uv[1] : 0;
    const u1 = uv ? uv[2] : 0;
    const v1 = uv ? uv[3] : 0;
    this.vert(a, _n, col, glow, u0, v0);
    this.vert(b, _n, col, glow, u1, v0);
    this.vert(c, _n, col, glow, u1, v1);
    this.vert(a, _n, col, glow, u0, v0);
    this.vert(c, _n, col, glow, u1, v1);
    this.vert(d, _n, col, glow, u0, v1);
  }

  /** Quad with explicit per-corner uvs [ua,va,ub,vb,uc,vc,ud,vd]. */
  quadUv(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.ColorRepresentation,
    glow: Glow,
    uv: readonly number[],
  ): void {
    const col = C(color);
    _n.subVectors(c, a).cross(_p.subVectors(d, b)).normalize();
    this.vert(a, _n, col, glow, uv[0]!, uv[1]!);
    this.vert(b, _n, col, glow, uv[2]!, uv[3]!);
    this.vert(c, _n, col, glow, uv[4]!, uv[5]!);
    this.vert(a, _n, col, glow, uv[0]!, uv[1]!);
    this.vert(c, _n, col, glow, uv[4]!, uv[5]!);
    this.vert(d, _n, col, glow, uv[6]!, uv[7]!);
  }

  /** Unit cube (−0.5..0.5) transformed by `m`. */
  boxM(m: THREE.Matrix4, color: THREE.ColorRepresentation, opts: BoxOpts = {}): void {
    for (let i = 0; i < 8; i++) {
      _corners[i]!.set(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5).applyMatrix4(m);
    }
    const faces = opts.faces ?? FACE.ALL;
    for (const [f, ia, ib, ic, id] of CUBE_FACES) {
      if (!(faces & f)) continue;
      const col = opts.colorFace?.(f) ?? color;
      const glow = opts.glowFace?.(f) ?? opts.glow ?? NO_GLOW;
      const uv = opts.uvFace?.(f) ?? opts.uv;
      this.quad(_corners[ia]!, _corners[ib]!, _corners[ic]!, _corners[id]!, col, glow, uv);
    }
  }

  /** Axis-aligned (optionally rotated) box centred at (cx, cy, cz) with size (sx, sy, sz). */
  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    color: THREE.ColorRepresentation,
    opts: BoxOpts = {},
  ): void {
    _e.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    this.boxM(_m, color, opts);
  }

  /** Box whose bottom sits at y0 (convenience for buildings / posts). */
  boxOn(
    cx: number,
    y0: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    color: THREE.ColorRepresentation,
    opts: BoxOpts = {},
  ): void {
    this.box(cx, y0 + sy / 2, cz, sx, sy, sz, color, opts);
  }

  /** Rectangular beam from a to b with cross-section w (horizontal) × h. */
  beam(
    a: THREE.Vector3,
    b: THREE.Vector3,
    w: number,
    h: number,
    color: THREE.ColorRepresentation,
    opts: BoxOpts = {},
  ): void {
    const len = a.distanceTo(b);
    if (len < 1e-5) return;
    _c.subVectors(b, a).normalize();
    // Build basis: z along the beam.
    const up = Math.abs(_c.y) > 0.95 ? _b.set(1, 0, 0) : _b.set(0, 1, 0);
    const xAxis = _a.crossVectors(up, _c).normalize();
    const yAxis = _d.crossVectors(_c, xAxis).normalize();
    _m.makeBasis(xAxis, yAxis, _c);
    _q.setFromRotationMatrix(_m);
    _p.addVectors(a, b).multiplyScalar(0.5);
    _m.compose(_p, _q, _s.set(w, h, len));
    this.boxM(_m, color, { faces: FACE.ALL & ~(FACE.PZ | FACE.NZ), ...opts });
  }

  /**
   * Appends any BufferGeometry transformed by `m`. `flat` recomputes face
   * normals (low-poly look). Geometry UVs are remapped into `uvRect` if given.
   */
  geometry(
    geo: THREE.BufferGeometry,
    m: THREE.Matrix4 | null,
    color: THREE.ColorRepresentation,
    glow: Glow = NO_GLOW,
    opts: { flat?: boolean; uvRect?: UvRect; vertexColorFn?: (p: THREE.Vector3) => THREE.Color } = {},
  ): void {
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const norAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const index = geo.getIndex();
    const count = index ? index.count : posAttr.count;
    const flat = opts.flat ?? true;
    const col = C(color);
    if (m) _nm.getNormalMatrix(m);
    const tmpP = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const tmpN = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const tmpUv = [0, 0, 0, 0, 0, 0];
    const r = opts.uvRect;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(i + k) : i + k;
        const p = tmpP[k]!.fromBufferAttribute(posAttr, vi);
        if (m) p.applyMatrix4(m);
        if (!flat && norAttr) {
          const n = tmpN[k]!.fromBufferAttribute(norAttr, vi);
          if (m) n.applyMatrix3(_nm).normalize();
        }
        if (uvAttr) {
          let u = uvAttr.getX(vi);
          let v = uvAttr.getY(vi);
          if (r) {
            u = r[0] + (r[2] - r[0]) * u;
            v = r[1] + (r[3] - r[1]) * v;
          }
          tmpUv[k * 2] = u;
          tmpUv[k * 2 + 1] = v;
        }
      }
      const [p0, p1, p2] = tmpP as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      if (flat || !norAttr) {
        _n.subVectors(p1, p0).cross(_d.subVectors(p2, p0));
        if (_n.lengthSq() < 1e-12) continue;
        _n.normalize();
        for (let k = 0; k < 3; k++) tmpN[k]!.copy(_n);
      }
      for (let k = 0; k < 3; k++) {
        const c = opts.vertexColorFn ? opts.vertexColorFn(tmpP[k]!) : col;
        this.vert(tmpP[k]!, tmpN[k]!, c, glow, tmpUv[k * 2]!, tmpUv[k * 2 + 1]!);
      }
    }
  }

  /** Convenience: appends a primitive geometry placed at pos with rotation/scale, then disposes it. */
  prim(
    geo: THREE.BufferGeometry,
    pos: THREE.Vector3Like,
    color: THREE.ColorRepresentation,
    opts: { rot?: THREE.Euler; scale?: THREE.Vector3Like; glow?: Glow; flat?: boolean; keep?: boolean } = {},
  ): void {
    _q.setFromEuler(opts.rot ?? _e.set(0, 0, 0));
    _m.compose(_p.set(pos.x, pos.y, pos.z), _q, opts.scale ? _s.set(opts.scale.x, opts.scale.y, opts.scale.z) : _s.set(1, 1, 1));
    const m = _m.clone();
    this.geometry(geo, m, color, opts.glow ?? NO_GLOW, { flat: opts.flat ?? true });
    if (!opts.keep) geo.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glw, 2));
    if (this.uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.tints) g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tints, 1));
    if (this.parts) g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.parts, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Builds and wraps into a mesh (static: matrixAutoUpdate off). */
  mesh(material: THREE.Material, name = 'prop'): THREE.Mesh {
    const m = new THREE.Mesh(this.build(), material);
    m.name = name;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

export interface VCOptions {
  side?: THREE.Side;
  map?: THREE.Texture | null;
  alphaTest?: number;
  /** Instance colour only applied where aTint = 1 (trees: foliage, boats: hull). */
  tint?: boolean;
  /** Vertex wind sway weighted by aTint * height (vegetation). */
  wind?: boolean;
  /** Gentle bobbing/rolling on water (instanced boats). */
  bob?: boolean;
  roughness?: number;
  metalness?: number;
  /** Force the Lambert path regardless of quality. */
  lambert?: boolean;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  polygonOffset?: number;
}

const materialCache = new Map<string, THREE.Material>();

function vcKey(quality: ModelQuality, o: VCOptions): string {
  return [
    'vc',
    quality === 'high' && !o.lambert ? 'std' : 'lam',
    o.side ?? THREE.FrontSide,
    o.map ? o.map.uuid : '-',
    o.alphaTest ?? 0,
    o.tint ? 't' : '',
    o.wind ? 'w' : '',
    o.bob ? 'b' : '',
    o.roughness ?? '',
    o.metalness ?? '',
    o.transparent ? `tr${o.opacity ?? 1}` : '',
    o.depthWrite === false ? 'nd' : '',
    o.polygonOffset ?? '',
  ].join('|');
}

/**
 * The workhorse material: vertex colours, optional texture, emissive from
 * `aGlow` (x always, y × uNight). Lambert on low/medium, Standard on high.
 */
export function getVCMaterial(quality: ModelQuality, o: VCOptions = {}): THREE.Material {
  const key = vcKey(quality, o);
  const cached = materialCache.get(key);
  if (cached) return cached;
  const common = {
    vertexColors: true,
    side: o.side ?? THREE.FrontSide,
    map: o.map ?? null,
    alphaTest: o.alphaTest ?? 0,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    depthWrite: o.depthWrite ?? true,
  };
  const mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial =
    quality === 'high' && !o.lambert
      ? new THREE.MeshStandardMaterial({ ...common, roughness: o.roughness ?? 0.82, metalness: o.metalness ?? 0.05 })
      : new THREE.MeshLambertMaterial(common);
  if (o.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = o.polygonOffset;
    mat.polygonOffsetUnits = o.polygonOffset;
  }
  patchVC(mat, key, o);
  materialCache.set(key, mat);
  return mat;
}

function patchVC(mat: THREE.Material, key: string, o: VCOptions): void {
  const tint = !!o.tint || !!o.wind;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = PROP_UNIFORMS.uNight;
    shader.uniforms.uTime = PROP_UNIFORMS.uTime;
    let vs = shader.vertexShader;
    vs = vs.replace(
      '#include <common>',
      `#include <common>
attribute vec2 aGlow;
varying vec2 vGlow;
uniform float uTime;
${tint ? 'attribute float aTint;' : ''}`,
    );
    const colorCode = tint
      ? `vColor = vec4(1.0);
#ifdef USE_COLOR
  vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);
#endif
vGlow = aGlow;`
      : `#include <color_vertex>
vGlow = aGlow;`;
    vs = vs.replace('#include <color_vertex>', colorCode);
    if (o.wind || o.bob) {
      vs = vs.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 ipos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
#else
  vec2 ipos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
#endif
${
  o.wind
    ? `float wph = dot(ipos, vec2(0.071, 0.113));
  float sway = aTint * max(position.y, 0.0) * 0.011;
  transformed.x += (sin(uTime * 1.27 + wph) + 0.35 * sin(uTime * 3.1 + wph * 2.3)) * sway;
  transformed.z += cos(uTime * 1.05 + wph * 1.31) * sway * 0.6;`
    : ''
}
${
  o.bob
    ? `float bph = dot(ipos, vec2(0.213, 0.371));
  float rollA = sin(uTime * 0.83 + bph) * 0.022;
  float pitchA = sin(uTime * 0.61 + bph * 1.7) * 0.012;
  transformed.y += sin(uTime * 0.7 + bph * 1.3) * 0.09 + transformed.x * rollA + transformed.z * pitchA;`
    : ''
}`,
      );
    }
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = fs.replace(
      '#include <common>',
      `#include <common>
varying vec2 vGlow;
uniform float uNight;`,
    );
    fs = fs.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * (vGlow.x + vGlow.y * uNight);
//#site`,
    );
    shader.fragmentShader = fs;
    // Night falloff after the glow so lit windows / LEDs keep their full brightness.
    injectSiteLight(shader, { anchor: '//#site' });
  };
  mat.customProgramCacheKey = () => key;
}

/**
 * Camera-facing additive glow halos for InstancedMesh quads (lamp flares).
 * Instance scale = halo size, instance colour = tint/brightness.
 * `nightOnly` fades the halos with uNight (street lights); otherwise always on.
 */
export function getHaloMaterial(nightOnly: boolean, map: THREE.Texture): THREE.Material {
  const key = `halo|${nightOnly}|${map.uuid}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
    toneMapped: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = PROP_UNIFORMS.uNight;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  float hs = length(instanceMatrix[0].xyz);
#else
  float hs = 1.0;
#endif
mvPosition = modelViewMatrix * mvPosition;
float msc = length(modelMatrix[0].xyz);
mvPosition.xy += position.xy * hs * msc;
gl_Position = projectionMatrix * mvPosition;`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace(
        '#include <opaque_fragment>',
        `${nightOnly ? 'outgoingLight *= uNight;' : ''}
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => key;
  materialCache.set(key, mat);
  return mat;
}

/** Shared cache for arbitrary materials built elsewhere (keyed by string). */
export function cachedMaterial<T extends THREE.Material>(key: string, make: () => T): T {
  const c = materialCache.get(key);
  if (c) return c as T;
  const m = make();
  materialCache.set(key, m);
  return m;
}

/* ------------------------------------------------------------------ */
/* Shared geometry cache                                               */
/* ------------------------------------------------------------------ */

const geometryCache = new Map<string, THREE.BufferGeometry>();

/** Cached geometry, flagged `userData.shared` so `disposeProp` leaves it alone. */
export function cachedGeometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometryCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geometryCache.set(key, g);
  }
  return g;
}

let quadGeo: THREE.BufferGeometry | null = null;
/** Shared unit quad in XY (for halos / billboards). */
export function unitQuad(): THREE.BufferGeometry {
  if (!quadGeo) {
    quadGeo = new THREE.PlaneGeometry(1, 1);
    quadGeo.userData.shared = true;
  }
  return quadGeo;
}

/* ------------------------------------------------------------------ */
/* Instancing helpers                                                  */
/* ------------------------------------------------------------------ */

const _im = new THREE.Matrix4();
const _iq = new THREE.Quaternion();
const _iy = new THREE.Vector3(0, 1, 0);

export function setInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  sx: number,
  sy = sx,
  sz = sx,
): void {
  _iq.setFromAxisAngle(_iy, rotY);
  _im.compose(_p.set(x, y, z), _iq, _s.set(sx, sy, sz));
  mesh.setMatrixAt(i, _im);
}

/** Finalises an instanced mesh: bounds, static matrices. */
export function finishInstanced(mesh: THREE.InstancedMesh): THREE.InstancedMesh {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** Halo glow sprites at the given points (single draw call). */
export function createHalos(
  points: readonly THREE.Vector3[],
  size: number | readonly number[],
  color: THREE.ColorRepresentation | readonly THREE.ColorRepresentation[],
  nightOnly: boolean,
  map: THREE.Texture,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(unitQuad(), getHaloMaterial(nightOnly, map), Math.max(1, points.length));
  mesh.count = points.length;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const s = typeof size === 'number' ? size : size[i] ?? 1;
    _im.makeScale(s, s, s).setPosition(p);
    mesh.setMatrixAt(i, _im);
    const c = Array.isArray(color) ? color[i % color.length] : color;
    mesh.setColorAt(i, C(c as THREE.ColorRepresentation));
  }
  mesh.renderOrder = 10;
  mesh.name = 'halos';
  return finishInstanced(mesh);
}

/* ------------------------------------------------------------------ */
/* Disposal                                                            */
/* ------------------------------------------------------------------ */

/**
 * Disposes per-instance GPU resources of a prop subtree (unique geometries,
 * InstancedMesh buffers). Shared cached geometries/materials/textures are kept;
 * free them with `disposePropsCache()` when leaving the 3D view entirely.
 */
export function disposeProp(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
    if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) (mesh as unknown as THREE.InstancedMesh).dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m && m.userData.owned) m.dispose();
  });
  object.removeFromParent();
}

const disposeHooks: (() => void)[] = [];
export function onCacheDispose(fn: () => void): void {
  disposeHooks.push(fn);
}

/** Frees every cached prop material, geometry and texture. */
export function disposePropsCache(): void {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
  for (const g of geometryCache.values()) g.dispose();
  geometryCache.clear();
  quadGeo?.dispose();
  quadGeo = null;
  for (const fn of disposeHooks) fn();
}

/* ------------------------------------------------------------------ */
/* Polyline helpers                                                    */
/* ------------------------------------------------------------------ */

/** Resamples a polyline at (approximately) fixed spacing, keeping endpoints. */
export function resamplePolyline(points: readonly THREE.Vector3[], spacing: number, closed = false): THREE.Vector3[] {
  const pts = closed && points.length > 2 ? [...points, points[0]!] : [...points];
  if (pts.length < 2) return pts.map((p) => p.clone());
  const out: THREE.Vector3[] = [pts[0]!.clone()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = a.distanceTo(b);
    let t = spacing - carry;
    while (t <= len) {
      out.push(new THREE.Vector3().lerpVectors(a, b, t / len));
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  const last = pts[pts.length - 1]!;
  if (out[out.length - 1]!.distanceTo(last) > spacing * 0.25) out.push(last.clone());
  else out[out.length - 1]!.copy(last);
  return out;
}

/** Per-point horizontal tangents and left normals (left = up × tangent). */
export function polylineFrames(points: readonly THREE.Vector3[]): { t: THREE.Vector3[]; n: THREE.Vector3[] } {
  const t: THREE.Vector3[] = [];
  const n: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(points.length - 1, i + 1)]!;
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
    if (dir.lengthSq() < 1e-10) dir.set(0, 0, 1);
    dir.normalize();
    t.push(dir);
    n.push(new THREE.Vector3(dir.z, 0, -dir.x));
  }
  return { t, n };
}

export function polylineLength(points: readonly THREE.Vector3[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += points[i - 1]!.distanceTo(points[i]!);
  return l;
}
