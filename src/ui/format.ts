/** Grams for display: whole grams, one decimal under 10 g, never NaN or Infinity. */
export function fmtGrams(g: number): string {
  if (!Number.isFinite(g)) return '? g';
  const v = Math.abs(g) < 10 ? Math.round(g * 10) / 10 : Math.round(g);
  return `${v.toLocaleString('en-US')} g`;
}
