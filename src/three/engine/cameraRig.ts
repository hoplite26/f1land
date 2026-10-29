import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TrackGeometry } from '@/data/circuits/geometry';

export type CameraMode = 'director' | 'follow' | 'tv' | 'heli' | 'onboard' | 'orbit' | 'overview';

export interface CameraSubject {
  pos: THREE.Vector3;
  /** Unit forward vector (world). */
  fwd: THREE.Vector3;
  speed: number;
  s: number;
}

interface TvCam {
  s: number;
  pos: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Broadcast-style camera rig: chase, trackside TV cameras, helicopter,
 * T-cam onboard, free orbit (touch) and full-track overview. Framing
 * changes ease over ~280 ms (F1-050); reduced motion snaps instantly.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  mode: CameraMode = 'director';
  frozen = false;
  reducedMotion = false;
  private tvCams: TvCam[] = [];
  private activeTv = -1;
  private pos = new THREE.Vector3(0, 300, 300);
  private look = new THREE.Vector3();
  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private fov = 50;
  private blend = 1;
  private directorShot: Exclude<CameraMode, 'director' | 'orbit' | 'overview'> = 'follow';
  private directorUntil = 0;
  private overviewTarget = new THREE.Vector3();
  private overviewDist = 1200;
  private trackRadius = 600;
  private lastSubjectPos = new THREE.Vector3();
  private orbitInit = false;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 9000);
    this.camera.position.copy(this.pos);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 3500;
    this.controls.enabled = false;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.screenSpacePanning = false;
  }

  setTrack(track: TrackGeometry, halfWidth: number, bounds: { minX: number; maxX: number; minY: number; maxY: number }): void {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.overviewTarget.set(cx, 0, -cy);
    this.trackRadius = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
    this.overviewDist = this.trackRadius * 2.1;
    this.tvCams = [];
    const spacing = 210;
    const n = Math.max(6, Math.floor(track.length / spacing));
    for (let i = 0; i < n; i++) {
      const s = (i * track.length) / n;
      const k = track.curvatureAt(s + 60);
      const side = k > 0 ? -1 : 1; // outside of the upcoming corner
      const off = halfWidth + 26 + ((i * 37) % 22);
      const p = track.pointAt(s, side * off);
      this.tvCams.push({ s, pos: new THREE.Vector3(p[0], 9 + ((i * 13) % 9), -p[1]) });
    }
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.blend = this.reducedMotion ? 1 : 0;
    this.controls.enabled = mode === 'orbit' || mode === 'overview';
    this.orbitInit = false;
    this.directorUntil = 0;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private pickTv(subject: CameraSubject, track: TrackGeometry): TvCam | null {
    if (!this.tvCams.length) return null;
    // Choose the camera the subject is approaching (ahead by 0..240 m) — switch after passing it by 70 m.
    if (this.activeTv >= 0) {
      const cur = this.tvCams[this.activeTv]!;
      const d = track.delta(subject.s, cur.s);
      if (d > -70 && d < 320) return cur;
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.tvCams.length; i++) {
      const d = track.delta(subject.s, this.tvCams[i]!.s);
      if (d > 30 && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.activeTv = best;
    return best >= 0 ? this.tvCams[best]! : null;
  }

  update(dt: number, subject: CameraSubject | null, track: TrackGeometry | null, timeSec: number): void {
    if (this.frozen) {
      if (this.controls.enabled) this.controls.update();
      return;
    }
    let mode: CameraMode = this.mode;
    if (mode === 'director') {
      if (timeSec > this.directorUntil) {
        const shots: Array<typeof this.directorShot> = ['follow', 'tv', 'heli', 'tv', 'follow', 'onboard', 'tv'];
        this.directorShot = shots[Math.floor(timeSec / 7.5) % shots.length]!;
        this.directorUntil = timeSec + 6 + (Math.floor(timeSec) % 4);
        this.blend = this.reducedMotion ? 1 : Math.min(this.blend, 0.15);
      }
      mode = this.directorShot;
    }

    if (mode === 'orbit' || mode === 'overview') {
      if (!this.orbitInit) {
        this.orbitInit = true;
        if (mode === 'overview') {
          this.controls.target.copy(this.overviewTarget);
          if (!this.reducedMotion) this.camera.position.copy(this.overviewTarget).add(new THREE.Vector3(0, this.overviewDist * 0.85, this.overviewDist * 0.55));
          else this.camera.position.copy(this.overviewTarget).add(new THREE.Vector3(0, this.overviewDist * 0.85, this.overviewDist * 0.55));
          this.camera.fov = 45;
        } else if (subject) {
          this.controls.target.copy(subject.pos);
          this.camera.position.copy(subject.pos).add(new THREE.Vector3(18, 12, 18));
          this.camera.fov = 50;
        }
        this.camera.updateProjectionMatrix();
        if (subject) this.lastSubjectPos.copy(subject.pos);
      }
      if (mode === 'orbit' && subject) {
        // Keep orbiting around the moving subject.
        const delta = subject.pos.clone().sub(this.lastSubjectPos);
        this.controls.target.add(delta);
        this.camera.position.add(delta);
        this.lastSubjectPos.copy(subject.pos);
      }
      this.controls.update();
      this.pos.copy(this.camera.position);
      this.look.copy(this.controls.target);
      return;
    }

    if (!subject || !track) return;
    let fov = 50;
    const f = subject.fwd;
    switch (mode) {
      case 'follow': {
        const back = 11 + Math.min(6, subject.speed * 0.05);
        this.desiredPos.copy(subject.pos).addScaledVector(f, -back).addScaledVector(UP, 3.4);
        this.desiredLook.copy(subject.pos).addScaledVector(f, 9).addScaledVector(UP, 0.8);
        fov = 56 + Math.min(10, subject.speed * 0.1);
        break;
      }
      case 'heli': {
        this.desiredPos.copy(subject.pos).addScaledVector(f, -38).addScaledVector(UP, 62);
        this.desiredLook.copy(subject.pos).addScaledVector(f, 18);
        fov = 42;
        break;
      }
      case 'onboard': {
        this.desiredPos.copy(subject.pos).addScaledVector(f, -0.55).addScaledVector(UP, 1.22);
        this.desiredLook.copy(subject.pos).addScaledVector(f, 30).addScaledVector(UP, 0.6);
        fov = 72;
        break;
      }
      case 'tv':
      default: {
        const cam = this.pickTv(subject, track);
        if (cam) {
          this.desiredPos.copy(cam.pos);
          this.desiredLook.copy(subject.pos).addScaledVector(f, 4);
          const dist = cam.pos.distanceTo(subject.pos);
          fov = THREE.MathUtils.clamp((2 * Math.atan(16 / Math.max(1, dist)) * 180) / Math.PI, 7, 55);
        } else {
          this.desiredPos.copy(subject.pos).addScaledVector(UP, 40);
          this.desiredLook.copy(subject.pos);
        }
        break;
      }
    }
    // Ease framing changes (~280 ms), then stiffly track.
    this.blend = Math.min(1, this.blend + dt / 0.28);
    const stiff = mode === 'tv' ? 1 : mode === 'onboard' ? 1 : 1 - Math.exp(-dt * (mode === 'heli' ? 4 : 9));
    const k = this.reducedMotion ? 1 : this.blend < 1 ? easeOut(this.blend) * 0.35 + stiff * 0.2 : stiff;
    if (mode === 'tv' && this.blend >= 1) {
      this.pos.copy(this.desiredPos);
    } else {
      this.pos.lerp(this.desiredPos, Math.min(1, k));
    }
    if (mode === 'onboard') this.look.copy(this.desiredLook);
    else this.look.lerp(this.desiredLook, Math.min(1, this.blend < 1 ? 0.3 : 1 - Math.exp(-dt * 14)));
    this.fov += (fov - this.fov) * Math.min(1, dt * 6);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Instant framing of an arbitrary point (e.g. a selected sector). */
  frameZone(center: THREE.Vector3, radius: number): void {
    this.setMode('overview');
    this.orbitInit = true;
    this.controls.target.copy(center);
    const dist = Math.max(120, radius * 1.6);
    this.camera.position.copy(center).add(new THREE.Vector3(dist * 0.35, dist * 0.8, dist * 0.6));
    this.camera.fov = 45;
    this.camera.updateProjectionMatrix();
    this.lastSubjectPos.copy(center);
  }

  dispose(): void {
    this.controls.dispose();
  }
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
