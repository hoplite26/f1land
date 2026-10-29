/**
 * DEMO schedule changes (F1-037: a rescheduled session is marked as updated and
 * the previous time no longer counts down). Maps session id → previous start
 * (ISO UTC). A real adapter would feed this from the provider's revisions.
 */
import { sessionById } from '@/data/calendar';

const PREVIOUS_START: Record<string, string> = {};

// One illustrative change per DEMO season: FP1 of the Las Vegas weekend moved 30 minutes later.
const LV_FP1 = sessionById('2026-22-fp1');
if (LV_FP1) PREVIOUS_START[LV_FP1.session.id] = new Date(Date.parse(LV_FP1.session.startsAt) - 30 * 60_000).toISOString();

export function previousStart(sessionId: string): string | null {
  return PREVIOUS_START[sessionId] ?? null;
}
