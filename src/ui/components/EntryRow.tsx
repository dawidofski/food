import { isKnownValue } from '@/domain/nutrients';
import type { DiaryEntry } from '@/types/diary';

const time = (at: string): string => {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};

export default function EntryRow({ entry, onRelog }: { entry: DiaryEntry; onRelog: (text: string) => void }) {
  const kcal = entry.nutrients.energyKcal;
  return (
    <li className="flex items-center gap-3 border-b border-slate-200 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-base">{entry.rawText}</p>
        <p className="text-xs text-slate-600">
          {time(entry.at)}
          {isKnownValue(kcal) && ` · ${Math.round(kcal).toLocaleString('en-US')} kcal`}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onRelog(entry.rawText)}
        aria-label={`Log ${entry.rawText} again`}
        className="min-h-11 shrink-0 rounded-lg border border-slate-400 px-3 text-sm"
      >
        Log again
      </button>
    </li>
  );
}
