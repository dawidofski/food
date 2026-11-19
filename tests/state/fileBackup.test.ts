import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addEntry, eraseEverything, getFileHandle, lsKey, putFileHandle, type StoredFileHandle } from '@/data/db';
import { exportAll } from '@/data/exportImport';
import { getLastExportAt } from '@/state/backupReminder';
import {
  BACKUP_INTERVAL_MS,
  backupNow,
  backupOnOpen,
  backupStatus,
  canWriteToAFile,
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
 * A file that behaves like a real one: the writable stages bytes in a scratch area and only `close()` puts them
 * into `content`, which is how `createWritable` actually works. That is the whole point — it lets a test assert
 * that YESTERDAY'S BACKUP IS STILL THERE after a failed write, rather than asserting that abort() was called
 * and hoping that means the same thing.
 */
function fakeFile(opts: { permission?: PermissionState; failOn?: 'write' | 'close' | 'open' } = {}) {
  const state = {
    content: 'yesterday' as string,
    closed: false,
    aborted: false,
    opens: 0,
    asked: 0,
    scratch: null as string | null,
  };
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
      state.scratch = '';
      return {
        write: async (b: Blob) => {
          if (opts.failOn === 'write') throw new DOMException('disk full', 'QuotaExceededError');
          state.scratch = await b.text();
        },
        close: async () => {
          if (opts.failOn === 'close') throw new DOMException('nope', 'NotAllowedError');
          // Only now does anything reach the real file.
          state.content = state.scratch ?? '';
          state.scratch = null;
          state.closed = true;
        },
        abort: async () => {
          state.scratch = null;
          state.aborted = true;
        },
      };
    },
  };
  return { handle, state, deny: () => { permission = 'prompt'; } };
}

const AT = (iso: string) => () => new Date(iso);

