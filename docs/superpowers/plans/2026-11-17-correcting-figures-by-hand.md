# Correcting Figures By Hand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner correct a logged entry's nutrient figures, and a batch's figures, by hand — every field optional, a blank field meaning unknown rather than zero, and the correction visible as a correction.

**Architecture:** Nutrient figures live on `DiaryEntry` itself, not on its items, so a correction replaces entry-level figures and records which keys the person typed. It then goes through the existing revise path, which already re-runs the warning gate and already stores an insert-only revision. Batches already cannot rewrite logged entries, because entries snapshot their own figures at commit — the spec asked the builder to confirm that; it is confirmed below, so no work is needed to make it true.

**Tech Stack:** Vite 5 + React 18 + TypeScript strict (`noUncheckedIndexedAccess`) + Tailwind; Vitest + @testing-library/react + jsdom + fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-11-16-targets-weight-and-daily-health-design.md` — §8.2. Read it; this plan argues from it.

## What is already true, so no task builds it

Read these before starting; three of the spec's requirements are already met by existing code.

- **A revise path exists and already re-runs the gate.** `useEntryFlow.submit(text, { revises: { id, at } })` resolves, opens the warning gate, and on confirmation calls `reviseEntry`. It preserves the original `at` (`useEntryFlow.ts:273`), so a correction cannot move an entry to today.
- **`reviseEntry` is insert-only.** `db.ts` writes a new row with `revisionOf` and marks the original `state: 'superseded'`. Nothing is overwritten.
- **Batch edits cannot rewrite history.** `batches.ts:167` states it: diary rows "snapshotted their own nutrients at commit, so they are not and cannot be altered here." §8.2 asked the builder to confirm this and make it true if it was not. It is true. **Pin it with a test (Task 6); do not re-engineer it.**

## Ruling the spec needs: corrections apply to the entry, not to its items

§8.2 says "An entry's items and a batch's total can have their macros edited". `FoodRef` carries `grams`, `classification` and `fped` — **it carries no nutrients**. Nutrients live once per entry, in `DiaryEntry.nutrients` with `DiaryEntry.coverage` beside them. Giving each item its own nutrient set would be a far larger change to the data model, the totals, the rules and the export format than §8.2 describes, and it would buy nothing: what the person wants to fix is the figure they can see, which is the entry's.

**So: a correction replaces entry-level figures.** The spec sentence is read as "the figures on an entry, and a batch's figures". If a later phase needs per-item nutrients it can introduce them then.

## Global Constraints

- **A test written in this plan as a name with an empty body, or as a comment, is a description of the assertion — not permission to omit it.** Every one must become a real assertion with the spec's values in it. This was ruled during the previous plan's execution after eight such bodies appeared across three tasks, and it is restated here because this plan contains them too. An empty test is a defect under the review rubric; reviewers are to flag it.
- **An absent nutrient key means UNKNOWN, never zero.** Clearing a corrected field must remove the key, not set it to `0`.
- **Food is never silently added or removed.** A correction passes the warning gate before it is stored, and cancelling the gate leaves the original entry untouched and `active`.
- A figure the person typed is theirs: never describe it with a source, and mark it wherever it appears.
- Figures are snapshotted at commit and never recomputed from food ids — a correction writes a new snapshot, it does not teach the app to recompute.
- No new runtime dependency.
- TypeScript strict with `noUncheckedIndexedAccess`.
- Phone-first: works at 375 px, every interactive control at least 44 px, **every colour has its `dark:` pair**.
- Public repository: no secret and no personal profile value in any file, including fixtures. `npm test` runs `scripts/check-no-secrets.sh` first.
- Commands: `npx vitest run <files>` while working; `npm test`, `npx tsc --noEmit`, `npm run build` before each commit.

## Review Focus

Five conditions the spec implies that no happy path exercises. Each has its test added to the task that owns the code.

1. **A corrected field is cleared again.** Expected: the key returns to absent, the day's total reports that nutrient as partial or unknown, and nothing anywhere shows `0`. The commonest way to turn a correction into a lie. → Task 1.
2. **A correction pushes a figure past a ceiling, and the person cancels the gate.** Expected: the original entry is still `active`, no revision row exists, and the day's totals are unchanged. → Task 3.
3. **Correcting an entry that is itself already a revision.** Expected: a chain — the second revision's `revisionOf` points at the first, the first becomes `superseded`, and the day counts exactly one of them. → Task 3.
4. **A corrected entry is exported and re-imported.** Expected: the corrected figures and the record of which keys were corrected both survive, and the restored entry still renders as corrected. → Task 5.
5. **A correction is made to an entry on a past day.** Expected: the revision keeps the original `at`, so it stays on that day and does not jump to today. Already true in `useEntryFlow.ts:273`; untested for this path. → Task 3.

---

### Task 1: What a correction is, in the domain

**Files:**
- Create: `src/domain/corrections.ts`
- Modify: `src/types/diary.ts`
- Test: `tests/domain/corrections.test.ts`

**Interfaces:**
- Consumes: `NutrientSet`, `Coverage`, `NutrientKey` from `@/types/nutrients`.
- Produces:
  - `DiaryEntry.correctedKeys?: NutrientKey[]` — which figures the person typed. An array rather than a boolean, because the entry must be able to say *which* numbers are theirs.
  - `export type Correction = Partial<Record<NutrientKey, number | null>>` — a value sets the figure, `null` clears it, an absent key leaves it alone.
  - `export function applyCorrection(base: { nutrients: NutrientSet; coverage: Coverage; correctedKeys?: NutrientKey[] }, c: Correction): { nutrients: NutrientSet; coverage: Coverage; correctedKeys: NutrientKey[] }`

- [ ] **Step 1: Write the failing test**

```ts
test('a corrected figure is known, because the person asserted it', () => {
  const out = applyCorrection({ nutrients: { energyKcal: 500 }, coverage: { energyKcal: 'partial' } }, { sodiumMg: 900 });
  expect(out.nutrients.sodiumMg).toBe(900);
  expect(out.coverage.sodiumMg).toBe('known');
  expect(out.correctedKeys).toContain('sodiumMg');
});

