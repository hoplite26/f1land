import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TrackGeometry } from '@/data/circuits/geometry';
import type { SceneColliders } from './colliders';

export type CameraMode = 'director' | 'follow' | 'tv' | 'heli' | 'onboard' | 'orbit' | 'overview';

/** Concrete broadcast shots the director cuts between ('duel' = chase framing both pool drivers, 'idle' = pre-live flyover). */
export type CameraShot = 'follow' | 'duel' | 'tv' | 'heli' | 'onboard' | 'front' | 'side' | 'orbit' | 'overview' | 'idle';

export type CameraCue = 'start' | 'overtake' | 'battle' | 'sc' | 'pit' | 'finish' | 'fastest';

export interface CameraSubject {
  pos: THREE.Vector3;
  /** Unit forward vector (world). */
  fwd: THREE.Vector3;
  speed: number;
  s: number;
  /** Stable id (a change triggers a short reframing glide). */
  id?: string;
}

export interface TvSpotLike {
  s: number;
  pos: THREE.Vector3;
}

type DirectorShot = 'tv' | 'follow' | 'heli' | 'side' | 'front' | 'onboard';

const UP = new THREE.Vector3(0, 1, 0);
const SHOT_LIST: Array<{ shot: DirectorShot; w: number; min: number; max: number }> = [
  { shot: 'tv', w: 4, min: 5, max: 8 },
  { shot: 'follow', w: 3, min: 6, max: 9 },
  { shot: 'heli', w: 2, min: 6, max: 9 },
  { shot: 'side', w: 1.6, min: 4, max: 6 },
  { shot: 'front', w: 1.4, min: 4, max: 6 },
  { shot: 'onboard', w: 1.2, min: 5, max: 7 },
];
/** F1-050: reframing on selection takes 240–320 ms. */
const SELECT_BLEND = 0.28;
const DUEL_MAX_GAP = 150;

