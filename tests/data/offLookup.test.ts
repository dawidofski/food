import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { allOffProducts, eraseEverything, getOffProduct } from '@/data/db';
import { OFF_TIMEOUT_MS, fetchOffProduct, offProductUrl } from '@/data/offApi';
import { findScannedProduct, offLookup, offProductMeta, refreshOffFoods } from '@/data/offCache';
import { barcodeProblem, normaliseBarcode } from '@/domain/barcode';
import { coca_cola, lu_prince, not_found } from '../fixtures/off/payloads';

const COLA = '5449000054227';

function okFetch(payload: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }));
}

beforeEach(async () => {
  await eraseEverything();
  await refreshOffFoods();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the barcode itself', () => {
  test('spaces and dashes are stripped', () => {
    expect(normaliseBarcode(' 5449 000-054227 ')).toBe(COLA);
  });

  test('a code with a wrong check digit is refused with a reason, not looked up', () => {
    expect(barcodeProblem(COLA)).toBeNull();
    expect(barcodeProblem('5449000054228')).toMatch(/check/i);
  });

  test('a code of the wrong length or with letters is refused', () => {
    expect(barcodeProblem('12345')).toMatch(/digits/i);
    expect(barcodeProblem('abcdefghijklm')).toMatch(/digits/i);
    expect(barcodeProblem('')).toMatch(/digits/i);
  });

  test('an 8-digit code is accepted without a check-digit test', () => {
    // EAN-8 and UPC-E are both 8 digits and compute their check digit differently, so checking it would
    // refuse valid UPC-E scans. Length and digits only.
    expect(barcodeProblem('20000005')).toBeNull();
  });
});

