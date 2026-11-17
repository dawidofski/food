# Amendment 2 — navigation, and the shape of the day

Added 2026-11-17 at the owner's request, after phase 4 (daily health data) was built. Amends
`2026-11-16-targets-weight-and-daily-health-design.md`, which stays the governing document for everything this
file does not touch. Where the two disagree, this file wins.

Written after the owner used the app and asked, in his own words, why he could not pick breakfast or snack "so we
can see what we do good and what we dont do good", where the weight graph was, and for the log page to be "just a
button that opens it as overlay". The answers to the first two were "not built yet — §8.3 and §8.5"; this
amendment is the rest of it.

---

## What this supersedes

| In the main design | Now |
|---|---|
| §8.3's "Add food" composer at the foot of the Diary | a floating Log button, over every page except Settings |
| §8.3's day's-figures block, full detail | compact bars; the sourcing text behind a disclosure |
| §8.5's separate **Weight** page | the weight graph lives inside **Trends** |
| §8.5's "Progress tab" keeping its name | renamed **Trends** |
| §8.6's **daily reminder**, both mechanisms | **dropped entirely** |
| §8.7's six destinations: diary, weight, progress, batches, my foods, settings | four: diary, trends, food, settings — plus the floating Log button |
| §11's steps 5-7 | §A2.6 below |

Nothing else changes. §8.1, §8.1.1, §8.2 and §8.4 are untouched, as is every invariant in §5 and every
anti-goal in §4.

---

## A2.1 The daily reminder is dropped

The owner's answer was "leave it i dont need it", after being shown what a web page can and cannot do here. It is
recorded because the reasoning should not have to be rediscovered:

- Chrome's `TimestampTrigger` — a notification scheduled by the page to fire later, offline — was exactly the
  right mechanism. Google **ended development on it**; it never shipped past an origin trial in Chrome 80-83,
  because consistent behaviour across platforms could not be assured.
  <https://developer.chrome.com/docs/web-platform/notification-triggers>
- Periodic Background Sync requires the app installed to the home screen, is gated on a site-engagement score,
  is throttled to roughly two wake-ups a day, and its own documentation states it gives **no guarantee of when
  it runs**. It cannot hit a chosen time.
  <https://developer.chrome.com/docs/capabilities/periodic-background-sync>
- A scheduled GitHub Action pushing to the device would be a real notification, and was offered. It was refused
  on its merits, not its cost: this app keeps every figure on the phone, so a sender that cannot see the diary
  can only say "open the app" — which is what a phone alarm says, on time, offline, with nothing to expire. The
  push route also drifts five to twenty minutes, stops when the repository sits idle for sixty days, and breaks
  silently when site data is cleared.

**So §8.6's reminder section is struck.** Settings gains no time field. The weekly copy nudge in §8.6 survives
unchanged — it is a message shown when the app is open, which needs none of the above.

The in-app nudge is also **not** built as a separate feature: §A2.2's day's-figures block already shows blank
figures as blank, which is the same information in the place the owner is already looking.

## A2.2 The Diary, in the order the owner asked for

```
 Wed 11  Thu 12  Fri 13  Sat 14 [Sun 15] Mon 16  Tue 17     ← the date strip, unchanged

 ┌───────────────────────────────────────────────┐
 │ Energy     1,840 / 3,050 kcal   ▓▓▓▓▓▓░░░     │   floor-ish: a goal
 │ Protein      112 / 170 g        ▓▓▓▓▓▓░░░     │   floor
 │ Fibre         18 / 43 g         ▓▓▓░░░░░░     │   floor
 │ Sodium     1,900 mg  limit 2,000              │   CEILING — different shape
 │ Sat fat       21 g   limit 34                 │   ceiling
 │ Added sug     31 g   limit 76                 │   ceiling
 │                                               │
 │  ⌄ Where these figures come from              │   ← collapsed by default
 └───────────────────────────────────────────────┘

 ── Breakfast ──────────────── 320 kcal ─────────
      12 g protein · 4 g sat fat
    toast with jam                            ⋯
    coffee                                    ⋯

 ── Lunch ─────────────────────── 640 kcal ──────
      48 g protein · 7 g sat fat
    chicken salad                             ⋯

 ── Dinner ────────────────────── 880 kcal ──────
      52 g protein · 19 g sat fat
    pork belly, rice                          ⋯

 ── Snacks ──────────────────────────── — ───────

 ── Earlier ───────────────────── 210 kcal ──────   ← only when unslotted entries exist
    salad with olive oil                      ⋯

 ┌─ Your day ────────────────────────────────────┐
 │ Sleep score   —      Steps   8,412            │
 │ Energy burned 2,780 kcal                      │
 │ Weight        —                               │
 └───────────────────────────────────────────────┘

                                        ╭───────╮
                                        │   +   │   ← the floating Log button
                                        ╰───────╯
```

