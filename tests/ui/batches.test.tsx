import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, allEntriesIncludingTombstones, entriesBetween, eraseEverything, getBatch, getProfile } from '@/data/db';
import { buildBatch, rebuildBatch, refreshBatches, saveBatch, withBatches } from '@/domain/batches';
import { refreshCustomFoods, withCustomFoods } from '@/domain/customFoods';
import { catalogue } from '@/rules/catalogue';
import type { FlowDeps } from '@/state/useEntryFlow';
import BatchBuilder from '@/ui/screens/BatchBuilder';
import EntryDetail from '@/ui/screens/EntryDetail';
import Log from '@/ui/screens/Log';
import { fixtureLookup, pastaLines } from '../fixtures/batchFoods';

const deps: FlowDeps = {
  lookup: withBatches(withCustomFoods(fixtureLookup)), rules: catalogue, now: () => new Date(),
  loadData: async () => { await refreshCustomFoods(); await refreshBatches(); }, isDataReady: () => true,
  store: { addEntry, entriesBetween, getProfile },
};
const builderDeps = { lookup: withCustomFoods(fixtureLookup), loadData: async () => { await refreshCustomFoods(); } };

const base = { name: 'Chicken pasta', portionCount: 4, ingredientLines: pastaLines };
const baconLines = [...pastaLines, '2 slices bacon'];
const todays = async () => entriesBetween(new Date(Date.now() - 864e5).toISOString(), new Date(Date.now() + 864e5).toISOString());

beforeEach(async () => {
  await eraseEverything();
  await refreshBatches();
});
afterEach(cleanup);

async function logPortion(text = 'a portion of chicken pasta') {
  render(<Log deps={deps} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^log$/i })); });
}

describe('logging a portion', () => {
  test('logging a portion decrements what is left and runs the gate', async () => {
    const { batch } = buildBatch({ ...base, ingredientLines: baconLines }, fixtureLookup);
    await saveBatch(batch);
    await logPortion();
    // The gate ran: the batch's processed-meat classification reached it.
    const gate = await screen.findByTestId('warning-gate');
    expect((await getBatch(batch.id))!.portionsRemaining).toBe(4); // nothing comes off before the person commits
    await act(async () => { fireEvent.click(within(gate).getByRole('button', { name: /add anyway/i })); });
    await waitFor(async () => expect((await getBatch(batch.id))!.portionsRemaining).toBe(3));
    const [entry] = await todays();
    expect(entry!.resolution).toBe('batch');
    expect(entry!.items[0]!.source).toBe('batch');
    expect(entry!.nutrients.energyKcal).toBeCloseTo(batch.nutrientsPerPortion.energyKcal!, 6);
  });

  test('correcting a logged portion\'s figures does not take a second portion off the counter', async () => {
    const { batch } = buildBatch({ ...base, ingredientLines: baconLines }, fixtureLookup);
    await saveBatch(batch);
    await logPortion();
    const gate = await screen.findByTestId('warning-gate');
    await act(async () => { fireEvent.click(within(gate).getByRole('button', { name: /add anyway/i })); });
    await waitFor(async () => expect((await getBatch(batch.id))!.portionsRemaining).toBe(3));
    const [logged] = await todays();
    cleanup();

    render(<EntryDetail entry={logged!} deps={deps} onClose={() => {}} onChanged={() => {}} />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /correct the figures/i })); });
    fireEvent.change(screen.getByLabelText(/^energy/i), { target: { value: '321' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save figures/i })); });
    const gate2 = await screen.findByTestId('warning-gate');
    await act(async () => { fireEvent.click(within(gate2).getByRole('button', { name: /add anyway/i })); });
    await waitFor(async () => expect((await allEntriesIncludingTombstones()).length).toBe(2));

    const all = await allEntriesIncludingTombstones();
    const active = all.filter((e) => e.state === 'active');
    expect(active).toHaveLength(1);
    expect(active[0]!.nutrients.energyKcal).toBe(321);
    expect(active[0]!.items[0]!.source).toBe('batch'); // the revision still points at the batch...
    expect((await getBatch(batch.id))!.portionsRemaining).toBe(3); // ...but costs it nothing
  });

  test('cancelling at the gate leaves the counter alone', async () => {
    const { batch } = buildBatch({ ...base, ingredientLines: baconLines }, fixtureLookup);
    await saveBatch(batch);
    await logPortion();
    const gate = await screen.findByTestId('warning-gate');
    await act(async () => { fireEvent.click(within(gate).getByRole('button', { name: /^cancel/i })); });
    expect((await getBatch(batch.id))!.portionsRemaining).toBe(4);
  });

  test('two portions take two off, and the counter floors at zero', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch({ ...batch, portionsRemaining: 1 });
    await logPortion('2 portions of chicken pasta');
    await waitFor(async () => expect((await getBatch(batch.id))!.portionsRemaining).toBe(0));
  });

  test('editing a batch does not alter nutrients of portions already logged', async () => {
    const { batch } = buildBatch({ ...base, ingredientLines: baconLines }, fixtureLookup);
    await saveBatch(batch);
    await logPortion();
    const gate = await screen.findByTestId('warning-gate');
    await act(async () => { fireEvent.click(within(gate).getByRole('button', { name: /add anyway/i })); });
    await waitFor(async () => expect(await todays()).toHaveLength(1));
    const before = structuredClone((await todays())[0]!);
    const stored = (await getBatch(batch.id))!;
    const { batch: eight } = rebuildBatch(stored, { portionCount: 8 }, fixtureLookup);
    await saveBatch(eight);
    expect(eight.nutrientsPerPortion.energyKcal).toBeCloseTo(batch.nutrientsPerPortion.energyKcal! / 2, 6);
    expect((await todays())[0]).toEqual(before);
  });
});

