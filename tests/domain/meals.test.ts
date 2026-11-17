import { describe, expect, test } from 'vitest';
import { mealFromClock, MEAL_DEFAULT_FROM } from '@/domain/meals';
import { MEAL_SLOTS } from '@/types/diary';

/** Local time on an arbitrary day; only the clock matters. */
const at = (h: number, m: number) => new Date(2026, 10, 15, h, m);

describe('mealFromClock', () => {
  test('defaults each slot from the clock at its boundaries', () => {
    expect(mealFromClock(at(4, 59))).toBe('snack');
    expect(mealFromClock(at(5, 0))).toBe('breakfast');
    expect(mealFromClock(at(11, 59))).toBe('breakfast');
    expect(mealFromClock(at(12, 0))).toBe('lunch');
    expect(mealFromClock(at(17, 29))).toBe('lunch');
    expect(mealFromClock(at(17, 30))).toBe('dinner');
    expect(mealFromClock(at(23, 29))).toBe('dinner');
    expect(mealFromClock(at(23, 30))).toBe('snack');
    expect(mealFromClock(at(0, 30))).toBe('snack');
  });

  test('answers with a slot at every minute of the day', () => {
    for (let m = 0; m < 24 * 60; m++) {
      expect(MEAL_SLOTS).toContain(mealFromClock(at(Math.floor(m / 60), m % 60)));
    }
  });

  test('names a start time for every slot', () => {
    for (const slot of MEAL_SLOTS) expect(MEAL_DEFAULT_FROM[slot]).toMatch(/^\d{2}:\d{2}$/);
  });
});
