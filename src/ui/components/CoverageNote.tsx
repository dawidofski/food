import type { NutrientKey } from '@/types/nutrients';

export const NUTRIENT_LABEL: Record<NutrientKey, { name: string; unit: string }> = {
  energyKcal: { name: 'energy', unit: 'kcal' },
  proteinG: { name: 'protein', unit: 'g' },
  fatG: { name: 'fat', unit: 'g' },
  satFatG: { name: 'saturated fat', unit: 'g' },
  transFatG: { name: 'trans fat', unit: 'g' },
  carbG: { name: 'carbohydrate', unit: 'g' },
  sugarsG: { name: 'sugars', unit: 'g' },
  addedSugarsG: { name: 'added sugars', unit: 'g' },
  fibreG: { name: 'fibre', unit: 'g' },
  sodiumMg: { name: 'sodium', unit: 'mg' },
  potassiumMg: { name: 'potassium', unit: 'mg' },
  calciumMg: { name: 'calcium', unit: 'mg' },
  ironMg: { name: 'iron', unit: 'mg' },
  magnesiumMg: { name: 'magnesium', unit: 'mg' },
  zincMg: { name: 'zinc', unit: 'mg' },
  vitaminCMg: { name: 'vitamin C', unit: 'mg' },
  vitaminDUg: { name: 'vitamin D', unit: 'µg' },
  vitaminB12Ug: { name: 'vitamin B12', unit: 'µg' },
  folateUg: { name: 'folate', unit: 'µg' },
};

function whole(n: number): string {
  return (Math.round(n) || 0).toLocaleString('en-US');
}

/**
 * Where a total is only partly known, say so. A partial total is a FLOOR ("at least 48 g"), never a clean number, and an
 * unknown one has no figure at all. A fully known total renders nothing. `missingItems` is how many items lacked the
 * nutrient; when the caller cannot count them the note still says some did.
 */
export default function CoverageNote({
  nutrient, coverage, missingItems, value,
}: {
  nutrient: NutrientKey;
  coverage: 'known' | 'partial' | 'unknown';
  missingItems?: number;
  value?: number;
}) {
  if (coverage === 'known') return null;
  const { name, unit } = NUTRIENT_LABEL[nutrient];
  if (coverage === 'unknown') {
    return (
      <p data-testid="coverage-note" className="text-sm text-amber-950">
        No {name} data for this, so no total can be given.
      </p>
    );
  }
  const n = typeof missingItems === 'number' && Number.isFinite(missingItems) && missingItems > 0 ? Math.round(missingItems) : null;
  const who = n === null ? 'Some items have' : n === 1 ? '1 item has' : `${n} items have`;
  const floor = typeof value === 'number' && Number.isFinite(value) ? `at least ${whole(value)} ${unit}` : 'at least what is shown';
  return (
    <p data-testid="coverage-note" className="text-sm text-amber-950">
      <span className="font-semibold">{floor}</span>
      <span>{` — ${who} no ${name} data`}</span>
    </p>
  );
}
