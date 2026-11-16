import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addEntry, allEntriesIncludingTombstones, eraseEverything, getProfile, lsKey, putProfile } from '@/data/db';
import { computeTargets } from '@/domain/targets';
import { clearApiKey, getApiKey, setApiKey } from '@/state/aiSettings';
import type { DiaryEntry } from '@/types/diary';
import type { Profile } from '@/types/profile';
import App from '@/App';
import FirstRun from '@/ui/screens/FirstRun';
import Log from '@/ui/screens/Log';
import Settings from '@/ui/screens/Settings';
import { ownerProfile } from '../fixtures/profile';

beforeEach(async () => {
  await eraseEverything();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearApiKey();
});

const click = async (name: RegExp | string) => {
  const b = await screen.findByRole('button', { name });
  await act(async () => {
    fireEvent.click(b);
  });
};
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('first run', () => {
  test('asks for body data with nothing prefilled', () => {
    render(<FirstRun onDone={() => {}} />);
    for (const label of [/height/i, /date of birth/i, /weight/i]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
    }
    expect(screen.getByLabelText(/sex/i)).toHaveValue('');
    expect(screen.getByLabelText(/activity/i)).toHaveValue('');
  });

  test('saves a complete profile with today as the first weight, and refuses an incomplete one', async () => {
    const done = vi.fn();
    render(<FirstRun onDone={done} />);
    await click(/save/i);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await getProfile()).toBeNull();
    type(/height/i, '180');
    type(/date of birth/i, '1990-05-05');
    type(/sex/i, 'female');
    type(/activity/i, 'moderate');
    type(/weight/i, '70.5');
    await click(/save/i);
    await waitFor(() => expect(done).toHaveBeenCalled());
    const p = await getProfile();
    expect(p).toMatchObject({ heightCm: 180, dob: '1990-05-05', sex: 'female', activityLevel: 'moderate' });
    expect(p?.weightLog).toHaveLength(1);
    expect(p?.weightLog[0]?.kg).toBe(70.5);
    expect(computeTargets(p, new Date()).isGeneric).toBe(false);
  });

  test('can be skipped, and the app then opens on the log with no profile', async () => {
    render(<App />);
    await click(/skip|not now|later/i);
    expect(await screen.findByRole('heading', { name: /what did you eat/i })).toBeInTheDocument();
    expect(await getProfile()).toBeNull();
  });

  test('is shown until it is done or skipped, and not once a profile exists', async () => {
    render(<App />);
    expect(await screen.findByLabelText(/date of birth/i)).toBeInTheDocument();
    cleanup();
    await putProfile(ownerProfile);
    render(<App />);
    expect(await screen.findByRole('heading', { name: /what did you eat/i })).toBeInTheDocument();
  });
});

describe('the app before setup', () => {
  test('works with generic targets and says so on the warning gate', async () => {
    const { defaultDeps } = await import('@/state/useEntryFlow');
    const { loadFoods, resetFoodRepository } = await import('@/data/foodRepository');
    const fromDisk = (async (url: string) => {
      const rel = String(url).replace(import.meta.env.BASE_URL, '');
      const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
      return { ok: true, status: 200, text: async () => body } as Response;
    }) as typeof fetch;
    resetFoodRepository();
    await loadFoods(fromDisk);
    expect(await getProfile()).toBeNull();
    render(<Log deps={{ ...defaultDeps, loadData: () => loadFoods(fromDisk) }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'six hot dogs' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^log$/i }));
    });
    expect((await screen.findAllByTestId('warning-card')).length).toBeGreaterThan(0);
    expect(screen.getByText(/general (adult )?guidelines/i)).toBeInTheDocument();
  }, 60_000);
});

