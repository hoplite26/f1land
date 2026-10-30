import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TrackGeometry } from '@/data/circuits/geometry';

export type CameraMode = 'director' | 'follow' | 'tv' | 'heli' | 'onboard' | 'orbit' | 'overview';

/** Concrete broadcast shots the director cuts between. */
export type CameraShot = 'follow' | 'tv' | 'heli' | 'onboard' | 'front' | 'side' | 'orbit' | 'overview';

export type CameraCue = 'start' | 'overtake' | 'battle' | 'sc' | 'pit' | 'finish' | 'fastest';

export interface CameraSubject {
  pos: THREE.Vector3;
  /** Unit forward vector (world). */
  fwd: THREE.Vector3;
  speed: number;
  s: number;
}

export interface TvSpotLike {
  s: number;
  pos: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);
const SHOT_LIST: Array<{ shot: Exclude<CameraShot, 'orbit' | 'overview'>; w: number; min: number; max: number }> = [
  { shot: 'tv', w: 4, min: 5, max: 8 },
  { shot: 'follow', w: 3, min: 6, max: 9 },
  { shot: 'heli', w: 2, min: 6, max: 9 },
  { shot: 'side', w: 1.6, min: 4, max: 6 },
  { shot: 'front', w: 1.4, min: 4, max: 6 },
  { shot: 'onboard', w: 1.2, min: 5, max: 7 },
];

