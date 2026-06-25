/**
 * WordtastePreview — the Taste Writing Studio (the showpiece viewer), v2 IA.
 *
 * A writer's reading room, not a dashboard. The studio is content-first:
 *
 *   CENTER  The article body — and NOTHING else. The protagonist. Rendered in
 *           the active reading SKIN (a warm serif day page, a clean sans page,
 *           a calm night page). Block-addressed prose: span-select → instant
 *           5-direction popup; per-block freeze/poke/mask hover chrome;
 *           agent-rewrite pulse; a quiet dense-block readability cue. When the
 *           agent has written revision notes, an ANNOTATION column opens on the
 *           right, each note aligned to the block it annotates (批注模式).
 *
 *   LEFT    A slim ICON RAIL. All panels default-collapsed so the article gets
 *           full width. Three stacked entries (top→bottom): Materials (read-only
 *           inputs), Taste (the learned profile — moved here from the old right
 *           column), Theme (the skin switcher). Click an icon → a generous,
 *           readable flyout opens over the studio edge; accordion (one open at a
 *           time); click again / click-away / Esc collapses it.
 *
 * TopBar (the viewer's own header strip): content-set switcher, the
 * human-temperature rung dial, the family chip, the annotation toggle (only
 * when notes exist), and the view/select toggle.
 *
 * THE NOTIFICATION DISCIPLINE (paid-for bug fix): an idle session — the agent
 * editing draft.md while the user does nothing — emits ZERO unsolicited
 * notifications. Readability is a PASSIVE visual cue only; it is NEVER sent to
 * the agent. `request-directions` fires EXACTLY ONCE per genuine user selection
 * mouseup, and from no other path — never from an effect that depends on a
 * churning memo. The only agent-bound notifications are direct user gestures
 * (chip click, poke, mask, dial-up, command buttons).
 *
 * The aggregate-file sources are root-only (the framework never passes a
 * content-set to load), so content for the ACTIVE content set is derived from
 * the raw file snapshot via studio-logic. The source subscription is what
 * drives re-render + the external-origin pulse signal.
 *
 * Design tokens: the studio CHROME stays on Ethereal Tech `cc-*` tokens; the
 * reading surface layers the active skin's CSS custom properties on top. Orange
 * (cc-primary) is rationed to one focus at a time. Glass (backdrop-blur) only on
 * elevated instruments (popup, TopBar, flyouts).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import type { Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import type {
  Draft,
  DraftBlock,
  TasteProfile,
  Symptom,
  DraftAnnotations,
  BlockAnnotation,
} from "../domain.js";
import { annotationsForBlock, hasAnnotations } from "../domain.js";
import {
  rungLabel,
  RUNG_SCALE_CAPTION,
  applyLadder,
  clampRung,
  MAX_RUNG,
  MIN_RUNG,
  DEFAULT_DIRECTIONS,
  chipsFromProposal,
  buildSpanHandle,
  buildAddress,
  denseBlockIds,
  deriveDraft,
  deriveTaste,
  deriveAnnotations,
  layoutAnnotations,
  type DirectionChip,
  type WordtasteAddress,
} from "./studio-logic.js";
import { SKINS, resolveSkin, skinCssVars, type Skin } from "./skins.js";

interface CrossFamily {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

interface WordtasteConfig {
  rung?: number;
  contentType?: string;
  /** The user's chosen reading skin id (wins over the agent suggestion). */
  skin?: string;
  /** The agent's content-register skin hint (fallback when the user has not chosen). */
  skinSuggested?: string;
  [k: string]: unknown;
}

/** Which left-rail panel is expanded (only one at a time — accordion). */
type RailPanel = "materials" | "taste" | "theme" | null;

/** A live popup anchored to a selection rect, carrying the address it acts on. */
interface PopupState {
  address: WordtasteAddress;
  chips: DirectionChip[];
  /** Viewport-relative rect of the selection, for placement. */
  rect: { top: number; bottom: number; left: number; right: number };
  /** True once the agent's contextual chips have replaced the defaults. */
  refined: boolean;
}

/** A block currently regenerating (mask-and-complete / rewrite in flight). */
interface RegenState {
  blocks: Set<string>;
}

