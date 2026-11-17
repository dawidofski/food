# Navigation, the Food Merge and the Weekly Copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four icons instead of six words, logging from a button that floats over every screen but Settings, Batches and My foods on one page, Progress renamed Trends, and the diary's backup offer arriving weekly as the owner asked rather than monthly.

**Architecture:** `App.tsx` owns the nav and gains an overlay slot; the Log screen moves from a tab into a dialog rendered above whatever tab is open. `Progress.tsx` is renamed to the Trends tab and its inner view that is itself called "Trends" is renamed to avoid two things called the same thing. A new `Food.tsx` holds Batches and My foods as two tabs, exactly as `Progress.tsx` already holds three.

**Tech Stack:** Vite 5, React 18, TypeScript strict (`noUncheckedIndexedAccess`), Tailwind, Vitest + @testing-library/react + jsdom + fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-11-17-navigation-and-the-day-amendment.md` §A2.3, §A2.4, §A2.5, §A2.6 steps 6 and 8, governed by `docs/superpowers/specs/2026-11-16-targets-weight-and-daily-health-design.md` (§4 anti-goals, §5 constraints, §7.3 icon-only, §8.6 the weekly copy, §8.7 navigation).

## Global Constraints

- **The warning gate is untouched and food is never silently added.** The overlay hands off to the same flow; nothing about resolution, warnings or confirmation changes (§4).
- **An absent nutrient key means UNKNOWN, never zero.** No screen in this plan computes a figure, but none may print a `0` for a missing one either.
- **Every figure shown carries its source**; an unsourced threshold is labelled as the app's own choice. A figure the person typed is theirs and never gets a source.
- **A screen must never claim something the code does not do.** In this plan that bites hardest on the backup wording: the app knows it *built a file and handed it over*, never that a backup exists (see `src/state/backupReminder.ts`'s header).
- **Icon-only navigation**, the owner's explicit choice (§7.3). Every control keeps an `aria-label` and a 44 px target; nothing is lost to a screen reader or a thumb.
- No new dependency — icons are inline SVG, not a package. TypeScript strict. Phone-first at 375 px with a `dark:` pair on every colour.
- No secret, API key, or personal profile value (name, date of birth, height, weight) in any file — the repository is public and `scripts/check-no-secrets.sh` runs as `pretest`.
- Commits: lower-case `feat:` / `fix:` / `test:` / `docs:`, behaviour in plain words. End each message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

1. **The overlay traps someone.** A dialog that the Android back gesture cannot close, or that returns focus nowhere, strands a person mid-entry. *(Task 2)*
2. **Logging loses what was typed.** Closing or reopening the overlay, or a tab change behind it, discarding a part-typed entry or a pending warning gate. *(Task 2)*
3. **An icon nobody can name.** A control whose accessible name is empty or is the word "button" leaves a screen-reader user with four unlabelled targets — the diary's day strip already has this defect. *(Task 1)*
4. **Two things called Trends.** The tab and one of its inner views share a name today; renaming one and not the other leaves a person unable to say where something is. *(Task 3)*
5. **The weekly offer becomes nagging, or claims too much.** Offering every week is what was asked for; saying or implying the data is now safe is forbidden. *(Task 5)*

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/components/NavIcon.tsx` *(new)* | the five inline SVGs, each with its label |
| `src/ui/components/LogOverlay.tsx` *(new)* | the dialog that holds the Log screen, its focus trap and its dismissal |
| `src/ui/screens/Food.tsx` *(new)* | Batches and My foods as two tabs |
| `src/ui/screens/Progress.tsx` → `src/ui/screens/TrendsTab.tsx` | the renamed tab, with its inner views renamed |
| `src/ui/screens/Trends.tsx` → `src/ui/screens/WeekTrends.tsx` | the inner weekly-nutrient view, renamed out of the collision |
| `src/App.tsx` | four tabs, the floating button, the overlay slot |
| `src/state/backupReminder.ts` | the offer's cadence |

---

### Task 1: The nav becomes four icons

**Files:**
- Create: `src/ui/components/NavIcon.tsx`
- Modify: `src/App.tsx`
- Test: `tests/ui/nav.test.tsx` (new)

**Interfaces:**
- Produces: `export type NavIconName = 'diary' | 'trends' | 'food' | 'settings' | 'log'`; `export default function NavIcon({ name }: { name: NavIconName })` — an inline `<svg>` with `aria-hidden="true"`, because the label lives on the control.