/** The store seam, holding the fake file. The real store is exercised separately, at the bottom. */
function depsFor(f: ReturnType<typeof fakeFile> | null, now = AT('2026-11-19T09:00:00.000Z')): BackupDeps & { row: () => StoredFileHandle | undefined } {
  let row: StoredFileHandle | undefined = f
    ? { id: 'autoBackup', handle: f.handle as unknown as FileSystemFileHandle, name: f.handle.name, chosenAt: '2026-11-01T00:00:00.000Z' }
    : undefined;
  return {
    getHandle: async () => row,
    putHandle: async (r) => { row = r; },
    deleteHandle: async () => { row = undefined; },
    exportAll,
    now,
    row: () => row,
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
  test('writes the whole diary into the file and records when the write finished', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile();
    const deps = depsFor(f, AT('2026-11-19T09:00:05.000Z'));

    const r = await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps);

    expect(r.state).toBe('written');
    // The diary really is IN the file, not merely handed to something.
    expect(JSON.parse(f.state.content).entries.map((e: { id: string }) => e.id)).toEqual(['e1']);
    expect(f.state.closed).toBe(true);
    // The moment recorded is when the write ended, not when it was started.
    expect(r.state === 'written' && r.at.toISOString()).toBe('2026-11-19T09:00:05.000Z');
    expect(deps.row()?.lastWrittenAt).toBe('2026-11-19T09:00:05.000Z');
    // A completed write is a copy made, so the weekly reminder goes quiet too.
    expect(getLastExportAt()?.toISOString()).toBe('2026-11-19T09:00:05.000Z');
  });

  test('a failed write leaves the PREVIOUS backup in the file and records nothing', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile({ failOn: 'write' });
    const deps = depsFor(f);

    const r = await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps);

    expect(r.state).toBe('failed');
    // This is the claim the whole feature rests on: the only copy there was is still the only copy there is.
    expect(f.state.content).toBe('yesterday');
    expect(f.state.aborted).toBe(true);
    expect(f.state.scratch).toBeNull();
    expect(deps.row()?.lastWrittenAt).toBeUndefined();
    expect(getLastExportAt()).toBeNull();
  });

  test('a write that stages every byte and then fails to close is not a backup', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile({ failOn: 'close' });
    const deps = depsFor(f);

    const r = await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps);

    expect(r.state).toBe('failed');
    // Yesterday's backup is untouched, and the scratch file is not left sitting in the owner's folder.
    expect(f.state.content).toBe('yesterday');
    expect(f.state.aborted).toBe(true);
    expect(f.state.scratch).toBeNull();
    expect(deps.row()?.lastWrittenAt).toBeUndefined();
  });

  test('says the file is gone, in words, rather than reporting a backup', async () => {
    const deps = depsFor(fakeFile({ failOn: 'open' }));
    const r = await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps);
    expect(r).toMatchObject({ state: 'failed', reason: 'that file is not there any more — it may have been moved or deleted' });
    expect(deps.row()?.lastWrittenAt).toBeUndefined();
  });

  test("an unexpected failure is a sentence, not the browser's own message", async () => {
    const f = fakeFile({ failOn: 'write' }); // QuotaExceededError: real, and nothing the owner can read.
    const r = await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), depsFor(f));
    expect(r).toMatchObject({ state: 'failed', reason: 'the write did not finish' });
    expect(r.state === 'failed' && r.reason).not.toMatch(/quota|exceed|execute/i);
  });

  test('at most once a day, measured from the last completed write', async () => {
    expect(BACKUP_INTERVAL_MS).toBe(86_400_000); // The owner asked for daily. Pinned so it cannot drift.
    await addEntry(entry('e1'));
    const f = fakeFile();
    const first = new Date('2026-11-19T09:00:00.000Z');
    const deps = depsFor(f, () => first);

    expect((await backupOnOpen(first, deps)).state).toBe('written');
    expect(f.state.opens).toBe(1);

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
    // Asking needs a tap, and opening the app is not one. Nothing was asked and nothing was written.
    expect(f.state.asked).toBe(0);
    expect(f.state.opens).toBe(0);
    expect(f.state.content).toBe('yesterday');
  });

  test('"Back up now" may ask, and writes even though a day has not passed', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile({ permission: 'prompt' });
    const deps = depsFor(f);

    expect((await backupNow(deps)).state).toBe('written');
    expect(f.state.asked).toBe(1);
    expect((await backupNow(deps)).state).toBe('written');
    expect(f.state.opens).toBe(2);
  });

  test('two writes at once become one, so the file cannot end up holding the earlier snapshot', async () => {
    await addEntry(entry('e1'));
    const f = fakeFile();
    const deps = depsFor(f);
    // What React's StrictMode does to the effect in App, and what a tap during the opening write would do.
    const [a, b] = await Promise.all([backupNow(deps), backupNow(deps)]);
    expect(a.state).toBe('written');
    expect(b.state).toBe('written');
    expect(f.state.opens).toBe(1);
  });

  test('no file set up, or a browser that cannot do this at all', async () => {
    expect((await backupOnOpen(new Date(), depsFor(null))).state).toBe('off');
    noPicker();
    expect(canWriteToAFile()).toBe(false);
    // Short-circuits before the store: "off" reads as "you have not set it up yet" and would send the owner
    // looking for a button that cannot work.
    expect((await backupOnOpen(new Date(), depsFor(fakeFile()))).state).toBe('unsupported');
  });

  describe('a stored date that cannot be trusted', () => {
    test('one from the future does not switch the backup off for years', async () => {
      const deps = depsFor(fakeFile());
      await deps.putHandle({ ...(deps.row() as StoredFileHandle), lastWrittenAt: '2099-01-01T00:00:00.000Z' });
      expect((await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps)).state).toBe('written');
    });

    test('one that is not a date reads as never, so the backup runs and the screen shows no date', async () => {
      const deps = depsFor(fakeFile());
      await deps.putHandle({ ...(deps.row() as StoredFileHandle), lastWrittenAt: 'not a date' });
      expect(await backupStatus(deps)).toMatchObject({ kind: 'ready', lastWrittenAt: null });
      expect((await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps)).state).toBe('written');
    });
  });

  test('a write still counts when the date cannot be saved afterwards', async () => {
    // The row write and the localStorage stamp are bookkeeping. The bytes are already in the owner's file, so
    // reporting a failure here would be a second lie in the other direction.
    await addEntry(entry('e1'));
    const f = fakeFile();
    const deps = { ...depsFor(f), putHandle: () => Promise.reject(new Error('store is full')) };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });

    expect((await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps)).state).toBe('written');
    expect(JSON.parse(f.state.content).entries).toHaveLength(1);
    vi.restoreAllMocks();
  });

  test('stopping forgets the file and the app stops writing to it', async () => {
    const f = fakeFile();
    const deps = depsFor(f);
    await stopFileBackup(deps);
    expect((await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps)).state).toBe('off');
    expect(f.state.opens).toBe(0);
    expect(await backupStatus(deps)).toEqual({ kind: 'off' });
  });
});

