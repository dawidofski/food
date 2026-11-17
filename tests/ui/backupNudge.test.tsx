import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addEntry, countActiveEntries, eraseEverything, lsKey } from '@/data/db';
import { LAST_EXPORT_KEY, NUDGE_DISMISSED_KEY, dismissNudge, recordExportOffered } from '@/state/backupReminder';
import { PERSIST_ASKED_KEY } from '@/state/persistentStorage';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import Diary from '@/ui/screens/Diary';
import Settings from '@/ui/screens/Settings';

/**
 * The backup nudge on the diary, and the two things Settings says about storage. Nothing here is allowed to
 * promise that data is safe: the app can only say a copy was offered, and can only report what the browser says.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-11-16T12:00:00');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

async function seedEntries(n: number, at: Date = NOW): Promise<void> {
  for (let i = 0; i < n; i++) {
    const e: DiaryEntry = {
      id: `e${i}`,
      at: new Date(at.getTime() - i * 1000).toISOString(),
      rawText: `an apple ${i}`,
      resolution: 'local',
      items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
      nutrients: { energyKcal: 52 },
      coverage: { energyKcal: 'known' },
      classification: flags,
      warningsShown: [],
      userAction: 'added',
      state: 'active',
    };
    await addEntry(e);
  }
}

const deps: FlowDeps = { ...defaultDeps, now: () => NOW };
const diary = (at: Date = NOW) => render(<Diary deps={{ ...deps, now: () => at }} />);
/** Lets the diary's two independent reads (entries, entry count) settle before absence is asserted. */
const settle = async () => {
  await screen.findByRole('heading', { name: /^diary$/i });
  await act(async () => {
    await Promise.resolve();
  });
};
const nudge = () => screen.queryByTestId('backup-nudge');
/** Found first, clicked second: a `findBy` inside `act` never settles, because act is holding the update back. */
const press = async (testId: string) => {
  const b = await screen.findByTestId(testId);
  await act(async () => {
    fireEvent.click(b);
  });
};

/**
 * jsdom has no `navigator.storage` at all, which is the "this browser does not say" case for free. A browser that
 * does have one is faked with an own property, removed again afterwards.
 */
function fakeStorageManager(value: unknown): void {
  Object.defineProperty(navigator, 'storage', { value, configurable: true });
}

beforeEach(async () => {
  await eraseEverything();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'storage');
});

describe('the backup nudge: when it appears', () => {
  test('a diary with fewer than twenty entries is left alone', async () => {
    await seedEntries(19);
    diary();
    await settle();
    expect(nudge()).toBeNull();
  });

  test('twenty entries and no copy ever made: the nudge appears', async () => {
    await seedEntries(20);
    diary();
    expect(await screen.findByTestId('backup-nudge')).toBeInTheDocument();
  });

  test('it states the mechanism and the real risk, and never says the data is safe', async () => {
    await seedEntries(20);
    diary();
    const panel = await screen.findByTestId('backup-nudge');
    expect(panel.textContent).toMatch(/stored only in this browser/i);
    expect(panel.textContent).toMatch(/site data/i);
    expect(panel.textContent).toMatch(/only way back/i);
    expect(panel.textContent).not.toMatch(/safe|backed up|protected|\d+ days/i);
    expect(panel.querySelector('[data-testid="nudge-export"]')).toBeInTheDocument();
  });

  test('it is on the diary and not on the log, so logging is never interrupted', async () => {
    await seedEntries(20);
    const { default: Log } = await import('@/ui/screens/Log');
    render(<Log deps={{ ...deps, loadData: async () => {}, isDataReady: () => true }} />);
    await screen.findByRole('heading', { name: /what did you eat/i });
    await act(async () => {
      await Promise.resolve();
    });
    expect(nudge()).toBeNull();
  });

  test('an export ten days ago hides it; one thirty-one days ago shows it again', async () => {
    await seedEntries(20);
    recordExportOffered(ago(10));
    diary();
    await settle();
    expect(nudge()).toBeNull();
    cleanup();

    recordExportOffered(ago(31));
    diary();
    expect(await screen.findByTestId('backup-nudge')).toBeInTheDocument();
  });
});

describe('the backup nudge: dismissing it', () => {
  test('dismissing hides it, it stays hidden six days later and returns after seven', async () => {
    await seedEntries(20);
    diary();
    await press('nudge-dismiss');
    expect(nudge()).toBeNull();
    expect(localStorage.getItem(NUDGE_DISMISSED_KEY)).not.toBeNull();
    cleanup();

    diary(new Date(NOW.getTime() + 6 * DAY));
    await settle();
    expect(nudge()).toBeNull();
    cleanup();

    diary(new Date(NOW.getTime() + 7 * DAY));
    expect(await screen.findByTestId('backup-nudge')).toBeInTheDocument();
  });
});