The four tabs are Diary, Trends, Food, Settings, in that order. The `log` icon belongs to Task 2's button and is defined here so every icon lives in one file.

- [ ] **Step 1: Write the failing test** in `tests/ui/nav.test.tsx`

```tsx
it('offers four destinations, each with a name a screen reader can read', () => {
  // getByRole('button', { name: 'Diary' }) for each of Diary, Trends, Food, Settings
  // and exactly four buttons inside the Main nav
});
it('marks the open tab and no other', () => { /* aria-current="page" on one only */ });
it('gives every nav control a 44 px target', () => { /* the min-h class the project already uses */ });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/ui/nav.test.tsx`
Expected: FAIL — the nav still has six text tabs.

- [ ] **Step 3: Build `NavIcon` and rewire `App.tsx`'s nav**

Each tab button keeps its visible label off-screen or as an `aria-label`; the icon carries no name of its own. Tailwind's `sr-only` is the project's existing way to keep a name without showing it — check whether it is already used before inventing another.

- [ ] **Step 4: Run the tests**

Run: `node node_modules/vitest/vitest.mjs run tests/ui/nav.test.tsx && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

---

### Task 2: Logging floats over everything but Settings

**Files:**
- Create: `src/ui/components/LogOverlay.tsx`
- Modify: `src/App.tsx`
- Test: `tests/ui/logOverlay.test.tsx` (new)

**Interfaces:**
- Consumes: `NavIcon` (Task 1).
- Produces: `export default function LogOverlay({ open, initialDraft, onClose }: { open: boolean; initialDraft: string; onClose: () => void })`.

The button is fixed bottom-right, above the nav, on every tab except Settings. The overlay renders `Log` unchanged inside a dialog.

**Requirements that a floating overlay usually gets wrong, all of them binding:**

- `role="dialog"` with `aria-modal="true"` and a name; focus moves into it on open and back to the button on close.
- Escape closes it, and so does the Android back gesture — a `popstate` entry pushed on open and consumed on close. Closing must not navigate the app away.
- It must not cover the last entry's controls on the Diary: the diary gains bottom padding the height of the button, not a smaller z-index.
- **Nothing typed is lost to a stray dismissal.** Decide and state in the code what closing does with a part-typed entry; if it discards, it says so first.
- The warning gate still runs inside it. Food is never silently added.

- [ ] **Step 1: Write the failing tests** in `tests/ui/logOverlay.test.tsx`

```tsx
it('opens from the button and puts focus inside', () => {});
it('closes on Escape and returns focus to the button', () => {});
it('closes on the back gesture without leaving the app', () => { /* dispatch popstate */ });
it('is offered on the diary, trends and food tabs and not on settings', () => {});
it('still runs the warning gate on an entry that triggers one', () => { /* Review Focus: never silently added */ });
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Build `LogOverlay` and mount it in `App.tsx`**

Remove the `log` tab. `BatchBuilder`'s `onLogPortion` currently switches to that tab with a draft — it now opens the overlay with the same draft, so the fridge-to-log path must keep working.

- [ ] **Step 4: Run the tests, plus the existing Log and batch suites**

Run: `node node_modules/vitest/vitest.mjs run tests/ui/ && npx tsc --noEmit`
Expected: PASS. Existing Log tests must pass unchanged; if one fails because the screen is now in a dialog, repoint it, never weaken it.

- [ ] **Step 5: Prove the gate test discriminates**

Make the overlay store without the gate, confirm that test goes red, revert. Report which failed.

- [ ] **Step 6: Commit**

---

### Task 3: Progress becomes Trends, and the name collision goes

**Files:**
- Rename: `src/ui/screens/Progress.tsx` → `src/ui/screens/TrendsTab.tsx`
- Rename: `src/ui/screens/Trends.tsx` → `src/ui/screens/WeekTrends.tsx`
- Modify: `src/App.tsx`, and every importer of the two
- Test: `tests/ui/trendsTab.test.tsx` (new); keep the existing trends and progress suites passing

