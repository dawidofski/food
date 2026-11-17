# The Diary Becomes the Day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Diary shows one day whole — the day's figures as compact bars under the date strip, food grouped into breakfast, lunch, dinner and snacks with each slot's own figures, then sleep, steps and energy burned.

**Architecture:** Entries gain an optional `meal` field; absent means unslotted and shows under "Earlier", never guessed from a timestamp. A new `mealTotals` in the domain returns one `DayTotals` per slot, so every slot inherits the coverage honesty the day already has. The Missing screen's bars block becomes a shared `DayFigures` component that both screens render, which is how the two cannot drift apart while both exist.

**Tech Stack:** Vite 5, React 18, TypeScript strict (`noUncheckedIndexedAccess`), Tailwind, Vitest + @testing-library/react + jsdom + fake-indexeddb, IndexedDB via `idb`.

**Spec:** `docs/superpowers/specs/2026-11-17-navigation-and-the-day-amendment.md` §A2.2 and §A2.7, with `docs/superpowers/specs/2026-11-16-targets-weight-and-daily-health-design.md` as the governing document (§4 anti-goals, §5 constraints, §8.1 the ceiling/floor distinction, §8.3 as amended).

**Precondition:** phase 4 (`docs/superpowers/plans/2026-11-17-daily-health-data.md`) is merged. Task 3 reads `src/domain/energySource.ts`, `src/ui/screens/Missing.tsx` and `tests/ui/missing.test.tsx` as phase 4's final fix wave left them — read those files, do not work from any wording quoted in this plan.

## Global Constraints

- **An absent nutrient key means UNKNOWN, never zero.** Never a `0` where a figure is unknown — not in a slot header, not in a bar, not in a total.
- `coverage` is the deliberate exception: `sumNutrients` writes every coverage key explicitly including `'unknown'`, while nutrients say unknown by absence. Do not make the two consistent in either direction.
- **A partial total is a floor** and reads "at least"; a nutrient nobody knew has no figure at all. `NutrientBar` and `CoverageNote` already do this — use them rather than formatting figures by hand.
- **Every health figure shown carries its source**; an unsourced threshold is labelled as the app's own choice and not a published figure. A figure the person typed is theirs and never gets a source.
- **The wording lives in one place.** `src/domain/energySource.ts` is the single source of the energy sentence. Two screens never keep separate accounts of where a figure came from.
- **A screen must never claim something the code does not do.** Four reviews on the preceding branch were spent on exactly this.
- **The warning gate is untouched.** Food is never silently added (§4).
- No new dependency. TypeScript strict. Every figure through `fmtAmount`. Phone-first at 375 px, 44 px minimum touch targets, `aria-label` on every icon control, a `dark:` pair on every colour.
- No secret, API key, or personal profile value (name, date of birth, height, weight) in any committed file — the repository is public and `scripts/check-no-secrets.sh` runs as `pretest`.
- Commits: lower-case `feat:` / `fix:` / `test:` / `docs:`, describing the behaviour in plain words. End each message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

1. **An entry whose `meal` is an unrecognised string** — from a hand-edited database or a newer build's backup — must still appear, under "Earlier". An entry that belongs to no rendered group is invisible, which reads as lost data. *(Task 2)*
2. **A slot whose entries have no saturated-fat figure** must show no saturated-fat figure, not `0 g`. The slot header is a new place for a false zero to appear. *(Task 4)*
3. **The revise path must carry `meal`.** `useEntryFlow`'s `store()` builds a fresh entry object and copies `fped` and `correctedKeys` across explicitly; a field it does not copy is silently dropped when someone corrects what they ate. This has already happened once in this codebase, to hand-typed figures. *(Task 5)*
4. **Per-slot totals must sum to the day's totals.** If they do not, one screen contradicts itself. *(Task 2)*
5. **The disclosure's text must come from the shared wording source**, so the Diary and Missing cannot disagree about where the energy figure came from while both exist. *(Task 3)*

## File Structure

