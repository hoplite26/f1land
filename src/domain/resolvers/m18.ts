/**
 * F1-M18 — final group of A in the Sprint: P1, P2_3, P4_8, P9_PLUS,
 * NOT_CLASSIFIED, DNS, DSQ. Only SESSION_FINAL of this Sprint session.
 */
import type { Resolver } from '../types';
import { resolveSessionGroup, type GroupSpec } from './classification';

export const M18_GROUPS: GroupSpec = [
  ['P1', 1, 1],
  ['P2_3', 2, 3],
  ['P4_8', 4, 8],
  ['P9_PLUS', 9, Number.POSITIVE_INFINITY],
];

export const resolveM18: Resolver = (ctx) => resolveSessionGroup(ctx, M18_GROUPS);