The tab is **Trends**. Its inner views keep their current content and are named so that no two things share a name: the weekly nutrient view becomes **This week**, and the others keep **Worth a look** (today's `Missing`) and **Warning history**.

The weight form stays inside `Missing` for now; §8.5 moves it in the next plan, and moving it twice would be churn.

- [ ] **Step 1: Write the failing test** in `tests/ui/trendsTab.test.tsx`

```tsx
it('names the tab Trends and its views without repeating the word', () => {
  // the three view buttons, and no view whose accessible name is exactly "Trends"
});
it('opens on Worth a look', () => { /* the view that replaced the Missing screen */ });
```

- [ ] **Step 2: Run it to verify it fails**

- [ ] **Step 3: Do the renames and update every importer**

Use the file moves; do not copy-and-delete, so the history follows.

- [ ] **Step 4: Run the whole UI suite**

Run: `node node_modules/vitest/vitest.mjs run tests/ui/ && npx tsc --noEmit`

- [ ] **Step 5: Commit**

---

### Task 4: Batches and My foods become one page

**Files:**
- Create: `src/ui/screens/Food.tsx`
- Modify: `src/App.tsx`
- Test: `tests/ui/food.test.tsx` (new); keep the existing batches and my-foods suites passing

**Interfaces:**
- Produces: `export default function Food({ onLogPortion }: { onLogPortion: (text: string) => void })` — two tabs, Batches first, in the shape `TrendsTab` already uses for its views, so the two agree.

Neither screen's behaviour changes. `onLogPortion` passes straight through to `BatchBuilder`.

- [ ] **Step 1: Write the failing test** in `tests/ui/food.test.tsx`

```tsx
it('shows both tabs and opens on Batches', () => {});
it('switches to My foods without losing the batches list', () => {});
it('still hands a portion to the log overlay', () => { /* onLogPortion called with the portion's text */ });
```

- [ ] **Step 2: Run it to verify it fails**

- [ ] **Step 3: Build `Food.tsx` and point `App.tsx` at it**

- [ ] **Step 4: Run the whole UI suite**

- [ ] **Step 5: Commit**

---

### Task 5: The copy is offered weekly, as asked

**Files:**
- Modify: `src/state/backupReminder.ts`
- Test: `tests/state/backupReminder.test.ts` or wherever its tests live — find them first

The owner asked for a copy to his phone **each week**. The offer currently goes quiet for 30 days after one (`EXPORT_SILENCE_DAYS`). Change it to 7.

**What must not change**, and the reason, which belongs in the commit message: the app still never says a backup exists. It knows it built a file and handed it to the browser; the download may have been cancelled or deleted. `DISMISS_SILENCE_DAYS` stays at 7, so "not now" still means a week — the two being equal is fine and means a dismissal and an export silence it for the same span.

Check the nudge's on-screen wording after the change: if it names a period ("a month"), it is now false and goes in the same commit.

- [ ] **Step 1: Write the failing test**

```ts
it('offers again a week after a copy was made', () => {
  // 6 days after: not due. 7 days after: due. 30 is no longer the boundary.
});
```

- [ ] **Step 2: Run it to verify it fails**

- [ ] **Step 3: Change the constant, and any wording that names the old period**

- [ ] **Step 4: Run the suite**

- [ ] **Step 5: Commit**

---

## Self-review

**Spec coverage.** §A2.4's floating button and its five non-negotiable requirements → Task 2. §A2.5's Food merge → Task 4. §A2.3's rename → Task 3 (its *contents* are the next plan, as §A2.6 step 7 says). §7.3 and §8.7's icon-only nav with names and 44 px targets → Task 1. §8.6's weekly copy → Task 5, with the reminder half already struck by §A2.1.

**Not in this plan, deliberately:** the weight view, the per-meal weekly pattern and the gap list's move out of `Missing` — all §A2.6 step 7. Moving the weight form in Task 3 and again next plan would be churn for no gain.

**Type consistency.** `NavIconName` is defined in Task 1 and consumed in Task 2. `Food`'s `onLogPortion` signature matches the prop `BatchBuilder` already takes. `TrendsTab` and `WeekTrends` are used under those names in Tasks 3 and 4 and in `App.tsx`.

**Review Focus.** Each of the five has a named test in the task that owns it — 3 in Task 1, 1 and 2 in Task 2, 4 in Task 3, 5 in Task 5 — and Task 2's gate test carries a discrimination check, because an overlay that quietly bypasses the warning gate is the worst thing this plan could ship.

**Proportion.** Five tasks, no function bodies, and the only values pinned are the ones a builder cannot infer: the tab order, the view names that remove the collision, and 7 days.
