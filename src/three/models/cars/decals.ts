/**
 * CanvasTexture generation for the car models: per-driver decal atlas
 * (numbers, code, helmet, livery swatches), tyre compound textures, wheel
 * roughness/metalness + brake-glow strips, emissive masks and the blob shadow.
 *
 * Atlas convention (UV space, v up): a 16×8 cell grid; swatch faces map all
 * their UVs to one cell centre so they sample a flat colour at mip 0.
 */
import * as THREE from 'three';
import type { TeamLivery } from '@/data/teams';
import type { TyreLetter } from '../types';

export type UVRect = readonly [number, number, number, number];

export const GRID_COLS = 16;
export const GRID_ROWS = 8;

export function cellUV(col: number, row: number): [number, number] {
  return [(col + 0.5) / GRID_COLS, (row + 0.5) / GRID_ROWS];
}

export function cellRect(col: number, row: number): UVRect {
  return [col / GRID_COLS, row / GRID_ROWS, (col + 1) / GRID_COLS, (row + 1) / GRID_ROWS];
}

/* ------------------------------------------------------------------------ */
/* Canvas helpers                                                           */
/* ------------------------------------------------------------------------ */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type CanvasTex = THREE.CanvasTexture<AnyCanvas>;

export function createCanvas(w: number, h: number): { canvas: AnyCanvas; ctx: Ctx2D } {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { canvas: c, ctx: c.getContext('2d')! };
  }
  const c = new OffscreenCanvas(w, h);
  return { canvas: c, ctx: c.getContext('2d')! };
}

type Px = [number, number, number, number];

function rectPx(r: UVRect, W: number, H: number): Px {
  return [r[0] * W, (1 - r[3]) * H, (r[2] - r[0]) * W, (r[3] - r[1]) * H];
}

export const FONT_STACK = '"Arial Black", "Helvetica Neue", Helvetica, Arial, "DejaVu Sans", "Liberation Sans", sans-serif';

interface TextStyle {
  fill: string;
  weight?: string;
  stroke?: string;
  /** Stroke width as a fraction of the font size. */
  strokeFrac?: number;
  /** Horizontal shear (italic look), e.g. −0.18. */
  skew?: number;
  /** Max glyph height as a fraction of the rect height. */
  heightFrac?: number;
  widthFrac?: number;
  /** Horizontal squash/stretch applied after fitting. */
  stretch?: number;
}

