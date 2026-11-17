# Daily Health Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a sleep score, a step count and a day's energy burned per day, typed in from Samsung Health, and use the energy figure to replace the activity-multiplier guess in the energy target.

**Architecture:** A new IndexedDB store keyed by local day, separate from entries because this is not food. `computeTargets` gains one optional input — a reported expenditure — and sets `basis.expenditure = 'reported'` when it uses it. Everything else about the targets is unchanged. Steps and sleep are recorded and shown, and enter no calculation at all.

**Tech Stack:** Vite 5 + React 18 + TypeScript strict (`noUncheckedIndexedAccess`) + Tailwind; Vitest + @testing-library/react + jsdom + fake-indexeddb; IndexedDB via `idb`.

**Spec:** `docs/superpowers/specs/2026-11-16-targets-weight-and-daily-health-design.md` — §8.4, with §7.1 and §8.1 for what the energy figure is for. Read it; this plan argues from it.

## What this plan deliberately does NOT do

- **Weight is not touched.** §8.4 is explicit: `profile.weightLog` stays the single source of truth and a second weight field would mean two answers to "what do I weigh". Weight entry stays where it is; the Diary's weight cell arrives with the Diary rebuild (§8.3), which is the next plan.
- **The Diary is not restructured.** This plan adds one section to the Diary as it stands. Meal slots, the day's figures, the composer and the icon nav are all §8.3, next plan. Do not start them here.
- **`basis.expenditure = 'observed'` is not built.** That is the weight page's (§8.5): it is back-calculated from measured weight change. This plan makes `'reported'` real and leaves `'observed'` reserved, exactly as `'reported'` was reserved before today.

## Global Constraints

- **An absent value means UNKNOWN, never zero.** A day with no step count is not a day with no steps. A blank field is unknown; `0` steps is a claim.
- **Steps are context and enter no calculation.** A total-burn figure already contains them; adding them to anything would count the same energy twice. Say so where they are shown.
- **Sleep is outside the arithmetic.** The association between short sleep and weight gain is real in the literature but confounded, and this app does not convert an association into a number. Record it, show it, compute nothing from it.
- Every figure typed by the person is theirs: marked self-reported, never described with a source.
- Every health figure shown carries a source; an unsourced threshold is labelled as the app's own choice.
- No new runtime dependency. TypeScript strict with `noUncheckedIndexedAccess`.
- Phone-first: works at 375 px, every interactive control at least 44 px, **every colour has its `dark:` pair**.
- Public repository: no secret and no personal profile value in any file, including fixtures. `npm test` runs `scripts/check-no-secrets.sh` first.
- **A test written in this plan as a name with an empty body, or as a comment, is a description of the assertion — not permission to omit it.** Every one must be a real assertion. This has been ruled twice on this project and reviewers are instructed to flag an empty test as Important.
- Commands: `npx vitest run <files>` while working; `npm test`, `npx tsc --noEmit`, `npm run build` before each commit.

## Rulings this plan settles, so no task has to guess

**The reported figure is the mean of the last 7 days ending yesterday, and it needs at least `MIN_LOGGED_DAYS` of them.** Today is excluded because the day is not over and its burn figure would be a partial. The minimum is the same constant the trends and the pattern notes already use (`src/domain/trends.ts`), not a new number — this project has one answer to "enough days" and should keep it. Below the minimum, `basis.expenditure` stays `'formula'` and the activity multiplier is used, exactly as today.

**`computeTargets` gains a third parameter, not a new function.** `computeTargets(profile, on, reportedKcal?)`. A separate "adjust the targets afterwards" function would mean two places compute a target and the screens could disagree about the same figure — which is the seam the previous plan's review found twice. Every call site passes it or does not; a call site that passes nothing behaves exactly as today.

**A burn figure below the person's estimated resting rate is flagged, not rejected and not silently accepted.** §8.4: it is almost certainly the active-energy figure rather than the whole day's, and the two differ by roughly a resting metabolism. Someone bedbound for a day is possible, so the app asks rather than refuses.

## Review Focus

Five conditions the spec implies that no happy path exercises. Each has its test added to the task that owns the code.

