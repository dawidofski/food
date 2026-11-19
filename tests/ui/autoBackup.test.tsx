import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eraseEverything, type StoredFileHandle } from '@/data/db';
import { exportAll } from '@/data/exportImport';
import { defaultBackupDeps, type BackupDeps } from '@/state/fileBackup';
import AutoBackup from '@/ui/components/AutoBackup';

/**
 * What this screen is allowed to say.
 *
 * The failure that matters is a line reading "Last written to … on …" about a write that did not happen — to
 * this file, or at all. These drive the real component against the real store, so the only way a date reaches
 * the screen is the one on the file's own row.
 */

const picker = (impl?: () => Promise<unknown>) => {
  (window as unknown as Record<string, unknown>).showSaveFilePicker = impl ?? (() => Promise.reject(new Error('unused')));
};
const noPicker = () => {
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
};

/**
 * A file the browser would give us, held in a store of its own.
 *
 * Not the real IndexedDB store: a `FileSystemFileHandle` is a platform object and no stand-in for one survives
 * structured clone, so the component is given the same seam its module has. `permission` drives
 * `queryPermission`; `writable` decides whether a write can start at all — absent, `createWritable` throws
 * NotFoundError, which is what a file deleted from the phone does.
 */
const fakeHandle = (o: { name?: string; permission?: PermissionState; writable?: boolean } = {}) => ({
  name: o.name ?? 'food-diary-backup.json',
  queryPermission: async () => o.permission ?? ('granted' as PermissionState),
  requestPermission: async () => o.permission ?? ('granted' as PermissionState),
  createWritable: async () => {
    if (o.writable !== true) throw new DOMException('gone', 'NotFoundError');
    return { write: async () => undefined, close: async () => undefined, abort: async () => undefined };
  },
});

function depsWith(o: { name?: string; lastWrittenAt?: string; permission?: PermissionState; writable?: boolean } | null): BackupDeps {
  const h = o ? fakeHandle(o) : null;
  let row: StoredFileHandle | undefined =
    o && h
      ? {
          id: 'autoBackup', handle: h as unknown as FileSystemFileHandle, name: h.name,
          chosenAt: '2026-11-01T00:00:00.000Z',
          ...(o.lastWrittenAt === undefined ? {} : { lastWrittenAt: o.lastWrittenAt }),
        }
      : undefined;
  return {
    ...defaultBackupDeps,
    getHandle: async () => row,
    putHandle: async (r) => { row = r; },
    deleteHandle: async () => { row = undefined; },
    exportAll,
    now: () => new Date('2026-11-19T12:00:00.000Z'),
  };
}

beforeEach(async () => {
  await eraseEverything();
  picker();
  vi.setSystemTime(new Date('2026-11-19T12:00:00.000Z'));
});
afterEach(() => {
  cleanup();
  noPicker();
  vi.useRealTimers();
});

