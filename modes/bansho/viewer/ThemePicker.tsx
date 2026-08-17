/** @jsxImportSource react */
/**
 * The board theme picker — three looks, and a real board wearing each one.
 *
 * ── WHY A PREVIEW AND NOT A SWATCH ──────────────────────────────────────────
 * The product owner's whole note on the first sketch was 「不要只有一个名字,
 * 需要一个预览区」. A theme here is not a colour: it is a HAND, and two of the
 * three differ from each other mainly in the shape of the letters. A row of
 * coloured rectangles would show the one axis these themes agree on and hide
 * the one they were chosen for. So the preview is a real `BoardCanvas`, built
 * by the real factories, laid out by the real stylesheet, written in the real
 * face — the same rendering path the lecture itself takes.
 *
 * It renders a FIXED short sample rather than a slice of the reader's own
 * lecture, and that is a deliberate trade. The sample is bounded (one screen,
 * one compile, nothing that can grow with the lecture) and it is bilingual by
 * construction, so the CJK faces — which is where all three themes actually
 * differ — are on screen even when the lecture in the room is English. A
 * slice of the live board would be more literal and would show neither on an
 * English lecture, which is exactly the reader who most needs to see what
 * `HanziPen SC` versus `Xingkai SC` will do.
 *
 * ── SCOPING ─────────────────────────────────────────────────────────────────
 * The candidate's stylesheet is emitted in `presetCss`'s scoped form, so it
 * reaches this subtree and cannot touch the board the reader is watching. The
 * scoped dark selector weighs (0,3,0) against the base and live sheets'
 * (0,2,0), so the preview wins on specificity and never depends on which
 * `<style>` tag landed last.
 *
 * ── AVAILABILITY IS MEASURED ────────────────────────────────────────────────
 * `parchment` and `slate-cursive` are built on macOS system faces and will
 * silently fall back elsewhere. `document.fonts.check()` cannot detect that —
 * it answers `true` for any name the fallback can draw — so every face is
 * measured through `familyAvailable`, and a face the instrument cannot judge
 * is reported as unknown rather than as fine.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { parseLecture } from "../domain.js";
import { familyAvailable } from "../engine/factories/env.js";
import type { EnvCaps } from "../engine/types.js";
import BoardCanvas from "./BoardCanvas.js";
import { loadFamilies } from "./board-fonts.js";
import {
  type BoardThemePreset,
  BOARD_THEMES,
  presetCss,
  presetIdOf,
} from "./themes.js";

/**
 * The sample every preview writes. Short enough to compile instantly and to
 * fit one panel; wide enough to carry what the themes differ on — a heading,
 * CJK body text, Latin body text, the marker sweep and a term's ink.
 */
const SAMPLE_SOURCE = [
  "# 板书 Bansho",
  "",
  "手写一笔一笔地 ==流到板上==,**重点**留在原处。",
  "",
  "The hand writes it out, and ((the term)) stays where it landed.",
  "",
].join("\n");

const PREVIEW_SCOPE = "bansho-theme-preview";

/** A face, and what the measurement said about it. */
interface FaceVerdict {
  family: string;
  /** `null` = the instrument could not judge; never rendered as "fine". */
  present: boolean | null;
}

type Verdicts = Record<string, FaceVerdict[]>;

export interface ThemePickerProps {
  /** The active content set's `theme.css`, or undefined when it has none. */
  themeCss: string | undefined;
  /** The reader's app chrome — the preview wears the same one. */
  theme: "light" | "dark";
  /** Session-fixed caps (§5.2). Passed down, never re-probed here. */
  env: EnvCaps;
  /** Writes the preset through to the content set's `theme.css`. */
  onApply: (preset: BoardThemePreset) => Promise<void>;
  onClose: () => void;
}

