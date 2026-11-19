import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addEntry, eraseEverything, getFileHandle, lsKey, putFileHandle } from '@/data/db';
import { exportAll } from '@/data/exportImport';
import { getLastExportAt } from '@/state/backupReminder';
import {
  BACKUP_INTERVAL_MS,
  LAST_FILE_BACKUP_KEY,
  backupNow,
  backupOnOpen,
  canWriteToAFile,
  getLastFileBackupAt,
  stopFileBackup,
  type BackupDeps,
} from '@/state/fileBackup';
import type { ClassificationFlags } from '@/types/nutrients';

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

const entry = (id: string) => ({
  id, at: '2026-11-18T12:00:00.000Z', rawText: 'something', resolution: 'local' as const,
  items: [{ source: 'dataset' as const, foodId: 'f1', grams: 100, classification: flags }],
  nutrients: { energyKcal: 100 }, coverage: { energyKcal: 'known' as const }, classification: flags,
  warningsShown: [], userAction: 'added' as const, state: 'active' as const,
});

/**
 * A file the browser would give us. `written` holds what actually reached it, so a test can tell a real write
 * from a call that looked like one, and `closed` records that the write was COMPLETED rather than merely begun.
 */
function fakeFile(opts: { permission?: PermissionState; failOn?: 'write' | 'close' | 'open' } = {}) {
  const state = { written: null as string | null, closed: false, aborted: false, opens: 0, asked: 0 };
  let permission: PermissionState = opts.permission ?? 'granted';
  const handle = {
    name: 'food-diary-backup.json',
    queryPermission: async () => permission,
    requestPermission: async () => {
      state.asked++;
      permission = 'granted';
      return permission;
    },
    createWritable: async () => {
      state.opens++;
      if (opts.failOn === 'open') throw new DOMException('gone', 'NotFoundError');
      return {
        write: async (b: Blob) => {
          if (opts.failOn === 'write') throw new DOMException('disk full', 'QuotaExceededError');
          state.written = await b.text();
        },
        close: async () => {
          if (opts.failOn === 'close') throw new DOMException('nope', 'NotAllowedError');
          state.closed = true;
        },
        abort: async () => { state.aborted = true; },
      };
    },
  };
  return { handle, state, deny: () => { permission = 'prompt'; } };
}

/**
 * The store seam, holding the fake file. A real `FileSystemFileHandle` is a platform object and no stand-in for
 * one survives IndexedDB's structured clone, so the store itself is tested separately, at the bottom.
 */
function depsFor(f: ReturnType<typeof fakeFile> | null): BackupDeps {
  let row = f
    ? { id: 'autoBackup', handle: f.handle as unknown as FileSystemFileHandle, name: f.handle.name, chosenAt: '2026-11-01T00:00:00.000Z' }
    : undefined;
  return {
    getHandle: async () => row,
    putHandle: async (r) => { row = r; },
    deleteHandle: async () => { row = undefined; },
    exportAll,
  };
}

/** This browser can write to a file the owner picks; without it every path short-circuits to 'unsupported'. */
const supportPicker = () => {
  (window as unknown as Record<string, unknown>).showSaveFilePicker = () => Promise.reject(new Error('not used here'));
};
const noPicker = () => {
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
};

beforeEach(async () => {
  await eraseEverything();
  supportPicker();
});
afterEach(() => {
  vi.unstubAllGlobals();
  noPicker();
});

