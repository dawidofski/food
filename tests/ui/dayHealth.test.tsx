import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything, getHealthDay, putHealthDay } from '@/data/db';
import { computeTargets } from '@/domain/targets';
import Diary from '@/ui/screens/Diary';
import { localDayKey } from '@/domain/dayBoundary';
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
    expect(note).toHaveTextContent(String(rmr));
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
    type(burn(), '25000');
    save();
    const note = await screen.findByTestId('burn-implausibly-high');
    expect(note).toHaveTextContent(/25000/);
    expect(await getHealthDay(DAY)).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: /keep 25000 kcal/i }));
    await waitFor(async () => expect((await getHealthDay(DAY))?.energyBurnedKcal).toBe(25000));
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
    expect(screen.getAllByText(/you typed these yourself/i)).toHaveLength(1);
  });
});

describe('on the Diary', () => {
  test('moving back a day shows that day\'s figures', async () => {
    const today = localDayKey(new Date());
    const yesterday = localDayKey(new Date(Date.now() - 86_400_000));
    await putHealthDay({ date: today, steps: 111 });
    await putHealthDay({ date: yesterday, steps: 222 });
    render(<Diary />);
    await waitFor(() => expect(steps().value).toBe('111'));
    const nav = screen.getByRole('navigation', { name: 'Days' });
    fireEvent.click(within(nav).getAllByRole('button')[5]!);
    await waitFor(() => expect(steps().value).toBe('222'));
  });
});