/**
 * Broadcast camera rig.
 *
 * Every shot is computed relative to its subject each frame (track arc length,
 * polar angle around the car, fixed tower), and only those parameters are
 * smoothed — so framing never lags behind a fast car even at low frame rates.
 *
 * Occlusion: low shots stay inside the barrier corridor; every shot checks the
 * line of sight against `SceneColliders` (stands, buildings, trees, towers)
 * and pulls in / rises / picks another tower or angle when blocked; chase
 * cameras also rise over nearby cars.
 *
 * Mode changes and subject changes glide in ~0.28 s (F1-050), director cuts
 * are hard cuts (heli swoops), reduced motion snaps. Overview fits the whole
 * circuit to the viewport (biased so a selected sector faces the camera).
 * Without a subject (feed not live yet) the rig flies an idle circuit tour.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  mode: CameraMode = 'director';
  reducedMotion = false;
  private _frozen = false;
  private track: TrackGeometry | null = null;
  private halfWidth = 6;
  private barrier: (s: number, side: 1 | -1) => number = () => 12;
  private colliders: SceneColliders | null = null;
  private cars: readonly THREE.Vector3[] = [];
  private tvSpots: TvSpotLike[] = [];
  private activeTv = -1;
  private tvBlocked = 0;
  // Current pose.
  private pos = new THREE.Vector3(0, 300, 300);
  private look = new THREE.Vector3();
  private fov = 50;
  // Ideal pose of the current shot (this frame).
  private idealPos = new THREE.Vector3();
  private idealLook = new THREE.Vector3();
  private idealFov = 50;
  // Transition snapshot.
  private fromPos = new THREE.Vector3();
  private fromLook = new THREE.Vector3();
  private fromFov = 50;
  private transT = 1;
  private transDur = 0;
  private transLift = 0;
  private shot: CameraShot = 'follow';
  private lastShot: CameraShot | null = null;
  private shotUntil = 0;
  private time = 0;
  private cueUntil = 0;
  private seed = 7;
  private punch = 0;
  private hasPose = false;
  /** The camera has shown at least one frame (fly-ins need a start pose). */
  private posed = false;
  private subjectId: string | undefined = undefined;
  // Smoothed shot parameters (subject-relative).
  private chB = 8;
  private chH = 2.4;
  private chLat = 0;
  private heliA = 0;
  private heliATarget = 0;
  private heliH = 46;
  private subjectLat = 0;
  private sideSign: 1 | -1 = 1;
  // Overview fit.
  private trackPts: THREE.Vector3[] = [];
  private circuitCenter = new THREE.Vector3();
  private circuitRadius = 600;
  private overviewTarget = new THREE.Vector3();
  private overviewPos = new THREE.Vector3(0, 900, 600);
  private overviewAz: number | null = null;
  private zoneFocus: THREE.Vector3 | null = null;
  private userDriven = false;
  private orbitInit = false;
  private lastSubjectPos = new THREE.Vector3();
  private fly: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; t: number; dur: number } | null = null;
  // Idle tour.
  private idleS = 0;
  private gridS = 0;
  private idlePhase: 'grid' | 'orbit' = 'grid';
  private idleT = 0;
  private idleAz = 0.6;
  // Scratch.
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private p2: [number, number] = [0, 0];
  private basis = new THREE.Matrix4();
  private near = 0.3;
  private far = 9000;
  /** Called when the visible shot changes (for the on-screen camera tag). */
  onShot: ((shot: CameraShot) => void) | null = null;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 9000);
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
    this.controls.addEventListener('start', this.onUserStart);
  }

  private onUserStart = () => {
    this.userDriven = true;
    this.fly = null;
  };

  /** Camera still (confirmation in progress, F1-050): no updates and no touch orbit. */
  get frozen(): boolean {
    return this._frozen;
  }
  set frozen(on: boolean) {
    this._frozen = on;
    this.controls.enabled = !on && (this.mode === 'orbit' || this.mode === 'overview');
  }

  setTrack(track: TrackGeometry, halfWidth: number, _bounds?: { minX: number; maxX: number; minY: number; maxY: number }): void {
    this.track = track;
    this.halfWidth = halfWidth;
    this.trackPts = [];
    const n = Math.max(48, Math.min(260, Math.round(track.length / 25)));
    const c = this.circuitCenter.set(0, 0, 0);
    for (let i = 0; i < n; i++) {
      track.pointAt((i / n) * track.length, 0, this.p2);
      const v = new THREE.Vector3(this.p2[0], 0, -this.p2[1]);
      this.trackPts.push(v);
      c.add(v);
    }
    c.divideScalar(n);
    this.circuitRadius = 1;
    for (const p of this.trackPts) this.circuitRadius = Math.max(this.circuitRadius, p.distanceTo(c));
    this.gridS = track.wrap(track.length - 10);
    this.overviewAz = null;
    this.fitOverview();
    if (!this.tvSpots.length) {
      // Fallback spots (no environment): outside of upcoming corners.
      const cnt = Math.max(6, Math.floor(track.length / 260));
      for (let i = 0; i < cnt; i++) {
        const s = (i * track.length) / cnt;
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

  /** Occlusion proxies of the scenery. */
  setColliders(c: SceneColliders | null): void {
    this.colliders = c;
  }

  /** Car positions (live references) the low cameras must not sit inside. */
  setCars(list: readonly THREE.Vector3[]): void {
    this.cars = list;
  }

  /** Arc length of pole position (idle flyover starts over the grid). */
  setGrid(poleS: number): void {
    this.gridS = poleS;
  }

  /** Overview bias: keep the whole circuit in frame with this point (selected sector) facing the camera. */
  setZoneFocus(p: THREE.Vector3 | null): void {
    const same = (!p && !this.zoneFocus) || (p && this.zoneFocus && p.distanceToSquared(this.zoneFocus) < 1);
    if (same) return;
    this.zoneFocus = p ? p.clone() : null;
    this.fitOverview();
    if (this.mode === 'overview') {
      this.userDriven = false;
      this.flyTo(this.overviewPos, this.overviewTarget, SELECT_BLEND);
    }
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.enabled = !this._frozen && (mode === 'orbit' || mode === 'overview');
    this.orbitInit = false;
    this.userDriven = false;
    this.fly = null;
    this.shotUntil = 0;
    this.cueUntil = 0;
    this.beginTransition(this.reducedMotion ? 0 : SELECT_BLEND);
    this.hasPose = false;
  }

  /** No transition or fly-in in progress and the shot has a pose. */
  get settled(): boolean {
    return this.fly === null && this.hasPose && this.transT >= 1;
  }

  /** Current concrete shot (director resolves to one of these). */
  get currentShot(): CameraShot {
    return this.shot;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (this.track) {
      this.fitOverview();
      if (this.mode === 'overview' && !this.userDriven && !this.fly) {
        this.camera.position.copy(this.overviewPos);
        this.controls.target.copy(this.overviewTarget);
      }
    }
  }

  /** Race event hint for the director (and a short lens "punch" for emphasis). */
  cue(kind: CameraCue): void {
    if (!this.reducedMotion && (kind === 'overtake' || kind === 'fastest' || kind === 'finish')) this.punch = 1;
    if (this.mode !== 'director') return;
    const pick: Record<CameraCue, DirectorShot> = {
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

  private beginTransition(dur: number, lift = 0): void {
    this.fromPos.copy(this.pos);
    this.fromLook.copy(this.look);
    this.fromFov = this.fov;
    this.transDur = dur;
    this.transT = dur > 0 ? 0 : 1;
    this.transLift = lift;
  }

  private setShot(shot: CameraShot, hold: number, cut: boolean): void {
    const prev = this.shot;
    this.shot = shot;
    this.shotUntil = this.time + hold;
    this.activeTv = -1;
    if (shot === 'heli') this.heliA = this.heliATarget = this.rand() * Math.PI * 2;
    // TV/onboard/front/side are hard cuts (broadcast grammar); heli ↔ chase swoops.
    const swoop = !cut && (shot === 'heli' || prev === 'heli') && !this.reducedMotion;
    // A selection glide in flight (F1-050) keeps running into the new shot.
    if (swoop || !(this.transT < 1 && this.transDur > 0)) this.beginTransition(swoop ? 1.1 : 0, swoop ? 30 : 0);
    this.hasPose = false;
    this.emitShot(shot);
  }

  private emitShot(shot: CameraShot): void {
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

  /* ---------------- geometry helpers ---------------- */

  /** World point on the track at (s, lateral), clamped inside the barriers. */
  private onTrack(s: number, lat: number, h: number, out: THREE.Vector3): THREE.Vector3 {
    const t = this.track!;
    const side: 1 | -1 = lat >= 0 ? 1 : -1;
    const lim = Math.max(this.halfWidth * 0.8, this.barrier(s, side) - 1.6);
    const l = Math.max(-lim, Math.min(lim, lat));
    t.pointAt(s, l, this.p2);
    return out.set(this.p2[0], h, -this.p2[1]);
  }

  /** Line of sight from `from` to `to` is clear of scenery. */
  private clear(from: THREE.Vector3, to: THREE.Vector3, skipEnd = 2): boolean {
    const c = this.colliders;
    if (!c) return true;
    return c.segmentHit(from, to, 0.35, skipEnd) >= 1 && !c.pointBlocked(from, 0.8);
  }

  /** Horizontal distance from `p` to the nearest car other than `except*`. */
  private nearestCar(p: THREE.Vector3, exceptA: THREE.Vector3 | null, exceptB: THREE.Vector3 | null): number {
    let best = Infinity;
    for (const c of this.cars) {
      if (c === exceptA || c === exceptB) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < best) best = d;
    }
    return best;
  }

  private damp(cur: number, target: number, rate: number, dt: number): number {
    if (!this.hasPose || this.reducedMotion) return target;
    return cur + (target - cur) * (1 - Math.exp(-dt * rate));
  }

  /* ---------------- per-frame ---------------- */

  update(dt: number, subject: CameraSubject | null, rival: CameraSubject | null, timeSec: number): void {
    this.time = timeSec;
    if (this._frozen) return;
    this.punch = Math.max(0, this.punch - dt * 1.6);

    if (this.mode === 'orbit' || this.mode === 'overview') {
      this.updateOrbit(dt, subject);
      return;
    }
    if (!this.track) return;
    if (!subject) {
      this.updateIdle(dt);
      return;
    }
    let glideIn = false;
    if (this.shot === 'idle') {
      // Feed went live: glide from the tour into the requested framing.
      this.shot = 'follow';
      this.shotUntil = 0;
      this.hasPose = false;
      glideIn = true;
    }
    if (subject.id !== this.subjectId) {
      if (this.subjectId !== undefined && this.posed) {
        const lift = Math.min(40, this.pos.distanceTo(subject.pos) * 0.2);
        this.beginTransition(this.reducedMotion ? 0 : SELECT_BLEND, lift);
      }
      this.subjectId = subject.id;
      this.hasPose = false;
    }

    // Resolve the shot.
    if (this.mode === 'director') {
      if (timeSec >= this.shotUntil) this.nextDirectorShot();
    } else if (this.shot !== this.mode && !(this.mode === 'follow' && this.shot === 'duel')) {
      this.shot = this.mode as CameraShot;
      this.activeTv = -1;
      this.emitShot(this.shot);
    }
    if (glideIn) this.beginTransition(this.reducedMotion ? 0 : 0.9, 24);

    const track = this.track;
    const pr = track.project(subject.pos.x, -subject.pos.z, subject.s, 40);
    this.subjectLat = this.hasPose ? this.subjectLat + (pr.lateral - this.subjectLat) * Math.min(1, dt * 5) : pr.lateral;
    const s = pr.s;
    const offTrack = pr.distance > this.halfWidth + 5;
    let shot = this.shot;
    // Duel framing: follow mode with a close rival on track (pool duels, F1-050).
    if ((shot === 'follow' || shot === 'duel') && rival && !offTrack) {
      const rp = track.project(rival.pos.x, -rival.pos.z, rival.s, 40);
      const gap = Math.abs(track.delta(s, rp.s));
      shot = rp.distance < this.halfWidth + 5 && gap < DUEL_MAX_GAP ? 'duel' : 'follow';
    } else if (shot === 'duel') shot = 'follow';
    if (offTrack && (shot === 'follow' || shot === 'duel' || shot === 'side' || shot === 'front')) shot = 'follow';
    if (shot !== this.shot && (this.shot === 'follow' || this.shot === 'duel')) {
      this.shot = shot;
      this.emitShot(shot);
    }

    switch (shot) {
      case 'duel':
        this.shotDuel(dt, subject, rival!, s);
        break;
      case 'follow':
        this.shotChase(dt, subject, s, offTrack);
        break;
      case 'heli':
        this.shotHeli(dt, subject);
        break;
      case 'onboard':
        this.shotOnboard(subject, timeSec);
        break;
      case 'front':
        if (!this.shotFront(subject, s)) this.shotChase(dt, subject, s, offTrack);
        break;
      case 'side':
        if (!this.shotSide(subject, s)) this.shotChase(dt, subject, s, offTrack);
        break;
      case 'tv':
      default:
        this.shotTv(dt, subject, s);
        break;
    }
    this.idealFov -= this.punch * 5;
    if (!this.hasPose || this.reducedMotion) this.fov = this.idealFov;
    else this.fov += (this.idealFov - this.fov) * Math.min(1, dt * 6);
    this.pos.copy(this.idealPos);
    this.look.copy(this.idealLook);
    this.hasPose = true;
    this.applyPose(dt, this.pos.distanceTo(this.look) > 150 ? 1.5 : 0.25);
  }

  private shotChase(dt: number, subject: CameraSubject, s: number, offTrack: boolean): void {
    const f = subject.fwd;
    const v = subject.speed;
    if (offTrack) {
      // Pit lane / garage: subject-relative, a bit higher to clear the pit wall.
      const back = this.damp(this.chB, 11, 3, dt);
      const h = this.damp(this.chH, 4.8, 3, dt);
      this.chB = back;
      this.chH = h;
      this.idealPos.copy(subject.pos).addScaledVector(f, -back).addScaledVector(UP, h);
      this.aim.copy(subject.pos).addScaledVector(UP, 0.8);
      for (let i = 0; i < 3 && !this.clear(this.idealPos, this.aim); i++) {
        this.idealPos.lerp(this.aim, 0.35);
        this.idealPos.y += 2.5;
      }
      this.idealLook.copy(subject.pos).addScaledVector(f, 6).addScaledVector(UP, 0.8);
      this.idealFov = 56;
      return;
    }
    let B = 7.4 + Math.min(3, v * 0.03);
    let H = 2.3 + Math.min(0.7, v * 0.007);
    const lat = this.subjectLat * 0.85;
    this.aim.copy(subject.pos).addScaledVector(UP, 0.9);
    for (let i = 0; i < 4; i++) {
      this.onTrack(s - B, lat, H, this.tmp);
      const carD = this.nearestCar(this.tmp, subject.pos, null);
      if (carD < 3.4) H = Math.max(H, 4.2);
      if (this.clear(this.tmp, this.aim, 1.5)) break;
      B *= 0.7;
      H += 1.3;
    }
    // Pull in fast, relax slowly.
    this.chB = this.damp(this.chB, B, B < this.chB ? 14 : 2.5, dt);
    this.chH = this.damp(this.chH, H, H > this.chH ? 14 : 2.5, dt);
    this.chLat = this.damp(this.chLat, lat, 5, dt);
    this.onTrack(s - this.chB, this.chLat, this.chH, this.idealPos);
    this.idealLook.copy(subject.pos).addScaledVector(f, 10).addScaledVector(UP, 0.7);
    this.idealFov = 56 + Math.min(12, v * 0.1);
    if (!this.reducedMotion && v > 40) {
      const j = Math.min(1, (v - 40) / 50) * 0.02;
      this.idealPos.y += Math.sin(this.time * 41) * j + Math.sin(this.time * 23) * j * 0.6;
    }
  }

  private shotDuel(dt: number, a: CameraSubject, b: CameraSubject, sA: number): void {
    const track = this.track!;
    const pb = track.project(b.pos.x, -b.pos.z, b.s, 40);
    const d = track.delta(sA, pb.s); // > 0: b ahead
    const trail = d >= 0 ? a : b;
    const lead = d >= 0 ? b : a;
    const trailS = d >= 0 ? sA : pb.s;
    const gap = Math.abs(d);
    const latT = d >= 0 ? this.subjectLat : pb.lateral;
    const latL = d >= 0 ? pb.lateral : this.subjectLat;
    let B = 8.5 + gap * 0.42;
    let H = 2.8 + Math.min(12, gap * 0.11);
    const lat = latT * 0.6 + latL * 0.25;
    this.aim.copy(trail.pos).lerp(lead.pos, 0.55).addScaledVector(UP, 0.6);
    for (let i = 0; i < 4; i++) {
      this.onTrack(trailS - B, lat, H, this.tmp);
      if (this.nearestCar(this.tmp, a.pos, b.pos) < 3.4) H = Math.max(H, 4.5);
      if (this.clear(this.tmp, trail.pos, 1.5) && this.clear(this.tmp, lead.pos, 1.5)) break;
      B *= 0.75;
      H += 1.6;
    }
    this.chB = this.damp(this.chB, B, B < this.chB ? 12 : 3, dt);
    this.chH = this.damp(this.chH, H, H > this.chH ? 12 : 3, dt);
    this.chLat = this.damp(this.chLat, lat, 4, dt);
    this.onTrack(trailS - this.chB, this.chLat, this.chH, this.idealPos);
    this.idealLook.copy(this.aim);
    // Lens that keeps both cars inside ~70% of the frame.
    this.basis.lookAt(this.idealPos, this.idealLook, UP);
    const aspect = this.camera.aspect;
    let need = Math.tan(THREE.MathUtils.degToRad(15));
    for (const p of [trail.pos, lead.pos]) {
      for (const dy of [0.2, 1.4]) {
        this.tmp2.copy(p).setY(p.y + dy).sub(this.idealPos);
        // Camera basis columns: x (right), y (up), z (back).
        const e = this.basis.elements;
        const x = this.tmp2.x * e[0]! + this.tmp2.y * e[1]! + this.tmp2.z * e[2]!;
        const y = this.tmp2.x * e[4]! + this.tmp2.y * e[5]! + this.tmp2.z * e[6]!;
        const z = -(this.tmp2.x * e[8]! + this.tmp2.y * e[9]! + this.tmp2.z * e[10]!);
        if (z <= 0.5) continue;
        need = Math.max(need, Math.abs(y / z) / 0.72, Math.abs(x / z) / (0.78 * aspect));
      }
    }
    this.idealFov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(need)), 30, 72);
  }

  private shotHeli(dt: number, subject: CameraSubject): void {
    const f = subject.fwd;
    const r = 70;
    if (!this.reducedMotion) this.heliATarget += dt * 0.09;
    this.aim.copy(subject.pos).addScaledVector(UP, 1);
    let h = 46;
    let found = false;
    // Raise first, then swing around the car until the view is clear.
    for (let k = 0; k < 8 && !found; k++) {
      const a = this.heliATarget + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4));
      for (const hh of [46, 72]) {
        this.tmp.copy(subject.pos).add(this.tmp2.set(Math.cos(a) * r, hh, Math.sin(a) * r)).addScaledVector(f, 16);
        const top = this.colliders ? this.colliders.topNear(this.tmp.x, this.tmp.z, 8) : 0;
        if (this.tmp.y < top + 10) this.tmp.y = top + 10;
        if (this.clear(this.tmp, this.aim, 3)) {
          if (k > 0) this.heliATarget = a;
          h = this.tmp.y - subject.pos.y;
          found = true;
          break;
        }
      }
    }
    this.heliA = this.hasPose ? this.heliA + wrapPi(this.heliATarget - this.heliA) * (1 - Math.exp(-dt * 1.6)) : this.heliATarget;
    this.heliH = this.damp(this.heliH, h, 2, dt);
    this.idealPos.copy(subject.pos).add(this.tmp2.set(Math.cos(this.heliA) * r, this.heliH, Math.sin(this.heliA) * r)).addScaledVector(f, 16);
    this.idealLook.copy(subject.pos).addScaledVector(f, 6);
    this.idealFov = 38;
  }

  private shotOnboard(subject: CameraSubject, timeSec: number): void {
    const f = subject.fwd;
    const v = subject.speed;
    this.idealPos.copy(subject.pos).addScaledVector(f, -0.55).addScaledVector(UP, 1.2);
    this.idealLook.copy(subject.pos).addScaledVector(f, 30).addScaledVector(UP, 0.55);
    if (!this.reducedMotion) {
      const j = Math.min(1, v / 90) * 0.012;
      this.idealPos.y += Math.sin(timeSec * 47) * j + Math.sin(timeSec * 31) * j * 0.6;
    }
    this.idealFov = 74;
  }

  private shotFront(subject: CameraSubject, s: number): boolean {
    const v = subject.speed;
    const ahead = 13 + Math.min(10, v * 0.09);
    this.onTrack(s + ahead, this.subjectLat * 0.6, 1.5, this.idealPos);
    this.aim.copy(subject.pos).addScaledVector(UP, 0.6);
    if (!this.clear(this.idealPos, this.aim, 1.5) || this.nearestCar(this.idealPos, subject.pos, null) < 3) return false;
    this.idealLook.copy(this.aim);
    this.idealFov = 38;
    return true;
  }

  private shotSide(subject: CameraSubject, s: number): boolean {
    if (!this.hasPose) this.sideSign = this.subjectLat > 0 ? -1 : 1;
    const target = this.subjectLat + this.sideSign * 7.5;
    this.onTrack(s + 1.5, target, 1.4, this.idealPos);
    this.aim.copy(subject.pos).addScaledVector(UP, 0.5);
    // Too narrow to step aside (street circuits) or blocked: not a usable shot.
    if (this.idealPos.distanceTo(subject.pos) < 4.5 || !this.clear(this.idealPos, this.aim, 1.5)) return false;
    this.idealLook.copy(subject.pos).addScaledVector(subject.fwd, 2).addScaledVector(UP, 0.5);
    this.idealFov = 48;
    return true;
  }

  private shotTv(dt: number, subject: CameraSubject, s: number): void {
    const v = subject.speed;
    const cam = this.pickTv(subject, s, dt);
    if (cam) {
      this.idealPos.copy(cam);
      this.idealLook.copy(subject.pos).addScaledVector(subject.fwd, Math.min(8, v * 0.08)).addScaledVector(UP, 0.4);
      const dist = cam.distanceTo(subject.pos);
      // Long lens: the car fills ~1/4 of the frame, widening as it gets close.
      this.idealFov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(13 / Math.max(1, dist))), 6, 48);
      return;
    }
    // No tower sees the car: crane over the outside of the corridor ahead.
    const k = this.track!.curvatureAt(s + 40);
    const side: 1 | -1 = k > 0 ? -1 : 1;
    this.onTrack(s + 38, side * 99, 9, this.idealPos);
    this.idealLook.copy(subject.pos).addScaledVector(UP, 0.4);
    this.idealFov = 34;
  }

  private pickTv(subject: CameraSubject, s: number, dt: number): THREE.Vector3 | null {
    const track = this.track!;
    if (!this.tvSpots.length) return null;
    this.aim.copy(subject.pos).addScaledVector(UP, 0.8);
    if (this.activeTv >= 0) {
      const cur = this.tvSpots[this.activeTv]!;
      const d = track.delta(s, cur.s);
      if (d > -70 && d < 340) {
        // Short occlusions (a single tree) are tolerated; longer ones cut to the next tower.
        this.tvBlocked = this.clear(cur.pos, this.aim, 3) ? 0 : this.tvBlocked + dt;
        if (this.tvBlocked < 0.35) return cur.pos;
      }
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.tvSpots.length; i++) {
      const sp = this.tvSpots[i]!;
      const d = track.delta(s, sp.s);
      if (d > 20 && d < 340 && d < bestD && sp.pos.distanceTo(subject.pos) < 420 && this.clear(sp.pos, this.aim, 3)) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) {
      // Behind the car but still close and visible.
      for (let i = 0; i < this.tvSpots.length; i++) {
        const sp = this.tvSpots[i]!;
        const d = track.delta(s, sp.s);
        if (d > -60 && d <= 20 && this.clear(sp.pos, this.aim, 3)) {
          best = i;
          break;
        }
      }
    }
    if (best !== this.activeTv) {
      this.hasPose = false; // hard cut to the next tower
      this.tvBlocked = 0;
    }
    this.activeTv = best;
    return best >= 0 ? this.tvSpots[best]!.pos : null;
  }

  /* ---------------- idle tour (no live feed yet) ---------------- */

  private updateIdle(dt: number): void {
    if (this.shot !== 'idle') {
      this.shot = 'idle';
      this.idlePhase = 'grid';
      this.idleT = 0;
      this.idleS = this.gridS + 40;
      this.hasPose = false;
      this.emitShot('idle');
    }
    const track = this.track!;
    this.idleT += dt;
    if (this.reducedMotion) this.idlePhase = 'orbit';
    else if (this.idlePhase === 'grid' && this.idleT > 13) {
      this.idlePhase = 'orbit';
      this.idleT = 0;
      this.hasPose = false;
    } else if (this.idlePhase === 'orbit' && this.idleT > 16) {
      this.idlePhase = 'grid';
      this.idleT = 0;
      this.idleS = this.gridS + 40;
      this.hasPose = false;
    }
    if (this.idlePhase === 'grid') {
      // Crane drifting back along the grid, looking down the rows.
      this.idleS -= dt * 9;
      const k = Math.min(1, this.idleT / 13);
      const h = 9 + k * 9;
      this.onTrack(this.idleS, -this.halfWidth * 0.2, h, this.idealPos);
      const top = this.colliders ? this.colliders.topNear(this.idealPos.x, this.idealPos.z, 4) : 0;
      if (this.idealPos.y < top + 4) this.idealPos.y = top + 4;
      this.onTrack(this.idleS - 34 - k * 20, 0, 0.5, this.idealLook);
      this.idealFov = 46;
    } else {
      if (!this.reducedMotion) this.idleAz += dt * 0.045;
      const c = this.circuitCenter;
      const r = this.circuitRadius;
      const pitch = THREE.MathUtils.degToRad(36);
      const dist = r * (this.camera.aspect < 1 ? 1.9 : 1.45) + 120;
      this.idealPos.set(c.x + Math.sin(this.idleAz) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, c.z + Math.cos(this.idleAz) * Math.cos(pitch) * dist);
      this.idealLook.copy(c);
      this.idealFov = 42;
    }
    if (!this.hasPose || this.reducedMotion) this.fov = this.idealFov;
    else this.fov += (this.idealFov - this.fov) * Math.min(1, dt * 3);
    this.pos.copy(this.idealPos);
    this.look.copy(this.idealLook);
    this.hasPose = true;
    void track;
    this.applyPose(dt, this.idlePhase === 'orbit' ? 2 : 0.5);
  }

  private applyPose(dt: number, near: number): void {
    let p = this.pos;
    let l = this.look;
    let fov = this.fov;
    if (this.transT < 1 && this.transDur > 0) {
      this.transT = Math.min(1, this.transT + dt / this.transDur);
      const k = easeInOut(this.transT);
      p = this.tmp.copy(this.fromPos).lerp(this.pos, k);
      l = this.tmp2.copy(this.fromLook).lerp(this.look, k);
      // Lift the camera through the move so it never cuts through scenery.
      p.y += Math.sin(k * Math.PI) * Math.min(this.transLift || 40, this.fromPos.distanceTo(this.pos) * 0.25);
      fov = this.fromFov + (fov - this.fromFov) * k;
      near = Math.min(near, 0.3);
    } else if (this.transT < 1) this.transT = 1;
    p.y = Math.max(0.8, p.y);
    this.posed = true;
    this.camera.position.copy(p);
    this.camera.lookAt(l);
    this.setLens(fov, near, near > 1 ? 14000 : 6000);
  }

  private setLens(fov: number, near: number, far: number): void {
    if (Math.abs(this.camera.fov - fov) > 0.01 || near !== this.near || far !== this.far) {
      this.near = near;
      this.far = far;
      this.camera.fov = fov;
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /* ---------------- overview / free orbit ---------------- */

  /** Fit the whole circuit into the viewport; the azimuth faces the selected sector when one is set. */
  private fitOverview(): void {
    const pts = this.trackPts;
    if (!pts.length) return;
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    const pitch = THREE.MathUtils.degToRad(portrait ? 56 : 46);
    const tanV = Math.tan(THREE.MathUtils.degToRad(45) / 2);
    const fwd = this.tmp3;
    const best = { score: Infinity, az: 0, d: 0, tx: 0, tz: 0 };
    const tryAz = (az: number, bias: number) => {
      const target = this.tmp2.copy(this.circuitCenter);
      let d = 0;
      for (let it = 0; it < 3; it++) {
        d = this.fitDistance(target, az, pitch, tanV, aspect);
        const off = this.screenCenter(target, az, pitch, d, tanV, aspect);
        // Re-centre: shift along the camera right axis and the ground-projected forward axis.
        const rx = Math.cos(az), rz = -Math.sin(az);
        fwd.set(-Math.sin(az), 0, -Math.cos(az));
        target.x += rx * off[0] * d * tanV * aspect + fwd.x * off[1] * d * tanV / Math.sin(pitch);
        target.z += rz * off[0] * d * tanV * aspect + fwd.z * off[1] * d * tanV / Math.sin(pitch);
      }
      let score = d;
      if (this.zoneFocus) {
        // 0 when the sector is on the camera side of the circuit, 1 when it is at the far side.
        fwd.set(-Math.sin(az), 0, -Math.cos(az));
        const along = (this.zoneFocus.x - target.x) * fwd.x + (this.zoneFocus.z - target.z) * fwd.z;
        score *= 1 + bias * THREE.MathUtils.clamp((along / this.circuitRadius + 1) / 2, 0, 1);
      }
      if (score < best.score) Object.assign(best, { score, az, d, tx: target.x, tz: target.z });
    };
    if (this.overviewAz !== null && !this.zoneFocus) tryAz(this.overviewAz, 0);
    else for (let i = 0; i < 24; i++) tryAz((i / 24) * Math.PI * 2, 0.9);
    if (!this.zoneFocus) this.overviewAz = best.az;
    this.overviewTarget.set(best.tx, 0, best.tz);
    this.overviewPos.set(best.tx + Math.sin(best.az) * Math.cos(pitch) * best.d, Math.sin(pitch) * best.d, best.tz + Math.cos(best.az) * Math.cos(pitch) * best.d);
  }

  private project(p: THREE.Vector3, cam: THREE.Vector3, az: number, pitch: number, out: [number, number]): number {
    // Camera looks along -dir; right = (cos az, 0, -sin az); up = cross(right, fwd).
    const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
    const sa = Math.sin(az), ca = Math.cos(az), sp = Math.sin(pitch), cp = Math.cos(pitch);
    const fx = -sa * cp, fy = -sp, fz = -ca * cp;
    const rx = ca, rz = -sa;
    const ux = -sa * sp, uy = cp, uz = -ca * sp;
    const z = dx * fx + dy * fy + dz * fz;
    out[0] = (dx * rx + dz * rz) / Math.max(1e-3, z);
    out[1] = (dx * ux + dy * uy + dz * uz) / Math.max(1e-3, z);
    return z;
  }

  private fitDistance(target: THREE.Vector3, az: number, pitch: number, tanV: number, aspect: number): number {
    // Margins: the top band hides ~16% under the pool header, the bottom ~18% under the fade.
    const mx = 0.92, myTop = 0.8, myBot = 0.78;
    let lo = 50, hi = 20000;
    const cam = this.tmp;
    for (let it = 0; it < 22; it++) {
      const d = (lo + hi) / 2;
      cam.set(target.x + Math.sin(az) * Math.cos(pitch) * d, Math.sin(pitch) * d, target.z + Math.cos(az) * Math.cos(pitch) * d);
      let ok = true;
      for (const p of this.trackPts) {
        const z = this.project(p, cam, az, pitch, this.p2);
        if (z <= 1) {
          ok = false;
          break;
        }
        const nx = this.p2[0] / (tanV * aspect);
        const ny = this.p2[1] / tanV;
        if (Math.abs(nx) > mx || ny > myTop || ny < -myBot) {
          ok = false;
          break;
        }
      }
      if (ok) hi = d;
      else lo = d;
    }
    return hi;
  }

  private screenCenter(target: THREE.Vector3, az: number, pitch: number, d: number, tanV: number, aspect: number): [number, number] {
    const cam = this.tmp.set(target.x + Math.sin(az) * Math.cos(pitch) * d, Math.sin(pitch) * d, target.z + Math.cos(az) * Math.cos(pitch) * d);
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const p of this.trackPts) {
      this.project(p, cam, az, pitch, this.p2);
      const nx = this.p2[0] / (tanV * aspect);
      const ny = this.p2[1] / tanV;
      mnx = Math.min(mnx, nx);
      mxx = Math.max(mxx, nx);
      mny = Math.min(mny, ny);
      mxy = Math.max(mxy, ny);
    }
    // Asymmetric vertical margins: aim slightly below the middle.
    return [(mnx + mxx) / 2, (mny + mxy) / 2 + 0.01];
  }

  private flyTo(toPos: THREE.Vector3, toTarget: THREE.Vector3, dur: number): void {
    if (this.reducedMotion || !this.posed || dur <= 0) {
      this.fly = null;
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTarget);
      return;
    }
    this.fly = { fromPos: this.camera.position.clone(), fromTarget: this.look.clone(), toPos: toPos.clone(), toTarget: toTarget.clone(), t: 0, dur };
  }

  private updateOrbit(dt: number, subject: CameraSubject | null): void {
    const mode = this.mode;
    const shot: CameraShot = mode === 'orbit' ? 'orbit' : 'overview';
    if (this.shot !== shot) {
      this.shot = shot;
      this.emitShot(shot);
    }
    if (!this.orbitInit) {
      this.orbitInit = true;
      const toTarget = new THREE.Vector3();
      const toPos = new THREE.Vector3();
      if (mode === 'orbit' && subject) {
        toTarget.copy(subject.pos);
        toPos.copy(subject.pos).add(this.tmp.set(-subject.fwd.x * 16 + 12, 11, -subject.fwd.z * 16 + 6));
      } else {
        toTarget.copy(this.overviewTarget);
        toPos.copy(this.overviewPos);
      }
      this.setLens(mode === 'overview' ? 45 : 50, mode === 'overview' ? 2 : 0.3, 14000);
      // The from-pose may be mid-glide: start from what is on screen.
      this.flyTo(toPos, toTarget, this.posed && this.hasPose ? (mode === 'overview' ? 0.6 : 0.5) : 0);
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
      this.fly.t = Math.min(1, this.fly.t + dt / this.fly.dur);
      const k = easeInOut(this.fly.t);
      this.camera.position.copy(this.fly.fromPos).lerp(this.fly.toPos, k);
      this.controls.target.copy(this.fly.fromTarget).lerp(this.fly.toTarget, k);
      if (this.fly.t >= 1) this.fly = null;
    }
    this.controls.update();
    // Free orbit: never inside scenery or under the ground.
    const cp = this.camera.position;
    if (cp.y < 1.5) cp.y = 1.5;
    if (this.colliders && this.colliders.pointBlocked(cp, 1)) cp.y = this.colliders.topNear(cp.x, cp.z, 1) + 3;
    this.camera.lookAt(this.controls.target);
    this.pos.copy(cp);
    this.look.copy(this.controls.target);
    this.fov = this.camera.fov;
    this.hasPose = true;
    this.transT = 1;
    this.posed = true;
  }

  /** Back-compat: frame a selected area (now keeps the whole circuit, sector facing the camera). */
  frameZone(center: THREE.Vector3, _radius?: number): void {
    this.setMode('overview');
    this.setZoneFocus(center);
  }

  dispose(): void {
    this.controls.removeEventListener('start', this.onUserStart);
    this.controls.dispose();
    this.onShot = null;
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
