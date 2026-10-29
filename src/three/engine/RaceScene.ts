import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { CircuitData } from '@/data/circuits/types';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import type { TrackModel } from '@/sim/trackModel';
import type { Moment, SimFrame } from '@/sim/types';
import type { TrackState } from '@/domain/types';
import type { F1CarModel, ModelQuality, RoadCarModel, TyreLetter } from '@/three/models/types';
import { createCarShadow, createF1Car, createRoadCar } from '@/three/models/cars';
import { buildTrackMeshes, toWorld, yawFromHeading, type TrackMeshes } from '@/three/track/trackMesh';
import { buildEnvironment, type EnvironmentHandle } from '@/three/track/environment';
import { createSkyDome, type PropsAtmosphere } from '@/three/models/props';
import { CameraRig, type CameraMode, type CameraSubject } from './cameraRig';
import { Beacon, MotionTrail, ParticleSystem, SelectionRing, Shockwaves } from './effects';
import { PitCrews } from './pitCrew';
import { LabelLayer, type LabelTarget, type ZoneTag } from './labels';

export interface SceneOptions {
  quality: ModelQuality;
  reducedMotion: boolean;
  onContextLost: () => void;
  onPick: (ids: string[]) => void;
  labelLayer: HTMLElement;
}

interface CarEntry {
  id: string;
  model: F1CarModel;
  shadow: THREE.Mesh;
  marker: THREE.Sprite;
  tyre: TyreLetter | null;
  spin: number;
  flap: number;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  s: number;
  visible: boolean;
  brakeSmooth: number;
  teamColor: string;
  /** Arc length along the pit lane while in the pits (projection hint). */
  pitS: number;
  /** Smoothed lateral shift into the working lane at the box. */
  boxShift: number;
}

const TYRE_LETTER: Record<string, TyreLetter> = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };

export class RaceScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private container: HTMLElement;
  private opts: SceneOptions;
  private circuit: CircuitData | null = null;
  private model: TrackModel | null = null;
  private track: TrackMeshes | null = null;
  private env: EnvironmentHandle | null = null;
  private cars = new Map<string, CarEntry>();
  private sc: RoadCarModel | null = null;
  private frames: SimFrame[] = [];
  private renderT = 0;
  private followId: string | null = null;
  private rivalId: string | null = null;
  private labelIds: string[] = [];
  private ringA = new SelectionRing('#c6ff3d', 10);
  private ringB = new SelectionRing('#2fe6ff', 9);
  private trail = new MotionTrail('#c6ff3d');
  private beaconA = new Beacon('#c6ff3d');
  private beaconB = new Beacon('#2fe6ff', 20, 0.9);
  private crews = new PitCrews();
  private medical: RoadCarModel | null = null;
  private byIdA = new Map<string, SimFrame['cars'][number]>();
  private sparkV = new THREE.Vector3();
  private sparkC = new THREE.Color(1, 0.75, 0.35);
  private particles = new ParticleSystem(1200);
  private sparks = new ParticleSystem(500, 6);
  private waves = new Shockwaves();
  private labels: LabelLayer;
  private labelBuf: LabelTarget[] = [];
  private zoneTagBuf: ZoneTag[] = [];
  private clockT = 0;
  private selectedZone: 1 | 2 | 3 | null = null;
  private zoneVisible = true;
  private trackState: TrackState = 'GREEN';
  private sectorFlags: boolean[] = [false, false, false];
  private excitement = 0.2;
  private disposed = false;
  private contextLost = false;
  private sun: THREE.DirectionalLight | null = null;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private envRT: THREE.WebGLRenderTarget | null = null;
  private tmpV = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private lastFrameT = -1;
  private fireworksUntil = 0;
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement, opts: SceneOptions) {
    this.container = container;
    this.opts = opts;
    const q = opts.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false });
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = q === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Stats cover the whole frame (scene + post passes); reset manually in render().
    this.renderer.info.autoReset = false;
    const canvas = this.renderer.domElement;
    canvas.className = 'scene-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    canvas.addEventListener('webglcontextlost', this.handleLost, false);
    const { clientWidth: w, clientHeight: h } = container;
    this.renderer.setSize(Math.max(1, w), Math.max(1, h), false);
    this.rig = new CameraRig(canvas, Math.max(1, w) / Math.max(1, h));
    this.rig.reducedMotion = opts.reducedMotion;
    this.labels = new LabelLayer(opts.labelLayer);
    this.scene.add(this.ringA.mesh, this.ringB.mesh, this.trail.mesh, this.particles.points, this.sparks.points, this.waves.group, this.beaconA.mesh, this.beaconB.mesh, this.crews.mesh);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.opts.onContextLost();
  };

  /** Per-frame renderer statistics (draw calls / triangles of the last frame incl. post). */
  stats(): { calls: number; triangles: number; geometries: number; textures: number; programs: number; shot: string } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, shot: this.rig.currentShot };
  }

  /** Test hook / QA19: simulate a lost WebGL context. */
  loseContext(): void {
    const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }

  async load(circuit: CircuitData, model: TrackModel, driverIds: string[], onProgress?: (p: number) => void): Promise<void> {
    this.circuit = circuit;
    this.model = model;
    const q = this.opts.quality;
    const tick = () => new Promise<void>((r) => setTimeout(r, 0));
    onProgress?.(0.05);
    this.track = buildTrackMeshes(circuit, model, q);
    this.scene.add(this.track.group);
    onProgress?.(0.25);
    await tick();
    if (this.disposed) return;
    this.env = buildEnvironment({ circuit, model, track: this.track, quality: q, scene: this.scene, renderer: this.renderer });
    this.scene.add(this.env.group);
    this.setupLighting(circuit, this.env.atmosphere);
    onProgress?.(0.6);
    await tick();
    if (this.disposed) return;
    let i = 0;
    for (const id of driverIds) {
      this.addCar(id);
      if (++i % 6 === 0) {
        onProgress?.(0.6 + (0.35 * i) / driverIds.length);
        await tick();
        if (this.disposed) return;
      }
    }
    const sc: RoadCarModel = createRoadCar(circuit.id === 'mc-1929' || circuit.id === 'gb-1948' || circuit.id === 'jp-1962' ? 'safety-aston' : 'safety-mercedes', q);
    sc.root.visible = false;
    sc.setLightBar(true);
    this.scene.add(sc.root);
    this.sc = sc;
    this.rig.setTvSpots(this.env.tvSpots);
    this.rig.setCorridor(this.env.layout.barrier);
    this.rig.setTrack(model.track, circuit.widthM / 2, circuit.bounds);
    this.rig.onShot = (shot) => this.labels.setShot(shot);
    this.labels.setShot(this.rig.currentShot);
    this.setupPost();
    onProgress?.(1);
  }

  private setupLighting(c: CircuitData, atm: PropsAtmosphere): void {
    const tod = c.timeOfDay;
    const q = this.opts.quality;
    // Night races are floodlit: bright cool overhead fill instead of a dim moon.
    const hemi = new THREE.HemisphereLight(
      tod === 'night' ? 0x9db0d8 : atm.hemiSky,
      atm.hemiGround,
      tod === 'night' ? 1.55 : tod === 'dusk' ? 1.25 : atm.hemiIntensity,
    );
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(tod === 'night' ? 0xe6eeff : atm.sunColor, tod === 'night' ? 1.6 : tod === 'dusk' ? 1.9 : atm.sunIntensity);
    this.sunDir.copy(tod === 'night' ? new THREE.Vector3(0.25, 0.92, 0.3).normalize() : atm.sunDirection);
    sun.position.copy(this.sunDir).multiplyScalar(400);
    if (q === 'high') {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const cam = sun.shadow.camera as THREE.OrthographicCamera;
      cam.left = -70;
      cam.right = 70;
      cam.top = 70;
      cam.bottom = -70;
      cam.near = 10;
      cam.far = 900;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.02;
    }
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.renderer.toneMappingExposure = atm.exposure * (tod === 'night' ? 1.05 : 1);
    const extent = Math.max(c.bounds.maxX - c.bounds.minX, c.bounds.maxY - c.bounds.minY);
    // Exponential haze: about 50% at ~1.4× the circuit extent, never fully opaque near the action.
    const density = Math.min(atm.fogDensity, 0.85 / Math.max(800, extent * 1.4));
    this.scene.fog = new THREE.FogExp2(atm.fogColor, density);
    this.scene.background = atm.fogColor.clone();
    this.setupEnvMap(atm, tod);
  }

  /** Prefiltered sky (+ floodlight panels at night) for car paint / glass reflections. */
  private setupEnvMap(atm: PropsAtmosphere, tod: CircuitData['timeOfDay']): void {
    const envScene = new THREE.Scene();
    const dome = createSkyDome(tod, this.circuit!.theme);
    envScene.add(dome.mesh);
    const extras: Array<{ dispose(): void }> = [];
    if (tod !== 'day') {
      const panelGeo = new THREE.PlaneGeometry(9, 3);
      const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.9).multiplyScalar(tod === 'night' ? 6 : 3), side: THREE.DoubleSide });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        const p = new THREE.Mesh(panelGeo, panelMat);
        p.position.set(Math.cos(a) * 8, 1.6 + (i % 2) * 0.8, Math.sin(a) * 8);
        p.lookAt(0, 0, 0);
        envScene.add(p);
      }
      extras.push(panelGeo, panelMat);
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: atm.hemiGround.clone().multiplyScalar(0.35) }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    envScene.add(ground);
    extras.push(ground.geometry, ground.material as THREE.Material);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene, 0.03, 0.1, 50);
    pmrem.dispose();
    dome.dispose();
    extras.forEach((e) => e.dispose());
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = tod === 'night' ? 0.9 : 0.75;
  }

  private setupPost(): void {
    if (this.opts.quality !== 'high') return;
    const { clientWidth: w, clientHeight: h } = this.container;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), this.circuit?.timeOfDay === 'day' ? 0.35 : 0.75, 0.6, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  private addCar(id: string): void {
    const d = DRIVER_BY_ID[id];
    if (!d) return;
    const team = TEAM_BY_ID[d.teamId]!;
    const model = createF1Car({ livery: team.livery, number: d.number, code: d.code, quality: this.opts.quality });
    model.root.traverse((o: THREE.Object3D) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = this.opts.quality === 'high';
    });
    const shadow = createCarShadow();
    const marker = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: markerTexture(team.color), sizeAttenuation: false, depthTest: false, transparent: true }),
    );
    marker.scale.set(0.032, 0.032, 1);
    marker.renderOrder = 20;
    marker.center.set(0.5, 0);
    this.scene.add(model.root, shadow, marker);
    this.cars.set(id, { id, model, shadow, marker, tyre: null, spin: 0, flap: 0, pos: new THREE.Vector3(), yaw: 0, speed: 0, s: 0, visible: true, brakeSmooth: 0, teamColor: team.color, pitS: -1, boxShift: 0 });
  }

  /* ---------------- state from the app ---------------- */

  pushFrame(f: SimFrame): void {
    if (f.t <= this.lastFrameT) return;
    this.lastFrameT = f.t;
    this.frames.push(f);
    if (this.frames.length > 12) this.frames.shift();
  }

  resetFrames(): void {
    this.frames = [];
    this.lastFrameT = -1;
    this.trail.reset();
  }

  follow(id: string | null): void {
    if (id !== this.followId) this.trail.reset();
    this.followId = id;
  }

  setRival(id: string | null): void {
    this.rivalId = id;
  }

  setLabelIds(ids: string[]): void {
    this.labelIds = ids;
  }

  setCameraMode(mode: CameraMode): void {
    this.rig.setMode(mode);
  }

  freezeCamera(on: boolean): void {
    this.rig.frozen = on;
  }

  setReducedMotion(on: boolean): void {
    this.opts.reducedMotion = on;
    this.rig.reducedMotion = on;
  }

  /** Highlight a sector zone (F1-047: limited electric lime at the selected sector). */
  setZone(sector: 1 | 2 | 3 | null, frame = false): void {
    this.selectedZone = sector;
    if (frame && sector && this.track) {
      const a = this.track.sectorAnchors[sector - 1]!;
      const c = this.circuit!;
      const sec = c.sectors[sector - 1]!;
      const len = ((sec.endS - sec.startS) % c.centerlineLengthM + c.centerlineLengthM) % c.centerlineLengthM;
      this.rig.frameZone(new THREE.Vector3(a.x, 0, a.z), len / 2.4);
    }
  }

  showZones(on: boolean): void {
    this.zoneVisible = on;
  }

  setTrackState(s: TrackState): void {
    this.trackState = s;
    this.env?.setFlags(s, this.sectorFlags);
  }

  /** Per-sector yellow flags (marshal LED panels). */
  setSectorFlags(flags: readonly boolean[]): void {
    if (flags.length === this.sectorFlags.length && flags.every((f, i) => f === this.sectorFlags[i])) return;
    this.sectorFlags = [...flags];
    this.env?.setFlags(this.trackState, this.sectorFlags);
  }

  /** Race positions for the labels. */
  setPositions(map: Map<string, number>): void {
    this.labels.setPositions(map);
  }

  setExcitement(x: number): void {
    this.excitement = x;
  }

  onMoment(m: Moment): void {
    if (this.opts.reducedMotion) return;
    const involved = m.drivers.map((id) => this.cars.get(id)).filter(Boolean) as CarEntry[];
    if (m.kind === 'OVERTAKE' && involved[0]) {
      this.waves.spawn(involved[0].pos, m.drivers.includes(this.followId ?? '') ? '#c6ff3d' : '#2fe6ff');
      this.particles.burst(involved[0].pos.clone().setY(0.6), new THREE.Color('#c6ff3d'), 40, 9, 0.9, 1.1);
      this.excitement = 1;
    } else if (m.kind === 'START') {
      this.excitement = 1;
    } else if (m.kind === 'FINISH') {
      this.excitement = 1;
      this.fireworksUntil = this.clockT + 14;
    } else if (m.kind === 'FASTEST_LAP' && involved[0]) {
      this.particles.burst(involved[0].pos.clone().setY(1), new THREE.Color('#b26bff'), 30, 6, 0.8, 1);
    }
  }

  /* ---------------- rendering ---------------- */

  private interpolate(): { a: SimFrame; b: SimFrame; k: number } | null {
    const n = this.frames.length;
    if (n === 0) return null;
    if (n === 1) return { a: this.frames[0]!, b: this.frames[0]!, k: 0 };
    const t = this.renderT;
    for (let i = n - 1; i > 0; i--) {
      const a = this.frames[i - 1]!;
      const b = this.frames[i]!;
      if (t >= a.t) {
        const k = b.t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 1;
        return { a, b, k };
      }
    }
    return { a: this.frames[0]!, b: this.frames[0]!, k: 0 };
  }

  /** Rendered frames (dev tooling waits on this). */
  frameCount = 0;

  render(dt: number, stale = false): void {
    if (this.disposed || this.contextLost || !this.circuit) return;
    this.frameCount++;
    this.clockT += dt;
    const latest = this.frames[this.frames.length - 1];
    if (latest) {
      // Render ~1 frame behind the newest sample; a stale feed freezes markers (F1-049).
      const target = latest.t - 0.1;
      if (stale) this.renderT = Math.min(this.renderT, target);
      else if (Math.abs(target - this.renderT) > 2) this.renderT = target;
      else this.renderT += dt + (target - this.renderT) * 0.1;
    }
    const ip = this.interpolate();
    if (ip) this.applyFrames(ip.a, ip.b, ip.k, dt);
    const subject = this.subject();
    this.rig.update(dt, subject, this.model?.track ?? null, this.clockT);
    this.updateMarkers();
    this.updateZones(dt);
    this.ringA.update(dt, this.followId ? this.cars.get(this.followId)?.pos ?? null : null, this.opts.reducedMotion);
    this.ringB.update(dt, this.rivalId ? this.cars.get(this.rivalId)?.pos ?? null : null, this.opts.reducedMotion);
    this.trail.update(dt, this.followId ? this.cars.get(this.followId)?.pos ?? null : null);
    this.particles.update(dt);
    this.sparks.update(dt);
    this.waves.update(dt);
    if (this.fireworksUntil > this.clockT && Math.random() < dt * 2.5) this.firework();
    this.excitement = Math.max(0.15, this.excitement - dt * 0.12);
    this.env?.update(this.clockT, this.excitement, ip?.b ?? null);
    if (this.sun && subject && this.opts.quality === 'high') {
      this.sun.target.position.copy(subject.pos);
      this.sun.position.copy(subject.pos).addScaledVector(this.sunDir, 300);
    }
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.rig.camera);
    this.labels.update(this.rig.camera, this.container, this.labelTargets(), this.zoneTags(), this.selectedZone);
  }

  private labelTargets(): LabelTarget[] {
    const out = this.labelBuf;
    out.length = 0;
    for (const id of this.labelIds) {
      const c = this.cars.get(id);
      if (!c || !c.visible) continue;
      out.push({ id, pos: c.pos, kind: id === this.followId ? 'follow' : id === this.rivalId ? 'rival' : 'near' });
    }
    if (this.sc?.root.visible) out.push({ id: '__sc', pos: this.sc.root.position, kind: 'sc' });
    return out;
  }

  private zoneTags(): ZoneTag[] | null {
    if (!this.track || !this.zoneVisible) return null;
    if (!this.zoneTagBuf.length) this.track.sectorAnchors.forEach((pos, i) => this.zoneTagBuf.push({ sector: (i + 1) as 1 | 2 | 3, pos }));
    return this.zoneTagBuf;
  }

  private subject(): CameraSubject | null {
    const c = this.followId ? this.cars.get(this.followId) : null;
    const target = c && c.visible ? c : [...this.cars.values()].find((x) => x.visible);
    if (!target) return null;
    this.fwd.set(Math.sin(target.yaw), 0, Math.cos(target.yaw));
    return { pos: target.pos, fwd: this.fwd, speed: target.speed, s: target.s };
  }

  private applyFrames(a: SimFrame, b: SimFrame, k: number, dt: number): void {
    const byIdA = this.byIdA;
    byIdA.clear();
    for (const c of a.cars) byIdA.set(c.id, c);
    for (const cb of b.cars) {
      const e = this.cars.get(cb.id);
      if (!e) continue;
      const ca = byIdA.get(cb.id) ?? cb;
      const x = ca.x + (cb.x - ca.x) * k;
      const y = ca.y + (cb.y - ca.y) * k;
      const jump = Math.hypot(cb.x - ca.x, cb.y - ca.y) > 60;
      const h = jump ? cb.heading : lerpAngle(ca.heading, cb.heading, k);
      e.speed = ca.speed + (cb.speed - ca.speed) * k;
      let px = jump ? cb.x : x;
      let py = jump ? cb.y : y;
      // The sim drives the pit lane centreline; slide into the working lane at the box.
      let shift = 0;
      if (cb.inPit && this.model && this.circuit) {
        const pit = this.model.pit;
        const pr = pit.project(px, py, e.pitS >= 0 ? e.pitS : undefined, 60);
        e.pitS = pr.s;
        const pl = this.circuit.pitLane;
        if (pr.s > pl.boxesStartS - 30 && pr.s < pl.boxesEndS + 30) shift = THREE.MathUtils.clamp((24 - e.speed) / 16, 0, 1);
      } else e.pitS = -1;
      e.boxShift += (shift - e.boxShift) * Math.min(1, dt * 3);
      if (e.boxShift > 0.01 && this.model && this.circuit) {
        const side = this.circuit.pitLane.side === 'left' ? 1 : -1;
        const hd = this.model.pit.headingAt(e.pitS);
        const off = side * 3.1 * e.boxShift;
        px += -Math.sin(hd) * off;
        py += Math.cos(hd) * off;
      }
      toWorld(px, py, 0, e.pos);
      e.yaw = yawFromHeading(h);
      e.s = cb.s;
      e.visible = cb.visible;
      const root = e.model.root;
      root.visible = cb.visible;
      e.shadow.visible = cb.visible;
      root.position.copy(e.pos);
      root.rotation.y = e.yaw;
      e.shadow.position.set(e.pos.x, 0.03, e.pos.z);
      e.shadow.rotation.set(-Math.PI / 2, 0, e.yaw);
      // Wheels + steering + brakes + aero
      e.spin += (e.speed * dt) / e.model.wheelRadius;
      for (const w of e.model.wheels) w.rotation.x = e.spin;
      const steer = cb.steer;
      e.model.steerPivots[0].rotation.y = steer;
      e.model.steerPivots[1].rotation.y = steer;
      e.brakeSmooth += (cb.brake - e.brakeSmooth) * Math.min(1, dt * 12);
      e.model.setBrake(e.brakeSmooth);
      const flapTarget = cb.aeroOpen ? 1 : 0;
      e.flap += (flapTarget - e.flap) * Math.min(1, dt * 8);
      e.model.rearFlap.rotation.x = -e.flap * 0.55;
      e.model.frontFlap.rotation.x = -e.flap * 0.25;
      const neutral = this.trackState === 'SC' || this.trackState === 'VSC' || this.trackState === 'SC_ENDING' || this.trackState === 'VSC_ENDING' || this.trackState === 'RED';
      e.model.setRainLight(neutral || cb.inPit || cb.boost ? Math.floor(this.clockT * 4) % 2 === 0 : false);
      const letter = TYRE_LETTER[cb.tyre] ?? 'M';
      if (letter !== e.tyre) {
        e.tyre = letter;
        e.model.setTyre(letter);
      }
      e.model.setHighlight(cb.id === this.followId ? 1 : 0);
      this.crews.update(cb.id, cb.visible && cb.inPit && e.boxShift > 0.85 && e.speed < 0.6, e.pos, e.yaw, e.teamColor, this.clockT);
      // Floor sparks at high speed on straights (cosmetic only).
      if (!this.opts.reducedMotion && this.opts.quality !== 'low' && cb.visible && e.speed > 78 && Math.random() < dt * 3.5) {
        const back = this.tmpV.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).multiplyScalar(-2.4).add(e.pos).setY(0.08);
        for (let n = 0; n < 6; n++)
          this.sparks.emit(back, this.sparkV.set((Math.random() - 0.5) * 3, Math.random() * 2.2, (Math.random() - 0.5) * 3).addScaledVector(this.fwd.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)), -e.speed * 0.25), this.sparkC, 0.35, 0.45);
      }
    }
    // Safety car
    if (this.sc) {
      const sb = b.safetyCar;
      const sa = a.safetyCar ?? sb;
      if (sb && sa) {
        this.sc.root.visible = true;
        const x = sa.x + (sb.x - sa.x) * k;
        const y = sa.y + (sb.y - sa.y) * k;
        toWorld(x, y, 0, this.sc.root.position);
        this.sc.root.rotation.y = yawFromHeading(lerpAngle(sa.heading, sb.heading, k));
        this.sc.setLightBar(sb.lights);
        const spin = (sb.speed * dt) / this.sc.wheelRadius;
        for (const w of this.sc.wheels) w.rotation.x += spin;
        this.sc.update(this.clockT);
      } else this.sc.root.visible = false;
    }
    this.env?.setLights(b.lights);
  }

  private updateMarkers(): void {
    const camPos = this.rig.camera.position;
    for (const e of this.cars.values()) {
      const dist = camPos.distanceTo(e.pos);
      const show = e.visible && dist > 160;
      e.marker.visible = show;
      if (show) {
        e.marker.position.set(e.pos.x, 2.5, e.pos.z);
        const s = e.id === this.followId ? 0.034 : e.id === this.rivalId ? 0.028 : 0.018;
        e.marker.scale.set(s, s, 1);
      }
    }
  }

  private updateZones(dt: number): void {
    if (!this.track) return;
    const k = Math.min(1, dt * (this.opts.reducedMotion ? 60 : 6));
    for (const z of this.track.zones) {
      if (!this.opts.reducedMotion) z.uniforms.uTime.value += dt;
      const sel = this.selectedZone === z.sector ? 1 : 0;
      z.uniforms.uSelected.value += (sel - z.uniforms.uSelected.value) * k;
      const base = this.zoneVisible ? (this.selectedZone ? 0.12 : 0.42) : 0;
      z.uniforms.uIntensity.value += (base - z.uniforms.uIntensity.value) * k;
      const on = z.uniforms.uIntensity.value + z.uniforms.uSelected.value > 0.01;
      z.floor.visible = on;
      z.walls.visible = on;
      z.gate.visible = on;
    }
  }

  private firework(): void {
    if (!this.circuit) return;
    const b = this.circuit.bounds;
    const p = new THREE.Vector3(b.minX + Math.random() * (b.maxX - b.minX), 80 + Math.random() * 60, -(b.minY + Math.random() * (b.maxY - b.minY)));
    const palette = ['#c6ff3d', '#2fe6ff', '#ff3b47', '#ffd12e', '#b26bff', '#ffffff'];
    this.particles.burst(p, new THREE.Color(palette[Math.floor(Math.random() * palette.length)]!), 90, 32, 1.8, 7);
  }

  /** Screen-space picking of cars (nearest within 28 px; overlaps return several). */
  private downAt: { x: number; y: number; t: number } | null = null;
  private onPointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 400) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const hits: Array<{ id: string; d: number }> = [];
    const v = new THREE.Vector3();
    for (const c of this.cars.values()) {
      if (!c.visible) continue;
      v.copy(c.pos).setY(0.6).project(this.rig.camera);
      if (v.z > 1) continue;
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const dist = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (dist < 30) hits.push({ id: c.id, d: dist });
    }
    hits.sort((a, b) => a.d - b.d);
    if (hits.length) this.opts.onPick(hits.map((h) => h.id));
  };

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.rig.resize(w / h);
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObs.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleLost);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    for (const c of this.cars.values()) {
      c.model.dispose();
      c.shadow.geometry.dispose();
      (c.marker.material as THREE.SpriteMaterial).dispose();
    }
    this.sc?.dispose();
    this.track?.dispose();
    this.env?.dispose();
    this.ringA.dispose();
    this.ringB.dispose();
    this.trail.dispose();
    this.particles.dispose();
    this.sparks.dispose();
    this.waves.dispose();
    this.rig.dispose();
    this.labels.dispose();
    this.composer?.dispose();
    this.envRT?.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const markerCache = new Map<string, THREE.Texture>();
function markerTexture(color: string): THREE.Texture {
  const hit = markerCache.get(color);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(32, 32, 19, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4;
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  markerCache.set(color, tex);
  return tex;
}