| File | Responsibility |
|---|---|
| `src/types/diary.ts` | `MealSlot`, `MEAL_SLOTS`, `DiaryEntry.meal?` |
| `src/domain/meals.ts` *(new)* | `mealFromClock` and its boundary table — the app's own choice, in one place |
| `src/domain/totals.ts` | `mealTotals`, beside `dayTotals` because it needs the same private `buildDay` |
| `src/data/exportImport.ts` | validate `meal` when present |
| `src/ui/components/DayFigures.tsx` *(new)* | the bars plus the provenance disclosure, rendered by both screens |
| `src/ui/components/MealSection.tsx` *(new)* | one slot: its heading, its figures, its entries |
| `src/ui/components/MealPicker.tsx` *(new)* | the four-way choice, used before and after saving |
| `src/ui/screens/Diary.tsx` | the order, and the slot sections |
| `src/ui/screens/Missing.tsx` | renders `DayFigures` instead of its own bars block |
| `src/ui/screens/EntryDetail.tsx` | change the slot after saving |
| `src/state/useEntryFlow.ts` | carry `meal` into the stored entry and across a revision |

---

### Task 1: The `meal` field, and a file that carries it

**Files:**
- Modify: `src/types/diary.ts`
- Modify: `src/data/exportImport.ts:134-157` (the `entry` validator)
- Test: `tests/data/exportImport.test.ts`

**Interfaces:**
- Produces: `export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'`; `export const MEAL_SLOTS: readonly MealSlot[]` in slot order — breakfast, lunch, dinner, snack; `DiaryEntry.meal?: MealSlot`.

- [ ] **Step 1: Write the failing tests** in `tests/data/exportImport.test.ts`

```ts
it('carries a meal slot through a backup round trip', async () => { /* export an entry with meal: 'dinner', import it, expect meal === 'dinner' */ });
it('leaves an entry with no meal slot without one', async () => { /* absent before, absent after — never defaulted to a slot on import */ });
it('refuses a file whose entry names a slot this build does not have', async () => {
  // meal: 'brunch' → rejects, and the store is byte-identical afterwards
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/data/exportImport.test.ts`
Expected: FAIL — `meal` is not a property of `DiaryEntry`.

- [ ] **Step 3: Add `MealSlot`, `MEAL_SLOTS` and `DiaryEntry.meal?`** to `src/types/diary.ts`

Document on the field: absent means the person never chose a slot, which is not the same as any slot, and is never filled in from the entry's timestamp.

- [ ] **Step 4: Validate `meal` in `exportImport.ts`'s `entry()`**

Use the existing `oneOf(o.meal, [...MEAL_SLOTS], `${w} meal`)` guarded by `if (o.meal !== undefined)`, matching how `resolution`, `userAction` and `state` are already checked. A comment must say why this one rejects the file rather than being accepted as an unknown string the way `correctedKeys` is: an unknown figure key costs a name, while an unknown slot would put the entry in no group the diary draws.

The same comment must say, in one line, why the importer refuses a slot the renderer tolerates (Task 2 puts an unrecognised slot under "Earlier"). They are different layers, not a contradiction: a file is a record this build owns, so a wrong slot in one is worth refusing, while a value can still reach the store without passing the importer — a hand-edited database, or a row from a later build — and an entry in no rendered group is invisible, which reads as lost food.

- [ ] **Step 5: Run the tests and the suite**

Run: `npx vitest run tests/data/exportImport.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/types/diary.ts src/data/exportImport.ts tests/data/exportImport.test.ts
git commit -m "feat: a diary entry can name the meal it belonged to"
```

---

### Task 2: Per-slot totals

**Files:**
- Modify: `src/domain/totals.ts`
- Test: `tests/domain/mealTotals.test.ts` (new)

**Interfaces:**
- Consumes: `MealSlot`, `MEAL_SLOTS` (Task 1).
- Produces: `export type MealGroup = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'earlier'`; `export const MEAL_GROUPS: readonly MealGroup[]` — `MEAL_SLOTS` then `'earlier'`; `export function mealTotals(entries: DiaryEntry[], dayKey: string): Record<MealGroup, DayTotals>`.

Every one of the five keys is always present. A group with no entries has `entryCount: 0` and empty `nutrients` — not zeros. Reuse the private `buildDay` so each group gets the same `coverage`, `energyCoveredShare` and partial-entry downgrade the day already gets; do not recompute any of that by hand.

- [ ] **Step 1: Write the failing tests** in `tests/domain/mealTotals.test.ts`

