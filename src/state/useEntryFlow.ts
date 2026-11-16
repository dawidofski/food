import { useCallback, useRef, useState } from 'react';
import { addEntry, entriesBetween, getProfile } from '@/data/db';
import { datasetLookup } from '@/data/datasetLookup';
import { refreshCustomFoods, withCustomFoods } from '@/domain/customFoods';
import { datasetState, loadFoods } from '@/data/foodRepository';
import { last7DayKeys, localDayRange } from '@/domain/dayBoundary';
import type { FoodLookup } from '@/domain/foodLookup';
import { parseEntry, type ParsedItem } from '@/domain/parseEntry';
import { resolveItems } from '@/domain/resolveItems';
import { computeTargets } from '@/domain/targets';
import { dayTotals, weekContext } from '@/domain/totals';
import { unusualServing, type UnusualServing } from '@/domain/unusualServing';
import { catalogue } from '@/rules/catalogue';
import { evaluate } from '@/rules/engine';
import type { Context, FoodIdentity, Rule, RuleFailure, SafetyQuestion, WarningCard } from '@/rules/types';
import type { DiaryEntry, FoodRef, FoodSource, Resolution } from '@/types/diary';
import type { Profile } from '@/types/profile';

export type FlowStage = 'idle' | 'resolving' | 'needsHelp' | 'questions' | 'gate' | 'committed';

/** What one parsed item resolved to: the user's only check against a near-miss match. */
export type ResolvedLine = {
  name: string;
  /** Where the numbers came from; 'custom' is shown as self-reported. */
  source: FoodSource;
  count?: number;
  portionLabel?: string;
  /** Grams of one unit of the portion label (e.g. one frankfurter), when it can be worked out. */
  perPortionGrams?: number;
  grams: number;
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
  };
};

export const defaultDeps: FlowDeps = {
  lookup: withCustomFoods(datasetLookup),
  rules: catalogue,
  now: () => new Date(),
  loadData: async () => {
    await loadFoods();
    // The person's own foods are optional: if they cannot be read, the dataset still works.
    await refreshCustomFoods().catch(() => undefined);
  },
  isDataReady: () => datasetState() === 'ready',
  store: { addEntry, entriesBetween, getProfile },
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
};

export type EntryFlow = {
  stage: FlowStage;
  cards: WarningCard[];
  questions: SafetyQuestion[];
  failures: RuleFailure[];
  lines: ResolvedLine[];
  unresolved: ParsedItem[];
  /** True when the food database could not be loaded, so nothing could be matched. */
  dataMissing: boolean;
  viewingAlternatives: boolean;
  outcome: Outcome | null;
  error: string | null;
  /** The text the person last submitted, so a correction can start from it. */
  lastText: string;
  /** Bumps whenever an entry (including a cancelled one) is stored, so lists can refresh. */
  storedCount: number;
  submit: (text: string) => Promise<void>;
  answer: (answerKey: string, yes: boolean) => void;
  addAnyway: () => Promise<void>;
  showAlternatives: () => void;
  backToGate: () => void;
  cancel: () => Promise<void>;
  /** Drops the pending entry without storing anything and returns to the text field. */
  edit: () => void;
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
    const unusual = item ? unusualServing(item, ref.grams, food) : null;
    const perPortionGrams = unitGrams(ref.portionLabel, ref.grams, count);
    return {
      name: food?.name ?? ref.foodId,
      source: ref.source,
      grams: ref.grams,
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
  const [failures, setFailures] = useState<RuleFailure[]>([]);
  const [lines, setLines] = useState<ResolvedLine[]>([]);
  const [unresolved, setUnresolved] = useState<ParsedItem[]>([]);
  const [dataMissing, setDataMissing] = useState(false);
  const [viewingAlternatives, setViewingAlternatives] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastText, setLastText] = useState('');
  const [storedCount, setStoredCount] = useState(0);
  const session = useRef<Session | null>(null);
  const seq = useRef(0);
  /** What resolved when some items did not, kept so the person may continue without the unresolved ones. */
  const pendingResolution = useRef<{ items: ParsedItem[]; resolution: Resolution } | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const clearPending = useCallback(() => {
    session.current = null;
    setCards([]);
    setQuestions([]);
    setFailures([]);
    setLines([]);
    setUnresolved([]);
    setViewingAlternatives(false);
  }, []);

  const store = useCallback(async (action: 'added' | 'addedAfterAlternatives' | 'cancelled'): Promise<boolean> => {
    const s = session.current;
    if (!s) return false;
    const d = depsRef.current;
    const entry: DiaryEntry = {
      id: globalThis.crypto.randomUUID(),
      at: d.now().toISOString(),
      rawText: s.text,
      resolution: 'local',
      items: s.resolution.refs,
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
      await d.store.addEntry(entry);
    } catch (e) {
      setError(`This entry could not be saved: ${e instanceof Error ? e.message : String(e)}`);
      return false;
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
    async (s: Session, answers: Record<string, boolean>, allowInstantCommit: boolean) => {
      const out = evaluate(depsRef.current.rules, { ...s.base, answers });
      const all = [...s.carried, ...out.failures];
      s.answers = answers;
      setCards(out.cards);
      cardsRef.current = out.cards;
      setQuestions(out.questions);
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
    async (text: string, resolutionOverride?: { items: ParsedItem[]; resolution: Resolution }) => {
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
        if (resolution.needsHelp.length > 0 || resolution.refs.length === 0) {
          // Keep what did resolve so "continue without" can use it; nothing is stored yet.
          pendingResolution.current = { items, resolution };
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
        let profile: Profile | null = null;
        try {
          profile = await d.store.getProfile();
        } catch {
          profile = null;
        }
        const foods = identities(resolution.refs, d.lookup);
        const s: Session = {
          text, resolution, lines: lns, foods, answers: {}, viewedAlternatives: false, carried,
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
    async (text: string) => {
      if (text.trim() === '') return;
      pendingResolution.current = null;
      await run(text);
    },
    [run],
  );

  const continueWithout = useCallback(async () => {
    const p = pendingResolution.current;
    const text = lastText;
    if (!p || p.resolution.refs.length === 0) return;
    await run(text, { items: p.items, resolution: { ...p.resolution, needsHelp: [] } });
  }, [run, lastText]);

  const answer = useCallback(
    (answerKey: string, yes: boolean) => {
      const s = session.current;
      if (!s) return;
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
    stage, cards, questions, failures, lines, unresolved, dataMissing, viewingAlternatives, outcome, error, lastText,
    storedCount, submit, answer, addAnyway, showAlternatives, backToGate, cancel, edit, continueWithout, dismissOutcome,
  };
}
