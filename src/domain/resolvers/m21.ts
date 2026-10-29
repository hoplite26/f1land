/**
 * F1-M21 — two conditions of one snapshot: BOTH_TRUE, NOT_BOTH.
 * Only the explicit F1-036 pairs with one shared anchor (instant T). Any
 * unknown required part → VOID / UNKNOWN_REQUIRED_PART (never inferred).
 * Both parts inherit the snapshot family: RED before T → VOID.
 */
import type { AnyEvent, ComboPart, Resolver, ResolverContext } from '../types';
import { toMs } from '../windows';
import {
  atLeast,
  compoundAt,
  firstRedOnset,
  inactiveOf,
  latestStatus,
  locationAt,
  observed,
  pending,
  resolved,
  snapshotAt,
  stintEffectiveMs,
  tOf,
  voided,
  waitOrVoid,
  win,
} from './common';

const GROUP_RANGES: Record<string, [number, number]> = {
  P1: [1, 1],
  P1_3: [1, 3],
  P2_3: [2, 3],
  P4_10: [4, 10],
  P1_10: [1, 10],
  P11_PLUS: [11, Number.POSITIVE_INFINITY],
};

interface PartResult {
  known: boolean;
  value: boolean;
  evidence: AnyEvent[];
  detail: string | number | boolean | null;
}

const unknown = (evidence: AnyEvent[] = []): PartResult => ({ known: false, value: false, evidence, detail: null });

function snapshotPart(ctx: ResolverContext, T: number) {
  const snap = snapshotAt(ctx.events, T);
  if (!snap || !observed(ctx, tOf(snap as AnyEvent), T + 1)) return null;
  return snap;
}

export function evaluatePart(ctx: ResolverContext, part: ComboPart, T: number): PartResult {
  const d = part.driver_id;
  switch (part.kind) {
    case 'POSITION_GROUP': {
      const snap = snapshotPart(ctx, T);
      if (!snap) return unknown();
      const entry = snap.payload.order.find((o) => o.driver_id === d);
      const st = latestStatus(ctx.events, d, T);
      const ev = [snap as AnyEvent, ...(st ? [st as AnyEvent] : [])];
      const inactive = inactiveOf(st?.payload.status, entry?.activity);
      if (inactive) return { known: true, value: false, evidence: ev, detail: inactive };
      if (!entry) return unknown(ev);
      const [lo, hi] = GROUP_RANGES[part.value] ?? [0, -1];
      return { known: true, value: entry.position >= lo && entry.position <= hi, evidence: ev, detail: entry.position };
    }
    case 'AHEAD_OF': {
      const snap = snapshotPart(ctx, T);
      if (!snap) return unknown();
      const other = part.value;
      const ea = snap.payload.order.find((o) => o.driver_id === d);
      const eb = snap.payload.order.find((o) => o.driver_id === other);
      const sa = latestStatus(ctx.events, d, T);
      const sb = latestStatus(ctx.events, other, T);
      const ev = [snap as AnyEvent, sa as AnyEvent | null, sb as AnyEvent | null].filter((x): x is AnyEvent => x !== null);
      const ia = inactiveOf(sa?.payload.status, ea?.activity);
      const ib = inactiveOf(sb?.payload.status, eb?.activity);
      if (ia) return { known: true, value: false, evidence: ev, detail: ia };
      if (!ea) return unknown(ev);
      if (ib) return { known: true, value: true, evidence: ev, detail: ib };
      if (!eb || ea.position === eb.position) return unknown(ev);
      return { known: true, value: ea.position < eb.position, evidence: ev, detail: `${ea.position}<${eb.position}` };
    }
    case 'TYRE_COMPOUND': {
      const c = compoundAt(ctx.events, d, T);
      if (!c || !observed(ctx, stintEffectiveMs(ctx.events, c.stint), T + 1)) return unknown();
      return { known: true, value: c.compound === part.value, evidence: [c.stint as AnyEvent], detail: c.compound };
    }
    case 'ON_TRACK':
    case 'SECTOR': {
      const loc = locationAt(ctx, d, T);
      if (loc.kind !== 'KNOWN') return unknown(loc.evidence);
      const value = part.kind === 'ON_TRACK' ? loc.location.startsWith('S') : loc.location === `S${part.value}`;
      return { known: true, value, evidence: loc.evidence, detail: loc.location };
    }
  }
}

export const resolveM21: Resolver = (ctx) => {
  const p = ctx.pool.target.parameters;
  const combo = p.combo!;
  const atIso = p.at_instant ?? ctx.pool.target.window_end;
  const T = toMs(atIso);
  const w = win(ctx);
  const base = { at_instant: atIso, part_1: combo[0].kind, part_2: combo[1].kind };
  if (ctx.now_ms < T) return pending(base);
  const red = firstRedOnset(ctx.events, w.start, T + 1);
  if (red) return voided(ctx, 'INTERRUPTED', [red], { ...base, red_flag_at: red.occurred_at });
  const [r1, r2] = [evaluatePart(ctx, combo[0], T), evaluatePart(ctx, combo[1], T)];
  const values = {
    ...base,
    part_1_known: r1.known,
    part_2_known: r2.known,
    part_1_value: r1.known ? r1.value : null,
    part_2_value: r2.known ? r2.value : null,
    part_1_detail: r1.detail,
    part_2_detail: r2.detail,
  };
  const evidence = [...r1.evidence, ...r2.evidence];
  if (!r1.known || !r2.known) return waitOrVoid(ctx, 'UNKNOWN_REQUIRED_PART', evidence, values);
  return resolved(ctx, r1.value && r2.value ? 'BOTH_TRUE' : 'NOT_BOTH', evidence, values, atLeast(atIso, evidence));
};