export default function ThemePicker({
  themeCss,
  theme,
  env,
  onApply,
  onClose,
}: ThemePickerProps): React.ReactElement {
  const currentId = presetIdOf(themeCss);
  const [candidateId, setCandidateId] = useState<string>(
    currentId ?? BOARD_THEMES[0]!.id,
  );
  const candidate =
    BOARD_THEMES.find((t) => t.id === candidateId) ?? BOARD_THEMES[0]!;

  // A `theme.css` with no marker is somebody's work — an author's, or the
  // agent's. Replacing it is still allowed (it is the reader's lecture), but
  // never in one click and never silently.
  const wouldOverwriteHandwritten = Boolean(themeCss) && currentId === null;
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const lecture = useMemo(
    () => parseLecture(SAMPLE_SOURCE, "theme-preview"),
    [],
  );

  // ── Measured availability, once, for all three ───────────────────────────
  // The bundled face has to be LOADED before it can be measured, or the
  // theme that is guaranteed to work reports itself missing.
  const [verdicts, setVerdicts] = useState<Verdicts>({});
  useEffect(() => {
    let cancelled = false;
    const bundled = BOARD_THEMES.flatMap((t) =>
      t.faces.filter((f) => f.bundled).map((f) => f.family),
    );
    void loadFamilies(document, bundled).then(() => {
      if (cancelled) return;
      const next: Verdicts = {};
      for (const preset of BOARD_THEMES) {
        next[preset.id] = preset.faces.map((face) => ({
          family: face.family,
          present: familyAvailable(document, face.family, face.sample),
        }));
      }
      setVerdicts(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Dismiss on Escape — the panel covers the board, so leaving it must not
  // require finding a button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const apply = async (): Promise<void> => {
    if (wouldOverwriteHandwritten && !confirming) {
      setConfirming(true);
      return;
    }
    setApplying(true);
    setFailure(null);
    try {
      await onApply(candidate);
      setConfirming(false);
      onClose();
    } catch (e) {
      // A write that did not land must say so — a picker that closes on a
      // failed write tells the reader their board changed when it did not.
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Board theme"
      className="w-[420px] max-w-[80vw] rounded-lg border border-cc-border bg-cc-surface/95 backdrop-blur shadow-xl overflow-hidden text-left"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-cc-border">
        <div className="text-[12px] font-medium text-cc-fg">
          Board theme
          <span className="ml-2 text-[11px] text-cc-muted/80 font-normal">
            this lecture&rsquo;s own theme.css
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] px-1.5 py-0.5 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-surface cursor-pointer focus-visible:ring-2 focus-visible:ring-cc-primary/60"
        >
          Close
        </button>
      </div>

      {/* The preview: a real board, in the candidate's look. */}
      <div className={`${PREVIEW_SCOPE} relative h-[210px] bg-cc-bg`}>
        <style data-bansho-theme-preview>
          {presetCss(candidate, `.${PREVIEW_SCOPE}`)}
        </style>
        <PreviewBoard lecture={lecture} theme={theme} env={env} />
      </div>

      <div className="p-2 flex flex-col gap-1">
        {BOARD_THEMES.map((preset) => (
          <ThemeRow
            key={preset.id}
            preset={preset}
            selected={preset.id === candidate.id}
            installed={preset.id === currentId}
            verdict={verdicts[preset.id]}
            onPick={() => {
              setCandidateId(preset.id);
              setConfirming(false);
              setFailure(null);
            }}
          />
        ))}
      </div>

      <div className="px-3 py-2 border-t border-cc-border flex items-center justify-between gap-2">
        <div className="text-[11px] text-cc-muted/80 min-w-0">
          {failure ? (
            <span className="text-cc-error">Could not write: {failure}</span>
          ) : confirming ? (
            <span className="text-cc-warning">
              This lecture has a hand-written theme.css. Replace it?
            </span>
          ) : (
            <>Writes {"{set}/theme.css"} — the agent can read and edit it after.</>
          )}
        </div>
        <button
          type="button"
          disabled={applying}
          onClick={() => void apply()}
          className={[
            "shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors",
            "focus-visible:ring-2 focus-visible:ring-cc-primary/60",
            applying
              ? "border-cc-border bg-cc-surface text-cc-muted cursor-wait"
              : confirming
                ? "border-cc-warning/50 bg-cc-warning/20 text-cc-warning hover:bg-cc-warning/30 cursor-pointer"
                : "border-cc-primary/40 bg-cc-primary/20 text-cc-primary hover:bg-cc-primary/30 cursor-pointer",
          ].join(" ")}
        >
          {applying
            ? "Writing…"
            : confirming
              ? "Replace it"
              : `Use ${candidate.labelZh}`}
        </button>
      </div>
    </div>
  );
}

/**
 * One row: the name it was chosen under, the hand it is, and — when the
 * measurement has something to say — what this machine will actually draw.
 */
function ThemeRow({
  preset,
  selected,
  installed,
  verdict,
  onPick,
}: {
  preset: BoardThemePreset;
  selected: boolean;
  installed: boolean;
  verdict: FaceVerdict[] | undefined;
  onPick: () => void;
}): React.ReactElement {
  const missing = (verdict ?? []).filter((v) => v.present === false);
  const unknown = (verdict ?? []).filter((v) => v.present === null);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={[
        "w-full text-left px-2 py-1.5 rounded-md border transition-colors cursor-pointer",
        "focus-visible:ring-2 focus-visible:ring-cc-primary/60",
        selected
          ? "border-cc-primary/40 bg-cc-primary/10"
          : "border-transparent hover:bg-cc-surface",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="w-4 h-4 rounded-sm border border-cc-border/70 shrink-0"
          style={{ background: preset.tokens["--board"] }}
        />
        <span className="text-[12px] font-medium text-cc-fg">
          {preset.labelZh}
        </span>
        <span className="text-[11px] text-cc-muted/70 truncate">
          {preset.label} · {preset.hand}
        </span>
        {installed ? (
          <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-cc-primary/15 text-cc-primary">
            in use
          </span>
        ) : null}
      </div>
      {missing.length > 0 ? (
        // Say it plainly. The whole reason this is measured rather than
        // asked is that the cheap API answers "yes" for a font nobody has.
        <div className="mt-1 text-[10.5px] text-cc-warning">
          not on this machine: {missing.map((v) => v.family).join(", ")} — the
          board will fall back, so it will not look like the preview here
        </div>
      ) : unknown.length > 0 ? (
        <div className="mt-1 text-[10.5px] text-cc-muted/70">
          could not measure {unknown.map((v) => v.family).join(", ")} on this
          browser — availability unknown
        </div>
      ) : null}
    </button>
  );
}

/**
 * A `BoardCanvas` frozen at the end of its own timeline — the sample fully
 * written, nothing playing, no camera work, no agent to point at.
 */
function PreviewBoard({
  lecture,
  theme,
  env,
}: {
  lecture: ReturnType<typeof parseLecture>;
  theme: "light" | "dark";
  env: EnvCaps;
}): React.ReactElement {
  // Identity-stable no-op subscriptions: the canvas contract requires them
  // not to change across renders, and a preview has no transport to drive.
  const noop = useRef(() => () => {}).current;
  return (
    <BoardCanvas
      lecture={lecture}
      view="board"
      theme={theme}
      fontsReady
      env={env}
      getPlayheadT={PLAYHEAD_END}
      onCompiled={NOOP}
      activeIndex={0}
      playing={false}
      follow="live"
      onSeek={noop}
      onFrame={noop}
      selectedRef={null}
    />
  );
}

/** Past the end of any sample this file will ever hold: fully written. */
const PLAYHEAD_END = (): number => 9_999;
const NOOP = (): void => {};
