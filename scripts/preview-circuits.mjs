#!/usr/bin/env node
/**
 * Renders every generated circuit to SVG + HTML contact sheets for visual QA:
 *   node scripts/preview-circuits.mjs [--out /tmp] [--size 640] [--ticks] [ids...]
 * Then e.g.: google-chrome --headless=new --no-sandbox --screenshot=/tmp/circuits-1.png \
 *   --window-size=1920,1290 file:///tmp/circuits-sheet-1.html
 * Legend: grey = track, lime/cyan/purple = sectors 1/2/3, yellow = pit lane (orange = boxes),
 * red bar + white arrow = control line + race direction, numbered dots = corners
 * (orange R / cyan L), blue boxes = grandstands, white dashes = straight zones, pink = landmarks.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Track, standRect } from './build-circuits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'src/data/circuits/generated');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const outDir = opt('--out', '/tmp');
const size = Number(opt('--size', '640'));
const fine = flag('--fine');
const ticks = flag('--ticks') || fine;
const perPage = Number(opt('--per-page', '6'));
const cols = Number(opt('--cols', '3'));
const ids = args;

const meta = JSON.parse(readFileSync(path.join(GEN, 'meta.json'), 'utf8'));
const files = meta.map((m) => m.id).filter((id) => !ids.length || ids.includes(id));

function render(c) {
  const track = new Track(c.centerline, true);
  const pit = new Track(c.pitLane.path, false);
  const b = c.bounds;
  const pad = 26;
  const top = 40;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const sc = Math.min((size - 2 * pad) / w, (size - top - pad) / h);
  const ox = (size - w * sc) / 2;
  const oy = top + (size - top - pad - h * sc) / 2;
  const P = (x, y) => [ox + (x - b.minX) * sc, oy + (b.maxY - y) * sc];
  const f = (v) => v.toFixed(1);
  const poly = (pts) => pts.map(([x, y]) => P(x, y)).map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
  const along = (t, a, bb, lat = 0, step = 4) => {
    const out = [];
    let e = bb;
    if (e < a) e += t.length;
    for (let s = a; s <= e; s += step) out.push(t.pointAt(s, lat));
    out.push(t.pointAt(e, lat));
    return out;
  };
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" font-family="sans-serif">`);
  o.push(`<rect width="${size}" height="${size}" fill="#0d1117"/>`);
  o.push(`<polygon points="${poly(c.centerline)}" fill="none" stroke="#5b616b" stroke-width="${Math.max(4, c.widthM * sc)}" stroke-linejoin="round"/>`);
  const colors = ['#b6ff3b', '#22d3ee', '#a855f7'];
  for (const sct of c.sectors) {
    o.push(`<polyline points="${poly(along(track, sct.startS, sct.endS - 0.01))}" fill="none" stroke="${colors[sct.index - 1]}" stroke-width="2"/>`);
  }
  for (const z of c.straightZones) {
    o.push(`<polyline points="${poly(along(track, z.startS, z.endS, c.widthM * 1.6))}" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    const d = P(...track.pointAt(z.detectionS, c.widthM * 1.6));
    o.push(`<circle cx="${f(d[0])}" cy="${f(d[1])}" r="2.5" fill="#fff"/>`);
  }
  o.push(`<polyline points="${poly(c.pitLane.path)}" fill="none" stroke="#facc15" stroke-width="2"/>`);
  o.push(`<polyline points="${poly(along(pit, c.pitLane.boxesStartS, c.pitLane.boxesEndS))}" fill="none" stroke="#fb923c" stroke-width="4"/>`);
  for (const g of c.grandstands) {
    o.push(`<polygon points="${poly(standRect(track, g))}" fill="#3b82f6" fill-opacity="0.75" stroke="#93c5fd" stroke-width="1"/>`);
  }
  if (ticks) {
    const tStep = fine ? 100 : 250;
    const lStep = fine ? 200 : 500;
    for (let s = tStep; s < c.centerlineLengthM; s += tStep) {
      const a = P(...track.pointAt(s, c.widthM));
      const bb = P(...track.pointAt(s, -c.widthM));
      o.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(bb[0])}" y2="${f(bb[1])}" stroke="#e5e7eb" stroke-width="1"/>`);
      if (s % lStep === 0) {
        const t = P(...track.pointAt(s, -c.widthM * 3.2));
        o.push(`<text x="${f(t[0])}" y="${f(t[1])}" fill="#fde68a" font-size="10" text-anchor="middle" dominant-baseline="middle">${s}</text>`);
      }
    }
  }
  // Control line + direction arrow.
  const a = P(...track.pointAt(0, c.widthM * 1.8));
  const bb = P(...track.pointAt(0, -c.widthM * 1.8));
  o.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(bb[0])}" y2="${f(bb[1])}" stroke="#ef4444" stroke-width="4"/>`);
  const arrowLen = Math.min(220, c.centerlineLengthM * 0.04);
  const arr = along(track, 0, arrowLen, 0, 4);
  o.push(`<polyline points="${poly(arr)}" fill="none" stroke="#fff" stroke-width="3"/>`);
  const tip = track.sample(arrowLen);
  const T = P(tip.x, tip.y);
  const ang = -tip.heading;
  const ah = 9;
  const pA = [T[0] - ah * Math.cos(ang - 0.5), T[1] - ah * Math.sin(ang - 0.5)];
  const pB = [T[0] - ah * Math.cos(ang + 0.5), T[1] - ah * Math.sin(ang + 0.5)];
  o.push(`<polygon points="${f(T[0])},${f(T[1])} ${f(pA[0])},${f(pA[1])} ${f(pB[0])},${f(pB[1])}" fill="#fff"/>`);
  for (const k of c.corners) {
    const lat = (k.direction === 'R' ? 1 : -1) * Math.max(24, 13 / sc);
    const q = P(...track.pointAt(k.s, lat));
    const col = k.direction === 'R' ? '#fb923c' : '#22d3ee';
    o.push(`<circle cx="${f(q[0])}" cy="${f(q[1])}" r="7" fill="#111" stroke="${col}" stroke-width="1.2"/>`);
    o.push(`<text x="${f(q[0])}" y="${f(q[1]) }" fill="${col}" font-size="8.5" text-anchor="middle" dominant-baseline="central">${k.number}</text>`);
    if (k.name) o.push(`<text x="${f(q[0] + 9)}" y="${f(q[1])}" fill="#e5e7eb" font-size="8">${k.name}</text>`);
  }
  for (const l of c.landmarks) {
    const q = P(...l.position);
    o.push(`<circle cx="${f(q[0])}" cy="${f(q[1])}" r="5" fill="#f472b6"/>`);
    o.push(`<text x="${f(q[0] + 7)}" y="${f(q[1] + 3)}" fill="#f9a8d4" font-size="10">${l.kind}</text>`);
  }
  const zoneTxt = c.straightZones.length;
  o.push(`<text x="10" y="18" fill="#fff" font-size="15" font-weight="bold">${c.id} · ${c.shortName} · ${c.direction} · ${(c.lengthM / 1000).toFixed(3)} km</text>`);
  o.push(`<text x="10" y="34" fill="#9ca3af" font-size="11">${c.corners.length} corners · T1 ${c.corners[0]?.direction} · pit ${c.pitLane.side} ${c.pitLane.lengthM.toFixed(0)} m (${c.pitLane.entryS.toFixed(0)}→${c.pitLane.exitS.toFixed(0)}) · ${c.grandstands.length} stands · ${zoneTxt} zones · ${c.timeOfDay}</text>`);
  // 100 m scale bar
  o.push(`<line x1="${size - 20 - 100 * sc}" y1="${size - 12}" x2="${size - 20}" y2="${size - 12}" stroke="#fff" stroke-width="2"/><text x="${size - 20}" y="${size - 16}" fill="#fff" font-size="9" text-anchor="end">100 m</text>`);
  o.push('</svg>');
  return o.join('');
}

const svgs = files.map((id) => {
  const c = JSON.parse(readFileSync(path.join(GEN, `${id}.json`), 'utf8'));
  const svg = render(c);
  writeFileSync(path.join(outDir, `circuit-${id}.svg`), svg);
  return svg;
});
const page = (list) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${size}px);gap:0}</style></head><body>${list.join('')}</body></html>`;
writeFileSync(path.join(outDir, 'circuits-sheet.html'), page(svgs));
let pages = 0;
for (let i = 0; i < svgs.length; i += perPage) {
  pages++;
  writeFileSync(path.join(outDir, `circuits-sheet-${pages}.html`), page(svgs.slice(i, i + perPage)));
}
console.log(`wrote ${svgs.length} SVGs, circuits-sheet.html + ${pages} page(s) to ${outDir} (cell ${size}px, ${cols} cols)`);
