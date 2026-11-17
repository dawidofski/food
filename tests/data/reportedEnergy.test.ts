import { describe, expect, test } from 'vitest';
import { loadReportedEnergy } from '@/data/reportedEnergy';
import { computeTargets } from '@/domain/targets';
import type { HealthDay } from '@/types/health';
import { ownerProfile } from '../fixtures/profile';

// Local noon on 17 November 2026; the window is 10 to 16 November.
const ON = new Date(2026, 10, 17, 12);
const FOUR_DAYS: HealthDay[] = ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'].map((date) => ({ date, energyBurnedKcal: 2600 }));

/**
 * Finding 10d. The reader is injectable precisely so this branch can be exercised: it is the one that decides whether a
 * transient store failure quietly changes someone's energy basis. A rejection must read as UNKNOWN, not as a figure and
 * not as a thrown error that takes the screen down with it.
 */
describe('loadReportedEnergy when the health store cannot be read', () => {
  test('a rejecting reader gives no figure, and the targets stay on the formula', async () => {
    const reported = await loadReportedEnergy(ON, () => Promise.reject(new Error('store closed')));
    expect(reported).toBeUndefined();
    const t = computeTargets(ownerProfile, ON, reported?.kcal);
    expect(t.basis.expenditure).toBe('formula');
    expect(t.energyKcal).toBe(computeTargets(ownerProfile, ON).energyKcal);
  });

  test('the same reader resolving does give a figure, so the case above is the failure and not the setup', async () => {
    const reported = await loadReportedEnergy(ON, () => Promise.resolve(FOUR_DAYS));
    expect(reported).toEqual({ kcal: 2600, days: 4 });
    expect(computeTargets(ownerProfile, ON, reported?.kcal).basis.expenditure).toBe('reported');
  });
});