// Review Focus 1.
test('clearing a corrected figure removes the key, and never writes a zero', () => {
  const base = { nutrients: { sodiumMg: 900 }, coverage: { sodiumMg: 'known' as const }, correctedKeys: ['sodiumMg' as const] };
  const out = applyCorrection(base, { sodiumMg: null });
  expect('sodiumMg' in out.nutrients).toBe(false);
  expect('sodiumMg' in out.coverage).toBe(false);
  expect(out.correctedKeys).not.toContain('sodiumMg');
});

test('a key the correction does not mention is left exactly as it was', () => {});

test('a non-finite or negative value is refused, leaving the figure as it was', () => {
  // NaN, Infinity, -1. The form validates too; this is the last line.
});

test('correcting a key twice does not list it twice', () => {});
```

- [ ] **Step 2: Run it and watch it fail.** `npx vitest run tests/domain/corrections.test.ts`

- [ ] **Step 3: Implement `applyCorrection` and add `correctedKeys` to `DiaryEntry`**

Pure; no store access. The header comment must say why a cleared key is deleted rather than zeroed, in the style of `src/domain/totals.ts`.

- [ ] **Step 4: Run it and watch it pass.**

- [ ] **Step 5: Commit**

```bash
git add src/domain/corrections.ts src/types/diary.ts tests/domain/corrections.test.ts
git commit -m "feat: a correction sets or clears a figure, and clearing means unknown"
```

---

### Task 2: A corrected figure says it is the person's own

**Files:**
- Create: `src/ui/components/CorrectedBadge.tsx`
- Modify: `src/ui/components/EntryRow.tsx`
- Test: `tests/ui/correctedBadge.test.tsx`

**Interfaces:**
- Consumes: `DiaryEntry.correctedKeys` (Task 1).
- Produces: `CorrectedBadge` — a default-exported component in the shape of `SelfReportedBadge`.

Read `src/ui/components/SelfReportedBadge.tsx` first and follow it: same structural idea, different words. It marks numbers the person typed from a package; this marks numbers the person corrected after the fact. Its `title` must say what was corrected and that the rest of the entry's figures are unchanged.

- [ ] **Step 1: Write the failing test**

```ts
test('an entry with corrected figures is marked', () => {});
test('an entry with none is not marked', () => {});
test('the badge names which figures were corrected', () => {});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement the badge and render it in `EntryRow`.** Every colour needs its `dark:` pair.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/CorrectedBadge.tsx src/ui/components/EntryRow.tsx tests/ui/correctedBadge.test.tsx
git commit -m "feat: an entry whose figures were corrected says so"
```

---

### Task 3: Correcting an entry goes through the warning gate

**Files:**
- Modify: `src/state/useEntryFlow.ts`
- Test: `tests/ui/entryFlow.test.tsx`

**Interfaces:**
- Consumes: `applyCorrection`, `Correction` (Task 1); `reviseEntry` (existing).
- Produces: `flow.correctEntry(entry: DiaryEntry, c: Correction): Promise<void>` — applies the correction to the entry's own figures, opens the warning gate with the resulting resolution, and on confirmation stores it through the existing `revises` path.

**This task must not re-parse `rawText`.** The food is not changing; only the figures are. `submitKnownFood` is the precedent for entering the gate without going through the parser — read it before writing this. Carry the entry's existing `items`, `classification` and `fped` through unchanged.

- [ ] **Step 1: Write the failing test**

```ts
test('a correction opens the gate before anything is stored', async () => {});

test('confirming stores a revision and supersedes the original', async () => {
  // revisionOf points at the original; the original's state becomes 'superseded'.
});

// Review Focus 2.
test('cancelling the gate leaves the original active and writes no revision', async () => {});

