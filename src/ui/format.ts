/** Grams for display: whole grams, one decimal under 10 g, never NaN or Infinity. */
export function fmtGrams(g: number): string {
  if (!Number.isFinite(g)) return '? g';
  const v = Math.abs(g) < 10 ? Math.round(g * 10) / 10 : Math.round(g);
  return `${v.toLocaleString('en-US')} g`;
}

/** A date for a person to read: "16 Nov 2026". An unparseable one says so rather than printing "Invalid Date". */
export function fmtDay(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'an unknown date';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
