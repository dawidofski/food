import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags, NutrientKey } from '@/types/nutrients';
import EntryRow from '@/ui/components/EntryRow';

afterEach(cleanup);

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

function entry(correctedKeys?: NutrientKey[]): DiaryEntry {
  return {
    id: 'e1',
    at: '2026-11-17T12:00:00.000Z',
    rawText: 'an apple',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
    nutrients: { energyKcal: 52, sodiumMg: 1 },
    coverage: { energyKcal: 'known', sodiumMg: 'known' },
    classification: flags,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...(correctedKeys ? { correctedKeys } : {}),
  };
}

const row = (e: DiaryEntry) => render(<ul><EntryRow entry={e} onRelog={() => {}} /></ul>);

describe('corrected badge', () => {
  test('an entry with corrected figures is marked', () => {
    row(entry(['proteinG']));
    const badge = screen.getByTestId('corrected');
    expect(badge).toHaveTextContent('Corrected');
  });

  test('an entry with none is not marked', () => {
    row(entry());
    expect(screen.queryByTestId('corrected')).toBeNull();
    cleanup();
    row(entry([]));
    expect(screen.queryByTestId('corrected')).toBeNull();
  });

  test('the badge names which figures were corrected, and says the rest are unchanged', () => {
    row(entry(['satFatG', 'sodiumMg']));
    const title = screen.getByTestId('corrected').getAttribute('title') ?? '';
    expect(title).toContain('saturated fat');
    expect(title).toContain('sodium');
    expect(title).not.toContain('satFatG');
    expect(title).not.toContain('protein');
    expect(title).toMatch(/other figures are unchanged/i);
  });
});
