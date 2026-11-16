import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addEntry, allEntriesIncludingTombstones, allOffProducts, entriesBetween, eraseEverything, getProfile, putProfile } from '@/data/db';
import { findScannedProduct, refreshOffFoods, withOpenFoodFacts } from '@/data/offCache';
import type { FoodLookup } from '@/domain/foodLookup';
import { catalogue } from '@/rules/catalogue';
import type { FlowDeps } from '@/state/useEntryFlow';
import Log from '@/ui/screens/Log';
import type { ScanDeps } from '@/ui/screens/ScanBarcode';
import { coca_cola, lu_prince } from '../fixtures/off/payloads';

const COLA = '5449000054227';
const FETCHED = '2026-11-16T19:00:00.000Z';

const empty: FoodLookup = { search: () => [], get: () => undefined };
const deps: FlowDeps = {
  lookup: withOpenFoodFacts(empty),
  rules: catalogue,
  now: () => new Date('2026-11-16T19:05:00Z'),
  loadData: async () => { await refreshOffFoods(); },
  isDataReady: () => true,
  store: { addEntry, entriesBetween, getProfile },
};

function okFetch(payload: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }));
}

/**
 * No camera and no network anywhere in these tests. The lookup goes through the REAL cache so the stored product
 * is the one the entry flow reads back by its barcode, exactly as it is on a phone; only `fetch` is replaced.
 */
function scanDeps(find: ScanDeps['find']): ScanDeps {
  return {
    find,
    availability: () => ({ kind: 'no-api', reason: 'This browser has no built-in barcode reader.' }),
    openCamera: async () => ({ ok: false, reason: 'no camera in a test' }),
    getDetector: () => undefined,
    stopCamera: () => undefined,
  };
}

/** The whole path, with one stubbed HTTP reply. */
const viaFetch = (payload: unknown): ScanDeps['find'] =>
  (barcode, opts) =>
    findScannedProduct(barcode, { ...opts, deps: { fetchImpl: okFetch(payload) as unknown as typeof fetch, now: () => new Date(FETCHED) } });

const found = viaFetch(coca_cola);

const press = async (name: RegExp) => {
  const el = screen.getByRole('button', { name });
  await act(async () => { fireEvent.click(el); });
};

async function openScanner(find: ScanDeps['find'] = found) {
  render(<Log deps={deps} scan={scanDeps(find)} />);
  await press(/scan a barcode/i);
  return screen.getByTestId('scan-panel');
}

async function typeBarcode(code: string) {
  fireEvent.change(screen.getByLabelText(/barcode digits/i), { target: { value: code } });
  await press(/look it up/i);
}

beforeEach(async () => {
  await eraseEverything();
  await refreshOffFoods();
});
afterEach(cleanup);

