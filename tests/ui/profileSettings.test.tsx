import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything, getProfile, putHealthDay, putProfile } from '@/data/db';
import { lastNDayKeys } from '@/domain/dayBoundary';
import { dailyKcalForRate, rateForDailyKcal } from '@/domain/goalConversion';
import ProfileSettings from '@/ui/screens/ProfileSettings';
import { ownerProfile } from '../fixtures/profile';

beforeEach(async () => {
  await eraseEverything();
});
afterEach(cleanup);

const click = async (name: RegExp | string) => {
  const b = await screen.findByRole('button', { name });
  await act(async () => {
    fireEvent.click(b);
  });
};
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const choose = (name: RegExp) => fireEvent.click(screen.getByRole('radio', { name }));
const open = async (p = ownerProfile) => {
  await putProfile(p);
  render(<ProfileSettings />);
  await screen.findByRole('heading', { name: /your goal/i });
};

describe('the conversion', () => {
  test('both directions come from one pair of functions and round-trip', () => {
    expect(dailyKcalForRate(0.5)).toBe(550);
    expect(rateForDailyKcal(700)).toBeCloseTo(0.636, 3);
    expect(dailyKcalForRate(rateForDailyKcal(550))).toBe(550);
  });
});

describe('weight goal', () => {
  test('choosing a rate shows the daily deficit it needs', async () => {
    await open();
    choose(/^lose/i);
    type(/rate \(kg a week\)/i, '0.5');
    expect(screen.getByText(/0\.5 kg a week needs a deficit of about 550 kcal a day/i)).toBeInTheDocument();
    expect(screen.queryByText(/is about 0\.5 kg a week/i)).toBeNull();
    expect((screen.getByLabelText(/daily deficit \(kcal\)/i) as HTMLInputElement).value).toBe('550');
    expect(screen.getByText(/7,700 kcal per kg/i)).toBeInTheDocument();
  });

  test('entering a daily deficit shows the rate it implies', async () => {
    await open();
    choose(/^lose/i);
    type(/daily deficit \(kcal\)/i, '700');
    expect((screen.getByLabelText(/rate \(kg a week\)/i) as HTMLInputElement).value).toBe('0.64');
    expect(screen.getByText(/deficit of 700 kcal a day is about 0\.64 kg a week/i)).toBeInTheDocument();
  });

  test('a gain goal is worded as a surplus', async () => {
    await open();
    choose(/^gain/i);
    type(/rate \(kg a week\)/i, '0.25');
    expect(screen.getByText(/surplus of about 275 kcal a day/i)).toBeInTheDocument();
  });

  test('saving stores the goal and the energy target moves', async () => {
    await open();
    choose(/^lose/i);
    type(/rate \(kg a week\)/i, '0.5');
    await click(/save goal/i);
    await waitFor(async () => expect((await getProfile())?.goal).toEqual({ kind: 'lose', rateKgPerWeek: 0.5 }));
    expect(await screen.findByText(/takes 550 kcal a day off/i)).toBeInTheDocument();
  });

  test('a goal with no rate says what moved and what did not', async () => {
    await open();
    choose(/^lose/i);
    await click(/save goal/i);
    await waitFor(async () => expect((await getProfile())?.goal).toEqual({ kind: 'lose' }));
    expect(await screen.findByText(/without a rate/i)).toHaveTextContent(/energy target stays at maintenance/i);
    expect(screen.getByText(/without a rate/i)).toHaveTextContent(/protein/i);
  });

  test('a body-fat percentage can be left blank and nothing breaks', async () => {
    await open();
    expect((screen.getByLabelText(/body fat/i) as HTMLInputElement).value).toBe('');
    choose(/^hold/i);
    await click(/save goal/i);
    await waitFor(async () => expect((await getProfile())?.goal).toEqual({ kind: 'hold' }));
    expect((await getProfile())?.bodyFatPct).toBeUndefined();
    expect(await screen.findByText(/mifflin/i)).toBeInTheDocument();
  });

  test('a body-fat percentage switches resting energy to Katch-McArdle, and an implausible one is refused', async () => {
    await open();
    type(/body fat/i, '95');
    await click(/save goal/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/between 3 and 60/i);
    expect((await getProfile())?.bodyFatPct).toBeUndefined();
    type(/body fat/i, '20');
    await click(/save goal/i);
    await waitFor(async () => expect((await getProfile())?.bodyFatPct).toBe(20));
    expect(await screen.findByText(/katch/i)).toBeInTheDocument();
  });

  test('a rate above the maximum is reduced, and the screen says so', async () => {
    await open();
    choose(/^gain/i);
    type(/rate \(kg a week\)/i, '2');
    await click(/save goal/i);
    expect(await screen.findByText(/could not give you the rate you asked for/i)).toHaveTextContent(/1 kg a week/i);
    expect(screen.getByText(/could not give you the rate you asked for/i)).toHaveTextContent(/app's own/i);
  });

  test('a deficit stopped by the resting rate says so', async () => {
    await open({ ...ownerProfile, weightLog: [{ date: '2026-01-01', kg: 50 }], activityLevel: 'sedentary' });
    choose(/^lose/i);
    type(/rate \(kg a week\)/i, '1');
    await click(/save goal/i);
    expect(await screen.findByText(/could not give you the rate you asked for/i)).toHaveTextContent(/resting/i);
  });

  test('the cap and the floor biting together name both limits, each as its own rule', async () => {
    await open({ ...ownerProfile, goal: { kind: 'lose', rateKgPerWeek: 5 } });
    const line = await screen.findByText(/could not give you the rate you asked for/i);
    expect(line.textContent).toMatch(/maximum is 1 kg a week \(its own choice, not a published figure\)/);
    expect(line.textContent).toMatch(/does not set a target below your resting energy of 1,755 kcal a day \(its own rule, not a published figure\)/);
    expect(line.textContent).toMatch(/Your energy target is 1,755 kcal a day\./);
    expect(line.textContent).not.toMatch(/ {2}/);
  });

  // Finding 8: every other figure in the app carries a thousands separator; these three did not.
  test('a four-figure offset is written with a thousands separator', async () => {
    await open({ ...ownerProfile, goal: { kind: 'gain', rateKgPerWeek: 1 } });
    const line = await screen.findByText(/adds .* kcal a day to your maintenance energy/);
    expect(line.textContent).toMatch(/adds 1,100 kcal a day/);
  });

  test('a capped target that lands exactly on the resting energy names only the maximum rate', async () => {
    // Active, 59 kg, 10 % body fat: the maximum rate lands exactly on the resting energy, so the floor did not apply.
    await open({
      ...ownerProfile, activityLevel: 'active', bodyFatPct: 10, weightLog: [{ date: '2026-01-01', kg: 59 }],
      goal: { kind: 'lose', rateKgPerWeek: 3 },
    });
    const line = await screen.findByText(/could not give you the rate you asked for/i);
    expect(line.textContent).toMatch(/maximum is 1 kg a week/);
    expect(line.textContent).not.toMatch(/resting energy|below/i);
    expect(line.textContent).not.toMatch(/ {2}/);
  });

  test('a floor-only cap names only the floor', async () => {
    await open({ ...ownerProfile, weightLog: [{ date: '2026-01-01', kg: 50 }], activityLevel: 'sedentary', goal: { kind: 'lose', rateKgPerWeek: 1 } });
    const line = await screen.findByText(/could not give you the rate you asked for/i);
    expect(line.textContent).toMatch(/does not set a target below your resting energy/);
    expect(line.textContent).not.toMatch(/maximum is/);
  });

  test('lose with no rate on a sedentary profile does not claim protein moved', async () => {
    await open({ ...ownerProfile, activityLevel: 'sedentary', goal: { kind: 'lose' } });
    const line = await screen.findByText(/without a rate/i);
    expect(line.textContent).toMatch(/energy target stays at maintenance/);
    expect(line.textContent).not.toMatch(/raises your protein/);
  });

  test('hold says energy stays at maintenance', async () => {
    await open({ ...ownerProfile, goal: { kind: 'hold' } });
    expect(await screen.findByText('Your goal is to hold, so your energy target stays at maintenance.')).toBeInTheDocument();
  });

  test('a stored out-of-range body-fat value is described truthfully and not used', async () => {
    await open({ ...ownerProfile, bodyFatPct: 95 });
    await screen.findByText(/^Energy:/);
    expect(document.body.textContent).not.toMatch(/NaN/);
    expect(screen.getByText(/\(95 %\) is outside 3 to 60 %/)).toBeInTheDocument();
  });

  test("a manual override wins and is labelled as the person's own figure", async () => {
    await open({ ...ownerProfile, goal: { kind: 'lose', rateKgPerWeek: 0.5 }, overrides: { energyKcal: 2000, proteinG: 120 } });
    const energy = await screen.findByText(/^Energy:/);
    expect(energy).toHaveTextContent(/your own figure/i);
    expect(energy).not.toHaveTextContent(/mifflin|katch|who|efsa/i);
    const protein = screen.getByText(/^Protein:/);
    expect(protein).toHaveTextContent(/your own figure/i);
    expect(protein).not.toHaveTextContent(/efsa|issn/i);
    expect(screen.queryByText(/off your maintenance|without a rate/i)).toBeNull();
  });

  test('sources are named beside calculated figures', async () => {
    await open();
    expect(await screen.findByText(/^Protein:/)).toHaveTextContent(/ISSN/);
    expect(screen.getByText(/^Energy:/)).toHaveTextContent(/Mifflin/);
  });

  test('a goal with a rate says which limits move with energy and which do not', async () => {
    await open({ ...ownerProfile, goal: { kind: 'lose', rateKgPerWeek: 0.5 } });
    const line = await screen.findByText(/shares of your energy target/i);
    expect(line.textContent).toMatch(/saturated fat, added sugars, trans fat and fibre/i);
    expect(line.textContent).toMatch(/move when your goal changes it/i);
    expect(line.textContent).toMatch(/sodium and the micronutrient reference amounts are fixed amounts and do not move/i);
  });

  test('a rate with a typed energy figure still explains the moved limits, in its own words', async () => {
    await open({ ...ownerProfile, goal: { kind: 'lose', rateKgPerWeek: 0.5 }, overrides: { energyKcal: 2000 } });
    const line = await screen.findByText(/worked out as shares of the energy your goal set/i);
    expect(line.textContent).toMatch(/your goal has already moved them/i);
    expect(line.textContent).toMatch(/your own energy figure replaces your energy target but not those limits/i);
    expect(line.textContent).toMatch(/sodium and the micronutrient reference amounts are fixed amounts and do not move/i);
    expect(screen.queryByText(/move when your goal changes it/i)).toBeNull();
    expect(line.textContent).not.toMatch(/your own figures, not worked out/i);
  });

  test("typed saturated-fat and added-sugar figures are named as the person's own", async () => {
    await open({ ...ownerProfile, goal: { kind: 'lose', rateKgPerWeek: 0.5 }, overrides: { satFatG: 20, addedSugarsG: 30 } });
    const line = await screen.findByText(/shares of your energy target/i);
    expect(line.textContent).toMatch(/Your own figures, not worked out by the app: saturated fat, added sugars\./);
    expect(line.textContent).not.toMatch(/trans fat\.$|fibre\.$/);
  });

  test('no typed share figure, no "own figures" note', async () => {
    await open({ ...ownerProfile, goal: { kind: 'lose', rateKgPerWeek: 0.5 } });
    const line = await screen.findByText(/shares of your energy target/i);
    expect(line.textContent).not.toMatch(/your own figures/i);
  });

  test('on the general path a hold goal is not told it "cannot move" anything', async () => {
    await open({ ...ownerProfile, weightLog: [], goal: { kind: 'hold' } });
    const heading = await screen.findByRole('heading', { name: /where your targets come from/i });
    const box = heading.parentElement as HTMLElement;
    expect(box.textContent).toMatch(/Your goal is to hold, so it would not move your energy target either way\./);
    expect(box.textContent).not.toMatch(/cannot move/i);
  });

  test('no such sentence without a rate, because nothing moved', async () => {
    await open({ ...ownerProfile, goal: { kind: 'hold' } });
    await screen.findByText(/^Energy:/);
    expect(screen.queryByText(/shares of your energy target/i)).toBeNull();
  });

  test.each([
    ['an empty weight log', []],
    ['a zero weight', [{ date: '2026-01-01', kg: 0 }]],
    ['a negative weight', [{ date: '2026-01-01', kg: -5 }]],
  ])('with %s the figures are general, not attributed to the person, and no offset is claimed', async (_n, weightLog) => {
    await open({ ...ownerProfile, weightLog, goal: { kind: 'lose', rateKgPerWeek: 0.5 } });
    const heading = await screen.findByRole('heading', { name: /where your targets come from/i });
    const box = heading.parentElement as HTMLElement;
    expect(box.textContent).toMatch(/general adult guidelines, not figures worked out for you/i);
    expect(box.textContent).toMatch(/goal cannot move your energy target until a weight is logged/i);
    expect(box.textContent).toMatch(/Energy: resting energy for a general adult from the Mifflin-St Jeor equation, multiplied by a light activity factor of 1\.375 \(this app.s own working figure/);
    // Finding 10b: the personal sentence must not leak onto this path. "Mifflin" cannot tell the two apart, as both
    // name it, so the negative is on the clause only the personal sentence has.
    expect(box.textContent).not.toMatch(/multiplied by your activity level/);
    // Was a literal backspace byte, not \b, so this alternative could never match anything. Pre-existing; found here.
    expect(box.textContent).not.toMatch(/EFSA|ISSN|Katch|off your maintenance|\b0 kcal|shares of your energy/i);
  });

  test('a typed figure is still labelled as theirs when targets are general', async () => {
    await open({ ...ownerProfile, weightLog: [], overrides: { proteinG: 100 } });
    expect(await screen.findByText(/^Protein:/)).toHaveTextContent(/your own figure/i);
  });

  test('without body data the goal is not offered, and says why', async () => {
    render(<ProfileSettings />);
    expect(await screen.findByText(/needs your body data/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('where the energy figure came from', () => {
  /** Gives `count` of the last 7 days (ending yesterday, newest first) a whole-day burn. */
  async function seedBurn(kcal: number, count: number) {
    const t = new Date();
    const keys = lastNDayKeys(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1, 12), 7).reverse();
    for (const date of keys.slice(0, count)) await putHealthDay({ date, energyBurnedKcal: kcal });
  }

  test('with enough reported days, the screen says the figure is the person\'s own and over how many days', async () => {
    await seedBurn(3000, 5);
    await open();
    const line = await screen.findByText(/^Energy:/);
    expect(line).toHaveTextContent(/your own reported energy burn/i);
    expect(line).toHaveTextContent(/5 of the last 7 days/);
    // Both are true at once: the burn replaced the activity factor, the equation still produced the resting rate.
    expect(line).toHaveTextContent(/Mifflin-St Jeor/);
    expect(line).not.toHaveTextContent(/multiplied by your activity level/i);
  });

  test('without them, it still names the formula and the activity factor', async () => {
    await seedBurn(3000, 3); // one short of the minimum: the formula is used
    await open();
    const line = await screen.findByText(/^Energy:/);
    expect(line).toHaveTextContent(/Mifflin-St Jeor equation, multiplied by your activity level/i);
    expect(line).toHaveTextContent(/light, a factor of 1\.375/);
    expect(line).toHaveTextContent(/this app's own working figure/i);
    // The burn is not the figure yet. It is named only as the thing still being collected (see the gate tests below).
    expect(line).not.toHaveTextContent(/your own reported energy burn, averaged over/i);
  });

  test('a stored figure no day produces never becomes the energy figure or the sentence', async () => {
    await seedBurn(1e308, 7);
    await open();
    const line = await screen.findByText(/^Energy:/);
    expect(line).toHaveTextContent(/multiplied by your activity level/i);
    expect(line).not.toHaveTextContent(/reported/i); // not even counted towards the gate
  });

  // Finding 4, spec section 8.1: the sentence must also say the targets depend on the expenditure figure being right.
  test.each([
    ['a reported burn', 5, /your own reported energy burn/],
    ['the formula', 0, /multiplied by your activity level/],
  ])('with %s the sentence says the targets assume that figure is right', async (_n, count, names) => {
    if (count > 0) await seedBurn(3000, count);
    await open();
    const line = await screen.findByText(/^Energy:/);
    expect(line.textContent).toMatch(names);
    expect(line.textContent).toMatch(/These targets assume that figure is right\./);
  });

  test('the general-adult sentence says it too, because those targets rest on a figure as well', async () => {
    await open({ ...ownerProfile, weightLog: [] });
    const line = await screen.findByText(/^Energy:/);
    expect(line.textContent).toMatch(/These targets assume that figure is right\./);
  });

  test('a typed energy figure is not second-guessed back at the person', async () => {
    await open({ ...ownerProfile, overrides: { energyKcal: 2500 } });
    const line = await screen.findByText(/^Energy:/);
    expect(line.textContent).not.toMatch(/assume that figure is right/);
  });

  // Finding 5: the gate was invisible, so three days of dutiful typing looked like a broken feature.
  test.each([[1, '1 does so far'], [2, '2 do so far'], [3, '3 do so far']])(
    'with %i reported day(s) the sentence says how many of the needed days are present',
    async (count, tail) => {
      await seedBurn(3000, count);
      await open();
      const line = await screen.findByText(/^Energy:/);
      expect(line.textContent).toMatch(/multiplied by your activity level/);
      expect(line.textContent).toContain(`Your own reported energy burn replaces the activity level once 4 of the last 7 days, ending yesterday, carry a figure; ${tail}.`);
    },
  );

  test('with no reported day there is no such clause, because nothing has been collected', async () => {
    await open();
    const line = await screen.findByText(/^Energy:/);
    expect(line.textContent).not.toMatch(/replaces the activity level once/);
  });

  test('once the gate opens the clause is gone and the burn is the figure', async () => {
    await seedBurn(3000, 4);
    await open();
    const line = await screen.findByText(/^Energy:/);
    expect(line.textContent).toMatch(/averaged over 4 of the last 7 days/);
    expect(line.textContent).not.toMatch(/replaces the activity level once/);
  });

  test('a typed energy figure is described as the person\'s own, even with a reported burn', async () => {
    await seedBurn(3000, 5);
    await open({ ...ownerProfile, overrides: { energyKcal: 2500 } });
    const line = await screen.findByText(/^Energy:/);
    expect(line.textContent).toBe('Energy: your own figure, not calculated by the app.');
  });

  // Finding 3: the goal has had this line since Task 3; the reported burn, which is also read and then not used, had none.
  test('a typed energy figure says it replaces the reported burn too, not only the goal', async () => {
    await seedBurn(3000, 5);
    await open({ ...ownerProfile, overrides: { energyKcal: 2500 } });
    expect(await screen.findByText('Your own energy figure replaces your reported energy burn as the energy target.')).toBeInTheDocument();
  });

  test('with no reported burn no such line is shown, because there is nothing it replaced', async () => {
    await open({ ...ownerProfile, overrides: { energyKcal: 2500 } });
    await screen.findByText(/^Energy:/);
    expect(screen.queryByText(/replaces your reported energy burn/i)).toBeNull();
  });
});
