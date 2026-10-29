import type { CircuitData, Vec2 } from './types';

export interface TrackSample {
  x: number;
  y: number;
  /** Heading of travel in radians, atan2(dy, dx). */
  heading: number;
  /** Signed curvature 1/m, positive = turning left. */
  curvature: number;
}

/**
 * Arc-length parameterised polyline (closed loop or open path).
 * Lateral offsets are positive to the LEFT of the direction of travel.
 */
export class TrackGeometry {
  readonly points: Vec2[];
  readonly closed: boolean;
  readonly length: number;
  /** Cumulative arc length at each point. */
  readonly cum: Float64Array;
  private readonly headings: Float64Array;
  private readonly curvatures: Float64Array;
  private readonly avgSpacing: number;

  constructor(points: Vec2[], closed: boolean) {
    if (points.length < 2) throw new Error('TrackGeometry needs at least 2 points');
    this.points = points;
    this.closed = closed;
    const n = points.length;
    const segCount = closed ? n : n - 1;
    this.cum = new Float64Array(n + 1);
    for (let i = 0; i < segCount; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      this.cum[i + 1] = this.cum[i]! + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    this.length = this.cum[segCount]!;
    this.avgSpacing = this.length / segCount;

    this.headings = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
      const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
      this.headings[i] = Math.atan2(next[1] - prev[1], next[0] - prev[0]);
    }
    // Curvature from heading change over a ~12 m window to suppress digitising noise.
    const w = Math.max(1, Math.round(6 / this.avgSpacing));
    this.curvatures = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const i0 = closed ? (i - w + n) % n : Math.max(0, i - w);
      const i1 = closed ? (i + w) % n : Math.min(n - 1, i + w);
      let dh = this.headings[i1]! - this.headings[i0]!;
      dh = wrapAngle(dh);
      let ds = this.cum[i1]! - this.cum[i0]!;
      if (closed && ds <= 0) ds += this.length;
      this.curvatures[i] = ds > 0 ? dh / ds : 0;
    }
  }

  /** Normalise s into [0, length) for closed tracks, clamp for open paths. */
  wrap(s: number): number {
    if (this.closed) {
      const L = this.length;
      s %= L;
      return s < 0 ? s + L : s;
    }
    return Math.min(Math.max(s, 0), this.length);
  }

  /** Index of the segment containing s (binary search). */
  segmentIndex(s: number): number {
    const cum = this.cum;
    const n = this.closed ? this.points.length : this.points.length - 1;
    let lo = 0;
    let hi = n - 1;
    // Fast guess for uniform spacing.
    let guess = Math.min(n - 1, Math.max(0, Math.floor(s / this.avgSpacing)));
    if (cum[guess]! <= s && cum[guess + 1]! > s) return guess;
    while (lo <= hi) {
      guess = (lo + hi) >> 1;
      if (cum[guess + 1]! <= s) lo = guess + 1;
      else if (cum[guess]! > s) hi = guess - 1;
      else return guess;
    }
    return Math.min(Math.max(lo, 0), n - 1);
  }

  sample(sIn: number, out: TrackSample = { x: 0, y: 0, heading: 0, curvature: 0 }): TrackSample {
    const s = this.wrap(sIn);
    const n = this.points.length;
    const i = this.segmentIndex(s);
    const j = (i + 1) % n;
    const a = this.points[i]!;
    const b = this.points[j]!;
    const segLen = this.cum[i + 1]! - this.cum[i]!;
    const t = segLen > 1e-9 ? (s - this.cum[i]!) / segLen : 0;
    out.x = a[0] + (b[0] - a[0]) * t;
    out.y = a[1] + (b[1] - a[1]) * t;
    const h0 = this.headings[i]!;
    const h1 = this.headings[j]!;
    out.heading = h0 + wrapAngle(h1 - h0) * t;
    out.curvature = this.curvatures[i]! + (this.curvatures[j]! - this.curvatures[i]!) * t;
    return out;
  }

  /** Point at arc length s with lateral offset (positive = left). */
  pointAt(s: number, lateral = 0, out: Vec2 = [0, 0]): Vec2 {
    const p = this.sample(s, scratch);
    out[0] = p.x - Math.sin(p.heading) * lateral;
    out[1] = p.y + Math.cos(p.heading) * lateral;
    return out;
  }

  headingAt(s: number): number {
    return this.sample(s, scratch).heading;
  }

  curvatureAt(s: number): number {
    return this.sample(s, scratch).curvature;
  }

  /** Signed forward distance from a to b along a closed loop, in (-L/2, L/2]. */
  delta(a: number, b: number): number {
    if (!this.closed) return b - a;
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    if (d <= -L / 2) d += L;
    return d;
  }

  /**
   * Project a world point onto the polyline. With `hintS` only a local window
   * (±windowM) is searched — use it for per-frame tracking.
   */
  project(x: number, y: number, hintS?: number, windowM = 120): { s: number; lateral: number; distance: number } {
    const n = this.points.length;
    const segCount = this.closed ? n : n - 1;
    let i0 = 0;
    let count = segCount;
    if (hintS !== undefined) {
      const k = Math.ceil(windowM / this.avgSpacing);
      i0 = this.segmentIndex(this.wrap(hintS)) - k;
      count = Math.min(segCount, 2 * k + 1);
    }
    let best = Infinity;
    let bestS = 0;
    let bestLat = 0;
    for (let c = 0; c < count; c++) {
      let i = i0 + c;
      if (this.closed) i = ((i % segCount) + segCount) % segCount;
      else if (i < 0 || i >= segCount) continue;
      const a = this.points[i]!;
      const b = this.points[(i + 1) % n]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0;
      t = Math.min(1, Math.max(0, t));
      const px = a[0] + dx * t;
      const py = a[1] + dy * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < best) {
        best = d2;
        bestS = this.cum[i]! + Math.sqrt(l2) * t;
        // cross product sign: left positive
        bestLat = (dx * (y - a[1]) - dy * (x - a[0])) / (Math.sqrt(l2) || 1);
      }
    }
    return { s: this.wrap(bestS), lateral: bestLat, distance: Math.sqrt(best) };
  }

  /** Evenly spaced samples (used by mesh builders). */
  resample(step: number): { s: number; x: number; y: number; heading: number; curvature: number }[] {
    const count = Math.max(2, Math.round(this.length / step));
    const real = this.length / count;
    const out: { s: number; x: number; y: number; heading: number; curvature: number }[] = [];
    const last = this.closed ? count - 1 : count;
    for (let k = 0; k <= last; k++) {
      const s = k * real;
      const p = this.sample(s);
      out.push({ s, x: p.x, y: p.y, heading: p.heading, curvature: p.curvature });
    }
    return out;
  }
}