// Review Focus 5.
test('a correction to a past day keeps that day', async () => {
  // the revision's `at` equals the original's `at`, not now.
});

// Review Focus 3.
test('correcting an already-corrected entry chains instead of corrupting', async () => {
  // second.revisionOf === first.id; first.state === 'superseded'; the day counts one entry.
});

test('a correction that crosses a ceiling shows that card in the gate', async () => {});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement `correctEntry`.** Reuse the existing gate and `revises` machinery; do not build a second path through it.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/state/useEntryFlow.ts tests/ui/entryFlow.test.tsx
git commit -m "feat: correcting an entry's figures passes the warning gate first"
```

---

### Task 4: The correction form

**Files:**
- Modify: `src/ui/screens/EntryDetail.tsx`
- Test: `tests/ui/entryDetail.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `flow.correctEntry` (Task 3), `CorrectedBadge` (Task 2).

The six figures the diary already shows are the ones to offer: `SHOWN` in `EntryDetail.tsx` is `['energyKcal', 'proteinG', 'fibreG', 'sodiumMg', 'satFatG', 'addedSugarsG']`. Each field pre-fills with the current figure, or blank when the app does not know it. A blank field left blank changes nothing; a field emptied that had a value clears it.

- [ ] **Step 1: Write the failing test**

```ts
test('each field pre-fills with the figure the entry holds', async () => {});
test('a field the app does not know is blank, not zero', async () => {});
test('emptying a field that had a value clears it', async () => {});
test('saving opens the gate rather than writing straight away', async () => {});
test('the form says a blank field means unknown', async () => {});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Build the form.**

One sentence above the fields saying what a blank field means, in this project's calm register. Follow the existing numeric-field pattern in `ProfileSettings.tsx` (`fieldClass`, `inputMode="decimal"`, `step="any"`). Reject a negative or non-finite value at the form with a message, rather than passing it down.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/EntryDetail.tsx tests/ui/entryDetail.test.tsx
git commit -m "feat: correct an entry's figures from its detail screen"
```

---

### Task 5: A correction survives a backup

**Files:**
- Modify: `src/data/exportImport.ts`
- Test: `tests/data/exportImport.test.ts`

**Interfaces:**
- Consumes: `DiaryEntry.correctedKeys` (Task 1).

Follow the file's existing contract exactly: it **throws on the first problem and writes nothing**. A `correctedKeys` that is not an array of known nutrient keys rejects the file; it is not dropped. That ruling was made for `bodyFatPct` and `goal` earlier in this project and holds here — a silent drop on restore is the one failure this app cannot afford.

- [ ] **Step 1: Write the failing test**

```ts
// Review Focus 4.
test('corrected figures and the record of which keys were corrected both survive a round trip', async () => {});
test('a correctedKeys that is not an array of nutrient keys rejects the file, leaving the store unchanged', async () => {});
test('an entry with no correctedKeys imports with the field absent, not an empty array', async () => {});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Validate and carry the field.**

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/data/exportImport.ts tests/data/exportImport.test.ts
git commit -m "feat: a corrected entry survives backup and restore"
```

---

### Task 6: Correcting a batch, and proving history is safe

**Files:**
- Modify: `src/ui/screens/BatchBuilder.tsx`
- Test: `tests/ui/batches.test.tsx`, `tests/domain/batchHistory.test.ts` (create)

**Interfaces:**
- Consumes: `rebuildBatch(b, changes, lookup)` and `saveBatch` (existing, `src/domain/batches.ts`).

Two separate deliverables, which is why they share a task: the edit, and the proof that the edit is safe.

- [ ] **Step 1: Write the failing test**

```ts
// The deliverable.
test('a batch\'s figures can be corrected by hand, and a blank field leaves the figure unknown', async () => {});

// The proof, and the spec's open question answered. This should PASS before the change:
// it characterises behaviour batches.ts:167 already claims. Say so in the commit message.
test('editing a batch does not change entries already logged from it', async () => {
  // log a portion, record the entry's nutrients, edit the batch, assert the entry is byte-identical
  // and that the day's totals did not move.
});

test('a portion logged after the edit uses the new figures', async () => {});
```

- [ ] **Step 2: Run them.** The first fails; the history test should already pass — confirm that, and say so, rather than assuming it.

- [ ] **Step 3: Add the batch correction form**, following Task 4's field pattern and wording so the two screens do not disagree.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Full verification, then commit**

Run `npm test`, `npx tsc --noEmit`, `npm run build` — all must pass.

```bash
git add src/ui/screens/BatchBuilder.tsx tests/ui/batches.test.tsx tests/domain/batchHistory.test.ts
git commit -m "feat: correct a batch's figures, and pin that logged entries never move"
```

---

## After this plan

Phases 4–7 of the spec, in its order: daily health data (sleep, steps, energy burned), the diary rebuild (meal slots, the day's figures, the composer, icon nav), the weight page, then the weekly copy and the reminder. The weight page depends on the daily health data for `Targets.basis.expenditure`, which carries only `'formula'` until then.
