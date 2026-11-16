# Food diary with proactive health warnings — design

**Date:** 2026-11-15
**Status:** awaiting approval
**Owner:** the owner

---

## 1. Intent and why

A personal food diary whose purpose is **education, not record-keeping**. The owner's
stated goal, in his own words: "I hope it will make me the healthiest possible, general
awareness and improve my life quality."

The defining mechanism: **nothing enters the diary silently.** Every entry passes through
a warning gate. The app computes the nutritional impact of the actual quantity eaten,
weighs it against what has already been eaten today and over the past seven days, and —
when there is something worth knowing — shows a graded, sourced explanation *before* the
entry is committed. The user then chooses to add it anyway, see alternatives, or cancel.

The app never blocks food, never shames, and never moralises. It is a teacher, not a
gatekeeper. Success looks like the owner understanding *why* something matters and
gradually making different choices on his own, while still using the app a year from now.

### Why the warnings are the product

A conventional tracker answers "how many calories was that?" This one answers "what
should I know about what I just ate, given everything else I have eaten this week?" The
numbers exist to make the warnings honest and quantitative. They are not the point.

---

## 2. Goals

- **G1.** Every food entry triggers a pre-commit evaluation; the user explicitly confirms,
  substitutes, or cancels. No silent add, no silent removal.
- **G2.** Warnings are graded across four levels (INFO / MODERATE / HIGH / CRITICAL) and
  reserved for genuine concerns. Ordinary food produces no warning at all.
- **G3.** Every warning states: the concern, the responsible ingredient or nutrient, the
  supporting evidence *and its strength*, whether the concern is about occasional or
  habitual consumption, how the actual portion affects the picture, and a healthier
  alternative where one genuinely exists.
- **G4.** Warnings are personalised against running daily totals, 7-day frequency history,
  and the owner's own profile (height 197 cm, weight 100 kg, DOB [the owner's date of birth], male).
- **G5.** A secondary "what's missing" view surfaces deficiencies that warnings cannot
  catch — low fibre, thin protein, no vegetables for days, missing micronutrients.
- **G6.** Works on a phone browser as the primary device, offline, from a GitHub Pages URL.
- **G7.** Diary data stays on the owner's device. No account, no server, no telemetry.
- **G8.** Future-proof: nothing derived is frozen into storage. Age recomputes from DOB;
  targets recompute from current weight. Adding a new allergen or condition later requires
  no migration.
- **G9.** The owner can define his own foods, and can enter a cooked batch once (ingredients
  plus number of portions) and log a portion of it on each of the following days.

## 3. Non-goals

- Not a weight-loss or calorie-deficit tool. No diet plans, no streaks, no gamification.
- No social features, sharing, or leaderboards.
- No barcode scanning in v1 (a plausible later addition via Open Food Facts).
- No cross-device sync in v1 (see Approaches — deliberately traded away).
- No meal planning, shopping lists, or cookbook features. Batches exist only to make
  logging what was actually eaten accurate (§10a) — not to manage recipes.
- No medical diagnosis or treatment advice.
- No exercise or water tracking.

## 4. Anti-goals — things that would make this a failure even if it worked

- **A1. Warning fatigue.** If an apple produces a card, the user stops reading cards. Every
  false positive costs credibility. The engine must stay silent far more often than it speaks.
