/**
 * ELI5 Preview — the audience-ladder player.
 *
 * One topic, explained once per audience, played as a ladder: an ordered
 * rail of rungs across the top, the rung's page below it, and a compare
 * mode that puts two rungs side by side so the register shift between them
 * is visible at a glance (the point of the mode).
 *
 * It is a PLAYER, not an editor. The agent writes every manifest, page and
 * asset; this component renders, selects, navigates and reports. The
 * `explainer` source carries the structure (which topics, which rungs, in
 * what order), the `files` source carries the page HTML the iframes show,
 * and nothing here ever writes.
 *
 * The mechanisms below are slide's, adapted:
 *   - `srcdoc` + `<base href>` under the content route so a page's
 *     relative assets resolve (`viewer.serveDir: "."`);
 *   - the shared dormant selection script, so pointing at a paragraph
 *     becomes a `<viewer-context>` line;
 *   - `actionRequest` / `navigateRequest` both resolved by one runner, so
 *     an agent's `navigate-to` and a reader's locator card cannot disagree.
 *
 * What is deliberately NOT slide's: no viewport clamp, no zoom, no iframe
 * pool. An explainer page is a document that scrolls, and it carries its
 * own CSS inline, so there is no CDN flash to hide.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Source } from "../../../core/types/source.js";
import type {
  ViewerActionResult,
  ViewerAddress,
  ViewerFileContent,
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import type { AudienceEntry, Explainer } from "../domain.js";
import AudienceRail from "./AudienceRail.js";
import { anchorRequestForPane, type AnchorRequest } from "./anchor-relay.js";
import PagePane, { type PageSelectionPayload } from "./PagePane.js";
import { PAGE_SCRIPT } from "./page-script.js";
import {
  activeRungIndex,
  anchorVerdict,
  audienceAddress,
  buildPageSrcdoc,
  comparePaneIndex,
  findPageHtml,
  frameworkPath,
  nextRung,
  pageBaseHref,
  pagePath,
  readAddress,
  resolveNavigateTarget,
  rungKey,
  selectLadder,
} from "./player-logic.js";

/** Stable empty references — a fresh `[]` per render would thrash memos. */
const NO_FILES: ViewerFileContent[] = [];
const NO_AUDIENCES: AudienceEntry[] = [];

/** How long a notice about a refused navigation stays on screen. */
const NOTICE_MS = 6000;

