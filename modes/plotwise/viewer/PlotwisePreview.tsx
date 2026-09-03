/**
 * Plotwise viewer — v0.1 scaffold.
 *
 * Galgame stage: autoplaying segments with flash-free double-buffered
 * swaps, hover-only transport, choices that fade in when the clip ends,
 * an inline question box, an evidence panel, and an 18-style picker
 * catalog on the empty stage. All chrome uses the cc-* design tokens so
 * the viewer follows the shell's light/dark theme; only the picture box
 * itself stays a black cinema surface.
 *
 * The full-screen course map (infinite canvas) replaces the node rail in
 * a later iteration; the Source subscription, address handling, and
 * action wiring here are what it builds on.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ViewerActionResult,
  ViewerFileContent,
  ViewerPreviewProps,
} from "../../../core/types/viewer-contract.js";
import type { Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import type { ChoiceRef, Course, CourseNode, CourseSet } from "../domain.js";
import { mainLine } from "./mainLine.js";
import { Spinner } from "./cinema.js";
import { IN_PRODUCTION, MANAGER_SILENT_MS, fmtElapsed, managerSilent, productionLabel, productionState, shotAt, waitState } from "./waiting.js";
import { getApiBase } from "../../../src/utils/api.js";
import { STYLE_CARDS } from "./styleCatalog.js";
import StyleBoard, { type StyleBoardEvent } from "./StyleBoard.js";
import PreparingScreen from "./PreparingScreen.js";
import Interlude from "./Interlude.js";
import VideoStage from "./VideoStage.js";

const STATUS_LABEL: Record<CourseNode["status"], string> = {
  planned: "待拍",
  scripting: "写稿中",
  queued: "排队中",
  generating: "拍摄中",
  ready: "已拍好",
  failed: "失败",
  cancelled: "未走",
};

const STATUS_DOT: Record<CourseNode["status"], string> = {
  ready: "bg-cc-success",
  generating: "bg-cc-primary",
  scripting: "bg-cc-primary/50",
  queued: "bg-cc-primary/50",
  failed: "bg-cc-error",
  planned: "bg-cc-muted/40",
  cancelled: "bg-cc-muted/20",
};

const KIND_LABEL: Record<CourseNode["kind"], string> = {
  main: "主线",
  branch: "支线",
  sidequest: "提问",
  question: "提问",
};

/** How long the interlude holds between two ready scenes. */
const TRANSITION_MS = 2_500;

/** What a choice card or rail entry says beside a scene that is not
 * simply ready. */
function sceneHint(n: CourseNode | undefined): string | null {
  if (!n) return "点击开拍";
  if (IN_PRODUCTION.has(n.status)) return productionLabel(n);
  if (n.status === "failed") return "失败 · 点击重拍";
  if (n.status === "cancelled") return "未走 · 点击改走";
  if (n.status === "planned") return "点击开拍";
  return null;
}

// ── Course map (infinite canvas) ────────────────────────────────────────

const CARD_W = 224;
const CARD_H = 196;
const GAP_X = 300;
const GAP_Y = 216;

/** Layered tree layout: depth → column, discovery order → row. */
function layoutCourse(set: CourseSet) {
  const depths = new Map<string, number>();
  const order: string[] = [];
  const queue: string[] = set.nodes[set.rootNode] ? [set.rootNode] : [];
  if (queue.length) depths.set(set.rootNode, 0);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const c of set.nodes[id]?.children ?? []) {
      if (set.nodes[c.nodeId] && !depths.has(c.nodeId)) {
        depths.set(c.nodeId, depths.get(id)! + 1);
        queue.push(c.nodeId);
      }
    }
  }
  for (const id of Object.keys(set.nodes)) {
    if (!depths.has(id)) {
      depths.set(id, 0);
      order.push(id);
    }
  }
  const rows = new Map<string, number>();
  const perDepth = new Map<number, number>();
  for (const id of order) {
    const d = depths.get(id)!;
    const r = perDepth.get(d) ?? 0;
    rows.set(id, r);
    perDepth.set(d, r + 1);
  }
  const pos = (id: string) => ({
    x: (depths.get(id) ?? 0) * GAP_X + 48,
    y: (rows.get(id) ?? 0) * GAP_Y + 48,
  });
  let maxX = 0;
  let maxY = 0;
  for (const id of order) {
    const p = pos(id);
    maxX = Math.max(maxX, p.x + CARD_W);
    maxY = Math.max(maxY, p.y + CARD_H);
  }
  return { pos, order, width: maxX + 48, height: maxY + 48 };
}

