import * as THREE from 'three';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import type { CameraShot } from './cameraRig';

export type LabelKind = 'follow' | 'rival' | 'near' | 'sc';

export interface LabelTarget {
  id: string;
  pos: THREE.Vector3;
  kind: LabelKind;
}

export interface ZoneTag {
  sector: 1 | 2 | 3;
  pos: THREE.Vector3;
}

const SHOT_NAMES: Record<CameraShot, string> = {
  follow: 'CHASE CAM',
  tv: 'TV CAM',
  heli: 'HELI CAM',
  onboard: 'ONBOARD',
  front: 'FRONT CAM',
  side: 'TRACKING',
  orbit: 'FREE CAM',
  overview: 'OVERVIEW',
};
const PRIORITY: Record<LabelKind, number> = { follow: 0, sc: 1, rival: 2, near: 3 };

/**
 * DOM labels projected from 3D positions (F1-048): only the followed driver,
 * the rival, nearest neighbours and the safety car get labels; elements are
 * reused and moved with transforms (no React re-render, no per-frame
 * allocations). Overlapping labels stack upwards with a stretched stem.
 * Also owns the sector zone tags and the broadcast camera tag.
 */
export class LabelLayer {
  private root: HTMLElement;
  private els = new Map<string, HTMLDivElement>();
  private positions = new Map<string, number>();
  private zoneEls: HTMLDivElement[] = [];
  private camTag: HTMLDivElement;
  private fx: HTMLDivElement;
  private camTimer = 0;
  private v = new THREE.Vector3();
  private placed: Array<{ x: number; y: number }> = [];
  private seen = new Set<string>();
  private sorted: LabelTarget[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.camTag = document.createElement('div');
    this.camTag.className = 'cam-tag';
    this.camTag.innerHTML = '<span class="cam-tag__dot"></span><span class="cam-tag__name"></span>';
    root.appendChild(this.camTag);
    this.fx = document.createElement('div');
    this.fx.className = 'scene-fx';
    root.appendChild(this.fx);
  }

  /** Full-frame moment flash (overtake / fastest lap / safety car / finish). */
  flash(kind: 'overtake' | 'fastest' | 'sc' | 'finish'): void {
    delete this.fx.dataset.fx;
    void this.fx.offsetWidth;
    this.fx.dataset.fx = kind;
  }

  setPositions(map: Map<string, number>): void {
    this.positions = map;
  }

  /** Broadcast tag ("TV CAM", "ONBOARD"…) — fades in on every cut. */
  setShot(shot: CameraShot): void {
    const name = this.camTag.lastElementChild as HTMLElement;
    name.textContent = SHOT_NAMES[shot] ?? shot.toUpperCase();
    this.camTag.classList.remove('cam-tag--cut');
    window.clearTimeout(this.camTimer);
    // Restart the cut animation.
    void this.camTag.offsetWidth;
    this.camTag.classList.add('cam-tag--cut');
    this.camTimer = window.setTimeout(() => this.camTag.classList.remove('cam-tag--cut'), 900);
  }

  private ensure(id: string, kind: LabelKind): HTMLDivElement {
    let el = this.els.get(id);
    if (!el) {
      el = document.createElement('div');
      if (kind === 'sc') {
        el.className = 'car-label car-label--sc';
        el.innerHTML = '<span class="car-label__code">SAFETY CAR</span>';
      } else {
        const d = DRIVER_BY_ID[id];
        const team = d ? TEAM_BY_ID[d.teamId] : undefined;
        el.className = 'car-label';
        el.style.setProperty('--team', team?.color ?? '#fff');
        el.innerHTML = `<span class="car-label__pos"></span><span class="car-label__bar"></span><span class="car-label__code">${d?.code ?? id}</span>`;
      }
      this.root.appendChild(el);
      this.els.set(id, el);
    }
    return el;
  }

  private project(p: THREE.Vector3, lift: number, camera: THREE.Camera, w: number, h: number): boolean {
    this.v.set(p.x, p.y + lift, p.z).project(camera);
    if (this.v.z > 1 || this.v.z < -1) return false;
    this.v.x = ((this.v.x + 1) / 2) * w;
    this.v.y = ((1 - this.v.y) / 2) * h;
    return true;
  }

  update(camera: THREE.Camera, container: HTMLElement, targets: LabelTarget[], zones: ZoneTag[] | null = null, selectedZone: number | null = null): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const seen = this.seen;
    seen.clear();
    this.placed.length = 0;
    const sorted = this.sorted;
    sorted.length = 0;
    for (const t of targets) sorted.push(t);
    sorted.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
    for (const t of sorted) {
      if (!this.project(t.pos, t.kind === 'sc' ? 2.4 : 1.9, camera, w, h)) continue;
      const x = this.v.x;
      const y = this.v.y;
      if (x < -60 || x > w + 60 || y < -40 || y > h + 40) continue;
      // Declutter: stack upwards over already placed labels.
      let stem = 14;
      for (let k = 0; k < 4; k++) {
        let hit = false;
        for (const p of this.placed) {
          if (Math.abs(p.x - x) < 64 && Math.abs(p.y - (y - stem)) < 22) {
            hit = true;
            break;
          }
        }
        if (!hit) break;
        stem += 24;
      }
      this.placed.push({ x, y: y - stem });
      const el = this.ensure(t.id, t.kind);
      seen.add(t.id);
      if (el.dataset.kind !== t.kind) el.dataset.kind = t.kind;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.setProperty('--stem', `${stem}px`);
      el.style.display = '';
      if (t.kind !== 'sc') {
        const pos = this.positions.get(t.id);
        const pe = el.firstElementChild as HTMLElement;
        const txt = pos ? String(pos) : '';
        if (pe.textContent !== txt) pe.textContent = txt;
      }
    }
    for (const [id, el] of this.els) if (!seen.has(id) && el.style.display !== 'none') el.style.display = 'none';

    // Sector tags.
    if (zones) {
      while (this.zoneEls.length < zones.length) {
        const el = document.createElement('div');
        const n = this.zoneEls.length + 1;
        el.className = 'zone-tag';
        el.dataset.zone = String(n);
        el.innerHTML = `<span class="zone-tag__s">S${n}</span>`;
        this.root.appendChild(el);
        this.zoneEls.push(el);
      }
    }
    for (let i = 0; i < this.zoneEls.length; i++) {
      const el = this.zoneEls[i]!;
      const z = zones?.[i];
      if (!z || !this.project(z.pos, 0, camera, w, h) || this.v.x < -40 || this.v.x > w + 40 || this.v.y < -30 || this.v.y > h + 30) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.transform = `translate3d(${this.v.x.toFixed(1)}px, ${this.v.y.toFixed(1)}px, 0)`;
      const sel = selectedZone === z.sector ? 'true' : selectedZone ? 'dim' : 'false';
      if (el.dataset.selected !== sel) el.dataset.selected = sel;
    }
  }

  dispose(): void {
    window.clearTimeout(this.camTimer);
    for (const el of this.els.values()) el.remove();
    for (const el of this.zoneEls) el.remove();
    this.camTag.remove();
    this.fx.remove();
    this.els.clear();
    this.zoneEls = [];
  }
}
