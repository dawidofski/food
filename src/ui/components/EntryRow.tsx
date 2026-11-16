import { isKnownValue } from '@/domain/nutrients';
import type { DiaryEntry } from '@/types/diary';
import CoverageNote from '@/ui/components/CoverageNote';
import OpenFoodFactsBadge from '@/ui/components/OpenFoodFactsBadge';
import SelfReportedBadge from '@/ui/components/SelfReportedBadge';

const time = (at: string): string => {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};

export default function EntryRow({ entry, onRelog }: { entry: DiaryEntry; onRelog: (text: string) => void }) {
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
        </p>
        {entry.coverage.energyKcal === 'partial' && isKnownValue(kcal) && (
          <CoverageNote nutrient="energyKcal" coverage="partial" value={kcal} />
        )}
      </div>
      <button
        type="button"
        onClick={() => onRelog(entry.rawText)}
        aria-label={`Log ${entry.rawText} again`}
        className="min-h-11 shrink-0 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-sm"
      >
        Log again
      </button>
    </li>
  );
}
