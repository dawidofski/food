import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, entriesBetween, eraseEverything, getBatch, getProfile } from '@/data/db';
import { buildBatch, refreshBatches, saveBatch, withBatches } from '@/domain/batches';
import { refreshCustomFoods, withCustomFoods } from '@/domain/customFoods';
import type { FoodLookup } from '@/domain/foodLookup';
import { catalogue } from '@/rules/catalogue';
import type { FlowDeps } from '@/state/useEntryFlow';
import BatchBuilder from '@/ui/screens/BatchBuilder';
import Log from '@/ui/screens/Log';
import { fixtureLookup, pastaLines } from '../fixtures/batchFoods';

const deps: FlowDeps = {
  lookup: withBatches(withCustomFoods(fixtureLookup)), rules: catalogue, now: () => new Date(),
  loadData: async () => { await refreshCustomFoods(); await refreshBatches(); }, isDataReady: () => true,
  store: { addEntry, entriesBetween, getProfile },
};
const builderDeps = { lookup: withCustomFoods(fixtureLookup), loadData: async () => { await refreshCustomFoods(); } };
const base = { name: 'Chicken pasta', portionCount: 4, ingredientLines: [...pastaLines, '2 slices bacon'] };

beforeEach(async () => {
  await eraseEverything();
  await refreshBatches();
});
afterEach(cleanup);

async function logPortion() {
  render(<Log deps={deps} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a portion of chicken pasta' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^log$/i })); });
  const gate = await screen.findByTestId('warning-gate');
  return gate;
}

describe('no invented weight', () => {
  test('a batch with no cooked weight shows no gram figure in the gate, the outcome, or the diary row', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch(batch);
    const gate = await logPortion();
    const line = within(gate).getByTestId('resolved-line');
    expect(line).toHaveTextContent('1 portion of Chicken pasta');
    expect(line.textContent).not.toMatch(/\d\s*g\b/);
    expect(line.textContent).not.toMatch(/100/);
    await act(async () => { fireEvent.click(within(gate).getByRole('button', { name: /add anyway/i })); });
    const outcome = await screen.findByTestId('outcome');
    expect(within(outcome).getByTestId('resolved-line').textContent).not.toMatch(/\d\s*g\b/);
    const recent = await screen.findByRole('region', { name: /recent entries/i });
    expect(recent.textContent).not.toMatch(/\d\s*g\b/);
    expect(recent).toHaveTextContent(/from a batch/i);
  });

  test('with a cooked weight the real division is shown', async () => {
    const { batch } = buildBatch({ ...base, totalCookedGrams: 2000 }, fixtureLookup);
    await saveBatch(batch);
    const gate = await logPortion();
    expect(within(gate).getByTestId('resolved-line')).toHaveTextContent(/500 g/);
  });

  test('the fridge list shows grams only when a weight was given', async () => {
    const a = buildBatch({ ...base, totalCookedGrams: 2000 }, fixtureLookup).batch;
    await saveBatch(a);
    render(<BatchBuilder deps={builderDeps} />);
    expect(await screen.findByText(/about 500 g each/i)).toBeInTheDocument();
    cleanup();
    await eraseEverything();
    await saveBatch(buildBatch(base, fixtureLookup).batch);
    render(<BatchBuilder deps={builderDeps} />);
    await screen.findByTestId('portions-left');
    expect(screen.getByRole('list', { name: /fridge/i }).textContent).not.toMatch(/\d\s*g\b/);
  });
});

describe('origin marking', () => {
  test('a batch with a custom ingredient is marked self-reported at the gate; a plain one is not', async () => {
    const asCustom: FoodLookup = {
      search: (q, l) => fixtureLookup.search(q, l).map((h) => (h.food.id === 'f-chicken' ? { ...h, source: 'custom' as const } : h)),
      get: (_s, id) => fixtureLookup.get('dataset', id),
    };
    await saveBatch(buildBatch(base, asCustom).batch);
    const gate = await logPortion();
    expect(within(gate).getByText(/self-reported/i)).toBeInTheDocument();
    cleanup();
    await eraseEverything();
    await saveBatch(buildBatch(base, fixtureLookup).batch);
    const gate2 = await logPortion();
    expect(within(gate2).queryByText(/self-reported/i)).not.toBeInTheDocument();
    expect(within(gate2).getByText(/from a batch/i)).toBeInTheDocument();
  });
});

describe('deleting a batch', () => {
  test('asks first, says logged portions keep their numbers, then deletes', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch(batch);
    render(<BatchBuilder deps={builderDeps} />);
    fireEvent.click(await screen.findByRole('button', { name: /edit chicken pasta/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete this batch/i }));
    expect(screen.getByRole('group', { name: /confirm delete/i })).toHaveTextContent(/already logged keep their numbers/i);
    expect(await getBatch(batch.id)).toBeDefined();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /yes, delete it/i })); });
    await waitFor(async () => expect(await getBatch(batch.id)).toBeUndefined());
    expect(await screen.findByText(/nothing in the fridge/i)).toBeInTheDocument();
  });
});
