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
import { createCarEnvironment, createF1Car, createRoadCar } from '@/three/models/cars';
import { shadowTexture } from '@/three/models/cars/decals';
import { buildTrackMeshes, toWorld, yawFromHeading, type TrackMeshes } from '@/three/track/trackMesh';
import { buildEnvironment, type EnvironmentHandle } from '@/three/track/environment';
import { createSkyDome, type PropsAtmosphere } from '@/three/models/props';
import { CameraRig, type CameraMode, type CameraSubject } from './cameraRig';
import { SceneColliders } from './colliders';
import { Beacon, BlobShadows, CarMarkers, MotionTrail, ParticleSystem, ScBeacons, SelectionRing, Shockwaves, SmokePuffs, SpeedLines } from './effects';
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
  idx: number;
  model: F1CarModel;
  tyre: TyreLetter | null;
  spin: number;
  flap: number;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  s: number;
  visible: boolean;
  inPit: boolean;
  brakeSmooth: number;
  teamColor: string;
  /** Arc length along the pit lane while in the pits (projection hint). */
  pitS: number;
  /** Smoothed lateral shift into the working lane at the box. */
  boxShift: number;
  /** Rendered small enough that the marker dot replaces the model (LOD). */
  tiny: boolean;
  /** Glide start after a stale feed recovers (F1-049). */
  g0: { x: number; z: number; yaw: number; s: number; lat: number; pit: boolean };
}

const TYRE_LETTER: Record<string, TyreLetter> = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };
const ASTON_SC = new Set(['mc-1929', 'gb-1948', 'jp-1962']);
/** Stale-feed recovery glide (F1-049): markers move to the current snapshot without replaying the gap. */
const GLIDE_DUR = 0.7;
const LOD_PX = 16;