const scratch: TrackSample = { x: 0, y: 0, heading: 0, curvature: 0 };

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export interface CircuitGeometry {
  track: TrackGeometry;
  pit: TrackGeometry;
}

const geometryCache = new WeakMap<CircuitData, CircuitGeometry>();

export function circuitGeometry(c: CircuitData): CircuitGeometry {
  let g = geometryCache.get(c);
  if (!g) {
    g = { track: new TrackGeometry(c.centerline, true), pit: new TrackGeometry(c.pitLane.path, false) };
    geometryCache.set(c, g);
  }
  return g;
}

export function sectorAt(c: CircuitData, s: number): 1 | 2 | 3 {
  const L = c.centerlineLengthM;
  const x = ((s % L) + L) % L;
  if (x < c.sectors[1].startS) return 1;
  if (x < c.sectors[2].startS) return 2;
  return 3;
}

/** Map local metres to an SVG viewBox (north up). */
export function makeSvgProjector(
  bounds: CircuitData['bounds'],
  viewW: number,
  viewH: number,
  padding: number,
): { project: (x: number, y: number) => Vec2; scale: number } {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const scale = Math.min((viewW - padding * 2) / w, (viewH - padding * 2) / h);
  const ox = (viewW - w * scale) / 2;
  const oy = (viewH - h * scale) / 2;
  return {
    scale,
    project: (x, y) => [ox + (x - bounds.minX) * scale, oy + (bounds.maxY - y) * scale],
  };
}

export function polylineToSvgPath(points: Vec2[], project: (x: number, y: number) => Vec2, closed: boolean, step = 1): string {
  const parts: string[] = [];
  for (let i = 0; i < points.length; i += step) {
    const [px, py] = project(points[i]![0], points[i]![1]);
    parts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  if (closed) parts.push('Z');
  return parts.join('');
}
