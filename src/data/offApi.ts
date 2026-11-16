/**
 * One request to Open Food Facts, for one barcode.
 *
 * WHAT LEAVES THE DEVICE: the barcode, in the URL path, and nothing else. No diary, no profile, no targets, no
 * totals, no identifier of any kind. There is no query string, no key, no account and no cookie: the request is
 * sent with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'` so neither a cookie nor this app's address
 * goes with it. Settings says exactly this, as the DeepSeek disclosure does.
 *
 * WHY THE `es.` HOST: `https://es.openfoodfacts.org/api/v2/product/{barcode}.json` is the same API as the `world.`
 * host and returns Spanish field translations. The owner shops in Spain. Verified from a browser on 16 Nov 2026:
 * 200 with working CORS, no proxy and no key. The newer `/api/v2/search` endpoint fails CORS and is not used; a
 * scan gives a barcode, so no search is needed.
 *
 * API ETIQUETTE. Open Food Facts asks clients to identify themselves with a descriptive `User-Agent`. A browser
 * will not let a page set that header, so this app cannot comply that way. What it can do, it does: ONE request
 * per scan, a local cache (`offCache.ts`) so a rescanned product is never fetched twice, and no bulk fetching
 * anywhere, ever.
 */
import { mapOffPayload, type OffLookupResult } from '@/domain/openFoodFacts';

export const OFF_HOST = 'https://es.openfoodfacts.org';

/**
 * A lookup needs the network, and this app is offline-first: a request that hangs must end in a sentence, never in
 * a spinner that never stops. Ten seconds is long enough for a slow phone connection and short enough that the
 * manual-entry fallback is still a reasonable next step.
 */
export const OFF_TIMEOUT_MS = 10_000;

export const offProductUrl = (barcode: string): string => `${OFF_HOST}/api/v2/product/${encodeURIComponent(barcode)}.json`;

export type OffFetchDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  isOnline?: () => boolean;
};

export type OffFetchResult =
  | OffLookupResult
  /** The browser says there is no connection. Nothing was sent. */
  | { kind: 'offline'; reason: string }
  /** The request was made and did not come back usable. Nothing was stored. */
  | { kind: 'failed'; reason: string };

/**
 * Fetches and maps one product. Never throws: every outcome is one of the `kind`s above, each carrying a sentence
 * the screen can show beside an offer of manual entry.
 */
export async function fetchOffProduct(barcode: string, deps: OffFetchDeps = {}): Promise<OffFetchResult> {
  const isOnline = deps.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!isOnline()) {
    return {
      kind: 'offline',
      reason:
        'This device is offline, so Open Food Facts could not be asked about this barcode. Nothing was sent. ' +
        'Try again when you have a connection, or enter the nutrition yourself.',
    };
  }
  const doFetch = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!doFetch) return { kind: 'failed', reason: 'This browser cannot make the request.' };

  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? OFF_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(offProductUrl(barcode), {
      method: 'GET',
      // Nothing of this device goes with the request: no cookie, no address of this app.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!res.ok) {
      return { kind: 'failed', reason: `Open Food Facts answered with an error (${res.status}). Nothing has been saved.` };
    }
    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return { kind: 'unusable', reason: 'Open Food Facts sent a reply this app could not read.' };
    }
    return mapOffPayload(payload, (deps.now ?? (() => new Date()))().toISOString());
  } catch (e) {
    // Read the signal, not the error: a DOMException is not an `Error` in every runtime, and a fetch implementation
    // may reject with anything at all. The signal is the one thing that definitely knows the timer fired.
    const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
    const aborted = controller.signal.aborted || name === 'AbortError' || name === 'TimeoutError';
    return {
      kind: 'failed',
      reason: aborted
        ? `Open Food Facts did not answer within ${Math.round(timeoutMs / 1000)} seconds, so the request took too long and was given up. Nothing has been saved.`
        : 'Open Food Facts could not be reached. Check your internet connection, or enter the nutrition yourself.',
    };
  } finally {
    clearTimeout(timer);
  }
}
