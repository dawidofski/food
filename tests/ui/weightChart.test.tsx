import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import WeightChart from '@/ui/components/WeightChart';
import { weightProjection } from '@/domain/weightProjection';
import { weightTrend } from '@/domain/weightTrend';

afterEach(cleanup);

const NOW = new Date('2026-11-18T12:00:00');
const key = (daysAgo: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};
const log = (...rows: [number, number][]) => rows.map(([d, kg]) => ({ date: key(d), kg }));

const steady = log([28, 80], [21, 79.75], [14, 79.5], [7, 79.25], [0, 79]);
const projection = weightProjection(weightTrend(steady, NOW), 79);

const svg = () => screen.getByRole('img');

describe('the weight chart', () => {
  test('draws a point per logged weight', () => {
    render(<WeightChart log={steady} projection={projection} label="five weights" />);
    expect(svg().querySelectorAll('circle')).toHaveLength(5);
  });

  test('describes itself in words for a screen reader', () => {
    render(<WeightChart log={steady} projection={projection} label="Your logged weights over 28 days, losing about 0.25 kg a week" />);
    expect(screen.getByRole('img', { name: /losing about 0\.25 kg a week/i })).toBeInTheDocument();
  });

  test('marks the projection as an estimate, visibly and apart from the measured line', () => {
    const { container } = render(<WeightChart log={steady} projection={projection} label="x" />);
    // Said in words where a person reads it, not only in the accessible name.
    expect(screen.getByText(/an estimate of where this rate would lead, not a\s+measurement/i)).toBeInTheDocument();
    // And drawn differently: the projection is dashed, the measured line is not.
    const dashed = container.querySelectorAll('[stroke-dasharray]');
    expect(dashed.length).toBeGreaterThan(0);
    const measured = container.querySelector('polyline:not([stroke-dasharray])');
    expect(measured).not.toBeNull();
    expect(container.querySelector('polygon')).not.toBeNull();
  });

  test('draws no band and promises nothing when there is no projection', () => {
    const { container } = render(<WeightChart log={steady} projection={[]} label="x" />);
    expect(container.querySelector('polygon')).toBeNull();
    expect(container.querySelectorAll('[stroke-dasharray]')).toHaveLength(0);
    expect(screen.queryByText(/estimate/i)).toBeNull();
  });

  test('survives a single weigh-in without an axis of zero width', () => {
    const { container } = render(<WeightChart log={log([0, 80])} projection={[]} label="one weight" />);
    const pts = container.querySelector('polyline')?.getAttribute('points') ?? '';
    for (const n of pts.split(/[ ,]/).filter(Boolean)) expect(Number.isFinite(Number(n))).toBe(true);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  test('survives weigh-ins that are all the same weight', () => {
    const { container } = render(<WeightChart log={log([28, 80], [14, 80], [0, 80])} projection={[]} label="flat" />);
    const pts = container.querySelector('polyline')?.getAttribute('points') ?? '';
    for (const n of pts.split(/[ ,]/).filter(Boolean)) expect(Number.isFinite(Number(n))).toBe(true);
  });

  test('renders nothing at all rather than an empty frame when there is no log', () => {
    const { container } = render(<WeightChart log={[]} projection={[]} label="none" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
