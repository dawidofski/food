import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything, getHealthDay, healthDaysBetween, putHealthDay } from '@/data/db';
import { REPORTED_BURN_CEILING_KCAL, reportedExpenditure } from '@/domain/expenditure';
import { computeTargets } from '@/domain/targets';
import Diary from '@/ui/screens/Diary';
import { last7DayKeys } from '@/domain/dayBoundary';
import DayHealthForm from '@/ui/components/DayHealthForm';
import { ownerProfile } from '../fixtures/profile';

const DAY = '2026-11-16';
const NOW = new Date('2026-11-17T12:00:00');
const rmr = computeTargets(ownerProfile, NOW).rmrKcal;

beforeEach(async () => { await eraseEverything(); });
afterEach(cleanup);

async function open(profile = ownerProfile as typeof ownerProfile | null) {
  render(<DayHealthForm dayKey={DAY} profile={profile} now={NOW} />);
  await screen.findByLabelText(/sleep score/i);
}
const sleep = () => screen.getByLabelText(/sleep score/i) as HTMLInputElement;
const steps = () => screen.getByLabelText(/^steps/i) as HTMLInputElement;
const burn = () => screen.getByLabelText(/energy burned/i) as HTMLInputElement;
const type = (el: HTMLInputElement, v: string) => fireEvent.change(el, { target: { value: v } });
const save = () => fireEvent.click(screen.getByRole('button', { name: /save/i }));

