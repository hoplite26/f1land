import { describe, expect, it } from 'vitest';
import { SEASON_2026, currentOrNextMeeting, getMeeting, meetingForCircuit, meetingStatus, sessionById } from './calendar';
import { CIRCUIT_META } from './circuits';

const SPRINT_CIRCUITS = ['cn-2004', 'us-2022', 'ca-1978', 'gb-1948', 'nl-1948', 'sg-2008'];

/** Local wall time of an ISO instant in a timezone, as 'YYYY-MM-DD HH:MM' + weekday. */
function local(iso: string, timeZone: string): { stamp: string; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { stamp: `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`, weekday: get('weekday') };
}

describe('2026 calendar', () => {
  it('has 24 rounds in order on the 24 circuits', () => {
    expect(SEASON_2026).toHaveLength(24);
    SEASON_2026.forEach((m, i) => {
      expect(m.round).toBe(i + 1);
      expect(m.id).toBe(`2026-${String(i + 1).padStart(2, '0')}`);
      expect(m.season).toBe(2026);
    });
    expect(SEASON_2026.map((m) => m.circuitId)).toEqual(CIRCUIT_META.map((c) => c.id));
    for (const m of SEASON_2026) {
      const circuit = CIRCUIT_META.find((c) => c.id === m.circuitId)!;
      expect(m.countryCode).toBe(circuit.countryCode);
      expect(m.name.en).toMatch(/Grand Prix$/);
      expect(m.name.ru).toMatch(/^Гран-при /);
    }
  });

  it('flags exactly the six sprint weekends', () => {
    expect(SEASON_2026.filter((m) => m.sprint).map((m) => m.circuitId)).toEqual(SPRINT_CIRCUITS);
    for (const m of SEASON_2026) {
      const kinds = m.sessions.map((s) => s.kind);
      if (m.sprint) expect(kinds).toEqual(['FP1', 'SPRINT_QUALIFYING', 'SPRINT', 'QUALIFYING', 'GRAND_PRIX']);
      else expect(kinds).toEqual(['FP1', 'FP2', 'FP3', 'QUALIFYING', 'GRAND_PRIX']);
    }
  });

  it('orders sessions without overlaps and with the right durations and types', () => {
    const minutes = { FP1: 60, FP2: 60, FP3: 60, SPRINT_QUALIFYING: 44, SPRINT: 60, QUALIFYING: 60, GRAND_PRIX: 120 };
    const types = { FP1: 'PRACTICE', FP2: 'PRACTICE', FP3: 'PRACTICE', SPRINT_QUALIFYING: 'SPRINT_QUALIFYING', SPRINT: 'SPRINT', QUALIFYING: 'QUALIFYING', GRAND_PRIX: 'GRAND_PRIX' };
    let prevEnd = 0;
    for (const m of SEASON_2026) {
      for (const s of m.sessions) {
        const a = Date.parse(s.startsAt);
        const b = Date.parse(s.endsAt);
        expect(s.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
        expect(a).toBeGreaterThanOrEqual(prevEnd);
        expect((b - a) / 60_000).toBe(minutes[s.kind]);
        expect(s.sessionType).toBe(types[s.kind]);
        prevEnd = b;
      }
    }
  });

  it('uses unique session ids (Sprint ≠ Grand Prix)', () => {
    const ids = SEASON_2026.flatMap((m) => m.sessions.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    const china = getMeeting('2026-02');
    const sprint = china.sessions.find((s) => s.kind === 'SPRINT')!;
    const gp = china.sessions.find((s) => s.kind === 'GRAND_PRIX')!;
    expect(sprint.id).toBe('2026-02-sprint');
    expect(gp.id).toBe('2026-02-gp');
    expect(sprint.id).not.toBe(gp.id);
  });

  it('keeps every session inside the local weekend dates', () => {
    for (const m of SEASON_2026) {
      for (const s of m.sessions) {
        const day = local(s.startsAt, m.timezone).stamp.slice(0, 10);
        expect(day >= m.startDate && day <= m.endDate).toBe(true);
      }
      expect(local(m.sessions[m.sessions.length - 1]!.startsAt, m.timezone).stamp.slice(0, 10)).toBe(m.endDate);
    }
  });

  it('converts local wall times to UTC with the circuit timezone (incl. DST)', () => {
    const gp = (round: number) => getMeeting(`2026-${String(round).padStart(2, '0')}`).sessions.find((s) => s.kind === 'GRAND_PRIX')!;
    expect(gp(24).startsAt).toBe('2026-12-06T13:00:00.000Z'); // Abu Dhabi 17:00 GST
    expect(gp(20).startsAt).toBe('2026-11-01T21:00:00.000Z'); // Mexico City 15:00 CST, no DST since 2022
    expect(gp(1).startsAt).toBe('2026-03-08T04:00:00.000Z'); // Melbourne 15:00 AEDT
    expect(gp(19).startsAt).toBe('2026-10-25T20:00:00.000Z'); // Austin 15:00 CDT
    expect(gp(11).startsAt).toBe('2026-07-05T14:00:00.000Z'); // Silverstone 15:00 BST
    expect(gp(22).startsAt).toBe('2026-11-22T06:00:00.000Z'); // Las Vegas Saturday 22:00 PST
    expect(gp(17).startsAt).toBe('2026-09-26T11:00:00.000Z'); // Baku Saturday 15:00
    expect(gp(18).startsAt).toBe('2026-10-11T12:00:00.000Z'); // Singapore 20:00
    expect(gp(4).startsAt).toBe('2026-04-12T15:00:00.000Z'); // Bahrain 18:00
    expect(local(gp(22).startsAt, 'America/Los_Angeles')).toEqual({ stamp: '2026-11-21 22:00', weekday: 'Sat' });
    expect(local(gp(17).startsAt, 'Asia/Baku').weekday).toBe('Sat');
    // Every Sunday race is on a Sunday locally.
    for (const m of SEASON_2026) {
      const wd = local(gp(m.round).startsAt, m.timezone).weekday;
      expect(wd).toBe(m.circuitId === 'az-2016' || m.circuitId === 'us-2023' ? 'Sat' : 'Sun');
    }
  });

  it('shows the expected local Qualifying / Grand Prix times at every venue', () => {
    const night: Record<string, [string, string]> = {
      'bh-2002': ['19:00', '18:00'],
      'sa-2021': ['20:00', '20:00'],
      'sg-2008': ['21:00', '20:00'],
      'qa-2004': ['20:00', '19:00'],
      'ae-2009': ['18:00', '17:00'],
      'us-2023': ['22:00', '22:00'],
    };
    for (const m of SEASON_2026) {
      const [q, gp] = night[m.circuitId] ?? ['16:00', '15:00'];
      const at = (kind: string) => local(m.sessions.find((s) => s.kind === kind)!.startsAt, m.timezone).stamp.slice(11);
      expect(`${m.circuitId} Q ${at('QUALIFYING')}`).toBe(`${m.circuitId} Q ${q}`);
      expect(`${m.circuitId} GP ${at('GRAND_PRIX')}`).toBe(`${m.circuitId} GP ${gp}`);
      for (const s of m.sessions) expect(['00', '30']).toContain(local(s.startsAt, m.timezone).stamp.slice(14));
    }
  });

  it('looks up meetings and sessions', () => {
    expect(getMeeting('2026-20').circuitId).toBe('mx-1962');
    expect(getMeeting('2026-20').name).toEqual({ en: 'Mexico City Grand Prix', ru: 'Гран-при Мехико' });
    expect(getMeeting('2026-08').name.ru).toBe('Гран-при Монако');
    expect(getMeeting('2026-21').name.ru).toBe('Гран-при Сан-Паулу');
    expect(() => getMeeting('2026-99')).toThrow(/Unknown meeting/);
    expect(sessionById('2026-20-gp')?.meeting.round).toBe(20);
    expect(sessionById('2026-20-gp')?.session.kind).toBe('GRAND_PRIX');
    expect(sessionById('2026-20-sprint')).toBeUndefined();
    expect(meetingForCircuit('ae-2009')?.round).toBe(24);
  });

  it('derives meeting status and the current/next meeting', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(meetingStatus(getMeeting('2026-19'), now)).toBe('COMPLETED');
    expect(meetingStatus(getMeeting('2026-20'), now)).toBe('NEXT');
    expect(meetingStatus(getMeeting('2026-21'), now)).toBe('UPCOMING');
    expect(currentOrNextMeeting(now).id).toBe('2026-20');

    const duringMexico = Date.parse('2026-10-31T20:00:00Z');
    expect(meetingStatus(getMeeting('2026-20'), duringMexico)).toBe('LIVE');
    expect(meetingStatus(getMeeting('2026-21'), duringMexico)).toBe('NEXT');
    expect(currentOrNextMeeting(duringMexico).id).toBe('2026-20');

    const gpEnd = Date.parse(getMeeting('2026-20').sessions.at(-1)!.endsAt);
    expect(meetingStatus(getMeeting('2026-20'), gpEnd)).toBe('COMPLETED');
    expect(currentOrNextMeeting(Date.parse('2026-01-01T00:00:00Z')).id).toBe('2026-01');
    expect(currentOrNextMeeting(Date.parse('2027-01-01T00:00:00Z')).id).toBe('2026-24');
  });
});
