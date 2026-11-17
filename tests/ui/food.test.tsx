import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eraseEverything, putBatch, putProfile } from '@/data/db';
import type { ClassificationFlags } from '@/types/nutrients';
import Food from '@/ui/screens/Food';
import { ownerProfile } from '../fixtures/profile';

beforeEach(async () => {
  await eraseEverything();
  await putProfile(ownerProfile);
});
afterEach(cleanup);

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

const views = () => within(screen.getByRole('group', { name: 'Food views' }));

describe('the Food page', () => {
  test('shows both tabs and opens on Batches', async () => {
    render(<Food onLogPortion={() => undefined} />);
    expect(views().getByRole('button', { name: 'Batches' })).toHaveAttribute('aria-pressed', 'true');
    expect(views().getByRole('button', { name: 'My foods' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('switches to My foods and back', async () => {
    render(<Food onLogPortion={() => undefined} />);
    fireEvent.click(views().getByRole('button', { name: 'My foods' }));
    await waitFor(() => expect(views().getByRole('button', { name: 'My foods' })).toHaveAttribute('aria-pressed', 'true'));
    expect(views().getByRole('button', { name: 'Batches' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(views().getByRole('button', { name: 'Batches' }));
    await waitFor(() => expect(views().getByRole('button', { name: 'Batches' })).toHaveAttribute('aria-pressed', 'true'));
  });

  test('hands a portion straight through to the log', async () => {
    // The fridge-to-log path: merging two screens into one destination must not break it. Asserting the
    // callback fires with the portion's text is the only thing that proves the prop reaches BatchBuilder
    // rather than being dropped at the Food layer.
    await putBatch({
      id: 'b1',
      name: 'chilli',
      ingredients: [],
      portionCount: 4,
      nutrientsPerPortion: { energyKcal: 400 },
      coverage: { energyKcal: 'known' },
      classification: flags,
      portionsRemaining: 4,
      cookedAt: new Date().toISOString(),
    });
    const onLogPortion = vi.fn();
    render(<Food onLogPortion={onLogPortion} />);
    const log = await screen.findByRole('button', { name: /log a portion/i });
    fireEvent.click(log);
    await waitFor(() => expect(onLogPortion).toHaveBeenCalledTimes(1));
    expect(String(onLogPortion.mock.calls[0]?.[0])).toMatch(/chilli/i);
  });

  test('gives both tab controls a thumb-sized target', () => {
    render(<Food onLogPortion={() => undefined} />);
    for (const b of views().getAllByRole('button')) expect(b.className).toMatch(/min-h-1[2-9]/);
  });
});
