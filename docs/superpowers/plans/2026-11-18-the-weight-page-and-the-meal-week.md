# The Weight Page and the Meal Week — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the owner which way his weight is going and why, with the arithmetic in the open and the scale given the last word, and show which meal is thin across the week rather than only today.

**Architecture:** Three pure domain modules — the measured trend, the projection, the energy arithmetic — each testable without a screen, then one view that assembles them inside the Trends tab. The weight entry form moves out of `Missing` into that view. The per-meal week reuses `mealTotals` over the seven days the trends screen already reads.

**Tech Stack:** Vite 5, React 18, TypeScript strict (`noUncheckedIndexedAccess`), Tailwind, Vitest + @testing-library/react + jsdom + fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-11-16-targets-weight-and-daily-health-design.md` §8.5 (the whole section is binding), §7.1 and §7.2 (where the energy and the projection figures come from, and what was rejected), amended by `docs/superpowers/specs/2026-11-17-navigation-and-the-day-amendment.md` §A2.3 — the weight view lives **inside the Trends tab**, not on a destination of its own.

## Global Constraints

- **An absent figure means UNKNOWN, never zero.** A day with no entries is not a day of zero energy; a week with no weigh-in is not a week of no change.
- **Every figure shown carries its source.** The 7,700 kcal/kg conversion is printed on the page. Any threshold this plan invents — how many weigh-ins are enough, what counts as holding steady, how wide the band is — is labelled on screen as this app's own working figure, not a published one.
- **The scale has the last word.** Where the arithmetic and the measured trend disagree, the measured rate governs the projection and the page says they disagree. The arithmetic never overrides the scale (§8.5).
- **Where logging is patchy, say so** rather than averaging over days that were never logged.
- **No claim of causation.** "What contributed" is arithmetic about energy and says so; no entry is said to have caused a weight change.
- **A screen must never claim something the code does not do.** Seven review rounds across this project have been spent on this one defect.
- No new dependency — the trend line is inline SVG like the existing one. TypeScript strict. Phone-first at 375 px, 44 px targets, a `dark:` pair on every colour.
- No secret or personal profile value (name, date of birth, height, weight) in any committed file — the repository is public and `scripts/check-no-secrets.sh` runs as `pretest`. **Weight is a profile value: fixtures use synthetic figures.**
- Commits: lower-case `feat:` / `fix:` / `test:`, behaviour in plain words, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

1. **Two weigh-ins a day apart imply a rate of ±20 kg a week.** Any direction or projection drawn from too few points over too short a span is noise presented as fact. *(Task 1)*
2. **A weigh-in entered twice for one day, or out of order.** The log is keyed by date and sorted by the UI; the domain must not assume either. *(Task 1)*
3. **The arithmetic averaged over days with no entries** reads as a huge deficit and would project dramatic loss from a week of not logging. *(Task 3)*
4. **Division by zero and absent inputs** — no weigh-ins, one weigh-in, no expenditure figure, no profile at all. Each must produce a sentence, never `NaN`, `Infinity` or a blank. *(Tasks 1-3)*
5. **The projection read as a measurement.** A band that looks like the line, or a figure quoted to a precision the data cannot support, invites someone to plan around a number that is a guess. *(Task 2)*

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/weightTrend.ts` *(new)* | the measured trend: direction, rate, how confident, and the gate |
| `src/domain/weightProjection.ts` *(new)* | the forward band, capped at twelve weeks |
| `src/domain/energyBalance.ts` *(new)* | intake vs expenditure, as a daily balance and as a rate |
| `src/ui/screens/WeightView.tsx` *(new)* | the view: the sentence, the line, the band, the arithmetic, what contributed, the entry form |
| `src/ui/components/WeightChart.tsx` *(new)* | the inline SVG: logged points, smoothed line, projection band |
| `src/ui/screens/TrendsTab.tsx` | gains the Weight view |
| `src/ui/screens/Missing.tsx` | loses `WeightPanel` |
| `src/ui/screens/WeekTrends.tsx` | gains the per-meal week |

