/**
 * Anime series viewer — wall · desk · rail.
 *
 * The cast wall (left) holds the bible; the episode desk (right) holds one
 * episode — screen, shot strip, shot detail; the season rail (top) holds
 * every episode. Binge mode hides the wall and the details and plays the
 * finished episodes back to back.
 *
 * Conventions worth knowing before changing anything:
 *
 * 1. ONE POSITION. A click, `navigate-to`, a locator card and
 *    `get-view-state` all go through `Position` (view-model.ts), and
 *    `positionAddress` turns it into the address on every selection — what
 *    the agent reads is what the user sees. `posRef` is written
 *    synchronously so an action can report where the viewer now is inside
 *    the same handler.
 *
 * 2. ONE CLOCK, the episode clock. A clip's own time maps onto it through
 *    its offset (a part's take starts at the part's offset); with no clip the
 *    clock still runs, as an animatic over the panels or the shot slates.
 *
 * 3. THE VIEWER WRITES DECISIONS, NOT MACHINE STATE. Edited text, a picked
 *    sheet or take, a lock, dragged seconds, an accepted drift and an
 *    acknowledged bible go straight into bible.json / episode.json through
 *    the `series` source. Anything that generates, checks or prices is a
 *    command to the agent; project.json is never written here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Source } from "../../../core/types/source.js";
import type { ViewerActionResult, ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import { getApiBase } from "../../../src/utils/api.js";

import type { EntityCard, EntityKind, EpisodeView, PartView, Series } from "../domain.js";
import {
  acceptDrift,
  cellVerdict,
  acknowledgeBible,
  dragShotBorder,
  findCard,
  findEpisode,
  inFlight,
  lockBible,
  partAt,
  pickSheet,
  pickStoryboard,
  pickTake,
  setEntityField,
  setShotText,
  setStyleField,
  shotAt,
  shotSpan,
} from "../domain.js";
import { CandidatesDrawer, CastWall, type WallHandlers } from "./CastWall.js";
import { EpisodeDesk, type DeskCommand, type ScreenMedia } from "./EpisodeDesk.js";
import { mediaUrl } from "./media.js";
import { GridOverlay, PromptsOverlay } from "./Overlays.js";
import { SeasonRail } from "./SeasonRail.js";
import { BingeView, SeasonOverview } from "./SeasonViews.js";
import { seriesStrings, type SeriesStrings } from "./strings.js";
import { Btn, ViewerKeyframes } from "./ui.js";
import {
  START,
  currentPart,
  effectiveLane,
  fmtSec,
  positionAddress,
  resolveAddress,
  type Focus,
  type Lane,
  type Position,
} from "./view-model.js";

const SELECTION_SETTLE_MS = 300;
/** How long the `play` action waits for the clip to start before answering with what it sees. */
const PLAY_START_TIMEOUT_MS = 5000;

/** How a start of playback ended: the clip is running, or why it is not. */
type PlayStart = { started: true } | { started: false; reason: string };

type Layout = "wide" | "mid" | "narrow";

/**
 * The wall stays a column — "always in view while a shot is judged" — down to
 * a viewer of 820 px, which covers the usual panel beside the chat; below
 * that it stacks above the desk. The desk then lays itself out by its OWN
 * width, not the window's.
 */
function wallWidthFor(width: number): number {
  if (width >= 1100) return 236;
  if (width >= 820) return 208;
  return 0;
}

function deskLayoutFor(deskWidth: number): Layout {
  if (deskWidth >= 900) return "wide";
  if (deskWidth >= 600) return "mid";
  return "narrow";
}

function ratioOf(text: string): number {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(text);
  return m ? Number(m[1]) / Number(m[2]) : 16 / 9;
}

