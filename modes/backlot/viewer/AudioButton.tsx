/**
 * A play button for one audio file.
 *
 * Not `<audio controls>`: native media chrome is OS widgetry and the
 * repository's frontend rule bans it in user-facing surfaces. This is one
 * button, the tokens, and an `HTMLAudioElement` nobody can see.
 *
 * ONE CLIP PLAYS AT A TIME. The element that is currently sounding is module
 * state — deliberately, because "stop whatever else is playing" is a fact
 * about the tab, not about any one card, and two voice samples over each
 * other is nobody's intention. A missing or unplayable file becomes a named
 * state on the button, never a silent no-op.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { PauseIcon, PlayIcon } from "./icons.js";

let sounding: HTMLAudioElement | null = null;

export interface AudioButtonProps {
  url: string | null;
  label: string;
  /** Recorded length, printed beside the button when it is known. */
  seconds?: number | null;
  title?: string;
}

export function AudioButton({ url, label, seconds = null, title }: AudioButtonProps) {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      const element = elementRef.current;
      if (!element) return;
      element.pause();
      if (sounding === element) sounding = null;
    };
  }, []);

  // A new URL is a new file: stop the old one rather than leaving it playing
  // under a card that no longer describes it.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.pause();
    if (sounding === element) sounding = null;
    elementRef.current = null;
    setPlaying(false);
    setError(null);
  }, [url]);

  const toggle = useCallback(() => {
    if (!url) return;
    let element = elementRef.current;
    if (!element) {
      element = new Audio(url);
      element.addEventListener("ended", () => setPlaying(false));
      element.addEventListener("pause", () => setPlaying(false));
      element.addEventListener("error", () => {
        setError("could not be played");
        setPlaying(false);
      });
      elementRef.current = element;
    }
    if (!element.paused) {
      element.pause();
      return;
    }
    if (sounding && sounding !== element) sounding.pause();
    sounding = element;
    setError(null);
    void element
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        setError("could not be played");
        setPlaying(false);
      });
  }, [url]);

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        title={title ?? (url ? label : "No audio file for this yet")}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
          url
            ? "border-cc-primary/50 bg-cc-primary/10 text-cc-primary hover:bg-cc-primary/20"
            : "cursor-not-allowed border-cc-border text-cc-muted/50"
        }`}
      >
        {playing ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
      </button>
      {error ? (
        <span className="text-[9px] text-cc-error">{error}</span>
      ) : seconds !== null ? (
        <span className="text-[9px] tabular-nums text-cc-muted">{seconds.toFixed(1)} s</span>
      ) : null}
    </span>
  );
}

export default AudioButton;