```ts
it('puts an entry with no meal under earlier', () => { /* entryCount 1 under 'earlier', 0 under every slot */ });
it('puts an entry whose meal is not a slot this build knows under earlier', () => {
  // { ...entry, meal: 'brunch' as MealSlot } — Review Focus 1: visible, never dropped
});
it('gives an empty slot no figures rather than zeros', () => {
  // expect(g.snack.nutrients.energyKcal).toBeUndefined() — NOT 0
});
it('counts neither a cancelled entry nor a tombstone in any group', () => { /* every group entryCount 0 */ });
it('sums to the day across every group', () => {
  // Review Focus 4: for each NUTRIENT_KEY, the five groups' known values sum to dayTotals' value
});
it('marks a slot partial when one of its entries knew a key and another did not', () => {
  // coverage.satFatG === 'partial' for that slot, so the UI reads it as a floor
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/domain/mealTotals.test.ts`
Expected: FAIL — `mealTotals` is not exported.

- [ ] **Step 3: Implement `mealTotals`** in `src/domain/totals.ts`

Group the day's entries by `meal` where it is one of `MEAL_SLOTS` and under `'earlier'` otherwise — that single condition is what satisfies Review Focus 1 — then call `buildDay` per group with `dayKey`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/domain/mealTotals.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the sum test discriminates**

Make `mealTotals` drop the `'earlier'` group's entries, confirm the sum test goes red, revert. Report which test failed.

- [ ] **Step 6: Commit**

```bash
git add src/domain/totals.ts tests/domain/mealTotals.test.ts
git commit -m "feat: a day's figures can be read per meal"
```

---

### Task 3: The day's figures become a shared component

**Files:**
- Create: `src/ui/components/DayFigures.tsx`
- Modify: `src/ui/screens/Missing.tsx` (its `today-h` section only)
- Test: `tests/ui/dayFigures.test.tsx` (new); keep `tests/ui/missing.test.tsx` passing

**Interfaces:**
- Produces: `export default function DayFigures({ totals, targets, basis, activityLevel, reportedDays, storageKey }: {...})` — the bars block plus the provenance disclosure. The exact prop list is the implementer's, with two requirements: every figure it needs is passed in, and it reads the clock and the database for nothing.

**Read first:** `src/ui/screens/Missing.tsx`'s `today-h` section, `src/domain/energySource.ts`, and `tests/ui/missing.test.tsx`, as phase 4's final fix wave left them. The sentences there are the output of four review rounds; move them, do not rewrite them.

- [ ] **Step 1: Write the failing tests** in `tests/ui/dayFigures.test.tsx`

```ts
it('shows a bar per nutrient with its target', () => { /* the TODAY_BARS set, each with its figure */ });
it('keeps the provenance collapsed until it is opened', () => {
  // The <details> element's own `open` property: false on mount, true after the summary is clicked.
  // NOT a visibility assertion — jsdom does not apply the user-agent stylesheet that hides a closed
  // <details>, so `not.toBeVisible()` would fail for the wrong reason and `toBeVisible()` after opening
  // would pass whatever the code did. Assert the summary's exact text here too.
});
it('loses no sentence', () => {
  // energy-source and own-targets-note both present, asserted unconditionally and independently of the
  // open state: the requirement is that moving the text behind a disclosure dropped none of it.
});
it('remembers that it was opened', () => { /* localStorage under the fd. prefix; a second mount starts open */ });
it('survives storage that cannot be read or written', () => {
  // getItem and setItem both throwing: renders collapsed, no crash — Task 3 of the preceding plan hit this exact trap
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/ui/dayFigures.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Build `DayFigures`** by moving Missing's bars block, its `TODAY_BARS` table, and both provenance paragraphs into it

A `<details>`/`<summary>` for the disclosure, summary text exactly `Where these figures come from`. The energy sentence must still come from `energySourceSentence`; the component must not hold a second copy of any wording. Wrap every `localStorage` read and write in `try`/`catch` and render correctly when both throw.

- [ ] **Step 4: Have `Missing.tsx` render `DayFigures`** in place of its own bars block, deleting the moved code rather than leaving it

- [ ] **Step 5: Run the UI suite**

Run: `npx vitest run tests/ui/ && npx tsc --noEmit`
Expected: PASS. `missing.test.tsx`'s existing assertions must pass unchanged — including the cross-screen byte-identical sentence test, which is Review Focus 5's pin. A closed `<details>` keeps its content in the DOM and jsdom does not hide it, so a `getByText` assertion should still pass; if one fails, repoint it, never weaken it.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/DayFigures.tsx src/ui/screens/Missing.tsx tests/ui/dayFigures.test.tsx tests/ui/missing.test.tsx
git commit -m "feat: the day's figures are one component, with their sourcing behind a disclosure"
```

