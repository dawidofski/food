# Design — honest targets, a weight page, daily health data, and a diary you can live in

Date: 2026-11-16. Status: approved in conversation, pending the written approval gate.

This document contains no personal profile values. Worked examples use an 80 kg adult and are illustrative only.

## 1. Why this work exists

The owner reported three things, and all three are the app's fault rather than his.

**The app has been telling him to eat more salt.** `NutrientBar` labels every nutrient `target N unit`, and the
Missing screen frames every shortfall as a gap worth closing. That is right for protein, fibre and the
micronutrients, which are floors. It is wrong for sodium, saturated fat and added sugars, which are **ceilings**.
A person reading the sodium bar at 1,400 of 2,000 mg sees 600 mg still "to get". The screen's whole grammar —
"what's missing", "worth a look" — pushes the same way. This is the app actively misinforming its only user about
the three nutrients its warning engine exists to limit.

**The protein target is a number nobody sourced.** `targets.ts` uses `proteinG = 1.2 × weightKg` and
`proteinFloorG = 0.8 × weightKg`. The build log already lists these under known limits: "fibre and protein targets
are unsourced numbers shown beside a carefully-cited EFSA section." The owner trains and eats well above that
figure, so the app has been showing him a target he clears before breakfast, which teaches him to ignore it.

**The app cannot answer the question he actually has.** It holds a `weightLog` and never draws it. It cannot say
whether he is losing, gaining or holding steady, which is the one thing a food diary ought to be able to tell
someone.

Around those, he asked for the diary to become the page he uses daily: meals grouped, the day's figures visible
without changing screen, logging from the same page, his own health data alongside, and a weekly copy of it all.

## 2. Goals

1. A ceiling reads as a ceiling and a floor reads as a floor, everywhere a figure appears.
2. Targets rest on cited evidence and on the person's body composition and stated goal.
3. A logged entry's or batch's figures can be corrected by hand, with the correction visible as a correction.
4. The Diary holds the day: meals, the day's figures, and the composer that adds to it.
5. Sleep score, steps and energy burned can be entered per day, from Samsung Health or anywhere else.
6. A Weight page shows the measured trend, says plainly which way it is going, and projects at most twelve weeks.
7. A goal — lose, gain, hold — adjusts the energy and protein targets.
8. A copy of everything is one tap away each week, and a daily reminder nudges the owner to fill the day in.
9. Navigation is icons.

## 3. Non-goals

- Reading Samsung Health or Health Connect programmatically. No browser API reaches either. Data is typed in.
- A notification guaranteed at a chosen time. Not available to a web page (section 9).
- A backup that writes to the phone with no tap. Not available to a web page (section 9).
- Rewriting the warning engine, its levels, its evidence or its prose. The rules keep reading `ctx.targets`; what
  changes is how some of those targets are derived (§8.1.1), not what any rule does with one.
- Macro ratios (40/30/30 and similar). Protein has an evidence base; carbohydrate and fat splits do not, at this
  level of precision, for this purpose.

## 4. Anti-goals — these would make the work a failure even if every test passed

- **A projection that sounds more certain than it is.** A twelve-week weight line drawn as a single confident
  stroke would be the most authoritative-looking and least reliable thing in the app.
- **Telling him a food caused a weight change.** Day-to-day weight is mostly water, glycogen and gut contents.
  The app may show arithmetic; it may not impute cause. This is the same line the warning cards already hold.
- **A weight page that grades him.** No streaks, no "on track", no red. The trends and warning-history screens
  set this register; the weight page is the one most likely to break it, and must not.
- **A zero standing in for something unknown.** A day with no step count is not a day with no steps. The central
  invariant applies to the new health fields exactly as it does to nutrients.
- **Counting the same energy twice.** Steps are already inside a total-burn figure. Adding them is wrong.
- **An unsourced number presented beside a sourced one.** The protein figure is being fixed precisely because the
  app did this once already.

## 5. Constraints

- Offline-first; no new runtime dependency.
- TypeScript strict with `noUncheckedIndexedAccess`; Vitest; phone-first at 375 px; both themes.
- Public repository: no secret and no personal profile value may be committed. `npm test` enforces it.
- An absent key means unknown, never zero.
- The barcode feature is landing in the same screens and must be merged first.