describe('no personal value in the source tree', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }
  test('nothing the guard script forbids appears in src, the manifest or index.html', () => {
    const root = resolve(__dirname, '../..');
    // The forbidden pattern lives in one place, the guard script, so this test never restates a personal value. We ask
    // the script for it rather than reading its text: the script assembles the values from fragments so that it does
    // not itself put them in the public tree, which means they cannot be recovered by matching on a literal.
    const source = execFileSync('bash', [join(root, 'scripts/check-no-secrets.sh'), '--print-pattern'], {
      encoding: 'utf8',
    }).trim();
    expect(source).toBeTruthy();
    const forbidden = new RegExp(source as string);
    const files = [
      ...walk(join(root, 'src')),
      ...walk(join(root, 'public')).filter((f) => /manifest|\.svg$/.test(f)),
      join(root, 'index.html'),
    ];
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((f) => forbidden.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  test('first run has no value baked in: every field starts empty', () => {
    render(<FirstRun />);
    for (const el of screen.getAllByRole('spinbutton')) expect((el as HTMLInputElement).value).toBe('');
  });
});

describe('settings: the DeepSeek key', () => {
  test('the field is masked, and a saved key can be cleared', async () => {
    render(<Settings />);
    expect(screen.getByLabelText(/deepseek api key/i)).toHaveAttribute('type', 'password');
    type(/deepseek api key/i, 'test-key-abcd1234');
    await click(/save key/i);
    expect(getApiKey()).toBe('test-key-abcd1234');
    expect(document.body.textContent).not.toContain('abcd');
    await click(/clear key/i);
    expect(getApiKey()).toBeNull();
    expect(screen.getByLabelText(/deepseek api key/i)).toHaveAttribute('type', 'password');
  });

  test('states the privacy consequence before the fallback can be enabled', () => {
    render(<Settings />);
    expect(screen.getByText(/sent to deepseek/i)).toBeInTheDocument();
    expect(screen.getByText(/never sent/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /use deepseek/i })).not.toBeInTheDocument();
  });
});