/** The clip on screen: an explicit take or patch, else the final, else the part's take. */
function screenMedia(
  episode: EpisodeView | null,
  part: PartView | null,
  position: Position,
  base: string,
  t: SeriesStrings,
): ScreenMedia | null {
  const takeName = (p: PartView, asset: string) => t.takeLabel(p.takes.findIndex((x) => x.record.asset === asset) + 1);
  if (!episode || !part) return null;
  if (position.take) {
    for (const p of episode.parts) {
      const take = p.takes.find((x) => x.record.asset === position.take);
      if (take) {
        const url = mediaUrl(base, take.view);
        if (url) return { url, offset: p.offset, asset: take.record.asset, label: `${takeName(p, take.record.asset)} · ${take.record.resolution ?? ""} · ${fmtSec(take.view.duration ?? p.seconds)}s` };
      }
      const patch = p.patches.find((x) => x.record.asset === position.take);
      if (patch) {
        const url = mediaUrl(base, patch.view);
        const start = p.timeline[(patch.record.covered?.[0] ?? patch.record.shots[0]) - 1]?.start ?? 0;
        if (url) return { url, offset: p.offset + start, asset: patch.record.asset, label: `${t.patchLabel(patch.record.shots[0], patch.record.shots[1])} · ${fmtSec(patch.view.duration ?? patch.record.seconds)}s` };
      }
    }
  }
  if (episode.final) {
    const url = mediaUrl(base, episode.final.view);
    if (url) return { url, offset: 0, asset: episode.final.record.asset, label: `${t.finalCut} · ${fmtSec(episode.final.view.duration ?? episode.duration)}s` };
  }
  if (part.take) {
    const url = mediaUrl(base, part.take.view);
    if (url) {
      return {
        url,
        offset: part.offset,
        asset: part.take.record.asset,
        label: `${takeName(part, part.take.record.asset)} · ${part.take.record.resolution ?? ""} · ${fmtSec(part.take.view.duration ?? part.seconds)}s`,
      };
    }
  }
  return null;
}

function Centered({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-[50vh] place-items-center p-8 text-center">
      <div className="max-w-md">
        <h1 className="m-0 text-[15px] font-semibold text-cc-fg">{title}</h1>
        {body ? <p className="m-0 mt-2 text-[12.5px] leading-[1.7] text-cc-muted">{body}</p> : null}
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </div>
  );
}

