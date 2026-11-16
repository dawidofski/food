import { useEffect } from 'react';

/**
 * Holds an app update until the person is at rest. A new service worker is not activated (and the page not reloaded)
 * while a warning gate, a food editor or typed text is open: reloading there would throw away the entry and the
 * questions answered against it. When the last hold is released, a waiting update is applied.
 */
export function createUpdateGate() {
  let holds = 0;
  let ready = false;
  let apply: (() => void) | null = null;

  const maybeApply = () => {
    if (ready && holds === 0 && apply) {
      ready = false;
      apply();
    }
  };

  return {
    setApply(fn: () => void) {
      apply = fn;
      maybeApply();
    },
    /** A new version is waiting. */
    notifyReady() {
      ready = true;
      maybeApply();
    },
    /** Returns the release function; releasing twice does nothing. */
    hold(): () => void {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        maybeApply();
      };
    },
    isHeld: () => holds > 0,
  };
}

export const updates = createUpdateGate();

/** Hold updates for as long as `active` is true and the component is mounted. */
export function useHoldUpdates(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    return updates.hold();
  }, [active]);
}
