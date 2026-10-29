import { memo, useMemo } from 'react';
import type { CircuitData, Vec2 } from '@/data/circuits/types';
import { makeSvgProjector, polylineToSvgPath, TrackGeometry } from '@/data/circuits/geometry';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import { t } from '@/i18n/core';

export const SECTOR_COLORS = ['#c6ff3d', '#2fe6ff', '#b26bff'];

export interface MapCar {
  id: string;
  x: number;
  y: number;
  inPit?: boolean;
  kind?: 'follow' | 'rival' | 'near' | 'other';
  position?: number;
}

interface Props {
  circuit: CircuitData;
  cars?: MapCar[];
  selectedSector?: 1 | 2 | 3 | null;
  onSelectSector?: (s: 1 | 2 | 3) => void;
  showPit?: boolean;
  showZones?: boolean;
  showCorners?: boolean;
  glow?: boolean;
  width?: number;
  height?: number;
  padding?: number;
  /** Highlight a sector with its multiplier label (position pool). */
  sectorLabels?: Partial<Record<1 | 2 | 3, string>>;
  className?: string;
  stale?: boolean;
}

interface Prepared {
  project: (x: number, y: number) => Vec2;
  scale: number;
  sectors: string[];
  pit: string;
  full: string;
  startLine: { x1: number; y1: number; x2: number; y2: number };
  arrows: Array<{ x: number; y: number; a: number }>;
  zones: string[];
  corners: Array<{ n: number; x: number; y: number }>;
  sectorMid: Vec2[];
}

const cache = new WeakMap<CircuitData, Map<string, Prepared>>();

function prepare(c: CircuitData, w: number, h: number, pad: number): Prepared {
  const key = `${w}x${h}:${pad}`;
  let m = cache.get(c);
  if (!m) {
    m = new Map();
    cache.set(c, m);
  }
  const hit = m.get(key);
  if (hit) return hit;
  const geom = new TrackGeometry(c.centerline, true);
  const { project, scale } = makeSvgProjector(c.bounds, w, h, pad);
  const L = geom.length;
  const segPath = (s0: number, s1: number) => {
    let len = s1 - s0;
    if (len <= 0) len += L;
    const n = Math.max(2, Math.round(len / 12));
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) pts.push(geom.pointAt(s0 + (len * i) / n));
    return polylineToSvgPath(pts, project, false);
  };
  const sectors = c.sectors.map((s) => segPath(s.startS, s.endS));
  const full = polylineToSvgPath(c.centerline, project, true, 3);
  const pit = polylineToSvgPath(c.pitLane.path, project, false, 2);
  const hw = c.widthM / 2 + 6 / Math.max(0.05, scale);
  const a = geom.pointAt(0, hw);
  const b = geom.pointAt(0, -hw);
  const pa = project(a[0], a[1]);
  const pb = project(b[0], b[1]);
  const arrows: Prepared['arrows'] = [];
  for (const f of [0.12, 0.45, 0.78]) {
    const s = L * f;
    const p = geom.pointAt(s);
    const q = geom.pointAt(s + 10);
    const pp = project(p[0], p[1]);
    const qq = project(q[0], q[1]);
    arrows.push({ x: pp[0], y: pp[1], a: (Math.atan2(qq[1] - pp[1], qq[0] - pp[0]) * 180) / Math.PI });
  }
  const zones = c.straightZones.map((z) => segPath(z.startS, z.endS));
  const corners = c.corners.map((cn) => {
    const side = cn.direction === 'L' ? -1 : 1;
    const p = geom.pointAt(cn.s, side * (c.widthM / 2 + 14 / Math.max(0.05, scale)));
    const pp = project(p[0], p[1]);
    return { n: cn.number, x: pp[0], y: pp[1] };
  });
  const sectorMid = c.sectors.map((s) => {
    let len = s.endS - s.startS;
    if (len <= 0) len += L;
    const p = geom.pointAt(s.startS + len / 2);
    return project(p[0], p[1]);
  });
  const prep: Prepared = { project, scale, sectors, pit, full, startLine: { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1] }, arrows, zones, corners, sectorMid };
  m.set(key, prep);
  return prep;
}

/**
 * Base interactive layer (F1-045): SVG circuit with sectors, pit path,
 * control line and approximate car dots. Works without WebGL.
 */