describe('scanning a barcode', () => {
  test('where the browser has no barcode reader, it says so and offers the digits instead', async () => {
    const panel = await openScanner();
    expect(within(panel).getByText(/no built-in barcode reader/i)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/barcode digits/i)).toBeInTheDocument();
    // never a button that does nothing
    expect(within(panel).queryByRole('button', { name: /start the camera/i })).not.toBeInTheDocument();
  });

  test('a barcode that cannot be right is refused before anything is looked up', async () => {
    const find = vi.fn(found);
    await openScanner(find);
    await typeBarcode('5449000054228');
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not check out/i);
    expect(find).not.toHaveBeenCalled();
  });

  test('a product is proposed for review and nothing is logged by itself', async () => {
    await openScanner();
    await typeBarcode(COLA);
    const review = await screen.findByTestId('scan-review');
    expect(within(review).getByText('Coca-Cola Original Taste')).toBeInTheDocument();
    expect(within(review).getByText('Coca-Cola')).toBeInTheDocument();
    // the figures it found
    expect(review).toHaveTextContent(/42/);
    expect(review).toHaveTextContent(/10\.6/);
    // and nothing stored
    expect(await allEntriesIncludingTombstones()).toEqual([]);
  });

  test('the review says what the app could not find out, added sugar first among them', async () => {
    await openScanner();
    await typeBarcode(COLA);
    const gaps = await screen.findByTestId('scan-gaps');
    expect(gaps).toHaveTextContent(/added sugar/i);
    expect(gaps).toHaveTextContent(/vitamins, minerals and trans fat/i);
    expect(gaps).toHaveTextContent(/red or processed meat/i);
    expect(gaps).toHaveTextContent(/allergen/i);
    expect(gaps).not.toHaveTextContent(/allergen-free/i);
  });

  test('it names Open Food Facts, the licence, and both dates', async () => {
    await openScanner();
    await typeBarcode(COLA);
    const review = await screen.findByTestId('scan-review');
    expect(review).toHaveTextContent(/Open Food Facts/);
    expect(review).toHaveTextContent(/Open Database Licen[cs]e|ODbL/i);
    // last edited (from last_modified_t) and fetched
    expect(review).toHaveTextContent(/16 Nov 2026/);
    expect(within(review).getByTestId('scan-dates')).toHaveTextContent(/edited/i);
    expect(within(review).getByTestId('scan-dates')).toHaveTextContent(/looked up|fetched/i);
  });

  test('confirming goes through the usual warning gate, and only then is it stored', async () => {
    await openScanner();
    await typeBarcode(COLA);
    await screen.findByTestId('scan-review');
    await press(/check (this|it) and log/i);

    // a cola is a sugar-sweetened drink, which is a card
    const gate = await screen.findByTestId('warning-gate');
    expect(gate).toHaveTextContent(/sugar-sweetened drink/i);
    expect(await allEntriesIncludingTombstones()).toEqual([]);

    await press(/add anyway/i);
    await waitFor(async () => expect(await allEntriesIncludingTombstones()).toHaveLength(1));
    const entry = (await allEntriesIncludingTombstones())[0]!;
    expect(entry.items[0]!.source).toBe('off');
    expect(entry.items[0]!.foodId).toBe(COLA);
    // the amount defaulted to the serving Open Food Facts lists, 250 ml
    expect(entry.items[0]!.grams).toBe(250);
    expect(entry.nutrients.sugarsG).toBeCloseTo(10.6 * 2.5, 6);
    // THE RULING: nothing imported added sugar, so the entry does not claim to know it.
    expect('addedSugarsG' in entry.nutrients).toBe(false);
    expect(entry.coverage.addedSugarsG).toBe('unknown');
  });

  test('the gate marks a scanned food as coming from Open Food Facts', async () => {
    await openScanner();
    await typeBarcode(COLA);
    await screen.findByTestId('scan-review');
    await press(/check (this|it) and log/i);
    const gate = await screen.findByTestId('warning-gate');
    expect(within(gate).getByTestId('off-sourced')).toBeInTheDocument();
  });

  test('a flagged allergen turns a scanned product into a reported check, never a silent all-clear', async () => {
    await putProfile({ flaggedAllergens: ['peanuts'], weightLog: [] } as never);
    await openScanner(viaFetch(lu_prince));
    await typeBarcode('7622210449283');
    await screen.findByTestId('scan-review');
    await press(/check (this|it) and log/i);
    const gate = await screen.findByTestId('warning-gate');
    const note = within(gate).getByTestId('check-note');
    expect(note).toHaveTextContent(/Open Food Facts/i);
    expect(note).not.toHaveTextContent(/allergen-free/i);
  });

  test('a barcode Open Food Facts does not hold says so and offers to enter it by hand', async () => {
    await openScanner(async () => ({ kind: 'not-found' }));
    await typeBarcode(COLA);
    expect(await screen.findByRole('alert')).toHaveTextContent(/not in open food facts|does not have/i);
    expect(screen.getByRole('button', { name: /enter the nutrition myself/i })).toBeInTheDocument();
  });

  test('a lookup with no connection says so plainly, and never spins for ever', async () => {
    await openScanner(async () => ({ kind: 'offline', reason: 'This device is offline, so Open Food Facts could not be asked.' }));
    await typeBarcode(COLA);
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);
    expect(screen.queryByText(/looking it up/i)).not.toBeInTheDocument();
  });

  test('a failed lookup says so and still offers manual entry', async () => {
    await openScanner(async () => ({ kind: 'failed', reason: 'Open Food Facts could not be reached.' }));
    await typeBarcode(COLA);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be reached/i);
    expect(screen.getByRole('button', { name: /enter the nutrition myself/i })).toBeInTheDocument();
  });

  test('cancelling the scan logs nothing and leaves the log screen as it was', async () => {
    await openScanner();
    await typeBarcode(COLA);
    await screen.findByTestId('scan-review');
    await press(/^cancel$/i);
    expect(screen.queryByTestId('scan-review')).not.toBeInTheDocument();
    expect(await allEntriesIncludingTombstones()).toEqual([]);
    // The product stays in the local cache, which is not the same thing as being logged: a cache spares Open Food
    // Facts a second request, while the diary gained nothing.
    expect(await allOffProducts()).toHaveLength(1);
  });

  test('the amount can be changed, and the entry uses it', async () => {
    await openScanner();
    await typeBarcode(COLA);
    await screen.findByTestId('scan-review');
    fireEvent.change(screen.getByLabelText(/how much/i), { target: { value: '500' } });
    await press(/check (this|it) and log/i);
    await screen.findByTestId('warning-gate');
    await press(/add anyway/i);
    await waitFor(async () => expect(await allEntriesIncludingTombstones()).toHaveLength(1));
    expect((await allEntriesIncludingTombstones())[0]!.items[0]!.grams).toBe(500);
  });

  test('an amount that is not a number is refused rather than logged as zero', async () => {
    await openScanner();
    await typeBarcode(COLA);
    await screen.findByTestId('scan-review');
    fireEvent.change(screen.getByLabelText(/how much/i), { target: { value: '0' } });
    await press(/check (this|it) and log/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/how much/i);
    expect(await allEntriesIncludingTombstones()).toEqual([]);
  });
});
