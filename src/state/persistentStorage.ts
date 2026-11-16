import { lsKey } from '@/data/db';

/**
 * What the browser will and will not promise about keeping this app's data.
 *
 * `navigator.storage.persist()` asks the browser to exempt this origin from eviction under storage pressure. It is
 * absent in some browsers, resolves `false` in others (Chrome decides from its own engagement heuristics and never
 * asks the user; Firefox may prompt; iOS Safari grants it but still clears data after about seven days without a
 * visit). None of that is knowable from here, so this module does two small things and claims nothing else:
 * it asks ONCE, and it reports back exactly what `persisted()` returned.
 *
 * Everything is feature-detected and wrapped. A browser without the API, or one that rejects, must not throw into
 * the UI, and must not be described as having said anything.
 */

/** Set once `persist()` has been called, so the browser (and on some, the owner) is not asked again. */
export const PERSIST_ASKED_KEY = lsKey('persistenceAskedAt');

/**
 * - `granted`: `persisted()` returned true.
 * - `not-granted`: it returned false.
 * - `unknown`: the browser has no Storage API, or it threw. NOT a synonym for "no".
 */
export type PersistenceState = 'granted' | 'not-granted' | 'unknown';

type MaybeStorageManager = {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
};

function storageManager(): MaybeStorageManager | undefined {
  try {
    if (typeof navigator === 'undefined') return undefined;
    return (navigator as Navigator & { storage?: MaybeStorageManager }).storage;
  } catch {
    return undefined;
  }
}

/** Reports what the browser says, never more. */
export async function persistenceState(): Promise<PersistenceState> {
  try {
    const sm = storageManager();
    if (!sm || typeof sm.persisted !== 'function') return 'unknown';
    return (await sm.persisted()) ? 'granted' : 'not-granted';
  } catch {
    return 'unknown';
  }
}

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(PERSIST_ASKED_KEY) !== null;
  } catch {
    // Storage is blocked, so the fact cannot be remembered either way. Asking again is harmless in every
    // browser that answers without a prompt, and this branch only happens where nothing is remembered at all.
    return false;
  }
}

/**
 * Asks the browser once, ever, to keep this app's data. Resolves whatever happens; the result is deliberately not
 * returned, because `persist()` resolving `false` is not a failure worth reporting and a granted request is not a
 * promise worth repeating to the owner. Settings reads `persisted()` instead, which is the browser's own answer.
 *
 * The "asked" flag is written only when a call was actually made, so a browser that gains the API later still gets
 * asked, and it is stored under the `fd.` prefix so an erase removes it with everything else.
 */
export async function requestPersistenceOnce(at: Date = new Date()): Promise<void> {
  try {
    const sm = storageManager();
    if (!sm || typeof sm.persist !== 'function') return;
    if (alreadyAsked()) return;
    try {
      localStorage.setItem(PERSIST_ASKED_KEY, at.toISOString());
    } catch {
      /* not remembered; the call below still happens */
    }
    await sm.persist();
  } catch {
    /* Rejected, blocked by permissions policy, or not implemented behind the property. Nothing to report. */
  }
}
