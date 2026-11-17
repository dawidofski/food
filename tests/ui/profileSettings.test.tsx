import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything, getProfile, putProfile } from '@/data/db';
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

  test('without body data the goal is not offered, and says why', async () => {
    render(<ProfileSettings />);
    expect(await screen.findByText(/needs your body data/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