describe('what the screen is told', () => {
  test('a file whose permission has lapsed is reported as blocked, with its date kept', async () => {
    const f = fakeFile();
    const deps = depsFor(f);
    await backupOnOpen(new Date('2026-11-19T09:00:00.000Z'), deps);

    f.deny();

    expect(await backupStatus(deps)).toMatchObject({
      kind: 'blocked',
      name: 'food-diary-backup.json',
      lastWrittenAt: new Date('2026-11-19T09:00:00.000Z'),
    });
    // Checking must never prompt: this runs whenever Settings is opened.
    expect(f.state.asked).toBe(0);
  });

  test('a date belongs to its file, so choosing a different one starts with no claim', async () => {
    // The defect this shape exists to prevent: A was written yesterday, B is chosen today and its first write
    // fails. Nothing may say "last written to B" using A's date.
    const a = fakeFile();
    const deps = depsFor(a, AT('2026-11-18T09:00:00.000Z'));
    await backupOnOpen(new Date('2026-11-18T09:00:00.000Z'), deps);
    expect(await backupStatus(deps)).toMatchObject({ name: 'food-diary-backup.json', lastWrittenAt: new Date('2026-11-18T09:00:00.000Z') });

    const b = fakeFile({ failOn: 'write' });
    await deps.putHandle({ id: 'autoBackup', handle: b.handle as unknown as FileSystemFileHandle, name: 'other.json', chosenAt: '2026-11-19T09:00:00.000Z' });

    expect(await backupStatus(deps)).toMatchObject({ kind: 'ready', name: 'other.json', lastWrittenAt: null });
  });
});

describe('the real store', () => {
  test('erasing everything forgets which file was chosen', async () => {
    // A stand-in for the handle: what is checked here is that the erase sweep reaches this store at all, which
    // is the thing a hand-written list of stores gets wrong.
    await putFileHandle({ id: 'autoBackup', handle: {} as FileSystemFileHandle, name: 'f.json', chosenAt: '2026-11-01T00:00:00.000Z', lastWrittenAt: '2026-11-18T00:00:00.000Z' });
    expect(await getFileHandle('autoBackup')).toBeDefined();

    await eraseEverything();

    expect(await getFileHandle('autoBackup')).toBeUndefined();
    expect(localStorage.getItem(lsKey('lastExportAt'))).toBeNull();
  });

  test('the chosen file is not in the export, so it cannot land on another device', async () => {
    await putFileHandle({ id: 'autoBackup', handle: {} as FileSystemFileHandle, name: 'f.json', chosenAt: '2026-11-01T00:00:00.000Z', lastWrittenAt: '2026-11-18T00:00:00.000Z' });
    const text = await (await exportAll()).text();
    expect(text).not.toMatch(/autoBackup|lastWrittenAt/);
  });
});
