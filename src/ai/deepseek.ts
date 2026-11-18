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
import {
  dishOperation,
  ingredientsOperation,
  labelOperation,
  phraseOperation,
  type AiComponent,
  type AiIngredient,
  type AiLabel,
  type AiOperation,
  type AiSuggestion,
} from './schemas';

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_PHRASE = 200;
/** A pasted recipe is longer than a phrase but still bounded: this is an ingredient list, not a document. */
const MAX_RECIPE = 2000;
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

/**
 * The longest side an image is sent at.
 *
 * DeepSeek's vision guide states that images larger than roughly 1300x1300 are scaled down to about that before
 * the model sees them, with an upper bound of 1024 tokens per image. Sending a 12-megapixel phone photo
 * therefore buys no legibility at all — it only spends the person's data and their money. A nutrition label
 * needs to be readable, not large.
 */
export const LABEL_IMAGE_MAX_PX = 1300;

/**
 * Read a nutrition label from a photograph.
 *
 * **This is the one operation where the model reads numbers**, and the addendum fences it as transcription of
 * figures already printed on a packet in the person's hand, not as nutrition knowledge. The fences, all of them
 * requirements: per 100 g or 100 ml only; an absent figure stays absent and is never written as zero; the
 * person sees every figure before anything is saved; and it sits behind its own switch, separate from the
 * phrase fallback, because sending a photograph to a third party is a different decision from sending a word.
 *
 * `dataUrl` must already be downscaled — see `LABEL_IMAGE_MAX_PX`.
 */
export async function readLabelPhoto(dataUrl: string, opts: InterpretOptions): Promise<AiLabel[]> {
  if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(dataUrl)) return [];
  return runOperation(
    labelOperation,
    [
      { type: 'text', text: 'Read the nutrition table in this photograph.' },
      // The OpenAI-compatible shape DeepSeek's vision guide documents for chat completions. `detail` is left
      // at the default: 'low' downscales to 512x512, which loses the small print a label is made of.
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
    { ...opts, maxTokens: 600 },
  );
}

/** A composite dish, as the foods it is made of. The dataset still supplies every number. */
export async function breakDownDish(dish: string, opts: InterpretOptions): Promise<AiComponent[]> {
  const text = dish.trim().slice(0, MAX_PHRASE);
  if (text === '') return [];
  return runOperation(dishOperation, JSON.stringify({ dish: text, servings: 1 }), { ...opts, maxTokens: 600 });
}

/** A written recipe, as the ingredient lines a batch is made of. Amounts the person stated pass through. */
export async function readIngredientList(text: string, opts: InterpretOptions): Promise<AiIngredient[]> {
  const body = text.trim().slice(0, MAX_RECIPE);
  if (body === '') return [];
  return runOperation(ingredientsOperation, JSON.stringify({ text: body }), { ...opts, maxTokens: 800 });
}
