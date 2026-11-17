import { MEAL_SLOTS, type MealSlot } from '@/types/diary';

const LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/**
 * Which meal an entry belonged to.
 *
 * The suggested slot comes from the clock and is said on screen to be the app's own guess, because it is: the
 * boundaries in `MEAL_DEFAULT_FROM` are this app's choice and not a published definition of a meal. Nothing is
 * derived from a slot, so a wrong guess costs a tap and no figure.
 */
export default function MealPicker({
  value,
  onChange,
  suggested = false,
}: {
  value: MealSlot | undefined;
  onChange: (m: MealSlot) => void;
  /** True where `value` is the clock's guess rather than a choice the person made. */
  suggested?: boolean;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">Which meal?</legend>
      <div className="flex flex-wrap gap-2">
        {MEAL_SLOTS.map((slot) => (
          <button
            key={slot}
            type="button"
            aria-pressed={value === slot}
            onClick={() => onChange(slot)}
            className={`min-h-11 rounded-lg border px-3 text-sm ${
              value === slot
                ? 'border-slate-900 dark:border-slate-100 bg-slate-100 dark:bg-slate-800 font-semibold'
                : 'border-slate-300 dark:border-slate-700'
            }`}
          >
            {LABEL[slot]}
          </button>
        ))}
      </div>
      {suggested && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Suggested from the time you logged it, using this app&rsquo;s own working times for meals, not a published
          definition. Change it if it is wrong.
        </p>
      )}
    </fieldset>
  );
}
