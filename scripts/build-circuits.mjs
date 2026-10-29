#!/usr/bin/env node
/**
 * Builds src/data/circuits/generated/<id>.json (CircuitData) + meta.json (CircuitMeta[])
 * from the MIT-licensed bacinger/f1-circuits GeoJSON (scripts/data/f1-circuits.geojson).
 *
 *   node scripts/build-circuits.mjs          (alias: pnpm circuits)
 *
 * Fully offline and deterministic: same input → byte-identical JSON.
 * Geometry is approximate (F1-004): a smoothed, length-calibrated centreline, a
 * synthetic pit lane and procedurally placed grandstands — good for a 3D scene,
 * never presented as exact racing lines.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'scripts/data/f1-circuits.geojson');
const OUT = path.join(ROOT, 'src/data/circuits/generated');
const SPACING = 4;
const R_EARTH = 6371008.8;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Per-circuit configuration (2026 calendar order).
// startS: metres along the oriented source loop (race direction, from the GeoJSON's
//   first vertex) to the control line. Determined from the preview contact sheet.
// t1: direction of the first corner after the control line (asserted).
// Landmark placement: { latlon:[lat,lon] } | { s: fraction, lat: metres (+left) } |
//   { centroid:[fromFrac,toFrac] } (centroid of that part of the track).
// ---------------------------------------------------------------------------
const CIRCUITS = [
  {
    id: 'au-1953', name: 'Albert Park Circuit', shortName: 'Albert Park', location: 'Melbourne', country: 'Australia',
    countryCode: 'AU', timezone: 'Australia/Melbourne', laps: 58, direction: 'CW', t1: 'R', widthM: 13,
    theme: 'parkland', timeOfDay: 'day', hasWater: true, lapRecordMs: 79813, realTurns: 14, startS: 0,
    landmarks: [{ kind: 'lake', at: { latlon: [-37.8466, 144.9705] }, scale: 3 }],
  },
  {
    id: 'cn-2004', name: 'Shanghai International Circuit', shortName: 'Shanghai', location: 'Shanghai', country: 'China',
    countryCode: 'CN', timezone: 'Asia/Shanghai', laps: 56, sprint: true, direction: 'CW', t1: 'R', widthM: 15,
    theme: 'countryside', timeOfDay: 'day', hasWater: false, lapRecordMs: 92238, realTurns: 16, startS: 0,
    landmarks: [],
  },
  {
    id: 'jp-1962',
    cornerNames: [{ s: 872, dir: 'L', name: 'S Curves' }, { s: 1556, dir: 'L', name: 'Dunlop' }, { s: 2068, dir: 'R', name: 'Degner' }, { s: 2680, dir: 'L', name: 'Hairpin' }, { s: 3575, dir: 'L', name: 'Spoon' }, { s: 4743, dir: 'L', name: '130R' }, { s: 5167, dir: 'R', name: 'Casio Triangle' }], name: 'Suzuka International Racing Course', shortName: 'Suzuka', location: 'Suzuka', country: 'Japan',
    // Figure-8: source order already has T1/T2 as right-handers; net signed area → CW.
    countryCode: 'JP', timezone: 'Asia/Tokyo', laps: 53, direction: null, reverse: false, t1: 'R', widthM: 13,
    theme: 'countryside', timeOfDay: 'day', hasWater: false, lapRecordMs: 90983, realTurns: 18, startS: 0,
    landmarks: [{ kind: 'ferris-wheel', at: { s: 0.06, lat: 220 }, scale: 1 }],
  },
  {
    id: 'bh-2002', name: 'Bahrain International Circuit', shortName: 'Bahrain', location: 'Sakhir', country: 'Bahrain',
    countryCode: 'BH', timezone: 'Asia/Bahrain', laps: 57, direction: 'CW', t1: 'R', widthM: 15,
    theme: 'desert', timeOfDay: 'night', hasWater: false, lapRecordMs: 91447, realTurns: 15, startS: 0,
    landmarks: [{ kind: 'sakhir-tower', at: { s: 0.0, pit: 70 }, scale: 1 }],
  },
  {
    id: 'sa-2021', name: 'Jeddah Corniche Circuit', shortName: 'Jeddah', location: 'Jeddah', country: 'Saudi Arabia',
    countryCode: 'SA', timezone: 'Asia/Riyadh', laps: 50, direction: 'CCW', t1: 'L', widthM: 12,
    theme: 'desert', timeOfDay: 'night', hasWater: false, lapRecordMs: 90734, realTurns: 27, startS: 0,
    landmarks: [{ kind: 'towers', at: { s: 0.25, lat: -320 }, scale: 1 }],
  },
  {
    id: 'us-2022', name: 'Miami International Autodrome', shortName: 'Miami', location: 'Miami Gardens', country: 'United States',
    // Geometry + Wikipedia 2022 map agree: driven CCW, T1 at the end of the pit straight is a right-hander.
    countryCode: 'US', timezone: 'America/New_York', laps: 57, sprint: true, direction: 'CCW', t1: 'R', widthM: 13,
    theme: 'street', timeOfDay: 'day', hasWater: true, lapRecordMs: 89708, realTurns: 19, startS: 0,
    landmarks: [
      { kind: 'stadium', at: { latlon: [25.958, -80.2389] }, scale: 1.2 },
      { kind: 'marina', at: { s: 0.6, lat: 90 }, scale: 1 },
    ],
  },
  {
    id: 'ca-1978',
    cornerNames: [{ s: 456, dir: 'L', name: 'Virage Senna' }, { s: 2889, dir: 'R', name: "L'Épingle" }, { s: 4133, dir: 'L', name: 'Wall of Champions' }], name: 'Circuit Gilles-Villeneuve', shortName: 'Montréal', location: 'Montréal', country: 'Canada',
    countryCode: 'CA', timezone: 'America/Toronto', laps: 70, sprint: true, direction: 'CW', t1: 'L', widthM: 13,
    theme: 'parkland', timeOfDay: 'day', hasWater: true, lapRecordMs: 73078, realTurns: 14, startS: 0,
    landmarks: [{ kind: 'lake', at: { s: 0.78, lat: 170 }, scale: 2 }],
  },
  {
    id: 'mc-1929',
    cornerNames: [{ s: 212, dir: 'R', name: 'Sainte Dévote' }, { s: 836, dir: 'L', name: 'Massenet' }, { s: 900, dir: 'R', name: 'Casino' }, { s: 1132, dir: 'R', name: 'Mirabeau' }, { s: 1264, dir: 'L', name: 'Loews' }, { s: 1440, dir: 'R', name: 'Portier' }, { s: 1797, dir: 'R', name: 'Tunnel' }, { s: 2101, dir: 'L', name: 'Nouvelle Chicane' }, { s: 2389, dir: 'L', name: 'Tabac' }, { s: 2541, dir: 'L', name: 'Piscine' }, { s: 2933, dir: 'R', name: 'Rascasse' }], name: 'Circuit de Monaco', shortName: 'Monaco', location: 'Monte Carlo', country: 'Monaco',
    countryCode: 'MC', timezone: 'Europe/Monaco', laps: 78, direction: 'CW', t1: 'R', widthM: 10.5,
    theme: 'street', timeOfDay: 'day', hasWater: true, lapRecordMs: 72909, realTurns: 19,
    // Pits sit between the start straight and the harbour (right), separated by a wall.
    speedLimitKph: 60, zones: 1, pitSide: 'right', pitOffsetM: 16, pitExitM: 150, pitTransitionM: 60,
    // Source loop starts near Casino Square; control line ≈200 m before Sainte Dévote.
    startS: 2440,
    landmarks: [{ kind: 'harbour', at: { latlon: [43.7351, 7.4258] }, scale: 1.5 }],
  },
  {
    id: 'es-1991', name: 'Circuit de Barcelona-Catalunya', shortName: 'Barcelona', location: 'Montmeló', country: 'Spain',
    countryCode: 'ES', timezone: 'Europe/Madrid', laps: 66, direction: 'CW', t1: 'R', widthM: 14,
    theme: 'countryside', timeOfDay: 'day', hasWater: false, lapRecordMs: 76330, realTurns: 14, startS: 0,
    landmarks: [],
  },
  {
    id: 'at-1969',
    cornerNames: [{ s: 1267, dir: 'R', name: 'Remus' }, { s: 2075, dir: 'R', name: 'Schlossgold' }], name: 'Red Bull Ring', shortName: 'Red Bull Ring', location: 'Spielberg', country: 'Austria',
    countryCode: 'AT', timezone: 'Europe/Vienna', laps: 71, direction: 'CW', t1: 'R', widthM: 14,
    theme: 'forest', timeOfDay: 'day', hasWater: false, lapRecordMs: 65619, realTurns: 10, startS: 0,
    landmarks: [{ kind: 'mountains', at: { compass: 330, dist: 1300 }, scale: 3 }],
  },
  {
    id: 'gb-1948',
    cornerNames: [{ s: 260, dir: 'R', name: 'Abbey' }], name: 'Silverstone Circuit', shortName: 'Silverstone', location: 'Silverstone', country: 'United Kingdom',
    countryCode: 'GB', timezone: 'Europe/London', laps: 52, sprint: true, direction: 'CW', t1: 'R', widthM: 15,
    theme: 'countryside', timeOfDay: 'day', hasWater: false, lapRecordMs: 87097, realTurns: 18, startS: 0,
    landmarks: [],
  },
  {
    id: 'be-1925',
    cornerNames: [{ s: 244, dir: 'R', name: 'La Source' }, { s: 908, dir: 'L', name: 'Eau Rouge' }, { s: 996, dir: 'R', name: 'Raidillon' }, { s: 2284, dir: 'R', name: 'Les Combes' }, { s: 2864, dir: 'R', name: 'Bruxelles' }, { s: 3652, dir: 'L', name: 'Pouhon' }, { s: 4980, dir: 'R', name: 'Stavelot' }, { s: 6072, dir: 'L', name: 'Blanchimont' }, { s: 6608, dir: 'R', name: 'Bus Stop' }], name: 'Circuit de Spa-Francorchamps', shortName: 'Spa', location: 'Stavelot', country: 'Belgium',
    countryCode: 'BE', timezone: 'Europe/Brussels', laps: 44, direction: 'CW', t1: 'R', widthM: 13,
    theme: 'forest', timeOfDay: 'day', hasWater: false, lapRecordMs: 104701, realTurns: 19, startS: 0,
    landmarks: [{ kind: 'mountains', at: { compass: 120, dist: 2200 }, scale: 3 }],
  },
  {
    id: 'hu-1986', name: 'Hungaroring', shortName: 'Hungaroring', location: 'Mogyoród', country: 'Hungary',
    countryCode: 'HU', timezone: 'Europe/Budapest', laps: 70, direction: 'CW', t1: 'R', widthM: 13,
    theme: 'forest', timeOfDay: 'day', hasWater: false, lapRecordMs: 76627, realTurns: 14, startS: 0,
    landmarks: [],
  },
  {
    id: 'nl-1948',
    cornerNames: [{ s: 440, dir: 'R', name: 'Tarzan' }, { s: 884, dir: 'L', name: 'Hugenholtz' }, { s: 1776, dir: 'R', name: 'Scheivlak' }, { s: 3815, dir: 'R', name: 'Arie Luyendyk' }], name: 'Circuit Zandvoort', shortName: 'Zandvoort', location: 'Zandvoort', country: 'Netherlands',
    countryCode: 'NL', timezone: 'Europe/Amsterdam', laps: 72, sprint: true, direction: 'CW', t1: 'R', widthM: 12,
    theme: 'dunes', timeOfDay: 'day', hasWater: false, lapRecordMs: 71097, realTurns: 14, startS: 0,
    landmarks: [],
  },
  {
    id: 'it-1922',
    cornerNames: [{ s: 624, dir: 'R', name: 'Rettifilo' }, { s: 1096, dir: 'R', name: 'Curva Grande' }, { s: 1836, dir: 'L', name: 'Roggia' }, { s: 2292, dir: 'R', name: 'Lesmo 1' }, { s: 2572, dir: 'R', name: 'Lesmo 2' }, { s: 3641, dir: 'L', name: 'Ascari' }, { s: 4833, dir: 'R', name: 'Parabolica' }], name: 'Autodromo Nazionale Monza', shortName: 'Monza', location: 'Monza', country: 'Italy',
    countryCode: 'IT', timezone: 'Europe/Rome', laps: 53, direction: 'CW', t1: 'R', widthM: 14,
    theme: 'forest', timeOfDay: 'day', hasWater: false, lapRecordMs: 81046, realTurns: 11, startS: 0,
    landmarks: [],
  },
  {
    id: 'es-2026',
    cornerNames: [{ s: 2383, dir: 'R', name: 'La Monumental' }], name: 'Madring', shortName: 'Madring', location: 'Madrid', country: 'Spain',
    countryCode: 'ES', timezone: 'Europe/Madrid', laps: 57, direction: 'CW', t1: 'L', widthM: 13,
    theme: 'street', timeOfDay: 'day', hasWater: false, lapRecordMs: null, realTurns: 22, startS: 0,
    // F1.com circuit guide (Sep 2026): 5.414 km × 57 laps = 308.399 km; the dataset still lists 5474 m.
    officialLengthM: 5414,
    landmarks: [],
  },
  {
    id: 'az-2016', name: 'Baku City Circuit', shortName: 'Baku', location: 'Baku', country: 'Azerbaijan',
    countryCode: 'AZ', timezone: 'Asia/Baku', laps: 51, direction: 'CCW', t1: 'L', widthM: 12,
    theme: 'street', timeOfDay: 'day', hasWater: true, lapRecordMs: 103009, realTurns: 20, startS: -80,
    landmarks: [{ kind: 'towers', at: { s: 0.4, lat: -250 }, scale: 1 }],
  },
  {
    id: 'sg-2008', name: 'Marina Bay Street Circuit', shortName: 'Marina Bay', location: 'Singapore', country: 'Singapore',
    countryCode: 'SG', timezone: 'Asia/Singapore', laps: 62, sprint: true, direction: 'CCW', t1: 'L', widthM: 12,
    theme: 'street', timeOfDay: 'night', hasWater: true, lapRecordMs: 94486, realTurns: 19, startS: 0,
    speedLimitKph: 60, straightMinRadius: 300,
    landmarks: [{ kind: 'towers', at: { s: 0.35, lat: -200 }, scale: 1.2 }],
  },
  {
    id: 'us-2012', name: 'Circuit of the Americas', shortName: 'COTA', location: 'Austin', country: 'United States',
    countryCode: 'US', timezone: 'America/Chicago', laps: 56, direction: 'CCW', t1: 'L', widthM: 15,
    theme: 'countryside', timeOfDay: 'day', hasWater: false, lapRecordMs: 96169, realTurns: 20, startS: 0,
    landmarks: [{ kind: 'observation-tower', at: { latlon: [30.1346, -97.638] }, scale: 1 }],
  },
  {
    id: 'mx-1962',
    cornerNames: [{ s: 3604, dir: 'R', name: 'Foro Sol' }], name: 'Autódromo Hermanos Rodríguez', shortName: 'Mexico City', location: 'Mexico City', country: 'Mexico',
    countryCode: 'MX', timezone: 'America/Mexico_City', laps: 71, direction: 'CW', t1: 'R', widthM: 14,
    theme: 'parkland', timeOfDay: 'day', hasWater: false, lapRecordMs: 77774, realTurns: 17, startS: 0,
    landmarks: [{ kind: 'stadium', at: { centroid: [0.8, 0.92] }, scale: 1 }],
  },
  {
    id: 'br-1940',
    cornerNames: [{ s: 312, dir: 'L', name: 'Senna S' }, { s: 1388, dir: 'L', name: 'Descida do Lago' }, { s: 1988, dir: 'R', name: 'Ferradura' }, { s: 2737, dir: 'R', name: 'Bico de Pato' }, { s: 2893, dir: 'L', name: 'Mergulho' }, { s: 3233, dir: 'L', name: 'Junção' }], name: 'Autódromo José Carlos Pace', shortName: 'Interlagos', location: 'São Paulo', country: 'Brazil',
    countryCode: 'BR', timezone: 'America/Sao_Paulo', laps: 71, direction: 'CCW', t1: 'L', widthM: 13,
    theme: 'countryside', timeOfDay: 'day', hasWater: false, lapRecordMs: 70540, realTurns: 15, startS: 0,
    landmarks: [],
  },
  {
    id: 'us-2023', name: 'Las Vegas Strip Circuit', shortName: 'Las Vegas', location: 'Las Vegas', country: 'United States',
    countryCode: 'US', timezone: 'America/Los_Angeles', laps: 50, direction: 'CCW', t1: 'L', widthM: 13,
    theme: 'street', timeOfDay: 'night', hasWater: false, lapRecordMs: 94876, realTurns: 17, startS: 0,
    landmarks: [{ kind: 'sphere', at: { latlon: [36.12083, -115.16222] }, scale: 1 }],
  },
  {
    id: 'qa-2004', name: 'Lusail International Circuit', shortName: 'Lusail', location: 'Lusail', country: 'Qatar',
    countryCode: 'QA', timezone: 'Asia/Qatar', laps: 57, direction: 'CW', t1: 'R', widthM: 15,
    theme: 'desert', timeOfDay: 'night', hasWater: false, lapRecordMs: 82384, realTurns: 16, startS: 0,
    landmarks: [],
  },
  {
    id: 'ae-2009', name: 'Yas Marina Circuit', shortName: 'Yas Marina', location: 'Abu Dhabi', country: 'United Arab Emirates',
    countryCode: 'AE', timezone: 'Asia/Dubai', laps: 58, direction: 'CCW', t1: 'L', widthM: 14,
    theme: 'desert', timeOfDay: 'dusk', hasWater: true, lapRecordMs: 86103, realTurns: 16, startS: 0,
    landmarks: [
      { kind: 'yas-hotel', at: { latlon: [24.4672, 54.6036] }, scale: 1, straddle: true },
      { kind: 'marina', at: { latlon: [24.4645, 54.6045] }, scale: 1.5 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Small geometry kit (mirrors src/data/circuits/geometry.ts semantics:
// lateral offsets positive = LEFT of travel, headings atan2(dy, dx)).
// ---------------------------------------------------------------------------
const hyp = Math.hypot;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => {
  const x = Math.round(v * 100) / 100;
  return Object.is(x, -0) ? 0 : x;
};
function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
function perimeter(pts, closed = true) {
  let l = 0;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) l += hyp(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]);
  return l;
}

class Track {
  constructor(points, closed) {
    this.points = points;
    this.closed = closed;
    const n = points.length;
    const segs = closed ? n : n - 1;
    this.cum = new Float64Array(n + 1);
    for (let i = 0; i < segs; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      this.cum[i + 1] = this.cum[i] + hyp(b[0] - a[0], b[1] - a[1]);
    }
    this.segs = segs;
    this.length = this.cum[segs];
    this.headings = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const q = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      this.headings[i] = Math.atan2(q[1] - p[1], q[0] - p[0]);
    }
  }
  wrap(s) {
    if (!this.closed) return clamp(s, 0, this.length);
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }
  seg(s) {
    let lo = 0;
    let hi = this.segs - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.cum[m] <= s) lo = m;
      else hi = m - 1;
    }
    return lo;
  }
  sample(sIn) {
    const s = this.wrap(sIn);
    const i = this.seg(s);
    const j = (i + 1) % this.points.length;
    const a = this.points[i];
    const b = this.points[j];
    const len = this.cum[i + 1] - this.cum[i];
    const t = len > 1e-9 ? (s - this.cum[i]) / len : 0;
    const h0 = this.headings[i];
    const h1 = this.headings[j];
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, heading: h0 + wrapAngle(h1 - h0) * t };
  }
  pointAt(s, lateral = 0) {
    const p = this.sample(s);
    return [p.x - Math.sin(p.heading) * lateral, p.y + Math.cos(p.heading) * lateral];
  }
  /** Signed forward distance a → b on a closed loop in (-L/2, L/2]. */
  delta(a, b) {
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    if (d <= -L / 2) d += L;
    return d;
  }
  project(x, y) {
    let best = Infinity;
    let bestS = 0;
    let bestLat = 0;
    const n = this.points.length;
    for (let i = 0; i < this.segs; i++) {
      const a = this.points[i];
      const b = this.points[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1) : 0;
      const px = a[0] + dx * t;
      const py = a[1] + dy * t;
      const d2 = (x - px) ** 2 + (y - py) ** 2;
      if (d2 < best) {
        best = d2;
        bestS = this.cum[i] + Math.sqrt(l2) * t;
        bestLat = (dx * (y - a[1]) - dy * (x - a[0])) / (Math.sqrt(l2) || 1);
      }
    }
    return { s: this.wrap(bestS), lateral: bestLat, distance: Math.sqrt(best) };
  }
}

