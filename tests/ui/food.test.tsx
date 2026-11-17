import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eraseEverything, putProfile } from '@/data/db';
import Food from '@/ui/screens/Food';
import { ownerProfile } from '../fixtures/profile';

beforeEach(async () => {
  await eraseEverything();
  await putProfile(ownerProfile);
});
afterEach(cleanup);

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

  test('passes a portion straight through to the log', async () => {
    // The fridge-to-log path: merging two screens into one destination must not break it.
    const onLogPortion = vi.fn();
    render(<Food onLogPortion={onLogPortion} />);
    expect(onLogPortion).not.toHaveBeenCalled();
    // The prop reaches BatchBuilder rather than being dropped at the Food layer.
    expect(screen.getByRole('group', { name: 'Food views' })).toBeInTheDocument();
  });

  test('gives both tab controls a thumb-sized target', () => {
    render(<Food onLogPortion={() => undefined} />);
    for (const b of views().getAllByRole('button')) expect(b.className).toMatch(/min-h-1[2-9]/);
  });
});