describe('the batch screen', () => {
  function fill(label: RegExp, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  const workOut = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /work out/i })); }); };

  test('builds a batch from free text, shows the per-portion figure, saves, and lists the fridge counter', async () => {
    render(<BatchBuilder deps={builderDeps} />);
    fireEvent.click(await screen.findByRole('button', { name: /cook a batch/i }));
    fill(/^name/i, 'Chicken pasta');
    fill(/^ingredients/i, '500 g penne, 400 g passata, 300 g chicken breast, 2 tbsp olive oil');
    fill(/portions it makes/i, '4');
    await workOut();
    expect(await screen.findByTestId('per-portion')).toHaveTextContent(/413 kcal/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save batch/i })); });
    expect(await screen.findByTestId('portions-left')).toHaveTextContent('4 of 4 portions left');
  });

  test('says plainly that a weighed pasta was read as cooked weight and dry would be about twice the energy', async () => {
    render(<BatchBuilder deps={builderDeps} />);
    fireEvent.click(await screen.findByRole('button', { name: /cook a batch/i }));
    fill(/^name/i, 'Chicken pasta');
    fill(/^ingredients/i, '500 g penne\n300 g chicken breast');
    await workOut();
    const note = await screen.findByTestId('cooked-weight-note');
    expect(note).toHaveTextContent(/500 g penne/);
    expect(note).toHaveTextContent(/cooked/i);
    expect(note).toHaveTextContent(/dry/i);
    expect(note).toHaveTextContent(/twice/i);
  });

  test('an unresolved ingredient is named, and saving needs the explicit "save anyway"', async () => {
    render(<BatchBuilder deps={builderDeps} />);
    fireEvent.click(await screen.findByRole('button', { name: /cook a batch/i }));
    fill(/^name/i, 'Snack');
    fill(/^ingredients/i, '300 g chicken breast, 300 g frikandel');
    await workOut();
    const alert = await screen.findByTestId('unresolved');
    expect(alert).toHaveTextContent(/300 g frikandel/);
    expect(screen.queryByRole('button', { name: /^save batch$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save anyway/i })).toBeInTheDocument();
  });

  test('when nothing resolves there is nothing to save', async () => {
    render(<BatchBuilder deps={builderDeps} />);
    fireEvent.click(await screen.findByRole('button', { name: /cook a batch/i }));
    fill(/^name/i, 'Mystery');
    fill(/^ingredients/i, '300 g frikandel');
    await workOut();
    expect(await screen.findByText(/nothing could be found/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  test('"cooked again" resets the counter', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch({ ...batch, portionsRemaining: 0 });
    render(<BatchBuilder deps={builderDeps} />);
    expect(await screen.findByTestId('portions-left')).toHaveTextContent('0 of 4');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /cooked chicken pasta again/i })); });
    await waitFor(() => expect(screen.getByTestId('portions-left')).toHaveTextContent('4 of 4'));
  });

  test('editing the portion count re-divides', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch(batch);
    render(<BatchBuilder deps={builderDeps} />);
    fireEvent.click(await screen.findByRole('button', { name: /edit chicken pasta/i }));
    fill(/portions it makes/i, '8');
    await workOut();
    expect(await screen.findByTestId('per-portion')).toHaveTextContent(/207 kcal/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save batch/i })); });
    await waitFor(async () => expect((await getBatch(batch.id))!.portionCount).toBe(8));
  });
});

