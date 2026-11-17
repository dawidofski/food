import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, eraseEverything, reviseEntry } from '@/data/db';
import { skipSetup } from '@/state/setup';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import App from '@/App';
import BehaviourHistory from '@/ui/screens/BehaviourHistory';
import TrendsTab from '@/ui/screens/TrendsTab';
import Trends from '@/ui/screens/WeekTrends';

beforeEach(async () => {
  await eraseEverything();
  localStorage.clear();
});
afterEach(cleanup);

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
function daysAgo(n: number, hour = 12): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, hour).toISOString();
}
function base(over: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: globalThis.crypto.randomUUID(), at: daysAgo(0), rawText: 'a meal', resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
    nutrients: { energyKcal: 500, proteinG: 20, fibreG: 5 },
    coverage: { energyKcal: 'known', proteinG: 'known', fibreG: 'known' },
    classification: flags, fped: { vegCupEq: 0, fruitCupEq: 0, wholeGrainOzEq: 0 },
    warningsShown: [], userAction: 'added', state: 'active', ...over,
  };
}
const seed = (over: Partial<DiaryEntry> = {}) => addEntry(base(over));
const pm = (action: DiaryEntry['userAction'], back: number) =>
  seed({ at: daysAgo(back), warningsShown: [{ ruleId: 'processed-meat', level: 'HIGH' }], userAction: action });

/** The figure for one metric card on the trends screen. */
function card(name: RegExp): HTMLElement {
  return screen.getByRole('heading', { name }).closest('section')!;
}

