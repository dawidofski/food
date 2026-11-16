import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  getDetector as realGetDetector,
  openCamera as realOpenCamera,
  scannerAvailability as realAvailability,
  stopCamera as realStopCamera,
  type BarcodeDetectorLike,
  type CameraResult,
  type ScannerAvailability,
} from '@/data/barcodeScanner';
import { findScannedProduct, type FindResult } from '@/data/offCache';
import { barcodeProblem, normaliseBarcode } from '@/domain/barcode';
import { isKnownValue } from '@/domain/nutrients';
import { offProductToDatasetShape } from '@/domain/openFoodFacts';
import type { DatasetFood, OffProduct } from '@/types/food';
import type { NutrientKey } from '@/types/nutrients';
import { NUTRIENT_LABEL } from '@/ui/components/CoverageNote';
import { fmtAmount } from '@/ui/components/NutrientBar';
import { fmtDay } from '@/ui/format';

/**
 * Scanning a barcode and proposing what was found.
 *
 * THE RULE THIS SCREEN IS BUILT AROUND: a scan never adds anything. It produces a PROPOSED food the person reads
 * — its name, its brand, the figures Open Food Facts had, how much they are eating, and a plain list of what the
 * app could not find out — and only a deliberate press sends it on to the ordinary warning gate and confirmation.
 *
 * Where a barcode cannot be read by camera (no `BarcodeDetector`, no camera, a refused camera, an insecure page)
 * the digits printed under the bars are typed instead, which works everywhere. The reason is always stated; there
 * is never a button that does nothing.
 *
 * The camera is stopped on success, on cancel and on unmount. All three. A camera left running on a phone is a
 * real bug, not a tidiness point.
 */
export type ScanDeps = {
  find: (barcode: string, opts?: { refetch?: boolean }) => Promise<FindResult>;
  availability: () => ScannerAvailability;
  openCamera: () => Promise<CameraResult>;
  getDetector: () => BarcodeDetectorLike | undefined;
  stopCamera: (stream: MediaStream | null | undefined) => void;
};

export const defaultScanDeps: ScanDeps = {
  find: (barcode, opts) => findScannedProduct(barcode, opts),
  availability: realAvailability,
  openCamera: realOpenCamera,
  getDetector: realGetDetector,
  stopCamera: realStopCamera,
};

/** The nutrients this app reads from Open Food Facts, in the order the review lists them. */
const SHOWN: NutrientKey[] = ['energyKcal', 'proteinG', 'fatG', 'satFatG', 'carbG', 'sugarsG', 'fibreG', 'sodiumMg'];

/**
 * The per-100 figures are shown EXACTLY as Open Food Facts carries them, to two decimals, not rounded to whole
 * numbers the way a daily total is: this screen's whole job is to let the person check the figures against the
 * packet in their hand, and "11 g" for a label that says 10.6 g makes that impossible.
 */
function fmtFigure(n: number): string {
  if (!Number.isFinite(n)) return '?';
  return Number(n.toFixed(2)).toLocaleString('en-US');
}

/** How often the video frame is looked at while the camera is on. 4 times a second is plenty and is cheap. */
const DETECT_INTERVAL_MS = 250;

const btn = 'min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-base';
const primary = 'min-h-12 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 text-base text-white dark:text-slate-900';

type Stage = 'entering' | 'looking' | 'review';

