import * as THREE from 'three';

/** Shared procedural textures for the track surface (CanvasTexture, cached). */
const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(tex: THREE.Texture, repeat = true, aniso = 4): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Track asphalt, 512² (14 m along × full width across per repeat): dark
 * bitumen with exposed light aggregate, fine pores, faint longitudinal
 * polishing streaks and a few sealed cracks. u runs along the track.
 */
export function asphaltTexture(): THREE.Texture {
  const key = 'asphalt';
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 512;
  const [c, g] = canvas(S, S);
  const rnd = seeded(7);
  g.fillStyle = '#2f3237';
  g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = rnd();
    // Aggregate: mostly fine grain, a few bright stones, some dark pores.
    let n = (rnd() - 0.5) * 26;
    if (r < 0.05) n += 22 + rnd() * 26;
    else if (r > 0.965) n -= 18;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n + 3));
  }
  g.putImageData(img, 0, 0);
  // Soft low-frequency patches (resurfacing / wear), wrapped for tiling.
  for (let k = 0; k < 26; k++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rad = 30 + rnd() * 90;
    const dark = rnd() < 0.55;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        gr.addColorStop(0, dark ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }
  // Longitudinal polishing streaks (u runs along the track → horizontal in the canvas).
  for (let k = 0; k < 70; k++) {
    g.strokeStyle = `rgba(${rnd() < 0.6 ? '0,0,0' : '255,255,255'},${0.02 + rnd() * 0.035})`;
    g.lineWidth = 1 + rnd() * 4;
    const y = rnd() * S;
    g.beginPath();
    g.moveTo(-10, y);
    g.lineTo(S + 10, y + (rnd() - 0.5) * 4);
    g.stroke();
  }
  // Sealed cracks (dark tar lines).
  g.strokeStyle = 'rgba(8,9,11,0.55)';
  for (let k = 0; k < 5; k++) {
    let x = rnd() * S;
    let y = rnd() * S;
    g.lineWidth = 1.5 + rnd() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0; j < 8; j++) {
      x += (rnd() - 0.3) * 30;
      y += (rnd() - 0.5) * 22;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = finish(new THREE.CanvasTexture(c), true, 8);
  cache.set(key, tex);
  return tex;
}

/** Kerb: red/white blocks 2 m each (uScale 4), rounded bevel shading and paint wear. */
export function kerbTexture(): THREE.Texture {
  const key = 'kerb';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 64);
  const rnd = seeded(3);
  g.fillStyle = '#ecebe6';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#d3161f';
  g.fillRect(0, 0, 128, 64);
  // Bevel across the width (v): darker edges, highlight on the crown.
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.32)');
  grd.addColorStop(0.18, 'rgba(0,0,0,0.05)');
  grd.addColorStop(0.42, 'rgba(255,255,255,0.10)');
  grd.addColorStop(0.75, 'rgba(0,0,0,0.04)');
  grd.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 64);
  // Block joints + tyre rubber smudges.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, 2, 64);
  g.fillRect(127, 0, 2, 64);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(20,20,22,${0.05 + rnd() * 0.12})`;
    g.fillRect(rnd() * 256, rnd() * 64, 2 + rnd() * 14, 1 + rnd() * 2);
  }
  const tex = finish(new THREE.CanvasTexture(c), true, 8);
  cache.set(key, tex);
  return tex;
}

/** Sausage / sawtooth apex kerb: yellow and black chevrons (uScale 1.2). */
export function sawtoothTexture(): THREE.Texture {
  const key = 'sawtooth';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#1a1b1e';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f2c200';
  g.beginPath();
  g.moveTo(0, 64);
  g.lineTo(32, 0);
  g.lineTo(64, 64);
  g.closePath();
  g.fill();
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = finish(new THREE.CanvasTexture(c), true, 4);
  cache.set(key, tex);
  return tex;
}

/** Gravel trap: rounded grey-beige pebbles with shadows (8 m per repeat). */
export function gravelTexture(): THREE.Texture {
  const key = 'gravel';
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 256;
  const [c, g] = canvas(S, S);
  const rnd = seeded(13);
  g.fillStyle = '#9d9282';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = 120 + Math.floor(rnd() * 95);
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.6 + rnd() * 1.6;
    g.fillStyle = 'rgba(40,34,28,0.35)';
    g.beginPath();
    g.arc(x + 0.6, y + 0.7, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgb(${v},${v - 8},${v - 22})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Rake marks (along u).
  for (let k = 0; k < 18; k++) {
    g.strokeStyle = `rgba(60,52,44,${0.06 + rnd() * 0.06})`;
    g.lineWidth = 2;
    const y = rnd() * S;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(S, y + (rnd() - 0.5) * 3);
    g.stroke();
  }
  const tex = finish(new THREE.CanvasTexture(c), true, 8);
  cache.set(key, tex);
  return tex;
}

/** Tarmac run-off: dark asphalt with faded painted bands (no "water blue" from the air). */
export function runoffTexture(): THREE.Texture {
  const key = 'runoff';
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 256;
  const [c, g] = canvas(S, 128);
  const rnd = seeded(29);
  g.fillStyle = '#34383d';
  g.fillRect(0, 0, S, 128);
  const img = g.getImageData(0, 0, S, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  g.putImageData(img, 0, 0);
  // Diagonal painted bands (muted teal / white), worn.
  g.save();
  g.globalAlpha = 0.32;
  for (let x = -128; x < S + 128; x += 64) {
    g.fillStyle = (x / 64) % 2 === 0 ? '#2e6f72' : '#9aa3a8';
    g.beginPath();
    g.moveTo(x, 128);
    g.lineTo(x + 28, 128);
    g.lineTo(x + 28 + 60, 0);
    g.lineTo(x + 60, 0);
    g.closePath();
    g.fill();
  }
  g.restore();
  const tex = finish(new THREE.CanvasTexture(c), true, 8);
  cache.set(key, tex);
  return tex;
}

/** Painted green track-limit strip (rough paint with grit). */
export function limitStripTexture(): THREE.Texture {
  const key = 'limit-strip';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(128, 32);
  const rnd = seeded(41);
  g.fillStyle = '#2f7a4a';
  g.fillRect(0, 0, 128, 32);
  for (let i = 0; i < 700; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.1)';
    g.fillRect(rnd() * 128, rnd() * 32, 1, 1);
  }
  const tex = finish(new THREE.CanvasTexture(c), true, 4);
  cache.set(key, tex);
  return tex;
}

export function checkerTexture(): THREE.Texture {
  const key = 'checker';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(64, 16);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#f4f4f4' : '#121212';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  const tex = finish(new THREE.CanvasTexture(c));
  tex.magFilter = THREE.NearestFilter;
  cache.set(key, tex);
  return tex;
}

export function glowRingTexture(): THREE.Texture {
  const key = 'glowring';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 256);
  const grd = g.createRadialGradient(128, 128, 60, 128, 128, 126);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.0)');
  grd.addColorStop(0.72, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.8, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

export function softDotTexture(): THREE.Texture {
  const key = 'softdot';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

export function labelTexture(text: string, color = '#ffffff', bg = 'rgba(0,0,0,0)', w = 256, h = 64, font = '700 38px "Titillium Web", sans-serif'): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