/** Uniform resample of a closed polyline: n points starting at arc length s0. */
function resampleClosed(pts, n, s0 = 0) {
  const t = new Track(pts, true);
  const step = t.length / n;
  const out = [];
  for (let k = 0; k < n; k++) {
    const p = t.sample(s0 + k * step);
    out.push([p.x, p.y]);
  }
  return out;
}
function resampleOpen(pts, step) {
  const t = new Track(pts, false);
  const n = Math.max(1, Math.round(t.length / step));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const p = t.sample((k * t.length) / n);
    out.push([p.x, p.y]);
  }
  return out;
}

/** Closed centripetal Catmull-Rom (Barry–Goldman), ~`res` metres between samples. */
function catmullRomClosed(pts, res = 1) {
  const n = pts.length;
  const out = [];
  const alpha = 0.5;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + Math.max(1e-6, hyp(p1[0] - p0[0], p1[1] - p0[1]) ** alpha);
    const t2 = t1 + Math.max(1e-6, hyp(p2[0] - p1[0], p2[1] - p1[1]) ** alpha);
    const t3 = t2 + Math.max(1e-6, hyp(p3[0] - p2[0], p3[1] - p2[1]) ** alpha);
    const steps = Math.max(2, Math.ceil(hyp(p2[0] - p1[0], p2[1] - p1[1]) / res));
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const lerp = (a, b, ta, tb) => [
        ((tb - t) / (tb - ta)) * a[0] + ((t - ta) / (tb - ta)) * b[0],
        ((tb - t) / (tb - ta)) * a[1] + ((t - ta) / (tb - ta)) * b[1],
      ];
      const A1 = lerp(p0, p1, t0, t1);
      const A2 = lerp(p1, p2, t1, t2);
      const A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2);
      const B2 = lerp(A2, A3, t1, t3);
      out.push(lerp(B1, B2, t1, t2));
    }
  }
  return out;
}

