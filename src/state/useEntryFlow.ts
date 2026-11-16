import { useHoldUpdates } from '@/state/updates';
import { useCallback, useRef, useState } from 'react';
import { addEntry, countActiveEntries, decrementBatchPortion, deleteEntry, entriesBetween, getProfile, reviseEntry } from '@/data/db';
import { batchHasCustomIngredient, batchWeightKnown, portionsFor, refreshBatches, withBatches } from '@/domain/batches';
import { datasetLookup } from '@/data/datasetLookup';
import { refreshCustomFoods, withCustomFoods } from '@/domain/customFoods';
import { datasetState, loadFoods } from '@/data/foodRepository';
import { offProductMeta, refreshOffFoods, withOpenFoodFacts } from '@/data/offCache';
import { last7DayKeys, localDayRange } from '@/domain/dayBoundary';
import type { FoodLookup } from '@/domain/foodLookup';
import { parseEntry, type ParsedItem } from '@/domain/parseEntry';
import { resolveItems, resolveKnownFood } from '@/domain/resolveItems';
import { applyAi, type AiApplied, type AiDeps, type AiReading } from '@/ai/aiFallback';
import { interpretEntry } from '@/ai/deepseek';
import { getApiKey, isAiEnabled } from '@/state/aiSettings';
import { computeTargets } from '@/domain/targets';
import { dayTotals, weekContext } from '@/domain/totals';
import { unusualServing, type UnusualServing } from '@/domain/unusualServing';
import { catalogue } from '@/rules/catalogue';
import { foodsAskedAbout, rememberedAnswers, rememberNo } from '@/state/safetyMemory';
import { evaluate } from '@/rules/engine';
import type { Context, FoodIdentity, Rule, RuleFailure, SafetyQuestion, WarningCard } from '@/rules/types';
import type { DiaryEntry, FoodRef, FoodSource, Resolution } from '@/types/diary';
import type { DatasetFood } from '@/types/food';
import type { Profile } from '@/types/profile';

export type FlowStage = 'idle' | 'resolving' | 'needsHelp' | 'aiReview' | 'questions' | 'gate' | 'committed';

/** What one parsed item resolved to: the user's only check against a near-miss match. */
export type ResolvedLine = {
  name: string;
  /** Where the numbers came from; 'custom' is shown as self-reported, 'off' as read from Open Food Facts. */
  source: FoodSource;
  count?: number;
  portionLabel?: string;
  /** Grams of one unit of the portion label (e.g. one frankfurter), when it can be worked out. */
  perPortionGrams?: number;
  grams: number;
  /** True for a batch portion nobody weighed: the nominal grams are internal only and must never be shown. */
  weightUnknown?: boolean;
  /** A batch with a custom-food ingredient inherits the self-reported marking. */
  selfReported?: boolean;
  /** For a scanned product: ISO datetime of the last edit anyone made to it in Open Food Facts. */
  offLastModified?: string;
  /** For a scanned product: ISO datetime this app fetched it, so a cached figure never reads as a fresh one. */
  offFetchedAt?: string;
  unusual?: UnusualServing;
};

export type FlowDeps = {
  lookup: FoodLookup;
  rules: Rule[];
  now: () => Date;
  loadData: () => Promise<void>;
  isDataReady: () => boolean;
  store: {
    addEntry: typeof addEntry;
    entriesBetween: typeof entriesBetween;
    getProfile: () => Promise<Profile | null>;
    /** Optional so a caller that never corrects an entry need not supply them; the diary falls back to the real store. */
    reviseEntry?: typeof reviseEntry;
    deleteEntry?: typeof deleteEntry;
    /** How many live entries exist, for the diary's backup reminder. Optional for the same reason. */
    countActiveEntries?: typeof countActiveEntries;
  };
  /** The optional AI fallback for a phrase the local parser could not resolve. Absent means off. */
  ai?: AiDeps;
};

