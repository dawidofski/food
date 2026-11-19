import 'fake-indexeddb/auto';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eraseEverything, putProfile } from '@/data/db';
import App from '@/App';
import { ownerProfile } from '../fixtures/profile';

/**
 * That the AUTOMATIC half of the automatic backup is wired up at all.
 *
 * Everything else about the backup is tested through `fileBackup` and the Settings panel, both of which are
 * reached by calling them. This is the one thing neither can show: that opening the app runs it. Without this,
 * deleting the effect from `App` leaves the whole suite green and the feature silently manual.
 */

const calls: string[] = [];

vi.mock('@/state/fileBackup', async (orig) => {
  const real = await orig<typeof import('@/state/fileBackup')>();
  return {
    ...real,
    backupOnOpen: () => {
      calls.push('backupOnOpen');
      return Promise.resolve({ state: 'off' as const });
    },
  };
});

beforeEach(async () => {
  calls.length = 0;
  await eraseEverything();
  await putProfile(ownerProfile);
});
afterEach(cleanup);

describe('opening the app', () => {
  test('runs the automatic backup', async () => {
    render(<App />);
    await waitFor(() => {
      expect(calls).toContain('backupOnOpen');
    });
  });

  test('does not wait for it: the diary is on screen whether or not it finishes', async () => {
    // A backup that never settles must not hold the app at a blank screen.
    const { findByRole } = render(<App />);
    expect(await findByRole('button', { name: 'Diary' }, { timeout: 8000 })).toBeTruthy();
  }, 20000);
});
