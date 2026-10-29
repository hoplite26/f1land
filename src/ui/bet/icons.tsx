/* Icons for the Live overlay and pool screens (workstream D). 24×24, currentColor. */
import type { CSSProperties, ReactNode, SVGProps } from 'react';
import type { CameraMode } from '@/three/engine/cameraRig';

type P = { size?: number; className?: string; style?: CSSProperties };

const Svg = ({ size = 20, className = 'icon', style, children, fill = 'none', ...rest }: P & { children: ReactNode } & SVGProps<SVGSVGElement>) => (
  <svg className={className} style={style} viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const IcClapper = (p: P) => (
  <Svg {...p}>
    <path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <path d="m4 10-.6-3.2a1 1 0 0 1 .8-1.2L17.5 3a1 1 0 0 1 1.2.8L19.3 7 4 10z" />
    <path d="m8.5 5.4 2.2 3M13 4.6l2.2 3" />
  </Svg>
);
export const IcChase = (p: P) => (
  <Svg {...p}>
    <path d="M7 15h12l-1.2-3.6A2 2 0 0 0 15.9 10H11l-3 2.4" />
    <circle cx="10" cy="16.5" r="1.6" />
    <circle cx="17" cy="16.5" r="1.6" />
    <path d="M2 10h4M3 13h3M2 16h3" />
  </Svg>
);
export const IcTv = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="m9 2 3 4 3-4M8 21h8" />
  </Svg>
);
export const IcHeli = (p: P) => (
  <Svg {...p}>
    <path d="M3 5h16M11 5v3" />
    <path d="M7 11.5A3.5 3.5 0 0 1 10.5 8H14a5 5 0 0 1 5 5v1h-8a4 4 0 0 1-4-2.5z" />
    <path d="M7 11.5H3M10 18h8M13 14v4M16 14v4" />
  </Svg>
);
export const IcWheel = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.2" />
    <path d="M3.8 10.5c2.6-.6 5.2-.9 8.2-.9s5.6.3 8.2.9M12 14.2V20.4" />
  </Svg>
);
export const IcOrbit = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.4" />
    <ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-18 12 12)" />
    <circle cx="19.6" cy="8.6" r="1.2" fill="currentColor" />
  </Svg>
);
export const IcOverview = (p: P) => (
  <Svg {...p}>
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z" />
    <path d="M9 4v14M15 6v14" />
  </Svg>
);

export const CAMERA_ICON: Record<CameraMode, (p: P) => ReactNode> = {
  director: IcClapper,
  follow: IcChase,
  tv: IcTv,
  heli: IcHeli,
  onboard: IcWheel,
  orbit: IcOrbit,
  overview: IcOverview,
};

export const IcSwords = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2" />
    <path d="M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2" />
  </Svg>
);
export const IcPodium = (p: P) => (
  <Svg {...p}>
    <path d="M9 21V9h6v12M3 21v-7h6M15 21v-9h6v9M2 21h20" />
    <path d="m12 3 .9 1.8 2 .3-1.4 1.4.3 2L12 7.6l-1.8.9.3-2-1.4-1.4 2-.3z" />
  </Svg>
);
export const IcLink = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  </Svg>
);
export const IcTicket = (p: P) => (
  <Svg {...p}>
    <path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H3z" transform="translate(0 -1)" />
    <path d="M14 6v12" strokeDasharray="2 2.4" transform="translate(0 -1)" />
  </Svg>
);
export const IcStopwatch = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 9.5v4l2.5 1.6M9.5 2.5h5M12 2.5V6M18.5 6.5l1.5-1.5" />
  </Svg>
);
export const IcArrowUp = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </Svg>
);
export const IcArrowDown = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" />
  </Svg>
);
export const IcEqual = (p: P) => (
  <Svg {...p}>
    <path d="M5 9h14M5 15h14" />
  </Svg>
);
export const IcPass = (p: P) => (
  <Svg {...p}>
    <path d="m5 6 6 6-6 6M12 6l6 6-6 6" />
  </Svg>
);
export const IcNo = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IcYes = (p: P) => (
  <Svg {...p}>
    <path d="m4.5 12.5 4.5 4.5L19.5 6.5" />
  </Svg>
);
export const IcMinus = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const IcPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IcCoins = (p: P) => (
  <Svg {...p}>
    <ellipse cx="9" cy="7" rx="6" ry="2.6" />
    <path d="M3 7v4c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V7" />
    <path d="M9 16.4c-3.3 0-6-1.2-6-2.6M15 12.2c3.3 0 6 1 6 2.4v3.8c0 1.4-2.7 2.6-6 2.6-2.6 0-4.8-.7-5.6-1.7" />
  </Svg>
);
export const IcSwapCar = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </Svg>
);
export const IcGrid = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </Svg>
);
export const IcList = (p: P) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1" fill="currentColor" />
  </Svg>
);
export const IcChat = (p: P) => (
  <Svg {...p}>
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M8 9.5h8M8 12.5h5" />
  </Svg>
);
export const IcChart = (p: P) => (
  <Svg {...p}>
    <path d="M3 20h18" />
    <path d="m4 15 4.5-5 4 3 7-7.5" />
    <circle cx="8.5" cy="10" r="1" fill="currentColor" />
    <circle cx="12.5" cy="13" r="1" fill="currentColor" />
  </Svg>
);
export const IcTrophy = (p: P) => (
  <Svg {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13v4M8.5 20h7M9.5 17h5v3h-5z" />
  </Svg>
);
export const IcRetire = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Svg>
);
export const IcGauge = (p: P) => (
  <Svg {...p}>
    <path d="M4.2 17a8.5 8.5 0 1 1 15.6 0" />
    <path d="m12 14 4-5" />
    <circle cx="12" cy="14" r="1.4" fill="currentColor" />
  </Svg>
);
export const IcThermo = (p: P) => (
  <Svg {...p}>
    <path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" />
    <path d="M12 9v7" />
  </Svg>
);
export const IcSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Svg>
);
export const IcCloud = (p: P) => (
  <Svg {...p}>
    <path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z" />
  </Svg>
);
export const IcRain = (p: P) => (
  <Svg {...p}>
    <path d="M7 15a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 6.5a4.3 4.3 0 0 1-.5 8.5z" />
    <path d="m8 18-1 2.5M12.5 18l-1 2.5M17 18l-1 2.5" />
  </Svg>
);

