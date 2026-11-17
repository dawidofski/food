import { ACTIVITY_FACTORS } from '@/domain/targets';
import { WINDOW_DAYS } from '@/domain/expenditure';
import { MIN_LOGGED_DAYS } from '@/domain/trends';
import type { ActivityLevel, Targets } from '@/types/profile';

/**
 * The one sentence that says where the energy target came from. Settings and the Missing screen both import it, so the two
 * cannot say different things (an earlier plan's review found exactly that).
 *
 * It reads `basis.energy` and `basis.expenditure` TOGETHER: they are independent. `energy` is what produced the resting rate
 * (still the equation when a reported burn replaced the activity factor); `expenditure` is what replaced the factor. A figure
 * the person typed is theirs and carries no source.
 *
 * Every case that rests on an expenditure figure also states that the targets depend on that figure being right, which
 * design section 8.1 requires in plain words. A figure the person typed as the energy target is not an expenditure figure
 * and is not second-guessed back at them.
 */

/** Section 8.1's required sentence, said once, straight after the source is named. */
const ASSUMES_FIGURE = 'These targets assume that figure is right.';

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
    return `Energy: resting energy for a general adult from the Mifflin-St Jeor equation, multiplied by a light activity factor of ${ACTIVITY_FACTORS.light} (this app's own working figure, not your activity level). ${ASSUMES_FIGURE}`;
  }
  const resting =
    basis.energy === 'katch-mcardle'
      ? 'the Katch-McArdle equation, using your body-fat percentage'
      : 'the Mifflin-St Jeor equation';
  if (basis.expenditure === 'reported') {
    const over = reportedDays === undefined ? 'the days you reported' : `${reportedDays} of the last ${WINDOW_DAYS} days, ending yesterday`;
    return `Energy: your own reported energy burn, averaged over ${over}, used in place of an activity level. Resting energy still comes from ${resting}. ${ASSUMES_FIGURE}`;
  }
  const factor =
    activityLevel !== undefined && Object.hasOwn(ACTIVITY_FACTORS, activityLevel)
      ? ` (${LEVEL_WORDS[activityLevel]}, a factor of ${ACTIVITY_FACTORS[activityLevel]}, this app's own working figure)`
      : '';
  // The feature's own gate, said out loud. Days are collected for three days before anything changes, and a figure typed
  // for today is not counted at all, so without this clause a person who fills the form in dutifully sees nothing happen
  // and concludes it is broken. At or above the minimum the basis is 'reported', so this is only ever reached below it;
  // at zero days there is nothing to report and no promise outstanding.
  const collecting =
    reportedDays !== undefined && reportedDays > 0 && reportedDays < MIN_LOGGED_DAYS
      ? ` Your own reported energy burn replaces the activity level once ${MIN_LOGGED_DAYS} of the last ${WINDOW_DAYS} days, ending yesterday, carry a figure; ${reportedDays} ${reportedDays === 1 ? 'does' : 'do'} so far.`
      : '';
  return `Energy: resting energy from ${resting}, multiplied by your activity level${factor}. ${ASSUMES_FIGURE}${collecting}`;
}

/**
 * WHICH energy the four share-derived limits were worked out from, when the person typed their own energy figure and
 * nothing else on the screen accounts for them.
 *
 * `computeTargets` overlays only the keys the person typed, so with `overrides.energyKcal` set the saturated fat, added
 * sugars, trans fat and fibre limits keep the values `derive` computed. The energy sentence above says the energy figure
 * is the person's own, so without this the four limits have no source at all (invariant 2).
 *
 * It says which energy and stops. It does NOT describe how that energy was reached: under a rate goal the figure is
 * goal-adjusted, so "a resting energy multiplied by an activity factor" pointed at a number the limits are not shares of
 * (2,413 where they were shares of 1,863), and it contradicted `ProfileSettings`, which says "shares of the energy your
 * goal set" for the same state. The activity factor is still named, as a working figure, by the sentence that follows
 * this one in the note. It also does NOT call the limits a share of the DISPLAYED energy target, because they are not:
 * they are a share of the figure the person's own replaced. That mismatch is pre-existing, changes nutrition targets,
 * and is recorded for its own decision rather than settled in a wording pass.
 *
 * Still withheld when `expenditure` is 'reported', although the sentence no longer describes a factor. There the energy
 * behind the limits is the mean of burn figures the PERSON reported, so "the energy the app calculated rather than from
 * your own figure" would deny them a figure that is theirs, and would contradict the energy sentence's own "your own
 * reported energy burn". The contrast this clause draws only holds where the app, and not the person, supplied the
 * expenditure figure. That path's limits are reported separately and are parked with the mismatch above.
 */
export function sharedLimitsSourceClause(basis: Targets['basis']): string | undefined {
  if (basis.energy !== 'custom' || basis.expenditure !== 'formula') return undefined;
  return 'The saturated fat, added sugars, trans fat and fibre limits were worked out from the energy the app calculated rather than from your own figure.';
}
