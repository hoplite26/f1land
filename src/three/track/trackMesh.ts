import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CircuitData } from '@/data/circuits/types';
import type { TrackGeometry } from '@/data/circuits/geometry';
import type { TrackModel } from '@/sim/trackModel';
import { sampleArr } from '@/sim/trackModel';
import { asphaltTexture, checkerTexture, gravelTexture, kerbTexture, runoffTexture } from './textures';
import type { ModelQuality } from '@/three/models/types';

/** Map circuit-plane metres (x east, y north) into world space (x, y-up, -z north). */
export function toWorld(x: number, y: number, h = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, h, -y);
}

/** Yaw for an object whose forward is +Z, given a 2D heading (atan2(dy, dx)). */
export function yawFromHeading(h: number): number {
  return Math.atan2(Math.cos(h), -Math.sin(h));
}

type LatFn = number | ((s: number) => number);
const val = (f: LatFn, s: number) => (typeof f === 'number' ? f : f(s));

interface RibbonOpts {
  geom: TrackGeometry;
  s0: number;
  s1: number;
  latA: LatFn;
  latB: LatFn;
  y: number;
  step: number;
  /** metres per texture repeat along the track */
  uScale: number;
  /** lateral subdivisions */
  cols?: number;
  /** v range */
  v0?: number;
  v1?: number;
  color?: (s: number, lat: number) => number;
}

