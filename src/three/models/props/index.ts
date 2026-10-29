/**
 * Procedural environment props for circuits (crowds, grandstands, start
 * gantry, pit complex, trackside, vegetation, buildings, landmarks, sky/water/
 * ground). All geometry/textures are generated in code and cached.
 *
 * Per frame: call `updatePropsTime(t)` once (wind, boats, water) plus the
 * `update(t)` of animated props (crowds, landmarks, pit screen).
 * Time of day: factories taking a TimeOfDay set the shared night level; use
 * `setPropsTimeOfDay(tod | 0..1)` to change/animate it globally.
 */
export {
  PROP_UNIFORMS,
  setPropsTimeOfDay,
  updatePropsTime,
  nightLevel,
  disposeProp,
  disposePropsCache,
  getVCMaterial,
  MeshBuilder,
  Rng,
  type Glow,
} from './core';
export { createCrowd, type CrowdModelExt } from './crowd';
export { createGrandstand, STAND_ROW_DEPTH, STAND_ROW_RISE, type GrandstandOptions, type GrandstandModel } from './grandstand';
export { createStartGantry } from './gantry';
export { createPitComplex, createPitBoxMarkings, PIT_WALL_Z, type PitComplexOptions, type PitComplexModel } from './pitComplex';
export {
  createBarrierRun,
  createAdBoards,
  createLampPosts,
  createMarshalPosts,
  createTvTowers,
  createLightTowers,
  type BarrierKind,
  type TracksideRunOptions,
  type AdBoardOptions,
  type LampPostOptions,
} from './trackside';
export { createTrees, createBushes, type TreeKind, type TreeOptions, type BushOptions } from './vegetation';
export {
  createBuildings,
  createSkyline,
  getFacadeMaterial,
  type BuildingFootprint,
  type BuildingStyle,
  type BuildingsOptions,
  type SkylineOptions,
} from './buildings';
export { createLandmark, createMountains, createBridge, createObservationTower, buildBoatGeometry, type LandmarkModel, type BoatKind } from './landmarks';
export {
  createSkyDome,
  createWaterMaterial,
  createGroundMaterial,
  getAtmosphere,
  applyPropsTimeOfDay,
  type SkyDome,
  type AnimatedMaterial,
  type PropsAtmosphere,
} from './environment';
export { BRANDS, getBrandAtlas, brandTileUV, getBannerTexture, getGroundTexture } from './textures';
