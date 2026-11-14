import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

export const IconSearch = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>);
export const IconLayers = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>);
export const IconPlus = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>);
export const IconMinus = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 12h14" /></svg>);
export const IconClose = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>);
export const IconRoute = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="6" r="2.4" /><path d="M8.4 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.6" /></svg>);
export const IconExplore = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></svg>);
export const IconPlay = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" /></svg>);
export const IconPause = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M8 5v14M16 5v14" strokeWidth={3} /></svg>);
export const IconRestart = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></svg>);
export const IconCompass = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3 15 12H9l3-9Z" fill="currentColor" stroke="none" /><path d="M12 21 9 12h6l-3 9Z" opacity=".45" fill="currentColor" stroke="none" /></svg>);
export const IconChevron = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="m9 6 6 6-6 6" /></svg>);
export const IconInfo = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>);
export const IconFlag = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>);
export const IconNav = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3 19 20l-7-4-7 4 7-17Z" /></svg>);
export const IconWarning = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4.5M12 17.2v.01" /></svg>);
export const IconTurnLeft = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M15 20v-7a4 4 0 0 0-4-4H5" /><path d="m9 5-4 4 4 4" /></svg>);
export const IconTurnRight = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 20v-7a4 4 0 0 1 4-4h6" /><path d="m15 5 4 4-4 4" /></svg>);
export const IconSample = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="9" y="2.5" width="6" height="19" rx="3" /><path d="M9 13h6" /></svg>);
export const IconEye = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></svg>);
export const IconCube = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4l8-4.6Z" /><path d="m4 7.4 8 4.6 8-4.6M12 12v9.2" /></svg>);
export const IconTarget = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" /></svg>);
export const IconSwap = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" /></svg>);

export function GeoMarsLogo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="gmLogoG" cx="36%" cy="32%" r="72%">
          <stop offset="0" stopColor="#ffbf8f" />
          <stop offset=".5" stopColor="#e0692f" />
          <stop offset="1" stopColor="#4a160a" />
        </radialGradient>
        <linearGradient id="gmLogoRing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd7b5" stopOpacity=".95" />
          <stop offset="1" stopColor="#ff8a3d" stopOpacity=".35" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="20" fill="url(#gmLogoG)" />
      <path d="M22 37c4-1 6-5 10-5s7 3 11 2" stroke="#7a2a12" strokeOpacity=".55" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M32 16.5 41.5 41 32 35.6 22.5 41Z" fill="#fff5ec" />
      <ellipse cx="32" cy="32" rx="29.5" ry="9.5" fill="none" stroke="url(#gmLogoRing)" strokeWidth="1.8" transform="rotate(-24 32 32)" />
    </svg>
  );
}

export const IconMountain = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="m3 19 6.5-11 4 6.5 2.5-3.5L21 19H3Z" /></svg>);
export const IconSlope = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 19h18L3 8v11Z" /><path d="M8 19a5 5 0 0 0-1.6-3.7" /></svg>);
export const IconBolt = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z" /></svg>);
export const IconBack = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="m15 6-6 6 6 6" /></svg>);
export const IconSidebar = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="3.5" /><path d="M9.5 4.5v15" /></svg>);
