import type { MarketId, Resolver, ResolverContext, ResolverOutput } from '../types';
import { resolveM01 } from './m01';
import { resolveM02 } from './m02';
import { resolveM03 } from './m03';
import { resolveM04 } from './m04';
import { resolveM05 } from './m05';
import { resolveM06 } from './m06';
import { resolveM07 } from './m07';
import { resolveM08 } from './m08';
import { resolveM09 } from './m09';
import { resolveM10 } from './m10';
import { resolveM11 } from './m11';
import { resolveM12 } from './m12';
import { resolveM13 } from './m13';
import { resolveM14 } from './m14';
import { resolveM15 } from './m15';
import { resolveM16 } from './m16';
import { resolveM17 } from './m17';
import { resolveM18 } from './m18';
import { resolveM19 } from './m19';
import { resolveM20 } from './m20';
import { resolveM21 } from './m21';

export const RESOLVERS: Readonly<Record<MarketId, Resolver>> = {
  'F1-M01': resolveM01,
  'F1-M02': resolveM02,
  'F1-M03': resolveM03,
  'F1-M04': resolveM04,
  'F1-M05': resolveM05,
  'F1-M06': resolveM06,
  'F1-M07': resolveM07,
  'F1-M08': resolveM08,
  'F1-M09': resolveM09,
  'F1-M10': resolveM10,
  'F1-M11': resolveM11,
  'F1-M12': resolveM12,
  'F1-M13': resolveM13,
  'F1-M14': resolveM14,
  'F1-M15': resolveM15,
  'F1-M16': resolveM16,
  'F1-M17': resolveM17,
  'F1-M18': resolveM18,
  'F1-M19': resolveM19,
  'F1-M20': resolveM20,
  'F1-M21': resolveM21,
};

export function resolve(ctx: ResolverContext): ResolverOutput {
  return RESOLVERS[ctx.pool.market_id](ctx);
}

export {
  resolveM01, resolveM02, resolveM03, resolveM04, resolveM05, resolveM06, resolveM07,
  resolveM08, resolveM09, resolveM10, resolveM11, resolveM12, resolveM13, resolveM14,
  resolveM15, resolveM16, resolveM17, resolveM18, resolveM19, resolveM20, resolveM21,
};
export { groupOf } from './classification';
export { evaluatePart } from './m21';
export { M13_GROUPS } from './m13';
export { M18_GROUPS } from './m18';
export {
  bucketOf,
  firstByOrder,
  inactiveOf,
  locationAt,
  officialClassification,
  sessionMarkers,
  snapshotAt,
} from './common';
export type { Location, LocationResult, Ordered } from './common';
