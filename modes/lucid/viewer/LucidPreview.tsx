/**
 * Lucid viewer — the loop's instrument panel.
 *
 * The stage shows one of three things and the segmented control says which:
 * the scene running live in a same-origin iframe, the locked target, or both
 * under a draggable wipe. Selecting a round swaps that round's recorded
 * capture in for the live scene, so the comparison the judge made is the
 * comparison the user can re-make.
 *
 * Three conventions worth knowing before changing anything:
 *
 * 1. THE IFRAME LOADS BY `src`, NEVER `srcdoc`. The scene is a real static
 *    site: relative ES-module imports (`./vendor/three.module.js`), GLB
 *    fetches and texture loads all resolve against `/content/<project>/scene/`.
 *    A `srcdoc` document has no such base and every one of those requests
 *    would 404 — as a blank canvas, with nothing in the console the user can
 *    see.
 *
 * 2. NOTHING HERE WRITES. `lucid.json`, `rounds/**` and `target.png` belong
 *    to `skill/scripts/lucid.mjs`; view mode, wipe position and the selected
 *    round are session-local and deliberately not persisted. A user request
 *    that would change a file goes to the agent as a command notification.
 *
 * 3. THE LIVE FRAME IS READ THROUGH THE BRIDGE, NEVER GUESSED. `capture` and
 *    `get-scene-state` both go through `postMessage` to `lucid-bridge.js`
 *    inside the scene. A scene without the bridge still renders — it just
 *    cannot be measured or captured, and the strip says so rather than
 *    letting the agent judge a black rectangle. A LIVE capture also waits for
 *    the scene to report itself ready before it shoots, and records what it
 *    found, so a frame taken too early is knowable rather than merely wrong.
 *    The one number that never needs the bridge is the stage's own size:
 *    `get-scene-state` measures it here, because the agent has to know the
 *    aspect it is building for before there is a scene to ask.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Source } from "../../../core/types/source.js";
import type {
  ViewerActionResult,
  ViewerFileContent,
  ViewerPreviewProps,
} from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import { getApiBase } from "../../../src/utils/api.js";

import type { Loop, Loops, RoundRecord } from "../domain.js";
import { setLucidStageCapture } from "../pneuma-mode.js";
import { AssetLedger } from "./AssetLedger.js";
import { CostPanel } from "./CostPanel.js";
import { summarizeCosts } from "../skill/scripts/costs.mjs";
import {
  BRIDGE_TIMEOUT_MS,
  SceneBridgeChannel,
  captureRecord,
  captureViewportPayload,
  parseInbound,
  stillCaptureRecord,
  trackNoteName,
  waitForSceneReady,
  type CaptureRecord,
  type SceneState,
} from "./bridge.js";
import { CoinsIcon, LayersIcon, ReloadIcon } from "./icons.js";
import { RoundsRail } from "./RoundsRail.js";
import {
  bestPoint,
  budgetLabel,
  clampWipe,
  exitChip,
  formatScore,
  nextStage,
  noteCount,
  parseAddress,
  railChips,
  resolveAddress,
  sceneSignature,
  sparklinePoints,
  stageSize,
  stillOnStage,
  VIEW_MODES,
  vitalsLine,
  warningLines,
  wipeFromPointer,
  type SceneVitals,
  type StageSize,
  type StillSelection,
  type ViewMode,
} from "./stage.js";
import { fetchStillPayload } from "./still.js";
import { StatusStrip } from "./StatusStrip.js";
import { assetUrl, sceneUrl } from "./urls.js";

/** Debounce between the last scene file change and the automatic reload. */
const AUTO_RELOAD_MS = 1500;
/** The budget is a wall clock; a minute is as often as it can visibly move. */
const CLOCK_TICK_MS = 60_000;

const VIEW_LABEL: Record<ViewMode, string> = {
  live: "Live",
  target: "Target",
  split: "Split",
};

/**
 * The project the viewer is showing.
 *
 * Prefers the content set the framework (or an address) named; otherwise the
 * first project by name, deterministically — a one-project workspace is the
 * ordinary case, not an edge.
 */
export function selectLoop(loops: Loops | null, contentSet: string | null | undefined): Loop | null {
  if (!loops) return null;
  if (contentSet != null && loops.projects[contentSet]) return loops.projects[contentSet];
  const first = Object.keys(loops.projects).sort()[0];
  return first === undefined ? null : loops.projects[first];
}