/** Taubin λ|μ smoothing (no shrinkage) on a closed polyline. */
function taubin(pts, iterations, lambda = 0.5, mu = -0.53) {
  let cur = pts.map((p) => [p[0], p[1]]);
  const n = cur.length;
  for (let it = 0; it < iterations; it++) {
    for (const f of [lambda, mu]) {
      const nxt = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = cur[(i - 1 + n) % n];
        const b = cur[i];
        const c = cur[(i + 1) % n];
        nxt[i] = [b[0] + f * ((a[0] + c[0]) / 2 - b[0]), b[1] + f * ((a[1] + c[1]) / 2 - b[1])];
      }
      cur = nxt;
    }
  }
  return cur;
}

/**
 * Removes spline cusps at sparsely digitised corners: locally smooths wherever
 * the 3-point radius (±2 samples) drops below minR, so offset track edges and
 * kerbs never fold. Leaves everything else untouched.
 */
function limitCurvature(pts, minR, maxIter = 400, closed = true) {
  let cur = pts.map((p) => [p[0], p[1]]);
  const n = cur.length;
  // Open paths keep their first/last 3 samples pinned (merge points on the track).
  const free = (i) => closed || (i >= 3 && i < n - 3);
  const radius = (a, b, c) => {
    const ab = hyp(b[0] - a[0], b[1] - a[1]);
    const bc = hyp(c[0] - b[0], c[1] - b[1]);
    const ca = hyp(a[0] - c[0], a[1] - c[1]);
    const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
  };
  for (let it = 0; it < maxIter; it++) {
    const flagged = new Uint8Array(n);
    let any = false;
    for (let i = closed ? 0 : 2; i < (closed ? n : n - 2); i++) {
      if (radius(cur[(i - 2 + n) % n], cur[i], cur[(i + 2) % n]) < minR) {
        for (let d = -3; d <= 3; d++) if (free((i + d + n) % n)) flagged[(i + d + n) % n] = 1;
        any = true;
      }
    }
    if (!any) break;
    const next = cur.map((p) => [p[0], p[1]]);
    for (let i = 0; i < n; i++) {
      if (!flagged[i]) continue;
      const a = cur[(i - 1 + n) % n];
      const c = cur[(i + 1) % n];
      next[i] = [cur[i][0] + 0.5 * ((a[0] + c[0]) / 2 - cur[i][0]), cur[i][1] + 0.5 * ((a[1] + c[1]) / 2 - cur[i][1])];
    }
    cur = next;
  }
  return cur;
}

