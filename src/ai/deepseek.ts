/**
 * DeepSeek fallback: the model resolves LANGUAGE, the dataset resolves NUTRITION.
 *
 * The model is given one unresolved phrase and asked only to DESCRIBE it: a plain-English
 * description of the food in common words ("deep-fried minced pork sausage" for a frikandel), plus
 * the quantity and unit it read. It is never shown the dataset, never names a dataset food, and
 * is never asked for a nutrient value. The caller searches the bundled dataset itself with the
 * description, so every number the person sees still comes from USDA and the model cannot conjure
 * an entry that does not exist.
 *
 * The response is treated as hostile: it is validated to exactly three fields
 * ({ description, quantity, unit }); every other field is dropped, and the description is a short
 * plain-text string that is only ever used as search words. Every failure (no key, HTTP error,
 * timeout, network error, non-JSON, wrong shape) returns [] and never throws, so the add flow
 * carries on to manual entry.
 */

export type { AiSuggestion } from './schemas';

/**
 * Why a call returned nothing. 'rejected' is a non-retryable HTTP refusal (a bad key, no balance, an
 * unknown model name). 'offline' covers a network error and a 429/5xx that the one retry did not cure.
 */
export type AiFailure = 'no-key' | 'offline' | 'rejected' | 'timeout' | 'bad-response';

export type InterpretOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Told once why the call produced nothing. Optional: without it every failure is still just []. */
  onFailure?: (f: AiFailure) => void;
};

export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_MODEL = 'deepseek-flash';
import { phraseOperation, type AiOperation, type AiSuggestion } from './schemas';

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_PHRASE = 200;
const MAX_RESPONSE_CHARS = 100_000;
/**
 * One request shape for every operation.
 *
 * `payload` is serialised into the USER message, never into the system prompt: that is what makes the person's
 * own words data rather than instructions, and it is why a prompt-injection attempt inside a dish name is just
 * a dish name. `content` may also be the multi-part array a vision request needs.
 */
function buildBody(systemPrompt: string, content: unknown, maxTokens = 400): string {
  return JSON.stringify({
    model: DEEPSEEK_MODEL,
    temperature: 0,
    max_tokens: maxTokens,
    stream: false,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
  });
}

type Attempt = { kind: 'ok'; text: string } | { kind: 'retry'; why: 'timeout' | 'offline' } | { kind: 'fail' };

async function attempt(body: string, apiKey: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Attempt> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A fetch that ignores the signal (or a body that never finishes) must still end at the deadline.
  const deadline = new Promise<Attempt>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: 'retry', why: 'timeout' });
    }, timeoutMs);
  });
  const work = (async (): Promise<Attempt> => {
    const res = await fetchImpl(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body,
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (res.status === 429 || res.status >= 500) return { kind: 'retry', why: 'offline' };
    if (!res.ok) return { kind: 'fail' }; // 401, 402, 4xx: retrying cannot help
    return { kind: 'ok', text: (await res.text()).slice(0, MAX_RESPONSE_CHARS) };
  })().catch((): Attempt => ({ kind: 'retry', why: 'offline' }));
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads the model's message out of the chat-completions envelope; anything else is no content. */
function contentOf(envelope: unknown): string | undefined {
  if (!isRecord(envelope) || !Array.isArray(envelope.choices)) return undefined;
  const first: unknown = envelope.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return undefined;
  return typeof first.message.content === 'string' ? first.message.content : undefined;
}


/**
 * Run one operation: build the request, make it (with a single retry on a timeout or a 5xx), unwrap the
 * envelope and hand the content to that operation's validator.
 *
 * Every failure returns [] and reports the reason out of band, so a refused model name is distinguishable from
 * "no food matched" — the silence that made a dead model look like an empty answer for weeks. Nothing here
 * throws: the manual path must always still work.
 */
export async function runOperation<T>(
  op: AiOperation<T>,
  content: unknown,
  opts: InterpretOptions & { maxTokens?: number },
): Promise<T[]> {
  const report = (f: AiFailure): void => {
    try {
      opts.onFailure?.(f);
    } catch {
      // A faulty listener must not turn a quiet failure into a thrown one.
    }
  };
  try {
    if (opts.apiKey.trim() === '') {
      report('no-key');
      return [];
    }
    const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    const body = buildBody(op.systemPrompt, content, opts.maxTokens);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let result = await attempt(body, opts.apiKey, fetchImpl, timeoutMs);
    if (result.kind === 'retry') result = await attempt(body, opts.apiKey, fetchImpl, timeoutMs); // one retry
    if (result.kind !== 'ok') {
      report(result.kind === 'fail' ? 'rejected' : result.why);
      return [];
    }

    const text = contentOf(parseJson(result.text));
    if (text === undefined) {
      report('bad-response');
      return [];
    }
    const parsed = parseJson(text);
    if (parsed === undefined) {
      report('bad-response');
      return [];
    }
    return op.validate(parsed);
  } catch {
    report('bad-response');
    return [];
  }
}

/** A phrase the dataset could not match. The operation this app already had, now one of several. */
export async function interpretEntry(text: string, opts: InterpretOptions): Promise<AiSuggestion[]> {
  const phrase = text.trim().slice(0, MAX_PHRASE);
  if (phrase === '' && opts.apiKey.trim() !== '') return [];
  return runOperation(phraseOperation, JSON.stringify({ phrase }), opts);
}
