import { useEffect, useState } from 'react';
import { THEME_PREFS, applyTheme, getThemePref, setThemePref, type ThemePref } from '@/state/theme';

const LABEL: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/**
 * Colour theme: System (follows the device, live), Light or Dark. The theme is re-applied on mount, so when Settings
 * re-keys this section after an import or an erase, the page matches what is now stored.
 */
export default function ThemeSettings() {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());
  useEffect(() => {
    applyTheme(pref);
  }, [pref]);
  return (
    <section aria-labelledby="theme-heading" className="space-y-2 rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3">
      <h2 id="theme-heading" className="text-lg font-semibold">Appearance</h2>
      <div role="radiogroup" aria-labelledby="theme-heading" className="flex gap-2">
        {THEME_PREFS.map((p) => (
          <label
            key={p}
            className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border text-base ${
              pref === p ? 'border-slate-900 bg-slate-100 font-semibold dark:border-slate-100 dark:bg-slate-800' : 'border-slate-400 dark:border-slate-500'
            }`}
          >
            <input
              type="radio"
              name="theme"
              value={p}
              checked={pref === p}
              onChange={() => {
                setThemePref(p);
                setPref(p);
              }}
              className="size-5"
            />
            {LABEL[p]}
          </label>
        ))}
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-300">System follows your device&rsquo;s light or dark setting.</p>
    </section>
  );
}
