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
 * The screen explains where a suggested slot comes from, as a standing fact about the app rather than a claim
 * about the entry in front of the person: the boundaries in `MEAL_DEFAULT_FROM` are this app's choice and not a
 * published definition of a meal, and nothing records whether a stored slot was the clock's guess or the
 * person's own pick. Nothing is derived from a slot, so a wrong one costs a tap and no figure.
 */
export default function MealPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: MealSlot | undefined;
  onChange: (m: MealSlot) => void;
  /** True while a write is in flight, or while another flow owns this entry. */
  disabled?: boolean;
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
            disabled={disabled}
            onClick={() => onChange(slot)}
            className={`min-h-11 rounded-lg border px-3 text-sm ${
              value === slot
                ? 'border-slate-900 dark:border-slate-100 bg-slate-100 dark:bg-slate-800 font-semibold'
                : 'border-slate-300 dark:border-slate-700'
            } disabled:opacity-50`}
          >
            {LABEL[slot]}
          </button>
        ))}
      </div>
      {/*
        A standing explanation of where a suggestion comes from, never a claim about THIS entry: nothing stored
        records whether a slot was the clock's guess or the person's own choice, so the screen cannot say which
        this one was, and saying it anyway would be the screen stating something the code does not know.
      */}
      <p className="text-xs text-slate-600 dark:text-slate-400">
        A slot is suggested from the time an entry was logged, using this app&rsquo;s own working times for meals
        rather than a published definition. Change it whenever it is wrong.
      </p>
    </fieldset>
  );
}
