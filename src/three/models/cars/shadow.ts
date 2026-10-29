/**
 * Soft blob shadow for cars when real shadow maps are disabled. Geometry,
 * texture and material are shared; each call returns a new Mesh.
 */
import * as THREE from 'three';
import { shadowTexture } from './decals';

let geo: THREE.PlaneGeometry | null = null;
let mat: THREE.MeshBasicMaterial | null = null;

/** Sized for an F1 car (≈2.5 × 6 m); scale the mesh for other vehicles. */
export function createCarShadow(): THREE.Mesh {
  geo ??= new THREE.PlaneGeometry(2.5, 6.0).rotateX(-Math.PI / 2);
  mat ??= new THREE.MeshBasicMaterial({
    map: shadowTexture(),
    color: 0x000000,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'carShadow';
  m.position.y = 0.012;
  m.renderOrder = -1;
  m.frustumCulled = true;
  return m;
}
