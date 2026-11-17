import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DayFigures, { PROVENANCE_SUMMARY } from '@/ui/components/DayFigures';
import { computeTargets } from '@/domain/targets';
import { dayTotals } from '@/domain/totals';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import { ownerProfile } from '../fixtures/profile';

const none: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

const DAY = '2026-11-15';
const ON = new Date('2026-11-15T12:00:00');

const entry: DiaryEntry = {
  id: 'e1',
  at: new Date(2026, 10, 15, 12).toISOString(),
  rawText: 'lunch',
  resolution: 'local',
  items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: none }],
  nutrients: { energyKcal: 700, proteinG: 40, fibreG: 9, sodiumMg: 900, satFatG: 6, addedSugarsG: 11 },
  coverage: { energyKcal: 'known', proteinG: 'known', fibreG: 'known', sodiumMg: 'known', satFatG: 'known', addedSugarsG: 'known' },
  classification: none,
  warningsShown: [],
  userAction: 'added',
  state: 'active',
};

const targets = computeTargets(ownerProfile, ON);
const totals = dayTotals([entry], DAY);

const view = () =>
  render(<DayFigures totals={totals} targets={targets} activityLevel={ownerProfile.activityLevel} emptyText="Nothing logged today yet." />);

const provenance = (): HTMLDetailsElement => screen.getByTestId('figures-provenance') as HTMLDetailsElement;

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DayFigures', () => {
  test('shows a bar per nutrient with its target', () => {
    view();
    expect(screen.getByText(`goal ${targets.energyKcal.toLocaleString('en-US')} kcal`)).toBeInTheDocument();
    expect(screen.getByText(`target ${targets.proteinG} g`)).toBeInTheDocument();
    expect(screen.getByText(`target ${targets.fibreG} g`)).toBeInTheDocument();
    expect(screen.getByText(`limit ${targets.sodiumMg.toLocaleString('en-US')} mg`)).toBeInTheDocument();
    expect(screen.getByText(`limit ${targets.satFatG} g`)).toBeInTheDocument();
    expect(screen.getByText(`limit ${targets.addedSugarsG} g`)).toBeInTheDocument();
  });

  test('keeps the provenance collapsed until it is opened', () => {
    view();
    // The element's own state, not visibility: jsdom does not apply the user-agent stylesheet that hides a closed
    // <details>, so a visibility assertion would pass whatever the code did.
    expect(provenance().open).toBe(false);
    expect(screen.getByText(PROVENANCE_SUMMARY)).toBeInTheDocument();
    fireEvent.click(screen.getByText(PROVENANCE_SUMMARY));
    expect(provenance().open).toBe(true);
  });

  test('loses no sentence', () => {
    view();
    // Asserted independently of the open state: the requirement is that moving the text behind a disclosure
    // dropped none of it.
    expect(screen.getByTestId('energy-source').textContent).toMatch(/Mifflin-St Jeor/);
    const note = screen.getByTestId('own-targets-note').textContent ?? '';
    expect(note).toMatch(/14 g per 1,000 kcal, at least 30 g/);
    expect(note).toMatch(/WHO advises at least 25 g/);
    expect(note).toMatch(/EFSA/);
    expect(note).toMatch(/International Society of Sports Nutrition/);
    expect(note).toMatch(/You can change any target in Settings/);
  });

  test('remembers that it was opened', () => {
    view();
    fireEvent.click(screen.getByText(PROVENANCE_SUMMARY));
    cleanup();
    view();
    expect(provenance().open).toBe(true);
  });

  test('survives storage that cannot be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    view();
    expect(provenance().open).toBe(false);
    expect(screen.getByTestId('own-targets-note')).toBeInTheDocument();
    fireEvent.click(screen.getByText(PROVENANCE_SUMMARY));
    expect(provenance().open).toBe(true);
  });
});
