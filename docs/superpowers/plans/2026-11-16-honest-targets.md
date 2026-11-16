# Honest Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the app presenting ceilings as things to reach, put the protein target on cited evidence, and let a stated weight goal adjust the targets that its source says follow intake.

**Architecture:** `Targets` gains a direction per figure and a record of the basis each figure was derived from. `targets.ts` keeps its shape — one pure `computeTargets(profile, on)` — and gains three inputs: body-fat percentage, a goal, and the knowledge of which derived figures follow the goal energy. `NutrientBar` learns to render a ceiling. Nothing in `src/rules/` changes; the rules keep reading `ctx.targets`.

**Tech Stack:** Vite 5 + React 18 + TypeScript strict (`noUncheckedIndexedAccess`) + Tailwind; Vitest + @testing-library/react + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-16-targets-weight-and-daily-health-design.md` — §6 (evidence), §8.1, §8.1.1. Read it; this plan argues from it.

## Global Constraints

- An absent nutrient key means UNKNOWN, never zero. Never substitute a zero for a missing figure.
- No new runtime dependency.
- TypeScript strict with `noUncheckedIndexedAccess`.
- Phone-first: works at 375 px, every control at least 44 px, every colour has its `dark:` pair.
- Public repository: no secret, no personal profile value, in any file including `docs/`. `npm test` runs `scripts/check-no-secrets.sh` first.
- Every health figure shown to a person carries a source. A figure with no source is not shown. Record each one in the design document's Verification log.
- Commands: `npx vitest run <files>` while working; `npm test`, `npx tsc --noEmit`, `npm run build` before each commit.

## Verified figures — copy these exactly, do not round or substitute

| Figure | Value | Source |
|---|---|---|
| Protein PRI, adults | **0.83 g/kg body weight/day** | EFSA Panel on Dietetic Products, Nutrition and Allergies, "Scientific Opinion on Dietary Reference Values for protein", EFSA Journal 2012;10(2):2557. Verbatim: "the PRI for adults of all ages was estimated to be 0.83 g protein/kg body weight per day" |
| Protein, exercising adults | **1.4–2.0 g/kg body weight/day** | Jäger et al., "International Society of Sports Nutrition Position Stand: protein and exercise", J Int Soc Sports Nutr 2017;14:20, Position 2. Verbatim: "an overall daily protein intake in the range of 1.4–2.0 g protein/kg body weight/day" |
| Sodium | 2,000 mg/day, absolute | WHO (already in `targets.ts`) |
| Energy per kg of body mass | 7,700 kcal | Used for the goal offset only; see spec §8.1 for why it is accepted here and refused for projection |

**Forbidden:** the ISSN's 2.3–3.1 g/kg/d figure. The paper never states whether its denominator is body weight or fat-free mass. Do not use it, do not approximate it, do not cite it. Spec §6 explains why.

## Review Focus

Five conditions the spec implies that no task's happy path exercises. Each has its test added to the task that owns the code.

1. **An implausible body-fat percentage** (0, negative, 95, or a string from a form) would make Katch–McArdle produce an absurd resting rate that silently becomes an energy target. Expected: ignored, Mifflin–St Jeor used instead, and the screen says which basis it used. → Task 5.
2. **A goal rate large enough to drive the energy target below the resting rate.** Expected: the rate is capped, the target never goes below RMR, and the app says it capped it. → Task 6.
3. **A goal set on a profile with no weight logged**, so targets are the generic fallback. Expected: the goal does not silently adjust generic targets, because a deficit from a stranger's expenditure is meaningless. → Task 6.
4. **A manual override in `profile.overrides` for a figure the goal also moves.** `computeTargets` applies overrides last, so the override must win and must be marked as the basis, or the person sees their own number explained as WHO's. → Task 7.
5. **A nutrient with no entry in the direction map** — the next person to add one. Expected: a type error at compile time, not a silent fallback to "target". → Task 1.

---

### Task 1: Direction — which way each figure points

**Files:**
- Create: `src/domain/targetDirection.ts`
- Test: `tests/domain/targetDirection.test.ts`

**Interfaces:**
- Consumes: `NutrientKey` from `@/types/nutrients`.
- Produces: `export type TargetDirection = 'floor' | 'ceiling' | 'none'`; `export const TARGET_DIRECTION: Record<DirectedNutrient, TargetDirection>`; `export function directionOf(key: DirectedNutrient): TargetDirection`. `DirectedNutrient` is the union of every nutrient the app shows against a figure.

- [ ] **Step 1: Write the failing test**

```ts
test('the three nutrients the warning engine limits are ceilings', () => {
  for (const k of ['sodiumMg', 'satFatG', 'addedSugarsG', 'transFatG'] as const) {
    expect(directionOf(k)).toBe('ceiling');
  }
});

