import { lsKey, onEraseEverything } from '@/data/db';

/**
 * The colour-theme preference: System (follow the device, live), Light or Dark. Stored under the app prefix so
 * "erase everything" removes it. System is the default and is stored as the ABSENCE of the key.
 *
 * `index.html` carries a tiny inline script that applies the same decision before React mounts, reading the same key,
 * so there is no flash of the wrong theme. If you change THEME_KEY or the stored values, change that script too
 * (tests/state/theme.test.ts fails if they drift apart).
 */
export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_KEY = lsKey('theme');
export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark'];
const QUERY = '(prefers-color-scheme: dark)';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Persists the choice. Never throws: if storage is blocked the choice still applies until the page closes. */
export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* applied for this session below; just not remembered */
  }
  applyTheme(pref);
}

function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

export function resolveDark(pref: ThemePref): boolean {
  return pref === 'dark' || (pref === 'system' && systemPrefersDark());
}

/** Puts the `dark` class and the matching `color-scheme` on <html>, so form controls and scrollbars follow. */
export function applyTheme(pref: ThemePref = getThemePref()): void {
  const dark = resolveDark(pref);
  const el = document.documentElement;
  el.classList.toggle('dark', dark);
  el.style.colorScheme = dark ? 'dark' : 'light';
}

/** Re-applies the theme whenever the device flips between light and dark. Returns the unsubscribe. */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  let mq: MediaQueryList;
  try {
    mq = matchMedia(QUERY);
  } catch {
    return () => {};
  }
  const onChange = () => applyTheme();
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

// An erase removes the key; go back to System straight away rather than at the next load.
onEraseEverything(() => applyTheme('system'));