describe('the automatic backup, as it is described on screen', () => {
  test('a browser that cannot write to a file says so, and offers no button that could not work', async () => {
    noPicker();
    render(<AutoBackup deps={depsWith(null)} />);
    expect(await screen.findByText(/cannot write to a file you choose/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /choose where to save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /back up now/i })).toBeNull();
  });

  test('with no file chosen it invites you to choose one and claims nothing', async () => {
    render(<AutoBackup deps={depsWith(null)} />);
    expect(await screen.findByRole('button', { name: /choose where to save/i })).toBeTruthy();
    expect(screen.queryByText(/last written/i)).toBeNull();
    // The file holds a date of birth and a weight log, and this is the screen that suggests putting it in Drive.
    expect(screen.getByText(/height, date of birth, sex and weight log/i)).toBeTruthy();
  });

  test('a file set up but never written says exactly that, not a date', async () => {
    render(<AutoBackup deps={depsWith({})} />);
    const status = await screen.findByTestId('auto-backup-status');
    expect(status).toHaveTextContent(/food-diary-backup\.json is set up, but nothing has been written to it yet/i);
    expect(status).not.toHaveTextContent(/last written/i);
  });

  test('the date shown is the one on the file, and how long ago it was', async () => {
    render(<AutoBackup deps={depsWith({ lastWrittenAt: '2026-11-18T07:30:00.000Z' })} />);
    expect(await screen.findByTestId('auto-backup-status')).toHaveTextContent(
      /last written to food-diary-backup\.json on 18 November 2026 at \d\d:\d\d — yesterday/i,
    );
  });

  test('a backup that stopped eleven days ago says so in days, not just a date', async () => {
    render(<AutoBackup deps={depsWith({ lastWrittenAt: '2026-11-08T07:30:00.000Z' })} />);
    expect(await screen.findByTestId('auto-backup-status')).toHaveTextContent(/11 days ago/i);
  });

  test('a lapsed permission is shown, not left for you to infer from a date that stopped moving', async () => {
    render(<AutoBackup deps={depsWith({ lastWrittenAt: '2026-11-18T07:30:00.000Z', permission: 'prompt' })} />);
    expect(await screen.findByTestId('auto-backup-blocked')).toHaveTextContent(/it is not running now/i);
    // And the reassuring paragraph is gone while it is not running.
    expect(screen.queryByText(/it happens when you open the app and a day has passed/i)).toBeNull();
  });

  test('while it is running it says so, and says the browser may ask again later', async () => {
    render(<AutoBackup deps={depsWith({ lastWrittenAt: '2026-11-18T07:30:00.000Z' })} />);
    await screen.findByTestId('auto-backup-status');
    expect(screen.queryByTestId('auto-backup-blocked')).toBeNull();
    expect(screen.getByText(/chrome may also ask to be allowed again/i)).toBeTruthy();
  });

  test('a failed "Back up now" says nothing was saved and leaves the date as it was', async () => {
    render(<AutoBackup deps={depsWith({ lastWrittenAt: '2026-11-18T07:30:00.000Z' })} />);
    await screen.findByTestId('auto-backup-status');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /back up now/i })); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was saved: that file is not there any more/i);
    // Still yesterday. A failure must never move the date forward.
    await waitFor(() => {
      expect(screen.getByTestId('auto-backup-status')).toHaveTextContent(/on 18 November 2026/i);
    });
  });

  test('choosing a different file does not inherit the old file\u2019s date when its first write fails', async () => {
    // The defect this whole shape exists to prevent.
    picker(() =>
      Promise.resolve({
        name: 'other.json',
        queryPermission: async () => 'granted' as PermissionState,
        requestPermission: async () => 'granted' as PermissionState,
        createWritable: async () => { throw new DOMException('gone', 'NotFoundError'); },
      }),
    );
    render(<AutoBackup deps={depsWith({ lastWrittenAt: '2026-11-18T07:30:00.000Z' })} />);
    await screen.findByTestId('auto-backup-status');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /use a different file/i })); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was saved/i);
    await waitFor(() => {
      const status = screen.getByTestId('auto-backup-status');
      expect(status).toHaveTextContent(/other\.json is set up, but nothing has been written to it yet/i);
      expect(status).not.toHaveTextContent(/18 November/);
    });
  });

  test('a successful write moves the date and says where it went', async () => {
    render(<AutoBackup deps={depsWith({ writable: true })} />);
    await screen.findByTestId('auto-backup-status');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /back up now/i })); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/saved to food-diary-backup\.json/i);
    await waitFor(() => {
      expect(screen.getByTestId('auto-backup-status')).toHaveTextContent(/last written to food-diary-backup\.json on 19 November 2026/i);
    });
  });

  test('closing the picker without choosing is not reported as a failure', async () => {
    picker(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    render(<AutoBackup deps={depsWith(null)} />);
    const choose = await screen.findByRole('button', { name: /choose where to save/i });
    await act(async () => { fireEvent.click(choose); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await screen.findByRole('button', { name: /choose where to save/i })).toBeTruthy();
  });

  test('stopping asks first, can be changed your mind about, and leaves the file alone', async () => {
    render(<AutoBackup deps={depsWith({})} />);
    await screen.findByTestId('auto-backup-status');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^stop$/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /keep it on/i })); });
    expect(await screen.findByRole('button', { name: /^stop$/i })).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^stop$/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /stop backing up/i })); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/left where it is, holding the last backup written to it/i);
    expect(await screen.findByRole('button', { name: /choose where to save/i })).toBeTruthy();
  });
});
