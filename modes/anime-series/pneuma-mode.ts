/**
 * Anime Series Mode — ModeDefinition binding manifest + viewer.
 *
 * Loaded by the frontend via mode-loader's dynamic import; the Bun backend
 * reads `manifest.ts` directly, which is why React only appears here.
 *
 * One workspace = one series. The workspace items are its EPISODES, because
 * an episode is what the user picks off the season rail and what an address
 * names first.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerFileContent,
  ViewerSelectionContext,
  WorkspaceItem,
} from "../../core/types/viewer-contract.js";

import {
  cellName,
  cellVerdict,
  findCard,
  findEpisode,
  inFlight,
  isLostBeat,
  loadSeries,
  partAt,
  shotAt,
  shotSpan,
  type EpisodeView,
  type PartView,
  type Series,
} from "./domain.js";
import animeSeriesManifest from "./manifest.js";
import AnimeSeriesPreview from "./viewer/AnimeSeriesPreview.js";

// ── Workspace items ────────────────────────────────────────────────────────

/** One item per episode, in id order. */
export function resolveSeriesItems(files: ViewerFileContent[]): WorkspaceItem[] {
  const series = loadSeries(files);
  return series.episodes.map((episode, index) => ({
    path: episode.path,
    label: `${episode.id} 《${episode.title}》`,
    index,
    metadata: { episode: episode.id, duration: episode.duration, stage: episode.stage },
  }));
}

// ── Context ────────────────────────────────────────────────────────────────

