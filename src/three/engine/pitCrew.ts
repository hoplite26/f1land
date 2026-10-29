import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Crew slots relative to the car (forward = +Z): [x, z, yaw, crouch]. */
const SLOTS: Array<[number, number, number, number]> = [
  // wheel gunners + tyre off/on per corner
  [1.45, 1.75, -Math.PI / 2, 0.62], [1.75, 2.35, -Math.PI / 2, 1], [1.75, 1.1, -Math.PI / 2, 1],
  [-1.45, 1.75, Math.PI / 2, 0.62], [-1.75, 2.35, Math.PI / 2, 1], [-1.75, 1.1, Math.PI / 2, 1],
  [1.45, -1.55, -Math.PI / 2, 0.62], [1.75, -0.95, -Math.PI / 2, 1], [1.75, -2.15, -Math.PI / 2, 1],
  [-1.45, -1.55, Math.PI / 2, 0.62], [-1.75, -0.95, Math.PI / 2, 1], [-1.75, -2.15, Math.PI / 2, 1],
  // front / rear jack, lollipop / release
  [0, 3.05, Math.PI, 0.85], [0, -3.0, 0, 0.85], [-0.9, 3.9, Math.PI, 1],
];
const MAX_STOPS = 3;

/**
 * Instanced pit crews (team kit colour) that gather round a car while it is
 * stationary in its box. One draw call for every crew on screen.
 */
export class PitCrews {
  readonly mesh: THREE.InstancedMesh;
  private active = new Map<string, number>();
  private free: number[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private c = new THREE.Color();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor() {
    const legs = new THREE.BoxGeometry(0.36, 0.86, 0.24).translate(0, 0.43, 0);
    const torso = new THREE.BoxGeometry(0.48, 0.6, 0.3).translate(0, 1.16, 0);
    const head = new THREE.SphereGeometry(0.15, 8, 6).translate(0, 1.62, 0);
    const geo = mergeGeometries([legs.toNonIndexed(), torso.toNonIndexed(), head.toNonIndexed()])!;
    legs.dispose();
    torso.dispose();
    head.dispose();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, SLOTS.length * MAX_STOPS);
    this.mesh.name = 'pit-crews';
    this.mesh.frustumCulled = false;
    for (let i = 0; i < this.mesh.count; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.c.set(0xffffff));
    }
    for (let k = MAX_STOPS - 1; k >= 0; k--) this.free.push(k);
  }

  /** Call per car per frame. `stopped` = stationary in its pit box. */
  update(id: string, stopped: boolean, pos: THREE.Vector3, yaw: number, teamColor: string, time: number): void {
    let slot = this.active.get(id);
    if (!stopped) {
      if (slot !== undefined) {
        for (let i = 0; i < SLOTS.length; i++) this.mesh.setMatrixAt(slot * SLOTS.length + i, this.zero);
        this.mesh.instanceMatrix.needsUpdate = true;
        this.active.delete(id);
        this.free.push(slot);
      }
      return;
    }
    if (slot === undefined) {
      slot = this.free.pop();
      if (slot === undefined) return;
      this.active.set(id, slot);
      for (let i = 0; i < SLOTS.length; i++) {
        // Lollipop man in white, the rest in team kit.
        this.mesh.setColorAt(slot * SLOTS.length + i, i === SLOTS.length - 1 ? this.c.set('#f2f4f6') : this.c.set(teamColor));
      }
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (let i = 0; i < SLOTS.length; i++) {
      const [x, z, ry, crouch] = SLOTS[i]!;
      // Busy wheel crew: tiny bob so the stop reads as action, not a diorama.
      const bob = i < 12 ? Math.sin(time * 14 + i) * 0.03 : 0;
      this.p.set(pos.x + x * cs + z * sn, bob, pos.z - x * sn + z * cs);
      this.e.set(0, yaw + ry, 0);
      this.q.setFromEuler(this.e);
      this.sc.set(1, crouch, 1);
      this.m.compose(this.p, this.q, this.sc);
      this.mesh.setMatrixAt(slot * SLOTS.length + i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