describe('settings: body data, weight log, allergens, conditions, overrides', () => {
  test('without a profile it offers setup, with nothing prefilled', async () => {
    render(<Settings />);
    expect((await screen.findAllByText(/general adult guidelines/i)).length).toBeGreaterThan(0);
    expect((screen.getByLabelText(/height/i) as HTMLInputElement).value).toBe('');
  });

  test('edits body data and activity level, keeping the weight log', async () => {
    await putProfile(ownerProfile);
    render(<Settings />);
    await screen.findByDisplayValue('180');
    type(/activity/i, 'active');
    type(/height/i, '181');
    await click(/save body data/i);
    await waitFor(async () => expect((await getProfile())?.activityLevel).toBe('active'));
    expect((await getProfile())?.heightCm).toBe(181);
    expect((await getProfile())?.weightLog).toEqual(ownerProfile.weightLog);
  });

  test('the weight log shows history and each measurement can be corrected or removed', async () => {
    const p: Profile = { ...ownerProfile, weightLog: [{ date: '2026-01-01', kg: 90 }, { date: '2026-02-01', kg: 88 }] };
    await putProfile(p);
    render(<Settings />);
    const list = await screen.findByRole('list', { name: /weight history/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.change(within(list).getByLabelText(/^weight on 2026-02-01/i), { target: { value: '87.5' } });
    await click(/save weight on 2026-02-01/i);
    await waitFor(async () => expect((await getProfile())?.weightLog.find((w) => w.date === '2026-02-01')?.kg).toBe(87.5));
    await click(/remove weight on 2026-01-01/i);
    await waitFor(async () => expect((await getProfile())?.weightLog.map((w) => w.date)).toEqual(['2026-02-01']));
  });

  test('refuses to remove the only weight, because targets need one', async () => {
    await putProfile(ownerProfile);
    render(<Settings />);
    expect(await screen.findByRole('button', { name: /remove weight on 2026-01-01/i })).toBeDisabled();
  });

  test('adds a weight for a date', async () => {
    await putProfile(ownerProfile);
    render(<Settings />);
    await screen.findByRole('list', { name: /weight history/i });
    type(/new weight date/i, '2026-03-01');
    type(/new weight \(kg\)/i, '99.2');
    await click(/add weight/i);
    await waitFor(async () => expect((await getProfile())?.weightLog).toHaveLength(2));
  });

  test('a flagged allergen the app has no tags for is reported as unchecked, not ignored', async () => {
    await putProfile(ownerProfile);
    render(<Settings />);
    await screen.findByLabelText(/add allergen/i);
    type(/add allergen/i, 'peanuts');
    await click(/^add allergen$/i);
    await waitFor(async () => expect((await getProfile())?.flaggedAllergens).toEqual(['peanuts']));
    expect(screen.queryByText(/no tags for/i)).not.toBeInTheDocument();
    type(/add allergen/i, 'kiwi');
    await click(/^add allergen$/i);
    const note = await screen.findByText(/no tags for .kiwi./i);
    expect(note.textContent).toMatch(/could not check|will say so|reported/i);
    await click(/remove allergen peanuts/i);
    await waitFor(async () => expect((await getProfile())?.flaggedAllergens).toEqual(['kiwi']));
  });

  test('conditions are added', async () => {
    await putProfile(ownerProfile);
    render(<Settings />);
    await screen.findByLabelText(/add condition/i);
    type(/add condition/i, 'hypertension');
    await click(/^add condition$/i);
    await waitFor(async () => expect((await getProfile())?.conditions).toEqual(['hypertension']));
  });

  test('target overrides: set one, and clearing it returns to the calculated figure', async () => {
    await putProfile(ownerProfile);
    render(<Settings />);
    await screen.findByLabelText(/protein.*override/i);
    type(/protein.*override/i, '95');
    await click(/save overrides/i);
    await waitFor(async () => expect((await getProfile())?.overrides?.proteinG).toBe(95));
    type(/protein.*override/i, '');
    await click(/save overrides/i);
    await waitFor(async () => expect((await getProfile())?.overrides?.proteinG).toBeUndefined());
  });

  test('an override that is not a positive number is refused and nothing is saved', async () => {
    await putProfile(ownerProfile);
    render(<Settings />);
    await screen.findByLabelText(/protein.*override/i);
    type(/protein.*override/i, '-3');
    await click(/save overrides/i);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect((await getProfile())?.overrides).toBeUndefined();
  });
});

describe('allergens without body data', () => {
  test('an allergen can be flagged with no body data, and a food carrying it then raises the CRITICAL card', async () => {
    const { defaultDeps } = await import('@/state/useEntryFlow');
    const { loadFoods, resetFoodRepository } = await import('@/data/foodRepository');
    const fromDisk = (async (url: string) => {
      const rel = String(url).replace(import.meta.env.BASE_URL, '');
      const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
      return { ok: true, status: 200, text: async () => body } as Response;
    }) as typeof fetch;
    resetFoodRepository();
    await loadFoods(fromDisk);

    render(<Settings />);
    await screen.findByLabelText(/add allergen/i);
    type(/add allergen/i, 'peanuts');
    await click(/^add allergen$/i);
    await waitFor(async () => expect((await getProfile())?.flaggedAllergens).toEqual(['peanuts']));
    const p = await getProfile();
    expect(p?.heightCm).toBeUndefined();
    expect(p?.dob).toBeUndefined();
    expect(computeTargets(p, new Date()).isGeneric).toBe(true);
    // The body form is still empty and still offered.
    expect((screen.getByLabelText(/height/i) as HTMLInputElement).value).toBe('');
    cleanup();

    render(<Log deps={{ ...defaultDeps, loadData: () => loadFoods(fromDisk) }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'peanut brittle' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^log$/i }));
    });
    const cards = await screen.findAllByTestId('warning-card');
    expect(cards.some((c) => c.getAttribute('data-level') === 'CRITICAL')).toBe(true);
  }, 60_000);

  test('body data entered afterwards keeps the flagged allergens', async () => {
    await putProfile({ weightLog: [], flaggedAllergens: ['peanuts'], conditions: ['x'] });
    render(<Settings />);
    await screen.findByLabelText(/height/i);
    type(/height/i, '180');
    type(/date of birth/i, '1990-05-05');
    type(/sex/i, 'female');
    type(/activity/i, 'moderate');
    type(/^weight/i, '70');
    await click(/save body data/i);
    await waitFor(async () => expect((await getProfile())?.heightCm).toBe(180));
    const p = await getProfile();
    expect(p?.flaggedAllergens).toEqual(['peanuts']);
    expect(p?.conditions).toEqual(['x']);
    expect(p?.weightLog).toHaveLength(1);
  });
});

describe('settings: erase everything', () => {
  const seed = async () => {
    await putProfile(ownerProfile);
    setApiKey('test-key-abcd1234');
    const e: DiaryEntry = {
      id: 'e1', at: new Date().toISOString(), rawText: 'x', resolution: 'local', items: [], nutrients: {}, coverage: {},
      classification: {
        processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
        refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
      },
      warningsShown: [], userAction: 'added', state: 'active',
    };
    await addEntry(e);
  };

  test('is confirmed before it runs, and says it cannot be undone', async () => {
    await seed();
    render(<Settings />);
    await click(/^erase everything$/i);
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(await allEntriesIncludingTombstones()).toHaveLength(1);
    await click(/cancel/i);
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
    expect(await allEntriesIncludingTombstones()).toHaveLength(1);
    expect(await getProfile()).not.toBeNull();
  });

  test('confirming erases the diary, the profile and the key', async () => {
    await seed();
    const erased = vi.fn();
    render(<Settings onErased={erased} />);
    await click(/^erase everything$/i);
    await click(/yes, erase everything/i);
    await waitFor(() => expect(erased).toHaveBeenCalled());
    expect(await allEntriesIncludingTombstones()).toHaveLength(0);
    expect(await getProfile()).toBeNull();
    expect(getApiKey()).toBeNull();
    expect(await screen.findByText(/everything has been erased/i)).toBeInTheDocument();
  });

  test('a failed sweep is shown as an error, never as success', async () => {
    await seed();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    render(<Settings />);
    await click(/^erase everything$/i);
    await click(/yes, erase everything/i);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/did not complete|could not|not be (fully )?erased|failed/i);
    expect(screen.queryByText(/everything has been erased/i)).not.toBeInTheDocument();
    vi.restoreAllMocks();
    expect(localStorage.getItem(lsKey('profile'))).not.toBeNull();
  });
});

