import { useRef, useState } from 'react';
import { LABEL_IMAGE_MAX_PX, readLabelPhoto } from '@/ai/deepseek';
import type { AiLabel } from '@/ai/schemas';
import { getApiKey, isLabelPhotoEnabled } from '@/state/aiSettings';

/**
 * Shrink a picture before it leaves the device.
 *
 * DeepSeek scales anything bigger to roughly this size before the model sees it, so sending a full phone photo
 * costs the person data and money and buys no legibility. Exported so a test can check the cap without a canvas.
 */
export async function downscale(file: Blob, maxPx = LABEL_IMAGE_MAX_PX): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    // No canvas, no bitmap decoder, a file that is not an image: the person types the figures instead.
    return null;
  }
}

/**
 * Photograph a nutrition label and get its per-100 figures back, to check before anything is saved.
 *
 * Hidden entirely unless the person turned on the separate photo switch in Settings — not the phrase
 * fallback's. Nothing here saves: it hands the figures up, and the ordinary food form shows every one of them
 * for correction, exactly as if they had been typed.
 */
export default function LabelPhoto({ onRead }: { onRead: (label: AiLabel) => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!isLabelPhotoEnabled()) return null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const dataUrl = await downscale(file);
      if (dataUrl === null) {
        setNote('That picture could not be read on this device. Type the figures in instead.');
        return;
      }
      const key = getApiKey();
      if (key === null) return;
      let refused = false;
      const [label] = await readLabelPhoto(dataUrl, {
        apiKey: key,
        onFailure: (f) => { if (f !== 'bad-response') refused = true; },
      });
      if (label === undefined) {
        // Telling someone their photo was unreadable when the service was down sends them to retake a photo
        // that was fine.
        setNote(
          refused
            ? 'The AI service could not be reached or refused the request, so the label was not read. Typing the figures in still works.'
            : 'No nutrition table could be read in that photo. Check it shows the per 100 g column, or type the figures in.',
        );
        return;
      }
      onRead(label);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-1">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Photograph a nutrition label"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="min-h-12 w-full rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-left text-sm disabled:opacity-50"
      >
        {busy ? 'Reading the label…' : 'Photograph the nutrition label'}
      </button>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        The photo is sent to DeepSeek. Only the per 100 g column is read, a figure the label does not print is
        left blank, and every figure is yours to check before it is saved.
      </p>
      {note && <p role="alert" className="text-sm">{note}</p>}
    </div>
  );
}
