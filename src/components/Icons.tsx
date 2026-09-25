import type { ReactNode, SVGProps } from 'react';

/** Small stroke icons (24 x 24 grid). */
const Svg = ({ children, ...p }: { children: ReactNode } & SVGProps<SVGSVGElement>) => (
  <svg className="i" viewBox="0 0 24 24" aria-hidden="true" {...p}>{children}</svg>
);

export const Icon = {
  Dice: () => <Svg><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" /></Svg>,
  Pencil: () => <Svg><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></Svg>,
  Check: () => <Svg><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>,
  Upload: () => <Svg><path d="M12 19V6" /><path d="M6.5 11.5L12 6l5.5 5.5" /></Svg>,
  Pause: () => <Svg><path d="M9 6v12M15 6v12" /></Svg>,
  Play: () => <Svg><path d="M8 5.5v13l10-6.5z" /></Svg>,
  Reset: () => <Svg><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></Svg>,
  Pin: () => <Svg><path d="M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.2" /></Svg>,
  Code: () => <Svg><path d="M8 7l-5 5 5 5M16 7l5 5-5 5" /></Svg>,
  Beams: () => <Svg><path d="M4 12h2" /><path d="M8 7.5a6 6 0 0 1 0 9" /><path d="M11.5 4.5a10.5 10.5 0 0 1 0 15" /><path d="M15 2a14 14 0 0 1 0 20" opacity=".55" /></Svg>,
  Trail: () => <Svg><path d="M4 19c3-1 3-6 7-6s4-6 9-7" strokeDasharray="2.5 2.5" /></Svg>,
  Trash: () => <Svg><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></Svg>,
  GitHub: () => (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'currentColor', stroke: 'none' }}>
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
    </svg>
  ),
};

/** Top-down robot mark used as the logo: chassis, yellow wheels, three sonar dots. */
export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="3" width="20" height="26" rx="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="1.5" y="17" width="4" height="9" rx="1.5" fill="#F2C230" />
      <rect x="26.5" y="17" width="4" height="9" rx="1.5" fill="#F2C230" />
      <circle cx="16" cy="7.5" r="2" fill="#4FD1E8" />
      <circle cx="9.6" cy="12" r="1.6" fill="#FF8A3D" />
      <circle cx="22.4" cy="12" r="1.6" fill="#B98CFF" />
    </svg>
  );
}
