import type { HealthDay } from '@/types/health';
import { diaryDb } from '@/data/db';

/**
 * One row per local day, keyed by `date`, beside the diary and not inside it: a day can have sleep recorded and no
 * food logged at all. Absent means unknown, so a figure that was not given is never stored as 0.
 */

const FIGURES = ['sleepScore', 'steps', 'energyBurnedKcal'] as const;

/** Throws on anything that is not a real figure in range. A silent drop is the failure this project refuses. */
function validated(d: HealthDay): HealthDay {
  if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
    throw new RangeError(`healthDay.date is not a day key: ${String(d.date)}`);
  }
  const row: HealthDay = { date: d.date };
  for (const k of FIGURES) {
    const v = d[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`healthDay.${k} is not finite`);
    if (v < 0) throw new RangeError(`healthDay.${k} is below 0`);
    if (k === 'sleepScore' && v > 100) throw new RangeError('healthDay.sleepScore is above 100');
    row[k] = v;
  }
  return row;
}

/** Validates and writes. A record with every figure absent deletes the row rather than storing an empty one. */
export async function putHealthDay(d: HealthDay): Promise<void> {
  const row = validated(d);
  const db = await diaryDb();
  if (FIGURES.every((k) => row[k] === undefined)) {
    await db.delete('healthDays', row.date);
    return;
  }
  await db.put('healthDays', row);
}

export async function getHealthDay(dayKey: string): Promise<HealthDay | undefined> {
  return (await diaryDb()).get('healthDays', dayKey);
}

/** Inclusive, oldest first. Day keys are zero-padded, so key order is date order. */
export async function healthDaysBetween(fromDayKey: string, toDayKey: string): Promise<HealthDay[]> {
  if (fromDayKey > toDayKey) return [];
  return (await diaryDb()).getAll('healthDays', IDBKeyRange.bound(fromDayKey, toDayKey));
}