describe('backing up to a file the owner chose', () => {
  test('writes the whole diary and records the moment it FINISHED', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile();
    const deps = depsFor(f);

    const now = new Date('2026-11-19T09:00:00.000Z');
    const r = await backupOnOpen(now, deps);

    expect(r.state).toBe('written');
    expect(f.state.closed).toBe(true);
    // Not "a file was handed over": the diary really is in it.
    const parsed = JSON.parse(f.state.written ?? '{}');
    expect(parsed.entries.map((e: { id: string }) => e.id)).toEqual(['e1']);
    expect(getLastFileBackupAt()?.toISOString()).toBe(now.toISOString());
    // A completed write is a copy made, so the weekly reminder goes quiet too.
    expect(getLastExportAt()?.toISOString()).toBe(now.toISOString());
  });

  test('records NOTHING when the write fails, so the screen cannot claim a backup that did not happen', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile({ failOn: 'write' });
    const deps = depsFor(f);

    const r = await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps);

    expect(r.state).toBe('failed');
    expect(getLastFileBackupAt()).toBeNull();
    expect(getLastExportAt()).toBeNull();
    // The half-written scratch file is thrown away, so the previous backup is still the previous backup.
    expect(f.state.aborted).toBe(true);
    expect(f.state.closed).toBe(false);
  });

  test('a write that begins and never closes is not a backup', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile({ failOn: 'close' });
    const deps = depsFor(f);

    const r = await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps);

    expect(r.state).toBe('failed');
    // The bytes reached the scratch file; the commit did not happen. Recording this as a backup is the exact
    // lie this feature must not tell.
    expect(f.state.written).not.toBeNull();
    expect(getLastFileBackupAt()).toBeNull();
  });

  test('says the file is gone rather than reporting a backup', async () => {
    const f = fakeFile({ failOn: 'open' });
    const deps = depsFor(f);
    const r = await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps);
    expect(r).toMatchObject({ state: 'failed', reason: expect.stringMatching(/not there any more/i) });
    expect(getLastFileBackupAt()).toBeNull();
  });

  test('at most once a day, and the day is measured from the last completed write', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile();
    const deps = depsFor(f);

    const first = new Date('2026-11-19T09:00:00.000Z');
    expect((await backupOnOpen(first, deps)).state).toBe('written');
    expect(f.state.opens).toBe(1);

    // Opened again an hour later, and six hours after that: the file is not touched either time.
    expect((await backupOnOpen(new Date(first.getTime() + 3_600_000), deps)).state).toBe('not-due');
    expect((await backupOnOpen(new Date(first.getTime() + 7 * 3_600_000), deps)).state).toBe('not-due');
    expect(f.state.opens).toBe(1);

    expect((await backupOnOpen(new Date(first.getTime() + BACKUP_INTERVAL_MS), deps)).state).toBe('written');
    expect(f.state.opens).toBe(2);
  });

  test('opening the app never asks for permission; it reports that it could not write', async () => {
    const f = fakeFile({ permission: 'prompt' });
    const deps = depsFor(f);

    const r = await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps);

    expect(r).toMatchObject({ state: 'needs-permission', name: 'food-diary-backup.json' });
    // Asking needs a tap, and opening the app is not one. Nothing was written and nothing was asked.
    expect(f.state.asked).toBe(0);
    expect(f.state.opens).toBe(0);
    expect(getLastFileBackupAt()).toBeNull();
  });

  test('"Back up now" may ask, and writes even though a day has not passed', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile({ permission: 'prompt' });
    const deps = depsFor(f);

    const r = await backupNow(new Date('2026-11-19T09:00:00.000Z'), deps);

    expect(r.state).toBe('written');
    expect(f.state.asked).toBe(1);
    // Straight away again: the once-a-day rule is about not writing behind their back, and this is not that.
    expect((await backupNow(new Date('2026-11-19T09:00:30.000Z'), deps)).state).toBe('written');
    expect(f.state.opens).toBe(2);
  });

  test('no file set up, or a browser that cannot do this at all', async () => {
    expect((await backupOnOpen(new Date(), depsFor(null))).state).toBe('off');
    noPicker();
    expect(canWriteToAFile()).toBe(false);
    // Short-circuits before the store: a browser that cannot write must not report "off", which reads as
    // "you have not set it up yet" and would send the owner looking for a button that cannot work.
    expect((await backupOnOpen(new Date(), depsFor(fakeFile()))).state).toBe('unsupported');
  });

  test('a stamp from the future is ignored rather than switching the backup off for years', async () => {
    const deps = depsFor(fakeFile());
    localStorage.setItem(LAST_FILE_BACKUP_KEY, '2099-01-01T00:00:00.000Z');
    expect((await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps)).state).toBe('written');
  });

  test('stopping forgets the file and the app stops writing to it', async () => {
    const f = fakeFile();
    const deps = depsFor(f);
    await stopFileBackup(deps);
    expect((await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps)).state).toBe('off');
    expect(f.state.opens).toBe(0);
  });

  test('erasing everything forgets which file was chosen, and the stamp with it', async () => {
    // The real store, with a stand-in for the handle: what is being checked is that the sweep reaches this
    // store at all, which is the thing a hand-written list of stores gets wrong.
    await putFileHandle({ id: 'autoBackup', handle: {} as FileSystemFileHandle, name: 'f.json', chosenAt: '2026-11-01T00:00:00.000Z' });
    localStorage.setItem(LAST_FILE_BACKUP_KEY, '2026-11-18T00:00:00.000Z');
    expect(await getFileHandle('autoBackup')).toBeDefined();

    await eraseEverything();

    expect(await getFileHandle('autoBackup')).toBeUndefined();
    expect(localStorage.getItem(lsKey('lastFileBackupAt'))).toBeNull();
    expect(getLastFileBackupAt()).toBeNull();
  });
});