**The order is the owner's instruction, taken literally:** the day's figures sit under the date strip and above
the food; the food sits above sleep, steps and energy burned. The "Add food" block that §8.3 put at the foot of
this screen is gone — it is the floating button now (§A2.4).

**The day's figures are compact.** Bars and numbers only. The provenance text that the Missing screen prints in
full today — where the energy figure came from, EFSA's 0.83 g/kg, the ISSN range, WHO's limits, the fibre rule,
which figures are this app's own working choices — moves behind the `⌄ Where these figures come from` disclosure,
in full, losing not one sentence. This is the owner's choice between three options he was shown; he picked
compact-with-details-on-tap over printing it all and over trimming it to energy and protein.

The disclosure's contents come from the **one shared wording source** phase 4 built, not from a copy. §5's rule
stands: two screens never keep separate accounts of where a figure came from. The ceiling/floor distinction is
§8.1's and does not change.

**Meal slots.** Entries gain `meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'`. Each slot header carries **what
that slot contributed** — its energy, and its macros on the line beneath. That is the whole of what the owner
asked for by "see what we do good and what we dont do good": the figures per meal, so breakfast being
protein-light and dinner carrying the saturated fat are both visible at a glance. He was offered a version where
the app labelled each meal good, thin or heavy, and declined it — those cutoffs would have been the app's own
inventions, and §4's anti-goals forbid inventing authority.

A slot with nothing in it shows `—`, never `0`. §5's invariant is unchanged and applies here: an empty slot has
no figures, and a slot whose entries have no saturated-fat data cannot state a saturated-fat total.

**Existing entries keep their honesty.** Entries written before this change have no `meal`, and appear under
**Earlier** rather than being guessed into a slot from their timestamp. Guessing would rewrite history the owner
did not write. New entries default from the clock and are changeable before and after saving.

## A2.3 Trends — what Progress becomes

Renamed **Trends**, because that is what the owner calls it and what it holds. Its contents, in order:

1. **Weight** — §8.5's page, entire and unchanged in substance, as the first view here rather than as a
   destination of its own: which way it is going in a sentence, the line of logged weights with a smoothed
   trend, the twelve-week projection band drawn so it cannot be mistaken for measurement, the arithmetic block
   with the 7,700 kcal/kg conversion shown, the implied rate beside the measured rate with the disagreement
   stated plainly, and what contributed. **Every word of §8.5 still governs**, including that the measured rate
   governs the projection and the arithmetic never overrides the scale.
2. **Nutrients over the week** — the existing weekly trends.
3. **Each meal across the week** — the per-meal pattern: each slot's average for the week, so "breakfast is
   short on protein most days" is visible rather than inferable from seven separate days. This is the half of
   the owner's meal-slot request that the Diary cannot answer, and he chose it knowing it is more to build.
4. **Warning history** — unchanged.
5. **Worth a look** — Missing's weekly gap list, restricted to floors exactly as §8.5 specified. A day under its
   sodium ceiling was never a gap.

The weight graph going here rather than onto a page of its own follows the owner's "only have trends and warning
history": weight over time is a trend, and he asked for fewer pages, not more. **This is the one call in this
amendment made on his behalf** — if he wants Weight as its own destination, the nav has room for five.

Missing is then fully taken apart, as §8.5 intended: its day's figures to the Diary, its weight form to Trends'
weight view, its gap list to Trends.

## A2.4 The Log button floats

A single circular button, bottom-right, over **every page except Settings**, opening the composer as an overlay
rather than navigating. It replaces both the Log destination in the nav and §8.3's composer block at the foot of
the Diary.

Requirements that are not negotiable, because they are the ones a floating overlay usually gets wrong:

- The overlay is dismissible by the Android back gesture, and closing it loses nothing the owner typed.
- It traps focus while open, returns focus to the button on close, and is announced as a dialog.
- It never covers the thing it would obscure: on the Diary it must not sit over the last entry's row controls.
- **The warning gate is untouched.** The overlay hands off to the full Log screen for the resolution and warning
  flow, which is too tall to inline. Food is still never silently added — §4's first anti-goal.
- The button is 44 px or larger with an `aria-label`, like every other control (§7.3).

## A2.5 Food — one page, two tabs

Batches and My foods merge into a single destination, **Food**, with two tabs. No behaviour changes; this is one
destination where there were two, which is what pays for the nav being four icons wide.

## A2.6 Order of the remaining work

Replaces §11's steps 5-7. Step 4 (daily health data) is built and under final review as this is written.

5. **The Diary becomes the day** — meal slots, the day's figures as compact bars, the disclosure, the order
   above. The largest piece, and the one the owner feels every day.
6. **Navigation** — icon-only nav, the floating Log button and its overlay, the Food merge, the Trends rename.
   Ships the shape; Trends' new contents arrive in 7.
