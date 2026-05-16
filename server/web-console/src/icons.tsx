import type { ReactNode, SVGProps } from "react";

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, "width" | "height" | "children">;

function StrokeIcon({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Lightning bolt — transmit / XMIT. */
export function IconBolt({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      <path d="M13 2 5 13h5l-1 9 9-12h-5l1-8Z" />
    </svg>
  );
}

/** Concentric broadcast arcs — the 10-33 channel marker. */
export function IconBeacon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9" />
      <path d="M16.5 7.5a6.4 6.4 0 0 1 0 9" />
      <path d="M4.7 4.7a10.3 10.3 0 0 0 0 14.6" />
      <path d="M19.3 4.7a10.3 10.3 0 0 1 0 14.6" />
    </StrokeIcon>
  );
}

/** Warning triangle — emergency. */
export function IconAlertTriangle(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <line x1="12" y1="9.5" x2="12" y2="14" />
      <circle cx="12" cy="16.8" r="0.6" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

/** Bell — paging. */
export function IconBell(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.8 2H4.2L6 16Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </StrokeIcon>
  );
}

/** Handheld radio — channels. */
export function IconRadio(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="7" y="8" width="10" height="13" rx="1.6" />
      <path d="M13.5 8 16.5 3" />
      <line x1="9.5" y1="11.5" x2="14.5" y2="11.5" />
      <circle cx="12" cy="16.5" r="1.6" />
    </StrokeIcon>
  );
}

/** Door with arrow — sign out. */
export function IconLogOut(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9" />
      <path d="M15 8.5 18.5 12 15 15.5" />
      <line x1="18.5" y1="12" x2="9" y2="12" />
    </StrokeIcon>
  );
}

/** Shield — admin portal. */
export function IconShield(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 3.2 19 6v5.2c0 4.7-2.9 8-7 9.6-4.1-1.6-7-4.9-7-9.6V6l7-2.8Z" />
    </StrokeIcon>
  );
}
