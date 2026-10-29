import { useMemo, useState } from 'react';
import type { CircuitData, Vec2 } from '@/data/circuits';
import { TrackGeometry, makeSvgProjector, polylineToSvgPath } from '@/data/circuits';
import { meetingForCircuit } from '@/data/calendar';
import { CHANNELS } from '@/demo/channels';
import { useNav } from '@/store/nav';
import { SubHeader } from '@/app/Header';
import { Card, Collapsible, useNow } from '@/ui/kit';
import { IconCalendar, IconFlag, IconPlay } from '@/ui/icons';
import { flagEmoji, fmtClock, fmtLap, fmtNumber, getLang, t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { CircuitThumb, Reveal, safeMeta, useBack, useCircuit, useReduced } from './common';
import { NotFound, watchChannel } from './Races';

/** Sector palette for this screen: S1 cyan, S2 lime, S3 violet. */
export const SECTOR_TONES = ['#2fe6ff', '#c6ff3d', '#b26bff'] as const;

const W = 340;
const H = 290;
const PAD = 26;

interface MapGeom {
  full: string;
  sectors: string[];
  sectorLen: number[];
  pit: string;
  zones: string[];
  start: { x1: number; y1: number; x2: number; y2: number };
  arrow: { x: number; y: number; a: number };
  corners: Array<{ n: number; x: number; y: number }>;
  labels: Array<{ x: number; y: number; ax: number; ay: number }>;
}

function buildGeom(c: CircuitData): MapGeom {
  const geom = new TrackGeometry(c.centerline, true);
  const { project, scale } = makeSvgProjector(c.bounds, W, H, PAD);
  const L = geom.length;
  const span = (s0: number, s1: number) => {
    let len = s1 - s0;
    if (len <= 0) len += L;
    return len;
  };
  const seg = (s0: number, s1: number) => {
    const len = span(s0, s1);
    const n = Math.max(2, Math.round(len / 10));
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) pts.push(geom.pointAt(s0 + (len * i) / n));
    return polylineToSvgPath(pts, project, false);
  };
  const pr = (p: Vec2) => project(p[0], p[1]);
  const hw = c.widthM / 2 + 9 / Math.max(0.05, scale);
  const a = pr(geom.pointAt(0, hw));
  const b = pr(geom.pointAt(0, -hw));
  const p0 = pr(geom.pointAt(L * 0.035));
  const p1 = pr(geom.pointAt(L * 0.035 + 12));
  const cx = W / 2;
  const cy = H / 2;
  const labels = c.sectors.map((s) => {
    const mid = pr(geom.pointAt(s.startS + span(s.startS, s.endS) / 2));
    const dx = mid[0] - cx;
    const dy = mid[1] - cy;
    const d = Math.hypot(dx, dy) || 1;
    const x = Math.max(28, Math.min(W - 28, mid[0] + (dx / d) * 30));
    const y = Math.max(14, Math.min(H - 14, mid[1] + (dy / d) * 22));
    return { x, y, ax: mid[0], ay: mid[1] };
  });
  return {
    full: polylineToSvgPath(c.centerline, project, true, 2),
    sectors: c.sectors.map((s) => seg(s.startS, s.endS)),
    sectorLen: c.sectors.map((s) => span(s.startS, s.endS)),
    pit: polylineToSvgPath(c.pitLane.path, project, false, 2),
    zones: c.straightZones.map((z) => seg(z.startS, z.endS)),
    start: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] },
    arrow: { x: p0[0], y: p0[1], a: (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI },
    corners: c.corners.map((cn) => {
      const side = cn.direction === 'L' ? -1 : 1;
      const p = pr(geom.pointAt(cn.s, side * (c.widthM / 2 + 15 / Math.max(0.05, scale))));
      return { n: cn.number, x: p[0], y: p[1] };
    }),
    labels,
  };
}