---

### Task 1: Which way it is going

**Files:**
- Create: `src/domain/weightTrend.ts`
- Test: `tests/domain/weightTrend.test.ts`

**Interfaces:**
- Produces:
  - `export const MIN_WEIGH_INS = 3` — fewer than this says nothing.
  - `export const MIN_SPAN_DAYS = 14` — a rate over a shorter span is noise.
  - `export const HOLDING_KG_PER_WEEK = 0.1` — inside this, it is holding steady.
  - `export type WeightTrend = { kind: 'losing' | 'gaining' | 'holding'; kgPerWeek: number; spanDays: number; points: number; seKgPerDay: number } | { kind: 'unknown'; reason: 'none' | 'too-few' | 'too-short'; points: number; spanDays: number }`
  - `export function weightTrend(log: { date: string; kg: number }[], on: Date): WeightTrend`

**All three constants are this app's own choice** and the view must say so. They exist because two weigh-ins a day apart imply a rate of ±20 kg a week, which is water, not fat.

The rate comes from an ordinary least-squares fit over (day, kg), which gives both the slope and the standard error the projection needs. Do not hand-roll a different smoother; the fit is the smoothing.

Deduplicate by date keeping the last value, sort ascending, and ignore any row whose `kg` is not finite — the domain must not assume the caller sorted or deduplicated.

- [ ] **Step 1: Write the failing tests**

```ts
it('says nothing from an empty log, one weigh-in, or two a day apart', () => {
  // kind 'unknown' with reason 'none', 'too-few', 'too-short' respectively — never a rate
});
it('calls a steady fall losing, with the rate in kg per week', () => {
  // 80.0 -> 79.0 over 28 days, weekly points: losing, about -0.25 kg/week
});
it('calls a flat log holding even when the figures wobble', () => {
  // 80.0, 80.4, 79.7, 80.1 over 28 days: holding, |rate| < HOLDING_KG_PER_WEEK
});
it('keeps the last figure when a day was weighed twice', () => { /* Review Focus 2 */ });
it('does not care what order the log arrives in', () => { /* same input shuffled, same result */ });
it('ignores a row whose weight is not a number', () => {});
it('never returns NaN or Infinity', () => { /* every branch, including all-identical dates */ });
```

- [ ] **Step 2: Run them to verify they fail**
- [ ] **Step 3: Implement `weightTrend`**
- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Prove the gate discriminates** — drop `MIN_SPAN_DAYS` to 1, confirm the "two a day apart" test goes red, revert. Report which failed.
- [ ] **Step 6: Commit**

---

### Task 2: The projection

**Files:**
- Create: `src/domain/weightProjection.ts`
- Test: `tests/domain/weightProjection.test.ts`

**Interfaces:**
- Consumes: `WeightTrend` (Task 1).
- Produces:
  - `export const PROJECTION_WEEKS = 12` — the owner chose this cap.
  - `export const DAILY_FLUCTUATION_KG = 0.5` — the app's own figure for ordinary day-to-day variation, printed on screen as such.
  - `export type ProjectedWeek = { week: number; kg: number; lowKg: number; highKg: number }`
  - `export function weightProjection(trend: WeightTrend, latestKg: number): ProjectedWeek[]`

Empty for an `unknown` trend: nothing to project from, and a band with no line is worse than no band.

The band's half-width at week *w* is `DAILY_FLUCTUATION_KG + 1.96 × seKgPerDay × days`, so it widens with distance **and** with how much the person's own weigh-ins scatter. A tidy log gives a narrow band and a noisy one a wide band, which is the honest behaviour. 1.96 is the ordinary 95% figure and is named in the code; the 0.5 kg floor is this app's own and is named on screen.

- [ ] **Step 1: Write the failing tests**

```ts
it('projects nothing from an unknown trend', () => { /* [] */ });
it('runs twelve weeks and no further', () => { /* length 12, last week === 12 */ });
it('widens with distance', () => { /* band width strictly increases week on week */ });
it('widens more for a scattered log than a tidy one', () => { /* same slope, larger se -> wider */ });
it('follows the measured rate, not any other figure', () => { /* kg at week w === latest + rate*w */ });
it('never returns NaN', () => {});
```

