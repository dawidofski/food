import { useEffect, useState } from 'react';
import { allSavedMeals as allFromDb, deleteSavedMeal as deleteFromDb } from '@/data/db';
import type { SavedMeal } from '@/domain/savedMeals';
import type { FoodRef } from '@/types/diary';

/**
 * The meals the person named, ready to log again.
 *
 * Each one is a name pointing at foods and weights, so tapping it reads those foods as they are today and
 * works everything out again. Nothing here is a stored nutrition figure or a stored flag, which is why a
 * saved meal cannot drift away from the foods behind it or quietly lose an allergen.
 *
 * Logging one goes through the ordinary warning gate. Food is never added silently, whatever it was saved as.
 */
export default function SavedMeals({
  onLog,
  reloadToken = 0,
  store,
}: {
  /**
   * Logs the meal. Resolves with the foods that could not be replayed — when that list is non-empty NOTHING
   * was logged, because a meal is logged whole or not at all.
   */
  onLog: (meal: SavedMeal) => Promise<FoodRef[]>;
  reloadToken?: number;
  /** The store seam, so a test can hand this its own meals. Absent means the real one. */
  store?: { allSavedMeals?: typeof allFromDb; deleteSavedMeal?: typeof deleteFromDb };
}) {
  const all = store?.allSavedMeals ?? allFromDb;
  const remove = store?.deleteSavedMeal ?? deleteFromDb;
  const [meals, setMeals] = useState<SavedMeal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = () => {
    all()
      .then((rows) => setMeals([...rows].sort((a, b) => a.name.localeCompare(b.name) || a.savedAt.localeCompare(b.savedAt))))
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
              <div className="flex shrink-0 flex-col gap-1">
                <p className="text-xs text-slate-600 dark:text-slate-400">Forget this meal? What you already logged stays.</p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    // Focus follows the question: the buttons that were under the person's finger have just
                    // been replaced, and without this focus drops to the document body.
                    autoFocus
                    onClick={() => {
                      void remove(m.id)
                        .then(() => { setConfirmDelete(null); load(); })
                        .catch(() => setNote('That could not be removed.'));
                    }}
                    className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-xs"
                  >
                    Forget it
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-11 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs">
                    Keep
                  </button>
                </div>
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
                        // A meal is logged whole or not at all. Logging the foods that are still there would add
                        // a smaller meal than the person asked for, and its totals would read as complete — the
                        // understating-while-looking-finished failure this app is built against.
                        setNote(
                          missing.length === m.refs.length
                            ? `Nothing in “${m.name}” is among your foods any more, so nothing was logged.`
                            : `${missing.length} of the ${m.refs.length} foods in “${m.name}” ${missing.length === 1 ? 'is' : 'are'} not among your foods any more. Nothing was logged: a meal goes in whole or not at all. Log what you did eat by typing it, and save it again as a new meal.`,
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
                  disabled={busy !== null}
                  aria-label={`Forget ${m.name}`}
                  onClick={() => setConfirmDelete(m.id)}
                  className="min-h-11 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs disabled:opacity-50"
                >
                  Forget
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
