import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
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
 *  - focus. It moves inside on open, is kept inside while open, and returns to the button on close.
 *  - what was typed. Closing discards the draft, and the person is told so before it happens, because losing a
 *    half-typed entry to a stray tap is the kind of small betrayal this app is built not to commit.
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

  const close = useCallback(() => {
    // Consume the history entry we pushed, so the back stack does not grow with every open and close.
    if (pushed.current) {
      pushed.current = false;
      try {
        history.back();
        return; // `popstate` calls onClose.
      } catch {
        // History is unavailable; fall through and close directly.
      }
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    restoreTo.current = returnFocusTo?.current ?? document.activeElement;
    try {
      history.pushState({ fdLogOverlay: true }, '');
      pushed.current = true;
    } catch {
      pushed.current = false;
    }
    const onPop = () => {
      pushed.current = false;
      onClose();
    };
    window.addEventListener('popstate', onPop);
    // Focus the panel itself rather than guessing a control: the Log screen's first field may not be mounted yet.
    panel.current?.focus();
    return () => {
      window.removeEventListener('popstate', onPop);
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus();
    };
  }, [open, onClose, returnFocusTo]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
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
        className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
      >
        <div className="mx-auto flex w-full max-w-xl justify-end px-4 pt-4">
          <button type="button" onClick={close} className="min-h-11 px-2 text-sm underline">
            Close
          </button>
        </div>
        <Log key={initialDraft} initialDraft={initialDraft} />
      </div>
    </div>
  );
}
