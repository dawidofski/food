import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, eraseEverything, getProfile, putProfile } from '@/data/db';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags, NutrientSet } from '@/types/nutrients';
import type { Profile } from '@/types/profile';
import { computeTargets } from '@/domain/targets';
import WeightView from '@/ui/screens/WeightView';
import { ownerProfile } from '../fixtures/profile';

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

const dayKey = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

let seq = 0;
async function seedDay(daysAgo: number, kcal: number) {
  const at = new Date();
  at.setDate(at.getDate() - daysAgo);
  at.setHours(12, 0, 0, 0);
  const nutrients: NutrientSet = { energyKcal: kcal };
  const e: DiaryEntry = {
    id: `e${++seq}`,
    at: at.toISOString(),
    rawText: `meal ${seq}`,
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
    nutrients,
    coverage: { energyKcal: 'known' },
    classification: flags,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
  };
  await addEntry(e);
}

const withWeights = (rows: [number, number][]): Profile => ({
  ...ownerProfile,
  weightLog: rows.map(([daysAgo, kg]) => ({ date: dayKey(daysAgo), kg })),
});

beforeEach(async () => {
  await eraseEverything();
});
afterEach(cleanup);

const show = async () => {
  render(<WeightView />);
  // The form's label only renders once the profile has loaded, so this is the signal that the screen is
  // showing the person's own data rather than its empty first frame. Waiting on the direction text alone
  // would read whatever was on screen before the profile arrived.
  await screen.findByLabelText(/weight for/i);
};

