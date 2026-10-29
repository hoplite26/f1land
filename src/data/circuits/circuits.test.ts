import { beforeAll, describe, expect, it } from 'vitest';
import { CIRCUIT_META, TrackGeometry, getCachedCircuit, getCircuitMeta, loadCircuit, sectorAt } from './index';
import type { CircuitData, GrandstandSpec, Vec2 } from './types';

const IDS = [
  'au-1953', 'cn-2004', 'jp-1962', 'bh-2002', 'sa-2021', 'us-2022', 'ca-1978', 'mc-1929',
  'es-1991', 'at-1969', 'gb-1948', 'be-1925', 'hu-1986', 'nl-1948', 'it-1922', 'es-2026',
  'az-2016', 'sg-2008', 'us-2012', 'mx-1962', 'br-1940', 'us-2023', 'qa-2004', 'ae-2009',
];

/** Direction of T1 after the main straight. Miami: geometry + Wikipedia's 2022 map show a right-hander. */
const FIRST_CORNER: Record<string, 'L' | 'R'> = {
  'au-1953': 'R', 'cn-2004': 'R', 'jp-1962': 'R', 'bh-2002': 'R', 'sa-2021': 'L', 'us-2022': 'R',
  'ca-1978': 'L', 'mc-1929': 'R', 'es-1991': 'R', 'at-1969': 'R', 'gb-1948': 'R', 'be-1925': 'R',
  'hu-1986': 'R', 'nl-1948': 'R', 'it-1922': 'R', 'es-2026': 'L', 'az-2016': 'L', 'sg-2008': 'L',
  'us-2012': 'L', 'mx-1962': 'R', 'br-1940': 'L', 'us-2023': 'L', 'qa-2004': 'R', 'ae-2009': 'L',
};

const CCW = new Set(['br-1940', 'ae-2009', 'az-2016', 'us-2012', 'sg-2008', 'sa-2021', 'us-2023', 'us-2022']);
const SPRINT = new Set(['cn-2004', 'us-2022', 'ca-1978', 'gb-1948', 'nl-1948', 'sg-2008']);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

function signedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function standRect(track: TrackGeometry, g: GrandstandSpec): Vec2[] {
  const p = track.sample(g.s);
  const sign = g.side === 'left' ? 1 : -1;
  const depth = g.rows * 0.9 + 6;
  const tx = Math.cos(p.heading);
  const ty = Math.sin(p.heading);
  const nx = -ty * sign;
  const ny = tx * sign;
  return ([[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]] as const).map(([u, v]) => [
    p.x + tx * u * g.lengthM + nx * (g.offsetM + v * depth),
    p.y + ty * u * g.lengthM + ny * (g.offsetM + v * depth),
  ]);
}

function pointRectDistance(p: Vec2, rect: Vec2[]): number {
  const [a, b, , d] = rect as [Vec2, Vec2, Vec2, Vec2];
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = d[0] - a[0];
  const vy = d[1] - a[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  const cu = ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / lu;
  const cv = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / lv;
  const du = cu < 0 ? -cu : cu > lu ? cu - lu : 0;
  const dv = cv < 0 ? -cv : cv > lv ? cv - lv : 0;
  return Math.hypot(du, dv);
}

describe('circuit meta', () => {
  it('lists the 24 calendar circuits in order', () => {
    expect(CIRCUIT_META.map((m) => m.id)).toEqual(IDS);
  });

  it('has normalised thumbnail paths', () => {
    for (const m of CIRCUIT_META) {
      expect(m.svgPath).toMatch(/^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+Z$/);
      const nums = m.svgPath.match(/[\d.]+/g)!.map(Number);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...nums)).toBeLessThanOrEqual(100);
      const points = nums.length / 2;
      expect(points).toBeGreaterThanOrEqual(60);
      expect(points).toBeLessThanOrEqual(200);
    }
  });

  it('getCircuitMeta resolves ids and rejects unknown ones', () => {
    expect(getCircuitMeta('mc-1929').shortName).toBe('Monaco');
    expect(() => getCircuitMeta('xx-0000')).toThrow(/Unknown circuit/);
  });

  it('loadCircuit caches and rejects unknown ids', async () => {
    const a = await loadCircuit('ae-2009');
    const b = await loadCircuit('ae-2009');
    expect(a).toBe(b);
    expect(getCachedCircuit('ae-2009')).toBe(a);
    await expect(loadCircuit('xx-0000')).rejects.toThrow(/Unknown circuit/);
  });
});