export class RaceScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly colliders = new SceneColliders();
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private container: HTMLElement;
  private opts: SceneOptions;
  private circuit: CircuitData | null = null;
  private model: TrackModel | null = null;
  private track: TrackMeshes | null = null;
  private env: EnvironmentHandle | null = null;
  private cars = new Map<string, CarEntry>();
  private carList: CarEntry[] = [];
  private carPositions: THREE.Vector3[] = [];
  private sc: RoadCarModel | null = null;
  private frames: SimFrame[] = [];
  private renderT = 0;
  private followId: string | null = null;
  private rivalId: string | null = null;
  private labelIds: string[] = [];
  private ringA = new SelectionRing('#c6ff3d', 10);
  private ringB = new SelectionRing('#2fe6ff', 9);
  private trail = new MotionTrail('#c6ff3d', 40);
  private beaconA = new Beacon('#c6ff3d');
  private beaconB = new Beacon('#2fe6ff', 20, 0.9);
  private crews = new PitCrews();
  private medical: RoadCarModel | null = null;
  private scActive: RoadCarModel | null = null;
  private scBeacons: ScBeacons | null = null;
  private byIdA = new Map<string, SimFrame['cars'][number]>();
  private sparkV = new THREE.Vector3();
  private sparkC = new THREE.Color(1, 0.75, 0.35);
  private burstC = new THREE.Color();
  private particles = new ParticleSystem(1200);
  private sparks = new ParticleSystem(500, 6);
  private smoke = new SmokePuffs(180);
  private waves = new Shockwaves();
  private speedLines = new SpeedLines();
  private shadows: BlobShadows | null = null;
  private markers: CarMarkers | null = null;
  private labels: LabelLayer;
  private labelBuf: LabelTarget[] = [];
  private zoneTagBuf: ZoneTag[] = [];
  private clockT = 0;
  private selectedZone: 1 | 2 | 3 | null = null;
  private zoneVisible = true;
  private trackState: TrackState = 'GREEN';
  private sectorFlags: boolean[] = [false, false, false];
  private excitement = 0.2;
  private speedBoost = 0;
  private disposed = false;
  private contextLost = false;
  private sun: THREE.DirectionalLight | null = null;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private envRT: THREE.WebGLRenderTarget | null = null;
  private carEnvRT: THREE.WebGLRenderTarget | null = null;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private rivalFwd = new THREE.Vector3();
  private subjectBuf: CameraSubject = { pos: new THREE.Vector3(), fwd: this.fwd, speed: 0, s: 0 };
  private rivalBuf: CameraSubject = { pos: new THREE.Vector3(), fwd: this.rivalFwd, speed: 0, s: 0 };
  private p2: [number, number] = [0, 0];
  private lastFrameT = -1;
  private fireworksUntil = 0;
  private glideT = 1;
  private placedFromFeed = false;
  private resizeObs: ResizeObserver;
  // Adaptive resolution.
  private dpr = 1;
  private dprCap = 1;
  private dprMin = 1;
  private emaDt = 1 / 60;
  private slowT = 0;
  private fastT = 0;

  constructor(container: HTMLElement, opts: SceneOptions) {
    this.container = container;
    this.opts = opts;
    const q = opts.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false });
    const dpr = window.devicePixelRatio || 1;
    // DPR cap per tier (≤ 2); adaptive steps below the cap when frames run long.
    this.dprCap = Math.min(dpr, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.dprMin = Math.min(this.dprCap, q === 'low' ? 0.85 : 1);
    this.dpr = this.dprCap;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = q === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    this.scene.add(this.ringA.mesh, this.ringB.mesh, this.trail.mesh, this.particles.points, this.sparks.points, this.smoke.points, this.waves.group, this.beaconA.mesh, this.beaconB.mesh, this.crews.mesh, this.speedLines.mesh);
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
  stats(): { calls: number; triangles: number; geometries: number; textures: number; programs: number; shot: string; dpr: number; colliders: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, shot: this.rig.currentShot, dpr: this.dpr, colliders: this.colliders.size };
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
    onProgress?.(0.55);
    await tick();
    if (this.disposed) return;
    // Camera occlusion proxies from the static scenery (stands, buildings, trees, landmarks).
    this.colliders.build([this.env.group]);
    this.rig.setColliders(this.colliders);
    onProgress?.(0.62);
    await tick();
    if (this.disposed) return;
    let i = 0;
    for (const id of driverIds) {
      this.addCar(id);
      if (++i % 6 === 0) {
        onProgress?.(0.62 + (0.33 * i) / driverIds.length);
        await tick();
        if (this.disposed) return;
      }
    }
    const sc: RoadCarModel = createRoadCar(ASTON_SC.has(circuit.id) ? 'safety-aston' : 'safety-mercedes', q);
    sc.root.visible = false;
    sc.setLightBar(true);
    this.scene.add(sc.root);
    this.sc = sc;
    const roof = new THREE.Box3().setFromObject(sc.root, true).max.y;
    this.scBeacons = new ScBeacons(Number.isFinite(roof) && roof > 0.5 ? roof : 1.3);
    const n = this.carList.length;
    this.shadows = new BlobShadows(shadowTexture(), n + 2);
    this.markers = new CarMarkers(this.carList.map((c) => c.teamColor), this.dpr);
    this.scene.add(this.shadows.mesh, this.markers.points);
    // Livery-true paint: time-of-day studio IBL on every car material.
    this.carEnvRT = createCarEnvironment(this.renderer, circuit.timeOfDay);
    for (const c of this.carList) this.applyCarEnv(c.model.root);
    this.applyCarEnv(sc.root);
    this.rig.setTvSpots(this.env.tvSpots);
    this.rig.setCorridor(this.env.layout.barrier);
    this.rig.setTrack(model.track, circuit.widthM / 2, circuit.bounds);
    this.rig.setGrid(model.gridS(0));
    this.rig.setCars(this.carPositions);
    this.rig.onShot = (shot) => this.labels.setShot(shot);
    this.labels.setShot(this.rig.currentShot);
    this.placeOnGrid();
    this.setupPost();
    onProgress?.(1);
  }

  private applyCarEnv(root: THREE.Object3D): void {
    const env = this.carEnvRT?.texture ?? null;
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial && std.envMap !== env) {
          std.envMap = env;
          std.needsUpdate = true;
        }
      }
    });
  }

  /** Before the feed is live the cars wait on their grid slots (decoration only, no labels). */
  private placeOnGrid(): void {
    const m = this.model;
    if (!m) return;
    this.carList.forEach((e, slot) => {
      const s = m.gridS(slot);
      m.track.pointAt(s, (slot % 2 === 0 ? 1 : -1) * 2.2, this.p2);
      toWorld(this.p2[0], this.p2[1], 0, e.pos);
      e.yaw = yawFromHeading(m.track.headingAt(s));
      e.s = s;
      e.speed = 0;
      e.visible = true;
      const root = e.model.root;
      root.visible = true;
      root.position.copy(e.pos);
      root.rotation.y = e.yaw;
      e.model.setBrake(0);
      e.model.setHighlight(0);
    });
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

  /** Prefiltered sky (+ floodlight panels at night) for scenery reflections. */
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
    const tod = this.circuit?.timeOfDay;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(Math.max(1, w), Math.max(1, h));
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    // Only emissive/neon parts bloom: bright skies stay crisp (no wash-out).
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), tod === 'day' ? 0.28 : tod === 'dusk' ? 0.45 : 0.8, 0.5, tod === 'day' ? 0.96 : tod === 'dusk' ? 0.92 : 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  private addCar(id: string): void {
    const d = DRIVER_BY_ID[id];
    if (!d) return;
    const team = TEAM_BY_ID[d.teamId]!;
    const teammates = Object.values(DRIVER_BY_ID).filter((x) => x.teamId === d.teamId).sort((a, b) => a.number - b.number);
    const model = createF1Car({ livery: team.livery, number: d.number, code: d.code, quality: this.opts.quality, tcam: teammates[0]?.id === id ? 'black' : 'yellow', castShadow: this.opts.quality === 'high' });
    this.scene.add(model.root);
    const e: CarEntry = {
      id,
      idx: this.carList.length,
      model,
      tyre: null,
      spin: 0,
      flap: 0,
      pos: new THREE.Vector3(),
      yaw: 0,
      speed: 0,
      s: 0,
      visible: true,
      inPit: false,
      brakeSmooth: 0,
      teamColor: team.color,
      pitS: -1,
      boxShift: 0,
      tiny: false,
      g0: { x: 0, z: 0, yaw: 0, s: 0, lat: 0, pit: false },
    };
    this.cars.set(id, e);
    this.carList.push(e);
    this.carPositions.push(e.pos);
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
    this.placedFromFeed = false;
    this.placeOnGrid();
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
    const c = this.circuit;
    const m = this.model;
    if (!c || !m) return;
    if (!sector) {
      this.rig.setZoneFocus(null);
      return;
    }
    const sec = c.sectors[sector - 1]!;
    const L = c.centerlineLengthM;
    const len = (((sec.endS - sec.startS) % L) + L) % L;
    m.track.pointAt(sec.startS + len / 2, 0, this.p2);
    const mid = this.tmpV2.set(this.p2[0], 0, -this.p2[1]);
    // Overview keeps the whole circuit in frame with the selected sector on the camera side.
    if (frame) this.rig.frameZone(mid);
    else this.rig.setZoneFocus(mid);
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
    const followed = !!this.followId && m.drivers.includes(this.followId);
    // Director cues and crowd reactions are not motion effects: keep them under reduced motion.
    switch (m.kind) {
      case 'START':
        this.rig.cue('start');
        this.env?.cheer(1);
        break;
      case 'OVERTAKE':
        if (followed) this.rig.cue('overtake');
        this.env?.cheer(followed ? 0.8 : 0.4);
        break;
      case 'BATTLE':
        if (followed) this.rig.cue('battle');
        break;
      case 'SC':
      case 'VSC':
      case 'RED':
        this.rig.cue('sc');
        if (!this.opts.reducedMotion) this.labels.flash('sc');
        break;
      case 'PIT':
        if (followed) this.rig.cue('pit');
        break;
      case 'FASTEST_LAP':
        if (followed) this.rig.cue('fastest');
        break;
      case 'FINISH':
        this.rig.cue('finish');
        this.env?.cheer(1);
        break;
      default:
        break;
    }
    if (this.opts.reducedMotion) {
      if (m.kind === 'FINISH') this.excitement = 1;
      return;
    }
    const lead = m.drivers[0] ? this.cars.get(m.drivers[0]) : undefined;
    if (m.kind === 'OVERTAKE' && lead) {
      this.waves.spawn(lead.pos, followed ? '#c6ff3d' : '#2fe6ff');
      this.burstC.set(followed ? '#c6ff3d' : '#2fe6ff');
      this.particles.burst(this.tmpV.copy(lead.pos).setY(0.6), this.burstC, followed ? 60 : 30, 9, 0.9, 1.1);
      if (followed) {
        this.labels.flash('overtake');
        this.ringA.flare();
        this.speedBoost = 1;
      }
      this.excitement = 1;
    } else if (m.kind === 'START') {
      this.excitement = 1;
    } else if (m.kind === 'FINISH') {
      this.excitement = 1;
      this.fireworksUntil = this.clockT + 14;
      this.labels.flash('finish');
    } else if (m.kind === 'FASTEST_LAP' && lead) {
      this.burstC.set('#b26bff');
      this.particles.burst(this.tmpV.copy(lead.pos).setY(1), this.burstC, 40, 6, 0.9, 1.1);
      this.waves.spawn(lead.pos, '#b26bff');
      if (followed) this.labels.flash('fastest');
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
    this.adaptResolution(dt);
    const latest = this.frames[this.frames.length - 1];
    if (latest) {
      // Render ~1 frame behind the newest sample; a stale feed freezes markers (F1-049).
      const target = latest.t - 0.1;
      if (stale) this.renderT = Math.min(this.renderT, target);
      else if (Math.abs(target - this.renderT) > 2) {
        // Feed recovered (or first samples): glide to the current snapshot instead of jumping.
        if (this.placedFromFeed && !this.opts.reducedMotion) this.beginGlide();
        this.renderT = target;
      } else this.renderT += dt + (target - this.renderT) * 0.1;
    }
    const ip = this.interpolate();
    if (ip) {
      this.applyFrames(ip.a, ip.b, ip.k, dt);
      this.placedFromFeed = true;
    }
    if (this.glideT < 1) this.glideT = Math.min(1, this.glideT + dt / GLIDE_DUR);
    const subject = ip ? this.subject() : null;
    const rival = ip ? this.rivalSubject() : null;
    this.rig.update(dt, subject, rival, this.clockT);
    const cam = this.rig.camera;
    this.updateLod();
    this.updateZones(dt);
    const fc = ip && this.followId ? this.cars.get(this.followId) : undefined;
    const rc = ip && this.rivalId ? this.cars.get(this.rivalId) : undefined;
    this.ringA.update(dt, fc?.visible ? fc.pos : null, this.opts.reducedMotion);
    this.ringB.update(dt, rc?.visible ? rc.pos : null, this.opts.reducedMotion);
    this.trail.update(dt, fc?.visible ? fc.pos : null);
    this.beaconA.update(dt, fc?.visible ? fc.pos : null, cam.position, this.opts.reducedMotion);
    this.beaconB.update(dt, rc?.visible ? rc.pos : null, cam.position, this.opts.reducedMotion);
    this.particles.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.waves.update(dt);
    this.updateSpeedLines(dt, subject);
    if (this.fireworksUntil > this.clockT && Math.random() < dt * 2.5) this.firework();
    this.excitement = Math.max(0.15, this.excitement - dt * 0.12);
    this.env?.update(this.clockT, this.excitement, ip?.b ?? null);
    const focus = subject?.pos ?? (this.carList[0]?.pos ?? null);
    if (this.sun && focus && this.opts.quality === 'high') {
      this.sun.target.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(this.sunDir, 300);
    }
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, cam);
    this.labels.update(cam, this.container, this.labelTargets(ip !== null), this.zoneTags(), this.selectedZone);
  }

  private adaptResolution(dt: number): void {
    if (this.dprCap <= this.dprMin) return;
    this.emaDt += (dt - this.emaDt) * 0.05;
    this.slowT = this.emaDt > 1 / 32 ? this.slowT + dt : 0;
    this.fastT = this.emaDt < 1 / 55 ? this.fastT + dt : 0;
    let next = this.dpr;
    if (this.slowT > 2.5 && this.dpr > this.dprMin) next = Math.max(this.dprMin, this.dpr - 0.25);
    else if (this.fastT > 6 && this.dpr < this.dprCap) next = Math.min(this.dprCap, this.dpr + 0.25);
    if (next === this.dpr) return;
    this.dpr = next;
    this.slowT = this.fastT = 0;
    this.renderer.setPixelRatio(next);
    this.composer?.setPixelRatio(next);
    this.markers?.setPixelRatio(next);
    this.resize();
  }

  private updateSpeedLines(dt: number, subject: CameraSubject | null): void {
    this.speedBoost = Math.max(0, this.speedBoost - dt * 1.4);
    const shot = this.rig.currentShot;
    let amount = 0;
    if (subject && this.opts.quality !== 'low' && !this.opts.reducedMotion && !this.rig.frozen) {
      const close = shot === 'follow' || shot === 'duel' || shot === 'onboard';
      const v = THREE.MathUtils.clamp((subject.speed - 48) / 40, 0, 1);
      if (close) amount = v * (shot === 'onboard' ? 0.85 : 0.5) + this.speedBoost * 0.5;
      else if (shot === 'tv' || shot === 'side' || shot === 'front') amount = this.speedBoost * 0.35;
    }
    let cx = 0;
    let cy = 0.05;
    if (amount > 0.01 && subject) {
      const p = this.tmpV.copy(subject.pos).addScaledVector(subject.fwd, 40).setY(1).project(this.rig.camera);
      if (p.z < 1) {
        cx = p.x;
        cy = p.y;
      }
    }
    this.speedLines.update(dt, amount, this.rig.camera.aspect, cx, cy);
  }

  private labelTargets(live: boolean): LabelTarget[] {
    const out = this.labelBuf;
    out.length = 0;
    if (!live) return out;
    for (const id of this.labelIds) {
      const c = this.cars.get(id);
      if (!c || !c.visible) continue;
      out.push({ id, pos: c.pos, kind: id === this.followId ? 'follow' : id === this.rivalId ? 'rival' : 'near' });
    }
    if (this.scActive?.root.visible) out.push({ id: this.scActive === this.medical ? '__med' : '__sc', pos: this.scActive.root.position, kind: 'sc' });
    return out;
  }

  private zoneTags(): ZoneTag[] | null {
    if (!this.track || !this.zoneVisible) return null;
    if (!this.zoneTagBuf.length) this.track.sectorAnchors.forEach((pos, i) => this.zoneTagBuf.push({ sector: (i + 1) as 1 | 2 | 3, pos }));
    return this.zoneTagBuf;
  }

  private subject(): CameraSubject | null {
    const c = this.followId ? this.cars.get(this.followId) : null;
    let target = c && c.visible ? c : null;
    for (let i = 0; !target && i < this.carList.length; i++) if (this.carList[i]!.visible) target = this.carList[i]!;
    if (!target) return null;
    const out = this.subjectBuf;
    out.pos = target.pos;
    this.fwd.set(Math.sin(target.yaw), 0, Math.cos(target.yaw));
    out.speed = target.speed;
    out.s = target.s;
    out.id = target.id;
    return out;
  }

  private rivalSubject(): CameraSubject | null {
    const c = this.rivalId && this.rivalId !== this.followId ? this.cars.get(this.rivalId) : null;
    if (!c || !c.visible || c.inPit) return null;
    const out = this.rivalBuf;
    out.pos = c.pos;
    this.rivalFwd.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    out.speed = c.speed;
    out.s = c.s;
    out.id = c.id;
    return out;
  }

  /** Snapshot the rendered pose of every car; applyFrames blends from it for GLIDE_DUR. */
  private beginGlide(): void {
    const m = this.model;
    if (!m) return;
    for (const e of this.carList) {
      const pr = m.track.project(e.pos.x, -e.pos.z, e.s, 60);
      e.g0.x = e.pos.x;
      e.g0.z = e.pos.z;
      e.g0.yaw = e.yaw;
      e.g0.s = pr.s;
      e.g0.lat = pr.lateral;
      e.g0.pit = e.inPit || pr.distance > (this.circuit!.widthM / 2) + 4;
    }
    this.glideT = 0;
  }

  private applyFrames(a: SimFrame, b: SimFrame, k: number, dt: number): void {
    const byIdA = this.byIdA;
    byIdA.clear();
    for (const c of a.cars) byIdA.set(c.id, c);
    const m = this.model;
    const camPos = this.rig.camera.position;
    const glide = this.glideT < 1 ? easeInOut(this.glideT) : 1;
    const neutral = this.trackState === 'SC' || this.trackState === 'VSC' || this.trackState === 'SC_ENDING' || this.trackState === 'VSC_ENDING' || this.trackState === 'RED';
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
      if (cb.inPit && m && this.circuit) {
        const pit = m.pit;
        const pr = pit.project(px, py, e.pitS >= 0 ? e.pitS : undefined, 60);
        e.pitS = pr.s;
        const pl = this.circuit.pitLane;
        if (pr.s > pl.boxesStartS - 30 && pr.s < pl.boxesEndS + 30) shift = THREE.MathUtils.clamp((24 - e.speed) / 16, 0, 1);
      } else e.pitS = -1;
      e.boxShift += (shift - e.boxShift) * Math.min(1, dt * 3);
      if (e.boxShift > 0.01 && m && this.circuit) {
        const side = this.circuit.pitLane.side === 'left' ? 1 : -1;
        const hd = m.pit.headingAt(e.pitS);
        const off = side * 3.1 * e.boxShift;
        px += -Math.sin(hd) * off;
        py += Math.cos(hd) * off;
      }
      toWorld(px, py, 0, e.pos);
      e.yaw = yawFromHeading(h);
      if (glide < 1 && m) {
        // Glide along the track (forward, never replaying laps) or straight in the pit lane.
        const g = e.g0;
        if (!g.pit && !cb.inPit) {
          const pr = m.track.project(px, py, cb.s, 60);
          let ds = m.track.delta(g.s, pr.s);
          if (ds < -30) ds += m.track.length;
          const s = g.s + ds * glide;
          m.track.pointAt(s, g.lat + (pr.lateral - g.lat) * glide, this.p2);
          toWorld(this.p2[0], this.p2[1], 0, e.pos);
          e.yaw = glide > 0.85 ? lerpAngle(yawFromHeading(m.track.headingAt(s)), e.yaw, (glide - 0.85) / 0.15) : yawFromHeading(m.track.headingAt(s));
        } else {
          e.pos.x = g.x + (e.pos.x - g.x) * glide;
          e.pos.z = g.z + (e.pos.z - g.z) * glide;
          e.yaw = lerpAngle(g.yaw, e.yaw, glide);
        }
      }
      e.s = cb.s;
      e.visible = cb.visible;
      e.inPit = cb.inPit;
      const root = e.model.root;
      root.position.copy(e.pos);
      root.rotation.y = e.yaw;
      // Wheels + steering + brakes + aero
      e.spin = (e.spin + (e.speed * dt) / e.model.wheelRadius) % (Math.PI * 2);
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
      e.model.setRainLight(neutral || cb.inPit || cb.boost ? Math.floor(this.clockT * 4) % 2 === 0 : false);
      const letter = TYRE_LETTER[cb.tyre] ?? 'M';
      if (letter !== e.tyre) {
        e.tyre = letter;
        e.model.setTyre(letter);
      }
      e.model.setHighlight(cb.id === this.followId ? 1 : 0);
      this.crews.update(cb.id, cb.visible && cb.inPit && e.boxShift > 0.85 && e.speed < 0.6, e.pos, e.yaw, e.teamColor, this.clockT);
      if (!cb.visible || this.opts.reducedMotion || this.opts.quality === 'low') continue;
      const near = camPos.distanceToSquared(e.pos) < 160 * 160;
      if (!near) continue;
      const fx = Math.sin(e.yaw);
      const fz = Math.cos(e.yaw);
      // Floor-plank sparks at top speed (cosmetic, derived from the sampled speed).
      if (e.speed > 78 && Math.random() < dt * 3.5) {
        const back = this.tmpV.set(fx, 0, fz).multiplyScalar(-2.4).add(e.pos).setY(0.08);
        for (let n = 0; n < 6; n++) this.sparks.emit(back, this.sparkV.set((Math.random() - 0.5) * 3 - fx * e.speed * 0.25, Math.random() * 2.2, (Math.random() - 0.5) * 3 - fz * e.speed * 0.25), this.sparkC, 0.35, 0.45);
      }
      // Heavy braking from speed: faint smoke off the front tyres (sim brake level only, no invented lock-ups).
      if (!cb.inPit && cb.brake > 0.82 && e.speed > 42 && Math.random() < dt * 9) {
        for (const side of [1, -1]) {
          const wx = e.pos.x + fx * 1.7 + fz * 0.8 * side;
          const wz = e.pos.z + fz * 1.7 - fx * 0.8 * side;
          this.smoke.emit(wx, 0.3, wz, fx * e.speed * 0.25 + (Math.random() - 0.5), 0.4 + Math.random() * 0.4, fz * e.speed * 0.25 + (Math.random() - 0.5), 0.9 + Math.random() * 0.5);
        }
      }
    }
    // Safety car / medical car (leads the pack with the light bar flashing) — only when the sim says so.
    const sb = b.safetyCar;
    const sa = a.safetyCar ?? sb;
    let active: RoadCarModel | null = null;
    if (sb && sa && sb.visible !== false) {
      if (sb.kind === 'MEDICAL' && !this.medical && this.circuit) {
        this.medical = createRoadCar(ASTON_SC.has(this.circuit.id) ? 'medical-aston' : 'medical-mercedes', this.opts.quality);
        this.applyCarEnv(this.medical.root);
        this.scene.add(this.medical.root);
      }
      active = sb.kind === 'MEDICAL' ? this.medical : this.sc;
    }
    for (const r of [this.sc, this.medical]) if (r && r !== active) r.root.visible = false;
    if (active && sb && sa) {
      active.root.visible = true;
      const x = sa.x + (sb.x - sa.x) * k;
      const y = sa.y + (sb.y - sa.y) * k;
      toWorld(x, y, 0, active.root.position);
      active.root.rotation.y = yawFromHeading(lerpAngle(sa.heading, sb.heading, k));
      active.setLightBar(sb.lights);
      const spin = (sb.speed * dt) / active.wheelRadius;
      for (const w of active.wheels) w.rotation.x = (w.rotation.x + spin) % (Math.PI * 2);
      active.update(this.clockT);
    }
    this.scActive = active;
    this.scBeacons?.update(active?.root ?? null, !!sb?.lights, this.clockT, active ? camPos.distanceTo(active.root.position) : 0);
    this.env?.setLights(b.lights);
  }

  /** Marker dots replace cars that are only a few pixels tall; blob shadows follow visible models. */
  private updateLod(): void {
    const cam = this.rig.camera;
    const camPos = cam.position;
    const sh = this.shadows;
    const mk = this.markers;
    const pxPerRad = this.container.clientHeight / THREE.MathUtils.degToRad(cam.fov);
    for (const e of this.carList) {
      const dist = camPos.distanceTo(e.pos);
      const carPx = (5.6 / Math.max(1, dist)) * pxPerRad;
      const tiny = e.visible && carPx < LOD_PX;
      e.tiny = tiny;
      e.model.root.visible = e.visible && !tiny;
      if (mk) {
        const px = e.id === this.followId ? 15 : e.id === this.rivalId ? 13 : 9;
        mk.set(e.idx, tiny ? e.pos : null, px);
      }
      sh?.set(e.idx, e.visible && !tiny ? e.pos : null, e.yaw);
    }
    if (sh) {
      const n = this.carList.length;
      for (const [i, r] of [[n, this.sc], [n + 1, this.medical]] as const) {
        const vis = !!r && r.root.visible;
        sh.set(i, vis ? r!.root.position : null, vis ? r!.root.rotation.y : 0, 0.86, 0.82);
      }
      sh.commit();
    }
    mk?.commit();
  }

  private updateZones(dt: number): void {
    if (!this.track) return;
    const k = Math.min(1, dt * (this.opts.reducedMotion ? 60 : 6));
    for (const z of this.track.zones) {
      if (!this.opts.reducedMotion) z.uniforms.uTime.value += dt;
      const sel = this.selectedZone === z.sector ? 1 : 0;
      z.uniforms.uSelected.value += (sel - z.uniforms.uSelected.value) * k;
      const base = this.zoneVisible ? (this.selectedZone ? 0.08 : 0.24) : 0;
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
    const p = this.tmpV.set(b.minX + Math.random() * (b.maxX - b.minX), 80 + Math.random() * 60, -(b.minY + Math.random() * (b.maxY - b.minY)));
    const palette = ['#c6ff3d', '#2fe6ff', '#ff3b47', '#ffd12e', '#b26bff', '#ffffff'];
    this.burstC.set(palette[Math.floor(Math.random() * palette.length)]!);
    this.particles.burst(p, this.burstC, 90, 32, 1.8, 7);
  }

  /** Screen-space picking of cars (nearest within 30 px; overlaps return several). */
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
    for (const c of this.carList) {
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
    for (const c of this.carList) c.model.dispose();
    this.sc?.dispose();
    this.medical?.dispose();
    this.scBeacons?.dispose();
    this.shadows?.dispose();
    this.markers?.dispose();
    this.crews.dispose();
    this.beaconA.dispose();
    this.beaconB.dispose();
    this.track?.dispose();
    this.env?.dispose();
    this.ringA.dispose();
    this.ringB.dispose();
    this.trail.dispose();
    this.particles.dispose();
    this.sparks.dispose();
    this.smoke.dispose();
    this.waves.dispose();
    this.speedLines.dispose();
    this.rig.dispose();
    this.labels.dispose();
    this.composer?.dispose();
    this.envRT?.dispose();
    this.carEnvRT?.dispose();
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

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
