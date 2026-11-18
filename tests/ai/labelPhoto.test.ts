import { afterEach, describe, expect, test, vi } from 'vitest';
import { LABEL_IMAGE_MAX_PX, readLabelPhoto } from '@/ai/deepseek';
import { labelOperation } from '@/ai/schemas';
import { clearApiKey, isLabelPhotoEnabled, isLabelPhotoSwitchedOn, setAiSwitch, setApiKey, setLabelPhotoSwitch } from '@/state/aiSettings';

const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

/** A fetch that answers with whatever the model is pretending to say. */
const replying = (content: unknown) =>
  vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  ) as unknown as typeof fetch;

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('reading a label from a photo', () => {
  test('a figure the model did not read is absent, never zero', async () => {
    const out = await readLabelPhoto(PIXEL, {
      apiKey: 'k',
      fetchImpl: replying({ per100: { energyKcal: 250, proteinG: 8 } }),
    });
    const per100 = out[0]?.per100 ?? {};
    expect(per100.energyKcal).toBe(250);
    expect('saltG' in per100).toBe(false);
    expect('fibreG' in per100).toBe(false);
  });

  test('a photo that is not a label fills in nothing', async () => {
    // Review Focus 3: a receipt, a face, a blank wall.
    const out = await readLabelPhoto(PIXEL, { apiKey: 'k', fetchImpl: replying({ per100: {} }) });
    expect(out).toEqual([]);
  });

  test('a per-serving column is never read as per 100 g', async () => {
    // Review Focus 4. There is no field in the accepted shape that can express a per-serving figure, so a
    // response carrying only one yields nothing rather than a figure wrong by the serving ratio.
    const out = await readLabelPhoto(PIXEL, {
      apiKey: 'k',
      fetchImpl: replying({ perServing: { energyKcal: 250 }, servingG: 30 }),
    });
    expect(out).toEqual([]);
  });

  test('no health claim or stray field survives, whatever came back', async () => {
    const out = await readLabelPhoto(PIXEL, {
      apiKey: 'k',
      fetchImpl: replying({
        per100: { energyKcal: 250, verdict: 'healthy', sodiumMg: 400 },
        name: 'oat biscuits',
        advice: 'eat freely',
        foodId: 'x',
      }),
    });
    expect(out).toEqual([{ per100: { energyKcal: 250 }, name: 'oat biscuits' }]);
  });

  test('refuses anything that is not an image it can send', async () => {
    const fetchImpl = replying({ per100: { energyKcal: 1 } });
    for (const bad of ['', 'https://example.com/label.jpg', 'data:text/plain;base64,aaa', 'not a url']) {
      expect(await readLabelPhoto(bad, { apiKey: 'k', fetchImpl })).toEqual([]);
    }
    // And it never reached the network to find out.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('sends the picture in the shape DeepSeek documents, and asks for JSON', async () => {
    const fetchImpl = replying({ per100: { energyKcal: 250 } });
    await readLabelPhoto(PIXEL, { apiKey: 'k', fetchImpl });
    const body = JSON.parse(String((fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1]?.body));
    expect(body.model).toBe('deepseek-flash');
    const content = body.messages[1].content;
    expect(content[0]).toEqual({ type: 'text', text: expect.any(String) });
    expect(content[1].type).toBe('image_url');
    expect(content[1].image_url.url).toBe(PIXEL);
    // The person's photo is in the USER message; the system prompt never varies with it.
    expect(JSON.stringify(body.messages[0])).not.toContain('base64');
  });

  test('every failure is quiet and empty, so the manual path still works', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const reasons: string[] = [];
    const out = await readLabelPhoto(PIXEL, { apiKey: 'k', fetchImpl: failing, onFailure: (f) => reasons.push(f) });
    expect(out).toEqual([]);
    expect(reasons.length).toBeGreaterThan(0);
    expect(await readLabelPhoto(PIXEL, { apiKey: '', fetchImpl: failing })).toEqual([]);
  });

  test('a zero from the model is treated as absent, not stored as a figure', async () => {
    // A stored 0 silently satisfies the sugar and salt rules; a blank makes the app say it does not know.
    const out = await readLabelPhoto(PIXEL, {
      apiKey: 'k',
      fetchImpl: replying({ per100: { energyKcal: 250, proteinG: 8, fatG: 5, carbsG: 30, sugarsG: 0 } }),
    });
    expect('sugarsG' in (out[0]?.per100 ?? {})).toBe(false);
  });

  test('refuses a reading whose arithmetic cannot be true', async () => {
    // 2.7 kg of macronutrient inside 100 g of food.
    expect(
      await readLabelPhoto(PIXEL, { apiKey: 'k', fetchImpl: replying({ per100: { fatG: 900, carbsG: 900, proteinG: 900 } }) }),
    ).toEqual([]);
    // More sugar than carbohydrate, and more saturated fat than fat.
    expect(
      await readLabelPhoto(PIXEL, { apiKey: 'k', fetchImpl: replying({ per100: { carbsG: 10, sugarsG: 40 } }) }),
    ).toEqual([]);
    expect(
      await readLabelPhoto(PIXEL, { apiKey: 'k', fetchImpl: replying({ per100: { fatG: 3, satFatG: 20 } }) }),
    ).toEqual([]);
  });

  test('refuses kilojoules left unconverted, the 4.2x error that would look plausible', async () => {
    // 800 kJ is 191 kcal. A label of 10 g protein, 30 g carbs and 5 g fat is about 205 kcal by Atwater, so a
    // reported 800 is far outside anything rounding explains.
    const kJ = { per100: { energyKcal: 800, proteinG: 10, carbsG: 30, fatG: 5 } };
    expect(await readLabelPhoto(PIXEL, { apiKey: 'k', fetchImpl: replying(kJ) })).toEqual([]);
    // The same label with the conversion done is accepted.
    const kcal = { per100: { energyKcal: 191, proteinG: 10, carbsG: 30, fatG: 5 } };
    const ok = await readLabelPhoto(PIXEL, { apiKey: 'k', fetchImpl: replying(kcal) });
    expect(ok[0]?.per100.energyKcal).toBe(191);
  });

  test('the image cap is small enough to be worth sending', () => {
    // DeepSeek scales anything larger to about 1300 px before the model sees it, so a 12-megapixel phone
    // photo buys no legibility — only the person's data and their money.
    expect(LABEL_IMAGE_MAX_PX).toBeLessThanOrEqual(1300);
  });

  test('its prompt forbids a zero for an absent figure and demands the per-100 column', () => {
    expect(labelOperation.systemPrompt).toMatch(/never write 0 for a figure that is absent/i);
    expect(labelOperation.systemPrompt).toMatch(/only the per 100 g or per 100 ml column/i);
  });
});

