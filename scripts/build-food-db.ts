/**
 * Builds the static food dataset from USDA FoodData Central (FNDDS survey foods) + FPED.
 * Run by hand (see scripts/README.md); the generated JSON is committed, the raw downloads are not.
 *
 * Invariant: an absent nutrient key means "not known", never zero. A nutrient is emitted only when
 * USDA supplies a finite, non-negative number for that food. Nothing is defaulted, estimated or borrowed
 * from another nutrient (total sugars are never used as added sugars).
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatasetFood } from '../src/types/food';
import type { NutrientKey, NutrientSet } from '../src/types/nutrients';
import { allergensFor, classifyFood } from './classification.ts';

export const CITATION =
  'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (FNDDS survey foods) and ' +
  'Food Patterns Equivalents Database (FPED). Public domain, CC0 1.0 Universal. https://fdc.nal.usda.gov/';

const ALLERGEN_NOTE =
  'Allergen tags are indicative, derived from food category and description. The absence of a tag does NOT ' +
  'mean a food is free of that allergen.';

/** 1 teaspoon-equivalent of added sugars = 4.2 g (FPED documentation). */
const GRAMS_PER_ADDED_SUGAR_TSP = 4.2;

interface NutrientSpec {
  /** USDA nutrient_nbr (stable across releases). */
  nbr: string;
  /** Unit USDA must report for that nutrient; a mismatch aborts the build rather than guessing a conversion. */
  unit: string;
}

/** FNDDS nutrients -> dataset keys. addedSugarsG is absent on purpose: FNDDS has none, it comes from FPED. */
const FNDDS_NUTRIENTS: Record<Exclude<NutrientKey, 'addedSugarsG'>, NutrientSpec> = {
  energyKcal: { nbr: '208', unit: 'KCAL' },
  proteinG: { nbr: '203', unit: 'G' },
  fatG: { nbr: '204', unit: 'G' },
  satFatG: { nbr: '606', unit: 'G' },
  transFatG: { nbr: '605', unit: 'G' },
  carbG: { nbr: '205', unit: 'G' },
  sugarsG: { nbr: '269', unit: 'G' },
  fibreG: { nbr: '291', unit: 'G' },
  sodiumMg: { nbr: '307', unit: 'MG' },
  potassiumMg: { nbr: '306', unit: 'MG' },
  calciumMg: { nbr: '301', unit: 'MG' },
  ironMg: { nbr: '303', unit: 'MG' },
  magnesiumMg: { nbr: '304', unit: 'MG' },
  zincMg: { nbr: '309', unit: 'MG' },
  vitaminCMg: { nbr: '401', unit: 'MG' },
  vitaminDUg: { nbr: '328', unit: 'UG' },
  vitaminB12Ug: { nbr: '418', unit: 'UG' },
  folateUg: { nbr: '417', unit: 'UG' }, // Folate, total
};

type Row = Record<string, string>;