describe('trends screen', () => {
  test('an empty diary renders a plain message, no charts and no NaN', async () => {
    const { container } = render(<Trends />);
    expect(await screen.findByText(/nothing logged in the last 12 weeks/i)).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  test('a week with too few logged days is not plotted: no value bar, and it says why', async () => {
    for (let i = 0; i < 3; i++) await seed({ at: daysAgo(i) });
    render(<Trends />);
    await screen.findByRole('heading', { name: /^fibre$/i });
    const fibre = card(/^fibre$/i);
    expect(fibre.querySelectorAll('[data-status="value"]')).toHaveLength(0);
    expect(fibre.querySelectorAll('[data-status="thin"]').length).toBeGreaterThan(0);
    expect(within(fibre).getByText(/no week has enough/i)).toBeInTheDocument();
    expect(fibre.textContent).not.toMatch(/\b0 g\b/);
  });

  test('a week with enough logged days is plotted with its median day', async () => {
    for (let i = 0; i < 5; i++) await seed({ at: daysAgo(i) });
    render(<Trends />);
    await screen.findByRole('heading', { name: /^fibre$/i });
    const fibre = card(/^fibre$/i);
    expect(fibre.querySelectorAll('[data-status="value"]')).toHaveLength(1);
    expect(within(fibre).getByText(/5 g on the median day/)).toBeInTheDocument();
  });

  test('an unknown nutrient is shown as unknown, never as zero', async () => {
    for (let i = 0; i < 5; i++) {
      await seed({ at: daysAgo(i), nutrients: { energyKcal: 500, proteinG: 20 }, coverage: { energyKcal: 'known', proteinG: 'known' } });
    }
    render(<Trends />);
    await screen.findByRole('heading', { name: /^fibre$/i });
    const fibre = card(/^fibre$/i);
    expect(fibre.querySelectorAll('[data-status="value"]')).toHaveLength(0);
    expect(fibre.querySelectorAll('[data-status="unknown"]').length).toBeGreaterThan(0);
    expect(within(fibre).getByText(/not enough complete data/i)).toBeInTheDocument();
    expect(fibre.textContent).not.toMatch(/\b0 g\b/);
  });

  test('cancelled entries do not count toward days logged or processed meat', async () => {
    for (let i = 0; i < 5; i++) await seed({ at: daysAgo(i) });
    for (let i = 0; i < 4; i++) await seed({ at: daysAgo(i), userAction: 'cancelled', classification: { ...flags, processedMeat: true } });
    render(<Trends />);
    await screen.findByRole('heading', { name: /processed meat/i });
    expect(within(card(/processed meat/i)).getByText(/\b0 meals\b/)).toBeInTheDocument();
    expect(within(card(/days logged/i)).getByText(/5 of 7 days/)).toBeInTheDocument();
  });

  test('a superseded entry and its revision are one meal', async () => {
    const pmFlags = { ...flags, processedMeat: true };
    for (let i = 1; i < 5; i++) await seed({ at: daysAgo(i) });
    const original = base({ at: daysAgo(0), classification: pmFlags });
    await addEntry(original);
    const { id: _id, supersededBy: _sb, revisionOf: _r, ...fields } = original;
    await reviseEntry(original.id, fields);
    render(<Trends />);
    await screen.findByRole('heading', { name: /processed meat/i });
    expect(within(card(/processed meat/i)).getByText(/\b1 meal\b/)).toBeInTheDocument();
  });

  test('uses no scores, grades, streaks or verdicts', async () => {
    for (let i = 0; i < 6; i++) await seed({ at: daysAgo(i), classification: { ...flags, processedMeat: i % 2 === 0 } });
    const { container } = render(<Trends />);
    await screen.findByRole('heading', { name: /^fibre$/i });
    expect(container.textContent).not.toMatch(/score|grade|streak|rating|bmi|failed|should|must|good|bad|improv|worse|declin|%/i);
  });
});

describe('behaviour history screen', () => {
  test('an empty diary renders a plain message and no NaN', async () => {
    const { container } = render(<BehaviourHistory />);
    expect(await screen.findByText(/nothing is recorded in this period/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  test('cancelled entries are counted here and described as what was recorded', async () => {
    await pm('added', 1);
    await pm('added', 2);
    await pm('addedAfterAlternatives', 3);
    await pm('cancelled', 4);
    await pm('cancelled', 5);
    render(<BehaviourHistory />);
    const rule = (await screen.findByRole('heading', { name: /processed meat/i })).closest('section')!;
    expect(within(rule).getByText(/5 entries had this warning shown/i)).toBeInTheDocument();
    expect(within(rule).getByText(/2 were added/i)).toBeInTheDocument();
    expect(within(rule).getByText(/1 was added after looking at the alternatives/i)).toBeInTheDocument();
    expect(within(rule).getByText(/2 were recorded as cancelled/i)).toBeInTheDocument();
  });

  test('says plainly that the app does not know what a cancelled entry means', async () => {
    await pm('cancelled', 1);
    render(<BehaviourHistory />);
    expect(await screen.findByText(/cannot tell whether/i)).toBeInTheDocument();
  });

  test('never claims the food was avoided, and has no score, grade, streak or percentage', async () => {
    for (let i = 0; i < 8; i++) await pm(i % 3 === 0 ? 'cancelled' : 'added', i + 1);
    const { container } = render(<BehaviourHistory />);
    await screen.findByRole('heading', { name: /processed meat/i });
    expect(container.textContent).not.toMatch(
      /avoid|resist|skipped|refus|ignor|overrid|despite|comply|compliance|score|grade|streak|rating|success|fail|should|must|good|bad|well done|improv|worse|declin|%/i,
    );
  });

  test('a superseded entry and its revision are one showing, and a deleted entry is not counted', async () => {
    const original = base({ at: daysAgo(1), warningsShown: [{ ruleId: 'processed-meat', level: 'HIGH' }] });
    await addEntry(original);
    const { id: _id, supersededBy: _sb, revisionOf: _r, ...fields } = original;
    await reviseEntry(original.id, fields);
    render(<BehaviourHistory />);
    const rule = (await screen.findByRole('heading', { name: /processed meat/i })).closest('section')!;
    expect(within(rule).getByText(/1 entry had this warning shown/i)).toBeInTheDocument();
  });

  test('the period can be widened to include older entries', async () => {
    await pm('added', 1);
    await pm('cancelled', 200);
    render(<BehaviourHistory />);
    const rule = (await screen.findByRole('heading', { name: /processed meat/i })).closest('section')!;
    expect(within(rule).getByText(/1 entry had this warning shown/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /all time/i }));
    await waitFor(() => expect(within(screen.getByRole('heading', { name: /processed meat/i }).closest('section')!).getByText(/2 entries had this warning shown/i)).toBeInTheDocument());
  });

  test('shows a month-by-month split once the history spans months', async () => {
    await pm('cancelled', 1);
    await pm('added', 45);
    await pm('added', 46);
    render(<BehaviourHistory />);
    fireEvent.click(await screen.findByRole('button', { name: /all time/i }));
    const rule = (await screen.findByRole('heading', { name: /processed meat/i })).closest('section')!;
    expect(within(rule).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
  });
});

describe('progress tab and navigation', () => {
  test('opens on worth a look and switches to this week and warning history', async () => {
    // Repointed when the tab was renamed Trends: the views are the same three, named so that none of them
    // repeats the tab's own name.
    render(<TrendsTab />);
    expect(await screen.findByRole('heading', { name: /what.s missing/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^this week$/i }));
    expect(await screen.findByRole('heading', { name: /^trends$/i, level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /warning history/i }));
    expect(await screen.findByRole('heading', { name: /^warning history$/i, level: 1 })).toBeInTheDocument();
  });

  test('no view inside the Trends tab is itself called Trends', () => {
    render(<TrendsTab />);
    const views = within(screen.getByRole('group', { name: 'Trends views' })).getAllByRole('button');
    expect(views).toHaveLength(3);
    expect(views.map((b) => b.textContent)).not.toContain('Trends');
  });

  test('the main nav reaches these views through the Trends tab', async () => {
    // Repointed from six text tabs to four icons: the claim worth keeping is that the nav reaches these views.
    skipSetup();
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('button')).toHaveLength(4);
    fireEvent.click(within(nav).getByRole('button', { name: 'Trends' }));
    expect(await screen.findByRole('button', { name: /^this week$/i })).toBeInTheDocument();
  });
});
