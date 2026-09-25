
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
