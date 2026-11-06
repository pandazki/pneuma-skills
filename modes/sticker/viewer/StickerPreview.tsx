/**
 * Sticker viewer — panel · chat · submit, on a light or dark chat plate.
 *
 * Conventions worth knowing before changing anything:
 *
 * 1. ONE POSITION. A click, `navigate-to`, `set-view`, a locator card and
 *    `capture` all go through `Position` (view-model.ts); every selection
 *    carries `positionAddress(position)`, so what the agent reads is what
 *    the user sees. `posRef` is written synchronously so an action can
 *    report where the viewer now is inside the same handler.
 *
 * 2. NO SECOND COPY OF A RULE. Every status, stale reason, export state and
 *    checklist row is read off the `pack` source, which `domain.ts` builds
 *    from `sticker-state.mjs` — the module `sticker.mjs` runs.
 *
 * 3. THE VIEWER WRITES DECISIONS, NOT MACHINE STATE. A picked take, anchor
 *    or art, an edited word / caption / emoji / action and the listing text
 *    go into pack.json through the source. Generating, exporting and
 *    checking are commands to the agent; project.json is never written.
 *
 * 4. READ-ONLY IS A STATE, NOT A CRASH. `editing === false`, `readonly` or
 *    the hosted player (`staticPlayer`) hide every write and every command;
 *    everything still plays. Nothing here calls `/api/*` — media is
 *    `/content/<uri>`, which the player's service worker also answers.
 *    Only page requests reach that worker: in the player an archive
 *    download is fetched and saved (`saveFetched`), never navigated to.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Source } from "../../../core/types/source.js";
import type { ViewerActionResult, ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import { getApiBase } from "../../../src/utils/api.js";

import type { Platform, StickerField, StickerPack } from "../domain.js";
import { findArt, findSticker, inFlight, pickAnchor, pickArt, pickTake, setListingField, setStickerField } from "../domain.js";
import { ChatView } from "./Chat.js";
import { ArtInspector, CharacterInspector, StickerInspector } from "./Inspector.js";
import { CompactBar, Sidebar, StickerGrid, type KeysKnown } from "./Panel.js";
import { SubmitView } from "./Submit.js";
import { mediaUrl } from "./media.js";
import { useGifFrames, type FramesState } from "./players.js";
import { stickerStrings, type StickerStrings } from "./strings.js";
import { Btn, Chip, Icon, Segmented } from "./ui.js";
import {
  PLATE_COLORS,
  START,
  frameVerdict,
  positionAddress,
  resolveAddress,
  resolveSetView,
  stageTake,
  type Focus,
  type Plate,
  type Position,
  type View,
} from "./view-model.js";

const SELECTION_SETTLE_MS = 300;
/** How long a frame address waits for the frames to decode before answering. */
const FRAME_ARRIVAL_TIMEOUT_MS = 5000;
const SIDEBAR_W = 248;
const GAP = 16;
/** How long a saved file's object URL lives — the download must have started by then. */
const OBJECT_URL_TTL_MS = 40_000;

/**
 * Save a `/content/*` file by fetching it. In the hosted player only the
 * content service worker can answer `/content/*`, and a browser hands an
 * `<a download>` click to its download manager, which does not ask the
 * worker: on the player harness Chrome 156 saved the static host's 404 body
 * as "wechat.txt" (then cancelled) and WebKit 26 kept it as "line.zip.txt".
 * A page `fetch()` goes through the worker, so the bytes are fetched here
 * and saved from an object URL. Rejects on any non-2xx answer, so a missing
 * file is reported instead of saved.
 */
async function saveFetched(url: string, name: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const objectUrl = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking at once can cancel the download before the browser has read it.
  setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_TTL_MS);
}

