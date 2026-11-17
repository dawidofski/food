import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Log from '@/ui/screens/Log';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Logging, over whatever screen the person was on.
 *
 * It is a dialog rather than a destination so that looking something up and then logging it does not cost the
 * place you were. The Log screen inside is unchanged, which matters more than it sounds: the resolution flow and
 * the warning gate live in it, and §4's first anti-goal is that food is never silently added. Nothing here
 * stores anything.
 *
 * Three things a floating overlay usually gets wrong, all handled here:
 *  - the Android back gesture. On open it pushes a history entry; `popstate` closes it, so back dismisses the
 *    dialog instead of leaving the app. Closing any other way consumes that entry again.
 *  - focus. It moves inside on open, is kept inside while open, and returns to the element the caller names.
 *  - **what was typed.** Closing with work in progress asks first. On this owner's phone an edge swipe is an
 *    everyday accident, and the work it would have destroyed is not just a half-typed phrase: it is a food
 *    editor part-filled by hand, a scan part-finished, or a warning gate the person submitted for and waited
 *    on and is now reading. The same three things `useHoldUpdates` already refuses to interrupt.
 *
 * The back route has to re-push its entry when the person says keep: by the time `popstate` arrives the
 * browser has already gone back, so staying open means putting the entry back.
 */
export default function LogOverlay({
  open,
  initialDraft,
  onClose,
  returnFocusTo,
}: {
  open: boolean;
  initialDraft: string;
  onClose: () => void;
  /**
   * Where focus goes when this closes. Passed in rather than read from `document.activeElement` at open: not
   * every platform focuses a button when it is tapped, and focus landing on `<body>` after a dialog closes
   * loses a keyboard or screen-reader user their place entirely.
   */
  returnFocusTo?: { current: HTMLElement | null };
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<Element | null>(null);
  const pushed = useRef(false);
  const unsaved = useRef(false);
  /** Set while a deliberate departure is in flight, so the `popstate` it causes is not mistaken for a back gesture. */
  const leaving = useRef(false);
  const [confirming, setConfirming] = useState(false);

  // Held in a ref so the open effect depends on `open` alone: a fresh `onClose` closure from the parent must
  // never re-run it, which would push a second history entry and pull focus out of the field mid-word.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const push = useCallback(() => {
    try {
      history.pushState({ fdLogOverlay: true }, '');
      pushed.current = true;
    } catch {
      pushed.current = false;
    }
  }, []);

  /** Leave for good, consuming the history entry we pushed so the back stack does not grow. */
  const leave = useCallback(() => {
    setConfirming(false);
    leaving.current = true;
    if (pushed.current) {
      pushed.current = false;
      try {
        history.back();
        return; // `popstate` calls onClose.
      } catch {
        // History is unavailable; fall through and close directly.
      }
    }
    onCloseRef.current();
  }, []);

  /** The Close button and Escape: ask first when there is something to lose. */
  const requestClose = useCallback(() => {
    if (unsaved.current) {
      setConfirming(true);
      return;
    }
    leave();
  }, [leave]);

  useEffect(() => {
    if (!open) return undefined;
    restoreTo.current = returnFocusTo?.current ?? document.activeElement;
    push();
    const onPop = () => {
      pushed.current = false;
      if (leaving.current) {
        // Our own `history.back()`, from a person who chose to discard. Asking again would never let them out.
        leaving.current = false;
        onCloseRef.current();
        return;
      }
      if (unsaved.current) {
        // Back has already happened. Put the entry back and ask, rather than discarding their work.
        push();
        setConfirming(true);
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    // Focus the panel itself rather than guessing a control: the Log screen's first field may not be mounted yet.
    panel.current?.focus();
    return () => {
      window.removeEventListener('popstate', onPop);
      setConfirming(false);
      unsaved.current = false;
      leaving.current = false;
      const back = restoreTo.current;
      if (back instanceof HTMLElement && document.body.contains(back)) back.focus();
    };
    // `onClose` is deliberately absent: it lives in a ref. See `onCloseRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, push, returnFocusTo]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white dark:bg-slate-950">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Log what you ate"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain outline-none"
      >
        <div className="mx-auto flex w-full max-w-xl justify-end px-4 pt-4">
          <button type="button" onClick={requestClose} aria-label="Close" className="min-h-11 min-w-11 px-2 text-lg">
            ✕
          </button>
        </div>

        {confirming && (
          <div role="alertdialog" aria-label="Leave without logging this?" className="mx-auto w-full max-w-xl px-4">
            <div className="rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3">
              <p className="text-base">Leave without logging this? What you have typed here will be lost.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-lg border border-slate-900 dark:border-slate-100 px-3 text-sm font-semibold">
                  Keep it
                </button>
                <button type="button" onClick={leave} className="min-h-11 flex-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-sm">
                  Discard it
                </button>
              </div>
            </div>
          </div>
        )}

        <Log
          key={initialDraft}
          initialDraft={initialDraft}
          onUnsavedWork={(u) => {
            unsaved.current = u;
          }}
        />
      </div>
    </div>
  );
}
