import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import NutrientBar from '@/ui/components/NutrientBar';

afterEach(cleanup);

const base = { coverage: 'known' as const, energyCoveredShare: 1 };

describe('NutrientBar says which way the figure points', () => {
  test('a ceiling never uses the word target', () => {
    render(<NutrientBar nutrient="sodiumMg" value={1400} {...base} target={2000} />);
    const text = screen.getByTestId('bar-sodiumMg').textContent ?? '';
    expect(text).not.toMatch(/target/i);
    expect(text).toMatch(/limit 2,000 mg/i);
  });

  test('a floor still reads as something to reach', () => {
    render(<NutrientBar nutrient="proteinG" value={80} {...base} target={160} />);
    const text = screen.getByTestId('bar-proteinG').textContent ?? '';
    expect(text).toMatch(/target 160 g/i);
    expect(text).not.toMatch(/limit/i);
  });

  test('a figure with no direction is a goal, neither target nor limit', () => {
    render(<NutrientBar nutrient="energyKcal" value={1800} {...base} target={2200} />);
    const text = screen.getByTestId('bar-energyKcal').textContent ?? '';
    expect(text).toMatch(/goal 2,200 kcal/i);
    expect(text).not.toMatch(/target|limit/i);
  });

  test('a second mark is shown on the same bar, not as a bar of its own', () => {
    render(
      <NutrientBar nutrient="addedSugarsG" value={30} {...base} target={56}
        secondMark={{ value: 28, label: 'WHO conditional 5%' }} />,
    );
    const bar = screen.getByTestId('bar-addedSugarsG');
    expect(bar.querySelectorAll('[data-mark]')).toHaveLength(2);
    expect(screen.queryByTestId('bar-addedSugarsIdealG')).toBeNull();
    expect(bar.textContent).toMatch(/WHO conditional 5%/);
    expect(bar.textContent).toMatch(/28 g/);
    expect(bar.textContent).not.toMatch(/target/i);
  });

  test('without a second mark there is one mark', () => {
    render(<NutrientBar nutrient="addedSugarsG" value={30} {...base} target={56} />);
    expect(screen.getByTestId('bar-addedSugarsG').querySelectorAll('[data-mark]')).toHaveLength(1);
  });

  test('a second mark on a floor inherits the floor wording', () => {
    render(<NutrientBar nutrient="proteinG" value={80} {...base} target={160} secondMark={{ value: 64, label: 'RDA' }} />);
    const bar = screen.getByTestId('bar-proteinG');
    expect(bar.querySelectorAll('[data-mark]')).toHaveLength(2);
    expect(bar.textContent).toMatch(/target 160 g/i);
    expect(bar.textContent).toMatch(/RDA/);
  });

  test('the accessible name says which way the figure points', () => {
    const { rerender } = render(<NutrientBar nutrient="sodiumMg" value={1400} {...base} target={2000} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toMatch(/limit/i);
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).not.toMatch(/target/i);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('2000');
    rerender(<NutrientBar nutrient="proteinG" value={80} {...base} target={160} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toMatch(/target/i);
    rerender(<NutrientBar nutrient="energyKcal" value={1800} {...base} target={2200} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toMatch(/goal/i);
  });

  test('passing a ceiling adds no alarm colour', () => {
    render(<NutrientBar nutrient="sodiumMg" value={3000} {...base} target={2000} />);
    const html = screen.getByTestId('bar-sodiumMg').innerHTML;
    expect(html).not.toMatch(/red|rose|orange|amber|yellow/);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3000');
  });

  test('an unknown nutrient shows no bar and no zero', () => {
    render(<NutrientBar nutrient="sodiumMg" value={undefined} coverage="unknown" energyCoveredShare={1} target={2000} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('bar-sodiumMg').textContent).toMatch(/limit 2,000 mg/i);
  });
});
