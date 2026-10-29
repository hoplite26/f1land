/**
 * 2026 Formula 1 season calendar (DEMO contour). Session times are local wall
 * times converted to UTC with a fixed per-meeting offset (no DST change falls
 * inside any of these weekends); calendar.test.ts re-checks every session
 * against the circuit's IANA timezone with Intl.
 */
import type { SessionType } from '@/domain/types';

export type CalendarSessionKind = 'FP1' | 'FP2' | 'FP3' | 'SPRINT_QUALIFYING' | 'SPRINT' | 'QUALIFYING' | 'GRAND_PRIX';

export interface CalendarSession {
  /** e.g. '2026-20-gp' */
  id: string;
  kind: CalendarSessionKind;
  sessionType: SessionType;
  /** ISO 8601 UTC */
  startsAt: string;
  endsAt: string;
}

export interface Meeting {
  /** e.g. '2026-20' (round zero-padded to two digits) */
  id: string;
  round: number;
  season: 2026;
  circuitId: string;
  name: { en: string; ru: string };
  officialName?: string;
  countryCode: string;
  /** IANA timezone of the circuit (for local-time display). */
  timezone: string;
  /** Local dates 'YYYY-MM-DD' of the first and last on-track day. */
  startDate: string;
  endDate: string;
  sprint: boolean;
  sessions: CalendarSession[];
}

export type MeetingStatus = 'COMPLETED' | 'LIVE' | 'NEXT' | 'UPCOMING';

const KIND: Record<CalendarSessionKind, { suffix: string; type: SessionType; minutes: number }> = {
  FP1: { suffix: 'fp1', type: 'PRACTICE', minutes: 60 },
  FP2: { suffix: 'fp2', type: 'PRACTICE', minutes: 60 },
  FP3: { suffix: 'fp3', type: 'PRACTICE', minutes: 60 },
  SPRINT_QUALIFYING: { suffix: 'sq', type: 'SPRINT_QUALIFYING', minutes: 44 },
  SPRINT: { suffix: 'sprint', type: 'SPRINT', minutes: 60 },
  QUALIFYING: { suffix: 'q', type: 'QUALIFYING', minutes: 60 },
  GRAND_PRIX: { suffix: 'gp', type: 'GRAND_PRIX', minutes: 120 },
};

/** [kind, day index from startDate, local 'HH:MM'] */
type Slot = readonly [CalendarSessionKind, number, string];

const STANDARD: readonly Slot[] = [
  ['FP1', 0, '13:30'],
  ['FP2', 0, '17:00'],
  ['FP3', 1, '12:30'],
  ['QUALIFYING', 1, '16:00'],
  ['GRAND_PRIX', 2, '15:00'],
];
const SPRINT_WEEKEND: readonly Slot[] = [
  ['FP1', 0, '12:30'],
  ['SPRINT_QUALIFYING', 0, '16:30'],
  ['SPRINT', 1, '12:00'],
  ['QUALIFYING', 1, '16:00'],
  ['GRAND_PRIX', 2, '15:00'],
];
const BAHRAIN: readonly Slot[] = [
  ['FP1', 0, '14:30'],
  ['FP2', 0, '18:00'],
  ['FP3', 1, '15:30'],
  ['QUALIFYING', 1, '19:00'],
  ['GRAND_PRIX', 2, '18:00'],
];
const JEDDAH: readonly Slot[] = [
  ['FP1', 0, '16:30'],
  ['FP2', 0, '20:00'],
  ['FP3', 1, '16:30'],
  ['QUALIFYING', 1, '20:00'],
  ['GRAND_PRIX', 2, '20:00'],
];
const QATAR: readonly Slot[] = [
  ['FP1', 0, '16:30'],
  ['FP2', 0, '20:00'],
  ['FP3', 1, '16:30'],
  ['QUALIFYING', 1, '20:00'],
  ['GRAND_PRIX', 2, '19:00'],
];
const SINGAPORE_SPRINT: readonly Slot[] = [
  ['FP1', 0, '17:30'],
  ['SPRINT_QUALIFYING', 0, '21:30'],
  ['SPRINT', 1, '17:00'],
  ['QUALIFYING', 1, '21:00'],
  ['GRAND_PRIX', 2, '20:00'],
];
const ABU_DHABI: readonly Slot[] = [
  ['FP1', 0, '13:30'],
  ['FP2', 0, '17:00'],
  ['FP3', 1, '14:30'],
  ['QUALIFYING', 1, '18:00'],
  ['GRAND_PRIX', 2, '17:00'],
];
/** Thursday–Saturday weekend, race on Saturday afternoon. */
const BAKU: readonly Slot[] = [
  ['FP1', 0, '13:30'],
  ['FP2', 0, '17:00'],
  ['FP3', 1, '12:30'],
  ['QUALIFYING', 1, '16:00'],
  ['GRAND_PRIX', 2, '15:00'],
];
/** Thursday–Saturday weekend, race on Saturday night local time. */
const LAS_VEGAS: readonly Slot[] = [
  ['FP1', 0, '18:30'],
  ['FP2', 0, '22:00'],
  ['FP3', 1, '18:30'],
  ['QUALIFYING', 1, '22:00'],
  ['GRAND_PRIX', 2, '22:00'],
];