describe('settings: backup', () => {
  test('offers export and an import with an explicit merge or replace choice, warning before replace', () => {
    render(<Settings />);
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/import file/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /merge/i })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /replace/i }));
    expect(screen.getByText(/replaces everything/i)).toBeInTheDocument();
  });

  test('a malformed file shows an error and changes nothing', async () => {
    await putProfile(ownerProfile);
    render(<Settings />);
    const input = screen.getByLabelText(/import file/i);
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['{oops'], 'd.json')] } });
    });
    await click(/^import$/i);
    expect((await screen.findByRole('alert')).textContent).toMatch(/nothing was changed/i);
    expect(await getProfile()).toEqual(ownerProfile);
  });
});

describe('settings: data source and what cannot be checked', () => {
  test('shows the dataset citation and release from meta.json, and says trans fat cannot be checked', async () => {
    const meta = { citation: 'USDA FoodData Central. Public domain, CC0 1.0 Universal.', fdcRelease: 'FNDDS 2021-2023 test release', count: 5431, file: 'x.json' };
    vi.stubGlobal('fetch', (async () => ({ ok: true, status: 200, text: async () => JSON.stringify(meta) })) as unknown as typeof fetch);
    render(<Settings />);
    const box = await screen.findByTestId('data-source');
    await waitFor(() => expect(box.textContent).toMatch(/CC0 1\.0/));
    expect(box.textContent).toMatch(/FNDDS 2021-2023 test release/);
    expect(screen.getByTestId('trans-fat-limit').textContent).toMatch(/cannot check trans fat/i);
    vi.unstubAllGlobals();
  });

  test('the barcode section names Open Food Facts, its licence, and what a lookup sends', async () => {
    render(<Settings />);
    const box = await screen.findByTestId('off-source');
    const text = box.textContent ?? '';
    expect(text).toMatch(/Open Food Facts/);
    expect(text).toMatch(/Open Database Licen[cs]e|ODbL/i);
    expect(box.querySelector('a[href*="opendatacommons.org"]')).not.toBeNull();
    // the privacy disclosure, in the spirit of the DeepSeek one above it
    expect(text).toMatch(/only the barcode/i);
    expect(text).toMatch(/not .*(your diary|diary).*(profile|totals)|diary, your profile/i);
    // and the two standing rulings
    expect(text).toMatch(/added sugar/i);
    expect(text).toMatch(/allergen/i);
    expect(text).not.toMatch(/allergen-free/i);
  });
});

describe('erasing from inside the app', () => {
  test('an erase mid-session returns to first run', async () => {
    await putProfile(ownerProfile);
    render(<App />);
    await screen.findByRole('heading', { name: /what did you eat/i });
    await click(/^settings$/i);
    await click(/^erase everything$/i);
    await click(/yes, erase everything/i);
    // Settings also has a date-of-birth field, so wait for Settings itself to go before looking for first run's.
    await waitFor(() => expect(screen.queryByRole('heading', { name: /^settings$/i })).not.toBeInTheDocument(), { timeout: 5000 });
    expect(await screen.findByLabelText(/date of birth/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip|not now|later/i })).toBeInTheDocument();
  });
});

describe('appearance setting', () => {
  test('defaults to System, saves a choice, applies the dark class, and an erase puts it back', async () => {
    render(<Settings />);
    const radio = (n: string) => screen.getByRole('radio', { name: n }) as HTMLInputElement;
    expect(radio('System').checked).toBe(true);
    fireEvent.click(radio('Dark'));
    expect(localStorage.getItem(lsKey('theme'))).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(radio('Light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(radio('Dark'));
    await act(async () => { await eraseEverything(); });
    expect(localStorage.getItem(lsKey('theme'))).toBeNull();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
