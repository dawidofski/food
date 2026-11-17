import { healthDaysBetween } from '@/data/healthDays';
import { reportedExpenditureOver, reportedWindowKeys, type ReportedExpenditure } from '@/domain/expenditure';
import type { HealthDay } from '@/types/health';

/**
 * The person's reported energy burn for `on`, read from the store: the one place the screens and the warning engine get
 * the figure they pass to `computeTargets`, so they cannot disagree about it. Every guard lives in `reportedExpenditureOver`;
 * nothing is averaged here.
 *
 * A store that cannot be read means the figure is UNKNOWN, so the formula is used, exactly as with too few days.
 */
export async function loadReportedEnergy(
  on: Date,
  read: (from: string, to: string) => Promise<HealthDay[]> = healthDaysBetween,
): Promise<ReportedExpenditure | undefined> {
  try {
    const keys = reportedWindowKeys(on);
    return reportedExpenditureOver(await read(keys[0]!, keys[keys.length - 1]!), on);
  } catch {
    return undefined;
  }
}
