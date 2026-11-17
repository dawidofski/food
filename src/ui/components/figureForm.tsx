import { isKnownValue } from '@/domain/nutrients';
import type { Coverage, NutrientKey } from '@/types/nutrients';
import { NUTRIENT_LABEL } from '@/ui/components/CoverageNote';
import { fmtAmount } from '@/ui/components/NutrientBar';

/**
 * What the two "correct the figures" forms share, so they cannot drift apart: how a held figure is shown in its field,
 * how a typed field is read against it, the words used for a refusal, and the note under a figure that is only a floor.
 */

/** The lead sentence of both forms. */
export const FIGURES_LEAD =
  'Type the figures you know. A blank field means the figure is unknown, not zero; emptying a field makes that figure unknown.';

/**
 * A held figure as it is shown in a field: at most 2 decimals, so 106.80000000000001 reads 106.8. A figure the app does
 * not know is '' (blank means unknown, never 0). The unchanged-field comparison runs through this same text, so a
 * rounded display is never read as an edit.
 */
export function figureText(v: number | undefined): string {
  return isKnownValue(v) ? String(Math.round(v * 100) / 100 + 0) : '';
}

const sentence = (k: NutrientKey): string => `${NUTRIENT_LABEL[k].name[0]!.toUpperCase()}${NUTRIENT_LABEL[k].name.slice(1)}`;

export type FigureRead =
  | { kind: 'unchanged' }
  | { kind: 'clear' }
  | { kind: 'set'; value: number }
  | { kind: 'refused'; message: string };

/**
 * Read one field against the figure it was opened with (`before`, from `figureText`). `badInput` comes from the DOM at
 * save time: unparseable text such as "1e" reads as '' in a number input, and that is not an emptied field.
 */
export function readFigure(k: NutrientKey, typed: string, before: string, badInput: boolean): FigureRead {
  return readNamedFigure(sentence(k), typed, before, badInput);
}

/** The same reading for a figure that is not a nutrient (a day's steps, say). `name` starts a sentence: "Steps". */
export function readNamedFigure(name: string, typed: string, before: string, badInput: boolean): FigureRead {
  if (badInput) return { kind: 'refused', message: `${name} is not a number yet. Nothing has been changed.` };
  const text = typed.trim();
  if (text === '') return before !== '' ? { kind: 'clear' } : { kind: 'unchanged' };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) {
    return { kind: 'refused', message: `${name} needs a number that is zero or more. Nothing has been changed.` };
  }
  if (text === before || (before !== '' && n === Number(before))) return { kind: 'unchanged' };
  return { kind: 'set', value: n };
}

/** The id of a field's partial note, for aria-describedby. */
export const partialNoteId = (inputId: string): string => `${inputId}-partial`;

/** Whether a field's held figure is only a floor. */
export const isPartialFigure = (coverage: Coverage, k: NutrientKey, value: number | undefined): boolean =>
  coverage[k] === 'partial' && isKnownValue(value);

/**
 * Under a field whose figure is only a floor ("at least"), say what the person is looking at. The field is NOT blanked:
 * blank means unknown, which would be a different untruth. Renders nothing for any other coverage.
 */
export function PartialFigureNote({
  k, coverage, value, inputId,
}: { k: NutrientKey; coverage: Coverage; value: number | undefined; inputId: string }) {
  if (!isPartialFigure(coverage, k, value) || !isKnownValue(value)) return null;
  const { name, unit } = NUTRIENT_LABEL[k];
  return (
    <p id={partialNoteId(inputId)} data-testid="partial-figure-note" className="mt-1 text-sm text-amber-950 dark:text-amber-200">
      {`This is at least ${fmtAmount(value)} ${unit} so far; some items had no ${name} data. It is a floor, not the full figure.`}
    </p>
  );
}