test('protein, fibre and every micronutrient are floors', () => {
  for (const k of ['proteinG', 'fibreG', 'calciumMg', 'ironMg', 'potassiumMg'] as const) {
    expect(directionOf(k)).toBe('floor');
  }
});

test('energy is neither: it is not a thing to reach or to stay under', () => {
  expect(directionOf('energyKcal')).toBe('none');
});

// Review Focus 5: the map must be exhaustive by construction, not by a default.
test('every directed nutrient has an explicit direction, with no default', () => {
  for (const k of Object.keys(TARGET_DIRECTION) as DirectedNutrient[]) {
    expect(['floor', 'ceiling', 'none']).toContain(TARGET_DIRECTION[k]);
  }
  expect(Object.keys(TARGET_DIRECTION).length).toBeGreaterThanOrEqual(14);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/targetDirection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/domain/targetDirection.ts`**

`TARGET_DIRECTION` is a `Record<DirectedNutrient, TargetDirection>` written out in full — a `Record` over a closed union, so omitting a key is a compile error. That is the mechanism Review Focus 5 asks for; do not add a default in `directionOf`. Include the nine micronutrients from `MICRO_ORDER` in `src/ui/screens/Missing.tsx`.

File header comment must say why ceilings exist as a concept here: the app told its only user for months to reach 2,000 mg of sodium.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/domain/targetDirection.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/targetDirection.ts tests/domain/targetDirection.test.ts
git commit -m "feat: each target figure knows whether it is a floor, a ceiling or neither"
```

---

### Task 2: `NutrientBar` renders a ceiling as a ceiling

**Files:**
- Modify: `src/ui/components/NutrientBar.tsx`
- Test: `tests/ui/nutrientBar.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `directionOf` from Task 1.
- Produces: `NutrientBar` props gain `secondMark?: { value: number; label: string }`. Direction is read from `directionOf(nutrient)`, not passed in, so no caller can disagree with the map.

- [ ] **Step 1: Write the failing test**

```ts
test('a ceiling never uses the word target', () => {
  render(<NutrientBar nutrient="sodiumMg" value={1400} coverage="known" energyCoveredShare={1} target={2000} />);
  expect(screen.getByTestId('bar-sodiumMg').textContent).not.toMatch(/target/i);
  expect(screen.getByTestId('bar-sodiumMg').textContent).toMatch(/limit/i);
});

test('a floor still reads as something to reach', () => {
  render(<NutrientBar nutrient="proteinG" value={80} coverage="known" energyCoveredShare={1} target={160} />);
  expect(screen.getByTestId('bar-proteinG').textContent).toMatch(/target/i);
});

test('a second mark is shown on the same bar, not as a bar of its own', () => {
  render(
    <NutrientBar nutrient="addedSugarsG" value={30} coverage="known" energyCoveredShare={1} target={56}
      secondMark={{ value: 28, label: 'WHO conditional 5%' }} />,
  );
  const bar = screen.getByTestId('bar-addedSugarsG');
  expect(bar.querySelectorAll('[data-mark]')).toHaveLength(2);
  expect(screen.queryByTestId('bar-addedSugarsIdealG')).toBeNull();
});

test('the accessible name says which way the figure points', () => {
  render(<NutrientBar nutrient="sodiumMg" value={1400} coverage="known" energyCoveredShare={1} target={2000} />);
  expect(screen.getByRole('progressbar').getAttribute('aria-label')).toMatch(/limit|under/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/ui/nutrientBar.test.tsx` → FAIL on the ceiling wording.

- [ ] **Step 3: Implement the rendering**

Three cases from `directionOf`. A ceiling fills towards a limit and the caption reads `limit N unit`; a floor keeps `target N unit`; `none` (energy) shows the figure with neither word — use `goal N unit`. Marks carry `data-mark` so the second-mark test can count them. Keep the existing calm palette: no alarm colour for a ceiling that has been passed, since this is not a warning surface — the warning cards are.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/ui/nutrientBar.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/NutrientBar.tsx tests/ui/nutrientBar.test.tsx
git commit -m "feat: a ceiling renders as a limit, never as a target to reach"
```

---

### Task 3: The profile carries body composition and a goal

**Files:**
- Modify: `src/types/profile.ts`, `src/data/exportImport.ts`
- Test: `tests/data/exportImport.test.ts`

**Interfaces:**
- Produces: `Profile` gains `bodyFatPct?: number` and `goal?: Goal`, where
  `export type Goal = { kind: 'lose' | 'hold' | 'gain'; rateKgPerWeek?: number }`.

- [ ] **Step 1: Write the failing test**

```ts
test('export and import carry body fat and the goal', async () => {
  await putProfile({ ...baseProfile, bodyFatPct: 23, goal: { kind: 'lose', rateKgPerWeek: 0.5 } });
  const file = await exportEverything();
  await eraseEverything();
  await importEverything(file);
  const p = await getProfile();
  expect(p?.bodyFatPct).toBe(23);
  expect(p?.goal).toEqual({ kind: 'lose', rateKgPerWeek: 0.5 });
});

test('an import with no goal leaves it absent, not defaulted to hold', async () => {
  // Absent means unknown. A profile that never stated a goal has not chosen to hold steady.
});
```

- [ ] **Step 2: Run it and watch it fail.** `npx vitest run tests/data/exportImport.test.ts`

- [ ] **Step 3: Add the fields and carry them through export/import validation**

Both optional. Follow the existing validation style in `exportImport.ts`: a value that is not a finite number, or a `kind` outside the union, is dropped rather than imported.

- [ ] **Step 4: Run it and watch it pass.**

- [ ] **Step 5: Commit**

```bash
git add src/types/profile.ts src/data/exportImport.ts tests/data/exportImport.test.ts
git commit -m "feat: the profile can hold a body-fat percentage and a weight goal"
```

---

### Task 4: Protein from the two verified sources

**Files:**
- Modify: `src/domain/targets.ts`
- Test: `tests/domain/targets.test.ts`

**Interfaces:**
- Consumes: `Goal` from Task 3.
- Produces: `Targets.proteinG` and `Targets.proteinFloorG` keep their names and types. `Targets` gains
  `basis: { protein: 'efsa-pri' | 'issn-range'; energy: 'mifflin' | 'katch-mcardle'; expenditure: 'formula' | 'reported' | 'observed' }`.
  Later tasks and later plans read `basis`.

- [ ] **Step 1: Write the failing test**

```ts
test('the floor is EFSA\'s PRI for any adult', () => {
  // 0.83 g/kg. For an 80 kg adult: 66 g.
  expect(computeTargets(profileAt(80, 'sedentary'), on).proteinFloorG).toBe(66);
});

test('a sedentary adult\'s target is the EFSA PRI, not a sports figure', () => {
  const t = computeTargets(profileAt(80, 'sedentary'), on);
  expect(t.proteinG).toBe(66);
  expect(t.basis.protein).toBe('efsa-pri');
});

test('an adult who exercises gets the ISSN range, positioned at its middle when holding', () => {
  // 1.7 g/kg of 80 kg = 136 g.
  const t = computeTargets(profileAt(80, 'moderate', { kind: 'hold' }), on);
  expect(t.proteinG).toBe(136);
  expect(t.basis.protein).toBe('issn-range');
});

test('losing weight moves protein to the top of the range whose basis is stated', () => {
  // 2.0 g/kg of 80 kg = 160 g. NOT 2.3-3.1: see the spec.
  expect(computeTargets(profileAt(80, 'moderate', { kind: 'lose' }), on).proteinG).toBe(160);
});

test('the floor never exceeds the target', () => {
  for (const a of ACTIVITY_LEVELS) {
    const t = computeTargets(profileAt(80, a), on);
    expect(t.proteinFloorG).toBeLessThanOrEqual(t.proteinG);
  }
});
```

- [ ] **Step 2: Run it and watch it fail.** `npx vitest run tests/domain/targets.test.ts`

- [ ] **Step 3: Implement the protein derivation in `derive()`**

Floor is always `0.83 × weightKg`. Target is `0.83 × weightKg` when `activityLevel === 'sedentary'` (EFSA's general-population value, because the ISSN range is stated for exercising individuals and the app must not assume someone trains), otherwise the ISSN range positioned by goal: `lose` → 2.0, `hold` and `gain` → 1.7, and no goal → 1.7. Replace the existing `1.2`/`0.8` constants and the comment calling them the app's own working figures.

- [ ] **Step 4: Run it and watch it pass.**

- [ ] **Step 5: Record both figures in the design document's Verification log, then commit**

```bash
git add src/domain/targets.ts tests/domain/targets.test.ts docs/superpowers/specs/2026-11-16-targets-weight-and-daily-health-design.md
git commit -m "feat: protein targets from EFSA's PRI and the ISSN range, replacing two unsourced numbers"
```

---

### Task 5: Resting metabolism from body composition

**Files:**
- Modify: `src/domain/targets.ts`
- Test: `tests/domain/targets.test.ts`

**Interfaces:**
- Produces: `Targets.basis.energy` is `'katch-mcardle'` when a usable body-fat percentage was present, else `'mifflin'`.

- [ ] **Step 1: Write the failing test**

```ts
test('a usable body-fat percentage switches the resting rate to Katch-McArdle', () => {
  // 370 + 21.6 x lean kg. 80 kg at 25% fat = 60 kg lean -> 370 + 1296 = 1666.
  const t = computeTargets({ ...profileAt(80, 'light'), bodyFatPct: 25 }, on);
  expect(t.rmrKcal).toBe(1666);
  expect(t.basis.energy).toBe('katch-mcardle');
});

// Review Focus 1.
test.each([0, -5, 95, 100, Number.NaN, Number.POSITIVE_INFINITY])(
  'an implausible body-fat percentage (%s) is ignored, not used', (bad) => {
    const t = computeTargets({ ...profileAt(80, 'light'), bodyFatPct: bad as number }, on);
    expect(t.basis.energy).toBe('mifflin');
    expect(t.rmrKcal).toBe(computeTargets(profileAt(80, 'light'), on).rmrKcal);
  },
);
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement**

Accept a body-fat percentage only in a plausible adult range — choose the bounds, state them in a comment, and reject anything outside. Lean mass is `weightKg × (1 − pct/100)`; RMR is `370 + 21.6 × leanKg`. Everything downstream of `rmr` is unchanged.

- [ ] **Step 4: Run it and watch it pass.**

- [ ] **Step 5: Commit**

```bash
git add src/domain/targets.ts tests/domain/targets.test.ts
git commit -m "feat: resting metabolism from lean mass when body composition is known"
```

---

### Task 6: The goal moves energy, and moves the figures whose sources follow intake

**Files:**
- Modify: `src/domain/targets.ts`
- Test: `tests/domain/targets.test.ts`, `tests/rules/goalTargets.test.ts` (create)

**Interfaces:**
- Produces: `Targets.energyKcal` reflects the goal. `Targets.goalCapped?: true` when the requested rate was reduced.

- [ ] **Step 1: Write the failing test**

```ts
test('a deficit shifts energy by rate x 7700 / 7', () => {
  const hold = computeTargets(profileAt(80, 'light', { kind: 'hold' }), on).energyKcal;
  const lose = computeTargets(profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 0.5 }), on).energyKcal;
  expect(hold - lose).toBe(Math.round((0.5 * 7700) / 7)); // 550
});

// Review Focus 2.
test('the energy target never falls below the resting rate, and says when it was capped', () => {
  const t = computeTargets(profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 5 }), on);
  expect(t.energyKcal).toBeGreaterThanOrEqual(t.rmrKcal);
  expect(t.goalCapped).toBe(true);
});

// Review Focus 3.
test('a goal does not adjust generic targets', () => {
  const t = computeTargets({ ...emptyProfile, goal: { kind: 'lose', rateKgPerWeek: 0.5 } }, on);
  expect(t.isGeneric).toBe(true);
  expect(t.energyKcal).toBe(computeTargets(emptyProfile, on).energyKcal);
});

// Spec 8.1.1 - this is the contradiction the builder check found.
test('the shares of energy follow the goal; the absolute figures never move', () => {
  const hold = computeTargets(profileAt(80, 'light', { kind: 'hold' }), on);
  const lose = computeTargets(profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 0.5 }), on);
  expect(lose.satFatG).toBeLessThan(hold.satFatG);
  expect(lose.addedSugarsG).toBeLessThan(hold.addedSugarsG);
  expect(lose.transFatG).toBeLessThan(hold.transFatG);
  expect(lose.fibreG).toBeLessThanOrEqual(hold.fibreG);
  expect(lose.sodiumMg).toBe(hold.sodiumMg);
  expect(lose.micronutrients).toEqual(hold.micronutrients);
});
```

And in `tests/rules/goalTargets.test.ts`, that the engine sees the moved figures:

```ts
test('a sodium card fires at the same point whether or not a goal is set', () => { /* ... */ });
test('an added-sugar card fires earlier under a deficit, because 10% of a smaller intake is less', () => { /* ... */ });
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement**

