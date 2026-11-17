import type { NutrientKey } from '@/types/nutrients';
import { NUTRIENT_LABEL } from '@/ui/components/CoverageNote';

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Marks an entry whose figures the person corrected by hand after logging. It says WHICH figures, and that the rest are
 * unchanged, because most of a corrected entry still comes from its original source. Absent or empty means no correction.
 */
export default function CorrectedBadge({ keys }: { keys: NutrientKey[] | undefined }) {
  const names = [...new Set(keys ?? [])].map((k) => NUTRIENT_LABEL[k].name);
  if (names.length === 0) return null;
  return (
    <span
      data-testid="corrected"
      title={`You corrected ${list(names)} by hand. The entry's other figures are unchanged.`}
      className="ml-1 inline-block rounded border border-teal-700 dark:border-teal-400 bg-teal-50 dark:bg-teal-950 px-1.5 py-0.5 align-middle text-xs font-medium text-teal-900 dark:text-teal-200"
    >
      Corrected
    </span>
  );
}
