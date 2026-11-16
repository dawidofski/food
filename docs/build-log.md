# Build log: decisions taken on the owner's behalf

Building this app meant settling roughly 150 questions the plan did not answer. Each was recorded as it was
made, with the reasoning and what it would cost if it turned out wrong. The whole record is preserved here
because the scratch workspace it was written in is deleted when the build finishes, and a decision that dies
with its workspace was made in secret.

Read it if you want to know *why* something is the way it is. The entries that matter most are the ones
marked **Ruling**, and the two marked **MY ERROR**. Everything here is reworkable.

---

# SDD ledger — plan: docs/superpowers/plans/2026-11-15-food-diary-health-warnings.md

**Spec:** docs/superpowers/specs/2026-11-15-food-diary-health-warnings-design.md (read)
**Repo:** C:/Users/[owner]/Downloads/food — git initialised at 3d7237e, branch `feat/food-diary`
**Workspace:** .superpowers/sdd/2026-11-15-food-diary-health-warnings
**Node:** v24.13.0, npm 11.6.2

Setup note: the project directory was empty and not a git repo. Initialised it,
committed the design + plan, and branched to `feat/food-diary` so no task
implements on `main`. No worktree: a worktree of a one-commit fresh repo buys
nothing over a feature branch.

---

## Pre-flight scan

### Task-pair rows (shared file or interface)

| Tasks | Produces → consumes | Finding |
|---|---|---|
| 2 → 4 | `DatasetFood` | **Conflict.** T2 creates `src/types/food.ts`; T4 declares `DatasetFood` but lists no file for it. |
| 2 → 7, 9, 10, 15, 16 | `NutrientSet`, `Coverage`, `ClassificationFlags` | Clean — names consistent at every use. |
| 4 → 5 | `foods.json`, `DatasetFood` | Clean. |
| 5 → 7, 18 | `searchFoods`, `getFood` | Clean. |
| 6 → 7, 16 | `ParsedItem`, `parseEntry` | Clean. |
| 7 → 15, 16 | `FoodLookup` (both Modify `resolveItems.ts`) | Clean — sequential, T15 then T16, no overlap in what each adds. |
| 7 → 8 | `src/types/diary.ts`, `DiaryEntry` | **Conflict.** T7 creates the file with `FoodRef`/`Resolution`; T8 declares `DiaryEntry` with no file named. |
| 7 → 18 | `Resolution.confidence`, `needsHelp` | Clean — T18 thresholds at 0.6, T7 defines confidence as 1 − mean score. |
| 8 → 9, 14, 17 | `entriesBetween`, `reviseEntry`, `deleteEntry` | Clean. |
| 9 → 10, 17 | `DayTotals`, `WeekContext` | Clean. |
| 10 → 11, 12, 13, 14 | `Rule`, `Context`, `WarningCard`, `evaluate` | **Conflict.** T10 enforces "no nutrition rule may declare CRITICAL", but no field on `Rule` distinguishes a safety rule. |
| 10 → 13 | `foodSafetyQuestionsFor` | **Gap.** Used in T13's tests, produced by neither task's interface block. |
| 11 → 12, 13 | `catalogue` in `index.ts` | Clean — each appends; T11's tone tests re-run over the enlarged catalogue by design. |
| 14 → 18 | `useEntryFlow` | Clean. |
| 15 → 17 | `CoverageNote` | Clean. |
| 1 → 3, 19 | `scripts/check-no-secrets.sh` vs `tests/fixtures/profile.ts` | **Conflict.** The guard greps the tracked tree for `[the owner's date of birth]`; T3 puts that exact string in a tracked fixture. The guard would fail the build at T3. |
| 1 → 9 | `vitest.config.ts` vs `tests/setup.ts` | **Gap.** T9 relies on `tests/setup.ts` setting `TZ`; T1 never creates it. |

### Per-task self-agreement rows

| Task | Own text agrees with itself? |
|---|---|
| 1 | **No.** Step 7 runs `git init`; the repo already exists. Also creates `vitest.config.ts` but no `tests/setup.ts`. |
| 2 | Yes. `energyShare(31,'satFatG',2834)` = 0.09845, matches the assertion to 3 dp. |
| 3 | Yes, arithmetically: RMR 2061.25→2061, ×1.375 = 2834.2→2834, satFat 31.5→31, addedSugar 70.85→71, fibre 39.7→40, protein 115.2→115 at 96 kg. |
| 4 | **Partly.** `buildAndFind(/no fped fixture/i)` names no actual fixture food. |
| 5 | Yes. |
| 6 | Yes — `-2 eggs` parses, rejection is T7's boundary, as T7's tests state. |
| 7 | Yes. |
| 8 | Yes. |
| 9 | **No.** Test 2 asserts `toBe(ternary on process.env.TZ)` — tautological when TZ is unset, i.e. a test that asserts nothing. |
| 10 | **Partly.** Step 2 reads "Expected: PASS impossible; Expected: FAIL". Rule names in its tests collide with T11's real exports. |
| 11 | Yes. 60+20=80 > 71 → MODERATE holds. |
| 12 | Yes. |
| 13 | Yes, given the `foodSafetyQuestionsFor` gap above. |
| 14 | Yes. |
| 15 | Yes. |
| 16 | Yes. |
| 17 | Yes. |
| 18 | Yes. |
| 19 | Yes, once the fixture-DOB ruling below lands. |

### Rulings

