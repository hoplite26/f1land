import { registerDict } from '@/i18n/core';

/** Feature dictionaries: every `dicts/*.ts` default-exports `{ ru, en }`. */
type FeatureDict = { ru: Record<string, string>; en: Record<string, string> };

const modules = import.meta.glob<{ default: FeatureDict }>('./dicts/*.ts', { eager: true });

export function registerFeatureDicts(): void {
  for (const mod of Object.values(modules)) {
    registerDict('ru', mod.default.ru);
    registerDict('en', mod.default.en);
  }
}
