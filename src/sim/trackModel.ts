import type { CircuitData } from '@/data/circuits/types';
import { circuitGeometry, type TrackGeometry } from '@/data/circuits/geometry';

/**
 * Pre-computed vehicle-dynamics model of a circuit used by the DEMO
 * simulator: a quasi-steady-state speed profile (lateral grip limit with
 * downforce, then backward braking / forward traction passes), a racing
 * line lateral offset and overtaking-zone flags.
 */
export interface TrackModel {
  circuit: CircuitData;
  track: TrackGeometry;
  pit: TrackGeometry;
  L: number;
  /** Profile resolution in metres. */
  step: number;
  n: number;
  /** Calibrated race speed (m/s) per step. */
  vmax: Float32Array;
  /** Racing line lateral offset (m, + = left). */
  line: Float32Array;
  /** Smoothed curvature (1/m). */
  curv: Float32Array;
  /** 1 inside a straight / overtaking zone. */
  zone: Uint8Array;
  halfWidth: number;
  /** Reference lap time (s) of the calibrated profile at factor 1.0. */
  lapTime: number;
  pitLimit: number;
  /** Pit lane arc length along pit path for each team box (by team index). */
  boxS: number[];
  /** Main-track arc length where each grid slot is located. */
  gridS: (slot: number) => number;
}

const G = 9.81;

function lateralLimit(k: number): number {
  // a_lat = mu*g + c*v^2  →  v^2*k = mu*g + c*v^2  →  v = sqrt(mu*g / (k - c))
  const mu = 1.45;
  const c = 0.0044;
  const ak = Math.abs(k);
  if (ak <= c + 1e-5) return 95;
  return Math.min(95, Math.sqrt((mu * G) / (ak - c)));
}

function accelLimit(v: number): number {
  // Traction-limited at low speed, power/drag-limited at high speed.
  return Math.max(1.2, 13.5 - 0.115 * v);
}

function brakeLimit(v: number): number {
  // Aero-assisted braking: ~2g at low speed, ~5g at 300+ km/h.
  return 18 + 0.0042 * v * v;
}

function smoothArray(src: Float32Array, radius: number, closed = true): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  const r = Math.max(1, radius);
  let acc = 0;
  for (let i = -r; i <= r; i++) acc += src[((i % n) + n) % n]!;
  for (let i = 0; i < n; i++) {
    out[i] = acc / (2 * r + 1);
    const add = i + r + 1;
    const rem = i - r;
    acc += closed ? src[((add % n) + n) % n]! : src[Math.min(n - 1, add)]!;
    acc -= closed ? src[((rem % n) + n) % n]! : src[Math.max(0, rem)]!;
  }
  return out;
}

const modelCache = new WeakMap<CircuitData, TrackModel>();

export function buildTrackModel(circuit: CircuitData): TrackModel {
  const cached = modelCache.get(circuit);
  if (cached) return cached;
  const { track, pit } = circuitGeometry(circuit);
  const L = track.length;
  const step = 2;
  const n = Math.max(16, Math.round(L / step));
  const realStep = L / n;

  const rawK = new Float32Array(n);
  for (let i = 0; i < n; i++) rawK[i] = track.curvatureAt(i * realStep);
  const curv = smoothArray(rawK, Math.round(10 / realStep));

  // Lateral grip limit.
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = lateralLimit(curv[i]!);
  // Braking pass (backward, two laps around for closure).
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 2 * n - 1; k >= 0; k--) {
      const i = k % n;
      const j = (i + 1) % n;
      const vj = v[j]!;
      const lim = Math.sqrt(vj * vj + 2 * brakeLimit(vj) * realStep);
      if (v[i]! > lim) v[i] = lim;
    }
    // Traction pass (forward).
    for (let k = 0; k < 2 * n; k++) {
      const i = k % n;
      const j = (i + 1) % n;
      const vi = v[i]!;
      const lim = Math.sqrt(vi * vi + 2 * accelLimit(vi) * realStep);
      if (v[j]! > lim) v[j] = lim;
    }
  }

  let lapTime = 0;
  for (let i = 0; i < n; i++) lapTime += realStep / Math.max(5, v[i]!);

  // Calibrate to a realistic race lap (record × 1.045) when known.
  const target = circuit.lapRecordMs ? (circuit.lapRecordMs / 1000) * 1.045 : lapTime;
  const factor = Math.min(1.25, Math.max(0.8, lapTime / target));
  for (let i = 0; i < n; i++) v[i] = v[i]! * factor;
  lapTime = 0;
  for (let i = 0; i < n; i++) lapTime += realStep / Math.max(5, v[i]!);

  // Racing line: inside at the apex, outside on entry/exit.
  const halfWidth = circuit.widthM / 2;
  const usable = Math.max(1, halfWidth - 1.4);
  const kNear = smoothArray(curv, Math.round(14 / realStep));
  const kWide = smoothArray(curv, Math.round(70 / realStep));
  const lineRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const apex = Math.tanh(kNear[i]! * 45);
    const wide = Math.tanh(kWide[i]! * 70);
    lineRaw[i] = usable * Math.max(-1, Math.min(1, apex * 1.15 - wide * 0.55));
  }
  const line = smoothArray(lineRaw, Math.round(26 / realStep));

  // Overtaking zones: from circuit data, plus any long low-curvature run.
  const zone = new Uint8Array(n);
  for (const z of circuit.straightZones) {
    const len = ((z.endS - z.startS) % L + L) % L;
    for (let d = 0; d <= len; d += realStep) zone[Math.floor((((z.startS + d) % L) + L) % L / realStep) % n] = 1;
  }
  let run = 0;
  for (let k = 0; k < 2 * n; k++) {
    const i = k % n;
    if (Math.abs(curv[i]!) < 0.0025) run++;
    else run = 0;
    if (run > 220 / realStep) {
      for (let b = 0; b < 60 / realStep; b++) zone[(i - b + n) % n] = 1;
    }
  }

  const pl = circuit.pitLane;
  const boxCount = 11;
  const boxSpan = pl.boxesEndS - pl.boxesStartS;
  const boxS: number[] = [];
  for (let b = 0; b < boxCount; b++) boxS.push(pl.boxesStartS + (boxSpan * (b + 0.5)) / boxCount);

  const model: TrackModel = {
    circuit,
    track,
    pit,
    L,
    step: realStep,
    n,
    vmax: v,
    line,
    curv,
    zone,
    halfWidth,
    lapTime,
    pitLimit: pl.speedLimitKph / 3.6,
    boxS,
    gridS: (slot: number) => (((L - 10 - slot * 8) % L) + L) % L,
  };
  modelCache.set(circuit, model);
  return model;
}

export function sampleArr(arr: Float32Array, model: TrackModel, s: number): number {
  const x = ((((s % model.L) + model.L) % model.L) / model.step);
  const i = Math.floor(x) % model.n;
  const j = (i + 1) % model.n;
  const t = x - Math.floor(x);
  return arr[i]! + (arr[j]! - arr[i]!) * t;
}

export function zoneAt(model: TrackModel, s: number): boolean {
  const i = Math.floor(((((s % model.L) + model.L) % model.L) / model.step)) % model.n;
  return model.zone[i] === 1;
}

/** Minimum profile speed over the next `dist` metres. */
export function minSpeedAhead(model: TrackModel, s: number, dist: number): number {
  let m = Infinity;
  for (let d = 0; d <= dist; d += model.step * 2) m = Math.min(m, sampleArr(model.vmax, model, s + d));
  return m;
}