export function drawFitted(ctx: Ctx2D, text: string, r: Px, st: TextStyle): void {
  const [x, y, w, h] = r;
  const weight = st.weight ?? '900';
  let size = h * (st.heightFrac ?? 0.82);
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  const stretch = st.stretch ?? 1;
  const measured = ctx.measureText(text).width * stretch;
  const maxW = w * (st.widthFrac ?? 0.9);
  if (measured > maxW) size *= maxW / measured;
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(x + w / 2, y + h / 2 + size * 0.04);
  ctx.transform(stretch, 0, st.skew ?? 0, 1, 0, 0);
  if (st.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * (st.strokeFrac ?? 0.08);
    ctx.strokeStyle = st.stroke;
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = st.fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  // Colour is linear after parsing; perceived brightness is fine for contrast picks.
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function contrastOn(hex: string): string {
  return luminance(hex) > 0.28 ? '#0B0B0D' : '#FFFFFF';
}

function canvasTexture(canvas: AnyCanvas, srgb = true): CanvasTex {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------------ */
/* F1 decal atlas                                                           */
/* ------------------------------------------------------------------------ */

export const F1_ATLAS = {
  helmet: [0, 0, 1, 0.25] as UVRect,
  sponsor: [0, 0.25, 1, 0.375] as UVRect,
  code: [0, 0.375, 0.5, 0.5] as UVRect,
  number: [0, 0.5, 0.5, 1] as UVRect,
  number2: [0.5, 0.5, 1, 1] as UVRect,
};

export const F1_SWATCH_ROW = 3;
export const F1_SWATCH = {
  secondary: 8,
  accent: 9,
  light: 10,
  tcam: 11,
  white: 12,
  black: 13,
  primary: 14,
  wing: 15,
} as const;
export type F1Swatch = keyof typeof F1_SWATCH;

/** Helmet sphere is cut at this fraction of π (the rest sits inside the cockpit). */
export const HELMET_THETA = 0.62;

export interface F1AtlasOptions {
  livery: TeamLivery;
  number: number;
  code: string;
  tcam: 'black' | 'yellow';
  size: readonly [number, number];
  helmetColor?: string;
}

export function createF1AtlasTexture(o: F1AtlasOptions): CanvasTex {
  const [W, H] = o.size;
  const { canvas, ctx } = createCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const L = o.livery;

  const sw = (col: number, color: string) => {
    const [x, y, w, h] = rectPx(cellRect(col, F1_SWATCH_ROW), W, H);
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
  };
  sw(F1_SWATCH.secondary, L.secondary);
  sw(F1_SWATCH.accent, L.accent);
  sw(F1_SWATCH.light, '#4A0508');
  sw(F1_SWATCH.tcam, o.tcam === 'yellow' ? '#FFE21A' : '#111214');
  sw(F1_SWATCH.white, '#F4F5F7');
  sw(F1_SWATCH.black, '#0B0B0D');
  sw(F1_SWATCH.primary, L.primary);
  sw(F1_SWATCH.wing, L.wing);

  const num = String(o.number);
  drawFitted(ctx, num, rectPx(F1_ATLAS.number, W, H), {
    fill: L.accent,
    stroke: contrastOn(L.accent),
    strokeFrac: 0.09,
    skew: -0.16,
    heightFrac: 0.84,
    widthFrac: 0.8,
  });
  const onBody = contrastOn(L.primary);
  drawFitted(ctx, num, rectPx(F1_ATLAS.number2, W, H), {
    fill: onBody,
    stroke: L.accent,
    strokeFrac: 0.07,
    skew: -0.16,
    heightFrac: 0.8,
    widthFrac: 0.7,
  });
  drawFitted(ctx, o.code.toUpperCase(), rectPx(F1_ATLAS.code, W, H), {
    fill: onBody,
    heightFrac: 0.74,
    widthFrac: 0.86,
    skew: -0.1,
  });
  // Sponsor band sits on the (accent-painted) rear wing endplates.
  const sp = rectPx(F1_ATLAS.sponsor, W, H);
  drawFitted(ctx, 'PULSE ARENA', sp, { fill: contrastOn(L.accent), heightFrac: 0.7, widthFrac: 0.9, skew: -0.12 });

  drawHelmet(ctx, rectPx(F1_ATLAS.helmet, W, H), o);
  return finishAtlas(canvas);
}

function finishAtlas(canvas: AnyCanvas): CanvasTex {
  const t = canvasTexture(canvas);
  t.anisotropy = 4;
  return t;
}

function helmetBase(o: F1AtlasOptions): string {
  if (o.helmetColor) return o.helmetColor;
  const palette = ['#F5F6F8', '#FFD100', o.livery.accent, '#FF5A1F', '#1E7BFF', '#111214', o.livery.primary];
  return palette[(o.number * 7 + o.code.charCodeAt(0)) % palette.length];
}

function drawHelmet(ctx: Ctx2D, r: Px, o: F1AtlasOptions): void {
  const [x0, y0, w, h] = r;
  const hx = (u: number) => x0 + u * w;
  const hy = (v: number) => y0 + (1 - v) * h;
  const base = helmetBase(o);
  const stripe = base.toLowerCase() === o.livery.accent.toLowerCase() ? o.livery.primary : o.livery.accent;
  ctx.fillStyle = base;
  ctx.fillRect(x0, y0, w, h);
  // Crown
  ctx.fillStyle = shade(base, -0.25);
  ctx.fillRect(x0, hy(1), w, hy(0.86) - hy(1));
  // Accent band + white pinline just above the visor.
  ctx.fillStyle = stripe;
  ctx.fillRect(x0, hy(0.52), w, hy(0.41) - hy(0.52));
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x0, hy(0.545), w, hy(0.52) - hy(0.545));
  // Side flash
  ctx.fillStyle = stripe;
  for (const uc of [0.0, 0.5, 1.0]) {
    ctx.beginPath();
    ctx.moveTo(hx(uc - 0.12), hy(0.41));
    ctx.lineTo(hx(uc + 0.12), hy(0.41));
    ctx.lineTo(hx(uc + 0.04), hy(0.2));
    ctx.lineTo(hx(uc - 0.04), hy(0.2));
    ctx.closePath();
    ctx.fill();
  }
  // Visor (faces +Z → sphere u = 0.25).
  const vx0 = hx(0.1);
  const vx1 = hx(0.4);
  const vy0 = hy(0.37);
  const vy1 = hy(0.15);
  const g = ctx.createLinearGradient(0, vy0, 0, vy1);
  g.addColorStop(0, '#1C2E52');
  g.addColorStop(0.45, '#07090D');
  g.addColorStop(1, '#151A22');
  ctx.fillStyle = g;
  roundRect(ctx, vx0, vy0, vx1 - vx0, vy1 - vy0, (vy1 - vy0) * 0.35);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,200,255,0.35)';
  ctx.fillRect(vx0 + (vx1 - vx0) * 0.08, vy0 + (vy1 - vy0) * 0.12, (vx1 - vx0) * 0.84, Math.max(1, (vy1 - vy0) * 0.08));
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amt * (amt < 0 ? hsl.l : 1 - hsl.l), 0, 1));
  return `#${c.getHexString()}`;
}

