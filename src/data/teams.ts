/**
 * 2026 grid (DEMO contour). Livery colours are stylised approximations used
 * for the procedural 3D cars and UI accents.
 */

export interface TeamLivery {
  /** Main body colour. */
  primary: string;
  /** Secondary body colour (sidepods, engine cover stripes). */
  secondary: string;
  /** Accent colour (wing endplates, number, halo stripe). */
  accent: string;
  /** Wing/floor base: carbon or painted. */
  wing: string;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  /** UI accent colour (timing tower stripe, labels). */
  color: string;
  livery: TeamLivery;
  engine: string;
  /** Relative car performance for the DEMO simulator, 0..1. */
  carPace: number;
  /** Pit crew mean stationary time, ms. */
  pitCrewMs: number;
}

export interface Driver {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  number: number;
  teamId: string;
  countryCode: string;
  /** DEMO simulator traits, 0..1 */
  pace: number;
  racecraft: number;
  consistency: number;
}

export const TEAMS: Team[] = [
  {
    id: 'mclaren', name: 'McLaren Formula 1 Team', shortName: 'McLaren', color: '#FF8000', engine: 'Mercedes',
    livery: { primary: '#FF8000', secondary: '#1B1B1F', accent: '#47C7FC', wing: '#1B1B1F' }, carPace: 0.97, pitCrewMs: 2250,
  },
  {
    id: 'ferrari', name: 'Scuderia Ferrari HP', shortName: 'Ferrari', color: '#E8002D', engine: 'Ferrari',
    livery: { primary: '#D40019', secondary: '#FFFFFF', accent: '#FFD100', wing: '#1A1A1A' }, carPace: 0.95, pitCrewMs: 2300,
  },
  {
    id: 'redbull', name: 'Oracle Red Bull Racing', shortName: 'Red Bull', color: '#3671C6', engine: 'Red Bull Ford',
    livery: { primary: '#1A2B5C', secondary: '#E10600', accent: '#FFC906', wing: '#141A33' }, carPace: 0.94, pitCrewMs: 2150,
  },
  {
    id: 'mercedes', name: 'Mercedes-AMG PETRONAS F1 Team', shortName: 'Mercedes', color: '#27F4D2', engine: 'Mercedes',
    livery: { primary: '#C8CCCE', secondary: '#0B0B0D', accent: '#00D2BE', wing: '#0B0B0D' }, carPace: 0.96, pitCrewMs: 2350,
  },
  {
    id: 'astonmartin', name: 'Aston Martin Aramco F1 Team', shortName: 'Aston Martin', color: '#229971', engine: 'Honda',
    livery: { primary: '#00594F', secondary: '#0E2A26', accent: '#CEDC00', wing: '#0E1F1C' }, carPace: 0.9, pitCrewMs: 2450,
  },
  {
    id: 'alpine', name: 'BWT Alpine F1 Team', shortName: 'Alpine', color: '#0093CC', engine: 'Mercedes',
    livery: { primary: '#0A62C9', secondary: '#FF87BC', accent: '#FFFFFF', wing: '#0B1B3A' }, carPace: 0.86, pitCrewMs: 2550,
  },
  {
    id: 'williams', name: 'Atlassian Williams Racing', shortName: 'Williams', color: '#64C4FF', engine: 'Mercedes',
    livery: { primary: '#0B2B66', secondary: '#1868DB', accent: '#64C4FF', wing: '#081A3F' }, carPace: 0.89, pitCrewMs: 2500,
  },
  {
    id: 'racingbulls', name: 'Visa Cash App Racing Bulls', shortName: 'Racing Bulls', color: '#6692FF', engine: 'Red Bull Ford',
    livery: { primary: '#F2F4F8', secondary: '#1634CC', accent: '#E8112D', wing: '#1A1F33' }, carPace: 0.88, pitCrewMs: 2400,
  },
  {
    id: 'haas', name: 'TGR Haas F1 Team', shortName: 'Haas', color: '#B6BABD', engine: 'Ferrari',
    livery: { primary: '#F4F4F4', secondary: '#1A1A1A', accent: '#E10600', wing: '#1A1A1A' }, carPace: 0.87, pitCrewMs: 2600,
  },
  {
    id: 'audi', name: 'Audi Revolut F1 Team', shortName: 'Audi', color: '#BB0A30', engine: 'Audi',
    livery: { primary: '#8E9196', secondary: '#151515', accent: '#F50537', wing: '#151515' }, carPace: 0.85, pitCrewMs: 2650,
  },
  {
    id: 'cadillac', name: 'Cadillac Formula 1 Team', shortName: 'Cadillac', color: '#C9A227', engine: 'Ferrari',
    livery: { primary: '#0D0D0F', secondary: '#F2F2F2', accent: '#C9A227', wing: '#0D0D0F' }, carPace: 0.83, pitCrewMs: 2700,
  },
];