7. **Trends' contents** — the weight view (§8.5 entire), and each meal across the week.
8. **Weekly copy** — §8.6's export nudge, with the reminder struck.

Each step ships working software on its own. 5 before 6 because the nav rename is cheap once the Diary owns the
day's figures; 6 before 7 because Trends must exist before §8.5's content moves into it.

## A2.7 Left to the builder

Unchanged from §10, plus: the disclosure's open/closed state is a per-device convenience and may live in
`localStorage` under the `fd.` prefix; the per-meal weekly averages reuse the existing trends gate rather than
inventing a new minimum; and the slot order is breakfast, lunch, dinner, snacks, with Earlier last.

---

# A3. The share limits follow the energy target shown

Added 2026-11-17, after the owner was shown the mismatch on his own screen and asked to decide it. This
supersedes §8.1.1 of the governing design for the typed-energy case.

## What was wrong

§8.1.1 ruled that the share-of-energy limits — saturated fat, added sugars (both figures), trans fat and fibre —
follow the **goal-adjusted** energy, while absolute figures (protein, sodium, micronutrients) never move. That
was right as far as it went, but it was written before a person could type their own energy figure, and
`computeTargets` overlays only the keys the person typed. So a typed figure replaced the energy target and left
the five limits as shares of a number the same screen said had been replaced.

Seen live, at a typed 2,000 kcal with a lose-0.5 kg/week goal: the energy target read **2,000** and the
saturated-fat limit read **24 g**, which is 10% of **2,163** — the calculated, goal-adjusted figure. Nothing on
screen was false, because the note said which energy the limits came from, but the two numbers sat together
needing a paragraph to explain them.

## The rule now

**The share-derived limits are always shares of the energy target shown.** One sentence, no exceptions, nothing
to explain. Where the energy target came from no longer changes how the limits relate to it:

| Energy target | Where it comes from | The five limits |
|---|---|---|
| calculated | resting rate × activity factor | shares of it |
| calculated, goal-adjusted | …less the goal offset | shares of it |
| reported | the mean of the person's own burn figures, goal-adjusted | shares of it |
| **typed** | **the person's own figure** | **shares of it** |

Only the last row changes. The first three already behaved this way.

**Absolute figures still never move**: protein stays per kilogram of body weight, sodium stays WHO's 2,000 mg,
micronutrients stay the reference intakes. §8.1.1's distinction between share figures and absolute figures is
unchanged and is the reason this amendment is small.

**A limit the person typed themselves still wins.** Someone who sets both an energy figure and a saturated-fat
figure keeps their saturated fat: the recomputed shares are applied first and the person's own overrides on top
of them. Their own number is never recalculated out from under them.

**The fibre floor stands.** It is `max(30, 14 g per 1,000 kcal)`, and the floor applies after the share, exactly
as it does on every other path — a low energy target does not drop the fibre target below 30 g.

## What this costs, stated plainly

A low typed figure now tightens four limits, so warnings that did not fire before can fire. That is the
behaviour the rule asks for — a limit that is 10% of an energy figure should be 10% of the figure being used —
and it is the owner's decision, made with the numbers in front of him.

The one formula must exist in a single place and be read by both the first calculation and the override merge.
Two copies would drift, and a drifting share formula is the defect this project has spent four review rounds on.

## The wording that must change with it

Two sentences become false the moment this ships and must go in the same change:

- The Missing screen's clause saying the limits "were worked out from the energy the app calculated rather than
  from your own figure" — it is now the opposite, and the clause has nothing left to say, so it goes rather than
  being reworded.
- The Settings line "Your own energy figure replaces your energy target but not those limits" — it now replaces
  both. The surrounding sentence about a goal having already moved them stays true where no energy figure was
  typed.

---

# A4. The meal slot is chosen after saving, not before

Decided 2026-11-17, when the owner was shown what had been built and what had not.

§A2.2 inherited "changeable before and after saving" from §8.3. Only *after* was built: an entry takes the
clock's suggestion when it is stored, and the entry screen — one tap from the diary — offers the four slots to
change it.

Offered the missing half, the owner answered that tapping the entry is fine. **So this is the design, not a
shortfall.** The reasons it is a good one:

- The logging flow ends at the warning gate, which is a warning surface. An unrelated control there competes
  with the one thing that screen exists to say.
- Nothing is derived from a slot: no figure, no target, no warning. A slot that is briefly wrong costs a tap and
  changes nothing the app tells anyone.
- The clock's suggestion is right most of the time, and `MEAL_DEFAULT_FROM` is tuned for someone eating in Spain
  rather than to a textbook.

The boundaries remain this app's own working times, said on screen as such, and `mealFromClock` remains a
suggestion that only ever becomes an entry's slot once it has been stored and can be changed.
