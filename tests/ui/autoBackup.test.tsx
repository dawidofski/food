import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything, putFileHandle } from '@/data/db';
import { LAST_FILE_BACKUP_KEY } from '@/state/fileBackup';
import AutoBackup from '@/ui/components/AutoBackup';

/**
 * What this screen is allowed to say.
 *
 * The one failure that matters here is a line reading "Last written to … on …" when no write finished. These
 * tests drive the real component against the real store, so the only way the date appears is the stamp, and the
 * only thing that writes the stamp is a completed write.
 */

const picker = (impl?: () => Promise<unknown>) => {
  (window as unknown as Record<string, unknown>).showSaveFilePicker = impl ?? (() => Promise.reject(new Error('unused')));
};
const noPicker = () => {
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
};

const installFile = () =>
  putFileHandle({ id: 'autoBackup', handle: {} as FileSystemFileHandle, name: 'food-diary-backup.json', chosenAt: '2026-11-01T00:00:00.000Z' });

beforeEach(async () => {
  await eraseEverything();
  picker();
});
afterEach(() => {
  cleanup();
  noPicker();
});

describe('the automatic backup, as it is described on screen', () => {
  test('a browser that cannot write to a file says so, and offers no button that could not work', async () => {
    noPicker();
    render(<AutoBackup />);
    expect(await screen.findByText(/cannot write to a file you choose/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /choose where to save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /back up now/i })).toBeNull();
  });

  test('with no file chosen it invites you to choose one and claims nothing', async () => {
    render(<AutoBackup />);
    expect(await screen.findByRole('button', { name: /choose where to save/i })).toBeTruthy();
    expect(screen.queryByText(/last written/i)).toBeNull();
  });

  test('a file set up but never written says exactly that, not a date', async () => {
    await installFile();
    render(<AutoBackup />);
    const status = await screen.findByTestId('auto-backup-status');
    expect(status).toHaveTextContent(/food-diary-backup\.json is set up, but nothing has been written to it yet/i);
    expect(status).not.toHaveTextContent(/last written/i);
  });

  test('the date shown is the stamp a finished write left, and nothing else', async () => {
    await installFile();
    localStorage.setItem(LAST_FILE_BACKUP_KEY, '2026-11-18T07:30:00.000Z');
    render(<AutoBackup />);
    const status = await screen.findByTestId('auto-backup-status');
    expect(status).toHaveTextContent(/last written to food-diary-backup\.json on 18 November 2026/i);
  });

  test('a failed "Back up now" says nothing was saved and leaves the line as it was', async () => {
    await installFile();
    localStorage.setItem(LAST_FILE_BACKUP_KEY, '2026-11-18T07:30:00.000Z');
    render(<AutoBackup />);
    await screen.findByTestId('auto-backup-status');

    // The stored stand-in has no createWritable, so the write cannot even begin — the same shape of failure as
    // a file that has been deleted from the phone.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /back up now/i })); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was saved/i);
    // Still yesterday. A failure must never move the date forward.
    await waitFor(() => {
      expect(screen.getByTestId('auto-backup-status')).toHaveTextContent(/on 18 November 2026/i);
    });
    expect(localStorage.getItem(LAST_FILE_BACKUP_KEY)).toBe('2026-11-18T07:30:00.000Z');
  });

  test('closing the picker without choosing is not reported as a failure', async () => {
    picker(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    render(<AutoBackup />);
    const choose = await screen.findByRole('button', { name: /choose where to save/i });
    await act(async () => { fireEvent.click(choose); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await screen.findByRole('button', { name: /choose where to save/i })).toBeTruthy();
  });

  test('stopping asks first, then says the file is left where it is', async () => {
    await installFile();
    render(<AutoBackup />);
    await screen.findByTestId('auto-backup-status');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^stop$/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /stop backing up/i })); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/left where it is, holding the last backup written to it/i);
    expect(await screen.findByRole('button', { name: /choose where to save/i })).toBeTruthy();
  });
});