export const DRIVERS: Driver[] = [
  { id: 'nor', code: 'NOR', firstName: 'Lando', lastName: 'Norris', number: 4, teamId: 'mclaren', countryCode: 'GB', pace: 0.97, racecraft: 0.9, consistency: 0.9 },
  { id: 'pia', code: 'PIA', firstName: 'Oscar', lastName: 'Piastri', number: 81, teamId: 'mclaren', countryCode: 'AU', pace: 0.95, racecraft: 0.89, consistency: 0.93 },
  { id: 'lec', code: 'LEC', firstName: 'Charles', lastName: 'Leclerc', number: 16, teamId: 'ferrari', countryCode: 'MC', pace: 0.97, racecraft: 0.9, consistency: 0.87 },
  { id: 'ham', code: 'HAM', firstName: 'Lewis', lastName: 'Hamilton', number: 44, teamId: 'ferrari', countryCode: 'GB', pace: 0.93, racecraft: 0.96, consistency: 0.9 },
  { id: 'ver', code: 'VER', firstName: 'Max', lastName: 'Verstappen', number: 3, teamId: 'redbull', countryCode: 'NL', pace: 0.99, racecraft: 0.98, consistency: 0.95 },
  { id: 'had', code: 'HAD', firstName: 'Isack', lastName: 'Hadjar', number: 6, teamId: 'redbull', countryCode: 'FR', pace: 0.9, racecraft: 0.85, consistency: 0.84 },
  { id: 'rus', code: 'RUS', firstName: 'George', lastName: 'Russell', number: 63, teamId: 'mercedes', countryCode: 'GB', pace: 0.95, racecraft: 0.9, consistency: 0.92 },
  { id: 'ant', code: 'ANT', firstName: 'Andrea Kimi', lastName: 'Antonelli', number: 12, teamId: 'mercedes', countryCode: 'IT', pace: 0.92, racecraft: 0.84, consistency: 0.82 },
  { id: 'alo', code: 'ALO', firstName: 'Fernando', lastName: 'Alonso', number: 14, teamId: 'astonmartin', countryCode: 'ES', pace: 0.93, racecraft: 0.97, consistency: 0.92 },
  { id: 'str', code: 'STR', firstName: 'Lance', lastName: 'Stroll', number: 18, teamId: 'astonmartin', countryCode: 'CA', pace: 0.85, racecraft: 0.82, consistency: 0.8 },
  { id: 'gas', code: 'GAS', firstName: 'Pierre', lastName: 'Gasly', number: 10, teamId: 'alpine', countryCode: 'FR', pace: 0.9, racecraft: 0.88, consistency: 0.87 },
  { id: 'col', code: 'COL', firstName: 'Franco', lastName: 'Colapinto', number: 43, teamId: 'alpine', countryCode: 'AR', pace: 0.85, racecraft: 0.83, consistency: 0.78 },
  { id: 'alb', code: 'ALB', firstName: 'Alexander', lastName: 'Albon', number: 23, teamId: 'williams', countryCode: 'TH', pace: 0.91, racecraft: 0.88, consistency: 0.9 },
  { id: 'sai', code: 'SAI', firstName: 'Carlos', lastName: 'Sainz', number: 55, teamId: 'williams', countryCode: 'ES', pace: 0.92, racecraft: 0.9, consistency: 0.91 },
  { id: 'law', code: 'LAW', firstName: 'Liam', lastName: 'Lawson', number: 30, teamId: 'racingbulls', countryCode: 'NZ', pace: 0.87, racecraft: 0.86, consistency: 0.82 },
  { id: 'lin', code: 'LIN', firstName: 'Arvid', lastName: 'Lindblad', number: 41, teamId: 'racingbulls', countryCode: 'GB', pace: 0.86, racecraft: 0.82, consistency: 0.8 },
  { id: 'oco', code: 'OCO', firstName: 'Esteban', lastName: 'Ocon', number: 31, teamId: 'haas', countryCode: 'FR', pace: 0.87, racecraft: 0.87, consistency: 0.86 },
  { id: 'bea', code: 'BEA', firstName: 'Oliver', lastName: 'Bearman', number: 87, teamId: 'haas', countryCode: 'GB', pace: 0.88, racecraft: 0.85, consistency: 0.83 },
  { id: 'hul', code: 'HUL', firstName: 'Nico', lastName: 'Hülkenberg', number: 27, teamId: 'audi', countryCode: 'DE', pace: 0.88, racecraft: 0.88, consistency: 0.9 },
  { id: 'bor', code: 'BOR', firstName: 'Gabriel', lastName: 'Bortoleto', number: 5, teamId: 'audi', countryCode: 'BR', pace: 0.87, racecraft: 0.84, consistency: 0.84 },
  { id: 'per', code: 'PER', firstName: 'Sergio', lastName: 'Pérez', number: 11, teamId: 'cadillac', countryCode: 'MX', pace: 0.86, racecraft: 0.9, consistency: 0.84 },
  { id: 'bot', code: 'BOT', firstName: 'Valtteri', lastName: 'Bottas', number: 77, teamId: 'cadillac', countryCode: 'FI', pace: 0.86, racecraft: 0.85, consistency: 0.89 },
];

export const TEAM_BY_ID: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
export const DRIVER_BY_ID: Record<string, Driver> = Object.fromEntries(DRIVERS.map((d) => [d.id, d]));

export function teamOf(driverId: string): Team {
  const d = DRIVER_BY_ID[driverId];
  if (!d) throw new Error(`Unknown driver ${driverId}`);
  return TEAM_BY_ID[d.teamId]!;
}

export function driverName(driverId: string): string {
  const d = DRIVER_BY_ID[driverId];
  return d ? `${d.firstName} ${d.lastName}` : driverId;
}
