/** Marks numbers the person typed from a package, as opposed to a measured database. Shown wherever a custom food appears. */
export default function SelfReportedBadge() {
  return (
    <span
      data-testid="self-reported"
      title="You entered these numbers yourself from a package or recipe. They are not from the USDA database."
      className="ml-1 inline-block rounded border border-dashed border-violet-700 dark:border-violet-400 bg-violet-50 dark:bg-violet-950 px-1.5 py-0.5 align-middle text-xs font-medium text-violet-900 dark:text-violet-200"
    >
      Self-reported
    </span>
  );
}