export const defaultDeps: FlowDeps = {
  // Order matters on an exact-name tie: the person's own food first, then a product they scanned, then the dataset.
  lookup: withBatches(withCustomFoods(withOpenFoodFacts(datasetLookup))),
  rules: catalogue,
  now: () => new Date(),
  loadData: async () => {
    await loadFoods();
    // The person's own foods are optional: if they cannot be read, the dataset still works.
    await refreshCustomFoods().catch(() => undefined);
    await refreshBatches().catch(() => undefined);
    await refreshOffFoods().catch(() => undefined);
  },
  isDataReady: () => datasetState() === 'ready',
  store: { addEntry, entriesBetween, getProfile, reviseEntry, deleteEntry, countActiveEntries },
  ai: {
    isEnabled: isAiEnabled,
    getKey: getApiKey,
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    interpret: interpretEntry,
  },
};

export type Outcome = { action: 'added' | 'cancelled'; lines: ResolvedLine[]; failures: RuleFailure[] };

type Session = {
  text: string;
  resolution: Resolution;
  lines: ResolvedLine[];
  foods: FoodIdentity[];
  base: Omit<Context, 'answers'>;
  answers: Record<string, boolean>;
  viewedAlternatives: boolean;
  /** Failures from reading history, carried into every evaluation's note. */
  carried: RuleFailure[];
  /** True when the model helped read the entry, so it is stored as 'ai' and the person saw it flagged. */
  viaAi: boolean;
  /** Set when this entry corrects an existing one: it is stored as a revision, keeping the original time. */
  revises?: Revises;
};

/** The entry being corrected. `at` is when the food was eaten, which a correction does not change. */
export type Revises = { id: string; at: string };

export type EntryFlow = {
  stage: FlowStage;
  cards: WarningCard[];
  questions: SafetyQuestion[];
  failures: RuleFailure[];
  lines: ResolvedLine[];
  unresolved: ParsedItem[];
  /** While stage is 'aiReview': how the model read each unresolved phrase. Nothing runs until the person accepts it. */
  aiReadings: AiReading[];
  /** True when the food database could not be loaded, so nothing could be matched. */
  dataMissing: boolean;
  viewingAlternatives: boolean;
  outcome: Outcome | null;
  error: string | null;
  /** The text the person last submitted, so a correction can start from it. */
  lastText: string;
  /** True when this entry was checked against the generic adult targets because no profile is set up. */
  genericTargets: boolean;
  /** Bumps whenever an entry (including a cancelled one) is stored, so lists can refresh. */
  storedCount: number;
  /** With `revises`, the entry is stored as a revision of that entry, and only once the gate has been passed. */
  submit: (text: string, opts?: { revises?: Revises }) => Promise<void>;
  /**
   * A food that is already known, at a gram amount the person set: the path a scanned barcode takes. The text is
   * only what gets stored as `rawText` and shown in the diary; the food is NOT searched for again, so no
   * near-miss can substitute a different product for the one in the person's hand. From here on it is an
   * ordinary entry: the same rules, the same warning gate, the same confirmation. Nothing is added silently.
   */
  submitKnownFood: (food: DatasetFood, grams: number, text: string, source?: FoodSource) => Promise<void>;
  answer: (answerKey: string, yes: boolean) => void;
  addAnyway: () => Promise<void>;
  showAlternatives: () => void;
  backToGate: () => void;
  cancel: () => Promise<void>;
  /** Drops the pending entry without storing anything and returns to the text field. */
  edit: () => void;
  /** Accept the model's reading and go on to the checks, which run on the dataset's numbers as usual. */
  acceptAi: () => Promise<void>;
  /** Discard the model's reading and fall back to manual entry. */
  rejectAi: () => void;
  /** Continue with the foods that did resolve, leaving the unresolved ones out (the person chose this). */
  continueWithout: () => Promise<void>;
  dismissOutcome: () => void;
};

const unitGrams = (label: string | undefined, grams: number, count: number | undefined): number | undefined => {
  if (label === undefined || count === undefined || !(count > 0)) return undefined;
  const m = /^\s*(?:(\d+(?:\.\d+)?)(?:\/(\d+))?\s*)?/.exec(label);
  let n = m?.[1] !== undefined ? Number(m[1]) : 1;
  if (m?.[2] !== undefined) n /= Number(m[2]);
  if (!(n > 0)) return undefined;
  const v = (grams / count) * n;
  return Number.isFinite(v) ? v : undefined;
};