describe('the backup nudge: making the copy', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  test('exporting from the nudge records the date and hides it', async () => {
    await seedEntries(20);
    diary();
    await press('nudge-export');
    await waitFor(() => expect(localStorage.getItem(LAST_EXPORT_KEY)).toBe(NOW.toISOString()));
    await waitFor(() => expect(nudge()).toBeNull());
  });

  test('exporting from Settings records the date too', async () => {
    await seedEntries(1);
    render(<Settings />);
    const b = await screen.findByRole('button', { name: /export everything/i });
    await act(async () => {
      fireEvent.click(b);
    });
    await waitFor(() => expect(localStorage.getItem(LAST_EXPORT_KEY)).not.toBeNull());
  });

  test('an export that fails records nothing', async () => {
    await seedEntries(20);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('download refused');
    });
    diary();
    await press('nudge-export');
    await waitFor(() => expect(screen.getByTestId('backup-nudge').textContent).toMatch(/could not be created/i));
    expect(localStorage.getItem(LAST_EXPORT_KEY)).toBeNull();
  });
});

describe('the backup nudge: storage that refuses to work', () => {
  test('localStorage throwing on read leaves the diary readable', async () => {
    await seedEntries(20);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    diary();
    expect(await screen.findByRole('heading', { name: /^diary$/i })).toBeInTheDocument();
    // Repointed when the day's figures replaced the "N entries" block: the claim is that the day still renders
    // when storage throws, so it is now pinned on the day's figures, which is what the diary shows instead.
    expect(await screen.findByTestId('figures-provenance')).toBeInTheDocument();
    expect(await screen.findByTestId('meal-breakfast')).toBeInTheDocument();
  });

  test('localStorage throwing on write leaves the diary readable and the dismiss working', async () => {
    await seedEntries(20);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    diary();
    await press('nudge-dismiss');
    expect(nudge()).toBeNull();
    expect(screen.getByRole('heading', { name: /^diary$/i })).toBeInTheDocument();
  });

  test('a diary whose entries cannot be counted shows no nudge and still renders', async () => {
    await seedEntries(20);
    const broken: FlowDeps = { ...deps, store: { ...deps.store, countActiveEntries: async () => { throw new Error('no db'); } } };
    render(<Diary deps={broken} />);
    await settle();
    expect(nudge()).toBeNull();
  });
});

describe('persistent storage', () => {
  test('a browser with no navigator.storage: nothing throws and Settings says it does not say', async () => {
    expect((navigator as Navigator & { storage?: unknown }).storage).toBeUndefined();
    await seedEntries(20);
    diary();
    expect(await screen.findByRole('heading', { name: /^diary$/i })).toBeInTheDocument();
    cleanup();

    render(<Settings />);
    expect(await screen.findByTestId('storage-promise')).toHaveTextContent(/does not say/i);
  });

  test('persistence granted and refused are reported in the browser’s own terms', async () => {
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => true);
    fakeStorageManager({ persist, persisted });
    render(<Settings />);
    expect(await screen.findByTestId('storage-promise')).toHaveTextContent(/has agreed to keep/i);
    cleanup();

    persisted.mockImplementation(async () => false);
    render(<Settings />);
    expect(await screen.findByTestId('storage-promise')).toHaveTextContent(/has not promised to keep/i);
  });

  test('persist() is asked for once and never again, and a rejection is swallowed', async () => {
    const persist = vi.fn(async () => {
      throw new Error('refused');
    });
    fakeStorageManager({ persist, persisted: async () => false });
    await seedEntries(1);
    diary();
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(PERSIST_ASKED_KEY)).not.toBeNull();
    cleanup();

    diary();
    await settle();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe('settings: what it says about copies and storage', () => {
  test('with no copy ever made it says so, and never claims anything is backed up', async () => {
    render(<Settings />);
    const line = await screen.findByTestId('last-copy');
    expect(line).toHaveTextContent(/no copy has been made/i);
    expect(line.textContent).not.toMatch(/safe|backed up/i);
  });

  test('after a copy it shows the date and says what the app cannot know', async () => {
    recordExportOffered(new Date('2026-10-05T09:00:00'));
    render(<Settings />);
    const line = await screen.findByTestId('last-copy');
    expect(line).toHaveTextContent(/5 October 2026/);
    expect(line.textContent).toMatch(/cannot tell whether/i);
  });
});

describe('erasing everything', () => {
  test('clears the export stamp, the dismissal and the persistence flag with the rest', async () => {
    recordExportOffered(NOW);
    dismissNudge(NOW);
    localStorage.setItem(PERSIST_ASKED_KEY, NOW.toISOString());
    localStorage.setItem(lsKey('theme'), 'dark');
    await seedEntries(2);
    expect(await countActiveEntries()).toBe(2);

    await eraseEverything();

    expect(localStorage.getItem(LAST_EXPORT_KEY)).toBeNull();
    expect(localStorage.getItem(NUDGE_DISMISSED_KEY)).toBeNull();
    expect(localStorage.getItem(PERSIST_ASKED_KEY)).toBeNull();
    expect(localStorage.getItem(lsKey('theme'))).toBeNull();
    expect(await countActiveEntries()).toBe(0);
  });
});

describe('counting what is in the diary', () => {
  test('counts live rows only: a deleted entry is kept but does not count', async () => {
    await seedEntries(3);
    const { deleteEntry } = await import('@/data/db');
    await deleteEntry('e0');
    expect(await countActiveEntries()).toBe(2);
  });
});