export default function WordtastePreview(props: ViewerPreviewProps) {
  const {
    sources,
    onSelect: rawOnSelect,
    onNotifyAgent: rawOnNotifyAgent,
    actionRequest,
    onActionResult,
    navigateRequest,
    onNavigateComplete,
    readonly,
    mode: previewMode,
    fileChannel,
  } = props;

  // Replay (readonly) suppresses every mutating affordance (brief §6.3).
  const onNotifyAgent = readonly ? undefined : rawOnNotifyAgent;
  const onSelect = readonly ? undefined : rawOnSelect;

  const activeContentSet = useStore((s) => s.activeContentSet);
  const contentSets = useStore((s) => s.contentSets);
  const setActiveContentSet = useStore((s) => s.setActiveContentSet);
  const cs = activeContentSet ?? "";

  // ── Sources: subscribe for reactivity + origin; derive content per set ──────
  const draftSource = sources.draft as Source<Draft> | undefined;
  const tasteSource = sources.taste as Source<TasteProfile> | undefined;
  const annotationsSource = sources.annotations as Source<DraftAnnotations> | undefined;
  const configSource = sources.config as Source<WordtasteConfig> | undefined;
  const { status: draftStatus } = useSource<Draft>(draftSource);
  // The taste/annotation sources are consumed for their reactivity; content is
  // derived from the snapshot below so it is content-set scoped.
  useSource<TasteProfile>(tasteSource);
  useSource<DraftAnnotations>(annotationsSource);
  const { value: config, write: writeConfig } = useSource<WordtasteConfig>(configSource);
  const { value: crossFamily, status: crossFamilyStatus } = useSource<CrossFamily>(
    sources.crossFamily as Source<CrossFamily> | undefined,
  );
  // The crossFamily source starts null and only resolves once the probe's file
  // lands. Until it has resolved at least once we must NOT assert a family
  // count (Bug 3) — gate the chip + banner on this.
  const familyResolved = crossFamilyStatus.lastOrigin !== null;

  // A monotonically-rising tick that re-derives content whenever ANY watched
  // file changes (the source fires; we bump). Decoupled from the source value
  // because that value is root-only.
  const [fileTick, setFileTick] = useState(0);
  useEffect(() => {
    const off = fileChannel.subscribe(() => setFileTick((t) => t + 1));
    return off;
  }, [fileChannel]);

  const draft = useMemo<Draft | null>(
    () => deriveDraft(fileChannel.snapshot(), cs),
    [fileChannel, cs, fileTick, draftStatus.lastOrigin],
  );
  const taste = useMemo<TasteProfile | null>(
    () => deriveTaste(fileChannel.snapshot(), cs),
    [fileChannel, cs, fileTick],
  );
  const annotations = useMemo<DraftAnnotations | null>(
    () => deriveAnnotations(fileChannel.snapshot(), cs),
    [fileChannel, cs, fileTick],
  );
  const materials = useMemo(
    () => collectMaterials(fileChannel.snapshot(), cs),
    [fileChannel, cs, fileTick],
  );

  // ── Active reading skin (config-persisted; user > agent > default) ──────────
  const skin = useMemo(() => resolveSkin(config), [config?.skin, config?.skinSuggested]);
  const skinVars = useMemo(() => skinCssVars(skin) as React.CSSProperties, [skin]);

  const setSkin = useCallback(
    (id: string) => {
      if (readonly) return;
      void writeConfig({ ...(config ?? {}), skin: id });
    },
    [config, writeConfig, readonly],
  );

  // ── Rung (config-persisted, human-temperature dial) ─────────────────────────
  const rung = clampRung(typeof config?.rung === "number" ? config.rung : (taste?.launchRung ?? 1));

  const persistRung = useCallback(
    (next: number) => {
      if (readonly) return;
      void writeConfig({ ...(config ?? {}), rung: clampRung(next) });
    },
    [config, writeConfig, readonly],
  );

  // ── Regenerating-block + pulse tracking (the external-event affordance) ─────
  const [regen, setRegen] = useState<RegenState>({ blocks: new Set() });
  const [pulseBlocks, setPulseBlocks] = useState<Set<string>>(new Set());
  const prevBlockHashRef = useRef<Map<string, string>>(new Map());

  // When an external draft change lands, clear any regen markers for blocks
  // that changed and pulse them once (brief §5.4). User self-writes are skipped.
  useEffect(() => {
    if (!draft) return;
    const next = new Map<string, string>();
    for (const b of draft.blocks) next.set(b.id, b.markdown);

    if (draftStatus.lastOrigin === "external") {
      const changed: string[] = [];
      for (const b of draft.blocks) {
        if (prevBlockHashRef.current.get(b.id) !== b.markdown) changed.push(b.id);
      }
      if (changed.length > 0) {
        setRegen((r) => {
          const blocks = new Set(r.blocks);
          for (const id of changed) blocks.delete(id);
          return { blocks };
        });
        setPulseBlocks(new Set(changed));
        const t = setTimeout(() => setPulseBlocks(new Set()), 1200);
        prevBlockHashRef.current = next;
        return () => clearTimeout(t);
      }
    }
    prevBlockHashRef.current = next;
  }, [draft, draftStatus.lastOrigin]);

  // ── Readability — a PASSIVE visual cue ONLY (NEVER an agent notification) ────
  // The dense set is derived for the quiet in-margin marker. It is intentionally
  // NOT wired to onNotifyAgent: the old readability-check effect fired on every
  // dense-set change, and because the agent rewriting draft.md churns that set,
  // it created a notify → rewrite → re-notify feedback loop. Readability is the
  // orthogonal axis; the user can SEE the cue, the agent is never pinged by it.
  const dense = useMemo(() => denseBlockIds(draft), [draft]);

  // ── The span-select popup ────────────────────────────────────────────────────
  const [popup, setPopup] = useState<PopupState | null>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  // Track the address the most recent request-directions was fired for, so a
  // late propose-directions only refreshes the still-open popup.
  const pendingDirectionsRef = useRef<string | null>(null);

  const dismissPopup = useCallback(() => {
    setPopup(null);
    pendingDirectionsRef.current = null;
  }, []);

  const isSelectMode = previewMode === "select";

  // mouseup over a text range inside a block → build address, show popup
  // instantly, fire request-directions ONCE (brief §5.1). This is the ONLY path
  // that emits request-directions — it lives in a user-gesture handler, never in
  // an effect, so no render/draft-update can re-emit it.
  const handleMouseUp = useCallback(() => {
    if (readonly || !draft) return;
    const winSel = window.getSelection();
    const text = winSel?.toString() ?? "";
    if (!text.trim() || text.trim().length < 2) return;
    const anchor = winSel?.anchorNode;
    const blockEl =
      (anchor as Element | null)?.parentElement?.closest("[data-block-id]") ??
      (anchor as Element | null)?.closest?.("[data-block-id]");
    const blockId = (blockEl as HTMLElement | null)?.dataset.blockId;
    if (!blockId) return;
    const block = draft.blocks.find((b) => b.id === blockId);
    if (!block || block.frozen) return; // frozen blocks refuse rewrite targeting

    const span = buildSpanHandle(block.markdown, text);
    const address = buildAddress({
      contentSet: cs,
      block: blockId,
      span,
      frozen: block.frozen,
      rung,
      symptoms: [],
    });

    const range = winSel?.rangeCount ? winSel.getRangeAt(0).getBoundingClientRect() : null;
    const rect = range
      ? { top: range.top, bottom: range.bottom, left: range.left, right: range.right }
      : { top: 0, bottom: 0, left: 0, right: 0 };

    setPopup({ address, chips: DEFAULT_DIRECTIONS, rect, refined: false });

    // Report the selection so extractContext grounds any chat message in this
    // exact address (one noun, every verb).
    const sel: ViewerSelectionContext = {
      type: span ? "span" : "block",
      content: text.trim().slice(0, 300),
      file: cs ? `${cs}/draft.md` : "draft.md",
      address,
      label: `block ${blockId}`,
    };
    onSelect?.(sel);

    // Fire request-directions ONCE for this selection (the agent refines chips).
    const key = JSON.stringify(address);
    pendingDirectionsRef.current = key;
    onNotifyAgent?.({
      type: "request-directions",
      severity: "warning",
      message: `The user selected a passage to rewrite. Read the taste rubric and the span, then call the propose-directions action with ~5 taste-aware directions for this address. Address: ${key} — selected text: "${text
        .trim()
        .slice(0, 200)}"`,
      summary: "/request-directions",
    });
  }, [readonly, draft, cs, rung, onSelect, onNotifyAgent]);

  // Click a direction chip → dispatch the rewrite intent. The agent writes
  // draft.md directly; the action is the signal — so we mark the block as
  // regenerating and let the external event clear it + pulse (brief §5.1/§5.4).
  const dispatchRewrite = useCallback(
    (chip: DirectionChip) => {
      if (!popup || readonly) return;
      const address = chip.symptom ? { ...popup.address, symptoms: [chip.symptom] } : popup.address;
      setRegen((r) => ({ blocks: new Set(r.blocks).add(address.block) }));
      onNotifyAgent?.({
        type: "rewrite-span",
        severity: "warning",
        message: `Rewrite this passage in the direction "${chip.label}". Stay inside the frozen kernel; only break structure and texture. Edit draft.md directly, then signal with the rewrite-span action, and write a one-line note to draft.annotations.json for this block. Address: ${JSON.stringify(
          address,
        )}`,
        summary: `/rewrite · ${chip.label}`,
      });
      dismissPopup();
    },
    [popup, readonly, onNotifyAgent, dismissPopup],
  );

  // ── Per-block chrome: freeze (in-viewer write) + poke + mask ─────────────────
  const toggleFreeze = useCallback(
    (blockId: string) => {
      if (readonly || !draft) return;
      const next: Draft = {
        contentSet: draft.contentSet,
        blocks: draft.blocks.map((b) =>
          b.id === blockId ? { ...b, frozen: !b.frozen } : b,
        ),
      };
      void draftSource?.write(next);
    },
    [readonly, draft, draftSource],
  );

  const pokeSymptom = useCallback(
    (block: DraftBlock, symptom: Symptom) => {
      if (readonly) return;
      const address = buildAddress({
        contentSet: cs,
        block: block.id,
        frozen: block.frozen,
        rung,
        symptoms: [symptom.id],
      });
      onNotifyAgent?.({
        type: "poke-symptom",
        severity: "warning",
        message: `The user tagged ${symptom.id} (${symptom.title}) on this block. Run the cross-family surgical fix for that symptom, edit draft.md, then signal with poke-symptom. Address: ${JSON.stringify(
          address,
        )}`,
        summary: `/poke · ${symptom.id}`,
      });
    },
    [readonly, cs, rung, onNotifyAgent],
  );

  const maskAndComplete = useCallback(
    (block: DraftBlock, scope: "region" | "after") => {
      if (readonly) return;
      const address = buildAddress({
        contentSet: cs,
        block: block.id,
        frozen: block.frozen,
        rung,
      });
      setRegen((r) => ({ blocks: new Set(r.blocks).add(block.id) }));
      onNotifyAgent?.({
        type: "mask-and-complete",
        severity: "warning",
        message:
          scope === "after"
            ? `Continue the draft from this block onward (skip frozen blocks, they are fixed). Edit draft.md, then signal mask-and-complete with scope "after". Address: ${JSON.stringify(address)}`
            : `Regenerate this region. Edit draft.md, then signal mask-and-complete with scope "region". Address: ${JSON.stringify(address)}`,
        summary: scope === "after" ? "/continue" : "/regenerate",
      });
    },
    [readonly, cs, rung, onNotifyAgent],
  );

  // ── Rung dial commands ───────────────────────────────────────────────────────
  const setRung = useCallback((next: number) => persistRung(next), [persistRung]);

  const dialUpStillAi = useCallback(() => {
    if (readonly) return;
    const next = applyLadder(rung, { delta: 1 });
    persistRung(next);
    onNotifyAgent?.({
      type: "still-ai",
      severity: "warning",
      message: `Still reads AI. Bumped the disruption to "${rungLabel(
        next,
      )}". Regenerate the whole draft one-shot at this level, preserving every frozen block. Then re-run the symptom rubric.`,
      summary: "/still-ai",
    });
  }, [readonly, rung, persistRung, onNotifyAgent]);

  // ── Entry + finalize commands (chat-bypassing) ───────────────────────────────
  const fireCommand = useCallback(
    (id: string, label: string, description: string) => {
      onNotifyAgent?.({
        type: "wordtaste-command",
        severity: "warning",
        message: `The user clicked the "${label}" command. ${description}`,
        summary: `/${id}`,
      });
    },
    [onNotifyAgent],
  );

  // ── Export the article body (draft.md) as a clean .md download ───────────────
  // The export is the article ALONE — no annotation column, no reading skin, no
  // meta. draft.md is already pure body-only markdown, so the server route just
  // streams it back with a download-safe filename. Relative URL so Vite's
  // /export proxy reaches whichever backend port the server landed on. Mirrors
  // kami's window.open export gesture (KamiPreview#handleExport).
  const exportMarkdown = useCallback(() => {
    const qs = new URLSearchParams();
    if (cs) qs.set("contentSet", cs);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    window.open(`/export/wordtaste/download${suffix}`, "_blank");
  }, [cs]);

  // ── Agent → Viewer actions (propose-directions, navigate-to, mark-resolved) ──
  useEffect(() => {
    if (!actionRequest) return;
    const { actionId, params, requestId } = actionRequest;
    switch (actionId) {
      case "propose-directions": {
        const addr = params?.address as WordtasteAddress | undefined;
        const key = addr ? JSON.stringify({ ...addr, frozen: undefined, rung: undefined }) : null;
        setPopup((p) => {
          if (!p) return p;
          const pKey = JSON.stringify({ ...p.address, frozen: undefined, rung: undefined });
          if (key && key !== pKey) return p;
          return { ...p, chips: chipsFromProposal(params?.directions), refined: true };
        });
        onActionResult?.(requestId, { success: true });
        break;
      }
      case "navigate-to": {
        const addr = params?.address as WordtasteAddress | undefined;
        if (addr?.block) scrollToBlock(centerRef.current, addr.block);
        onActionResult?.(requestId, { success: true });
        break;
      }
      case "mark-resolved": {
        const addr = params?.address as WordtasteAddress | undefined;
        if (addr?.block) {
          setRegen((r) => {
            const blocks = new Set(r.blocks);
            blocks.delete(addr.block);
            return { blocks };
          });
        }
        dismissPopup();
        onActionResult?.(requestId, { success: true });
        break;
      }
      case "set-block-frozen": {
        const block = params?.block as string | undefined;
        if (block) toggleFreeze(block);
        onActionResult?.(requestId, { success: true });
        break;
      }
      case "set-ladder": {
        const next = applyLadder(rung, {
          rung: typeof params?.rung === "number" ? (params.rung as number) : undefined,
          delta: typeof params?.delta === "number" ? (params.delta as number) : undefined,
        });
        persistRung(next);
        onActionResult?.(requestId, { success: true, data: { rung: next } });
        break;
      }
      case "rewrite-span":
      case "mask-and-complete":
        onActionResult?.(requestId, { success: true });
        break;
      case "poke-symptom":
        onActionResult?.(requestId, { success: true });
        break;
      default:
        onActionResult?.(requestId, { success: false, message: `Unknown action: ${actionId}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRequest]);

  // ── Locator navigation (chat cards) ──────────────────────────────────────────
  useEffect(() => {
    if (!navigateRequest) return;
    const block = navigateRequest.address?.block;
    if (typeof block === "string") scrollToBlock(centerRef.current, block);
    onNavigateComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRequest]);

  // Esc dismisses the popup (popup only — not the gallery rules).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && popup) {
        e.stopPropagation();
        dismissPopup();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popup, dismissPopup]);

  // ── Left rail (accordion) + annotation column ────────────────────────────────
  const [railPanel, setRailPanel] = useState<RailPanel>(null);
  const toggleRail = useCallback(
    (panel: Exclude<RailPanel, null>) => setRailPanel((p) => (p === panel ? null : panel)),
    [],
  );
  const closeRail = useCallback(() => setRailPanel(null), []);

  const annotationsPresent = useMemo(() => hasAnnotations(annotations), [annotations]);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const annotationColumnOpen = annotationsPresent && showAnnotations;

  const setSelectMode = useStore((s) => s.setPreviewMode);

  // Resolve a concrete family triple, with the cold-start floor (brief §7.2).
  const resolvedFamilies: CrossFamily = crossFamily ?? {
    claude: true,
    codex: false,
    gemini: false,
  };
  const missingFamilies = (["codex", "gemini"] as const).filter(
    (f) => !resolvedFamilies[f],
  );
  const familyDegraded = familyResolved && missingFamilies.length >= 2;

  return (
    <div className="wordtaste-studio">
      <WordtasteStyles />
      <StudioTopBar
        contentSets={contentSets.map((c) => ({ prefix: c.prefix, label: c.label }))}
        activeContentSet={cs}
        onContentSet={(p) => setActiveContentSet(p)}
        rung={rung}
        onRung={setRung}
        onDialUp={dialUpStillAi}
        crossFamily={resolvedFamilies}
        familyResolved={familyResolved}
        selectMode={isSelectMode}
        onToggleSelect={() => setSelectMode(isSelectMode ? "view" : "select")}
        annotationsPresent={annotationsPresent}
        annotationsOn={showAnnotations}
        onToggleAnnotations={() => setShowAnnotations((v) => !v)}
        canExport={!!draft && draft.blocks.length > 0}
        onExport={exportMarkdown}
        readonly={readonly}
      />

      <div className="wordtaste-body">
        {/* LEFT — slim icon rail (all panels collapsed by default) */}
        <LeftRail
          active={railPanel}
          onToggle={toggleRail}
          materialsCount={materials.length}
          tasteReady={!!taste}
        />

        {/* The expanded flyout for the active rail panel (accordion) */}
        {railPanel && (
          <RailFlyout title={railPanelTitle(railPanel)} onClose={closeRail}>
            {railPanel === "materials" && <MaterialsPanel materials={materials} />}
            {railPanel === "taste" && (
              <TastePanel
                taste={taste}
                rung={rung}
                familyDegraded={familyDegraded}
                missingFamilies={missingFamilies}
              />
            )}
            {railPanel === "theme" && (
              <ThemePanel
                activeSkinId={skin.id}
                suggestedSkinId={
                  typeof config?.skinSuggested === "string" ? config.skinSuggested : undefined
                }
                onPick={setSkin}
                readonly={readonly}
              />
            )}
          </RailFlyout>
        )}

        {/* CENTER — the article body, and nothing else */}
        <section
          className={`wordtaste-center ${annotationColumnOpen ? "has-annotations" : ""}`}
          aria-label="The Draft"
          style={skinVars}
        >
          <div
            ref={centerRef}
            className="wordtaste-draft-scroll"
            onMouseUp={isSelectMode ? handleMouseUp : undefined}
          >
            {draft && draft.blocks.length > 0 ? (
              <div className="wordtaste-reading">
                <article className="wordtaste-prose">
                  {draft.blocks.map((b) => (
                    <BlockView
                      key={b.id}
                      block={b}
                      rubric={taste?.rubric ?? []}
                      dense={dense.includes(b.id)}
                      regenerating={regen.blocks.has(b.id)}
                      pulsing={pulseBlocks.has(b.id)}
                      readonly={!!readonly}
                      onFreeze={() => toggleFreeze(b.id)}
                      onPoke={(s) => pokeSymptom(b, s)}
                      onMask={(scope) => maskAndComplete(b, scope)}
                    />
                  ))}
                </article>
                {annotationColumnOpen && (
                  <AnnotationColumn
                    blocks={draft.blocks}
                    annotations={annotations}
                    scrollRef={centerRef}
                  />
                )}
              </div>
            ) : (
              <DraftEmpty
                onStartIdea={() =>
                  fireCommand(
                    "start-from-idea",
                    "Write from this outline",
                    "Generate the first cross-family draft from the materials/outline.",
                  )
                }
                onStartDraft={() =>
                  fireCommand(
                    "start-from-draft",
                    "De-AI this draft",
                    "Intake the disliked draft, freeze the kernel, run the first disruption pass.",
                  )
                }
                readonly={readonly}
              />
            )}
          </div>

          {/* Finalize bar — the cheapest "good enough" signal */}
          {!readonly && draft && draft.blocks.length > 0 && (
            <div className="wordtaste-finalize">
              <button
                type="button"
                className="wordtaste-finalize-btn"
                onClick={() =>
                  fireCommand(
                    "good-enough",
                    "This is good — finalize",
                    "Trigger the finalize + distill pass.",
                  )
                }
              >
                This reads right — finalize
              </button>
            </div>
          )}
        </section>
      </div>

      {popup &&
        centerRef.current &&
        createPortal(
          <DirectionPopup popup={popup} onPick={dispatchRewrite} onDismiss={dismissPopup} />,
          document.body,
        )}
    </div>
  );
}

function railPanelTitle(p: Exclude<RailPanel, null>): string {
  return p === "materials" ? "Materials" : p === "taste" ? "Taste" : "Theme";
}

// ── Left icon rail ─────────────────────────────────────────────────────────────

function LeftRail({
  active,
  onToggle,
  materialsCount,
  tasteReady,
}: {
  active: RailPanel;
  onToggle: (panel: Exclude<RailPanel, null>) => void;
  materialsCount: number;
  tasteReady: boolean;
}) {
  return (
    <nav className="wordtaste-rail" aria-label="Studio panels">
      <RailButton
        active={active === "materials"}
        label="Materials"
        badge={materialsCount > 0 ? materialsCount : undefined}
        onClick={() => onToggle("materials")}
      >
        <MaterialsIcon />
      </RailButton>
      <RailButton
        active={active === "taste"}
        label="Taste"
        dot={tasteReady}
        onClick={() => onToggle("taste")}
      >
        <TasteIcon />
      </RailButton>
      <div className="wordtaste-rail-spacer" />
      <RailButton active={active === "theme"} label="Theme" onClick={() => onToggle("theme")}>
        <ThemeIcon />
      </RailButton>
    </nav>
  );
}

function RailButton({
  active,
  label,
  onClick,
  badge,
  dot,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  badge?: number;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`wordtaste-rail-btn ${active ? "is-active" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
      {typeof badge === "number" && <span className="wordtaste-rail-badge">{badge}</span>}
      {dot && !badge && <span className="wordtaste-rail-dot" />}
      <span className="wordtaste-rail-label">{label}</span>
    </button>
  );
}

function RailFlyout({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Click-away / Esc closes the flyout. Deferred mousedown so the opening click
  // (already handled) doesn't immediately re-close it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && ref.current.contains(t)) return;
      // Clicks on the rail itself are handled by the rail's own toggle.
      const onRail = (t as Element | null)?.closest?.(".wordtaste-rail");
      if (onRail) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const id = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="wordtaste-flyout" role="dialog" aria-label={title}>
      <div className="wordtaste-flyout-head">
        <span className="wordtaste-eyebrow">{title}</span>
        <button type="button" className="wordtaste-flyout-close" onClick={onClose} title="Collapse" aria-label="Collapse">
          <CloseIcon />
        </button>
      </div>
      <div className="wordtaste-flyout-body">{children}</div>
    </div>
  );
}

// ── Materials panel ─────────────────────────────────────────────────────────────

interface MaterialFile {
  rel: string;
  group: string;
  name: string;
  content: string;
}

function collectMaterials(
  files: ReadonlyArray<{ path: string; content: string }>,
  cs: string,
): MaterialFile[] {
  const prefix = cs ? `${cs}/materials/` : "materials/";
  const out: MaterialFile[] = [];
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rel = f.path.slice(prefix.length);
    if (!/\.(md|txt)$/.test(rel)) continue;
    let group = "Reference";
    if (/^outline\./.test(rel)) group = "Outline";
    else if (/^original\./.test(rel)) group = "Original";
    else if (/^kernel\./.test(rel)) group = "Kernel";
    else if (rel.startsWith("voice/")) group = "Voice";
    else if (rel.startsWith("refs/")) group = "Reference";
    out.push({ rel, group, name: rel.replace(/\.[^.]+$/, "").replace(/^.*\//, ""), content: f.content });
  }
  const order = ["Outline", "Original", "Kernel", "Voice", "Reference"];
  out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.rel.localeCompare(b.rel));
  return out;
}

function MaterialsPanel({ materials }: { materials: MaterialFile[] }) {
  if (materials.length === 0) {
    return (
      <p className="wordtaste-muted-note">
        The raw stock — your outline or original draft, the frozen kernel, your voice anchors and
        reference texts — appears here as you feed it in.
      </p>
    );
  }
  return (
    <div className="wordtaste-stack">
      {materials.map((m) => (
        <MaterialCard key={m.rel} material={m} />
      ))}
    </div>
  );
}

function MaterialCard({ material }: { material: MaterialFile }) {
  const [open, setOpen] = useState(material.group === "Kernel" || material.group === "Outline");
  return (
    <div className="wordtaste-card">
      <button type="button" className="wordtaste-card-head" onClick={() => setOpen((v) => !v)}>
        <span className="wordtaste-chip wordtaste-chip-quiet">{material.group}</span>
        <span className="wordtaste-card-name">{material.name}</span>
        <span className="wordtaste-card-caret">{open ? "–" : "+"}</span>
      </button>
      {open && (
        <div className="wordtaste-card-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{material.content || "_(empty)_"}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ── Draft block (center) ──────────────────────────────────────────────────────

function BlockView({
  block,
  rubric,
  dense,
  regenerating,
  pulsing,
  readonly,
  onFreeze,
  onPoke,
  onMask,
}: {
  block: DraftBlock;
  rubric: Symptom[];
  dense: boolean;
  regenerating: boolean;
  pulsing: boolean;
  readonly: boolean;
  onFreeze: () => void;
  onPoke: (s: Symptom) => void;
  onMask: (scope: "region" | "after") => void;
}) {
  const [pokeOpen, setPokeOpen] = useState(false);
  const classes = [
    "wordtaste-block",
    block.frozen ? "is-frozen" : "",
    regenerating ? "is-regen" : "",
    pulsing ? "is-pulse" : "",
    dense ? "is-dense" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div data-block-id={block.id} className={classes}>
      {!readonly && (
        <div className="wordtaste-block-chrome" contentEditable={false}>
          <button
            type="button"
            className={`wordtaste-icon-btn ${block.frozen ? "is-active" : ""}`}
            title={block.frozen ? "Unfreeze (allow rewrites)" : "Freeze (kernel — protect from rewrites)"}
            onClick={onFreeze}
          >
            <LockIcon open={!block.frozen} />
          </button>
          {!block.frozen && (
            <>
              <div className="wordtaste-poke-wrap">
                <button
                  type="button"
                  className="wordtaste-icon-btn"
                  title="Tag a symptom"
                  onClick={() => setPokeOpen((v) => !v)}
                >
                  <TagIcon />
                </button>
                {pokeOpen && (
                  <div className="wordtaste-poke-menu" onMouseLeave={() => setPokeOpen(false)}>
                    {(rubric.length > 0 ? rubric : FALLBACK_SYMPTOMS).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="wordtaste-poke-item"
                        onClick={() => {
                          onPoke(s);
                          setPokeOpen(false);
                        }}
                      >
                        <span className="wordtaste-poke-id">{s.id}</span>
                        <span className="wordtaste-poke-title">{s.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="wordtaste-icon-btn"
                title="Regenerate this region"
                onClick={() => onMask("region")}
              >
                <MaskIcon />
              </button>
              <button
                type="button"
                className="wordtaste-icon-btn"
                title="Continue from here"
                onClick={() => onMask("after")}
              >
                <ContinueIcon />
              </button>
            </>
          )}
        </div>
      )}

      {block.frozen && (
        <span className="wordtaste-frozen-badge" title="Frozen — the kernel the rewrite path protects">
          <LockIcon open={false} /> kernel
        </span>
      )}
      {dense && !block.frozen && (
        <span
          className="wordtaste-dense-dot"
          title="A long paragraph — you may want to break it up (readability)"
          aria-hidden
        />
      )}

      <div className="wordtaste-block-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.markdown}</ReactMarkdown>
      </div>

      {regenerating && <div className="wordtaste-shimmer" aria-hidden />}
    </div>
  );
}

const FALLBACK_SYMPTOMS: Symptom[] = [
  { id: "S2", title: "marching skeleton", tell: "", fix: "" },
  { id: "S4", title: "no punch", tell: "", fix: "" },
  { id: "S5", title: "definition couplet", tell: "", fix: "" },
  { id: "S7", title: "AI metaphor", tell: "", fix: "" },
];

// ── Annotation column (right of the article, block-aligned) ─────────────────────

/** Vertical gap kept between adjacent annotation cards when they collide. */
const ANNOTATION_GAP = 12;

function AnnotationColumn({
  blocks,
  annotations,
  scrollRef,
}: {
  blocks: DraftBlock[];
  annotations: DraftAnnotations | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Each note group prefers to align with the TOP of the block it annotates, but
  // the column is a margin-notes layout: when anchors sit close together, or a
  // card is taller than the gap to the next anchor, the groups would overlap and
  // cover each other's text. So we measure each block's anchor top AND each
  // group's rendered height (relative to the scroll container), then run the
  // pure push-down resolver (studio-logic#layoutAnnotations) to get a non-
  // overlapping `top` for every group. Re-measured on draft/annotation change
  // and on resize, never per scroll frame.
  const [tops, setTops] = useState<Record<string, number>>({});
  // Per-group element refs, so we can read each card stack's measured height.
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const annotatedIds = useMemo(
    () => blocks.filter((b) => annotationsForBlock(annotations, b.id).length > 0).map((b) => b.id),
    [blocks, annotations],
  );

  const measure = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const base = scroll.getBoundingClientRect().top - scroll.scrollTop;
    const items: { id: string; anchorTop: number; height: number }[] = [];
    for (const id of annotatedIds) {
      const blockEl = scroll.querySelector(`[data-block-id="${id}"]`) as HTMLElement | null;
      if (!blockEl) continue;
      const anchorTop = blockEl.getBoundingClientRect().top - base;
      const groupEl = groupRefs.current.get(id);
      const height = groupEl?.getBoundingClientRect().height ?? 0;
      items.push({ id, anchorTop, height });
    }
    const resolved = layoutAnnotations(items, ANNOTATION_GAP);
    const next: Record<string, number> = {};
    for (const r of resolved) next[r.id] = r.top;
    setTops(next);
  }, [annotatedIds, scrollRef]);

  useLayoutEffect(() => {
    measure();
    const scroll = scrollRef.current;
    if (!scroll) return;
    // Re-measure when the article reflows (resize) OR when a card's own height
    // changes (the annotation aside is observed too, so a taller note re-runs
    // the collision pass and never silently overlaps the next group).
    const ro = new ResizeObserver(() => measure());
    ro.observe(scroll);
    const inner = scroll.querySelector(".wordtaste-prose");
    if (inner) ro.observe(inner);
    for (const el of groupRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [measure, scrollRef, annotatedIds]);

  const setGroupRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) groupRefs.current.set(id, el);
      else groupRefs.current.delete(id);
    },
    [],
  );

  return (
    <aside className="wordtaste-annotations" aria-label="Revision notes">
      <div className="wordtaste-annotations-inner">
        {annotatedIds.map((id) => (
          <div
            key={id}
            ref={setGroupRef(id)}
            className="wordtaste-anno-group"
            style={{ top: tops[id] ?? 0 }}
          >
            {annotationsForBlock(annotations, id).map((note, i) => (
              <AnnotationCard key={i} note={note} />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function AnnotationCard({ note }: { note: BlockAnnotation }) {
  return (
    <div className={`wordtaste-anno-card is-${note.kind}`}>
      <div className="wordtaste-anno-meta">
        <span className="wordtaste-anno-kind">{note.kind === "revision" ? "revised" : "note"}</span>
        {note.ts && <span className="wordtaste-anno-ts">{formatTs(note.ts)}</span>}
      </div>
      <p className="wordtaste-anno-text">{note.text}</p>
    </div>
  );
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Direction popup ────────────────────────────────────────────────────────────

function DirectionPopup({
  popup,
  onPick,
  onDismiss,
}: {
  popup: PopupState;
  onPick: (chip: DirectionChip) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = Math.min(popup.rect.bottom + 8, window.innerHeight - 160);
  const left = Math.min(Math.max(popup.rect.left, 12), window.innerWidth - 268);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onDismiss]);

  return (
    <div ref={ref} className="wordtaste-popup" style={{ top, left }} role="menu">
      <div className="wordtaste-popup-head">
        <span>Rewrite toward</span>
        <span className={`wordtaste-popup-status ${popup.refined ? "is-refined" : ""}`}>
          {popup.refined ? "taste-aware" : "quick"}
        </span>
      </div>
      <div className="wordtaste-popup-chips">
        {popup.chips.map((chip, i) => (
          <button
            key={`${chip.label}-${i}`}
            type="button"
            className="wordtaste-chip-action"
            onClick={() => onPick(chip)}
            role="menuitem"
          >
            {chip.symptom && <span className="wordtaste-chip-tag">{chip.symptom}</span>}
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── TopBar ───────────────────────────────────────────────────────────────────

function StudioTopBar({
  contentSets,
  activeContentSet,
  onContentSet,
  rung,
  onRung,
  onDialUp,
  crossFamily,
  familyResolved,
  selectMode,
  onToggleSelect,
  annotationsPresent,
  annotationsOn,
  onToggleAnnotations,
  canExport,
  onExport,
  readonly,
}: {
  contentSets: { prefix: string; label: string }[];
  activeContentSet: string;
  onContentSet: (prefix: string) => void;
  rung: number;
  onRung: (next: number) => void;
  onDialUp: () => void;
  crossFamily: CrossFamily | null;
  familyResolved: boolean;
  selectMode: boolean;
  onToggleSelect: () => void;
  annotationsPresent: boolean;
  annotationsOn: boolean;
  onToggleAnnotations: () => void;
  canExport: boolean;
  onExport: () => void;
  readonly?: boolean;
}) {
  return (
    <header className="wordtaste-topbar no-drag">
      <div className="wordtaste-topbar-left">
        {contentSets.length > 1 ? (
          <div className="wordtaste-cs-switch">
            {contentSets.map((c) => (
              <button
                key={c.prefix}
                type="button"
                className={`wordtaste-cs-tab ${c.prefix === activeContentSet ? "is-active" : ""}`}
                onClick={() => onContentSet(c.prefix)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="wordtaste-wordmark">
            Wordtaste <span className="wordtaste-wordmark-sub">taste studio</span>
          </span>
        )}
      </div>

      {!readonly && (
        <div className="wordtaste-topbar-center">
          <RungDial rung={rung} onRung={onRung} onDialUp={onDialUp} />
        </div>
      )}

      <div className="wordtaste-topbar-right">
        <FamilyChip crossFamily={crossFamily} resolved={familyResolved} />
        {canExport && (
          <button
            type="button"
            className="wordtaste-export-btn"
            onClick={onExport}
            title="Download the article as a Markdown file"
          >
            <ExportIcon />
            Export
          </button>
        )}
        {annotationsPresent && (
          <button
            type="button"
            className={`wordtaste-mode-toggle ${annotationsOn ? "is-active" : ""}`}
            onClick={onToggleAnnotations}
            title={annotationsOn ? "Hide revision notes" : "Show revision notes"}
          >
            Notes
          </button>
        )}
        {!readonly && (
          <button
            type="button"
            className={`wordtaste-mode-toggle ${selectMode ? "is-active" : ""}`}
            onClick={onToggleSelect}
            title={selectMode ? "Reading mode" : "Point at the prose"}
          >
            {selectMode ? "Select" : "View"}
          </button>
        )}
      </div>
    </header>
  );
}

function RungDial({
  rung,
  onRung,
  onDialUp,
}: {
  rung: number;
  onRung: (n: number) => void;
  onDialUp: () => void;
}) {
  const segments = [];
  for (let r = MIN_RUNG; r <= MAX_RUNG; r++) segments.push(r);
  return (
    <div className="wordtaste-dial" title="How far to break the AI shape — gentler to bolder">
      <span className="wordtaste-dial-cap">{RUNG_SCALE_CAPTION}</span>
      <div className="wordtaste-dial-track" role="slider" aria-valuemin={0} aria-valuemax={5} aria-valuenow={rung}>
        {segments.map((r) => (
          <button
            key={r}
            type="button"
            className={`wordtaste-dial-seg ${r <= rung ? "is-filled" : ""} ${r === rung ? "is-head" : ""}`}
            onClick={() => onRung(r)}
            title={rungLabel(r)}
            aria-label={rungLabel(r)}
          />
        ))}
      </div>
      <span className="wordtaste-dial-word">{rungLabel(rung)}</span>
      <button type="button" className="wordtaste-dial-up" onClick={onDialUp} title="Still reads AI — go bolder & regenerate">
        bolder ↑
      </button>
    </div>
  );
}

function FamilyChip({
  crossFamily,
  resolved = true,
}: {
  crossFamily: CrossFamily | null;
  resolved?: boolean;
}) {
  if (!resolved) {
    return (
      <div className="wordtaste-family-chip is-checking" title="Detecting available model families…">
        <span className="wordtaste-family-dot" />
        checking…
      </div>
    );
  }
  const present = crossFamily
    ? (["claude", "codex", "gemini"] as const).filter((f) => crossFamily[f])
    : ["claude"];
  const degraded = present.length <= 1;
  return (
    <div className={`wordtaste-family-chip ${degraded ? "is-degraded" : ""}`} title="Model families in the diversity engine">
      <span className="wordtaste-family-dot" />
      {present.length} {present.length === 1 ? "family" : "families"}
    </div>
  );
}

// ── Taste panel (left rail) ──────────────────────────────────────────────────

function TastePanel({
  taste,
  rung,
  familyDegraded,
  missingFamilies,
}: {
  taste: TasteProfile | null;
  rung: number;
  familyDegraded: boolean;
  missingFamilies: readonly string[];
}) {
  return (
    <div className="wordtaste-stack-lg">
      <p className="wordtaste-panel-sub">what Wordtaste learned about you</p>

      {familyDegraded && (
        <div className="wordtaste-banner">
          <strong>Single-family mode.</strong> Cross-family diversity is reduced — install{" "}
          {missingFamilies.join(" / ")} for the full engine. Everything still works.
        </div>
      )}

      {!taste ? (
        <div className="wordtaste-coldstart">
          <p className="wordtaste-coldstart-lead">No taste read yet.</p>
          <p className="wordtaste-muted-note">
            Feed Wordtaste a sample of your own writing — or just give it a goal. It learns your voice
            as you judge its rewrites, and what it learns shows up here.
          </p>
        </div>
      ) : (
        <>
          <RungGauge rung={rung} launchRung={taste.launchRung} />

          {taste.voiceFloor && (
            <section className="wordtaste-section">
              <h3 className="wordtaste-section-title">Voice floor</h3>
              <div className="wordtaste-voicefloor">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{taste.voiceFloor}</ReactMarkdown>
              </div>
            </section>
          )}

          {taste.rubric.length > 0 && (
            <section className="wordtaste-section">
              <h3 className="wordtaste-section-title">
                Symptom rubric <span className="wordtaste-count">{taste.rubric.length}</span>
              </h3>
              <div className="wordtaste-rubric">
                {taste.rubric.map((s) => (
                  <SymptomCard key={s.id} symptom={s} />
                ))}
              </div>
            </section>
          )}

          <LearnedGauge swaps={taste.swapCount} prefs={taste.prefsCount} recipes={taste.recipeNames} />
        </>
      )}
    </div>
  );
}

function RungGauge({ rung, launchRung }: { rung: number; launchRung: number }) {
  const pct = (rung / MAX_RUNG) * 100;
  return (
    <section className="wordtaste-section">
      <h3 className="wordtaste-section-title">Disruption</h3>
      <div className="wordtaste-gauge">
        <div className="wordtaste-gauge-bar">
          <div className="wordtaste-gauge-fill" style={{ width: `${pct}%` }} />
          <div
            className="wordtaste-gauge-launch"
            style={{ left: `${(launchRung / MAX_RUNG) * 100}%` }}
            title={`Calibrated start: ${rungLabel(launchRung)}`}
          />
        </div>
        <div className="wordtaste-gauge-foot">
          <span>{rungLabel(rung)}</span>
          <span className="wordtaste-muted-note">start · {rungLabel(launchRung)}</span>
        </div>
      </div>
    </section>
  );
}

function SymptomCard({ symptom }: { symptom: Symptom }) {
  const [open, setOpen] = useState(false);
  const expandable = !!(symptom.tell || symptom.fix);
  return (
    <div className={`wordtaste-symptom ${open ? "is-open" : ""}`}>
      <button type="button" className="wordtaste-symptom-head" onClick={() => expandable && setOpen((v) => !v)}>
        <span className="wordtaste-symptom-id">{symptom.id}</span>
        <span className="wordtaste-symptom-title">{symptom.title}</span>
        {expandable && <span className="wordtaste-symptom-caret">{open ? "–" : "+"}</span>}
      </button>
      {open && expandable && (
        <div className="wordtaste-symptom-detail">
          {symptom.tell && (
            <p>
              <span className="wordtaste-symptom-label">tell</span>
              {symptom.tell}
            </p>
          )}
          {symptom.fix && (
            <p>
              <span className="wordtaste-symptom-label">fix</span>
              {symptom.fix}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LearnedGauge({
  swaps,
  prefs,
  recipes,
}: {
  swaps: number;
  prefs: number;
  recipes: string[];
}) {
  return (
    <section className="wordtaste-section">
      <h3 className="wordtaste-section-title">Golden material</h3>
      <div className="wordtaste-counters">
        <Counter n={swaps} label="swaps" hint="your AI→human sentence pairs" />
        <Counter n={prefs} label="signals" hint="judgments logged" />
        <Counter n={recipes.length} label="recipes" hint="distilled generation recipes" />
      </div>
    </section>
  );
}

function Counter({ n, label, hint }: { n: number; label: string; hint: string }) {
  return (
    <div className="wordtaste-counter" title={hint}>
      <span className="wordtaste-counter-n">{n}</span>
      <span className="wordtaste-counter-label">{label}</span>
    </div>
  );
}

// ── Theme panel (left rail) ──────────────────────────────────────────────────

function ThemePanel({
  activeSkinId,
  suggestedSkinId,
  onPick,
  readonly,
}: {
  activeSkinId: string;
  suggestedSkinId?: string;
  onPick: (id: string) => void;
  readonly?: boolean;
}) {
  return (
    <div className="wordtaste-stack-lg">
      <p className="wordtaste-panel-sub">how the article reads — pick a reading skin</p>
      <div className="wordtaste-skins">
        {SKINS.map((s) => (
          <SkinCard
            key={s.id}
            skin={s}
            active={s.id === activeSkinId}
            suggested={s.id === suggestedSkinId}
            onPick={() => !readonly && onPick(s.id)}
            readonly={readonly}
          />
        ))}
      </div>
    </div>
  );
}

function SkinCard({
  skin,
  active,
  suggested,
  onPick,
  readonly,
}: {
  skin: Skin;
  active: boolean;
  suggested: boolean;
  onPick: () => void;
  readonly?: boolean;
}) {
  return (
    <button
      type="button"
      className={`wordtaste-skin-card ${active ? "is-active" : ""}`}
      onClick={onPick}
      disabled={readonly}
      aria-pressed={active}
      title={skin.blurb}
    >
      <span
        className="wordtaste-skin-swatch"
        style={
          {
            background: skin.palette.bg,
            color: skin.palette.fg,
            fontFamily: skin.fontFamily,
            borderColor: skin.palette.rule,
          } as React.CSSProperties
        }
      >
        <span className="wordtaste-skin-aa" style={{ color: skin.palette.heading }}>
          Aa
        </span>
        <span className="wordtaste-skin-line" style={{ background: skin.palette.fg }} />
        <span className="wordtaste-skin-line is-short" style={{ background: skin.palette.muted }} />
        <span className="wordtaste-skin-accent" style={{ background: skin.palette.accent }} />
      </span>
      <span className="wordtaste-skin-meta">
        <span className="wordtaste-skin-label">
          {skin.label}
          {active && <span className="wordtaste-skin-dot" />}
        </span>
        <span className="wordtaste-skin-mode">
          {skin.mode}
          {suggested && !active && <span className="wordtaste-skin-suggested">suggested</span>}
        </span>
      </span>
    </button>
  );
}

// ── Empty draft ───────────────────────────────────────────────────────────────

function DraftEmpty({
  onStartIdea,
  onStartDraft,
  readonly,
}: {
  onStartIdea: () => void;
  onStartDraft: () => void;
  readonly?: boolean;
}) {
  return (
    <div className="wordtaste-reading">
      <div className="wordtaste-draft-empty">
        <p className="wordtaste-empty-lead">Nothing on the page yet.</p>
        <p className="wordtaste-empty-note">
          Tell Wordtaste what you want to write — or hand it a draft that reads one-glance-AI. It writes
          across model families and de-AIs the result with you, one cheap judgment at a time.
        </p>
        {!readonly && (
          <div className="wordtaste-empty-actions">
            <button type="button" className="wordtaste-cta is-primary" onClick={onStartIdea}>
              Write from an outline
            </button>
            <button type="button" className="wordtaste-cta" onClick={onStartDraft}>
              De-AI a draft
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function scrollToBlock(container: HTMLElement | null, blockId: string) {
  if (!container) return;
  const el = container.querySelector(`[data-block-id="${blockId}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("is-pulse");
    setTimeout(() => el.classList.remove("is-pulse"), 1200);
  }
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="wordtaste-svg">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      {open ? (
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0" strokeLinecap="round" />
      ) : (
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" strokeLinecap="round" />
      )}
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="wordtaste-svg">
      <path d="M7.5 2.5H13V8l-5.5 5.5a1.5 1.5 0 0 1-2.1 0L2.5 9.6a1.5 1.5 0 0 1 0-2.1L7.5 2.5z" strokeLinejoin="round" />
      <circle cx="10" cy="5.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MaskIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="wordtaste-svg">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" strokeDasharray="2.4 2" />
      <path d="M6 8l1.5 1.5L10.5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ContinueIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="wordtaste-svg">
      <path d="M3 4h10M3 8h6M3 12h10" strokeLinecap="round" />
      <path d="M11.5 6.5L14 9l-2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MaterialsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="wordtaste-rail-svg">
      <path d="M4 3.5h7l4 4V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" strokeLinejoin="round" />
      <path d="M11 3.5V7.5h4" strokeLinejoin="round" />
      <path d="M6 11h7M6 13.5h5" strokeLinecap="round" />
    </svg>
  );
}

function TasteIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="wordtaste-rail-svg">
      <path d="M10 3c2.8 0 5 2.1 5 4.7 0 2-1.4 3.4-3 3.9v2.9a2 2 0 1 1-4 0v-2.9c-1.6-.5-3-1.9-3-3.9C5 5.1 7.2 3 10 3z" strokeLinejoin="round" />
      <path d="M8.5 14.5h3" strokeLinecap="round" />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="wordtaste-rail-svg">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="wordtaste-svg">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

function ExportIcon() {
  // Down-into-tray: a page with an arrow exiting downward — the export glyph.
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="wordtaste-svg">
      <path d="M8 2v7M5.5 6.5L8 9l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 10.5v1.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5v-1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Scoped styles ──────────────────────────────────────────────────────────────

function WordtasteStyles() {
  return <style dangerouslySetInnerHTML={{ __html: STUDIO_CSS }} />;
}

const STUDIO_CSS = `
.wordtaste-studio {
  display: flex; flex-direction: column; height: 100%; width: 100%;
  background: var(--color-cc-bg, #09090b);
  color: var(--color-cc-fg, #fafafa);
  font-family: "DM Sans", system-ui, sans-serif;
  overflow: hidden;
}

/* ── TopBar ── */
.wordtaste-topbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 10px 18px; flex-shrink: 0; z-index: 30;
  border-bottom: 1px solid var(--color-cc-border, rgba(255,255,255,0.08));
  background: color-mix(in srgb, var(--color-cc-surface, #18181b) 70%, transparent);
  backdrop-filter: blur(14px);
}
.wordtaste-topbar-left { display: flex; align-items: center; min-width: 0; }
.wordtaste-topbar-center { display: flex; justify-content: center; flex: 1; }
.wordtaste-topbar-right { display: flex; align-items: center; gap: 10px; }
.wordtaste-wordmark { font-family: "Playfair Display", Georgia, serif; font-size: 17px; letter-spacing: 0.01em; }
.wordtaste-wordmark-sub { font-family: "DM Sans"; font-size: 11px; color: var(--color-cc-muted); letter-spacing: 0.08em; text-transform: uppercase; margin-left: 6px; }
.wordtaste-cs-switch { display: inline-flex; gap: 2px; padding: 2px; border-radius: 9px; background: var(--color-cc-bg); border: 1px solid var(--color-cc-border); }
.wordtaste-cs-tab { font-size: 12px; padding: 4px 11px; border-radius: 7px; color: var(--color-cc-muted); background: transparent; border: none; cursor: pointer; transition: color .15s, background .15s; }
.wordtaste-cs-tab:hover { color: var(--color-cc-fg); }
.wordtaste-cs-tab.is-active { color: var(--color-cc-fg); background: var(--color-cc-active, rgba(255,255,255,0.08)); }

/* Rung dial — physical, human temperature */
.wordtaste-dial { display: inline-flex; align-items: center; gap: 10px; }
.wordtaste-dial-cap { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-cc-muted); }
.wordtaste-dial-track { display: inline-flex; gap: 3px; padding: 3px; border-radius: 999px; background: var(--color-cc-bg); border: 1px solid var(--color-cc-border); }
.wordtaste-dial-seg { width: 22px; height: 8px; border: none; border-radius: 999px; background: var(--color-cc-border); cursor: pointer; transition: background .18s cubic-bezier(.16,1,.3,1), transform .18s; padding: 0; }
.wordtaste-dial-seg:hover { transform: translateY(-1px); }
.wordtaste-dial-seg.is-filled { background: color-mix(in srgb, var(--color-cc-primary, #f97316) 55%, var(--color-cc-muted)); }
.wordtaste-dial-seg.is-head { background: var(--color-cc-primary, #f97316); box-shadow: 0 0 12px var(--color-cc-glow, rgba(249,115,22,0.4)); }
.wordtaste-dial-word { font-size: 12px; font-weight: 600; min-width: 64px; color: var(--color-cc-fg); }
.wordtaste-dial-up { font-size: 11px; padding: 3px 9px; border-radius: 7px; border: 1px solid var(--color-cc-border); background: transparent; color: var(--color-cc-muted); cursor: pointer; transition: all .15s; }
.wordtaste-dial-up:hover { color: var(--color-cc-primary); border-color: color-mix(in srgb, var(--color-cc-primary) 40%, transparent); }

.wordtaste-family-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--color-cc-border); color: var(--color-cc-muted); }
.wordtaste-family-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-cc-success, #4ade80); box-shadow: 0 0 6px color-mix(in srgb, var(--color-cc-success) 60%, transparent); }
.wordtaste-family-chip.is-degraded { color: var(--color-cc-warning, #facc15); border-color: color-mix(in srgb, var(--color-cc-warning) 30%, transparent); }
.wordtaste-family-chip.is-degraded .wordtaste-family-dot { background: var(--color-cc-warning); box-shadow: 0 0 6px color-mix(in srgb, var(--color-cc-warning) 60%, transparent); }
.wordtaste-family-chip.is-checking { color: var(--color-cc-muted); border-color: var(--color-cc-border); }
.wordtaste-family-chip.is-checking .wordtaste-family-dot { background: var(--color-cc-muted); box-shadow: none; animation: wordtaste-family-pulse 1.1s ease-in-out infinite; }
@keyframes wordtaste-family-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.wordtaste-mode-toggle { font-size: 12px; padding: 5px 13px; border-radius: 8px; border: 1px solid var(--color-cc-border); background: transparent; color: var(--color-cc-muted); cursor: pointer; transition: all .15s; }
.wordtaste-mode-toggle:hover { color: var(--color-cc-fg); }
.wordtaste-mode-toggle.is-active { color: var(--color-cc-primary); border-color: color-mix(in srgb, var(--color-cc-primary) 45%, transparent); background: var(--color-cc-primary-muted, rgba(249,115,22,0.12)); }
.wordtaste-export-btn { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 5px 12px 5px 11px; border-radius: 8px; border: 1px solid var(--color-cc-border); background: transparent; color: var(--color-cc-muted); cursor: pointer; transition: all .15s; }
.wordtaste-export-btn .wordtaste-svg { width: 14px; height: 14px; }
.wordtaste-export-btn:hover { color: var(--color-cc-primary); border-color: color-mix(in srgb, var(--color-cc-primary) 45%, transparent); background: var(--color-cc-primary-muted, rgba(249,115,22,0.12)); }

/* ── Body: rail | flyout | center ── */
.wordtaste-body { display: flex; flex: 1; min-height: 0; position: relative; }

/* Left icon rail — always slim; panels open as a flyout */
.wordtaste-rail { width: 56px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 0; border-right: 1px solid var(--color-cc-border); background: color-mix(in srgb, var(--color-cc-surface) 35%, transparent); z-index: 20; }
.wordtaste-rail-spacer { flex: 1; }
.wordtaste-rail-btn { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; width: 44px; padding: 8px 0 6px; border-radius: 10px; border: 1px solid transparent; background: transparent; color: var(--color-cc-muted); cursor: pointer; transition: all .15s; }
.wordtaste-rail-btn:hover { color: var(--color-cc-fg); background: var(--color-cc-hover, rgba(255,255,255,0.05)); }
.wordtaste-rail-btn.is-active { color: var(--color-cc-primary); background: var(--color-cc-primary-muted, rgba(249,115,22,0.1)); border-color: color-mix(in srgb, var(--color-cc-primary) 35%, transparent); }
.wordtaste-rail-svg { width: 20px; height: 20px; }
.wordtaste-rail-label { font-size: 8.5px; letter-spacing: 0.04em; text-transform: uppercase; }
.wordtaste-rail-badge { position: absolute; top: 3px; right: 3px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 999px; background: var(--color-cc-primary); color: #0a0a0a; font-size: 9px; font-weight: 700; line-height: 14px; }
.wordtaste-rail-dot { position: absolute; top: 6px; right: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--color-cc-success, #4ade80); }

/* Flyout — generous readable panel over the studio edge (accordion) */
.wordtaste-flyout { position: absolute; left: 56px; top: 0; bottom: 0; width: 360px; max-width: 78vw; z-index: 25; display: flex; flex-direction: column; border-right: 1px solid var(--color-cc-border); background: color-mix(in srgb, var(--color-cc-surface) 92%, transparent); backdrop-filter: blur(22px); box-shadow: 22px 0 60px rgba(0,0,0,0.4); animation: wordtaste-flyout-in .2s cubic-bezier(.16,1,.3,1); }
@keyframes wordtaste-flyout-in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
.wordtaste-flyout-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 10px; border-bottom: 1px solid var(--color-cc-border); }
.wordtaste-flyout-close { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--color-cc-muted); cursor: pointer; transition: all .14s; }
.wordtaste-flyout-close:hover { color: var(--color-cc-fg); background: var(--color-cc-hover); border-color: var(--color-cc-border); }
.wordtaste-flyout-body { flex: 1; overflow-y: auto; padding: 14px 16px 24px; }
.wordtaste-eyebrow { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-cc-muted); font-weight: 600; }
.wordtaste-panel-sub { font-size: 12px; color: var(--color-cc-muted); font-family: "Lora", serif; font-style: italic; margin: 0 0 4px; }
.wordtaste-stack { display: flex; flex-direction: column; gap: 8px; }
.wordtaste-stack-lg { display: flex; flex-direction: column; gap: 18px; }

/* Generic collapsible card (materials) */
.wordtaste-card { border: 1px solid var(--color-cc-border); border-radius: 10px; background: var(--color-cc-card, rgba(24,24,27,0.4)); overflow: hidden; }
.wordtaste-card-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; background: transparent; border: none; cursor: pointer; text-align: left; }
.wordtaste-card-name { font-size: 12.5px; color: var(--color-cc-fg); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wordtaste-card-caret { color: var(--color-cc-muted); font-size: 13px; }
.wordtaste-card-content { padding: 4px 12px 12px; font-size: 13px; line-height: 1.65; color: var(--color-cc-muted); font-family: "Lora", serif; border-top: 1px solid var(--color-cc-border); }
.wordtaste-card-content :is(h1,h2,h3) { color: var(--color-cc-fg); font-size: 13.5px; margin: 8px 0 4px; }
.wordtaste-card-content p { margin: 6px 0; }
.wordtaste-card-content ul { margin: 6px 0; padding-left: 18px; }
.wordtaste-chip { font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 6px; border-radius: 5px; font-weight: 600; }
.wordtaste-chip-quiet { color: var(--color-cc-muted); background: var(--color-cc-hover, rgba(255,255,255,0.05)); }

/* ── Center — the reading surface (the active SKIN layers here) ── */
.wordtaste-center { display: flex; flex-direction: column; flex: 1; min-width: 0; position: relative;
  background: var(--wordtaste-skin-bg, var(--color-cc-bg, #09090b));
  transition: background .35s ease;
}
.wordtaste-draft-scroll { flex: 1; overflow-y: auto; padding: 40px 0 96px; }
.wordtaste-reading { display: flex; justify-content: center; gap: 0; width: 100%; }
.wordtaste-center.has-annotations .wordtaste-reading { gap: 28px; align-items: flex-start; padding-right: 12px; }

.wordtaste-prose {
  width: min(var(--wordtaste-skin-measure, 64ch), 100% - 80px);
  margin: 0 auto;
  font-family: var(--wordtaste-skin-font, "Lora", Georgia, serif);
  color: var(--wordtaste-skin-fg, var(--color-cc-fg));
}
.wordtaste-center.has-annotations .wordtaste-prose { margin: 0; }

.wordtaste-block { position: relative; padding: 4px 16px; margin: 2px -16px; border-radius: 10px; transition: background .3s ease; }
.wordtaste-block .wordtaste-block-body { font-size: 18px; line-height: var(--wordtaste-skin-line, 1.78); color: var(--wordtaste-skin-fg, var(--color-cc-fg)); }
.wordtaste-block-body :is(h1) { font-family: var(--wordtaste-skin-font); font-weight: 700; font-size: 30px; line-height: 1.22; margin: 14px 0 12px; color: var(--wordtaste-skin-heading, var(--color-cc-fg)); }
.wordtaste-block-body :is(h2) { font-family: var(--wordtaste-skin-font); font-weight: 700; font-size: 23px; margin: 22px 0 8px; color: var(--wordtaste-skin-heading, var(--color-cc-fg)); }
.wordtaste-block-body :is(h3) { font-size: 19px; font-weight: 600; margin: 16px 0 6px; color: var(--wordtaste-skin-heading, var(--color-cc-fg)); }
.wordtaste-block-body p { margin: 0 0 2px; }
.wordtaste-block-body blockquote { padding-left: 18px; position: relative; font-style: italic; color: var(--wordtaste-skin-muted, var(--color-cc-muted)); }
.wordtaste-block-body blockquote::before { content: ""; position: absolute; left: 0; top: 2px; bottom: 2px; width: 2px; border-radius: 2px; background: var(--wordtaste-skin-accent, var(--color-cc-primary)); }
.wordtaste-block-body ul, .wordtaste-block-body ol { padding-left: 24px; }
.wordtaste-block-body a { color: var(--wordtaste-skin-accent, var(--color-cc-primary)); }
.wordtaste-block-body code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; background: var(--wordtaste-skin-wash); padding: 1px 5px; border-radius: 4px; }
.wordtaste-block-body hr { border: none; border-top: 1px solid var(--wordtaste-skin-rule); margin: 18px 0; }
.wordtaste-block:hover { background: var(--wordtaste-skin-wash, rgba(255,255,255,0.04)); }

.wordtaste-block.is-frozen { background: var(--wordtaste-skin-wash); }
.wordtaste-block.is-frozen .wordtaste-block-body { color: var(--wordtaste-skin-muted); }

.wordtaste-block.is-pulse { animation: wordtaste-pulse 1.2s cubic-bezier(.16,1,.3,1); }
@keyframes wordtaste-pulse {
  0% { background: color-mix(in srgb, var(--color-cc-primary) 20%, transparent); }
  100% { background: transparent; }
}

.wordtaste-block.is-regen .wordtaste-block-body { opacity: 0.35; }
.wordtaste-shimmer { position: absolute; inset: 4px 14px; border-radius: 8px; overflow: hidden; pointer-events: none; }
.wordtaste-shimmer::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--color-cc-primary) 16%, transparent) 50%, transparent 70%);
  background-size: 220% 100%; animation: wordtaste-shimmer 1.4s infinite linear;
}
@keyframes wordtaste-shimmer { 0% { background-position: 180% 0; } 100% { background-position: -80% 0; } }

.wordtaste-block-chrome { position: absolute; right: 6px; top: 6px; z-index: 5; display: flex; flex-direction: row; gap: 2px; padding: 2px; border-radius: 9px; opacity: 0; transform: translateY(-2px); transition: opacity .15s, transform .15s; background: color-mix(in srgb, var(--color-cc-surface) 86%, transparent); backdrop-filter: blur(8px); border: 1px solid var(--color-cc-border); }
.wordtaste-block:hover .wordtaste-block-chrome { opacity: 1; transform: none; }
.wordtaste-icon-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 7px; border: 1px solid transparent; background: transparent; color: #d4d4d8; cursor: pointer; transition: all .14s; }
.wordtaste-icon-btn:hover { color: #fafafa; background: rgba(255,255,255,0.08); border-color: var(--color-cc-border); }
.wordtaste-icon-btn.is-active { color: var(--color-cc-primary); }
.wordtaste-svg { width: 15px; height: 15px; }

.wordtaste-poke-wrap { position: relative; }
.wordtaste-poke-menu { position: absolute; right: 0; top: 30px; z-index: 40; min-width: 170px; padding: 5px; border-radius: 10px; background: color-mix(in srgb, var(--color-cc-surface) 94%, transparent); backdrop-filter: blur(16px); border: 1px solid var(--color-cc-border); box-shadow: 0 12px 40px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 1px; }
.wordtaste-poke-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: transparent; border: none; cursor: pointer; text-align: left; color: var(--color-cc-fg); }
.wordtaste-poke-item:hover { background: var(--color-cc-hover); }
.wordtaste-poke-id { font-family: ui-monospace, monospace; font-size: 11px; color: var(--color-cc-primary); font-weight: 600; }
.wordtaste-poke-title { font-size: 12px; color: var(--color-cc-fg); }

.wordtaste-frozen-badge { display: inline-flex; align-items: center; gap: 4px; position: absolute; top: 9px; right: 14px; z-index: 4; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--wordtaste-skin-muted, var(--color-cc-muted)); pointer-events: none; }
.wordtaste-block:hover .wordtaste-frozen-badge { opacity: 0; }
.wordtaste-frozen-badge .wordtaste-svg { width: 12px; height: 12px; }
/* Readability cue: a quiet, non-prominent dot in the margin — NOT a loud badge,
   and NEVER an agent notification. */
.wordtaste-dense-dot { position: absolute; top: 14px; left: -8px; width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--wordtaste-skin-muted, #888) 55%, transparent); pointer-events: none; }

/* Annotation column — block-aligned revision notes (批注模式) */
.wordtaste-annotations { position: relative; width: 264px; flex-shrink: 0; align-self: stretch; }
.wordtaste-annotations-inner { position: relative; height: 100%; }
.wordtaste-anno-group { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; gap: 6px; }
.wordtaste-anno-card { padding: 9px 11px; border-radius: 9px; background: color-mix(in srgb, var(--wordtaste-skin-bg, #18181b) 80%, var(--color-cc-surface, #18181b)); border: 1px solid var(--wordtaste-skin-rule, var(--color-cc-border)); border-left: 2px solid var(--wordtaste-skin-accent, var(--color-cc-primary)); box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
.wordtaste-anno-card.is-note { border-left-color: var(--wordtaste-skin-muted, var(--color-cc-muted)); }
.wordtaste-anno-meta { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 3px; }
.wordtaste-anno-kind { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700; color: var(--wordtaste-skin-accent, var(--color-cc-primary)); }
.wordtaste-anno-card.is-note .wordtaste-anno-kind { color: var(--wordtaste-skin-muted, var(--color-cc-muted)); }
.wordtaste-anno-ts { font-size: 10px; color: var(--wordtaste-skin-muted, var(--color-cc-muted)); }
.wordtaste-anno-text { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--wordtaste-skin-fg, var(--color-cc-fg)); font-family: "DM Sans", system-ui, sans-serif; }

/* Direction popup */
.wordtaste-popup { position: fixed; z-index: 9999; min-width: 248px; max-width: 280px; padding: 8px; border-radius: 12px; background: color-mix(in srgb, var(--color-cc-surface) 92%, transparent); backdrop-filter: blur(20px); border: 1px solid var(--color-cc-border); box-shadow: 0 18px 50px rgba(0,0,0,0.55); animation: wordtaste-pop .16s cubic-bezier(.16,1,.3,1); color: var(--color-cc-fg); }
@keyframes wordtaste-pop { from { opacity: 0; transform: translateY(-6px) scale(.97); } to { opacity: 1; transform: none; } }
.wordtaste-popup-head { display: flex; align-items: center; justify-content: space-between; padding: 2px 6px 8px; font-size: 11px; color: var(--color-cc-muted); letter-spacing: 0.04em; }
.wordtaste-popup-status { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 6px; border-radius: 5px; background: var(--color-cc-hover); color: var(--color-cc-muted); }
.wordtaste-popup-status.is-refined { color: var(--color-cc-primary); background: var(--color-cc-primary-muted); }
.wordtaste-popup-chips { display: flex; flex-direction: column; gap: 3px; }
.wordtaste-chip-action { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--color-cc-fg); font-size: 13px; font-family: "DM Sans"; cursor: pointer; text-align: left; transition: all .13s; }
.wordtaste-chip-action:hover { background: var(--color-cc-primary-muted, rgba(249,115,22,0.12)); border-color: color-mix(in srgb, var(--color-cc-primary) 35%, transparent); }
.wordtaste-chip-tag { font-family: ui-monospace, monospace; font-size: 10px; color: var(--color-cc-primary); }

/* Taste panel (in the rail flyout) */
.wordtaste-section { display: flex; flex-direction: column; gap: 8px; }
.wordtaste-section-title { display: flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-cc-muted); font-weight: 600; margin: 0; }
.wordtaste-count { font-family: ui-monospace, monospace; font-size: 10px; color: var(--color-cc-primary); padding: 1px 5px; border-radius: 5px; background: var(--color-cc-primary-muted); }
.wordtaste-banner { padding: 10px 12px; border-radius: 10px; font-size: 12px; line-height: 1.5; color: var(--color-cc-warning, #facc15); background: color-mix(in srgb, var(--color-cc-warning) 9%, transparent); border: 1px solid color-mix(in srgb, var(--color-cc-warning) 28%, transparent); }
.wordtaste-banner strong { color: var(--color-cc-fg); }
.wordtaste-coldstart { display: flex; flex-direction: column; gap: 8px; }
.wordtaste-coldstart-lead { font-family: "Lora", serif; font-size: 15px; color: var(--color-cc-fg); margin: 0; }
.wordtaste-muted-note { font-size: 12.5px; line-height: 1.6; color: var(--color-cc-muted); margin: 0; }

.wordtaste-gauge { display: flex; flex-direction: column; gap: 6px; }
.wordtaste-gauge-bar { position: relative; height: 8px; border-radius: 999px; background: var(--color-cc-border); overflow: hidden; }
.wordtaste-gauge-fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: var(--color-cc-primary, #f97316); transition: width .3s cubic-bezier(.16,1,.3,1); }
.wordtaste-gauge-launch { position: absolute; top: -3px; width: 2px; height: 14px; background: var(--color-cc-fg); border-radius: 2px; opacity: 0.6; }
.wordtaste-gauge-foot { display: flex; justify-content: space-between; align-items: baseline; }
.wordtaste-gauge-foot span:first-child { font-size: 13px; font-weight: 600; color: var(--color-cc-fg); }

.wordtaste-voicefloor { font-family: "Lora", serif; font-size: 13.5px; line-height: 1.7; color: color-mix(in srgb, var(--color-cc-fg) 85%, transparent); }
.wordtaste-voicefloor :is(ul) { padding-left: 18px; margin: 6px 0; }
.wordtaste-voicefloor li { margin: 4px 0; }
.wordtaste-voicefloor strong { color: var(--color-cc-fg); }

.wordtaste-rubric { display: flex; flex-direction: column; gap: 5px; }
.wordtaste-symptom { border: 1px solid var(--color-cc-border); border-radius: 9px; background: var(--color-cc-card, rgba(24,24,27,0.4)); overflow: hidden; }
.wordtaste-symptom-head { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 10px; background: transparent; border: none; cursor: pointer; text-align: left; }
.wordtaste-symptom-id { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; color: var(--color-cc-primary); }
.wordtaste-symptom-title { font-size: 12.5px; color: var(--color-cc-fg); flex: 1; }
.wordtaste-symptom-caret { color: var(--color-cc-muted); font-size: 13px; }
.wordtaste-symptom-detail { padding: 0 10px 10px; font-size: 12px; line-height: 1.55; color: var(--color-cc-muted); border-top: 1px solid var(--color-cc-border); }
.wordtaste-symptom-detail p { margin: 7px 0 0; }
.wordtaste-symptom-label { display: inline-block; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-cc-primary); margin-right: 6px; }

.wordtaste-counters { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.wordtaste-counter { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 6px; border-radius: 9px; background: var(--color-cc-card, rgba(24,24,27,0.4)); border: 1px solid var(--color-cc-border); }
.wordtaste-counter-n { font-family: "Playfair Display", Georgia, serif; font-size: 22px; line-height: 1; color: var(--color-cc-fg); }
.wordtaste-counter-label { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--color-cc-muted); }

/* Theme panel — skin cards */
.wordtaste-skins { display: flex; flex-direction: column; gap: 8px; }
.wordtaste-skin-card { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 12px; border: 1px solid var(--color-cc-border); background: var(--color-cc-card, rgba(24,24,27,0.4)); cursor: pointer; transition: all .15s; text-align: left; }
.wordtaste-skin-card:hover { border-color: color-mix(in srgb, var(--color-cc-fg) 28%, transparent); }
.wordtaste-skin-card.is-active { border-color: color-mix(in srgb, var(--color-cc-primary) 55%, transparent); background: var(--color-cc-primary-muted, rgba(249,115,22,0.1)); }
.wordtaste-skin-card:disabled { cursor: default; opacity: 0.7; }
.wordtaste-skin-swatch { position: relative; flex-shrink: 0; width: 76px; height: 56px; border-radius: 8px; border: 1px solid; overflow: hidden; padding: 8px 9px; display: flex; flex-direction: column; gap: 5px; }
.wordtaste-skin-aa { font-size: 17px; font-weight: 700; line-height: 1; }
.wordtaste-skin-line { height: 3px; width: 100%; border-radius: 2px; opacity: 0.5; }
.wordtaste-skin-line.is-short { width: 62%; opacity: 0.35; }
.wordtaste-skin-accent { position: absolute; bottom: 8px; right: 8px; width: 12px; height: 4px; border-radius: 2px; }
.wordtaste-skin-meta { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wordtaste-skin-label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--color-cc-fg); }
.wordtaste-skin-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-cc-primary); }
.wordtaste-skin-mode { display: flex; align-items: center; gap: 8px; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-cc-muted); }
.wordtaste-skin-suggested { padding: 1px 6px; border-radius: 5px; font-size: 9px; letter-spacing: 0.06em; color: var(--color-cc-primary); background: var(--color-cc-primary-muted); }

/* Empty draft */
.wordtaste-draft-empty { width: min(54ch, 100% - 80px); margin: 8vh auto 0; display: flex; flex-direction: column; gap: 10px; }
.wordtaste-empty-lead { font-family: "Playfair Display", Georgia, serif; font-size: 26px; color: var(--wordtaste-skin-heading, var(--color-cc-fg)); margin: 0; }
.wordtaste-empty-note { font-size: 14px; line-height: 1.6; color: var(--wordtaste-skin-muted, var(--color-cc-muted)); margin: 0; font-family: var(--wordtaste-skin-font, "Lora", serif); }
.wordtaste-empty-actions { display: flex; gap: 10px; margin-top: 8px; }
.wordtaste-cta { font-size: 13px; padding: 9px 16px; border-radius: 9px; border: 1px solid var(--color-cc-border); background: transparent; color: var(--color-cc-fg); cursor: pointer; transition: all .15s; font-family: "DM Sans"; }
.wordtaste-cta:hover { border-color: var(--color-cc-muted); }
.wordtaste-cta.is-primary { background: var(--color-cc-primary, #f97316); color: #0a0a0a; border-color: var(--color-cc-primary); }
.wordtaste-cta.is-primary:hover { background: var(--color-cc-primary-hover, #fdba74); }

/* Finalize */
.wordtaste-finalize { position: absolute; bottom: 18px; left: 0; right: 0; display: flex; justify-content: center; pointer-events: none; }
.wordtaste-finalize-btn { pointer-events: auto; font-size: 12.5px; padding: 9px 18px; border-radius: 999px; border: 1px solid var(--color-cc-border); background: color-mix(in srgb, var(--color-cc-surface) 90%, transparent); backdrop-filter: blur(14px); color: var(--color-cc-fg); cursor: pointer; box-shadow: 0 8px 28px rgba(0,0,0,0.4); transition: all .15s; }
.wordtaste-finalize-btn:hover { border-color: color-mix(in srgb, var(--color-cc-primary) 40%, transparent); color: var(--color-cc-primary); }

@media (prefers-reduced-motion: reduce) {
  .wordtaste-block.is-pulse, .wordtaste-shimmer::after, .wordtaste-popup, .wordtaste-flyout { animation: none; }
}
`;
