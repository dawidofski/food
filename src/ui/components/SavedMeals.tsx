import { useEffect, useState } from 'react';
import { allSavedMeals, deleteSavedMeal } from '@/data/db';
import type { SavedMeal } from '@/domain/savedMeals';
import type { FoodRef } from '@/types/diary';

/**
 * The meals the person named, ready to log again.
 *
 * Each one is a name pointing at foods and weights, so tapping it works the figures out from the foods as they
 * are today. Nothing here is a stored nutrition figure, which is why a saved meal cannot drift away from the
 * database behind it or quietly lose an allergen.
 *
 * Logging one goes through the ordinary warning gate. Food is never added silently, whatever it was saved as.
 */
export default function SavedMeals({
  onLog,
  reloadToken = 0,
}: {
  /** Resolves with any foods that could not be found, so this can say which rather than logging less. */
  onLog: (meal: SavedMeal) => Promise<FoodRef[]>;
  reloadToken?: number;
}) {
  const [meals, setMeals] = useState<SavedMeal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = () => {
    allSavedMeals()
      .then((rows) => setMeals([...rows].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setMeals([]));
  };
  useEffect(load, [reloadToken]);

  if (meals.length === 0) return null;

  return (
    <section aria-label="Saved meals" className="space-y-1">
      <h2 className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">Your meals</h2>
      {note && <p role="alert" className="text-sm">{note}</p>}
      <ul>
        {meals.map((m) => (
          <li key={m.id} className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base">{m.name}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {`${m.refs.length} ${m.refs.length === 1 ? 'food' : 'foods'} · worked out fresh each time you log it`}
              </p>
            </div>
            {confirmDelete === m.id ? (
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    void deleteSavedMeal(m.id).then(() => { setConfirmDelete(null); load(); }).catch(() => setNote('That could not be removed.'));
                  }}
                  className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-xs"
                >
                  Remove it
                </button>
                <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-11 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs">
                  Keep
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-label={`Log ${m.name}`}
                  onClick={() => {
                    setBusy(m.id);
                    setNote(null);
                    void onLog(m)
                      .then((missing) => {
                        if (missing.length === 0) return;
                        // Named, not swallowed: logging a smaller meal than they asked for while looking
                        // complete is the failure this app is built against.
                        setNote(
                          missing.length === m.refs.length
                            ? `None of the foods in “${m.name}” could be found any more, so nothing was logged.`
                            : `${missing.length} of the foods in “${m.name}” could not be found any more, so what was logged is short by that much.`,
                        );
                      })
                      .catch(() => setNote('That could not be logged.'))
                      .finally(() => setBusy(null));
                  }}
                  className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-sm disabled:opacity-50"
                >
                  {busy === m.id ? 'Logging…' : 'Log it'}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${m.name} from your meals`}
                  onClick={() => setConfirmDelete(m.id)}
                  className="min-h-11 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs"
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