function Centered({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="grid h-full min-h-[50vh] place-items-center p-8 text-center">
      <div className="max-w-md">
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-[14px] bg-cc-primary/12 text-cc-primary shadow-[inset_0_0_0_1px_rgba(249,115,22,0.25)]">
          <Icon.Sticker size={22} />
        </span>
        <h1 className="m-0 text-[15px] font-semibold text-cc-fg">{title}</h1>
        {body ? <p className="m-0 mt-2 text-[12.5px] leading-[1.7] text-cc-muted">{body}</p> : null}
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </div>
  );
}

function Swatch({ plate }: { plate: Plate }) {
  return <span className="h-3 w-3 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]" style={{ backgroundColor: PLATE_COLORS[plate] }} />;
}

/** "WeChat" out of the module's own `--platform wechat` for a next step that names one. */
function stepPlatform(value: StickerPack, command: string | undefined): string | null {
  const id = command ? /--platform (\w+)/.exec(command)?.[1] : undefined;
  return id ? value.platforms.find((p) => p.platform === id)?.profile.label ?? null : null;
}

export default function StickerPreview(props: ViewerPreviewProps) {
  const { value, write } = useSource(props.sources.pack as Source<StickerPack> | undefined);
  const staticPlayer = useStore((s) => s.staticPlayer);
  const t: StickerStrings = useMemo(() => stickerStrings(props.locale), [props.locale]);
  const base = useMemo(() => getApiBase(), []);

  const canWrite = props.editing !== false && !props.readonly && !staticPlayer;
  const canCommand = canWrite && !!props.onNotifyAgent;
  const params = props.initParams ?? {};
  const keys: KeysKnown = {
    fal: "stickersEnabled" in params ? params.stickersEnabled === "true" : null,
    openrouter: "imagesEnabled" in params ? params.imagesEnabled === "true" : null,
  };

  // ── Size ─────────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth || 1200);
    return () => ro.disconnect();
  }, []);

  // ── Position ─────────────────────────────────────────────────────────────
  const [position, setPosition] = useState<Position>(START);
  const posRef = useRef<Position>(START);
  const apply = useCallback((next: Position) => {
    posRef.current = next;
    setPosition(next);
  }, []);
  const valueRef = useRef<StickerPack | null>(value);
  valueRef.current = value;

  // Never point at something the agent removed; open a platform tab by default.
  useEffect(() => {
    const pack = value?.pack;
    if (!value || !pack) return;
    const here = posRef.current;
    let next = here;
    const focus = here.focus;
    if (focus?.type === "sticker") {
      const sticker = findSticker(value, focus.id);
      if (!sticker) next = { ...next, focus: null, take: null, frame: null };
      else if (here.take && !sticker.takes.some((x) => x.id === here.take)) next = { ...next, take: null, frame: null };
    } else if (focus?.type === "art" && !findArt(value, focus.kind)) next = { ...next, focus: null };
    if (!here.platform || !pack.platforms.includes(here.platform)) next = { ...next, platform: pack.platforms[0] ?? null };
    if (next !== here) apply(next);
  }, [value, apply]);

  // A click that unmounts the focused control (the sidebar collapses when
  // the inspector opens) drops focus to <body>, where Escape and the arrow
  // keys no longer reach the viewer. Take it back — only from <body>, never
  // from the chat input or anything else the user is in.
  useEffect(() => {
    const root = rootRef.current;
    if (root && typeof document !== "undefined" && (document.activeElement === document.body || document.activeElement === null)) {
      root.focus({ preventScroll: true });
    }
  }, [position.focus, position.view]);

  // ── The stage's frames ───────────────────────────────────────────────────
  const focusSticker = value && position.focus?.type === "sticker" ? findSticker(value, position.focus.id) : null;
  const stage = position.view === "panel" ? stageTake(focusSticker, position) : null;
  const stageUrl = stage?.status === "ready" ? mediaUrl(base, stage) : null;
  const frames: FramesState = useGifFrames(stageUrl);
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    for (const w of waiters.current.splice(0)) w();
  }, [frames]);
  // A frame the new take does not have lets go of the freeze.
  useEffect(() => {
    if (frames.status === "ready" && position.frame !== null && position.frame >= frames.frames.length) apply({ ...posRef.current, frame: null });
  }, [frames, position.frame, apply]);

  /**
   * Resolves with null once a frame address is on screen (its take's frames
   * decoded and long enough), or with why it cannot be: no ImageDecoder, a
   * decode error, fewer frames than recorded, still decoding after 5 s.
   * Anything that is not a frame is on screen at once.
   */
  const arrival = useCallback(
    (target: Position): Promise<string | null> => {
      if (target.view !== "panel" || target.frame === null || !valueRef.current) return Promise.resolve(null);
      const frame = target.frame;
      const sticker = target.focus?.type === "sticker" ? findSticker(valueRef.current, target.focus.id) : null;
      const expected = mediaUrl(base, stageTake(sticker, target));
      return new Promise((resolve) => {
        let settled = false;
        const done = (failure: string | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(failure);
        };
        const timer = setTimeout(
          () => done(`Frame ${frame} was still decoding after ${FRAME_ARRIVAL_TIMEOUT_MS / 1000} s: the stage plays the whole take.`),
          FRAME_ARRIVAL_TIMEOUT_MS,
        );
        const check = () => {
          const verdict = frameVerdict(framesRef.current, expected, frame);
          if (!verdict.done) waiters.current.push(check);
          else done(verdict.shown ? null : verdict.reason);
        };
        check();
      });
    },
    [base],
  );

  // ── Clock for "generating for N s" ───────────────────────────────────────
  const [now, setNow] = useState(() => Date.now());
  const busy = value ? inFlight(value).length > 0 : false;
  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // ── Notices ──────────────────────────────────────────────────────────────
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ── Writes (decisions only) ──────────────────────────────────────────────
  const commit = useCallback(
    (edit: (v: StickerPack) => StickerPack) => {
      const current = valueRef.current;
      if (!current || !canWrite) return;
      let next: StickerPack;
      try {
        next = edit(current);
      } catch (error) {
        setNotice({ text: t.notSaved((error as Error).message), tone: "error" });
        return;
      }
      if (next === current) return;
      write(next).catch((error: unknown) => setNotice({ text: t.notSaved((error as Error).message), tone: "error" }));
    },
    [canWrite, write, t],
  );

  // ── Selection reported to the agent ──────────────────────────────────────
  const { onSelect } = props;
  useEffect(() => {
    if (!value?.pack) return;
    const timer = setTimeout(() => {
      const here = posRef.current;
      const address = positionAddress(here);
      if (here.view === "chat") {
        onSelect({ type: "view", content: "the chat preview", label: "Chat preview" });
        return;
      }
      const focus = here.focus;
      const scope = here.view === "submit" ? value.platforms.find((p) => p.platform === here.platform) : null;
      const where = scope ? ` · ${scope.profile.label} submission` : "";
      if (focus?.type === "sticker") {
        const s = findSticker(value, focus.id);
        if (!s) return;
        onSelect({
          type: "sticker",
          content: `${s.sticker.word} — ${s.sticker.caption ? `“${s.sticker.caption}”` : "no caption"} — ${s.sticker.action}`.slice(0, 200),
          label: `${s.number} · ${s.id} ${s.sticker.word}${here.frame !== null ? ` · frame ${here.frame}` : ""}${where}`,
          address,
        });
        return;
      }
      if (focus?.type === "character" && here.view === "panel") {
        onSelect({ type: "character", content: (value.pack?.character.description ?? "").slice(0, 200), label: "Character", address });
        return;
      }
      if (focus?.type === "art") {
        onSelect({ type: "art", content: focus.kind, label: `Art · ${focus.kind}${where}`, address });
        return;
      }
      if (scope) {
        onSelect({ type: "platform", content: value.projectError ? `${scope.profile.label}: checks unknown — project.json is unreadable` : `${scope.profile.label}: ${scope.tally.fail} fail, ${scope.tally.warn} warn, ${scope.tally.pass} pass`, label: `${scope.profile.label} submission`, address });
        return;
      }
      onSelect(null);
    }, SELECTION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [position, value, onSelect]);

  // ── View state + address handling (actions, locators, capture) ───────────
  const viewState = useCallback((): Record<string, unknown> => {
    const here = posRef.current;
    const v = valueRef.current;
    const sticker = v && here.focus?.type === "sticker" ? findSticker(v, here.focus.id) : null;
    return {
      view: here.view,
      plate: here.plate,
      platform: here.view === "submit" ? here.platform : null,
      focus: here.focus,
      stageTake: here.view === "panel" ? stageTake(sticker, here)?.id ?? null : null,
      frame: here.frame,
      status: sticker ? sticker.state.status : null,
      address: positionAddress(here),
    };
  }, []);

  const runAddress = useCallback(
    (address: unknown): { result: ViewerActionResult; target: Position | null } => {
      const v = valueRef.current;
      if (!v) return { result: { success: false, message: "The pack has not loaded yet." }, target: null };
      const resolved = resolveAddress(v, address, posRef.current);
      if (!resolved.ok) return { result: { success: false, message: resolved.message, data: viewState() }, target: null };
      apply(resolved.position);
      return { result: { success: true, data: viewState() }, target: resolved.position };
    },
    [apply, viewState],
  );

  /**
   * Move, then answer once the target is on screen. A frame waits for its
   * decode; a frame that cannot be shown is a failure — a `navigate-to` +
   * `capture` caller would otherwise screenshot the playing loop as that
   * frame — and the stage lets go of it, so the reply's `data` and the
   * screen agree: the sticker, playing.
   */
  const navigate = useCallback(
    (address: unknown, answer: (result: ViewerActionResult) => void) => {
      const { result, target } = runAddress(address);
      if (!target) return answer(result);
      void arrival(target).then((failure) => {
        if (target.frame === null) return answer({ ...result, data: viewState() });
        const here = posRef.current;
        const still = here.view === "panel" && here.frame === target.frame && here.take === target.take && JSON.stringify(here.focus) === JSON.stringify(target.focus);
        if (!failure && still) return answer({ ...result, data: viewState() });
        if (still) apply({ ...here, frame: null });
        answer({ success: false, message: failure ?? `Frame ${target.frame} was replaced by a later move before it was shown.`, data: viewState() });
      });
    },
    [runAddress, arrival, viewState, apply],
  );

  const { actionRequest, onActionResult } = props;
  useEffect(() => {
    if (!actionRequest || !onActionResult) return;
    const { requestId, actionId, params: p } = actionRequest;
    switch (actionId) {
      case "navigate-to":
        navigate(p?.address, (result) => onActionResult(requestId, result));
        break;
      case "set-view": {
        const v = valueRef.current;
        if (!v) {
          onActionResult(requestId, { success: false, message: "The pack has not loaded yet." });
          break;
        }
        const r = resolveSetView(v, p, posRef.current);
        if (!r.ok) {
          onActionResult(requestId, { success: false, message: r.message, data: viewState() });
          break;
        }
        apply(r.position);
        onActionResult(requestId, { success: true, data: viewState() });
        break;
      }
      default:
        onActionResult(requestId, { success: false, message: `Unknown action: ${actionId}` });
    }
    // Only a NEW request may run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRequest]);

  const { navigateRequest, onNavigateComplete } = props;
  useEffect(() => {
    if (!navigateRequest) return;
    navigate(navigateRequest.address, (result) => onNavigateComplete?.(result));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRequest]);

  // ── Commands (user → agent) ──────────────────────────────────────────────
  const notify = useCallback(
    (id: "make-missing" | "export-check", lines: string[], summary: string) => {
      if (!props.onNotifyAgent) return;
      const label = props.commands?.find((c) => c.id === id)?.label ?? id;
      props.onNotifyAgent({
        type: `sticker-command:${id}`,
        severity: "warning",
        summary: `/${id} · ${summary}`,
        message: [`The user pressed "${label}" in the sticker viewer.`, `command: ${id}`, ...lines, `address: ${JSON.stringify(positionAddress(posRef.current))}`].join("\n"),
      });
      setNotice({ text: t.commandSent, tone: "info" });
    },
    [props, t],
  );

  /** Exactly what a plain `gen` makes (`genTargets`, as gen, quote and the next step read it); never a sticker whose last call may have been billed. */
  const makeMissing = useCallback(() => {
    const v = valueRef.current;
    const plan = v?.gen;
    if (!v || !plan?.targets.length) return;
    notify(
      "make-missing",
      [
        `make (what a plain gen makes): ${plan.targets.map((s) => `${s.id} (${s.status})`).join(", ")}`,
        plan.uncertain.length
          ? `not included — the last take failed with billing unknown, so it may have been charged; retry only if the user says so: ${plan.uncertain.map((u) => `${u.id} (${u.take ?? "no take"}: ${u.reason})`).join(", ")}`
          : "",
        v.next ? `next step: ${v.next.line}` : "",
      ].filter(Boolean),
      plan.targets.map((s) => s.id).join(", "),
    );
  }, [notify]);

  const exportCheck = useCallback(
    (platform: Platform) => {
      const v = valueRef.current;
      const view = v?.platforms.find((p) => p.platform === platform);
      if (!v || !view) return;
      notify(
        "export-check",
        [`platform: ${platform}`, `checklist now: ${view.tally.fail} fail, ${view.tally.warn} warn, ${view.tally.pass} pass`, `archive: ${view.exports.archive.state}`],
        view.profile.label,
      );
    },
    [notify],
  );

  // ── Downloads (hosted player only; the app's server answers the link) ────
  const saveArchive = useCallback(
    (url: string, name: string) => {
      saveFetched(url, name).catch((error: unknown) => setNotice({ text: t.downloadFailed(error instanceof Error ? error.message : String(error)), tone: "error" }));
    },
    [t],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const focusOn = useCallback(
    (focus: Focus) => {
      const here = posRef.current;
      const same = JSON.stringify(here.focus) === JSON.stringify(focus);
      apply({ ...here, focus, take: same ? here.take : null, frame: same ? here.frame : null });
    },
    [apply],
  );
  const closeInspector = useCallback(() => apply({ ...posRef.current, focus: null, take: null, frame: null }), [apply]);
  const setView = useCallback((view: View) => apply({ ...posRef.current, view, ...(view !== "panel" ? { frame: null, take: null } : {}) }), [apply]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("textarea, input, [contenteditable='true']")) return;
    const here = posRef.current;
    const v = valueRef.current;
    if (e.key === "Escape") {
      if (here.frame !== null) apply({ ...here, frame: null });
      else if (here.focus) closeInspector();
      return;
    }
    if (!v || here.view !== "panel" || here.focus?.type !== "sticker") return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    const f = framesRef.current;
    if (here.frame !== null && f.status === "ready") {
      apply({ ...here, frame: (here.frame + step + f.frames.length) % f.frames.length });
      return;
    }
    const index = v.stickers.findIndex((s) => s.id === (here.focus as { id: string }).id);
    const next = v.stickers[Math.min(v.stickers.length - 1, Math.max(0, index + step))];
    if (next) apply({ ...here, focus: { type: "sticker", id: next.id }, take: null, frame: null });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const shell = (body: React.ReactNode) => (
    <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} data-sticker-viewer className="relative flex h-full w-full flex-col overflow-hidden bg-cc-bg text-[13px] leading-[1.45] text-cc-fg outline-none">
      {body}
      {notice ? (
        <div
          role="status"
          className={`absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-[10px] border bg-cc-surface/95 px-3 py-1.5 text-[11.5px] shadow-xl backdrop-blur ${notice.tone === "error" ? "border-cc-error/50 text-cc-error" : "border-cc-primary/40 text-cc-fg"}`}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  );

  if (!value) return shell(<Centered title={t.loading} />);
  if (!value.hasPack) return shell(<Centered title={t.noPackTitle} body={t.noPackBody} />);
  if (!value.pack) {
    return shell(
      <Centered title={t.packInvalidTitle} body={t.packInvalidBody}>
        <ul data-pack-errors className="m-0 list-none rounded-[12px] border border-cc-error/35 bg-cc-error/[0.07] p-3 text-left font-mono text-[11.5px] leading-[1.6] text-cc-fg/90">
          {value.packErrors.map((e) => (
            <li key={e.message}>{e.message}</li>
          ))}
        </ul>
      </Centered>,
    );
  }

  const ready = value.stickers.filter((s) => s.state.status === "ready").length;
  const next = value.next;
  const missing = (value.gen?.targets.length ?? 0) > 0;
  const nextPlatform = next ? stepPlatform(value, next.command) : null;

  // Layout by the viewer's own width.
  const inspectorOpen = position.view === "panel" && position.focus !== null;
  const inspectorW = width >= 1320 ? 420 : 384;
  let sidebar: "full" | "compact" = width >= 760 ? "full" : "compact";
  let inspectorMode: "column" | "overlay" | null = null;
  if (inspectorOpen) {
    if (width >= 1180) inspectorMode = "column";
    else if (width >= 760) {
      inspectorMode = "column";
      sidebar = "compact";
    } else inspectorMode = "overlay";
  }
  const gridWidth = width - 2 * GAP - (sidebar === "full" ? SIDEBAR_W + GAP : 0) - (inspectorMode === "column" ? inspectorW + GAP : 0);
  const columns = gridWidth >= 540 ? 4 : gridWidth >= 380 ? 3 : 2;

  let inspector: React.ReactNode = null;
  if (inspectorOpen && position.focus) {
    const focus = position.focus;
    if (focus.type === "sticker" && focusSticker) {
      inspector = (
        // Keyed by what it shows: another sticker opens at the top (its status
        // and stale reason), not at the previous one's scroll position.
        <StickerInspector
          key={focusSticker.id}
          value={value}
          sticker={focusSticker}
          position={position}
          frames={frames}
          base={base}
          t={t}
          now={now}
          canWrite={canWrite}
          canCommand={canCommand}
          onClose={closeInspector}
          onShowTake={(take) => apply({ ...posRef.current, take, frame: null })}
          onFrame={(frame) => apply({ ...posRef.current, frame })}
          onPickTake={(take) => commit((v) => pickTake(v, focusSticker.id, take))}
          onField={(field: StickerField, text: string) => commit((v) => setStickerField(v, focusSticker.id, field, text))}
        />
      );
    } else if (focus.type === "character" && value.character) {
      inspector = <CharacterInspector value={value} position={position} base={base} t={t} canWrite={canWrite} onClose={closeInspector} onPickAnchor={(id) => commit((v) => pickAnchor(v, id))} />;
    } else if (focus.type === "art" && findArt(value, focus.kind)) {
      inspector = (
        <ArtInspector
          key={focus.kind}
          value={value}
          kind={focus.kind}
          position={position}
          base={base}
          t={t}
          canWrite={canWrite}
          onClose={closeInspector}
          onPickArt={(id) => commit((v) => pickArt(v, focus.kind, id))}
          onExport={(platform) => apply({ ...posRef.current, view: "submit", platform })}
        />
      );
    }
  }

  let body: React.ReactNode;
  if (position.view === "chat") {
    body = <ChatView value={value} plate={position.plate} base={base} t={t} />;
  } else if (position.view === "submit") {
    body = (
      <div className="h-full overflow-y-auto">
        <SubmitView
          value={value}
          position={position}
          base={base}
          t={t}
          wide={width >= 900}
          canWrite={canWrite}
          canCommand={canCommand}
          onTab={(platform) => apply({ ...posRef.current, platform })}
          onRow={(focus) => apply({ ...posRef.current, focus })}
          onListing={(platform, field, text) => commit((v) => setListingField(v, platform, field, text))}
          onExport={exportCheck}
          onDownload={staticPlayer ? saveArchive : undefined}
        />
      </div>
    );
  } else {
    body = (
      <div className="flex h-full min-h-0 gap-4 px-4 pb-4 pt-3">
        {sidebar === "full" ? (
          <div className="shrink-0 overflow-y-auto pb-2 pr-0.5" style={{ width: SIDEBAR_W }}>
            <Sidebar value={value} position={position} base={base} t={t} keys={keys} onFocus={focusOn} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 overflow-y-auto pb-2">
          {sidebar === "compact" ? <CompactBar value={value} position={position} base={base} t={t} onFocus={focusOn} /> : null}
          {value.stickers.length ? (
            <StickerGrid value={value} position={position} base={base} t={t} now={now} columns={columns} onFocus={focusOn} />
          ) : (
            <Centered title={t.nextStep({ id: "stickers", line: "", message: { code: "next.stickers", params: {} } })} body={next?.line} />
          )}
        </div>
        {inspector && inspectorMode === "column" ? (
          <div className="min-h-0 shrink-0" style={{ width: inspectorW }}>
            {inspector}
          </div>
        ) : null}
        {inspector && inspectorMode === "overlay" ? <div className="absolute inset-2 z-30">{inspector}</div> : null}
      </div>
    );
  }

  return shell(
    <>
      <header className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-cc-border bg-cc-surface/50 px-4 pb-2.5 pt-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-cc-primary/12 text-cc-primary shadow-[inset_0_0_0_1px_rgba(249,115,22,0.28)]">
            <Icon.Sticker size={17} />
          </span>
          <div className="min-w-0">
            <div data-pack-title className="truncate text-[14px] font-semibold leading-tight text-cc-fg">{value.title || t.untitled}</div>
            <div className="text-[11px] text-cc-muted">{t.stickerCount(value.stickers.length, value.projectError ? null : ready)}</div>
          </div>
        </div>
        <Segmented
          label={t.viewsLabel}
          dataName="view"
          value={position.view}
          onChange={setView}
          options={[
            { value: "panel", label: t.view.panel, icon: <Icon.Grid size={13} /> },
            { value: "chat", label: t.view.chat, icon: <Icon.Chat size={13} /> },
            { value: "submit", label: t.view.submit, icon: <Icon.Checklist size={13} /> },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          {!canWrite ? (
            <Chip>
              <Icon.Lock size={11} />
              {t.readOnly}
            </Chip>
          ) : null}
          <Segmented
            label={t.plateLabel}
            dataName="plate"
            value={position.plate}
            onChange={(plate) => apply({ ...posRef.current, plate })}
            options={[
              { value: "light", label: t.plate.light, icon: <Swatch plate="light" /> },
              { value: "dark", label: t.plate.dark, icon: <Swatch plate="dark" /> },
            ]}
          />
        </div>
      </header>
      {next ? (
        <div data-next-step={next.id} className="flex shrink-0 items-center gap-2.5 border-b border-cc-border bg-cc-primary/[0.035] px-4 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-cc-primary">{t.next}</span>
          <span className="min-w-0 truncate text-[12px] font-medium text-cc-fg" title={next.line}>
            {t.nextStep(next)}
            {nextPlatform ? ` · ${nextPlatform}` : ""}
          </span>
          <span className="ml-auto" />
          {canCommand && missing ? (
            <Btn small primary data-command="make-missing" onClick={makeMissing}>
              <Icon.Spark size={12} />
              {t.makeMissing}
            </Btn>
          ) : null}
        </div>
      ) : null}
      {value.projectError ? (
        <div role="alert" data-project-error className="shrink-0 border-b border-cc-error/40 bg-cc-error/10 px-4 py-1.5 text-[11.5px] text-cc-error">
          {t.projectBroken(value.projectError)}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">{body}</div>
    </>,
  );
}
