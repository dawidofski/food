# Food dataset pipeline

`scripts/build-food-db.ts` turns USDA downloads into the static dataset the app fetches
(`public/data/foods.<hash>.json` + `public/data/meta.json`). It is run by hand and its output is committed.
**Never commit the raw USDA archives or CSVs** - keep them outside the repo.

Invariant: an absent nutrient key means "not known", never zero. A value is written only when USDA supplies a
finite, non-negative number. Blank means unknown. Nothing is estimated, and total sugars are never used as added sugars.

## What to download

1. **FNDDS / Survey Foods, CSV** - https://fdc.nal.usda.gov/download-datasets , "Survey Foods (FNDDS)" CSV.
   Used: `FoodData_Central_survey_food_csv_2024-10-31.zip` (FNDDS 2021-2023, 5,432 foods as eaten, with portions).
2. **FPED** (Food Patterns Equivalents Database, per 100 g of FNDDS foods) -
   https://www.ars.usda.gov/northeast-area/beltsville-md-bhnrc/beltsville-human-nutrition-research-center/food-surveys-research-group/docs/fped-databases/
   Used: `https://www.ars.usda.gov/ARSUserFiles/80400530/apps/FPED_2123.xls` (FPED 2021-2023, matches FNDDS 2021-2023).
   The release year must match the FNDDS release. If it does not, use the nearest year and set `fpedMatchesFndds: false`
   and `fpedYearUsed` in `sources.json`; both are copied into `meta.json`.
   (The FPED page lists the 2021-2023 file only in the FPED_2123 link pattern above; older years are `FPED_1718.xls` etc.)

Foundation Foods is not used: its CSV release contains lab sample tables but no `food.csv` / `food_nutrient.csv`
with per-food nutrient values, so it cannot be joined the same way. FNDDS already covers the foods as eaten.

## Where to put them

Create an input directory **outside the repo** (example `~/usda-in`):

```
usda-in/
  sources.json          # hand-written, see below
  fped.csv              # FPED_2123.xls converted to CSV (step below)
  survey/
    food.csv
    survey_fndds_food.csv
    food_nutrient.csv
    nutrient.csv
    food_portion.csv
    wweia_food_category.csv
```

Unzip the survey archive and copy those six CSVs into `survey/`. Convert FPED (it is a legacy `.xls`):

```
pip install xlrd
python -I scripts/fped-xls-to-csv.py FPED_2123.xls usda-in/fped.csv
```

`sources.json` records provenance (the build refuses to run without it):

```json
{
  "fdcRelease": "FNDDS 2021-2023, FoodData Central survey_food_csv release 2024-10-31",
  "fpedRelease": "FPED 2021-2023 (FPED_2123.xls, per 100 g of FNDDS 2021-2023 foods)",
  "fpedYearUsed": "2021-2023",
  "fpedMatchesFndds": true
}
```

## Run

```
npm run build:data -- /path/to/usda-in public/data
gzip -c public/data/foods.*.json | wc -c     # must stay under 3,000,000 (constraint C4)
```

(`node scripts/build-food-db.ts <inputDir> [outDir]`, Node 22.18+ / 24 runs TypeScript directly.)
Then commit `public/data/`. Old `foods.*.json` files in the output directory are removed; `meta.json.file` names the current one.

## How values are derived

- Per-100 g nutrients come from FNDDS `food_nutrient.csv`, matched by USDA `nutrient_nbr`, units verified (the build aborts on a unit mismatch).
  `folateUg` is *Folate, total*. FNDDS does not report **trans fat**, so `transFatG` is absent for every food.
- `addedSugarsG` = FPED `ADD_SUGARS` (teaspoon equivalents) x 4.2 g. FPED rows flagged `NO_COMPONENTS` are treated as unknown
  (their zeros are not measurements), so those foods have neither `addedSugarsG` nor `fped`. Foods with no FPED row are likewise omitted, never zeroed.
- `fped` = `V_TOTAL`, `F_TOTAL`, `G_WHOLE` (cup / cup / oz equivalents per 100 g).
- `portions` = FNDDS portion rows with a positive gram weight; "Quantity not specified" and duplicates are dropped. Labels are USDA's ("1 regular", "1 cup").
- A food with no nutrient rows at all is dropped (FNDDS "Milk, human").
- Classification flags and allergen tags come from `scripts/classification.ts` (curated, not USDA data). Allergen tags are
  indicative only: an absent tag is not a guarantee a food is free of that allergen.

## Last real build

- Source: FNDDS 2021-2023 (FDC release 2024-10-31) + FPED 2021-2023 (same period, no fallback year).
- **5,431 foods**; foods file 4,274,370 bytes, **451,522 bytes gzipped** (budget 3 MB). No subset cut was needed.
- `addedSugarsG` / `fped` present for 5,223 foods (209 `NO_COMPONENTS` rows omitted).

## Tests

`npx vitest run tests/scripts/build-food-db.test.ts` builds from the ~20-row real-format slices in `tests/fixtures/usda/`
(real FNDDS/FPED rows plus one synthetic row named `Test food, no FPED`).
