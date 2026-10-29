export {
  CATALOG,
  COMBO_PAIRS,
  COMBO_PART_CAPABILITIES,
  COMPOUNDS,
  MARKET_IDS,
  POSITION_GROUPS,
  bucketOutcomes,
  describePool,
  getTemplate,
  isShortTerm,
  listTemplates,
  requiredCapabilitiesFor,
  thresholdsFor,
} from './catalog';
export type { CopyRef, MarketTemplate, NeutralisationRule, PoolCopy, PoolParams, PositionGroup, RedFlagRule, SubjectKind } from './catalog';
export { PoolValidationError, createPool, planPoolTiming, resolveTargetBounds, validatePoolTemplate } from './factory';
export type { PlanTimingOptions, PoolTiming, ValidationCode, ValidationIssue, ValidationResult } from './factory';
export { F1_I18N, formatI18n } from './i18n';
export type { F1Locale } from './i18n';