---

### Task 4: The Diary, in the owner's order

**Files:**
- Create: `src/ui/components/MealSection.tsx`
- Modify: `src/ui/screens/Diary.tsx`
- Test: `tests/ui/diaryDay.test.tsx` (new); `tests/ui/diary.test.tsx` — its assertions about the deleted "Day total" section must be **repointed** at the figures `DayFigures` now shows, never deleted. A deleted assertion is a lost guarantee.

**Interfaces:**
- Consumes: `mealTotals`, `MEAL_GROUPS` (Task 2); `DayFigures` (Task 3).
- Produces: `export default function MealSection({ group, totals, entries, onOpen }: {...})`.

The order in the DOM, top to bottom: the date strip, `DayFigures`, the meal sections, then `DayHealthForm`. The existing "Day total" section is replaced by `DayFigures` — delete it rather than keeping both.

Each section's heading carries the group's name and its energy. Beneath it, that group's protein and saturated fat. Every figure goes through `NutrientBar`'s `fmtAmount`; an unknown figure is omitted and a partial one reads "at least", via `CoverageNote` — the slot header must not format a figure by hand. A group with no entries shows `—`. `'earlier'` renders only when its `entryCount` is above 0, with the heading `Earlier`.

- [ ] **Step 1: Write the failing tests** in `tests/ui/diaryDay.test.tsx`

```ts
it('puts the day figures above the food and the food above sleep and steps', () => {
  // compareDocumentPosition on the three landmarks, in that order
});
it('shows each meal with its own energy and protein', () => { /* breakfast 320 kcal / 12 g, dinner 880 / 52 */ });
it('shows an empty slot as a dash, not a zero', () => { /* Snacks section: '—', and no /0 kcal/ anywhere in it */ });
it('says at least for a slot one of whose entries had no saturated fat figure', () => {
  // Review Focus 2: /at least/ in that slot, and no bare sat-fat total
});
it('shows nothing for a slot whose entries all lack a figure', () => { /* no sat-fat figure at all, not a zero */ });
it('heads unslotted entries Earlier, and only when there are some', () => { /* absent when every entry has a slot */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/ui/diaryDay.test.tsx`
Expected: FAIL — `MealSection` does not exist.

- [ ] **Step 3: Build `MealSection`, then reorder `Diary.tsx`**

The entry rows keep the markup they have today, badges included — this task moves them under a heading and changes nothing about a row.

- [ ] **Step 4: Run the UI suite at 375 px**

Run: `npx vitest run tests/ui/ && npx tsc --noEmit && npm run build`
Expected: PASS, exit 0, build succeeds.

- [ ] **Step 5: Prove the false-zero test discriminates**