/** Shared emissive mask for F1 atlases: only the rain-light swatch glows. */
let f1Mask: THREE.DataTexture | null = null;
export function f1EmissiveMask(): THREE.DataTexture {
  if (f1Mask) return f1Mask;
  const data = new Uint8Array(GRID_COLS * GRID_ROWS * 4);
  const i = (F1_SWATCH_ROW * GRID_COLS + F1_SWATCH.light) * 4;
  data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
  f1Mask = maskTexture(data);
  return f1Mask;
}

export function maskTexture(data: Uint8Array): THREE.DataTexture {
  const t = new THREE.DataTexture(data, GRID_COLS, GRID_ROWS, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------------ */
/* Wheels                                                                   */
/* ------------------------------------------------------------------------ */

export const TYRE_COLORS: Record<TyreLetter, string> = {
  S: '#E8002D',
  M: '#FFD12E',
  H: '#F0F0EC',
  I: '#43B02A',
  W: '#0067AD',
};

/** V bands along the wheel profile (shared by geometry and textures). */
export const WHEEL_V = {
  innerHub: [0, 0.06],
  innerSide: [0.06, 0.14],
  tread: [0.14, 0.32],
  outerSide: [0.32, 0.7],
  ring: [0.42, 0.49],
  lip: [0.7, 0.74],
  gap: [0.74, 0.78],
  cover: [0.78, 0.96],
  hub: [0.96, 1],
} as const;

type Band = readonly [number, number];

function bandFill(ctx: Ctx2D, W: number, H: number, b: Band, color: string): void {
  const y0 = (1 - b[1]) * H;
  const y1 = (1 - b[0]) * H;
  ctx.fillStyle = color;
  ctx.fillRect(0, Math.floor(y0), W, Math.ceil(y1 - y0));
}

const tyreCache = new Map<string, CanvasTex>();

export function tyreTexture(letter: TyreLetter, size: readonly [number, number]): CanvasTex {
  const key = `${letter}|${size[0]}`;
  const hit = tyreCache.get(key);
  if (hit) return hit;
  const [W, H] = size;
  const { canvas, ctx } = createCanvas(W, H);
  const col = TYRE_COLORS[letter];
  const vy = (v: number) => (1 - v) * H;
  ctx.fillStyle = '#1B1B1D';
  ctx.fillRect(0, 0, W, H);
  bandFill(ctx, W, H, WHEEL_V.innerHub, '#24262A');
  bandFill(ctx, W, H, WHEEL_V.innerSide, '#1D1D20');
  bandFill(ctx, W, H, [0.088, 0.106], col);
  bandFill(ctx, W, H, WHEEL_V.tread, '#151517');
  if (letter === 'I' || letter === 'W') {
    ctx.strokeStyle = '#08080A';
    ctx.lineWidth = Math.max(1, H * (letter === 'W' ? 0.012 : 0.008));
    const n = letter === 'W' ? 36 : 28;
    for (let k = 0; k < n; k++) {
      const x = (k / n) * W;
      const dx = W / n;
      ctx.beginPath();
      ctx.moveTo(x, vy(0.15));
      ctx.lineTo(x + dx * 0.5, vy(0.23));
      ctx.lineTo(x, vy(0.31));
      ctx.stroke();
    }
    if (letter === 'W') {
      bandFill(ctx, W, H, [0.195, 0.205], '#08080A');
      bandFill(ctx, W, H, [0.255, 0.265], '#08080A');
    }
  }
  // Outer sidewall: subtle radial shading, compound ring broken by two logos.
  const g = ctx.createLinearGradient(0, vy(WHEEL_V.outerSide[1]), 0, vy(WHEEL_V.outerSide[0]));
  g.addColorStop(0, '#18181A');
  g.addColorStop(0.5, '#222225');
  g.addColorStop(1, '#19191B');
  ctx.fillStyle = g;
  ctx.fillRect(0, vy(WHEEL_V.outerSide[1]), W, vy(WHEEL_V.outerSide[0]) - vy(WHEEL_V.outerSide[1]));
  const ringY0 = vy(WHEEL_V.ring[1]);
  const ringH = vy(WHEEL_V.ring[0]) - ringY0;
  ctx.fillStyle = col;
  const gaps: Array<[number, number]> = [
    [0.02, 0.17],
    [0.52, 0.67],
  ];
  let u = 0;
  for (const [a, b] of gaps) {
    ctx.fillRect(u * W, ringY0, (a - u) * W, ringH);
    u = b;
  }
  ctx.fillRect(u * W, ringY0, (1 - u) * W, ringH);
  for (const [a, b] of gaps) {
    drawFitted(ctx, 'PULSE', [a * W, ringY0 - ringH * 0.3, (b - a) * W, ringH * 1.6], {
      fill: col,
      heightFrac: 0.8,
      widthFrac: 0.92,
    });
  }
  bandFill(ctx, W, H, [0.6, 0.612], '#2A2A2E');
  bandFill(ctx, W, H, WHEEL_V.lip, '#3A3D43');
  bandFill(ctx, W, H, WHEEL_V.gap, '#0B0B0C');
  bandFill(ctx, W, H, WHEEL_V.cover, '#26282D');
  // Wheel-cover graphic: five lighter blades so rotation reads at speed.
  ctx.fillStyle = '#3E4249';
  for (let k = 0; k < 5; k++) {
    const x = (k / 5) * W;
    ctx.beginPath();
    ctx.moveTo(x, vy(0.955));
    ctx.lineTo(x + W * 0.05, vy(0.955));
    ctx.lineTo(x + W * 0.11, vy(0.79));
    ctx.lineTo(x + W * 0.03, vy(0.79));
    ctx.closePath();
    ctx.fill();
  }
  bandFill(ctx, W, H, [0.785, 0.8], '#4A4E56');
  bandFill(ctx, W, H, WHEEL_V.hub, '#B8BCC2');
  const t = canvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  tyreCache.set(key, t);
  return t;
}

function stripTexture(bands: Array<[Band, string]>, srgb: boolean): CanvasTex {
  const W = 4;
  const H = 256;
  const { canvas, ctx } = createCanvas(W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  for (const [b, c] of bands) bandFill(ctx, W, H, b, c);
  return canvasTexture(canvas, srgb);
}

function orm(rough: number, metal: number): string {
  return `rgb(255, ${Math.round(rough * 255)}, ${Math.round(metal * 255)})`;
}

let ormTex: CanvasTex | null = null;
/** Roughness (G) / metalness (B) by wheel band. */
export function wheelOrmTexture(): CanvasTex {
  ormTex ??= stripTexture(
    [
      [[0, 1], orm(0.88, 0)],
      [WHEEL_V.innerHub, orm(0.5, 0.6)],
      [WHEEL_V.lip, orm(0.3, 0.9)],
      [WHEEL_V.gap, orm(0.7, 0.2)],
      [WHEEL_V.cover, orm(0.36, 0.6)],
      [WHEEL_V.hub, orm(0.22, 1)],
    ],
    false,
  );
  return ormTex;
}

let glowTex: CanvasTex | null = null;
/** Brake glow: the rim gap and inner disc light up under braking. */
export function brakeGlowTexture(): CanvasTex {
  glowTex ??= stripTexture(
    [
      [[0.03, 0.052], '#B0B0B0'],
      [WHEEL_V.lip, '#3A3A3A'],
      [WHEEL_V.gap, '#FFFFFF'],
      [[0.78, 0.8], '#555555'],
    ],
    true,
  );
  return glowTex;
}

/* ------------------------------------------------------------------------ */
/* Blob shadow                                                              */
/* ------------------------------------------------------------------------ */

let shadowTex: CanvasTex | null = null;
export function shadowTexture(): CanvasTex {
  if (shadowTex) return shadowTex;
  const W = 128;
  const H = 256;
  const { canvas, ctx } = createCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, H / W);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, W / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-W / 2, -W / 2, W, W);
  ctx.restore();
  shadowTex = canvasTexture(canvas, false);
  return shadowTex;
}

/* ------------------------------------------------------------------------ */
/* Road cars (Safety / Medical)                                             */
/* ------------------------------------------------------------------------ */

export const ROAD_ATLAS = {
  textSide: [0, 0.75, 1, 1] as UVRect,
  textRear: [0, 0.5, 1, 0.75] as UVRect,
  pattern: [0, 0.25, 1, 0.375] as UVRect,
  grille: [0, 0, 0.5, 0.25] as UVRect,
  intake: [0.5, 0, 1, 0.25] as UVRect,
};

export const ROAD_CELL_ROW = 3;
export const ROAD_CELL = {
  head: 0,
  tail: 1,
  amberL: 2,
  amberR: 3,
  green: 4,
  accentA: 5,
  accentB: 6,
  dark: 7,
  white: 8,
  lens: 9,
  chrome: 10,
  paint: 11,
} as const;
export type RoadCell = keyof typeof ROAD_CELL;

export interface RoadAtlasOptions {
  key: string;
  text: string;
  textColor: string;
  textStroke: string;
  paint: string;
  accentA: string;
  accentB: string;
  grille: 'slats' | 'mesh';
  pattern: 'chequer' | 'stripe';
  size: readonly [number, number];
}

const roadAtlasCache = new Map<string, CanvasTex>();

export function roadAtlasTexture(o: RoadAtlasOptions): CanvasTex {
  const key = `${o.key}|${o.size[0]}`;
  const hit = roadAtlasCache.get(key);
  if (hit) return hit;
  const [W, H] = o.size;
  const { canvas, ctx } = createCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const cell = (c: number, color: string) => {
    const [x, y, w, h] = rectPx(cellRect(c, ROAD_CELL_ROW), W, H);
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
  };
  cell(ROAD_CELL.head, '#DDE5EE');
  cell(ROAD_CELL.tail, '#3A0406');
  cell(ROAD_CELL.amberL, '#6B3A00');
  cell(ROAD_CELL.amberR, '#6B3A00');
  cell(ROAD_CELL.green, '#0B4A22');
  cell(ROAD_CELL.accentA, o.accentA);
  cell(ROAD_CELL.accentB, o.accentB);
  cell(ROAD_CELL.dark, '#0D0E11');
  cell(ROAD_CELL.white, '#F4F5F7');
  cell(ROAD_CELL.lens, '#C9861C');
  cell(ROAD_CELL.chrome, '#C9CDD2');
  cell(ROAD_CELL.paint, o.paint);

  const style = { fill: o.textColor, stroke: o.textStroke, strokeFrac: 0.08, skew: -0.18, heightFrac: 0.72, widthFrac: 0.94 };
  drawFitted(ctx, o.text, rectPx(ROAD_ATLAS.textSide, W, H), style);
  drawFitted(ctx, o.text, rectPx(ROAD_ATLAS.textRear, W, H), { ...style, heightFrac: 0.66 });

  const [px0, py0, pw, ph] = rectPx(ROAD_ATLAS.pattern, W, H);
  if (o.pattern === 'chequer') {
    const n = 32;
    const s = pw / n;
    for (let r = 0; r < 2; r++) {
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = (k + r) % 2 === 0 ? o.accentA : o.accentB;
        ctx.fillRect(px0 + k * s, py0 + (r * ph) / 2, Math.ceil(s), Math.ceil(ph / 2));
      }
    }
  } else {
    ctx.fillStyle = o.accentA;
    ctx.fillRect(px0, py0, pw, ph * 0.62);
    ctx.fillStyle = o.accentB;
    ctx.fillRect(px0, py0 + ph * 0.72, pw, ph * 0.28);
  }

  const [gx, gy, gw, gh] = rectPx(ROAD_ATLAS.grille, W, H);
  ctx.fillStyle = '#07080A';
  ctx.fillRect(gx, gy, gw, gh);
  if (o.grille === 'slats') {
    ctx.fillStyle = '#AEB3BA';
    const n = 15;
    for (let k = 0; k < n; k++) ctx.fillRect(gx + ((k + 0.5) / n) * gw - gw * 0.009, gy + gh * 0.06, gw * 0.018, gh * 0.88);
  } else {
    ctx.strokeStyle = '#3A3F46';
    ctx.lineWidth = Math.max(1, gh * 0.03);
    for (let k = 1; k < 10; k++) {
      ctx.beginPath();
      ctx.moveTo(gx, gy + (k / 10) * gh);
      ctx.lineTo(gx + gw, gy + (k / 10) * gh);
      ctx.stroke();
    }
    ctx.strokeStyle = '#8D939B';
    ctx.lineWidth = Math.max(1, gh * 0.05);
    ctx.strokeRect(gx + 2, gy + 2, gw - 4, gh - 4);
  }
  const [ix, iy, iw, ih] = rectPx(ROAD_ATLAS.intake, W, H);
  ctx.fillStyle = '#0A0B0D';
  ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = '#1C1F24';
  const hs = Math.max(4, ih / 6);
  for (let yy = 0; yy < ih; yy += hs) {
    for (let xx = (yy / hs) % 2 ? hs / 2 : 0; xx < iw; xx += hs) ctx.fillRect(ix + xx, iy + yy, hs * 0.6, hs * 0.6);
  }

  const t = finishAtlas(canvas);
  roadAtlasCache.set(key, t);
  return t;
}

