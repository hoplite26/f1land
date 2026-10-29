import type { LandmarkKind, TimeOfDay } from '@/data/circuits/types';
import type { ModelQuality } from '../../types';
import type { LandmarkModel } from './common';
import { createYasHotel } from './yasHotel';
import { createFerrisWheel } from './ferrisWheel';
import { createHarbour, createLakeShore, createMarina } from './waterfront';
import { createSphere } from './sphere';
import { createSakhirTower, createTowers } from './towers';
import { createStadium } from './stadium';
import { createBridge, createMountains, createObservationTower } from './misc';

export type { LandmarkModel } from './common';
export { buildBoatGeometry, type BoatKind } from './waterfront';
export { createBridge, createMountains, createObservationTower } from './misc';

/**
 * Builds a landmark in its local frame (origin on the ground, +Z = "front").
 * Frames: yas-hotel straddles a road along X (z ∈ [−7, 7]); bridge spans a
 * track along Z; harbour / marina / lake have the shore along X at z = 0 with
 * water towards +Z; stadium opens towards +X; mountains ring the origin at
 * ~1.6 km (scale the root to fit the circuit).
 */
export function createLandmark(kind: LandmarkKind, quality: ModelQuality, timeOfDay: TimeOfDay): LandmarkModel {
  switch (kind) {
    case 'yas-hotel':
      return createYasHotel(quality, timeOfDay);
    case 'ferris-wheel':
      return createFerrisWheel(quality, timeOfDay);
    case 'harbour':
      return createHarbour(quality, timeOfDay);
    case 'marina':
      return createMarina(quality, timeOfDay);
    case 'sphere':
      return createSphere(quality, timeOfDay);
    case 'towers':
      return createTowers(quality, timeOfDay);
    case 'sakhir-tower':
      return createSakhirTower(quality, timeOfDay);
    case 'stadium':
      return createStadium(quality, timeOfDay);
    case 'observation-tower':
      return createObservationTower(quality, timeOfDay);
    case 'mountains':
      return createMountains(quality, timeOfDay);
    case 'lake':
      return createLakeShore(quality, timeOfDay);
    case 'bridge':
      return createBridge(quality, timeOfDay);
  }
}