/** refs are the resolved items in order, so walk the parsed items skipping the ones that went to needsHelp. */
function describeLines(items: ParsedItem[], res: Resolution, lookup: FoodLookup): ResolvedLine[] {
  const skipped = new Set(res.needsHelp);
  const resolved = items.filter((i) => !skipped.has(i));
  return res.refs.map((ref, idx) => {
    const item = resolved[idx];
    const food = lookup.get(ref.source, ref.foodId);
    const count = item?.quantity.count;
    const unweighed = ref.source === 'batch' && !batchWeightKnown(ref.foodId);
    const off = ref.source === 'off' ? offProductMeta(ref.foodId) : undefined;
    // An unweighed batch portion has a nominal gram figure that means nothing, so it is never judged or displayed.
    const unusual = item && !unweighed ? unusualServing(item, ref.grams, food) : null;
    const perPortionGrams = unitGrams(ref.portionLabel, ref.grams, count);
    return {
      name: food?.name ?? ref.foodId,
      source: ref.source,
      grams: ref.grams,
      ...(unweighed ? { weightUnknown: true } : {}),
      ...(ref.source === 'batch' && batchHasCustomIngredient(ref.foodId) ? { selfReported: true } : {}),
      ...(off ? { offFetchedAt: off.fetchedAt } : {}),
      ...(off?.lastModified !== undefined ? { offLastModified: off.lastModified } : {}),
      ...(count !== undefined && item?.quantity.grams === undefined ? { count } : {}),
      ...(ref.portionLabel !== undefined ? { portionLabel: ref.portionLabel } : {}),
      ...(perPortionGrams !== undefined ? { perPortionGrams } : {}),
      ...(unusual ? { unusual } : {}),
    };
  });
}

function identities(refs: FoodRef[], lookup: FoodLookup): FoodIdentity[] {
  const out: FoodIdentity[] = [];
  for (const r of refs) {
    const f = lookup.get(r.source, r.foodId);
    if (f) out.push({ name: f.name, allergens: [...f.allergens], source: r.source });
  }
  return out;
}

/** Entry-level fped exists only when EVERY item has it: a partial total would read as "known" when part is unknown. */
function sumFped(refs: FoodRef[]): DiaryEntry['fped'] {
  if (refs.length === 0 || refs.some((r) => !r.fped)) return undefined;
  const total = { vegCupEq: 0, fruitCupEq: 0, wholeGrainOzEq: 0 };
  for (const r of refs) {
    total.vegCupEq += r.fped!.vegCupEq;
    total.fruitCupEq += r.fped!.fruitCupEq;
    total.wholeGrainOzEq += r.fped!.wholeGrainOzEq;
  }
  return total;
}

const needsAttention = (s: Session, failures: RuleFailure[], cards: WarningCard[]): boolean =>
  cards.length > 0 || failures.some((f) => f.category === 'safety') || s.lines.some((l) => l.unusual);