export default function AnimeSeriesPreview(props: ViewerPreviewProps) {
  const { value: series, write } = useSource(props.sources.series as Source<Series> | undefined);
  const staticPlayer = useStore((s) => s.staticPlayer);
  const t: SeriesStrings = useMemo(() => seriesStrings(props.locale), [props.locale]);
  const base = useMemo(() => getApiBase(), []);

  const canWrite = props.editing !== false && !props.readonly && !staticPlayer;
  const canCommand = canWrite && !!props.onNotifyAgent;
  const params = props.initParams ?? {};
  const keysKnown = "imagesEnabled" in params || "videoEnabled" in params;
  const imagesOk = !keysKnown || params.imagesEnabled === "true";
  const videoOk = !keysKnown || params.videoEnabled === "true";

  // ── Size ─────────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  const deskRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const wallWidth = wallWidthFor(width);
  const layout = deskLayoutFor(width - wallWidth);
  const wallLayout: Layout = wallWidth > 0 ? "wide" : width >= 560 ? "mid" : "narrow";

  // ── Position ─────────────────────────────────────────────────────────────
  const [position, setPosition] = useState<Position>(START);
  const posRef = useRef<Position>(START);
  const [time, setTime] = useState(0);
  const apply = useCallback((next: Position) => {
    posRef.current = next;
    setPosition(next);
    setTime(next.time);
  }, []);

  const seriesRef = useRef<Series | null>(series);
  seriesRef.current = series;

  // Adopt the first episode, and never point at one the agent removed.
  useEffect(() => {
    if (!series) return;
    const here = posRef.current;
    if (here.episode && findEpisode(series, here.episode)) return;
    const first = series.episodes[0] ?? null;
    apply({ ...here, episode: first?.id ?? null, part: first?.parts[0]?.id ?? null, shot: first?.parts[0]?.shots.length ? 1 : null, time: 0, range: null, take: null, check: null });
  }, [series, apply]);

  const episode = series ? findEpisode(series, position.episode) : null;
  const part = currentPart(episode, position);
  const lane = effectiveLane(part, position);
  const media = useMemo(() => screenMedia(episode, part, position, base, t), [episode, part, position, base, t]);

  // ── Clock ────────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRef = useRef<ScreenMedia | null>(media);
  mediaRef.current = media;
  const laneRef = useRef<Lane>(lane);
  laneRef.current = lane;
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const stopAtRef = useRef<number | null>(null);

  const syncVideo = useCallback((seconds: number) => {
    const v = videoRef.current;
    const m = mediaRef.current;
    if (!v || !m || laneRef.current !== "clip") return;
    const local = Math.max(0, seconds - m.offset);
    if (Number.isFinite(local) && Math.abs(v.currentTime - local) > 0.05) v.currentTime = local;
  }, []);

  /** Follow the playhead with the shot (and the part) it is over. */
  const follow = useCallback(
    (seconds: number) => {
      const s = seriesRef.current;
      const here = posRef.current;
      const ep = s ? findEpisode(s, here.episode) : null;
      const p = ep ? partAt(ep, seconds) : null;
      const n = p ? shotAt(p, seconds) : null;
      if (p && (p.id !== here.part || n !== here.shot)) {
        const next = { ...here, part: p.id, shot: n, time: seconds, check: null };
        posRef.current = next;
        setPosition(next);
      } else {
        posRef.current = { ...here, time: seconds };
      }
      setTime(seconds);
    },
    [],
  );

  // Each start of playback gets a number; a late answer from an earlier
  // `play()` (a refusal, an interruption) must not stop a newer one.
  const playSeqRef = useRef(0);

  const pause = useCallback(() => {
    playSeqRef.current += 1;
    videoRef.current?.pause();
    playingRef.current = false;
    stopAtRef.current = null;
    setPlaying(false);
  }, []);

  const seek = useCallback(
    (seconds: number) => {
      const ep = seriesRef.current ? findEpisode(seriesRef.current, posRef.current.episode) : null;
      const clamped = Math.max(0, Math.min(seconds, ep?.duration ?? seconds));
      follow(clamped);
      syncVideo(clamped);
    },
    [follow, syncVideo],
  );

  /**
   * Start the clock. Settles when the clip has really started — the
   * element's `play()` promise — or with the browser's reason when it
   * refused (autoplay without a gesture, an undecodable clip), in which case
   * the clock is stopped again rather than left "playing" over a frozen
   * frame. With no clip on screen the clock runs as an animatic at once.
   */
  const play = useCallback(
    (from?: number, to?: number): Promise<PlayStart> => {
      const ep = seriesRef.current ? findEpisode(seriesRef.current, posRef.current.episode) : null;
      if (!ep) return Promise.resolve({ started: false, reason: "no episode is open" });
      let start = from ?? posRef.current.time;
      if (start >= ep.duration - 0.05) start = 0;
      seek(start);
      const seq = ++playSeqRef.current;
      stopAtRef.current = to ?? null;
      playingRef.current = true;
      setPlaying(true);
      const v = videoRef.current;
      if (!v || !mediaRef.current || laneRef.current !== "clip") return Promise.resolve({ started: true });
      return v.play().then(
        (): PlayStart => ({ started: true }),
        (error: unknown): PlayStart => {
          if (playSeqRef.current === seq) pause();
          const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          return { started: false, reason };
        },
      );
    },
    [seek, pause],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (ts: number) => {
      if (!playingRef.current) return;
      const ep = seriesRef.current ? findEpisode(seriesRef.current, posRef.current.episode) : null;
      const end = Math.min(stopAtRef.current ?? Infinity, ep?.duration ?? 0);
      const v = videoRef.current;
      const m = mediaRef.current;
      let seconds: number;
      if (v && m && laneRef.current === "clip") seconds = m.offset + v.currentTime;
      else seconds = posRef.current.time + (ts - last) / 1000;
      last = ts;
      if (seconds >= end - 1e-3) {
        follow(Math.max(0, end));
        pause();
        return;
      }
      follow(seconds);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, follow, pause]);

  // A newly mounted clip starts where the clock is.
  useEffect(() => {
    if (!media) return;
    const v = videoRef.current;
    if (!v) return;
    const onReady = () => syncVideo(posRef.current.time);
    v.addEventListener("loadedmetadata", onReady);
    return () => v.removeEventListener("loadedmetadata", onReady);
  }, [media, syncVideo]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) pause();
    else void play();
  }, [pause, play]);

  // ── In-flight timer (submitted Ns ago) ───────────────────────────────────
  const [now, setNow] = useState(() => Date.now());
  const busy = series ? inFlight(series).length > 0 : false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // ── Overlays & notices ───────────────────────────────────────────────────
  const [overlay, setOverlay] = useState<"grid" | "prompts" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ── Writes (decisions only) ──────────────────────────────────────────────
  const commit = useCallback(
    (edit: (s: Series) => Series): string | null => {
      const current = seriesRef.current;
      if (!current || !canWrite) return null;
      let next: Series;
      try {
        next = edit(current);
      } catch (error) {
        const message = (error as Error).message;
        setNotice(message);
        return message;
      }
      write(next).catch((error: unknown) => setNotice((error as Error).message));
      return null;
    },
    [canWrite, write],
  );

  // ── Selection reported to the agent ──────────────────────────────────────
  const { onSelect } = props;
  useEffect(() => {
    if (playing || !series) return;
    const timer = setTimeout(() => {
      const here = posRef.current;
      const address = positionAddress(series, here);
      if (here.level === "overview") {
        onSelect({ type: "season", content: series.title, label: t.seasonOverview, address });
        return;
      }
      if (here.pointer === "wall" && here.focus) {
        if (here.focus.kind === "style") {
          onSelect({ type: "card", content: series.style.style.slice(0, 160), label: t.styleTitle, address });
          return;
        }
        const card = findCard(series, here.focus.kind, here.focus.id);
        if (!card) return;
        const look = (card.entity as { look?: string }).look ?? "";
        onSelect({ type: "card", content: `${card.name}: ${look.slice(0, 160)}`, label: `${card.kind} · ${card.name}`, address });
        return;
      }
      const ep = findEpisode(series, here.episode);
      if (!ep) {
        onSelect(null);
        return;
      }
      const p = currentPart(ep, here);
      const shot = here.shot !== null && p ? p.shots[here.shot - 1] : null;
      if (shot && here.shot !== null) {
        onSelect({
          type: "shot",
          content: String(shot.desc ?? "").slice(0, 200),
          label: `${ep.id} · ${t.shotTitle(here.shot)}`,
          address,
        });
        return;
      }
      onSelect({ type: "episode", content: ep.title, label: `${ep.id} 《${ep.title}》`, address });
    }, SELECTION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [position, playing, series, onSelect, t]);

  // ── View state + address handling (actions, locators) ────────────────────
  const viewState = useCallback((): Record<string, unknown> => {
    const s = seriesRef.current;
    const here = posRef.current;
    const ep = s ? findEpisode(s, here.episode) : null;
    const p = currentPart(ep, here);
    const drift = p ? p.checks.filter((c) => cellVerdict(c) === "drift" && !c.accepted).map((c) => ({ shot: c.shot, character: c.character, note: c.note })) : [];
    const unverified = p ? [...new Set(p.checks.filter((c) => cellVerdict(c) === "unverified").map((c) => c.shot))] : [];
    return {
      level: here.level,
      episode: ep?.id ?? null,
      part: p?.id ?? null,
      shot: here.shot,
      lane: effectiveLane(p, here),
      take: here.take ?? p?.take?.record.asset ?? null,
      playhead: Math.round(here.time * 10) / 10,
      markedRange: here.range,
      playing: playingRef.current,
      focus: here.focus,
      selected: s ? positionAddress(s, here) : {},
      candidatesOpen: here.candidate && here.focus ? { ...here.focus, candidate: here.candidate } : null,
      flags: {
        bibleStale: ep?.flag?.stale ?? false,
        drift,
        unverified,
      },
    };
  }, []);

  // A drift compare opened by an address (a wall chip, `navigate-to`, a
  // locator) is brought on screen once it has rendered — it sits below the
  // screen and the strip, and at narrow widths below the whole wall.
  const [revealCheck, setRevealCheck] = useState(0);

  const runAddress = useCallback(
    (address: unknown): ViewerActionResult => {
      const s = seriesRef.current;
      if (!s) return { success: false, message: "The series has not loaded yet." };
      pause();
      const resolved = resolveAddress(s, address, posRef.current);
      if (!resolved.ok) return { success: false, message: resolved.message, data: viewState() };
      apply(resolved.position);
      syncVideo(resolved.position.time);
      if (resolved.position.check && resolved.position.level === "desk") setRevealCheck((n) => n + 1);
      return { success: true, data: viewState() };
    },
    [apply, pause, syncVideo, viewState],
  );

  const { actionRequest, onActionResult } = props;
  useEffect(() => {
    if (!actionRequest || !onActionResult) return;
    const { requestId, actionId, params: p } = actionRequest;
    switch (actionId) {
      case "navigate-to":
        onActionResult(requestId, runAddress(p?.address));
        break;
      case "get-view-state":
        onActionResult(requestId, { success: true, data: viewState() });
        break;
      case "play": {
        if (typeof p?.episode === "string" && p.episode !== posRef.current.episode) {
          const moved = runAddress({ episode: p.episode });
          if (!moved.success) {
            onActionResult(requestId, moved);
            break;
          }
        }
        const s = seriesRef.current;
        const ep = s ? findEpisode(s, posRef.current.episode) : null;
        const hasClip = !!ep && (!!ep.final || ep.parts.some((x) => x.take));
        if (!ep || !hasClip) {
          onActionResult(requestId, { success: false, message: `${ep?.id ?? "this episode"} has no ready take to play`, data: viewState() });
          break;
        }
        const from = typeof p?.from === "number" ? p.from : undefined;
        const to = typeof p?.to === "number" ? p.to : undefined;
        if (from !== undefined) {
          const target = partAt(ep, from);
          if (target) apply({ ...posRef.current, part: target.id, lane: "clip", take: null, time: from });
        } else apply({ ...posRef.current, lane: "clip" });
        // The clip mounts on the next render; start it there, and answer
        // once it has started (or refused) — `playing` in the reply is what
        // the screen is doing, not what was asked for.
        requestAnimationFrame(() => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const waited = new Promise<"waiting">((resolve) => {
            timer = setTimeout(() => resolve("waiting"), PLAY_START_TIMEOUT_MS);
          });
          void Promise.race([play(from, to), waited]).then((outcome) => {
            clearTimeout(timer);
            if (outcome === "waiting") {
              onActionResult(requestId, {
                success: true,
                message: `The clip had not started after ${PLAY_START_TIMEOUT_MS / 1000} s (still loading?); this is the state now.`,
                data: viewState(),
              });
            } else if (outcome.started) {
              onActionResult(requestId, { success: true, data: viewState() });
            } else {
              onActionResult(requestId, {
                success: false,
                message: `The browser did not start the clip (${outcome.reason}); the user can press Play.`,
                data: viewState(),
              });
            }
          });
        });
        break;
      }
      case "pause":
        pause();
        onActionResult(requestId, { success: true, data: viewState() });
        break;
      default:
        onActionResult(requestId, { success: false, message: `Unknown action: ${actionId}` });
    }
    // Only a NEW request may run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRequest]);

  const { navigateRequest, onNavigateComplete } = props;
  useEffect(() => {
    if (!navigateRequest) return;
    onNavigateComplete?.(runAddress(navigateRequest.address));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRequest]);

  // ── Commands (user → agent) ──────────────────────────────────────────────
  const commandLabel = useCallback(
    (id: string) => props.commands?.find((c) => c.id === id)?.label ?? id,
    [props.commands],
  );

  const notify = useCallback(
    (id: string, lines: Array<string | null | undefined>, summary: string) => {
      if (!props.onNotifyAgent) return;
      const s = seriesRef.current;
      const here = posRef.current;
      props.onNotifyAgent({
        type: `anime-series-command:${id}`,
        severity: "warning",
        summary: `/${id} · ${summary}`,
        message: [
          `The user pressed "${commandLabel(id)}" in the anime-series viewer.`,
          `command: ${id}`,
          ...lines.filter((l): l is string => !!l),
          s ? `address: ${JSON.stringify(positionAddress(s, here))}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    },
    [commandLabel, props],
  );

  const deskCommand = useCallback(
    (id: DeskCommand, extra?: { shot?: number }) => {
      const s = seriesRef.current;
      const here = posRef.current;
      const ep = s ? findEpisode(s, here.episode) : null;
      const p = currentPart(ep, here);
      if (!ep || !p) return;
      const lines: string[] = [`episode: ${ep.id} 《${ep.title}》`];
      if (ep.parts.length > 1) lines.push(`part: ${p.id}`);
      if (id === "redo-panel" && extra?.shot) lines.push(`shot: ${extra.shot}`);
      if (id === "patch-range") {
        let a: number | null = null;
        let b: number | null = null;
        if (extra?.shot) a = b = extra.shot;
        else if (here.range) {
          a = shotAt(p, here.range[0] + 1e-3);
          b = shotAt(p, here.range[1] - 1e-3);
          lines.push(`marked range: ${fmtSec(here.range[0])}–${fmtSec(here.range[1])} s`);
        }
        if (a !== null && b !== null) lines.push(`shots: ${a}–${b}`);
        if (p.take) lines.push(`take: ${p.take.record.asset}`);
      }
      if (id === "shoot-video" && ep.flag?.stale) lines.push(`bible flag: shot under v${ep.flag.shotUnder}, bible now v${ep.flag.latest}`);
      if (id === "review-episode" && p.take) lines.push(`take: ${p.take.record.asset}`);
      notify(id, lines, ep.id);
    },
    [notify],
  );

  const cardCommand = useCallback(
    (id: "make-sheets" | "check-sheets" | "retry", card: EntityCard) => {
      notify(id, [`${card.kind}: ${card.id} (${card.name})`, `sheet candidates: ${card.candidates.map((c) => `${c.id} ${c.status}`).join(", ") || "none"}`], card.name);
    },
    [notify],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const selectEpisode = useCallback(
    (id: string) => {
      pause();
      const s = seriesRef.current;
      const ep = s ? findEpisode(s, id) : null;
      if (!ep) return;
      const same = posRef.current.episode === id && posRef.current.level === "desk";
      apply({
        ...posRef.current,
        level: "desk",
        pointer: "desk",
        candidate: null,
        episode: id,
        ...(same ? {} : { part: ep.parts[0]?.id ?? null, shot: ep.parts[0]?.shots.length ? 1 : null, time: 0, range: null, take: null, check: null, lane: null }),
      });
    },
    [apply, pause],
  );

  const selectShot = useCallback(
    (n: number, extend: boolean) => {
      const s = seriesRef.current;
      const here = posRef.current;
      const ep = s ? findEpisode(s, here.episode) : null;
      const p = currentPart(ep, here);
      if (!p) return;
      const span = shotSpan(p, n);
      if (!span) return;
      let range: [number, number] | null = null;
      if (extend && here.shot !== null) {
        const a = Math.min(here.shot, n);
        const b = Math.max(here.shot, n);
        const from = shotSpan(p, a);
        const to = shotSpan(p, b);
        if (from && to) range = [from[0], to[1]];
      }
      pause();
      apply({ ...here, level: "desk", pointer: "desk", shot: n, part: p.id, time: span[0], range: extend ? range : null, check: null });
      syncVideo(span[0]);
    },
    [apply, pause, syncVideo],
  );

  const wallHandlers: WallHandlers = useMemo(
    () => ({
      onFocus: (focus: Focus) => apply({ ...posRef.current, level: posRef.current.level === "binge" ? "desk" : posRef.current.level, pointer: "wall", focus, candidate: null }),
      onOpenCandidates: (card, candidate) =>
        apply({ ...posRef.current, pointer: "wall", focus: { kind: card.kind, id: card.id }, candidate: candidate ?? card.candidates[0]?.id ?? null }),
      onEditField: (card, field, value) => commit((s) => setEntityField(s, card.kind, card.id, field, value)),
      onEditStyle: (field, value) => commit((s) => setStyleField(s, field, value)),
      onLock: () => commit((s) => lockBible(s, new Date().toISOString())),
      onCommand: cardCommand,
      onOverview: () => {
        pause();
        apply({ ...posRef.current, level: "overview", pointer: "desk", candidate: null });
      },
      onDrift: (d) => runAddress({ episode: d.episode, part: d.part, shot: d.shot, check: d.check }),
    }),
    [apply, cardCommand, commit, pause, runAddress],
  );

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("textarea, input, [contenteditable='true']")) return;
    const here = posRef.current;
    if (e.key === "Escape") {
      if (overlay) setOverlay(null);
      else if (here.candidate) apply({ ...here, candidate: null });
      else if (here.range) apply({ ...here, range: null });
      return;
    }
    if (here.level !== "desk") return;
    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const s = seriesRef.current;
      const ep = s ? findEpisode(s, here.episode) : null;
      const p = currentPart(ep, here);
      if (!p || p.shots.length === 0) return;
      e.preventDefault();
      const current = here.shot ?? 1;
      const next = Math.min(p.shots.length, Math.max(1, current + (e.key === "ArrowRight" ? 1 : -1)));
      selectShot(next, e.shiftKey);
    }
  };

  // Opening the overview or another episode from far down the wall (the
  // episode-log button sits at its bottom) would leave the new content
  // above the viewport: bring its top under the sticky rail.
  useEffect(() => {
    const root = rootRef.current;
    const desk = deskRef.current;
    if (!root || !desk) return;
    const rail = root.querySelector<HTMLElement>("[data-series-rail]");
    const top = desk.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - (rail?.offsetHeight ?? 0);
    if (root.scrollTop > top + 1) root.scrollTo({ top: Math.max(0, top) });
  }, [position.level, position.episode]);

  // After the one above, so a drift in another episode lands on its compare.
  useEffect(() => {
    if (!revealCheck) return;
    const root = rootRef.current;
    const card = root?.querySelector<HTMLElement>("[data-series-check]");
    if (!root || !card) return;
    const rail = root.querySelector<HTMLElement>("[data-series-rail]")?.offsetHeight ?? 0;
    const frame = root.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    if (box.top >= frame.top + rail && box.bottom <= frame.bottom) return;
    root.scrollTo({ top: Math.max(0, root.scrollTop + box.top - frame.top - rail - 8) });
  }, [revealCheck]);

  // ── Render ───────────────────────────────────────────────────────────────
  // The frame does not scroll; the page inside it does. Overlays (the grid,
  // the prompts, a card's candidates) and the notice are the frame's
  // children, so they cover the viewer where it is at any scroll offset —
  // inside the scrolling page, `absolute inset-0` is the page's first
  // screenful, and opening one from far down left it above the viewport.
  const shell = (body: React.ReactNode, overlays?: React.ReactNode) => (
    <div tabIndex={-1} onKeyDown={onKeyDown} className="relative h-full w-full overflow-hidden bg-cc-bg text-[13px] leading-[1.45] text-cc-fg outline-none">
      <ViewerKeyframes />
      <div ref={rootRef} data-series-scroll className="h-full w-full overflow-auto">
        {body}
      </div>
      {overlays}
    </div>
  );

  if (!series) return shell(<Centered title={t.loading} />);

  const problems = [
    series.bibleError ? t.bibleBroken(series.bibleError) : null,
    series.projectError ? t.projectBroken(series.projectError) : null,
    ...series.broken.map((b) => t.episodeBroken(b.id, b.error)),
  ].filter((x): x is string => !!x);
  const problemBar =
    problems.length > 0 ? (
      <div role="alert" className="border-b border-cc-error/40 bg-cc-error/10 px-3.5 py-1.5 text-[11.5px] text-cc-error">
        {problems.map((p) => (
          <div key={p}>{p}</div>
        ))}
      </div>
    ) : null;

  if (!series.hasBible && series.episodes.length === 0) {
    return shell(
      <>
        {problemBar}
        <Centered title={t.noBibleTitle} body={t.noBibleBody} />
      </>,
    );
  }

  const ratio = ratioOf(series.style.ratio);
  const focusCard =
    position.focus && position.focus.kind !== "style" ? findCard(series, position.focus.kind as EntityKind, position.focus.id) : null;

  const wall = (
    <CastWall
      series={series}
      base={base}
      t={t}
      focus={position.pointer === "wall" ? position.focus : null}
      layout={wallLayout}
      canWrite={canWrite}
      canCommand={canCommand}
      handlers={wallHandlers}
    />
  );

  let main: React.ReactNode;
  if (position.level === "overview") {
    main = <SeasonOverview series={series} base={base} t={t} onEpisode={selectEpisode} />;
  } else if (!episode || !part) {
    main = (
      <Centered title={t.noEpisodesTitle} body={t.noEpisodesBody}>
        <Btn primary disabled={!canCommand} onClick={() => notify("new-episode", [], series.title)}>
          {t.newEpisode}
        </Btn>
      </Centered>
    );
  } else {
    main = (
      <EpisodeDesk
        series={series}
        episode={episode}
        part={part}
        base={base}
        t={t}
        layout={layout}
        ratio={ratio}
        shot={position.shot}
        check={position.check}
        lane={lane}
        time={time}
        range={position.range}
        playing={playing}
        media={media}
        viewingTake={position.take}
        videoRef={videoRef}
        canWrite={canWrite}
        canCommand={canCommand}
        imagesOk={imagesOk}
        videoOk={videoOk}
        now={now}
        onTogglePlay={togglePlay}
        onLane={(l) => {
          pause();
          apply({ ...posRef.current, lane: l, take: l === "board" ? null : posRef.current.take });
        }}
        onPart={(id) => {
          pause();
          const p = episode.parts.find((x) => x.id === id);
          if (p) apply({ ...posRef.current, part: p.id, shot: p.shots.length ? 1 : null, time: p.offset, range: null, take: null, check: null });
        }}
        onSelectShot={selectShot}
        onClearRange={() => apply({ ...posRef.current, range: null })}
        onDragBorder={(index, dur) => commit((s) => dragShotBorder(s, episode.id, part.id, index, dur))}
        onCommand={deskCommand}
        onAcknowledge={() => commit((s) => acknowledgeBible(s, episode.id, s.version))}
        onShowTake={(asset) => {
          pause();
          apply({ ...posRef.current, take: asset, lane: asset ? "clip" : posRef.current.lane });
        }}
        onUseTake={(asset) => commit((s) => pickTake(s, episode.id, part.id, asset))}
        onOverlay={setOverlay}
        onVideoTime={() => {
          if (playingRef.current) return;
          const v = videoRef.current;
          const m = mediaRef.current;
          if (v && m) follow(m.offset + v.currentTime);
        }}
        onVideoEnded={pause}
        detail={{
          onEditShot: (index, field, value) => commit((s) => setShotText(s, episode.id, part.id, index, field, value)),
          onCommand: (id, shot) => deskCommand(id, { shot }),
          onCheck: (cell) => apply({ ...posRef.current, check: cell, pointer: "desk" }),
          onAccept: (shot, cell, source) => commit((s) => acceptDrift(s, episode.id, source, shot, cell)),
        }}
      />
    );
  }

  const body =
    position.level === "binge" ? (
      <BingeView series={series} base={base} t={t} canCommand={canCommand} onCompile={() => notify("compile-season", [], series.title)} />
    ) : (
      <main
        className={wallWidth > 0 ? "grid min-h-[calc(100%-56px)]" : "flex flex-col"}
        style={wallWidth > 0 ? { gridTemplateColumns: `${wallWidth}px minmax(0, 1fr)` } : undefined}
      >
        {wall}
        <div ref={deskRef} className="min-w-0">
          {main}
        </div>
      </main>
    );

  return shell(
    <>
      <SeasonRail
        series={series}
        t={t}
        base={base}
        current={position.episode}
        level={position.level}
        narrow={width < 760}
        onEpisode={selectEpisode}
        onNewEpisode={() => notify("new-episode", [`episodes so far: ${series.episodes.map((e) => e.id).join(", ") || "none"}`], series.title)}
        onBinge={() => {
          pause();
          apply({ ...posRef.current, level: posRef.current.level === "binge" ? "desk" : "binge", candidate: null });
        }}
        canCommand={canCommand}
      />
      {problemBar}
      {body}
    </>,
    <>
      {focusCard && position.candidate !== null ? (
        <CandidatesDrawer
          card={focusCard}
          selected={position.candidate}
          base={base}
          t={t}
          canWrite={canWrite}
          canCommand={canCommand}
          onSelect={(id) => apply({ ...posRef.current, candidate: id })}
          onUse={(id) => commit((s) => pickSheet(s, focusCard.kind, focusCard.id, id))}
          onCommand={(id) => cardCommand(id, focusCard)}
          onClose={() => apply({ ...posRef.current, candidate: null })}
        />
      ) : null}
      {overlay === "grid" && episode && part ? (
        <GridOverlay
          part={part}
          base={base}
          t={t}
          canWrite={canWrite}
          onUse={(asset) => commit((s) => pickStoryboard(s, episode.id, part.id, asset))}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay === "prompts" && episode && part ? (
        <PromptsOverlay series={series} episode={episode} part={part} t={t} onClose={() => setOverlay(null)} />
      ) : null}
      {notice ? (
        <div role="status" className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-[8px] border border-cc-error/50 bg-cc-surface/95 px-3 py-1.5 text-[11.5px] text-cc-error shadow-xl">
          {notice}
        </div>
      ) : null}
    </>,
  );
}
