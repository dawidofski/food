import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { entriesBetween, eraseEverything } from '@/data/db';
import { localDayKey, localDayRange } from '@/domain/dayBoundary';
import type { FoodLookup } from '@/domain/foodLookup';
import type { AiDeps } from '@/ai/aiFallback';
import type { AiSuggestion } from '@/ai/deepseek';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import Log from '@/ui/screens/Log';
import Settings from '@/ui/screens/Settings';
import { clearApiKey, getApiKey, isAiEnabled, setAiSwitch, setApiKey } from '@/state/aiSettings';
import type { DatasetFood } from '@/types/food';
import type { ClassificationFlags } from '@/types/nutrients';

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
const food = (id: string, name: string, kcal: number, portions: { label: string; grams: number }[]): DatasetFood => ({
  id, name, synonyms: [], per100g: { energyKcal: kcal }, portions, classification: flags, allergens: [],
});
const sausage = food('s', 'Sausage, pork', 300, [{ label: '1 link', grams: 50 }]);
const apple = food('a', 'Apples, raw', 52, [{ label: '1 medium', grams: 180 }]);
const foods = [sausage, apple];
const lookup: FoodLookup = {
  search: (q) => foods.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).map((f) => ({ source: 'dataset' as const, food: f, score: 0.03 })),
  get: (_s, id) => foods.find((f) => f.id === id),
};

const aiOf = (suggestions: AiSuggestion[], over: Partial<AiDeps> = {}) => {
  const interpret = vi.fn(async (_t: string, _o: unknown) => suggestions);
  const ai: AiDeps = { isEnabled: () => true, getKey: () => 'test-key', isOnline: () => true, interpret, ...over };
  return { ai, interpret };
};
const depsWith = (ai: AiDeps | undefined): FlowDeps => ({
  ...defaultDeps, lookup, rules: [], loadData: async () => undefined, isDataReady: () => true, ...(ai ? { ai } : {}),
});

async function entriesToday() {
  const { fromISO, toISO } = localDayRange(localDayKey(new Date()));
  return entriesBetween(fromISO, toISO);
}
async function typeAndSubmit(text: string, deps: FlowDeps) {
  render(<Log deps={deps} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^log$/i })); });
}
const click = async (name: RegExp) => {
  const b = await screen.findByRole('button', { name });
  await act(async () => { fireEvent.click(b); });
};

beforeEach(async () => { await eraseEverything(); localStorage.clear(); });
afterEach(cleanup);

