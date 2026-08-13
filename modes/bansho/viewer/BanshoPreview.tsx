/**
 * BanshoPreview (T4 + T6) — the player shell: the 讲稿 drawer (source with
 * line-level playback highlight, G6 consumer — folded away by default, see
 * ScriptDrawer.tsx), the board (BoardCanvas),
 * the ask bar and the transport (Timeline). Live-follow state lives in the
 * player hook; this component wires sources → lecture → compiled board →
 * player, and owns the whole interaction surface: which step the user is
 * pointing at, the three actions the agent can call, the three things the
 * user can ask for, and the three things the board reports on its own.
 *
 * Chrome uses the app's `cc-*` tokens; the board surface uses bansho board
 * tokens overridable by a content set's `theme.css` (see board-css.ts for
 * the split rationale).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ViewerActionResult,
  ViewerAddress,
  ViewerCommandDescriptor,
  ViewerPreviewProps,
} from "../../../core/types/viewer-contract.js";
import type { Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import { getApiBase } from "../../../src/utils/api.js";
import type { Board } from "../domain.js";
import {
  FALLBACK_GLYPH_LIST_CAP,
  glyphsFallingBack,
  probeEnvCaps,
} from "../engine/factories/index.js";
import type { EnvCaps, Lecture, StepRef } from "../engine/types.js";
import {
  illustrationSource,
  illustrationSources,
  undrawnIllustrations,
} from "../illustrations/types.js";
import { buildNarrationPlan } from "../narration/plan.js";
import {
  withoutMissingClips,
  type NarrationManifestRead,
} from "../narration/types.js";
import {
  describeStep,
  foreignSet,
  formatAddress,
  resolveAddress,
  stepAt,
  stepWindow,
  summarizeStep,
  toAddress,
} from "./address.js";
import {
  collectFindings,
  deriveCollisionNotification,
  deriveNotifications,
  reportBoardCheck,
} from "./board-check.js";
import { glanceBoard, SNAPSHOT_WAIT_MS } from "./glance.js";
import {
  resolveFrames,
  type FrameCandidate,
  type FramePerformed,
} from "./board-frame.js";
import { captureViewer } from "../../../src/utils/viewer-capture.js";
import { AudioConductor } from "./audio-conductor.js";
import { TrackConductor } from "./track-conductor.js";
import { layOutTrack, verifyTrack } from "../narration/track.js";
import BoardCanvas, {
  type BoardApi,
  type CompiledBoard,
} from "./BoardCanvas.js";
import BoardCommands from "./BoardCommands.js";
import { BOARD_BASE_CSS } from "./board-css.js";
import {
  narrateResponse,
  probeMissingClips,
  subtitlesResponse,
} from "./narration-actions.js";
import {
  buildCommandNotification,
  selectionForStep,
  type BoardMoment,
} from "./context.js";
import { setBoardMomentReader } from "./player-status.js";
import ScriptDrawer from "./ScriptDrawer.js";
import {
  hydrationJoin,
  relatchOnSelectionChange,
  resolveSetKey,
} from "./set-latch.js";
import Timeline from "./Timeline.js";
import { useBoardPlayer } from "./useBoardPlayer.js";

const INERT_ENV: EnvCaps = {
  handwritingFontActive: false,
  strokeFontCovers: () => false,
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((v) => b.has(v));

/**
 * frame-board's honest watermark (§6.2): what has actually PERFORMED this
 * session, which is a different fact from what the document says. Session
 * state, zero disk — the qualifier "this session" is in the wording because
 * the number cannot survive a reload and must not pretend to.
 */
function readPerformed(
  compiled: { timeline: { schedule: readonly { step: StepRef }[] } } | null,
  activeIndex: number,
): FramePerformed {
  const schedule = compiled?.timeline.schedule ?? [];
  if (schedule.length === 0) return { where: null, pending: 0 };
  const i = Math.min(activeIndex, schedule.length - 1);
  const entry = i >= 0 ? schedule[i] : undefined;
  return {
    where: entry ? formatAddress(toAddress(entry.step)) : null,
    pending: Math.max(0, schedule.length - 1 - i),
  };
}