export default function Eli5Preview({
  sources,
  onSelect: rawOnSelect,
  mode: rawPreviewMode,
  imageVersion,
  onActiveFileChange,
  activeFile,
  actionRequest,
  onActionResult,
  navigateRequest,
  onNavigateComplete,
  readonly,
}: ViewerPreviewProps) {
  // Replay: look, don't touch. Selection would write into a conversation
  // that already happened.
  const previewMode = readonly ? "view" : rawPreviewMode;
  const onSelect = useCallback(
    (selection: ViewerSelectionContext | null) => {
      if (!readonly) rawOnSelect(selection);
    },
    [readonly, rawOnSelect],
  );

  // ── Data ──────────────────────────────────────────────────────────────
  const explainerSource = sources.explainer as Source<Explainer> | undefined;
  const { value: explainer } = useSource(explainerSource);
  const filesSource = sources.files as Source<ViewerFileContent[]> | undefined;
  const { value: filesValue } = useSource(filesSource);
  const files = filesValue ?? NO_FILES;

  const activeContentSet = useStore((s) => s.activeContentSet);
  const contentSets = useStore((s) => s.contentSets);
  const setActiveContentSet = useStore((s) => s.setActiveContentSet);

  const ladder = useMemo(
    () => selectLadder(explainer, activeContentSet),
    [explainer, activeContentSet],
  );
  const prefix = ladder?.prefix ?? "";
  const audiences = ladder?.manifest.audiences ?? NO_AUDIENCES;

  const apiBase = useMemo(
    () =>
      import.meta.env.DEV
        ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`
        : "",
    [],
  );

  // ── Which rungs are on screen ─────────────────────────────────────────
  // State holds the WISH (an audience id), never an index: a content-set
  // switch replaces the whole ladder, and an index would silently land on
  // a different audience in the new topic.
  const [wantedId, setWantedId] = useState<string | null>(null);
  const [compareOn, setCompareOn] = useState(false);
  const [wantedCompareId, setWantedCompareId] = useState<string | null>(null);

  // The wish wins while it names a rung of THIS ladder; otherwise the
  // framework's `activeFile` — which on a resumed session or a replay is
  // the position the reader left off at — decides. `activeRungIndex`
  // documents the whole order.
  const activeIndex = useMemo(
    () => activeRungIndex(audiences, prefix, wantedId, activeFile),
    [audiences, prefix, wantedId, activeFile],
  );
  const activeAudience = audiences[activeIndex] ?? null;

  const compareIndex = useMemo(
    () => comparePaneIndex(audiences, activeIndex, wantedCompareId),
    [audiences, activeIndex, wantedCompareId],
  );
  const comparing = compareOn && audiences.length > 1;
  const compareAudience = comparing ? (audiences[compareIndex] ?? null) : null;

  // ── Pages ─────────────────────────────────────────────────────────────
  const pathSet = useMemo(() => new Set(files.map((f) => f.path)), [files]);
  const hasPage = useCallback(
    (audience: AudienceEntry) =>
      !!audience.file && pathSet.has(pagePath(prefix, audience.file)),
    [pathSet, prefix],
  );

  const renderPage = useCallback(
    (audience: AudienceEntry | null) => {
      if (!audience) return { html: null, srcdoc: null };
      const html = findPageHtml(files, prefix, audience.file);
      if (html === null) return { html: null, srcdoc: null };
      return {
        html,
        srcdoc: buildPageSrcdoc(html, {
          baseHref: pageBaseHref(apiBase, prefix, audience.file),
          script: PAGE_SCRIPT,
          imageVersion,
        }),
      };
    },
    [files, prefix, apiBase, imageVersion],
  );
  const activePage = useMemo(
    () => renderPage(activeAudience),
    [renderPage, activeAudience],
  );
  const comparePage = useMemo(
    () => renderPage(compareAudience),
    [renderPage, compareAudience],
  );

  // The page in view, in the framework's path space (stripped while a
  // content set is active) — the shape `activeFile` and `<viewer-context>`
  // both expect.
  const currentFile = activeAudience
    ? frameworkPath(prefix, activeAudience.file, activeContentSet)
    : "";
  // Report the position, never erase it. Two guards, each load-bearing:
  //
  //  - an empty `currentFile` is NOT reported as `null`. On first mount the
  //    ladder is still empty, and `App.tsx` restores the persisted position
  //    asynchronously — pushing `null` here races that restore and wipes the
  //    rung the reader left off at. A ladder that genuinely loses its pages
  //    is handled upstream: `workspace-slice` clears `activeFile` itself
  //    when the item list no longer contains it.
  //  - a value the store already holds is not re-sent, so the round trip
  //    (`activeFile` → rung → `currentFile` → `activeFile`) settles instead
  //    of writing on every render.
  useEffect(() => {
    if (!currentFile || currentFile === activeFile) return;
    onActiveFileChange?.(currentFile);
  }, [currentFile, activeFile, onActiveFileChange]);

  // ── Transient notice (a refused navigation has to be visible) ─────────
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  // ── Anchor scrolling (parent ↔ page, with a verdict) ──────────────────
  //
  // The timing lives in the pane's `AnchorRelay`, because only the pane
  // knows when its document is reachable: a rung switch mounts a fresh
  // opaque-origin iframe, and the budget for finding an element must not be
  // spent on that document's network. What stays here is the half only this
  // component can do — mint the sequence, name the rung the request is FOR,
  // and hold the promise the navigation runner is awaiting.
  const [anchorRequest, setAnchorRequest] = useState<AnchorRequest | null>(null);
  const anchorSeqRef = useRef(0);
  const anchorWaitersRef = useRef(new Map<number, (found: boolean) => void>());

  const requestAnchor = useCallback(
    (anchor: string, target: string | null) =>
      new Promise<boolean>((resolve) => {
        const seq = anchorSeqRef.current + 1;
        anchorSeqRef.current = seq;
        anchorWaitersRef.current.set(seq, resolve);
        setAnchorRequest({ seq, anchor, target });
      }),
    [],
  );

  const handleAnchorResult = useCallback((seq: number, found: boolean) => {
    // Retiring the request is what keeps a settled question from being
    // re-asked: a pane remounts with fresh state every time the reader
    // climbs back onto that rung, and a request still in its props would be
    // dispatched again — a page scrolling itself for a navigation that
    // finished long ago.
    setAnchorRequest((current) => (current && current.seq === seq ? null : current));
    const resolve = anchorWaitersRef.current.get(seq);
    if (!resolve) return; // already settled — a verdict arrives at most once
    anchorWaitersRef.current.delete(seq);
    resolve(found);
  }, []);

  // Unmounting mid-flight must not leave an action waiting forever on a
  // promise nobody can settle — the viewer is gone, so no page will ever
  // answer, and the agent's `navigate-to` would sit until the framework's
  // 60 s bound.
  useEffect(
    () => () => {
      for (const resolve of anchorWaitersRef.current.values()) resolve(false);
      anchorWaitersRef.current.clear();
    },
    [],
  );

  // Which pane may answer. A request names the rung it was issued for, and
  // only the pane standing on that rung ever receives it — so a reader who
  // climbs elsewhere while a page is still loading gets an honest miss for
  // the rung the agent named, instead of a scroll into a page that was
  // never addressed.
  const activeRungKey = rungKey(prefix, activeAudience?.id);
  const mainAnchorRequest = anchorRequestForPane(anchorRequest, activeRungKey);

  // A request whose rung is not on screen belongs to no pane, so nothing
  // will ever answer it. Settle it here, where the ladder is known: the
  // navigation itself succeeded (the reader is somewhere real), and the
  // anchor is honestly reported as missed rather than left pending until
  // the framework's own 60 s bound gives up on the action.
  useEffect(() => {
    if (!anchorRequest || mainAnchorRequest) return;
    handleAnchorResult(anchorRequest.seq, false);
  }, [anchorRequest, mainAnchorRequest, handleAnchorResult]);

  // ── Selection ─────────────────────────────────────────────────────────
  const pickAudience = useCallback(
    (id: string) => {
      const audience = audiences.find((a) => a.id === id);
      if (!audience) return;
      setWantedId(id);
      onSelect({
        type: "section",
        content: audience.label,
        file: frameworkPath(prefix, audience.file, activeContentSet),
        label: audience.label,
        address: audienceAddress(audience, activeContentSet),
      });
    },
    [audiences, prefix, activeContentSet, onSelect],
  );

  const selectInPage = useCallback(
    (audience: AudienceEntry | null, payload: PageSelectionPayload | null) => {
      if (!audience) return;
      if (!payload) {
        onSelect(null);
        return;
      }
      onSelect({
        type: payload.type,
        content: payload.content,
        level: payload.level,
        file: frameworkPath(prefix, audience.file, activeContentSet),
        tag: payload.tag,
        classes: payload.classes,
        selector: payload.selector,
        // Coarse rung + fine anchor: exactly what `navigate-to`, `capture`
        // and a `<viewer-locator>` take back.
        address: audienceAddress(audience, activeContentSet, payload.selector),
        thumbnail: payload.thumbnail,
        label: payload.label,
        nearbyText: payload.nearbyText,
        accessibility: payload.accessibility,
      });
    },
    [prefix, activeContentSet, onSelect],
  );

  const selectInActivePage = useCallback(
    (payload: PageSelectionPayload | null) => selectInPage(activeAudience, payload),
    [selectInPage, activeAudience],
  );
  const selectInComparePage = useCallback(
    (payload: PageSelectionPayload | null) => selectInPage(compareAudience, payload),
    [selectInPage, compareAudience],
  );

  // ── The one navigation runner (agent action + locator card) ───────────
  const runNavigate = useCallback(
    async (rawAddress: unknown): Promise<ViewerActionResult> => {
      const address = readAddress(rawAddress);
      if (!address) {
        const message = "navigate-to needs an address, e.g. { audience: \"manager\" }.";
        showNotice(message);
        return { success: false, message };
      }
      const target = resolveNavigateTarget(
        explainer,
        activeContentSet,
        contentSets,
        address,
      );
      if (!target.ok) {
        // A locator card whose address names nothing must say so where the
        // reader is looking; the same sentence goes back to the agent.
        showNotice(target.message);
        return { success: false, message: target.message };
      }

      if (target.switchTo) setActiveContentSet(target.switchTo);
      if (target.audienceId) setWantedId(target.audienceId);

      if (!target.anchor) return { success: true };

      const manifest = explainer?.byContentSet[target.prefix];
      const rung = manifest?.audiences.find((a) => a.id === target.audienceId);
      const where = rung?.label ?? manifest?.title ?? "the page";
      // The request is stamped with the rung the ADDRESS named — resolved,
      // not observed — so that the pane which ends up showing that rung is
      // the only one allowed to answer it. An address that named no rung
      // (topic + anchor) is stamped null: it means "wherever the reader is".
      const found = await requestAnchor(
        target.anchor,
        rung ? rungKey(target.prefix, rung.id) : null,
      );
      // The page landed — that is what `success` reports. The anchor is
      // the fine half, and a miss is a fact the agent should hear without
      // being told the navigation failed. It also has to be a fact the
      // READER can see: a `success: true` message is dropped by
      // `resolveNavigate`, so the caveat would otherwise die between a
      // locator card and the person who clicked it.
      const verdict = anchorVerdict(found, where, target.anchor);
      if (verdict.notice) showNotice(verdict.notice);
      return verdict.result;
    },
    [
      explainer,
      activeContentSet,
      contentSets,
      setActiveContentSet,
      requestAnchor,
      showNotice,
    ],
  );

  // Agent → viewer. `capture` never arrives here: the runtime masks it and
  // handles it framework-side (`src/hooks/useCaptureAction.ts`), driving
  // this viewer through `navigateRequest` first when the address names a
  // rung.
  const runNavigateRef = useRef(runNavigate);
  runNavigateRef.current = runNavigate;

  useEffect(() => {
    if (!actionRequest) return;
    const { requestId, actionId, params } = actionRequest;
    if (actionId !== "navigate-to") {
      onActionResult?.(requestId, {
        success: false,
        message: `Unknown action: ${actionId}`,
      });
      return;
    }
    let cancelled = false;
    runNavigateRef.current(params?.address).then((result) => {
      if (!cancelled) onActionResult?.(requestId, result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRequest]);

  // Locator card → viewer. `contentSet` has already been resolved by the
  // store (`planNavigate`), so what arrives here is the rest of the
  // address; the verdict rides back so the card can show a failure.
  useEffect(() => {
    if (!navigateRequest) return;
    let cancelled = false;
    runNavigateRef.current(navigateRequest.address).then((result) => {
      if (!cancelled) onNavigateComplete?.(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRequest]);

  // ── Compare ───────────────────────────────────────────────────────────
  const toggleCompare = useCallback(() => {
    if (compareOn) {
      setCompareOn(false);
      return;
    }
    // Snapshot the default partner once, so the second pane holds still
    // while the reader climbs the ladder in the first.
    const fallback = audiences[nextRung(activeIndex, audiences.length)]?.id ?? null;
    setWantedCompareId((prev) =>
      prev && prev !== activeAudience?.id && audiences.some((a) => a.id === prev)
        ? prev
        : fallback,
    );
    setCompareOn(true);
  }, [compareOn, audiences, activeIndex, activeAudience]);

  const selectMode = previewMode === "select" || previewMode === "annotate";

  if (!ladder) return <EmptyState />;

  const manifest = ladder.manifest;

  return (
    <div className="flex h-full min-h-0 flex-col bg-cc-bg text-cc-fg">
      <header className="shrink-0 border-b border-cc-border/60 bg-cc-surface/40 backdrop-blur">
        <div className="flex items-center gap-3 px-4 pt-3">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
            {manifest.title}
          </h1>
          {manifest.language && (
            <span className="shrink-0 rounded-full border border-cc-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-cc-muted">
              {manifest.language}
            </span>
          )}
          <button
            type="button"
            onClick={toggleCompare}
            disabled={audiences.length < 2}
            title={
              audiences.length < 2
                ? "Compare needs at least two audiences"
                : "Show two audiences side by side"
            }
            aria-pressed={comparing}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-cc-primary/60 disabled:cursor-not-allowed disabled:opacity-40 ${
              comparing
                ? "border-cc-primary/60 bg-cc-primary/15 text-cc-primary"
                : "border-cc-border bg-cc-surface/60 text-cc-muted hover:border-cc-primary/40 hover:text-cc-fg"
            }`}
          >
            Compare
          </button>
        </div>
        <div className="flex items-center px-4 pb-2.5 pt-2">
          {audiences.length > 0 ? (
            <AudienceRail
              audiences={audiences}
              activeId={activeAudience?.id ?? null}
              compareId={comparing ? (compareAudience?.id ?? null) : null}
              hasPage={hasPage}
              onPick={pickAudience}
            />
          ) : (
            <p className="text-xs text-cc-muted">
              No audiences yet — ask the agent who this should be explained to.
            </p>
          )}
        </div>
        {notice && (
          <div
            role="status"
            className="border-t border-cc-primary/30 bg-cc-primary/10 px-4 py-1.5 text-[11px] leading-relaxed text-cc-primary"
          >
            {notice}
          </div>
        )}
      </header>

      <main className="flex min-h-0 flex-1 gap-3 p-3">
        <PagePane
          key={`main-${activeRungKey}`}
          audience={activeAudience}
          html={activePage.html}
          srcdoc={activePage.srcdoc}
          selectMode={selectMode}
          anchorRequest={mainAnchorRequest}
          onAnchorResult={handleAnchorResult}
          onSelectElement={selectInActivePage}
          header={
            comparing ? (
              <PaneHeader
                caption="In view"
                audiences={audiences}
                valueId={activeAudience?.id ?? null}
                onChange={pickAudience}
              />
            ) : undefined
          }
        />
        {comparing && (
          <PagePane
            key={`compare-${rungKey(prefix, compareAudience?.id)}`}
            audience={compareAudience}
            html={comparePage.html}
            srcdoc={comparePage.srcdoc}
            selectMode={selectMode}
            onSelectElement={selectInComparePage}
            header={
              <PaneHeader
                caption="Compared with"
                audiences={audiences}
                valueId={compareAudience?.id ?? null}
                onChange={setWantedCompareId}
              />
            }
          />
        )}
      </main>
    </div>
  );
}