- [ ] **Step 2-4: Run, implement, run**
- [ ] **Step 5: Commit**

---

### Task 3: The arithmetic, and the disagreement

**Files:**
- Create: `src/domain/energyBalance.ts`
- Test: `tests/domain/energyBalance.test.ts`

**Interfaces:**
- Produces:
  - `export const KCAL_PER_KG = 7700` — printed on screen, never a black box.
  - `export const BALANCE_WINDOW_DAYS = 14`
  - `export const MIN_COMPLETE_DAYS = 8` — below this it says logging is patchy and gives no average.
  - `export type EnergyBalance = { kind: 'patchy'; completeDays: number } | { kind: 'known'; completeDays: number; intakeKcal: number; expenditureKcal: number; basis: Targets['basis']['expenditure']; balanceKcal: number; impliedKgPerWeek: number }`
  - `export function energyBalance(days: DayTotals[], expenditureKcal: number, basis: Targets['basis']['expenditure'], on: Date): EnergyBalance`

A day counts as complete only when its energy figure is one the app can vouch for — `completeDayValue(day, 'energyKcal')` already decides exactly this and must be reused, not reimplemented. **That is what stops Review Focus 3**: a day with no entries is absent from the average rather than counted as zero.

`impliedKgPerWeek` is `balanceKcal × 7 / KCAL_PER_KG`. The spec's worked examples are the test's expected values: 300 kcal/day ≈ 0.27 kg/week, 700 ≈ 0.64, and 1 kg/week needs ≈ 1,100 kcal/day.

- [ ] **Step 1: Write the failing tests**

```ts
it('says logging is patchy below eight complete days, and gives no average', () => {});
it('leaves an unlogged day out of the average rather than counting it as zero', () => {
  // Review Focus 3: 10 days at 2,000 and 4 days with no entries -> intake 2,000, not 1,429
});
it('matches the figures the design states', () => {
  // -300 -> ~0.27 kg/week lost; -700 -> ~0.64; -1100 -> ~1.0
});
it('reports a surplus as gaining', () => {});
it('never divides by zero', () => {});
```

- [ ] **Step 2-4: Run, implement, run**
- [ ] **Step 5: Prove the false-zero guard discriminates** — count every day in the window, confirm the Review Focus 3 test goes red, revert.
- [ ] **Step 6: Commit**

---

### Task 4: The chart

**Files:**
- Create: `src/ui/components/WeightChart.tsx`
- Test: `tests/ui/weightChart.test.tsx`

**Interfaces:**
- Consumes: `ProjectedWeek` (Task 2).
- Produces: `export default function WeightChart({ log, projection }: { log: { date: string; kg: number }[]; projection: ProjectedWeek[] })`.

An inline SVG with `role="img"` and an `aria-label` that states in words what the picture shows, because a line is unreadable to a screen reader. **The projection must not look like the line**: the measured line is solid, the projection band is a hatched or faded area with a dashed centre, and the chart carries a visible label saying the shaded part is an estimate, not a measurement.

- [ ] **Step 1: Write the failing tests**

```tsx
it('draws a point per logged weight', () => {});
it('describes itself in words for a screen reader', () => { /* aria-label naming span and direction */ });
it('marks the projection as an estimate, visibly and in the label', () => { /* Review Focus 5 */ });
it('draws no band when there is no projection', () => {});
it('survives a single weigh-in without an axis of zero width', () => {});
```

- [ ] **Step 2-4: Run, implement, run**
- [ ] **Step 5: Commit**

---

### Task 5: The Weight view

**Files:**
- Create: `src/ui/screens/WeightView.tsx`
- Modify: `src/ui/screens/TrendsTab.tsx`, `src/ui/screens/Missing.tsx`
- Test: `tests/ui/weightView.test.tsx`