function CircuitMap({ c, sel, onSel, showTurns }: { c: CircuitData; sel: 0 | 1 | 2 | 3; onSel: (s: 0 | 1 | 2 | 3) => void; showTurns: boolean }) {
  const g = useMemo(() => buildGeom(c), [c]);
  const reduced = useReduced();
  return (
    <svg className={`sc-map ${reduced ? '' : 'sc-map--anim'}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${c.name}. ${t('f1.data.approximate')}`}>
      <defs>
        <filter id="sc-map-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id="sc-chk" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="#fff" />
          <rect width="2" height="2" fill="#000" />
          <rect x="2" y="2" width="2" height="2" fill="#000" />
        </pattern>
      </defs>
      <path d={g.full} className="sc-map__base" />
      <path d={g.full} className="sc-map__edge" />
      <path d={g.pit} className="sc-map__pit" />
      {g.sectors.map((d, i) => {
        const on = sel === 0 || sel === i + 1;
        return (
          <g key={i} style={{ opacity: on ? 1 : 0.22 }} className="sc-map__secg">
            <path d={d} className="sc-map__sec" stroke={SECTOR_TONES[i]} pathLength={1} style={{ animationDelay: `${i * 0.35}s` }} filter="url(#sc-map-glow)" />
            <path
              d={d}
              className="sc-map__hit"
              onClick={() => {
                haptic.tap();
                onSel(sel === i + 1 ? 0 : ((i + 1) as 1 | 2 | 3));
              }}
            />
          </g>
        );
      })}
      {g.zones.map((d, i) => (
        <path key={`z${i}`} d={d} className="sc-map__zone" />
      ))}
      <line {...g.start} className="sc-map__startbg" />
      <line {...g.start} className="sc-map__start" stroke="url(#sc-chk)" />
      <g transform={`translate(${g.arrow.x} ${g.arrow.y}) rotate(${g.arrow.a})`} className="sc-map__arrow">
        <path d="M-5 -4 L3 0 L-5 4" />
      </g>
      {!reduced && (
        <circle r={4.2} className="sc-map__car">
          <animateMotion dur="9s" repeatCount="indefinite" path={g.full} />
        </circle>
      )}
      {showTurns &&
        g.corners.map((cn) => (
          <text key={cn.n} x={cn.x} y={cn.y} className="sc-map__turn">
            {cn.n}
          </text>
        ))}
      {g.labels.map((l, i) => (
        <g key={`l${i}`} className="sc-map__label" style={{ opacity: sel === 0 || sel === i + 1 ? 1 : 0.35 }}>
          <line x1={l.ax} y1={l.ay} x2={l.x} y2={l.y} stroke={SECTOR_TONES[i]} />
          <circle cx={l.ax} cy={l.ay} r={3} fill={SECTOR_TONES[i]} />
          <rect x={l.x - 17} y={l.y - 10} width={34} height={20} rx={6} stroke={SECTOR_TONES[i]} />
          <text x={l.x} y={l.y + 4} fill={SECTOR_TONES[i]}>
            S{i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function CircuitScreen({ circuitId }: { circuitId: string }) {
  const back = useBack();
  const meta = safeMeta(circuitId);
  if (!meta) return <NotFound onBack={back} />;
  return <CircuitBody circuitId={circuitId} />;
}

function CircuitBody({ circuitId }: { circuitId: string }) {
  const back = useBack();
  const push = useNav((s) => s.push);
  const meta = safeMeta(circuitId)!;
  const c = useCircuit(circuitId);
  const now = useNow(15_000);
  const [sel, setSel] = useState<0 | 1 | 2 | 3>(0);
  const [turns, setTurns] = useState(false);
  const meeting = meetingForCircuit(circuitId);
  const ch = CHANNELS.find((x) => x.circuitId === circuitId);
  const lang = getLang();
  const km = (m: number) => `${fmtNumber(m / 1000, 3)} ${t('scr.km')}`;
  const sectorCorners = (i: number) => {
    if (!c) return 0;
    const s = c.sectors[i]!;
    return c.corners.filter((cn) => (s.endS > s.startS ? cn.s >= s.startS && cn.s < s.endS : cn.s >= s.startS || cn.s < s.endS)).length;
  };
  return (
    <>
      <SubHeader title={meta.shortName} onBack={back} />
      <Reveal i={0}>
        <Card glow pad={false} className="sc-cmap">
          <div className="sc-cmap__head">
            <div>
              <div className="sc-kicker">
                {flagEmoji(meta.countryCode)} {meta.location}, {meta.country}
              </div>
              <h1 className="sc-cmap__name">{meta.name}</h1>
            </div>
            <div className="sc-cmap__len">
              <b className="num">{fmtNumber(meta.lengthM / 1000, 3)}</b>
              <span>{t('scr.km')}</span>
            </div>
          </div>
          <div className="sc-cmap__svg">{c ? <CircuitMap c={c} sel={sel} onSel={setSel} showTurns={turns} /> : <CircuitThumb id={circuitId} size={240} draw className="sc-cmap__ph" />}</div>
          <div className="sc-cmap__legend">
            <span>
              <i className="sc-lg sc-lg--start" />
              {t('scr.circuit.startFinish')}
            </span>
            <span>
              <i className="sc-lg sc-lg--zone" />
              {t('scr.circuit.zones')}
            </span>
            <span>
              <i className="sc-lg sc-lg--pit" />
              {t('scr.circuit.pit')}
            </span>
            <button className="sc-lg-btn" aria-pressed={turns} onClick={() => setTurns(!turns)}>
              {t('scr.circuit.turnNumbers')}
            </button>
          </div>
          <div className="sc-secrow" role="group" aria-label={t('scr.circuit.sectors')}>
            {[1, 2, 3].map((n) => {
              const len = c ? c.sectors[n - 1]!.endS - c.sectors[n - 1]!.startS : 0;
              return (
                <button
                  key={n}
                  className="sc-sec"
                  aria-pressed={sel === n}
                  style={{ ['--sec' as string]: SECTOR_TONES[n - 1] }}
                  onClick={() => {
                    haptic.tap();
                    setSel(sel === n ? 0 : (n as 1 | 2 | 3));
                  }}
                >
                  <span className="sc-sec__k">S{n}</span>
                  <span className="sc-sec__v num">{c ? km(len > 0 ? len : len + c.centerlineLengthM) : '—'}</span>
                  <span className="sc-sec__s">{c ? t('scr.circuit.nTurns', { n: sectorCorners(n - 1) }) : ''}</span>
                </button>
              );
            })}
          </div>
        </Card>
      </Reveal>

      <Reveal i={1} className="section">
        <div className="sc-statgrid">
          <Stat k={t('races.laps')} v={String(meta.laps)} />
          <Stat k={t('scr.circuit.distance')} v={`${fmtNumber((meta.lengthM * meta.laps) / 1000, 1)}`} unit={t('scr.km')} />
          <Stat k={t('races.record')} v={c ? fmtLap(c.lapRecordMs) : '—'} tone="purple" />
          <Stat k={t('scr.circuit.turns')} v={c ? String(c.corners.length) : '—'} />
          <Stat k={t('races.direction')} v={t(meta.direction === 'CW' ? 'races.cw' : 'races.ccw')} small />
          <Stat k={t('scr.circuit.zones')} v={c ? String(c.straightZones.length) : '—'} tone="cyan" />
          <Stat k={t('scr.circuit.pitLane')} v={c ? `${fmtNumber(c.pitLane.lengthM, 0)}` : '—'} unit={t('scr.m')} />
          <Stat k={t('scr.circuit.pitLimit')} v={c ? String(c.pitLane.speedLimitKph) : '—'} unit={t('scr.kmh')} />
          <Stat k={t('scr.circuit.localTime')} v={c ? fmtClock(now, false, c.timezone) : '—'} />
        </div>
      </Reveal>

      {c && c.corners.length > 0 && (
        <Reveal i={2} className="section">
          <Collapsible title={t('scr.circuit.turnsList', { n: c.corners.length })} icon={<IconFlag size={18} />}>
            <div className="sc-turns">
              {c.corners.map((cn) => (
                <div key={cn.number} className="sc-turn">
                  <span className="sc-turn__n num">T{cn.number}</span>
                  <span className="sc-turn__name ellipsis">{cn.name ?? (cn.direction === 'L' ? t('scr.circuit.left') : t('scr.circuit.right'))}</span>
                  <span className="sc-turn__dir">{cn.direction === 'L' ? '↰' : '↱'}</span>
                  <span className="sc-turn__sev" aria-label={t('scr.circuit.severity', { n: cn.severity })}>
                    {[1, 2, 3, 4, 5, 6].map((k) => (
                      <i key={k} data-on={k <= cn.severity || undefined} />
                    ))}
                  </span>
                  <span className="sc-turn__r num muted">
                    {Math.round(cn.radius)} {t('scr.m')}
                  </span>
                </div>
              ))}
            </div>
          </Collapsible>
        </Reveal>
      )}

      <Reveal i={3} className="section">
        <div className="sc-btnrow sc-btnrow--split">
          {meeting && (
            <button className="btn btn--ghost" onClick={() => push({ name: 'meeting', meetingId: meeting.id })}>
              <IconCalendar size={16} />
              {t('scr.races.weekend')}
            </button>
          )}
          {ch && (
            <button className="btn btn--primary" onClick={() => watchChannel(ch)}>
              <IconPlay size={16} />
              {t('races.watchDemo')}
            </button>
          )}
        </div>
        {meeting && <p className="sc-fine">{t('scr.circuit.hosts', { name: meeting.name[lang], n: meeting.round })}</p>}
        <p className="sc-fine">{t('f1.data.approximate')}</p>
      </Reveal>
    </>
  );
}

function Stat({ k, v, unit, tone, small }: { k: string; v: string; unit?: string; tone?: string; small?: boolean }) {
  return (
    <div className="sc-stat">
      <span className={`sc-stat__v num ${tone ?? ''} ${small ? 'sc-stat__v--sm' : ''}`}>
        {v}
        {unit && <i>{unit}</i>}
      </span>
      <span className="sc-stat__k">{k}</span>
    </div>
  );
}