export default function BanshoPreview({
  sources,
  theme,
  selection,
  onSelect,
  commands,
  onNotifyAgent,
  actionRequest,
  onActionResult,
  navigateRequest,
  onNavigateComplete,
  readonly,
  editing,
}: ViewerPreviewProps) {
  const { value: board, status: boardStatus } = useSource<Board>(
    (sources.board as Source<Board> | undefined) ?? null,
  );
  // RAW store value — `null` means "the async content-set matcher has not
  // resolved yet", which is a different fact from "the root set". The
  // latch below depends on telling those two apart.
  const activeContentSet = useStore((state) => state.activeContentSet);
  const filesHydrated = useStore((state) => state.filesHydrated);

  // One key for the lecture AND its theme (set-latch.ts): resolving them
  // through separate fallback chains rendered a seeded board with no
  // theme.css during the pre-selection window.
  const setKey = useMemo(
    () => resolveSetKey(Object.keys(board?.byContentSet ?? {}), activeContentSet),
    [board, activeContentSet],
  );
  const lecture = setKey === null ? null : (board?.byContentSet[setKey] ?? null);
  const themeCss = setKey === null ? undefined : board?.themeCss[setKey];
  const narrationRead: NarrationManifestRead | null =
    setKey === null ? null : (board?.narration[setKey] ?? null);

  // Live-join decision, latched ONCE per session: a board that already
  // existed when the WORKSPACE opened is history — the player joins at
  // its tip (zero replay, F22). A board that did NOT exist yet is a
  // broadcast about to start — its first compile plays from 0 (R2).
  // Until hydration resolves the latch stays open and the conservative
  // default (tip) applies, so a slow initial fetch can never replay an
  // existing board from scratch.
  //
  // The verdict reads the HYDRATION SNAPSHOT (`filesAtHydration`), not
  // the live file list — see hydrationJoin's header: this component can
  // MOUNT long after hydration (empty workspace → the app shell renders
  // the seed gallery instead of the viewer; the first mount happens once
  // seed content landed), and the live list at that moment would judge
  // the freshly seeded board pre-existing and show it fully written, no
  // performance. Nor does it read the parsed source value: the
  // AggregateFileSource only exists once useSourceInstances' passive
  // effect has committed, and App.tsx's /api/files fetch can resolve
  // before that flush. The snapshot is written synchronously before
  // `markFilesHydrated`, so it is race-free by construction.
  const filesAtHydration = useStore((state) => state.filesAtHydration);
  const joinAtTipRef = useRef<boolean | null>(null);
  if (joinAtTipRef.current === null) {
    joinAtTipRef.current = hydrationJoin(filesAtHydration);
  }

  // §7.4 — first measurement only after fonts are ready; §5.2 — env caps
  // are probed once and stay session-fixed (scrub determinism).
  const [fontsReady, setFontsReady] = useState(false);
  const [env, setEnv] = useState<EnvCaps>(INERT_ENV);
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      setEnv(probeEnvCaps(document));
      setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // §6.4-A chip — measured SEPARATELY from `env` on purpose. §6.3 makes the
  // `--hand` stack the seed's property, and a seed's `theme.css` lands
  // whenever its board does: on the gallery path that is well after
  // `document.fonts.ready`, so the session-fixed probe above can only ever
  // have measured the base stack. The warning has to track what the board
  // actually renders with — while `env`, which the engine consumes, stays
  // fixed for the session exactly as §5.2 requires.
  const [handStackActive, setHandStackActive] = useState(true);
  // The chip NAMES what fell back (blind-trial findings §2.1: a chip that
  // only says "fallback" sends a cold author to `document.fonts.check`,
  // which lies). Probed over the board's OWN text, so it can never cry wolf
  // about a character this lecture never writes — and keyed on the DISTINCT
  // characters rather than the source, because the source changes on every
  // keystroke the agent makes while the alphabet settles in the first few
  // sentences.
  const boardAlphabet = useMemo(
    () => [...new Set(lecture?.source ?? "")].join(""),
    [lecture?.source],
  );
  const [handFallbackGlyphs, setHandFallbackGlyphs] = useState<string[]>([]);
  useEffect(() => {
    if (!fontsReady) return;
    setHandStackActive(probeEnvCaps(document).handwritingFontActive);
    setHandFallbackGlyphs(glyphsFallingBack(document, boardAlphabet));
  }, [fontsReady, themeCss, boardAlphabet]);

  // ── 板 ≠ 笔记 (C3): two projections of ONE canonical timeline ───────────
  // "board" performs the stage (area-limited panels, erasing, camera);
  // "notes" is the lecture notes — one unbounded strip, nothing ever lost
  // (camera and erase steps plan to zero units; StepRefs untouched, so
  // pointing and agent addresses stay valid). A switch REMOUNTS the canvas
  // (the key below) — the factory contract is single-shot per mount
  // generation, so the projections never dual-build.
  const [boardView, setBoardView] = useState<"board" | "notes">("board");
  const canvasKey = `${setKey ?? ""}::${boardView}`;

  // ── V1.5: parallax, and the accessibility gate over it ──────────────────
  // The switch is the css3d brief's §5.2 probe: with it on the pointer rocks
  // the board a few degrees, and real depth answers with parallax while
  // painted-on perspective falls apart. DEFAULT OFF — it is a probe and a
  // toy, not the reading condition.
  //
  // `prefers-reduced-motion` overrides it in both directions: parallax is
  // forced off (a picture that follows the mouse is genuinely unpleasant for
  // vestibular-sensitive readers) and transitions lose their depth too,
  // degrading to the existing 2D Van Wijk glide rather than to an instant
  // cut (brief §6-2). Subscribed, not sampled: a reader who turns the OS
  // setting on mid-lecture must be obeyed on the spot.
  const [parallaxOn, setParallaxOn] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setReduceMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const parallaxActive = parallaxOn && !reduceMotion;

  const [compiled, setCompiled] = useState<CompiledBoard | null>(null);
  const onCompiled = useCallback((next: CompiledBoard | null) => {
    setCompiled(next);
  }, []);
  // Ref mirror so the board-position reader (published once, at mount) can
  // see the CURRENT compile without re-registering itself per rebuild.
  const compiledRef = useRef<CompiledBoard | null>(compiled);
  compiledRef.current = compiled;

  // Which step the user is pointing at (T6). Local state, not
  // `props.selection`: the shell's selection mapping drops `address`, and
  // the address is the whole handle.
  const [selectedRef, setSelectedRef] = useState<StepRef | null>(null);
  const boardApiRef = useRef<BoardApi | null>(null);
  const onBoardApi = useCallback((api: BoardApi | null) => {
    boardApiRef.current = api;
  }, []);

  // Replay disables everything; a viewing session has no agent to talk to,
  // so pointing and asking would both be gestures into the void.
  const interactive = !readonly && editing !== false;

  // Content-set transitions (set-latch.ts), on their two separate axes.
  // SELECTION: a real switch is a new OPENING and gets its own join
  // verdict; the async matcher's first `null → prefix` resolution is NOT —
  // it is the same opening the hydration latch already judged, and
  // re-judging it there is what made a freshly seeded board join at its
  // tip. Render-phase reset (React's documented derived-state pattern); the
  // ref writes are idempotent across re-renders.
  const prevSelectionRef = useRef(activeContentSet);
  if (prevSelectionRef.current !== activeContentSet) {
    const next = relatchOnSelectionChange(
      prevSelectionRef.current,
      activeContentSet,
      lecture !== null,
    );
    prevSelectionRef.current = activeContentSet;
    if (next !== null) joinAtTipRef.current = next;
  }

  // The compiled board follows the RENDERED key, which is what BoardCanvas
  // is keyed on: only that remount produces a new compile, so dropping the
  // compiled board on any other signal leaves the transport at 0.0s/0.0s
  // over a fully drawn board with nothing driving it. A view switch (C3)
  // is a remount too — the two projections compile different timelines.
  const prevRenderedRef = useRef(canvasKey);
  if (prevRenderedRef.current !== canvasKey) {
    prevRenderedRef.current = canvasKey;
    setCompiled(null);
    // A different board is a different set of addresses — carrying the
    // pointer across would leave the user pointing at coordinates that
    // now name someone else's step. (A view switch keeps refs valid but
    // the pointer clears too — the click that made it happened on the
    // other projection.)
    setSelectedRef(null);
  }

  // ── The voice layer (T10-4) ──────────────────────────────────────────────
  // One conductor for the component's whole life (the element is reusable;
  // clip identity is the content hash). Created lazily in a render-phase
  // ref write — idempotent, and the ctor touches no DOM until a clip is
  // actually needed.
  const conductorRef = useRef<AudioConductor | null>(null);
  if (conductorRef.current === null) {
    conductorRef.current = new AudioConductor({
      resolveUrl: (path) =>
        `${getApiBase()}/api/file?path=${encodeURIComponent(path)}`,
    });
  }
  // The pre-mixed track's conductor (T10-5), created beside the per-clip
  // one and never instead of it: a missing or stale track falls back to
  // clip-at-a-time playback, which is flawed but audible. Exactly one of
  // the two holds a program at any moment (the effect below), so they can
  // never both be sounding.
  const trackConductorRef = useRef<TrackConductor | null>(null);
  if (trackConductorRef.current === null) {
    trackConductorRef.current = new TrackConductor({
      resolveUrl: (path) =>
        `${getApiBase()}/api/file?path=${encodeURIComponent(path)}`,
    });
  }
  useEffect(
    () => () => {
      conductorRef.current?.dispose();
      trackConductorRef.current?.dispose();
    },
    [],
  );

  // ── The file-existence probe (M3), on the PLAYBACK path ─────────────────
  // A manifest `seconds` whose audio file is gone must not pace the
  // writing — before this probe the schedule was silently 2.5×-slower on a
  // phantom clip, and only an explicit `narrate` call would ever notice.
  // Each recorded clip's workspace path is checked against `/api/file`;
  // only a CONFIRMED 404 accuses (an unanswerable probe changes nothing),
  // the verdict filters the compile input below, feeds the chip and the
  // check-board finding, and `narrate` refreshes it (the heal path: the
  // agent re-synthesizes to the same path, calls narrate, the board
  // re-paces).
  const [missingClips, setMissingClips] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const probeClips = useCallback(
    () =>
      probeMissingClips(
        narrationRead?.manifest?.clips ?? {},
        setKey ?? "",
        async (workspacePath) => {
          const res = await fetch(
            `${getApiBase()}/api/file?path=${encodeURIComponent(workspacePath)}`,
          );
          // Headers are the answer; never download the audio bytes here.
          void res.body?.cancel();
          return res.status === 404;
        },
      ),
    [narrationRead, setKey],
  );
  const probeClipsRef = useRef(probeClips);
  probeClipsRef.current = probeClips;
  // One fingerprint over the clips' IDENTITY (hash → file): the aggregate
  // source mints a fresh manifest object on every watched-file emit —
  // including each board.md append while the agent live-writes — and the
  // probe must re-run on real clip changes only, never per stream chunk
  // (the file-watch → render loop is hot).
  const clipsFingerprint = useMemo(() => {
    const clips = narrationRead?.manifest?.clips ?? {};
    return Object.keys(clips)
      .sort()
      .map((hash) => `${hash}:${clips[hash]!.file}`)
      .join("|");
  }, [narrationRead]);
  useEffect(() => {
    if (clipsFingerprint === "") {
      setMissingClips((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    let cancelled = false;
    void probeClipsRef.current().then((missing) => {
      if (cancelled) return;
      setMissingClips((prev) => (sameSet(prev, missing) ? prev : missing));
    });
    return () => {
      cancelled = true;
    };
  }, [clipsFingerprint, setKey]);

  // The compile input: the manifest minus confirmed-missing clips.
  // Identity-preserving when nothing is missing, so the board's rebuild
  // effect re-runs only on a real verdict change.
  const narrationForBoard = useMemo(
    () => withoutMissingClips(narrationRead?.manifest ?? null, missingClips),
    [narrationRead, missingClips],
  );

  // ── The picture layer (I1) ───────────────────────────────────────────────
  // Same three moves as the voice: read the sidecar off the board's own
  // file load, probe the files it names, hand the board ONE resolver.
  const illustrationRead =
    setKey === null ? null : (board?.illustrations[setKey] ?? null);
  const [absentFigures, setAbsentFigures] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // TWO fingerprints, and both are STRINGS on purpose (the narration
  // probe's precedent): the aggregate source mints a fresh Lecture AND a
  // fresh manifest object on every watched-file emit — including each
  // board.md append while the agent live-writes — so an effect keyed on
  // either object would re-probe on every keystroke burst, and the
  // file-watch → render loop is hot. Keyed on the strings, the probe runs
  // when the pictures or their declarations actually change.
  const figureFingerprint = useMemo(
    () => (lecture ? illustrationSources(lecture).join("|") : ""),
    [lecture],
  );
  const figureManifestFingerprint = useMemo(() => {
    const figures = illustrationRead?.manifest?.figures ?? {};
    return [
      illustrationRead?.issue ?? "",
      ...Object.keys(figures)
        .sort()
        .map((key) => `${key}=${figures[key]!.aspect}`),
    ].join("|");
  }, [illustrationRead]);
  const probeFiguresRef = useRef<() => Promise<Set<string>>>(async () => new Set());
  probeFiguresRef.current = async () => {
    const paths = lecture ? illustrationSources(lecture) : [];
    const prefix = setKey ? `${setKey}/` : "";
    const gone = new Set<string>();
    await Promise.all(
      paths.map(async (path) => {
        try {
          const res = await fetch(
            `${getApiBase()}/api/file?path=${encodeURIComponent(prefix + path)}`,
          );
          // Headers are the answer; never download the picture here.
          void res.body?.cancel();
          // A CONFIRMED 404 accuses; anything else (offline, 500, a host
          // with no file route at all) changes nothing.
          if (res.status === 404) gone.add(path);
        } catch {
          // Unanswerable is not an accusation — see above.
        }
      }),
    );
    return gone;
  };
  useEffect(() => {
    if (figureFingerprint === "") {
      setAbsentFigures((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    let cancelled = false;
    void probeFiguresRef.current().then((gone) => {
      if (cancelled) return;
      setAbsentFigures((prev) => (sameSet(prev, gone) ? prev : gone));
    });
    return () => {
      cancelled = true;
    };
    // NOT keyed on `illustrations.identity`: that carries `absentFigures`,
    // which this effect writes — the probe would re-arm itself for ever.
  }, [figureFingerprint, figureManifestFingerprint, setKey]);

  const illustrations = useMemo(
    () =>
      illustrationSource(
        illustrationRead?.manifest ?? null,
        setKey ?? "",
        // ROOT-RELATIVE, never `getApiBase()`: a mask reads pixels, so a
        // cross-origin source paints NOTHING and reports success while
        // doing it (`.claude/rules/frontend.md`). In dev the API base is a
        // different port — a different origin — and the dev server proxies
        // `/api` for exactly this reason.
        (workspacePath) => `/api/file?path=${encodeURIComponent(workspacePath)}`,
        absentFigures,
      ),
    [illustrationRead, setKey, absentFigures],
  );

  /** The pictures that are not on the board, as check-board observations. */
  const undrawnFigures = useMemo(
    () =>
      lecture
        ? undrawnIllustrations(
            lecture,
            illustrationRead?.manifest ?? null,
            absentFigures,
          )
        : [],
    [lecture, illustrationRead, absentFigures],
  );

  // The missing clips as check-board observations, addressed to their
  // steps (the plan knows hash → ref; missing clips have no windows to
  // read it from — they were filtered out of the compile).
  const missingNarration = useMemo(() => {
    if (missingClips.size === 0 || !lecture) return [];
    return buildNarrationPlan(lecture, narrationRead?.manifest ?? null)
      .entries.filter((e) => missingClips.has(e.hash))
      .map((e) => ({ ref: e.ref, file: e.file }));
  }, [missingClips, lecture, narrationRead]);

  // ── The pre-mixed track (T10-5) ──────────────────────────────────────────
  // The track's layout is EVIDENCE, never authority. Per-clip playback is
  // self-correcting — a clip sounds when its window opens, so a schedule
  // error costs one step — but one track is globally aligned: after t = 0
  // there is no per-step resync at all, so a layout mixed against a
  // schedule that has since moved divorces the voice from the pen
  // progressively, and it reads as an engine bug. The board's schedule is
  // a function of MEASURED text (a theme flip changes the font and the
  // same words wrap differently), so it genuinely does move.
  //
  // Therefore the layout is recomputed HERE, from this compile, and the
  // recorded one has to still agree. It does not → the track is not
  // played, the per-clip path takes over, and the reason is said out loud
  // (a `staleTrack` finding + the chip). Staleness detection costs nothing
  // extra: appending one sentence shifts every later position, which is
  // the same disagreement.
  const trackRead = setKey === null ? null : (board?.track[setKey] ?? null);
  const trackVerdict = useMemo(() => {
    const recorded = trackRead?.manifest ?? null;
    if (recorded === null) {
      // No track is the ordinary state; a MALFORMED sidecar is not, and
      // must not hide behind the same silent fallback.
      return { manifest: null, reason: trackRead?.issue ?? null };
    }
    if (!compiled) return { manifest: null, reason: null };
    const live = layOutTrack(
      compiled.narration,
      compiled.timeline.duration,
      recorded.sampleRate,
    );
    const verdict = verifyTrack(recorded, live);
    return verdict.ok
      ? { manifest: recorded, reason: null }
      : { manifest: null, reason: verdict.reason };
  }, [trackRead, compiled]);

  // A track that would not load or start takes the whole voice with it, so
  // it hands the board back to the per-clip path rather than muting the
  // lecture. Cleared when the track itself changes — a new file is a new
  // chance.
  const [trackFailed, setTrackFailed] = useState(false);
  useEffect(
    () =>
      trackConductorRef.current?.onDegraded(({ reason }) => {
        if (reason === "failed") setTrackFailed(true);
      }),
    [],
  );
  const trackFile = trackVerdict.manifest?.file ?? null;
  useEffect(() => {
    setTrackFailed(false);
  }, [trackFile, setKey]);
  const useTrack = trackVerdict.manifest !== null && !trackFailed;
  // The narrate runner is an async callback that must not re-identify on
  // every compile (it is handed to the action dispatcher), so it reads the
  // verdict and the compile through refs — the same shape `lectureRef`
  // already uses next to it.
  const trackVerdictRef = useRef(trackVerdict);
  trackVerdictRef.current = trackVerdict;

  // Every compile hands the conductor its program: the clip windows plus
  // each clip's WORKSPACE path (manifest `file` values are content-set
  // relative — the one path rule narration-actions.ts pins). Same-hash
  // clips survive recompiles untouched, so an agent append never restarts
  // the sounding voice.
  useEffect(() => {
    const conductor = conductorRef.current;
    const track = trackConductorRef.current;
    if (!conductor || !track) return;
    const windows = compiled?.narration ?? [];
    const recorded = useTrack ? trackVerdict.manifest : null;
    if (recorded) {
      // The track path: ONE src, set here and not touched again while the
      // board plays. The per-clip conductor is emptied in the same breath
      // — an empty program is a quiet element — so only one voice exists.
      track.setProgram(
        recorded,
        windows,
        setKey ? `${setKey}/${recorded.file}` : recorded.file,
      );
      conductor.setProgram([], new Map());
      return;
    }
    track.setProgram(null, [], null);
    const clips = narrationForBoard?.clips ?? {};
    const files = new Map<string, string>();
    for (const w of windows) {
      const clip = clips[w.hash];
      if (clip) files.set(w.hash, setKey ? `${setKey}/${clip.file}` : clip.file);
    }
    conductor.setProgram(windows, files);
  }, [compiled, narrationForBoard, setKey, useTrack, trackVerdict]);

  // Autoplay policy surface: when the browser refused to sound the voice
  // without a gesture, say so — a silently muted voice is the same
  // degradation class as the font-fallback chip (§6.4-A). One click (or
  // any page gesture — the conductor also re-arms itself) brings it back.
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  // Follows whichever conductor currently owns the voice; `onBlocked`
  // fires immediately with the current value, so switching paths re-reads
  // the latch rather than inheriting a stale one.
  useEffect(
    () =>
      (useTrack ? trackConductorRef.current : conductorRef.current)?.onBlocked(
        setVoiceBlocked,
      ),
    [useTrack],
  );

  // Clips the conductor had to abandon at runtime (a load/start failure,
  // a buffering stall) — the chip's second feed, beside the probe's
  // confirmed-missing files. Reset when the manifest changes: a new
  // manifest is a new chance.
  const [degradedClips, setDegradedClips] = useState<ReadonlySet<string>>(
    new Set(),
  );
  useEffect(
    () =>
      conductorRef.current?.onDegraded(({ hash }) =>
        setDegradedClips((prev) =>
          prev.has(hash) ? prev : new Set(prev).add(hash),
        ),
      ),
    [],
  );
  useEffect(() => {
    setDegradedClips((prev) => (prev.size === 0 ? prev : new Set()));
  }, [clipsFingerprint, setKey]);
  const voiceTroubleCount = useMemo(
    () => new Set([...missingClips, ...degradedClips]).size,
    [missingClips, degradedClips],
  );

  const { player, activeIndex } = useBoardPlayer(
    compiled?.timeline ?? null,
    joinAtTipRef.current ?? true,
    // A view switch is a new opening of the same board: the notes join at
    // the tip (the export posture — everything already written), and
    // returning to the board view rejoins the live tip.
    canvasKey,
    useTrack ? trackConductorRef.current : conductorRef.current,
  );
  // Stable getter — BoardCanvas's rebuild effect depends on it; a new
  // identity per render would recompile the board every frame.
  const playerRef = useRef(player);
  playerRef.current = player;
  const getPlayheadStable = useCallback(() => playerRef.current.getT(), []);

  // Parse-level issues + formulas that failed to render + ink aimed at
  // erased writing (all R6 "the board plays on" degradations — the chip
  // is their shared surface; the orphan case is INVISIBLE by nature, so
  // a user-facing counter is the only way the user learns it happened)
  // + the overlaps the room stopped preventing (canvas pivot §5.3).
  //
  // A collision is a FACT, not a fault, and it is counted here for exactly
  // that reason: it is the one thing on this list the reader can already
  // see and cannot interpret. Two paragraphs written through each other
  // read as a broken renderer until something says otherwise — the marks
  // on the board say it in place, this chip says how many.
  const issueCount =
    (compiled?.issues.length ?? 0) +
    (compiled?.mathErrors.length ?? 0) +
    (compiled?.unplacedMathErrors ?? 0) +
    (compiled?.inkAfterErase.length ?? 0) +
    (compiled?.collisions.length ?? 0);

  // ── The interaction surface (T6) ─────────────────────────────────────────

  // Callbacks the shell rebuilds on every render (they are inline arrows in
  // `useViewerProps`). Mirrored into refs so the effects below key on real
  // board changes instead of firing once per render.
  const notifyRef = useRef(onNotifyAgent);
  notifyRef.current = onNotifyAgent;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const lectureRef = useRef<Lecture | null>(lecture);
  lectureRef.current = lecture;
  // Which board is open, for the same reason: the action runners read live
  // state through refs, and an address naming another board is refused
  // rather than acted on (see `locate`).
  const setKeyRef = useRef<string | null>(setKey);
  setKeyRef.current = setKey;

  /** The playhead's schedule index, for frame-board's honest watermark. */
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  /**
   * Where the board is, read on demand (once per user message), never
   * published per frame. `pneuma-mode.ts::extractContext` reads this to
   * tell the agent the playhead and whether the pointed-at step has been
   * written yet — facts that are simply not in the files.
   */
  useEffect(() => {
    setBoardMomentReader((): BoardMoment | null => {
      const timeline = compiledRef.current?.timeline;
      if (!timeline) return null;
      const p = playerRef.current;
      return {
        t: p.getT(),
        duration: timeline.duration,
        follow: p.ui.follow,
        playing: p.ui.playing,
        schedule: timeline.schedule,
      };
    });
    return () => setBoardMomentReader(null);
  }, []);

  // The user cleared the chip in the composer — stop pointing on the board
  // too, or the outline outlives the thing it stands for.
  useEffect(() => {
    if (!selection) setSelectedRef(null);
  }, [selection]);

  /** A click on the board (or on bare board, which stops pointing). */
  const handleSelectStep = useCallback((ref: StepRef | null): void => {
    const current = lectureRef.current;
    const picked = ref && current ? selectionForStep(current, ref) : null;
    setSelectedRef(picked ? ref : null);
    selectRef.current?.(picked);
  }, []);

  /**
   * The user grabbed the board (C1′). The performance stops — you cannot
   * read a board that is moving under your hand — and nothing else moves:
   * no seek, no camera write, so the hand keeps whatever it dragged to.
   * Releasing does not resume; pressing play does, and the camera returns
   * to the pen there (BoardCanvas's resume re-engage).
   */
  const handleGrab = useCallback((): void => {
    playerRef.current.pause();
  }, []);

  /** The step the ask bar shows a receipt for. */
  const pointing = useMemo(() => {
    if (!selectedRef || !lecture) return null;
    const step = stepAt(lecture, selectedRef);
    if (!step) return null;
    return {
      where: formatAddress(toAddress(selectedRef)),
      kind: describeStep(step),
      summary: summarizeStep(step, 70),
    };
  }, [selectedRef, lecture]);

  const runCommand = useCallback(
    (command: ViewerCommandDescriptor): void => {
      const notify = notifyRef.current;
      const current = lectureRef.current;
      if (!notify) return;
      notify(
        buildCommandNotification(
          command,
          selectedRef && current ? selectionForStep(current, selectedRef) : null,
          current ? [{ path: "board.md", content: current.source }] : [],
          compiledRef.current
            ? {
                t: playerRef.current.getT(),
                duration: compiledRef.current.timeline.duration,
                follow: playerRef.current.ui.follow,
                playing: playerRef.current.ui.playing,
                schedule: compiledRef.current.timeline.schedule,
              }
            : null,
        ),
      );
    },
    [selectedRef],
  );

  // ── Actions (§9) ─────────────────────────────────────────────────────────
  // Every one of them answers with the address it acted on, so the agent can
  // chain (navigate → capture) without re-deriving anything.

  /** Resolve an agent-supplied address, or say precisely why it did not. */
  const locate = useCallback(
    (
      address: unknown,
    ): { ref: StepRef; lecture: Lecture } | ViewerActionResult => {
      const current = lectureRef.current;
      if (!current) {
        return { success: false, message: "There is no board open yet." };
      }
      // A board this action cannot reach. `contentSet` is resolved by the
      // framework on the locator channel only (store::setNavigateRequest
      // switches the set, then hands this mode the rest of the address);
      // action params arrive verbatim, so acting on `section`/`step` here
      // would land on the board the user is actually watching and report
      // success for a step on a different one. Refusing is the honest
      // half; the message names the one channel that does cross boards.
      const elsewhere = foreignSet(address as ViewerAddress, setKeyRef.current);
      if (elsewhere) {
        return {
          success: false,
          message: `That address is on the "${elsewhere}" board, and this asks the board the user is watching${
            setKeyRef.current ? ` ("${setKeyRef.current}")` : ""
          } to move. Drop "contentSet" to act on the open board; to reach that one, hand the user a <viewer-locator> card with the full address, or pass the same address to "capture" if you only need to look at it yourself.`,
        };
      }
      const ref = resolveAddress(current, address as ViewerAddress);
      if (!ref) {
        return {
          success: false,
          message: `No such place on this board: ${JSON.stringify(address)}. Sections count from 0 (the opening) and steps from 1 within their section.`,
        };
      }
      return { ref, lecture: current };
    },
    [],
  );

  const runNavigateTo = useCallback(
    (address: unknown): ViewerActionResult => {
      const located = locate(address);
      if (!("ref" in located)) return located;
      const { ref } = located;
      const step = stepAt(located.lecture, ref)!;
      const where = formatAddress(toAddress(ref));
      const window = compiled
        ? stepWindow(compiled.timeline.schedule, ref)
        : null;
      if (window) {
        // Seeking IS the camera move: the player's seek fan-out brings the
        // step being performed into view (BoardCanvas.onSeek).
        playerRef.current.scrubTo(window.end);
      } else if (!boardApiRef.current?.showStep(ref)) {
        return {
          success: false,
          message: `${where} is in board.md but is not on the board yet — it may still be being measured.`,
        };
      }
      return {
        success: true,
        message: window
          ? `Showing ${where} — ${describeStep(step)}: "${summarizeStep(step)}"`
          : `${where} is in view, but the board never writes it (${describeStep(step)}), so the playhead did not move.`,
        data: {
          address: toAddress(ref),
          ...(window ? { at: Number(window.end.toFixed(2)) } : {}),
        },
      };
    },
    [locate, compiled],
  );

  const runPlayFrom = useCallback(
    (address: unknown): ViewerActionResult => {
      if (!compiled) {
        return { success: false, message: "There is no board to play yet." };
      }
      if (address === undefined || address === null) {
        playerRef.current.playFrom(0);
        return { success: true, message: "Playing the board from the top." };
      }
      const located = locate(address);
      if (!("ref" in located)) return located;
      const { ref } = located;
      const step = stepAt(located.lecture, ref)!;
      const where = formatAddress(toAddress(ref));
      const window = stepWindow(compiled.timeline.schedule, ref);
      if (!window) {
        return {
          success: false,
          message: `The board never writes ${where} (${describeStep(step)}), so there is nothing to play from there. Pick a step that is written.`,
        };
      }
      playerRef.current.playFrom(window.start);
      return {
        success: true,
        message: `Playing from ${where} — ${describeStep(step)}: "${summarizeStep(step)}"`,
        data: { address: toAddress(ref), from: Number(window.start.toFixed(2)) },
      };
    },
    [locate, compiled],
  );

  const runCheckBoard = useCallback((): ViewerActionResult => {
    const current = lectureRef.current;
    if (!current) {
      return {
        success: true,
        message: "The board is empty — there is nothing to check yet.",
        data: { ok: true, findings: [] },
      };
    }
    const report = reportBoardCheck(
      collectFindings(current, {
        mathErrors: compiled?.mathErrors ?? [],
        unplacedMathErrors: compiled?.unplacedMathErrors ?? 0,
        overflowing: compiled?.overflowing ?? [],
        inkAfterErase: compiled?.inkAfterErase ?? [],
        missingNarrationClips: missingNarration,
        staleTrack: trackVerdict.reason,
        undrawnIllustrations: undrawnFigures,
        collisions: compiled?.collisions ?? [],
        bursts: compiled?.bursts ?? [],
        turnsOnFullWall: compiled?.turnsOnFullWall ?? [],
        turnsUnderfilled: compiled?.turnsUnderfilled ?? [],
      }),
    );
    return {
      success: true,
      message: report.summary,
      data: { ok: report.ok, findings: report.findings },
    };
  }, [compiled, missingNarration, undrawnFigures, trackVerdict]);

  /**
   * `narrate` (T10) — the voice-over plan. The response shape lives in
   * `narration-actions.ts` (pure, pinned by tests); the runner's own
   * halves are the empty-board branch and the file-existence probe
   * (T10-4): each recorded clip's workspace path is checked against
   * `/api/file`, and only a confirmed 404 flips its step back to
   * needs-audio — a probe that cannot answer accuses nothing.
   */
  const runNarrate = useCallback(async (): Promise<ViewerActionResult> => {
    const current = lectureRef.current;
    if (!current) {
      return {
        success: true,
        message: "The board is empty — write the lecture first, then give it a voice.",
        data: { steps: [], orphans: [] },
      };
    }
    const missing = await probeClips();
    // Share the verdict with the playback path — this is the heal loop:
    // the agent re-synthesized to the same path, asked narrate, and the
    // board re-paces (or a fresh miss un-paces) without a manifest write.
    setMissingClips((prev) => (sameSet(prev, missing) ? prev : missing));
    return narrateResponse(current, narrationRead, setKey ?? "", missing, {
      windows: compiledRef.current?.narration ?? [],
      duration: compiledRef.current?.timeline.duration ?? 0,
      state: trackVerdictRef.current.manifest
        ? "verified"
        : trackVerdictRef.current.reason
          ? "refused"
          : "absent",
      reason: trackVerdictRef.current.reason,
    });
  }, [setKey, narrationRead, probeClips]);

  /**
   * `frame-board` (canvas pivot §6) — the IMAGINING organ: what would my
   * declaration cover? Async like `glance-board` and `narrate`, and for the
   * same reason — the screenshot is a round trip, a deferred answer is a
   * normal answer, and a failure still ANSWERS rather than hanging the
   * agent to the bridge timeout.
   *
   * The order is load-bearing: resolve (pure) → paint → shoot → UNPAINT in
   * a `finally`, so no failure path can leave the annotation layer standing
   * on the user's board. The user's camera is never touched: this is an
   * ELEMENT capture of the panels at layout size, so it neither navigates
   * nor moves the stage transform (§6.1-3, pinned negatively).
   */
  const runFrameBoard = useCallback(
    async (params?: Record<string, unknown>): Promise<ViewerActionResult> => {
      const api = boardApiRef.current;
      const geometry = api?.readFrameGeometry();
      if (!api || !geometry) {
        return {
          success: false,
          message: "The board is still being measured — ask again in a moment.",
        };
      }
      const raw = Array.isArray(params?.placements) ? params.placements : [];
      const candidates: FrameCandidate[] = raw.flatMap((entry) => {
        if (typeof entry === "string") return [{ at: entry }];
        if (!entry || typeof entry !== "object") return [];
        const e = entry as Record<string, unknown>;
        return typeof e.at === "string"
          ? [
              {
                at: e.at,
                ...(typeof e.anchor === "string" ? { anchor: e.anchor } : {}),
                ...(typeof e.label === "string" ? { label: e.label } : {}),
              },
            ]
          : [];
      });

      const report = resolveFrames({
        candidates,
        geometry,
        standing: api.readStandingBoxes(),
        performed: readPerformed(compiledRef.current, activeIndexRef.current),
      });

      const target = api.framesTarget();
      if (!target) return { success: true, message: report.message };

      const unpaint = api.paintFrames({
        panel: report.panel,
        standing: report.standing,
        frames: report.verdicts
          .filter((v): v is Extract<typeof v, { ok: true }> => v.ok)
          .map((v) => ({ tag: v.tag, rect: v.rect, open: v.open })),
        window: report.window,
      });
      try {
        const shot = await captureViewer(target);
        if (!shot.ok) {
          return {
            success: true,
            message: `${report.message}\n(No image this time — ${shot.message})`,
          };
        }
        const res = await fetch(`${getApiBase()}/api/session/capture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: shot.base64 }),
        });
        const json = (await res.json()) as { ok?: boolean; path?: string; message?: string };
        if (!json.ok || !json.path) {
          return {
            success: true,
            message: `${report.message}\n(No image this time — ${json.message ?? "the screenshot could not be saved"})`,
          };
        }
        return {
          success: true,
          message: `${report.message}\nThe picture: ${json.path}`,
          data: {
            path: json.path,
            panel: report.panel,
            facet: report.facet,
            verdicts: report.verdicts,
            window: report.window,
          },
        };
      } finally {
        unpaint();
      }
    },
    [],
  );

  /**
   * `glance-board` (S1) — the look-up before the next stroke. The timing
   * core lives in `glance.ts` (testable with fakes); this runner only
   * implements the host seams: the live parse, the last build's basis
   * (BoardApi), the on-disk probe (`/api/file` — probeClips' precedent,
   * bounded, a failure accuses nothing), and "wake me on the next
   * compile" (the wakers set below, flushed by the compile effect).
   */
  const glanceWakersRef = useRef(new Set<() => void>());
  useEffect(() => {
    for (const wake of [...glanceWakersRef.current]) wake();
  }, [compiled, lecture]);
  const runGlanceBoard = useCallback((): Promise<ViewerActionResult> => {
    return glanceBoard({
      liveSource: () => lectureRef.current?.source ?? null,
      readBasis: () => boardApiRef.current?.readSnapshotBasis() ?? null,
      now: () => Date.now(),
      probeDisk: async () => {
        try {
          const path = setKeyRef.current
            ? `${setKeyRef.current}/board.md`
            : "board.md";
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            SNAPSHOT_WAIT_MS / 2,
          );
          const res = await fetch(
            `${getApiBase()}/api/file?path=${encodeURIComponent(path)}`,
            { signal: controller.signal },
          );
          clearTimeout(timer);
          return res.ok ? await res.text() : null;
        } catch {
          // The probe could not answer — it accuses nothing and blocks
          // nothing (§6 step 1; the M3 posture probeClips pinned).
          return null;
        }
      },
      waitForCompile: (ms) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(done, Math.max(0, ms));
          function done(): void {
            clearTimeout(timer);
            glanceWakersRef.current.delete(done);
            resolve();
          }
          glanceWakersRef.current.add(done);
        }),
    });
  }, []);

  /**
   * `subtitles` (T10) — the lecture as finished SRT / VTT text off the
   * compiled schedule; the agent saves it verbatim. Needs a compile: the
   * cue times ARE the schedule, and there is none before the first one.
   */
  const runSubtitles = useCallback((): ViewerActionResult => {
    const current = lectureRef.current;
    if (!current) {
      return {
        success: true,
        message: "The board is empty — there is nothing to caption yet.",
        data: { cues: 0 },
      };
    }
    if (!compiled) {
      return {
        success: false,
        message:
          "The board is still being measured — ask again in a moment.",
      };
    }
    return subtitlesResponse(
      current,
      compiled.timeline.schedule,
      narrationRead,
      setKey ?? "",
      compiled.narration,
    );
  }, [setKey, narrationRead, compiled]);

  // The shell hands one request at a time and clears it on the response, so
  // the request itself is the only honest trigger (slide / diagram do the
  // same). The runners read live state through refs.
  const runnersRef = useRef({
    runNavigateTo,
    runPlayFrom,
    runCheckBoard,
    runNarrate,
    runSubtitles,
    runGlanceBoard,
    runFrameBoard,
  });
  runnersRef.current = {
    runNavigateTo,
    runPlayFrom,
    runCheckBoard,
    runNarrate,
    runSubtitles,
    runGlanceBoard,
    runFrameBoard,
  };
  useEffect(() => {
    if (!actionRequest) return;
    const { requestId, actionId, params } = actionRequest;
    const runners = runnersRef.current;
    switch (actionId) {
      case "navigate-to":
        onActionResult?.(requestId, runners.runNavigateTo(params?.address));
        break;
      case "play-from":
        onActionResult?.(requestId, runners.runPlayFrom(params?.address));
        break;
      case "check-board":
        onActionResult?.(requestId, runners.runCheckBoard());
        break;
      case "narrate":
        // Async on purpose (the file-existence probe); the shell keys on
        // requestId, so a deferred answer is a normal answer. A probe
        // failure still answers — an unresolved action would hang the
        // agent until the bridge timeout.
        void runners.runNarrate().then(
          (result) => onActionResult?.(requestId, result),
          (err: unknown) =>
            onActionResult?.(requestId, {
              success: false,
              message: `narrate failed: ${err instanceof Error ? err.message : String(err)}`,
            }),
        );
        break;
      case "subtitles":
        onActionResult?.(requestId, runners.runSubtitles());
        break;
      case "glance-board":
        // Async like narrate: the §6 wait (probe + bounded catch-up) is
        // the point of the action; a deferred answer is a normal answer,
        // and a failure still answers — never hang the agent.
        void runners.runGlanceBoard().then(
          (result) => onActionResult?.(requestId, result),
          (err: unknown) =>
            onActionResult?.(requestId, {
              success: false,
              message: `glance-board failed: ${err instanceof Error ? err.message : String(err)}`,
            }),
        );
        break;
      case "frame-board":
        // Async like glance: the picture is a round trip. A failure still
        // answers — the report is the useful half and it is already known.
        void runners.runFrameBoard(params).then(
          (result) => onActionResult?.(requestId, result),
          (err: unknown) =>
            onActionResult?.(requestId, {
              success: false,
              message: `frame-board failed: ${err instanceof Error ? err.message : String(err)}`,
            }),
        );
        break;
      default:
        onActionResult?.(requestId, {
          success: false,
          message: `Unknown action: ${actionId}`,
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRequest]);

  // A locator card in chat, or the framework driving `capture` to an
  // address — the same move as `navigate-to`.
  useEffect(() => {
    if (!navigateRequest) return;
    runnersRef.current.runNavigateTo(navigateRequest.address);
    onNavigateComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRequest]);

  // ── Notifications (§9) ───────────────────────────────────────────────────
  // Transitions only — see board-check.ts for why a per-rebuild warning
  // would be worse than no warning at all.
  const reportedRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const notify = notifyRef.current;
    if (!notify || readonly || !lecture) return;
    const { notifications, seen } = deriveNotifications(
      reportedRef.current,
      collectFindings(lecture, {
        mathErrors: compiled?.mathErrors ?? [],
        unplacedMathErrors: compiled?.unplacedMathErrors ?? 0,
        overflowing: compiled?.overflowing ?? [],
        inkAfterErase: compiled?.inkAfterErase ?? [],
        // Present for coherence with check-board; narrationClipMissing is
        // not a notified kind (report, not interrupt), so it never fires
        // here — deriveNotifications filters it. A picture that is not on
        // the board DOES fire: it rides `refUnresolved`, one of the three
        // §9 kinds, because a hole in the board is worth interrupting for.
        missingNarrationClips: missingNarration,
        staleTrack: trackVerdict.reason,
        undrawnIllustrations: undrawnFigures,
        collisions: compiled?.collisions ?? [],
        bursts: compiled?.bursts ?? [],
        turnsOnFullWall: compiled?.turnsOnFullWall ?? [],
        turnsUnderfilled: compiled?.turnsUnderfilled ?? [],
      }),
    );
    reportedRef.current = seen;
    for (const notification of notifications) notify(notification);
  }, [lecture, compiled, readonly, missingNarration, undrawnFigures, trackVerdict]);

  // `boardCollision` (§5.5): the room now lets declarations land on top of
  // each other, and being SEEN is the whole of how a collision is handled.
  // Transition-deduped on the region PAIR in the pure half; it replaces
  // `boardAutoErased` in this slot, which died with the physics behind it.
  const collisionSeenRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const notify = notifyRef.current;
    if (!notify || readonly || !compiled) return;
    const { notification, seen } = deriveCollisionNotification(
      collisionSeenRef.current,
      compiled.collisions,
    );
    collisionSeenRef.current = seen;
    if (notification) notify(notification);
  }, [compiled, readonly]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-cc-bg">
      <style data-bansho-base>{BOARD_BASE_CSS}</style>
      {/* Injected VERBATIM and unscoped — the contract (SKILL.md + both
          seed theme.css headers) is that every rule scopes itself under
          `.bansho-board-surface`. A bare selector would restyle the app
          chrome; `@scope` wrapping was considered and deferred (the hosted
          online player serves arbitrary browsers, and a browser without
          @scope support would drop the ENTIRE sheet — worse than trusting
          the documented constraint). */}
      {themeCss ? <style data-bansho-theme-css>{themeCss}</style> : null}

      <div className="flex-1 min-h-0 flex gap-3 p-3">
        {/* Folded away by default — the wall is what the reader came for,
            and the script is the author's instrument (ScriptDrawer's
            header carries the argument, and why it is not a third
            segment of the projection switch below). */}
        <ScriptDrawer
          source={lecture?.source ?? ""}
          activeSpan={
            activeIndex >= 0
              ? (compiled?.entrySpan(activeIndex) ?? null)
              : null
          }
          issueCount={issueCount}
          reduceMotion={reduceMotion}
        />

        <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1.5">
              {lecture ? (
                // 板 ≠ 笔记 (C3): the same lecture, two projections. The
                // board performs (limited area, erasing, camera); the
                // notes lay everything out on one unbounded strip and
                // never lose a word — erased content included.
                <div
                  role="group"
                  aria-label="Board or lecture notes view"
                  className="flex rounded-md overflow-hidden border border-cc-border bg-cc-surface/70 backdrop-blur text-[11px] font-medium"
                >
                  {(["board", "notes"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={boardView === v}
                      onClick={() => setBoardView(v)}
                      className={[
                        "px-2 py-1 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-cc-primary/60",
                        boardView === v
                          ? "bg-cc-primary/20 text-cc-primary"
                          : "text-cc-muted hover:text-cc-fg hover:bg-cc-surface",
                      ].join(" ")}
                      title={
                        v === "board"
                          ? "The stage: boards with limited area — erased content leaves the board (and comes back when you scrub back)"
                          : "The lecture notes: everything ever written, on one long page — nothing is lost"
                      }
                    >
                      {v === "board" ? "Board" : "Notes"}
                    </button>
                  ))}
                </div>
              ) : null}
              {lecture && boardView === "board" ? (
                // V1.5 — the depth probe. Its own control, not a third
                // segment of the projection switch above: board/notes picks
                // WHAT you are reading, this picks how you are looking at
                // it, and folding a viewing pose into a projection choice
                // would say they are the same kind of decision.
                <button
                  type="button"
                  aria-pressed={parallaxActive}
                  disabled={reduceMotion}
                  onClick={() => setParallaxOn((on) => !on)}
                  className={[
                    "px-2 py-1 rounded-md border text-[11px] font-medium backdrop-blur transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-cc-primary/60",
                    reduceMotion
                      ? "border-cc-border bg-cc-surface/70 text-cc-muted/60 cursor-not-allowed"
                      : parallaxActive
                        ? "border-cc-primary/40 bg-cc-primary/20 text-cc-primary cursor-pointer"
                        : "border-cc-border bg-cc-surface/70 text-cc-muted hover:text-cc-fg hover:bg-cc-surface cursor-pointer",
                  ].join(" ")}
                  title={
                    reduceMotion
                      ? "Your system asks for reduced motion, so the board stays still — transitions keep their existing flat glide"
                      : "Rock the board with the pointer. Real depth answers with parallax; a board that only looks tilted does not"
                  }
                >
                  Parallax
                </button>
              ) : null}
              {fontsReady && (!handStackActive || handFallbackGlyphs.length > 0) ? (
                // §6.4-A — a silently-fallback board font is exactly the
                // silent degradation the design forbids. The chip is the
                // user-facing half, and it NAMES the characters: a chip that
                // will not say which ones sent the blind trial's author to
                // `document.fonts.check`, which answers about the family and
                // never about the glyph, and then to giving up.
                <div
                  className="px-2 py-1 rounded-md text-[11px] font-medium bg-cc-warning/15 text-cc-warning backdrop-blur"
                  title={
                    handFallbackGlyphs.length > 0
                      ? `These characters of this board measure the same width under the declared handwriting stack (--hand) as under the system fallback (PingFang), so the hand is not drawing them: ${handFallbackGlyphs.join(" ")}. Add a family that covers them to the stack in theme.css.`
                      : "The board's declared handwriting stack (--hand) measures the same width as the system fallback (PingFang) — the declared face is not rendering and the board falls back"
                  }
                >
                  {handFallbackGlyphs.length > 0
                    ? `handwriting font fallback: ${handFallbackGlyphs
                        .slice(0, FALLBACK_GLYPH_LIST_CAP)
                        .join(" ")}${
                        handFallbackGlyphs.length > FALLBACK_GLYPH_LIST_CAP
                          ? ` +${handFallbackGlyphs.length - FALLBACK_GLYPH_LIST_CAP}`
                          : ""
                      }`
                    : "handwriting font fallback"}
                </div>
              ) : null}
              {voiceBlocked ? (
                // The voice-over sibling of the font chip: the browser
                // refused to sound audio before the first interaction, and
                // a silently muted voice must not pretend to be a silent
                // board. The click IS the gesture that unlocks it.
                <button
                  type="button"
                  onClick={() =>
                    (useTrack
                      ? trackConductorRef.current
                      : conductorRef.current
                    )?.unlock()
                  }
                  className="px-2 py-1 rounded-md text-[11px] font-medium bg-cc-warning/15 text-cc-warning backdrop-blur hover:bg-cc-warning/25 transition-colors cursor-pointer"
                  title="The browser blocked sound before your first interaction with the page — click to let the voice-over play"
                >
                  voice muted — click to enable
                </button>
              ) : null}
              {trackVerdict.reason ? (
                // A refused track (T10-5). The board did NOT go silent —
                // it fell back to playing the clips one at a time — but a
                // silent downgrade would leave the author believing the
                // track they mixed is what they are hearing.
                <div
                  className="px-2 py-1 rounded-md text-[11px] font-medium bg-cc-warning/15 text-cc-warning backdrop-blur"
                  title={`The mixed narration track no longer matches this board (${trackVerdict.reason}), so it is not played — the clips play one at a time instead. Ask the agent to re-run the mixer.`}
                >
                  narration track stale — playing clips
                </div>
              ) : null}
              {voiceTroubleCount > 0 ? (
                // Degraded voice (M3/M2): clips whose file is missing on
                // disk, failed to load, or stalled mid-play. The board
                // plays on — but never silently about it.
                <div
                  className="px-2 py-1 rounded-md text-[11px] font-medium bg-cc-warning/15 text-cc-warning backdrop-blur"
                  title="Recorded narration clips could not be played (file missing on disk, failed to load, or stalled). The affected steps play silent at their natural pace; ask the agent to run the narrate action to heal them."
                >
                  {voiceTroubleCount} voice clip
                  {voiceTroubleCount > 1 ? "s" : ""} silent — board plays on
                </div>
              ) : null}
            </div>
            {lecture ? (
              <BoardCanvas
                key={canvasKey}
                lecture={lecture}
                view={boardView}
                narration={narrationForBoard}
                illustrations={illustrations}
                theme={theme}
                themeCss={themeCss}
                fontsReady={fontsReady}
                env={env}
                getPlayheadT={getPlayheadStable}
                onCompiled={onCompiled}
                activeIndex={activeIndex}
                playing={player.ui.playing}
                follow={player.ui.follow}
                onSeek={player.onSeek}
                onFrame={player.onFrame}
                selectedRef={selectedRef}
                onSelectStep={interactive ? handleSelectStep : undefined}
                onGrab={handleGrab}
                onApi={onBoardApi}
                parallax={parallaxActive}
                depthMotion={!reduceMotion}
              />
            ) : boardStatus.lastError ? (
              <BoardError
                code={boardStatus.lastError.code}
                message={boardStatus.lastError.message}
              />
            ) : filesHydrated ? (
              <EmptyBoard />
            ) : (
              // Workspace still hydrating — "the board is empty" is not yet
              // known to be true (a resumed board would flash the wrong copy
              // in --viewing, where App-level gating does not apply).
              <BoardLoading />
            )}
          </div>

          {/* Raising your hand — kept off the transport row on purpose:
              one is the user's remote, the other is a request to the
              person who wrote the lecture (§9 draws exactly this line). */}
          {interactive && lecture ? (
            <BoardCommands
              commands={commands ?? []}
              pointing={pointing}
              onClear={() => handleSelectStep(null)}
              onRun={runCommand}
            />
          ) : null}
        </div>
      </div>

      <Timeline
        timeline={compiled?.timeline ?? null}
        player={player}
        // Only a board with clip windows gets the rate menu's note about
        // where the voice stops following (clock-gate rule 6).
        narrated={(compiled?.narration.length ?? 0) > 0}
      />
    </div>
  );
}

/** Pre-hydration placeholder — emptiness is not yet known to be true. */
function BoardLoading() {
  return (
    <div className="h-full min-h-0 flex items-center justify-center rounded-lg border border-cc-border bg-cc-surface/40">
      <div className="text-sm text-cc-muted/70 animate-pulse">
        Loading the board…
      </div>
    </div>
  );
}

/** Source-level load failure — surfaced, never disguised as an empty board. */
function BoardError({ code, message }: { code: string; message: string }) {
  return (
    <div className="h-full min-h-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-cc-border bg-cc-surface/40 text-center px-6">
      <div className="text-sm font-medium text-cc-warning">
        The board could not be loaded
      </div>
      <div className="text-xs text-cc-muted break-all">
        {code}: {message}
      </div>
    </div>
  );
}

function EmptyBoard() {
  return (
    <div className="h-full min-h-0 flex flex-col items-center justify-center gap-3 rounded-lg border border-cc-border bg-cc-surface/40 text-center">
      <svg
        viewBox="0 0 24 24"
        className="w-10 h-10 text-cc-muted/50"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      >
        <rect x="3" y="4" width="18" height="13" rx="1.5" />
        <path d="M6.5 8.5c2.5-1.2 5-1.2 7.5 0" />
        <path d="M6.5 12.5h6" />
        <path d="m15.5 20.5 3-3.5" />
      </svg>
      <div className="text-sm text-cc-muted">
        The board is empty — ask for an explanation and watch it being
        written.
      </div>
    </div>
  );
}