export function useEntryFlow(deps: FlowDeps = defaultDeps): EntryFlow {
  const [stage, setStage] = useState<FlowStage>('idle');
  const [cards, setCards] = useState<WarningCard[]>([]);
  const [questions, setQuestions] = useState<SafetyQuestion[]>([]);
  const questionsRef = useRef<SafetyQuestion[]>([]);
  const [failures, setFailures] = useState<RuleFailure[]>([]);
  const [lines, setLines] = useState<ResolvedLine[]>([]);
  const [unresolved, setUnresolved] = useState<ParsedItem[]>([]);
  const [aiReadings, setAiReadings] = useState<AiReading[]>([]);
  const [dataMissing, setDataMissing] = useState(false);
  const [viewingAlternatives, setViewingAlternatives] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastText, setLastText] = useState('');
  const [storedCount, setStoredCount] = useState(0);
  const [genericTargets, setGenericTargets] = useState(false);
  // A part-finished entry (resolving, questions, the gate) must not be lost to an app update.
  useHoldUpdates(stage !== 'idle' && stage !== 'committed');
  const session = useRef<Session | null>(null);
  const seq = useRef(0);
  /** What resolved when some items did not, kept so the person may continue without the unresolved ones. */
  const pendingResolution = useRef<{ items: ParsedItem[]; resolution: Resolution; viaAi?: boolean } | null>(null);
  const aiPending = useRef<AiApplied | null>(null);
  const revisesRef = useRef<Revises | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const clearPending = useCallback(() => {
    session.current = null;
    setCards([]);
    setQuestions([]);
    setFailures([]);
    setLines([]);
    setUnresolved([]);
    setAiReadings([]);
    aiPending.current = null;
    setViewingAlternatives(false);
    setGenericTargets(false);
  }, []);

  const store = useCallback(async (action: 'added' | 'addedAfterAlternatives' | 'cancelled'): Promise<boolean> => {
    const s = session.current;
    if (!s) return false;
    const d = depsRef.current;
    // Abandoning a correction changes nothing: the original stays exactly as it was.
    if (s.revises && action === 'cancelled') return true;
    const entry: DiaryEntry = {
      id: globalThis.crypto.randomUUID(),
      at: s.revises ? s.revises.at : d.now().toISOString(),
      rawText: s.text,
      resolution: s.resolution.refs.some((r) => r.source === 'batch') ? 'batch' : s.viaAi ? 'ai' : 'local',
      items: s.resolution.refs.map((r) => (r.source === 'batch' && batchHasCustomIngredient(r.foodId) ? { ...r, selfReported: true } : r)),
      nutrients: s.resolution.nutrients,
      coverage: s.resolution.coverage,
      classification: s.resolution.classification,
      // Every claim the person read, each at its own level: a card's absorbed claims are part of what was shown.
      warningsShown: cardsRef.current.flatMap((c) => [
        { ruleId: c.ruleId, level: c.level },
        ...c.merged.map((m) => ({ ruleId: m.ruleId, level: m.level })),
      ]),
      userAction: action,
      state: 'active',
    };
    const fped = sumFped(s.resolution.refs);
    if (fped) entry.fped = fped;
    try {
      if (s.revises) {
        const { id: _id, ...fields } = entry;
        await (d.store.reviseEntry ?? reviseEntry)(s.revises.id, fields);
      } else {
        await d.store.addEntry(entry);
      }
    } catch (e) {
      setError(`This entry could not be saved: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    // A portion eaten comes off the fridge counter. The entry is already safe, so a counter failure must not undo it.
    if (action !== 'cancelled' && !s.revises) {
      for (const ref of s.resolution.refs) {
        if (ref.source !== 'batch') continue;
        const per = d.lookup.get('batch', ref.foodId)?.portions[0]?.grams;
        const n = per !== undefined ? portionsFor(ref.grams, per) : 1;
        try {
          for (let i = 0; i < n; i++) await decrementBatchPortion(ref.foodId);
        } catch { /* the counter is a convenience; the diary entry stands */ }
      }
    }
    setStoredCount((n) => n + 1);
    return true;
  }, []);
  // The cards on screen at the moment of the click are exactly the cards that were shown.
  const cardsRef = useRef<WarningCard[]>([]);
  cardsRef.current = cards;
  const failuresRef = useRef<RuleFailure[]>([]);
  failuresRef.current = failures;

  const finish = useCallback(
    async (action: 'added' | 'addedAfterAlternatives' | 'cancelled') => {
      const s = session.current;
      if (!s) return;
      const note = failuresRef.current;
      const shownLines = s.lines;
      if (!(await store(action))) return;
      setOutcome({ action: action === 'cancelled' ? 'cancelled' : 'added', lines: shownLines, failures: note });
      clearPending();
      setError(null);
      setStage(action === 'cancelled' ? 'idle' : 'committed');
    },
    [store, clearPending],
  );

  const evaluateSession = useCallback(
    async (s: Session, initialAnswers: Record<string, boolean>, allowInstantCommit: boolean) => {
      let answers = initialAnswers;
      let out = evaluate(depsRef.current.rules, { ...s.base, answers });
      // A "no" given before, for these very foods, answers the question without asking again.
      const remembered = rememberedAnswers(depsRef.current.rules, out.questions, s.base);
      if (Object.keys(remembered).length > 0) {
        answers = { ...answers, ...remembered };
        out = evaluate(depsRef.current.rules, { ...s.base, answers });
      }
      const all = [...s.carried, ...out.failures];
      s.answers = answers;
      setCards(out.cards);
      cardsRef.current = out.cards;
      setQuestions(out.questions);
      questionsRef.current = out.questions;
      setFailures(all);
      failuresRef.current = all;
      if (out.questions.length > 0) {
        setStage('questions');
        return;
      }
      if (needsAttention(s, all, out.cards)) {
        setStage('gate');
        return;
      }
      // Silence is the normal case: nothing to show, so commit at once.
      if (allowInstantCommit) await finish(s.viewedAlternatives ? 'addedAfterAlternatives' : 'added');
    },
    [finish],
  );

  const run = useCallback(
    async (text: string, resolutionOverride?: { items: ParsedItem[]; resolution: Resolution }, viaAi = false) => {
      const revises = revisesRef.current;
      const my = ++seq.current;
      const d = depsRef.current;
      setLastText(text);
      setError(null);
      setOutcome(null);
      clearPending();
      setStage('resolving');
      try {
        await d.loadData();
        if (my !== seq.current) return;
        const ready = d.isDataReady();
        setDataMissing(!ready);
        const parsed = resolutionOverride ?? (() => {
          const { items } = parseEntry(text);
          return { items, resolution: resolveItems(items, d.lookup) };
        })();
        const { items, resolution } = parsed;
        const lns = describeLines(items, resolution, d.lookup);
        setLines(lns);
        setUnresolved(resolution.needsHelp);
        if (!resolutionOverride && ready && (resolution.needsHelp.length > 0 || items.length === 0)) {
          // Keep the local result first: declining the model's reading falls back to it.
          pendingResolution.current = { items, resolution };
          // Only the unresolved phrase leaves the device, and only when the person switched this on.
          // The reading is shown for correction BEFORE any rule runs; a failure here is silent.
          const applied = await applyAi(text, items, resolution, d.lookup, d.ai).catch(() => null);
          if (my !== seq.current) return;
          if (applied) {
            aiPending.current = applied;
            setLines(describeLines(applied.items, applied.resolution, d.lookup));
            setUnresolved(applied.resolution.needsHelp);
            setAiReadings(applied.readings);
            setStage('aiReview');
            return;
          }
        }
        if (resolution.needsHelp.length > 0 || resolution.refs.length === 0) {
          // Keep what did resolve so "continue without" can use it; nothing is stored yet.
          pendingResolution.current = { items, resolution, ...(viaAi ? { viaAi } : {}) };
          setStage('needsHelp');
          return;
        }

        const now = d.now();
        const keys = last7DayKeys(now);
        const carried: RuleFailure[] = [];
        let history: DiaryEntry[] = [];
        try {
          history = await d.store.entriesBetween(localDayRange(keys[0]!).fromISO, localDayRange(keys[6]!).toISO);
        } catch {
          carried.push({
            ruleId: 'history', category: 'nutrition',
            message: 'we could not read your earlier entries, so the daily and weekly checks may understate',
          });
        }
        if (my !== seq.current) return;
        // The entry being corrected is about to be replaced, so it must not count toward its own gate.
        if (revises) history = history.filter((e) => e.id !== revises.id);
        let profile: Profile | null = null;
        try {
          profile = await d.store.getProfile();
        } catch {
          profile = null;
        }
        const foods = identities(resolution.refs, d.lookup);
        // Fail visibly: when only SOME refs lose their food, the engine (which reports only an empty list) stays silent,
        // and the safety rules would read as "checked, nothing found" for the foods they never saw.
        if (foods.length > 0 && foods.length < resolution.refs.length) {
          carried.push({
            ruleId: 'food-identity', category: 'safety',
            message: `${resolution.refs.length - foods.length} of the foods in this entry could not be identified, so the safety checks did not cover them`,
          });
        }
        const s: Session = {
          text, resolution, lines: lns, foods, answers: {}, viewedAlternatives: false, viaAi, carried, ...(revises ? { revises } : {}),
          base: {
            pending: resolution,
            foods,
            rawText: text,
            today: dayTotals(history, keys[6]!),
            week: weekContext(history, now),
            targets: computeTargets(profile, now),
            profile,
            now,
          },
        };
        session.current = s;
        setGenericTargets(s.base.targets.isGeneric);
        await evaluateSession(s, {}, true);
      } catch (e) {
        if (my !== seq.current) return;
        setError(`Something went wrong while checking this entry: ${e instanceof Error ? e.message : String(e)}`);
        setStage('idle');
      }
    },
    [clearPending, evaluateSession],
  );

  const submit = useCallback(
    async (text: string, opts?: { revises?: Revises }) => {
      if (text.trim() === '') return;
      revisesRef.current = opts?.revises ?? null;
      pendingResolution.current = null;
      await run(text);
    },
    [run],
  );

  const submitKnownFood = useCallback(
    async (food: DatasetFood, grams: number, text: string, source: FoodSource = 'off') => {
      revisesRef.current = null;
      pendingResolution.current = null;
      const items: ParsedItem[] = [{ rawFragment: text, quantity: { grams }, foodQuery: food.name }];
      await run(text, { items, resolution: resolveKnownFood(source, food, grams) });
    },
    [run],
  );

  const continueWithout = useCallback(async () => {
    const p = pendingResolution.current;
    const text = lastText;
    if (!p || p.resolution.refs.length === 0) return;
    await run(text, { items: p.items, resolution: { ...p.resolution, needsHelp: [] } }, p.viaAi === true);
  }, [run, lastText]);

  const acceptAi = useCallback(async () => {
    const a = aiPending.current;
    if (!a) return;
    await run(lastText, { items: a.items, resolution: a.resolution }, true);
  }, [run, lastText]);

  const rejectAi = useCallback(() => {
    const p = pendingResolution.current;
    if (!p) return;
    const d = depsRef.current;
    aiPending.current = null;
    setAiReadings([]);
    setLines(describeLines(p.items, p.resolution, d.lookup));
    setUnresolved(p.resolution.needsHelp);
    setStage('needsHelp');
  }, []);

  const answer = useCallback(
    (answerKey: string, yes: boolean) => {
      const s = session.current;
      if (!s) return;
      if (!yes) {
        const q = questionsRef.current.find((x) => x.answerKey === answerKey);
        if (q) rememberNo(answerKey, foodsAskedAbout(depsRef.current.rules, q, s.base));
      }
      void evaluateSession(s, { ...s.answers, [answerKey]: yes }, true).catch((e: unknown) => {
        setError(`Something went wrong while checking this entry: ${e instanceof Error ? e.message : String(e)}`);
      });
    },
    [evaluateSession],
  );

  const addAnyway = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    await finish(s.viewedAlternatives ? 'addedAfterAlternatives' : 'added');
  }, [finish]);

  const showAlternatives = useCallback(() => {
    if (session.current) session.current.viewedAlternatives = true;
    setViewingAlternatives(true);
  }, []);
  const backToGate = useCallback(() => setViewingAlternatives(false), []);

  const cancel = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    await finish('cancelled');
  }, [finish, clearPending]);

  const edit = useCallback(() => {
    seq.current++;
    clearPending();
    setOutcome(null);
    setStage('idle');
  }, [clearPending]);

  const dismissOutcome = useCallback(() => {
    setOutcome(null);
    setStage('idle');
  }, []);

  return {
    stage, cards, questions, failures, lines, unresolved, aiReadings, dataMissing, viewingAlternatives, outcome, error, lastText,
    genericTargets, storedCount, submit, submitKnownFood, answer, addAnyway, showAlternatives, backToGate, cancel, edit, continueWithout, acceptAi, rejectAi, dismissOutcome,
  };
}