Make `MealSection` print `0` for an unknown figure, confirm the dash test and the "shows nothing" test both go red, revert. Report which failed.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/MealSection.tsx src/ui/screens/Diary.tsx tests/ui/diaryDay.test.tsx
git commit -m "feat: the diary shows the day's figures, then food by meal, then sleep and steps"
```

---

### Task 5: Choosing a slot, and keeping it

**Files:**
- Create: `src/domain/meals.ts`
- Create: `src/ui/components/MealPicker.tsx`
- Modify: `src/state/useEntryFlow.ts:288-310` (the `store` callback)
- Modify: `src/ui/screens/EntryDetail.tsx`
- Test: `tests/domain/meals.test.ts` (new), `tests/ui/mealPicker.test.tsx` (new), and an addition to the existing entry-flow revision test

**Interfaces:**
- Consumes: `MealSlot`, `MEAL_SLOTS` (Task 1).
- Produces: `export function mealFromClock(at: Date): MealSlot`; `export const MEAL_DEFAULT_FROM: Record<MealSlot, string>`; `export default function MealPicker({ value, onChange }: { value: MealSlot | undefined; onChange: (m: MealSlot) => void })`; `setEntryMeal(entry: DiaryEntry, meal: MealSlot): Promise<void>` on the entry flow.

**How a slot changes after saving, already traced so you do not have to:** `EntryDetail`'s figure form calls `flow.correctEntry(entry, correction)`, which returns early when nothing changed, so a slot-only change cannot ride it. Add `setEntryMeal` beside `correctEntry` in `src/state/useEntryFlow.ts`, mirroring its shape: build the `Resolution` from the entry's own `items`, `nutrients` and `coverage` unchanged, and go through the same revise mechanism. Do not mutate the stored row — nothing in this codebase does; every change is a revision with the original kept as `superseded`, and `behaviour.ts` counts only `state: 'active'`, so the history does not double-count.

**The boundary table is this app's own choice and must say so where the person can read it, not only in a comment.** Local time, each slot running until the next begins, snack wrapping midnight:

| From | Slot |
|---|---|
| 05:00 | breakfast |
| 12:00 | lunch |
| 17:30 | dinner |
| 23:30 | snack (through 04:59) |

Later than a textbook would put them, because the owner eats in Spain. It is a starting guess and the picker overrides it; nothing in the app treats a defaulted slot as a fact about what the meal was.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/meals.test.ts
it('defaults each slot from the clock at its boundaries', () => {
  // 04:59 snack, 05:00 breakfast, 11:59 breakfast, 12:00 lunch,
  // 17:29 lunch, 17:30 dinner, 23:29 dinner, 23:30 snack, 00:30 snack
});

// tests/ui/mealPicker.test.tsx
it('offers the four slots and reports the one chosen', () => {});
it('says the suggested slot is the app's own guess', () => { /* the wording is on screen, not in a comment */ });

// alongside the existing revision test
it('keeps the meal slot when an entry is corrected', () => {
  // Review Focus 3: revise an entry with meal 'dinner', expect the stored revision still says 'dinner'
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/domain/meals.test.ts tests/ui/mealPicker.test.tsx`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement `mealFromClock` and `MealPicker`**

- [ ] **Step 4: Carry `meal` through `useEntryFlow`'s `store`**

Set it from the picker's value, defaulting to `mealFromClock(d.now())`. On a revision it must be carried across exactly as `fped` and `correctedKeys` already are — a field that is not copied explicitly is dropped, which is what Review Focus 3 exists to catch.

- [ ] **Step 5: Add the picker to `EntryDetail`** so the slot can be changed after saving, saving through the existing revision path

- [ ] **Step 6: Run the whole suite, types and build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, exit 0, build succeeds.

- [ ] **Step 7: Prove the carry-across test discriminates**

Delete the line that copies `meal` on a revision, confirm the Review Focus 3 test goes red, restore it. Report the failure.

- [ ] **Step 8: Commit**

```bash
git add src/domain/meals.ts src/ui/components/MealPicker.tsx src/state/useEntryFlow.ts src/ui/screens/EntryDetail.tsx tests/
git commit -m "feat: a meal's slot is suggested from the clock and changeable before and after saving"
```

---

## Self-review

**Spec coverage.** §A2.2's order → Task 4. Compact bars → Task 3. The disclosure losing no sentence → Task 3. Meal slots with their own figures → Tasks 2 and 4. No good/thin/heavy verdict → absent by construction; no task adds one. "Earlier" rather than guessing from a timestamp → Tasks 1, 2 and 4. An empty slot showing `—` → Task 4. Defaulting from the clock, changeable either side of saving → Task 5. §A2.7's `localStorage` convenience and slot order → Tasks 3 and 2.

**Not in this plan, and deliberately:** the floating Log button and its overlay (§A2.4), the Food merge (§A2.5), the Trends rename and the weight view (§A2.3) — all step 6 and step 7 of §A2.6. The Diary keeps its current composer-free foot and the nav is untouched, so this plan ships a working Diary without touching navigation.

**Type consistency.** `MealSlot` and `MEAL_SLOTS` are defined once in Task 1 and consumed under those names in Tasks 2 and 5. `MealGroup`/`MEAL_GROUPS` (Task 2) extend them with `'earlier'` and are consumed under those names in Task 4. `mealTotals` returns `Record<MealGroup, DayTotals>` in both the task that defines it and the task that reads it.

**Review Focus.** Each of the five has a named test in the task that owns the code — 1 and 4 in Task 2, 2 in Task 4, 3 in Task 5, 5 in Task 3 — and three of them carry a discrimination check, because the preceding branch shipped two tests that passed whatever the code did.

**Proportion.** Five tasks over roughly a page of spec. No step carries a function body; the two places where a decision could not be left open — the clock boundary table and the five-group shape of `mealTotals` — are stated as values and signatures rather than as code.
