/**
 * Backlot viewer — one screen, the stage rail on top, the body per stage.
 *
 * A film moves through eight stages in a fixed order and the creator approves
 * each one before the next starts. That is the whole navigation model: the
 * rail says where the film is and what it has cost, and the body under it is
 * whatever that stage is about — prose, cards, a shot strip, the shot player,
 * a line table, the cut.
 *
 * Four conventions worth knowing before changing anything:
 *
 * 1. ONE CLOCK OWNS TIME on the two player stages. `usePlayhead` is the
 *    single time state; the lanes, the 3D scene and the timeline all read it
 *    and none of them advances it. It is deliberately NOT React state — see
 *    `usePlayhead.ts` for why — so anything here that needs the current
 *    second asks `clock.getTime()` rather than reading a render-old copy.
 *    The cut has its own clock, because it is a different film.
 *
 * 2. NOTHING HERE WRITES. Every file under a project belongs to
 *    `skill/scripts/backlot.mjs` or `previz.mjs` (invariant 2). The stage,
 *    the layout and the marked range are session-local and deliberately not
 *    persisted; a user request that would change a file — including
 *    APPROVING A STAGE — goes to the agent as a command notification.
 *
 * 3. WHAT THE AGENT READS IS WHAT THE USER SEES. One `ViewPosition` answers
 *    the user's click, `navigate-to` and `get-player-state`, and
 *    `positionAddress` turns it into the address that rides on every
 *    selection — so a sentence that starts with "here" arrives with its
 *    stage, its shot and its moment attached.
 *
 * 4. AN ADDRESS WITH NO `stage` IS A PREVIZ ADDRESS (the brief's appendix),
 *    which is why every address written before the other seven stages
 *    existed still lands where it always did.
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

import type { Beat, Check, Film, SceneMeta, Shot, StageId } from "../domain.js";
import {
  beatAt,
  frameAt,
  nextOpenStage,
  parseSceneMeta,
  selectedTake,
  stageLabel,
  totalCost,
} from "../domain.js";
import { BibleView } from "./BibleView.js";
import { BoardsView } from "./BoardsView.js";
import { CutView } from "./CutView.js";
import { Panel } from "./panel/Panel.js";
import { Player } from "./Player.js";
import {
  beatEdges,
  defaultPair,
  isPlayerStage,
  laneOfTarget,
  laneViews,
  nextEdge,
  parseAddress,
  playheadLabel,
  positionAddress,
  prevEdge,
  resolveAddress,
  selectProject,
  stagePair,
  takeLabel,
  withStageDefaults,
  type CameraMode,
  type GreyboxMode,
  type LaneId,
  type LayoutId,
  type PlayerPosition,
  type ViewPosition,
} from "./player-model.js";
import { ScriptView } from "./ScriptView.js";
import { ShotsRail } from "./ShotsRail.js";
import { SoundView } from "./SoundView.js";
import { StageRail } from "./StageRail.js";
import { Timeline } from "./Timeline.js";
import { Transport } from "./Transport.js";
import { assetUrl, shotAssetUrl } from "./urls.js";
import { usePlayhead } from "./usePlayhead.js";

/** How long after the last seek the agent is told where the playhead is. */
const SELECTION_SETTLE_MS = 350;

/** The command the stage rail's Approve button sends. */
const APPROVE_COMMAND = "approve-stage";

interface LaneLoadState {
  loaded: boolean;
  error: string | null;
}