export const ROAD_WHEEL_V = {
  innerHub: [0, 0.06],
  innerSide: [0.06, 0.14],
  tread: [0.14, 0.3],
  outerSide: [0.3, 0.52],
  lip: [0.52, 0.56],
  barrel: [0.56, 0.6],
  spokes: [0.6, 0.94],
  cap: [0.94, 1],
} as const;

const roadWheelCache = new Map<string, CanvasTex>();

export function roadWheelTexture(spoke: string, size: readonly [number, number]): CanvasTex {
  const key = `${spoke}|${size[0]}`;
  const hit = roadWheelCache.get(key);
  if (hit) return hit;
  const [W, H] = size;
  const { canvas, ctx } = createCanvas(W, H);
  const vy = (v: number) => (1 - v) * H;
  ctx.fillStyle = '#1A1A1C';
  ctx.fillRect(0, 0, W, H);
  bandFill(ctx, W, H, ROAD_WHEEL_V.innerHub, '#202226');
  bandFill(ctx, W, H, ROAD_WHEEL_V.tread, '#141416');
  bandFill(ctx, W, H, [0.36, 0.4], '#232327');
  bandFill(ctx, W, H, ROAD_WHEEL_V.lip, spoke);
  bandFill(ctx, W, H, ROAD_WHEEL_V.barrel, '#2A2C30');
  bandFill(ctx, W, H, ROAD_WHEEL_V.spokes, '#0B0B0C');
  // Ten twin spokes, widening towards the rim.
  ctx.fillStyle = spoke;
  const n = 10;
  for (let k = 0; k < n; k++) {
    const x = (k / n) * W;
    for (const off of [-0.014, 0.014]) {
      ctx.beginPath();
      ctx.moveTo(x + (off - 0.01) * W, vy(0.94));
      ctx.lineTo(x + (off + 0.01) * W, vy(0.94));
      ctx.lineTo(x + (off * 1.6 + 0.012) * W, vy(0.6));
      ctx.lineTo(x + (off * 1.6 - 0.012) * W, vy(0.6));
      ctx.closePath();
      ctx.fill();
    }
  }
  bandFill(ctx, W, H, ROAD_WHEEL_V.cap, '#2B2E33');
  bandFill(ctx, W, H, [0.975, 1], spoke);
  const t = canvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  roadWheelCache.set(key, t);
  return t;
}

let roadOrmTex: CanvasTex | null = null;
export function roadWheelOrmTexture(): CanvasTex {
  roadOrmTex ??= stripTexture(
    [
      [[0, 1], orm(0.88, 0)],
      [ROAD_WHEEL_V.innerHub, orm(0.5, 0.5)],
      [ROAD_WHEEL_V.lip, orm(0.22, 0.95)],
      [ROAD_WHEEL_V.barrel, orm(0.4, 0.7)],
      [ROAD_WHEEL_V.spokes, orm(0.26, 0.9)],
      [ROAD_WHEEL_V.cap, orm(0.25, 0.9)],
    ],
    false,
  );
  return roadOrmTex;
}