Compute maintenance energy first, then the goal offset, then derive the energy-share figures from the *adjusted* energy. The cap is the app's own choice: pick it, and write a comment saying it is the app's choice and not a published figure, in the style of the `THRESHOLDS` comment in `ultraProcessed.ts`. The floor is the resting rate.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/domain/targets.ts tests/domain/targets.test.ts tests/rules/goalTargets.test.ts
git commit -m "feat: a weight goal moves energy and the figures whose sources follow intake"
```

---

### Task 7: Setting the goal, in both directions

**Files:**
- Modify: `src/ui/screens/ProfileSettings.tsx`
- Test: `tests/ui/profileSettings.test.tsx`

**Interfaces:**
- Consumes: `Goal` (Task 3), `computeTargets` (Tasks 4–6).

- [ ] **Step 1: Write the failing test**

```ts
test('choosing a rate shows the daily deficit it needs', async () => {
  // 0.5 kg/week -> about 550 kcal a day.
});

test('entering a daily deficit shows the rate it implies', async () => {
  // 700 kcal a day -> about 0.64 kg a week. Both directions, one conversion.
});

test('a body-fat percentage can be left blank and nothing breaks', async () => {});

// Review Focus 4.
test('a manual override wins and is labelled as the person\'s own figure', async () => {
  // profile.overrides.energyKcal is applied last by computeTargets; the screen must not
  // explain that number as WHO's or as the goal's.
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement the goal section**

Three choices plus an optional rate, an optional body-fat field, and the two-way conversion from spec §8.1. The conversion is one function used in both directions so the two readings can never disagree. Show the 7,700 kcal/kg figure on screen. State which basis each target used, from `Targets.basis`.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/ProfileSettings.tsx tests/ui/profileSettings.test.tsx
git commit -m "feat: set a weight goal, and see the deficit and the rate it implies"
```

---

### Task 8: The screens stop saying "target" for a ceiling

**Files:**
- Modify: `src/ui/screens/Missing.tsx`
- Test: `tests/ui/missing.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2. `TODAY_BARS` passes `secondMark` for added sugars (`addedSugarsIdealG`) and protein (`proteinFloorG`).

- [ ] **Step 1: Write the failing test**

```ts
test('no ceiling on the screen is described as a target', async () => {
  // Render with a logged day, then assert over the whole screen, not one bar:
  // for each of sodium, saturated fat and added sugars, its block never matches /target/i.
});

test('the weekly gap list never names a ceiling', async () => {
  // It already only iterates MICRO_ORDER; this pins it so a later edit cannot widen it.
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Pass `secondMark` and update any prose on the screen that frames a ceiling as a shortfall**

The heading and the "Worth a look" framing stay; they are about floors, which is correct. Change only what describes a ceiling.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Full verification, then commit**

Run: `npm test`, `npx tsc --noEmit`, `npm run build` — all must pass.

```bash
git add src/ui/screens/Missing.tsx tests/ui/missing.test.tsx
git commit -m "fix: the app no longer asks its user to reach a sodium limit"
```

---

## After this plan

Phases 3–7 of the spec get their own plans, in the spec's order: hand corrections, daily health data, the diary rebuild, the weight page, the weekly copy and reminder. The weight page depends on `Targets.basis.expenditure`, defined in Task 4 and carrying only `'formula'` until the daily health data plan adds the other two.
