import type { ReactElement } from 'react';

export type NavIconName = 'diary' | 'trends' | 'food' | 'settings' | 'log';

/**
 * The navigation icons, drawn inline so the app takes no icon dependency.
 *
 * Every one is `aria-hidden`: the name belongs to the control that holds it, never to the picture. The owner chose
 * icon-only navigation (§7.3) and accepted that it costs first-run legibility; what it must not cost is a screen
 * reader, so a control using one of these has an accessible name or it is a defect.
 */
const PATHS: Record<NavIconName, ReactElement> = {
  // A book, open: the day's record.
  diary: (
    <>
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H9a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H3z" />
      <path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H15a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H21z" />
    </>
  ),
  // A line rising over time.
  trends: (
    <>
      <path d="M3 20h18" />
      <path d="M4 16l5-5 4 3 6-7" />
      <path d="M19 4h0.5V8" />
    </>
  ),
  // A fork and a knife: the things you keep rather than the things you ate.
  food: (
    <>
      <path d="M6 3v7a2 2 0 0 0 4 0V3" />
      <path d="M8 3v18" />
      <path d="M16 3c-1.5 2-2 4-2 6s0.8 3 2 3 2-1 2-3-0.5-4-2-6z" />
      <path d="M16 12v9" />
    </>
  ),
  // A cog.
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>
  ),
  // A plus: add what you ate.
  log: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
};

export default function NavIcon({ name, className = 'h-6 w-6' }: { name: NavIconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
