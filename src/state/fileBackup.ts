import { deleteFileHandle, getFileHandle, putFileHandle, type StoredFileHandle } from '@/data/db';
import { exportAll } from '@/data/exportImport';
import { recordExportOffered } from '@/state/backupReminder';

/**
 * The automatic backup: one file on the device, overwritten with the latest diary, at most once a day.
 *
 * This is the first thing in the app that can honestly say the diary was **backed up** rather than merely
 * offered. A download hands a file to the browser and then knows nothing — it may have been cancelled, or saved
 * somewhere the browser can clear. Writing through a handle the owner picked either finishes or throws, and what
 * it writes is a real file at a place they chose. So the moment recorded here is the moment `close()` returned,
 * and nothing records it on any other path.
 *
 * **The date is kept ON the file's own row, never beside it.** An earlier version held "last written at" in a
 * key of its own, and so could pair yesterday's date with a file chosen today whose first write had failed: the
 * screen then read "Last written to B.json on <the day A.json was written>". A date that lives with the file it
 * describes cannot outlive it, cannot survive the file being swapped, and does not travel in the export to land
 * on another device as a claim about a write that never happened there.
 *
 * Two things this deliberately does NOT do, because it cannot:
 *
 * - **Run when the app is shut.** Nothing can wake a web page. The backup happens when the app is opened, which
 *   is why the screen says "when you open the app" and never "every day".
 * - **Keep its own permission.** The browser owns that, and Chrome drops it after a tab has been in the
 *   background for a while. Re-granting needs a tap, which opening the app is not — so `backupOnOpen` reports a
 *   lapse rather than asking, and `backupStatus` exists so the screen can SHOW that lapse instead of leaving
 *   the owner to notice for himself that a date stopped moving.
 */

/** There is one automatic backup file, so one handle. */
const HANDLE_ID = 'autoBackup';

/**
 * The seam to the store, the export and the clock, as every other part of this app has one.
 *
 * It is here for a reason beyond habit: a real `FileSystemFileHandle` is a platform object, and nothing a test
 * can build survives IndexedDB's structured clone. Without this seam, "the write failed, so record nothing"
 * could not be tested at all.
 */
export type BackupDeps = {
  getHandle: () => Promise<StoredFileHandle | undefined>;
  putHandle: (row: StoredFileHandle) => Promise<void>;
  deleteHandle: () => Promise<void>;
  exportAll: () => Promise<Blob>;
  /** Read when a write FINISHES, which is the only moment worth recording. */
  now: () => Date;
};

export const defaultBackupDeps: BackupDeps = {
  getHandle: () => getFileHandle(HANDLE_ID),
  putHandle: putFileHandle,
  deleteHandle: () => deleteFileHandle(HANDLE_ID),
  exportAll,
  now: () => new Date(),
};

const DAY_MS = 86_400_000;

/** The owner asked for at most one a day. */
export const BACKUP_INTERVAL_MS = DAY_MS;

/**
 * `showSaveFilePicker` is not in TypeScript's DOM library. Declared here rather than globally so that the one
 * place that may call it is this file, and every other part of the app goes through the functions below.
 */
type SavePickerOptions = {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
};
type PickerWindow = Window & {
  showSaveFilePicker?: (o?: SavePickerOptions) => Promise<FileSystemFileHandle>;
};

/** True when this browser can write to a file the owner picks. Chrome 132+ on Android can; Firefox cannot. */
export function canWriteToAFile(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showSaveFilePicker === 'function';
}