export default function ScanBarcode({
  deps = defaultScanDeps,
  onLog,
  onClose,
  onEnterManually,
}: {
  deps?: ScanDeps;
  /** Hands the proposed food to the entry flow, which runs the usual rules, gate and confirmation. */
  onLog: (food: DatasetFood, grams: number, text: string) => void;
  onClose: () => void;
  /** "I will type the nutrition myself", for a product Open Food Facts does not have. */
  onEnterManually: () => void;
}) {
  const [stage, setStage] = useState<Stage>('entering');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** True when the error leaves manual entry as the sensible next step (not found, offline, unreadable). */
  const [offerManual, setOfferManual] = useState(false);
  const [product, setProduct] = useState<OffProduct | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [grams, setGrams] = useState('100');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraNote, setCameraNote] = useState<string | null>(null);

  const availability = useRef<ScannerAvailability>(deps.availability());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seq = useRef(0);

  const stopEverything = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    deps.stopCamera(streamRef.current);
    streamRef.current = null;
    setCameraOn(false);
  }, [deps]);

  // On unmount, whatever the reason: a closed panel must never leave the lens on.
  useEffect(() => stopEverything, [stopEverything]);

  const lookUp = useCallback(
    async (barcode: string, refetch = false) => {
      const my = ++seq.current;
      setError(null);
      setOfferManual(false);
      setStage('looking');
      let result: FindResult;
      try {
        result = await deps.find(barcode, refetch ? { refetch: true } : undefined);
      } catch (e) {
        result = { kind: 'failed', reason: `The lookup failed: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (my !== seq.current) return;
      if (result.kind === 'found') {
        setProduct(result.product);
        setFromCache(result.fromCache);
        setGrams(String(result.product.servingGrams ?? 100));
        setStage('review');
        return;
      }
      setStage('entering');
      setOfferManual(true);
      setError(
        result.kind === 'not-found'
          ? `Barcode ${barcode} is not in Open Food Facts. Nothing has been saved. You can add this food yourself instead.`
          : result.reason,
      );
    },
    [deps],
  );

  const onDetected = useCallback(
    (raw: string) => {
      const code = normaliseBarcode(raw);
      if (barcodeProblem(code) !== null) return; // keep looking: a half-read frame is not an error
      stopEverything();
      setTyped(code);
      void lookUp(code);
    },
    [lookUp, stopEverything],
  );

  const startCamera = useCallback(async () => {
    setCameraNote(null);
    const detector = deps.getDetector();
    if (!detector) {
      const a = availability.current;
      setCameraNote(a.kind === 'available' ? 'This browser has no barcode reader.' : a.reason);
      return;
    }
    const cam = await deps.openCamera();
    if (!cam.ok) {
      setCameraNote(cam.reason);
      return;
    }
    streamRef.current = cam.stream;
    setCameraOn(true);
    const video = videoRef.current;
    if (video) {
      video.srcObject = cam.stream;
      try {
        await video.play();
      } catch {
        /* autoplay refused; the frames are still read below */
      }
    }
    timerRef.current = setInterval(() => {
      const el = videoRef.current;
      if (!el) return;
      void detector
        .detect(el)
        .then((hits) => {
          const first = hits[0]?.rawValue;
          if (first !== undefined) onDetected(first);
        })
        .catch(() => undefined);
    }, DETECT_INTERVAL_MS);
  }, [deps, onDetected]);

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    const code = normaliseBarcode(typed);
    const problem = barcodeProblem(typed);
    if (problem !== null) {
      setOfferManual(false);
      setError(problem);
      return;
    }
    stopEverything();
    void lookUp(code);
  };

  const confirm = () => {
    if (!product) return;
    const g = Number(grams.replace(',', '.'));
    if (!Number.isFinite(g) || g <= 0 || g > 5000) {
      setError('Say how much of it you are eating, in grams — more than 0 and at most 5000.');
      return;
    }
    stopEverything();
    onLog(offProductToDatasetShape(product), g, `${g} g ${product.name}`);
  };

  const cancel = () => {
    stopEverything();
    onClose();
  };

  const avail = availability.current;
  const canScan = avail.kind === 'available';

  return (
    <section
      data-testid="scan-panel"
      aria-labelledby="scan-heading"
      className="space-y-3 rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3"
    >
      <h2 id="scan-heading" className="text-lg font-semibold">Scan a barcode</h2>

      {stage !== 'review' && (
        <>
          {canScan ? (
            <div className="space-y-2">
              {!cameraOn && (
                <button type="button" onClick={() => void startCamera()} className={primary}>
                  Start the camera
                </button>
              )}
              <video
                ref={videoRef}
                muted
                playsInline
                data-testid="scan-video"
                className={`w-full rounded-lg bg-slate-200 dark:bg-slate-800 ${cameraOn ? '' : 'hidden'}`}
              />
              {cameraOn && (
                <>
                  <p className="text-sm text-slate-700 dark:text-slate-300">Hold the barcode in the picture. Nothing is saved until you have read what was found.</p>
                  <button type="button" onClick={stopEverything} className={btn}>Stop the camera</button>
                </>
              )}
            </div>
          ) : (
            <p data-testid="scan-no-camera" className="text-sm text-slate-900 dark:text-slate-100">
              {avail.reason}
            </p>
          )}
          {cameraNote !== null && <p role="status" className="text-sm text-slate-900 dark:text-slate-100">{cameraNote}</p>}

          <form onSubmit={submitTyped} className="space-y-2">
            <label htmlFor="barcode-digits" className="block text-sm font-medium">
              Barcode digits (printed under the bars)
            </label>
            <input
              id="barcode-digits"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="min-h-12 w-full rounded-lg border-2 border-slate-400 dark:border-slate-500 px-3 text-lg"
            />
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={stage === 'looking'} className={`${primary} disabled:opacity-50`}>
                {stage === 'looking' ? 'Looking it up…' : 'Look it up'}
              </button>
              <button type="button" onClick={cancel} className={btn}>Cancel</button>
            </div>
          </form>

          {error !== null && (
            <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>
          )}
          {offerManual && (
            <button type="button" onClick={() => { stopEverything(); onEnterManually(); }} className={btn}>
              Enter the nutrition myself
            </button>
          )}
          <p className="text-xs text-slate-600 dark:text-slate-400">
            A lookup sends the barcode to Open Food Facts and nothing else: no diary, no profile, no totals and
            nothing that identifies you.
          </p>
        </>
      )}

      {stage === 'review' && product && (
        <Review
          product={product}
          fromCache={fromCache}
          grams={grams}
          onGrams={setGrams}
          error={error}
          onConfirm={confirm}
          onCancel={cancel}
          onRefetch={() => void lookUp(product.barcode, true)}
        />
      )}
    </section>
  );
}

function Review({
  product, fromCache, grams, onGrams, error, onConfirm, onCancel, onRefetch,
}: {
  product: OffProduct;
  fromCache: boolean;
  grams: string;
  onGrams: (v: string) => void;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onRefetch: () => void;
}) {
  const amount = Number(grams.replace(',', '.'));
  const scale = Number.isFinite(amount) && amount > 0 ? amount / 100 : null;
  const unit = product.perMlNotPerGram ? '100 ml' : '100 g';
  return (
    <div data-testid="scan-review" className="space-y-3">
      <div>
        <p className="text-lg font-semibold">{product.name}</p>
        {product.brand !== undefined && <p className="text-sm text-slate-700 dark:text-slate-300">{product.brand}</p>}
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Barcode {product.barcode}
          {product.packSize !== undefined && ` · pack size ${product.packSize}`}
        </p>
      </div>

      <p className="text-sm">
        Nothing has been saved yet. Read what was found, say how much you are eating, and the usual checks run before
        anything goes into the diary.
      </p>

      <div>
        <label htmlFor="scan-grams" className="block text-sm font-medium">
          How much are you eating, in grams{product.perMlNotPerGram ? ' (1 ml counted as 1 g)' : ''}?
        </label>
        <input
          id="scan-grams"
          type="text"
          inputMode="decimal"
          value={grams}
          onChange={(e) => onGrams(e.target.value)}
          className="mt-1 min-h-12 w-full rounded-lg border-2 border-slate-400 dark:border-slate-500 px-3 text-lg"
        />
        {product.servingGrams !== undefined && (
          <button type="button" onClick={() => onGrams(String(product.servingGrams))} className="mt-1 min-h-11 text-sm underline">
            One serving ({product.servingGrams} g)
          </button>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">What Open Food Facts has</h3>
        <dl className="mt-1 space-y-1 text-sm">
          {SHOWN.map((k) => {
            const v = product.per100g[k];
            if (!isKnownValue(v)) return null;
            const { name, unit: u } = NUTRIENT_LABEL[k];
            return (
              <div key={k} className="flex justify-between gap-2">
                <dt className="capitalize">{name}</dt>
                <dd>
                  {fmtFigure(v)} {u} per {unit}
                  {scale !== null && <span className="text-slate-600 dark:text-slate-400"> · {fmtAmount(v * scale)} {u} here</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      <div data-testid="scan-gaps">
        <h3 className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">What the app could not find out</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {product.gaps.map((g) => <li key={g}>{g}</li>)}
        </ul>
      </div>

      <div data-testid="scan-dates" className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2 text-sm">
        <p>
          These figures come from <strong>Open Food Facts</strong>, a public database that anyone can edit. They were
          copied off a packet by a member of the public, not measured by a laboratory.
        </p>
        <p className="mt-1">
          {product.lastModified !== undefined
            ? `Last edited there on ${fmtDay(product.lastModified)}.`
            : 'Open Food Facts does not say when it was last edited.'}{' '}
          {fromCache
            ? `Looked up on ${fmtDay(product.fetchedAt)} and kept on this device since, so it has not been asked for again.`
            : `Looked up just now, on ${fmtDay(product.fetchedAt)}.`}
        </p>
        <p className="mt-1">
          Open Food Facts data is used under the{' '}
          <a className="underline" href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer noopener">
            Open Database License (ODbL) 1.0
          </a>
          .
        </p>
        <button type="button" onClick={onRefetch} className="mt-2 min-h-11 text-sm underline">Ask Open Food Facts again</button>
      </div>

      {error !== null && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} className={primary}>Check this and log it</button>
        <button type="button" onClick={onCancel} className={btn}>Cancel</button>
      </div>
    </div>
  );
}
