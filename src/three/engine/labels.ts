import type * as THREE from 'three';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';

/**
 * DOM labels projected from 3D positions (F1-048): only the followed driver,
 * the rival and nearest neighbours get labels; elements are reused and
 * moved with transforms (no React re-render per frame).
 */
export class LabelLayer {
  private root: HTMLElement;
  private els = new Map<string, HTMLDivElement>();
  private positions = new Map<string, number>();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  setPositions(map: Map<string, number>): void {
    this.positions = map;
  }

  private ensure(id: string): HTMLDivElement {
    let el = this.els.get(id);
    if (!el) {
      const d = DRIVER_BY_ID[id];
      const team = d ? TEAM_BY_ID[d.teamId] : undefined;
      el = document.createElement('div');
      el.className = 'car-label';
      el.style.setProperty('--team', team?.color ?? '#fff');
      el.innerHTML = `<span class="car-label__pos"></span><span class="car-label__bar"></span><span class="car-label__code">${d?.code ?? id}</span>`;
      this.root.appendChild(el);
      this.els.set(id, el);
    }
    return el;
  }

  update(camera: THREE.Camera, container: HTMLElement, targets: Array<{ id: string; pos: THREE.Vector3; kind: 'follow' | 'rival' | 'near' }>): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const seen = new Set<string>();
    for (const t of targets) {
      const v = t.pos.clone().setY(t.pos.y + 2.2).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h;
      if (x < -60 || x > w + 60 || y < -40 || y > h + 40) continue;
      const el = this.ensure(t.id);
      seen.add(t.id);
      el.dataset.kind = t.kind;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      el.style.display = '';
      const pos = this.positions.get(t.id);
      const pe = el.firstElementChild as HTMLElement;
      const txt = pos ? `P${pos}` : '';
      if (pe.textContent !== txt) pe.textContent = txt;
    }
    for (const [id, el] of this.els) if (!seen.has(id)) el.style.display = 'none';
  }

  dispose(): void {
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }
}
