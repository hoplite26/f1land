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

export function asphaltTexture(): THREE.Texture {
  const key = 'asphalt';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 256);
  const rnd = seeded(7);
  g.fillStyle = '#3a3e43';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 34 + (rnd() < 0.04 ? 28 : 0);
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n + 2));
  }
  g.putImageData(img, 0, 0);
  // Longitudinal streaks (u runs along the track).
  for (let k = 0; k < 40; k++) {
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + rnd() * 0.04})`;
    g.lineWidth = 1 + rnd() * 3;
    const y = rnd() * 256;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y + (rnd() - 0.5) * 6);
    g.stroke();
  }
  const tex = finish(new THREE.CanvasTexture(c));
  cache.set(key, tex);
  return tex;
}

export function kerbTexture(): THREE.Texture {
  const key = 'kerb';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(128, 32);
  g.fillStyle = '#e8e8e4';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#d6202a';
  g.fillRect(0, 0, 64, 32);
  // Subtle bevel shading across width
  const grd = g.createLinearGradient(0, 0, 0, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.25)');
  grd.addColorStop(0.3, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.15)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 32);
  const tex = finish(new THREE.CanvasTexture(c));
  cache.set(key, tex);
  return tex;
}

export function gravelTexture(): THREE.Texture {
  const key = 'gravel';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(128, 128);
  const rnd = seeded(13);
  g.fillStyle = '#b39a74';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    const v = 120 + Math.floor(rnd() * 90);
    g.fillStyle = `rgb(${v},${v - 18},${v - 46})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
  }
  const tex = finish(new THREE.CanvasTexture(c));
  cache.set(key, tex);
  return tex;
}

export function runoffTexture(): THREE.Texture {
  const key = 'runoff';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(128, 64);
  g.fillStyle = '#2b4a7a';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 16, 64);
  const tex = finish(new THREE.CanvasTexture(c));
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
