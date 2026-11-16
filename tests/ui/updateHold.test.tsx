import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { eraseEverything } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { updates } from '@/state/updates';
import { defaultDeps } from '@/state/useEntryFlow';
import Log from '@/ui/screens/Log';

const fromDisk = (async (url: string) => {
  const rel = String(url).replace(import.meta.env.BASE_URL, '');
  const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
  return { ok: true, status: 200, text: async () => body } as Response;
}) as typeof fetch;

beforeEach(async () => {
  await eraseEverything();
  resetFoodRepository();
  await loadFoods(fromDisk);
});
afterEach(cleanup);

test('a waiting update is held while text is typed or a warning gate is open, and released after', async () => {
  render(<Log deps={{ ...defaultDeps, loadData: () => loadFoods(fromDisk) }} />);
  expect(updates.isHeld()).toBe(false);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'six hot dogs' } });
  expect(updates.isHeld()).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^log$/i }));
  });
  await screen.findByTestId('warning-gate');
  expect(updates.isHeld()).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  });
  await screen.findByTestId('outcome');
  await waitFor(() => expect(updates.isHeld()).toBe(false));
}, 60_000);

test('leaving the screen releases the hold', () => {
  const { unmount } = render(<Log deps={{ ...defaultDeps }} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
  expect(updates.isHeld()).toBe(true);
  unmount();
  expect(updates.isHeld()).toBe(false);
});
