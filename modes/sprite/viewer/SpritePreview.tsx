/**
 * Sprite viewer — the motion stage.
 *
 * The shell: it owns the character selection, the playback clock, and every
 * seam that faces the agent (actions, locator navigation, capture, commands).
 * The pieces it composes are dumb on purpose — `Stage` draws, `FrameStrip`
 * transports, `MotionRail` lists, `PreviewPanel` shows deliverables — because
 * the state that must stay coherent is exactly the state an agent can read
 * back with `get-playback-state`, and it lives here in one place.
 *
 * Two conventions worth knowing before changing anything:
 *
 * 1. AN AGENT'S NAVIGATION PAUSES; A HUMAN'S CLICK PLAYS. `navigate-to`
 *    seeks and stops, because `capture` pre-navigates and then screenshots
 *    ~1.1 s later — a stage still animating would hand back whichever frame
 *    happened to land, and the agent would believe it was looking at the one
 *    it asked for. A locator card pressed by a person is the opposite case:
 *    they want to see it move, so that path autoplays.
 *
 * 2. NOTHING HERE WRITES. Frames, atlases, previews and `project.json` are
 *    produced by the mode's scripts; the viewer reads. fps and loop are
 *    session-local overrides (see `FrameStrip`), and every user request that
 *    would change a file goes to the agent as a command notification.
 *
 * Player compatibility (`5c`): every asset URL is `/content/...`, no `/api/*`
 * call is made at render time, and the command bar is gated on
 * `editing !== false`, `readonly` and `staticPlayer`, so the hosted player
 * shows a motion without offering to change it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Source } from "../../../core/types/source.js";
import type {
  ViewerActionResult,
  ViewerPreviewProps,
} from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import {
  findMotion,
  findRef,
  resolveAssetUri,
  type Motion,
  type Roster,
  type VideoModel,
} from "../domain.js";
import { setSpriteStageCapture } from "../pneuma-mode.js";
import { CommandBar } from "./CommandPopovers.js";
import { FrameStrip } from "./FrameStrip.js";
import { frameThumbnail, type StageBackground, type StageZoom } from "./frame-render.js";
import { MotionRail } from "./MotionRail.js";
import { PreviewPanel, type PanelTab } from "./PreviewPanel.js";
import {
  advance,
  clampFrame,
  contentSetMismatch,
  declaredFrameCount,
  frameCountOf,
  parseAddress,
  playbackStateData,
  resolveAddress,
  resolveFrameSource,
  selectActiveCharacter,
  stepFrame,
  transportIntent,
  typingTarget,
  type FrameSource,
  type PlaybackState,
} from "./playback.js";
import { Stage } from "./Stage.js";
import { RailIcon } from "./icons.js";
import { useFrameImages } from "./useFrameImages.js";
import { contentUrl } from "./urls.js";

/** Below this the preview panel moves under the stage instead of beside it. */
const WIDE_PANE_PX = 900;
/** Below this the rail folds away — the stage is what matters on a small pane. */
const RAIL_PANE_PX = 680;

export { selectActiveCharacter };