/** Solid waving flag; `chequered` renders the black/white pattern. */
export function FlagGlyph({ color = '#ffd12e', size = 20, chequered = false }: { color?: string; size?: number; chequered?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="flag-glyph">
      <defs>
        <pattern id="lv-cheq" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="#fff" />
          <rect width="2" height="2" fill="#111" />
          <rect x="2" y="2" width="2" height="2" fill="#111" />
        </pattern>
      </defs>
      <path d="M5 3v18" stroke="#c9d1d6" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 4c3-1.6 5.5 1.4 8.5 0S18.5 3 20 4v9c-1.5-1-3.5-1.6-5.5 0s-5.5-1.6-8.5 0z" fill={chequered ? 'url(#lv-cheq)' : color} stroke="rgba(0,0,0,.35)" strokeWidth=".6" />
    </svg>
  );
}

/** Rounded “SC” / “VSC” race-control badge. */
export function RcBadge({ text, size = 20 }: { text: 'SC' | 'VSC'; size?: number }) {
  const w = text === 'SC' ? size * 1.25 : size * 1.7;
  return (
    <svg width={w} height={size} viewBox={`0 0 ${text === 'SC' ? 30 : 41} 24`} aria-hidden="true" className="rc-badge">
      <rect x="1" y="2" width={text === 'SC' ? 28 : 39} height="20" rx="5" fill="rgba(255,209,46,.14)" stroke="#ffd12e" strokeWidth="1.6" />
      <text x={text === 'SC' ? 15 : 20.5} y="16.4" textAnchor="middle" fontFamily="Chakra Petch, sans-serif" fontWeight="700" fontSize="11.5" fill="#ffd12e">
        {text}
      </text>
    </svg>
  );
}

/** Tyre ring (sidewall stripe in compound colour). */
export function TyreRing({ compound, size = 44 }: { compound: string; size?: number }) {
  const c = compound.toUpperCase();
  const color = c === 'SOFT' ? 'var(--soft)' : c === 'MEDIUM' ? 'var(--medium)' : c === 'HARD' ? 'var(--hard)' : c === 'INTERMEDIATE' ? 'var(--inter)' : c === 'WET' ? 'var(--wet)' : 'var(--muted)';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="tyre-ring">
      <circle cx="24" cy="24" r="22" fill="#0b0e10" stroke="#23292d" strokeWidth="2" />
      <circle cx="24" cy="24" r="16.5" fill="none" stroke={color} strokeWidth="4" strokeDasharray="22 4" strokeLinecap="round" transform="rotate(-80 24 24)" />
      <circle cx="24" cy="24" r="11" fill="#14191c" />
      <text x="24" y="28.6" textAnchor="middle" fontFamily="Chakra Petch, sans-serif" fontWeight="700" fontSize="13" fill={color}>
        {c[0] ?? '?'}
      </text>
    </svg>
  );
}