1. **A day with a step count but no burn figure.** Expected: the step count is kept and shown, and the expenditure figure ignores that day entirely rather than treating its burn as zero — which would drag the mean down and lower the energy target. The most damaging way this feature can go wrong. → Task 4.
2. **A burn figure typed as the active-energy number** (e.g. 600 kcal for someone whose resting rate is 1,700). Expected: flagged with what the app suspects and why, the person can confirm it, and nothing is silently discarded. → Tasks 3 and 4.
3. **A sleep score outside 0–100**, or a negative step count. Expected: refused at the form with a message, and refused by the store, so a hand-edited backup cannot inject one. → Tasks 1 and 3.
4. **A health record for a day with no food entries at all.** Expected: it saves and survives — the two are independent records, and someone may log their sleep on a day they did not log food. → Task 1.
5. **An existing diary upgrading to the new store.** Expected: the new store is created without touching entries, and a database already at the new version with data is left alone. → Task 1.

---

### Task 1: The daily health record and its store

**Files:**
- Create: `src/types/health.ts`, `src/data/healthDays.ts`
- Modify: `src/data/db.ts`
- Test: `tests/data/healthDays.test.ts`

**Interfaces:**
- Produces:
  - `export type HealthDay = { date: string; sleepScore?: number; steps?: number; energyBurnedKcal?: number }` — `date` is a local day key (`localDayKey` from `src/domain/dayBoundary.ts`), and is the store's `keyPath`. Every figure optional; absent means unknown.
  - `export async function putHealthDay(d: HealthDay): Promise<void>` — validates and writes. A record whose every figure is absent **deletes** the row rather than storing an empty one, so "I cleared all three" does not leave a record claiming a day was filled in.
  - `export async function healthDaysBetween(fromDayKey: string, toDayKey: string): Promise<HealthDay[]>` — inclusive, oldest first.
  - `export async function getHealthDay(dayKey: string): Promise<HealthDay | undefined>`

`db.ts`: `DB_VERSION` goes to 3 and `'healthDays'` joins `STORES` and `create()`. Read `create()` first — it is written to add only what is missing, so it serves a fresh database, an upgrade and the repair path alike. Do not restructure it.

- [ ] **Step 1: Write the failing test**

```ts
test('a day round-trips with only the figures that were given', async () => {
  await putHealthDay({ date: '2026-11-17', steps: 8412 });
  const back = await getHealthDay('2026-11-17');
  expect(back).toEqual({ date: '2026-11-17', steps: 8412 });
  expect('sleepScore' in back!).toBe(false); // absent, never 0
});

// Review Focus 3.
test.each([
  ['sleepScore', -1], ['sleepScore', 101], ['steps', -1],
  ['energyBurnedKcal', -1], ['steps', Number.NaN], ['energyBurnedKcal', Number.POSITIVE_INFINITY],
])('%s of %s is refused and nothing is written', async (field, value) => {
  await expect(putHealthDay({ date: '2026-11-17', [field]: value })).rejects.toThrow();
  expect(await getHealthDay('2026-11-17')).toBeUndefined();
});

test('a record with every figure cleared removes the row', async () => {});

// Review Focus 4.
test('a health day saves on a date with no food entries, and both survive', async () => {});

// Review Focus 5.
test('an existing database with entries gains the store without losing them', async () => {
  // Plant a v2 database holding one entry, then open through db.ts and assert the entry is still readable
  // and healthDays exists. Follow tests/data/dbRepair.test.ts for how to plant a database at a version.
});

test('healthDaysBetween returns the range inclusive, oldest first, and excludes days outside it', async () => {});
```

- [ ] **Step 2: Run them and watch them fail.** `npx vitest run tests/data/healthDays.test.ts`

- [ ] **Step 3: Add the type, the store and the three functions**