- **A2. Shame.** Any phrasing that implies the user is weak, bad, failing, or disappointing
  is a defect, not a tone preference. This includes passive-aggressive framing ("you've
  *already* had…"), red/alarm styling on INFO-level cards, and guilt-adjacent emoji.
- **A3. Overclaiming.** Saying or implying that one serving causes disease, presenting
  associational evidence as causal, or stating a number the data cannot support. An
  unsourced health claim is a bug.
- **A4. Flattening.** Treating all processed foods as equally bad. Tinned beans, wholemeal
  bread and a hot dog are not the same thing, and the engine must not imply they are.
- **A5. Friction.** If logging a meal takes more than a few seconds on a phone, the diary
  stops being used and the warnings never fire at all.

---

## 5. Constraints

- **C1.** Static hosting only (GitHub Pages). No backend, no server-side compute, no
  database the app controls. Everything ships as files or runs in the browser.
- **C2.** The repository is public. **No secrets may ever be committed.** The DeepSeek API
  key is entered by the user in the running app and stored in browser storage only.
- **C3.** Phone-first. Primary use is standing at a table, one-handed, possibly offline.
- **C4.** Bundled food data must stay small enough to load fast on mobile data. Budget:
  under ~3 MB gzipped for the core dataset, loaded lazily and cached.
- **C5.** Nutrient data must come from a citable public source. USDA FoodData Central is
  CC0 / public domain, which satisfies both licensing and defensibility.
- **C6.** Nutrient values must never be invented by a language model. (See §10.)
- **C7.** The app must function fully with no network and no API key. The AI path is an
  enhancement, never a dependency.

---

## 6. Approaches considered

Three were put to the owner. The axis that mattered was **how much of a free-text entry
the app can understand**, since that determines whether the diary is usable daily.

### Approach 1 — Offline dataset, hand-written parser, no AI
Bundle a curated USDA subset; parse quantity, unit and food name with hand-written rules
and fuzzy matching. Fully offline, free, deterministic, every number traceable.
**Trade-off:** fails on unusual phrasing and composed dishes ("my mum's lasagne"), falling
back to a manual pick-the-closest-food flow.

### Approach 2 — Approach 1 plus an AI fallback for unmatched entries ← **chosen**
Identical core. When the local parser cannot resolve an entry, the raw text is optionally
sent to an LLM, which returns *structured food-and-quantity guesses only*. Nutrient numbers
still come exclusively from the bundled dataset.
**Trade-off:** requires an API key held in the browser; the fallback needs a connection and
costs a fraction of a cent per use; the user's entry text leaves the device when it fires.
**Chosen because** it removes the daily-friction risk (anti-goal A5) without surrendering
numeric integrity (C6), and because it degrades cleanly to Approach 1 when offline or
unconfigured.

### Approach 3 — Host as a private Claude Artifact with a built-in shared database
Same engine, but phone and desktop would share one diary automatically.
**Rejected by the owner:** he wants his own GitHub Pages URL and will log almost entirely
from his phone, so the sync benefit does not pay for the platform dependency.

### Decisions made by the owner during the conversation
- Approach 2, **with DeepSeek rather than Claude** as the model provider.
- The API key must be enterable in the web page itself, never committed to GitHub.
- GitHub Pages hosting confirmed; phone is the primary device.
- Citations curated by hand from WHO, IARC and comparable bodies, bundled offline.
- Warnings are the centrepiece; the "what's missing" view is a quieter secondary surface
  and stays out of the entry flow.
- No current conditions or allergies; the flagged-allergen mechanism ships with an empty list.
- Profile: 197 cm, 100 kg, DOB [the owner's date of birth], male.
- Foods missing from the dataset are added by hand as the owner's own foods, marked
  self-reported, counting toward totals, with blank nutrients left blank (§10a.1).
- Batch cooking is in scope: enter the whole cooked quantity and the number of portions,
  and log a portion per day (§10a.2).

**Verified during design:** `api.deepseek.com` returns `access-control-allow-origin`
reflecting the caller's origin and permits `authorization` on POST, so direct
browser-to-DeepSeek calls work from a GitHub Pages origin with no proxy.

---

## 7. Stack and deployment

Chosen by the designer (the owner delegated technical choices):

- **Vite + React + TypeScript**, **Tailwind CSS**.
- **Storage:** IndexedDB via a thin wrapper (`idb`) for entries and food data cache;
  `localStorage` for the profile, settings and API key.
- **Deployment:** GitHub Action on push to `main`, publishing `dist/` to GitHub Pages.
  Vite `base` set to the repository name.
- **PWA manifest + service worker** so the app installs to the phone home screen and the
  dataset is cached for offline use. This is load-bearing for C3 and C7, not a nicety.
- **No analytics, no fonts from CDNs, no third-party scripts.** The only outbound request
  the app ever makes is to DeepSeek, and only when the user has configured a key and the
  parser has failed.

---

## 8. Food data pipeline (build time)

A Node script in `scripts/build-food-db.ts`, run manually and committed as output, not run
in CI:

1. Download from USDA FoodData Central:
   - **FNDDS / Survey Foods** — foods as actually consumed, with portion descriptions
     ("1 frankfurter", "1 cup"). The primary source for diary use.
   - **Foundation Foods** — deeper nutrient analysis for whole foods.
   - **FPED (Food Patterns Equivalents Database)** — per-food **added sugars** (teaspoon
     equivalents), solid fats, and fruit/vegetable/whole-grain **cup equivalents**.
2. Select a working subset (target ~3,000–5,000 foods) covering European and North
   American everyday eating, plus anything the owner logs that is missing (the set grows
   from real use).
3. Retain per 100 g: energy, protein, total fat, saturated fat, trans fat, carbohydrate,
   total sugars, **added sugars**, fibre, sodium, potassium, calcium, iron, magnesium,
   zinc, vitamin C, vitamin D, vitamin B12, folate. Plus portion rows (description, gram
   weight) and FPED cup-equivalents.
4. Attach a **hand-curated classification layer** — the part USDA does not provide:
   `processedMeat`, `redMeat`, `sugarSweetenedBeverage`, `alcohol`, `novaGroup` (1–4),
   `refinedGrain`, `vegetable`, `fruit`, `legume`, `oilyFish`. Curated per food group with
   per-food overrides, in a reviewable TypeScript/JSON file.
5. Emit `public/data/foods.<hash>.json` plus a small prebuilt search index (name,
   synonyms, trigram keys). Sharded if it exceeds the C4 budget.

**Known data gaps to handle explicitly, not paper over:**
- Added sugars are unavailable for some foods. Where missing, the engine must say "added
  sugar unknown for this food" rather than substituting total sugars silently.
- FNDDS is US-centric. European staples may be absent; the manual-entry path and the
  growing subset cover this.
- FPED releases lag FNDDS releases. If the matching FPED year is unavailable, fall back to
  the nearest and record the year in the dataset metadata.
- **Every citation and threshold in the rules file must be verified against the primary
  source during implementation.** The figures in §9 are the designer's starting values and
  are to be confirmed, not trusted.

---

## 9. The warning engine

### 9.1 Shape

Rules are **data, not code** — one entry per concern in `src/rules/*.ts`, so the catalogue
can be reviewed, corrected and extended without touching engine logic. Each rule declares:

```ts
type Rule = {
  id: string;
  title: string;                  // "Processed meat"
  level: (ctx: Context) => Level | null;   // null = stay silent
  concern: string;                // what the concern is
  cause: string;                  // which ingredient or property causes it
  evidence: {
    strength: 'strong' | 'moderate' | 'limited' | 'uncertain';
    body: string;                 // "IARC", "WHO", "EFSA"
    summary: string;              // plain-language statement of what is actually shown
    citation: { title: string; publisher: string; year: number; url: string };
    isAssociational: boolean;     // forces hedged phrasing when true
  };
  horizon: 'occasional' | 'habitual' | 'both';
  portionNote: (ctx: Context) => string;   // how this amount changes the picture
  alternatives?: Alternative[];   // omitted entirely when none is honest

  // data confidence — a rule must know whether its inputs are actually known
  requiresNutrients: NutrientKey[];   // rule stays silent if any is unknown
  minCoverage?: number;               // for daily-aggregate rules: minimum share of
                                      // the day's energy with known values (default 0.8)
};
```

`Context` carries: the pending entry's resolved nutrients, today's running totals, the
7-day history and frequency counts, and the profile-derived targets.

### 9.2 Levels

| Level | Meaning | Visual treatment |
|---|---|---|
| **INFO** | Minor nutritional consideration worth knowing | Neutral grey, collapsed by default |
| **MODERATE** | Worth limiting or improving | Amber, one line visible |
| **HIGH** | Significant concern, especially with frequent consumption | Orange, expanded |
| **CRITICAL** | Immediate safety concern — a flagged allergen, or unsafe handling | Red, expanded, cannot be collapsed |

**CRITICAL is reserved for safety, never nutrition.** No quantity of sugar or sodium
reaches CRITICAL. Sources of CRITICAL in v1: a food matching the user's flagged allergen
list, and a small hand-written set of food-safety conditions (e.g. raw kidney beans,
reheated rice held warm, unpasteurised products where the user has flagged a reason).

**The allergen layer is built in v1 even though the list ships empty**, because G8 promises
that adding an allergen later needs no migration — and that promise is only kept if the
food-to-allergen mapping already exists. The build pipeline (§8 step 4) therefore tags each
food with the EU's 14 declarable allergen groups, curated per food group with per-food
overrides. Custom foods (§10a) carry user-set allergen tags.

**Food-safety rules do not infer preparation from free text.** USDA identity cannot tell us
the rice was held warm, and guessing it from keywords would put false positives on the one
tier that cannot be collapsed. Instead a short explicit list of foods with a known
preparation-dependent hazard (raw kidney beans, reheated rice, raw sprouts, raw eggs,
unpasteurised dairy) carries a flag that makes the gate ask one direct question — "was this
reheated rice kept warm rather than chilled?" — and raises CRITICAL only on a yes. No
question, no card. This keeps CRITICAL reachable and testable in v1 without a new inference
surface.

Anti-goal A1 is enforced structurally: a rule returning `null` is the normal case, and the
entry commits with no card at all. The engine shows **at most three cards** per entry,
highest level first, and merges same-nutrient rules rather than stacking them.

### 9.3 Initial rule catalogue

Starting values, **all to be verified against primary sources during implementation:**

| Rule | Threshold / trigger | Evidence strength | Source to cite |
|---|---|---|---|
| Sodium — single entry | > ~600 mg in one entry | strong | WHO sodium intake guideline |
| Sodium — daily total | projected day > 2,000 mg | strong | WHO (<2,000 mg/day) |
| Added sugar — entry | > ~15 g added sugar | strong | WHO free-sugars guideline |
| Added sugar — daily | projected day > 10% of energy | strong | WHO (<10%E strong, <5%E conditional) |
| Saturated fat — daily | projected day > 10% of energy (~28 g at 2,500 kcal) | strong | WHO saturated fat guideline |
| Trans fat | any industrial trans fat; day > 1% of energy | strong | WHO trans fat guideline |
| Processed meat — occasion | any processed meat entry | strong (Group 1) | IARC Monograph Vol. 114 |
| Processed meat — frequency | ≥ 3 occasions in 7 days | strong | IARC + WCRF |
| Red meat — weekly | > ~500 g cooked in 7 days | moderate (Group 2A) | IARC Vol. 114, WCRF |
| Alcohol | any; escalates with weekly total | strong (Group 1) | IARC, WHO 2023 statement |
| Sugar-sweetened drink | any SSB entry | moderate | WHO, cohort evidence |
| Ultra-processed (NOVA 4) | high share of day's energy | **limited / associational** | NOVA literature — must be hedged |
| Low nutrient density | high energy, low fibre + protein + micronutrients | moderate | derived, framed as context not risk |
| Flagged allergen | match against user list | n/a — safety | user's own flag |

**"Projected day" means today's committed totals plus the pending entry — plain arithmetic,
as in the worked example below.** No extrapolation from time of day or past patterns: that
would manufacture warnings about food not yet eaten, which is the false-positive risk
anti-goal A1 exists to prevent. The consequence is accepted deliberately — daily-total rules
cannot fire at breakfast, and will mostly fire at the evening meal. The weekly view (§11)
carries the forward-looking picture instead.

**When primary-source verification contradicts a value in this table, the source wins and
the threshold moves.** If a source supports the concern but no defensible quantitative
trigger (the likeliest candidates are the single-entry sodium figure and the NOVA-4 "high
share of energy" trigger), the rule becomes qualitative — it fires on the food's
classification, states the concern without a numeric claim, and says the threshold is not
established. If the source does not support the concern at all, the rule is dropped and the
removal is recorded in the rules file. Inventing a threshold to keep a feature is anti-goal
A3 and is never the answer.

**Citations are bundled, meaning the stored rule carries the publisher, title, year and a
short verbatim statement of what the source actually concludes** — enough to read the claim
offline (C7). The URL is a link out for when there is a connection, never the only content.

The ultra-processed rule is deliberately marked *limited*: the evidence is largely
observational and confounded, and the card must say so. This is the clearest test of
anti-goal A3 — if the app cannot be honest about weak evidence, it should not raise it.

### 9.4 Personalisation and targets

Computed from the profile, recomputed whenever weight or the date changes:

- **Age** from DOB ([the owner's date of birth]) — 35 at time of writing, derived never stored.
- **RMR** via Mifflin–St Jeor, male: `10×100 + 6.25×197 − 5×35 + 5` = **2,061 kcal/day**.
- **Energy target** = RMR × activity factor. The app asks for activity level on first run;
  default *lightly active* (×1.375) ≈ **2,834 kcal/day**. Designer's call; user-editable.
- **Sodium** 2,000 mg/day (WHO). The US 2,300 mg figure is shown as a secondary reference.
- **Saturated fat** < 10% of energy ≈ 31 g at 2,834 kcal.
- **Added sugar** < 10% of energy ≈ 71 g; the 5% conditional ideal ≈ 35 g shown as the
  better target.
- **Fibre** 30–35 g/day (14 g per 1,000 kcal).
- **Protein** target 1.2 g/kg = **120 g/day**, with the 0.8 g/kg RDA floor (80 g) marked as
  the minimum rather than the goal.
- **Micronutrients** against adult male reference intakes.

**Explicit decision — no BMI judgments.** At 197 cm, BMI is a poor individual measure, and
weight commentary is outside what the owner asked for. The app shows weight as an editable
number with history and a trend line, and says nothing evaluative about it.

### 9.5 Tone rules (enforced in review, and testable)

- Second person, factual, no exclamation marks.
- Never "you should not" — instead "consider", "worth knowing", "the evidence suggests".
- Associational findings must use associational language. Never "causes" for `isAssociational`.
- Never attribute disease to one serving. Frequency framing is mandatory for habitual rules.
- Alternatives are concrete and comparable ("grilled chicken thigh, ~90 mg sodium per 100 g
  against ~810 mg"), and are omitted when no honest alternative exists.
- Uncertainty is stated in the card, not buried in a footnote.

### 9.6 Worked example — "I ate two hot dogs"

```
┌────────────────────────────────────────────────────┐
│  2 × Frankfurter, beef (1 frankfurter, 57 g)       │
│  114 g · 345 kcal                                  │
├────────────────────────────────────────────────────┤
│  ⬤ HIGH   Processed meat                           │
│                                                    │
│  Hot dogs are processed meat — cured, salted and    │
│  preserved. IARC classifies processed meat as a     │
│  Group 1 carcinogen, based on consistent evidence   │
│  linking regular consumption to colorectal cancer.  │
│                                                    │
│  What the evidence actually shows: about 50 g a day │
│  — roughly one hot dog — is associated with an 18%  │
│  higher relative risk of colorectal cancer. That is │
│  a statement about habitual intake over years, not  │
│  about this meal. Two hot dogs today does not cause │
│  disease.                                           │
│                                                    │
│  Your portion: 114 g, a little over twice the 50 g  │
│  reference amount.                                  │
│                                                    │
│  Evidence strength: strong · IARC Monograph Vol. 114│
│                                                    │
│  ⬤ MODERATE   Sodium                                │
│  1,240 mg in this entry. You have had 2,000 mg      │
│  today, which would bring you to 3,240 mg against   │
│  the WHO 2,000 mg daily guideline.                  │
│                                                    │
│  ⬤ INFO   Logged 3× this week                       │
│  Processed meat on Monday and Thursday. The concern │
│  is frequency rather than any single occasion.      │
├────────────────────────────────────────────────────┤
│  Healthier swaps                                   │
│  Grilled chicken thigh · ~90 mg sodium /100 g      │
│  Tinned sardines · adds omega-3 and calcium        │
│  Turkey breast · ~1/8 the sodium                   │
├────────────────────────────────────────────────────┤
│  [ Add anyway ]  [ Show alternatives ]  [ Cancel ] │
└────────────────────────────────────────────────────┘
```

---

## 10. The DeepSeek fallback

**Invariant: the model resolves language. The dataset resolves nutrition.**

- **Trigger.** Only when the local parser fails to resolve an entry with acceptable
  confidence, and only when a key is configured and the device is online. Never on a
  successful local parse.
- **Contract.** The model receives the raw entry text and a shortlist of candidate dataset
  food names. It returns strict JSON: a list of `{ datasetFoodId | candidateName, quantity,
  unit }`. **It is never asked for, and never trusted for, nutrient values.** Any numeric
  nutrient field in the response is discarded.
- **Resolution.** Returned names are matched back against the bundled dataset. Anything
  unmatched goes to the manual-entry path. The user sees that the AI was used and can
  correct the interpretation before the warning gate runs.
- **Key handling.** A Settings screen accepts the key, stores it in `localStorage`, and
  shows it masked with a clear/replace control. Stated plainly in that screen: the key
  lives in this browser, is sent only to `api.deepseek.com`, and can be revoked at
  DeepSeek at any time. **Nothing key-shaped is ever committed to the repository**; a
  pre-commit grep and a `.gitignore` for any `.env` guard this.
- **Privacy, stated in the UI where the user can see it before enabling:** when the
  fallback fires, the text of that entry is sent to DeepSeek, a third-party provider
  outside the owner's device, under DeepSeek's own data policy. Diary history, profile,
  weight and totals are **never** transmitted — only the single unresolved phrase. The
  fallback is **off until a key is entered**, and there is a toggle to disable it while
  keeping the key.
- **Model:** `deepseek-chat`. JSON-mode response, low temperature, short timeout, one
  retry, then fall through to manual entry. Failure is silent and non-blocking.

---

## 10a. Custom foods and batch cooking

Decided by the owner: *"let me add my own food… but if I want to have a pasta for example
that I mealprep and I make for 4 days I should also be able to say the total I have made and
then AI helps me figure out the macros per day."*

### 10a.1 Custom foods

When nothing in the dataset matches, the owner creates his own food: a name, synonyms, a
reference portion, and whatever nutrients he can read off the package. Stored in IndexedDB,
reusable forever, included in export/import.

- Marked **self-reported** everywhere it appears, visually distinct from USDA entries.
- **Counts in daily totals** for the nutrients that were entered.
- **Blank nutrients stay blank — never zero, never inferred.** A rule whose
  `requiresNutrients` are not all known stays silent (§9.1), so an unknown sodium value
  produces no sodium warning rather than a wrong one.
- Carries the same classification flags as dataset foods (processed meat, NOVA group,
  vegetable, allergens), set by the owner when he creates it. These drive the
  classification-based rules even when the numbers are incomplete — so a home-made sausage
  still raises the processed-meat card.
- Partial-coverage honesty: where a daily total includes a food with unknown values, the
  figure is shown as a known floor with a coverage note ("at least 48 g — 2 items have no
  added-sugar data"), never as a clean total. A daily-aggregate rule whose coverage falls
  below `minCoverage` does not fire, and the view says why.

### 10a.2 Batches

A batch is a cooked quantity divided into portions. The owner enters it once:

1. **Ingredients**, as free text, one per line or comma-separated — "500 g penne, 400 g
   passata, 300 g chicken breast, 2 tbsp olive oil".
2. **How many portions** it makes (4, in his example).
3. Optionally the **total cooked weight**, used only to describe a portion in grams.

The app resolves each ingredient line through the normal path — local parser first, DeepSeek
fallback for lines it cannot match, manual pick or custom food if that also fails — then
**sums the ingredient nutrients and divides by the portion count.**

**Portions, not weight, are the unit of division.** Cooking changes weight through water
loss and absorption, so per-100-g figures for a cooked dish are unreliable while the total
divided by four is exact. Total cooked weight is recorded for labelling a portion only, and
is never used to rescale nutrients.

The batch is saved as a reusable food, "Chicken pasta (1 portion)", with a **remaining
portions counter** that decrements each time one is logged and shows what is left in the
fridge. Logging a portion runs the warning gate normally, against that portion's nutrients.
A batch can be re-cooked, resetting the counter without re-entering the ingredients, and its
ingredients can be edited — which re-divides and recomputes, without altering portions
already logged (nutrients are snapshotted at commit, §12).

**The AI's role here is unchanged from §10: it resolves language, never nutrition.** It maps
"2 tbsp olive oil" to a dataset food and a gram weight. The arithmetic — summing and
dividing — is the app's, and is exact.

---

## 11. "What's missing" view

A separate screen, deliberately outside the entry flow (per the owner's choice):

- **Today:** energy, protein, fibre, sodium, saturated fat, added sugar against targets, as
  progress bars with the target marked.
- **This week:** vegetable and fruit cup-equivalents per day from FPED, fibre trend, protein
  trend, days with no vegetables, days with oily fish, processed-meat occasions.
- **Standing gaps:** micronutrients persistently under reference intake over 7 days.
- **Tone:** opportunities, never failures. "Three days without a vegetable serving" is a
  fact; "you failed your vegetable goal" is a defect.
- No scores, no grades, no letter ratings. A single aggregate score would flatten exactly
  the nuance the warnings exist to preserve.

---

## 12. Data model

```ts
Profile {
  heightCm: 197
  dob: '[the owner's date of birth]'
  sex: 'male'
  activityLevel: 'sedentary'|'light'|'moderate'|'active'|'veryActive'
  weightLog: { date: string; kg: number }[]     // current = latest
  flaggedAllergens: string[]                    // empty initially
  conditions: string[]                          // empty initially, extensible
  overrides?: Partial<Targets>                  // manual target overrides
}

DiaryEntry {
  id: string
  at: string                 // ISO datetime
  rawText: string            // exactly what was typed, kept verbatim
  resolution: 'local'|'ai'|'manual'|'batch'
  items: FoodRef[]
  nutrients: NutrientSet     // snapshotted at commit time
  coverage: Partial<Record<NutrientKey, 'known'|'partial'|'unknown'>>
  warningsShown: { ruleId: string; level: Level }[]
  userAction: 'added'|'addedAfterAlternatives'|'cancelled'

  // corrections — G1's "no silent removal"
  state: 'active'|'deleted'|'superseded'
  supersededBy?: string      // id of the corrected entry
  revisionOf?: string        // id of the entry this corrects
}

FoodRef {
  source: 'dataset'|'custom'|'batch'
  foodId: string
  grams: number
  portionLabel?: string      // "1 frankfurter", "1 portion"
}

CustomFood {
  id: string
  name: string
  synonyms: string[]
  referencePortion: { label: string; grams: number }
  nutrientsPer100g: Partial<NutrientSet>   // absent key = unknown, never zero
  classification: ClassificationFlags
  allergens: string[]
  createdAt: string
}

Batch {
  id: string
  name: string
  ingredients: { raw: string; resolved?: FoodRef }[]
  portionCount: number
  totalCookedGrams?: number        // labelling only; never rescales nutrients
  nutrientsPerPortion: NutrientSet
  coverage: Partial<Record<NutrientKey, 'known'|'partial'|'unknown'>>
  classification: ClassificationFlags   // inherited from ingredients, worst case wins
  portionsRemaining: number
  cookedAt: string
}
```

**Corrections and deletion.** Mis-parses are expected — that is why `rawText` is kept — so
correcting an entry is a normal daily path, not an edge case. An edit creates a new entry
marked `revisionOf`, sets the original to `superseded`, and **re-runs the warning gate**, so
a correction that reveals a concern still shows it. A delete is a tombstone (`state:
'deleted'`), not a removal: the row survives for the learning history, disappears from the
diary UI, and leaves all totals and 7-day frequency counts. Hard deletion exists only as
"erase everything" in settings. Choosing tombstones now avoids a migration later (G8), and
"no silent removal" (G1) means the UI always confirms and always says what the deletion
changes about today's totals.

**The owner's profile is never committed to the repository.** C2 forbids secrets in a public
repo, and G7 keeps personal data on the device; a date of birth seeded into source would be
public and permanent in git history. The profile is therefore asked on first run — body
data, activity level, optional allergens — with nothing prefilled and no personal values
anywhere in the source tree. The engine must behave sanely with an empty profile: before
setup, generic adult reference values are used and every card states that it is using
general guidelines.

Two deliberate choices:

- **`rawText` is kept verbatim** so parser quality can be improved against real history,
  and so a mis-parse is always traceable.
- **`warningsShown` and `userAction` are recorded, including cancellations.** This is what
  makes the app a teacher over months: it can later show which warnings actually changed
  behaviour. Cancelled entries are stored but excluded from all nutritional totals.

Nutrients are **snapshotted** at commit time rather than recomputed from food IDs, so a
later dataset update never silently rewrites history.

**Export/import:** one-tap export of the whole store as a single JSON file, and import with
a merge-or-replace choice. This is the answer to having no sync, and also the backup story
— browser storage can be cleared by the browser itself.

---

## 13. Screens

1. **Log** (home) — single text field, big tap target, recent entries below. One-tap
   re-log of anything recent.
2. **Warning gate** — a sheet over the Log screen. Cards, then the three actions.
3. **Alternatives** — swaps with the comparison that matters for the triggered rule.
4. **Diary** — day view, week view, entry detail with the warnings that were shown.
5. **What's missing** — §11.
6. **My foods & batches** — custom food editor, batch builder with portion count, and the
   fridge list of batches with portions remaining.
7. **Profile & settings** — body data, weight log, allergen flags, activity level, target
   overrides, DeepSeek key, export/import, erase everything.
8. **First run** — profile setup, nothing prefilled, skippable with generic adult defaults.

Mobile-first throughout; the desktop layout is the same screens widened.

---

## 14. What's left to the builder

- Exact parser algorithm and fuzzy-matching strategy; the confidence threshold at which the
  AI fallback engages.
- Final dataset subset selection and sharding, within the C4 budget.
- Component structure, state management choice, and styling specifics.
- Service-worker caching strategy and dataset versioning.
- Test strategy. Two areas need real coverage: the rule engine's level decisions against
  fixture contexts, and the tone rules of §9.5 as assertions over generated card text.
- The curated classification layer's per-food assignments (§8 step 4).
- **Verification of every threshold and citation in §9.3 against its primary source.**

## 15. Designer's calls, flagged for the owner to check

These were not decided by the owner and are open to correction:

1. Activity level defaults to *lightly active* (×1.375) and is asked on first run.
2. Protein target set at 1.2 g/kg (120 g), above the 0.8 g/kg RDA, as a health rather than
   minimum-sufficiency target.
3. Sodium target follows WHO's 2,000 mg rather than the US 2,300 mg.
4. No BMI, no weight judgments, no aggregate health score (§9.4, §11).
5. CRITICAL is reserved for safety only; nutrition never reaches it (§9.2).
6. At most three warning cards per entry.
7. Cancelled entries are stored for learning, excluded from totals (§12).
8. The AI fallback is off until a key is entered, and sends only the single unresolved
   phrase — never diary, profile or totals (§10).

Settled after the builder review, from constraints already agreed — flagged so you can
check them while reading:

9. "Projected day" is today's totals plus the pending entry, with no extrapolation. Daily
   rules therefore cannot fire at breakfast; the weekly view carries the forward look (§9.3).
10. Where a primary source contradicts a threshold, the source wins; where it supports the
    concern but no defensible number, the rule goes qualitative; where it supports neither,
    the rule is dropped and the removal recorded (§9.3).
11. Bundled citations store a short verbatim statement of the source's conclusion, so a
    claim can be read offline; the URL is a link out, not the content (§9.3).
12. The allergen layer is built now against the EU's 14 declarable groups, though the list
    ships empty, so adding one later needs no migration (§9.2).
13. Food-safety CRITICAL rules ask one direct question in the gate rather than guessing
    preparation from your words (§9.2).
14. Edits create a revision and re-run the warning gate; deletes are tombstones, not
    removals, and always confirmed (§12).
15. Your profile is asked on first run and never committed to the public repository (§12).
16. Unknown nutrients stay unknown, never zero: affected rules stay silent, and daily
    totals show a known floor with a coverage note (§10a.1).

## Verification log

### Nutrient rules (Task 11), checked 2026-11-16

Sources were read from WHO's own pages and documents (the sodium guideline text, the 2023 saturated and trans fat
guideline PDF, the WHO sugars news item and fact sheets). Where a page gave a statement only in summary, the table
says so. The values in the §9.3 table above are superseded by this log.

| Rule | Plan figure | What the source says | Result |
|---|---|---|---|
| Sodium, daily | > 2,000 mg (WHO) | WHO Guideline: Sodium intake for adults and children (2012): "a reduction to <2 g/day sodium (5 g/day salt) in adults (strong recommendation)". Blood-pressure evidence rated high quality. Also on WHO's sodium fact sheet. | **Confirmed.** Level MODERATE above 2,000 mg. HIGH from 1.5 times the figure, a presentation grading that is not a WHO number. |
| Sodium, single entry | > 600 mg | The guideline and fact sheet state intake as an average daily figure. Neither gives any figure for a single meal or serving. 600 mg is not a published guideline. | **Changed to qualitative.** Fires only when one entry alone exceeds WHO's whole-day figure. The card states that WHO sets no single-serving limit. No 600 mg anywhere. |
| Added sugar, daily | > 10% of energy; 5% better | WHO Guideline: Sugars intake (2015): free sugars below 10% of total energy (strong); a further reduction below 5%, about 25 g (conditional). | **Confirmed, with a caveat.** MODERATE above 10%; INFO above 5% (conditional). WHO's measure is *free* sugars (adds juice and honey sugars); the diary counts *added* sugars, so it can understate. The card says so. Certainty of the sugar evidence was not read at source, so strength is declared 'moderate', not 'strong'. |
| Added sugar, single entry | > 15 g | WHO states no per-serving limit (the article gives examples such as a can of soda only). 15 g is not a published figure. | **Changed to qualitative.** INFO above the day's 5% figure, MODERATE above the day's 10% figure, on one entry, with a card saying no single-serving limit exists. No 15 g anywhere. |
| Saturated fat, daily | > 10% of energy | WHO 2023 guideline: "reduce saturated fatty acid intake to 10% of total energy intake (strong recommendation)". Certainty of evidence for that recommendation: moderate, from trials with cardiovascular outcomes. Going below 10% is a separate conditional recommendation on very-low-certainty evidence. | **Confirmed.** MODERATE above 10%. No sub-10% tier. Strength declared 'moderate' (certainty), not 'strong' (recommendation). Alternative offered (polyunsaturated fat) is WHO's own strong replacement recommendation. |
| Trans fat | any industrial; day > 1% of energy | WHO 2023: "reduce trans-fatty acid intake to 1% of total energy intake (strong recommendation)", moderate certainty. The definition covers all trans fat, ruminant and industrial alike. The remark is that foods with *high levels* of industrial trans fat should largely be avoided. | **Changed.** Food data does not separate industrial from ruminant trans fat, so "any industrial trans fat" cannot be detected, and "any trans fat" would fire on milk. The rule fires HIGH only when one entry alone exceeds the whole-day 1% figure, and says so. Strength declared 'moderate'. |

Cross-cutting findings:

- Every WHO figure is a population recommendation for usual intake. Each daily card says one day above it is not by
  itself a problem, and no card attributes disease to one serving.
- Single-entry cards compare one entry with a whole-day figure and say plainly that no single-serving guideline exists.
  They are the only place the app applies a daily figure to one entry, and they exist partly so a day with incomplete
  data (where the daily rule stays silent by its coverage gate) still gets a card when one entry is large.
- No rule was dropped.
- Citation conclusions are WHO's own words. The sugars conclusion joins two sentences from the WHO sugars news item
  and labels each with the strength WHO gives it ("their" dropped from the first); the other three are single
  sentences from the guideline text.
- Not checked at source: the sugars guideline's per-outcome certainty ratings (the full document could not be
  fetched; the WHO page and news item were read). Declared 'moderate' accordingly.
- The 2012 sodium guideline covers adults and, adjusted for energy needs, children aged 2 to 15. The app's targets use
  the adult figure; a child's profile would need a scaled figure (not implemented).