function str(address: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = address?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(address: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = address?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function castLine(series: Series): string {
  const cards = series.cards.map((card) => {
    const lock =
      card.lock.state === "locked"
        ? `locked v${card.lock.version}`
        : card.lock.state === "edited"
          ? `EDITED since v${card.lock.version} (${card.lock.changed.join(", ")})`
          : "not locked";
    const sheet =
      card.sheet && card.sheet.status === "ready"
        ? ""
        : card.sheetState === "pick"
          ? ", sheet candidates waiting for a pick"
          : card.sheetState === "generating"
            ? ", sheets generating"
            : card.kind === "group"
              ? ", text only"
              : ", no sheet";
    const drift = card.drift.filter((d) => !d.accepted);
    return `${card.name} (${card.kind} ${card.id}) ${lock}${sheet}${drift.length ? `, ${drift.length} drift` : ""}`;
  });
  const style = series.style.lock.state === "edited" ? " · style EDITED since lock" : "";
  return `Cast: ${cards.join(" · ") || "none yet"}${style}`;
}

function episodeLines(series: Series, episode: EpisodeView, part: PartView | null): string[] {
  const lines: string[] = [];
  const shots = episode.parts.reduce((n, p) => n + p.shots.length, 0);
  const board = part?.board ? `board ${part.board.record.asset} ${part.board.view.status}` : "no board";
  const take = part?.take ? `clip ${part.take.record.asset} ${part.take.view.status}` : "no clip";
  const flag = episode.flag?.stale
    ? ` (shot under v${episode.flag.shotUnder} — ${episode.flag.changes.map((c) => `${c.name}: ${c.fields.join("/")}`).join("; ")} changed)`
    : "";
  lines.push(
    `On screen: ${episode.id}《${episode.title}》${episode.duration}s · ${shots} shots${episode.parts.length > 1 ? ` · ${episode.parts.length} parts, showing ${part?.id}` : ""} · ${episode.stage}${episode.stage === "reviewed" && episode.unverified > 0 ? ` (${episode.unverified} cell(s) still unchecked — not finished)` : ""}${episode.busy ? " (generating)" : ""} · ${board} · ${take}${flag}`,
  );
  for (const issue of episode.issues.errors.slice(0, 3)) lines.push(`Timing error: ${issue.message}`);
  if (part?.take) {
    const drift = part.checks.filter((c) => cellVerdict(c) === "drift" && !c.accepted);
    const ok = part.checks.filter((c) => cellVerdict(c) === "ok").length;
    const absent = part.checks.filter((c) => cellVerdict(c) === "absent").length;
    const lost = part.checks.filter(isLostBeat);
    const unverifiedShots = [...new Set(part.checks.filter((c) => cellVerdict(c) === "unverified").map((c) => c.shot))];
    const accepted = part.checks.filter((c) => c.accepted).length;
    lines.push(
      `Checks: ${ok} ok · ${drift.length} drift${drift.length ? ` (${drift
        .slice(0, 3)
        .map((c) => `shot ${c.shot} ${cellName(series, c)}: ${c.note || "no note"}`)
        .join("; ")})` : ""} · ${unverifiedShots.length} shot(s) unverified${unverifiedShots.length ? ` (${unverifiedShots.join(", ")})` : ""}${accepted ? ` · ${accepted} accepted` : ""}${absent ? ` · ${absent} not in shot` : ""}${lost.length ? ` (lost beats — the shot's words name them: ${lost.map((c) => `shot ${c.shot} ${cellName(series, c)}`).join("; ")})` : ""}`,
    );
  }
  if (part) {
    if (part.staleClip.length) lines.push(`Changed since the clip: shots ${part.staleClip.join(", ")} (not re-shot)`);
    if (part.staleBoard.length) lines.push(`Changed since the storyboard: shots ${part.staleBoard.join(", ")} (not redrawn)`);
    if (part.setupStale) lines.push("The episode setup (cast, place, time or length) changed after the clip.");
  }
  const now = Date.now();
  for (const p of episode.parts) {
    for (const patch of p.patches) {
      if (patch.view.status !== "pending" && patch.view.status !== "generating") continue;
      const ago = patch.view.submittedAt ? Math.round((now - patch.view.submittedAt) / 1000) : null;
      lines.push(
        `Patch: shots ${patch.record.shots[0]}–${patch.record.shots[1]} ${patch.view.status}${ago !== null ? `, submitted ${ago}s ago` : ""}${patch.view.cost?.usd != null ? `, ≈${usd(patch.view.cost.usd)}` : ""}`,
      );
    }
  }
  return lines;
}

/**
 * What the user is looking at, written for the agent (canvas design §11).
 *
 * Every status here is read from `domain.ts`, which takes it from
 * series-state.mjs — the same rules the scripts refuse to spend against, so
 * the agent never reads "locked" here and "edited" from `series.mjs status`.
 */
export function extractSeriesContext(
  selection: ViewerSelectionContext | null,
  files: ViewerFileContent[],
): string {
  const series = loadSeries(files);
  if (!series.hasBible && series.episodes.length === 0) {
    return `<viewer-context mode="anime-series">\nNo bible yet — the series has no cast.\n</viewer-context>`;
  }
  const address = selection?.address as Record<string, unknown> | undefined;
  const lines: string[] = [];
  const version = series.version
    ? `bible v${series.version} (locked ${day(series.lockedAt)})`
    : "bible not locked";
  lines.push(`Series: ${series.title || "(untitled)"} · ${version} · ${series.episodes.length} episode(s) · ${usd(series.cost.total)} est.${series.cost.unpriced ? ` + ${series.cost.unpriced} unpriced call(s)` : ""}${series.cost.uncertain ? ` (incl. ${series.cost.uncertain} failed call(s) whose billing is unknown: ${series.summary?.uncertain.join(", ")})` : ""}`);
  lines.push(castLine(series));
  const busy = inFlight(series);
  if (busy.length) lines.push(`In flight: ${busy.map((a) => `${a.id} ${a.status}`).join(", ")}`);
  if (series.projectError) lines.push(`project.json is unreadable: ${series.projectError}`);
  for (const b of series.broken) lines.push(`${b.path} is unreadable: ${b.error}`);

  if (address?.season === "overview") {
    lines.push(`On screen: the season overview — ${series.ideas.episodes.length} logged episode(s)`);
  }

  for (const kind of ["character", "group", "scene"] as const) {
    const id = str(address, kind);
    if (!id) continue;
    const card = findCard(series, kind, id);
    if (!card) continue;
    const look = (card.entity as { look?: string }).look ?? "";
    lines.push(`Selected card: ${card.name} (${kind} ${id}) — ${look.slice(0, 160)}${look.length > 160 ? "…" : ""}`);
    const candidate = str(address, "candidate");
    const c = candidate ? card.candidates.find((x) => x.id === candidate) : null;
    if (c) lines.push(`Sheet candidate: ${c.id} ${c.status}${c.check ? ` · ${c.check.verdict}: ${c.check.note}` : " · unchecked"}${c.id === card.sheet?.id ? " · in use" : ""}`);
  }
  if (address?.bible === "style") lines.push(`Selected card: the style lock — ${series.style.style.slice(0, 160)}`);

  const episodeId = str(address, "episode") ?? series.episodes[0]?.id;
  const episode = findEpisode(series, episodeId);
  if (episode && !address?.season && !["character", "group", "scene", "bible"].some((k) => k in (address ?? {}))) {
    // The part an address is on: named, else the one holding the named take,
    // else the one under `time` or the marked range's start (a 60 s
    // episode's clock runs across both parts), else the first. The viewer's
    // resolveAddress makes the same choice.
    const time = num(address, "time");
    const takeId = str(address, "take");
    const range = address?.range;
    const marked =
      Array.isArray(range) && typeof range[0] === "number" && typeof range[1] === "number"
        ? ([range[0], range[1]] as [number, number])
        : null;
    const anchor = time ?? marked?.[0];
    const named = str(address, "part");
    const part =
      (named ? episode.parts.find((p) => p.id === named) : undefined) ??
      (takeId ? episode.parts.find((p) => [...p.takes, ...p.patches].some((t) => t.record.asset === takeId)) : undefined) ??
      (anchor !== undefined ? partAt(episode, anchor) : null) ??
      episode.parts[0] ??
      null;
    for (const line of episodeLines(series, episode, part)) lines.push(line);
    const shot = num(address, "shot") ?? (part && anchor !== undefined ? shotAt(part, anchor) ?? undefined : undefined);
    if (part && shot !== undefined) {
      const data = part.shots[shot - 1];
      const span = shotSpan(part, shot);
      if (data && span) {
        const lane = str(address, "lane") ?? (part.take ? "clip" : "board");
        lines.push(
          `Selected: shot ${shot} · ${span[0].toFixed(1)}–${span[1].toFixed(1)}s · ${lane} lane · "${String(data.desc ?? "").slice(0, 120)}"${data.sfx ? ` sfx: ${data.sfx}` : ""}`,
        );
      }
      const check = str(address, "check");
      if (check) {
        const cell = part.checks.find((c) => c.shot === shot && c.character === check);
        lines.push(`Drift compare open: ${cell ? cellName(series, cell) : check} — ${cell ? `${cell.verdict}${cell.accepted ? " (accepted)" : ""}${cell.note ? `: ${cell.note}` : ""}` : "unverified"}`);
      }
    }
    if (takeId) lines.push(`Showing take: ${takeId}`);
    // A shot address carries no time when the playhead sits at its start.
    const playhead = time ?? (part && shot !== undefined ? shotSpan(part, shot)?.[0] : undefined) ?? marked?.[0] ?? 0;
    lines.push(
      `Playhead: ${playhead.toFixed(1)}s · Marked: ${marked ? `${marked[0].toFixed(1)}–${marked[1].toFixed(1)}s` : "none"}`,
    );
  }

  if (selection?.address) lines.push(`Address: ${JSON.stringify(selection.address)}`);
  return `<viewer-context mode="anime-series">\n${lines.join("\n")}\n</viewer-context>`;
}

// ── Mode Definition ────────────────────────────────────────────────────────

const workspace = animeSeriesManifest.viewerApi!.workspace!;

const animeSeriesMode: ModeDefinition = {
  manifest: animeSeriesManifest,

  viewer: {
    PreviewComponent: AnimeSeriesPreview,

    workspace: {
      type: workspace.type,
      multiFile: workspace.multiFile,
      ordered: workspace.ordered,
      hasActiveFile: workspace.hasActiveFile,
      manifestFile: workspace.manifestFile,
      topBarNavigation: workspace.topBarNavigation,
      resolveItems: resolveSeriesItems,
      /**
       * No "new" button from the framework. A series starts with
       * `series.mjs init` and an episode with `series.mjs add-episode`,
       * which check the timing rules before anything is written — an empty
       * skeleton written from here would skip them.
       */
      createEmpty: () => null,
    },

    extractContext: extractSeriesContext,

    // The manifest is the single source of truth for the action space.
    actions: animeSeriesManifest.viewerApi?.actions,

    updateStrategy: "incremental",
  },
};

export default animeSeriesMode;
