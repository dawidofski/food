import { deleteFileHandle, getFileHandle, lsKey, putFileHandle, type StoredFileHandle } from '@/data/db';
import { exportAll } from '@/data/exportImport';
import { recordExportOffered } from '@/state/backupReminder';

/**
 * The automatic backup: one file on the device, overwritten with the latest diary, at most once a day.
 *
 * This is the first thing in the app that can honestly say the diary was **backed up** rather than merely
 * offered. A download hands a file to the browser and then knows nothing — it may have been cancelled, or saved
 * somewhere the browser can clear. Writing through a handle the owner picked either finishes or throws, and what
 * it writes is a real file at a place they chose. So the stamp here records a completed write, and nothing
 * records it unless `close()` returned.
 *
 * Two things this deliberately does NOT do, because it cannot:
 *
 * - **Run when the app is shut.** Nothing can wake a web page. The backup happens when the app is opened, which
 *   is why the screen says "when you open the app" and never "every day".
 * - **Keep its own permission.** The browser owns that. On Android a write permission granted today may be back
 *   to asking tomorrow, and re-asking needs a tap — so when the permission has lapsed this reports that plainly
 *   instead of failing quietly or pretending a backup happened.
 */

/** There is one automatic backup file, so one handle. */
const HANDLE_ID = 'autoBackup';

/**
 * The seam to the store and to the export, as every other part of this app has one.
 *
 * It is here for a reason beyond habit: a real `FileSystemFileHandle` is a platform object, and nothing a test
 * can build will survive being put through IndexedDB's structured clone. Without this seam the only way to
 * exercise "the write failed, so record nothing" would be to not exercise it.
 */
export type BackupDeps = {
  getHandle: () => Promise<StoredFileHandle | undefined>;
  putHandle: (row: StoredFileHandle) => Promise<void>;
  deleteHandle: () => Promise<void>;
  exportAll: () => Promise<Blob>;
};

export const defaultBackupDeps: BackupDeps = {
  getHandle: () => getFileHandle(HANDLE_ID),
  putHandle: putFileHandle,
  deleteHandle: () => deleteFileHandle(HANDLE_ID),
  exportAll,
};

/** Written only after a completed write. Through `lsKey`, so erasing the app sweeps it without being told. */
export const LAST_FILE_BACKUP_KEY = lsKey('lastFileBackupAt');

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

/** True when this browser can write to a file the owner picks. Chrome for Android can; Firefox cannot. */
export function canWriteToAFile(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showSaveFilePicker === 'function';
}

function readStamp(): Date | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LAST_FILE_BACKUP_KEY);
  } catch {
    return null; // Storage blocked: the same position as never having backed up.
  }
  if (raw === null || raw === '') return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

/** When the backup file was last actually written, or null: never, unreadable, or storage blocked. */
export function getLastFileBackupAt(): Date | null {
  return readStamp();
}

function recordWritten(at: Date): void {
  try {
    localStorage.setItem(LAST_FILE_BACKUP_KEY, at.toISOString());
  } catch {
    /* Not remembered, so it backs up again sooner than needed. The harmless direction. */
  }
  // A completed write is a copy made, which is exactly what the weekly reminder watches for. Recording it here
  // keeps that reminder quiet without it needing to know this feature exists.
  recordExportOffered(at);
}

/**
 * A stamp more than a day ahead of now is a wrong value, not clock drift, and is ignored — otherwise a nonsense
 * date could switch the backup off for years in silence. Settings prints the stored date, so it stays visible.
 */
function dueAt(stamp: Date | null, now: Date): boolean {
  if (stamp === null) return true;
  if (stamp.getTime() - now.getTime() > DAY_MS) return true;
  return now.getTime() - stamp.getTime() >= BACKUP_INTERVAL_MS;
}

export type BackupState =
  /** Written just now. */
  | { state: 'written'; at: Date; name: string }
  /** A file is set up and was written recently enough; nothing to do. */
  | { state: 'not-due'; at: Date; name: string }
  /** No file has been chosen yet. */
  | { state: 'off' }
  /** This browser cannot write to a file at all. */
  | { state: 'unsupported' }
  /** A file is set up but the browser is no longer letting the app write to it without being asked. */
  | { state: 'needs-permission'; name: string }
  /** Something went wrong. `reason` is for the person, not a stack trace. */
  | { state: 'failed'; reason: string; name: string };

