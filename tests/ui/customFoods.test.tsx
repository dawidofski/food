import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, allCustomFoods, entriesBetween, eraseEverything, getProfile } from '@/data/db';
import { createCustomFood, refreshCustomFoods, withCustomFoods } from '@/domain/customFoods';
import type { FoodLookup } from '@/domain/foodLookup';
import { catalogue } from '@/rules/catalogue';
import type { FlowDeps } from '@/state/useEntryFlow';
import CoverageNote from '@/ui/components/CoverageNote';
import Log from '@/ui/screens/Log';
import MyFoods from '@/ui/screens/MyFoods';

const empty: FoodLookup = { search: () => [], get: () => undefined };
const deps: FlowDeps = {
  lookup: withCustomFoods(empty), rules: catalogue, now: () => new Date(),
  loadData: async () => { await refreshCustomFoods(); }, isDataReady: () => true,
  store: { addEntry, entriesBetween, getProfile },
};

beforeEach(async () => {
  await eraseEverything();
  await refreshCustomFoods();
});
afterEach(cleanup);

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

describe('custom foods in the UI', () => {
  test('custom foods are marked self-reported wherever they appear', async () => {
    await createCustomFood({ name: 'Frikandel', per100g: { energyKcal: 280 }, classification: { processedMeat: true } });
    render(<Log deps={deps} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'one frikandel' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^log$/i })); });
    // in the gate (processed meat raises a card)
    const gate = await screen.findByTestId('warning-gate');
    expect(within(gate).getByText(/self-reported/i)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /add anyway/i })); });
    // in the outcome and in the diary row
    const outcome = await screen.findByTestId('outcome');
    expect(within(outcome).getByText(/self-reported/i)).toBeInTheDocument();
    const recent = await screen.findByRole('region', { name: /recent entries/i });
    expect(within(recent).getByText(/self-reported/i)).toBeInTheDocument();
  });

  test('the My foods list marks each food self-reported', async () => {
    await createCustomFood({ name: 'Frikandel' });
    render(<MyFoods />);
    expect(await screen.findByText('Frikandel')).toBeInTheDocument();
    expect(screen.getByText(/self-reported/i)).toBeInTheDocument();
  });

  test('saving with every nutrient field blank stores no nutrient keys', async () => {
    render(<MyFoods />);
    fireEvent.click(await screen.findByRole('button', { name: /add a food/i }));
    fireEvent.change(field(/^name/i), { target: { value: 'Frikandel' } });
    fireEvent.click(screen.getByLabelText(/processed meat/i));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save food/i })); });
    await waitFor(async () => expect(await allCustomFoods()).toHaveLength(1));
    const stored = (await allCustomFoods())[0]!;
    expect(stored.nutrientsPer100g).toEqual({});
    expect(stored.classification.processedMeat).toBe(true);
    expect(stored.referencePortion).toEqual({ label: '1 serving', grams: 100 });
  });

  test('typed values are stored, a cleared field returns to unknown, and bad input blocks the save', async () => {
    render(<MyFoods />);
    fireEvent.click(await screen.findByRole('button', { name: /add a food/i }));
    fireEvent.change(field(/^name/i), { target: { value: 'Frikandel' } });
    fireEvent.change(field(/energy/i), { target: { value: '280' } });
    fireEvent.change(field(/^sodium/i), { target: { value: 'lots' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save food/i })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/sodium/i);
    expect(await allCustomFoods()).toHaveLength(0);
    fireEvent.change(field(/^sodium/i), { target: { value: '' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save food/i })); });
    await waitFor(async () => expect(await allCustomFoods()).toHaveLength(1));
    expect((await allCustomFoods())[0]!.nutrientsPer100g).toEqual({ energyKcal: 280 });
  });

  test('salt from the label converts to sodium only when typed', async () => {
    render(<MyFoods />);
    fireEvent.click(await screen.findByRole('button', { name: /add a food/i }));
    fireEvent.change(field(/^name/i), { target: { value: 'Frikandel' } });
    fireEvent.change(field(/^salt/i), { target: { value: '2,5' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save food/i })); });
    await waitFor(async () => expect(await allCustomFoods()).toHaveLength(1));
    expect((await allCustomFoods())[0]!.nutrientsPer100g.sodiumMg).toBeCloseTo(1000, 6);
  });

  test('"add as my own food" in the log opens the editor, and saving it makes the entry resolve', async () => {
    render(<Log deps={deps} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'one frikandel' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^log$/i })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /add .*own food/i })); });
    expect(field(/^name/i).value.toLowerCase()).toBe('frikandel');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save food/i })); });
    const outcome = await screen.findByTestId('outcome');
    expect(within(outcome).getByText(/frikandel/i)).toBeInTheDocument();
    expect(within(outcome).getByText(/self-reported/i)).toBeInTheDocument();
  });
});

describe('CoverageNote', () => {
  test('a daily total including an unknown value shows a floor and a coverage note', () => {
    render(<CoverageNote nutrient="addedSugarsG" coverage="partial" missingItems={2} />);
    expect(screen.getByText(/at least/i)).toBeInTheDocument();
    expect(screen.getByText(/2 items/i)).toBeInTheDocument();
  });
  test('with a value it reads as a floor with its figure, singular for one item', () => {
    render(<CoverageNote nutrient="addedSugarsG" coverage="partial" missingItems={1} value={48} />);
    expect(screen.getByText(/at least 48 g/i)).toBeInTheDocument();
    expect(screen.getByText(/1 item has no added sugars data/i)).toBeInTheDocument();
  });
  test('unknown says no data and gives no figure; known renders nothing', () => {
    const { container, rerender } = render(<CoverageNote nutrient="sodiumMg" coverage="unknown" value={0} />);
    expect(container.textContent).toMatch(/no sodium data/i);
    expect(container.textContent).not.toMatch(/\b0\b/);
    rerender(<CoverageNote nutrient="sodiumMg" coverage="known" value={10} />);
    expect(container).toBeEmptyDOMElement();
  });
  test('never prints NaN or Infinity', () => {
    const { container } = render(<CoverageNote nutrient="sodiumMg" coverage="partial" value={Number.NaN} missingItems={Infinity} />);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });
});