describe('daily health form', () => {
  test('each field is blank when the day has no figure, never 0', async () => {
    await open();
    expect(sleep().value).toBe('');
    expect(steps().value).toBe('');
    expect(burn().value).toBe('');
  });

  test('a day that has figures shows them, and the day shown decides which', async () => {
    await putHealthDay({ date: DAY, sleepScore: 82, steps: 9000, energyBurnedKcal: 2600 });
    await open();
    expect(sleep().value).toBe('82');
    expect(steps().value).toBe('9000');
    expect(burn().value).toBe('2600');
    cleanup();
    render(<DayHealthForm dayKey="2026-11-15" profile={ownerProfile} now={NOW} />);
    await screen.findByLabelText(/sleep score/i);
    expect(sleep().value).toBe('');
  });

  test('saving stores only the figures that were typed', async () => {
    await open();
    type(steps(), '8123');
    save();
    await waitFor(async () => expect(await getHealthDay(DAY)).toEqual({ date: DAY, steps: 8123 }));
    const row = (await getHealthDay(DAY))!;
    expect('sleepScore' in row).toBe(false);
    expect('energyBurnedKcal' in row).toBe(false);
  });

  test('clearing a figure removes it rather than storing a zero', async () => {
    await putHealthDay({ date: DAY, sleepScore: 70, steps: 5000 });
    await open();
    type(steps(), '');
    save();
    await waitFor(async () => expect(await getHealthDay(DAY)).toEqual({ date: DAY, sleepScore: 70 }));
  });

  test('clearing every figure removes the day', async () => {
    await putHealthDay({ date: DAY, steps: 5000 });
    await open();
    type(steps(), '');
    save();
    await waitFor(async () => expect(await getHealthDay(DAY)).toBeUndefined());
  });

  test('a half-typed number is refused and nothing is saved', async () => {
    await putHealthDay({ date: DAY, steps: 5000 });
    await open();
    // jsdom sanitises "1e" to '' like a browser; a browser also reports badInput, so stub that report.
    Object.defineProperty(steps(), 'validity', { configurable: true, get: () => ({ badInput: true }) });
    type(steps(), '1e');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a number yet/i);
    expect((await getHealthDay(DAY))?.steps).toBe(5000);
  });

  test('the badInput read is taken at save time, so a later empty field saves', async () => {
    await putHealthDay({ date: DAY, steps: 5000 });
    await open();
    let bad = true;
    Object.defineProperty(steps(), 'validity', { configurable: true, get: () => ({ badInput: bad }) });
    type(steps(), '');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a number yet/i);
    bad = false; // the field is visibly empty again; React fires no change event
    save();
    await waitFor(async () => expect(await getHealthDay(DAY)).toBeUndefined());
  });

  // Review Focus 2.
  test('a burn figure below the resting rate is flagged, and can still be confirmed', async () => {
    await open();
    type(burn(), '600');
    save();
    const note = await screen.findByTestId('burn-below-resting');
    expect(note).toHaveTextContent(/active/i);
    expect(note).toHaveTextContent(/whole day/i);
    expect(note).toHaveTextContent(rmr.toLocaleString('en-US'));
    expect(await getHealthDay(DAY)).toBeUndefined(); // nothing saved until confirmed
    fireEvent.click(screen.getByRole('button', { name: /keep 600 kcal/i }));
    await waitFor(async () => expect((await getHealthDay(DAY))?.energyBurnedKcal).toBe(600));
  });

  test('a burn figure at or above the resting rate is saved without a flag', async () => {
    await open();
    type(burn(), String(rmr + 800));
    save();
    await waitFor(async () => expect((await getHealthDay(DAY))?.energyBurnedKcal).toBe(rmr + 800));
    expect(screen.queryByTestId('burn-below-resting')).toBeNull();
  });

  test('with no profile there is no resting rate, so a low figure is not flagged', async () => {
    await open(null);
    type(burn(), '600');
    save();
    await waitFor(async () => expect((await getHealthDay(DAY))?.energyBurnedKcal).toBe(600));
    expect(screen.queryByTestId('burn-below-resting')).toBeNull();
  });

  test('an implausibly high burn figure is flagged, and can still be confirmed', async () => {
    await open();
    type(burn(), '11000');
    save();
    const note = await screen.findByTestId('burn-implausibly-high');
    expect(note).toHaveTextContent(/11,000/);
    expect(await getHealthDay(DAY)).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: /keep 11,000 kcal/i }));
    await waitFor(async () => expect((await getHealthDay(DAY))?.energyBurnedKcal).toBe(11000));
  });

  test('changing the figure after a flag withdraws the flag', async () => {
    await open();
    type(burn(), '600');
    save();
    await screen.findByTestId('burn-below-resting');
    type(burn(), String(rmr + 500));
    expect(screen.queryByTestId('burn-below-resting')).toBeNull();
  });

  // Review Focus 3.
  test('a sleep score of 101 is refused at the form with a message', async () => {
    await open();
    type(sleep(), '101');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent(/sleep score.*0 and 100/i);
    expect(await getHealthDay(DAY)).toBeUndefined();
  });

  test('the steps field says it is not added to any calculation', async () => {
    await open();
    const note = screen.getByTestId('steps-note');
    expect(note).toHaveTextContent(/not added to any calculation/i);
    expect(steps().getAttribute('aria-describedby')).toContain(note.id);
  });

  test('the energy field says whole day, not active, and which figure to copy', async () => {
    await open();
    expect(burn().labels?.[0]?.textContent).toMatch(/whole day/i);
    expect(burn().labels?.[0]?.textContent).toMatch(/not active/i);
    const note = screen.getByTestId('burn-note');
    expect(note).toHaveTextContent(/total/i);
    expect(burn().getAttribute('aria-describedby')).toContain(note.id);
  });

  test('the section says once that every figure is the person\'s own', async () => {
    await open();
    expect(screen.getAllByText(/you entered these figures yourself/i)).toHaveLength(1);
  });
});

describe('on the Diary', () => {
  test('moving back a day shows that day\'s figures', async () => {
    const keys = last7DayKeys(new Date());
    const today = keys[6]!;
    const yesterday = keys[5]!;
    const [y, m, d] = yesterday.split("-").map(Number);
    const yesterdayLabel = new Date(y!, m! - 1, d!).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
    await putHealthDay({ date: today, steps: 111 });
    await putHealthDay({ date: yesterday, steps: 222 });
    render(<Diary />);
    await waitFor(() => expect(steps().value).toBe('111'));
    const nav = screen.getByRole('navigation', { name: 'Days' });
    fireEvent.click(within(nav).getByRole('button', { name: new RegExp(`^${yesterdayLabel}`) }));
    await waitFor(() => expect(steps().value).toBe('222'));
  });
});

