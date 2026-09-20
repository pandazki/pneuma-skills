/**
 * Previz viewer — the shot's player.
 *
 * Three conventions worth knowing before changing anything:
 *
 * 1. ONE CLOCK OWNS TIME. `usePlayhead` is the single time state; the lanes,
 *    the 3D scene and the timeline all read it and none of them advances it.
 *    It is deliberately NOT React state — see `usePlayhead.ts` for why — so
 *    anything here that needs the current second asks `clock.getTime()`
 *    rather than reading a render-old copy.
 *
 * 2. NOTHING HERE WRITES. `previz.json`, `shot.json` and every file under a
 *    shot belong to `skill/scripts/previz.mjs` (invariant 2). The stage
 *    position, the layout and the marked range are session-local and
 *    deliberately not persisted; a user request that would change a file goes
 *    to the agent as a command notification.
 *
 * 3. WHAT THE AGENT READS IS WHAT THE USER SEES. The playhead address —
 *    shot, lane, take, time, frame, beat — rides on every selection, so a
 *    sentence that starts with "here" arrives with its moment attached. The
 *    same `resolveAddress` answers `navigate-to`, so the stage and the report
 *    cannot drift apart.
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

import type { Beat, Check, Film, SceneMeta, Shot } from "../domain.js";
import { beatAt, frameAt, parseSceneMeta, selectedTake } from "../domain.js";
import { Panel } from "./panel/Panel.js";
import { ShotsRail } from "./ShotsRail.js";
import { Stage } from "./Stage.js";
import {
  beatEdges,
  defaultPair,
  laneOfTarget,
  laneViews,
  nextEdge,
  parseAddress,
  playheadLabel,
  positionAddress,
  prevEdge,
  resolveAddress,
  selectProject,
  takeLabel,
  type CameraMode,
  type GreyboxMode,
  type LaneId,
  type LayoutId,
  type StagePosition,
} from "./stage-model.js";
import { Timeline } from "./Timeline.js";
import { Transport } from "./Transport.js";
import { shotAssetUrl } from "./urls.js";
import { usePlayhead } from "./usePlayhead.js";

/** How long after the last seek the agent is told where the playhead is. */
const SELECTION_SETTLE_MS = 350;

interface LaneLoadState {
  loaded: boolean;
  error: string | null;
}