Validation style follows `assertEntryFinite`/`assertFiniteValues` in `db.ts`: throw, do not drop. A sleep score is 0–100 inclusive; steps and energy are finite and at least 0.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/types/health.ts src/data/healthDays.ts src/data/db.ts tests/data/healthDays.test.ts
git commit -m "feat: a per-day record for sleep, steps and energy burned"
```

---

### Task 2: It survives a backup, and an erase clears it

**Files:**
- Modify: `src/data/exportImport.ts`, `src/data/db.ts`
- Test: `tests/data/exportImport.test.ts`, `tests/data/db.test.ts`

**Interfaces:**
- Consumes: `HealthDay`, the `healthDays` store (Task 1).
- Produces: `ImportRows` gains `healthDays: HealthDay[]`.

The file's contract, in its own header: **it throws on the first problem and writes nothing.** A malformed health day rejects the file. Follow how entries and custom foods are validated, and note the ruling from the previous plan: reject a value that is structurally wrong, but do not reject a *forward-compatible unknown field*.

`eraseEverything` clears the new store alongside the others; the import's replace mode clears it too.

- [ ] **Step 1: Write the failing test**

```ts
test('health days round-trip through export and import', async () => {});
test('a malformed health day rejects the whole file and leaves the store unchanged', async () => {});
test('replace mode clears health days that are not in the file', async () => {});
test('erasing everything removes health days', async () => {});
test('a backup written before this feature imports with no health days and no error', async () => {});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Carry the rows through export, validation, import and erase.**

Do **not** bump the export version: it is compared with `!==`, so a bump makes every existing backup unreadable. An older file simply has no `healthDays` key, which reads as none.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/data/exportImport.ts src/data/db.ts tests/data/exportImport.test.ts tests/data/db.test.ts
git commit -m "feat: daily health data is carried by backup and cleared by erase"
```

---

### Task 3: Typing the day in, on the Diary

**Files:**
- Create: `src/ui/components/DayHealthForm.tsx`
- Modify: `src/ui/screens/Diary.tsx`
- Test: `tests/ui/dayHealth.test.tsx`

**Interfaces:**
- Consumes: `putHealthDay`, `getHealthDay` (Task 1); `figureText` and `readFigure` from `src/ui/components/figureForm.tsx`.

**Reuse `figureForm.tsx`.** It was extracted in the previous plan precisely so a second numeric form does not become a third copy: it holds the display rounding, the changed/cleared/refused logic, both error strings, and the save-time `validity.badInput` read. **Do not cache `badInput` in React state** — a cached flag goes stale when an empty field becomes empty again, which was reproduced in a real browser.

Three fields for the day being viewed, each optional and blank when unknown:
- **Sleep score (0–100)** — labelled as Samsung Health's score, with no claim about what it means for health.
- **Steps** — with a line saying they are recorded as context and are not added to any calculation, because a whole-day burn figure already includes them.
- **Energy burned (kcal)** — labelled unambiguously as **the whole day, not active calories**, with a line saying which figure to copy. The two differ by roughly a resting metabolism.

All three are the person's own readings, so the section says so once, in the register `SelfReportedBadge` uses for a figure typed from a packet — §8.4 requires these be marked self-reported. One sentence for the section, not a badge per field: every figure here is theirs, so a per-field mark would say nothing a reader does not already know.

**The flag in Review Focus 2 needs the resting rate**, which is `computeTargets(profile, now).rmrKcal`. The form therefore needs the profile; take it as a prop rather than reading the store from inside the component, so the test can supply one. When there is no usable profile the app has no resting rate to compare against, so no flag is shown — and that is correct, not a gap.

- [ ] **Step 1: Write the failing test**

```ts
test('each field is blank when the day has no figure, never 0', async () => {});
test('saving stores only the figures that were typed', async () => {});
test('clearing a figure removes it rather than storing a zero', async () => {});

// Review Focus 2.
test('a burn figure below the resting rate is flagged, and can still be confirmed', async () => {
  // resting rate ~1700: typing 600 shows a note naming the suspicion (the active figure, not the whole day)
  // and the person can confirm; nothing is discarded silently.
});

// Review Focus 3.
test('a sleep score of 101 is refused at the form with a message', async () => {});

test('the steps field says it is not added to any calculation', async () => {});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Build the form and place it on the Diary.**

