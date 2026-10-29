import * as THREE from 'three';
import type { CircuitData } from '@/data/circuits/types';
import type { SimFrame } from '@/sim/types';
import type { TrackModel } from '@/sim/trackModel';
import type { ModelQuality } from '@/three/models/types';
import {
  applyPropsTimeOfDay, createGrandstand, createGroundMaterial, createLandmark,
  createSkyDome, createStartGantry, updatePropsTime,
} from '@/three/models/props';
import type { TrackMeshes } from './trackMesh';
import { toWorld, yawFromHeading } from './trackMesh';

export interface EnvironmentHandle {
  group: THREE.Group;
  update(time: number, excitement: number, frame: SimFrame | null): void;
  setLights(state: number | 'off'): void;
  dispose(): void;
}

/** Assemble the procedural track surroundings using the circuit's own layout. */
export function buildEnvironment({ circuit, model, quality }: {
  circuit: CircuitData;
  model: TrackModel;
  track: TrackMeshes;
  quality: ModelQuality;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
}): EnvironmentHandle {
  const group = new THREE.Group();
  applyPropsTimeOfDay(circuit.timeOfDay, circuit.theme);
  const sky = createSkyDome(circuit.timeOfDay, circuit.theme);
  group.add(sky.mesh);

  const bounds = circuit.bounds;
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1000) + 3000;
  const groundGeometry = new THREE.PlaneGeometry(size, size);
  const groundMaterial = createGroundMaterial(circuit.theme, circuit.timeOfDay, { quality, repeat: size / 24 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, -0.08, -(bounds.minY + bounds.maxY) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  const gantry = createStartGantry(circuit.widthM);
  const start = model.track.pointAt(0);
  gantry.root.position.copy(toWorld(start[0], start[1]));
  gantry.root.rotation.y = yawFromHeading(model.track.headingAt(0));
  group.add(gantry.root);

  const stands = circuit.grandstands.map((spec) => {
    const stand = createGrandstand({ lengthM: spec.lengthM, rows: spec.rows, quality, palette: ['#e43b3b', '#f2d543', '#e8e8e8', '#4e81d2'], bannerText: spec.name });
    const side = spec.side === 'left' ? 1 : -1;
    const p = model.track.pointAt(spec.s, side * spec.offsetM);
    stand.root.position.copy(toWorld(p[0], p[1]));
    stand.root.rotation.y = yawFromHeading(model.track.headingAt(spec.s)) + (side === 1 ? Math.PI / 2 : -Math.PI / 2);
    group.add(stand.root);
    return stand;
  });
  const landmarks = circuit.landmarks.map((spec) => {
    const landmark = createLandmark(spec.kind, quality, circuit.timeOfDay);
    landmark.root.position.copy(toWorld(spec.position[0], spec.position[1]));
    landmark.root.rotation.y = yawFromHeading(spec.rotation);
    landmark.root.scale.setScalar(spec.scale);
    group.add(landmark.root);
    return landmark;
  });
  return {
    group,
    update(time, excitement) {
      updatePropsTime(time);
      sky.update(time);
      for (const stand of stands) { stand.crowd.setExcitement(excitement); stand.update(time); }
      for (const landmark of landmarks) landmark.update(time);
    },
    setLights: (state) => gantry.setLights(state),
    dispose() {
      sky.dispose();
      groundGeometry.dispose();
      groundMaterial.dispose();
      gantry.dispose();
      for (const stand of stands) stand.dispose();
      for (const landmark of landmarks) landmark.dispose();
      group.removeFromParent();
    },
  };
}
