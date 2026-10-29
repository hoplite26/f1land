import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: P) {
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, className: 'icon', ...rest };
}

export const IconHome = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 10.5 12 3.8l8.5 6.7V20a1 1 0 0 1-1 1H15v-6.2H9V21H4.5a1 1 0 0 1-1-1z" />
  </svg>
);
export const IconFlag = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 21V4" />
    <path d="M5 4h6v3h8v9h-7v-3H5" />
    <path d="M11 4v3M12 13v3M8 4v3h3M8 13h4M15 7v3h4M12 10h3v3" strokeWidth={1.2} />
  </svg>
);
export const IconTrophy = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
    <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4v3h-4z" />
  </svg>
);
export const IconChart = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 20V11M10 20V5M15 20v-7M20 20V8" />
  </svg>
);
export const IconUser = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c1.2-3.7 4-5.5 7.5-5.5s6.3 1.8 7.5 5.5" />
  </svg>
);
export const IconPulse = (p: P) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M2 12h4l2.2-6 3.6 13 2.6-9 1.6 2H22" />
  </svg>
);
export const IconWallet = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
    <rect x="4" y="8" width="16" height="11" rx="2.5" />
    <circle cx="16" cy="13.5" r="1.2" fill="currentColor" />
  </svg>
);
export const IconGift = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="9" width="16" height="11" rx="1.5" />
    <path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S9 9 12 9zm0 0c2-4 6-4 6-1.5S15 9 12 9z" />
  </svg>
);
export const IconChevron = (p: P & { dir?: 'right' | 'left' | 'down' | 'up' }) => {
  const { dir = 'right', ...rest } = p;
  const r = { right: 0, down: 90, left: 180, up: 270 }[dir];
  return (
    <svg {...base(rest)} style={{ transform: `rotate(${r}deg)` }}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
};
export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.01" />
  </svg>
);
export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
);
export const IconCamera = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.3l1.4-2h7.6l1.4 2h2.3A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const IconLayers = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);
export const IconTarget = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
);
export const IconTimer = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M9.5 2.5h5M19 6l1.5-1.5" />
  </svg>
);
export const IconSwap = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h14l-3-3M20 16H6l3 3" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)} strokeWidth={2.6}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);
export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </svg>
);
export const IconPause = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
  </svg>
);
export const IconFast = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6v12l8-6zM12 6v12l8-6z" fill="currentColor" />
  </svg>
);
export const IconExpand = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);
export const IconList = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);
export const IconBolt = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconHelmet = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 14.5C3.5 8.7 7.4 5 12.5 5c4.5 0 8 3.3 8 8v3.5a2 2 0 0 1-2 2H7.5a4 4 0 0 1-4-4z" />
    <path d="M10 10.5h10.3M10 10.5v4h10.5" />
  </svg>
);
export const IconCar = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 13h3l2-3h3.5l2.5-2.5h3l1 2.5h3.5l1 3.5h-19.5z" />
    <circle cx="7" cy="15.5" r="2" />
    <circle cx="17.5" cy="15.5" r="2" />
  </svg>
);
export const IconPit = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 3.5a5 5 0 0 0-4.6 6.9L3.5 16.8a1.9 1.9 0 0 0 2.7 2.7l6.4-6.4a5 5 0 0 0 6.9-4.6l-3 3-2.8-.6-.6-2.8z" />
  </svg>
);
export const IconTyre = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" strokeWidth={1.2} />
  </svg>
);
export const IconStar = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />
  </svg>
);
export const IconFire = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21c4 0 6.5-2.6 6.5-6.3 0-4.4-3.8-6.4-4.5-10.2-2 1.4-3.5 3.8-3.2 6.3-1.4-.7-2.2-2-2.3-3.3-2 1.8-3 4.2-3 7.2C5.5 18.4 8 21 12 21z" />
  </svg>
);
export const IconSend = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 3 3 10.5l7 2.5 2.5 7z" />
    <path d="M10 13 21 3" />
  </svg>
);
export const IconHistory = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
    <path d="M3.5 3.5v5h5M12 8v4.5l3 2" />
  </svg>
);
export const IconGlobe = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
  </svg>
);
export const IconVibrate = (p: P) => (
  <svg {...base(p)}>
    <rect x="8" y="4" width="8" height="16" rx="1.5" />
    <path d="M4.5 8v8M19.5 8v8M2 10v4M22 10v4" />
  </svg>
);
export const IconSound = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);
export const IconEye = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const IconSpark = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </svg>
);
export const IconUsers = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20c.8-3.4 3.3-5 6.5-5s5.7 1.6 6.5 5M16 5.2a3.5 3.5 0 0 1 0 6.6M18 15.3c1.8.6 3 2.1 3.5 4.7" />
  </svg>
);
export const IconWarning = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5 22 20H2z" />
    <path d="M12 10v4.5M12 17v.01" />
  </svg>
);
export const IconCalendar = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);
export const IconMap = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6.5c3-2.5 5 1 8-1s5-3 8 0v12c-3-3-5-2-8 0s-5-1.5-8 1z" />
  </svg>
);

/** Pulse Arena heartbeat logo. */
export const LogoPulse = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 48 36" fill="none" aria-hidden="true">
    <path d="M1 19h9l3.5-9 6 21 5.5-26 4.5 18 3-4h14" stroke="#c6ff3d" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Top-down F1 car used in the navigation bar. */
export const NavCar = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 68 36" aria-hidden="true">
    <g>
      <rect x="2" y="4" width="9" height="28" rx="2" fill="#0d1206" stroke="#c6ff3d" strokeWidth="1.5" />
      <rect x="12" y="2" width="9" height="7" rx="2.5" fill="#111" />
      <rect x="12" y="27" width="9" height="7" rx="2.5" fill="#111" />
      <rect x="46" y="1" width="8" height="7" rx="2.5" fill="#111" />
      <rect x="46" y="28" width="8" height="7" rx="2.5" fill="#111" />
      <path d="M11 13h10l6-3h18l9 6v4l-9 6H27l-6-3H11z" fill="#c6ff3d" />
      <path d="M31 14.5h9l3 3.5-3 3.5h-9z" fill="#0b1200" />
      <rect x="58" y="6" width="8" height="24" rx="2" fill="#0d1206" stroke="#c6ff3d" strokeWidth="1.5" />
      <path d="M54 15h5v6h-5z" fill="#c6ff3d" />
    </g>
  </svg>
);

/* ---- Shell / Home additions ---- */
export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconArrow = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 12h14.5M13.5 6.5 19 12l-5.5 5.5" />
  </svg>
);
/** PULSE demo point coin. */
export const IconCoin = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="7" rx="7.5" ry="3" />
    <path d="M4.5 7v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V7M4.5 12v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5" />
  </svg>
);
export const IconBroadcast = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="2" />
    <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4" />
  </svg>
);
export const IconTicket = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 7.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v2.6a2 2 0 0 0 0 3.8v2.6a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2.6a2 2 0 0 0 0-3.8z" />
    <path d="M15 7v1.6M15 11.2v1.6M15 15.4V17" />
  </svg>
);
export const IconChequered = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 21V4" />
    <path d="M5 4h14v10H5" />
    <path d="M5 4h3.5v3.3H5zM12 4h3.5v3.3H12zM8.5 7.3H12v3.4H8.5zM15.5 7.3H19v3.4h-3.5zM5 10.7h3.5V14H5zM12 10.7h3.5V14H12z" fill="currentColor" strokeWidth={0} />
  </svg>
);
export const IconRefund = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
    <path d="M4 4v4.5h4.5" />
  </svg>
);
