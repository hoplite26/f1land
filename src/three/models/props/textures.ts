/**
 * Procedural CanvasTextures for props (cached module-wide). Every brand is
 * invented — no real trademarks. Falls back to a 1×1 DataTexture when no
 * canvas is available (node tests).
 */
import * as THREE from 'three';
import { DRIVERS, TEAMS } from '@/data/teams';
import type { EnvironmentTheme } from '@/data/circuits/types';
import { Rng, onCacheDispose, type UvRect } from './core';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const texCache = new Map<string, THREE.Texture>();
onCacheDispose(() => {
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
});

export const FONT_STACK = `"Arial Black","Helvetica Neue",Arial,"FreeSans","DejaVu Sans",sans-serif`;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx } | null {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    // Software-backed: drawn once and uploaded (GPU-backed 2D contexts are costly to create).
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return ctx ? { canvas, ctx } : null;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return ctx ? { canvas, ctx } : null;
  }
  return null;
}

export interface CanvasTexOpts {
  repeat?: boolean;
  /** Colour textures are sRGB; masks/data are linear. */
  srgb?: boolean;
  anisotropy?: number;
  mipmaps?: boolean;
}

/** Cached canvas texture. `draw` receives a 2D context of size w × h. */
export function canvasTexture(
  key: string,
  w: number,
  h: number,
  draw: (ctx: Ctx, w: number, h: number) => void,
  opts: CanvasTexOpts = {},
): THREE.Texture {
  const cached = texCache.get(key);
  if (cached) return cached;
  const c = makeCanvas(w, h);
  let tex: THREE.Texture;
  if (c) {
    draw(c.ctx, w, h);
    tex = new THREE.CanvasTexture(c.canvas as HTMLCanvasElement);
  } else {
    tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  }
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = opts.anisotropy ?? 4;
  if (opts.mipmaps === false) {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
  }
  tex.needsUpdate = true;
  tex.name = key;
  texCache.set(key, tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Brand atlas                                                         */
/* ------------------------------------------------------------------ */

interface Brand {
  name: string;
  sub?: string;
  bg: string;
  bg2?: string;
  fg: string;
  accent: string;
  mark: 'pulse' | 'chevron' | 'stripe' | 'dot' | 'slash' | 'ring' | 'none';
}

/** Invented sponsor brands used on boards, banners and signage. */
export const BRANDS: readonly Brand[] = [
  { name: 'PULSE ARENA', sub: 'FORMULA 1', bg: '#0b0f0c', bg2: '#141c16', fg: '#ffffff', accent: '#b6ff3b', mark: 'pulse' },
  { name: 'APEX', sub: 'PERFORMANCE', bg: '#d7141d', fg: '#ffffff', accent: '#111111', mark: 'chevron' },
  { name: 'GRIDLINE', sub: 'TELEMETRY', bg: '#0d2a6b', bg2: '#13398f', fg: '#ffffff', accent: '#36c6ff', mark: 'stripe' },
  { name: 'NOVA FUEL', bg: '#ffcc00', fg: '#151515', accent: '#e4002b', mark: 'dot' },
  { name: 'VELOCITA', sub: 'TIMING', bg: '#101820', fg: '#f5f5f5', accent: '#ff6a00', mark: 'slash' },
  { name: 'TORQUE', sub: 'LUBRICANTS', bg: '#00843d', fg: '#ffffff', accent: '#ffd400', mark: 'ring' },
  { name: 'HELIX', sub: 'TYRES', bg: '#f4f4f4', fg: '#121212', accent: '#ffcc00', mark: 'stripe' },
  { name: 'KINETIC', sub: 'ENERGY', bg: '#5b21b6', bg2: '#7c3aed', fg: '#ffffff', accent: '#22d3ee', mark: 'chevron' },
  { name: 'ORBITAL', sub: 'NETWORKS', bg: '#0e7490', fg: '#ffffff', accent: '#a7f3d0', mark: 'ring' },
  { name: 'SKYLINE', sub: 'AIRWAYS', bg: '#7a0019', fg: '#ffffff', accent: '#d4af37', mark: 'slash' },
  { name: 'CARBONIX', bg: '#1a1a1a', bg2: '#2b2b2b', fg: '#e6e6e6', accent: '#e10600', mark: 'chevron' },
  { name: 'QUANTA', sub: 'CLOUD', bg: '#ffffff', fg: '#0047bb', accent: '#00b2ff', mark: 'dot' },
  { name: 'ZENITH', sub: 'WATCHES', bg: '#0a3d2e', fg: '#f0e6c8', accent: '#d4af37', mark: 'none' },
  { name: 'RAPIDO', sub: 'COLA', bg: '#e4002b', fg: '#ffffff', accent: '#ffffff', mark: 'dot' },
  { name: 'PULSE', sub: 'PREDICT · PLAY · BELONG', bg: '#b6ff3b', fg: '#0b0f0c', accent: '#0b0f0c', mark: 'pulse' },
];

export const BRAND_COUNT = BRANDS.length;
const ATLAS_COLS = 2;
const ATLAS_ROWS = 8;
/** Tile index of the plain dark backing plate. */
export const BRAND_DARK_TILE = 15;

/** UV rect of brand tile `i` (tiles are 4:1). */
export function brandTileUV(i: number): UvRect {
  const idx = ((i % 16) + 16) % 16;
  const c = idx % ATLAS_COLS;
  const r = Math.floor(idx / ATLAS_COLS);
  const eu = 1 / 1024;
  const ev = 1 / 1024;
  return [c / ATLAS_COLS + eu, 1 - (r + 1) / ATLAS_ROWS + ev, (c + 1) / ATLAS_COLS - eu, 1 - r / ATLAS_ROWS - ev];
}

function drawPulseMark(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, h * 0.09);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  const pts = [
    [0, 0.5], [0.28, 0.5], [0.38, 0.15], [0.5, 0.9], [0.6, 0.3], [0.68, 0.5], [1, 0.5],
  ] as const;
  pts.forEach(([px, py], i) => {
    const X = x + px * w;
    const Y = y + py * h;
    if (i === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  });
  ctx.shadowColor = color;
  ctx.shadowBlur = h * 0.25;
  ctx.stroke();
  ctx.restore();
}

function drawBrandTile(ctx: Ctx, b: Brand, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, b.bg2 ?? b.bg);
  g.addColorStop(1, b.bg);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Marks
  ctx.fillStyle = b.accent;
  ctx.strokeStyle = b.accent;
  let textX = x + w * 0.5;
  const align: CanvasTextAlign = 'center';
  switch (b.mark) {
    case 'pulse':
      drawPulseMark(ctx, x + w * 0.04, y + h * 0.2, h * 0.9, h * 0.6, b.accent);
      textX = x + h * 1.05 + (w - h * 1.05) * 0.5;
      break;
    case 'chevron':
      for (let i = 0; i < 3; i++) {
        const cx = x + w * 0.06 + i * h * 0.22;
        ctx.beginPath();
        ctx.moveTo(cx, y + h * 0.2);
        ctx.lineTo(cx + h * 0.16, y + h * 0.5);
        ctx.lineTo(cx, y + h * 0.8);
        ctx.lineTo(cx + h * 0.1, y + h * 0.8);
        ctx.lineTo(cx + h * 0.26, y + h * 0.5);
        ctx.lineTo(cx + h * 0.1, y + h * 0.2);
        ctx.closePath();
        ctx.fill();
      }
      textX = x + w * 0.56;
      break;
    case 'stripe':
      ctx.fillRect(x, y + h * 0.84, w, h * 0.08);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, y + h * 0.08, w, h * 0.04);
      ctx.globalAlpha = 1;
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(x + w * 0.1, y + h * 0.5, h * 0.26, 0, Math.PI * 2);
      ctx.fill();
      textX = x + w * 0.56;
      break;
    case 'slash':
      ctx.beginPath();
      ctx.moveTo(x + w * 0.8, y + h);
      ctx.lineTo(x + w * 0.86, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fill();
      textX = x + w * 0.42;
      break;
    case 'ring':
      ctx.lineWidth = h * 0.08;
      ctx.beginPath();
      ctx.arc(x + w * 0.1, y + h * 0.5, h * 0.24, 0, Math.PI * 2);
      ctx.stroke();
      textX = x + w * 0.56;
      break;
    case 'none':
      ctx.fillRect(x + w * 0.05, y + h * 0.82, w * 0.9, 2);
      break;
  }
  // Wordmark
  ctx.fillStyle = b.fg;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const hasSub = !!b.sub;
  const size = Math.round(h * (hasSub ? 0.5 : 0.62));
  ctx.font = `italic 900 ${size}px ${FONT_STACK}`;
  let tw = ctx.measureText(b.name).width;
  const maxW = w * (b.mark === 'none' || b.mark === 'stripe' ? 0.86 : 0.68);
  const sx = tw > maxW ? maxW / tw : 1;
  ctx.save();
  ctx.translate(textX, y + h * (hasSub ? 0.42 : 0.52));
  ctx.scale(sx, 1);
  ctx.fillText(b.name, 0, 0);
  ctx.restore();
  if (b.sub) {
    ctx.font = `700 ${Math.round(h * 0.16)}px ${FONT_STACK}`;
    ctx.globalAlpha = 0.85;
    const sub = b.sub.split('').join(' ');
    tw = ctx.measureText(sub).width;
    const s2 = tw > maxW ? maxW / tw : 1;
    ctx.save();
    ctx.translate(textX, y + h * 0.78);
    ctx.scale(s2, 1);
    ctx.fillText(sub, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // Subtle panel frame
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.restore();
}

/** 1024² atlas of 16 brand tiles (2 × 8, each 512 × 128). Tile 15 is a dark plate. */
export function getBrandAtlas(): THREE.Texture {
  return canvasTexture(
    'brand-atlas',
    1024,
    1024,
    (ctx) => {
      const tw = 512;
      const th = 128;
      for (let i = 0; i < 16; i++) {
        const x = (i % ATLAS_COLS) * tw;
        const y = Math.floor(i / ATLAS_COLS) * th;
        if (i === BRAND_DARK_TILE) {
          const g = ctx.createLinearGradient(0, y, 0, y + th);
          g.addColorStop(0, '#2a2d31');
          g.addColorStop(1, '#16181b');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, tw, th);
          continue;
        }
        drawBrandTile(ctx, BRANDS[i % BRANDS.length]!, x, y, tw, th);
      }
    },
    { anisotropy: 8 },
  );
}

/* ------------------------------------------------------------------ */
/* Banner strip (long text banner with repeated brands)                */
/* ------------------------------------------------------------------ */

/** Wide banner texture (2048 × 128 = 16 m at 1 m height) with optional headline text. */
export function getBannerTexture(text?: string): THREE.Texture {
  return canvasTexture(`banner|${text ?? ''}`, 2048, 128, (ctx, w, h) => drawBannerStrip(ctx, 0, w, h, text), {
    anisotropy: 8,
    repeat: true,
  });
}

/* ------------------------------------------------------------------ */
/* Facades                                                             */
/* ------------------------------------------------------------------ */

export type FacadeStyle = 'modern' | 'monaco' | 'desert' | 'industrial';

export interface FacadeTextures {
  map: THREE.Texture;
  emissiveMap: THREE.Texture;
  /** Metres covered by one texture repeat horizontally / vertically. */
  tileW: number;
  tileH: number;
}

const FACADE_METRICS: Record<FacadeStyle, { bay: number; floor: number }> = {
  modern: { bay: 3, floor: 3.6 },
  monaco: { bay: 3.2, floor: 3.2 },
  desert: { bay: 3.5, floor: 3.6 },
  industrial: { bay: 4, floor: 4 },
};

export function getFacadeTextures(style: FacadeStyle): FacadeTextures {
  const { bay, floor } = FACADE_METRICS[style];
  const S = 512;
  const bays = 4;
  const floors = 4;
  const bw = S / bays;
  const fh = S / floors;
  // Lit-window pattern shared between map & mask (same seed).
  const lit = (seed: string) => {
    const rng = new Rng(seed);
    return Array.from({ length: bays * floors * 2 }, () => rng.next());
  };
  const map = canvasTexture(
    `facade|${style}`,
    S,
    S,
    (ctx) => {
      const rng = new Rng(`facade-map-${style}`);
      if (style === 'modern') {
        ctx.fillStyle = '#c9d1d8';
        ctx.fillRect(0, 0, S, S);
        for (let f = 0; f < floors; f++) {
          for (let b = 0; b < bays; b++) {
            for (let k = 0; k < 2; k++) {
              const x = b * bw + 3 + k * (bw / 2);
              const y = f * fh + 3;
              const w = bw / 2 - 5;
              const h = fh - 22;
              const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
              const t = rng.range(0, 0.25);
              g.addColorStop(0, `rgb(${130 + t * 200},${168 + t * 160},${196 + t * 100})`);
              g.addColorStop(0.55, `rgb(${52 + t * 80},${84 + t * 80},${112 + t * 80})`);
              g.addColorStop(1, `rgb(${38},${60},${84})`);
              ctx.fillStyle = g;
              ctx.fillRect(x, y, w, h);
            }
          }
          ctx.fillStyle = '#8c969f';
          ctx.fillRect(0, f * fh + fh - 18, S, 18);
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillRect(0, f * fh + fh - 18, S, 2);
        }
      } else if (style === 'monaco') {
        ctx.fillStyle = '#f3ece0';
        ctx.fillRect(0, 0, S, S);
        for (let f = 0; f < floors; f++) {
          // Cornice
          ctx.fillStyle = '#ddd2c0';
          ctx.fillRect(0, f * fh + fh - 8, S, 8);
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.fillRect(0, f * fh + fh - 2, S, 2);
          for (let b = 0; b < bays; b++) {
            const cx = b * bw + bw / 2;
            const ww = bw * 0.34;
            const wh = fh * 0.58;
            const y = f * fh + fh * 0.16;
            ctx.fillStyle = '#2b3036';
            ctx.fillRect(cx - ww / 2, y, ww, wh);
            ctx.fillStyle = 'rgba(160,190,210,0.35)';
            ctx.fillRect(cx - ww / 2 + 3, y + 3, ww - 6, wh * 0.4);
            // Shutters
            const open = rng.next();
            ctx.fillStyle = rng.chance(0.5) ? '#3f6b4a' : '#4f7a8a';
            if (open < 0.75) {
              ctx.fillRect(cx - ww / 2 - ww * 0.42, y, ww * 0.38, wh);
              ctx.fillRect(cx + ww / 2 + ww * 0.04, y, ww * 0.38, wh);
            } else {
              ctx.fillRect(cx - ww / 2, y, ww, wh);
            }
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            for (let s = 0; s < 6; s++) ctx.fillRect(cx - ww / 2 - ww * 0.42, y + (s * wh) / 6, ww * 1.84, 1.5);
            // Sill + balcony
            ctx.fillStyle = '#fbf8f2';
            ctx.fillRect(cx - ww / 2 - 4, y + wh, ww + 8, 5);
            if (f % 2 === 1) {
              ctx.fillStyle = '#222';
              ctx.fillRect(cx - ww * 0.75, y + wh * 0.72, ww * 1.5, 2);
              for (let s = 0; s <= 8; s++) ctx.fillRect(cx - ww * 0.75 + (s * ww * 1.5) / 8, y + wh * 0.72, 1.5, wh * 0.28);
            }
          }
        }
      } else if (style === 'desert') {
        ctx.fillStyle = '#efe2c8';
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < 900; i++) {
          ctx.fillStyle = `rgba(120,90,50,${rng.range(0.02, 0.06)})`;
          ctx.fillRect(rng.range(0, S), rng.range(0, S), 2, 2);
        }
        for (let f = 0; f < floors; f++) {
          ctx.fillStyle = 'rgba(150,120,80,0.25)';
          ctx.fillRect(0, f * fh + fh - 6, S, 6);
          for (let b = 0; b < bays; b++) {
            const cx = b * bw + bw / 2;
            const ww = bw * 0.3;
            const wh = fh * 0.52;
            const y = f * fh + fh * 0.2;
            ctx.fillStyle = '#2f2a25';
            ctx.beginPath();
            ctx.moveTo(cx - ww / 2, y + wh);
            ctx.lineTo(cx - ww / 2, y + ww / 2);
            ctx.arc(cx, y + ww / 2, ww / 2, Math.PI, 0);
            ctx.lineTo(cx + ww / 2, y + wh);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,240,210,0.6)';
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        }
      } else {
        // industrial: corrugated cladding + strip windows
        for (let x = 0; x < S; x += 8) {
          ctx.fillStyle = x % 16 === 0 ? '#c4c8cc' : '#a9aeb3';
          ctx.fillRect(x, 0, 8, S);
        }
        for (let f = 0; f < floors; f++) {
          const y = f * fh + fh * 0.3;
          ctx.fillStyle = '#3c4c5a';
          ctx.fillRect(0, y, S, fh * 0.22);
          ctx.fillStyle = '#d0d4d8';
          for (let x = 0; x < S; x += bw / 3) ctx.fillRect(x, y, 3, fh * 0.22);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(0, f * fh + fh - 4, S, 4);
        }
      }
    },
    { repeat: true, anisotropy: 8 },
  );
  const emissiveMap = canvasTexture(
    `facade-lit|${style}`,
    S,
    S,
    (ctx) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, S, S);
      const L = lit(`lit-${style}`);
      const warm = ['#ffd9a0', '#ffe8c4', '#fff1d6'];
      const cool = ['#e8f2ff', '#d6e8ff', '#fff8ee'];
      let i = 0;
      for (let f = 0; f < floors; f++) {
        for (let b = 0; b < bays; b++) {
          for (let k = 0; k < 2; k++) {
            const r = L[i++]!;
            const chance = style === 'modern' ? 0.55 : style === 'industrial' ? 0.3 : 0.42;
            if (r > chance) continue;
            const palette = style === 'modern' || style === 'industrial' ? cool : warm;
            ctx.fillStyle = palette[Math.floor(r * 97) % palette.length]!;
            if (style === 'modern') {
              ctx.fillRect(b * bw + 3 + k * (bw / 2), f * fh + 3, bw / 2 - 5, fh - 22);
            } else if (style === 'industrial') {
              if (k === 1) continue;
              ctx.fillRect(b * bw, f * fh + fh * 0.3, bw, fh * 0.22);
            } else if (k === 0) {
              const cx = b * bw + bw / 2;
              const ww = style === 'monaco' ? bw * 0.34 : bw * 0.3;
              const y = f * fh + fh * (style === 'monaco' ? 0.16 : 0.2);
              const wh = fh * (style === 'monaco' ? 0.58 : 0.52);
              ctx.fillRect(cx - ww / 2, y, ww, wh);
            }
          }
        }
      }
    },
    { repeat: true },
  );
  return { map, emissiveMap, tileW: bay * bays, tileH: floor * floors };
}