export default function SpritePreview(props: ViewerPreviewProps) {
  const rosterSource = props.sources.roster as Source<Roster> | undefined;
  const { value: roster } = useSource(rosterSource);
  const activeContentSet = useStore((s) => s.activeContentSet);
  const staticPlayer = useStore((s) => s.staticPlayer);

  const character = useMemo(
    () => selectActiveCharacter(roster, activeContentSet),
    [roster, activeContentSet],
  );

  // ── Selection ────────────────────────────────────────────────────────────
  const [motionId, setMotionId] = useState<string | null>(null);
  const [refId, setRefId] = useState<string | null>(null);
  const [fpsOverride, setFpsOverride] = useState<number | null>(null);
  const [loopOverride, setLoopOverride] = useState<boolean | null>(null);

  // ── Stage chrome ─────────────────────────────────────────────────────────
  const [background, setBackground] = useState<StageBackground>("checker");
  const [zoom, setZoom] = useState<StageZoom>("fit");
  const [onion, setOnion] = useState(false);
  const [ground, setGround] = useState(true);
  const [tab, setTab] = useState<PanelTab>("gif");
  const [railOpen, setRailOpen] = useState(true);
  const [paneWidth, setPaneWidth] = useState(1200);
  /** A command popover owns the keyboard while it is open (see the transport
   *  shortcuts below): its own buttons and note field must keep Space. */
  const [popoverOpen, setPopoverOpen] = useState(false);

  // ── Playback ─────────────────────────────────────────────────────────────
  const playRef = useRef<PlaybackState>({ frame: 0, acc: 0, playing: false });
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  /**
   * Mirrors of the selection state, written synchronously.
   *
   * An action arrives, changes the stage, and must report what the stage now
   * shows — all inside one handler. React state is a render behind at that
   * moment, so answering out of it made `navigate-to` report the frame it was
   * ON rather than the frame it had just moved to: a plausible, wrong answer,
   * which is the failure mode this whole viewer is built to avoid. These refs
   * are the same values one tick earlier, and every reader that has to be
   * correct *now* uses them.
   */
  const motionIdRef = useRef<string | null>(null);
  const refIdRef = useRef<string | null>(null);
  const fpsOverrideRef = useRef<number | null>(null);
  const loopOverrideRef = useRef<boolean | null>(null);

  const showRef = useCallback((id: string | null) => {
    refIdRef.current = id;
    setRefId(id);
  }, []);
  const applyFps = useCallback((value: number | null) => {
    fpsOverrideRef.current = value;
    setFpsOverride(value);
  }, []);
  const applyLoop = useCallback((value: boolean | null) => {
    loopOverrideRef.current = value;
    setLoopOverride(value);
  }, []);

  const motion = useMemo(
    () => (character && motionId ? (findMotion(character, motionId) ?? null) : null),
    [character, motionId],
  );

  const motionSource = useMemo(
    () => resolveFrameSource(character, motion, props.imageVersion),
    [character, motion, props.imageVersion],
  );

  // A reference is put on the stage as a one-frame source, so it goes through
  // the same draw, the same zoom and the same capture as everything else.
  const refUrl = useMemo(() => {
    if (!character || !refId) return null;
    const ref = findRef(character, refId);
    const uri = ref ? resolveAssetUri(character, ref.asset) : undefined;
    return uri ? contentUrl(character.contentSet, uri, props.imageVersion) : null;
  }, [character, refId, props.imageVersion]);

  const stageSource: FrameSource = useMemo(
    () =>
      refUrl
        ? { kind: "raw-sheet", url: refUrl, cols: 1, rows: 1, count: 1, alpha: true }
        : motionSource,
    [refUrl, motionSource],
  );

  const images = useFrameImages(stageSource);
  const count = frameCountOf(stageSource);
  const countRef = useRef(count);
  countRef.current = count;

  const fps = fpsOverride ?? motion?.fps ?? 8;
  const loop = loopOverride ?? motion?.loop ?? true;

  const setPlay = useCallback((value: boolean) => {
    playRef.current = { ...playRef.current, playing: value, acc: 0 };
    setPlaying(value);
  }, []);

  const seek = useCallback((next: number) => {
    const clamped = clampFrame(next, countRef.current);
    playRef.current = { ...playRef.current, frame: clamped, acc: 0 };
    setFrame(clamped);
  }, []);

  /** Put a motion on the stage. `play` is the caller's intent, not a default. */
  const lastMotionRef = useRef<string | null>(null);
  const showMotion = useCallback(
    (id: string, options: { frame?: number | null; play?: boolean } = {}) => {
      showRef(null);
      // Overrides belong to the motion they were dialled in on.
      if (lastMotionRef.current !== id) {
        lastMotionRef.current = id;
        applyFps(null);
        applyLoop(null);
      }
      motionIdRef.current = id;
      setMotionId(id);
      const target = character ? findMotion(character, id) : null;
      const frameTarget = clampFrame(
        options.frame ?? 0,
        target ? declaredFrameCount(target) : 0,
      );
      playRef.current = { frame: frameTarget, acc: 0, playing: options.play ?? false };
      setFrame(frameTarget);
      setPlaying(options.play ?? false);
    },
    [character, showRef, applyFps, applyLoop],
  );

  /** Whether a motion is worth autoplaying: it has to have something to play. */
  const playable = useCallback(
    (candidate: Motion | null | undefined): boolean =>
      !!candidate && declaredFrameCount(candidate) > 1,
    [],
  );

  // Land on something as soon as a character exists, and never keep pointing
  // at a motion the agent has removed.
  useEffect(() => {
    if (!character) {
      motionIdRef.current = null;
      setMotionId(null);
      return;
    }
    const motions = character.sprite.motions;
    if (motionId && motions.some((m) => m.id === motionId)) return;
    const next = motions.find((m) => m.status === "ready") ?? motions[0];
    if (next) showMotion(next.id, { play: playable(next) });
    else {
      motionIdRef.current = null;
      setMotionId(null);
    }
  }, [character, motionId, showMotion, playable]);

  // The frame source can shrink under the playhead (a re-run with fewer
  // frames); keep the index inside it. A reference on the stage is NOT that
  // case — it is a one-frame source standing in front of the motion, and
  // resetting the playhead for it would lose the frame the user was on.
  const motionFrameCount = frameCountOf(motionSource);
  useEffect(() => {
    if (refId) return;
    if (playRef.current.frame < motionFrameCount) return;
    seek(Math.max(0, motionFrameCount - 1));
  }, [motionFrameCount, refId, seek]);

  // ── The clock ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !images.ready || count <= 1) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = advance(playRef.current, now - last, {
        frameCount: count,
        fps,
        loop,
      });
      last = now;
      if (next.frame !== playRef.current.frame) setFrame(next.frame);
      playRef.current = next;
      if (!next.playing) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, images.ready, count, fps, loop]);

  // ── Selection reported to the agent ──────────────────────────────────────
  const { onSelect } = props;
  const reportSelection = useCallback(
    (target: Motion | null, frameIndex: number | null) => {
      if (!character || !target) {
        onSelect(null);
        return;
      }
      const address: Record<string, unknown> = {
        contentSet: character.contentSet,
        motion: target.id,
      };
      if (frameIndex !== null) address.frame = frameIndex;
      const thumbnail =
        frameIndex !== null ? frameThumbnail(stageSource, images, frameIndex) : null;
      onSelect({
        type: "image",
        content: target.prompt || target.label,
        label:
          frameIndex !== null
            ? `${target.label} — frame ${String(frameIndex).padStart(2, "0")}`
            : `${target.label} (${target.status})`,
        address,
        ...(thumbnail ? { thumbnail } : {}),
      });
    },
    [character, onSelect, stageSource, images],
  );

  const reportRefSelection = useCallback(
    (id: string) => {
      if (!character) return;
      const ref = findRef(character, id);
      if (!ref) return;
      onSelect({
        type: "image",
        content: ref.label,
        label: `${ref.label} (reference, ${ref.role})`,
        address: { contentSet: character.contentSet, ref: ref.id },
      });
    },
    [character, onSelect],
  );

  // ── The transport, however it is driven ──────────────────────────────────
  //
  // The buttons and the keyboard call the SAME two functions. A shortcut that
  // stepped the playhead without pausing, or without telling the agent what
  // the user is now looking at, would be a second transport with its own
  // behaviour — and the drift would only show up as an agent answering about
  // a frame nobody is on.

  /** Step by hand: stop the clock, move one frame, report where we landed. */
  const stepBy = useCallback(
    (delta: number) => {
      setPlay(false);
      const next = stepFrame(playRef.current.frame, delta, countRef.current);
      seek(next);
      reportSelection(motion, next);
    },
    [setPlay, seek, reportSelection, motion],
  );

  /** Jump to one frame by hand — a strip click, Home, End. */
  const seekTo = useCallback(
    (index: number) => {
      setPlay(false);
      seek(index);
      reportSelection(motion, index);
    },
    [setPlay, seek, reportSelection, motion],
  );

  const togglePlay = useCallback(() => {
    setPlay(!playRef.current.playing);
  }, [setPlay]);

  /**
   * Keyboard transport.
   *
   * On `document`, because the stage is a canvas with no focus of its own and
   * a shortcut that only works after clicking the right pixel is not a
   * shortcut. Everything that could mean something else to whoever is
   * actually focused is handed back: text fields and contenteditables
   * (`typingTarget`), modifier combinations and key repeat
   * (`transportIntent`), and an open command popover, whose own buttons take
   * Space. `preventDefault` is what keeps Space from scrolling the pane — and
   * from double-firing on a transport button that still has focus after being
   * clicked.
   */
  const transportLive = !refId && count > 0;
  useEffect(() => {
    if (!transportLive || popoverOpen || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (typingTarget(event.target as HTMLElement | null)) return;
      const intent = transportIntent(event);
      if (!intent) return;
      event.preventDefault();
      if (intent === "toggle-play") togglePlay();
      else if (intent === "step-back") stepBy(-1);
      else if (intent === "step-forward") stepBy(1);
      else if (intent === "first-frame") seekTo(0);
      else seekTo(Math.max(0, countRef.current - 1));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [transportLive, popoverOpen, togglePlay, stepBy, seekTo]);

  // ── Capture: the stage canvas, not the whole pane ────────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
  }, []);

  useEffect(() => {
    setSpriteStageCapture(async () => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
      try {
        const url = canvas.toDataURL("image/png");
        return { data: url.slice(url.indexOf(",") + 1), media_type: "image/png" };
      } catch {
        // Tainted canvas — let the framework fall back to a DOM capture.
        return null;
      }
    });
    return () => setSpriteStageCapture(null);
  }, []);

  // ── Address routing, shared by the action and the locator card ───────────
  const runAddress = useCallback(
    (raw: unknown, intent: { autoplay: boolean }): ViewerActionResult => {
      const address = parseAddress(raw);
      const resolution = resolveAddress(character, address, motionId);
      const target = resolution.target;
      if (target?.kind === "ref") {
        showRef(target.refId);
        setPlay(false);
      } else if (target?.kind === "motion") {
        const next = character ? findMotion(character, target.motionId) : null;
        showMotion(target.motionId, {
          frame: target.frame ?? 0,
          // An address that names a frame always stops there — that is the
          // whole point of naming it.
          play: target.frame === null && intent.autoplay && playable(next),
        });
      } else if (target?.kind === "character") {
        showRef(null);
      }
      return {
        success: resolution.ok,
        ...(resolution.message ? { message: resolution.message } : {}),
      };
    },
    [character, motionId, setPlay, showMotion, showRef, playable],
  );

  /**
   * The stage described for the agent, optionally about another motion.
   *
   * Always reports the MOTION's frame source, never the stage's: a reference
   * image on the stage is a one-frame source, and letting it through here
   * would tell the agent the motion had one frame and no aligned output. The
   * reference is reported as a warning instead — true, and not confusable
   * with a pipeline result.
   */
  const readState = useCallback(
    (raw: unknown): ViewerActionResult => {
      const address = parseAddress(raw);
      // Another character's name must not be answered with this character's
      // stage — the same refusal `navigate-to` gives, for the same reason:
      // a state report about the wrong sprite reads exactly like a right one.
      const mismatch = contentSetMismatch(character, address.contentSet);
      if (mismatch) return { success: false, message: mismatch };
      const named = address.motion && character ? findMotion(character, address.motion) : null;
      if (address.motion && !named) {
        return {
          success: false,
          message: `Motion "${address.motion}" is not in this character.`,
        };
      }
      const stageMotionId = motionIdRef.current;
      const onStageMotion =
        character && stageMotionId ? (findMotion(character, stageMotionId) ?? null) : null;
      const subject = named ?? onStageMotion;
      const onStage = !!subject && subject.id === stageMotionId;
      const source = resolveFrameSource(character, subject, props.imageVersion);
      const data = playbackStateData({
        project: character,
        motion: subject,
        source,
        frame: onStage ? playRef.current.frame : 0,
        playing: onStage ? playRef.current.playing : false,
        fps: onStage
          ? (fpsOverrideRef.current ?? subject?.fps ?? 8)
          : (subject?.fps ?? 8),
        loop: onStage
          ? (loopOverrideRef.current ?? subject?.loop ?? true)
          : (subject?.loop ?? true),
      });
      if (onStage && refIdRef.current) {
        data.warnings = [
          ...data.warnings,
          `A reference image ("${refIdRef.current}") is on the stage in front of this motion, so playback is paused.`,
        ];
      }
      return {
        success: true,
        ...(subject && !onStage ? { message: `"${subject.id}" is not the motion on stage.` } : {}),
        data,
      };
    },
    [character, props.imageVersion],
  );

  // ── Agent actions ────────────────────────────────────────────────────────
  const { actionRequest, onActionResult } = props;
  useEffect(() => {
    if (!actionRequest || !onActionResult) return;
    const { requestId, actionId, params } = actionRequest;

    switch (actionId) {
      case "navigate-to": {
        const result = runAddress(params?.address, { autoplay: false });
        // Report where the stage IS now — including after a refusal, where
        // "nothing moved, here is what you are still looking at" is the
        // useful answer.
        onActionResult(requestId, {
          ...result,
          data: (readState(undefined).data ?? {}) as Record<string, unknown>,
        });
        break;
      }
      case "play": {
        let result: ViewerActionResult = { success: true };
        if (params?.address !== undefined) {
          result = runAddress(params.address, { autoplay: false });
          if (!result.success) {
            onActionResult(requestId, result);
            break;
          }
        }
        if (typeof params?.fps === "number" && params.fps > 0) {
          applyFps(params.fps);
        }
        if (typeof params?.loop === "boolean") applyLoop(params.loop);
        setPlay(true);
        onActionResult(requestId, {
          ...result,
          success: true,
          data: (readState(undefined).data ?? {}) as Record<string, unknown>,
        });
        break;
      }
      case "pause": {
        setPlay(false);
        onActionResult(requestId, readState(undefined));
        break;
      }
      case "get-playback-state": {
        onActionResult(requestId, readState(params?.address));
        break;
      }
      default:
        onActionResult(requestId, {
          success: false,
          message: `Unknown action: ${actionId}`,
        });
    }
    // Only a NEW request may run this; every value it reads comes from the
    // render that request arrived in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRequest]);

  // ── Locator cards ────────────────────────────────────────────────────────
  const { navigateRequest, onNavigateComplete } = props;
  useEffect(() => {
    if (!navigateRequest) return;
    const result = runAddress(navigateRequest.address, { autoplay: true });
    onNavigateComplete?.(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRequest]);

  // ── Layout ───────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPaneWidth(Math.round(width));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const showRail = railOpen && paneWidth >= RAIL_PANE_PX;
  const panelPlacement = paneWidth >= WIDE_PANE_PX ? "side" : "bottom";

  const commandsEnabled =
    props.editing !== false && !props.readonly && !staticPlayer && !!props.onNotifyAgent;
  const defaultVideoModel: VideoModel =
    props.initParams?.defaultVideoModel === "h3-max" ? "h3-max" : "seedance-2.5";

  if (!character) {
    return (
      <div
        ref={rootRef}
        className="flex h-full w-full items-center justify-center bg-cc-bg p-8 text-center"
      >
        <div className="max-w-md">
          <h1 className="text-base text-cc-fg">No character yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-cc-muted">
            Sprite starts with a character — a name, a look, a style. Describe
            one in the chat and the agent will draw its references, then you can
            ask for motions: idle, walk, attack.
          </p>
        </div>
      </div>
    );
  }

  const identity = character.sprite.character;
  const refCount = character.sprite.refs.length;
  const motionCount = character.sprite.motions.length;
  const activeRef = refId ? findRef(character, refId) : null;

  return (
    <div ref={rootRef} className="flex h-full w-full flex-col bg-cc-bg text-cc-fg">
      <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-cc-border bg-cc-surface/40 px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => setRailOpen((value) => !value)}
          title={showRail ? "Hide the rail" : "Show the rail"}
          aria-pressed={showRail}
          disabled={paneWidth < RAIL_PANE_PX}
          className={`rounded p-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 disabled:opacity-30 ${
            showRail
              ? "bg-cc-primary/15 text-cc-primary"
              : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          }`}
        >
          <RailIcon size={14} />
        </button>

        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-sm font-medium text-cc-fg">
            {identity.name}
          </h1>
          <p className="truncate text-[11px] text-cc-muted">
            {identity.cell.width}×{identity.cell.height} cell
            {identity.facing ? ` · facing ${identity.facing}` : ""} · {refCount}{" "}
            reference{refCount === 1 ? "" : "s"} · {motionCount} motion
            {motionCount === 1 ? "" : "s"}
          </p>
        </div>

        {identity.style ? (
          <span
            className="hidden max-w-[22rem] truncate rounded-full border border-cc-border px-2 py-0.5 text-[11px] text-cc-muted lg:inline"
            title={identity.style}
          >
            {identity.style}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {commandsEnabled && props.commands?.length ? (
            <CommandBar
              commands={props.commands}
              motion={motion}
              defaultVideoModel={defaultVideoModel}
              onNotifyAgent={props.onNotifyAgent!}
              onOpenChange={setPopoverOpen}
            />
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {showRail ? (
          <MotionRail
            project={character}
            imageVersion={props.imageVersion}
            selectedMotionId={motionId}
            selectedRefId={refId}
            onSelectMotion={(id) => {
              const next = findMotion(character, id);
              showMotion(id, { play: playable(next) });
              reportSelection(next ?? null, null);
            }}
            onSelectRef={(id) => {
              showRef(id);
              setPlay(false);
              reportRefSelection(id);
            }}
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            <Stage
              source={stageSource}
              images={images}
              frame={frame}
              motion={refId ? null : motion}
              refLabel={activeRef ? activeRef.label : null}
              theme={props.theme}
              background={background}
              zoom={zoom}
              onion={onion}
              ground={ground}
              onBackground={setBackground}
              onZoom={setZoom}
              onOnion={setOnion}
              onGround={setGround}
              onCanvas={handleCanvas}
            />

            {activeRef ? (
              <div className="flex shrink-0 items-center gap-2 border-t border-cc-border bg-cc-surface/30 px-3 py-2 text-[11px]">
                <span className="text-cc-muted">
                  Showing the reference{" "}
                  <span className="text-cc-fg">{activeRef.label}</span>
                </span>
                {motion ? (
                  <button
                    type="button"
                    onClick={() => {
                      showRef(null);
                      showMotion(motion.id, { play: playable(motion) });
                    }}
                    className="ml-auto rounded border border-cc-border px-2 py-1 text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-primary"
                  >
                    Back to {motion.label}
                  </button>
                ) : null}
              </div>
            ) : (
              <FrameStrip
                source={stageSource}
                images={images}
                frame={frame}
                playing={playing}
                count={count}
                fps={fps}
                loop={loop}
                motionFps={motion?.fps ?? 8}
                motionLoop={motion?.loop ?? true}
                onTogglePlay={togglePlay}
                onStep={stepBy}
                onSeek={seekTo}
                onFps={applyFps}
                onLoop={applyLoop}
              />
            )}
          </div>

          {panelPlacement === "bottom" ? (
            <PreviewPanel
              project={character}
              motion={motion}
              imageVersion={props.imageVersion}
              tab={tab}
              onTab={setTab}
              placement="bottom"
            />
          ) : null}
        </div>

        {panelPlacement === "side" ? (
          <PreviewPanel
            project={character}
            motion={motion}
            imageVersion={props.imageVersion}
            tab={tab}
            onTab={setTab}
            placement="side"
          />
        ) : null}
      </div>
    </div>
  );
}
