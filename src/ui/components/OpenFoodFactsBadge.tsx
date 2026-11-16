import { fmtDay } from '@/ui/format';

/**
 * Marks a food whose numbers came from Open Food Facts, a public database that ANYONE can edit. In the spirit of
 * SelfReportedBadge, which marks numbers the person typed off a packet: both say "nobody measured this in a
 * laboratory", and this one adds "and the person who typed it was a stranger".
 *
 * `lastModified` is the product's own last edit in Open Food Facts, shown on the badge wherever it is known,
 * because the age of a crowdsourced figure is part of what it is worth.
 */
export default function OpenFoodFactsBadge({ lastModified }: { lastModified?: string }) {
  const edited = lastModified !== undefined ? fmtDay(lastModified) : null;
  return (
    <span
      data-testid="off-sourced"
      title={
        'These numbers come from Open Food Facts, a public database that anyone can edit. They were copied from a ' +
        'product label by a member of the public, not measured by a laboratory, and they may be wrong, out of date ' +
        'or incomplete.' + (edited ? ` This product was last edited there on ${edited}.` : '')
      }
      className="ml-1 inline-block rounded border border-dashed border-sky-700 dark:border-sky-400 bg-sky-50 dark:bg-sky-950 px-1.5 py-0.5 align-middle text-xs font-medium text-sky-900 dark:text-sky-200"
    >
      Open Food Facts{edited ? ` · edited ${edited}` : ''}
    </span>
  );
}