/** Signed curvature (1/m, + = left) from heading change over ±w points. */
function curvatureArray(pts, w) {
  const n = pts.length;
  const head = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n];
    const q = pts[(i + 1) % n];
    head[i] = Math.atan2(q[1] - p[1], q[0] - p[0]);
  }
  const step = perimeter(pts) / n;
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    k[i] = wrapAngle(head[(i + w) % n] - head[(i - w + n) % n]) / (2 * w * step);
  }
  return { k, head, step };
}
function movingAverageCyclic(arr, half) {
  const n = arr.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = -half; d <= half; d++) s += arr[(i + d + n) % n];
    out[i] = s / (2 * half + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------
function severityFor(r) {
  if (r < 20) return 6;
  if (r < 40) return 5;
  if (r < 70) return 4;
  if (r < 120) return 3;
  if (r < 220) return 2;
  return 1;
}

function detectCorners(pts, cfg) {
  const { k, step } = curvatureArray(pts, Math.max(1, Math.round(12 / SPACING)));
  const n = pts.length;
  const kMin = 1 / (cfg.cornerMaxRadius ?? 400);
  const minTurn = (cfg.cornerMinDeg ?? 14) * DEG;
  // Start scanning at the straightest point so no region wraps the array end.
  let start = 0;
  for (let i = 1; i < n; i++) if (Math.abs(k[i]) < Math.abs(k[start])) start = i;
  const regions = [];
  let cur = null;
  for (let c = 0; c <= n; c++) {
    const i = (start + c) % n;
    const sign = c < n && Math.abs(k[i]) >= kMin ? Math.sign(k[i]) : 0;
    if (cur && sign !== cur.sign) {
      regions.push(cur);
      cur = null;
    }
    if (sign !== 0) {
      if (!cur) cur = { sign, peak: i, peakK: Math.abs(k[i]), turn: 0, first: c, last: c };
      cur.turn += k[i] * step;
      cur.last = c;
      if (Math.abs(k[i]) > cur.peakK) {
        cur.peakK = Math.abs(k[i]);
        cur.peak = i;
      }
    }
  }
  const kinkTurn = (cfg.cornerKinkDeg ?? 25) * DEG;
  let peaks = regions
    // Keep real turns; gentle kinks only when they are also fairly tight.
    .filter((r) => Math.abs(r.turn) >= kinkTurn || (Math.abs(r.turn) >= minTurn && 1 / r.peakK < 150))
    .map((r) => ({
      s: r.peak * step,
      dir: r.sign > 0 ? 'L' : 'R',
      radius: 1 / r.peakK,
      turn: Math.abs(r.turn),
      entry: ((start + r.first) % n) * step,
      exit: ((start + r.last) % n) * step,
    }))
    .sort((a, b) => a.s - b.s);
  const L = n * step;
  // Merge same-direction peaks closer than ~60 m (incl. across the wrap).
  const mergeDist = cfg.cornerMergeM ?? 60;
  let merged = true;
  while (merged && peaks.length > 1) {
    merged = false;
    for (let i = 0; i < peaks.length; i++) {
      const a = peaks[i];
      const j = (i + 1) % peaks.length;
      const b = peaks[j];
      let d = b.s - a.s;
      if (d < 0) d += L;
      if (a.dir === b.dir && d < mergeDist) {
        const keep = a.radius <= b.radius ? a : b;
        const m = { s: keep.s, dir: a.dir, radius: Math.min(a.radius, b.radius), turn: a.turn + b.turn, entry: a.entry, exit: b.exit };
        if (j === 0) {
          peaks.splice(i, 1);
          peaks[0] = m;
        } else peaks.splice(i, 2, m);
        peaks.sort((x, y) => x.s - y.s);
        merged = true;
        break;
      }
    }
  }
  // Drop digitising blips: a small turn hugging a much bigger opposite-hand corner.
  const blipDeg = 25 * DEG;
  peaks = peaks.filter((p) => {
    if (p.turn >= blipDeg) return true;
    return !peaks.some((q) => {
      if (q === p || q.dir === p.dir || q.turn < 2 * p.turn) return false;
      let d = Math.abs(q.s - p.s);
      d = Math.min(d, L - d);
      return d < 70;
    });
  });
  return peaks.map((p, i) => {
    const corner = { number: i + 1, s: r2(p.s), direction: p.dir, severity: severityFor(p.radius), radius: r2(p.radius) };
    // Build-time only (stripped from JSON): extent of the bend around the apex.
    Object.defineProperty(corner, 'entry', { value: p.entry, enumerable: false });
    Object.defineProperty(corner, 'exit', { value: p.exit, enumerable: false });
    return corner;
  });
}

function pickSectors(pts, cfg, L) {
  const { k, step } = curvatureArray(pts, 3);
  const ks = movingAverageCyclic(k.map(Math.abs), Math.round(30 / step));
  const fr = cfg.sectorFractions ?? [1 / 3, 2 / 3];
  const bounds = fr.map((f) => {
    const target = f * L;
    let best = Math.round(target / step);
    let bestScore = Infinity;
    const win = Math.round((0.045 * L) / step);
    for (let d = -win; d <= win; d++) {
      const i = Math.round(target / step) + d;
      const score = ks[(i + pts.length) % pts.length] * 400 + Math.abs(d * step) / (0.045 * L);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return r2(best * step);
  });
  return [
    { index: 1, startS: 0, endS: bounds[0] },
    { index: 2, startS: bounds[0], endS: bounds[1] },
    { index: 3, startS: bounds[1], endS: r2(L) },
  ];
}

function pickStraightZones(pts, cfg, L, corners) {
  const { k, step } = curvatureArray(pts, 3);
  const n = pts.length;
  const ks = movingAverageCyclic(k.map(Math.abs), Math.round(16 / step));
  const norm = (s) => ((s % L) + L) % L;
  // Main straight: from the exit of the last corner to the braking point of T1.
  const last = corners[corners.length - 1];
  const first = corners[0];
  // Walk out of the bordering bends on smoothed curvature (robust to split corner tails).
  const ksAt = (x) => ks[Math.round(norm(x) / step) % n];
  let zStart = last.s;
  while (ksAt(zStart) > 1 / 450 && zStart < L + first.s) zStart += step;
  zStart += 25;
  let zEnd = first.s + L;
  while (ksAt(zEnd) > 1 / 450 && zEnd > zStart) zEnd -= step;
  zEnd -= 50;
  if (zEnd - zStart < 200) {
    zStart = last.s + 60;
    zEnd = first.s - 90 + L;
  }
  const zones = [{ startS: norm(zStart), endS: norm(zEnd), len: zEnd - zStart }];
  // Other straights: long low-curvature runs (tiny kinks bridged).
  const straight = Array.from(ks, (v) => v < 1 / (cfg.straightMinRadius ?? 420));
  let start = 0;
  while (straight[start] && start < n - 1) start++;
  const runs = [];
  let cur = null;
  for (let c = 1; c <= n; c++) {
    const i = (start + c) % n;
    if (straight[i] && c < n) {
      if (!cur) cur = { a: start + c, b: start + c };
      cur.b = start + c;
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  for (let i = 0; i < runs.length - 1; i++) {
    if ((runs[i + 1].a - runs[i].b) * step < 40) {
      runs[i].b = runs[i + 1].b;
      runs.splice(i + 1, 1);
      i--;
    }
  }
  const inMain = (s) => norm(s - zones[0].startS) <= norm(zones[0].endS - zones[0].startS) + 120;
  const others = runs
    .map((r) => ({ startS: norm(r.a * step + 40), endS: norm(r.b * step - 70), len: (r.b - r.a) * step - 110, mid: norm(((r.a + r.b) / 2) * step) }))
    .filter((r) => r.len >= 320 && !inMain(r.mid))
    .sort((a, b) => b.len - a.len || a.startS - b.startS);
  const maxZones = cfg.zones ?? 3;
  return [...zones, ...others]
    .slice(0, maxZones)
    .map((z) => ({ detectionS: r2(norm(z.startS - 150)), startS: r2(z.startS), endS: r2(z.endS) }))
    .sort((a, b) => a.startS - b.startS);
}

function smootherstep(t) {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Distance from point to the nearest non-adjacent centreline point (track s outside [a, b]). */
function clearanceToTrack(track, pts, a, b) {
  let min = Infinity;
  const L = track.length;
  const inWindow = (s) => {
    const x = (((s - a) % L) + L) % L;
    return x <= (((b - a) % L) + L) % L;
  };
  for (let j = 0; j < track.points.length; j++) {
    const s = track.cum[j];
    if (inWindow(s)) continue;
    const q = track.points[j];
    for (const p of pts) {
      const d = hyp(p[0] - q[0], p[1] - q[1]);
      if (d < min) min = d;
    }
  }
  return min;
}

function buildPitLane(track, cfg, corners) {
  const L = track.length;
  const { k } = curvatureArray(track.points, 3);
  const step = L / track.points.length;
  const last = corners[corners.length - 1];
  const first = corners[0];
  const lastExit = last.exit < last.s - L / 2 ? last.exit + L : Math.max(last.exit, last.s);
  const firstEntry = first.entry > first.s + L / 2 ? first.entry - L : Math.min(first.entry, first.s);
  const firstExit = first.exit < first.s - L / 2 ? first.exit + L : Math.max(first.exit, first.s);
  const entryDist = cfg.pitEntryM ?? clamp(L - lastExit + 20, 250, 450);
  const exitDist = cfg.pitExitM ?? (firstEntry - 30 >= 250 ? clamp(firstEntry - 30, 250, 450) : clamp(firstExit + 120, 250, 450));
  const tr = cfg.pitTransitionM ?? 80;
  const preferred = cfg.direction === 'CCW' ? 'left' : 'right';
  const sides = cfg.pitSide ? [cfg.pitSide] : [preferred, preferred === 'left' ? 'right' : 'left'];
  const offsets = cfg.pitOffsetM ? [cfg.pitOffsetM] : [25, 22, 28];
  const need = cfg.widthM + 8;
  // Fallback exit: merge before T1's braking zone (when wrapping a tight T1 is impossible).
  const exitOptions = cfg.pitExitM ? [cfg.pitExitM] : [exitDist, clamp(firstEntry - 40, 140, exitDist)];
  const pathMinRadius = (path) => {
    let m = Infinity;
    for (let i = 1; i < path.length - 1; i++) {
      const [pa, pb, pc] = [path[i - 1], path[i], path[i + 1]];
      const cross = Math.abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]));
      if (cross < 1e-9) continue;
      m = Math.min(m, (hyp(pb[0] - pa[0], pb[1] - pa[1]) * hyp(pc[0] - pb[0], pc[1] - pb[1]) * hyp(pa[0] - pc[0], pa[1] - pc[1])) / (2 * cross));
    }
    return m;
  };
  const entryS = -entryDist;
  const candidates = [];
  let chosen = null;
  for (const exitS of exitOptions) {
    for (const side of sides) {
      for (const off of offsets) {
        const sign = side === 'left' ? 1 : -1;
        const ds = 1;
        const m = Math.round((exitS - entryS) / ds);
        const prof = new Float64Array(m + 1);
        for (let i = 0; i <= m; i++) {
          const s = entryS + i * ds;
          let d = off * Math.min(smootherstep((s - entryS) / tr), smootherstep((exitS - s) / tr));
          // Never offset further than ~0.55 R on the inside of a bend (avoids loops).
          const kk = k[Math.round(track.wrap(s) / step) % track.points.length];
          if (Math.sign(kk) === sign && Math.abs(kk) > 1e-6) d = Math.min(d, 0.55 / Math.abs(kk));
          prof[i] = d;
        }
        // Erode then average: stays below the clipped profile but is smooth.
        const half = 15;
        const ero = new Float64Array(m + 1);
        for (let i = 0; i <= m; i++) {
          let v = Infinity;
          for (let d = -half; d <= half; d++) v = Math.min(v, prof[clamp(i + d, 0, m)]);
          ero[i] = v;
        }
        const sm = new Float64Array(m + 1);
        for (let i = 0; i <= m; i++) {
          let acc = 0;
          for (let d = -half; d <= half; d++) acc += ero[clamp(i + d, 0, m)];
          sm[i] = acc / (2 * half + 1);
        }
        sm[0] = 0;
        sm[m] = 0;
        const raw = [];
        for (let i = 0; i <= m; i++) raw.push(track.pointAt(entryS + i * ds, sign * sm[i]));
        const path = resampleOpen(limitCurvature(resampleOpen(raw, 2), 15, 3000, false), SPACING);
        const clear = clearanceToTrack(track, path, entryS - 60, exitS + 60);
        // Away from the merge transitions the lane must stay off every part of the track,
        // including the adjacent leg of a hairpin it wraps.
        const pitLen = perimeter(path, false);
        const inner = path.filter((_, i) => i * (pitLen / (path.length - 1)) > tr + 15 && i * (pitLen / (path.length - 1)) < pitLen - tr - 15);
        let innerClear = Infinity;
        for (const q of track.points) for (const pp of inner) innerClear = Math.min(innerClear, hyp(pp[0] - q[0], pp[1] - q[1]));
        const cand = { side, off, path, exitS, clear: Math.min(clear, innerClear + 8), minR: pathMinRadius(path) };
        candidates.push(cand);
        if (!chosen && cand.clear >= need && cand.minR >= 13) chosen = cand;
      }
    }
    if (chosen) break;
  }
  if (!chosen) {
    chosen = candidates.slice().sort((x, y) => Math.min(y.clear / need, y.minR / 13) - Math.min(x.clear / need, x.minR / 13))[0];
    warn(cfg.id, `pit lane compromise: clearance ${chosen.clear.toFixed(1)} m, min radius ${chosen.minR.toFixed(1)} m`);
  }
  const exitS = chosen.exitS;
  const pit = new Track(chosen.path, false);
  const lengthM = pit.length;
  // Boxes: 22 × 11 m centred on the projection of the control line, inside the parallel part.
  const c0 = track.pointAt(0, 0);
  let centre = 0;
  {
    let best = Infinity;
    for (let i = 0; i < chosen.path.length; i++) {
      const d = hyp(chosen.path[i][0] - c0[0], chosen.path[i][1] - c0[1]);
      if (d < best) {
        best = d;
        centre = pit.cum[i];
      }
    }
  }
  const lo = tr + 15;
  const hi = lengthM - tr - 15;
  const boxesLen = Math.min(242, hi - lo);
  const boxesStartS = clamp(centre - boxesLen / 2, lo, hi - boxesLen);
  return {
    data: {
      path: chosen.path.map((p) => [r2(p[0]), r2(p[1])]),
      entryS: r2(track.wrap(entryS)),
      exitS: r2(track.wrap(exitS)),
      boxesStartS: r2(boxesStartS),
      boxesEndS: r2(boxesStartS + boxesLen),
      side: chosen.side,
      speedLimitKph: cfg.speedLimitKph ?? 80,
      lengthM: r2(lengthM),
    },
    clear: chosen.clear,
    offset: chosen.off,
  };
}

/** Grandstand rectangle (4 corners) for a spec on a track. */
function standRect(track, g) {
  const p = track.sample(g.s);
  const sign = g.side === 'left' ? 1 : -1;
  const depth = g.rows * 0.9 + 6;
  const tx = Math.cos(p.heading);
  const ty = Math.sin(p.heading);
  const nx = -ty * sign;
  const ny = tx * sign;
  const out = [];
  for (const [u, v] of [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 1],
    [-0.5, 1],
  ]) {
    out.push([p.x + tx * u * g.lengthM + nx * (g.offsetM + v * depth), p.y + ty * u * g.lengthM + ny * (g.offsetM + v * depth)]);
  }
  return out;
}
function pointRectDistance(p, rect) {
  // rect corners in order; inside test via local frame.
  const [a, b, , d] = rect;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = d[0] - a[0];
  const vy = d[1] - a[1];
  const lu = hyp(ux, uy);
  const lv = hyp(vx, vy);
  const px = p[0] - a[0];
  const py = p[1] - a[1];
  const cu = (px * ux + py * uy) / lu;
  const cv = (px * vx + py * vy) / lv;
  const du = cu < 0 ? -cu : cu > lu ? cu - lu : 0;
  const dv = cv < 0 ? -cv : cv > lv ? cv - lv : 0;
  return hyp(du, dv);
}
function rectsOverlap(r1, r2_, margin) {
  for (const p of r1) if (pointRectDistance(p, r2_) < margin) return true;
  for (const p of r2_) if (pointRectDistance(p, r1) < margin) return true;
  // centre test for crossing rectangles
  const c1 = [(r1[0][0] + r1[2][0]) / 2, (r1[0][1] + r1[2][1]) / 2];
  const c2 = [(r2_[0][0] + r2_[2][0]) / 2, (r2_[0][1] + r2_[2][1]) / 2];
  return pointRectDistance(c1, r2_) < margin || pointRectDistance(c2, r1) < margin;
}
function standClear(track, pitPts, widthM, rect, others) {
  for (const q of track.points) if (pointRectDistance(q, rect) < widthM / 2 + 15) return false;
  for (const q of pitPts) if (pointRectDistance(q, rect) < 6 + 15) return false;
  for (const o of others) if (rectsOverlap(rect, o, 8)) return false;
  return true;
}

function buildGrandstands(track, cfg, corners, pit) {
  const stands = [];
  const rects = [];
  const pitPts = pit.path;
  const tryPlace = (base, offsets, lengths, shifts) => {
    for (const len of lengths) {
      for (const sh of shifts) {
        for (const off of offsets) {
          const g = { ...base, s: track.wrap(base.s + sh), lengthM: len, offsetM: off };
          const rect = standRect(track, g);
          if (standClear(track, pitPts, cfg.widthM, rect, rects)) {
            stands.push(g);
            rects.push(rect);
            return true;
          }
        }
      }
    }
    return false;
  };
  const W2 = cfg.widthM / 2;
  // Main grandstand opposite the pits, centred just before the control line.
  const mainSide = pit.side === 'left' ? 'right' : 'left';
  const okMain = tryPlace(
    { s: -20, side: mainSide, rows: 22, name: 'Main Grandstand' },
    [W2 + 18, W2 + 24, W2 + 30, W2 + 36],
    [180, 160, 140, 120, 100, 80],
    [0, -40, 40, -80, 80],
  );
  if (!okMain) warn(cfg.id, 'main grandstand could not be placed');
  // Corner stands: heavy-braking corners (tight, after a long approach) + named corners.
  const L = track.length;
  const scored = corners.map((c, i) => {
    const prev = corners[(i - 1 + corners.length) % corners.length];
    let approach = c.s - prev.s;
    if (approach <= 0) approach += L;
    return { c, score: c.severity * 1.6 + Math.min(approach / 180, 5) + (c.name ? 2 : 0) };
  });
  scored.sort((a, b) => b.score - a.score || a.c.s - b.c.s);
  const maxCorner = cfg.cornerStands ?? 5;
  let placed = 0;
  for (const { c } of scored) {
    if (placed >= maxCorner) break;
    // Skip corners right next to the main stand.
    if (Math.abs(track.delta(0, c.s)) < 160) continue;
    const side = c.direction === 'R' ? 'left' : 'right';
    const rows = 10 + Math.min(8, c.severity * 1.5) | 0;
    const ok = tryPlace(
      { s: c.s - 25, side, rows, name: c.name ? `${c.name}` : `Turn ${c.number}` },
      [W2 + 20, W2 + 26, W2 + 32, W2 + 40],
      [120, 100, 80, 60],
      [0, -30, -60, 25],
    );
    if (ok) placed++;
  }
  return stands.map((g) => ({
    s: r2(g.s),
    side: g.side,
    lengthM: g.lengthM,
    rows: g.rows,
    offsetM: r2(g.offsetM),
    name: g.name,
  }));
}

function placeLandmarks(track, cfg, proj, pitPts, standRects) {
  const out = [];
  for (const lm of cfg.landmarks) {
    let pos;
    let rot = lm.rotation ?? null;
    const at = lm.at;
    if (at.latlon) pos = proj(at.latlon[1], at.latlon[0]);
    else if (at.compass !== undefined) {
      // Backdrop scenery: bearing (deg, 0 = north, clockwise) + distance from the layout centre.
      const cx = (cfg._bbox.minX + cfg._bbox.maxX) / 2;
      const cy = (cfg._bbox.minY + cfg._bbox.maxY) / 2;
      pos = [cx + Math.sin(at.compass * DEG) * at.dist, cy + Math.cos(at.compass * DEG) * at.dist];
    }
    else if (at.centroid) {
      const L = track.length;
      let sx = 0;
      let sy = 0;
      let c = 0;
      for (let s = at.centroid[0] * L; s <= at.centroid[1] * L; s += 4) {
        const p = track.pointAt(s);
        sx += p[0];
        sy += p[1];
        c++;
      }
      pos = [sx / c, sy / c];
    } else if (at.pit !== undefined) {
      const sign = cfg._pitSide === 'left' ? 1 : -1;
      pos = track.pointAt(at.s * track.length, sign * (cfg._pitOffset + at.pit));
      rot = rot ?? track.sample(at.s * track.length).heading;
    } else {
      pos = track.pointAt(at.s * track.length, at.lat);
      rot = rot ?? track.sample(at.s * track.length).heading;
    }
    if (!lm.straddle) {
      const minD = lm.minDistM ?? 60;
      const ok = (p) => {
        for (const q of track.points) if (hyp(p[0] - q[0], p[1] - q[1]) < minD) return false;
        for (const q of pitPts) if (hyp(p[0] - q[0], p[1] - q[1]) < minD) return false;
        for (const r of standRects) if (pointRectDistance(p, r) < 25) return false;
        return true;
      };
      if (!ok(pos)) {
        let found = null;
        for (let rad = 10; rad <= 400 && !found; rad += 10) {
          for (let a = 0; a < 24; a++) {
            const c = [pos[0] + rad * Math.cos((a / 24) * 2 * Math.PI), pos[1] + rad * Math.sin((a / 24) * 2 * Math.PI)];
            if (ok(c)) {
              found = c;
              break;
            }
          }
        }
        if (!found) warn(cfg.id, `landmark ${lm.kind} could not be placed clear of the track`);
        else pos = found;
      }
    }
    if (rot === null) {
      // Face the nearest track point.
      const pr = track.project(pos[0], pos[1]);
      const q = track.pointAt(pr.s);
      rot = Math.atan2(q[1] - pos[1], q[0] - pos[0]);
    }
    out.push({ kind: lm.kind, position: [r2(pos[0]), r2(pos[1])], rotation: Math.round(wrapAngle(rot) * 1000) / 1000, scale: lm.scale ?? 1 });
  }
  return out;
}

/** Douglas–Peucker on a closed loop. */
function simplifyClosed(pts, tol) {
  const n = pts.length;
  const keep = new Uint8Array(n);
  const rec = (i, j) => {
    const a = pts[i];
    const b = pts[j % n];
    let best = -1;
    let bi = -1;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
      const d = hyp(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
      if (d > best) {
        best = d;
        bi = k;
      }
    }
    if (best > tol) {
      keep[bi % n] = 1;
      rec(i, bi);
      rec(bi, j);
    }
  };
  const half = Math.floor(n / 2);
  keep[0] = 1;
  keep[half] = 1;
  rec(0, half);
  rec(half, n);
  return pts.filter((_, i) => keep[i]);
}

function svgPathFor(centerline) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of centerline) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const pad = 6;
  const scale = Math.min((100 - 2 * pad) / (maxX - minX), (100 - 2 * pad) / (maxY - minY));
  const ox = (100 - (maxX - minX) * scale) / 2;
  const oy = (100 - (maxY - minY) * scale) / 2;
  const P = ([x, y]) => [ox + (x - minX) * scale, oy + (maxY - y) * scale];
  const projected = centerline.map(P);
  let tol = 0.015;
  let simp = simplifyClosed(projected, tol);
  while (simp.length > 200) {
    tol *= 1.15;
    simp = simplifyClosed(projected, tol);
  }
  return simp.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + 'Z';
}