## 6. Evidence, verified

Both figures below were read verbatim from the source during this design. The 2.3–3.1 g/kg/d figure was
deliberately rejected; the reason is part of the design.

**Protein, general.** International Society of Sports Nutrition position stand (Jäger et al., *J Int Soc Sports
Nutr*, 2017;14:20), Position 2, read verbatim: "an overall daily protein intake in the range of 1.4–2.0 g
protein/kg body weight/day". The basis is stated: **body weight**.

**Protein while losing weight.** The same paper's Position 3, read verbatim: "Higher protein intakes (2.3–3.1
g/kg/d) may be needed to maximize the retention of lean body mass" / "in resistance-trained subjects during
hypocaloric periods."

**Ruling: the app does not use 2.3–3.1 g/kg/d.** The paper writes the unit only as `g/kg/d` and nowhere states
whether the denominator is total body weight or fat-free mass. For an 80 kg adult at 23% body fat that ambiguity
is the difference between 184 g and 142 g a day — a 40 g error in a figure the app would be presenting as
evidence-based. Instead, a weight-loss goal moves the target to the **top of the range whose basis is stated**,
2.0 g/kg body weight, which the same paper supports: its Key points say 1.4–2.0 g/kg/day is "a minimum
recommended amount while greater amounts may be needed for people attempting to restrict energy intake while
maintaining fat-free mass." If the underlying basis of 2.3–3.1 is later established from the primary source, this
decision can be revisited and the Verification log updated.

**Not verified, not used.** Morton et al. 2018 (*BJSM*) and its widely-quoted 1.6 g/kg breakpoint: the PDF could
not be read during this design. No figure from it appears anywhere in the app.

## 7. Approaches considered

### 7.1 Where the energy number comes from

| | Approach | Trade-off |
|---|---|---|
| A | Mifflin–St Jeor × an activity multiplier (today) | Free; wrong by an unknown amount in an undetectable direction. The multiplier is a guess the owner makes once from five labels. |
| B | Use the energy-burned figure typed in from Samsung Health | Closer to the person, but a wrist estimate can be several hundred kcal out and carries no error bar. |
| C | **Learn it from measured weight change (chosen)** | Needs several weeks of weigh-ins and logging before it says anything, and degrades if logging is patchy. In exchange it is the only option that becomes *more* correct over time. |

**Chosen: C, with A and B as the fallbacks it replaces.** Energy balance is an identity: if a fortnight of logged
intake averages 2,600 kcal and weight held steady, expenditure was about 2,600 kcal, whatever any formula says.
The app therefore keeps three sources of truth for expenditure and always names which one it is using:

1. **Formula** (Mifflin–St Jeor × multiplier) — the day the app is installed.
2. **Reported** (Samsung Health's energy burned, averaged over the days present) — once that data exists.
3. **Observed** (back-calculated from weight change against logged intake) — once there are enough weigh-ins and
   enough completely-logged days, and this one wins.

This is also what makes the Samsung import worth the typing: it is not decoration, it is the bridge until the
observed figure is available.

### 7.2 How the weight page projects

| | Approach | Trade-off |
|---|---|---|
| A | Energy arithmetic: daily balance × 12 weeks ÷ 7,700 kcal/kg | Simple and systematically wrong. This is the discredited "3,500 kcal per pound" rule; expenditure falls as mass falls, so it overshoots, and it overshoots most for the people most motivated to believe it. |
| B | Fit the measured weigh-ins and carry the trend forward | Says nothing about why, and needs regular weighing. |
| C | **Trend projects, arithmetic explains (chosen)** | Two things on one page must not be confused for each other; the design has to keep them visibly separate. |

**Chosen: C.** The projection comes from measured weight. Beneath it, in its own block, the arithmetic says what
the diary implies: average intake, the expenditure figure in use and where it came from, and the resulting
balance. The projection is drawn as a **band, not a line**, widening with distance, and stops at twelve weeks —
agreed with the owner, who asked initially for a year.

### 7.3 Navigation

Icon-only was considered against icon-with-label. The owner chose icon-only and said he will learn them. Accepted.
Every control keeps its `aria-label` and its 44 px target, so nothing is lost to a screen reader or to a thumb;
what is given up is first-run legibility, which is his call to make.

## 8. The design

### 8.1 Targets: direction, basis and goal

**Direction.** `Targets` gains, for every figure, which way it points: a floor, a ceiling, or neither. Energy is
neither. `NutrientBar` renders the three cases differently and never writes the bare word "target" for a ceiling:
a ceiling reads as a limit with the bar filling towards it, a floor as an amount to reach. The Missing screen's
"gap" logic must only consider floors; a day under its sodium ceiling is not a gap.

**Basis.** The profile gains an optional **body-fat percentage**. When present, resting metabolism uses
Katch–McArdle (`370 + 21.6 × lean kg`) and the fact is stated on screen; otherwise Mifflin–St Jeor as now. Protein
uses the verified ISSN range against body weight, positioned by the goal (below). Every target shown carries its
basis — which formula, which source — because the app's existing standard is that a figure without provenance is
not shown.

**Which figures are floors, ceilings or neither.** Settled here so the direction type has no gaps:

| Floors (reach) | Ceilings (stay under) | Neither |
|---|---|---|
| protein, fibre, every micronutrient | sodium, saturated fat, added sugars, trans fat | energy |

`addedSugarsIdealG` (WHO's conditional 5% figure) is **not** a second bar. It is a second, lower mark on the added
sugars bar, which is what it is: a stricter conditional recommendation under the same ceiling. `proteinFloorG`
likewise stays a lower mark on the protein bar, not a bar of its own.

**Goal.** The profile gains `goal: 'lose' | 'hold' | 'gain'` and an optional rate in kg/week.

- *Hold*: energy = the expenditure figure in use. Protein 1.4–2.0 g/kg, target at the middle.
- *Lose*: energy = expenditure − (rate × 7,700 ÷ 7), with the rate capped at a level the design review must set
  and justify, not invented here. Protein moves to **2.0 g/kg** (section 6).
- *Gain*: energy = expenditure + a surplus, same treatment.

The goal screen runs this conversion in **both directions**, because people think in both: pick a rate and it
shows the daily deficit or surplus it needs; pick a deficit and it shows the rate it implies. Same 7,700 kcal/kg,
same figure shown on screen, same wording as the weight page's arithmetic block (§8.5), so the two screens can
never appear to disagree with each other.

The app must say, in one plain sentence, that these targets assume the expenditure figure is right, and name which
of the three sources it is.

The lose/gain energy offset uses 7,700 kcal per kg. §7.2 rejects that figure for a twelve-week projection and
accepts it here, and the difference is real rather than convenient: over a week or two, before the body has
adapted, it is a serviceable approximation for *setting* a starting deficit, and it is self-correcting here
because the observed-expenditure source (§7.1) re-reads the person's actual weight change and moves the target.
Carried forward twelve weeks with nothing correcting it, the same figure compounds its own error. The builder must
put this reasoning in the Verification log, because a reader who sees 7,700 used in one place and refused in
another will otherwise think one of them is a mistake.

#### 8.1.1 Which targets the goal moves, and which the warning rules see

The rules read `ctx.targets` directly, and several targets are derived as a share of energy. A naive reading of
"the goal changes the energy target" would therefore move the saturated fat and added sugar ceilings and the
nutrient-density denominators too — warnings firing at different points because someone set a goal. The resolution
is not to freeze them, but to follow each guideline's own basis:

- **Expressed by its source as a share of energy intake** — saturated fat, added sugars, **trans fat** and fibre:
  these follow the energy target the person is actually eating to. WHO's figure is 10% of total energy *intake*,
  not 10% of expenditure, so on a 2,100 kcal target the ceiling is 52 g, and that is the guideline applied
  correctly rather than the app moving the goalposts. A tighter intake genuinely does carry a tighter absolute
  allowance. (Trans fat belongs here, not below: `targets.ts` already derives it as 1% of energy, matching how its
  source states it. An earlier draft of this document listed it as absolute, which was simply wrong.)
- **Expressed by its source as an absolute amount** — sodium (2,000 mg/day) and the micronutrient reference
  intakes: unchanged by the goal. These never move.
- **Protein** is per kg of body weight, so the goal moves it only through §6's rule (2.0 g/kg while losing).

`Targets` therefore stays a single structure and is **not** split into a rule-facing and a display-facing view:
a split would mean the person's own screen and the warning they are shown disagreed about the same figure, which
is worse than either basis. Each derived target carries which basis it used, and the bar and the card say so.

Consequence the builder must handle: existing rule tests fixing a target to a literal will still pass, but the
goal must be exercised. Add cases where a lose goal is set and assert the sodium ceiling is unchanged while the
added sugar ceiling has moved.

### 8.2 Correcting figures by hand

An entry's items and a batch's total can have their macros edited. Every field optional; leaving one blank leaves
it **unknown**, and clearing a value must set it back to unknown rather than to zero.

A corrected entry is marked, visibly, the way a custom food is marked self-reported. The provenance matters more
than the number: `coverage` for a hand-entered key becomes `'known'` because the person asserted it, but the
source is no longer the dataset, and the entry says so. Revisions already go through `reviseEntry`, which is
insert-only with the old row superseded — corrections inherit that, so nothing is silently rewritten.

**A correction re-runs the warning gate.** The product's promise is that you see the warnings before the figure
lands in your diary; a correction that raises sodium past a ceiling without showing the card would break that
promise in the one case where the person is paying closest attention to the number. The gate is reused, not
rebuilt. It follows that a correction can be cancelled, leaving the entry as it was.

**Editing a batch changes future portions only.** A logged entry snapshots its own figures at the time it was
logged — the builder must confirm this is true of `decrementBatchPortion` and the batch flow before relying on it,
and make it true if it is not. Back-dating a correction into meals already eaten would rewrite days the person
already saw, and would silently move historical totals, trends and the warning history that records what they were
shown. Days that have passed are a record, not a cache.

### 8.3 The Diary becomes the day

```
 [ ← ]   Sun 16 Nov   [ → ]

 ┌─ Today ───────────────────────────┐
 │ Energy    1,480 / 2,600 kcal      │   floor-ish: a goal
 │ Protein     88 / 160 g            │   floor
 │ Fibre       22 / 38 g             │   floor
 │ Sodium   1,900 mg  limit 2,000    │   CEILING — different shape
 │ Sat fat     18 g   limit 25       │   ceiling
 │ Added sug   31 g   limit 56       │   ceiling
 └───────────────────────────────────┘

 Breakfast                    520 kcal
   oatmeal with berries           ⋯
 Lunch                            —
 Dinner                       960 kcal
   chicken, rice, broccoli        ⋯
 Snacks                           —

 ┌─ Your day ────────────────────────┐
 │ Sleep score   —    Steps   8,412  │
 │ Energy burned 2,780 kcal          │
 │ Weight        —                   │
 └───────────────────────────────────┘

 ┌─ Add food ────────────────────────┐
 │ [ what did you eat?            ]  │
 │ [ Scan ]                 [ Add ]  │
 └───────────────────────────────────┘
```

**Meal slots.** Entries gain `meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'`. Existing entries have none;
they appear under an "Earlier" heading rather than being guessed into a slot from their timestamp — guessing would
rewrite history the owner did not write. New entries default from the clock, changeable before and after saving.

**The day's figures** are the Missing screen's `TODAY_BARS` block, moved here, with the ceiling/floor distinction
of 8.1. This is the change that makes the Missing screen's remaining job small enough to be replaced.

**Logging moves in.** The Log screen's composer appears at the foot of the Diary. The full Log screen stays
reachable for the resolution and warning flow, which is too tall to inline; the Diary's composer hands off to it.
The warning gate is untouched — food is still never silently added.

### 8.4 Daily health data

A new per-day record, separate from entries: sleep score (0–100), steps and energy burned (kcal). All optional,
all marked self-reported, all absent-means-unknown. Entered on the Diary; the daily reminder exists because this
needs filling in.

**Weight is not part of this record.** `profile.weightLog` stays the single source of truth, with its existing
protection that the only measurement cannot be removed. The Diary's weight cell is a view that writes there, as
ProfileSettings and FirstRun already do. A second weight field would mean two answers to "what do I weigh", and
the targets, the trend and the export would each have to pick one.

**Energy burned means the whole day, not active energy.** Samsung Health reports both, and the two differ by
roughly a resting metabolism — typing the wrong one understates expenditure by around 1,800 kcal and would push
the energy target down by the same amount. The field is labelled unambiguously, with a line saying which figure to
copy. A value below the person's estimated resting rate is almost certainly the active figure, so the app flags
it and asks, rather than rejecting it (someone bedbound for a day is possible) or accepting it in silence.

Of these, **energy burned** is the only one that enters a calculation (8.1, 7.1). **Steps** are shown as context
and explicitly not added to anything, because a total-burn figure already contains them. **Sleep score** is shown
beside the weight trend and is explicitly outside the arithmetic: the association between short sleep and weight
gain is real in the literature but confounded, and this app does not convert an association into a number.

### 8.5 The Weight page, and what becomes of Missing

Missing is not deleted; it is taken apart, because its three jobs belong in three different places now.

| Missing holds today | Where it goes |
|---|---|
| `TODAY_BARS`, the day's figures | the Diary (§8.3) |
| the weight entry form | the Weight page |
| the weekly gap list ("Worth a look") | stays inside the Progress tab, beside Trends and Warning history, **restricted to floors** — a day under its sodium ceiling was never a gap |

So the nav gains Weight and keeps Progress; Progress keeps three sub-views, with Missing's segment renamed to
match what it now does. The gap logic itself barely changes: it loses the three ceilings from its candidate list.

Weight page contents, in order:

1. **Which way it is going**, in a sentence, from the measured trend: losing, gaining, or holding steady, with the
   rate. Silent, with a plain explanation, until there are enough weigh-ins — the same gate discipline as the
   trends screen, reusing `MIN_LOGGED_DAYS`-style constants rather than inventing new ones.
2. **The line**, every logged weight, with a smoothed trend through it.
3. **The projection**: a band forward to twelve weeks, widening with distance, drawn so it cannot be mistaken for
   measurement. It assumes today's eating continues and says so on the page.
4. **Why**, as arithmetic in its own block: average logged intake, the expenditure figure and which of the three
   sources it came from, the balance between them, and — the owner asked for this explicitly — **that balance
   expressed as a rate**, because "about 0.4 kg a week" is a number a person can act on and "−430 kcal a day" is
   not.

   The conversion is 7,700 kcal per kg, shown on the page so the figure is never a black box. Worked examples,
   all approximate: a 300 kcal daily deficit is about **0.27 kg a week**; 700 kcal is about **0.64 kg**; 1 kg a
   week needs about **1,100 kcal a day**. (The owner's own estimate had 700 kcal at 1 kg a week. That is roughly
   the value you get from mixing up the per-pound figure, 3,500 kcal, with kilograms — an easy slip, and the
   reason the page shows the conversion rather than only the answer.)

   **The implied rate and the measured rate are shown together, and the page expects them to disagree.** That
   disagreement is the most informative thing here: if the arithmetic implies 0.6 kg a week and the scale says
   0.2, then the logging is incomplete, or the expenditure figure is too high, or both — and the page says that
   plainly rather than picking a winner. Where they differ, **the measured rate is the one that governs the
   projection**; the arithmetic never overrides the scale. This is also exactly the signal that feeds the
   observed-expenditure source in §7.1.

   Where logging is patchy it says so instead of averaging over days it cannot see.
5. **What contributed**, as the honest version of "which foods affect my weight": the entries carrying the most
   energy over the period, as a plain list. Labelled as arithmetic about energy, with no claim that any of them
   caused a weight change.

### 8.6 Backup and reminder

**Weekly copy.** The existing backup machinery already records `fd.lastExportAt`. A week after the last copy, the
Diary offers a prepared export behind one tap. The honest wording already written for the nudge applies: the app
knows it built a file and handed it over, and nothing more.

**Daily reminder.** Settings gains a time. Two mechanisms, both named honestly on the settings screen:
- When the app is opened and the day's health data or food is missing, it says so. This always works.
- If notifications are permitted and the app is installed to the home screen, a best-effort daily notification via
  the service worker. The browser decides the moment; the chosen time is a preference, not a guarantee, and the
  screen must say that rather than implying an alarm.
Settings should point out that the phone's own alarm is the reliable tool for a fixed time.

### 8.7 Navigation

Icon-only, six destinations or fewer, each with an `aria-label` and a 44 px target: diary, weight, progress,
batches, my foods, settings.

## 9. What a web page cannot do, and why these choices were forced

- **Health Connect / Samsung Health.** No browser API. Typed entry, or a file the owner exports and imports.
- **A notification at a chosen time.** Notification Triggers is not shipped. Periodic Background Sync exists in
  Chrome for installed apps but the browser chooses when it fires. A fixed-time alarm needs a native app.
- **Automatic file writes.** `showSaveFilePicker` is not available on Android Chrome, and a download needs a user
  gesture. One tap is the floor, not a shortcoming of the implementation.

Each of these is stated to the owner on the screen that depends on it. A feature that quietly under-delivers is
worse here than one that explains its limit.

## 10. Left to the builder

- The exact shape and arithmetic of the trend fit and the projection band. The requirement is that it is honest
  about uncertainty and documented; the method is the builder's, and must be written into the Verification log.
- **The gates on the observed-expenditure source, which are the builder's and must be justified in writing.**
  How long a window, how many weigh-ins in it, how many days logged completely enough to average intake over, and
  what "completely enough" means when nutrient coverage can be partial. `MIN_LOGGED_DAYS` is 4 and exists to gate
  a median; it is far too few to fit a weight trend through noise, and must not be reused here. Two requirements
  bound the choice: the figure may not activate on noise, and when the energy target changes source the app says
  so on screen rather than letting the number jump unexplained.
- The rate cap for a weight-loss goal, with a source, or an explicit statement that it is the app's own choice.
- Where the daily health record lives (its own IndexedDB store, versioned; note that `db.ts` now repairs a
  database that has lost its stores). It must be carried by export and import, and cleared by erase.
- The icon set, drawn inline as SVG — no icon dependency.
- Whether the Log screen survives as a route or is absorbed entirely.
- Migration for existing entries with no meal slot: they show under "Earlier" and are never back-filled.

## 11. Order of work

1. Merge the barcode feature. It is a **hard precondition**: nothing below starts against an uncommitted tree.
   It touches Log, Diary and EntryDetail, which step 5 rewrites, and the Diary composer's Scan button is its
   button. Plan against the committed baseline, not against the work in flight.
2. Targets: direction, basis, goal. **First, because the app is misinforming its user today.**
3. Correcting figures by hand.
4. Daily health data.
5. Diary rebuild: meals, the day's figures, the composer, icon nav.
6. Weight page.
7. Weekly copy and reminder.

---

# Addendum — further uses of the optional DeepSeek fallback

Added 2026-11-16 at the owner's request, after the main design was approved. Has its own plan.

## The line this addendum does not cross

`src/ai/deepseek.ts` already states it: "the model resolves LANGUAGE, the dataset resolves NUTRITION." The model
gets one unresolved phrase, returns a plain-English description, and the app searches its own database with it. It
is never shown the dataset, never names a dataset entry, and is never asked for a nutrient value. The response is
validated to an exact shape and treated as hostile; every failure returns an empty list and never throws.

**Every use below keeps that line.** The model may supply *structure* (what components a dish has, what a list of
ingredients contains) and *language* (what a foreign word means). It may not supply nutrition, may not pick a
food, and may not generate a health claim. One use — reading a label photo — comes nearer the line than the rest
and is fenced accordingly (§A4).

Also unchanged: the whole path stays optional and off until a key is entered and the switch turned on, and the
privacy disclosure in Settings must be updated to match whatever is actually sent, before any of it ships.

## A0. The model name is probably wrong already

`DEEPSEEK_MODEL = 'deepseek-chat'`. DeepSeek's own Models & Pricing page (read 2026-11-16) lists exactly two
models, `deepseek-flash` (DeepSeek-V4.1-Flash-1017) and `deepseek-v4-pro`, and `deepseek-chat` is not among them.
Legacy names are noted as still accepted for the retired Flash builds; `deepseek-chat` is not one of the names
that note covers. Verify against a live key and move to `deepseek-flash`, which is also the cheaper model and the
only one of the two with vision. Do this first: every other item here depends on the call working.

## A1. Composite dishes — the largest real gap

"chicken tikka masala with rice and naan" resolves badly, because the parser matches a phrase to a single food.
The model decomposes a dish into components with rough proportions; the app looks each component up in its own
database; the person adjusts the amounts and confirms. The model supplies the *list*, never a number that reaches
the diary — the proportions are a starting point the person edits, and must be presented as such.

## A2. Spanish — verify before building

The owner shops in Spain and the dataset is US survey foods. The existing prompt already asks the model to
describe an unrecognised word in plain English, so Spanish food words may already work end to end. **Test this
before writing anything.** What probably does need work is upstream of the fallback: Spanish quantity words
("una loncha", "un puñado", "medio") that the local parser mishandles before the phrase ever reaches the model.
That is a parser fix, not an AI feature, and must not be built as one.

## A3. Meal-prep ingredient lists

The feature the owner asked for at the very start, finished. "I made a lasagna with 500 g beef, 400 g pasta, two
jars of sauce" is a list; turning free text into a structured list is the same operation as A1 and uses the same
validated shape. It feeds the existing batch builder, which already divides a total into portions.

## A4. Reading a nutrition label from a photo

The most useful for Spanish supermarket own-brands, which are exactly what Open Food Facts covers worst, and the
only item here where the model reads numbers. Fences, all required:

- It fills in the **custom food form**, every field editable, and nothing is saved until the person confirms. This
  is the same standing as a figure typed from a packet, and it carries the existing self-reported badge.
- A field the model did not read is left **blank, not zero**. The central invariant does not bend for a photo.
- The photo is sent to a third party. The disclosure must say so plainly, and this must be its own switch, not
  covered by the existing one.
- Requires `deepseek-flash`; `deepseek-v4-pro` has no vision. Depends on A0.

## Rejected, with reasons

- **Explaining or paraphrasing a warning.** Every card carries a verbatim conclusion from WHO, IARC or EFSA,
  stored offline. A paraphrase is how an app ends up stating something no source said. The discipline is the
  product.
- **Generated alternatives.** The rules already carry sourced ones, under the standing rule that an alternative
  with no citation is a taste, not evidence. A generated one is a taste.
- **Weekly summaries of the diary.** Settings currently promises that "your diary, your profile, your targets and
  your totals are never sent". A summary breaks that promise. Not rejected on principle — it is the owner's data
  — but it would need its own switch and its own disclosure, and is out of scope here.

## Verification log

### Protein targets (honest-targets plan, Task 4)

Replaces `1.2 × weightKg` and `0.8 × weightKg`, which had no source. Both figures below were read verbatim from
their sources during the design (section 6). Nothing was re-read from a secondary summary.

**Floor, and the target for a sedentary adult: 0.83 g per kg of body weight per day.**
EFSA Panel on Dietetic Products, Nutrition and Allergies, "Scientific Opinion on Dietary Reference Values for
protein", *EFSA Journal* 2012;10(2):2557, https://doi.org/10.2903/j.efsa.2012.2557. Verbatim: "the PRI for adults of
all ages was estimated to be 0.83 g protein/kg body weight per day". Basis: body weight. Limit: one figure for all
adults; age, sex and pregnancy are not modelled.

**Target for an adult who is not sedentary: 1.4 to 2.0 g per kg of body weight per day.**
Jäger et al., "International Society of Sports Nutrition Position Stand: protein and exercise", *J Int Soc Sports
Nutr* 2017;14:20, Position 2. Verbatim: "an overall daily protein intake in the range of 1.4–2.0 g protein/kg body
weight/day". Basis: body weight. The range is stated for exercising individuals, so a `sedentary` activity level
never receives it. Positioning within the range is the app's choice, not the paper's: 1.7 (the middle) when holding,
gaining or no goal is stated; 2.0 (the top) when the goal is to lose weight, for the reason given in section 6.

**What was checked in the app:** for 80 kg the floor is 66 g, a sedentary target 66 g, an exercising target 136 g
(1.7) or 160 g (2.0, losing). `Targets.basis.protein` is `'efsa-pri'` or `'issn-range'` accordingly. The
Missing screen's note was corrected, because it still stated 1.2 g/kg.

**Decision:** when the targets are generic (no profile, or an incomplete one), protein is EFSA's 0.83 g/kg for both
floor and target, with basis `'efsa-pri'`. The generic basis's `light` activity serves the energy formula only and is
not a claim that the person exercises, which the ISSN range requires.