describe.each(IDS)('%s', (id) => {
  let c: CircuitData;
  let track: TrackGeometry;
  let pit: TrackGeometry;

  beforeAll(async () => {
    c = await loadCircuit(id);
    track = new TrackGeometry(c.centerline, true);
    pit = new TrackGeometry(c.pitLane.path, false);
  });

  it('matches the CircuitData shape', () => {
    expect(c.id).toBe(id);
    expect(c.layoutVersion).toBe(`${id}@2026.1`);
    for (const k of ['name', 'shortName', 'location', 'country', 'timezone'] as const) expect(c[k]).toMatch(/\S/);
    expect(c.countryCode).toMatch(/^[A-Z]{2}$/);
    expect(c.direction === 'CW' || c.direction === 'CCW').toBe(true);
    expect(['desert', 'street', 'parkland', 'forest', 'countryside', 'dunes']).toContain(c.theme);
    expect(['day', 'dusk', 'night']).toContain(c.timeOfDay);
    expect(typeof c.hasWater).toBe('boolean');
    expect(c.lapRecordMs === null || (isNum(c.lapRecordMs) && c.lapRecordMs > 60_000 && c.lapRecordMs < 120_000)).toBe(true);
    expect(Number.isInteger(c.laps) && c.laps * c.lengthM > 260_000 && c.laps * c.lengthM < 312_000).toBe(true);
    if (SPRINT.has(id)) expect(c.sprintLaps).toBe(Math.ceil(100_000 / c.lengthM));
    else expect(c.sprintLaps).toBeUndefined();
    expect(c.widthM).toBeGreaterThanOrEqual(10);
    expect(c.widthM).toBeLessThanOrEqual(15);
    expect(c.centerline.every(isVec)).toBe(true);
    expect(c.pitLane.path.every(isVec)).toBe(true);
    for (const k of ['minX', 'maxX', 'minY', 'maxY'] as const) expect(isNum(c.bounds[k])).toBe(true);
    for (const l of c.landmarks) {
      expect(isVec(l.position) && isNum(l.rotation) && isNum(l.scale)).toBe(true);
    }
    expect(getCircuitMeta(id)).toMatchObject({ name: c.name, lengthM: c.lengthM, laps: c.laps, direction: c.direction });
  });

  it('is a closed loop within 1% of the official length', () => {
    expect(Math.abs(track.length - c.lengthM) / c.lengthM).toBeLessThan(0.01);
    expect(Math.abs(track.length - c.centerlineLengthM)).toBeLessThan(1);
    const first = c.centerline[0]!;
    const last = c.centerline[c.centerline.length - 1]!;
    // No duplicated closing vertex: the last point is one step before the first.
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeGreaterThan(c.spacingM * 0.5);
  });

  it('has uniform ~4 m spacing', () => {
    expect(c.spacingM).toBeGreaterThan(3.8);
    expect(c.spacingM).toBeLessThan(4.2);
    for (let i = 0; i < c.centerline.length; i++) {
      const d = track.cum[i + 1]! - track.cum[i]!;
      expect(Math.abs(d - c.spacingM)).toBeLessThan(0.1);
    }
  });

  it('never bends tighter than the track half-width allows (no folded edges)', () => {
    const n = c.centerline.length;
    let minR = Infinity;
    for (let i = 0; i < n; i++) {
      const a = c.centerline[(i - 1 + n) % n]!;
      const b = c.centerline[i]!;
      const d = c.centerline[(i + 1) % n]!;
      const cross = Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]));
      if (cross < 1e-9) continue;
      const r = (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(d[0] - b[0], d[1] - b[1]) * Math.hypot(a[0] - d[0], a[1] - d[1])) / (2 * cross);
      minR = Math.min(minR, r);
    }
    expect(minR).toBeGreaterThan(c.widthM / 2 + 2);
  });

  it('runs in the race direction', () => {
    expect(c.direction).toBe(signedArea(c.centerline) > 0 ? 'CCW' : 'CW');
    if (id !== 'jp-1962') expect(c.direction).toBe(CCW.has(id) ? 'CCW' : 'CW');
  });

  it('starts on a straight with T1 in the right direction', () => {
    expect(c.corners[0]!.direction).toBe(FIRST_CORNER[id]);
    expect(c.corners[0]!.s).toBeGreaterThan(100);
    expect(c.centerlineLengthM - c.corners[c.corners.length - 1]!.s).toBeGreaterThan(100);
    expect(Math.abs(track.curvatureAt(0))).toBeLessThan(1 / 250);
  });

  it('has ordered, plausible corners', () => {
    expect(c.corners.length).toBeGreaterThanOrEqual(8);
    expect(c.corners.length).toBeLessThanOrEqual(30);
    c.corners.forEach((k, i) => {
      expect(k.number).toBe(i + 1);
      expect(k.s).toBeGreaterThanOrEqual(0);
      expect(k.s).toBeLessThan(c.centerlineLengthM);
      if (i > 0) expect(k.s).toBeGreaterThan(c.corners[i - 1]!.s);
      expect([1, 2, 3, 4, 5, 6]).toContain(k.severity);
      expect(k.radius).toBeGreaterThan(5);
      expect(k.radius).toBeLessThan(450);
    });
  });

  it('has ascending sectors covering [0, L)', () => {
    const [s1, s2, s3] = c.sectors;
    expect([s1.index, s2.index, s3.index]).toEqual([1, 2, 3]);
    expect(s1.startS).toBe(0);
    expect(s1.endS).toBe(s2.startS);
    expect(s2.endS).toBe(s3.startS);
    expect(s3.endS).toBeCloseTo(c.centerlineLengthM, 1);
    for (const s of c.sectors) expect(s.endS - s.startS).toBeGreaterThan(c.centerlineLengthM * 0.2);
    expect(sectorAt(c, 1)).toBe(1);
    expect(sectorAt(c, s2.startS + 1)).toBe(2);
    expect(sectorAt(c, c.centerlineLengthM - 1)).toBe(3);
  });

  it('has 1–3 straight zones on low-curvature track', () => {
    expect(c.straightZones.length).toBeGreaterThanOrEqual(1);
    expect(c.straightZones.length).toBeLessThanOrEqual(id === 'mc-1929' ? 1 : 3);
    for (const z of c.straightZones) {
      const len = (z.endS - z.startS + c.centerlineLengthM) % c.centerlineLengthM;
      expect(len).toBeGreaterThan(150);
      expect(len).toBeLessThan(c.centerlineLengthM / 2);
      expect((z.startS - z.detectionS + c.centerlineLengthM) % c.centerlineLengthM).toBeCloseTo(150, 0);
    }
    // The main straight (through the control line) is always a zone.
    expect(c.straightZones.some((z) => z.startS > z.endS)).toBe(true);
  });

  it('has a pit lane that leaves before and rejoins after the control line, clear of other track', () => {
    const p = c.pitLane;
    const L = c.centerlineLengthM;
    const before = (L - p.entryS) % L;
    expect(before).toBeGreaterThanOrEqual(150);
    expect(before).toBeLessThanOrEqual(460);
    expect(p.exitS).toBeGreaterThanOrEqual(140);
    expect(p.exitS).toBeLessThanOrEqual(460);
    expect(Math.abs(pit.length - p.lengthM)).toBeLessThan(1);
    // Branches off / merges onto the centreline in race direction.
    const a = track.pointAt(p.entryS);
    const b = track.pointAt(p.exitS);
    expect(Math.hypot(p.path[0]![0] - a[0], p.path[0]![1] - a[1])).toBeLessThan(1.5);
    const end = p.path[p.path.length - 1]!;
    expect(Math.hypot(end[0] - b[0], end[1] - b[1])).toBeLessThan(1.5);
    // Parallel to the main straight on the declared side at the control line.
    const atLine = pit.project(...track.pointAt(0));
    const proj = track.project(...pit.pointAt(atLine.s));
    expect(Math.sign(proj.lateral)).toBe(p.side === 'left' ? 1 : -1);
    expect(Math.abs(proj.lateral)).toBeGreaterThan(c.widthM);
    // Boxes sit on the pit path.
    expect(p.boxesStartS).toBeGreaterThan(0);
    expect(p.boxesEndS).toBeGreaterThan(p.boxesStartS + 150);
    expect(p.boxesEndS).toBeLessThan(p.lengthM);
    expect([60, 80]).toContain(p.speedLimitKph);
    // Spacing ~4 m.
    for (let i = 0; i < p.path.length - 1; i++) expect(Math.abs(pit.cum[i + 1]! - pit.cum[i]! - 4)).toBeLessThan(0.5);
    // Clearance from non-adjacent parts of the circuit.
    const w0 = p.entryS - 60;
    const w1 = p.exitS + 60;
    const inWindow = (s: number) => ((s - w0) % L + L) % L <= ((w1 - w0) % L + L) % L;
    let min = Infinity;
    track.points.forEach((q, j) => {
      if (inWindow(track.cum[j]!)) return;
      for (const pp of p.path) min = Math.min(min, Math.hypot(pp[0] - q[0], pp[1] - q[1]));
    });
    expect(min).toBeGreaterThanOrEqual(c.widthM);
    // Smooth enough for a lane mesh: no bend tighter than 12 m.
    for (let i = 1; i < p.path.length - 1; i++) {
      const [a, b, d] = [p.path[i - 1]!, p.path[i]!, p.path[i + 1]!];
      const cross = Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]));
      if (cross < 1e-9) continue;
      const r = (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(d[0] - b[0], d[1] - b[1]) * Math.hypot(a[0] - d[0], a[1] - d[1])) / (2 * cross);
      expect(r).toBeGreaterThan(12);
    }
    // Between the merge transitions the lane stays off the whole circuit.
    const inner = p.path.filter((_, i) => pit.cum[i]! > 100 && pit.cum[i]! < p.lengthM - 100);
    for (const q of c.centerline) for (const pp of inner) expect(Math.hypot(pp[0] - q[0], pp[1] - q[1])).toBeGreaterThan(c.widthM / 2 + 4);
  });

  it('places grandstands clear of the track and pit lane', () => {
    expect(c.grandstands.length).toBeGreaterThanOrEqual(3);
    expect(c.grandstands.length).toBeLessThanOrEqual(7);
    expect(c.grandstands.some((g) => g.name === 'Main Grandstand')).toBe(true);
    const rects = c.grandstands.map((g) => standRect(track, g));
    c.grandstands.forEach((g, i) => {
      expect(g.lengthM).toBeGreaterThanOrEqual(50);
      expect(g.lengthM).toBeLessThanOrEqual(180);
      expect(g.rows).toBeGreaterThanOrEqual(8);
      expect(g.rows).toBeLessThanOrEqual(22);
      expect(g.offsetM).toBeGreaterThan(c.widthM / 2);
      const rect = rects[i]!;
      for (const q of c.centerline) expect(pointRectDistance(q, rect)).toBeGreaterThan(c.widthM / 2 + 5);
      for (const q of c.pitLane.path) expect(pointRectDistance(q, rect)).toBeGreaterThan(8);
    });
  });

  it('keeps landmarks off the track unless they straddle it', () => {
    for (const l of c.landmarks) {
      if (l.kind === 'yas-hotel' || l.kind === 'bridge') continue;
      const d = Math.min(
        ...c.centerline.map((q) => Math.hypot(q[0] - l.position[0], q[1] - l.position[1])),
        ...c.pitLane.path.map((q) => Math.hypot(q[0] - l.position[0], q[1] - l.position[1])),
      );
      expect(d).toBeGreaterThanOrEqual(59.9);
    }
  });

  it('bounds contain the track and pit lane', () => {
    for (const [x, y] of [...c.centerline, ...c.pitLane.path]) {
      expect(x).toBeGreaterThanOrEqual(c.bounds.minX);
      expect(x).toBeLessThanOrEqual(c.bounds.maxX);
      expect(y).toBeGreaterThanOrEqual(c.bounds.minY);
      expect(y).toBeLessThanOrEqual(c.bounds.maxY);
    }
  });
});