describe('the label photo switch', () => {
  test('is off until it is turned on, separately from the phrase fallback', () => {
    setApiKey('k');
    setAiSwitch(true);
    // The phrase fallback being on is not agreement to send a photograph.
    expect(isLabelPhotoSwitchedOn()).toBe(false);
    expect(isLabelPhotoEnabled()).toBe(false);
    setLabelPhotoSwitch(true);
    expect(isLabelPhotoEnabled()).toBe(true);
  });

  test('needs the key and the AI switch as well as itself', () => {
    setLabelPhotoSwitch(true);
    expect(isLabelPhotoEnabled()).toBe(false);
    setApiKey('k');
    expect(isLabelPhotoEnabled()).toBe(false);
    setAiSwitch(true);
    expect(isLabelPhotoEnabled()).toBe(true);
  });

  test('clearing the key revokes the photo agreement too', () => {
    // Consent to send pictures must not outlive the key it was given against, or entering a new key later
    // silently brings the camera back on an agreement made before the revocation.
    setApiKey('k');
    setAiSwitch(true);
    setLabelPhotoSwitch(true);
    clearApiKey();
    expect(isLabelPhotoSwitchedOn()).toBe(false);
  });

  test('turning the phrase fallback off takes the photo path with it', () => {
    setApiKey('k');
    setAiSwitch(true);
    setLabelPhotoSwitch(true);
    expect(isLabelPhotoEnabled()).toBe(true);
    setAiSwitch(false);
    expect(isLabelPhotoEnabled()).toBe(false);
  });
});