function CourseMap({
  set,
  prefix,
  currentId,
  onOpenNode,
}: {
  set: CourseSet;
  prefix: string;
  currentId: string | null;
  onOpenNode: (id: string) => void;
}) {
  const layout = useMemo(() => layoutCourse(set), [set]);
  const [tf, setTf] = useState({ x: 0, y: 0, scale: 0.9 });
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const spine = mainLine(set).spine;
  const pathEdges = new Set<string>();
  for (let i = 0; i + 1 < spine.length; i++) {
    pathEdges.add(`${spine[i]}→${spine[i + 1]}`);
  }

  return (
    <div
      className="relative h-full w-full cursor-grab overflow-hidden active:cursor-grabbing"
      onWheel={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        setTf((t) => {
          const scale = Math.min(2, Math.max(0.3, t.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
          const k = scale / t.scale;
          return { scale, x: mx - (mx - t.x) * k, y: my - (my - t.y) * k };
        });
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-map-card]")) return;
        dragRef.current = { px: e.clientX, py: e.clientY, x: tf.x, y: tf.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        setTf((t) => ({ ...t, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={layout.width}
          height={layout.height}
        >
          {layout.order.flatMap((id) =>
            (set.nodes[id]?.children ?? [])
              .filter((c) => set.nodes[c.nodeId])
              .map((c) => {
                const a = layout.pos(id);
                const b = layout.pos(c.nodeId);
                const x1 = a.x + CARD_W;
                const y1 = a.y + CARD_H / 2;
                const x2 = b.x;
                const y2 = b.y + CARD_H / 2;
                const taken = pathEdges.has(`${id}→${c.nodeId}`);
                return (
                  <path
                    key={`${id}→${c.nodeId}`}
                    d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    style={{
                      stroke: taken
                        ? "var(--color-cc-primary)"
                        : "var(--color-cc-border)",
                      strokeWidth: taken ? 2.5 : 1.5,
                    }}
                  />
                );
              }),
          )}
        </svg>
        {layout.order.map((id) => {
          const n = set.nodes[id];
          const p = layout.pos(id);
          const active = id === currentId;
          const onPath = spine.includes(id);
          return (
            <button
              key={id}
              data-map-card
              onClick={() => onOpenNode(id)}
              className={`absolute overflow-hidden rounded-xl border text-left shadow-lg transition-colors ${
                active
                  ? "border-cc-primary bg-cc-primary/5"
                  : onPath
                    ? "border-cc-primary/40 bg-cc-card hover:border-cc-primary/70"
                    : "border-cc-border bg-cc-card hover:border-cc-muted/40"
              }`}
              style={{ left: p.x, top: p.y, width: CARD_W }}
            >
              <div className="aspect-video w-full bg-black">
                {n.video ? (
                  <video
                    src={`/content/${prefix ? `${prefix}/` : ""}${n.video.file}`}
                    preload="metadata"
                    muted
                    playsInline
                    className="pointer-events-none h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[11px] text-cc-muted">
                    {STATUS_LABEL[n.status]}
                  </div>
                )}
              </div>
              <div className="px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[n.status]}`} />
                  <span className="truncate text-xs font-medium text-cc-fg">
                    {n.choiceLabel || id}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-cc-muted">
                  {n.script}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PlotwisePreview(props: ViewerPreviewProps) {
  const courseSource = props.sources.course as Source<Course> | undefined;
  const { value: course, status: courseStatus } = useSource<Course>(courseSource);
  const activeContentSet = useStore((s) => s.activeContentSet);

  const set: CourseSet | null = useMemo(() => {
    if (!course) return null;
    const keys = Object.keys(course.byContentSet);
    if (keys.length === 0) return null;
    const key =
      activeContentSet && course.byContentSet[activeContentSet]
        ? activeContentSet
        : keys[0];
    return course.byContentSet[key];
  }, [course, activeContentSet]);

  const prefix =
    activeContentSet && course?.byContentSet[activeContentSet]
      ? activeContentSet
      : Object.keys(course?.byContentSet ?? {})[0] ?? "";

  const filesSource = props.sources.files as Source<ViewerFileContent[]> | undefined;
  const { value: files } = useSource<ViewerFileContent[]>(filesSource);

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  // Scenes the learner chose before their clip existed: the stage shows
  // a loading state for them and plays the clip the moment it lands.
  const [requested, setRequested] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<"stage" | "map">("stage");
  const [replaying, setReplaying] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  // Galgame rhythm: choices fade in when the clip finishes, never before.
  // Derived SYNCHRONOUSLY (which node has earned its reveal), never reset
  // in an effect — an effect runs after paint, and the frame in between
  // is a visible flash of choices that then fade back out.
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  // A clip the browser could not play to the end: the choices come up
  // anyway, with the reason, so a broken file is never a dead end.
  const [playbackFailed, setPlaybackFailed] = useState<string | null>(null);
  // A scene change from a choice card passes through the interlude for a
  // beat even when the next clip is ready: the last frame, one line of
  // what was just said, the name of what comes next. A hard cut between
  // two takes read as abrupt (third trial); a wait with nothing to wait
  // for is still a cut with a title.
  const [transitionUntil, setTransitionUntil] = useState(0);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [questionSent, setQuestionSent] = useState(false);

  // The learner's line — root to the segment it ends on — and what
  // "continue" means right now. Derived from parent links, so a path[]
  // the director recorded short still draws whole.
  const line = useMemo(() => (set ? mainLine(set) : { tip: null, spine: [], next: [] }), [set]);

  // Until the learner picks something in this tab, the stage is where
  // the course is: the manager's current scene, else the line's tip,
  // else the root. A reload used to drop the stage back on scene 1 while
  // the rail said scene 4 (2026-09-03).
  const node: CourseNode | null =
    (set && selectedNode && set.nodes[selectedNode]) ||
    (set && set.play?.currentNode && set.nodes[set.play.currentNode]) ||
    (set && line.tip && set.nodes[line.tip]) ||
    (set && set.nodes[set.rootNode]) ||
    null;
  const onLine = (id: string) => line.spine.includes(id);
  // When the learner asked for a scene that was not ready yet, and when
  // a finished clip started waiting for its continuations — the clocks
  // the stage shows, and the lines past which a wait is stuck.
  const requestedAtRef = useRef<Map<string, number>>(new Map());
  const preparingSinceRef = useRef<Map<string, number>>(new Map());
  // The scene whose clip last played to the end — what the interlude
  // recaps while the next one is made.
  const lastPlayedRef = useRef<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The shot being spoken on stage, for the caption.
  const [captionShot, setCaptionShot] = useState(0);

  // A scene with no clip (an untaken planned branch) has nothing to
  // wait for; one in production has — its choices come after it plays.
  // During a full-path replay, choices stay down until the run ends.
  const loading = !!node && !node.video && (IN_PRODUCTION.has(node.status) || requested.has(node.id));
  const transitioning = !!node?.video && transitionUntil > now;
  // A finished clip with no continuations on file. With a manager that
  // is the end of the course; before one exists, the director is (or
  // should be) preparing them.
  const preparing = !!node && !!node.video && node.status === "ready" && node.children.length === 0 && revealedFor === node.id && !set?.play;
  if (node && node.children.length > 0) preparingSinceRef.current.delete(node.id);
  if (preparing && node && !preparingSinceRef.current.has(node.id)) preparingSinceRef.current.set(node.id, Date.now());

  // Every manager write is followed by one fresh read of the workspace:
  // a scene's evidence.json landed in the same instant as its `ready` and
  // one tab never showed it (third trial). The snapshot is a few hundred
  // kilobytes of text now, so a read per write is nothing.
  const refetchFiles = () =>
    fetch(`${getApiBase()}/api/files`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.files) && d.files.length) useStore.getState().setFiles(d.files);
      })
      .catch(() => {});
  useEffect(() => {
    if (!set?.play?.updatedAt) return;
    const t = setTimeout(refetchFiles, 1500);
    return () => clearTimeout(t);
  }, [set?.play?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // A clock while something is waited on — and every 30s a fresh read of
  // the workspace, so a lost watcher event cannot freeze the stage on a
  // state the disk has left behind.
  const anyProducing = !!set && (requested.size > 0 || Object.values(set.nodes).some((n) => IN_PRODUCTION.has(n.status)));
  // The screenplay has landed but the manager never wrote its snapshot:
  // it did not start, or died before its first write. Nothing else would
  // ever say so — the preparing screen would read "等待开拍" forever (it
  // did, for ten minutes, on 2026-09-03).
  const scripted = !!set && Object.values(set.nodes).some((n) => n.kind === "main" && n.shots.length > 0);
  const managerMissing = scripted && !set?.play;
  // Stamped from the wall clock, never from `now`: the ticker only runs
  // while something is waited on, so `now` can be minutes stale at the
  // moment the screenplay lands — a stale stamp fired a false
  // "manager not started" the instant the manager started (2026-09-03).
  const scriptedSinceRef = useRef<number | null>(null);
  if (managerMissing && scriptedSinceRef.current == null) scriptedSinceRef.current = Date.now();
  if (!managerMissing) scriptedSinceRef.current = null;
  const startMissing = managerMissing && scriptedSinceRef.current != null && now - scriptedSinceRef.current > MANAGER_SILENT_MS;
  const waiting = loading || preparing || anyProducing || managerMissing || transitioning;
  // The manager's heartbeat: a snapshot that stops moving while scenes
  // are pending means the process died. The stage says so, and the
  // director hears it once per silence so it can restart the process.
  const silence = managerSilent(set?.play, waiting, now);
  const managerDown = silence.silent || startMissing;
  const silenceToldRef = useRef<string | null>(null);
  useEffect(() => {
    if (!managerDown || !set) return;
    const key = set.play?.updatedAt ?? `unstarted:${scriptedSinceRef.current}`;
    if (silenceToldRef.current === key) return;
    silenceToldRef.current = key;
    const how = `Start it now with the skill's scripts/play-manager.mjs --set "${prefix}" --detach (exactly as SKILL.md's "Play" section says: --detach only — never nohup, never &, never in the foreground; a process backgrounded by your shell dies when the command returns), read the { pid } it prints, and tell the learner in one line. Do not produce any scene by hand and do not navigate-to anything.`;
    props.onNotifyAgent?.({
      type: "managerOffline",
      severity: "warning",
      replaces: ["managerOffline"],
      message: startMissing
        ? `The screenplay landed ${fmtElapsed(now - (scriptedSinceRef.current ?? now))} ago and the play manager has never written its snapshot (course.json has no play{}): it is not running. ${how}`
        : `The play manager has gone silent: course.json play.updatedAt has not moved for ${fmtElapsed(silence.sinceMs ?? 0)} while scenes are pending, so the process is gone. ${how}`,
      summary: startMissing ? "制片进程没有启动,请导演启动" : "制片进程没有响应,请导演重启",
    });
  }, [managerDown, set?.play?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const sync = setInterval(refetchFiles, 30_000);
    return () => {
      clearInterval(tick);
      clearInterval(sync);
    };
  }, [waiting]);
  // The end of the course is the manager's to declare and the director's
  // to close: the summary is written from the path actually taken. The
  // manager notifies no one, so the viewer says it once, until the
  // summary exists.
  const completeToldRef = useRef<string | null>(null);
  const complete = !!set && set.play?.state === "complete" && !set.summaryFile;
  useEffect(() => {
    if (!complete || !set) return;
    const key = `${prefix}:${set.path.join(",")}`;
    if (completeToldRef.current === key) return;
    completeToldRef.current = key;
    props.onNotifyAgent?.({
      type: "courseComplete",
      severity: "info",
      replaces: ["courseComplete"],
      message: `The learner has reached the end of the course "${set.title}" (play.state is complete; the path they took: ${set.path.join(" → ")}). Close it exactly as SKILL.md's "Finale" says: write <set>/summary.md — a recap of the path they ACTUALLY took (the detours they chose, the questions they asked), in the course language — then register it with \`node the skill's scripts/course-edit.mjs summary --set "${prefix}" --file summary.md\` and tell them in one line that the course map holds the whole journey. Do not navigate-to and do not shoot anything.`,
      summary: "课程走完了,请导演写总结",
    });
  }, [complete, prefix]); // eslint-disable-line react-hooks/exhaustive-deps
  const choicesRevealed =
    !!node && !replaying && !loading && (revealedFor === node.id || !node.video);

  const summaryText = useMemo(() => {
    if (!set?.summaryFile || !files) return null;
    const path = prefix ? `${prefix}/${set.summaryFile}` : set.summaryFile;
    return files.find((f) => f.path === path)?.content ?? null;
  }, [set?.summaryFile, files, prefix]);

  // Clip finished on stage: advance the replay along the taken path, or
  // reveal the choices.
  const handleClipFailed = (id: string) => {
    setPlaybackFailed(id);
    setRevealedFor(id);
  };

  const handleClipEnded = (endedId: string) => {
    if (replaying && set) {
      const i = line.spine.indexOf(endedId);
      const next = i >= 0 ? line.spine[i + 1] : undefined;
      if (next && set.nodes[next]?.video) {
        setSelectedNode(next);
        return;
      }
      setReplaying(false);
    }
    setRevealedFor(endedId);
    lastPlayedRef.current = endedId;
  };

  // The learner's input to the play manager: one small file. The manager
  // polls it and answers by re-prioritising its work; nothing on this
  // path calls a model. Both fields may ride together — a failed or
  // pruned scene is reset and then made current.
  const writeChoice = (payload: { choose?: string; retry?: string }) => {
    const path = `${prefix ? `${prefix}/` : ""}state/choice.json`;
    void props.fileChannel
      .write(path, JSON.stringify({ at: new Date().toISOString(), ...payload }, null, 2))
      .catch(() => {});
  };

  // An address may point into another course (content set). Resolve the
  // target set, switching the active one when needed; null = unknown set
  // or unknown node.
  const resolveAddress = (address: {
    node?: string;
    contentSet?: string;
  }): string | null => {
    const targetId = address.node;
    if (!targetId) return null;
    const targetPrefix = address.contentSet ?? prefix;
    const targetSet = course?.byContentSet[targetPrefix];
    if (!targetSet?.nodes[targetId]) return null;
    if (targetPrefix !== prefix) {
      useStore.getState().setActiveContentSet(targetPrefix);
    }
    return targetId;
  };

  // ── Agent-invoked actions ────────────────────────────────────────────
  useEffect(() => {
    const req = props.actionRequest;
    if (!req) return;
    const done = (result: ViewerActionResult) =>
      props.onActionResult?.(req.requestId, result);

    const address = (req.params?.address ?? {}) as {
      node?: string;
      contentSet?: string;
    };

    if (req.actionId === "navigate-to" || req.actionId === "open-references") {
      const targetId = resolveAddress(address);
      if (!targetId) {
        done({
          success: false,
          message: `No segment "${address.node}" in course "${address.contentSet ?? prefix}"`,
        });
        return;
      }
      setSelectedNode(targetId);
      setShowEvidence(req.actionId === "open-references");
      done({ success: true });
    }
  }, [props.actionRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Locator navigation (chat card clicks) ────────────────────────────
  useEffect(() => {
    const nav = props.navigateRequest;
    if (!nav) return;
    const address = (nav.address ?? {}) as { node?: string; contentSet?: string };
    const targetId = resolveAddress(address);
    if (targetId) {
      setSelectedNode(targetId);
      props.onNavigateComplete?.({ success: true });
    } else {
      props.onNavigateComplete?.({
        success: false,
        message: `No segment "${address.node}" in course "${address.contentSet ?? prefix}"`,
      });
    }
  }, [props.navigateRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the question box when the stage moves.
  useEffect(() => {
    setAsking(false);
    setQuestion("");
    setQuestionSent(false);
  }, [node?.id]);

  // Opening a scene. A choice card, or a scene opened from the rail or
  // the map that extends or changes the learner's line, is the learner
  // ADVANCING: the manager records it, prunes the roads not taken and
  // pulls the chosen road's work forward. A scene not ready yet shows
  // the interlude until its clip lands; a failed or pruned one is reset
  // first. Re-opening a scene already on the line is browsing and
  // touches nothing.
  const selectNode = (id: string, choiceLabel?: string) => {
    const n = set?.nodes[id];
    if (!n) return;
    const moves = choiceLabel !== undefined || !onLine(id) || id !== line.tip;
    const fromCard = choiceLabel !== undefined;
    if (fromCard && node && node.id !== id) {
      lastPlayedRef.current = node.id;
      if (n.video) setTransitionUntil(Date.now() + TRANSITION_MS);
    }
    if (n.status === "failed" || n.status === "cancelled") {
      setRequested((prev) => new Set(prev).add(id));
      requestedAtRef.current.set(id, Date.now());
      writeChoice({ retry: id, choose: id });
    } else if (!n.video) {
      setRequested((prev) => new Set(prev).add(id));
      if (!requestedAtRef.current.has(id)) requestedAtRef.current.set(id, Date.now());
      if (moves) writeChoice({ choose: id });
    } else if (!onLine(id)) {
      writeChoice({ choose: id });
    }
    setSelectedNode(id);
    // A choice card is navigation, not a selection: the chat's context
    // chip is for a scene the learner pointed at on the rail or the map.
    if (!fromCard) {
      props.onSelect({
        type: "segment",
        content: n.script.slice(0, 200) || id,
        address: { node: id },
        label: n.choiceLabel || id,
        file: `${prefix ? `${prefix}/` : ""}nodes/${id}/script.md`,
      });
    }
  };

  // A question is the one thing during play that needs the director:
  // the answer has to be grounded before the manager can shoot it.
  const submitQuestion = () => {
    const q = question.trim();
    if (!q || !node) return;
    props.onNotifyAgent?.({
      type: "userQuestion",
      severity: "warning",
      message: `About scene "${node.id}" (${node.choiceLabel || "untitled"}), the learner asks: "${q}". This came from the stage's question box — do NOT ask them to repeat it. Answer it as a question scene, as SKILL.md's "A learner's question" says: verify the answer now (this is preparation — the learner expects this wait), put any figure it needs under evidence/<sceneId>/, then hand it to the play manager by writing state/requests/<slug>.json with { parent: "${node.id}", label, brief } — the manager writes the shots, shoots the scene and links it under "${node.id}"; the card appears when it is ready. Do not shoot anything yourself and do not navigate-to.`,
      summary: `提问:${q.slice(0, 40)}${q.length > 40 ? "…" : ""}`,
    });
    setQuestion("");
    setAsking(false);
    setQuestionSent(true);
  };

  // A wait that has gone stale or a production that failed: the learner
  // asks again, explicitly. The manager resets the scene and re-queues it.
  const retryScene = (id: string) => {
    setRequested((prev) => new Set(prev).add(id));
    requestedAtRef.current.set(id, Date.now());
    writeChoice({ retry: id, choose: id });
  };

  // A scene the learner waited for has landed: it leaves the requested
  // set whether or not it is the one on stage now. A scene they retried
  // and then walked away from otherwise stayed "requested" for the rest
  // of the session, and the stage kept counting it as production.
  useEffect(() => {
    if (!set || requested.size === 0) return;
    const landed = [...requested].filter((id) => !!set.nodes[id]?.video);
    if (landed.length === 0) return;
    setRequested((prev) => {
      const next = new Set(prev);
      for (const id of landed) next.delete(id);
      return next;
    });
  }, [set, requested]);

  // The caption follows the shot being spoken.
  useEffect(() => {
    setCaptionShot(0);
    setPlaybackFailed(null);
  }, [node?.id, node?.video?.file]);

  // ── The style step ───────────────────────────────────────────────────
  // Every move on the board becomes one instruction to the director. The
  // board keeps the learner; the director keeps the scripts.
  const notifyStyleEvent = (e: StyleBoardEvent) => {
    const setRef = prefix
      ? `--set ${prefix}`
      : "--set <the course directory — create it first with course-edit.mjs init --set <slug> --title ... --topic ...>";
    const sampler = `the skill's scripts/make-style-sample.mjs ${setRef}`;
    const hook = `--hook "<ONE spoken line that opens THIS topic, in the course language>" --action "<what those 5 seconds SHOW: the hook made visible in this style's own materials — motion and objects, never on-screen text, formulas or labeled figures>"`;
    const replaces = ["styleCandidate", "styleRecommendRequested", "styleCustomRequested", "styleAdjust"];
    const notify = (type: string, message: string, summary: string) =>
      props.onNotifyAgent?.({ type, severity: "warning", replaces, message, summary });
    switch (e.type) {
      case "candidate":
        notify(
          "styleCandidate",
          `On the style board the user picked "${e.id}" (${e.name}) and asked for a sample. Run \`node ${sampler} --style-id ${e.id} ${hook}\` now. If there is no course.json yet, run course-edit.mjs init first; if you do not know the topic yet, ask for it in one line before sampling. Say nothing else — the board shows the sample for confirmation. Never navigate-to anything during the style step.`,
          `拍样片:${e.name}`,
        );
        break;
      case "recommend":
        notify(
          "styleRecommendRequested",
          `The user asked you to recommend a visual style. Pick ONE catalog preset from references/styles.md that fits the topic and run \`node ${sampler} --style-id <id> --rationale "<one sentence, in the user's language, why this style fits the topic>" ${hook}\`. One candidate, sampled — no audition, no list of alternatives. If the topic is unknown, ask for it in one line first.`,
          "请导演推荐风格",
        );
        break;
      case "custom":
        notify(
          "styleCustomRequested",
          `The user described the style they want: "${e.description}". Turn it into a recipe (concrete visual detail, in the prompt-fragment form of references/styles.md), give it a short name, then run \`node ${sampler} --style-id custom --name "<name>" --recipe "<recipe>" --rationale "<how you read their wish, in their language>" ${hook}\`. If they attached reference images in chat, copy them under <set>/style/refs/ and pass each as --ref-image.`,
          "自定义风格,拍样片",
        );
        break;
      case "adjust":
        notify(
          "styleAdjust",
          `The user wants the style sample adjusted: "${e.feedback}". Revise the recipe (keep the same --style-id; pass the revised text as --recipe so it becomes the course's recipe) and/or the hook line accordingly, then re-run \`node ${sampler} ...\`. One revision per request; do not ask clarifying questions unless the feedback is unusable.`,
          "调整样片",
        );
        break;
      case "confirm":
        props.onNotifyAgent?.({
          type: "styleConfirmed",
          severity: "warning",
          replaces: [...replaces, "styleConfirmed"],
          message: `The user confirmed the visual style "${e.id}" (${e.name}) with its sample. Run \`node the skill's scripts/course-edit.mjs confirm-style ${setRef}\`, then start the course exactly as SKILL.md's "Root" says: plan-course if the outline is not written yet, wait for the outline to land, write the screenplay (write-screenplay.mjs), and start the play manager detached (play-manager.mjs) — it shoots the opening and everything after. From here on the style is settled — never re-open it unless the user asks.`,
          summary: `风格已确认:${e.name}`,
        });
        break;
    }
  };

  if (!set || set.style.status !== "confirmed") {
    return (
      <StyleBoard
        topic={set?.title || set?.topic || undefined}
        style={set?.style ?? null}
        prefix={prefix}
        onEvent={notifyStyleEvent}
      />
    );
  }

  // ── Style settled, nothing shot yet: the director is preparing ──────
  if (!Object.values(set.nodes).some((n) => n.video)) {
    return <PreparingScreen set={set} prefix={prefix} now={now} managerDown={managerDown} onRetry={() => retryScene(set.rootNode)} />;
  }

  // "下一步" follows the scene on stage: the line's tip while the learner
  // is there, an earlier scene's own choices when they have stepped back.
  const next = node && onLine(node.id) ? node.children : line.next;
  const nextIds = next.map((c) => c.nodeId);
  const spineMain = line.spine.filter((id) => set.nodes[id]?.kind === "main").length;
  // Detours the learner took (on path[] but not on the spine), and the
  // scene on stage when it is neither on the line nor one of its next
  // steps (a branch opened from the map): the rail keeps them under
  // their own heading, so a road taken does not vanish on the way back.
  const asides = [
    ...set.path.filter((id) => set.nodes[id] && !onLine(id) && !nextIds.includes(id)),
    ...(node && !onLine(node.id) && !nextIds.includes(node.id) && !set.path.includes(node.id) ? [node.id] : []),
  ];

  const railStep = (id: string, n: number) => {
    const seg = set.nodes[id];
    const active = node?.id === id;
    return (
      <li key={id} className="relative">
        <span
          className={`absolute -left-[9px] top-2 flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-medium tabular-nums ${
            active
              ? "border-cc-primary bg-cc-primary text-white"
              : "border-cc-border bg-cc-bg text-cc-muted"
          }`}
        >
          {n}
        </span>
        <button
          onClick={() => selectNode(id)}
          className={`ml-3 flex w-[calc(100%-0.75rem)] items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
            active ? "bg-cc-primary/10 text-cc-primary" : "text-cc-fg/80 hover:bg-cc-hover hover:text-cc-fg"
          }`}
        >
          <span className="truncate">{seg?.choiceLabel || id}</span>
        </button>
      </li>
    );
  };

  const railChoice = (c: ChoiceRef, chosen: boolean) => {
    const seg = set.nodes[c.nodeId];
    const status = seg?.status ?? "planned";
    const active = node?.id === c.nodeId;
    const hint = status === "planned" ? "待拍" : sceneHint(seg);
    return (
      <button
        key={c.nodeId}
        onClick={() => selectNode(c.nodeId, chosen ? c.label : undefined)}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          active ? "bg-cc-primary/10 text-cc-primary" : "text-cc-fg/80 hover:bg-cc-hover hover:text-cc-fg"
        }`}
      >
        {IN_PRODUCTION.has(status) ? (
          <Spinner className="h-3 w-3 shrink-0 text-cc-primary" />
        ) : (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
        )}
        <span className="truncate">{c.label || seg?.choiceLabel || c.nodeId}</span>
        {hint && <span className="ml-auto shrink-0 text-[11px] text-cc-muted">{hint}</span>}
      </button>
    );
  };

  return (
    <div className="relative flex h-full w-full bg-cc-bg text-cc-fg">
      {/* A course file the viewer could not read is shown, not swallowed:
          the stage would otherwise sit on the last good state with no
          hint that the disk has moved on. */}
      {/* The rail is the learner's main line: the segments they took,
          root to the one their line ends on, then what "continue" means
          right now. The rest of the tree lives on the course map. */}
      <div className="flex w-64 shrink-0 flex-col border-r border-cc-border">
        <div className="border-b border-cc-border px-4 py-3">
          <div className="truncate text-sm font-semibold">{set.title}</div>
          <div className="mt-0.5 truncate text-xs text-cc-muted">
            主线 {spineMain}/{set.outline.length} 场 · 支线 {asides.length} 场 · 已拍 {Object.values(set.nodes).filter((n) => n.status === "ready").length}/{Object.keys(set.nodes).length}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <ol className="relative ml-2 border-l border-cc-border">
            {line.spine.map((id, i) => railStep(id, i + 1))}
          </ol>
          {next.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 px-2 text-[11px] font-medium tracking-wide text-cc-muted">下一步</div>
              {next.map((c) => railChoice(c, true))}
            </div>
          )}
          {asides.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 px-2 text-[11px] font-medium tracking-wide text-cc-muted">走过的支线</div>
              {asides.map((id) => railChoice({ nodeId: id, label: set.nodes[id].choiceLabel ?? id }, false))}
            </div>
          )}
        </div>
      </div>

      {/* Stage */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* A course file the viewer could not read is shown, not swallowed:
            the stage would otherwise sit on the last good state with no
            hint that the disk has moved on. */}
        {courseStatus.lastError && (
          <div className="flex items-center justify-center gap-2 border-b border-cc-error/40 bg-cc-error/10 px-4 py-1.5 text-xs text-cc-fg/90">
            <span>课程文件读取出错,画面可能不是最新的:</span>
            <span className="max-w-xl truncate text-cc-muted">{courseStatus.lastError.message}</span>
          </div>
        )}
        {/* The manager's heartbeat stopped while scenes are pending: the
            learner sees it, and the director has been asked to restart it. */}
        {managerDown && !courseStatus.lastError && (
          <div
            data-plotwise-manager-silent
            className="flex items-center justify-center gap-2 border-b border-cc-error/40 bg-cc-error/10 px-4 py-1.5 text-xs text-cc-fg/90"
          >
            <span>
              {startMissing
                ? "制片进程没有启动。已请导演启动,启动后从剧本开始拍。"
                : `制片进程没有响应,已静默 ${fmtElapsed(silence.sinceMs ?? 0)}。已请导演重启,重启后会从停下的地方继续。`}
            </span>
          </div>
        )}
        {node ? (
          <>
            <div className="flex items-center justify-between border-b border-cc-border px-4 py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium">
                  {view === "map" ? "课程地图" : node.choiceLabel || node.id}
                </span>
                <span className="ml-2 text-xs text-cc-muted">
                  {view === "map"
                    ? `主线 ${spineMain}/${set.outline.length} 场`
                    : `${STATUS_LABEL[node.status]} · ${KIND_LABEL[node.kind]}${node.shots.length > 1 ? ` · ${node.shots.length} 镜` : ""}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {view === "map" && line.spine.length > 0 && (
                  <button
                    onClick={() => {
                      const first = line.spine.find((id) => set.nodes[id]?.video);
                      if (!first) return;
                      setView("stage");
                      setReplaying(true);
                      setSelectedNode(first);
                    }}
                    className="rounded-md border border-cc-primary/50 bg-cc-primary/10 px-2.5 py-1 text-xs text-cc-primary transition-colors hover:bg-cc-primary/20"
                  >
                    重播全程
                  </button>
                )}
                {summaryText && (
                  <button
                    onClick={() => setShowSummary((v) => !v)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      showSummary
                        ? "border-cc-primary/50 bg-cc-primary/10 text-cc-primary"
                        : "border-cc-border text-cc-muted hover:text-cc-fg"
                    }`}
                  >
                    课程总结
                  </button>
                )}
                <button
                  onClick={() => setView((v) => (v === "map" ? "stage" : "map"))}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    view === "map"
                      ? "border-cc-primary/50 bg-cc-primary/10 text-cc-primary"
                      : "border-cc-border text-cc-muted hover:text-cc-fg"
                  }`}
                >
                  {view === "map" ? "返回课程" : "课程地图"}
                </button>
                <button
                  onClick={() => setShowEvidence((v) => !v)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    showEvidence
                      ? "border-cc-primary/50 bg-cc-primary/10 text-cc-primary"
                      : "border-cc-border text-cc-muted hover:text-cc-fg"
                  }`}
                >
                  Evidence ({node.evidence.length})
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              {view === "map" ? (
                <CourseMap
                  set={set}
                  prefix={prefix}
                  currentId={node.id}
                  onOpenNode={(id) => {
                    setView("stage");
                    selectNode(id);
                  }}
                />
              ) : (
              // Stage layout contract: video + script + choices form ONE
              // unit, centered together, script and choices hugging the
              // picture's bottom edge. The footer keeps a fixed reserved
              // height (and the no-video placeholder keeps the same
              // aspect box), so the unit's height — and the picture's
              // position — never changes, choices or not.
              <div className="flex min-w-0 flex-1 items-center justify-center p-6">
                <div
                  className="flex w-full max-w-5xl flex-col items-center"
                  style={{
                    width: "min(100%, calc((100dvh - 300px) * 16 / 9))",
                  }}
                >
                  {transitioning ? (
                    <Interlude
                      set={set}
                      prefix={prefix}
                      prev={(lastPlayedRef.current && set.nodes[lastPlayedRef.current]) || (node.parent ? set.nodes[node.parent] ?? null : null)}
                      next={node}
                      state={{ kind: "idle" }}
                      now={now}
                      onRetry={() => retryScene(node.id)}
                    />
                  ) : node.video ? (
                    <VideoStage
                      key={prefix}
                      src={`/content/${prefix ? `${prefix}/` : ""}${node.video.file}`}
                      preloadSrcs={node.children
                        .map((c) => set.nodes[c.nodeId])
                        .filter((n): n is CourseNode => !!n?.video)
                        .map(
                          (n) =>
                            `/content/${prefix ? `${prefix}/` : ""}${n.video!.file}`,
                        )}
                      onEnded={() => handleClipEnded(node.id)}
                      onFailed={() => handleClipFailed(node.id)}
                      onTime={(t) => {
                        const idx = shotAt(node.shots, t);
                        if (idx !== captionShot) setCaptionShot(idx);
                      }}
                    />
                  ) : loading || node.status === "failed" || node.status === "cancelled" ? (
                    <Interlude
                      set={set}
                      prefix={prefix}
                      prev={(lastPlayedRef.current && set.nodes[lastPlayedRef.current]) || (node.parent ? set.nodes[node.parent] ?? null : null)}
                      next={node}
                      state={productionState(node, requested.has(node.id) ? (requestedAtRef.current.get(node.id) ?? now) : null, now)}
                      now={now}
                      onRetry={() => retryScene(node.id)}
                    />
                  ) : (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-cc-border text-sm text-cc-muted">
                      这条支线没有走过,还没有拍摄
                    </div>
                  )}
                  <div className="flex h-24 w-full shrink-0 flex-col items-center gap-2.5 pt-2">
                    {playbackFailed === node.id ? (
                      <div className="flex items-center gap-3 text-sm text-cc-fg/80" data-plotwise-playback-failed>
                        <span>这一段的视频播放出错了。可以直接选下一步,或者</span>
                        <button onClick={() => { setPlaybackFailed(null); retryScene(node.id); }} className="text-cc-primary hover:underline">
                          再拍一次
                        </button>
                      </div>
                    ) : (
                      <div className="line-clamp-2 max-w-xl text-center text-sm leading-relaxed text-cc-muted" data-plotwise-caption>
                        {node.shots[captionShot]?.script || node.script}
                      </div>
                    )}
                    {asking ? (
                      <div className="flex w-full max-w-xl items-center gap-2">
                        <input
                          autoFocus
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitQuestion();
                            if (e.key === "Escape") {
                              setAsking(false);
                              setQuestion("");
                            }
                          }}
                          placeholder="关于这一段,你想问什么?(回车发送,Esc 取消)"
                          className="min-w-0 flex-1 appearance-none rounded-full border border-cc-primary/50 bg-cc-input-bg px-4 py-1.5 text-sm text-cc-fg placeholder:text-cc-muted/70 focus-visible:ring-2 focus-visible:ring-cc-primary/40"
                        />
                        <button
                          onClick={submitQuestion}
                          disabled={!question.trim()}
                          className="shrink-0 rounded-full bg-cc-primary px-4 py-1.5 text-sm text-white transition-opacity disabled:opacity-40"
                        >
                          发送
                        </button>
                      </div>
                    ) : (
                      <div
                        key={node.id}
                        className={`flex flex-wrap items-center justify-center gap-2 transition-all duration-700 ease-out ${
                          choicesRevealed
                            ? "translate-y-0 opacity-100"
                            : "pointer-events-none translate-y-2 opacity-0"
                        }`}
                      >
                        {node.children.length === 0 && node.status === "ready" && (set.play ? (() => {
                          // A detour without a link back returns to the spine
                          // by its parent's main continuation; the last main
                          // scene is the end of the course.
                          const back = node.kind !== "main" && node.parent
                            ? set.nodes[node.parent]?.children.map((c) => set.nodes[c.nodeId]).find((n) => n?.kind === "main")
                            : undefined;
                          return back ? (
                            <button
                              onClick={() => selectNode(back.id, "回到主线")}
                              tabIndex={choicesRevealed ? 0 : -1}
                              className="flex items-center gap-2 rounded-full border border-cc-border bg-cc-surface/70 px-4 py-1.5 text-sm text-cc-fg/90 backdrop-blur transition-colors hover:border-cc-primary/50 hover:text-cc-primary"
                            >
                              回到主线：{back.choiceLabel || back.id}
                            </button>
                          ) : (
                            <span className="flex items-center gap-3 rounded-full border border-cc-border bg-cc-surface/70 px-4 py-1.5 text-sm text-cc-muted backdrop-blur" data-plotwise-course-end>
                              课程到这里讲完了
                              <button onClick={() => setView("map")} className="text-cc-primary hover:underline">看看课程地图</button>
                            </span>
                          );
                        })() : (() => {
                          // A course from before the manager: the director prepares by hand.
                          const ws = waitState(preparingSinceRef.current.get(node.id) ?? now, now);
                          return (
                            <span className="flex items-center gap-2 rounded-full border border-cc-border bg-cc-surface/70 px-4 py-1.5 text-sm text-cc-muted backdrop-blur">
                              <Spinner className="h-3.5 w-3.5 text-cc-primary" />
                              导演正在准备下一步
                              <span className="tabular-nums text-cc-muted/70">{fmtElapsed(ws.elapsedMs)}</span>
                            </span>
                          );
                        })())}
                        {node.children.map((c) => {
                          const child = set.nodes[c.nodeId];
                          const cs = child?.status;
                          const hint = sceneHint(child);
                          const busy = !!child && IN_PRODUCTION.has(child.status);
                          return (
                            <button
                              key={c.nodeId}
                              onClick={() => selectNode(c.nodeId, c.label)}
                              tabIndex={choicesRevealed ? 0 : -1}
                              className={`flex items-center gap-2 rounded-full border bg-cc-surface/70 px-4 py-1.5 text-sm text-cc-fg/90 backdrop-blur transition-colors hover:border-cc-primary/50 hover:text-cc-primary ${
                                cs === "ready" ? "border-cc-border" : cs === "failed" ? "border-dashed border-cc-error/50" : "border-dashed border-cc-border"
                              }`}
                            >
                              {busy && <Spinner className="h-3 w-3 text-cc-primary" />}
                              {c.label || c.nodeId}
                              {hint && <span className="text-[11px] text-cc-muted">{hint}</span>}
                            </button>
                          );
                        })}
                        {questionSent ? (
                          <span className="px-2 text-xs text-cc-muted">
                            问题已发给导演,支线拍好会出现在选项里
                          </span>
                        ) : (
                          <button
                            onClick={() => setAsking(true)}
                            tabIndex={choicesRevealed ? 0 : -1}
                            className="rounded-full border border-dashed border-cc-border px-4 py-1.5 text-sm text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-primary"
                          >
                            我有问题
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}

              {showSummary && summaryText && (
                <div className="w-80 shrink-0 overflow-y-auto border-l border-cc-border p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-cc-muted">
                    课程总结
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-cc-fg/90">
                    {summaryText.replace(/^#+\s*/gm, "")}
                  </div>
                </div>
              )}

              {showEvidence && (
                <div className="w-72 shrink-0 overflow-y-auto border-l border-cc-border p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-cc-muted">
                    Evidence
                  </div>
                  {node.evidence.length === 0 ? (
                    <div className="text-sm text-cc-muted/70">
                      No evidence bound to this segment.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {node.evidence.map((ev, i) => (
                        <div
                          key={i}
                          className="rounded-md border border-cc-border bg-cc-card p-3"
                        >
                          <div className="text-[11px] uppercase tracking-wide text-cc-primary/80">
                            {ev.kind}
                          </div>
                          <div className="mt-1 text-sm text-cc-fg/90">
                            {ev.note}
                          </div>
                          {ev.file && (
                            <div className="mt-1 truncate text-xs text-cc-muted">
                              {ev.file}
                            </div>
                          )}
                          {ev.url && (
                            <a
                              href={ev.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block truncate text-xs text-cc-primary/80 hover:text-cc-primary"
                            >
                              {ev.url}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-cc-muted">
            Select a segment
          </div>
        )}
      </div>
    </div>
  );
}