/** The row's stored moment, or null when it is absent or not a date. A junk value must read as "never". */
function writtenAt(row: StoredFileHandle | undefined): Date | null {
  if (row?.lastWrittenAt === undefined || row.lastWrittenAt === '') return null;
  const t = new Date(row.lastWrittenAt).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * A moment more than a day ahead of now is a wrong value, not clock drift, and is ignored — otherwise a
 * nonsense date could switch the backup off for years in silence. Settings prints the stored date, so a strange
 * value stays visible either way.
 */
function dueAt(stamp: Date | null, now: Date): boolean {
  if (stamp === null) return true;
  if (stamp.getTime() - now.getTime() > DAY_MS) return true;
  return now.getTime() - stamp.getTime() >= BACKUP_INTERVAL_MS;
}

export type BackupState =
  /** Written just now. `at` is when the write finished. */
  | { state: 'written'; at: Date; name: string }
  /** A file is set up and was written recently enough; nothing to do. */
  | { state: 'not-due'; at: Date; name: string }
  /** No file has been chosen yet. */
  | { state: 'off' }
  /** This browser cannot write to a file at all. */
  | { state: 'unsupported' }
  /** A file is set up but the browser wants to be asked again before the app may write to it. */
  | { state: 'needs-permission'; name: string }
  /** Something went wrong. `reason` is a sentence for the owner, never a stack trace. */
  | { state: 'failed'; reason: string; name: string };

type PermissionCapable = FileSystemFileHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

/**
 * Whether the app may write through this handle right now. Never prompts: `queryPermission` only reports.
 *
 * A handle without the method, or one that throws, is treated as allowed. `createWritable` is the real
 * authority and throws `NotAllowedError` when it is not, so the owner is still told nothing was saved —
 * whereas guessing "denied" here would switch off a backup that in fact works.
 */
async function mayWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as PermissionCapable;
  if (typeof h.queryPermission !== 'function') return true;
  try {
    return (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return true;
  }
}

/** Asks for write permission. Must be called from a tap: browsers refuse this without one. */
async function askToWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as PermissionCapable;
  if (typeof h.requestPermission !== 'function') return true;
  try {
    return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * What the owner is told when a write fails.
 *
 * The two cases worth naming are named. Everything else gets a plain sentence rather than the browser's own
 * message, which on a phone reads like "Failed to execute 'write' on 'FileSystemWritableFileStream'" and tells
 * them nothing they can act on.
 */
const reasonOf = (err: unknown): string => {
  if (err instanceof DOMException && err.name === 'NotFoundError') {
    return 'that file is not there any more — it may have been moved or deleted';
  }
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'the browser did not allow the write';
  }
  return 'the write did not finish';
};

/**
 * One write at a time.
 *
 * Opening the app fires a write, and under React's StrictMode that effect runs twice; a "Back up now" tap can
 * also land while the opening write is still going. `createWritable` defaults to `siloed` mode, so concurrent
 * writers do not throw — each gets its own scratch file and the last one closed wins, which can leave the file
 * holding the EARLIER of two snapshots while both report success. Sharing the promise makes the second caller
 * wait for the first and report the same outcome, and saves a phone a second full export.
 */
let inFlight: Promise<BackupState> | null = null;

/**
 * Overwrites the chosen file with the whole diary, then records the moment that finished.
 *
 * `createWritable` does not touch the existing file: the browser writes to a scratch file beside it and only
 * puts it in place when `close()` returns. So a write that fails part-way leaves the previous backup intact,
 * which is what matters when the file being replaced is the only copy there is. A failure at any stage — the
 * write or the close — aborts the stream, so the scratch file is not left sitting in the owner's folder either.
 */
async function writeOnce(row: StoredFileHandle, deps: BackupDeps): Promise<BackupState> {
  try {
    // Built BEFORE the file is opened for writing, deliberately: a failure here must not have touched the file.
    const blob = await deps.exportAll();
    const w = await row.handle.createWritable();
    try {
      await w.write(blob);
      await w.close();
    } catch (err) {
      await w.abort().catch(() => undefined);
      throw err;
    }
    const at = deps.now();
    // Only here, and nowhere else: the bytes are in the file the owner chose.
    await deps.putHandle({ ...row, lastWrittenAt: at.toISOString() }).catch(() => undefined);
    // A completed write is a copy made, which is what the weekly reminder watches for. Recording it here keeps
    // that reminder right without it needing to know this feature exists.
    recordExportOffered(at);
    return { state: 'written', at, name: row.name };
  } catch (err) {
    return { state: 'failed', reason: reasonOf(err), name: row.name };
  }
}

function write(row: StoredFileHandle, deps: BackupDeps): Promise<BackupState> {
  if (inFlight !== null) return inFlight;
  const p = writeOnce(row, deps).finally(() => {
    inFlight = null;
  });
  inFlight = p;
  return p;
}

/**
 * What the app does when it is opened: back up if a file is set up and a day has passed.
 *
 * Never asks for anything. There is no tap behind opening the app, so a permission that has lapsed is reported,
 * not requested — `backupStatus` then lets Settings show it and offer the button, which is a tap and may ask.
 */
export async function backupOnOpen(now: Date = new Date(), deps: BackupDeps = defaultBackupDeps): Promise<BackupState> {
  if (!canWriteToAFile()) return { state: 'unsupported' };
  const row = await deps.getHandle().catch(() => undefined);
  if (!row) return { state: 'off' };
  const last = writtenAt(row);
  if (last !== null && !dueAt(last, now)) return { state: 'not-due', at: last, name: row.name };
  if (!(await mayWrite(row.handle))) return { state: 'needs-permission', name: row.name };
  return write(row, deps);
}

/**
 * Back up now because the owner asked. Call from a tap.
 *
 * Ignores the once-a-day rule: that rule exists so the app does not write behind their back, and this is not
 * behind their back. Takes no moment, because the only moment worth recording is the one the write ends at.
 * May ask for permission, which is why it needs the tap.
 */
export async function backupNow(deps: BackupDeps = defaultBackupDeps): Promise<BackupState> {
  if (!canWriteToAFile()) return { state: 'unsupported' };
  const row = await deps.getHandle().catch(() => undefined);
  if (!row) return { state: 'off' };
  if (!(await mayWrite(row.handle)) && !(await askToWrite(row.handle))) {
    return { state: 'needs-permission', name: row.name };
  }
  return write(row, deps);
}

/**
 * Ask the owner where the backup should live, then write it once so they can see that it worked.
 *
 * The new row carries no `lastWrittenAt`, so until that first write succeeds the screen says nothing has been
 * written to this file — which is true, whatever had been written to the file it replaced.
 *
 * Returns undefined when they closed the picker without choosing: a cancel is not an error and must not be
 * reported as one. Call from a tap.
 */
export async function chooseBackupFile(now: Date = new Date(), deps: BackupDeps = defaultBackupDeps): Promise<BackupState | undefined> {
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (typeof picker !== 'function') return { state: 'unsupported' };
  let handle: FileSystemFileHandle;
  try {
    handle = await picker({
      suggestedName: 'food-diary-backup.json',
      types: [{ description: 'Food diary backup', accept: { 'application/json': ['.json'] } }],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return undefined;
    return { state: 'failed', reason: reasonOf(err), name: '' };
  }
  const row: StoredFileHandle = { id: HANDLE_ID, handle, name: handle.name, chosenAt: now.toISOString() };
  try {
    await deps.putHandle(row);
  } catch (err) {
    return { state: 'failed', reason: reasonOf(err), name: handle.name };
  }
  return write(row, deps);
}

/** Forget the file. The file itself is left exactly where it is, holding the last backup written to it. */
export async function stopFileBackup(deps: BackupDeps = defaultBackupDeps): Promise<void> {
  await deps.deleteHandle();
}

/** Everything the screen needs to describe the backup truthfully, including whether it can still run. */
export type BackupStatus =
  | { kind: 'unsupported' }
  | { kind: 'off' }
  | { kind: 'ready'; name: string; lastWrittenAt: Date | null }
  /** A file is set up, but the browser will ask before the app may write again, so opening it does nothing. */
  | { kind: 'blocked'; name: string; lastWrittenAt: Date | null };

/**
 * What is actually true right now, permission included.
 *
 * Settings calls this rather than reading the stored row alone, because the row cannot tell it that the browser
 * has quietly stopped allowing the writes. Without this the screen would keep showing an old date beside "it
 * happens when you open the app", and the owner would only find out by noticing the date had stopped moving.
 * `queryPermission` reports without prompting, so this is safe to call when a screen appears.
 */
export async function backupStatus(deps: BackupDeps = defaultBackupDeps): Promise<BackupStatus> {
  if (!canWriteToAFile()) return { kind: 'unsupported' };
  const row = await deps.getHandle().catch(() => undefined);
  if (!row) return { kind: 'off' };
  const lastWrittenAt = writtenAt(row);
  return (await mayWrite(row.handle))
    ? { kind: 'ready', name: row.name, lastWrittenAt }
    : { kind: 'blocked', name: row.name, lastWrittenAt };
}