interface RoundDef {
  circuitId: string;
  en: string;
  ru: string;
  countryCode: string;
  timezone: string;
  start: string;
  end: string;
  /** Local time = UTC + utcOffsetH during this weekend (DST resolved). */
  utcOffsetH: number;
  sprint?: boolean;
  slots?: readonly Slot[];
}

const ROUNDS: RoundDef[] = [
  { circuitId: 'au-1953', en: 'Australian Grand Prix', ru: 'Гран-при Австралии', countryCode: 'AU', timezone: 'Australia/Melbourne', start: '2026-03-06', end: '2026-03-08', utcOffsetH: 11 },
  { circuitId: 'cn-2004', en: 'Chinese Grand Prix', ru: 'Гран-при Китая', countryCode: 'CN', timezone: 'Asia/Shanghai', start: '2026-03-13', end: '2026-03-15', utcOffsetH: 8, sprint: true },
  { circuitId: 'jp-1962', en: 'Japanese Grand Prix', ru: 'Гран-при Японии', countryCode: 'JP', timezone: 'Asia/Tokyo', start: '2026-03-27', end: '2026-03-29', utcOffsetH: 9 },
  { circuitId: 'bh-2002', en: 'Bahrain Grand Prix', ru: 'Гран-при Бахрейна', countryCode: 'BH', timezone: 'Asia/Bahrain', start: '2026-04-10', end: '2026-04-12', utcOffsetH: 3, slots: BAHRAIN },
  { circuitId: 'sa-2021', en: 'Saudi Arabian Grand Prix', ru: 'Гран-при Саудовской Аравии', countryCode: 'SA', timezone: 'Asia/Riyadh', start: '2026-04-17', end: '2026-04-19', utcOffsetH: 3, slots: JEDDAH },
  { circuitId: 'us-2022', en: 'Miami Grand Prix', ru: 'Гран-при Майами', countryCode: 'US', timezone: 'America/New_York', start: '2026-05-01', end: '2026-05-03', utcOffsetH: -4, sprint: true },
  { circuitId: 'ca-1978', en: 'Canadian Grand Prix', ru: 'Гран-при Канады', countryCode: 'CA', timezone: 'America/Toronto', start: '2026-05-22', end: '2026-05-24', utcOffsetH: -4, sprint: true },
  { circuitId: 'mc-1929', en: 'Monaco Grand Prix', ru: 'Гран-при Монако', countryCode: 'MC', timezone: 'Europe/Monaco', start: '2026-06-05', end: '2026-06-07', utcOffsetH: 2 },
  { circuitId: 'es-1991', en: 'Barcelona-Catalunya Grand Prix', ru: 'Гран-при Барселоны-Каталонии', countryCode: 'ES', timezone: 'Europe/Madrid', start: '2026-06-12', end: '2026-06-14', utcOffsetH: 2 },
  { circuitId: 'at-1969', en: 'Austrian Grand Prix', ru: 'Гран-при Австрии', countryCode: 'AT', timezone: 'Europe/Vienna', start: '2026-06-26', end: '2026-06-28', utcOffsetH: 2 },
  { circuitId: 'gb-1948', en: 'British Grand Prix', ru: 'Гран-при Великобритании', countryCode: 'GB', timezone: 'Europe/London', start: '2026-07-03', end: '2026-07-05', utcOffsetH: 1, sprint: true },
  { circuitId: 'be-1925', en: 'Belgian Grand Prix', ru: 'Гран-при Бельгии', countryCode: 'BE', timezone: 'Europe/Brussels', start: '2026-07-17', end: '2026-07-19', utcOffsetH: 2 },
  { circuitId: 'hu-1986', en: 'Hungarian Grand Prix', ru: 'Гран-при Венгрии', countryCode: 'HU', timezone: 'Europe/Budapest', start: '2026-07-24', end: '2026-07-26', utcOffsetH: 2 },
  { circuitId: 'nl-1948', en: 'Dutch Grand Prix', ru: 'Гран-при Нидерландов', countryCode: 'NL', timezone: 'Europe/Amsterdam', start: '2026-08-21', end: '2026-08-23', utcOffsetH: 2, sprint: true },
  { circuitId: 'it-1922', en: 'Italian Grand Prix', ru: 'Гран-при Италии', countryCode: 'IT', timezone: 'Europe/Rome', start: '2026-09-04', end: '2026-09-06', utcOffsetH: 2 },
  { circuitId: 'es-2026', en: 'Spanish Grand Prix', ru: 'Гран-при Испании', countryCode: 'ES', timezone: 'Europe/Madrid', start: '2026-09-11', end: '2026-09-13', utcOffsetH: 2 },
  { circuitId: 'az-2016', en: 'Azerbaijan Grand Prix', ru: 'Гран-при Азербайджана', countryCode: 'AZ', timezone: 'Asia/Baku', start: '2026-09-24', end: '2026-09-26', utcOffsetH: 4, slots: BAKU },
  { circuitId: 'sg-2008', en: 'Singapore Grand Prix', ru: 'Гран-при Сингапура', countryCode: 'SG', timezone: 'Asia/Singapore', start: '2026-10-09', end: '2026-10-11', utcOffsetH: 8, sprint: true, slots: SINGAPORE_SPRINT },
  { circuitId: 'us-2012', en: 'United States Grand Prix', ru: 'Гран-при США', countryCode: 'US', timezone: 'America/Chicago', start: '2026-10-23', end: '2026-10-25', utcOffsetH: -5 },
  { circuitId: 'mx-1962', en: 'Mexico City Grand Prix', ru: 'Гран-при Мехико', countryCode: 'MX', timezone: 'America/Mexico_City', start: '2026-10-30', end: '2026-11-01', utcOffsetH: -6 },
  { circuitId: 'br-1940', en: 'São Paulo Grand Prix', ru: 'Гран-при Сан-Паулу', countryCode: 'BR', timezone: 'America/Sao_Paulo', start: '2026-11-06', end: '2026-11-08', utcOffsetH: -3 },
  { circuitId: 'us-2023', en: 'Las Vegas Grand Prix', ru: 'Гран-при Лас-Вегаса', countryCode: 'US', timezone: 'America/Los_Angeles', start: '2026-11-19', end: '2026-11-21', utcOffsetH: -8, slots: LAS_VEGAS },
  { circuitId: 'qa-2004', en: 'Qatar Grand Prix', ru: 'Гран-при Катара', countryCode: 'QA', timezone: 'Asia/Qatar', start: '2026-11-27', end: '2026-11-29', utcOffsetH: 3, slots: QATAR },
  { circuitId: 'ae-2009', en: 'Abu Dhabi Grand Prix', ru: 'Гран-при Абу-Даби', countryCode: 'AE', timezone: 'Asia/Dubai', start: '2026-12-04', end: '2026-12-06', utcOffsetH: 4, slots: ABU_DHABI },
];

