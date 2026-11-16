import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eraseEverything, lsKey } from '@/data/db';
import { THEME_KEY, applyTheme, getThemePref, resolveDark, setThemePref, watchSystemTheme } from '@/state/theme';

type Listener = () => void;
/** A controllable stand-in for matchMedia, which jsdom does not provide. */
function stubSystem(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (q: string) => ({
    media: q,
    get matches() { return dark; },
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  }));
  return { flip(next: boolean) { dark = next; listeners.forEach((f) => f()); }, listeners };
}

const isDarkClass = () => document.documentElement.classList.contains('dark');

beforeEach(async () => {
  await eraseEverything();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('theme preference', () => {
  test('defaults to System, and the key lives under the app prefix', () => {
    expect(getThemePref()).toBe('system');
    expect(THEME_KEY).toBe(lsKey('theme'));
    expect(THEME_KEY.startsWith('fd.')).toBe(true);
  });

  test('persists a choice and reads it back', () => {
    stubSystem(false);
    setThemePref('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(getThemePref()).toBe('dark');
    setThemePref('light');
    expect(getThemePref()).toBe('light');
    setThemePref('system');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(getThemePref()).toBe('system');
  });

  test('an unknown stored value falls back to System', () => {
    localStorage.setItem(THEME_KEY, 'purple');
    expect(getThemePref()).toBe('system');
  });

  test('applies the dark class and color-scheme for each choice', () => {
    stubSystem(true);
    setThemePref('light');
    expect(isDarkClass()).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
    setThemePref('dark');
    expect(isDarkClass()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    setThemePref('system');
    expect(isDarkClass()).toBe(true); // the device is dark
  });

  test('System follows the device live; a forced choice ignores it', () => {
    const sys = stubSystem(false);
    const stop = watchSystemTheme();
    applyTheme();
    expect(isDarkClass()).toBe(false);
    sys.flip(true);
    expect(isDarkClass()).toBe(true);
    sys.flip(false);
    expect(isDarkClass()).toBe(false);
    setThemePref('light');
    sys.flip(true);
    expect(isDarkClass()).toBe(false);
    stop();
    expect(sys.listeners.size).toBe(0);
  });

  test('without matchMedia, System resolves to light', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveDark('system')).toBe(false);
    expect(() => watchSystemTheme()()).not.toThrow();
  });

  test('a blocked localStorage does not throw and still applies the choice', () => {
    stubSystem(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => setThemePref('dark')).not.toThrow();
    expect(isDarkClass()).toBe(true);
    vi.restoreAllMocks();
  });

  test('eraseEverything clears the stored key and returns the page to System', async () => {
    stubSystem(false);
    setThemePref('dark');
    expect(isDarkClass()).toBe(true);
    await eraseEverything();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(getThemePref()).toBe('system');
    expect(isDarkClass()).toBe(false);
  });
});

describe('no flash of the wrong theme', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  test('index.html has an inline script, before the module script, reading the same key', () => {
    expect(script).not.toBe('');
    expect(script).toContain(`'${THEME_KEY}'`);
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'));
  });

  test.each([
    ['system', true, true],
    ['system', false, false],
    ['dark', false, true],
    ['light', true, false],
  ] as const)('stored %s with a dark=%s device gives dark=%s', (pref, device, expected) => {
    stubSystem(device);
    if (pref !== 'system') localStorage.setItem(THEME_KEY, pref);
    new Function(script)();
    expect(isDarkClass()).toBe(expected);
    expect(document.documentElement.style.colorScheme).toBe(expected ? 'dark' : 'light');
  });

  test('the script survives blocked storage', () => {
    stubSystem(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => new Function(script)()).not.toThrow();
    expect(isDarkClass()).toBe(true);
    vi.restoreAllMocks();
  });
});