describe('the AI fallback in the add flow', () => {
  test('a phrase that does not resolve is shown as an AI reading and nothing is stored until it is confirmed', async () => {
    const { ai, interpret } = aiOf([{ description: 'deep-fried minced pork sausage', quantity: 2, unit: 'link' }]);
    await typeAndSubmit('two frikandel', depsWith(ai));
    expect(await screen.findByTestId('ai-review')).toBeInTheDocument();
    expect(screen.getByTestId('ai-review')).toHaveTextContent(/AI/);
    expect(screen.getByTestId('ai-review')).toHaveTextContent(/frikandel/);
    // The phrase, the model's description and the dataset food it landed on are all shown.
    expect(screen.getByTestId('ai-review')).toHaveTextContent(/deep-fried minced pork sausage/);
    expect(screen.getByTestId('ai-review')).toHaveTextContent(/Sausage, pork/);
    expect(interpret).toHaveBeenCalledTimes(1);
    // The model was sent only the unresolved phrase, never the whole entry's other parts.
    expect(interpret.mock.calls[0]![0]).toMatch(/frikandel/);
    expect(await entriesToday()).toHaveLength(0);

    await click(/use this reading/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    const [e] = await entriesToday();
    // 2 links x 50 g x 300 kcal/100 g: the number comes from the dataset row, not from the model.
    expect(e!.nutrients.energyKcal).toBeCloseTo(300, 5);
    expect(e!.items[0]!.foodId).toBe('s');
  });

  test('the model is never given a list of foods, and it cannot pick one', async () => {
    const { ai, interpret } = aiOf([{ description: 'deep-fried minced pork sausage', quantity: 1, unit: 'piece' }]);
    await typeAndSubmit('one frikandel', depsWith(ai));
    await screen.findByTestId('ai-review');
    expect(interpret.mock.calls[0]).toHaveLength(2); // (phrase, options): no candidate list
  });

  test('text that parses to nothing is still sent for help, and a reading is offered', async () => {
    const { ai, interpret } = aiOf([{ description: 'apple', quantity: 1, unit: 'piece' }]);
    await typeAndSubmit('2 tbsp', depsWith(ai));
    expect(await screen.findByTestId('ai-review')).toBeInTheDocument();
    expect(interpret.mock.calls[0]![0]).toBe('2 tbsp');
    expect(await entriesToday()).toHaveLength(0);
    await click(/use this reading/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    expect((await entriesToday())[0]!.items[0]!.foodId).toBe('a');
  });

  test('empty text is never sent', async () => {
    const { ai, interpret } = aiOf([]);
    await typeAndSubmit('   ', depsWith(ai));
    expect(interpret).not.toHaveBeenCalled();
  });

  test('only the unresolved phrase is sent, not the resolved part of the entry', async () => {
    const { ai, interpret } = aiOf([]);
    await typeAndSubmit('an apple and a frikandel', depsWith(ai));
    await screen.findByText(/don.t know/i);
    const sent = interpret.mock.calls[0]![0] as string;
    expect(sent).toMatch(/frikandel/);
    expect(sent).not.toMatch(/apple/i);
  });

  test('declining the reading falls back to manual entry and stores nothing', async () => {
    const { ai } = aiOf([{ description: 'deep-fried minced pork sausage', quantity: 1, unit: 'piece' }]);
    await typeAndSubmit('one frikandel', depsWith(ai));
    await click(/don.t use/i);
    expect(await screen.findByText(/don.t know/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add .*own food/i })).toBeInTheDocument();
    expect(await entriesToday()).toHaveLength(0);
  });

  test('a description the dataset has nothing for is dropped and the flow ends in manual entry', async () => {
    const { ai } = aiOf([{ description: 'plutonium', quantity: 1, unit: 'g' }]);
    await typeAndSubmit('one frikandel', depsWith(ai));
    expect(await screen.findByText(/don.t know/i)).toBeInTheDocument();
    expect(screen.queryByTestId('ai-review')).not.toBeInTheDocument();
  });

  test('an interpreter that throws does not block the flow', async () => {
    const { ai } = aiOf([], { interpret: async () => { throw new Error('boom'); } });
    await typeAndSubmit('one frikandel', depsWith(ai));
    expect(await screen.findByText(/don.t know/i)).toBeInTheDocument();
  });

  test.each([
    ['switched off', { isEnabled: () => false }],
    ['offline', { isOnline: () => false }],
    ['no key', { getKey: () => null }],
  ])('the model is not called when %s', async (_n, over) => {
    const { ai, interpret } = aiOf([{ description: 'deep-fried minced pork sausage', quantity: 1, unit: 'piece' }], over);
    await typeAndSubmit('one frikandel', depsWith(ai));
    expect(await screen.findByText(/don.t know/i)).toBeInTheDocument();
    expect(interpret).not.toHaveBeenCalled();
  });

  test('a fully resolved entry never contacts the model', async () => {
    const { ai, interpret } = aiOf([]);
    await typeAndSubmit('an apple', depsWith(ai));
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    expect(interpret).not.toHaveBeenCalled();
  });

  test('with no ai dependency at all the flow behaves as before', async () => {
    await typeAndSubmit('one frikandel', depsWith(undefined));
    expect(await screen.findByText(/don.t know/i)).toBeInTheDocument();
  });
});

describe('the settings screen', () => {
  test('states what is sent before the fallback can be enabled, and starts off', () => {
    render(<Settings />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/DeepSeek/);
    expect(text).toMatch(/third party|outside (your|this) (device|phone)/i);
    expect(text).toMatch(/only the phrase it could not match/i);
    expect(text).toMatch(/nothing you typed could be matched[\s\S]*whole line[\s\S]*200 characters/i);
    expect(text).not.toMatch(/list of food names/i);
    expect(text).toMatch(/diary.*profile.*targets.*totals.*never sent/i);
    expect(isAiEnabled()).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /use deepseek/i })).not.toBeInTheDocument();
  });

  test('saving a key stores it, switches the fallback on and shows only a masked key', async () => {
    render(<Settings />);
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'test-key-abcd1234' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save key and turn on/i })); });
    expect(getApiKey()).toBe('test-key-abcd1234');
    expect(isAiEnabled()).toBe(true);
    expect(document.body.textContent).toContain('1234');
    expect(document.body.textContent).not.toContain('abcd');
    expect((screen.queryByLabelText(/api key/i) as HTMLInputElement | null)?.value ?? '').not.toContain('test-key');
  });

  test('the switch turns it off while keeping the key, and clear key removes the key', async () => {
    setApiKey('test-key-abcd1234');
    setAiSwitch(true);
    render(<Settings />);
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /use deepseek/i })); });
    expect(isAiEnabled()).toBe(false);
    expect(getApiKey()).toBe('test-key-abcd1234');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /clear key/i })); });
    expect(getApiKey()).toBeNull();
    clearApiKey();
  });
});
