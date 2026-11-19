import { isKnownValue } from '@/domain/nutrients';
import type { DiaryEntry } from '@/types/diary';
import CoverageNote from '@/ui/components/CoverageNote';
import CorrectedBadge from '@/ui/components/CorrectedBadge';
import OpenFoodFactsBadge from '@/ui/components/OpenFoodFactsBadge';
import SelfReportedBadge from '@/ui/components/SelfReportedBadge';

const time = (at: string): string => {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};

export default function EntryRow({
  entry,
  onRelog,
  onSaveMeal,
}: {
  entry: DiaryEntry;
  onRelog: (text: string) => void;
  /** Offered only where a meal can be saved from this entry; absent, and no such control is drawn. */
  onSaveMeal?: (entry: DiaryEntry) => void;
}) {
  const kcal = entry.nutrients.energyKcal;
  return (
    <li className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-base">{entry.rawText}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {time(entry.at)}
          {isKnownValue(kcal) && ` · ${Math.round(kcal).toLocaleString('en-US')} kcal`}
          {entry.items.some((i) => i.source === 'batch') && ' · from a batch'}
          {entry.items.some((i) => i.source === 'custom' || i.selfReported) && <SelfReportedBadge />}
          {entry.items.some((i) => i.source === 'off') && <OpenFoodFactsBadge />}
          <CorrectedBadge keys={entry.correctedKeys} />
        </p>
        {entry.coverage.energyKcal === 'partial' && isKnownValue(kcal) && (
          <CoverageNote nutrient="energyKcal" coverage="partial" value={kcal} />
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <button
          type="button"
          onClick={() => onRelog(entry.rawText)}
          aria-label={`Log ${entry.rawText} again`}
          className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-sm"
        >
          Log again
        </button>
        {onSaveMeal && (
          <button
            type="button"
            onClick={() => onSaveMeal(entry)}
            aria-label={`Save ${entry.rawText} as a meal`}
            className="min-h-11 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs"
          >
            Save as a meal
          </button>
        )}
      </div>
    </li>
  );
}