describe('what the burn field and its flags say', () => {
  test('the burn note names the profile\'s own resting rate and no fixed figure', async () => {
    await open();
    const text = screen.getByTestId('burn-note').textContent ?? '';
    expect(text).toContain(`about ${rmr.toLocaleString('en-US')} kcal too low`);
    expect(text).toMatch(/about 1,\d{3} kcal too low/); // a thousands separator, like every other figure in the app
    expect(text).not.toContain('1,800');
  });

  test('with no profile the burn note gives no number', async () => {
    await open(null);
    const text = screen.getByTestId('burn-note').textContent ?? '';
    expect(text).toMatch(/roughly a resting metabolism/);
    expect(text).not.toMatch(/\d/);
  });

  test('exactly 10000 kcal is not flagged', async () => {
    await open();
    type(burn(), '10000');
    save();
    await waitFor(async () => expect((await getHealthDay(DAY))?.energyBurnedKcal).toBe(10000));
    expect(screen.queryByTestId('burn-implausibly-high')).toBeNull();
  });

  test('10001 kcal is flagged and not yet saved', async () => {
    await open();
    type(burn(), '10001');
    save();
    await screen.findByTestId('burn-implausibly-high');
    expect(await getHealthDay(DAY)).toBeUndefined();
  });

  test('the flag says the 10,000 kcal mark is the app\'s own figure, not a published one', async () => {
    await open();
    type(burn(), '11000');
    save();
    const note = await screen.findByTestId('burn-implausibly-high');
    expect(note).toHaveTextContent(/10,000 kcal for one day, which is far above a usual day \(that mark is this app.s own working figure, not a published one\)/);
  });
});

// Finding 6: the form invited the person to keep a figure the domain would then drop from every average.
describe('a figure the app would never use is refused, not offered to keep', () => {
  test(`above ${REPORTED_BURN_CEILING_KCAL} kcal the form refuses and offers no way to keep it`, async () => {
    await open();
    type(burn(), String(REPORTED_BURN_CEILING_KCAL + 1));
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent(/20,000 kcal or less.*left out of your energy average/);
    expect(await getHealthDay(DAY)).toBeUndefined();
    expect(screen.queryByRole('button', { name: /^keep /i })).toBeNull();
    expect(screen.queryByTestId('burn-implausibly-high')).toBeNull();
  });

  test('a figure exactly at the ceiling is only flagged, and keeping it still works', async () => {
    await open();
    type(burn(), String(REPORTED_BURN_CEILING_KCAL));
    save();
    await screen.findByTestId('burn-implausibly-high');
    fireEvent.click(screen.getByRole('button', { name: /^keep /i }));
    await waitFor(async () => expect((await getHealthDay(DAY))?.energyBurnedKcal).toBe(REPORTED_BURN_CEILING_KCAL));
  });

  test('a flagged figure the person keeps reaches the mean the energy target is built from', async () => {
    for (const d of ['2026-11-13', '2026-11-14', '2026-11-15']) await putHealthDay({ date: d, energyBurnedKcal: 2600 });
    await open();
    type(burn(), '11000'); // over the flag, under the ceiling: flagged, never refused
    save();
    await screen.findByTestId('burn-implausibly-high');
    fireEvent.click(screen.getByRole('button', { name: /keep 11,000 kcal/i }));
    await waitFor(async () => expect((await getHealthDay(DAY))?.energyBurnedKcal).toBe(11000));
    const window = await healthDaysBetween('2026-11-10', DAY);
    expect(reportedExpenditure(window, NOW)).toBe(Math.round((2600 * 3 + 11000) / 4)); // 4700: the kept figure is in it
  });

  test('the flag is announced and takes the focus the vanished submit button had', async () => {
    await open();
    type(burn(), '11000');
    save();
    const note = await screen.findByTestId('burn-implausibly-high');
    expect(note).toHaveAttribute('role', 'alert');
    expect(document.activeElement).toBe(note);
  });

  test('the below-resting flag is announced and focused the same way', async () => {
    await open();
    type(burn(), '600');
    save();
    const note = await screen.findByTestId('burn-below-resting');
    expect(note).toHaveAttribute('role', 'alert');
    expect(document.activeElement).toBe(note);
  });
});