describe('the weight view', () => {
  test('says why it cannot name a direction yet, rather than saying nothing', async () => {
    await putProfile(withWeights([[1, 80], [0, 79.6]]));
    await show();
    const said = screen.getByTestId('weight-direction').textContent ?? '';
    expect(said).toMatch(/weigh-ins/i);
    // It must not pretend to a direction from two readings a day apart.
    expect(said).not.toMatch(/losing|gaining|holding steady/i);
  });

  test('names the direction and the rate once there are enough weigh-ins', async () => {
    await putProfile(withWeights([[28, 80], [21, 79.75], [14, 79.5], [7, 79.25], [0, 79]]));
    await show();
    expect(screen.getByTestId('weight-direction').textContent).toMatch(/losing about 0\.2[45] kg a week/i);
  });

  test('says logging is patchy rather than averaging days it cannot see', async () => {
    await putProfile(withWeights([[28, 80], [14, 79.5], [0, 79]]));
    await seedDay(1, 2000);
    await seedDay(2, 2000);
    await show();
    await waitFor(() => expect(screen.getByTestId('balance-patchy')).toBeInTheDocument());
    expect(screen.getByTestId('balance-patchy').textContent).toMatch(/full record/i);
    expect(screen.queryByTestId('balance-known')).toBeNull();
  });

  test('prints the conversion it used and names where energy out came from', async () => {
    await putProfile(withWeights([[28, 80], [14, 79.5], [0, 79]]));
    for (let d = 0; d < 12; d++) await seedDay(d, 2000);
    await show();
    await waitFor(() => expect(screen.getByTestId('balance-known')).toBeInTheDocument());
    const text = screen.getByTestId('balance-known').textContent ?? '';
    expect(text).toMatch(/7,700 kcal per kg/);
    // Which of the three sources, not just "energy out".
    expect(text).toMatch(/resting-energy equation times an activity factor|reported energy burn|your own weight/i);
    expect(text).toMatch(/this app’s own working figure|reported|imply/i);
  });

  test('states the disagreement and says the scale governs the estimate', async () => {
    // Eating far under the target, while the scale barely moves: the two must not be reconciled silently.
    await putProfile(withWeights([[28, 80], [21, 79.95], [14, 79.9], [7, 79.95], [0, 79.9]]));
    for (let d = 0; d < 14; d++) await seedDay(d, 1200);
    await show();
    await waitFor(() => expect(screen.getByTestId('disagreement')).toBeInTheDocument());
    const text = screen.getByTestId('disagreement').textContent ?? '';
    expect(text).toMatch(/disagree/i);
    expect(text).toMatch(/logging is incomplete|too high/i);
    expect(text).toMatch(/follows the scale/i);
  });

  test('calls what contributed arithmetic about energy and claims no cause', async () => {
    await putProfile(withWeights([[28, 80], [14, 79.5], [0, 79]]));
    await seedDay(1, 900);
    await show();
    await waitFor(() => expect(screen.getByText(/what carried the most energy/i)).toBeInTheDocument());
    expect(screen.getByText(/no entry here is\s+said to have caused a change in your weight/i)).toBeInTheDocument();
  });

  test('still saves a weight, as the panel did on the old screen', async () => {
    await putProfile(withWeights([[14, 80]]));
    await show();
    fireEvent.change(screen.getByLabelText(/weight for/i), { target: { value: '79.4' } });
    fireEvent.click(screen.getByRole('button', { name: /save weight/i }));
    await waitFor(async () => {
      const p = await getProfile();
      expect(p?.weightLog.some((w) => w.kg === 79.4)).toBe(true);
    });
  });

  test('shows the logged weights and says nothing evaluative about them', async () => {
    // Moved here from the missing screen with the weight log. The app does not grade a body: no BMI, no
    // "ideal weight", no judgement of any kind.
    await putProfile(withWeights([[28, 101.5], [14, 100.9], [0, 100.2]]));
    const { container } = render(<WeightView />);
    await screen.findByLabelText(/weight for/i);
    expect(screen.getByRole('img', { name: /logged weights/i })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/bmi|overweight|underweight|obese|ideal weight|healthy weight/i);
  });

  test('a weight goal does not become the energy-out figure', async () => {
    // The defect this pins: passing targets.energyKcal (what to EAT, after the goal) as expenditure. Someone
    // eating exactly to a 1 kg/week goal would read "a surplus of about 0 kcal a day" when the honest answer
    // is a 1,100 kcal deficit — and the page would then blame their logging for the gap against the scale.
    // The shared fixture has no goal, which is exactly why nothing caught this.
    await putProfile({ ...withWeights([[28, 80], [14, 79.5], [0, 79]]), goal: { kind: 'lose', rateKgPerWeek: 1 } });
    const target = computeTargets(await getProfile(), new Date());
    for (let d = 0; d < 12; d++) await seedDay(d, target.energyKcal);
    await show();
    await waitFor(() => expect(screen.getByTestId('balance-known')).toBeInTheDocument());
    const text = screen.getByTestId('balance-known').textContent ?? '';
    // Eating to a loss goal is a deficit against what the body burns, never a balance of nothing.
    expect(text).toMatch(/deficit/i);
    expect(text).not.toMatch(/surplus/i);
    expect(text).not.toMatch(/about 0 kcal a day/i);
  });

  test('says nothing about a direction once the log has gone stale', async () => {
    // Weigh-ins from months ago, a month apart. Without a staleness gate the page reports them in the present
    // tense and projects twelve weeks forward from a date already in the past.
    await putProfile(withWeights([[230, 85], [215, 84], [200, 83]]));
    await show();
    const said = screen.getByTestId('weight-direction').textContent ?? '';
    expect(said).toMatch(/last weigh-in was \d+ days ago/i);
    expect(said).not.toMatch(/losing|gaining/i);
  });

  test('says which way each rate points when they are compared', async () => {
    // Two rates of the same size pointing opposite ways must never read as the same figure.
    await putProfile(withWeights([[28, 79], [21, 79.2], [14, 79.4], [7, 79.6], [0, 79.8]]));
    for (let d = 0; d < 14; d++) await seedDay(d, 1200);
    await show();
    await waitFor(() => expect(screen.getByTestId('disagreement')).toBeInTheDocument());
    const text = screen.getByTestId('disagreement').textContent ?? '';
    expect(text).toMatch(/up/);
    expect(text).toMatch(/down/);
    expect(text).toMatch(/disagree/i);
  });

  test('shows the weights themselves, not only a picture of them', async () => {
    await putProfile(withWeights([[28, 81.5], [14, 80.9], [0, 80.2]]));
    await show();
    const list = screen.getByTestId('weight-log');
    for (const kg of ['81.5 kg', '80.9 kg', '80.2 kg']) {
      expect(within(list).getByText(kg)).toBeInTheDocument();
    }
  });

  test('accepts a comma for the decimal point', async () => {
    // A Spanish-locale keyboard types 79,4. Refusing it as "not a number" would be false.
    await putProfile(withWeights([[14, 80]]));
    await show();
    fireEvent.change(screen.getByLabelText(/weight for/i), { target: { value: '79,4' } });
    fireEvent.click(screen.getByRole('button', { name: /save weight/i }));
    await waitFor(async () => {
      const p = await getProfile();
      expect(p?.weightLog.some((w) => w.kg === 79.4)).toBe(true);
    });
  });

  test('refuses an impossible weight and changes nothing', async () => {
    await putProfile(withWeights([[14, 80]]));
    await show();
    fireEvent.change(screen.getByLabelText(/weight for/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save weight/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const p = await getProfile();
    expect(p?.weightLog).toHaveLength(1);
  });
});
