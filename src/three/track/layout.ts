import * as THREE from 'three';
import type { CircuitData } from '@/data/circuits/types';
import type { TrackModel } from '@/sim/trackModel';
import type { TrackMeshes } from './trackMesh';
import { yawFromHeading } from './trackMesh';

/**
 * Derived circuit layout used to dress the scene: smoothed barrier lines,
 * where the pit lane replaces the barrier, and a coarse occupancy grid so
 * scattered props (trees, buildings, stands) never land on the racing
 * corridor or the pit complex.
 */
export interface TrackLayout {
  L: number;
  hw: number;
  street: boolean;
  /** Smoothed barrier distance from the centreline (m, positive) for a side (+1 left, −1 right). */
  barrier(s: number, side: 1 | -1): number;
  /** True where the pit lane runs between the track and the barrier on that side. */
  pitBeside(s: number, side: 1 | -1): boolean;
  /** World position on the main track (y = h). */
  world(s: number, lat: number, h?: number, out?: THREE.Vector3): THREE.Vector3;
  /** Yaw (rotation.y) facing the track from a prop standing on `side`. */
  facingTrack(s: number, side: 1 | -1): number;
  isFree(x: number, z: number): boolean;
  /** Is a rotated rectangle (world centre, yaw, width along local X, depth along local Z) free? */
  rectFree(cx: number, cz: number, yaw: number, w: number, d: number): boolean;
  occupyRect(cx: number, cz: number, yaw: number, w: number, d: number): void;
  occupyCircle(x: number, z: number, r: number): void;
  /** World-space XZ bounds of the dressing area. */
  area: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const CELL = 6;

export function buildLayout(circuit: CircuitData, model: TrackModel, track: TrackMeshes): TrackLayout {
  const geom = model.track;
  const L = geom.length;
  const hw = circuit.widthM / 2;
  const street = circuit.theme === 'street';
  const step = model.step;
  const n = model.n;

  // --- smoothed barrier lateral per side (moving max then moving average) ---
  const raw = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    raw[0]![i] = track.barrierLat(i * step, 1);
    raw[1]![i] = track.barrierLat(i * step, -1);
  }
  const smooth = raw.map((r) => {
    const win = Math.max(1, Math.round(28 / step));
    const mx = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let k = -win; k <= win; k++) m = Math.max(m, r[(i + k + n) % n]!);
      mx[i] = m;
    }
    const av = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -win; k <= win; k++) s += mx[(i + k + n) % n]!;
      av[i] = Math.max(r[i]!, s / (2 * win + 1));
    }
    return av;
  });
  const idx = (s: number) => {
    const x = ((((s % L) + L) % L) / step);
    return Math.floor(x) % n;
  };
  const barrier = (s: number, side: 1 | -1) => {
    const x = ((((s % L) + L) % L) / step);
    const i = Math.floor(x) % n;
    const j = (i + 1) % n;
    const t = x - Math.floor(x);
    const a = smooth[side > 0 ? 0 : 1]!;
    return a[i]! + (a[j]! - a[i]!) * t;
  };

  // --- pit lane alongside the main track ---
  const pitMask = [new Uint8Array(n), new Uint8Array(n)];
  {
    const pit = model.pit;
    let hint: number | undefined;
    for (let d = 0; d <= pit.length; d += 3) {
      const p = pit.pointAt(d);
      const pr = geom.project(p[0], p[1], hint, hint === undefined ? undefined : 160);
      hint = pr.s;
      const side = pr.lateral >= 0 ? 0 : 1;
      if (Math.abs(pr.lateral) < barrier(pr.s, side === 0 ? 1 : -1) + 22) {
        const i0 = idx(pr.s);
        const span = Math.ceil(10 / step);
        for (let k = -span; k <= span; k++) pitMask[side]![(i0 + k + n) % n] = 1;
      }
    }
  }
  const pitBeside = (s: number, side: 1 | -1) => pitMask[side > 0 ? 0 : 1]![idx(s)] === 1;

  const world = (s: number, lat: number, h = 0, out = new THREE.Vector3()) => {
    const p = geom.pointAt(s, lat);
    return out.set(p[0], h, -p[1]);
  };
  const facingTrack = (s: number, side: 1 | -1) => yawFromHeading(geom.headingAt(s)) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);

  // --- occupancy grid ---
  const b = circuit.bounds;
  const margin = 900;
  const area = { minX: b.minX - margin, maxX: b.maxX + margin, minZ: -b.maxY - margin, maxZ: -b.minY + margin };
  const gw = Math.ceil((area.maxX - area.minX) / CELL);
  const gh = Math.ceil((area.maxZ - area.minZ) / CELL);
  const grid = new Uint8Array(gw * gh);
  const occupyCircle = (x: number, z: number, r: number) => {
    const cx = Math.floor((x - area.minX) / CELL);
    const cz = Math.floor((z - area.minZ) / CELL);
    const rc = Math.ceil(r / CELL);
    for (let j = -rc; j <= rc; j++) {
      const zz = cz + j;
      if (zz < 0 || zz >= gh) continue;
      for (let i = -rc; i <= rc; i++) {
        const xx = cx + i;
        if (xx < 0 || xx >= gw || i * i + j * j > rc * rc) continue;
        grid[zz * gw + xx] = 1;
      }
    }
  };
  const isFree = (x: number, z: number) => {
    const cx = Math.floor((x - area.minX) / CELL);
    const cz = Math.floor((z - area.minZ) / CELL);
    if (cx < 0 || cz < 0 || cx >= gw || cz >= gh) return false;
    return grid[cz * gw + cx] === 0;
  };
  const rectPoints = (cx: number, cz: number, yaw: number, w: number, d: number, fn: (x: number, z: number) => boolean) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const nx = Math.max(1, Math.ceil(w / (CELL * 0.7)));
    const nz = Math.max(1, Math.ceil(d / (CELL * 0.7)));
    for (let i = 0; i <= nx; i++) {
      const lx = -w / 2 + (w * i) / nx;
      for (let j = 0; j <= nz; j++) {
        const lz = -d / 2 + (d * j) / nz;
        // rotation.y = yaw maps local (x, z) → (x cos + z sin, −x sin + z cos)
        if (!fn(cx + lx * c + lz * s, cz - lx * s + lz * c)) return false;
      }
    }
    return true;
  };
  const rectFree = (cx: number, cz: number, yaw: number, w: number, d: number) => rectPoints(cx, cz, yaw, w, d, isFree);
  const occupyRect = (cx: number, cz: number, yaw: number, w: number, d: number) => {
    rectPoints(cx, cz, yaw, w, d, (x, z) => {
      occupyCircle(x, z, CELL * 0.5);
      return true;
    });
  };

  // Racing corridor (track + run-off + barriers + a little air).
  const tmp = new THREE.Vector3();
  for (let s = 0; s < L; s += 4) {
    for (const side of [1, -1] as const) {
      const bl = barrier(s, side);
      for (let lat = 0; lat <= bl + 7; lat += CELL * 0.8) {
        world(s, side * lat, 0, tmp);
        occupyCircle(tmp.x, tmp.z, CELL * 0.6);
      }
    }
  }
  // Pit lane + garages.
  {
    const pit = model.pit;
    const garageSide = circuit.pitLane.side === 'left' ? 1 : -1;
    for (let d = 0; d <= pit.length; d += 4) {
      for (let lat = -12; lat <= 40; lat += 4) {
        const p = pit.pointAt(d, garageSide * lat);
        occupyCircle(p[0], -p[1], 5);
      }
    }
  }

  return { L, hw, street, barrier, pitBeside, world, facingTrack, isFree, rectFree, occupyRect, occupyCircle, area };
}

/** Contiguous runs of s where `pred` holds, sampled every `ds` metres (closed loop aware). */
export function runsWhere(L: number, ds: number, pred: (s: number) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const nS = Math.ceil(L / ds);
  const vals: boolean[] = [];
  for (let i = 0; i < nS; i++) vals.push(pred(i * ds));
  if (vals.every(Boolean)) return [[0, L]];
  // Start scanning just after a false sample so runs crossing s = 0 stay whole.
  let start = vals.findIndex((v) => !v);
  let runStart = -1;
  for (let k = 1; k <= nS; k++) {
    const i = (start + k) % nS;
    if (vals[i] && runStart < 0) runStart = start + k;
    if (!vals[i] && runStart >= 0) {
      out.push([runStart * ds, (start + k) * ds]);
      runStart = -1;
    }
  }
  if (runStart >= 0) out.push([runStart * ds, (start + nS) * ds]);
  start = 0;
  return out;
}