function buildMeeting(def: RoundDef, index: number): Meeting {
  const round = index + 1;
  const id = `2026-${String(round).padStart(2, '0')}`;
  const [y, m, d] = def.start.split('-').map(Number) as [number, number, number];
  const slots = def.slots ?? (def.sprint ? SPRINT_WEEKEND : STANDARD);
  const sessions = slots.map(([kind, day, hhmm]): CalendarSession => {
    const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
    const start = Date.UTC(y, m - 1, d + day, hh, mm) - def.utcOffsetH * 3_600_000;
    const meta = KIND[kind];
    return {
      id: `${id}-${meta.suffix}`,
      kind,
      sessionType: meta.type,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + meta.minutes * 60_000).toISOString(),
    };
  });
  return {
    id,
    round,
    season: 2026,
    circuitId: def.circuitId,
    name: { en: def.en, ru: def.ru },
    countryCode: def.countryCode,
    timezone: def.timezone,
    startDate: def.start,
    endDate: def.end,
    sprint: !!def.sprint,
    sessions,
  };
}

export const SEASON_2026: Meeting[] = ROUNDS.map(buildMeeting);

const MEETING_BY_ID = new Map(SEASON_2026.map((m) => [m.id, m]));
const SESSION_BY_ID = new Map<string, { meeting: Meeting; session: CalendarSession }>();
for (const meeting of SEASON_2026) for (const session of meeting.sessions) SESSION_BY_ID.set(session.id, { meeting, session });

export function getMeeting(id: string): Meeting {
  const meeting = MEETING_BY_ID.get(id);
  if (!meeting) throw new Error(`Unknown meeting id: ${id}`);
  return meeting;
}

export function meetingForCircuit(circuitId: string): Meeting | undefined {
  return SEASON_2026.find((m) => m.circuitId === circuitId);
}

export function sessionById(id: string): { meeting: Meeting; session: CalendarSession } | undefined {
  return SESSION_BY_ID.get(id);
}

const startMs = (m: Meeting) => Date.parse(m.sessions[0]!.startsAt);
const endMs = (m: Meeting) => Date.parse(m.sessions[m.sessions.length - 1]!.endsAt);

/**
 * LIVE from the start of FP1 to the end of the Grand Prix; NEXT is the first
 * meeting that has not started yet (it can coexist with a LIVE one).
 */
export function meetingStatus(m: Meeting, nowMs: number): MeetingStatus {
  if (nowMs >= endMs(m)) return 'COMPLETED';
  if (nowMs >= startMs(m)) return 'LIVE';
  const next = SEASON_2026.find((x) => startMs(x) > nowMs);
  return next?.id === m.id ? 'NEXT' : 'UPCOMING';
}

/** The live meeting, else the next one; after the finale, the last meeting. */
export function currentOrNextMeeting(nowMs: number): Meeting {
  const live = SEASON_2026.find((m) => nowMs >= startMs(m) && nowMs < endMs(m));
  if (live) return live;
  return SEASON_2026.find((m) => startMs(m) > nowMs) ?? SEASON_2026[SEASON_2026.length - 1]!;
}
