/**
 * Contracts for procedural 3D models. All models are built from code
 * (no external assets), in metres, Y-up.
 *
 * Car convention: forward = +Z, up = +Y, origin on the ground at the
 * centre of the wheelbase. Use `object.lookAt()`-compatible orientation
 * (Object3D.lookAt points +Z at the target).
 */
import type * as THREE from 'three';
import type { TeamLivery } from '@/data/teams';

export type ModelQuality = 'low' | 'medium' | 'high';

export type TyreLetter = 'S' | 'M' | 'H' | 'I' | 'W';

export interface CarModelOptions {
  livery: TeamLivery;
  /** Race number painted on nose/engine cover. */
  number: number;
  /** Three-letter code, used for the nose/halo decal. */
  code: string;
  quality: ModelQuality;
}

export interface F1CarModel {
  root: THREE.Group;
  /** Wheel meshes/groups in order FL, FR, RL, RR. Rotate around local X to roll. */
  wheels: [THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D];
  /** Front wheel steering pivots (rotate around local Y). */
  steerPivots: [THREE.Object3D, THREE.Object3D];
  /** Rear wing upper flap pivot — rotate around local X (radians) to open (straight mode / DRS look). */
  rearFlap: THREE.Object3D;
  /** Front wing flap pivot (2026 active aero) — rotate around local X. */
  frontFlap: THREE.Object3D;
  /** Wheel radius in metres (for rolling speed). */
  wheelRadius: number;
  /** 0..1 brake light intensity. */
  setBrake(level: number): void;
  /** Rear rain light blink (on during SC/VSC, pit limiter, wet). */
  setRainLight(on: boolean): void;
  /** Tyre sidewall colour band by compound letter. */
  setTyre(letter: TyreLetter): void;
  /** Selected highlight (emissive edge/rim tint), 0..1. */
  setHighlight(level: number): void;
  dispose(): void;
}

export type SafetyCarKind = 'safety-mercedes' | 'safety-aston' | 'medical-mercedes' | 'medical-aston';

export interface RoadCarModel {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  /** Light bar flashing on/off; call `update(timeSec)` every frame to animate. */
  setLightBar(on: boolean): void;
  update(timeSec: number): void;
  dispose(): void;
}

export interface StartGantryModel {
  root: THREE.Group;
  /** 0..5 red light columns lit; -1 = all off (lights out); 'green' for formation/pit exit. */
  setLights(state: number | 'off' | 'green'): void;
  dispose(): void;
}

export interface CrowdOptions {
  /** World-space seat positions (x, y, z) — one person per entry. */
  seats: Float32Array;
  /** Facing direction (radians around Y) per seat, or a single shared value. */
  facing: Float32Array | number;
  /** Shirt colour palette (team colours); picked deterministically per seat. */
  palette: string[];
  quality: ModelQuality;
}

export interface CrowdModel {
  mesh: THREE.InstancedMesh | THREE.Mesh;
  /** Excitement 0..1 drives the wave/jump amplitude (shader uniform). */
  setExcitement(level: number): void;
  update(timeSec: number): void;
  dispose(): void;
}
