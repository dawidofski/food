import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, entriesBetween, eraseEverything, getBatch, getProfile } from '@/data/db';
import { buildBatch, rebuildBatch, refreshBatches, saveBatch, withBatches } from '@/domain/batches';
import { applyCorrection } from '@/domain/corrections';
import { refreshCustomFoods, withCustomFoods } from '@/domain/customFoods';
import { dayTotals } from '@/domain/totals';
import { localDayKey } from '@/domain/dayBoundary';
import { catalogue } from '@/rules/catalogue';
import { useEntryFlow, type FlowDeps } from '@/state/useEntryFlow';
import { fixtureLookup, pastaLines } from '../fixtures/batchFoods';

/**
 * CHARACTERISATION TESTS. They describe what batches.ts:167 already claims, and they passed before any change was
 * made for the batch correction form: an entry snapshots its own nutrients at commit, so editing a batch cannot reach it.
 */
const deps: FlowDeps = {
  lookup: withBatches(withCustomFoods(fixtureLookup)), rules: catalogue, now: () => new Date(),
  loadData: async () => { await refreshCustomFoods(); await refreshBatches(); }, isDataReady: () => true,
  store: { addEntry, entriesBetween, getProfile },
};
const todays = () => entriesBetween(new Date(Date.now() - 864e5).toISOString(), new Date(Date.now() + 864e5).toISOString());

beforeEach(async () => {
  await eraseEverything();
  await refreshBatches();
});
afterEach(cleanup);

async function logOnePortion(): Promise<void> {
  const { result } = renderHook(() => useEntryFlow(deps));
  await act(async () => { await result.current.submit('a portion of chicken pasta'); });
  await waitFor(async () => expect(await todays()).toHaveLength(1));
}

describe('editing a batch never reaches the meals already eaten', () => {
  test('a rebuild and a hand correction leave a logged entry byte-identical and the day\'s totals where they were', async () => {
    const { batch } = buildBatch({ name: 'Chicken pasta', portionCount: 4, ingredientLines: pastaLines }, fixtureLookup);
    await saveBatch(batch);
    await logOnePortion();

    const entryBefore = structuredClone((await todays())[0]!);
    const totalsBefore = structuredClone(dayTotals(await todays(), localDayKey(new Date())));
    expect(entryBefore.nutrients.energyKcal).toBeCloseTo(batch.nutrientsPerPortion.energyKcal!, 6);

    // A rebuild with different figures, then a hand correction of the result, both saved.
    const stored = (await getBatch(batch.id))!;
    const { batch: eight } = rebuildBatch(stored, { portionCount: 8 }, fixtureLookup);
    await saveBatch(eight);
    const corrected = applyCorrection({ nutrients: eight.nutrientsPerPortion, coverage: eight.coverage }, { energyKcal: 999, sodiumMg: null });
    await saveBatch({ ...eight, nutrientsPerPortion: corrected.nutrients, coverage: corrected.coverage });

    const after = (await getBatch(batch.id))!;
    expect(after.nutrientsPerPortion.energyKcal).toBe(999);
    expect(after.nutrientsPerPortion.sodiumMg).toBeUndefined();
    expect(after.nutrientsPerPortion.proteinG).toBe(eight.nutrientsPerPortion.proteinG);

    const entriesAfter = await todays();
    expect(entriesAfter).toHaveLength(1);
    expect(JSON.stringify(entriesAfter[0])).toBe(JSON.stringify(entryBefore));
    expect(dayTotals(entriesAfter, localDayKey(new Date()))).toEqual(totalsBefore);
  });
});
