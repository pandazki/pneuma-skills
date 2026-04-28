import { useState, useEffect } from "react";

/**
 * useAnimatedMount — keep an element mounted long enough to play an exit
 * animation when its owner flips `visible` to false.
 *
 * Returns:
 * - `mounted` — whether the element should currently render at all
 * - `closing` — true while the exit animation is running; consumers use
 *   this to swap from the "enter" to the "exit" CSS animation
 *
 * The owner is expected to call this hook with a boolean derived from its
 * own UI state and to render conditional on `mounted`. The animation CSS
 * itself (e.g. `overlayFadeIn` / `overlayFadeOut`) is the consumer's
 * concern — this hook just times the unmount.
 */
export function useAnimatedMount(visible: boolean, duration = 200) {
  const [mounted, setMounted] = useState(visible);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const timer = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, duration);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return { mounted, closing };
}