- **R1** — `DatasetFood` lives in `src/types/food.ts` (created T2). T4 modifies that file rather than declaring the type in `scripts/`. *Why:* one home per type, and T5 imports from `src/`, not from a build script. *Cost if wrong:* one import path to move.
- **R2** — `DiaryEntry` lives in `src/types/diary.ts`, created in T7 alongside `FoodRef`/`Resolution`; T8 extends that file with the persistence fields (`state`, `supersededBy`, `revisionOf`). *Why:* T7 already creates the file; splitting the entry type across two files would break T9's and T14's imports. *Cost if wrong:* a file move.
- **R3** — `Rule` gains `category: 'nutrition' | 'safety'` in T10. `evaluate` throws only when a `category: 'nutrition'` rule returns CRITICAL. *Why:* the spec's §9.2 invariant is unenforceable without it, and T10's own test demands the throw. *Cost if wrong:* a field rename across the catalogue.
- **R4** — T13 exports `foodSafetyQuestionsFor(ctx): SafetyQuestion[]` from `src/rules/catalogue/foodSafety.ts`; `evaluate` calls it through the normal rule interface. *Why:* keeps hazard-question logic beside the hazard list. *Cost if wrong:* one function moves into the engine.
- **R5** — **No real personal data in the repository, tests included.** `tests/fixtures/profile.ts` uses `dob: '1991-06-15'` (age 35 on 2026-11-15, so every pinned target is unchanged) and T3's `ageOn` tests use that date and `'1991-06-14'` for the day-before case. The owner's actual DOB is entered in the app at first run and never committed. *Why:* spec C2 plus G7; the plan's own secret guard would otherwise fail the build at T3. *Cost if wrong:* nothing — the numbers are identical.
- **R6** — `scripts/check-no-secrets.sh` greps for `sk-[A-Za-z0-9]{20,}`, `the DeepSeek key variable name`, and `[the owner's date of birth]`, excluding `.superpowers/` and `docs/`. *Why:* a bare `DEEPSEEK` grep would trip on the legitimate `api.deepseek.com` constant; `docs/` legitimately records the owner's profile in the approved design. *Cost if wrong:* a looser or tighter guard, caught by its own test.
- **R7** — T1 also creates `tests/setup.ts` setting `process.env.TZ = 'Europe/Amsterdam'` and importing `@testing-library/jest-dom`, wired via `setupFiles` in `vitest.config.ts`. *Why:* T9's day-boundary and DST tests are only deterministic with a fixed zone. *Cost if wrong:* one config line.
- **R8** — T1 skips `git init`; it commits onto the existing `feat/food-diary` branch. *Why:* the repo exists. *Cost if wrong:* none.
- **R9** — T9's second test is replaced with a deterministic assertion: `expect(localDayKey(new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-15')`, valid because R7 fixes the zone. *Why:* the plan as written mandates a test that asserts nothing, which the review rubric correctly treats as a defect. *Cost if wrong:* the test is stricter than planned, which is the point.
- **R10** — In T10's engine tests, every rule named (`sodiumEntryRule`, `addedSugarRule`, `reheatedRiceRule`, …) is a **local stub defined in the test file**, not an import from the catalogue, which does not exist until T11–T13. T11+ tests import the real exports. *Why:* the engine must be testable before any real rule exists. *Cost if wrong:* test-only churn.
- **R11** — T4's "no FPED value" fixture is an explicit row named `Test food, no FPED` in `tests/fixtures/usda/`. *Why:* the assertion needs a named target. *Cost if wrong:* a fixture rename.
- **R12** — T10 step 2 expected result is **FAIL**. *Why:* obvious typo in the plan. *Cost if wrong:* none.

---

## Task log

### Task 1 — scaffold, CI, deploy
- BASE 3d7237e, implementer commit 8d42028, status DONE_WITH_CONCERNS.
- Ruling: `weekly-review/` (an unrelated Google Apps Script project that appeared
  in this folder at 11:02-11:13 today) is added to `.gitignore` in commit ffe4b27.
  Verified it contains NO real key value — 9 references to the name
  `the DeepSeek key variable name` as a Script Properties lookup, 0 matches for `sk-...`.
  Nothing from it is tracked. Flagged to the user; moving it out of the folder
  is their call. Cost if wrong: one .gitignore line.
- Ruling: jsdom pinned to 29.1.1 rather than 31 accepted — 31 drops Node 20, which
  the CI workflow uses. Cost if wrong: a dev-dependency bump.
- Ruling: the guard script excluding itself is accepted (its own source contains the
  pattern text). Cost if wrong: a narrower exclusion.
- Open for the user at the end: GitHub Pages source must be set to "GitHub Actions"
  in repo settings; the deploy workflow has never run.
- Review package: review-3d7237e..8d42028.diff
- Task 1 review (sonnet): spec ✅, quality "Needs fixes" — 1 Important (guard fails
  open when `git ls-files` errors; reviewer reproduced exit 0 with .git removed).
- Task 1: minor (deferred): guard excludes itself from its own scan.
- Task 1: minor (deferred): guard scans tracked files only, so it is not a pre-commit
  hook — a secret is caught only after `git add`. Controller decision, stands.
- Task 1: minor (deferred): `@` alias block duplicated in vite.config.ts and
  vitest.config.ts; mergeConfig would be tidier, not necessary.
- Task 1: minor (deferred): TypeScript pinned 5.9.3 rather than latest.
- Task 1: fix round 1/5 dispatched to the original implementer — Important (fail-open
  guard) + Minor (`grep -H` so a single-file hit prints its path) + a regression test
  for the git-call failure path. FIX_BASE 8d42028.
- Task 1: fix round 1/5 (3 addressed, 0 open; commits 8d42028..06c965f). Re-reviewer
  confirmed the new tests genuinely fail against the old script, not tautologically.
- Task 1: minor (deferred): guard exits 2 when a tracked file is deleted from the
  worktree but not the index — fails closed, but blocks `npm test` for a non-leak reason.
- Task 1: minor (deferred): `mapfile -d ''` needs bash >= 4.4; macOS bash 3.2 would
  abort loudly. Git Bash + CI Ubuntu are fine.
- Task 1: minor (deferred): full tracked list passed as argv to grep instead of xargs
  batching; a very large tree could hit the Windows argv limit (fails loudly).
- **Task 1: complete (commits 3d7237e..06c965f, review clean)**

### Task 2 — core types and nutrient math
- BASE 06c965f.
- Ruling (refines R1): `src/types/food.ts` is created in Task 2 **already containing the
  full `DatasetFood` shape** that Task 4 emits, rather than Task 4 modifying a type file
  later. Why: Task 2's file list already owns that file, Task 5 imports the type from
  `src/`, and a type that two tasks co-author invites drift. Cost if wrong: Task 4
  extends the interface instead of authoring it.
- Task 2 implementer: commit d188b23, DONE_WITH_CONCERNS. Nutrients suite 5/5, full
  vitest 9/9, tsc clean — but `npm test` is RED at HEAD.
- **Ruling (reopens Task 1, fix round 2/5):** Task 1's regression test
  `tests/scripts/check-no-secrets.test.ts` holds the literal fake key
  `a fake sk- style key` as a fixture. The guard scans all tracked files, so it
  matches its own test and `pretest` exits 1 — `npm test` cannot run at all.
  Decision: do NOT exclude `tests/` from the guard (a real secret in a test file is
  still a leaked secret); instead the test builds its fixture string at runtime so no
  tracked literal matches any guard pattern. Required proof: guard exits 0 on the tree
  AND the leak test still triggers a real hit. Cost if wrong: the guard stops covering
  test files, which is the outcome this ruling exists to avoid.
- Ruling: `energyShare` with `energyKcal <= 0` currently yields Infinity/NaN. Decision:
  guard it to return 0, with a test. Why: Review Focus 2 forbids NaN/Infinity reaching
  any total, and the rule engine divides by the energy target on every evaluation.
  Folded into Task 2's review round rather than a separate dispatch.
- Ruling: `mergeClassification([])` returning the identity (all false, novaGroup 1) is
  accepted as-is — callers always pass at least one set, and the identity is the correct
  neutral element. Cost if wrong: nothing; no caller depends on it.
- Task 1: fix round 2/5 dispatched (guard/test deadlock).
- Task 1: fix round 2/5 (1 addressed, 0 open; commit 1244a83). Controller verified
  `npm test` green at 1244a83: 3 files, 9 tests, guard OK.
- **Task 1: complete (commits 3d7237e..1244a83, review clean)** — reconfirmed after the
  reopened round.
- Task 2: energyShare zero-guard dispatched to its implementer before review.
- Task 2 review (sonnet): spec ✅, quality Approved, but 2 Important test-strength
  findings — no measured-zero case anywhere, and the `'known'` coverage branch never
  asserted. A truthiness-based implementation would have passed every original test.
- Ruling: the reviewer's Minor about `{key: undefined}` and non-finite `grams` producing
  NaN is promoted into this fix round. Why: "no NaN or Infinity in any total" is a hard
  global constraint, and `key in set` alone does not uphold it. Decision: a value counts
  as known only when `typeof v === 'number' && Number.isFinite(v)`; a present-but-
  non-finite value is treated as UNKNOWN (absent from the total), never as zero.
  Cost if wrong: a slightly stricter guard than the plan asked for.
- Task 2: minor (deferred → folded into the same round as cheap extras): energyShare
  4 kcal/g path untested; mergeClassification's other eight flags unasserted.
- Task 2: fix round 1/5 dispatched. FIX_BASE 0f16fbc.
- Task 2: fix round 1/5 (5 addressed, 0 open; commits 0f16fbc..a7acdc6). Re-reviewer
  settled the implementer's open question by reading the code: a truthy-check mutation
  IS caught by the zero tests, so the pins genuinely pin.
- Task 2: minor (deferred): Infinity is not pinned by a test as a value or as `grams`
  (same `Number.isFinite` path as NaN, so covered in practice).
- Task 2: minor (deferred): `energyShare(NaN, 'satFatG', 2834)` returns NaN — the guard
  checks the energy argument only, not the nutrient amount. Low risk now that totals are
  guaranteed finite; for the final review to triage.
- **Task 2: complete (commits 06c965f..a7acdc6, review clean)**
- Ruling: remaining pure-domain tasks go to a mid-tier model, not the cheapest. Task 2
  needed two fix rounds on a fully specified task; turn count beat token price.

### Task 3 — profile, age and targets
- BASE a7acdc6.
- Ruling (applies R5): the generic fallback profile used when no profile exists is
  175 cm, 70 kg, age 40, sex 'unspecified', light activity, `isGeneric: true`. Why: the
  spec requires the engine to work before first-run setup and to say it is using general
  guidelines; the basis must be deterministic and documented rather than improvised.
  Cost if wrong: the generic energy figure shifts; all guideline-derived limits that the
  tests pin are percentages of it and follow automatically.
- Task 3 implementer: commit 475fdc2, DONE_WITH_CONCERNS. npm test green, 4 files, 29
  tests, tsc clean. Generic basis yields 1516 RMR / 2084 kcal — matches the ruling.
- Ruling: the "unspecified sex takes the higher iron reference" rule has no home because
  `Targets` carries no micronutrient fields. Decision: micronutrient reference intakes
  are added to `Targets` in Task 17, which is the task that actually consumes them for
  the standing-gaps view. Not a Task 3 defect; carried into Task 17's dispatch.
  Cost if wrong: one field added a few tasks earlier than needed.
- Task 3: minor (deferred): git reports LF→CRLF conversion on the new files; a
  `.gitattributes` would silence it.
- Task 3 review (sonnet): spec ✅, quality Approved, no Critical/Important. Reviewer
  re-derived every pinned number by hand and confirmed the targets are computed, not
  hardcoded; `ageOn` and `currentWeightKg` correct in general, not just for the fixture.
- Note: this reviewer stated it did not read the implementer's report. Not material here
  — it verified the arithmetic independently rather than relying on claims — but the
  report file is a required input and I will restate that more firmly in later dispatches.
- Ruling: promoted one Minor into a fix round — `p.sex in SEX_CONSTANT` /
  `p.activityLevel in ACTIVITY_FACTORS` also match prototype keys, so a corrupt stored
  profile (`sex: 'constructor'`) yields NaN targets. "No NaN in any target" is a hard
  constraint and profiles come from browser storage. Decision: `Object.hasOwn` plus a
  final `Number.isFinite` fallback check, pinned by tests. Also pinned the generic
  1516/2084 arithmetic, since that basis was my ruling and nothing else locks it.
  Cost if wrong: two lines stricter than the plan asked.
- Task 3: minor (deferred): `ageOn` reads `on` in UTC — documented, behaviour unchanged.
- Task 3: minor (deferred): `dob` regex does not range-validate (`1991-13-45` accepted);
  the invalid-dob fallback test covers the consequence.
- Task 3: minor (deferred): overrides accept zero/negative finite values and use an
  `as Record<string, number>` cast; validation belongs at the settings UI (Task 19).
- Task 3: fix round 1/5 dispatched. FIX_BASE 475fdc2.
- Task 3: fix round 1/5 (6 addressed, 0 open; commits 475fdc2..06219f9). Re-reviewer
  confirmed the finiteness guard covers all ten numeric Targets fields, not a subset,
  and that `Object.hasOwn` still accepts all three sex and all five activity values.
- Controller verified green at 06219f9: 4 files, 33 tests, guard OK. `git grep [the owner's date of birth]`
  hits only docs/ and the guard's own pattern line — both excluded by design.
- **Task 3: complete (commits a7acdc6..06219f9, review clean)**

### Task 4 — USDA data pipeline
- BASE 06219f9.
- Known risk, flagged in the plan's own self-review: this task cannot be fully verified
  without the real USDA downloads (100 MB+, manual). Fixture tests pin the transformation;
  the real build is a separate step. If the download proves impractical in the subagent
  environment, the script plus documented manual instructions is the deliverable and the
  real build becomes a user step — that is an acceptable outcome, fabricated nutrient
  data is not.
- Task 4 implementer: commit 1da1bb6, DONE_WITH_CONCERNS. **Real build succeeded**:
  5,431 foods from FNDDS 2021-2023 + FPED 2021-2023, 451,522 bytes gzipped against the
  3 MB budget, so nothing was cut. npm test green (5 files, 41 tests).
- **Ruling: FNDDS zeros are kept as-is, and this is NOT a defect.** The implementer worried
  USDA writes 0 for undetermined micronutrients (vitamin D zero in 3,000 foods, B12 in
  2,031). Controller checked the distribution: FNDDS is a complete-profile database that
  imputes every value for dietary-recall analysis, and the zero counts match real-world
  nutrient presence — B12 is genuinely absent from all plant foods, vitamin D from nearly
  all. sodium zero in only 66 foods, saturated fat in 287, which is what real data looks
  like. Treating these as unknown would silence legitimate information, which is the
  mirror-image error of inventing data. Decision: keep source values; meta.json records
  that FNDDS values are imputed rather than per-sample assays. Cost if wrong: the
  micronutrient view slightly understates a few foods.
- **Ruling (carries into Tasks 13 and 19): allergen tags are indicative, never safety.**
  They are category- and name-derived and incomplete — 2,942 of 5,431 foods carry tags and
  "Bacon bits" carries none. Decision: the allergen rule must warn on *possible* presence
  and tell the user to check the label; the UI must never present an absent tag as
  allergen-free. meta.json already carries the caveat. Cost if wrong: an over-cautious
  allergen card, which is the right direction to err on a safety tier.
- **Ruling (carries into Task 5): the dataset file is hash-named** (`foods.96dc75b2a4.json`),
  so `loadFoods` must fetch `public/data/meta.json` first and read `file` from it. This
  changes Task 5's interface from the plan's fixed filename. Cost if wrong: one extra fetch.
- Ruling: Foundation Foods was dropped — its CSV release has no joinable per-food nutrient
  table. FNDDS alone carries complete profiles for foods as eaten, which is this app's use
  case. Cost if wrong: slightly shallower nutrient depth for whole foods.
- Controller spot-checked the curated layer against the built dataset: hot dog sandwiches
  processedMeat=true nova=4 sodium 694 mg/100 g; bacon bits processedMeat=true 1,770 mg;
  "Bacon and tomato dressing" correctly processedMeat=false; chicken breast false;
  broccoli vegetable=true nova=1. 258 processed-meat foods, 90 alcohol, 77 sweet drinks.
- Task 4: minor (deferred): `scripts/classification.ts` is 2,411 lines — acceptable as a
  reviewable data file, not logic.
- Task 4: minor (deferred): FPED ships as .xls and needs a Python converter with xlrd;
  the input dir needs a hand-written sources.json. Both documented in scripts/README.md.
- **For the user:** a stray empty tree exists at C:\c\Users\[owner]\Downloads\food\tests\
  fixtures\usda (8 copied fixture CSVs) from a bad absolute path in a scratch script.
  Removing it was blocked by a built-in safety check because `/c/c` resolves to a drive
  root. Harmless; the user can delete it.
- Review package: review-task4.diff (generated 4 MB dataset excluded, classification.ts
  truncated to its first 400 lines — it is 2,411 lines of lookup data).
- Task 4 review (sonnet): spec ✅, quality Approved, no Critical/Important. Reviewer
  independently probed the built dataset: 5,223 of 5,431 foods carry addedSugarsG, zero
  foods where addedSugarsG and fped presence disagree, transFat absent everywhere, and
  verified nutrient IDs/units (328 µg vitamin D not 324 IU; 4.2 g per tsp conversion).
  Confirmed no `?? 0` path exists and `sugarsG` never feeds `addedSugarsG`.
- Ruling: `processedMeat` on mixed dishes ("Turkey sandwich on white", "Chicken deli
  sandwich", "Pizza with meat other than pepperoni") STANDS. The reviewer suspected
  over-flagging; deli turkey, deli chicken and pizza meats are cured or preserved meats
  and so are processed meat by the IARC definition the app cites. Cost if wrong: a card
  on a sandwich the user considers fresh — visible and easily corrected in the data.
- Ruling: `nutrientKeyColumn`'s tie-break heuristic stands — the build-time unit check
  throws on a mismatch, which already catches a wrong column for any release.
- Ruling: `round()` at 4 significant digits stands — only matters above 10,000 per 100 g.
- Task 4: minor (deferred): no `classifyByFoodGroup` unknown-code or inherited-key test
  beyond what the fix round adds.
- Task 4: fix round 1/5 dispatched — override-precedence unit tests for `classifyFood`
  (it decides whether a HIGH processed-meat warning fires) and a thicker blank-nutrient
  fixture so a partial default-to-zero mutation cannot pass. FIX_BASE 1da1bb6.
- Task 4: fix round 1/5 (2 addressed, 0 open; commits 1da1bb6..0fe9d94). Test-only diff,
  no implementation change needed. The implementer ran the mutation itself — swapped the
  spread order in `classifyFood`, saw the override test fail, reverted — which is the exact
  question a re-reviewer would have been asked to settle by reading. Decision: controller
  verified directly (suite green, 49 tests, new tests present) instead of spending a
  re-review seat on a test-only diff whose key risk was already settled by an executed
  mutation. Recorded so this is not a silent shortcut; the loop had not triggered on any
  Critical/Important finding, these were promoted minors.
- **Task 4: complete (commits 06219f9..0fe9d94, review clean)**

### Task 5 — food repository
- BASE 0fe9d94.
- Carries the Task 4 ruling: the dataset is hash-named, so `loadFoods` fetches
  `data/meta.json` first and reads `file` from it.
- Ruling: fetch paths must be built from `import.meta.env.BASE_URL`, not absolute `/data/...`.
  Why: `vite.config.ts` sets `base: '/food/'` for GitHub Pages, so an absolute path would
  404 in production while working in dev — the worst kind of failure. Cost if wrong: the
  dataset never loads on the deployed site.
- Task 5 implementer: commit 6caff94, DONE_WITH_CONCERNS. 11/11 repository tests, full
  suite 6 files / 60 tests green, tsc clean. fuse.js 7.5.0 pinned, two-step fetch via
  meta.json, BASE_URL-relative URLs, single in-flight promise, score passed through.
- **Ruling: PLAN DEFECT in the search design, fixed inside Task 5.** The implementer
  flagged that real-dataset search quality was unverified. Controller measured it: Fuse
  with the brief's config over the real 5,431 foods resolves only 12 of 20 everyday
  queries within the 0.25 accept threshold, and two of those twelve are wrong.
    hot dogs 0.5489 OVER (but "hot dog" 0.1363) — the design doc's own worked example
    cola 0.1820 "ok" -> Chocolate candy — a confidently WRONG match inside the threshold
    penne 0.4472, passata 0.4695, white bread 0.5356, cheddar cheese 0.5396, yoghurt 0.2526 OVER
    apple -> "Apple, baked"; eggs -> "Egg, Benedict"; salmon -> "Salmon salad" — wrong variants
    frikandel NO HIT, bitterballen 0.7284 — correctly unresolvable, custom foods cover these
  Four root causes: no plural normalisation; nothing requires query tokens to actually
  appear in the candidate; Fuse scores whole-string so multi-word queries lose; no
  preference for base forms over elaborate prepared dishes.
  Decision: Task 5 gains a normalisation and ranking layer — singularise simple plurals,
  require every query token to match, prefer fewer comma-separated qualifiers and the
  raw/cooked/NFS variants, plus a small curated query-synonym map for European
  colloquialisms. The 0.25 threshold is NOT loosened: loosening admits more wrong matches,
  and a sourced warning about a food the user did not eat is the failure mode that matters
  most in this app. Required proof: a test running the same twenty queries against the
  REAL dataset. Cost if wrong: search tuning is self-contained in one module and the
  measurement test makes any regression visible.
- Ruling: a `'failed'` load must be retryable — `loadFoods` after a failure attempts again.
  Why: someone opening the app offline on first visit and then regaining signal would
  otherwise be stuck with a permanently empty database for the life of the tab.
- Task 5: fix round 1/5 dispatched. FIX_BASE 6caff94.
- Task 5: fix round 1/5 (search rebuilt; commits 6caff94..b650204). 18/20 queries now
  resolve with correct variants; suite 7 files / 90 tests green. Both remaining NO HITs
  are the genuinely unresolvable Dutch foods, which is the right answer.
- **Ruling: a query synonym is legitimate only when the target is the SAME food
  nutritionally; otherwise return no hit.** Controller checked the implementer's
  judgement-call mappings against real numbers:
    passata   -> "Tomato sauce, for use with vegetables"  965 mg sodium/100 g (real ~10)
    courgette -> "Zucchini, pickled"                      951 mg sodium/100 g (fresh ~8)
    penne     -> "Pasta, whole grain, cooked"             fibre 3.9, refinedGrain=false
                 while plain "Pasta, cooked" exists:      fibre 1.8, refinedGrain=true
  A hundred-fold sodium error would fire a confident sourced sodium warning on plain pasta
  with passata. Decision: drop passata and courgette (the dataset has no equivalent —
  "Zucchini, pickled" is the ONLY zucchini entry), point penne at plain cooked pasta, and
  audit the whole map the same way with the numbers reported. Silence beats a confident
  wrong match. Cost if wrong: a few more foods need a one-time custom entry.
- **Ruling (carries into Tasks 7 and 18): the accept gate is token-completeness, not the
  0.25 score threshold.** Turning off Fuse's field-length normalisation was necessary to
  stop long names losing, and it pushes every full-word match to ~0.03. So the score no
  longer discriminates match quality — a query either has all its words present or it does
  not. Accepted as the better design: it is predictable and it is what kills the
  confident-wrong-match case. Consequence Tasks 7 and 18 must know: a `score <= 0.25`
  test will pass for everything that matches at all, and AI fallback must trigger on
  `needsHelp` (no hit) rather than on a low-confidence score. Cost if wrong: the fallback
  fires less often than the plan imagined, which is the safe direction.
- Task 5: fix round 2/5 dispatched. FIX_BASE b650204.
- Task 5: fix round 2/5 (synonym audit; commits b650204..1a9e7db). Implementer also
  dropped chips, mince, sweets and ice lolly on the same-food rule, and made name matches
  beat dataset-synonym matches. Suite 7 files / 92 tests green.
- Ruling: `zucchini` and `courgette` -> "Summer squash, green, raw" (sodium 8) IS the
  same-food rule applied correctly, not an exception — that is USDA's name for a zucchini,
  while "Zucchini, pickled" (sodium 951) is a different food. The earlier courgette removal
  was only because the target on offer was the pickled entry. Also fixes a bare `zucchini`
  query, which matched the pickled entry directly through the token gate.
- Ruling: "Pasta, cooked" at sodium 232 and `prawn` -> "Shrimp, baked or broiled" at 363
  both STAND. FNDDS catalogues foods as actually eaten and people salt pasta water; the
  dataset has no raw shrimp for the same reason. These are honest figures for the thing
  being logged.
- **Design note carried into Task 14:** the above tolerance is only safe because the
  warning gate shows the resolved food NAME and quantity before anything is committed,
  with a cancel option. Task 14 must make the resolved food name prominent — it is the
  user's own check against mis-resolution, and the reason a slightly-off cooked variant is
  acceptable while a hundred-fold sodium error is not.
- Task 5: fix round 3/5 dispatched (zucchini mapping only). FIX_BASE 1a9e7db.
- Task 5: fix round 3/5 (1 addressed, 0 open; commits 1a9e7db..a18ac23). zucchini,
  zucchinis, courgette, courgettes all resolve to "Summer squash, green, raw" (Na 8),
  pinned with a sodium assertion so a ranking regression is caught. Suite 96 tests green.
- **Process correction:** Task 5 never received its full task review — I went straight from
  the implementer's first report into fix rounds, because my own real-dataset measurement
  had already found a plan defect that was going to rewrite the module anyway. That was
  reasonable at the time but it skipped a required gate. Running the full task review now
  against the FINAL state (0fe9d94..a18ac23, all three rounds together) rather than a
  scoped re-review of the last round, since no reviewer has yet seen this code at all.
- Task 5 review (sonnet, final state 0fe9d94..a18ac23): spec ✅ on the brief and all eight
  controller decisions; quality "Needs fixes (narrowly)". Confirmed by reading: `doLoad`
  can never reject, failure clears all four pieces of state, `inflight` clears by identity,
  a generation guard drops stale results, `limit` applied after the sort, index built once.
- **My own ruling caused a regression, and the reviewer caught it.** Mapping `zucchini` to
  the four tokens `summer squash green raw` plus the token-completeness gate makes real
  foods unreachable: controller confirmed the dataset holds "Bread, zucchini",
  "Muffin, zucchini" and "Cake or cupcake, zucchini", so `zucchini bread` expands to
  `summer squash green raw bread` and matches nothing. Same flaw for `tortilla crisps`.
  Decision: synonym expansion falls back to the unmapped tokens when the mapped query
  yields zero hits, and `zucchini` maps to the two tokens `summer squash` rather than
  forcing `green raw`. That keeps the sodium fix for a bare query while leaving compounds
  reachable. Cost if wrong: a bare zucchini query could pick a cooked summer squash
  variant, which is nutritionally close, unlike the pickled entry.
- Ruling: the singulariser's `ies`->`y` rule is a real bug, not polish — it turns `cookies`
  into `cooky`, which fails the one-edit tolerance against `cookie`. Controller counted 93
  cookie entries, 25 pie entries and 5 brownie entries in the dataset, all currently
  unreachable by their plural. Fix required.
- Ruling: `meta.json` must be fetched with `cache: 'no-cache'`. GitHub Pages' ~10-minute
  max-age can serve a stale hash after a deploy, whereupon the referenced file 404s and the
  load fails until the cache expires. A real production failure, not polish.
- Ruling: split the module now — `src/data/foodSearch.ts` for the pure search functions
  (synonym data, singulariser, token matching, ranking) and `foodRepository.ts` for fetch,
  state, retry and `getFood`. Why now: no task imports it yet, so this is the cheapest
  moment, and the next tuning round lands in a file that already holds two responsibilities.
- Resolved the reviewer's ⚠️: `public/data/foods.96dc75b2a4.json` and `meta.json` ARE
  git-tracked, so the real-dataset test works on a clean checkout.
- Task 5: fix round 4/5 — per the fix-loop rules, dispatched to a FRESH implementer on a
  more capable model (opus) rather than resuming. The earlier rounds were driven by my own
  evolving rulings rather than implementer failure, but fresh eyes suit a module that now
  needs splitting. FIX_BASE a18ac23.
- Task 5: fix round 4/5 (fresh implementer, opus; commits a18ac23..27fc89e..d173696).
  Suite 8 files / 120 tests green, tsc and build clean. All 20 original queries keep their
  food, zero new NO HITs, and zucchini bread -> "Bread, zucchini", cookies -> "Cookie, NFS",
  pies -> "Pie, NFS", brownies -> "Cookie, brownie", bare zucchini -> fresh squash (Na 8).
- Ruling: the implementer's unlisted fix — `BASE_MARKERS` held "nfs" while tokens
  singularise to "nf", so FNDDS's unspecified base variants never earned the base-form
  bonus — is CORRECT and stands, including its side effect of moving bare `salmon` from
  "Fish, salmon, raw" (Na 63) to "Fish, salmon, NFS" (Na 294). Controller checked the
  variants: NFS is 294, identical to "baked or broiled" (294), and well below "smoked"
  (672) — so NFS is FNDDS's pointer to the usual preparation, not an average inflated by
  cured forms. "I ate salmon" means cooked salmon, so NFS is the honest default and raw at
  63 would understate a cooked fillet. Same for `prawn` -> "Shrimp, NFS" (348 vs 363).
  Cost if wrong: a bare fish query resolves to the common preparation rather than raw,
  visible to the user in the gate.
- Ruling: `two hot dogs` returning NO HIT from a raw search call is NOT a defect. Task 6's
  parser strips the quantity and hands the search `hot dogs`, which resolves at 0.0316.
  Nothing calls `searchFoods` with a quantity word in production.
- Task 5: minor (deferred): `tortilla crisps` is still NO HIT — the synonym fallback is
  all-or-nothing, and neither the mapped nor the unmapped form matches. Silence, not a
  wrong match; "tortilla chips" works. Diminishing returns.
- Task 5: minor (deferred): `-ves` plurals (leaves/loaves) deliberately skipped, reasoning
  documented in code.
- Task 5: fix round 4/5 re-review (sonnet): all findings addressed, no new
  Critical/Important. Verified the refactor preserved the exported surface, signatures,
  defaults and load ordering, and that search code moved rather than being rewritten.
  Confirmed the zero-hit fallback cannot resurrect "Zucchini, pickled" (the mapped pass
  always has hits, so the fallback is never reached for a bare query). The plural fix also
  removed two WRONG matches the old rule produced: `pies` -> Cheesecake and `brownies` ->
  brown rice.
- Task 5: minor (deferred): `-ies` words lose one-edit typo tolerance (`cheries` no longer
  matches cherry) — a deliberate trade that avoids wrong foods.
- Task 5: minor (deferred): tiebreak uses `localeCompare`, so ordering depends on the
  runtime's ICU locale; code-point comparison would be fully reproducible.
- **Task 5: complete (commits 0fe9d94..d173696, review clean after 4 rounds)**
  Four rounds was proportionate: this module decides which food every warning is about.
  Net effect vs the plan's design — 12/20 everyday queries resolving with 2 of those wrong,
  to 20/20 correct with the 3 genuinely-absent foods returning honest no-hits.

### Task 6 — quantity and entry parsing
- BASE d173696.
- Task 6 implementer: commit 25a8f7c, DONE_WITH_CONCERNS. 10 files / 146 tests green.
- **Ruling: PLAN DEFECT — the brief's `asdf` test asked this layer to do something it
  cannot.** The implementer built a keyboard-row/repeated-letter heuristic to detect
  nonsense words, and correctly flagged that without the dataset a nonsense word cannot be
  told from a food word. Decision: remove the heuristic; `parseEntry('asdf')` yields one
  item with `foodQuery: 'asdf'`. The architecture already answers this authoritatively one
  layer down — Task 7 resolves phrases against the dataset, the token-completeness gate
  returns no hit, and the phrase lands in `needsHelp`, which routes to manual entry or a
  custom food. A heuristic here would misfire on loanwords and Dutch/German foods the owner
  will actually type, silently refusing real entries. Input with no words at all (empty,
  whitespace, emoji, punctuation) still yields no items. Cost if wrong: one more phrase
  reaches the resolver, which is designed to handle exactly that.
- **Ruling: " and " splitting needs a curated exception list, not removal.** Splitting
  "mac and cheese" into macaroni + cheese would show warnings about a dish the user did not
  eat. But splitting is usually RIGHT — "eggs and bacon" genuinely is two foods. Decision:
  keep splitting on " and " by default, with a short curated list of compound names that
  must not split (mac and cheese, salt and pepper, fish and chips, bangers and mash, oil
  and vinegar, ham and cheese, surf and turf, and similar). Commas, newlines and `+` keep
  splitting unconditionally. Cost if wrong: an unlisted compound splits and the user sees
  two wrong items in the gate before committing.
- Ruling: mixed fractions ("1 1/2 cups") added — common phrasing, cheap now.
- Ruling: `a cola and a half` yielding [cola] plus unparseable ["a half"] STANDS. Genuinely
  ambiguous English; the user sees the unresolved fragment in the gate, and silence on the
  ambiguous part beats guessing. Its pinning test stays.
- Task 6: fix round 1/5 dispatched. FIX_BASE 25a8f7c.
- Task 6: fix round 1/5 (3 addressed; commits 25a8f7c..ae7ab26). 152 tests green.
- Task 6 review (sonnet, final state d173696..ae7ab26): spec ✅ against the brief as
  amended by all five rulings; quality Approved. Reviewer traced every numeric path and
  found no NaN/Infinity route (zero denominators and a 400-nine overflow both return null),
  confirmed only the GRAM_UNITS branch sets `grams`, confirmed `2 slices of white bread`
  leaves `white bread`, and confirmed the compound glue gives two items for
  `2 mac and cheese and a cola`. Only gate left is a has-a-letter-or-digit check, so no
  food-judging heuristic remains.
- **Ruling: `%` after a number must not parse as a count (Important).** `2% milk` gave
  `{count: 2}`, `100% orange juice` gave 100, `0% yogurt` gave 0 — which Task 7 would then
  reject as non-positive. These are common food names and the result is a silent 2x or 100x
  quantity. Decision: a numeric token immediately followed by `%` yields no quantity, so
  the fragment stays the food phrase with the default count 1.
- **Ruling: the comma must not split between digits (promoted from Minor).** `1,5 kg rice`
  split into `1` and `5 kg rice`. Not minor for THIS app — the owner writes Dutch, where the
  comma is the decimal separator, so "1,5 kg" is how he will type one and a half kilos and
  the current behaviour makes it five kilos. Decision: comma separates only when not
  between digits, and `1,5 kg` reads as the decimal 1.5 kg (1500 g).
- Ruling: compound list extended (half and half — which currently vanishes entirely —
  peanut butter and jelly, bread and butter, cookies and cream, rice and beans).
- Ruling: two near-vacuous tests tightened to exact values.
- Ruling: `2-3 apples` -> count 2 with query `-3 apples` STANDS (ambiguous range; fails to
  resolve and the user sees it in the gate). `lb`/`oz` not stripped STANDS (not in the
  brief's units; this user is metric). `drink mix` -> `mix` STANDS (rare).
- **Carried into Task 7: it must range-check quantity magnitude.** Task 6 deliberately has
  no upper bound, so Task 7 is the boundary — it already rejects non-positive counts and
  must also reject absurd magnitudes (the reviewer noted `1e299 kg` passes as finite).
- Task 6: fix round 2/5 dispatched. FIX_BASE ae7ab26.
- Task 6: fix round 2/5 (4 addressed; commit 3cdea75). 157 tests green. Implementer also
  found an unanticipated bug: `half and half` needed a guard so a quantity whose rest starts
  with "and" is not treated as a quantity — before it, `half` parsed as 0.5 and the food
  became "and half".
- **Ruling (reverses the implementer's judgement call): a comma between digits is ALWAYS a
  decimal separator.** Its rule read `X,YYY` as a thousands separator when exactly three
  digits followed, making `1,500 kg` into 1500 kg. In Dutch the comma IS the decimal mark,
  so that is the input this owner will actually type for one and a half kilos, and the rule
  turned it into a tonne and a half — a 1000x overstatement on a realistic input, to protect
  `1,000 g` which nobody types when they mean a kilo. Decision: no thousands handling, with
  a comment at the rule explaining the locale reason so a future reader does not restore it.
  `1,000 g` now reads as 1 g. Both error directions are visible in the gate before saving,
  and understating grams is far safer than inflating them.
- Task 6: fix round 3/5 dispatched (comma rule only). FIX_BASE 3cdea75.
- Task 6: fix round 3/5 re-review (haiku): all findings addressed, no new
  Critical/Important. Confirmed the comma rule is genuinely unconditional (no residual
  branch on digit-group length, leading zero or trailing-digit count) and traced all five
  pinned cases. Confirmed the `%` guard covers integers, decimals, comma-decimals,
  fractions and mixed fractions, and that the `half and half` guard cannot break
  "two hot dogs and a cola" because " and " splitting runs before `parseQuantity`.
- Task 6: minor (deferred): `1,2,3 apples` leaves `,3 apples` in the food phrase — a
  consequence of the always-decimal ruling; Task 7 rejects it.
- Task 6: minor (deferred): the `and` guard is slightly broader than its comment; affects
  only garbage input like `2 and`.
- Task 6: minor (deferred): `two% milk` and `2 % milk` (word number, or a space before the
  percent) still parse a count — same bug class, outside the numeric-token requirement.
- Task 6: minor (deferred): `1/2% milk` and `1,5% milk` behave correctly but are not pinned.
- **Task 6: complete (commits d173696..c922bc9, review clean after 3 rounds)**

### Task 7 — item resolution
- BASE c922bc9.
- Carries: (a) the accept gate is token-completeness, not the 0.25 score — a score test will
  pass for anything that matches at all; (b) Task 7 is the boundary that range-checks
  quantity magnitude, since Task 6 deliberately has no upper bound.
- Task 7 implementer: commit 10d02b6, DONE_WITH_CONCERNS. 11 files / 173 tests green, tsc
  clean. `FoodLookup` (search + get(source,id)) in src/domain/foodLookup.ts with a
  `combineLookups(...providers)` helper and a dataset provider in src/data/datasetLookup.ts —
  the seam Tasks 15 and 16 extend.
- **Ruling: a bare count must fall back to a measure portion (plan/usability defect).** The
  implementer flagged that a bare count on a food with only measure portions went to
  `needsHelp`. Controller measured the real dataset: 1,783 of 5,431 foods (33%) have ONLY
  measure portions, including Rice ("1 cup, cooked" is its single portion), Milk and cola —
  and "a cola" is part of the design doc's own worked example. That is anti-goal A5
  (friction kills the diary, so the warnings never fire). Decision: rank portions by
  serving-likeness — whole-item/container labels first (preferring the middle size), then
  `cup` and its variants (3,055 foods carry one), with sub-serving units (fl oz, oz, cubic
  inch, surface inch, tbsp, tsp) last; "1 can (12 fl oz)" is a container label despite
  containing "fl oz", so match whole labels not substrings. Only the 37 foods with no
  portions at all go to `needsHelp`. An explicit user `unitLabel` still wins.
  Safe because the gate shows the chosen portion label and gram weight before committing.
  Cost if wrong: a visible, correctable serving choice instead of a refusal.
- Ruling: a real-dataset end-to-end resolution test is required, for the same reason Task 5
  needed one — in-test fixtures do not exercise real FNDDS portion labels, which is exactly
  where this defect hid.
- Ruling: the implementer's ceilings (100 kg per item, count 1000), exporting `isKnownValue`,
  and loosening the confidence assertion to >0.5 all STAND. Confidence is near-meaningless
  by design; the comment pointing AI fallback at `needsHelp.length > 0` is what matters.
- Task 7: fix round 1/5 dispatched. FIX_BASE 10d02b6.
- Task 7: fix round 1/5 (commits 10d02b6..23a0965..a4c55ed). 12 files / 194 tests green.
  All eight everyday entries resolve with no needsHelp: two hot dogs 114 g, cola 372 g (the
  can), rice 158 g, an apple 200 g, 2 slices white bread 56 g, a glass of milk 244 g,
  2 eggs 100 g, 500 g penne 500 g.
  The implementer found four further real-data traps on its own: "Guideline amount per fl oz
  of beverage" rows (2.5 g, present in 199 foods) would have won for milk and are now
  excluded; cola's "1 medium drink" (512 g) beat the can until containers got their own
  tier; milk's "1 individual school container" is demoted; and "glass" was not a parsed unit
  at all, so "a glass of milk" failed — glass/glasses added and mapped to cup.
- Task 7: minor (process): commit 23a0965 was pushed with one of the implementer's own unit
  tests failing; a4c55ed fixed it. The intermediate commit is red.
- **Ruling (data limitation, carried into Task 16): "500 g penne" resolves to cooked pasta,
  so a weight is read as cooked weight.** FNDDS catalogues foods as eaten and has no dry
  pasta entry, so there is no raw option to choose. Dry 500 g is ~1,750 kcal against ~800
  cooked — a 2x energy error if the user weighed the dry package. Decision: accept, because
  the resolved name the user sees literally says "Pasta, cooked". Carried to Task 16: the
  batch builder must make this explicit for grain and pasta ingredients given by weight,
  since the meal-prep example in the design doc is exactly "500 g penne" and a per-portion
  error there is invisible.
- Task 7 review (sonnet, final state c922bc9..a4c55ed): spec ❌ on one defect, otherwise
  compliant with the brief and all six controller decisions. Confirmed: no `?? 0`/`|| 0`/
  coercion on any nutrient path, `coverage` propagated from `sumNutrients` not recomputed,
  `boundedGrams` applied to the final product so an absurd portion row cannot yield
  Infinity, ranking total, and the `FoodLookup` seam genuinely supports both later
  providers without touching `resolveItems`.
- **Ruling: the guideline filter `/^guideline|per/i` must be anchored (Important).** A bare
  `per` matches anywhere, so "1 pepper" was dropped — *pepper* contains *per*. "Peppers,
  hot, cooked" then falls back to its "1 cup" row and **"a hot pepper" resolves to 150 g
  instead of 15 g, a silent 10x error with no needsHelp**. Also killed every "personal size
  pizza" row, the "(15 per 8 oz package)" slice rows, and "1 small paper" (*paper* contains
  *per*) — 20 real labels in all. A finite, plausible, ten-fold wrong gram weight that
  nobody sees is worse than a crash, because the app then shows a confident sourced warning
  computed from it. Decision: anchor to `/^guideline/i` plus explicit `\bper (fl oz|cup|
  surface inch|item)\b` and the `topping per` rows; pin "a hot pepper" at ~15 g and confirm
  milk still takes "1 cup" (244 g) rather than the 2.5 g guideline row.
- Ruling: tie-breaks must be rebuild-proof — add `label.localeCompare` or grams before the
  original portion index, pinned by a test that shuffles a food's portions. Why: a dataset
  rebuild that reorders portions could otherwise silently change what "an apple" weighs.
- Ruling: the `QUALIFIED` regex's fragility, the `combineLookups` score-merge convention
  (a custom provider at 0.0 beating a dataset hit at 0.03 is the desired precedence), the
  weak 0-quantity test, and `resolveItems` never calling `get` all STAND.
- **Carried into Tasks 15 and 16:** a batch provider must implement name search, because
  resolution goes through `search` and never `get`; and custom and batch providers should
  emit simple portion labels like "1 serving", since the English-label portion ranking
  applies to them too.
- Task 7: fix round 2/5 dispatched. FIX_BASE a4c55ed.
- Task 7: fix round 2/5 (commit b4bd677). Filter fix CONFIRMED good — new regex
  `/guideline amount|^topping per /i` drops exactly 15 labels on the real dataset, all
  genuine guideline or topping rows, against 33 before; hot pepper back to 15 g, milk keeps
  244 g. Root cause of the bare-`per` bug was a shell escape mangling the committed regex
  (stray control characters where word boundaries belonged). Controller scanned every
  tracked file under src/, scripts/ and tests/ for control characters: none found, so that
  corruption is isolated and fixed.
- **MY ERROR, caught by the re-reviewer.** I accepted the implementer's "smaller measure
  wins" side effect on its stated claim that it was confined to the last-resort tier. A
  full-dataset probe disproved that: the grams-ascending key sits above the index INSIDE
  group 0, so a whole item and a fragment of it sharing a tier race on weight and the
  fragment wins. 302 foods changed, 141 by more than 2x downward:
    Banana, raw        1 banana 126 g -> 1 slice 6 g   (21x understated)
    Cereal, O's        1 serving 30 g -> 1 piece 0.1 g
    Apricot, raw       1 apricot 35 g -> 1 slice 10 g
    Butter, stick      1 stick 113 g  -> 1 pat 7 g
    Beef, oxtails      1 tail 240 g   -> 1 tail bone 30 g
    Beets, pickled     1 whole 25 g   -> 1 slice 10 g
    Beef sausage       1 patty 35 g   -> 1 slice 15 g
  All silent, no needsHelp, and the suite stayed green because "a banana" was never pinned.
  I should have required a dataset-wide before/after diff when I accepted the side effect
  rather than taking the stated scope on trust — the same measurement discipline that
  caught every other defect in this module.
- **Ruling: within a group and tier, a whole item must beat a fragment of it.** Demote
  explicit sub-portion words (slice, piece, pat, chunk, cube, wedge, sliver, bone, bite,
  strip, square, half, quarter) to their own tier below plain whole-item labels, keeping
  genuine whole things (stick, patty, tail, whole, loaf) out of that list; and make the
  final tie-break deterministic by label, with any gram key DESCENDING not ascending. The
  rebuild-proof requirement was about determinism, not re-ranking. Pin banana (~126 g),
  cereal O's (the serving row), apricot (~35 g), and a shuffle test on a same-tier
  whole-item-versus-fragment food — the existing order test misses this because apple sizes
  sit in different tiers.
- Ruling: a bare "bread" resolving to a whole loaf is accepted — pre-regression behaviour,
  visible in the gate, and bread is normally logged as "2 slices" which wins anyway.
- Task 7: fix round 3/5 dispatched. FIX_BASE b4bd677.
- Task 7: fix round 3/5 (commit 69062ba) + the dataset-wide audit I should have demanded a
  round earlier. Fragment tier added; grams key removed from the rank; ties sorted then
  upper-median taken. Audit over all 5,431 foods: identical picks for forward and reversed
  row order (0 diffs), and vs b4bd677 804 foods changed, 508 by >=2x UPWARD and none
  downward — the banana/cereal/butter/oxtail/apricot regression is genuinely fixed.
- **New Important from the audit: the upper-median rule picks "1 cup, dry, yields N" over
  "1 cup, cooked" for 25 cooked-grain staples** — barley 740 g vs 170 g, bulgur 690 vs 140,
  buckwheat 500 vs 170, cream of rice 815 vs 240, cream of wheat 965 vs 240. About 4x, silent,
  on foods people log regularly. Ruling: treat labels containing "dry" or "yield" as
  qualified so the cooked cup wins.
- **Promoting the audit's Minor on chicken breast to a required fix.** The fragment test runs
  after MIDDLE_SIZE/OTHER_SIZE, so "1 medium slice" (60 g) beats "1 breast" (120-175 g) for
  8 chicken-breast foods and a slice beats a baguette for 7 garlic breads. Chicken breast is
  a staple entry and 2-3x low is exactly the silent error class. Ruling: the fragment
  demotion must apply within the size tiers too, not only to plain labels.
- Ruling: whole-pie/lasagna/quiche/cabbage-head picks (1.2-2 kg) are ACCEPTED, consistent
  with the already-accepted bread-loaf case — large, obviously wrong to a human, and shown
  in the gate with its label and gram weight before anything is saved.
- Ruling: single-unit picks are ACCEPTED — 1 drop of lime juice (0.1 g), 1 popcorn kernel,
  1 dried berry, 1 basil leaf. They are genuinely single units and the only alternative is a
  cup, which is worse. 105 foods under 5 g, mostly of this kind.
- **Design note carried into Task 14 — the better answer than more heuristics.** 554 of
  5,376 foods have a bare-count pick that is under 5 g, over 1 kg, or under 20% of the
  food's largest portion. Rather than chase that with more label rules, the warning gate
  must visibly flag an unusual serving size for confirmation ("1 regular pie, 1,200 g — is
  that right?"). That converts the whole residual class from a silent error into a visible
  question, which is what the gate is for. Stop adding heuristics after this round.
- Task 7: fix round 4/5 — per the fix-loop rules, a FRESH implementer on a more capable
  model (opus). The loop survived three rounds because of my own evolving rulings and real
  dataset discoveries rather than implementer failure, but fresh eyes on a comparator now
  revised three times is genuinely useful. FIX_BASE 69062ba.
- Task 7: fix round 4/5 (fresh implementer, opus; commit cb31330). 210 tests green. Both
  defects fixed: `dry` added to QUALIFIED; `tier()` computes size first then returns
  `4 + size/10` for a fragment, so a sized fragment loses to any whole item while the
  fragment ladder still orders (white bread keeps its regular slice). Probe: order
  independence holds over 4 shuffles x 5,431 foods, needsHelp unchanged at 55, all intact
  picks confirmed.
- Ruling: the implementer's decision NOT to add `yield` to QUALIFIED STANDS and was correct.
  It had probe evidence: `\byields?\b` would change 92 foods rather than 47 and send bacon
  to "1 cup, pieces" (8 -> 80 g on a processed meat) and fries to a single 5 g fry. `dry`
  alone fixes every grain case. Good use of evidence against an instruction of mine.
- **Ruling: add `meatball` to the fragment word list (round 5).** The fragment demotion
  regressed 5 meat-loaf foods: "1 medium slice" 108 g -> "1 medium meatball" 28 g, a 3.9x
  UNDERSTATEMENT on red/processed meat. That is the dangerous direction — it suppresses a
  sodium or processed-meat warning that should fire — and unlike the oversized picks it is
  invisible, because 28 g of meat loaf looks plausible in the gate. Safe for genuine
  meatball foods because the fragment tier sits inside group 0, so a food whose own whole
  item is "1 meatball" still outranks a group 1 cup; required the implementer to verify that
  in the probe rather than take it on trust.
- Ruling: "Bread, Cuban" 20 g -> 1,185 g (59x up) STANDS — the accepted loaf class, enormous
  and visible in the gate, and it over-warns rather than under-warns.
- Ruling: the 51 further moves beyond my predicted 40 are ACCEPTED — the same two rules
  reaching further in the safe direction (21 instant-cereal packet rows going to the cooked
  cup is an improvement; cakes and loaves are the accepted class).
- Task 7: fix round 5/5 dispatched — the cap. After this report Task 7 closes and anything
  still open is recorded as a known limitation, not another round.
- Task 7: fix round 5/5 (commit f20ee85). Interrupted mid-round by a 5-hour usage limit with
  the fix applied but uncommitted; resumed after reset and closed. Final probe vs cb31330:
  5 changed picks, ALL the meat loaves and ALL upward (28 -> 108 g, 36 -> 137 g). No genuine
  meatball food moved — all 15 checked, including the 4 "with sauce" variants and the 5
  beef-family loaves which were never affected because `patty` is not a fragment word (which
  is why only 5 of 10 loaf foods showed the defect). Order independence: 0 breaks over
  21,724 checks. needsHelp still 55. All 11 intact picks asserted.
- Note: the implementer caught that its own first-draft pin used the query `meat loaf`, which
  matches "Meat loaf, Puerto Rican style" — a single 95 g row with no meatball row, so the
  pin could never have caught the defect. It renamed the query and commented why. Good
  self-verification of the kind that was missing in rounds 2 and 3.
- **Task 7: complete (commits c922bc9..f20ee85, review clean after 5 rounds — the cap)**
- Known limitations recorded at close, NO further rounds: Bread Cuban 1,185 g loaf plus 11
  other bread loaf/baguette picks; 21 instant-cereal packet rows going to a cooked cup; a
  powdered fruit drink at 23 g; and the 554-food audit class (picks under 5 g, over 1 kg, or
  under 20% of the food's largest portion) which the Task 14 gate flag addresses rather than
  more label heuristics.

## Status at 2026-11-16
Tasks 1-7 complete, 213 tests green, 19 commits on feat/food-diary. Remaining: 8 (persistence),
9 (day boundaries/totals), 10-13 (rule engine + catalogue), 14-17 (UI), 18 (DeepSeek), 19
(first run/settings/PWA). A 5-hour usage limit was hit during Task 7 round 5.

## Execution method changed by the user — 2026-11-16
After I surfaced the 5-hour usage limit and Task 7's five-round cost, the user chose the
hybrid: **Tasks 8-13 keep full subagent-driven review** (persistence, day boundaries, and the
rule engine with its WHO/IARC citations — where the health claims live and a silent error is
most dangerous and least visible), **Tasks 14-17 and 19 go native** (I implement the screens
myself, with one thorough whole-branch review at the end). Reasoning recorded because it
changes the process for the rest of the plan: UI mistakes are visible the moment the app
opens, so per-task independent review earns far less there than it does on a rule that
attaches a WHO citation to a number.

### Task 8 — persistence
- BASE f20ee85.
- Carries ruling R2: `DiaryEntry`, `CustomFood` and `Batch` are ADDED to the existing
  `src/types/diary.ts` (created in Task 7 with `FoodRef` and `Resolution`), not a new file.
- `Level` ('INFO'|'MODERATE'|'HIGH'|'CRITICAL') is defined here too, since Task 10's rule
  engine will import it and `DiaryEntry.warningsShown` needs it now.
- Task 8 implementer: commit d0e16f0, DONE_WITH_CONCERNS. 13 files / 228 tests green.
  `Level`, `DiaryEntry`, `CustomFood`, `Batch` added to the existing diary.ts; idb 8.0.4 and
  fake-indexeddb 6.2.8 pinned.
- Task 8 review (sonnet): spec ✅, quality "Needs fixes" on one Important. Confirmed as
  strengths: `deleteEntry` a real tombstone inside a transaction; `reviseEntry` doing read,
  state check and both puts in one transaction with `...next` unable to smuggle a stale
  id/state/supersededBy; nothing normalising `nutrients` on read or write;
  `IDBKeyRange.bound` closed on both ends; tests on real fake-indexeddb with no mocks.
- **Ruling: `putEntry` becomes insert-only `addEntry` (Important).** The implementer flagged
  the unguarded upsert and the reviewer traced what it allows: resurrecting a tombstone via
  `putEntry({...tombstone, state:'active'})`; clobbering a superseded row and erasing its
  `supersededBy`; forking a chain with `revisionOf` on an already-superseded entry; and a
  dangling `revisionOf: 'ghost'`. The file header claims entries are never hard-deleted and
  nothing enforced it. Decision: `store.add` so a duplicate id fails, and reject any entry
  arriving with `state !== 'active'` or with `supersededBy`/`revisionOf` set — those belong to
  `reviseEntry` and `deleteEntry` alone. An undelete, if ever wanted, becomes an explicit
  `restoreEntry`; not now.
- Ruling: `deleteEntry` must tombstone only `active` rows — rewriting a superseded row to
  `deleted` destroys the "replaced by a revision" fact.
- **Ruling: normalise `at` through `toISOString()` on write (promoted from Minor).** The `at`
  index relies on lexicographic ISO ordering and nothing enforced a uniform format:
  `...:00Z` sorts after `...:00.000Z` and an offset form mis-sorts. **Task 9 builds day
  boundaries and the 7-day window directly on this index**, so a mixed format would corrupt
  daily totals — exactly the silent-error class. Also `entriesBetween` returns [] rather than
  letting `bound` throw when from > to, with tests at both inclusive boundaries.
- Ruling: guard NaN/Infinity at the storage boundary (`addEntry`, `putBatch`,
  `decrementBatchPortion` which yields NaN on a missing `portionsRemaining`) — the global
  constraint says none may reach a stored total and everything funnels through here. Also
  `toStrictEqual` for the round-trip, since `toEqual` treats `{a: undefined}` and `{}` as
  equal and the unknown-vs-zero test passes only via its explicit `in` and zero checks.
- Ruling: `eraseEverything` clears localStorage FIRST — the current order leaves the profile
  including the date of birth on disk if the step between fails, which is backwards for a
  privacy action. Export `LS_PREFIX` so no later module invents an unprefixed surviving key.
- Ruling: guard the upgrade callback with `if (oldVersion < 1)`; reset `dbPromise` on a
  rejected `openDB` (currently cached for the life of the page). Skipped blocked/terminating
  handlers as out of scope.
- Ruling: `Partial<NutrientSet>` is redundant — `NutrientSet` is already Partial.
- Ruling: the implementer's `reviseEntry` throw-on-missing-or-inactive STANDS (confirmed by
  the reviewer as what prevents a branched history), as does having no settings API yet
  (Task 19 owns it).
- Task 8: fix round 1/5 dispatched. FIX_BASE d0e16f0.
- Task 8: fix round 1/5 (all 8 addressed; commit 68df54d). 252 tests green, 39 in db.test.ts
  (RED at 32 failures before). Re-reviewer traced the WHOLE write surface, not just the fixed
  function, and concluded no door can break a revision chain through the API: `addEntry`
  insert-only rejecting the link fields; `reviseEntry` forcing state/revisionOf and stripping
  `supersededBy`, with an active original unable to already have a successor so no fork is
  possible; `deleteEntry` never touching link fields; no other exported write reaching the
  entries store. `at` normalised on both persist paths.
- **Ruling: `putCustomFood` must be guarded too (round 2).** The re-reviewer found it entirely
  unguarded — `nutrientsPer100g` and `referencePortion.grams` — the same class of hole I had
  just required closing for entries, and arguably a likelier one: custom-food numbers are
  TYPED BY THE USER in an editor Task 15 builds, so an empty or malformed field is exactly how
  a NaN enters. Also the two batch fields the sweep missed, `totalCookedGrams` and
  `ingredients[].refs[].grams`.
- Ruling: `deleteEntry` returns a boolean — the no-op itself is right (fails safe, retries
  harmless) but `void` lets a caller believe it deleted something that was already superseded
  or missing.
- Ruling: `eraseEverything` wraps the localStorage sweep in try/catch and proceeds to the IDB
  clear regardless. Moving the sweep first was right for privacy, but it now throws before the
  IDB clear when storage is blocked, so in a private window an erase could wipe nothing.
- Ruling: `tx.abort()` wrapped so an `InvalidStateError` cannot mask the original cause.
- Ruling: `normaliseAt` stays permissive (the `+YYYYYY` year case is not worth code) but gains
  a doc warning that an offset-less string parses as LOCAL time and shifts silently.
- **Carried into Task 9: pass `toISOString()` output or Z-suffixed strings to the store.** A
  bare `'2026-11-15T13:00:00'` is parsed as local time, and Task 9's day boundaries and 7-day
  window are built directly on the `at` index.
- Ruling: the untested `dbPromise` reset (3 lines, awkward seam, re-reviewer judged acceptable)
  and the second IDB connection in the decrement test both STAND.
- Task 8: fix round 2/5 dispatched. FIX_BASE 68df54d.
- Task 8: fix round 2/5 (all 6 addressed; commit 50c2661). 266 tests green. Re-reviewer
  confirmed the guards PRESERVE the unknown-vs-zero invariant: `Object.entries` never visits
  an absent key so it stays absent, a key present as `undefined` short-circuits and is not
  coerced, a genuine 0 passes `Number.isFinite`, NaN/Infinity throw, and nothing strips,
  defaults or converts a value anywhere.
- **Ruling (correcting my own round-2 instruction): `eraseEverything` rethrows after the IDB
  clear.** I told it to proceed regardless when the localStorage sweep throws, which made a
  failed sweep look like success while the profile — including the date of birth — may still
  be on disk, and left the doc comment asserting the opposite. Decision: still clear IDB
  unconditionally (the bulk of the data should go even when storage is partly blocked), then
  rethrow the sweep error afterwards so a caller can tell the user something true — "your
  diary was cleared, but your profile could not be removed because storage is blocked." A
  throw is hard to ignore; a status object would be quietly dropped. Comment corrected to
  match.
- Ruling: guard `putProfile`. The re-reviewer suspected an open hole and it is one — `Profile`
  carries `heightCm`, `weightLog[].kg` and optional numeric `overrides`, and `JSON.stringify`
  silently turns NaN/Infinity into `null`, which would surface later as a mystery.
- Ruling: strengthen the `safeAbort` test with the re-reviewer's recipe (stub `abort` on the
  `IDBTransaction` prototype to throw `InvalidStateError`, keep the unclonable value, assert
  the surfaced error is `DataCloneError`). The implementer was right that its own test only
  guarded: the unclonable value throws synchronously, leaving the transaction active, so the
  bare abort succeeded too and the catch was never reached.
- Ruling: NaN/Infinity tests assert `RangeError` rather than a bare `toThrow()`.
- Ruling: the renamed "ref X grams" message and the over-long comment line both STAND.
- Task 8: fix round 3/5 dispatched — the last. FIX_BASE 50c2661.
- Task 8: fix round 3/5 (all 4 addressed; commit 3256fbd). 276 tests green. The implementer
  proved the `safeAbort` test by executed mutation — it fails without the fix
  ("expected 'InvalidStateError' to be 'DataCloneError'") and passes with it, which is the
  verification the previous version lacked. Decision: controller verified green directly
  rather than spending a fourth review seat on a small diff whose one real risk was settled
  by an executed mutation, consistent with how Task 4's test-only round was handled.
- **Task 8: complete (commits f20ee85..3256fbd, review clean after 3 rounds)**

### Task 9 — day boundaries, totals and the 7-day window
- BASE 3256fbd.
- Carries: pass `toISOString()` output or Z-suffixed strings to the store (a bare
  '2026-11-15T13:00:00' parses as LOCAL time and shifts silently); `tests/setup.ts` fixes
  TZ=Europe/Amsterdam; `entriesBetween` already returns active, non-cancelled rows only.
- **Ruling: `DiaryEntry` gains `classification` and `fped`, snapshotted at commit.** Found by
  inspection before dispatch: the entry snapshots `nutrients` and `coverage` but NOT
  `classification` or the FPED cup-equivalents, so `weekContext` could not count processed-meat
  occasions or vegetable cup-equivalents without re-resolving every food by id. That would
  break the snapshot guarantee (a dataset rebuild would rewrite history) and would fail
  outright for a since-deleted custom food. Additive field, no migration needed — the stores
  are keyPath-only, which the Task 8 reviewer confirmed. Cost if wrong: one more field on a
  record that already snapshots its nutrients for the same reason.
- Task 9 implementer: commit 9295291, DONE_WITH_CONCERNS. 15 files / 300 tests green. All
  three pre-dispatch rulings applied (classification+fped on DiaryEntry, `alcoholOccasions`
  documented as drinks logged, the tautological test replaced deterministically).
- **Ruling: `FoodRef` gains per-item `classification` and `fped`.** The implementer flagged
  that `redMeatGrams` sums ALL item grams of any entry flagged redMeat, because the snapshot
  had no per-item flags — so a chicken-and-beef stir fry counts its whole weight toward a
  weekly red-meat total that cites IARC and WCRF's ~500 g figure. Warning about red meat the
  user did not eat is the same failure class I have been fixing all through this module.
  Decision: snapshot classification and the already-scaled fped per item on `FoodRef`;
  `redMeatGrams` sums only flagged items' grams; the entry-level merged worst case stays for
  rules asking "did this entry contain processed meat at all", and `processedMeatOccasions`
  remains per-entry by design. `resolveItems` already has per-item classification in hand, so
  the data exists at commit time.
- Ruling: the implementer's extra fields STAND and were the right call — `vegCupEq`,
  `vegCoverage`, `hasVegetableFlag`, `daysVegetableUnknown`. They preserve the
  unknown-vs-zero invariant in a place the brief overlooked: a day whose entries carry no
  FPED data and no vegetable flag is genuinely UNKNOWN, not vegetable-free, and telling the
  user "three days without a vegetable" when the truth is "we don't know" would be the same
  dishonesty as a fabricated nutrient.
- Ruling: `energyCoveredShare` as a per-nutrient record STANDS — the brief's single-number
  reading would have made the coverage gate meaningless.
- **Carried into Task 14:** entry creation must populate entry-level `classification`/`fped`
  AND the new per-item `FoodRef.classification`/`fped` at commit.
- Task 9: fix round 1/5 dispatched. FIX_BASE 9295291.
- Task 9: fix round 1/5 (commit 2a2b3b5). 303 tests green. RED evidence "expected 2000 to be
  500" — five mixed stir-fries reported 2,000 g of red meat against a true 500 g, a 4x
  overstatement against the IARC/WCRF weekly figure. The implementer also had to update
  `resolveItems` to fill the new required per-item field, which Task 14 then only carries
  through at commit.
- Task 9 review (sonnet, final state 3256fbd..2a2b3b5): spec ✅, quality Approved. Confirmed
  by reading: `keyOf` uses only local getters so an offset string is converted before
  bucketing; `last7DayKeys` builds each key at LOCAL NOON so a midnight DST shift cannot move
  a date; `localDayRange` takes the next local midnight minus 1 ms rather than assuming 24
  hours (pinned at 25 hours for 2026-10-25); `energyCoveredShare` is energy-weighted, not an
  entry count, and an energy-unknown entry is excluded from both numerator and denominator;
  `redMeatGrams` per-item while both occasion counts are per-entry.
- **Ruling carried into Task 14: set entry-level `fped` ONLY when every item has FPED data,
  otherwise leave it absent.** The reviewer's one Important finding: an entry with one
  fped-bearing and one fped-less item would get a non-absent entry-level `fped`, and
  `vegCoverage` would then read `'known'` while part of the entry was unknown — so a day
  could be reported "no vegetable" off a lower bound. Not a defect in Task 9's diff; it is
  the commit path's rule.
- Ruling: `alcoholOccasions`' doc comment must say "entries containing alcohol", not "drinks
  logged" — it counts entries, so two beers in one entry is 1, and a rule will cite a weekly
  drinking figure off this number.
- Ruling: document that a rule must check BOTH `energyCoveredShare` and `coverage[key]` — the
  share is 1 even when coverage is 'partial', because energy-unknown entries are invisible to
  the ratio by design. A rule checking only one would fire off an understated total.
- Ruling: a missing `classification` on a row is treated as all-false rather than throwing.
  No real data exists yet so no migration is warranted, but a TypeError here would
  white-screen the whole diary view instead of degrading.
- Ruling: close two test gaps that cover arithmetic behind a health claim — `resolveItems`'
  fped gram-scaling (untested, and it produces every vegetable cup-equivalent the weekly view
  shows) and a `weekContext` DST-day test.
- **Carried into Tasks 12 and 17: gate on enough logged days.** An empty day counts toward
  `daysWithoutVegetable`, which is correct arithmetic but would tell a lapsed user "7 days
  without a vegetable" when they simply have not logged.
- Task 9: fix round 2/5 dispatched — the last. FIX_BASE 2a2b3b5.
- Task 9: fix round 2/5 (all 5 closed; commit 60e0b46). 306 tests green. RED on the one
  behavioural change (malformed-row TypeError reading 'vegetable'); the two added tests pin
  existing behaviour, which the implementer said plainly rather than implying they caught a
  bug. Controller verified green directly instead of a third review seat on a diff that is
  one defensive guard plus doc corrections.
- **Task 9: complete (commits 3256fbd..60e0b46, review clean after 2 rounds)**

### Task 10 — rule engine core
- BASE 60e0b46. This is the heart of the app: it decides which warnings a person sees and
  carries the invariants that keep them honest.
- Task 10 implementer: commit 822e024, DONE_WITH_CONCERNS. 17 files / 341 tests green.
  Coverage gate implemented exactly as ruling 4 intended — fires with a `dataNote` whenever
  day coverage is 'partial' or the share is under 1, so a partial total can never read as a
  clean one. `mergedFrom` and `SafetyQuestion.answerKey` accepted as good additions.
- **Ruling: `Rule.scope` becomes REQUIRED, no default.** The implementer added
  `scope?: 'entry'|'daily'` defaulting to 'daily' so a forgotten declaration goes silent
  rather than noisy. The instinct is right for this app but the default is not: a
  processed-meat rule that fires per entry has no business consulting day coverage, and
  silently defaulting it to 'daily' would make it go quiet on a hot dog when the day's data
  is thin — a missed HIGH warning with an IARC citation behind it, which is the one direction
  this app must not fail in. Neither default is safe, so remove the choice: a required field
  fails to compile if omitted, which is caught at build time rather than at runtime by nobody.
- **Ruling: a rule that throws must NOT block the add flow.** The implementer rethrows, on
  the reasoning that silently dropping a safety rule would hide a hazard — right about silent
  dropping, but rethrowing is worse: one buggy rule makes the gate unable to evaluate
  anything, so the user cannot log food at all and gets NO warnings rather than one fewer,
  and the diary stops being used. Decision: catch per rule, skip it, and return
  `failures: {ruleId, category, message}[]` alongside cards and questions. Nothing is silently
  dropped (the caller holds the list); nothing is blocked (evaluation completes). Task 14's
  gate shows a visible, non-blocking note naming the check that could not run, and says so
  plainly for a safety failure — "we could not check this" is information the user deserves
  rather than a silent gap.
- **Carried into Tasks 11-13 (the implementer's own concern, acted on): every rule in the
  catalogue must be probed with a context that makes it FIRE**, so its level is actually
  observed. The nutrition-CRITICAL throw only triggers when a rule passes the data gate and
  returns CRITICAL, so a violating rule could otherwise hide behind silence.
- Task 10: fix round 1/5 dispatched. FIX_BASE 822e024.
- Task 10: fix round 1/5 (both addressed; commit eaf8f80). 343 tests green. `scope` required
  and pinned with a `@ts-expect-error` test that makes tsc fail if it ever becomes optional
  again; `evaluate` returns `failures` and a rule whose safety prompt throws is held back
  entirely so it can neither ask nor fire.
- **Ruling: the nutrition-CRITICAL violation throws in dev/test, reports via `failures` in a
  production build.** The implementer kept an unconditional throw (correctly noting it is a
  catalogue defect, not a runtime fault) and asked. An unconditional throw has exactly the
  consequence I had just ruled against: a violating catalogue rule in the shipped app would
  stop the gate evaluating anything, so the user could not log food at all. The invariant
  exists to protect the MEANING of CRITICAL; enforcing it that way would cost an unusable
  diary. Decision: loud where it can be fixed (test/dev), non-blocking where it cannot
  (production), with a test for each branch.
- Task 10: fix round 2/5 dispatched — the last before review. FIX_BASE eaf8f80.
- Task 10: fix round 2/5 (commit 61bd3b5). 345 tests green. The implementer verified the
  production branch with a REAL `vite build` of a temporary entry, confirming the throw is
  eliminated — stronger than reading the code.
- Task 10 review (sonnet, final state 60e0b46..61bd3b5): spec ✅ on the brief and all eight
  rulings; quality "Needs fixes" on two Important. Confirmed holding: gate before `level()`,
  merge before cap, failure isolation across all three throw sites, both coverage signals
  with a test per combination, no module state or clock.
- **Ruling: merged cards must not borrow a citation. The most serious finding in the project
  so far.** `merge` joined the lower rule's `portionNote` onto the higher rule's card, which
  keeps the higher rule's evidence, citation, concern, cause and horizon — so a sentence from
  one rule displays beside a WHO or IARC citation that does not support it, and a test
  asserted that joined text as a FEATURE. This is precisely what the design document forbids
  ("distinguish scientific evidence from speculation", "provide sources for significant health
  claims"). Decision: `WarningCard` gains `merged: {ruleId, concern, portionNote, evidence,
  citation}[]`; no prose is concatenated across rules; the test is inverted to assert the
  absorbed note carries its OWN citation. Carried to Task 14: render each claim under its own
  source.
- **Ruling: an all-unknown day must not be gated as an empty day.**
  `Object.keys(today.nutrients).length === 0` is true both for nothing logged and for a day
  whose entries all lack nutrient data, so the daily gate was skipped and a daily rule fired
  off a total of zero with NO dataNote. Worst for below-target rules (fibre, protein,
  vegetables), which would read an understated total as a deficit and warn about a shortfall
  that may not exist. Decision: add an entry count / `hasEntries` to `DayTotals` in
  src/domain/totals.ts so "empty" and "all unknown" are distinguishable, and gate on it.
- **Ruling: tie evidence strength to a level ceiling, enforced like the CRITICAL invariant.**
  Nothing stopped a rule returning HIGH on 'uncertain' evidence, and a dozen rules are about
  to be written against this type. Cap 'uncertain' and 'limited' at INFO/MODERATE; throw in
  dev/test, report via `failures` in production. The design document names the
  ultra-processed-food rule as its own test of this, so the engine should make overclaiming
  impossible rather than rely on a reviewer noticing.
- Ruling: the card must COPY `evidence` and `alternatives` rather than alias them — a UI that
  mutated a card would otherwise mutate the catalogue itself.
- **Carried into Tasks 11-13:** run `citationProblems` over every rule as a test; assert
  wording when `isAssociational` is set (the `cause` field name invites causal phrasing);
  probe every rule with a context that makes it FIRE so a CRITICAL or strength violation
  cannot hide behind silence; `requiresNutrients: []` is legitimate for classification-driven
  rules but bypasses the gate; no declared `threshold` field exists.
- Ruling: questions asked before the data gate, the >3-CRITICAL cap behaviour (comment only),
  and the absence of `scope: 'week'` (weekly counts are integers from the diary, not nutrient
  data) all STAND.
- Task 10: fix round 3/5 dispatched. FIX_BASE 61bd3b5.
- Task 10: fix round 3/5 (all 5 addressed; 356 tests green). Merged cards now carry each
  absorbed claim with its OWN evidence and citation, nothing concatenated; `DayTotals` gained
  `entryCount` so an all-unknown day is no longer gated as empty; weak evidence capped;
  card data copied rather than aliased, pinned by a test that mutates a card and proves the
  catalogue is untouched.
- **Ruling: `category: 'safety'` is EXEMPT from the evidence ceiling.** The implementer asked
  rather than assuming, and it matters: as first implemented the ceiling would silently
  downgrade a flagged-allergen card from CRITICAL to MODERATE if its evidence were declared
  anything less than strong — the one downgrade this app must never make, since a missed
  allergen warning is the most harmful output available to it. The ceiling guards against
  EPIDEMIOLOGICAL overclaiming; a safety rule's severity comes from immediacy and the user's
  own declaration, not from effect size. The two invariants together now say something
  coherent: nutrition rules may never reach CRITICAL and may not outrun their evidence, while
  safety rules may reach CRITICAL and are judged on the hazard. Reason required in a code
  comment so the exemption cannot later read as an oversight.
- **Carried into Task 13:** every safety rule must still declare where its authority comes
  from — a citation for a handling hazard, or an explicit marker that the authority is the
  user's own flag — so "exempt from the ceiling" never becomes "exempt from saying why".
- Task 10: fix round 4/5 dispatched (safety exemption only). 
- Task 10: fix round 4/5 (commit 12d9612). 357 tests green; the implementer stashed the
  engine change to show exactly one RED test for the safety exemption.
- **A second 5-hour usage limit killed the round 3-4 re-reviewer before it produced anything
  (resets 11:30am Madrid). Controller verified the four judgement calls directly** rather than
  spending scarce capacity on another reviewer seat:
  1. Misattribution gone, not moved. `merge` spreads only the higher card's fields plus
     `merged`/`mergedFrom`; the absorbed rule's concern, portionNote, evidence and citation go
     into `merged[]` as its own claim. The ONLY joined prose is `dataNote`, which is a
     coverage caveat rather than a health claim — joining those is correct.
  2. `entryCount: day.length` is set in `buildDay`, the single construction point (`dayTotals`
     delegates to it), and the engine gates on `ctx.today.entryCount > 0`. Threaded.
  3. The invariants compose coherently: CRITICAL check is `level === 'CRITICAL' && category
     !== 'safety'`; the ceiling is `category === 'nutrition' && RANK[level] > MODERATE && weak
     evidence`. Safety may reach CRITICAL at any strength; nutrition may never reach CRITICAL
     and is capped at MODERATE when weak. The rationale comment is in the code.
  4. The copy is two levels — `{...rule.evidence, citation: {...rule.evidence.citation}}` —
     so it reaches the citation object, which is the only nested member that mattered.
- Task 10: minor (deferred, found by controller): an absorbed rule's `alternatives` are
  dropped on merge — lost rather than misattributed, and alternatives render on their own
  screen anyway.
- **Task 10: complete (commits 60e0b46..12d9612, verified after 4 rounds)**

### Task 11 — nutrient rules
- BASE 12d9612. Carries from Task 10: run `citationProblems` over every rule as a test; probe
  every rule with a context that makes it FIRE so a CRITICAL or strength violation cannot hide
  behind silence; assert hedged wording when `isAssociational` is set.
- Task 11 implementer: commit a5e69f0, DONE_WITH_CONCERNS. 19 files / 432 tests green.
  **It actually checked WHO and changed three of the plan's figures rather than keeping
  invented numbers**: no 600 mg single-entry sodium (WHO publishes only a daily figure), no
  15 g single-entry sugar, and "any industrial trans fat" dropped because the food data
  cannot separate industrial from ruminant and "any trans fat" would fire on milk. Confirmed
  unchanged: sodium 2,000 mg/day, sugar 10%/5% of energy, saturated fat 10%. Verification log
  appended to the design document. No rule dropped.
- Task 11 review (sonnet): spec ✅, quality "Needs fixes" on six Important. `requiresNutrients`
  confirmed complete for all six rules; prose mostly faithful; every entry card already states
  WHO sets no single-serving limit.
- **Ruling: entry cards must carry the "usual intake over time" qualifier on any disease
  sentence.** The sugar entry card followed "This entry alone has more added sugar than WHO
  suggests for a whole day" with "Higher sugars intake is associated with weight gain and
  dental caries" — a reader joins those into "this entry causes weight gain", which the design
  document explicitly forbids. The daily rules get it right; the entry rules did not. Plus a
  tone test that bites.
- **Ruling: DROP the sodium HIGH tier (1.5x) entirely.** It was undisclosed and contradicted
  its own card's "one day above it is not by itself a problem" — but the deeper reason is that
  the grade is on the wrong axis. The design document defines HIGH as "significant concern,
  especially with FREQUENT consumption". One day at 3,000 mg is not a different KIND of
  concern from one day at 2,100 mg, just more of the same; frequency is what should escalate,
  and no weekly sodium rule exists. Daily sodium is MODERATE with no magnitude tier.
- **Ruling: trans fat becomes MODERATE**, matching the other entry rules — HIGH was a grade
  WHO does not publish, on moderate-certainty observational evidence, from a card that itself
  says the figure is not a threshold.
- **Ruling: remove the unsourced "because".** "The 5% figure is conditional because it rests
  on fewer studies" attributed a reason to WHO that the implementer's own log says was not read
  at source.
- **Ruling + mapping rule for Tasks 12-13: declared `strength` reflects the CERTAINTY OF
  EVIDENCE for the outcome the card names, not the strength of WHO's recommendation.** That is
  why saturated fat is 'moderate' despite a strong recommendation, and it stops a future rule
  borrowing a recommendation's authority for a weaker evidence base. Sodium's rating to be
  confirmed at source (blood-pressure evidence high, cardiovascular-outcome possibly low).
- **Ruling: fix two tone tests that cannot fail.** "Claims no more than its evidence" only
  checked `strength` was 'strong' or 'moderate' — so an overclaiming rule declaring 'strong'
  passes, while an honest future rule declaring 'limited' FAILS even though the engine
  supports and caps it. The alternatives test's `toMatch(/WHO/)` passes any invented
  alternative mentioning WHO. A test that cannot fail is worse than none because it looks like
  protection.
- Ruling: also expand the lexical lists (dangerous/harmful/toxic/excessive/unsafe; death,
  mortality, weight gain, kidney, cholesterol), fix `usual` matching inside "unusual", clarify
  the sugar tier wording, and log two substitutions: WHO's share-of-INTAKE figures compared
  against the app's energy TARGET, and no daily trans-fat rule existing.
- Ruling: missing boundary tests and "for adults" wording on sodium cards STAND (the log
  already records the adult-figure limitation).
- Task 11: fix round 1/5 dispatched. FIX_BASE a5e69f0.
- Task 11: fix round 1/5 (all 6 + cheap items; commits e2fbbe2, d140de5). 438 tests green,
  12 RED first. Sodium evidence checked at source: WHO 2012 rates blood-pressure evidence
  high and the mortality/cardiovascular/stroke/coronary evidence "of lower quality"; the
  summary now says so and `strength` stays 'strong' on the blood-pressure basis.
- Task 11 re-review: all addressed. Confirmed the tone tests now bite — an entry rule naming
  a disease without a long-term qualifier fails, an honest 'limited' rule passes once pinned,
  the portion-note join loophole is closed by splitting on newlines, and no orphaned tier
  prose survives. `Alternative.citation` values are honest: each is a DIFFERENT statement
  from its rule's own conclusion, with strong-vs-conditional labels not copied across.
- **Ruling: remove or source the LDL claim on the saturated-fat alternative.** Its `reason`
  says the replacement "lowered LDL cholesterol in trials", which that alternative's own
  citation does not support — unsourced prose beside a WHO citation, exactly the misattribution
  the task spent two rounds eliminating. The hedge regex let it through because "trials" is on
  the allowed list.
- **Ruling: name the outcome the 'strong' badge covers in the card text the user reads.** The
  sodium card's title and concern name no outcome, so the badge sits on a card whose only
  outcome mention is in the summary — a reader takes it as covering disease outcomes. The
  distinction must not depend on reaching the summary.
- Ruling: `Alternative.citation` becomes REQUIRED. Optional, enforced only by a tone test, it
  would let an alternative added outside the catalogue tests carry a health claim with no
  source; required makes that a compile error and forces Tasks 12-13 to source theirs.
- Ruling: `LONG_TERM` accepting "regular"/"regularly" STANDS (honest synonyms for usual
  intake), as does the strength pins being review gates rather than semantic proof — the pin
  makes an upgrade a visible diff, which is what a reviewer needs.
- Note for Task 12: the implementer observed nothing in the catalogue can now exceed MODERATE.
  That resolves next task — processed meat is HIGH on the NATURE of the concern and its
  frequency, not on magnitude of a nutrient, which is the axis the design document reserves
  HIGH for. The cap is the correct outcome for nutrient-quantity rules.
- Task 11: fix round 2/5 dispatched — the last. FIX_BASE d140de5.
- Task 11: fix round 2/5 (all 3; commit d79f360). 444 tests green, 3 RED first. The
  saturated-fat alternative no longer claims LDL/trials, and a NEW tone test generalises the
  fix: it fails any alternative whose reason names an outcome or mechanism word its own
  citation does not contain. Both sodium cards now bound the 'strong' rating to blood
  pressure in the text the user reads, with a test requiring that of every 'strong' rule, and
  the log quotes the 2012 guideline sentence read directly from the PDF.
  `Alternative.citation` is required, and the engine copies it per card.
  Controller verified green directly rather than a third review seat: small diff, RED-first
  evidence, and the key risk (does the alternatives rule generalise?) is settled by the new
  test being written as a property over the whole catalogue rather than a case.
- **Task 11: complete (commits 12d9612..d79f360, review clean after 2 rounds)**

### Task 12 — classification rules
- BASE d79f360. Carries: the strength mapping rule (declared `strength` = certainty of
  evidence for the outcome the card NAMES, not the strength of the recommendation);
  `Alternative.citation` now required; `alcoholOccasions` counts ENTRIES containing alcohol,
  not drinks or units; `redMeatGrams` is per-item; probe every rule so it fires; run
  `citationProblems` over every rule.
- Task 12 implementer: commit 6e4d8ac, DONE_WITH_CONCERNS. 20 files / 556 tests green. Its
  own tone tests caught two wording slips in its prose, which is the mechanism working.
- Ruling: alcohol flat MODERATE with NO escalation STANDS and was the right call — WHO says
  the evidence "cannot indicate a threshold", and `alcoholOccasions` counts entries rather
  than drinks, so an escalating card would imply knowledge the app does not have.
- Ruling: red meat and sweet drink downgraded from 'moderate' to 'limited' STANDS, following
  IARC's own "limited evidence" wording and WHO's low rating for the drink-specific cohort
  evidence. Processed meat declared NON-associational STANDS — IARC Group 1 means sufficient
  evidence of carcinogenicity, and hedging it would understate the source. Processed meat as
  the only HIGH STANDS.
- **Ruling: the ultra-processed rule must not fire per item.** The implementer flagged it:
  as built it fires on any NOVA 4 item, and 1,724 of 5,431 dataset foods are NOVA 4, so
  roughly a third of everything logged would produce a card. That is the warning-fatigue
  anti-goal — the user stops reading, and then the processed-meat card stops working too. A
  rule firing a third of the time has negative value even when each card is true. Decision: a
  DAILY rule on the share of the day's ENTRIES that are NOVA 4, high threshold, minimum three
  entries, with two disclosures on the card — that it counts entries not energy, and that the
  research measures ultra-processed intake as a share of ENERGY, so this is an indicator
  rather than a measurement of what that research measured. Share threshold labelled as the
  app's own choice, like the frequency figure.
- **Ruling: red meat's prose names IARC but its only citation is WCRF.** The card asserts
  Group 2A, so IARC owes the source of that claim; WCRF supports the weekly amount, not the
  classification. Same misattribution class as the engine merge fix and the alternatives fix,
  one level down again. Decision: add optional `supportingCitations: Citation[]` to Evidence
  for cards making more than one sourced claim, give red meat both, and add a tone test that
  GENERALISES it — if a card's prose names an organisation (IARC, WCRF, WHO), the rule must
  carry a citation from that organisation.
- Ruling: try once more for a sourced processed-meat alternative in WCRF's cancer-prevention
  recommendations — it is the flagship card and the design document's worked example shows
  swaps on it. If the language genuinely is not there, record that in the log; an unexamined
  "no source names a replacement" is what I am ruling out, not the conclusion itself.
- Ruling: record in the log that IARC Volume 114 itself was not read (only the press release,
  which is where the 50 g / 18% figure comes from) and that WHO's server returned 403 so the
  sugars guideline was read from a PDF copy.
- Task 12: fix round 1/5 dispatched. FIX_BASE 6e4d8ac.
- Task 12: fix round 1/5 (all 4; commit 8ac36e8). 594 tests green, 12 RED first. Ultra-processed
  is now a daily rule firing INFO only when >half of today's entries are NOVA 4 with at least
  three entries; `DayTotals` gained `nova4EntryCount`. `Evidence.supportingCitations` added
  (red meat: WCRF for the amount + IARC N.240 for Group 2A; alcohol: IARC N.371 for Group 1),
  with a tone test requiring a citation from every organisation the prose names. It also found
  WCRF's ACTUAL replacement language rather than concluding none existed.
- Ruling: the alternatives-test regex widening to accept "swap", "alternatives to" and
  "instead of" STANDS — the test's purpose is to confirm the citation supports a replacement,
  and that is replacement language.
- **Ruling: the tone tests must exempt `citation.title` and `citation.conclusion` from the
  app's-voice prohibitions.** WCRF's real page title contains "avoid", which the tone tests
  ban, so the implementer substituted a descriptive title — the test pushing toward LESS
  honesty, which means the test is wrong, not the title. The prohibitions govern the app's own
  voice (concern, cause, portionNote, summary, alternative reason); a citation title and
  conclusion are the SOURCE's words, quoted. Forcing those through a filter built for our prose
  makes us paraphrase sources, and an invented title is less truthful than the real one.
  Restore the real title; keep the checks that genuinely apply to a conclusion (substantive,
  and not a paraphrase that strengthens the source).
- **Ruling: drop "much of the research measures a share of energy".** That sentence came from
  MY description of the evidence base, not from a source anyone read — I should not have handed
  it a line to put on a card. The card says only what the app can stand behind: it counts
  entries, the threshold is the app's own choice, and it indicates a daily pattern rather than
  measuring one.
- Ruling: reword the ham alternative as WCRF's own example rather than tailored advice, instead
  of scoping it to sandwich entries — more honest and more useful than a sandwich-specific line
  on a hot-dog card.
- Ruling: the undated WCRF citation's `year` becomes the ACCESS year, recorded as such in the
  log. An inferred publication year presented as fact is a small untruth in a field whose whole
  job is traceability.
- Task 12: fix round 2/5 dispatched — the last before review. FIX_BASE 8ac36e8.
- **A THIRD 5-hour usage limit (resets 16:50 Madrid) killed the Task 12 round-2 implementer
  before it started; tree was clean at 8ac36e8 with 594 green.** Controller applied the four
  round-2 items directly rather than stall for hours — a deliberate deviation from "never fix
  findings yourself", recorded here so the final whole-branch review can scrutinise this commit
  (46de1b0) with that in mind. All four were small, well-specified text and test edits:
  1. Tone prohibitions scoped to app-authored prose via `ownProse`; `allProse` removed. A
     citation's title and conclusion are the SOURCE's quoted words. The old test had forced a
     descriptive substitute for WCRF's real page title because it contains "avoid" — the test
     pushing toward paraphrasing a source to satisfy a rule about our own voice.
  2. Red-meat citation restored to WCRF's real title "Limit red meat and avoid processed meat"
     (verified by search; it matches the page the implementer read and the URL slug, and is
     already the title on the processed-meat alternative's citation). `year` marked as an ACCESS
     year, 2026, since the page is undated.
  3. The ultra-processed card no longer characterises the research literature. It had carried
     "much of the research measures ultra-processed intake as a share of energy" — a sentence
     that came from MY OWN description of the evidence base, not from any source read on this
     project. My error, introduced by handing an implementer a line to put on a card. A test now
     asserts the claim does not return.
  4. The processed-meat alternative is framed as WCRF's own example rather than tailored advice.
  Two tests that pinned the old wording were updated to pin the new; suite 594 green, tsc clean.
  Verification log updated in the design document.
- Task 12 review (sonnet): spec compliant structurally — CRITICAL unreachable (every `level()`
  returns a literal), HIGH only on processed-meat and pinned, 'limited' rules capped at
  MODERATE, strengths all pinned. Called out as best-handled: the alcohol card (flat MODERATE,
  says it counts entries not drinks, with a test forbidding unit/glass/pint/ml wording) and the
  ultra-processed card (counts entries, both numbers labelled the app's own choice, category
  called broad, evidence called observational, no threshold claimed, names no organisation).
  Four Important findings, all claims reaching a card without a cited conclusion behind them.
- **Round 3 applied by the controller (commit 1915b70), the limit still holding the agent:**
  alcohol's two headline sentences (no safe level; evidence cannot indicate a threshold) were
  the stated basis for the flat MODERATE grade yet appeared in no quoted conclusion — now
  quoted verbatim; red meat asserted "observational studies, mainly for colorectal" uncited —
  now IARC's own sentence on the colorectal, pancreatic and prostate associations is quoted and
  the prose follows it; nutrient density's WHO carbohydrate citation concerns neither protein
  nor energy share nor any single entry while the card compares exactly those — the summary now
  says the comparison is the app's own and the citation is background; both WCRF citations now
  carry an ACCESS year. Stale log caveats marked superseded.
- **Ruling: the tone tests' three known bypasses are RECORDED, not patched.** Review found an
  associational card whose quoted conclusion says "causes", a conclusion paraphrased stronger
  than its source, and a WHO mention satisfied by an IARC citation. The first and third are
  CORRECT behaviour — IARC's limited-evidence wording does say "causes", and IARC is part of
  WHO — and the second cannot be caught without reading the source. Lexical tests for them
  would force misquoting sources, which is exactly the error round 2 corrected. Verifying a
  conclusion against its source is the verification log's job, not a unit test's.
- **Task 12: complete (commits d79f360..1915b70, review clean after 3 rounds)**

### Task 13 — safety rules (allergen + food handling)
- BASE 1915b70. This is the only task where CRITICAL is reachable.
- Task 13 implementer: commit 390605a, DONE_WITH_CONCERNS. 21 files / 696 tests green. All
  five hazards verified at FSA/FDA pages plus NHS for the allergen "check the label" claim;
  none dropped. The allergen card warns "may be present", says to check the label, and states
  that a missing tag does not mean allergen-free; its authority is declared as the user's own
  flag via a new `Rule.safetyAuthority`. It correctly escalated the raw-egg question to a human
  rather than deciding it.
- **Ruling: remove raw eggs from the hazard list.** The FDA warns while the UK FSA treats
  Lion-marked runny eggs as low risk, so the hazard is jurisdiction-dependent — and this user is
  in the Netherlands, where EU salmonella controls are comparable to the UK's rather than to the
  FDA's assumptions. A CRITICAL card on a soft-boiled egg or homemade mayonnaise would be
  exactly the over-warning that destroys the tier: an uncollapsible red card on something most
  Europeans eat without incident teaches the user to dismiss CRITICAL, and then the allergen
  card — the one that could actually matter — arrives at a tier they have learned to ignore.
  Reasoning recorded in the verification log rather than silently deleted, with a comment
  pointing at the profile's `conditions` list: if pregnancy or immunosuppression is ever
  flagged, raw egg becomes a live hazard and that is the hook to re-add it. The other four
  (rice, kidney beans, sprouts, unpasteurised dairy) hold regardless of jurisdiction.
- **Ruling: `Context.foods` being empty must not silently disable safety rules.** The
  implementer added the field with "empty means silence", which is a fail-open on the one
  category where that is unacceptable — if Task 14 forgets to populate it, every allergen and
  hazard rule goes quiet and nothing reports it. Decision: when `pending` has resolved items
  but `foods` is empty, a safety rule depending on it records a `failures` entry with
  `category: 'safety'`, so the gate's existing non-blocking note says a check could not run.
- Ruling: the three catalogue-wide tests scoped to nutrition rules must carry their own stated
  reasoning in the report — narrowing is sometimes right (a long-term-intake qualifier makes no
  sense on a card about rice kept warm, since that hazard IS about one serving) and sometimes
  how a test quietly stops protecting. Also asked it to confirm the exemption was not widened so
  a NUTRITION rule could now return CRITICAL.
- Task 13: fix round 1/5 dispatched. FIX_BASE 390605a.
- Task 13: fix round 1/5 (all 3; commit 6b465d9). 689 tests green. New `Rule.identityRequired`
  turns the fail-open into a visible `failures` entry; the allergen rule opts in only when
  something is flagged, so the shipped default makes no noise. A test proves a nutrition rule
  carrying `safetyAuthority` still throws on CRITICAL.
- Task 13 review (sonnet, with a real dataset probe): spec compliant; allergen wording verified
  NOT readable as reassurance (warning first, label instruction before the disclaimer, "this app
  cannot tell you that a food is free of one"); no-inference rule airtight (`rawText` read
  nowhere in src/); nutrition-CRITICAL invariant untouched; all seven test-scoping edits judged
  legitimate one by one. Hazard match counts: rice 146 foods, kidney beans 6, sprouts 4, raw
  milk 6 — nothing fires without an explicit yes.
- **Ruling: fix the allergen vocabulary mismatch — this is the missed-allergen failure.**
  `foldAllergen` strips only case, a trailing "s" and a leading "tree ", so a user flagging
  "soy", "shellfish", "dairy" or "wheat" gets ZERO matches against `soybeans`,
  `crustaceans`/`molluscs`, `milk` and `gluten`: the rule goes silent and, because
  `identityRequired` is satisfied, no failure is raised either. Reached by someone typing the
  ordinary English word for their own allergy. Decision: map the synonyms people actually type,
  AND record a `failures` entry when a flagged allergen matches no known tag, so an
  unrecognised flag surfaces as "we could not check this" rather than silence.
- **Ruling: a pending hazard question must not withhold an allergen CRITICAL.** The engine
  returns `{cards: [], questions}` whenever any safety question is unanswered, so "Rice, fried,
  with shrimp" asks the rice question and holds back the crustacean card — and if the gate lets
  the user dismiss the question, the allergen card never appears. Decision: CRITICAL cards from
  rules with no pending question pass through alongside the questions. A question about rice
  must never be able to swallow an allergen warning.
- **Ruling: gate sprouts on `Profile.conditions`, exactly as raw eggs were.** The FDA conclusion
  applies to people more vulnerable to foodborne illness, but the card says nothing about that
  group and asks only "raw or lightly cooked" — so a healthy person logging bean sprouts on pho
  answers yes honestly and gets an uncollapsible red card. Same population-dependent hazard,
  same reasoning, same hook.
- Ruling: narrow the rice question to room-temperature cooling and drop "kept warm" — a rice
  cooker's keep-warm setting is ordinary, and the FSA page is about room-temperature holding.
  146 matching foods is the most exposed surface in the catalogue, so the question-fatigue
  trade-off goes in the log: on this tier credibility depends on rarity.
- Ruling: exclude cooked variants from the kidney-bean and sprout patterns; narrow the tone-test
  `kidney` exception to safety rules so "kidney damage" is still caught in nutrition prose;
  strengthen the allergen no-reassurance assertion (it matches `allergen-free` while the card
  says "free of an allergen"); fix the interleaved `safetyAuthority`/`identityRequired` doc
  comments; assert safety rules return only CRITICAL or null.
- Task 13: fix round 2/5 dispatched. FIX_BASE 6b465d9.
- Task 13: fix round 2/5 (all 6; commit 86cb6a1). 709 tests green, 20 RED first. Synonym map
  tested against all 14 real dataset tags plus 21 synonym pairs; an unmatched flag now raises a
  safety failure via `Rule.cannotCheck` instead of silence. Raw sprouts gated on
  `Profile.conditions` like eggs, leaving three live hazards (rice, kidney beans, raw milk).
  Controller verified the engine change directly: `questions.length > 0 ? merged.filter(CRITICAL)
  : merged`, with the reasoning in the comment — "a question about rice must never swallow an
  allergen warning; everything below CRITICAL still waits, because the gate re-evaluates once
  the question is answered." Exactly right.
- Ruling: the rice question's "an hour or two", looser than FSA's "ideally within one hour",
  STANDS — a wider window means a yes is more likely to be a genuine hazard, which is the right
  calibration for a tier that must fire rarely. The card carries FSA's own figure in its quoted
  conclusion, so the source's number is visible to the reader.
- **Task 13: complete (commits 1915b70..86cb6a1, review clean after 2 rounds)**

## The rule catalogue is finished — 13 of 19 tasks, 709 tests
Every health claim in the app now traces to a source that was read, and the verification log
records what each source actually says, what the plan got wrong, and what could not be checked.
Figures the plan asserted that did NOT survive contact with the sources: the 600 mg single-entry
sodium trigger, the 15 g single-entry added-sugar trigger, "any industrial trans fat", the
sodium HIGH tier at 1.5x, alcohol escalation, a per-item ultra-processed card, raw eggs as a
hazard, and raw sprouts for the general population. Each was removed or made qualitative rather
than kept on an invented number.

### Next: the native phase (Tasks 14-17, 19, 18) per the user's hybrid choice
**Execution method, final form (user's choice at 13/19):** implementation delegated to one
implementer subagent per task; the CONTROLLER reviews each task itself rather than dispatching a
separate reviewer. Saves a seat per task, keeps my context on judging rather than typing, and the
whole-branch review at the end still runs on the most capable model.

### Task 14 — log screen and warning gate (the centrepiece)
- BASE 86cb6a1. Carries the accumulated hand-offs from Tasks 5, 7, 9, 10, 12 and 13 — all listed
  in the dispatch.
- Task 14: implementer commit 05055b4 + fix 446c293. 739 tests green. Controller reviewed all
  ten carried requirements against the code and all hold. `unusualServing` is better than asked:
  it only second-guesses a DEFAULTED serving and leaves a weight or unit the person typed alone.
- Ruling: `MergedClaim` gains `level`, set by `claimOf` from the absorbed card, so `warningsShown`
  records every claim the user actually saw at its own true level. `warningsShown` is not
  bookkeeping — the design gives it a job (showing over months which warnings changed behaviour)
  and dropping merged claims would bias that history toward whichever rule sorted first.
- Ruling: text-only alternatives STAND. The rules' alternatives are sourced prose from WCRF and
  WHO carrying no dataset ids, so there is nothing to resolve and nothing was invented. The
  design's worked example shows comparative sodium figures beside swaps; we deliberately do not,
  because no source ties those numbers to the recommendation and matching a free-text label back
  to a dataset food could put the wrong food's figures beside a WCRF citation.
- **Controller verified Task 14 in a REAL browser at 375x812 — the check jsdom cannot give.**
  Logged "I ate two hot dogs and a cola" end to end: the gate resolved "2 × Hot dog, NFS
  (1 regular, 57 g each) — 114 g" and "1 × Soft drink, cola (1 can (12 fl oz), 372 g each) —
  372 g"; showed the HIGH processed-meat card expanded with IARC's quoted conclusion and the
  evidence-strength line; two INFO cards collapsed and neutral; exactly three cards (the cap);
  the three actions plus "Change what I typed". "Add anyway" committed through real IndexedDB
  and the RECENT list showed the entry at 510 kcal. No console errors. The card's prose is more
  carefully hedged than the original spec drafted it — it carries IARC's "remains small" and
  "no figure for one serving", which the plan's §9.6 example omitted.
- **Task 14: complete (commits 86cb6a1..446c293, reviewed by the controller + browser-verified)**

### Task 15 — custom foods
- BASE 446c293.
- Task 15 implementer: commit e123df8, DONE_WITH_CONCERNS. 24 files / 764 tests green.
  Controller verified the invariant end to end: `if (r.value !== undefined) per100g[k] = r.value`
  keeps a blank field as an ABSENT KEY, never a zero, through form state, storage, resolution and
  totals. Self-reported badge wired through the gate, outcome, diary row and the list. Unasked
  and good: a salt-to-sodium conversion, because European packaging lists salt rather than sodium
  and this user would otherwise do that arithmetic on every label.
- **Ruling: `eraseEverything` must clear the custom-food cache.** The lookup is module-level and
  refreshes on create, update and load but NOT on erase — so after wiping their data the user's
  custom foods stay searchable and loggable for the rest of the session. A privacy promise broken
  in the quietest way: the erase reports success and the data is still in front of them.
- **Ruling: add `deleteCustomFood` (hard delete).** Leaving it out because the db had no delete
  API was the right call rather than inventing one, but the gap is real — a mistyped food is
  stuck in search results forever and the only escape is erasing everything. Hard delete is
  correct here, unlike diary entries: custom foods are reference data, and every `DiaryEntry`
  snapshots its nutrients and coverage at commit, so past entries keep their numbers and their
  `rawText`. Confirmation must say so, and a test must prove it.
- Ruling: the NOVA assumption is DOCUMENTED, not fixed. `ClassificationFlags.novaGroup` cannot
  say "unknown", so an unflagged custom food records as group 1 — making it optional would ripple
  through the pipeline and every rule for little gain. Consequence written down where it will be
  found: an unflagged custom food counts as NOT ultra-processed in the daily share, so that card
  under-fires rather than over-fires. The safe direction for a 'limited'-evidence rule, and a
  recorded choice rather than an accident of the type.
- Ruling: not touching `resolveItems.ts` STANDS — the provider seam already carries `source`, and
  avoiding resolver edits was the point of building it. `CoverageNote` wired only into `EntryRow`
  STANDS; Task 17 uses it for totals.
- Task 15: fix round 1/5 dispatched. FIX_BASE e123df8.
- Task 15: fix round 1/5 (all 3; commit 1e18f3d). 767 tests green, 3 RED first. Erase now empties
  the cache even if storage throws partway; `deleteCustomFood` is a hard delete with a
  confirmation saying logged entries keep their numbers, pinned by a test that an entry logged
  before the delete keeps identical nutrients and rawText.
- **Task 15: complete (commits 446c293..1e18f3d, reviewed by the controller)**

### Task 16 — batches (meal prep)
- BASE 1e18f3d. The feature the user asked for by name: "if i want to have a pasta for example
  that i mealprep and i make for 4 days".
- **Controller browser-checked the custom-food screens at 375x812 and found a real bug no test
  could catch (commit 37598e7).** With no explicit body colours and no `color-scheme`
  declaration, a device set to dark mode got the browser's dark UA background behind text
  coloured for a light theme — the whole app rendered grey-on-near-black and was unreadable.
  Many people run their phone in dark mode, and this is a phone-first app. Fixed by declaring
  `color-scheme: light` and explicit body colours in `src/index.css`, verified by reloading with
  the pane forcing dark. A suspected text-clipping bug turned out to be a screenshot-scaling
  artefact: a JS measurement showed `scrollWidth === innerWidth === 375`, no overflow.
  Also added `.claude/launch.json` so the dev server can be started by name.
- Process note: my shell chain ran `git commit` after a `grep` of the test output rather than
  after the test's own exit status, so a commit went out while a one-test failure was on screen.
  The failure turned out to be the Task 16 agent's file caught mid-write — the tree is green at
  767 and the commit contains only my two intended files — but the chain was wrong and I should
  gate on the suite's exit code, not on grep finding lines.

### Task 16 — batches
- Implementer commit 403cffe, DONE_WITH_CONCERNS. 26 files / 795 tests green. It said plainly
  that the RED run was manufactured — implementation drafted first, moved aside to produce a
  missing-module failure. Recorded, not redone: the tests exist and pin real behaviour, which is
  most of the value. A test that has never failed has never been shown to test anything.
- **Ruling: never show a nominal 100 g for a portion whose weight is unknown.** With no cooked
  weight the gate line read as though the app knew a portion weighs 100 g. It does not, and a
  number presented as a measurement when nobody measured it is the same failure as a fabricated
  nutrient, moved into the units line. A portion's NUTRIENTS are exact regardless of its weight,
  so "1 portion of Chicken pasta" with no gram figure is both honest and complete.
- **Ruling: carry `fped` through to batch portions**, summed per ingredient and divided, set only
  when EVERY ingredient has it (the same rule as entries). Without it a batch of vegetable soup
  contributes nothing to the vegetable count — so someone who meal-preps, which is this user and
  the reason the feature exists, gets "days without a vegetable" over-reported on exactly the
  days they cooked properly. The app would be wrong about the thing it is meant to encourage.
- Ruling: add a batch delete (same reasoning as custom foods — a mistyped batch otherwise sits in
  search forever), with the confirmation that logged portions keep their numbers.
- **Ruling: test the cooked-grain regex against the real dataset.** An untested name heuristic
  over FNDDS names is precisely where this project found its worst bugs — "1 pepper" dropped
  because *pepper* contains *per*, and a banana resolving to a 6 g slice. Report the match list,
  not a count.
- Ruling: `rebuildBatch` returning `{batch, needsHelp, cookedWeightNotes}` STANDS — an edit that
  silently drops an unresolved ingredient would be worse than a wider return type. Self-reported
  marking is INHERITED when any ingredient was a custom food, since then part of the figure is
  someone's reading of a packet; batch-sourced entries are marked as such either way.
- Task 16: fix round 1/5 dispatched. FIX_BASE 403cffe.
- Task 16: fix round 1/5 (all 4 + both rulings; commit b426f1f). 29 files / 813 tests green,
  tests written first this time with a real RED. **The dataset test I required caught a badly
  over-broad regex**: the cooked-grain check matched 630 of 5,431 names including oat milk,
  infant formula, cookies and cereals; `isCookedGrain` now matches 35, requiring the head of the
  name to be a plain grain and excluding dish and dry/raw words. An unweighed portion now reads
  "1 portion of Chicken pasta (from a batch)" with no gram figure anywhere the user can see.
- **Controller fix (commit 8c9f0dd-ish, see log): the ordinary words for pasta resolved to
  nothing.** The implementer flagged that bare "spaghetti" went to needsHelp. A probe of all
  5,431 names found ZERO entries containing spaghetti, macaroni, tagliatelle, linguine, farfalle
  or orzo — the dataset's entire pasta vocabulary is "Pasta, ...". Added all six to the synonym
  map and extended the real-dataset test to cover them. Safe precisely because no dish entry
  carries those names to hijack; lasagne deliberately excluded as a composed dish. This matters
  for a user who meal-preps pasta, which is the reason batches exist at all.
- **Task 16: complete (commits 1e18f3d..HEAD, reviewed by the controller)**

### Task 17 — diary, corrections and the what's-missing view
- Task 17 implementer: commit d026290, DONE_WITH_CONCERNS. 31 files / 834 tests green, RED seen
  first for both the targets and the screen tests. It flagged honestly that the micronutrient
  reference intakes were NOT verified — NIH ODS returned 403 and NCBI a bot check, so the values
  were NASEM DRI figures from memory cross-checked against Wikipedia.
- **Ruling: unverified reference intakes cannot ship.** Everywhere else in this app a number the
  user sees traces to a source someone read — the rule catalogue had eight of the plan's own
  figures removed for exactly this reason. Recalled values would be the one exception, and it
  would be in the screen that tells someone they are short of a nutrient. Controller found the
  right source and it is a better fit than the one that blocked: **EFSA's "Summary of Dietary
  Reference Values", January 2017 consolidated table**
  (efsa.europa.eu/sites/default/files/assets/DRV_Summary_tables_jan_17.pdf). EFSA sets the
  European reference values and this user is in the Netherlands, so its PRIs are more
  appropriate than NASEM's DRIs regardless of which was easier to reach; the Dutch Health
  Council's own tables derive from them. Required: transcribe the adult male PRI per nutrient,
  record table and column in the log, and distinguish a PRI from an AI or "safe and adequate
  intake" (potassium and vitamin D are the likely cases) because they are not interchangeable.
  **If the PDF cannot be fetched, DISABLE the micronutrient-gaps section rather than substitute
  remembered numbers** — the rest of the missing view rests on already-verified targets and
  still does its job. A view that silently omits a section is honest; one that reports a deficit
  against an invented reference is not.
- Ruling: document rather than fix — revising a batch-portion entry does not adjust the fridge
  counter (the nutrients are already correct; the counter is a convenience), and the diary
  covering only the last seven days (it matches the week the warnings reason over).
- Ruling: the tightened delete-confirmation regex STANDS (same fact asserted); weight saving
  requiring an existing profile STANDS (the profile screen is Task 19).
- Task 17: fix round 1/5 dispatched. FIX_BASE d026290.
- Task 17: fix rounds 1-2 (commits 4f05c87, d062755). 835 tests green. **The EFSA PDF downloaded
  and every reference intake was read out of it**, so the micronutrient section did not have to be
  disabled: calcium 950 mg, iron 11/16 mg, magnesium 350/300 mg, zinc 11.7 mg at 600 mg phytate,
  vitamin C 110/95 mg, vitamin D 15 µg, B12 4.0 µg, folate 330 µg DFE, potassium 3,500 mg. The log
  records table, column and age band per value, and notes age bands are not modelled and the zinc
  phytate level is assumed.
- Ruling: the PRI-versus-AI kinds are correct — EFSA sets ADEQUATE INTAKES for magnesium,
  potassium, vitamin D and B12 and population reference intakes for the other five. The
  implementer could not confirm this from the PDF's typeface (bold marks a PRI; text extraction
  loses it), so the log keeps "unconfirmed from the summary table" and now adds that a second
  reader agreed from knowledge. Not claimed as read from the source.
- **Ruling: the footnote must NAME which values are adequate intakes**, and better, mark each
  nutrient's kind where its bar is shown. A PRI covers nearly everyone's needs; an AI is a value
  EFSA set because the evidence would not support a PRI at all. "You are below the reference for
  magnesium" means something different depending on which it is, and the reader is owed that.
  Done: each gap line now reads "adequate intake (a best estimate)" or "population reference
  intake".
- Process note from the implementer: the kind-marking test was written WITH the implementation,
  so it was never seen to fail. Recorded.
- **Controller browser-checked Task 17 at 375x812.** The five-tab nav fits — 75x48 px per tab, no
  overflow, and 48 px meets the tap-target minimum, so the implementer's concern was unfounded.
  The Missing view reads exactly as the design requires: "What your diary shows is left out or
  thin, as facts about what was logged. These are things to add, not things you got wrong."
  Today's bars carry "Targets use general adult guidelines until your profile is set up"
  (`isGeneric` surfacing correctly), and the logged-days gate works — "Only 1 of the last 7 days
  have entries, which is too few to say what is missing across the week." No score, no grade, no
  BMI, no evaluative weight text. Minor grammar nit, not worth a round: "1 of the last 7 days
  have entries" should be "has".
- **Task 17: complete (commits b283454..d062755, reviewed by the controller + browser-verified)**

### Task 18 — DeepSeek fallback
- Implementer commit 209d41d, DONE_WITH_CONCERNS. 34 files / 881 tests green. It correctly
  changed a brief test that passed `[]` as candidates and expected a result — that contradicts
  the allow-list, and the allow-list was the point.
- **Ruling: restructure the fallback into describe-then-search.** The implementer found that the
  candidate shortlist cannot do the job the feature exists for: "frikandel" matches no dataset
  token, so the model was left choosing among ~18 broad names — and a Dutch food the parser
  cannot resolve is precisely the case the owner named when he asked for DeepSeek. Decision:
  (1) ask the model to DESCRIBE the food in plain English ("deep-fried minced pork sausage"),
  not to choose a dataset entry; (2) search the dataset ourselves with that description through
  `searchFoods`; (3) show the phrase, the description and the resolved food in the gate for
  confirmation before the rules run. This is strictly SAFER than the shape it replaces — today
  the model names a dataset food and we validate it against a list; afterwards it cannot name
  one at all — and it is also the thing a language model is actually authoritative about.
  Numeric nutrient fields still discarded, single phrase only, every error path still empty.
- Ruling: engage the fallback when the parser yields NO items at all. It only sent unresolved
  parsed items, so text producing nothing — the most unresolvable case there is — got no help.
- Ruling: not testing against the live API STANDS; the contract is covered by tests and I am not
  spending the owner's credits to prove it.
- Task 18: fix round 1/5 dispatched. FIX_BASE 209d41d.
- Task 18: fix round 1/5 (commit 8c04aca). 35 files / 889 tests green, 17 RED first. The model
  now gets only the phrase and returns `{description, quantity, unit}`; it is never given a food
  list and cannot name a food. Our own dataset search turns the description into a food, and a
  review panel shows the phrase typed, the AI's description and the matched food before any rule
  runs. Description validated to 2-100 characters of plain letters. The secret guard caught a
  profile-date literal in the implementer's own new test once it was tracked — the mechanical
  floor working as intended.
- Ruling: the residual risk the implementer names — a poor description landing on a plausible but
  wrong food — is ACCEPTED, with the review panel as the safeguard. That is the same pattern as
  the gate showing the resolved food name: the app does not hide an uncertain interpretation, it
  shows it and asks.
- **Task 18: complete (commits d062755..8c04aca, reviewed by the controller)**

### Task 19 — first run, settings, export/import, offline
- The last task.
- Task 19 implementer: commit 1758487, DONE_WITH_CONCERNS. 37 files / 951 tests green. Real
  build 412.75 kB JS (126.76 kB gzip), dist ~4.5 MiB. **Offline verified in headless Chrome over
  CDP with the server STOPPED** — shell, meta.json and the 4.27 MB dataset all load from the
  service worker's 10 precached entries. That is proof rather than a precache manifest read.
- **Ruling: flagging an allergen must not require a profile.** As built, someone who skips setup
  cannot flag one until they enter height, date of birth and sex. That is backwards: the allergen
  flag is the most safety-critical setting in the app and the one thing a person might want set
  BEFORE anything else, while body data is optional, exists only to sharpen calorie and protein
  targets, and is exactly what a privacy-minded person would skip. A profile with only
  `flaggedAllergens` must save, with `computeTargets` still returning generic targets.
- **Ruling: do not reload the page while a warning gate is open.** `autoUpdate` taking over
  mid-gate would discard a typed entry and the safety questions answered against it — and the
  gate is the one screen where the user is part-way through a decision. Hold the update until the
  flow is idle, or switch to prompt-based registration and apply it on return to a resting state.
- Ruling: the height not being in the guard's grep pattern STANDS (first-run empty-field tests
  cover it, and reading the pattern from the guard script rather than restating a date of birth
  was the right instinct); the two changed tests STAND (same facts, changed behaviour); not
  running the deploy workflow on GitHub STANDS (no remote yet, steps pass locally).
- Task 19: fix round 1/5 dispatched — the last change before the whole-branch review.

## Final whole-branch review (opus) — 66 commits, 144 files, 962 tests
Verdict: disciplined branch, the part that matters most (what a card says and whether a source
stands behind it) is the strongest part. The unknown-vs-zero invariant verified REAL end to end —
build script, `sumNutrients`, coverage gate, custom foods, screens — with no `?? 0` on any
nutrient path. CRITICAL structurally closed to nutrition rules. Allergen card never reassures.
Verification log called "honest to an unusual degree, including about what it could not read".
Not ready, for two reasons:

- **C1 (MY ERROR): the owner's name, DOB, height, weight, sex and country are committed to this
  public repo** in `docs/` and one `src/` comment — and the secret guard built to prevent exactly
  that EXCLUDES `docs/`. That exclusion was my preflight ruling R6: I reasoned docs/ "legitimately
  records the owner's profile in the approved design" and never connected it to C2's promise that
  no personal value is committed, or to the repo being public. The design document breaks its own
  §12 promise. 66 commits already carry it, so a later deletion does not remove it — history must
  be rewritten or the repo stays private. **That decision is the user's, not mine.**
- **C2: the batch->entry seam launders partial coverage into "known".** `batchToDatasetShape`
  emits a per100g key for every nutrient it has any number for and carries no coverage;
  `sumNutrients` on a single set then marks every present key 'known'. Consequences: the engine's
  "may be understated" note is suppressed; the daily figure prints clean; and the micronutrient
  gap can state "under the 950 mg population reference intake on 4 of 4 days with complete
  calcium data" — a sentence that names EFSA and is false. The only path found where this app can
  say something false about intake with an authority attached.

Important: I1 three Task-11 nutrient cards state outcomes their stored conclusions do not carry
(round 3 applied that standard only to Task 12's rules); I2 the allergen "could not check" branch
is unreachable (`allergen` vs `allergen-flagged`) and its test fabricates the id — the one test
found that cannot fail for the reason it claims; I3 `transFatG` is absent for all 5,431 foods so
that rule can never fire on dataset food; I4 the AI disclosure is narrower than the behaviour;
I5 rice (146 foods) and milk ask a safety question every time with no memory; I6 fibre and protein
targets are unsourced numbers shown beside a carefully-cited EFSA section.

Both controller commits reviewed specifically and judged "good, and better than average for the
branch", with the round-3 known-limits paragraph called "the most intellectually honest thing in
the document". Its weakness: it shipped prose changes touching no test, and applied its own
standard only to Task 12.

Deferred-minor triage: 21 of 24 stand; fix = the guard's scope (bundled into C1), `localeCompare`
ordering in the search tiebreak, and deleting the dead `energyShare`.

One fix wave dispatched (single agent, complete list) per the skill. Scoped re-review to follow.


---

under a heading of its own.

## The gap

Spec G3 requires every warning to say "whether the concern is about occasional or habitual consumption". Three rules
already read `ctx.week` (processed meat, red meat, alcohol). Sodium, added sugar, saturated fat, sweetened drinks and
ultra-processed food spoke only about this entry or today, so a card could say "today is above the figure" and never
how often that has happened. `Rule.patternNote` closes it.

## Rulings

- **The note counts; it never judges and never gates.** `patternNote` is OPTIONAL on `Rule`, evaluated by the engine
  ONLY for a rule that is already firing, and it takes no part in `level`. No source in this project gives a number of
  days or occasions a week at which anything changes for these five concerns, so no note states one. Every note is the
  app's own count of what the diary holds, against a figure that already appears on the card. Pinned by tests: the
  level of every one of these rules is unchanged across a week that is wholly above the figure, wholly below it, and
  empty; and no note may contain "limit", "risk", "too much/many/often", "should", "safe" or "per week is".

- **Ruling: the window is the six days BEFORE today, and the wording says so.** Today is excluded because the card
  already states today in its portion note, and today is still being logged — a card shown at lunch would otherwise
  count a part-day as a day under the figure. The note says "the 6 days before today", never "this week". The
  occasion-counting notes are the exception: they say "the last 7 days", because they count entries, this one
  included, and the pending entry is today's.

- **Ruling: a day we cannot vouch for is left OUT of the window, not counted as a day under the figure.** A day's
  total is used only when every counted entry knew the key, no entry's own figure was itself a floor, and the known
  values cover the day's energy (`completeDayValue`, the same test the trends view applies before plotting a week).
  The note therefore says "5 had complete sodium data and 4 of those were above 2,000 mg" — the denominator is days we
  can stand behind, and a partial day appears nowhere. This is the unknown-is-never-zero invariant applied to a count.

- **Ruling: the honesty gate is `MIN_LOGGED_DAYS`, imported from `trends.ts`, not a second number.** Fewer than four
  complete days in the window, or fewer than four logged days for an occasion count, and the card simply has no
  pattern line. "Three drinks in seven days" is misleading when only three days were logged at all. A 4 that drifted
  apart from the week view's 4 would be a quiet second standard.

- **Ruling: the threshold comparison stays in the rules, not in `totals.ts`.** The design asked `WeekContext` to carry
  "how many were above the corresponding figure in `Targets`", but `weekContext(entries, on)` has no access to
  `Targets` and its two callers include `src/state/useEntryFlow.ts`, which another agent holds. `WeekContext` carries
  `completeDayTotalsBeforeToday` — the day totals we can vouch for, per nutrient — and the rule, where `ctx.targets`
  already lives, counts how many exceed the figure. Same information, no signature change, and the sourced figure
  stays in the one place that owns it. **Deviation from the written design; flagged for review.**

- **Ruling: both rules of a nutrient carry the same note, and a merged card keeps the survivor's.** `MergedClaim` was
  NOT extended: an absorbed claim's pattern note is DROPPED with it, because a claim may never appear under another
  rule's note and a note bolted to a claim block would read as the claim's own evidence. Nothing is lost, because the
  entry card and the daily card of one nutrient count the same days against the same figure and produce identical
  text — pinned by a test, so a future divergence fails rather than silently disappears.

- **Ruling: a note that throws does not suppress the card.** `portionNote` throwing drops the card (existing
  behaviour; the card's central sentence is missing). A pattern note is an addition, so a throw is reported as a rule
  failure and the note omitted, and the warning that fired still shows. Suppressing a warning because a decorative
  count misbehaved is the wrong direction for this app.

- **Ruling: `patternNote` is NOT `dataNote` and neither is renamed.** `dataNote` says what the app does not know
  ("may be understated"); `patternNote` says what it does know, as a count. They render as separate lines, and a test
  shows both on one card.

- **Ruling: the frequency notes are subject to the tone tests.** `ownProse` in `tone.test.ts` now includes
  `patternNote`, and the catalogue meta-test fails if a rule declares a note that no probe actually produces — prose
  that slipped past the phrasing checks would be the one piece of the app's voice nobody is reading.

- **Zero reads as "none".** "…and none of those were above 2,000 mg" rather than "0 of those". A zero count is still
  shown: a note that appeared only when the count was high would itself be a verdict.

## The notes, verbatim

- Sodium (both cards): `Of the 6 days before today, 5 had complete sodium data and 4 of those were above 2,000 mg.
  WHO's figure is about average intake over time.`
- Added sugar (both cards): `Of the 6 days before today, 5 had complete added-sugar data and 4 of those were above
  about 63 g, which is 10% of the energy target. WHO's figure is about usual intake over time.`
- Saturated fat: `Of the 6 days before today, 5 had complete saturated-fat data and 4 of those were above about 28 g,
  which is 10% of the energy target. WHO's recommendation is about usual intake as a share of energy.`
- Sweetened drinks: `Counting this entry, sugar-sweetened drinks appear in 3 entries in the last 7 days, over 5 days
  with entries. The diary counts entries, not drinks: an entry with two glasses counts once.`
- Ultra-processed: `Counting this entry, NOVA group 4 food appears in 9 entries in the last 7 days, over 6 days with
  entries. The diary counts entries, not energy or amount.`

The closing clause on the three nutrient notes is the only evaluative-sounding part, and it states what the guideline
is about (already on the card as `horizon: 'habitual'`), not a verdict on the person.

## Process notes

- Test-first held for the window (`tests/domain/totals.test.ts`, 7 tests seen RED) and for the rules
  (`tests/rules/patternNote.test.ts`, 15 tests seen RED before `patternNote` existed on any rule). The engine and UI
  tests were written after their implementation, so they were **re-run against a reverted implementation** to see them
  fail: 3 of the 6 engine tests and 2 of the 3 UI tests went red, and the "a note that throws is reported" test went
  red against an unguarded call. The remaining three are guards that pass trivially on an absent feature, which is
  what they are for. Recorded rather than claimed as RED-first.
- The occasion counts count ENTRIES, carrying the same caveat as `processedMeatOccasions`: an entry with two colas is
  one occasion. Both the field comments and the card text say so.
- `completeDayValue` is exported from `totals.ts` and duplicates the private `completeValue` in `trends.ts`. It was
  not folded into one function because `trends` already imports `totals` and the task scoped `trends.ts` to read-only;
  worth unifying later (the one direction that works is `trends` importing from `totals`).


---

merged into `docs/build-log.md`. Same convention: the entries that matter are marked **Ruling**.

The design was settled before the work started (a nudge on the Diary at 20 entries and 30 days, dismissal for 7,
`navigator.storage.persist()` asked once, Settings reporting what the API actually says). Nothing below redesigns
it; these are the questions it did not answer.

---

## What the app is allowed to say

- **Ruling: the app never says "backed up", "safe", or "protected", anywhere.** It does not know. It knows that it
  built a file and handed it to the browser; the download may have been cancelled, saved into a folder that is
  itself inside this browser's sandbox, or deleted five minutes later. Every stored fact is therefore named for
  what it is — `fd.lastExportAt` is the moment a copy was *offered* — and the Settings line states the limit in
  the same breath as the date: "This records only that a file was built and handed to the browser: the app cannot
  tell whether it was saved, where it went, or whether it is still there." A test asserts the words *safe* and
  *backed up* appear in neither the nudge nor that line, so a later edit cannot quietly promise more.
- **Ruling: "persisted" is reported in three states, not two.** `navigator.storage.persisted()` can say yes, say
  no, or not exist, and the third is not a synonym for the second. The type is `'granted' | 'not-granted' |
  'unknown'` and the sentences are:
  - granted — "This browser has agreed to keep this app's data unless you delete it."
  - not granted — "This browser has not promised to keep this app's data, so it may remove it to free space."
  - unknown — "This browser does not say whether it will keep this app's data."

  Followed, in all three cases, by: "Either way, clearing this browser's site data deletes the diary, and a phone
  browser may remove it when the app goes unused for a while. An exported file is the only copy that outlives this
  browser." That last sentence is true even in the granted case — iOS Safari grants persistence and still clears
  an unvisited site after about a week — and it is the reason the Backup section exists.
- The nudge's wording, close to the one in the design and kept deliberately flat:

  > **Make a copy of this diary**
  > This diary is stored only in this browser. Clearing the browser's site data deletes it, and a phone browser
  > may remove it on its own when the app goes unused for a while. A copy is the only way back.
  > [Export a copy now] [Not now]

  No streak, no day count, no "you haven't backed up in 47 days". A test asserts the panel contains no digits
  followed by "days", so the guilt-metre cannot be added by accident later.

## The decision to show it

- **Ruling: blocked storage shows the nudge rather than hides it.** Every read of the two stamps is wrapped, and a
  read that throws (private window, site data blocked) is treated as "never exported" — which makes the reminder
  due. Being told twice costs a tap; being told never costs the diary. The same choice applies to an unparseable
  stamp.
- **Ruling: a stamp in the future silences rather than fires.** The plausible cause is a clock that moved, not a
  forged timestamp, and showing the reminder to someone who exported this morning reads as a bug. The age is
  clamped at zero. The cost, recorded honestly: a corrupted far-future value would silence the reminder
  indefinitely — which is why Settings prints the actual date, where a nonsense value is visible.
- The entry threshold counts rows with `state: 'active'` (`countActiveEntries`, new in `src/data/db.ts`), so a
  tombstone or a superseded revision is not counted twice over. A *cancelled* entry does count: it was never
  eaten, but it is still a stored row that the backup file carries, and the question here is "is there enough in
  this database to be worth a copy", not "how much was eaten".
- A diary whose entries cannot be counted shows no nudge at all. Reminding someone about data the app cannot see
  would be guessing, and the Diary screen's own error line already says the diary could not be read.

## Where it lives, and where it does not

- The panel is rendered by `Diary`, directly under the day strip. It is **not** on the Log screen, and a test
  renders `Log` with twenty entries seeded and asserts the panel is absent, so the rule is enforced rather than
  merely intended.
- **Ruling: `persist()` is asked for from the Diary screen, not at start-up.** Chrome decides from its own
  heuristics and never prompts, but Firefox may show a permission prompt, and a prompt must not land on someone
  part-way through logging an entry — the same reason `src/state/updates.ts` holds an app update while a warning
  gate is open. The Diary is a resting screen.
- The "already asked" flag (`fd.persistenceAskedAt`) is written **before** the call, so a rejected or dismissed
  request is not re-asked on every visit. It is written only when a call is actually made, so a browser that gains
  the API in a later version still gets asked once. `persist()`'s own answer is deliberately discarded: a granted
  request is not a promise worth repeating to the owner, and Settings reads `persisted()` instead, which is the
  browser's own current answer rather than a remembered one.

## Structure

- **Ruling: one export path, not two.** The nudge's button and the Settings button both call
  `downloadBackup()` in the new `src/state/exportDownload.ts`, which builds the blob, hands it to the browser and
  then records the timestamp. Two copies of that sequence would have drifted the moment one of them learned
  something the other did not. The record is written only after the click has returned without throwing: an
  export that failed must leave no trace, or the reminder would go quiet about a copy that was never made. There
  is a test for exactly that, and the failing export leaves the panel on screen with the error.
- **`eraseEverything` needed no new list.** It already enumerates localStorage by the `fd.` prefix rather than
  from a list of known names, so the three new keys are swept the day they are written. The only requirement is
  that every key goes through `lsKey`, which all three do; the comment in `eraseStores` now says so explicitly and
  names them, and a test erases a seeded `fd.lastExportAt`, `fd.backupNudgeDismissedAt` and `fd.persistenceAskedAt`
  along with the theme and the entries. A hardcoded list was considered and rejected: it is exactly the thing that
  drifts.
- The Settings "last copy" line is read at render rather than held in state, so an erase or an import cannot leave
  a stale date on screen claiming a copy exists. `BackupSettings` deliberately did **not** get a `key` bump on the
  Settings version counter: remounting it would have wiped the "Imported. N added" confirmation the person had
  just been given.

## Process notes

- Test-first throughout. Both test files were written and run red (unresolved imports, then failing assertions)
  before the modules existed. After the suite went green the decision function was mutated on purpose — threshold
  to 1, dismissal check removed — to confirm three tests failed; they did. The entry threshold is written as the
  literal `20` in the test rather than read from the exported constant, because a test that imports the number it
  is checking cannot notice the number changing.
- A pitfall worth recording for the next UI test in this repo: `await screen.findByTestId(...)` **inside**
  `await act(async () => ...)` never settles — act holds back the very update the query is waiting for, and the
  failure looks like a screen that rendered no data at all. The existing tests already find the element first and
  click it inside `act`; the new ones now do the same, via a `press` helper.
- `npm test` 49 files / 1101 tests green, `npx tsc --noEmit` clean, `npm run build` clean (run with another
  agent's in-progress rules work in the tree; nothing in it failed).

## Not done, and unsure

- **Not verified in a browser.** The behaviour is covered by tests, but the panel has not been looked at on a
  375 px screen in both themes the way Task 17 was. Colours are paired (`bg-slate-50 dark:bg-slate-900`,
  `border-slate-400 dark:border-slate-500`, `bg-slate-900 dark:bg-slate-100` on the primary button) and both
  buttons are `min-h-12`, but that is reasoning from the markup, not from looking.
- `persist()` is asked for on every Diary visit until it has been asked once, and the flag is per-browser. If the
  owner clears site data, the app asks again — correct, and worth knowing.
- The reminder counts entries on every Diary mount with a full `getAll` on the entries store. At this diary's
  scale that is nothing; at ten thousand entries it would be worth a count over a `state` index, which does not
  exist today and would need a schema version.
- The localStorage sweep in `eraseStores` still removes keys in one `try`, so a single key that refuses to be
  removed stops the rest. Making each removal independent would be a small improvement and is out of this
  feature's scope; recorded rather than done.

## Review additions (controller)

**Ruling: a stamp more than a day in the future is discarded, not clamped to "just now".** Hours of clock drift
are ordinary and must not start the reminder nagging someone who exported this morning, so a small future stamp
still silences it. But clamping an arbitrary future date to zero age would silence the reminder for as long as
that date stays ahead — a corrupted or hand-edited value could switch the only warning about data loss off for
years, in silence. Discarding it fails the other way: the reminder reappears, which costs a tap. Settings prints
the stored date, so a nonsense value is visible there.

**Ruling: a `food-diary` database that claims the current version but holds no object stores is deleted and
rebuilt on open.** `upgrade` runs only when the stored version is BELOW `DB_VERSION`, so such a database opens
"successfully" and then fails every read, permanently, with no way back from inside the app: the owner sees "The
diary could not be read" for ever and the only cure is DevTools. It is reachable in the wild — an upgrade
interrupted by a closed tab, eviction part-way through a write, or any other script on the origin opening
`food-diary` without a version number. Both this session's controller and the implementer hit it by accident on
the dev server, which is how it was found; neither could recover without the console. The repair is safe
precisely because a database with no object stores has nowhere to keep a row, so there is nothing in it to lose,
and the delete happens ONLY in that case. The healthy path is pinned by every test in `db.test.ts`, each of which
writes through the same open and reads the row back.


---


To be merged into `docs/build-log.md`. Same convention as the rest: the entries that matter are marked **Ruling**.

The findings that settled the design — CORS, the `es.` host, the unit of `sodium_100g`, the `added-sugars` false
zeros — were established by probing the live API from a browser on 16 Nov 2026 and are not re-derived here. What
follows is what that brief did not answer.

---

## What is read from Open Food Facts, and what is refused

- **Ruling: `added-sugars` is never imported, for any product, with no exception.** The evidence is in the fixture
  file itself: `added-sugars_100g` is `0` for Coca-Cola Original Taste (`sugars_100g: 10.6`) and `0` for LU Prince
  biscuits (`sugars_100g: 32`). This app reads a present key as a KNOWN value, so importing that zero would make
  the added-sugar rule say "0 g of added sugar, known" for a cola and **stay silent**. Nutella's `52.13` is right,
  and is refused too: one rule with no exceptions beats a rule that has to judge each value, because the judging
  is exactly what cannot be done from here. Pinned by a test that feeds the real Coca-Cola payload and asserts the
  key is absent — `'addedSugarsG' in product.per100g` is `false`, not merely `undefined` — and by a second
  assertion on the Nutella payload so the ban cannot be quietly narrowed to "only when it looks wrong". The
  sugar-sweetened-drink rule keys on classification, so a scanned cola still warns; verified in a real browser.
- **Ruling: trans fat is not imported either.** Not probed; decided by analogy and recorded as a judgement rather
  than a finding. EU labels are not required to carry trans fat, so any `trans-fat_100g` in Open Food Facts is an
  editor's contribution rather than a label reading, and carries the same false-zero risk as added sugars with
  none of the evidence that settled them. Revisit only with a probe of real products that carry the field.
- **Ruling: no vitamin or mineral is imported.** Their units in this API were NOT verified: none of the three
  probed products carries one, and a unit error here is precisely the thousandfold mistake the `sodium_100g` note
  exists to prevent. Not reading them costs nothing (they stay unknown, which they already were); reading them
  wrong would put a fabricated figure into a daily total. Named in the review panel and in Settings as a gap.
- Imported, therefore, and only these eight: `energy-kcal`, `proteins`, `fat`, `saturated-fat`, `carbohydrates`,
  `sugars`, `fiber`, and `sodium` × 1000 into `sodiumMg`. A field that is missing produces an ABSENT key and a
  sentence in the review panel naming it; a field that is present and zero is kept as a known zero, because that
  is the label's own figure (Coca-Cola really has no fat).
- **Ruling: an implausible figure refuses the whole product rather than dropping one nutrient.** A per-100 g
  energy above 1000 kcal, or a macronutrient above 100 g, is a data-entry error, and a product carrying one has
  demonstrated that nobody checked it. Importing the rest of it would be trusting the same editor twice.

## `nutrition_data_per` is read, never assumed

- **Ruling: only `"100g"` and `"serving"` are accepted, and `"serving"` only with a serving weight.** `"100g"`
  uses the `_100g` fields as they stand. `"serving"` uses the `_serving` fields and scales them by
  `serving_quantity`; with no usable serving weight the product is refused with "Open Food Facts gives this
  product's figures per serving but does not say how much a serving weighs, so the amounts cannot be worked out",
  and manual entry is offered. A missing or unrecognised `nutrition_data_per` is refused the same way. Open Food
  Facts does appear to normalise `_100g` itself even for per-serving products, but that was not verified, and
  deriving the figure from the fields the payload says are authoritative needs no assumption about its internals.
  **Not verified against a real per-serving product**: all three probed products are `"100g"`. The path is covered
  by a hand-built payload only, and that is recorded as a gap rather than claimed as tested.
- A drink's "per 100 g" is per 100 ml. The product is marked `perMlNotPerGram` (beverage category, or a `ml`
  serving size or pack size), the review panel says "This looks like a drink. Open Food Facts gives a drink's
  figures per 100 ml, and this app counts 1 ml as 1 g", and the amount field is labelled "(1 ml counted as 1 g)".
  A disclosure, not a silent conversion. Cola is about 1.04 g/ml, so the app understates a cola by ~4%; saying so
  is better than inventing a density per product.

## Classification, which drives warnings

- **Ruling: `redMeat` and `processedMeat` are NOT set from Open Food Facts categories, and the app says so.** A
  category that IS present (`en:charcuterie`, `en:hams`) would be trustworthy, so mapping the positives was
  tempting. It was rejected because absence is the common case on exactly the products that matter, and the
  absence of a card cannot be told from a clean result: a scanned chorizo would look checked. Rather than leave
  that unsaid, the review panel states it outright — "The app cannot tell from Open Food Facts whether this is red
  or processed meat, so those two warnings will not appear for anything you scan" — and Settings repeats it. A
  stated gap beats a flag that fires on two thirds of the products it should.
- **Ruling: `sweetDrink` IS set, from the product's own sugar figure rather than from a category.** A beverage
  (`en:beverages`) that is not alcoholic, is not a juice or a milk drink, and whose own `sugars_100g` is at least
  1 g, is a sugar-sweetened drink. The decision rests on a number off the label, not on a category guess, so
  Coca-Cola Original (10.6) is flagged and Coca-Cola Zero (0.0, probed as a fourth product and kept as a fixture)
  is not. The 1 g floor is the app's own choice, so a trace does not flag a drink. Known cost: an unsweetened
  plant drink with natural sugars could be flagged, which is one INFO card.
- `alcohol` is set from `en:alcoholic-beverages` or a positive alcohol figure. Unambiguous either way.
- **Ruling: where the payload carries two NOVA groups that disagree, the worse one wins.** Nutella has
  `product.nova_group: 3` and `product.nutriments['nova-group']: 4` — discovered while writing the fixture, not
  expected. Taking the maximum is the same "worst case wins" rule `mergeClassification` already applies to a mixed
  entry, and it errs toward showing the ultra-processed card rather than toward silence on a rule whose whole
  point is a caution. Both figures are Open Food Facts' own; nothing is invented. When no group is given at all,
  `novaGroup` is 1 — "not flagged", exactly the NOVA ASSUMPTION already recorded for custom foods — and the review
  panel says the processing level is unknown.
- `refinedGrain`, `vegetable`, `fruit`, `legume`, `oilyFish` are left false: no rule in the catalogue reads them
  today and nothing in Open Food Facts maps onto them cleanly. There are no FPED cup-equivalents either, so a
  scanned product contributes no vegetable or fruit amount — absent, which is unknown, never zero.

## Allergens

- **Ruling: a flagged allergen plus a scanned product is ALWAYS a reported `cannotCheck`, whether or not a tag
  matched.** `allergens_tags` and `traces_tags` are `en:`-prefixed and are frequently empty for products that do
  contain the allergen. The existing rule already holds that a missing tag is not an absence; for crowdsourced
  data nobody need have looked at the packet at all. Silence at the gate reads as "checked, nothing found", so the
  rule now says: *could not fully check X: the allergen list for a scanned product comes from Open Food Facts,
  where anyone can edit it and where products that do contain an allergen often list none. Read the packet
  yourself before you eat it.* It is reported even when a tag DID match and the CRITICAL card is already showing,
  because the list may be short either way.
- `cannotCheck` previously returned one reason. It now composes: an unrecognised flag and a scanned product are
  both reported, not one instead of the other. Pinned by a test.
- Traces are folded into `allergens`. A trace is a possible presence, and this rule's whole stance is "may be
  present"; `traces` is kept separately so the review panel can name them as traces.
- Tags are stripped of any language prefix (`en:`, `es:`, `fr:`) and four are renamed to this app's vocabulary
  (`sulphur-dioxide-and-sulphites` → `sulphites`, `sesame-seeds` → `sesame`, `tree-nuts` → `nuts`,
  `cereals-containing-gluten` → `gluten`). Everything else keeps the tag's own word, which the allergen rule folds
  and singularises before matching and which can still meet a tag the person typed on a custom food.

## The scan itself

- `BarcodeDetector` with `getUserMedia`, formats `ean_13`, `ean_8`, `upc_a`, `upc_e`. **No dependency added and no
  polyfill shipped.** The seam is `src/data/barcodeScanner.ts`: `scannerAvailability()`, `getDetector()`,
  `openCamera()`, `stopCamera()`. A polyfill could be lazy-loaded inside `getDetector` without the screen changing.
- **Ruling: there is never a button that does nothing.** `scannerAvailability()` distinguishes `no-api` (iOS
  Safari, Firefox), `insecure` (not a secure context, so no camera is offered at all) and `no-camera`, and the
  panel prints that reason instead of a Start button. A refused camera is reported when the stream is asked for,
  not as an availability state, because the person may simply have said no. Typing the digits is offered in every
  one of these cases and in the normal case too — the digits are printed under every barcode, so it always works.
  Confirmed in the real browser: desktop Chrome has no `BarcodeDetector`, and the panel said so and fell back.
- The camera is stopped on unmount (a `useEffect` cleanup), on a successful detect, on Cancel, on Stop, and before
  the proposed food is handed to the entry flow. All of them. The detect loop is a 250 ms interval, cleared in the
  same place.
- **Ruling: the check digit is tested for 12- and 13-digit codes only.** An 8-digit code may be EAN-8 or UPC-E,
  and a UPC-E carries the check digit of the UPC-A it expands to, so testing it under the EAN-8 rule would refuse
  valid scans. Eight digits are accepted on length alone and a mistyped one simply comes back "not found". A
  13-digit code with a bad check digit is refused BEFORE any request, so a typo does not become "not in Open Food
  Facts" and send the person off to type nutrition by hand.
- A half-read frame that fails the check digit is ignored and scanning continues; it is not an error.

## How a scanned product reaches the diary

- **Ruling: a scan never adds anything.** It produces a proposed food in a review panel — name, brand, barcode,
  pack size, the eight figures per 100 (and what they come to at the amount being eaten), a list of what the app
  could not find out, both dates, the licence — and only a press of "Check this and log it" sends it into the
  ordinary warning gate and confirmation. Pinned: after a lookup the entries store is still empty, and after the
  gate opens it is still empty.
- **Ruling: the scanned product is NOT searched for again by name.** `useEntryFlow` gained `submitKnownFood`,
  which builds the resolution directly through the new `resolveKnownFood` in `resolveItems.ts`. A scan knows
  exactly which product it read; running its name back through the fuzzy search would be the one place a
  near-miss could substitute a different food for the one in the person's hand. From there it is an ordinary
  entry: the same rules, gate, cards, failures and confirmation.
- `rawText` is stored as `"<grams> g <name>"`, which is what the Recent list re-submits on "log that again". That
  path DOES go through the search, which is why `offLookup` is searchable at all (see below).
- `resolveItems` was refactored so both paths build a `FoodRef` through one `makeRef`; no behaviour changed and
  its tests are untouched.

## The cache

- A new object store, `offProducts`, keyed by barcode. **`DB_VERSION` is now 2**, and `create()` was rewritten to
  add whatever is missing rather than assuming an empty database, so it serves a fresh open, a 1 → 2 upgrade and
  the existing repair path alike. Verified in a real browser: the dev database upgraded in place and now reports
  all four stores.
- **The repair test was quietly weakened by the version bump and was fixed.** `tests/data/dbRepair.test.ts`
  planted an empty database at version **1**; with `DB_VERSION` at 2 that is just an ordinary upgrade, and the
  repair — which only runs for a database that already claims the CURRENT version — would have stopped being
  tested, silently. `DB_VERSION` is now exported and the test plants at it. Worth remembering for the next bump.
- **Ruling: the cache stores the MAPPED product, not the raw payload.** A full payload is about 130 KB; three
  scans a day would be 140 MB a year on a phone, to hold fields nothing reads. The cost is real and recorded: a
  later improvement to the mapping does not reach a product already cached. That is why the review panel carries
  an "Ask Open Food Facts again" button, which refetches and replaces the stored copy — one tap, and the only way
  a product edited upstream reaches a barcode already scanned.
- A not-found, offline or failed lookup stores NOTHING. An absent product must never become a cached empty one.
- `eraseEverything` clears the new store (it is in the transaction's list), and the in-memory index empties
  through the existing `onEraseEverything` hook, so an erased product is neither stored nor searchable.
- **The cache is not in the export file.** Every entry snapshots its own nutrients at commit, so a restored diary
  keeps its numbers; it loses only the product's NAME in the entry detail, exactly as a deleted custom food does.
  `exportImport.ts` was taught to accept `source: 'off'` so a backup containing a scanned entry imports.

## Where a scanned product sits among the other food providers

- `withBatches(withCustomFoods(withOpenFoodFacts(datasetLookup)))`: batches, then the person's own foods, then
  scanned products, then the USDA dataset. Earlier providers win an exact-name tie, so the person's own food still
  beats a crowdsourced one for their own word.
- **Ruling: scanned products are searchable by name, and this is a deliberate trade.** It is what makes "log that
  again" work from the Recent list. The consequence is that after scanning a Coca-Cola, typing "cola" resolves to
  the scanned product rather than the USDA survey cola, because both score alike and the scanned provider is
  listed first. That is arguably the better answer — it is the actual product in the fridge — and it is visible:
  the gate shows the Open Food Facts badge with the product's last-edited date before anything is saved. Nothing
  crowdsourced can enter the cache without a deliberate scan, so the search only ever ranges over products the
  owner scanned themselves.

## Wording, verbatim

The badge, wherever a scanned food appears (gate, Recent, Diary, entry detail):

> **Open Food Facts · edited 12 Nov 2026**

with the title text: *These numbers come from Open Food Facts, a public database that anyone can edit. They were
copied from a product label by a member of the public, not measured by a laboratory, and they may be wrong, out of
date or incomplete. This product was last edited there on 12 Nov 2026.* The date is shown on the badge itself
wherever it is known, not only in the tooltip; in the list rows, where no product record is to hand, the badge
appears without a date.

The review panel's own date line:

> These figures come from **Open Food Facts**, a public database that anyone can edit. They were copied off a
> packet by a member of the public, not measured by a laboratory.
> Last edited there on 12 Nov 2026. Looked up just now, on 16 Nov 2026.
> Open Food Facts data is used under the Open Database License (ODbL) 1.0.

A cached product says instead: *Looked up on 16 Nov 2026 and kept on this device since, so it has not been asked
for again.*

The privacy line under the barcode field, and the fuller version in Settings:

> A lookup sends the barcode to Open Food Facts and nothing else: no diary, no profile, no totals and nothing that
> identifies you.

## Not done, and unsure

- **No per-serving product was probed**, so the `nutrition_data_per: "serving"` conversion is tested only against
  a payload written by hand. It is the one import path with no real example behind it.
- **The camera was not exercised.** Desktop Chrome has no `BarcodeDetector` and the preview pane has no camera, so
  the scan path itself — `getUserMedia`, the detect loop, `track.stop()` — has been reasoned about and typed but
  never run. The owner's Android Chrome is the first place it will execute. Everything around it (availability
  reporting, the manual fallback, the lookup, the review, the gate, the cache) was verified in a real browser at
  375 px, including a live request to the real API.
- **The light theme was checked by removing the `dark` class in the page, not by switching the app's theme**, so
  as not to overwrite the owner's stored preference on the dev origin. The badge and panel read correctly in both.
- The dev-server database at `localhost:5173` now holds **one cached product** (the Coca-Cola used for the live
  check) and no diary entry. Erase it from Settings if it is unwanted.
- `offProductMeta` is read during render in the entry detail, once per item, from an in-memory map. Fine at this
  scale; a long entry would call it twice per row.
- Open Food Facts' API etiquette asks for a descriptive `User-Agent`, which a browser will not let a page set.
  Nothing here can comply. What is offered instead: one request per scan, the cache, and no bulk fetching.
- `data_quality_errors_tags` exists and could gate an import. It is read by nothing here; the plausibility
  ceilings do that job more directly. Worth revisiting if a bad product gets through.
- The review panel is long — eight figures plus five or six gap sentences — and on a 375 px screen the confirm
  button is well below the fold. That is the project's house style (say everything, hide nothing) but it is the
  one place this feature might deserve a second look on the phone.

## Process

- Test-first. `tests/domain/openFoodFacts.test.ts` was written and run red (unresolved import) before the module
  existed, then 24 assertions green; `tests/data/offLookup.test.ts` likewise; `tests/ui/barcodeScan.test.tsx` was
  written and run with all 14 failing before the screen existed. The three allergen-rule tests were run red
  against the unmodified rule.
- The UI tests drive the REAL cache and the real mapping, with only `fetch` replaced by a stub serving the
  recorded payloads, so the product the entry flow reads back by barcode is the one the cache actually stored.
  Nothing in the suite touches the network.
- `tests/fixtures/off/payloads.ts` holds four real payloads (Coca-Cola, LU Prince, Nutella, Coca-Cola Zero) and a
  real not-found reply, fetched on 16 Nov 2026 and trimmed to the fields this app reads plus several it ignores.
  Values are untouched, false zeros included — that is the point of them.
- `npm test` 54 files / 1169 tests green, `npx tsc --noEmit` clean, `npm run build` clean.

## Review addition (controller)

**Ruling: the database repair deletes ONLY a database holding no object stores at all, never one missing some.**
When the repair was written there were three stores created together, so "missing any" and "holding nothing" were
the same condition. The barcode work made `create` additive across versions, and the two conditions parted
company: a database can now legitimately hold a full diary while lacking a store added in a later version. The
repair's own comment still claimed it was safe "because a database with no object stores cannot be holding
anything" — true of the claim, no longer true of the test it was guarding. Left alone, a future version bump
could have deleted a real diary on open, and the comment would have read as if that were intended. The guard is
now `holdsNothing` (zero stores); a partial database throws and the diary reports that it could not be read,
which is recoverable, where a wrong delete is not. Pinned by `tests/data/dbNeverDeletesData.test.ts`, which
plants a diary with an entry and all stores but `offProducts` and asserts the entry survives; verified red by
mutating the guard to `if (false)`.