/**
 * Broadcast-style camera rig: track-guided chase, elevated trackside TV
 * cameras with long lenses, orbiting helicopter, T-cam onboard, front and
 * side tracking shots, free orbit (touch) and a fitted full-track overview.
 *
 * Track-guided shots sample the centreline instead of the car's heading, so
 * they stay inside the racing corridor (never inside stands or walls).
 * Explicit mode changes blend over ~0.7 s; director cuts are hard cuts or
 * short swoops; reduced motion snaps instantly.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  mode: CameraMode = 'director';
  frozen = false;
  reducedMotion = false;
  private track: TrackGeometry | null = null;
  private halfWidth = 6;
  private barrier: (s: number, side: 1 | -1) => number = () => 12;
  private tvSpots: TvSpotLike[] = [];
  private activeTv = -1;
  // Smoothed pose.
  private pos = new THREE.Vector3(0, 300, 300);
  private look = new THREE.Vector3();
  private fov = 50;
  // Ideal pose of the current shot.
  private idealPos = new THREE.Vector3();
  private idealLook = new THREE.Vector3();
  private idealFov = 50;
  // Transition snapshot.
  private fromPos = new THREE.Vector3();
  private fromLook = new THREE.Vector3();
  private fromFov = 50;
  private transT = 1;
  private transDur = 0;
  private shot: CameraShot = 'follow';
  private lastShot: CameraShot | null = null;
  private shotUntil = 0;
  private time = 0;
  private cueUntil = 0;
  private seed = 1;
  private heliAngle = 0;
  private punch = 0;
  private subjectLat = 0;
  private overviewTarget = new THREE.Vector3();
  private overviewOffset = new THREE.Vector3(0, 900, 600);
  private boundsW = 1200;
  private boundsH = 1200;
  /** Viewport height fractions covered by screen UI (top strip / bottom cards). */
  private insetTop = 0;
  private insetBottom = 0;
  private viewH = 1;
  private lastSubjectPos = new THREE.Vector3();
  private orbitInit = false;
  private fly: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private p2: [number, number] = [0, 0];
  private hasPose = false;
  /** The camera has shown at least one frame (fly-ins need a start pose). */
  private posed = false;
  /** Showing the whole-circuit establishing view while no car is on screen yet (feed syncing). */
  private establishing = false;
  /** Called when the visible shot changes (for the on-screen camera tag). */
  onShot: ((shot: CameraShot) => void) | null = null;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 12000);
    this.camera.position.copy(this.pos);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 4200;
    this.controls.enabled = false;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
  }

  setTrack(track: TrackGeometry, halfWidth: number, bounds: { minX: number; maxX: number; minY: number; maxY: number }): void {
    this.track = track;
    this.halfWidth = halfWidth;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.overviewTarget.set(cx, 0, -cy);
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    this.fitOverview(w, h);
    if (!this.tvSpots.length) {
      // Fallback spots (no environment): outside of upcoming corners.
      const n = Math.max(6, Math.floor(track.length / 260));
      for (let i = 0; i < n; i++) {
        const s = (i * track.length) / n;
        const side = track.curvatureAt(s + 60) > 0 ? -1 : 1;
        const p = track.pointAt(s, side * (halfWidth + 22));
        this.tvSpots.push({ s, pos: new THREE.Vector3(p[0], 16, -p[1]) });
      }
    }
  }

  /** Elevated broadcast positions (towers / stand roofs) from the environment. */
  setTvSpots(spots: TvSpotLike[]): void {
    if (spots.length) this.tvSpots = spots;
    this.activeTv = -1;
  }

  /** Barrier distance per side so track-guided shots stay inside the walls. */
  setCorridor(barrier: (s: number, side: 1 | -1) => number): void {
    this.barrier = barrier;
  }

  /**
   * Screen UI covering the top/bottom of the canvas (px of a viewport `heightPx` tall):
   * the projection centre moves into the free band and the overview is fitted into it.
   */
  setInsets(topPx: number, bottomPx: number, heightPx: number): void {
    const h = Math.max(1, heightPx);
    this.viewH = h;
    this.insetTop = THREE.MathUtils.clamp(topPx / h, 0, 0.45);
    this.insetBottom = THREE.MathUtils.clamp(bottomPx / h, 0, 0.45);
    this.applyViewOffset();
    if (this.track) this.fitOverview(this.boundsW, this.boundsH);
  }

  private applyViewOffset(): void {
    const shift = ((this.insetTop - this.insetBottom) / 2) * this.viewH;
    if (Math.abs(shift) < 0.5) this.camera.clearViewOffset();
    else {
      const w = Math.round(this.viewH * this.camera.aspect);
      this.camera.setViewOffset(w, this.viewH, 0, -shift, w, this.viewH);
    }
  }

  private fitOverview(w: number, h: number): void {
    this.boundsW = w;
    this.boundsH = h;
    const aspect = this.camera.aspect;
    // Vertical half-angle of the band left free by the screen UI.
    const vf = Math.atan(Math.tan(THREE.MathUtils.degToRad(45) / 2) * Math.max(0.4, 1 - this.insetTop - this.insetBottom));
    const portrait = aspect < 1;
    const pitch = THREE.MathUtils.degToRad(portrait ? 56 : 50);
    // Portrait phones: put the long axis of the circuit into screen depth; landscape: across the screen.
    const longX = w >= h;
    const horizontal = portrait ? Math.min(w, h) : Math.max(w, h);
    const depth = portrait ? Math.max(w, h) : Math.min(w, h);
    const distH = horizontal / 2 / (Math.tan(THREE.MathUtils.degToRad(45) / 2) * aspect);
    const distV = ((depth / 2) * Math.sin(pitch)) / Math.tan(vf);
    const dist = Math.max(distH, distV) * 1.08 + 60;
    const alongX = portrait ? longX : !longX;
    const dir = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    this.overviewOffset.copy(dir).multiplyScalar(Math.cos(pitch) * dist).addScaledVector(UP, Math.sin(pitch) * dist);
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.enabled = mode === 'orbit' || mode === 'overview';
    this.orbitInit = false;
    this.fly = null;
    this.shotUntil = 0;
    this.cueUntil = 0;
    this.beginTransition(this.reducedMotion ? 0 : 0.75);
    this.hasPose = false;
  }

  /** No transition or fly-in in progress. */
  get settled(): boolean {
    const orbit = this.mode === 'orbit' || this.mode === 'overview';
    return this.fly === null && this.hasPose && (orbit || (this.transT >= 1 && this.pos.distanceTo(this.idealPos) < 2));
  }

  /** Current concrete shot (director resolves to one of these). */
  get currentShot(): CameraShot {
    return this.shot;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.applyViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.track) this.fitOverview(this.boundsW, this.boundsH);
  }

  /** Race event hint for the director (and a short lens "punch" for emphasis). */
  cue(kind: CameraCue): void {
    if (!this.reducedMotion && (kind === 'overtake' || kind === 'fastest' || kind === 'finish')) this.punch = 1;
    if (this.mode !== 'director') return;
    const pick: Record<CameraCue, Exclude<CameraShot, 'orbit' | 'overview'>> = {
      start: 'front',
      overtake: this.shot === 'tv' ? 'side' : 'tv',
      battle: 'follow',
      sc: 'heli',
      pit: 'tv',
      finish: 'side',
      fastest: 'tv',
    };
    if (this.time < this.cueUntil && kind !== 'start' && kind !== 'finish' && kind !== 'sc') return;
    this.setShot(pick[kind], kind === 'start' ? 7 : 5.5, true);
    this.cueUntil = this.time + 6;
  }

  private beginTransition(dur: number): void {
    this.fromPos.copy(this.pos);
    this.fromLook.copy(this.look);
    this.fromFov = this.fov;
    this.transDur = dur;
    this.transT = dur > 0 ? 0 : 1;
  }

  private setShot(shot: CameraShot, hold: number, cut: boolean): void {
    const prev = this.shot;
    this.shot = shot;
    this.shotUntil = this.time + hold;
    this.activeTv = -1;
    if (shot === 'heli') this.heliAngle = this.rand() * Math.PI * 2;
    // TV/onboard/front/side are hard cuts (broadcast grammar); heli ↔ chase swoops.
    const swoop = !cut && (shot === 'heli' || prev === 'heli') && !this.reducedMotion;
    this.beginTransition(swoop ? 1.1 : 0);
    this.hasPose = false;
    if (shot !== this.lastShot) this.onShot?.(shot);
    this.lastShot = shot;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private nextDirectorShot(): void {
    let total = 0;
    for (const s of SHOT_LIST) if (s.shot !== this.shot) total += s.w;
    let r = this.rand() * total;
    let pick = SHOT_LIST[0]!;
    for (const s of SHOT_LIST) {
      if (s.shot === this.shot) continue;
      r -= s.w;
      if (r <= 0) {
        pick = s;
        break;
      }
    }
    this.setShot(pick.shot, pick.min + this.rand() * (pick.max - pick.min), false);
  }

  private pickTv(subject: CameraSubject): TvSpotLike | null {
    const track = this.track;
    if (!this.tvSpots.length || !track) return null;
    // Camera the subject is approaching (ahead by up to ~300 m); keep it until passed by ~60 m.
    if (this.activeTv >= 0) {
      const cur = this.tvSpots[this.activeTv]!;
      const d = track.delta(subject.s, cur.s);
      if (d > -60 && d < 340) return cur;
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.tvSpots.length; i++) {
      const d = track.delta(subject.s, this.tvSpots[i]!.s);
      if (d > 25 && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best !== this.activeTv && this.activeTv >= 0 && !this.reducedMotion) this.hasPose = false; // hard cut to the next tower
    this.activeTv = best;
    return best >= 0 ? this.tvSpots[best]! : null;
  }

  /** World point on the track at (s, lateral), clamped inside the barriers. */
  private onTrack(s: number, lat: number, h: number, out: THREE.Vector3): THREE.Vector3 {
    const t = this.track!;
    const side: 1 | -1 = lat >= 0 ? 1 : -1;
    const lim = Math.max(this.halfWidth, this.barrier(s, side) - 1.5);
    const l = Math.max(-lim, Math.min(lim, lat));
    t.pointAt(s, l, this.p2);
    return out.set(this.p2[0], h, -this.p2[1]);
  }

  update(dt: number, subject: CameraSubject | null, track: TrackGeometry | null, timeSec: number): void {
    this.time = timeSec;
    if (track && !this.track) this.track = track;
    if (this.frozen) {
      if (this.controls.enabled) this.controls.update();
      return;
    }
    this.punch = Math.max(0, this.punch - dt * 1.6);

    if (this.mode === 'orbit' || this.mode === 'overview') {
      this.updateOrbit(dt, subject);
      return;
    }
    if (!subject || !this.track) {
      if (this.track) this.establish();
      return;
    }

    // Resolve the shot.
    if (this.mode === 'director') {
      if (timeSec >= this.shotUntil) this.nextDirectorShot();
    } else if (this.shot !== this.mode) {
      this.shot = this.mode as CameraShot;
      this.activeTv = -1;
      this.onShot?.(this.shot);
      this.lastShot = this.shot;
    }
    if (this.establishing) {
      // First car on screen after the establishing view: swoop down instead of a hard cut.
      this.establishing = false;
      this.beginTransition(this.reducedMotion ? 0 : 1.6);
      this.hasPose = false;
      if (this.lastShot !== this.shot) {
        this.onShot?.(this.shot);
        this.lastShot = this.shot;
      }
    }

    // Subject lateral (for track-guided framing).
    const pr = this.track.project(subject.pos.x, -subject.pos.z, subject.s, 40);
    this.subjectLat += (pr.lateral - this.subjectLat) * Math.min(1, dt * 4);
    const s = pr.s;
    const lat = this.subjectLat;
    const f = subject.fwd;
    const v = subject.speed;
    let stiffPos = 10;
    let stiffLook = 14;
    // Pit lane / garage: track-guided framing makes no sense there.
    const offTrack = pr.distance > this.halfWidth + 5;
    let shot = this.shot;
    if (offTrack && (shot === 'follow' || shot === 'side' || shot === 'front')) shot = v < 3 ? 'front' : 'follow';
    switch (shot) {
      case 'follow': {
        if (offTrack) {
          this.idealPos.copy(subject.pos).addScaledVector(f, -12).addScaledVector(UP, 4.5);
          this.idealLook.copy(subject.pos).addScaledVector(f, 6).addScaledVector(UP, 0.8);
          this.idealFov = 56;
          stiffPos = 6;
          break;
        }
        const back = 7.2 + Math.min(3, v * 0.03);
        this.onTrack(s - back, lat * 0.85, 2.25 + Math.min(0.6, v * 0.006), this.idealPos);
        this.idealLook.copy(subject.pos).addScaledVector(f, 10).addScaledVector(UP, 0.7);
        this.idealFov = 56 + Math.min(12, v * 0.1);
        stiffPos = 10;
        break;
      }
      case 'heli': {
        this.heliAngle += dt * 0.1;
        // Steep (~56°) so grandstands and pit buildings beside the track never hide the car.
        const r = 48;
        const a = this.heliAngle;
        this.idealPos.copy(subject.pos).add(this.tmp.set(Math.cos(a) * r, 72, Math.sin(a) * r)).addScaledVector(f, 14);
        this.idealLook.copy(subject.pos).addScaledVector(f, 5);
        this.idealFov = 34;
        stiffPos = 3;
        stiffLook = 8;
        break;
      }
      case 'onboard': {
        this.idealPos.copy(subject.pos).addScaledVector(f, -0.55).addScaledVector(UP, 1.2);
        this.idealLook.copy(subject.pos).addScaledVector(f, 30).addScaledVector(UP, 0.55);
        if (!this.reducedMotion) {
          const j = Math.min(1, v / 90) * 0.012;
          this.idealPos.y += Math.sin(timeSec * 47) * j + Math.sin(timeSec * 31) * j * 0.6;
        }
        this.idealFov = 74;
        stiffPos = 1000;
        stiffLook = 1000;
        break;
      }
      case 'front': {
        const ahead = 13 + Math.min(10, v * 0.09);
        if (offTrack) this.idealPos.copy(subject.pos).addScaledVector(f, 11).addScaledVector(UP, 2.6);
        else this.onTrack(s + ahead, lat * 0.6, 1.5, this.idealPos);
        this.idealLook.copy(subject.pos).addScaledVector(UP, 0.6);
        this.idealFov = 38;
        stiffPos = 8;
        break;
      }
      case 'side': {
        const sideSign = lat > 0 ? -1 : 1;
        this.onTrack(s + 1.5, lat + sideSign * 7.5, 1.4, this.idealPos);
        this.idealLook.copy(subject.pos).addScaledVector(f, 2).addScaledVector(UP, 0.5);
        this.idealFov = 48;
        stiffPos = 7;
        break;
      }
      case 'tv':
      default: {
        const cam = this.pickTv(subject);
        if (cam) {
          this.idealPos.copy(cam.pos);
          this.idealLook.copy(subject.pos).addScaledVector(f, Math.min(8, v * 0.08)).addScaledVector(UP, 0.4);
          const dist = cam.pos.distanceTo(subject.pos);
          // Long lens: the car fills about a third of the frame width on any aspect
          // (portrait phones need a taller frame), widening as it gets close.
          const frameH = THREE.MathUtils.clamp(18 / Math.max(0.3, this.camera.aspect), 10, 32);
          this.idealFov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(frameH / 2 / Math.max(1, dist))), 3, 68);
          stiffPos = 1000;
          stiffLook = 7;
        } else {
          this.idealPos.copy(subject.pos).addScaledVector(UP, 40);
          this.idealLook.copy(subject.pos);
        }
        break;
      }
    }
    this.idealFov -= this.punch * 5;

    if (!this.hasPose || this.reducedMotion) {
      this.pos.copy(this.idealPos);
      this.look.copy(this.idealLook);
      this.fov = this.idealFov;
      this.hasPose = true;
    } else {
      this.pos.lerp(this.idealPos, stiffPos >= 1000 ? 1 : 1 - Math.exp(-dt * stiffPos));
      this.look.lerp(this.idealLook, stiffLook >= 1000 ? 1 : 1 - Math.exp(-dt * stiffLook));
      this.fov += (this.idealFov - this.fov) * Math.min(1, dt * 5);
    }
    this.applyPose(dt);
  }

  /** Static whole-circuit view used until the first frame of the feed arrives. */
  private establish(): void {
    this.idealPos.copy(this.overviewTarget).add(this.overviewOffset);
    this.idealLook.copy(this.overviewTarget);
    this.pos.copy(this.idealPos);
    this.look.copy(this.idealLook);
    this.fov = 45;
    this.transT = 1;
    this.establishing = true;
    if (this.lastShot !== 'overview') {
      this.onShot?.('overview');
      this.lastShot = 'overview';
    }
    this.applyPose(0);
  }

  private applyPose(dt: number): void {
    let p = this.pos;
    let l = this.look;
    let fov = this.fov;
    if (this.transT < 1 && this.transDur > 0) {
      this.transT = Math.min(1, this.transT + dt / this.transDur);
      const k = easeInOut(this.transT);
      p = this.tmp.copy(this.fromPos).lerp(this.pos, k);
      l = this.tmp2.copy(this.fromLook).lerp(this.look, k);
      // Lift the camera through the swoop so it never cuts through scenery.
      p.y += Math.sin(k * Math.PI) * Math.min(40, this.fromPos.distanceTo(this.pos) * 0.25);
      fov = this.fromFov + (fov - this.fromFov) * k;
    }
    p.y = Math.max(0.8, p.y);
    this.posed = true;
    this.camera.position.copy(p);
    this.camera.lookAt(l);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateOrbit(dt: number, subject: CameraSubject | null): void {
    const mode = this.mode;
    const shot: CameraShot = mode === 'orbit' ? 'orbit' : 'overview';
    if (this.shot !== shot) {
      this.shot = shot;
      this.onShot?.(shot);
      this.lastShot = shot;
    }
    if (!this.orbitInit) {
      this.orbitInit = true;
      const toTarget = new THREE.Vector3();
      const toPos = new THREE.Vector3();
      if (mode === 'overview') {
        toTarget.copy(this.overviewTarget);
        toPos.copy(this.overviewTarget).add(this.overviewOffset);
      } else if (subject) {
        toTarget.copy(subject.pos);
        toPos.copy(subject.pos).add(this.tmp.set(-subject.fwd.x * 16 + 12, 11, -subject.fwd.z * 16 + 6));
      } else {
        toTarget.copy(this.overviewTarget);
        toPos.copy(this.overviewTarget).add(this.overviewOffset);
      }
      this.camera.fov = mode === 'overview' ? 45 : 50;
      this.camera.updateProjectionMatrix();
      if (this.reducedMotion || !this.posed) {
        this.camera.position.copy(toPos);
        this.controls.target.copy(toTarget);
      } else {
        this.fly = { fromPos: this.camera.position.clone(), fromTarget: this.look.clone(), toPos, toTarget, t: 0 };
      }
      if (subject) this.lastSubjectPos.copy(subject.pos);
    }
    if (mode === 'orbit' && subject) {
      // Keep orbiting around the moving subject.
      const delta = this.tmp.copy(subject.pos).sub(this.lastSubjectPos);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      if (this.fly) {
        this.fly.toPos.add(delta);
        this.fly.toTarget.add(delta);
      }
      this.lastSubjectPos.copy(subject.pos);
    }
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / 0.9);
      const k = easeInOut(this.fly.t);
      this.camera.position.copy(this.fly.fromPos).lerp(this.fly.toPos, k);
      this.controls.target.copy(this.fly.fromTarget).lerp(this.fly.toTarget, k);
      if (this.fly.t >= 1) this.fly = null;
    }
    this.controls.update();
    this.pos.copy(this.camera.position);
    this.look.copy(this.controls.target);
    this.fov = this.camera.fov;
    this.hasPose = true;
    this.posed = true;
  }

  /** Smoothly frame an arbitrary point (e.g. a selected sector) in overview mode. */
  frameZone(center: THREE.Vector3, radius: number): void {
    this.setMode('overview');
    this.orbitInit = true;
    const dist = Math.max(140, radius * 1.7);
    const toPos = center.clone().add(new THREE.Vector3(dist * 0.35, dist * 0.82, dist * 0.6));
    this.camera.fov = 45;
    this.camera.updateProjectionMatrix();
    if (this.reducedMotion || !this.posed) {
      this.controls.target.copy(center);
      this.camera.position.copy(toPos);
      this.fly = null;
    } else {
      this.fly = { fromPos: this.camera.position.clone(), fromTarget: this.look.clone(), toPos, toTarget: center.clone(), t: 0 };
    }
    this.lastSubjectPos.copy(center);
  }

  dispose(): void {
    this.controls.dispose();
    this.onShot = null;
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