export default function LucidPreview(props: ViewerPreviewProps) {
  const { value: loops } = useSource(props.sources.loops as Source<Loops> | undefined);
  const { value: sceneFiles } = useSource(
    props.sources.sceneFiles as Source<ViewerFileContent[]> | undefined,
  );
  const { value: falJobFiles } = useSource(
    props.sources.falJobs as Source<ViewerFileContent[]> | undefined,
  );
  // The cost panel's other two inputs live on the session, not in files:
  // image generations are tool calls in the transcript, tokens are what the
  // backend reported for the whole session.
  const messages = useStore((s) => s.messages);
  const session = useStore((s) => s.session);
  const activeContentSet = useStore((s) => s.activeContentSet);
  const contentSets = useStore((s) => s.contentSets);
  const setActiveContentSet = useStore((s) => s.setActiveContentSet);
  const staticPlayer = useStore((s) => s.staticPlayer);
  const apiBase = useMemo(() => getApiBase(), []);

  const loop = useMemo(() => selectLoop(loops, activeContentSet), [loops, activeContentSet]);
  const dir = loop?.dir ?? "";
  const costSummary = useMemo(() => {
    const jobFile = (falJobFiles ?? []).find((f) => f.path === (dir ? `${dir}/assets/fal-jobs.json` : "assets/fal-jobs.json"));
    let jobs: Array<Record<string, unknown>> = [];
    if (jobFile) {
      try {
        const parsed = JSON.parse(jobFile.content) as { jobs?: unknown } | unknown[];
        jobs = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : Array.isArray((parsed as { jobs?: unknown }).jobs) ? ((parsed as { jobs: Array<Record<string, unknown>> }).jobs) : [];
      } catch {
        jobs = [];
      }
    }
    // Image generations are session-wide, not per file: a project owns the
    // ones made while it was the newest project in the workspace — from its
    // creation until the next project's. One session, two stages: the
    // second stage's images do not land on the first one's bill.
    const created = Date.parse(loop?.createdAt ?? "");
    const next = Object.values(loops?.projects ?? {})
      .map((l) => Date.parse(l.createdAt ?? ""))
      .filter((t) => Number.isFinite(t) && Number.isFinite(created) && t > created)
      .sort((a, b) => a - b)[0] ?? Infinity;
    const from = Number.isFinite(created) ? created : -Infinity;
    const imageTimestamps: number[] = [];
    for (const m of messages) {
      if (m.role !== "assistant" || !m.contentBlocks) continue;
      if (!(m.timestamp >= from && m.timestamp < next)) continue;
      for (const block of m.contentBlocks) {
        if (block.type === "tool_use" && block.name === "ImageGeneration") imageTimestamps.push(m.timestamp);
      }
    }
    return summarizeCosts({
      jobs,
      imageTimestamps,
      tokenUsage: session?.token_usage ?? null,
      model: session?.model ?? "",
      rounds: loop?.rounds ?? [],
    });
  }, [falJobFiles, dir, messages, session?.token_usage, session?.model, loop?.rounds, loop?.createdAt, loops]);

  // ── Stage state ──────────────────────────────────────────────────────────
  const [view, setView] = useState<ViewMode>("live");
  const [wipe, setWipe] = useState(0.5);
  const [roundIndex, setRoundIndex] = useState<number | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(1);
  const [now, setNow] = useState(() => new Date());

  // ── Bridge state ─────────────────────────────────────────────────────────
  const [sceneState, setSceneState] = useState<SceneState | null>(null);
  const [sceneErrors, setSceneErrors] = useState<string[]>([]);
  const [noteNames, setNoteNames] = useState<string[]>([]);
  const [helloSeen, setHelloSeen] = useState(false);
  /** null while the 3 s grace after a load is still running. */
  const [bridgeVerdict, setBridgeVerdict] = useState<boolean | null>(null);

  /**
   * Mirrors written synchronously.
   *
   * An action arrives, changes the stage, and must report what the stage now
   * shows inside the same handler — React state is a render behind at that
   * moment. Every reader that has to be correct *now* uses these.
   */
  const viewRef = useRef<ViewMode>("live");
  const roundRef = useRef<number | null>(null);
  const helloRef = useRef(false);
  const sceneErrorsRef = useRef<string[]>([]);
  const noteNamesRef = useRef<string[]>([]);
  const reloadedAtRef = useRef<string>(new Date().toISOString());
  /** What the last live frame was worth; null until one has been shot. */
  const lastCaptureRef = useRef<CaptureRecord | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /**
   * The whole viewer pane, measured only when there is no stage yet.
   *
   * `get-scene-state` has to answer with a stage size BEFORE the first
   * project exists — that is the moment the agent is choosing the target's
   * aspect ratio — and in the empty state the pane is the box the stage will
   * occupy.
   */
  const paneRef = useRef<HTMLDivElement | null>(null);

  const channelRef = useRef<SceneBridgeChannel | null>(null);
  if (!channelRef.current) {
    channelRef.current = new SceneBridgeChannel((message) => {
      iframeRef.current?.contentWindow?.postMessage(message, "*");
    });
  }

  const applyView = useCallback((next: ViewMode) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const applyRound = useCallback((next: number | null) => {
    roundRef.current = next;
    setRoundIndex(next);
  }, []);

  /** Restart the scene. Everything the previous document said stops being true. */
  const reload = useCallback(() => {
    channelRef.current?.abort();
    helloRef.current = false;
    sceneErrorsRef.current = [];
    // The notes belonged to the document being torn down; the new one has to
    // announce its own.
    noteNamesRef.current = [];
    reloadedAtRef.current = new Date().toISOString();
    setHelloSeen(false);
    setBridgeVerdict(null);
    setSceneState(null);
    setSceneErrors([]);
    setNoteNames([]);
    setReloadNonce((n) => n + 1);
  }, []);

  /**
   * The CSS box the scene fills. Read on demand rather than tracked in state:
   * the only consumer is `get-scene-state`, and a ResizeObserver feeding a
   * re-render would cost the live scene a reflow every time the user drags a
   * panel divider.
   */
  const measureStage = useCallback((): StageSize | null => {
    const element = stageRef.current ?? paneRef.current;
    return element ? stageSize(element.getBoundingClientRect()) : null;
  }, []);

  // ── The scene's own messages ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      // Only the scene on this stage may speak for it. Without this check the
      // session shell, the chat's own iframes and any nested page could
      // answer a capture request.
      if (!win || event.source !== win) return;
      const message = parseInbound(event.data);
      if (!message) return;
      if (channelRef.current?.accept(message)) return;
      if (message.kind === "hello") {
        helloRef.current = true;
        setHelloSeen(true);
        setBridgeVerdict(true);
        return;
      }
      if (message.kind === "error") {
        sceneErrorsRef.current = [...sceneErrorsRef.current, message.message].slice(-10);
        setSceneErrors(sceneErrorsRef.current);
        return;
      }
      if (message.kind === "note") {
        // The announcement carries only the name; the VALUE comes with the
        // next state reply, where it cannot go stale.
        const next = trackNoteName(noteNamesRef.current, message.name);
        if (next !== noteNamesRef.current) {
          noteNamesRef.current = next;
          setNoteNames(next);
        }
        return;
      }
      // `ready` needs no local state: the next `state` reply carries it, and
      // a boolean kept here would go stale the moment the scene reloads.
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // A scene with no bridge never says hello. Give it the same 3 s a request
  // gets, then say so — before that the honest answer is "measuring…".
  useEffect(() => {
    if (helloSeen) return;
    const timer = setTimeout(() => setBridgeVerdict(helloRef.current), BRIDGE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [reloadNonce, dir, helloSeen]);

  // Poll the scene's vitals while it is on stage. Slow on purpose: these are
  // the numbers the strip prints, not a profiler.
  const liveOnStage = view !== "target" && roundIndex === null;
  useEffect(() => {
    if (!liveOnStage || !helloSeen) return;
    let cancelled = false;
    const channel = channelRef.current!;
    const poll = async () => {
      const reply = await channel.request("state");
      if (cancelled) return;
      if (reply?.kind === "state:result") setSceneState(reply.state);
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [liveOnStage, helloSeen, reloadNonce]);

  // ── Auto-reload, debounced after the last scene edit ─────────────────────
  const signature = useMemo(() => sceneSignature(sceneFiles), [sceneFiles]);
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    if (lastSignature.current === null) {
      lastSignature.current = signature;
      return;
    }
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    const timer = setTimeout(reload, AUTO_RELOAD_MS);
    return () => clearTimeout(timer);
  }, [signature, reload]);

  // ── The budget clock ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!loop?.budget?.startedAt) return;
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [loop?.budget?.startedAt]);

  // ── Capture: what is on the stage, not a picture of the UI ───────────────
  //
  // `stillRef` is written during render (below) rather than read out of
  // state: the capture closure is registered once, and an action can arrive
  // in the same tick the user changed the view.
  const stillRef = useRef<StillSelection | null>(null);

  useEffect(() => {
    setLucidStageCapture(async () => {
      // A recorded round or the target is a file; hand back its exact bytes.
      // Answering with a live frame would be a picture of something the user
      // is not looking at, and rasterizing the <img> would be a rescaled copy
      // of a PNG the agent could have had verbatim.
      const still = stillRef.current;
      if (still) {
        // EVERY capture is filed, not just the live ones. `capture` answers
        // with a PNG path whichever way it went, so an agent that meant to
        // shoot the scene and got the target back cannot see the difference
        // in the reply — and a judge scoring the target against itself costs
        // a whole round. `lastCapture.source` is where that shows.
        lastCaptureRef.current = stillCaptureRecord(
          new Date().toISOString(),
          still.source,
          still.round,
        );
        return fetchStillPayload(still.url);
      }

      // The live scene: wait for it to say it is ready before shooting. A
      // reload leaves the bridge reporting `registered: false` for a few
      // hundred milliseconds, and a frame taken in that window is a picture
      // of a scene that had not started — which the judge then scores.
      const channel = channelRef.current!;
      const readiness = await waitForSceneReady({
        requestState: () => channel.request("state"),
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      });
      const at = new Date().toISOString();
      const reply = await channel.request("capture");
      // Filed whether or not it was ready: a real frame beats the framework's
      // fallback, but the agent has to be able to find out that this one was
      // taken too early. `get-scene-state` reports it as `lastCapture`.
      lastCaptureRef.current = captureRecord(at, readiness, reply);
      return captureViewportPayload(reply);
    });
    return () => setLucidStageCapture(null);
  }, []);

  // ── Selection reported to the agent ──────────────────────────────────────
  const { onSelect } = props;
  const reportSelection = useCallback(
    (round: RoundRecord | null) => {
      if (!loop) {
        onSelect(null);
        return;
      }
      const address: Record<string, unknown> = {};
      if (loop.dir) address.contentSet = loop.dir;
      if (round) address.round = round.index;
      const label = round
        ? round.verdict
          ? `Round ${round.index} · ${formatScore(round.verdict.total)}`
          : `Round ${round.index}`
        : `${loop.title} · live scene`;
      onSelect({
        type: round ? "image" : "scene",
        content: label,
        label,
        address,
      });
    },
    [loop, onSelect],
  );

  const selectRound = useCallback(
    (index: number | null) => {
      applyRound(index);
      const round = index === null ? null : (loop?.rounds.find((r) => r.index === index) ?? null);
      // Comparing a recorded capture against the target is the reason to open
      // a round at all, so a click carries the view with it — including from
      // Target, where the round would otherwise be invisible.
      if (index !== null && viewRef.current !== "split") applyView("split");
      reportSelection(round);
    },
    [applyRound, applyView, loop, reportSelection],
  );

  /**
   * The segmented control, through the SAME algebra the address takes.
   *
   * Pressing a view used to change only `view`, which left the selected round
   * mounted over the stage: "Live" lit up while the round's PNG was still the
   * thing `capture` handed back, and `navigate-to { view: "live" }` — which
   * does clear the round — disagreed with the button beside it. One rule for
   * where a view switch lands, or the two surfaces drift again.
   */
  const selectView = useCallback(
    (mode: ViewMode) => {
      const previousRound = roundRef.current;
      const next = nextStage({ round: previousRound, view: viewRef.current }, { view: mode });
      applyRound(next.round);
      applyView(next.view);
      // The agent's copy of the selection has to lose the round too; otherwise
      // the user's next message still carries "they are looking at round 2"
      // about a stage showing the live scene.
      if (next.round !== previousRound) {
        reportSelection(
          next.round === null ? null : (loop?.rounds.find((r) => r.index === next.round) ?? null),
        );
      }
    },
    [applyRound, applyView, loop, reportSelection],
  );

  // ── Address routing, shared by the action and the locator card ───────────
  //
  // Validated in full BEFORE anything moves. A refusal that had already
  // switched the project would leave the stage somewhere the answer does not
  // describe.
  const runAddress = useCallback(
    (raw: unknown): ViewerActionResult => {
      const here = { round: roundRef.current, view: viewRef.current };
      const outcome = resolveAddress(
        {
          dir,
          projects: loops?.projects ?? {},
          contentSets: contentSets.map((cs) => cs.prefix),
          position: here,
        },
        parseAddress(raw),
      );
      if (!outcome.ok) {
        // The answer reports where the stage still is — nothing moved.
        return { success: false, message: outcome.message, data: { contentSet: dir, ...here } };
      }
      if (outcome.switchTo !== null) setActiveContentSet(outcome.switchTo);
      applyRound(outcome.position.round);
      applyView(outcome.position.view);
      return { success: true, data: { contentSet: outcome.contentSet, ...outcome.position } };
    },
    [applyRound, applyView, contentSets, dir, loops, setActiveContentSet],
  );

  /** The scene's own report, as `get-scene-state` returns it. */
  const readSceneState = useCallback(async (): Promise<ViewerActionResult> => {
    const reply = await channelRef.current!.request("state");
    const viewerErrors = sceneErrorsRef.current;
    // Measured here, not through the bridge: the stage exists before any
    // scene does, so this is the one number that is always answerable — and
    // it is the number the agent needs BEFORE it dreams a target.
    const stage = measureStage();
    const lastCapture = lastCaptureRef.current;
    if (!reply || reply.kind === "unsupported") {
      // Three different facts, and the agent has to be able to tell them
      // apart: no bridge at all, a bridge that went quiet, and a bridge too
      // old to answer this request. Only the first two mean "nothing can be
      // measured"; the third means the scene is running an older script.
      const bridge = reply?.kind === "unsupported" || helloRef.current;
      return {
        success: true,
        message:
          reply?.kind === "unsupported"
            ? `The scene's bridge (version ${reply.bridgeVersion ?? "unknown"}) does not answer "${reply.requestType}" requests. Re-copy lucid-bridge.js into scene/.`
            : helloRef.current
              ? "The scene bridge said hello but did not answer within 3 s — the page is probably blocked in a long task."
              : "The scene page does not include lucid-bridge.js, so nothing about it can be measured or captured.",
        data: {
          bridge,
          registered: false,
          ready: false,
          loading: false,
          fps: null,
          rafFps: null,
          fpsSource: null,
          frameMs: null,
          passesPerFrame: null,
          errorSources: null,
          visibility: null,
          sinceLastRenderMs: null,
          drawCalls: null,
          triangles: null,
          textures: null,
          errors: [...viewerErrors],
          notes: {},
          viewport: null,
          stage,
          lastCapture,
          reloadedAt: reloadedAtRef.current,
        },
      };
    }
    const state = reply.state;
    setSceneState(state);
    const errors = [...new Set([...viewerErrors, ...state.errors])];
    return {
      success: true,
      data: {
        bridge: true,
        registered: state.registered,
        ready: state.ready,
        loading: state.loading,
        fps: state.fps,
        rafFps: state.rafFps,
        fpsSource: state.fpsSource,
        frameMs: state.frameMs,
        passesPerFrame: state.passesPerFrame,
        errorSources: state.errorSources,
        visibility: state.visibility,
        sinceLastRenderMs: state.sinceLastRenderMs,
        drawCalls: state.drawCalls,
        triangles: state.triangles,
        textures: state.textures,
        errors,
        notes: state.notes,
        viewport: state.viewport,
        stage,
        lastCapture,
        reloadedAt: reloadedAtRef.current,
      },
    };
  }, [measureStage]);

  // ── Agent actions ────────────────────────────────────────────────────────
  const { actionRequest, onActionResult } = props;
  useEffect(() => {
    if (!actionRequest || !onActionResult) return;
    const { requestId, actionId, params } = actionRequest;
    switch (actionId) {
      case "navigate-to": {
        // `runAddress` reports where the stage ended up — including the
        // project it switched to, which `dir` will not know about until the
        // store has re-rendered this component.
        onActionResult(requestId, runAddress(params?.address));
        break;
      }
      case "get-scene-state": {
        void readSceneState().then((result) => onActionResult(requestId, result));
        break;
      }
      case "reload-scene": {
        reload();
        onActionResult(requestId, {
          success: true,
          message:
            "The scene iframe is restarting. Give it a moment, then call get-scene-state to see what it reports.",
        });
        break;
      }
      default:
        onActionResult(requestId, { success: false, message: `Unknown action: ${actionId}` });
    }
    // Only a NEW request may run this; every value it reads comes from the
    // render that request arrived in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRequest]);

  // ── Locator cards ────────────────────────────────────────────────────────
  const { navigateRequest, onNavigateComplete } = props;
  useEffect(() => {
    if (!navigateRequest) return;
    onNavigateComplete?.(runAddress(navigateRequest.address));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRequest]);

  // Never keep pointing at a round the agent has removed.
  useEffect(() => {
    if (roundIndex === null) return;
    if (loop?.rounds.some((r) => r.index === roundIndex)) return;
    applyRound(null);
  }, [loop, roundIndex, applyRound]);

  // ── The wipe drag ────────────────────────────────────────────────────────
  //
  // Whether the drag is live is OUR state, not `hasPointerCapture()`. Capture
  // is best-effort: it throws for a pointer the browser no longer considers
  // active, and gating the move handler on it means one failed capture leaves
  // the wipe frozen under a pointer that is visibly still dragging.
  const draggingWipe = useRef(false);

  const onWipePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const surface = event.currentTarget;
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      /* capture is an optimization; the drag works without it */
    }
    draggingWipe.current = true;
    setWipe(wipeFromPointer(event.clientX, surface.getBoundingClientRect()));
  }, []);

  const onWipePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingWipe.current) return;
    setWipe(wipeFromPointer(event.clientX, event.currentTarget.getBoundingClientRect()));
  }, []);

  const onWipePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingWipe.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* never captured, or already released */
    }
  }, []);

  // ── Derived display values ───────────────────────────────────────────────
  const chips = useMemo(() => railChips(loop), [loop]);
  // The script's own trend when it has computed one; otherwise the judged
  // rounds OF THE CURRENT TARGET, which is the same set `lucid.mjs` would
  // have used. Drawing a superseded round into the trajectory would show a
  // re-dreamed loop as one long climb across two different dreams.
  const trend = useMemo(
    () =>
      loop?.evaluation?.trend ??
      chips.filter((c) => c.judged && !c.superseded).map((c) => c.total!),
    [loop, chips],
  );
  const points = useMemo(() => sparklinePoints(trend, 88, 22), [trend]);
  const chip = useMemo(() => exitChip(loop), [loop]);
  const budget = useMemo(() => budgetLabel(loop, now), [loop, now]);

  const vitals: SceneVitals = useMemo(
    () => ({
      bridge: bridgeVerdict !== false,
      fps: sceneState?.fps ?? null,
      frameMs: sceneState?.frameMs ?? null,
      triangles: sceneState?.triangles ?? null,
      textures: sceneState?.textures ?? null,
      errors: [...new Set([...sceneErrors, ...(sceneState?.errors ?? [])])],
      notes: noteCount(noteNames, sceneState?.notes),
    }),
    [bridgeVerdict, sceneState, sceneErrors, noteNames],
  );
  const warnings = useMemo(() => warningLines(loop, vitals), [loop, vitals]);

  const selectedRound = useMemo(
    () => (roundIndex === null ? null : (loop?.rounds.find((r) => r.index === roundIndex) ?? null)),
    [loop, roundIndex],
  );

  const targetSrc = assetUrl(apiBase, dir, loop?.target.path ?? null, props.imageVersion);
  const captureSrc = assetUrl(apiBase, dir, selectedRound?.capture ?? null, props.imageVersion);
  const sceneSrc = sceneUrl(apiBase, dir, reloadNonce);

  // Which file `capture` should hand back, and what that file is a picture
  // of — null when the live scene is the thing on stage.
  stillRef.current = stillOnStage({ round: roundIndex, view }, {
    target: targetSrc,
    capture: captureSrc,
  });

  const commandsEnabled =
    props.editing !== false && !props.readonly && !staticPlayer && !!props.onNotifyAgent;

  const notifyCommand = useCallback(
    (id: string, label: string) => {
      if (!props.onNotifyAgent || !loop) return;
      // The loop's own answer, not a second one derived here: after a
      // re-dream the best round of the ABANDONED target is not "best so far".
      const best = bestPoint(loop);
      props.onNotifyAgent({
        type: `lucid-command:${id}`,
        severity: "warning",
        summary: `/${id} · ${loop.title}`,
        // `description` is the hint the USER was shown, not an instruction;
        // the agent's briefing for these two lives in SKILL.md's Commands.
        message: [
          `The user pressed "${label}" on the lucid stage.`,
          `command: ${id} · project: ${loop.dir || "(root)"} · rounds: ${loop.rounds.length}`,
          best ? `best so far: round ${best.index} at ${formatScore(best.total)}` : "",
          roundRef.current !== null ? `they are looking at round ${roundRef.current}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    },
    [loop, props],
  );

  // ── Empty and loading states ─────────────────────────────────────────────
  if (loops === null) {
    return (
      <div
        ref={paneRef}
        className="flex h-full w-full items-center justify-center bg-cc-bg text-sm text-cc-muted"
      >
        Loading the loop…
      </div>
    );
  }

  if (!loop) {
    return (
      <div
        ref={paneRef}
        className="flex h-full w-full items-center justify-center bg-cc-bg p-8 text-center"
      >
        <div className="max-w-md">
          <h1 className="text-base text-cc-fg">Nothing dreamed yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-cc-muted">
            Ask the agent to describe what you want to build — it dreams the
            target first, then builds the scene toward it while a fresh judge
            scores every round.
          </p>
        </div>
      </div>
    );
  }

  /**
   * The live scene, ALWAYS mounted.
   *
   * Unmounting it while a recorded round or the target is on stage looked
   * tidier and was wrong twice: the scene restarted (losing the camera) every
   * time the user glanced at a round, and — because an unmounted scene can
   * never say hello — the status strip announced "no bridge" about a scene
   * that was running perfectly a second earlier. A covered iframe keeps
   * rendering, so the vitals stay true and the warning means what it says.
   */
  const liveLayer = (
    <iframe
      key={reloadNonce}
      ref={iframeRef}
      src={sceneSrc}
      title={`${loop.title} — live scene`}
      className="absolute inset-0 h-full w-full border-0 bg-black"
      // The scene is first-party static web from this workspace; sandboxing
      // it would break its own relative module imports.
      allow="fullscreen; xr-spatial-tracking"
    />
  );

  /** A recorded round's capture, opaque so nothing shows through the letterbox. */
  const roundLayer =
    selectedRound === null ? null : (
      <div className="absolute inset-0 bg-cc-bg">
        {captureSrc ? (
          <img
            src={captureSrc}
            alt={`Round ${selectedRound.index} capture`}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-cc-muted">
            Round {selectedRound.index} has no capture recorded.
          </div>
        )}
      </div>
    );

  const targetLayer = (
    <div className="absolute inset-0 bg-cc-bg">
      {targetSrc ? (
        <img
          src={targetSrc}
          alt="The target this loop is building toward"
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-cc-muted">
          No target locked yet — the agent dreams it first.
        </div>
      )}
    </div>
  );

  return (
    <div ref={paneRef} className="relative flex h-full w-full flex-col bg-cc-bg text-cc-fg">
      <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-cc-border bg-cc-surface/40 px-3 py-2 backdrop-blur">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-sm font-medium text-cc-fg">{loop.title}</h1>
          <p className="truncate text-[11px] text-cc-muted" title={loop.brief}>
            {loop.brief || "No direction recorded"}
          </p>
        </div>

        {/* Segmented control — custom buttons, never a native control. */}
        <div
          role="group"
          aria-label="Stage view"
          className="ml-auto flex items-center gap-0.5 rounded-full border border-cc-border p-0.5"
        >
          {VIEW_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => selectView(mode)}
              aria-pressed={view === mode}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                view === mode
                  ? "bg-cc-primary/15 text-cc-primary"
                  : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
              }`}
            >
              {VIEW_LABEL[mode]}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={reload}
          title="Reload the live scene"
          className="rounded p-1.5 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
        >
          <ReloadIcon size={14} />
        </button>

        <button
          type="button"
          onClick={() => setLedgerOpen((open) => !open)}
          aria-pressed={ledgerOpen}
          title={`Asset ledger (${loop.assets.length})`}
          className={`rounded p-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
            ledgerOpen
              ? "bg-cc-primary/15 text-cc-primary"
              : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          }`}
        >
          <LayersIcon size={14} />
        </button>

        <button
          type="button"
          onClick={() => setCostOpen((open) => !open)}
          aria-pressed={costOpen}
          title={`Cost so far: $${costSummary.total.toFixed(2)} (list-price estimate)`}
          className={`rounded p-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
            costOpen
              ? "bg-cc-primary/15 text-cc-primary"
              : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          }`}
        >
          <CoinsIcon size={14} />
        </button>

        {commandsEnabled && props.commands?.length
          ? props.commands.map((command) => (
              <button
                key={command.id}
                type="button"
                onClick={() => notifyCommand(command.id, command.label)}
                title={command.description}
                className="rounded-full border border-cc-border px-2.5 py-1 text-[11px] text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-primary"
              >
                {command.label}
              </button>
            ))
          : null}
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-cc-bg">
          {liveLayer}
          {view === "target" ? (
            targetLayer
          ) : (
            <>
              {roundLayer}
              {view === "split" ? (
                <>
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{ clipPath: `inset(0 ${((1 - wipe) * 100).toFixed(2)}% 0 0)` }}
                  >
                    {targetLayer}
                  </div>
                  {/* One drag surface over the whole stage: mid-drag the
                      pointer crosses the iframe, which would otherwise
                      swallow the move events and freeze the wipe. */}
                  <div
                    className="absolute inset-0 cursor-ew-resize"
                    onPointerDown={onWipePointerDown}
                    onPointerMove={onWipePointerMove}
                    onPointerUp={onWipePointerUp}
                    onPointerCancel={onWipePointerUp}
                    role="separator"
                    aria-label="Wipe between the target and the scene"
                    aria-valuenow={Math.round(clampWipe(wipe) * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="absolute inset-y-0 w-px bg-cc-primary/70"
                      style={{ left: `${(clampWipe(wipe) * 100).toFixed(2)}%` }}
                    >
                      <span className="absolute top-1/2 left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cc-primary/70 bg-cc-bg/80 backdrop-blur" />
                    </div>
                    <span className="absolute top-2 left-2 rounded-full border border-cc-border bg-cc-bg/70 px-2 py-0.5 text-[10px] text-cc-muted backdrop-blur">
                      Target
                    </span>
                    <span className="absolute top-2 right-2 rounded-full border border-cc-border bg-cc-bg/70 px-2 py-0.5 text-[10px] text-cc-muted backdrop-blur">
                      {selectedRound ? `Round ${selectedRound.index}` : "Live"}
                    </span>
                  </div>
                </>
              ) : null}
            </>
          )}

          {selectedRound && view !== "target" ? (
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-cc-border bg-cc-bg/80 px-2.5 py-1 text-[11px] text-cc-muted backdrop-blur">
              {selectedRound.verdict
                ? `Round ${selectedRound.index} · ${formatScore(selectedRound.verdict.total)}${
                    selectedRound.verdict.summary ? ` — ${selectedRound.verdict.summary}` : ""
                  }`
                : `Round ${selectedRound.index} · not judged`}
            </div>
          ) : null}
        </div>

        <AssetLedger
          assets={loop.assets}
          open={ledgerOpen}
          onClose={() => setLedgerOpen(false)}
        />
        <CostPanel
          summary={costSummary}
          open={costOpen}
          onClose={() => setCostOpen(false)}
        />
      </div>

      <StatusStrip
        chip={chip}
        vitals={vitalsLine(vitals)}
        budget={budget}
        warnings={warnings}
        bridgeKnown={bridgeVerdict !== null}
        bridgeOk={bridgeVerdict === true}
      />

      <RoundsRail chips={chips} points={points} selected={roundIndex} onSelect={selectRound} />
    </div>
  );
}