/** Build a flat ribbon between two lateral offsets over [s0, s1] (wraps on closed tracks). */
export function ribbon(o: RibbonOpts): THREE.BufferGeometry {
  const cols = o.cols ?? 1;
  let len = o.s1 - o.s0;
  if (o.geom.closed && len <= 0) len += o.geom.length;
  const rows = Math.max(1, Math.ceil(len / o.step));
  const pos = new Float32Array((rows + 1) * (cols + 1) * 3);
  const uv = new Float32Array((rows + 1) * (cols + 1) * 2);
  const col = o.color ? new Float32Array((rows + 1) * (cols + 1) * 3) : null;
  const p: [number, number] = [0, 0];
  let k = 0;
  let ku = 0;
  for (let r = 0; r <= rows; r++) {
    const d = (len * r) / rows;
    const s = o.s0 + d;
    const a = val(o.latA, s);
    const b = val(o.latB, s);
    for (let c = 0; c <= cols; c++) {
      const lat = a + ((b - a) * c) / cols;
      o.geom.pointAt(s, lat, p);
      pos[k] = p[0];
      pos[k + 1] = o.y;
      pos[k + 2] = -p[1];
      if (col && o.color) {
        const shade = o.color(s, lat);
        col[k] = shade;
        col[k + 1] = shade;
        col[k + 2] = shade;
      }
      k += 3;
      uv[ku++] = d / o.uScale;
      uv[ku++] = (o.v0 ?? 0) + (((o.v1 ?? 1) - (o.v0 ?? 0)) * c) / cols;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = i0 + (cols + 1);
      const i3 = i2 + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Ensure normals face up regardless of winding.
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** Vertical wall ribbon (for zone corridors / pit wall). */
export function wall(geom: TrackGeometry, s0: number, s1: number, lat: LatFn, y0: number, y1: number, step: number, uScale = 10): THREE.BufferGeometry {
  let len = s1 - s0;
  if (geom.closed && len <= 0) len += geom.length;
  const rows = Math.max(1, Math.ceil(len / step));
  const pos = new Float32Array((rows + 1) * 2 * 3);
  const uv = new Float32Array((rows + 1) * 2 * 2);
  const p: [number, number] = [0, 0];
  for (let r = 0; r <= rows; r++) {
    const d = (len * r) / rows;
    const s = s0 + d;
    geom.pointAt(s, val(lat, s), p);
    const i = r * 6;
    pos.set([p[0], y0, -p[1], p[0], y1, -p[1]], i);
    uv.set([d / uScale, 0, d / uScale, 1], r * 4);
  }
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const a = r * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function isStreet(c: CircuitData): boolean {
  return c.theme === 'street';
}

export interface TrackMeshes {
  group: THREE.Group;
  /** Sector zone overlay meshes (index 0..2) with shader uniforms. */
  zones: ZoneOverlay[];
  /** Overtake-zone chevrons. */
  straights: THREE.Mesh | null;
  /** World-space anchor (centre of each sector) for DOM labels. */
  sectorAnchors: THREE.Vector3[];
  /** Runoff extents per sample for barriers (lateral distance from centre). */
  barrierLat: (s: number, side: 1 | -1) => number;
  dispose(): void;
}

export interface ZoneOverlay {
  floor: THREE.Mesh;
  walls: THREE.Mesh;
  uniforms: { uColor: { value: THREE.Color }; uTime: { value: number }; uIntensity: { value: number }; uSelected: { value: number } };
  sector: 1 | 2 | 3;
}

const ZONE_COLORS = ['#c6ff3d', '#2fe6ff', '#b26bff'];

function zoneMaterial(color: string, wallMode: boolean): { mat: THREE.ShaderMaterial; uniforms: ZoneOverlay['uniforms'] } {
  const uniforms = {
    uColor: { value: new THREE.Color(color) },
    uTime: { value: 0 },
    uIntensity: { value: 0.18 },
    uSelected: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: wallMode
      ? /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uIntensity; uniform float uSelected;
      varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 2.2);
        float scan = 0.65 + 0.35 * sin(vUv.x * 2.0 - uTime * 3.0);
        float a = fade * scan * uSelected * 0.75;
        gl_FragColor = vec4(uColor * a, a);
      }`
      : /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uIntensity; uniform float uSelected;
      varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.42, 0.5, abs(vUv.y - 0.5));
        float flow = fract(vUv.x * 0.6 - uTime * (0.6 + uSelected * 0.9));
        float chevron = smoothstep(0.0, 0.08, flow) * (1.0 - smoothstep(0.12, 0.3, flow));
        float base = uIntensity * (0.35 + edge * 1.4);
        float sel = uSelected * (0.22 + chevron * 0.55 + edge * 1.3);
        float a = clamp(base + sel, 0.0, 1.0);
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  return { mat, uniforms };
}

export function buildTrackMeshes(circuit: CircuitData, model: TrackModel, quality: ModelQuality): TrackMeshes {
  const group = new THREE.Group();
  group.name = 'track';
  const geom = model.track;
  const L = geom.length;
  const hw = circuit.widthM / 2;
  const step = quality === 'low' ? 6 : quality === 'medium' ? 4 : 3;
  const street = isStreet(circuit);
  const disposables: Array<{ dispose(): void }> = [];

  // --- Road surface with rubbered racing line (vertex colours) ---
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTexture(), vertexColors: true, roughness: 0.86, metalness: 0.0, color: 0xffffff });
  const roadGeo = ribbon({
    geom,
    s0: 0,
    s1: L,
    latA: -hw,
    latB: hw,
    y: 0,
    step,
    uScale: 14,
    cols: quality === 'low' ? 4 : 10,
    color: (s, lat) => {
      const line = sampleArr(model.line, model, s);
      const d = Math.abs(lat - line);
      return 0.62 + Math.min(1, d / 3.2) * 0.38;
    },
  });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = quality === 'high';
  group.add(road);
  disposables.push(roadGeo, roadMat);

  // --- White edge lines ---
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe9ecef, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lines = mergeGeometries([
    ribbon({ geom, s0: 0, s1: L, latA: hw - 0.42, latB: hw - 0.14, y: 0.01, step, uScale: 10 }),
    ribbon({ geom, s0: 0, s1: L, latA: -hw + 0.14, latB: -hw + 0.42, y: 0.01, step, uScale: 10 }),
  ])!;
  group.add(new THREE.Mesh(lines, lineMat));
  disposables.push(lines, lineMat);

  // --- Kerbs + runoff per corner ---
  const kerbGeos: THREE.BufferGeometry[] = [];
  const gravelGeos: THREE.BufferGeometry[] = [];
  const runoffGeos: THREE.BufferGeometry[] = [];
  const kThreshold = 1 / 260;
  const segs: Array<{ s0: number; s1: number; side: 1 | -1; k: number }> = [];
  {
    let inSeg = false;
    let s0 = 0;
    let side: 1 | -1 = 1;
    let kMax = 0;
    const dstep = 4;
    for (let d = 0; d <= L + dstep; d += dstep) {
      const s = d % L;
      const k = sampleArr(model.curv, model, s);
      const on = Math.abs(k) > kThreshold;
      if (on && !inSeg) {
        inSeg = true;
        s0 = s;
        side = k > 0 ? 1 : -1;
        kMax = Math.abs(k);
      } else if (on && inSeg) {
        kMax = Math.max(kMax, Math.abs(k));
        if ((k > 0 ? 1 : -1) !== side) {
          segs.push({ s0, s1: s, side, k: kMax });
          s0 = s;
          side = k > 0 ? 1 : -1;
          kMax = Math.abs(k);
        }
      } else if (!on && inSeg) {
        inSeg = false;
        segs.push({ s0, s1: s, side, k: kMax });
      }
    }
  }
  const runoffWidth = new Float32Array(model.n * 2); // [left, right] per profile step
  for (const sg of segs) {
    let len = sg.s1 - sg.s0;
    if (len <= 0) len += L;
    if (len < 10) continue;
    // Inside kerb around apex.
    kerbGeos.push(ribbon({ geom, s0: sg.s0 - 4, s1: sg.s1 + 4, latA: sg.side * hw, latB: sg.side * (hw + 1.1), y: 0.02, step: 2, uScale: 4 }));
    // Outside kerb on the exit.
    const exitStart = sg.s0 + len * 0.45;
    kerbGeos.push(ribbon({ geom, s0: exitStart, s1: sg.s1 + 22, latA: -sg.side * (hw + 1.1), latB: -sg.side * hw, y: 0.02, step: 2, uScale: 4 }));
    if (!street) {
      const speedHere = sampleArr(model.vmax, model, (sg.s0 + len / 2) % L);
      const depth = Math.min(60, 10 + speedHere * 0.5);
      const fn = (s: number) => {
        const d = geom.delta(sg.s0, s);
        const tt = Math.min(1, Math.max(0, d / Math.max(1, len + 50)));
        const bell = Math.sin(Math.PI * tt);
        return -sg.side * (hw + 1.1 + depth * (0.25 + 0.75 * bell));
      };
      const geo = ribbon({ geom, s0: sg.s0, s1: sg.s1 + 50, latA: (s) => Math.min(-sg.side * (hw + 1.1), fn(s)), latB: (s) => Math.max(-sg.side * (hw + 1.1), fn(s)), y: 0.006, step: 4, uScale: 8, cols: 1 });
      // Fast corners → asphalt runoff (blue painted), slow → gravel trap.
      if (speedHere > 45) runoffGeos.push(geo);
      else gravelGeos.push(geo);
      for (let d = 0; d <= len + 50; d += model.step) {
        const s = (sg.s0 + d) % L;
        const i = Math.floor(s / model.step) % model.n;
        const w = Math.abs(fn(s)) - hw;
        const slot = i * 2 + (sg.side > 0 ? 1 : 0);
        runoffWidth[slot] = Math.max(runoffWidth[slot]!, w);
      }
    }
  }
  if (kerbGeos.length) {
    const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const kg = mergeGeometries(kerbGeos)!;
    group.add(new THREE.Mesh(kg, kerbMat));
    disposables.push(kg, kerbMat);
  }
  if (gravelGeos.length) {
    const gm = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1 });
    const gg = mergeGeometries(gravelGeos)!;
    group.add(new THREE.Mesh(gg, gm));
    disposables.push(gg, gm);
  }
  if (runoffGeos.length) {
    const rm = new THREE.MeshStandardMaterial({ map: runoffTexture(), roughness: 0.9 });
    const rg = mergeGeometries(runoffGeos)!;
    group.add(new THREE.Mesh(rg, rm));
    disposables.push(rg, rm);
  }

  // Verge (dark asphalt/grass shoulder) along the whole track for a finished edge.
  {
    const vergeMat = new THREE.MeshStandardMaterial({ color: street ? 0x2a2c30 : circuit.theme === 'desert' ? 0x8f7a5a : 0x2f5a2a, roughness: 1 });
    const vg = mergeGeometries([
      ribbon({ geom, s0: 0, s1: L, latA: hw, latB: hw + (street ? 2.2 : 3.5), y: 0.002, step: 6, uScale: 10 }),
      ribbon({ geom, s0: 0, s1: L, latA: -hw - (street ? 2.2 : 3.5), latB: -hw, y: 0.002, step: 6, uScale: 10 }),
    ])!;
    group.add(new THREE.Mesh(vg, vergeMat));
    disposables.push(vg, vergeMat);
  }

  // --- Start/finish line + grid boxes ---
  {
    const cm = new THREE.MeshBasicMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const cg = ribbon({ geom, s0: L - 0.9, s1: L + 0.9, latA: -hw, latB: hw, y: 0.015, step: 1, uScale: 1.8, v0: 0, v1: hw });
    // Rotate UVs so checkers run across the track.
    const uv = cg.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, v / 1.6, u);
    }
    group.add(new THREE.Mesh(cg, cm));
    disposables.push(cg, cm);

    const gridGeos: THREE.BufferGeometry[] = [];
    for (let slot = 0; slot < 22; slot++) {
      const s = model.gridS(slot);
      const side = slot % 2 === 0 ? 1 : -1;
      const c = side * 2.2;
      gridGeos.push(ribbon({ geom, s0: s + 2.6, s1: s + 2.9, latA: c - 1.3, latB: c + 1.3, y: 0.012, step: 1, uScale: 1 }));
      gridGeos.push(ribbon({ geom, s0: s - 0.5, s1: s + 2.9, latA: c - 1.3, latB: c - 1.08, y: 0.012, step: 1, uScale: 1 }));
      gridGeos.push(ribbon({ geom, s0: s - 0.5, s1: s + 2.9, latA: c + 1.08, latB: c + 1.3, y: 0.012, step: 1, uScale: 1 }));
    }
    const gg = mergeGeometries(gridGeos)!;
    group.add(new THREE.Mesh(gg, lineMat));
    disposables.push(gg);
  }

  // --- Pit lane ---
  {
    const pit = model.pit;
    const pw = 5.6;
    const pitMat = new THREE.MeshStandardMaterial({ map: asphaltTexture(), color: 0xb9bdc2, roughness: 0.8 });
    const pg = ribbon({ geom: pit, s0: 0, s1: pit.length, latA: -pw, latB: pw, y: 0.004, step: 2, uScale: 14 });
    group.add(new THREE.Mesh(pg, pitMat));
    disposables.push(pg, pitMat);
    const garageSide = circuit.pitLane.side === 'left' ? 1 : -1;
    const pl = [
      ribbon({ geom: pit, s0: 4, s1: pit.length - 4, latA: -pw + 0.15, latB: -pw + 0.4, y: 0.012, step: 2, uScale: 10 }),
      ribbon({ geom: pit, s0: 4, s1: pit.length - 4, latA: pw - 0.4, latB: pw - 0.15, y: 0.012, step: 2, uScale: 10 }),
      // fast lane / working lane divider (dashed approximated by thin line)
      ribbon({ geom: pit, s0: circuit.pitLane.boxesStartS - 10, s1: circuit.pitLane.boxesEndS + 10, latA: garageSide * 1.2 - 0.08, latB: garageSide * 1.2 + 0.08, y: 0.012, step: 2, uScale: 10 }),
      // speed limit lines
      ribbon({ geom: pit, s0: 58, s1: 59.5, latA: -pw, latB: pw, y: 0.013, step: 1, uScale: 1 }),
      ribbon({ geom: pit, s0: pit.length - 60, s1: pit.length - 58.5, latA: -pw, latB: pw, y: 0.013, step: 1, uScale: 1 }),
    ];
    const plg = mergeGeometries(pl)!;
    group.add(new THREE.Mesh(plg, lineMat));
    disposables.push(plg);
    // Team pit boxes (coloured rectangles in the working lane).
    const boxGeos: THREE.BufferGeometry[] = [];
    const boxSpan = (circuit.pitLane.boxesEndS - circuit.pitLane.boxesStartS) / 11;
    for (let b = 0; b < 11; b++) {
      const sMid = model.boxS[b]!;
      const a = garageSide * 1.4;
      const bb = garageSide * pw * 0.95;
      boxGeos.push(ribbon({ geom: pit, s0: sMid - boxSpan * 0.38, s1: sMid + boxSpan * 0.38, latA: Math.min(a, bb), latB: Math.max(a, bb), y: 0.011, step: 2, uScale: 4 }));
    }
    const bg = mergeGeometries(boxGeos)!;
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x27323a, roughness: 0.7, emissive: 0x0b1215 });
    group.add(new THREE.Mesh(bg, boxMat));
    disposables.push(bg, boxMat);
    // Pit wall between the pit lane and the track.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.75 });
    const wg = wall(pit, 40, pit.length - 40, -garageSide * (pw + 0.4), 0, 1.1, 3);
    const wg2 = wall(pit, 40, pit.length - 40, -garageSide * (pw + 0.9), 0, 1.1, 3);
    const wTop = ribbon({ geom: pit, s0: 40, s1: pit.length - 40, latA: -garageSide * (pw + 0.9), latB: -garageSide * (pw + 0.4), y: 1.1, step: 3, uScale: 6 });
    const wAll = mergeGeometries([wg, wg2, wTop])!;
    const pitWall = new THREE.Mesh(wAll, wallMat);
    group.add(pitWall);
    disposables.push(wAll, wallMat);
  }

  // --- Sector zone overlays (floor + volumetric corridor walls) ---
  const zones: ZoneOverlay[] = [];
  const sectorAnchors: THREE.Vector3[] = [];
  circuit.sectors.forEach((sec, i) => {
    const { mat, uniforms } = zoneMaterial(ZONE_COLORS[i]!, false);
    const fg = ribbon({ geom, s0: sec.startS, s1: sec.endS, latA: -hw - 0.6, latB: hw + 0.6, y: 0.03, step: 4, uScale: 24 });
    const floor = new THREE.Mesh(fg, mat);
    floor.renderOrder = 5;
    const wm = zoneMaterial(ZONE_COLORS[i]!, true);
    wm.uniforms.uTime = uniforms.uTime;
    wm.uniforms.uSelected = uniforms.uSelected;
    const wgeo = mergeGeometries([
      wall(geom, sec.startS, sec.endS, hw + 1.2, 0, 3.2, 6, 30),
      wall(geom, sec.startS, sec.endS, -hw - 1.2, 0, 3.2, 6, 30),
    ])!;
    const walls = new THREE.Mesh(wgeo, wm.mat);
    walls.renderOrder = 6;
    walls.visible = false;
    group.add(floor, walls);
    disposables.push(fg, mat, wgeo, wm.mat);
    zones.push({ floor, walls, uniforms, sector: (i + 1) as 1 | 2 | 3 });
    const mid = (sec.startS + (((sec.endS - sec.startS) % L) + L) % L / 2) % L;
    const p = geom.pointAt(mid);
    sectorAnchors.push(new THREE.Vector3(p[0], 6, -p[1]));
  });

  // --- Overtake / straight-mode zones: cyan chevrons on the edges ---
  let straights: THREE.Mesh | null = null;
  if (circuit.straightZones.length) {
    const geos: THREE.BufferGeometry[] = [];
    for (const z of circuit.straightZones) {
      geos.push(ribbon({ geom, s0: z.startS, s1: z.endS, latA: -hw + 0.6, latB: -hw + 1.0, y: 0.014, step: 4, uScale: 6 }));
      geos.push(ribbon({ geom, s0: z.startS, s1: z.endS, latA: hw - 1.0, latB: hw - 0.6, y: 0.014, step: 4, uScale: 6 }));
      geos.push(ribbon({ geom, s0: z.detectionS - 0.6, s1: z.detectionS + 0.6, latA: -hw, latB: hw, y: 0.014, step: 1, uScale: 1 }));
    }
    const sg = mergeGeometries(geos)!;
    const sm = new THREE.MeshBasicMaterial({ color: 0x2fe6ff, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    straights = new THREE.Mesh(sg, sm);
    group.add(straights);
    disposables.push(sg, sm);
  }

  const barrierLat = (s: number, side: 1 | -1) => {
    const i = Math.floor((((s % L) + L) % L) / model.step) % model.n;
    const run = runoffWidth[i * 2 + (side > 0 ? 1 : 0)]!;
    return hw + (street ? 2.4 : Math.max(9, run + 4));
  };

  return {
    group,
    zones,
    straights,
    sectorAnchors,
    barrierLat,
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
