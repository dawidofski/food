import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { WarningCard as Card } from '@/rules/types';
import WarningCard from '@/ui/components/WarningCard';

afterEach(cleanup);

const citation = {
  title: 'WHO source', publisher: 'WHO', year: 2012, url: 'https://example.org/who',
  conclusion: 'WHO concludes something specific about usual intake.',
};
const card: Card = {
  ruleId: 'sodium-daily', mergedFrom: [], merged: [], level: 'MODERATE', title: 'Sodium today',
  concern: 'A concern.', cause: 'A cause.',
  evidence: { strength: 'strong', body: 'WHO', summary: 'A summary.', citation, isAssociational: false },
  horizon: 'habitual', portionNote: 'Today comes to about 2,400 mg of sodium with this entry.', alternatives: [],
};
const PATTERN = 'Of the 6 days before today, 5 had complete sodium data and 4 of those were above 2,000 mg.';

/** A MODERATE card starts collapsed (spec 9.2), so the body is read after expanding it. */
function show(c: Card) {
  render(<WarningCard card={c} />);
  fireEvent.click(screen.getByRole('button', { name: /show more/i }));
}

describe('the frequency note on a card', () => {
  test('the note is shown, beside the portion note and not in place of it', () => {
    show({ ...card, patternNote: PATTERN });
    expect(screen.getByTestId('pattern-note')).toHaveTextContent(PATTERN);
    expect(screen.getByText(card.portionNote)).toBeInTheDocument();
  });

  test('a card with no honest count shows no pattern line at all', () => {
    show(card);
    expect(screen.queryByTestId('pattern-note')).not.toBeInTheDocument();
  });

  test('the frequency note and the "may be understated" note are separate lines', () => {
    const understated = "Some of today's food has no sodium data, so today's sodium total may be understated.";
    show({ ...card, patternNote: PATTERN, dataNote: understated });
    expect(screen.getByTestId('pattern-note').textContent).toBe(PATTERN);
    expect(screen.getByText(understated)).toBeInTheDocument();
  });
});