export const TrackMap = memo(function TrackMap({
  circuit,
  cars = [],
  selectedSector = null,
  onSelectSector,
  showPit = true,
  showZones = true,
  showCorners = false,
  glow = true,
  width = 300,
  height = 220,
  padding = 14,
  sectorLabels,
  className,
  stale,
}: Props) {
  const p = useMemo(() => prepare(circuit, width, height, padding), [circuit, width, height, padding]);
  const sw = Math.max(3, Math.min(7, width / 60));
  return (
    <svg className={`trackmap ${className ?? ''}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${circuit.name}. ${t('f1.data.approximate')}`}>
      <defs>
        <filter id="tm-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={p.full} className="trackmap__base" strokeWidth={sw + 5} />
      <path d={p.full} className="trackmap__edge" strokeWidth={sw + 1.6} />
      {showPit && <path d={p.pit} className="trackmap__pit" strokeWidth={1.6} />}
      {p.sectors.map((d, i) => {
        const sel = selectedSector === i + 1;
        const dim = selectedSector !== null && !sel;
        return (
          <path
            key={i}
            d={d}
            className="trackmap__sector"
            stroke={SECTOR_COLORS[i]}
            strokeWidth={sel ? sw + 1.5 : sw - 0.6}
            opacity={dim ? 0.28 : 1}
            filter={glow ? 'url(#tm-glow)' : undefined}
            style={{ cursor: onSelectSector ? 'pointer' : undefined }}
            onClick={onSelectSector ? () => onSelectSector((i + 1) as 1 | 2 | 3) : undefined}
          />
        );
      })}
      {showZones &&
        p.zones.map((d, i) => <path key={`z${i}`} d={d} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="2 3" />)}
      <line {...p.startLine} stroke="#fff" strokeWidth={2.2} />
      {p.arrows.map((a, i) => (
        <path key={i} d="M-3,-2.6 L2.5,0 L-3,2.6" transform={`translate(${a.x},${a.y}) rotate(${a.a})`} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={1.3} />
      ))}
      {showCorners &&
        p.corners.map((c) => (
          <text key={c.n} x={c.x} y={c.y + 2.5} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.55)" fontFamily="Chakra Petch">
            {c.n}
          </text>
        ))}
      {sectorLabels &&
        ([1, 2, 3] as const).map((s) =>
          sectorLabels[s] ? (
            <g key={`sl${s}`} transform={`translate(${p.sectorMid[s - 1]![0]},${p.sectorMid[s - 1]![1]})`} opacity={selectedSector && selectedSector !== s ? 0.6 : 1}>
              <rect x={-20} y={-21} width={40} height={16} rx={5} fill="rgba(5,8,10,0.85)" stroke={SECTOR_COLORS[s - 1]} strokeWidth={selectedSector === s ? 1.6 : 0.8} />
              <text y={-10} textAnchor="middle" fontSize="9" fontWeight="700" fill={SECTOR_COLORS[s - 1]} fontFamily="Chakra Petch">
                {sectorLabels[s]}
              </text>
            </g>
          ) : null,
        )}
      {cars.map((c) => {
        const [x, y] = p.project(c.x, c.y);
        const d = DRIVER_BY_ID[c.id];
        const color = d ? TEAM_BY_ID[d.teamId]!.color : '#fff';
        const big = c.kind === 'follow' || c.kind === 'rival';
        // Keep driver tags inside the viewBox: flip left / below near the right / top edges.
        const lw = c.position ? 30 : 22;
        const lx = x + 6 + lw > width - 1 ? -6 - lw : 6;
        const ly = y < 14 ? 9 : -7;
        return (
          <g key={c.id} className="trackmap__dot" transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} opacity={stale ? 0.5 : 1}>
            {c.kind === 'follow' && <circle r={9} fill="none" stroke="var(--lime)" strokeWidth={1.4} opacity={0.8} />}
            {c.kind === 'rival' && <circle r={8} fill="none" stroke="var(--cyan)" strokeWidth={1.2} opacity={0.8} />}
            <circle r={big ? 4.6 : 3.3} fill={color} stroke="#05080a" strokeWidth={1.2} />
            {(c.kind === 'follow' || c.kind === 'rival' || c.kind === 'near') && d && (
              <g transform={`translate(${lx},${ly})`}>
                <rect x={0} y={-6} width={lw} height={11} rx={3} fill="rgba(5,8,10,0.9)" stroke={c.kind === 'follow' ? 'var(--lime)' : c.kind === 'rival' ? 'var(--cyan)' : 'rgba(255,255,255,.25)'} strokeWidth={0.8} />
                <text x={3} y={2} className="trackmap__label">
                  {c.position ? `${c.position} ` : ''}
                  {d.code}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
});