const warnings = [];
function warn(id, msg) {
  warnings.push(`${id}: ${msg}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function buildCircuit(feature, cfg) {
  const coords = feature.geometry.coordinates.map((c) => [c[0], c[1]]);
  // Drop the closing duplicate and any repeated vertices.
  const uniq = [];
  for (const c of coords) {
    const prev = uniq[uniq.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) uniq.push(c);
  }
  if (uniq.length > 2 && uniq[0][0] === uniq[uniq.length - 1][0] && uniq[0][1] === uniq[uniq.length - 1][1]) uniq.pop();
  let lon0 = 0;
  let lat0 = 0;
  for (const [lon, lat] of uniq) {
    lon0 += lon;
    lat0 += lat;
  }
  lon0 /= uniq.length;
  lat0 /= uniq.length;
  const kx = R_EARTH * DEG * Math.cos(lat0 * DEG);
  const ky = R_EARTH * DEG;
  const rawProj = (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky];
  let pts = uniq.map(([lon, lat]) => rawProj(lon, lat));

  // Orientation: shoelace > 0 → CCW.
  const area = signedArea(pts);
  let reverse;
  if (cfg.direction) reverse = (area > 0 ? 'CCW' : 'CW') !== cfg.direction;
  else reverse = !!cfg.reverse;
  if (reverse) pts = [pts[0], ...pts.slice(1).reverse()];

  const official = cfg.officialLengthM ?? feature.properties.length;
  // Spline → length-calibrate → light Taubin smoothing → calibrate again.
  let dense = catmullRomClosed(pts, 1);
  let scale = official / perimeter(dense);
  dense = dense.map(([x, y]) => [x * scale, y * scale]);
  let fine = resampleClosed(dense, Math.round(official / 2));
  fine = taubin(fine, cfg.smoothIterations ?? 6);
  fine = limitCurvature(resampleClosed(fine, Math.round(official / 2)), cfg.widthM / 2 + 4);
  const s2 = official / perimeter(fine);
  scale *= s2;
  fine = fine.map(([x, y]) => [x * s2, y * s2]);

  // Final uniform resample starting on the control line.
  const n = Math.round(official / SPACING);
  let centerline = resampleClosed(fine, n, cfg.startS ?? 0);
  const s3 = official / perimeter(centerline);
  scale *= s3;
  centerline = centerline.map(([x, y]) => [r2(x * s3), r2(y * s3)]);
  const L = perimeter(centerline);
  const track = new Track(centerline, true);
  const finalArea = signedArea(centerline);
  const direction = finalArea > 0 ? 'CCW' : 'CW';
  if (cfg.direction && direction !== cfg.direction) warn(cfg.id, `direction ${direction} ≠ expected ${cfg.direction}`);
  cfg.direction = direction;
  const proj = (lon, lat) => {
    const [x, y] = rawProj(lon, lat);
    return [x * scale, y * scale];
  };

  cfg._bbox = centerline.reduce(
    (b, [x, y]) => ({ minX: Math.min(b.minX, x), maxX: Math.max(b.maxX, x), minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  const corners = detectCorners(centerline, cfg);
  for (const nm of cfg.cornerNames ?? []) {
    let best = null;
    for (const c of corners) {
      const d = Math.abs(track.delta(nm.s, c.s));
      if ((!nm.dir || nm.dir === c.direction) && d < 120 && (!best || d < best.d)) best = { c, d };
    }
    if (best) best.c.name = nm.name;
    else warn(cfg.id, `corner name ${nm.name} not matched`);
  }
  if (corners[0]?.direction !== cfg.t1) warn(cfg.id, `first corner is ${corners[0]?.direction}, expected ${cfg.t1}`);

  const sectors = pickSectors(centerline, cfg, L);
  const straightZones = pickStraightZones(centerline, cfg, L, corners);
  const pit = buildPitLane(track, cfg, corners);
  cfg._pitSide = pit.data.side;
  cfg._pitOffset = pit.offset;
  const grandstands = buildGrandstands(track, cfg, corners, pit.data);
  const standRects = grandstands.map((g) => standRect(track, g));
  const landmarks = placeLandmarks(track, cfg, proj, pit.data.path, standRects);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const grow = (x, y, m = 0) => {
    minX = Math.min(minX, x - m);
    maxX = Math.max(maxX, x + m);
    minY = Math.min(minY, y - m);
    maxY = Math.max(maxY, y + m);
  };
  for (const [x, y] of centerline) grow(x, y, cfg.widthM / 2);
  for (const [x, y] of pit.data.path) grow(x, y, 6);
  for (const r of standRects) for (const [x, y] of r) grow(x, y);
  // Backdrop mountains sit beyond the playable area on purpose.
  for (const l of landmarks) if (l.kind !== 'mountains') grow(l.position[0], l.position[1]);

  const data = {
    id: cfg.id,
    layoutVersion: `${cfg.id}@2026.1`,
    name: cfg.name,
    shortName: cfg.shortName,
    location: cfg.location,
    country: cfg.country,
    countryCode: cfg.countryCode,
    timezone: cfg.timezone,
    lengthM: official,
    centerlineLengthM: r2(L),
    laps: cfg.laps,
    ...(cfg.sprint ? { sprintLaps: Math.ceil(100000 / official) } : {}),
    direction,
    widthM: cfg.widthM,
    spacingM: Math.round((L / n) * 10000) / 10000,
    sectors,
    corners,
    straightZones,
    pitLane: pit.data,
    grandstands,
    bounds: { minX: r2(minX), maxX: r2(maxX), minY: r2(minY), maxY: r2(maxY) },
    theme: cfg.theme,
    timeOfDay: cfg.timeOfDay,
    landmarks,
    hasWater: cfg.hasWater,
    lapRecordMs: cfg.lapRecordMs,
    centerline,
  };
  const meta = {
    id: cfg.id,
    name: cfg.name,
    shortName: cfg.shortName,
    location: cfg.location,
    country: cfg.country,
    countryCode: cfg.countryCode,
    lengthM: official,
    laps: cfg.laps,
    direction,
    theme: cfg.theme,
    timeOfDay: cfg.timeOfDay,
    svgPath: svgPathFor(centerline),
  };
  const diag = {
    id: cfg.id,
    area: area > 0 ? 'CCW' : 'CW',
    reversed: reverse,
    dir: direction,
    corners: corners.length,
    real: cfg.realTurns,
    t1: `${corners[0]?.direction}@${Math.round(corners[0]?.s)} last@-${Math.round(L - corners[corners.length - 1].s)}`,
    pit: `${pit.data.side} ${pit.offset}m clr ${pit.clear.toFixed(0)}`,
    stands: grandstands.length,
    zones: straightZones.length,
  };
  return { data, meta, diag };
}

function main() {
  const geo = JSON.parse(readFileSync(SRC, 'utf8'));
  mkdirSync(OUT, { recursive: true });
  // `node scripts/build-circuits.mjs <id…>` rebuilds a subset and keeps the rest.
  const only = process.argv.slice(2);
  if (!only.length) for (const f of readdirSync(OUT)) if (f.endsWith('.json')) unlinkSync(path.join(OUT, f));
  const metaPath = path.join(OUT, 'meta.json');
  const previous = only.length ? JSON.parse(readFileSync(metaPath, 'utf8')) : [];
  const metas = [];
  for (const cfg0 of CIRCUITS) {
    if (only.length && !only.includes(cfg0.id)) continue;
    const cfg = structuredClone(cfg0);
    const feature = geo.features.find((f) => f.properties.id === cfg.id);
    if (!feature) throw new Error(`GeoJSON feature ${cfg.id} missing`);
    const { data, meta, diag } = buildCircuit(feature, cfg);
    writeFileSync(path.join(OUT, `${cfg.id}.json`), JSON.stringify(data) + '\n');
    metas.push(meta);
    console.log(Object.values(diag).join('\t'));
  }
  const merged = CIRCUITS.map((c) => metas.find((m) => m.id === c.id) ?? previous.find((m) => m.id === c.id)).filter(Boolean);
  writeFileSync(metaPath, JSON.stringify(merged, null, 1) + '\n');
  if (warnings.length) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  ⚠ ${w}`);
  }
}

export { Track, standRect, pointRectDistance, CIRCUITS };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