type PermissionCapable = FileSystemFileHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

/**
 * Whether the app may write through this handle right now.
 *
 * A browser without these methods (they are not in every implementation) is treated as granted: the write itself
 * is the real test, and it throws if it is not allowed. Guessing "denied" here would turn a working backup off.
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

const reasonOf = (err: unknown): string => {
  if (err instanceof DOMException && err.name === 'NotFoundError') {
    return 'that file is not there any more — it may have been moved or deleted';
  }
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'the browser did not allow the write';
  }
  return err instanceof Error ? err.message : String(err);
};

/**
 * Overwrites the chosen file with the whole diary.
 *
 * `createWritable` does not touch the existing file: the browser writes to a scratch file and only puts it in
 * place when `close()` returns. So a write that fails part-way leaves yesterday's backup intact, which matters
 * when the file being replaced is the only copy there is.
 */
async function write(row: { handle: FileSystemFileHandle; name: string }, now: Date, deps: BackupDeps): Promise<BackupState> {
  try {
    const blob = await deps.exportAll();
    const w = await row.handle.createWritable();
    try {
      await w.write(blob);
    } catch (err) {
      await w.abort().catch(() => undefined);
      throw err;
    }
    await w.close();
    recordWritten(now);
    return { state: 'written', at: now, name: row.name };
  } catch (err) {
    return { state: 'failed', reason: reasonOf(err), name: row.name };
  }
}

/**
 * What the app does when it is opened: back up if a file is set up and a day has passed.
 *
 * Never asks for anything. There is no tap behind opening the app, so a permission that has lapsed is reported,
 * not requested — the screen then offers the owner a button, which is a tap and may ask.
 */
export async function backupOnOpen(now: Date = new Date(), deps: BackupDeps = defaultBackupDeps): Promise<BackupState> {
  if (!canWriteToAFile()) return { state: 'unsupported' };
  const row = await deps.getHandle().catch(() => undefined);
  if (!row) return { state: 'off' };
  const last = readStamp();
  if (last !== null && !dueAt(last, now)) return { state: 'not-due', at: last, name: row.name };
  if (!(await mayWrite(row.handle))) return { state: 'needs-permission', name: row.name };
  return write(row, now, deps);
}

/**
 * Back up now because the owner asked. Call from a tap.
 *
 * Ignores the once-a-day rule: that rule exists so the app does not write behind their back, and this is not
 * behind their back. May ask for permission, which is why it needs the tap.
 */
export async function backupNow(now: Date = new Date(), deps: BackupDeps = defaultBackupDeps): Promise<BackupState> {
  if (!canWriteToAFile()) return { state: 'unsupported' };
  const row = await deps.getHandle().catch(() => undefined);
  if (!row) return { state: 'off' };
  if (!(await mayWrite(row.handle)) && !(await askToWrite(row.handle))) {
    return { state: 'needs-permission', name: row.name };
  }
  return write(row, now, deps);
}

/**
 * Ask the owner where the backup should live, then write it once so they can see that it worked.
 *
 * Returns undefined when they closed the picker without choosing — a cancel is not an error and must not be
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
  const row = { id: HANDLE_ID, handle, name: handle.name, chosenAt: now.toISOString() };
  try {
    await deps.putHandle(row);
  } catch (err) {
    return { state: 'failed', reason: reasonOf(err), name: handle.name };
  }
  return write(row, now, deps);
}

/** Forget the file. The file itself is left exactly where it is, holding the last backup written to it. */
export async function stopFileBackup(deps: BackupDeps = defaultBackupDeps): Promise<void> {
  await deps.deleteHandle();
}

/** The file currently set up, or undefined. */
export async function currentBackupFile(deps: BackupDeps = defaultBackupDeps): Promise<{ name: string; chosenAt: string } | undefined> {
  const row = await deps.getHandle().catch(() => undefined);
  return row ? { name: row.name, chosenAt: row.chosenAt } : undefined;
}