/** Minimal RFC 4180 CSV reader (quoted fields, escaped quotes, newlines inside quotes, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readTable(path: string): Promise<Row[]> {
  const [header, ...body] = parseCsv(await readFile(path, 'utf8'));
  if (!header) throw new Error(`${path}: empty file`);
  return body.map((cells) => {
    const r: Row = {};
    header.forEach((h, i) => {
      r[h] = cells[i] ?? '';
    });
    return r;
  });
}

function need(row: Row, col: string, file: string): string {
  const v = row[col];
  if (v === undefined) throw new Error(`${file}: missing column "${col}"`);
  return v;
}

/** Finite, non-negative number from a CSV cell, or undefined. Blank means unknown, never 0. */
function num(cell: string | undefined): number | undefined {
  if (cell === undefined || cell.trim() === '') return undefined;
  const v = Number(cell);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Four significant digits: keeps the file small without ever rounding a real value to zero. */
const round = (v: number): number => (v === 0 ? 0 : Number(v.toPrecision(4)));

interface Sources {
  fdcRelease: string;
  fpedRelease: string;
  fpedYearUsed: string;
  fpedMatchesFndds: boolean;
}

async function readSources(inputDir: string): Promise<Sources> {
  const path = join(inputDir, 'sources.json');
  let raw: Partial<Sources>;
  try {
    raw = JSON.parse(await readFile(path, 'utf8')) as Partial<Sources>;
  } catch {
    throw new Error(`${path} is required: it records which USDA releases the CSVs came from (see scripts/README.md)`);
  }
  const { fdcRelease, fpedRelease, fpedYearUsed, fpedMatchesFndds } = raw;
  if (!fdcRelease || !fpedRelease || !fpedYearUsed || typeof fpedMatchesFndds !== 'boolean') {
    throw new Error(`${path} must define fdcRelease, fpedRelease, fpedYearUsed and fpedMatchesFndds`);
  }
  return { fdcRelease, fpedRelease, fpedYearUsed, fpedMatchesFndds };
}

interface FpedEntry {
  addedSugarsG?: number;
  fped?: NonNullable<DatasetFood['fped']>;
}

/** FPED headers look like "F_TOTAL (cup eq.)" or "PF_CUREDMEAT \n(oz. eq.)"; the first token is the name. */
async function readFped(path: string): Promise<Map<string, FpedEntry>> {
  const [header, ...body] = parseCsv(await readFile(path, 'utf8'));
  if (!header) throw new Error(`${path}: empty file`);
  const col = new Map<string, number>();
  header.forEach((h, i) => col.set(h.trim().split(/[\s(]/)[0] ?? h, i));
  const idx = (name: string): number => {
    const i = col.get(name);
    if (i === undefined) throw new Error(`${path}: missing column ${name}`);
    return i;
  };
  const [cCode, cFruit, cVeg, cWhole, cAdd, cNone] = ['FOODCODE', 'F_TOTAL', 'V_TOTAL', 'G_WHOLE', 'ADD_SUGARS', 'NO_COMPONENTS'].map(idx) as [
    number, number, number, number, number, number,
  ];
  const out = new Map<string, FpedEntry>();
  for (const cells of body) {
    const code = (cells[cCode] ?? '').trim();
    if (!code) continue;
    // FPED marks foods it could not break into food-group components. Its zeros for those rows are not
    // measurements (e.g. a sweetened drink mix shows 0 added sugars), so the whole row is treated as unknown.
    const noComponents = (cells[cNone] ?? '').trim();
    if (noComponents !== '' && noComponents !== '0') continue;
    const entry: FpedEntry = {};
    const add = num(cells[cAdd]);
    if (add !== undefined) entry.addedSugarsG = round(add * GRAMS_PER_ADDED_SUGAR_TSP);
    const veg = num(cells[cVeg]);
    const fruit = num(cells[cFruit]);
    const whole = num(cells[cWhole]);
    if (veg !== undefined && fruit !== undefined && whole !== undefined) {
      entry.fped = { vegCupEq: round(veg), fruitCupEq: round(fruit), wholeGrainOzEq: round(whole) };
    }
    out.set(code, entry);
  }
  return out;
}

/** food_nutrient.nutrient_id holds nutrient_nbr in the FNDDS CSVs and nutrient.id in others; pick the one that matches. */
function nutrientKeyColumn(nutrients: Row[], foodNutrients: Row[]): 'nutrient_nbr' | 'id' {
  const nbrs = new Set(nutrients.map((n) => n['nutrient_nbr']));
  const ids = new Set(nutrients.map((n) => n['id']));
  let byNbr = 0;
  let byId = 0;
  for (const fn of foodNutrients.slice(0, 5000)) {
    const k = fn['nutrient_id'] ?? '';
    if (nbrs.has(k)) byNbr++;
    if (ids.has(k)) byId++;
  }
  return byNbr >= byId ? 'nutrient_nbr' : 'id';
}

export async function buildFoodDb(inputDir: string, outDir: string): Promise<{ count: number; bytes: number }> {
  const sources = await readSources(inputDir);
  const survey = join(inputDir, 'survey');
  const [foodRows, fnddsRows, nutrientRows, foodNutrientRows, portionRows, categoryRows] = await Promise.all([
    readTable(join(survey, 'food.csv')),
    readTable(join(survey, 'survey_fndds_food.csv')),
    readTable(join(survey, 'nutrient.csv')),
    readTable(join(survey, 'food_nutrient.csv')),
    readTable(join(survey, 'food_portion.csv')),
    readTable(join(survey, 'wweia_food_category.csv')),
  ]);
  const fped = await readFped(join(inputDir, 'fped.csv'));

  // Resolve each wanted nutrient to the key used in food_nutrient, verifying the unit.
  const keyColumn = nutrientKeyColumn(nutrientRows, foodNutrientRows);
  const keyByUsdaId = new Map<string, Exclude<NutrientKey, 'addedSugarsG'>>();
  for (const [key, spec] of Object.entries(FNDDS_NUTRIENTS) as [Exclude<NutrientKey, 'addedSugarsG'>, NutrientSpec][]) {
    const def = nutrientRows.find((n) => n['nutrient_nbr'] === spec.nbr);
    if (!def) continue; // this release does not define the nutrient: it stays unknown
    const unit = (def['unit_name'] ?? '').toUpperCase();
    if (unit !== spec.unit) throw new Error(`nutrient ${spec.nbr} (${key}) is reported in ${unit}, expected ${spec.unit}`);
    keyByUsdaId.set(def[keyColumn] ?? '', key);
  }

  const nutrientsByFdc = new Map<string, NutrientSet>();
  for (const fn of foodNutrientRows) {
    const key = keyByUsdaId.get(need(fn, 'nutrient_id', 'food_nutrient.csv'));
    if (!key) continue;
    const amount = num(fn['amount']);
    if (amount === undefined) continue; // blank/invalid => unknown, never 0
    const set = nutrientsByFdc.get(need(fn, 'fdc_id', 'food_nutrient.csv')) ?? {};
    set[key] = round(amount);
    nutrientsByFdc.set(fn['fdc_id'] ?? '', set);
  }

  const portionsByFdc = new Map<string, { seq: number; label: string; grams: number }[]>();
  for (const p of portionRows) {
    const label = (p['portion_description'] ?? '').trim();
    const grams = num(p['gram_weight']);
    // "Quantity not specified" is a default weight, not a portion a person can pick.
    if (!label || /^quantity not specified$/i.test(label) || grams === undefined || grams <= 0) continue;
    const list = portionsByFdc.get(p['fdc_id'] ?? '') ?? [];
    list.push({ seq: Number(p['seq_num']) || 0, label, grams: round(grams) });
    portionsByFdc.set(p['fdc_id'] ?? '', list);
  }

  const categoryName = new Map(categoryRows.map((c) => [c['wweia_food_category'] ?? '', (c['wweia_food_category_description'] ?? '').trim()]));
  const codeByFdc = new Map(fnddsRows.map((f) => [f['fdc_id'] ?? '', f['food_code'] ?? '']));

  const foods: DatasetFood[] = [];
  for (const f of foodRows) {
    const id = need(f, 'fdc_id', 'food.csv');
    const foodCode = codeByFdc.get(id);
    const per100g = nutrientsByFdc.get(id);
    if (!foodCode || !per100g) continue; // not an FNDDS survey food, or no nutrient data at all
    const name = need(f, 'description', 'food.csv').trim();
    const category = f['food_category_id'] ?? '';
    const fp = fped.get(foodCode);
    const nutrients: NutrientSet = { ...per100g };
    if (fp?.addedSugarsG !== undefined) nutrients.addedSugarsG = fp.addedSugarsG;
    const portions = (portionsByFdc.get(id) ?? [])
      .sort((a, b) => a.seq - b.seq)
      .filter((p, i, all) => all.findIndex((q) => q.label === p.label) === i)
      .map(({ label, grams }) => ({ label, grams }));
    const group = categoryName.get(category);
    const food: DatasetFood = {
      id,
      name,
      synonyms: group && group.toLowerCase() !== name.toLowerCase() ? [group] : [],
      per100g: nutrients,
      portions,
      classification: classifyFood(foodCode, category),
      allergens: allergensFor(foodCode, category),
    };
    if (fp?.fped) food.fped = fp.fped;
    foods.push(food);
  }
  foods.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const json = JSON.stringify(foods);
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 10);
  const file = `foods.${hash}.json`;
  await mkdir(outDir, { recursive: true });
  for (const old of await readdir(outDir)) {
    if (/^foods\.[0-9a-f]+\.json$/.test(old) && old !== file) await rm(join(outDir, old));
  }
  await writeFile(join(outDir, file), json);
  const meta = {
    fdcRelease: sources.fdcRelease,
    fpedRelease: sources.fpedRelease,
    fpedYearUsed: sources.fpedYearUsed,
    fpedMatchesFndds: sources.fpedMatchesFndds,
    builtAt: new Date().toISOString(),
    citation: CITATION,
    allergenNote: ALLERGEN_NOTE,
    count: foods.length,
    file,
  };
  await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return { count: foods.length, bytes: Buffer.byteLength(json) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputDir, outDir = 'public/data'] = process.argv.slice(2);
  if (!inputDir) {
    console.error('usage: node scripts/build-food-db.ts <inputDir> [outDir=public/data]');
    process.exit(2);
  }
  buildFoodDb(inputDir, outDir).then(
    ({ count, bytes }) => console.log(`built ${count} foods, ${bytes} bytes -> ${outDir}`),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