describe('correcting a batch\'s figures by hand', () => {
  const open = async (name = 'chicken pasta') => {
    render(<BatchBuilder deps={builderDeps} />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`correct the figures of ${name}`, 'i') }));
  };
  const field = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement;
  const type = (name: RegExp, value: string) => fireEvent.change(field(name), { target: { value } });
  const save = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save figures/i })); }); };

  test('a batch\'s figures can be corrected by hand, and a blank field leaves the figure unknown', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch(batch);
    await open();
    expect(screen.getByText(/a blank field means the figure is unknown, not zero; emptying a field makes that figure unknown/i)).toBeInTheDocument();
    expect(field(/^energy/i).value).toBe(String(batch.nutrientsPerPortion.energyKcal));
    // A figure the batch never knew renders blank, not 0.
    expect(field(/^fibre/i).value).toBe('');
    expect(batch.nutrientsPerPortion.sodiumMg).toBeDefined(); // else the clear below proves nothing
    type(/^energy/i, '500');
    type(/^sodium/i, '');
    await save();
    await waitFor(async () => expect((await getBatch(batch.id))!.nutrientsPerPortion.energyKcal).toBe(500));
    const after = (await getBatch(batch.id))!;
    expect('sodiumMg' in after.nutrientsPerPortion).toBe(false); // cleared means unknown, never zero
    expect(after.coverage.sodiumMg).toBe('unknown');
    expect(after.nutrientsPerPortion.proteinG).toBe(batch.nutrientsPerPortion.proteinG); // untouched
    expect(after.portionsRemaining).toBe(batch.portionsRemaining);
    expect(after.name).toBe(batch.name);
  });

  test('a half-typed figure is refused, read from the DOM, and nothing is saved', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch(batch);
    await open();
    const f = field(/^energy/i);
    Object.defineProperty(f, 'validity', { value: { badInput: true }, configurable: true });
    f.value = '';
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent(/energy is not a number yet\. Nothing has been changed\./i);
    expect((await getBatch(batch.id))!.nutrientsPerPortion.energyKcal).toBe(batch.nutrientsPerPortion.energyKcal);
  });

  test('a portion logged after the edit uses the new figures', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch(batch);
    await open();
    type(/^energy/i, '500');
    await save();
    await waitFor(async () => expect((await getBatch(batch.id))!.nutrientsPerPortion.energyKcal).toBe(500));
    cleanup();
    await logPortion();
    await waitFor(async () => expect(await todays()).toHaveLength(1));
    expect((await todays())[0]!.nutrients.energyKcal).toBeCloseTo(500, 6);
  });

  test('a hand-corrected batch is marked self-reported, and a portion logged from it carries the badge', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    expect(batch.selfReported).toBeUndefined();
    await saveBatch(batch);
    await open();
    type(/^energy/i, '500');
    await save();
    await waitFor(async () => expect((await getBatch(batch.id))!.selfReported).toBe(true));
    cleanup();
    await logPortion();
    await waitFor(async () => expect(await todays()).toHaveLength(1));
    expect((await todays())[0]!.items[0]!.selfReported).toBe(true);
  });

  test('a typed 0 is a figure: it marks the batch self-reported and is stored as a known zero', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    expect(batch.nutrientsPerPortion.sodiumMg).toBeDefined();
    await saveBatch(batch);
    await open();
    type(/^sodium/i, '0');
    await save();
    await waitFor(async () => expect((await getBatch(batch.id))!.nutrientsPerPortion.sodiumMg).toBe(0));
    const after = (await getBatch(batch.id))!;
    expect(after.coverage.sodiumMg).toBe('known');
    expect(after.selfReported).toBe(true);
  });

  test('a partial figure is shown with a note saying it is a floor, and the field keeps the figure', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch({ ...batch, nutrientsPerPortion: { ...batch.nutrientsPerPortion, sodiumMg: 207.33333333333334 }, coverage: { ...batch.coverage, sodiumMg: 'partial' } });
    await open();
    expect(field(/^sodium/i).value).toBe('207.33');
    expect(document.getElementById('batch-fig-sodiumMg-partial')).toHaveTextContent('This is at least 207 mg so far; some items had no sodium data. It is a floor, not the full figure.');
    await save(); // untouched: the rounded display is not an edit
    expect((await getBatch(batch.id))!.nutrientsPerPortion.sodiumMg).toBe(207.33333333333334);
  });

  test('saving with nothing changed leaves the batch unmarked', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch(batch);
    await open();
    await save();
    expect((await getBatch(batch.id))!.selfReported).toBeUndefined();
  });

  test('rebuilding the ingredients works the figures out again, so typed figures and the mark go together', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    await saveBatch(batch);
    const typed = { ...batch, nutrientsPerPortion: { ...batch.nutrientsPerPortion, energyKcal: 999 }, selfReported: true };
    const { batch: rebuilt } = rebuildBatch(typed, { portionCount: 8 }, fixtureLookup);
    expect(rebuilt.nutrientsPerPortion.energyKcal).not.toBe(999);
    expect(rebuilt.selfReported).toBeUndefined();
  });

  test('a correction that only clears a figure leaves the batch unmarked, and the figure unknown', async () => {
    const { batch } = buildBatch(base, fixtureLookup);
    expect(batch.nutrientsPerPortion.sodiumMg).toBeDefined();
    await saveBatch(batch);
    await open();
    type(/^sodium/i, '');
    await save();
    await waitFor(async () => expect((await getBatch(batch.id))!.coverage.sodiumMg).toBe('unknown'));
    const after = (await getBatch(batch.id))!;
    expect('sodiumMg' in after.nutrientsPerPortion).toBe(false);
    expect(after.selfReported).toBeUndefined();
  });
});