/** The per-pane audience picker, shown only while comparing. */
function PaneHeader({
  caption,
  audiences,
  valueId,
  onChange,
}: {
  caption: string;
  audiences: AudienceEntry[];
  valueId: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-2 flex shrink-0 items-center gap-2">
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-cc-muted">
        {caption}
      </span>
      <select
        aria-label={caption}
        value={valueId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 truncate rounded-md border border-cc-border bg-cc-surface/70 px-2 py-1 text-xs text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
      >
        {audiences.map((audience, i) => (
          <option key={audience.id} value={audience.id}>
            {i + 1}. {audience.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-cc-bg px-8 text-center">
      <div className="max-w-sm">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mx-auto h-10 w-10 text-cc-primary/70"
          aria-hidden="true"
        >
          <path d="M21 4.5v9a1.5 1.5 0 0 1-1.5 1.5H12l-4.5 3.75V15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5Z" />
          <path d="M12 4.5a2.75 2.75 0 0 0-1.65 4.95c.34.26.55.65.55 1.08v.22h2.2v-.22c0-.43.21-.82.55-1.08A2.75 2.75 0 0 0 12 4.5ZM10.9 12.8h2.2" />
        </svg>
        <h2 className="mt-5 text-base font-semibold tracking-tight text-cc-fg">
          Explain anything to anyone
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-cc-muted">
          Name a topic and who it needs to land with — a five-year-old, your
          manager, the engineer on call. Each audience gets its own page, and
          they stack up here as a ladder you can climb.
        </p>
      </div>
    </div>
  );
}