It reads and writes the day the Diary is currently showing, so moving back a day shows that day's figures.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/DayHealthForm.tsx src/ui/screens/Diary.tsx tests/ui/dayHealth.test.tsx
git commit -m "feat: record a day's sleep, steps and energy burned from the diary"
```

---

### Task 4: The reported expenditure replaces the activity guess

**Files:**
- Create: `src/domain/expenditure.ts`
- Modify: `src/domain/targets.ts`
- Test: `tests/domain/expenditure.test.ts`, `tests/domain/targets.test.ts`

**Interfaces:**
- Consumes: `HealthDay` (Task 1), `MIN_LOGGED_DAYS` from `src/domain/trends.ts`.
- Produces:
  - `export function reportedExpenditure(days: HealthDay[], on: Date): number | undefined` — the mean `energyBurnedKcal` of the last 7 days **ending yesterday**, or `undefined` when fewer than `MIN_LOGGED_DAYS` of them carry one.
  - `computeTargets(profile, on, reportedKcal?)` — when a figure is given and the targets are not generic, it replaces `rmr × activityFactor` as maintenance, and `basis.expenditure` becomes `'reported'`.

- [ ] **Step 1: Write the failing test**

```ts
// Review Focus 1 — the most damaging failure this feature has.
test('a day with steps but no burn figure is ignored, never counted as zero', () => {
  // 5 days at 2,600 plus one day with steps only -> the mean is 2,600, not 2,167.
});

test('fewer than the minimum days gives undefined, so the formula is still used', () => {});
test('today is excluded, because the day is not over', () => {});
test('the mean is taken over the days that have a figure, oldest to yesterday', () => {});

test('a reported figure replaces the activity multiplier and names itself in the basis', () => {
  const t = computeTargets(profileAt(80, 'light'), on, 2600);
  expect(t.energyKcal).toBe(2600);
  expect(t.basis.expenditure).toBe('reported');
});

test('no reported figure leaves every target exactly as it is today', () => {
  expect(computeTargets(p, on, undefined)).toEqual(computeTargets(p, on));
});

test('generic targets ignore a reported figure', () => {
  // A stranger's expenditure is meaningless; the same gate protein and the goal already use.
});

test('a goal offset still applies on top of the reported figure, and the floor still holds', () => {});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement both.**

The share-derived figures (saturated fat, added sugars, trans fat, fibre) follow the **adjusted** energy as they already do — read the comment at `derive`'s single `energy` binding before changing anything, and do not duplicate it.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/domain/expenditure.ts src/domain/targets.ts tests/domain/expenditure.test.ts tests/domain/targets.test.ts
git commit -m "feat: a reported energy burn replaces the activity-multiplier guess"
```

---

### Task 5: Saying where the energy figure came from

**Files:**
- Modify: `src/state/useEntryFlow.ts`, `src/ui/screens/Missing.tsx`, `src/ui/screens/ProfileSettings.tsx`
- Test: `tests/ui/profileSettings.test.tsx`, `tests/ui/missing.test.tsx`

**Interfaces:**
- Consumes: `reportedExpenditure` (Task 4), `healthDaysBetween` (Task 1).

Every caller of `computeTargets` now supplies the reported figure, so the screens and the warning engine agree about the same number. `ProfileSettings`'s `TargetSources` already names the basis for protein and energy; it gains the expenditure source in the same voice — the formula and its activity factor, or the person's own reported figure and over how many days.

**This is where the previous plan's seam could reopen.** Two screens disagreed about where the energy target came from once already. Whatever wording is chosen must be the same sentence in one place, imported by both, not two copies.

- [ ] **Step 1: Write the failing test**

```ts
test('with enough reported days, the screen says the figure is the person\'s own and over how many days', async () => {});
test('without them, it still names the formula and the activity factor', async () => {});
test('the warning engine sees the same energy target the screen shows', async () => {
  // computeTargets through useEntryFlow's path and through the screen's path agree.
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Thread the figure through and write the sentence once.**

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Full verification, then commit**

Run `npm test`, `npx tsc --noEmit`, `npm run build` — all must pass.

```bash
git add src/state/useEntryFlow.ts src/ui/screens/Missing.tsx src/ui/screens/ProfileSettings.tsx tests/ui/profileSettings.test.tsx tests/ui/missing.test.tsx
git commit -m "feat: the screens and the rules agree on where the energy figure came from"
```

---

## After this plan

§8.3 the Diary rebuild (meal slots, the day's figures, the composer, icon nav), then §8.5 the weight page — which turns `basis.expenditure` into `'observed'` by back-calculating from measured weight change — then §8.6 the weekly copy and the reminder.

Carried from the previous plan and still open: a shared figures-form component (`fieldClass` still lives in the `FirstRun` screen, and the entry and batch forms are still structurally asymmetric); the ingredient-edit screen gives no warning that it replaces hand-typed figures; and the entry screen's Edit path silently discards them.
