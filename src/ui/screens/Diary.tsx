import { useEffect, useMemo, useState } from 'react';
import { countActiveEntries, getProfile } from '@/data/db';
import { loadReportedEnergy } from '@/data/reportedEnergy';
import { last7DayKeys, localDayRange } from '@/domain/dayBoundary';
import type { ReportedExpenditure } from '@/domain/expenditure';
import { isKnownValue } from '@/domain/nutrients';
import { computeTargets } from '@/domain/targets';
import { dayTotals, mealTotals, MEAL_GROUPS } from '@/domain/totals';
import { requestPersistenceOnce } from '@/state/persistentStorage';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import type { DiaryEntry } from '@/types/diary';
import type { Profile } from '@/types/profile';
import DayFigures from '@/ui/components/DayFigures';
import DayHealthForm from '@/ui/components/DayHealthForm';
import MealSection from '@/ui/components/MealSection';
import BackupNudge from '@/ui/components/BackupNudge';
import CorrectedBadge from '@/ui/components/CorrectedBadge';
import { fmtAmount } from '@/ui/components/NutrientBar';
import OpenFoodFactsBadge from '@/ui/components/OpenFoodFactsBadge';
import SelfReportedBadge from '@/ui/components/SelfReportedBadge';
import EntryDetail from './EntryDetail';

const timeOf = (at: string): string => {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
};

function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

export default function Diary({ deps = defaultDeps }: { deps?: FlowDeps }) {
  const now = deps.now();
  const todayKey = last7DayKeys(now)[6]!;
  const keys = useMemo(() => last7DayKeys(new Date(`${todayKey}T12:00:00`)), [todayKey]);
  const [dayKey, setDayKey] = useState(todayKey);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [reported, setReported] = useState<ReportedExpenditure | undefined>(undefined);

  useEffect(() => {
    let live = true;
    getProfile().then((p) => { if (live) setProfile(p); }, () => undefined);
    return () => { live = false; };
  }, []);

  // The same guarded path the missing screen and the warning engine use, so the three cannot disagree about the
  // figure behind the targets. It cannot reject: an unreadable store means the formula is used.
  useEffect(() => {
    let live = true;
    void loadReportedEnergy(deps.now(), deps.store.healthDaysBetween).then((r) => { if (live) setReported(r); });
    return () => { live = false; };
  }, [deps, reload]);

  /**
   * Ask the browser once to keep this app's data. Here rather than at start-up because the diary is a resting
   * screen: in the browsers that prompt for this, a prompt must not land on someone part-way through logging.
   * It cannot throw and its answer is not acted on; Settings reports what the browser actually says.
   */
  useEffect(() => {
    void requestPersistenceOnce(deps.now());
  }, [deps]);

  useEffect(() => {
    let live = true;
    deps.store
      .entriesBetween(localDayRange(keys[0]!).fromISO, localDayRange(keys[6]!).toISO)
      .then((rows) => {
        if (!live) return;
        setEntries(rows);
        setLoadError(false);
        setLoaded(true);
      })
      .catch(() => {
        if (!live) return;
        setLoadError(true);
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [deps, keys, reload]);

  const opened = openId === null ? undefined : entries.find((e) => e.id === openId);
  if (opened) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-xl p-4">
        {/* keyed by id: EntryDetail's form state is captured at mount, so another entry must remount it */}
        <EntryDetail key={opened.id} entry={opened} deps={deps} onClose={() => setOpenId(null)} onChanged={(nextId) => { if (nextId !== undefined) setOpenId(nextId); setReload((n) => n + 1); }} />
      </main>
    );
  }

  const totals = dayTotals(entries, dayKey);
  const dayEntries = entries.filter((e) => dayTotals([e], dayKey).entryCount > 0);
  const byMeal = mealTotals(entries, dayKey);
  const targets = computeTargets(profile, now, reported?.kcal);

  const row = (e: DiaryEntry) => (
    <li key={e.id} className="border-b border-slate-200 dark:border-slate-800">
      <button type="button" onClick={() => setOpenId(e.id)} className="min-h-14 w-full py-2 text-left">
        <span className="block text-base">{e.rawText}</span>
        <span className="block text-xs text-slate-600 dark:text-slate-400">
          {timeOf(e.at)}
          {isKnownValue(e.nutrients.energyKcal) && ` · ${fmtAmount(e.nutrients.energyKcal)} kcal`}
          {e.items.some((i) => i.source === 'custom' || i.selfReported) && <SelfReportedBadge />}
          {e.items.some((i) => i.source === 'off') && <OpenFoodFactsBadge />}
          <CorrectedBadge keys={e.correctedKeys} />
        </span>
      </button>
    </li>
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Diary</h1>

      <nav aria-label="Days" className="grid grid-cols-7 gap-1">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            aria-current={k === dayKey ? 'date' : undefined}
            onClick={() => setDayKey(k)}
            className={`min-h-14 rounded-lg border px-1 text-xs ${k === dayKey ? 'border-slate-900 dark:border-slate-100 bg-slate-100 dark:bg-slate-800 font-semibold' : 'border-slate-300 dark:border-slate-700'}`}
          >
            <span className="block">{dayLabel(k)}</span>
            <span className="block text-slate-600 dark:text-slate-400">{dayTotals(entries, k).entryCount || '·'}</span>
          </button>
        ))}
      </nav>

      <BackupNudge now={deps.now} countEntries={deps.store.countActiveEntries ?? countActiveEntries} />

      {loadError && <p role="alert" className="text-sm text-slate-900 dark:text-slate-100">The diary could not be read, so nothing is shown. Nothing has been lost.</p>}

      {loaded && !loadError && (
        <DayFigures
          totals={totals}
          targets={targets}
          {...(profile?.activityLevel ? { activityLevel: profile.activityLevel } : {})}
          {...(reported?.days !== undefined ? { reportedDays: reported.days } : {})}
          emptyText="Nothing logged on this day."
        />
      )}

      {loaded && !loadError && MEAL_GROUPS.map((g) => {
        const slot = byMeal[g];
        // "Earlier" holds entries logged before slots existed; it is not a time of day, so it appears only when
        // it has something in it.
        if (g === 'earlier' && slot.entryCount === 0) return null;
        return (
          <MealSection key={g} group={g} totals={slot}>
            <ul>{dayEntries.filter((e) => (g === 'earlier' ? mealTotals([e], dayKey).earlier.entryCount > 0 : e.meal === g)).map(row)}</ul>
          </MealSection>
        );
      })}

      <DayHealthForm dayKey={dayKey} profile={profile} now={now} />
    </main>
  );
}