**Interfaces:** consumes everything above. Order on screen, from §8.5: the sentence, the line and band, the arithmetic block, what contributed, then the entry form.

- **The sentence** names the direction and the rate, or says plainly why it cannot yet — "three weigh-ins across two weeks" rather than silence.
- **The arithmetic block** prints: average logged intake, the expenditure figure *and which of the three sources it came from*, the balance, the balance as a rate, and the 7,700 kcal/kg conversion.
- **Implied beside measured, with the disagreement stated.** When they differ by more than a small margin the page says so plainly — the logging may be incomplete, or the expenditure figure too high, or both — and says the scale governs the projection. It must not pick a winner beyond that.
- **What contributed:** the entries carrying the most energy over the window, as a plain list, labelled as arithmetic about energy with no claim any of them caused anything.
- `WeightPanel` moves here from `Missing` unchanged; delete it there rather than leaving both.

- [ ] **Step 1: Write the failing tests**

```tsx
it('says why it cannot name a direction yet, rather than saying nothing', () => {});
it('names the direction and the rate once there are enough weigh-ins', () => {});
it('prints the conversion it used', () => { /* 7,700 kcal on screen */ });
it('names which of the three sources the expenditure figure came from', () => {});
it('states the disagreement when implied and measured differ, and says the scale governs', () => {});
it('says logging is patchy rather than averaging days it cannot see', () => {});
it('calls what contributed arithmetic about energy and claims no cause', () => {});
it('still saves a weight, as the panel did on the old screen', () => {});
```

- [ ] **Step 2-4: Run, implement, run the whole UI suite**
- [ ] **Step 5: Commit**

---

### Task 6: Each meal across the week

**Files:**
- Modify: `src/ui/screens/WeekTrends.tsx`
- Test: `tests/ui/mealWeek.test.tsx`

Each slot's average across the seven days the screen already reads, so "breakfast is short on protein most days" is visible rather than inferable from seven separate days (§A2.3 item 3).

Reuse `mealTotals` per day; average over the days that **have** that slot logged, and say how many those were. A slot logged on two days of seven is not an average over seven.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows an average per slot with the number of days behind it', () => {});
it('averages over the days a slot was logged, not over seven', () => { /* the false-zero trap again */ });
it('says nothing for a slot never logged, rather than zero', () => {});
```

- [ ] **Step 2-4: Run, implement, run**
- [ ] **Step 5: Commit**

---

## Self-review

**Spec coverage.** §8.5's five numbered contents map to Tasks 1-5: the sentence (1, 5), the line (4), the projection (2, 4), the arithmetic with the conversion and the implied-versus-measured disagreement (3, 5), what contributed (5). The weight form's move and `Missing` losing it: Task 5. §A2.3's per-meal week: Task 6. §A2.3 put the view inside Trends rather than on its own destination, which is why no task touches the nav.

**Not in this plan:** the gap list's restriction to floors (§8.5's third table row) — `Missing` already shows only floors in its gap section, so there is nothing to do; if a reviewer finds a ceiling in that list, it is a defect to raise, not work this plan dropped. The DeepSeek addendum has its own plan.

**Type consistency.** `WeightTrend` is produced in Task 1 and consumed in Tasks 2, 4 and 5 under that name; `ProjectedWeek` in 2 and consumed in 4 and 5; `EnergyBalance` in 3 and consumed in 5. `completeDayValue` and `mealTotals` are existing exports and are reused, not reimplemented.

**Review Focus.** All five have named tests in the owning task — 1 and 2 in Task 1, 3 in Task 3, 4 across Tasks 1-3, 5 in Task 4 — and Tasks 1 and 3 carry discrimination checks, because a rate drawn from noise and an average over days nobody logged are the two ways this page could confidently mislead someone about their own body.

**Proportion.** Six tasks over one spec section. The only code in the plan is test names and assertions; every value a builder could not infer — three gates, the holding band, the fluctuation floor, 1.96, 7,700, twelve weeks, the window and its minimum — is stated once, with the reason it is that number and whether it is published or the app's own.