describe('asking Open Food Facts about one barcode', () => {
  test('the request carries the barcode and nothing else, on the Spanish host', () => {
    const url = offProductUrl(COLA);
    expect(url).toBe(`https://es.openfoodfacts.org/api/v2/product/${COLA}.json`);
    expect(url).not.toContain('?');
  });

  test('a found product is mapped', async () => {
    const fetchImpl = okFetch(coca_cola);
    const r = await fetchOffProduct(COLA, { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => new Date('2026-11-16T19:00:00Z') });
    expect(r.kind).toBe('found');
    if (r.kind === 'found') {
      expect(r.product.name).toBe('Coca-Cola Original Taste');
      expect(r.product.fetchedAt).toBe('2026-11-16T19:00:00.000Z');
    }
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  test('a barcode Open Food Facts does not hold is reported as not found', async () => {
    const r = await fetchOffProduct('8480000598554', { fetchImpl: okFetch(not_found) as unknown as typeof fetch });
    expect(r.kind).toBe('not-found');
  });

  test('being offline is said plainly and makes no request', async () => {
    const fetchImpl = okFetch(coca_cola);
    const r = await fetchOffProduct(COLA, { fetchImpl: fetchImpl as unknown as typeof fetch, isOnline: () => false });
    expect(r.kind).toBe('offline');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a failed request is a plain sentence, never an endless wait', async () => {
    const r = await fetchOffProduct(COLA, { fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') expect(r.reason).toMatch(/could not be reached|internet/i);
  });

  test('a server error is reported with its status', async () => {
    const r = await fetchOffProduct(COLA, { fetchImpl: (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch });
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') expect(r.reason).toMatch(/503/);
  });

  test('a reply that is not JSON is reported, not guessed at', async () => {
    const r = await fetchOffProduct(COLA, { fetchImpl: (async () => new Response('<html>hello</html>', { status: 200 })) as unknown as typeof fetch });
    expect(r.kind).toBe('unusable');
  });

  test('a request that never answers is given up on', async () => {
    const r = await fetchOffProduct(COLA, {
      timeoutMs: 20,
      fetchImpl: ((_u: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })) as unknown as typeof fetch,
    });
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') expect(r.reason).toMatch(/took too long|did not answer/i);
  });

  test('there is a timeout at all, and it is not minutes long', () => {
    expect(OFF_TIMEOUT_MS).toBeGreaterThan(0);
    expect(OFF_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});

describe('the local cache of scanned products', () => {
  test('a fetched product is stored, and a rescan does not fetch again', async () => {
    const fetchImpl = okFetch(coca_cola);
    const first = await findScannedProduct(COLA, { deps: { fetchImpl: fetchImpl as unknown as typeof fetch } });
    expect(first.kind).toBe('found');
    if (first.kind === 'found') expect(first.fromCache).toBe(false);
    expect((await getOffProduct(COLA))?.name).toBe('Coca-Cola Original Taste');

    const second = await findScannedProduct(COLA, { deps: { fetchImpl: fetchImpl as unknown as typeof fetch } });
    expect(second.kind).toBe('found');
    if (second.kind === 'found') expect(second.fromCache).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('asking again on purpose does fetch again, and replaces the stored copy', async () => {
    await findScannedProduct(COLA, { deps: { fetchImpl: okFetch(coca_cola) as unknown as typeof fetch, now: () => new Date('2026-11-16T19:00:00Z') } });
    const fetchImpl = okFetch(coca_cola);
    const again = await findScannedProduct(COLA, {
      refetch: true,
      deps: { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => new Date('2026-11-17T08:00:00Z') },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (again.kind === 'found') expect(again.product.fetchedAt).toBe('2026-11-17T08:00:00.000Z');
    expect((await getOffProduct(COLA))?.fetchedAt).toBe('2026-11-17T08:00:00.000Z');
  });

  test('a cached product is still readable with no network at all', async () => {
    await findScannedProduct(COLA, { deps: { fetchImpl: okFetch(coca_cola) as unknown as typeof fetch } });
    const offline = await findScannedProduct(COLA, { deps: { isOnline: () => false, fetchImpl: okFetch(coca_cola) as unknown as typeof fetch } });
    expect(offline.kind).toBe('found');
  });

  test('a barcode that is not held is not stored and not cached as an empty product', async () => {
    const r = await findScannedProduct('8480000598554', { deps: { fetchImpl: okFetch(not_found) as unknown as typeof fetch } });
    expect(r.kind).toBe('not-found');
    expect(await allOffProducts()).toEqual([]);
  });

  test('a failed fetch stores nothing', async () => {
    const r = await findScannedProduct(COLA, { deps: { fetchImpl: (async () => { throw new TypeError('x'); }) as unknown as typeof fetch } });
    expect(r.kind).toBe('failed');
    expect(await allOffProducts()).toEqual([]);
  });

  test('a scanned product becomes a food the rest of the app can fetch by its barcode', async () => {
    await findScannedProduct(COLA, { deps: { fetchImpl: okFetch(coca_cola) as unknown as typeof fetch } });
    const food = offLookup.get('off', COLA);
    expect(food?.name).toBe('Coca-Cola Original Taste');
    expect(offLookup.get('dataset', COLA)).toBeUndefined();
    expect(offLookup.search('Coca-Cola Original Taste')[0]?.source).toBe('off');
  });

  test('the fetch date and the product’s own last-edit date are both available to show', async () => {
    await findScannedProduct('7622210449283', {
      deps: { fetchImpl: okFetch(lu_prince) as unknown as typeof fetch, now: () => new Date('2026-11-16T19:00:00Z') },
    });
    const meta = offProductMeta('7622210449283');
    expect(meta?.fetchedAt).toBe('2026-11-16T19:00:00.000Z');
    expect(meta?.lastModified).toBe(new Date(1793958244 * 1000).toISOString());
  });

  test('erasing everything clears scanned products and leaves nothing searchable', async () => {
    await findScannedProduct(COLA, { deps: { fetchImpl: okFetch(coca_cola) as unknown as typeof fetch } });
    expect(offLookup.get('off', COLA)).toBeDefined();
    await eraseEverything();
    expect(await allOffProducts()).toEqual([]);
    expect(offLookup.get('off', COLA)).toBeUndefined();
    expect(offLookup.search('Coca-Cola Original Taste')).toEqual([]);
  });
});
