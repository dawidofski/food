import { MEAL_SLOTS, type MealSlot } from '@/types/diary';

/**
 * The local clock time each slot starts, as `HH:MM`. Each runs until the next begins, and `snack` wraps midnight.
 *
 * **These are this app's own choice, not a published definition of a meal**, and they are set later than a textbook
 * would put them because the person this app was built for eats in Spain. They produce a starting guess only: the
 * picker overrides it, nothing stores a slot the person did not see, and no figure anywhere is derived from a slot.
 * Change them here and the picker's wording follows, because both read this table.
 */
export const MEAL_DEFAULT_FROM: Record<MealSlot, string> = {
  breakfast: '05:00',
  lunch: '12:00',
  dinner: '17:30',
  snack: '23:30',
};

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Slots with their start minute, earliest first. */
const STARTS: { slot: MealSlot; from: number }[] = MEAL_SLOTS
  .map((slot) => ({ slot, from: minutesOf(MEAL_DEFAULT_FROM[slot]) }))
  .sort((a, b) => a.from - b.from);

/**
 * The slot a meal eaten at `at` most likely belongs to, read from the local clock.
 *
 * A suggestion, never a fact: an entry only ever carries the slot the person accepted or chose. Before the first
 * boundary of the day the answer wraps to the last slot, so 00:30 is a snack rather than an impossible gap.
 */
export function mealFromClock(at: Date): MealSlot {
  const mins = at.getHours() * 60 + at.getMinutes();
  let found = STARTS[STARTS.length - 1]?.slot ?? 'snack';
  for (const { slot, from } of STARTS) {
    if (mins >= from) found = slot;
  }
  // Before the earliest boundary the clock is still in the previous day's last slot.
  const first = STARTS[0];
  if (first !== undefined && mins < first.from) found = STARTS[STARTS.length - 1]?.slot ?? found;
  return found;
}
