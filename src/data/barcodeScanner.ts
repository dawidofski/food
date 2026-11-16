/**
 * The seam between the scan screen and whatever actually reads a barcode.
 *
 * Today that is the browser's own `BarcodeDetector`, which Android Chrome has and which needs NO library: this
 * app adds no dependency for it. Tomorrow a polyfill could be lazy-loaded behind `getDetector` without the screen
 * changing a line — but none ships, so a device without the API falls back to typing the digits, which are printed
 * under every barcode and so always work.
 *
 * `scannerAvailability` reports exactly WHY scanning is unavailable, because a button that silently does nothing
 * is worse than no button. The three reasons are different and the person can act on two of them:
 *  - 'no-api'      — this browser has no barcode reader (iOS Safari, Firefox). Type the digits.
 *  - 'insecure'    — the page is not on a secure origin, so no camera is offered at all. Type the digits.
 *  - 'no-camera'   — there is no camera API here.
 * The camera being REFUSED is not an availability question: it happens when the stream is asked for, and the
 * screen reports it then.
 */
import { BARCODE_FORMATS } from '@/domain/barcode';

/** What `BarcodeDetector` gives back. Typed here because TypeScript's DOM library does not carry it yet. */
export type DetectedBarcode = { rawValue: string; format?: string };

export type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
};

type DetectorConstructor = new (opts: { formats: readonly string[] }) => BarcodeDetectorLike;

export type ScannerAvailability =
  | { kind: 'available' }
  | { kind: 'no-api'; reason: string }
  | { kind: 'insecure'; reason: string }
  | { kind: 'no-camera'; reason: string };

function detectorConstructor(): DetectorConstructor | undefined {
  const g = globalThis as unknown as { BarcodeDetector?: DetectorConstructor };
  return typeof g.BarcodeDetector === 'function' ? g.BarcodeDetector : undefined;
}

function hasCamera(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** A secure context is required for the camera. `isSecureContext` is the browser's own answer; do not infer it from the URL. */
function secure(): boolean {
  return typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : true;
}

export function scannerAvailability(): ScannerAvailability {
  if (!secure()) {
    return {
      kind: 'insecure',
      reason: 'This page is not on a secure (https) address, so the browser will not give it the camera. Type the barcode digits instead.',
    };
  }
  if (!hasCamera()) {
    return { kind: 'no-camera', reason: 'This browser offers no camera to this app. Type the barcode digits instead.' };
  }
  if (!detectorConstructor()) {
    return {
      kind: 'no-api',
      reason:
        'This browser has no built-in barcode reader (Safari on iPhone and Firefox do not), and this app adds no ' +
        'library for one. Type the barcode digits instead — they are printed under the bars.',
    };
  }
  return { kind: 'available' };
}

/** A detector for the formats on supermarket packaging, or undefined where the browser has none. */
export function getDetector(): BarcodeDetectorLike | undefined {
  const Ctor = detectorConstructor();
  return Ctor ? new Ctor({ formats: [...BARCODE_FORMATS] }) : undefined;
}

export type CameraResult = { ok: true; stream: MediaStream } | { ok: false; reason: string };

/**
 * The rear camera, or a sentence saying why not. A refusal is a normal answer here, not an error: the person may
 * simply not want the camera on, and the screen then offers the digits instead.
 */
export async function openCamera(): Promise<CameraResult> {
  if (!hasCamera()) return { ok: false, reason: 'This browser offers no camera to this app.' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    return { ok: true, stream };
  } catch (e) {
    const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { ok: false, reason: 'The camera was not allowed, so there is nothing to scan with. Type the barcode digits instead.' };
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { ok: false, reason: 'No camera was found on this device. Type the barcode digits instead.' };
    }
    return { ok: false, reason: 'The camera could not be started. Type the barcode digits instead.' };
  }
}

/**
 * Stops every track on a stream. A camera left running on a phone keeps the lens light on and drains the battery,
 * so this is called on success, on cancel and on unmount — all three, every time, without exception.
 */
export function stopCamera(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* a track already ended */
    }
  }
}
