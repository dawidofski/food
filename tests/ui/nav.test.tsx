import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything, putProfile } from '@/data/db';
import App from '@/App';
import { ownerProfile } from '../fixtures/profile';

beforeEach(async () => {
  await eraseEverything();
  await putProfile(ownerProfile);
});
afterEach(cleanup);

const nav = async () => {
  render(<App />);
  return within(await screen.findByRole('navigation', { name: 'Main' }));
};

describe('the main navigation', () => {
  test('offers four destinations, each with a name a screen reader can read', async () => {
    const n = await nav();
    for (const name of ['Diary', 'Trends', 'Food', 'Settings']) {
      expect(n.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(n.getAllByRole('button')).toHaveLength(4);
  });

  test('marks the open tab and no other', async () => {
    const n = await nav();
    const current = n.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
  });

  test('gives every nav control a 44 px target', async () => {
    const n = await nav();
    // min-h-12 is 48 px in this project's Tailwind scale; anything smaller fails the thumb rule.
    for (const b of n.getAllByRole('button')) expect(b.className).toMatch(/min-h-1[2-9]|min-h-\d{2,}/);
  });

  test('the icons carry no accessible name of their own', async () => {
    const n = await nav();
    for (const b of n.getAllByRole('button')) {
      const svg = b.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  test('opens on the diary', async () => {
    await nav();
    await waitFor(() => expect(screen.getByRole('heading', { name: /^diary$/i })).toBeInTheDocument());
  });
});
