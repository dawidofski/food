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
      <path d="M15 4h4v4" />
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
  // A cog: a toothed outer ring, so it does not read as the sun/brightness glyph.
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
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