/* ------------------------------------------------------------------ */
/* Grandstand seat rows with painted seated spectators                 */
/* ------------------------------------------------------------------ */

function drawSeatStrip(
  ctx: Ctx,
  oy: number,
  w: number,
  h: number,
  seatColor: string,
  palette: readonly string[],
  fill: number,
  seed: string,
): void {
  // Logical drawing space: w × 64 (64 px per metre horizontally), stretched to h.
  ctx.save();
  ctx.translate(0, oy);
  ctx.scale(1, h / 64);
  const H = 64;
  const rng = new Rng(seed);
  const seatW = 32;
  const skins = ['#f1c7a5', '#e0ac85', '#c68863', '#8d5a3b', '#5c3a24', '#f6d5bc'];
  const hair = ['#1b1410', '#3b2a1e', '#6b4a2b', '#c9a46a', '#2a2a2a', '#8a8a8a'];
  for (let x = 0; x < w; x += seatW) {
    ctx.fillStyle = seatColor;
    ctx.fillRect(x + 3, H * 0.5, seatW - 6, H * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(x + 3, H * 0.5, seatW - 6, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, H * 0.5, 3, H * 0.5);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, H - 6, w, 6);
  for (let x = 0; x < w; x += seatW) {
    if (!rng.chance(fill)) continue;
    const cx = x + seatW / 2 + rng.range(-3, 3);
    const shirt = rng.chance(0.78) ? rng.pick(palette) : rng.pick(['#ffffff', '#1c1c1c', '#6b7280', '#1e3a8a']);
    const top = H * rng.range(0.24, 0.34);
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.moveTo(cx - 11, H);
    ctx.lineTo(cx - 11, top + 10);
    ctx.quadraticCurveTo(cx - 11, top + 4, cx - 4, top + 4);
    ctx.lineTo(cx + 4, top + 4);
    ctx.quadraticCurveTo(cx + 11, top + 4, cx + 11, top + 10);
    ctx.lineTo(cx + 11, H);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(cx - 11, top + 18, 22, 3);
    if (rng.chance(0.16)) {
      ctx.fillStyle = shirt;
      ctx.fillRect(cx - 14, top - 10, 4, 18);
      ctx.fillRect(cx + 10, top - 10, 4, 18);
    }
    ctx.fillStyle = rng.pick(skins);
    ctx.beginPath();
    ctx.arc(cx, top - 3, 6.5, 0, Math.PI * 2);
    ctx.fill();
    if (rng.chance(0.3)) {
      ctx.fillStyle = rng.pick(palette);
      ctx.fillRect(cx - 7, top - 11, 14, 5);
      ctx.fillRect(cx - 2, top - 7, 10, 2);
    } else {
      ctx.fillStyle = rng.pick(hair);
      ctx.beginPath();
      ctx.arc(cx, top - 5, 6.5, Math.PI, 0);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawBannerStrip(ctx: Ctx, oy: number, w: number, h: number, text?: string): void {
  ctx.save();
  ctx.translate(0, oy);
  const seq = [0, 2, 3, 1, 4, 5, 7, 9];
  const tile = h * 4;
  if (!text) {
    for (let k = 0, x = 0; x < w; x += tile, k++) drawBrandTile(ctx, BRANDS[seq[k % seq.length]!]!, x, 0, tile, h);
  } else {
    // [brand][ headline panel ][brand] so tiles are never cut.
    const pw = Math.max(tile, w - tile * 2);
    drawBrandTile(ctx, BRANDS[0]!, 0, 0, tile, h);
    drawBrandTile(ctx, BRANDS[2]!, tile + pw, 0, tile, h);
    const px = tile;
    const g = ctx.createLinearGradient(px, 0, px + pw, 0);
    g.addColorStop(0, '#0b0f0c');
    g.addColorStop(0.5, '#1a261d');
    g.addColorStop(1, '#0b0f0c');
    ctx.fillStyle = g;
    ctx.fillRect(px, 0, pw, h);
    ctx.fillStyle = '#b6ff3b';
    ctx.fillRect(px, h - h * 0.08, pw, h * 0.08);
    ctx.fillRect(px, 0, pw, h * 0.03);
    drawPulseMark(ctx, px + h * 0.25, h * 0.22, h * 0.9, h * 0.56, '#b6ff3b');
    drawPulseMark(ctx, px + pw - h * 1.15, h * 0.22, h * 0.9, h * 0.56, '#b6ff3b');
    ctx.fillStyle = '#ffffff';
    ctx.font = `italic 900 ${Math.round(h * 0.52)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = text.toUpperCase();
    const maxW = pw - h * 2.8;
    const tw = ctx.measureText(label).width;
    const s = tw > maxW ? maxW / tw : 1;
    ctx.translate(px + pw / 2, h * 0.5);
    ctx.scale(s, 1);
    ctx.fillText(label, 0, 0);
  }
  ctx.restore();
}

/** Metres of seat row covered by one horizontal repeat of the grandstand texture. */
export const STAND_SEAT_PERIOD_M = 32;
/** Metres of banner covered by one horizontal repeat (banner is 1 m tall). */
export const STAND_BANNER_PERIOD_M = 16;

/**
 * Grandstand atlas, 2048 × 256, horizontally repeating:
 * v ∈ [0.5, 1] = sponsor banner (16 m per repeat at 1 m height),
 * v ∈ [0, 0.5) = seat row with painted seated spectators, alpha above heads
 * (32 m per repeat, 1 m tall). Use with alphaTest.
 */
export function getGrandstandTexture(
  seatColor: string,
  palette: readonly string[],
  fill: number,
  bannerText?: string,
): THREE.Texture {
  const fillQ = Math.round(fill * 10) / 10;
  const key = `stand|${seatColor}|${palette.join(',')}|${fillQ}|${bannerText ?? ''}`;
  return canvasTexture(
    key,
    2048,
    256,
    (ctx, w) => {
      ctx.clearRect(0, 0, w, 256);
      drawBannerStrip(ctx, 0, w, 128, bannerText);
      drawSeatStrip(ctx, 128, w, 128, seatColor, palette, fillQ, key);
    },
    { repeat: true, anisotropy: 8 },
  );
}

/** Standalone seat strip (512 × 64 = 8 m × 1 m), alpha above heads. */
export function getSeatCrowdTexture(seatColor: string, palette: readonly string[], fill: number): THREE.Texture {
  const fillQ = Math.round(fill * 10) / 10;
  const key = `seats|${seatColor}|${palette.join(',')}|${fillQ}`;
  return canvasTexture(
    key,
    512,
    64,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      drawSeatStrip(ctx, 0, w, h, seatColor, palette, fillQ, key);
    },
    { repeat: true, anisotropy: 4 },
  );
}

/* ------------------------------------------------------------------ */
/* Trackside textures                                                  */
/* ------------------------------------------------------------------ */

/** 256 × 512: v ∈ [0.75, 1] solid grey (posts/rails), v ∈ [0, 0.75) wire diamond mesh on transparent. */
export function getWireFenceTexture(): THREE.Texture {
  return canvasTexture(
    'wire-fence',
    256,
    512,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#9aa1a8');
      g.addColorStop(0.5, '#d5d9dd');
      g.addColorStop(1, '#8d949b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, 128);
      ctx.strokeStyle = 'rgba(205,210,215,1)';
      ctx.lineWidth = 2.2;
      const step = 21.33;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 128, w, h - 128);
      ctx.clip();
      for (let k = -h; k < w + h; k += step) {
        ctx.beginPath();
        ctx.moveTo(k, 128);
        ctx.lineTo(k + (h - 128), h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(k, h);
        ctx.lineTo(k + (h - 128), 128);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(170,176,182,1)';
      for (const y of [130, 230, 330, 430, 508]) ctx.fillRect(0, y, w, 3);
    },
    { repeat: true, srgb: true, anisotropy: 8 },
  );
}

/** 256 × 256: top half white (belts, tinted by vertex colour), bottom half stacked tyres. */
export function getTyreTexture(): THREE.Texture {
  return canvasTexture(
    'tyre-wall',
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 2, h / 2);
      const rows = 4;
      const rh = h / 2 / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 2; c++) {
          const x = c * (w / 2);
          const y = h / 2 + r * rh;
          const g = ctx.createLinearGradient(0, y, 0, y + rh);
          g.addColorStop(0, '#0d0d0f');
          g.addColorStop(0.35, '#3a3b3f');
          g.addColorStop(0.55, '#26272a');
          g.addColorStop(1, '#09090a');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, w / 2, rh);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x, y, 4, rh);
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          for (let t = 0; t < 10; t++) ctx.fillRect(x + 8 + t * 12, y + rh * 0.3, 6, rh * 0.35);
        }
      }
    },
    { repeat: true, anisotropy: 4 },
  );
}

/** Radial soft glow for additive halos. */
export function getGlowTexture(): THREE.Texture {
  return canvasTexture(
    'glow',
    128,
    128,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.28)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.07)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { mipmaps: true },
  );
}

/* ------------------------------------------------------------------ */
/* Big screen (3 pages stacked vertically)                             */
/* ------------------------------------------------------------------ */

export const SCREEN_PAGES = 3;

export function getBigScreenTexture(teamColors: readonly string[]): THREE.Texture {
  const key = `screen|${teamColors.join(',')}`;
  return canvasTexture(
    key,
    512,
    288 * SCREEN_PAGES,
    (ctx, w) => {
      const ph = 288;
      const bg = (y: number) => {
        const g = ctx.createLinearGradient(0, y, w, y + ph);
        g.addColorStop(0, '#07110b');
        g.addColorStop(1, '#0f1d14');
        ctx.fillStyle = g;
        ctx.fillRect(0, y, w, ph);
        ctx.fillStyle = '#b6ff3b';
        ctx.fillRect(0, y + ph - 6, w, 6);
      };
      // Page 0: brand
      bg(0);
      drawPulseMark(ctx, 40, 70, 150, 110, '#b6ff3b');
      ctx.fillStyle = '#fff';
      ctx.font = `italic 900 64px ${FONT_STACK}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('PULSE', 210, 104);
      ctx.fillStyle = '#b6ff3b';
      ctx.fillText('ARENA', 210, 166);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `700 20px ${FONT_STACK}`;
      ctx.fillText('F O R M U L A   1   ·   L I V E', 44, 238);
      // Page 1: timing tower
      const y1 = ph;
      bg(y1);
      ctx.fillStyle = '#e10600';
      ctx.fillRect(20, y1 + 16, 120, 30);
      ctx.fillStyle = '#fff';
      ctx.font = `italic 900 22px ${FONT_STACK}`;
      ctx.fillText('LAP 42/58', 28, y1 + 32);
      const order = DRIVERS.slice(0, 10);
      order.forEach((d, i) => {
        const col = i < 5 ? 0 : 1;
        const row = i % 5;
        const x = 20 + col * 245;
        const y = y1 + 60 + row * 42;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, y, 230, 36);
        ctx.fillStyle = '#fff';
        ctx.font = `900 20px ${FONT_STACK}`;
        ctx.fillText(String(i + 1), x + 8, y + 19);
        const team = TEAMS.find((t) => t.id === d.teamId);
        ctx.fillStyle = team?.color ?? teamColors[i % Math.max(1, teamColors.length)] ?? '#fff';
        ctx.fillRect(x + 36, y + 6, 6, 24);
        ctx.fillStyle = '#fff';
        ctx.fillText(d.code, x + 52, y + 19);
        ctx.fillStyle = i === 0 ? '#b6ff3b' : 'rgba(255,255,255,0.75)';
        ctx.font = `700 16px ${FONT_STACK}`;
        ctx.fillText(i === 0 ? 'LEADER' : `+${(i * 1.37 + 0.4).toFixed(3)}`, x + 128, y + 19);
      });
      // Page 2: overtake zone
      const y2 = ph * 2;
      bg(y2);
      ctx.save();
      ctx.translate(0, y2);
      ctx.strokeStyle = '#b6ff3b';
      ctx.lineWidth = 10;
      ctx.shadowColor = '#b6ff3b';
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.moveTo(40, 220);
      ctx.bezierCurveTo(140, 220, 160, 90, 260, 110);
      ctx.bezierCurveTo(360, 130, 380, 60, 470, 70);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = `italic 900 40px ${FONT_STACK}`;
      ctx.fillText('OVERTAKE', 40, 60);
      ctx.fillStyle = '#b6ff3b';
      ctx.fillText('ZONE', 300, 250);
      ctx.restore();
    },
    { anisotropy: 4 },
  );
}

/* ------------------------------------------------------------------ */
/* Ground                                                              */
/* ------------------------------------------------------------------ */

export function getGroundTexture(theme: EnvironmentTheme): THREE.Texture {
  return canvasTexture(
    `ground|${theme}`,
    512,
    512,
    (ctx, w, h) => {
      const rng = new Rng(`ground-${theme}`);
      const speckle = (n: number, colors: string[], size: [number, number], alpha: [number, number]) => {
        for (let i = 0; i < n; i++) {
          ctx.globalAlpha = rng.range(alpha[0], alpha[1]);
          ctx.fillStyle = rng.pick(colors);
          const s = rng.range(size[0], size[1]);
          ctx.fillRect(rng.range(0, w), rng.range(0, h), s, s);
        }
        ctx.globalAlpha = 1;
      };
      const blotches = (n: number, colors: string[], r: [number, number], alpha: number) => {
        for (let i = 0; i < n; i++) {
          const x = rng.range(0, w);
          const y = rng.range(0, h);
          const rad = rng.range(r[0], r[1]);
          for (const ox of [-w, 0, w]) {
            for (const oy of [-h, 0, h]) {
              const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
              const c = rng.pick(colors);
              g.addColorStop(0, c);
              g.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.globalAlpha = alpha;
              ctx.fillStyle = g;
              ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
            }
          }
        }
        ctx.globalAlpha = 1;
      };
      switch (theme) {
        case 'countryside':
        case 'parkland':
        case 'forest': {
          const [a, b] =
            theme === 'forest' ? ['#3d6b2f', '#457536'] : theme === 'parkland' ? ['#4f8f3c', '#5a9c45'] : ['#4c8838', '#5a9842'];
          // Mowing stripes (2 per tile)
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = i % 2 ? a! : b!;
            ctx.fillRect((i * w) / 4, 0, w / 4, h);
          }
          blotches(14, ['rgba(40,70,25,0.9)', 'rgba(110,140,60,0.8)'], [40, 110], 0.25);
          speckle(5000, ['#2f5a24', '#6aa84f', '#7cb35a', '#3b6b2c'], [1, 2.5], [0.25, 0.6]);
          if (theme === 'forest') blotches(6, ['rgba(110,85,50,0.9)'], [20, 50], 0.25);
          break;
        }
        case 'desert': {
          ctx.fillStyle = '#cfb791';
          ctx.fillRect(0, 0, w, h);
          blotches(16, ['rgba(190,155,110,0.9)', 'rgba(235,210,170,0.9)'], [60, 150], 0.12);
          ctx.strokeStyle = 'rgba(160,125,85,0.07)';
          ctx.lineWidth = 3;
          for (let y = 0; y < h + 40; y += 26) {
            ctx.beginPath();
            for (let x = 0; x <= w; x += 8) {
              const yy = y + Math.sin((x / w) * Math.PI * 4 + y * 0.05) * 6;
              if (x === 0) ctx.moveTo(x, yy);
              else ctx.lineTo(x, yy);
            }
            ctx.stroke();
          }
          speckle(7000, ['#b08a5a', '#efd7ad', '#9a7448'], [1, 2], [0.2, 0.5]);
          break;
        }
        case 'dunes': {
          ctx.fillStyle = '#e2cf9e';
          ctx.fillRect(0, 0, w, h);
          blotches(12, ['rgba(200,180,130,0.9)', 'rgba(245,232,200,0.9)'], [60, 140], 0.14);
          speckle(5000, ['#c8b07a', '#f5e9c8'], [1, 2], [0.2, 0.5]);
          // Marram grass tufts
          for (let i = 0; i < 90; i++) {
            const x = rng.range(0, w);
            const y = rng.range(0, h);
            ctx.strokeStyle = rng.pick(['#7d8f4a', '#9aa35a', '#6c7c3c']);
            ctx.lineWidth = 1.5;
            for (let k = 0; k < 7; k++) {
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x + rng.range(-7, 7), y - rng.range(5, 12));
              ctx.stroke();
            }
          }
          break;
        }
        case 'street': {
          ctx.fillStyle = '#8b8d91';
          ctx.fillRect(0, 0, w, h);
          blotches(10, ['rgba(70,72,76,0.9)', 'rgba(160,162,165,0.9)'], [40, 120], 0.25);
          speckle(9000, ['#6f7276', '#a5a8ac', '#5d6064'], [1, 2], [0.2, 0.5]);
          ctx.fillStyle = 'rgba(40,42,45,0.55)';
          for (let i = 0; i <= 4; i++) {
            ctx.fillRect((i * w) / 4 - 1, 0, 2, h);
            ctx.fillRect(0, (i * h) / 4 - 1, w, 2);
          }
          break;
        }
      }
    },
    { repeat: true, anisotropy: 8 },
  );
}

/** Logo strip used on LED surfaces (Sphere): white/lime wordmark on black. */
export function getLedLogoTexture(): THREE.Texture {
  return canvasTexture(
    'led-logo',
    1024,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      drawPulseMark(ctx, 40, 50, 220, 150, '#b6ff3b');
      ctx.textBaseline = 'middle';
      ctx.font = `italic 900 120px ${FONT_STACK}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('PULSE', 290, 128);
      ctx.fillStyle = '#b6ff3b';
      ctx.fillText('ARENA', 640, 128);
    },
    { repeat: true, mipmaps: true },
  );
}
