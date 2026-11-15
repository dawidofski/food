import { beforeEach, expect, test, vi } from 'vitest';
import fixture from '../fixtures/foods.fixture.json';
import {
  datasetState,
  getFood,
  loadFoods,
  resetFoodRepository,
  searchFoods,
} from '@/data/foodRepository';

const FILE = 'foods.test123.json';

function res(body: string, ok = true, status = 200) {
  return { ok, status, text: async () => body, json: async () => JSON.parse(body) } as unknown as Response;
}

/** Serves meta.json then the hash-named foods file. */
function datasetFetch(foodsBody: string = JSON.stringify(fixture)) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('data/meta.json')) return res(JSON.stringify({ file: FILE }));
    if (url.endsWith(`data/${FILE}`)) return res(foodsBody);
    return res('', false, 404);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

async function loadFixture() {
  await loadFoods(datasetFetch());
}

beforeEach(() => resetFoodRepository());

test('searchFoods ranks an exact name first', async () => {
  await loadFixture();
  const hits = searchFoods('frankfurter');
  expect(hits[0]!.food.name).toMatch(/frankfurter/i);
  expect(hits[0]!.score).toBeLessThanOrEqual(0.25);
});

test('searchFoods matches a synonym', async () => {
  await loadFixture();
  const hits = searchFoods('hot dog');
  expect(hits[0]!.food.name).toMatch(/frankfurter/i);
  expect(hits[0]!.score).toBeLessThanOrEqual(0.25);
});

test('searchFoods respects limit and getFood finds by id', async () => {
  await loadFixture();
  expect(searchFoods('a', 1).length).toBeLessThanOrEqual(1);
  expect(getFood('f-apple')?.name).toBe('Apple, raw');
  expect(getFood('nope')).toBeUndefined();
});

test('a failed fetch leaves the app in a failed state, not a throw', async () => {
  await loadFoods(() => Promise.reject(new Error('offline')) as any);
  expect(datasetState()).toBe('failed');
  expect(searchFoods('anything')).toEqual([]);
  expect(getFood('x')).toBeUndefined();
});

test('truncated json is treated as a failed load', async () => {
  await loadFoods(datasetFetch('[{"id":"1",'));
  expect(datasetState()).toBe('failed');
});

test('a non-200 response is a failed load', async () => {
  await loadFoods((async () => res('nope', false, 404)) as any);
  expect(datasetState()).toBe('failed');
});

test('a foods file that is valid json but not an array is a failed load', async () => {
  await loadFoods(datasetFetch('{"foo":1}'));
  expect(datasetState()).toBe('failed');
});

test('meta.json without a file field is a failed load', async () => {
  const f = vi.fn(async () => res(JSON.stringify({ count: 3 })));
  await loadFoods(f as any);
  expect(datasetState()).toBe('failed');
  expect(f).toHaveBeenCalledTimes(1);
});

test('loadFoods is idempotent and fetches once per file', async () => {
  const spy = datasetFetch();
  await loadFoods(spy);
  await loadFoods(spy);
  expect(datasetState()).toBe('ready');
  expect(spy).toHaveBeenCalledTimes(2); // meta.json + foods file, once
});

test('concurrent loadFoods calls share one load', async () => {
  const spy = datasetFetch();
  await Promise.all([loadFoods(spy), loadFoods(spy)]);
  expect(spy).toHaveBeenCalledTimes(2); // meta.json + foods file, not 4
  expect(datasetState()).toBe('ready');
});

test('fetch URLs are built from BASE_URL without double slashes', async () => {
  const spy = datasetFetch();
  await loadFoods(spy);
  const urls = spy.mock.calls.map((c: unknown[]) => String(c[0]));
  expect(urls[0]).toBe(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}data/meta.json`);
  expect(urls[1]).toBe(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}data/${FILE}`);
  for (const u of urls) expect(u.replace('://', '')).not.toContain('//');
});