export default function PrevizPreview(props: ViewerPreviewProps) {
  const { value: film } = useSource(props.sources.film as Source<Film> | undefined);
  const { value: docFiles } = useSource(
    props.sources.docs as Source<ViewerFileContent[]> | undefined,
  );
  const { value: metaFiles } = useSource(
    props.sources.metas as Source<ViewerFileContent[]> | undefined,
  );

  const activeContentSet = useStore((s) => s.activeContentSet);
  const contentSets = useStore((s) => s.contentSets);
  const setActiveContentSet = useStore((s) => s.setActiveContentSet);
  const staticPlayer = useStore((s) => s.staticPlayer);
  const apiBase = useMemo(() => getApiBase(), []);

  const project = useMemo(() => selectProject(film, activeContentSet), [film, activeContentSet]);
  const shots = project?.shots ?? [];

  // ── Stage state ──────────────────────────────────────────────────────────
  const [shotId, setShotId] = useState<string | null>(null);
  const [lane, setLane] = useState<LaneId>("greybox");
  const [takeId, setTakeId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutId>("side");
  const [laneA, setLaneA] = useState<LaneId>("greybox");
  const [laneB, setLaneB] = useState<LaneId>("take");
  const [greyboxMode, setGreyboxMode] = useState<GreyboxMode>("render");
  const [cameraMode, setCameraMode] = useState<CameraMode>("shot");
  const [markedRange, setMarkedRange] = useState<[number, number] | null>(null);
  const [mutedTakes, setMutedTakes] = useState(true);
  const [laneLoad, setLaneLoad] = useState<Record<string, LaneLoadState>>({});

  /**
   * Mirrors written synchronously.
   *
   * An action arrives, changes the stage, and must report what the stage now
   * shows inside the same handler — React state is a render behind at that
   * moment. Every reader that has to be correct *now* uses these.
   */
  const shotRef = useRef<string | null>(null);
  const laneRef = useRef<LaneId>("greybox");
  const takeRef = useRef<string | null>(null);
  const layoutRef = useRef<LayoutId>("side");
  const rangeRef = useRef<[number, number] | null>(null);
  const greyboxModeRef = useRef<GreyboxMode>("render");
  const cameraModeRef = useRef<CameraMode>("shot");
  const laneLoadRef = useRef<Record<string, LaneLoadState>>({});

  const shot: Shot | null = useMemo(
    () => shots.find((s) => s.id === shotId) ?? shots[0] ?? null,
    [shots, shotId],
  );

  const clock = usePlayhead(shot?.spec.seconds ?? 1, shot?.spec.fps ?? 24);

  // Never keep pointing at a shot the agent has removed, and adopt the first
  // one as soon as a project loads.
  useEffect(() => {
    if (shots.length === 0) {
      if (shotRef.current !== null) {
        shotRef.current = null;
        setShotId(null);
      }
      return;
    }
    if (shotId !== null && shots.some((s) => s.id === shotId)) return;
    const next = shots[0].id;
    shotRef.current = next;
    setShotId(next);
  }, [shots, shotId]);

  // A shot switch is a different clock, a different set of lanes and a
  // different marked range. Everything session-local about the old shot goes.
  const previousShot = useRef<string | null>(null);
  useEffect(() => {
    if (!shot || previousShot.current === shot.id) return;
    previousShot.current = shot.id;
    clock.pause();
    clock.seek(0);
    clock.setLoopWindow(null);
    rangeRef.current = null;
    setMarkedRange(null);
    laneLoadRef.current = {};
    setLaneLoad({});
    const next = selectedTake(shot)?.id ?? null;
    takeRef.current = next;
    setTakeId(next);
    greyboxModeRef.current = "render";
    setGreyboxMode("render");
  }, [shot, clock]);

  const lanes = useMemo(() => (shot ? laneViews(shot, takeId) : []), [shot, takeId]);

  // The A/B pair must always name two lanes this shot actually has —
  // a `reference` pick that survives into a shot with no reference would
  // show an empty half and read as a broken player.
  useEffect(() => {
    if (lanes.length === 0) return;
    const ids = lanes.map((l) => l.id);
    if (!ids.includes(laneA) || !ids.includes(laneB) || laneA === laneB) {
      const pair = defaultPair(lanes);
      setLaneA(pair.a);
      setLaneB(pair.b);
    }
  }, [lanes, laneA, laneB]);

  // ── Files the panel reads ────────────────────────────────────────────────
  const docText = useCallback(
    (name: string): string | null => {
      if (!shot) return null;
      const path = `${shot.dir}/${name}`;
      return docFiles?.find((f) => f.path === path)?.content ?? null;
    },
    [docFiles, shot],
  );

  const meta: SceneMeta | null = useMemo(() => {
    if (!shot || !shot.greybox.meta) return null;
    const path = `${shot.dir}/${shot.greybox.meta}`;
    const file = metaFiles?.find((f) => f.path === path);
    return file ? parseSceneMeta(file.content) : null;
  }, [metaFiles, shot]);

  const urlFor = useCallback(
    (path: string | null, revision: number) =>
      shot ? shotAssetUrl(apiBase, shot.dir, path, revision) : null,
    [apiBase, shot],
  );

  const railUrlFor = useCallback(
    (target: Shot, path: string | null, revision: number) =>
      shotAssetUrl(apiBase, target.dir, path, revision),
    [apiBase],
  );

  const glbUrl = shot ? shotAssetUrl(apiBase, shot.dir, shot.greybox.glb, shot.greybox.revision) : null;

  // ── Selection reported to the agent ──────────────────────────────────────
  const { onSelect } = props;
  const reportSelection = useCallback(() => {
    if (!shot || !project) {
      onSelect(null);
      return;
    }
    const position: StagePosition = {
      shot: shot.id,
      lane: laneRef.current,
      take: takeRef.current,
      layout: layoutRef.current,
      time: clock.getTime(),
      range: rangeRef.current,
    };
    const address = positionAddress(project.dir, position, shot.spec);
    const beat = beatAt(shot.beats, position.time);
    if (beat) address.beat = beat.id;
    const laneName = position.lane === "take" && position.take ? takeLabel(position.take) : position.lane;
    onSelect({
      type: "frame",
      content: `${shot.title} · ${laneName} · ${playheadLabel(position.time, shot.spec)}`,
      label: `${shot.id} · ${laneName}`,
      address,
    });
  }, [clock, onSelect, project, shot]);

  const reportRef = useRef(reportSelection);
  reportRef.current = reportSelection;

  /**
   * The playhead rides on the selection, but not sixty times a second: the
   * report is debounced so it lands once the user has stopped moving. While
   * playing, the clock changes on every frame, so the timer keeps resetting
   * and nothing is sent until playback stops — which is exactly when "here"
   * starts meaning something.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = clock.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reportRef.current(), SELECTION_SETTLE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [clock]);

  // Everything that is not time reports immediately.
  useEffect(() => {
    reportRef.current();
  }, [shot, lane, takeId, layout, markedRange]);

  // ── Stage moves ──────────────────────────────────────────────────────────
  const applyPosition = useCallback(
    (next: StagePosition) => {
      shotRef.current = next.shot;
      laneRef.current = next.lane;
      takeRef.current = next.take;
      layoutRef.current = next.layout;
      rangeRef.current = next.range;
      setShotId(next.shot);
      setLane(next.lane);
      setTakeId(next.take);
      setLayout(next.layout);
      setMarkedRange(next.range);
      // A named lane has to be visible: in a two-up or solo layout the lane
      // the caller asked for becomes A, otherwise the stage would report a
      // lane the user cannot see.
      setLaneA((current) => (next.layout === "side" ? current : next.lane));
      clock.seek(next.time);
    },
    [clock],
  );

  const currentPosition = useCallback(
    (): StagePosition => ({
      shot: shotRef.current ?? shot?.id ?? "",
      lane: laneRef.current,
      take: takeRef.current,
      layout: layoutRef.current,
      time: clock.getTime(),
      range: rangeRef.current,
    }),
    [clock, shot],
  );

  const runAddress = useCallback(
    (raw: unknown): ViewerActionResult => {
      const here = currentPosition();
      const outcome = resolveAddress(
        {
          contentSet: project?.dir ?? "",
          projects: film?.projects ?? {},
          contentSets: contentSets.map((cs) => cs.prefix),
          position: here,
        },
        parseAddress(raw),
      );
      if (!outcome.ok) {
        // The answer reports where the stage still is — nothing moved.
        return {
          success: false,
          message: outcome.message,
          data: { contentSet: project?.dir ?? "", ...here },
        };
      }
      if (outcome.switchTo !== null) setActiveContentSet(outcome.switchTo);
      applyPosition(outcome.position);
      const target = (film?.projects[outcome.contentSet]?.shots ?? []).find(
        (s) => s.id === outcome.position.shot,
      );
      return {
        success: true,
        data: {
          contentSet: outcome.contentSet,
          ...outcome.position,
          frame: target ? frameAt(outcome.position.time, target.spec) : null,
        },
      };
    },
    [applyPosition, contentSets, currentPosition, film, project, setActiveContentSet],
  );

  const readPlayerState = useCallback((): ViewerActionResult => {
    if (!shot || !project) {
      return {
        success: true,
        message: "No shot is open — this workspace has no previz.json with shots yet.",
        data: { contentSet: project?.dir ?? null, shot: null, shots: [] },
      };
    }
    const snapshot = clock.getSnapshot();
    const views = laneViews(shot, takeRef.current);
    const beat = beatAt(shot.beats, snapshot.time);
    return {
      success: true,
      data: {
        contentSet: project.dir,
        shot: shot.id,
        shots: project.shots.map((s) => s.id),
        layout: layoutRef.current,
        laneA,
        laneB,
        greyboxMode: greyboxModeRef.current,
        cameraMode: cameraModeRef.current,
        lanes: views.map((view) => ({
          id: view.id,
          label: view.label,
          kind: view.kind,
          file: view.file,
          loaded: laneLoadRef.current[view.id]?.loaded ?? false,
          error: laneLoadRef.current[view.id]?.error ?? null,
          facts: view.facts,
          duration: view.duration,
        })),
        playhead: {
          time: Math.round(snapshot.time * 1000) / 1000,
          frame: frameAt(snapshot.time, shot.spec),
          frames: shot.spec.frames,
          beat: beat?.id ?? null,
        },
        markedRange: rangeRef.current,
        selectedTake: takeRef.current,
        playing: snapshot.playing,
        rate: snapshot.rate,
        loop: snapshot.loop,
      },
    };
  }, [clock, laneA, laneB, project, shot]);

  // ── Agent actions ────────────────────────────────────────────────────────
  const { actionRequest, onActionResult } = props;
  useEffect(() => {
    if (!actionRequest || !onActionResult) return;
    const { requestId, actionId, params } = actionRequest;
    switch (actionId) {
      case "navigate-to":
        onActionResult(requestId, runAddress(params?.address));
        break;
      case "get-player-state":
        onActionResult(requestId, readPlayerState());
        break;
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

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const edges = useMemo(
    () => (shot ? beatEdges(shot.beats, shot.spec.seconds) : [0]),
    [shot],
  );
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const beatsRef = useRef<Beat[]>([]);
  beatsRef.current = shot?.beats ?? [];

  const loopCurrentBeat = useCallback(() => {
    const beat = beatAt(beatsRef.current, clock.getTime());
    if (!beat) {
      clock.setLoopWindow(null);
      clock.setLoop(clock.getSnapshot().loop === "shot" ? "off" : "shot");
      return;
    }
    clock.setLoopWindow([beat.from, beat.to]);
    clock.setLoop(clock.getSnapshot().loop === "beat" ? "off" : "beat");
  }, [clock]);

  useEffect(() => {
    if (typeof window === "undefined" || !shot) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // The chat input is a sibling of this pane; Space belongs to whoever
      // is typing, not to the transport.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case " ":
          event.preventDefault();
          clock.toggle();
          break;
        case "ArrowLeft":
          event.preventDefault();
          clock.stepFrames(event.shiftKey ? -10 : -1);
          break;
        case "ArrowRight":
          event.preventDefault();
          clock.stepFrames(event.shiftKey ? 10 : 1);
          break;
        case "[":
          event.preventDefault();
          clock.pause();
          clock.seek(prevEdge(edgesRef.current, clock.getTime()));
          break;
        case "]":
          event.preventDefault();
          clock.pause();
          clock.seek(nextEdge(edgesRef.current, clock.getTime()));
          break;
        case "l":
        case "L":
          event.preventDefault();
          loopCurrentBeat();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clock, loopCurrentBeat, shot]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const onLaneLoaded = useCallback((laneId: string, loaded: boolean, error: string | null) => {
    const current = laneLoadRef.current[laneId];
    if (current && current.loaded === loaded && current.error === error) return;
    laneLoadRef.current = { ...laneLoadRef.current, [laneId]: { loaded, error } };
    setLaneLoad(laneLoadRef.current);
  }, []);

  const onSelectShot = useCallback((id: string) => {
    shotRef.current = id;
    setShotId(id);
  }, []);

  const onSelectTake = useCallback((id: string) => {
    takeRef.current = id;
    setTakeId(id);
    laneRef.current = "take";
    setLane("take");
  }, []);

  const onMarkRange = useCallback((range: [number, number] | null) => {
    rangeRef.current = range;
    setMarkedRange(range);
  }, []);

  const onBeatFocus = useCallback(
    (beat: Beat | null) => {
      clock.setLoopWindow(beat ? [beat.from, beat.to] : null);
    },
    [clock],
  );

  const onFocusCheck = useCallback(
    (check: Check) => {
      const { lane: targetLane, take } = laneOfTarget(check.target);
      laneRef.current = targetLane;
      setLane(targetLane);
      if (take) {
        takeRef.current = take;
        setTakeId(take);
      }
      // A two-up layout has to put the check's target on the A side, or the
      // user is sent to a moment on a lane the check is not about.
      setLaneA(targetLane);
      if (check.range) {
        clock.pause();
        clock.seek(check.range[0]);
        onMarkRange(check.range);
      }
    },
    [clock, onMarkRange],
  );

  const setLayoutChecked = useCallback((next: LayoutId) => {
    layoutRef.current = next;
    setLayout(next);
  }, []);

  const setGreyboxModeChecked = useCallback((next: GreyboxMode) => {
    greyboxModeRef.current = next;
    setGreyboxMode(next);
  }, []);

  const setCameraModeChecked = useCallback((next: CameraMode) => {
    cameraModeRef.current = next;
    setCameraMode(next);
  }, []);

  const commandsEnabled =
    props.editing !== false && !props.readonly && !staticPlayer && !!props.onNotifyAgent;

  const notifyCommand = useCallback(
    (id: string, label: string) => {
      if (!props.onNotifyAgent || !shot || !project) return;
      const time = clock.getTime();
      const failing = shot.checks.filter((c) => c.status === "fail").map((c) => c.id);
      const unverified = shot.checks.filter((c) => c.status === "unverified").map((c) => c.id);
      props.onNotifyAgent({
        type: `previz-command:${id}`,
        severity: "warning",
        summary: `/${id} · ${shot.title}`,
        // `description` is the hint the USER was shown, not an instruction;
        // the agent's briefing for these two lives in SKILL.md's Commands.
        message: [
          `The user pressed "${label}" on the previz stage.`,
          `command: ${id} · project: ${project.dir || "(root)"} · shot: ${shot.id}`,
          `greybox: ${shot.greybox.final ? `revision ${shot.greybox.final.revision}` : "not rendered"}`,
          `playhead: ${playheadLabel(time, shot.spec)} on the ${laneRef.current} lane`,
          rangeRef.current
            ? `marked range: ${rangeRef.current[0].toFixed(2)}–${rangeRef.current[1].toFixed(2)} s`
            : "",
          failing.length > 0 ? `failing checks: ${failing.join(", ")}` : "",
          unverified.length > 0 ? `unverified checks: ${unverified.join(", ")}` : "",
          shot.stuck.length > 0 ? `stuck: ${shot.stuck.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    },
    [clock, project, props, shot],
  );

  // ── Empty and loading states ─────────────────────────────────────────────
  if (film === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-cc-bg text-sm text-cc-muted">
        Loading the film…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-cc-bg p-8 text-center">
        <div className="max-w-md">
          <h1 className="text-base text-cc-fg">Nothing blocked yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-cc-muted">
            Tell the agent what the shot is — or point it at a video to recreate. It writes a
            timed plan, blocks the shot in Blender and renders a greybox; only once that is
            accepted does a video model paint the look on top of it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-cc-bg">
      <ShotsRail
        shots={shots}
        selected={shot?.id ?? null}
        onSelect={onSelectShot}
        projectTitle={project.title}
        urlFor={railUrlFor}
      />

      {!shot ? (
        <div className="flex min-w-0 flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-md">
            <h1 className="text-base text-cc-fg">{project.title} has no shots yet</h1>
            <p className="mt-2 text-sm leading-relaxed text-cc-muted">
              Ask the agent for the first shot. It scaffolds the plan, a Blender script that
              already renders, and the acceptance list in one step.
            </p>
            {project.warnings.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 text-left text-[11px] text-cc-warning">
                {project.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <Stage
              lanes={lanes}
              urlFor={urlFor}
              clock={clock}
              aspect={shot.spec.width / Math.max(shot.spec.height, 1)}
              layout={layout}
              onLayout={setLayoutChecked}
              laneA={laneA}
              laneB={laneB}
              onLaneA={setLaneA}
              onLaneB={setLaneB}
              greyboxMode={greyboxMode}
              onGreyboxMode={setGreyboxModeChecked}
              cameraMode={cameraMode}
              onCameraMode={setCameraModeChecked}
              glbUrl={glbUrl}
              meta={meta}
              takes={shot.takes}
              onSelectTake={onSelectTake}
              mutedTakes={mutedTakes}
              onToggleMuted={() => setMutedTakes((m) => !m)}
              onLoadedChange={onLaneLoaded}
            />

            <Transport
              clock={clock}
              spec={shot.spec}
              onPrevEdge={() => {
                clock.pause();
                clock.seek(prevEdge(edges, clock.getTime()));
              }}
              onNextEdge={() => {
                clock.pause();
                clock.seek(nextEdge(edges, clock.getTime()));
              }}
              markedRange={markedRange}
              onClearRange={() => onMarkRange(null)}
            />

            <Timeline
              shot={shot}
              clock={clock}
              markedRange={markedRange}
              onMarkRange={onMarkRange}
              onBeatFocus={onBeatFocus}
            />

            {commandsEnabled && props.commands && props.commands.length > 0 ? (
              <div className="flex shrink-0 items-center gap-2 border-t border-cc-border bg-cc-surface/20 px-3 py-1.5">
                {props.commands.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    onClick={() => notifyCommand(command.id, command.label)}
                    title={command.description}
                    className="rounded-full border border-cc-border px-2.5 py-1 text-[11px] text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
                  >
                    {command.label}
                  </button>
                ))}
                <span className="ml-auto text-[10px] text-cc-muted">
                  {Object.values(laneLoad).filter((l) => l.error).length > 0
                    ? "a lane could not be decoded — see the lane header"
                    : ""}
                </span>
              </div>
            ) : null}
          </div>

          <Panel
            shot={shot}
            allShots={shots}
            planMarkdown={docText("shot-plan.md")}
            promptMarkdown={docText(shot.promptFile ?? "prompts.md")}
            dark={props.theme !== "light"}
            selectedLaneTake={takeId}
            onFocusCheck={onFocusCheck}
            onShowTake={onSelectTake}
          />
        </>
      )}
    </div>
  );
}
