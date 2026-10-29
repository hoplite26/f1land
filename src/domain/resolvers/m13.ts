/**
 * F1-M13 — final group of A in the Grand Prix: P1, P2_3, P4_10, P11_PLUS,
 * NOT_CLASSIFIED, DNS, DSQ. SESSION_FINAL only; a classified retiree keeps
 * its group (QA15). No official result by planned end + 24 h → VOID reason.
 */
import type { Resolver } from '../types';
import { resolveSessionGroup, type GroupSpec } from './classification';

export const M13_GROUPS: GroupSpec = [
  ['P1', 1, 1],
  ['P2_3', 2, 3],
  ['P4_10', 4, 10],
  ['P11_PLUS', 11, Number.POSITIVE_INFINITY],
];

export const resolveM13: Resolver = (ctx) => resolveSessionGroup(ctx, M13_GROUPS);
