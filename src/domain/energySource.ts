import { ACTIVITY_FACTORS } from '@/domain/targets';
import { WINDOW_DAYS } from '@/domain/expenditure';
import type { ActivityLevel, Targets } from '@/types/profile';

/**
 * The one sentence that says where the energy target came from. Settings and the Missing screen both import it, so the two
 * cannot say different things (an earlier plan's review found exactly that).
 *
 * It reads `basis.energy` and `basis.expenditure` TOGETHER: they are independent. `energy` is what produced the resting rate
 * (still the equation when a reported burn replaced the activity factor); `expenditure` is what replaced the factor. A figure
 * the person typed is theirs and carries no source.
 */

const LEVEL_WORDS: Record<ActivityLevel, string> = {
  sedentary: 'sedentary', light: 'light', moderate: 'moderate', active: 'active', veryActive: 'very active',
};

export function energySourceSentence(
  basis: Targets['basis'],
  activityLevel: ActivityLevel | undefined,
  reportedDays: number | undefined,
  isGeneric = false,
): string {
  if (basis.energy === 'custom') return 'Energy: your own figure, not calculated by the app.';
  // The general-adult basis: nothing about this person is known, so the 'light' factor stands in and no goal or reported
  // burn is applied. It must not be worded as "your" activity level.
  if (isGeneric) {
    return `Energy: resting energy for a general adult from the Mifflin-St Jeor equation, multiplied by a light activity factor of ${ACTIVITY_FACTORS.light} (this app's own working figure, not your activity level).`;
  }
  const resting =
    basis.energy === 'katch-mcardle'
      ? 'the Katch-McArdle equation, using your body-fat percentage'
      : 'the Mifflin-St Jeor equation';
  if (basis.expenditure === 'reported') {
    const over = reportedDays === undefined ? 'the days you reported' : `${reportedDays} of the last ${WINDOW_DAYS} days, ending yesterday`;
    return `Energy: your own reported energy burn, averaged over ${over}, used in place of an activity level. Resting energy still comes from ${resting}.`;
  }
  const factor =
    activityLevel !== undefined && Object.hasOwn(ACTIVITY_FACTORS, activityLevel)
      ? ` (${LEVEL_WORDS[activityLevel]}, a factor of ${ACTIVITY_FACTORS[activityLevel]}, this app's own working figure)`
      : '';
  return `Energy: resting energy from ${resting}, multiplied by your activity level${factor}.`;
}