export default function BacklotPreview(props: ViewerPreviewProps) {
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

  // ── Where the viewer is ──────────────────────────────────────────────────
  const [stage, setStage] = useState<StageId>("previz");
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
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [setId, setSetId] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [cutTime, setCutTime] = useState(0);

  /**
   * Mirrors written synchronously.
   *
   * An action arrives, moves the viewer, and must report where it now is
   * inside the same handler — React state is a render behind at that moment.
   * Every reader that has to be correct *now* uses these.
   */
  const stageRef = useRef<StageId>("previz");
  const shotRef = useRef<string | null>(null);
  const laneRef = useRef<LaneId>("greybox");
  const takeRef = useRef<string | null>(null);
  const layoutRef = useRef<LayoutId>("side");
  const rangeRef = useRef<[number, number] | null>(null);
  const greyboxModeRef = useRef<GreyboxMode>("render");
  const cameraModeRef = useRef<CameraMode>("shot");
  const laneLoadRef = useRef<Record<string, LaneLoadState>>({});
  const sceneRef = useRef<string | null>(null);
  const characterRef = useRef<string | null>(null);
  const setRef = useRef<string | null>(null);
  const lineRef = useRef<string | null>(null);
  const segmentRef = useRef<string | null>(null);
  const cutTimeRef = useRef(0);

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

  /**
   * A different project is a different film: a scene id, a character, a line
   * and a cut segment all belong to the one they came from, and carrying them
   * across would make the reported address name things this project does not
   * have. `projectRef` is written by `runAddress` BEFORE the switch lands, so
   * a `navigate-to` that changes the project AND names a card is not undone
   * by this reset.
   */
  const projectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!project || projectRef.current === project.dir) return;
    projectRef.current = project.dir;
    sceneRef.current = null;
    characterRef.current = null;
    setRef.current = null;
    lineRef.current = null;
    segmentRef.current = null;
    cutTimeRef.current = 0;
    setSceneId(null);
    setCharacterId(null);
    setSetId(null);
    setLineId(null);
    setSegmentId(null);
    setCutTime(0);
  }, [project]);

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
    (path: string | null, revision: number | string) =>
      shot ? shotAssetUrl(apiBase, shot.dir, path, revision) : null,
    [apiBase, shot],
  );

  const railUrlFor = useCallback(
    (target: Shot, path: string | null, revision: number | string) =>
      shotAssetUrl(apiBase, target.dir, path, revision),
    [apiBase],
  );

  /** Workspace-relative media: the bible, the sound and the cut. */
  const projectUrlFor = useCallback(
    (path: string, rev: number | string) => assetUrl(apiBase, path, rev),
    [apiBase],
  );

  const glbUrl = shot ? shotAssetUrl(apiBase, shot.dir, shot.greybox.glb, shot.greybox.revision) : null;

  // ── Position ─────────────────────────────────────────────────────────────
  const currentPosition = useCallback(
    (): ViewPosition => ({
      stage: stageRef.current,
      scene: sceneRef.current,
      character: characterRef.current,
      set: setRef.current,
      line: lineRef.current,
      segment: segmentRef.current,
      cutTime: cutTimeRef.current,
      player: {
        shot: shotRef.current ?? shot?.id ?? "",
        lane: laneRef.current,
        take: takeRef.current,
        layout: layoutRef.current,
        time: clock.getTime(),
        range: rangeRef.current,
      },
    }),
    [clock, shot],
  );

  const applyPosition = useCallback(
    (next: ViewPosition) => {
      stageRef.current = next.stage;
      sceneRef.current = next.scene;
      characterRef.current = next.character;
      setRef.current = next.set;
      lineRef.current = next.line;
      segmentRef.current = next.segment;
      cutTimeRef.current = next.cutTime;
      setStage(next.stage);
      setSceneId(next.scene);
      setCharacterId(next.character);
      setSetId(next.set);
      setLineId(next.line);
      setSegmentId(next.segment);
      setCutTime(next.cutTime);

      const player = next.player;
      shotRef.current = player.shot;
      laneRef.current = player.lane;
      takeRef.current = player.take;
      layoutRef.current = player.layout;
      rangeRef.current = player.range;
      setShotId(player.shot);
      setLane(player.lane);
      setTakeId(player.take);
      setLayout(player.layout);
      setMarkedRange(player.range);
      // A named lane has to be visible: in a two-up or solo layout the lane
      // the caller asked for becomes A, otherwise the player would report a
      // lane the user cannot see. Arriving at Takes puts the take over the
      // greybox, which is the comparison that stage exists for.
      const target = (project?.shots ?? []).find((s) => s.id === player.shot) ?? null;
      if (next.stage === "takes" && target) {
        const pair = stagePair(next.stage, laneViews(target, player.take));
        setLaneA(pair.a);
        setLaneB(pair.b);
      } else if (player.layout !== "side") {
        setLaneA(player.lane);
      }
      clock.seek(player.time);
    },
    [clock, project],
  );

  /** Move one field and leave the rest alone — what every click does. */
  const move = useCallback(
    (patch: Partial<Omit<ViewPosition, "player">> & { player?: Partial<PlayerPosition> }) => {
      const here = currentPosition();
      applyPosition({
        ...here,
        ...patch,
        player: { ...here.player, ...(patch.player ?? {}) },
      });
    },
    [applyPosition, currentPosition],
  );

  const selectStage = useCallback(
    (next: StageId) => {
      const here = currentPosition();
      applyPosition(withStageDefaults({ ...here, stage: next }, here.stage, {}));
    },
    [applyPosition, currentPosition],
  );

  /** A shot chip or a board card: open that shot on a stage that shows it. */
  const openShotOn = useCallback(
    (target: StageId, id: string) => {
      const here = currentPosition();
      applyPosition(
        withStageDefaults(
          { ...here, stage: target, player: { ...here.player, shot: id } },
          here.stage,
          {},
        ),
      );
    },
    [applyPosition, currentPosition],
  );

  // ── Selection reported to the agent ──────────────────────────────────────
  const { onSelect } = props;
  const reportSelection = useCallback(() => {
    if (!project) {
      onSelect(null);
      return;
    }
    const position = currentPosition();
    const target = project.shots.find((s) => s.id === position.player.shot) ?? null;
    const address = positionAddress(project.dir, position, target?.spec ?? null);
    const stageName = stageLabel(position.stage);

    if (isPlayerStage(position.stage) && target) {
      const beat = beatAt(target.beats, position.player.time);
      if (beat) address.beat = beat.id;
      const laneName =
        position.player.lane === "take" && position.player.take
          ? takeLabel(position.player.take)
          : position.player.lane;
      onSelect({
        type: "frame",
        content: `${target.title} · ${laneName} · ${playheadLabel(position.player.time, target.spec)}`,
        label: `${stageName} · ${target.id} · ${laneName}`,
        address,
      });
      return;
    }

    onSelect({
      type: "stage",
      content: describeFocus(position, project.title),
      label: `${stageName} · ${project.title}`,
      address,
    });
  }, [currentPosition, onSelect, project]);

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
  }, [
    stage,
    shot,
    lane,
    takeId,
    layout,
    markedRange,
    sceneId,
    characterId,
    setId,
    lineId,
    segmentId,
  ]);

  // ── Addresses ────────────────────────────────────────────────────────────
  const runAddress = useCallback(
    (raw: unknown): ViewerActionResult => {
      const here = currentPosition();
      const address = parseAddress(raw);
      const outcome = resolveAddress(
        {
          contentSet: project?.dir ?? "",
          projects: film?.projects ?? {},
          contentSets: contentSets.map((cs) => cs.prefix),
          position: here,
        },
        address,
      );
      if (!outcome.ok) {
        // The answer reports where the viewer still is — nothing moved.
        return {
          success: false,
          message: outcome.message,
          data: { contentSet: project?.dir ?? "", ...flatten(here) },
        };
      }
      const applied = withStageDefaults(outcome.position, here.stage, address);
      // Claim the new project BEFORE the switch lands, or the reset effect
      // would wipe the card this very address just put in focus.
      projectRef.current = outcome.contentSet;
      if (outcome.switchTo !== null) setActiveContentSet(outcome.switchTo);
      applyPosition(applied);
      const target = (film?.projects[outcome.contentSet]?.shots ?? []).find(
        (s) => s.id === applied.player.shot,
      );
      return {
        success: true,
        data: {
          contentSet: outcome.contentSet,
          ...flatten(applied),
          frame: target ? frameAt(applied.player.time, target.spec) : null,
        },
      };
    },
    [applyPosition, contentSets, currentPosition, film, project, setActiveContentSet],
  );

  const readPlayerState = useCallback((): ViewerActionResult => {
    if (!project) {
      return {
        success: true,
        message: "No film is open — this workspace has no backlot.json yet.",
        data: { contentSet: null, stage: null, shot: null, shots: [] },
      };
    }
    const position = currentPosition();
    const open = nextOpenStage(project);
    const base = {
      contentSet: project.dir,
      stage: position.stage,
      stages: project.stages.map((s) => ({ stage: s.id, status: s.status, usd: s.usd })),
      nextOpenStage: open?.id ?? null,
      gates: project.gates,
      totalUsd: totalCost(project.cost),
      scene: position.scene,
      character: position.character,
      set: position.set,
      line: position.line,
      segment: position.segment,
      cut: project.cut
        ? { kind: project.cut.kind, seconds: project.cut.seconds, time: round2(position.cutTime) }
        : null,
      shots: project.shots.map((s) => s.id),
    };

    if (!shot) return { success: true, data: { ...base, shot: null } };

    const snapshot = clock.getSnapshot();
    const views = laneViews(shot, takeRef.current);
    const beat = beatAt(shot.beats, snapshot.time);
    return {
      success: true,
      data: {
        ...base,
        shot: shot.id,
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
  }, [clock, currentPosition, laneA, laneB, project, shot]);

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

  // ── Keyboard (the player stages own these keys) ──────────────────────────
  const edges = useMemo(() => (shot ? beatEdges(shot.beats, shot.spec.seconds) : [0]), [shot]);
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

  const playerKeys = isPlayerStage(stage) && shot !== null;
  useEffect(() => {
    // Only Previz and Takes bind the arrows to the frame step. On the other
    // six stages they belong to the stage rail, which handles them on its own
    // element so the two owners can never both fire.
    if (typeof window === "undefined" || !playerKeys) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // The chat input is a sibling of this pane; Space belongs to whoever
      // is typing, not to the transport.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
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
  }, [clock, loopCurrentBeat, playerKeys]);

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

  const onCutTime = useCallback((seconds: number) => {
    cutTimeRef.current = seconds;
    setCutTime(seconds);
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
        type: `backlot-command:${id}`,
        severity: "warning",
        summary: `/${id} · ${shot.title}`,
        // `description` is the hint the USER was shown, not an instruction;
        // the agent's briefing for these lives in SKILL.md's Commands.
        message: [
          `The user pressed "${label}" on the backlot ${stageLabel(stageRef.current)} stage.`,
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

  /**
   * Approve is a COMMAND, not a write.
   *
   * The viewer records nothing: it tells the agent, in the words the skill
   * expects, that the creator approved a stage. `backlot.mjs approve` then
   * stores the approval together with that stage's content hash — which is
   * the only thing that can ever make `changed` mean anything.
   */
  const approveStage = useCallback(
    (target: StageId) => {
      if (!props.onNotifyAgent || !project) return;
      const state = project.stages.find((s) => s.id === target);
      props.onNotifyAgent({
        type: `backlot-command:${APPROVE_COMMAND}`,
        severity: "warning",
        summary: `Approve · ${stageLabel(target)}`,
        message: [
          `approve ${target}`,
          "",
          `The user pressed Approve on the ${stageLabel(target)} stage of "${project.title}"${
            project.dir ? ` (${project.dir})` : ""
          }.`,
          `status when they pressed it: ${state?.status ?? "unknown"}`,
          "Record the approval against what that stage holds right now, then say what the next stage will produce.",
        ].join("\n"),
      });
    },
    [project, props],
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
          <h1 className="text-base text-cc-fg">No film yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-cc-muted">
            Tell the agent what the film is. It writes the idea, then the screenplay, then the
            bible and the boards — and blocks every shot in 3D before a video model is allowed to
            paint anything.
          </p>
        </div>
      </div>
    );
  }

  const shotCommands = (props.commands ?? []).filter((c) => c.id !== APPROVE_COMMAND);

  return (
    <div className="flex h-full w-full flex-col bg-cc-bg">
      <StageRail
        stages={project.stages}
        current={stage}
        onSelect={selectStage}
        onApprove={commandsEnabled ? approveStage : null}
        gates={project.gates}
        title={project.title}
        total={totalCost(project.cost)}
      />

      <div className="flex min-h-0 flex-1">
        {stage === "idea" || stage === "script" ? (
          <ScriptView
            project={project}
            stage={stage}
            selectedScene={sceneId}
            onSelectScene={(id) => move({ scene: id })}
            onOpenShot={(id) => openShotOn("boards", id)}
            dark={props.theme !== "light"}
          />
        ) : stage === "bible" ? (
          <BibleView
            project={project}
            selectedCharacter={characterId}
            selectedSet={setId}
            onSelectCharacter={(id) => move({ character: id })}
            onSelectSet={(id) => move({ set: id })}
            urlFor={projectUrlFor}
          />
        ) : stage === "boards" ? (
          <BoardsView
            project={project}
            selected={shot?.id ?? null}
            onOpenShot={(id) => openShotOn("previz", id)}
            urlFor={railUrlFor}
          />
        ) : stage === "sound" ? (
          <SoundView
            project={project}
            selectedLine={lineId}
            onSelectLine={(id) => move({ line: id })}
            urlFor={projectUrlFor}
          />
        ) : stage === "cut" ? (
          <CutView
            project={project}
            selectedSegment={segmentId}
            onSelectSegment={(id) => move({ segment: id })}
            time={cutTime}
            onTime={onCutTime}
            urlFor={projectUrlFor}
          />
        ) : !shot ? (
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
            <ShotsRail
              shots={shots}
              selected={shot.id}
              onSelect={onSelectShot}
              projectTitle={project.title}
              urlFor={railUrlFor}
            />

            <div className="flex min-w-0 flex-1 flex-col">
              <Player
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

              {commandsEnabled && shotCommands.length > 0 ? (
                <div className="flex shrink-0 items-center gap-2 border-t border-cc-border bg-cc-surface/20 px-3 py-1.5">
                  {shotCommands.map((command) => (
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
              project={project}
              planMarkdown={docText("shot-plan.md")}
              promptMarkdown={docText(shot.promptFile ?? "prompts.md")}
              dark={props.theme !== "light"}
              selectedLaneTake={takeId}
              onFocusCheck={onFocusCheck}
              onShowTake={onSelectTake}
              checkFocus={stage === "takes" ? "take" : "greybox"}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ───────────────────────────────────────────────────────────

/** The action reply's flat shape — the same keys an address uses. */
function flatten(position: ViewPosition): Record<string, unknown> {
  return {
    stage: position.stage,
    scene: position.scene,
    character: position.character,
    set: position.set,
    line: position.line,
    segment: position.segment,
    cutTime: round2(position.cutTime),
    shot: position.player.shot,
    lane: position.player.lane,
    take: position.player.take,
    layout: position.player.layout,
    time: position.player.time,
    range: position.player.range,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** One sentence naming what a non-player stage has in focus. */
function describeFocus(position: ViewPosition, title: string): string {
  switch (position.stage) {
    case "script":
      return position.scene
        ? `Scene "${position.scene}" of "${title}"`
        : `The screenplay of "${title}"`;
    case "bible":
      if (position.character) return `The character "${position.character}"`;
      if (position.set) return `The set "${position.set}"`;
      return `The bible of "${title}"`;
    case "sound":
      return position.line ? `The line "${position.line}"` : `The sound of "${title}"`;
    case "cut":
      return position.segment
        ? `The cut at ${position.cutTime.toFixed(2)} s, on segment "${position.segment}"`
        : `The cut of "${title}" at ${position.cutTime.toFixed(2)} s`;
    default:
      return `The ${stageLabel(position.stage)} stage of "${title}"`;
  }
}
