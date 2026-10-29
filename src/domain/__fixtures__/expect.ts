import type { ResolverOutput } from '../types';

/** Compact label of a resolver output: outcome id, `VOID:<reason>` or `PENDING`. */
export function R(out: ResolverOutput): string {
  if (out.state === 'RESOLVED') return out.winner_outcome_id;
  if (out.state === 'VOID') return `VOID:${out.reason}`;
  return 'PENDING';
}

export function valuesOf(out: ResolverOutput): Record<string, string | number | boolean | null> {
  return out.values ?? {};
}
