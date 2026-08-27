/**
 * WordTaste v0.2 — a stage-driven writing room.
 *
 * The source project's latest finding is that the user should never operate
 * the machinery. Rung numbers, symptom codes, judge language, and model
 * provenance remain inside the orchestration. This viewer exposes the three
 * useful human gates instead:
 *
 *   1. approve the argument and mark the few strongest landing points;
 *   2. choose by feel when a hard passage earns multiple candidates;
 *   3. point at one line for local repair.
 *
 * File state is canonical. The agent writes workflow.json and draft.md; the
 * viewer renders them and sends only direct user gestures back.
 */

import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
// KaTeX's HTML output is a pile of positioned spans; without its stylesheet
// a formula renders as a scrambled line of glyphs. Vite resolves the font
// files this sheet references, which is why it is imported here rather than
// inlined into `STYLES` below.
import "katex/dist/katex.min.css";
import { WORDTASTE_MARKDOWN_COMPONENTS } from "./markdown-components.js";
import {
  WORDTASTE_REHYPE_PLUGINS,
  WORDTASTE_REMARK_PLUGINS,
} from "./markdown-plugins.js";
import {
  readRangeSegments,
  segmentsHaveConstruct,
  segmentsToSource,
} from "./math-selection.js";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import type { Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import type {
  Draft,
  Plan,
  TasteProfile,
  WorkflowState,
  WritingCandidate,
  WritingStage,
} from "../domain.js";
import {
  STAGES,
  buildSpanAddress,
  PLAN_SECTION_LABEL,
  candidateMarkdown,
  commandMessage,
  deriveDraft,
  deriveTaste,
  deriveWorkflow,
  findPlanUnit,
  inferStage,
  normalizeEmphasis,
  planRows,
  planSourceLabel,
  planUnitCaption,
  progressPercent,
  stageIndex,
  type WordtasteAddress,
} from "./studio-logic.js";
import {
  otherSkin,
  readStoredSkin,
  resolveFont,
  resolveSkin,
  resolveSurfaceTheme,
  skinStorageKey,
  surfaceCssVars,
  writeStoredSkin,
  type SurfaceSkin,
} from "./font-theme.js";

interface WordtasteConfig {
  font?: string;
  theme?: string;
  fontSuggested?: string;
  themeSuggested?: string;
  skin?: string;
  skinSuggested?: string;
  [key: string]: unknown;
}

interface SelectionPopup {
  address: WordtasteAddress;
  rect: { top: number; bottom: number; left: number; right: number };
}

interface Material {
  path: string;
  label: string;
  content: string;
}

const STATUS: Record<WritingStage, string> = {
  intake: "Waiting for a goal",
  layout: "Needs your call",
  writing: "Writing in sequence",
  review: "Checking the whole",
  choice: "Choose by feel",
  final: "Ready to keep",
  distilled: "Saved and learned",
};

export default function WordtastePreview(props: ViewerPreviewProps) {
  const {
    sources,
    fileChannel,
    actionRequest,
    onActionResult,
    navigateRequest,
    onNavigateComplete,
    onNotifyAgent: rawOnNotifyAgent,
    onSelect: rawOnSelect,
    readonly,
  } = props;

  const onNotifyAgent = readonly ? undefined : rawOnNotifyAgent;
  const onSelect = readonly ? undefined : rawOnSelect;
  const activeContentSet = useStore((state) => state.activeContentSet) ?? "";
  const contentSets = useStore((state) => state.contentSets);
  const setActiveContentSet = useStore((state) => state.setActiveContentSet);
  // Only ever used to key the remembered reading surface to this session.
  const sessionId = useStore((state) => state.sessionId);

  const draftSource = sources.draft as Source<Draft> | undefined;
  const workflowSource = sources.workflow as Source<WorkflowState> | undefined;
  const tasteSource = sources.taste as Source<TasteProfile> | undefined;
  const configSource = sources.config as Source<WordtasteConfig> | undefined;

  const { status: draftStatus } = useSource(draftSource);
  const { status: workflowStatus } = useSource(workflowSource);
  useSource(tasteSource);
  const { value: config } = useSource(configSource);

  const [fileTick, setFileTick] = useState(0);
  useEffect(
    () => fileChannel.subscribe(() => setFileTick((tick) => tick + 1)),
    [fileChannel],
  );

  const files = useMemo(
    () => fileChannel.snapshot(),
    [
      fileChannel,
      fileTick,
      draftStatus.lastOrigin,
      workflowStatus.lastOrigin,
    ],
  );
  const draft = useMemo(
    () => deriveDraft(files, activeContentSet),
    [files, activeContentSet],
  );
  const workflow = useMemo(
    () => deriveWorkflow(files, activeContentSet),
    [files, activeContentSet],
  );
  const taste = useMemo(
    () => deriveTaste(files, activeContentSet),
    [files, activeContentSet],
  );
  const materials = useMemo(
    () => collectMaterials(files, activeContentSet),
    [files, activeContentSet],
  );

  const stage = inferStage(workflow, draft);
  const activeStageIndex = stageIndex(stage);
  // Emphasis indexes address the claim list the user is actually looking at.
  // A planned session lists `plan.claims`, a legacy one lists `layout.thesis`;
  // bounding against the wrong one would clip a mark the user could see and
  // click.
  const claimCount =
    workflow?.layout?.plan?.claims.length ?? workflow?.layout?.thesis.length ?? 0;
  const [emphasis, setEmphasis] = useState<number[]>(workflow?.emphasis ?? []);
  const [layoutNote, setLayoutNote] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState(
    workflow?.acceptedCandidateId ?? workflow?.candidates[0]?.id ?? "",
  );
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopup | null>(null);
  const [flashQuote, setFlashQuote] = useState("");

  useEffect(() => {
    setEmphasis(workflow?.emphasis ?? []);
    setLayoutNote("");
    setSelectedCandidateId(
      workflow?.acceptedCandidateId ?? workflow?.candidates[0]?.id ?? "",
    );
    setSelectionPopup(null);
  }, [
    activeContentSet,
    workflow?.updatedAt,
    workflow?.stage,
    workflow?.acceptedCandidateId,
  ]);

  const draftText = draft?.markdown ?? "";
  const font = useMemo(
    () => resolveFont(draftText.slice(0, 4000), config),
    [
      draftText,
      config?.font,
      config?.fontSuggested,
      config?.skin,
      config?.skinSuggested,
    ],
  );
  // The reading surface. `null` means "the user has not toggled in this
  // session", which is what lets the file stay the default.
  const skinKey = useMemo(() => skinStorageKey(sessionId), [sessionId]);
  const [skinChoice, setSkinChoice] = useState<SurfaceSkin | null>(() =>
    readStoredSkin(skinKey),
  );
  // One effect owns the whole state <-> storage sync, in both directions, so
  // there is exactly one writer.
  //
  // It has to run on the key as well as the choice: the session id arrives
  // with the WebSocket connect, which can land after this viewer mounts, so
  // the storage key changes underneath it. A choice already made in this
  // mount is carried across and written through — a late session id must
  // never silently undo a toggle the user is looking at — and only when there
  // is no choice yet does the stored habit flow back in.
  useEffect(() => {
    if (skinChoice) {
      writeStoredSkin(skinKey, skinChoice);
      return;
    }
    const stored = readStoredSkin(skinKey);
    if (stored) setSkinChoice(stored);
  }, [skinKey, skinChoice]);

  const skin = useMemo(
    () => resolveSkin(config, skinChoice),
    [
      skinChoice,
      config?.theme,
      config?.themeSuggested,
      config?.skin,
      config?.skinSuggested,
    ],
  );
  // Pure state. Persisting it is the sync effect's job, not this one's.
  const toggleSkin = useCallback(() => setSkinChoice(otherSkin(skin)), [skin]);

  const theme = useMemo(
    () => resolveSurfaceTheme(config, skin),
    [
      skin,
      config?.theme,
      config?.themeSuggested,
      config?.skin,
      config?.skinSuggested,
    ],
  );
  const surfaceVars = useMemo(
    () => surfaceCssVars(font, theme) as CSSProperties,
    [font, theme],
  );

  const gateRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);

  const fireCommand = useCallback(
    (
      id: string,
      summary: string,
      payload: Record<string, unknown> = {},
    ) => {
      if (!onNotifyAgent) return;
      onNotifyAgent({
        type: `wordtaste:${id}`,
        severity: "warning",
        summary,
        message: commandMessage(id, {
          contentSet: activeContentSet,
          stage,
          ...payload,
        }),
      });
    },
    [onNotifyAgent, activeContentSet, stage],
  );

  const focusGate = useCallback(() => {
    gateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const focusDraft = useCallback((quote?: string) => {
    articleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (quote) {
      setFlashQuote(quote);
      window.setTimeout(() => setFlashQuote(""), 1600);
    }
  }, []);

  useEffect(() => {
    if (!actionRequest) return;
    if (actionRequest.actionId === "navigate-to") {
      const address = actionRequest.params?.address as
        | WordtasteAddress
        | undefined;
      focusDraft(address?.quote);
      onActionResult?.(actionRequest.requestId, {
        success: true,
        message: "Draft focused.",
      });
      return;
    }
    if (actionRequest.actionId === "focus-stage") {
      focusGate();
      onActionResult?.(actionRequest.requestId, {
        success: true,
        message: "Active writing gate focused.",
      });
      return;
    }
    onActionResult?.(actionRequest.requestId, {
      success: false,
      message: `Unknown WordTaste action: ${actionRequest.actionId}`,
    });
  }, [actionRequest, focusDraft, focusGate, onActionResult]);

  useEffect(() => {
    if (!navigateRequest) return;
    const address = navigateRequest.address as WordtasteAddress;
    focusDraft(address.quote);
    onNavigateComplete?.();
  }, [navigateRequest, focusDraft, onNavigateComplete]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectionPopup(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleDraftSelection = useCallback(() => {
    if (!onSelect || !draft || stage === "choice") return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const article = articleRef.current;
    if (
      !article
      || !article.contains(range.startContainer)
      || !article.contains(range.endContainer)
    ) {
      return;
    }
    // Plain prose reads back off the Selection, as it always has. Anything
    // the renderer did not print verbatim does not: KaTeX drew
    // `t=(user_id,agent_id)` where the file says
    // `$t = (\mathit{user\_id}, \mathit{agent\_id})$`, and markdown drew
    // `recipe_json.py` where the file wrote `` `recipe_json.py` ``. A range
    // that crossed either is read back out of the DOM in source form instead
    // (`math-selection.ts`), and the segments travel with it so the lookup
    // can forgive what the renderer normalised away.
    const segments = readRangeSegments(range);
    const hasConstruct = segmentsHaveConstruct(segments);
    const quote = hasConstruct
      ? segmentsToSource(segments)
      : selection.toString().trim();
    const address = buildSpanAddress({
      contentSet: activeContentSet,
      markdown: draft.markdown,
      quote,
      segments: hasConstruct ? segments : undefined,
    });
    // Residual, deliberately silent: the constructs the walk does not model
    // — `~~struck~~`, an image, a heading's `## ` — still have no address,
    // and a stale draft can always leave a selection with none. This viewer
    // has no error surface to say so in, and inventing one for this is worse
    // than the gap; the fix is to teach the walk the missing element, not to
    // grow chrome here.
    if (!address) return;
    const rect = range.getBoundingClientRect();
    setSelectionPopup({
      address,
      rect: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      },
    });
    // The agent is told what the file says, not what the page drew — it goes
    // on to edit `draft.md`, and `address.quote` is a verbatim slice of it.
    const source = address.quote;
    const context: ViewerSelectionContext = {
      type: "span",
      content: source,
      file: address.file,
      label: `Selected text: “${source.slice(0, 72)}${source.length > 72 ? "…" : ""}”`,
      address,
    };
    onSelect(context);
  }, [onSelect, draft, stage, activeContentSet]);

  const activeCandidate = workflow?.candidates.find(
    (candidate) => candidate.id === selectedCandidateId,
  ) ?? workflow?.candidates[0];
  const activeCandidateIndex = activeCandidate
    ? workflow?.candidates.findIndex(
        (candidate) => candidate.id === activeCandidate.id,
      ) ?? -1
    : -1;
  const candidateText = activeCandidate
    ? candidateMarkdown(files, activeContentSet, activeCandidate)
    : "";
  const visibleDraft = stage === "choice" && candidateText
    ? candidateText
    : draftText;

  return (
    <div className="wordtaste-v2" data-skin={skin} style={surfaceVars}>
      <WordtasteStyles />
      <StudioHeader
        stage={stage}
        contentSets={contentSets}
        activeContentSet={activeContentSet}
        onContentSet={setActiveContentSet}
        canExport={Boolean(visibleDraft.trim())}
        onExport={() => exportMarkdown(visibleDraft, workflow?.layout?.title)}
        skin={skin}
        onToggleSkin={toggleSkin}
      />

      <div className="wordtaste-v2-body">
        <ProcessRail
          activeIndex={activeStageIndex}
          workflow={workflow}
          materials={materials}
          taste={taste}
        />

        <main className="wordtaste-workspace">
          <div ref={gateRef} className="wordtaste-gate-anchor">
            {stage === "intake" && (
              <IntakeGate
                readonly={Boolean(readonly)}
                onIdea={() =>
                  fireCommand(
                    "begin-from-idea",
                    "Start from a concrete idea",
                    { entry: "idea" },
                  )
                }
                onDraft={() =>
                  fireCommand(
                    "begin-from-draft",
                    "Rework the existing draft",
                    { entry: "draft" },
                  )
                }
              />
            )}

            {stage === "layout" && workflow?.layout && (
              <LayoutGate
                workflow={workflow}
                emphasis={emphasis}
                note={layoutNote}
                readonly={Boolean(readonly)}
                onEmphasis={(index) => {
                  const next = emphasis.includes(index)
                    ? emphasis.filter((value) => value !== index)
                    : [...emphasis, index];
                  setEmphasis(normalizeEmphasis(next, claimCount));
                }}
                onNote={setLayoutNote}
                onApprove={() =>
                  fireCommand(
                    "approve-layout",
                    "The layout is approved",
                    {
                      emphasis: normalizeEmphasis(emphasis, claimCount),
                      note: layoutNote.trim(),
                    },
                  )
                }
                onRevise={() =>
                  fireCommand(
                    "revise-layout",
                    "The layout needs a change",
                    { note: layoutNote.trim() },
                  )
                }
              />
            )}

            {stage === "writing" && (
              <WritingGate workflow={workflow} hasDraft={Boolean(draftText.trim())} />
            )}

            {(stage === "review" || stage === "choice") && (
              <ReviewGate
                workflow={workflow}
                activeCandidate={activeCandidate}
                selectedCandidateId={selectedCandidateId}
                readonly={Boolean(readonly)}
                onCandidate={setSelectedCandidateId}
                onChoose={() => {
                  if (!activeCandidate) return;
                  fireCommand(
                    "choose-candidate",
                    `Choose version ${activeCandidate.label}`,
                    { candidateId: activeCandidate.id },
                  );
                }}
                onReject={() =>
                  fireCommand(
                    "reject-candidates",
                    "None of the versions land",
                    {
                      candidateIds: workflow?.candidates.map(
                        (candidate) => candidate.id,
                      ) ?? [],
                    },
                  )
                }
              />
            )}

            {(stage === "final" || stage === "distilled") && (
              <FinalGate
                workflow={workflow}
                taste={taste}
                readonly={Boolean(readonly)}
                onAccept={() =>
                  fireCommand(
                    "accept-draft",
                    "Keep this version and distill the session",
                    {},
                  )
                }
              />
            )}
          </div>

          {visibleDraft.trim() ? (
            <DraftSurface
              ref={articleRef}
              markdown={visibleDraft}
              stage={stage}
              labelledBy={
                stage === "choice" && activeCandidateIndex >= 0
                  ? `wordtaste-candidate-tab-${activeCandidateIndex}`
                  : undefined
              }
              flashQuote={flashQuote}
              onMouseUp={handleDraftSelection}
            />
          ) : stage !== "intake" && stage !== "layout" ? (
            <WritingEmpty stage={stage} />
          ) : null}
        </main>
      </div>

      {selectionPopup
        && createPortal(
          <SelectionMenu
            popup={selectionPopup}
            skin={skin}
            onFlag={() => {
              fireCommand(
                "flag-selection",
                "A selected line still feels fake",
                { address: selectionPopup.address },
              );
              setSelectionPopup(null);
            }}
            onVariants={() => {
              fireCommand(
                "request-variants",
                "Generate a few local alternatives",
                { address: selectionPopup.address },
              );
              setSelectionPopup(null);
            }}
            onClose={() => setSelectionPopup(null)}
          />,
          document.body,
        )}
    </div>
  );
}

function StudioHeader({
  stage,
  contentSets,
  activeContentSet,
  onContentSet,
  canExport,
  onExport,
  skin,
  onToggleSkin,
}: {
  stage: WritingStage;
  contentSets: Array<{ prefix: string; label: string }>;
  activeContentSet: string;
  onContentSet: (prefix: string) => void;
  canExport: boolean;
  onExport: () => void;
  skin: SurfaceSkin;
  onToggleSkin: () => void;
}) {
  // The icon shows the surface the press moves TO, which is what the label
  // says as well — a reader should never have to guess whether the sun means
  // "you are here" or "go here".
  const toLight = skin === "dark";
  const skinLabel = toLight
    ? "Switch to the light reading surface"
    : "Switch to the dark reading surface";
  return (
    <header className="wordtaste-header">
      <div className="wordtaste-brand">
        <WordmarkIcon />
        <span>WordTaste</span>
        <span className="wordtaste-scope">Chinese long-form</span>
      </div>
      <div className="wordtaste-header-status">
        <span className={`wordtaste-status-dot is-${stage}`} />
        {STATUS[stage]}
      </div>
      <div className="wordtaste-header-actions">
        {contentSets.length > 1 && (
          <select
            className="wordtaste-project-select"
            name="writing-project"
            value={activeContentSet}
            onChange={(event) => onContentSet(event.target.value)}
            aria-label="Writing project"
          >
            {contentSets.map((set) => (
              <option key={set.prefix} value={set.prefix}>
                {set.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="wordtaste-header-button wordtaste-skin-toggle"
          onClick={onToggleSkin}
          aria-label={skinLabel}
          aria-pressed={skin === "light"}
          title={skinLabel}
        >
          {toLight ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          className="wordtaste-header-button"
          disabled={!canExport}
          onClick={onExport}
          aria-label="Export"
        >
          <ExportIcon />
          <span className="wordtaste-header-label">Export</span>
        </button>
      </div>
    </header>
  );
}

function ProcessRail({
  activeIndex,
  workflow,
  materials,
  taste,
}: {
  activeIndex: number;
  workflow: WorkflowState | null;
  materials: Material[];
  taste: TasteProfile | null;
}) {
  return (
    <aside className="wordtaste-process">
      <div className="wordtaste-process-title">The writing path</div>
      <ol className="wordtaste-stage-list">
        {STAGES.map((stage, index) => (
          <li
            key={stage.id}
            className={[
              "wordtaste-stage",
              index === activeIndex ? "is-active" : "",
              index < activeIndex ? "is-complete" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="wordtaste-stage-marker">
              {index < activeIndex ? <CheckIcon /> : index + 1}
            </span>
            <span>
              <strong>{stage.label}</strong>
              <small>{stage.description}</small>
            </span>
          </li>
        ))}
      </ol>

      {workflow?.goal && (
        <div className="wordtaste-goal-summary">
          <span>Current goal</span>
          <p>{workflow.goal}</p>
        </div>
      )}

      {workflow?.stage === "writing" && (
        <div className="wordtaste-progress-block">
          <div>
            <span>Draft progress</span>
            <strong>{progressPercent(workflow)}%</strong>
          </div>
          <div className="wordtaste-progress-track">
            <span
              style={{
                transform: `scaleX(${progressPercent(workflow) / 100})`,
              }}
            />
          </div>
        </div>
      )}

      <details className="wordtaste-rail-details">
        <summary>
          Source material
          <span>{materials.length}</span>
        </summary>
        <div className="wordtaste-material-list">
          {materials.length ? (
            materials.map((material) => (
              <details key={material.path}>
                <summary>{material.label}</summary>
                <div className="wordtaste-material-copy">
                  <ReactMarkdown
                    remarkPlugins={WORDTASTE_REMARK_PLUGINS}
                    rehypePlugins={WORDTASTE_REHYPE_PLUGINS}
                    components={WORDTASTE_MARKDOWN_COMPONENTS}
                  >
                    {material.content || "_Empty_"}
                  </ReactMarkdown>
                </div>
              </details>
            ))
          ) : (
            <p>Outline, original text, and references will appear here.</p>
          )}
        </div>
      </details>

      {taste && (
        <details className="wordtaste-rail-details">
          <summary>
            What it remembers
            <span>{taste.prefsCount}</span>
          </summary>
          <div className="wordtaste-memory">
            {taste.voiceFloor ? (
              <ReactMarkdown
                remarkPlugins={WORDTASTE_REMARK_PLUGINS}
                rehypePlugins={WORDTASTE_REHYPE_PLUGINS}
                components={WORDTASTE_MARKDOWN_COMPONENTS}
              >
                {taste.voiceFloor}
              </ReactMarkdown>
            ) : (
              <p>No stable voice floor yet. It will grow from real choices.</p>
            )}
            <dl>
              <div>
                <dt>Past decisions</dt>
                <dd>{taste.prefsCount}</dd>
              </div>
              <div>
                <dt>Hand edits kept</dt>
                <dd>{taste.swapCount}</dd>
              </div>
              <div>
                <dt>Recipes</dt>
                <dd>{taste.recipeNames.length}</dd>
              </div>
            </dl>
          </div>
        </details>
      )}
    </aside>
  );
}

function IntakeGate({
  readonly,
  onIdea,
  onDraft,
}: {
  readonly: boolean;
  onIdea: () => void;
  onDraft: () => void;
}) {
  return (
    <section className="wordtaste-intake">
      <div className="wordtaste-intake-copy">
        <span className="wordtaste-kicker">Start with the work</span>
        <h1>Bring a real writing goal.</h1>
        <p>
          WordTaste learns your taste while doing the piece. There is no style
          questionnaire and no setup ritual.
        </p>
      </div>
      <div className="wordtaste-entry-options">
        <button type="button" disabled={readonly} onClick={onIdea}>
          <IdeaIcon />
          <span>
            <strong>I have an idea or loose outline</strong>
            <small>Shape the argument first, then write it in sequence.</small>
          </span>
          <ArrowIcon />
        </button>
        <button type="button" disabled={readonly} onClick={onDraft}>
          <DraftIcon />
          <span>
            <strong>I have a draft that does not sound right</strong>
            <small>Protect the meaning, rebuild the writing around it.</small>
          </span>
          <ArrowIcon />
        </button>
      </div>
      <p className="wordtaste-honesty">
        Calibrated for Chinese knowledge essays and long-form prose. Other
        formats can run, but the defaults are not yet evidence-backed.
      </p>
    </section>
  );
}

function LayoutGate({
  workflow,
  emphasis,
  note,
  readonly,
  onEmphasis,
  onNote,
  onApprove,
  onRevise,
}: {
  workflow: WorkflowState;
  emphasis: number[];
  note: string;
  readonly: boolean;
  onEmphasis: (index: number) => void;
  onNote: (value: string) => void;
  onApprove: () => void;
  onRevise: () => void;
}) {
  const layout = workflow.layout!;
  // A planned session shows the plan; a legacy one shows the prose projection
  // it was written with. There is no toggle between them — the session either
  // has a plan or it does not.
  const plan = layout.plan;
  const claims = plan
    ? plan.claims
    : layout.thesis.map((text) => ({ text, source: "" }));
  const openQuestion = layout.openQuestion ?? plan?.open_question?.trim() ?? "";
  return (
    <section className="wordtaste-layout-gate">
      <div className="wordtaste-gate-heading">
        <span>Your call</span>
        <h1>Is this the argument you want to make?</h1>
        <p>
          Confirm the core claims. Mark at most three that deserve the
          strongest landing; the rest should support them, not compete.
        </p>
      </div>

      {openQuestion && (
        <div className="wordtaste-open-question">
          <QuestionIcon />
          <div>
            <strong>One thing is still open</strong>
            <p>{openQuestion}</p>
          </div>
        </div>
      )}

      <div className="wordtaste-thesis">
        <h2>{plan?.title || layout.title || "Untitled piece"}</h2>
        <ol>
          {claims.map((claim, index) => {
            const selected = emphasis.includes(index);
            return (
              <li key={`${index}-${claim.text}`}>
                <span className="wordtaste-claim-number">{index + 1}</span>
                <div className="wordtaste-claim-body">
                  <p>{claim.text}</p>
                  {claim.source && (
                    <span className="wordtaste-claim-source" title={claim.source}>
                      {planSourceLabel(claim.source)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className={selected ? "is-selected" : ""}
                  disabled={readonly || (!selected && emphasis.length >= 3)}
                  onClick={() => onEmphasis(index)}
                  aria-pressed={selected}
                >
                  <FocusIcon filled={selected} />
                  {selected ? "Strong landing" : "Make this one count"}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {plan ? (
        <PlanUnits plan={plan} />
      ) : (
        <details className="wordtaste-plan-details">
          <summary>
            How it will move
            <span>{layout.units.length} writing units</span>
          </summary>
          <ol>
            {layout.units.map((unit, index) => (
              <li key={unit.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{unit.brief}</strong>
                  {(unit.role || unit.rhythm || unit.emphasis) && (
                    <small>
                      {[unit.role, unit.rhythm, unit.emphasis]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}

      <label className="wordtaste-note-field">
        <span>Anything to change before writing?</span>
          <textarea
            name="layout-note"
            value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder="For example: claim 2 is too strong; end with the practical consequence."
          disabled={readonly}
          rows={3}
        />
      </label>

      <div className="wordtaste-gate-actions">
        <button
          type="button"
          className="wordtaste-secondary"
          disabled={readonly || !note.trim()}
          onClick={onRevise}
        >
          Change the shape
        </button>
        <button
          type="button"
          className="wordtaste-primary"
          disabled={readonly}
          onClick={onApprove}
        >
          This is the argument. Start writing
          <ArrowIcon />
        </button>
      </div>
    </section>
  );
}

/**
 * The plan, shown as a plan.
 *
 * A prose list reads like a summary of an article; a table reads like a
 * sequence someone is about to execute, which is what the user is being asked
 * to approve. Every cell is a fact the plan already committed to — what the
 * unit does, which headings it reads, roughly how long, how many sentences it
 * must not lose, how tightly it is packed and whether it stops or leaves the
 * door open. The planner's own words are English and stay in a muted line
 * under the row, where they cannot be mistaken for the author's material.
 *
 * The table scrolls inside its own container: on a narrow window the row must
 * stay a row, and the page must not start sliding sideways to show it.
 */
function PlanUnits({ plan }: { plan: Plan }) {
  const rows = planRows(plan);
  return (
    <section className="wordtaste-plan" aria-labelledby="wordtaste-plan-heading">
      <div className="wordtaste-plan-head">
        <h3 id="wordtaste-plan-heading">How it will move</h3>
        <span>{rows.length} writing units</span>
      </div>
      <div
        className="wordtaste-plan-scroll"
        role="region"
        aria-labelledby="wordtaste-plan-heading"
        tabIndex={0}
      >
        <table className="wordtaste-plan-table">
          <thead>
            <tr>
              <th scope="col" className="wordtaste-plan-order">#</th>
              <th scope="col">What it does</th>
              <th scope="col">Reads from</th>
              <th scope="col" className="wordtaste-plan-figure">Target chars</th>
              <th scope="col" className="wordtaste-plan-figure">Must keep</th>
              <th scope="col">Rhythm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr className="wordtaste-plan-row">
                  <td className="wordtaste-plan-order">{row.order}</td>
                  <td className="wordtaste-plan-role">
                    {row.roleLabel}
                    {row.opensSection && (
                      <span className="wordtaste-plan-section" title="Opens a new section">
                        {PLAN_SECTION_LABEL}
                      </span>
                    )}
                  </td>
                  <td>
                    {row.spans.length ? (
                      <div className="wordtaste-plan-spans">
                        {row.spans.map((span, index) => (
                          <span
                            className="wordtaste-plan-span"
                            key={`${span.from}-${span.to}-${index}`}
                          >
                            <code title={span.from}>{span.from}</code>
                            <i aria-hidden>→</i>
                            <code title={span.to}>{span.to}</code>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="wordtaste-plan-blank">—</span>
                    )}
                  </td>
                  <td className="wordtaste-plan-figure">≈{row.targetChars}</td>
                  <td className="wordtaste-plan-figure">
                    {row.mustKeepCount || (
                      <span className="wordtaste-plan-blank">—</span>
                    )}
                  </td>
                  <td>
                    <span className="wordtaste-plan-chips">
                      <span className="wordtaste-plan-chip">{row.paceLabel}</span>
                      <span className="wordtaste-plan-chip">{row.endsLabel}</span>
                    </span>
                  </td>
                </tr>
                {row.notes && (
                  <tr className="wordtaste-plan-notes">
                    <td />
                    <td colSpan={5}>{row.notes}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WritingGate({
  workflow,
  hasDraft,
}: {
  workflow: WorkflowState | null;
  hasDraft: boolean;
}) {
  const progress = workflow?.progress;
  const done = progress?.completedUnits.length ?? 0;
  const total = progress?.totalUnits ?? workflow?.layout?.units.length ?? 0;
  // "u1" names the unit without saying anything about it. When the session
  // carries a plan, the same line can say what the unit is for and which
  // headings it is reading — the two things a reader needs to judge whether
  // the writing is on the right material.
  const currentUnit = findPlanUnit(workflow?.layout?.plan, progress?.currentUnit);
  return (
    <section className="wordtaste-writing-gate">
      <div>
        <span>Writing now</span>
        <h1>
          {progress?.currentUnit
            ? `Working through ${progress.currentUnit}`
            : "Building the piece in sequence"}
        </h1>
        {currentUnit && (
          <p
            className="wordtaste-writing-unit"
            title={planUnitCaption(currentUnit)}
          >
            {planUnitCaption(currentUnit)}
          </p>
        )}
        <p>
          Each unit grows from the text before it. A fresh reader checks the
          joins and the whole argument before anything comes back to you.
        </p>
      </div>
      <div className="wordtaste-writing-count">
        <strong>{done}</strong>
        <span>of {total || "—"} units complete</span>
      </div>
      {!hasDraft && <div className="wordtaste-inline-skeleton" aria-hidden />}
    </section>
  );
}

function ReviewGate({
  workflow,
  activeCandidate,
  selectedCandidateId,
  readonly,
  onCandidate,
  onChoose,
  onReject,
}: {
  workflow: WorkflowState | null;
  activeCandidate?: WritingCandidate;
  selectedCandidateId: string;
  readonly: boolean;
  onCandidate: (id: string) => void;
  onChoose: () => void;
  onReject: () => void;
}) {
  const candidates = workflow?.candidates ?? [];
  const issues = workflow?.review?.issues ?? [];
  const isChoice = workflow?.stage === "choice" && candidates.length > 0;
  const activeCandidateId = activeCandidate?.id ?? selectedCandidateId;

  if (isChoice) {
    return (
      <section className="wordtaste-choice-gate">
        <div className="wordtaste-gate-heading">
          <span>Your call</span>
          <h1>Which one feels closer?</h1>
          <p>
            Labels are deliberately neutral. Read for the writing, not for who
            made it or how long it is.
          </p>
        </div>
        <div className="wordtaste-candidate-tabs" role="tablist">
          {candidates.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              id={`wordtaste-candidate-tab-${index}`}
              aria-controls="wordtaste-candidate-panel"
              aria-selected={candidate.id === activeCandidateId}
              tabIndex={candidate.id === activeCandidateId ? 0 : -1}
              className={candidate.id === activeCandidateId ? "is-active" : ""}
              onClick={() => onCandidate(candidate.id)}
              onKeyDown={(event) => {
                let nextIndex = index;
                if (event.key === "ArrowRight") {
                  nextIndex = (index + 1) % candidates.length;
                } else if (event.key === "ArrowLeft") {
                  nextIndex = (index - 1 + candidates.length) % candidates.length;
                } else if (event.key === "Home") {
                  nextIndex = 0;
                } else if (event.key === "End") {
                  nextIndex = candidates.length - 1;
                } else {
                  return;
                }
                event.preventDefault();
                onCandidate(candidates[nextIndex].id);
                const tabs = event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                tabs?.[nextIndex]?.focus();
              }}
            >
              Version {candidate.label}
            </button>
          ))}
        </div>
        {activeCandidate?.note && (
          <p className="wordtaste-candidate-note">{activeCandidate.note}</p>
        )}
        <div className="wordtaste-gate-actions">
          <button
            type="button"
            className="wordtaste-secondary"
            disabled={readonly}
            onClick={onReject}
          >
            None of these
          </button>
          <button
            type="button"
            className="wordtaste-primary"
            disabled={readonly || !activeCandidate}
            onClick={onChoose}
          >
            Keep version {activeCandidate?.label ?? ""}
            <ArrowIcon />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="wordtaste-review-gate">
      <div className="wordtaste-gate-heading">
        <span>Fresh eyes</span>
        <h1>The whole piece is being checked.</h1>
        <p>
          Meaning, joins, repetition, and reading rhythm are checked separately
          from whether the writing feels good.
        </p>
      </div>
      {workflow?.review?.summary && (
        <p className="wordtaste-review-summary">{workflow.review.summary}</p>
      )}
      {issues.length > 0 && (
        <div className="wordtaste-issues">
          {issues.slice(0, 4).map((issue, index) => (
            <blockquote key={`${issue.quote}-${index}`}>
              <p>“{issue.quote}”</p>
              <footer>{issue.problem}</footer>
            </blockquote>
          ))}
        </div>
      )}
    </section>
  );
}

function FinalGate({
  workflow,
  taste,
  readonly,
  onAccept,
}: {
  workflow: WorkflowState | null;
  taste: TasteProfile | null;
  readonly: boolean;
  onAccept: () => void;
}) {
  const done = workflow?.stage === "distilled";
  return (
    <section className={`wordtaste-final-gate ${done ? "is-done" : ""}`}>
      <div>
        <span>{done ? "Kept" : "Read it as a reader"}</span>
        <h1>{done ? "This session is in the profile." : "Does this one land?"}</h1>
        <p>
          {done
            ? workflow?.finalNote
              || "The decisions, candidates, and useful hand edits are saved for the next piece."
            : "Select any line that still feels false, or keep the version and let WordTaste distill what worked."}
        </p>
      </div>
      {done ? (
        <div className="wordtaste-learned-counts">
          <span>{taste?.prefsCount ?? 0} decisions</span>
          <span>{taste?.swapCount ?? 0} hand edits</span>
          <span>{taste?.recipeNames.length ?? 0} recipes</span>
        </div>
      ) : (
        <button
          type="button"
          className="wordtaste-primary"
          disabled={readonly}
          onClick={onAccept}
        >
          Keep this version
          <CheckIcon />
        </button>
      )}
    </section>
  );
}

const DraftSurface = forwardRef<
  HTMLElement,
  {
    markdown: string;
    stage: WritingStage;
    labelledBy?: string;
    flashQuote: string;
    onMouseUp: () => void;
  }
>(function DraftSurface(
  { markdown, stage, labelledBy, flashQuote, onMouseUp },
  ref,
) {
  return (
    <section className="wordtaste-draft-shell">
      <div className="wordtaste-draft-label">
        <span>{stage === "choice" ? "Candidate" : "Current draft"}</span>
        {stage !== "choice" && <span>Select a line to point at it</span>}
      </div>
      <article
        ref={ref}
        id={stage === "choice" ? "wordtaste-candidate-panel" : undefined}
        role={stage === "choice" ? "tabpanel" : undefined}
        aria-labelledby={stage === "choice" ? labelledBy : undefined}
        className={[
          "wordtaste-draft",
          flashQuote ? "is-flashing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onMouseUp={stage === "choice" ? undefined : onMouseUp}
        onKeyUp={stage === "choice" ? undefined : onMouseUp}
        data-flash-quote={flashQuote || undefined}
      >
        <ReactMarkdown
          remarkPlugins={WORDTASTE_REMARK_PLUGINS}
          rehypePlugins={WORDTASTE_REHYPE_PLUGINS}
          components={WORDTASTE_MARKDOWN_COMPONENTS}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </section>
  );
});

function WritingEmpty({ stage }: { stage: WritingStage }) {
  return (
    <div className="wordtaste-writing-empty">
      <div className="wordtaste-empty-lines" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <p>
        {stage === "writing"
          ? "The first unit will appear here as soon as it lands."
          : "The next version will appear here."}
      </p>
    </div>
  );
}

function SelectionMenu({
  popup,
  skin,
  onFlag,
  onVariants,
  onClose,
}: {
  popup: SelectionPopup;
  /**
   * The menu is portaled to `document.body`, so it inherits nothing from the
   * studio root — it carries the surface itself, and the stylesheet declares
   * the `--wt-*` token set for both mount points.
   */
  skin: SurfaceSkin;
  onFlag: () => void;
  onVariants: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu && event.composedPath().includes(menu)) return;
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose]);

  const width = 268;
  const left = Math.max(
    12,
    Math.min(window.innerWidth - width - 12, (popup.rect.left + popup.rect.right) / 2 - width / 2),
  );
  const menuHeight = 152;
  const top =
    popup.rect.bottom + menuHeight + 10 <= window.innerHeight
      ? popup.rect.bottom + 10
      : Math.max(12, popup.rect.top - menuHeight - 10);
  return (
    <div
      ref={menuRef}
      className="wordtaste-selection-menu"
      data-skin={skin}
      style={{ left, top }}
      role="toolbar"
      aria-label="Selected text actions"
    >
      <div className="wordtaste-selection-head">
        <span>Point, do not diagnose</span>
        <button type="button" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>
      <button type="button" onClick={onFlag}>
        <FlagIcon />
        This line feels fake
      </button>
      <button type="button" onClick={onVariants}>
        <VariantsIcon />
        Show a few ways through
      </button>
    </div>
  );
}

function collectMaterials(
  files: ReadonlyArray<{ path: string; content: string }>,
  contentSet: string,
): Material[] {
  const prefix = contentSet ? `${contentSet}/materials/` : "materials/";
  return files
    .filter(
      (file) =>
        file.path.startsWith(prefix) && /\.(md|txt)$/i.test(file.path),
    )
    .map((file) => {
      const relative = file.path.slice(prefix.length);
      return {
        path: file.path,
        label: relative
          .replace(/\.[^.]+$/, "")
          .split("/")
          .map((part) => part.replace(/[-_]/g, " "))
          .join(" / "),
        content: file.content,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function exportMarkdown(markdown: string, title?: string) {
  if (!markdown.trim()) return;
  const safe = (title || "wordtaste-draft")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "");
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safe || "wordtaste-draft"}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Svg({
  children,
  viewBox = "0 0 24 24",
}: {
  children: ReactNode;
  viewBox?: string;
}) {
  return (
    <svg
      className="wordtaste-icon"
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function WordmarkIcon() {
  return (
    <Svg>
      <path d="M5 5h14M5 10h9M5 15h12M5 20h7" />
      <path d="m16 9 2 2 3-4" />
    </Svg>
  );
}

function ExportIcon() {
  return (
    <Svg>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M5 15v5h14v-5" />
    </Svg>
  );
}

/** The light surface, drawn as the daylight it is. */
function SunIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </Svg>
  );
}

/** The dark surface. */
function MoonIcon() {
  return (
    <Svg>
      <path d="M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2Z" />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg>
      <path d="m5 12 4 4L19 6" />
    </Svg>
  );
}

function ArrowIcon() {
  return (
    <Svg>
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </Svg>
  );
}

function IdeaIcon() {
  return (
    <Svg>
      <path d="M9 18h6m-5 3h4" />
      <path d="M8.5 14.5c-1.2-1-2-2.5-2-4.3a5.5 5.5 0 0 1 11 0c0 1.8-.8 3.3-2 4.3-.7.6-1.1 1.2-1.2 1.8H9.7c-.1-.6-.5-1.2-1.2-1.8Z" />
    </Svg>
  );
}

function DraftIcon() {
  return (
    <Svg>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </Svg>
  );
}

function QuestionIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 17h.01" />
    </Svg>
  );
}

function FocusIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="wordtaste-icon"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m12 3 2.8 5.7L21 9.6l-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <Svg>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

function FlagIcon() {
  return (
    <Svg>
      <path d="M6 21V4m0 0h11l-2 3 2 3H6" />
    </Svg>
  );
}

function VariantsIcon() {
  return (
    <Svg>
      <path d="M4 7h16M4 12h10M4 17h13" />
      <path d="m17 10 3 2-3 2" />
    </Svg>
  );
}

function WordtasteStyles() {
  return <style>{STYLES}</style>;
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,550;6..72,650&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap');
@import url('https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/lxgwwenkaiscreen.css');

/* The studio surface is ONE token set with two value sets, keyed by
   [data-skin]. Every rule below is written against these names and none of
   them branches on the skin: switching surface re-values the tokens, it does
   not fork the stylesheet. The selection menu is portaled to <body> — it
   inherits nothing from the studio root, so it carries the same attribute and
   is listed alongside it here.

   Note on color-scheme: it is deliberately NOT set. The document has none, so
   declaring "dark" here would repaint today's native selects and scrollbars,
   and declaring "light" would only restate the document default. */
.wordtaste-v2, .wordtaste-selection-menu {
  /* dark — the Ethereal Tech desk this mode has always read on */
  --wt-chrome: var(--color-cc-bg, #09090b);
  --wt-panel: var(--color-cc-surface, #111113);
  --wt-raised: var(--color-cc-card, #18181b);
  --wt-border: var(--color-cc-border, #29292e);
  --wt-ink: var(--color-cc-fg, #f4f4f5);
  --wt-muted: var(--color-cc-muted, #a1a1aa);
  --wt-accent: var(--color-cc-primary, #f97316);
  --wt-accent-hover: #fb923c;
  --wt-on-accent: #111113;
  --wt-accent-soft: color-mix(in srgb, var(--wt-accent) 14%, transparent);
  --wt-success: #65a30d;
  --wt-success-ink: #a3e635;
  --wt-info: #38bdf8;
  --wt-done: #84cc16;
  --wt-card-shadow: 0 18px 70px rgba(0,0,0,.18);
  --wt-menu-shadow: 0 18px 60px rgba(0,0,0,.5);
}

/* light — a warm paper desk. Deliberately not white and not black: the page
   the draft renders on is the parchment palette (#f7f2e9), so the desk sits a
   few percent below it and the panels a few percent above, which is what makes
   the draft read as a lit page rather than a flat region. Ink is the same
   #2b2620 the parchment article uses. The accent is burnt sienna rather than
   the neon orange — #f97316 on paper measures 3.3:1 against small text, this
   clears 4.5:1 on both the desk and the panels. */
.wordtaste-v2[data-skin="light"], .wordtaste-selection-menu[data-skin="light"] {
  --wt-chrome: #ebe4d7;
  --wt-panel: #faf6ee;
  --wt-raised: #f1ebdf;
  --wt-border: #ded3c1;
  --wt-ink: #2b2620;
  --wt-muted: #655c4f;
  --wt-accent: #a34a19;
  --wt-accent-hover: #8a3d13;
  --wt-on-accent: #fdfaf4;
  --wt-success: #4d7c0f;
  --wt-success-ink: #3f6212;
  --wt-info: #0369a1;
  --wt-done: #4d7c0f;
  --wt-card-shadow: 0 12px 40px rgba(84,66,40,.11);
  --wt-menu-shadow: 0 14px 44px rgba(84,66,40,.20);
}

.wordtaste-v2 {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--wt-ink);
  background: var(--wt-chrome);
  font-family: "DM Sans", Inter, system-ui, sans-serif;
}

.wordtaste-v2 *, .wordtaste-v2 *::before, .wordtaste-v2 *::after { box-sizing: border-box; }
.wordtaste-v2 button, .wordtaste-v2 textarea, .wordtaste-v2 select { font-family: inherit; }
.wordtaste-v2 button:focus-visible, .wordtaste-v2 textarea:focus-visible, .wordtaste-v2 select:focus-visible,
.wordtaste-plan-scroll:focus-visible, .wordtaste-selection-menu button:focus-visible {
  outline: 2px solid var(--wt-accent, #f97316);
  outline-offset: 2px;
}
.wordtaste-icon { width: 17px; height: 17px; flex: 0 0 auto; }

.wordtaste-header {
  min-height: 54px;
  padding: 0 14px 0 18px;
  display: flex;
  align-items: center;
  gap: 18px;
  border-bottom: 1px solid var(--wt-border);
  background: var(--wt-panel);
  position: relative;
  z-index: 5;
}
.wordtaste-brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: -0.01em; }
.wordtaste-brand .wordtaste-icon { color: var(--wt-accent); width: 19px; height: 19px; }
.wordtaste-scope {
  margin-left: 5px;
  padding-left: 12px;
  border-left: 1px solid var(--wt-border);
  color: var(--wt-muted);
  font-size: 11px;
  font-weight: 500;
}
.wordtaste-header-status { display: flex; align-items: center; gap: 8px; color: var(--wt-muted); font-size: 12px; }
.wordtaste-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--wt-muted); }
.wordtaste-status-dot.is-layout, .wordtaste-status-dot.is-choice { background: var(--wt-accent); box-shadow: 0 0 0 4px var(--wt-accent-soft); }
.wordtaste-status-dot.is-writing, .wordtaste-status-dot.is-review { background: var(--wt-info); }
.wordtaste-status-dot.is-final, .wordtaste-status-dot.is-distilled { background: var(--wt-done); }
.wordtaste-header-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.wordtaste-project-select {
  height: 32px;
  border: 1px solid var(--wt-border);
  border-radius: 8px;
  background: var(--wt-raised);
  color: var(--wt-ink);
  font-size: 12px;
  max-width: 170px;
  padding: 0 28px 0 10px;
}
.wordtaste-header-button {
  height: 30px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--wt-muted);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: color .14s ease, background .14s ease, border-color .14s ease;
}
.wordtaste-header-button:hover:not(:disabled) {
  border-color: var(--wt-border);
  background: var(--wt-raised);
  color: var(--wt-ink);
}
.wordtaste-header-button:disabled { opacity: .35; cursor: default; }
.wordtaste-header-button .wordtaste-icon { width: 13px; height: 13px; }

.wordtaste-v2-body { flex: 1; min-height: 0; display: flex; }
.wordtaste-process {
  width: 246px;
  flex: 0 0 246px;
  overflow-y: auto;
  padding: 22px 16px 28px;
  background: var(--wt-panel);
  border-right: 1px solid var(--wt-border);
}
.wordtaste-process-title { margin: 0 8px 14px; color: var(--wt-muted); font-size: 11px; font-weight: 600; }
.wordtaste-stage-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.wordtaste-stage {
  min-height: 53px;
  display: flex;
  align-items: flex-start;
  gap: 11px;
  position: relative;
  color: color-mix(in srgb, var(--wt-muted) 68%, transparent);
}
.wordtaste-stage:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 13px;
  top: 29px;
  bottom: 0;
  width: 1px;
  background: var(--wt-border);
}
.wordtaste-stage-marker {
  width: 27px;
  height: 27px;
  border-radius: 50%;
  border: 1px solid var(--wt-border);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: var(--wt-panel);
  color: inherit;
  font-size: 11px;
  position: relative;
  z-index: 1;
}
.wordtaste-stage-marker .wordtaste-icon { width: 13px; height: 13px; }
.wordtaste-stage > span:last-child { padding-top: 2px; min-width: 0; }
.wordtaste-stage strong { display: block; color: inherit; font-size: 12.5px; font-weight: 600; }
.wordtaste-stage small { display: block; margin-top: 2px; color: inherit; font-size: 10.5px; line-height: 1.35; }
.wordtaste-stage.is-active { color: var(--wt-ink); }
.wordtaste-stage.is-active .wordtaste-stage-marker { border-color: var(--wt-accent); background: var(--wt-accent-soft); color: var(--wt-accent); }
.wordtaste-stage.is-complete { color: var(--wt-muted); }
.wordtaste-stage.is-complete .wordtaste-stage-marker { border-color: color-mix(in srgb, var(--wt-success) 55%, var(--wt-border)); color: var(--wt-success-ink); }

.wordtaste-goal-summary, .wordtaste-progress-block {
  margin: 16px 4px 0;
  padding: 13px 12px;
  border-top: 1px solid var(--wt-border);
}
.wordtaste-goal-summary span, .wordtaste-progress-block span { font-size: 10.5px; color: var(--wt-muted); }
.wordtaste-goal-summary p { margin: 5px 0 0; font-size: 12px; line-height: 1.5; color: var(--wt-ink); }
.wordtaste-progress-block > div:first-child { display: flex; align-items: baseline; justify-content: space-between; }
.wordtaste-progress-block strong { font-size: 12px; }
.wordtaste-progress-track { height: 4px; margin-top: 9px; border-radius: 4px; overflow: hidden; background: var(--wt-border); }
.wordtaste-progress-track span { display: block; width: 100%; height: 100%; background: var(--wt-info); transform-origin: left center; transition: transform .2s cubic-bezier(.16,1,.3,1); }

.wordtaste-rail-details { margin: 14px 4px 0; border-top: 1px solid var(--wt-border); }
.wordtaste-rail-details > summary {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  list-style: none;
  font-size: 11.5px;
  color: var(--wt-muted);
}
.wordtaste-rail-details > summary::-webkit-details-marker { display: none; }
.wordtaste-rail-details > summary span { min-width: 21px; text-align: center; padding: 2px 5px; border-radius: 10px; background: var(--wt-raised); font-size: 10px; }
.wordtaste-material-list { display: flex; flex-direction: column; gap: 4px; padding-bottom: 6px; }
.wordtaste-material-list > p { margin: 0; color: var(--wt-muted); font-size: 11px; line-height: 1.5; }
.wordtaste-material-list details { border-bottom: 1px solid color-mix(in srgb, var(--wt-border) 75%, transparent); }
.wordtaste-material-list summary { padding: 7px 0; cursor: pointer; color: var(--wt-ink); font-size: 11.5px; }
.wordtaste-material-copy { max-height: 220px; overflow: auto; padding: 4px 0 10px; color: var(--wt-muted); font-size: 11px; line-height: 1.55; }
.wordtaste-material-copy :is(p, ul, ol) { margin: 5px 0; }
.wordtaste-material-copy :is(ul, ol) { padding-left: 17px; }
.wordtaste-memory { color: var(--wt-muted); font-size: 11px; line-height: 1.55; }
.wordtaste-memory :is(p, ul) { margin: 5px 0; }
.wordtaste-memory ul { padding-left: 17px; }
.wordtaste-memory dl { margin: 11px 0 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.wordtaste-memory dl div { min-width: 0; padding: 7px 4px; text-align: center; background: var(--wt-raised); border-radius: 7px; }
.wordtaste-memory dt { font-size: 8.5px; line-height: 1.2; color: var(--wt-muted); }
.wordtaste-memory dd { margin: 3px 0 0; color: var(--wt-ink); font-size: 12px; font-weight: 600; }

.wordtaste-workspace {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background:
    radial-gradient(circle at 78% 0%, color-mix(in srgb, var(--wt-accent) 4%, transparent), transparent 32%),
    var(--wt-chrome);
  scroll-behavior: smooth;
}
.wordtaste-gate-anchor { scroll-margin-top: 16px; }
.wordtaste-intake, .wordtaste-layout-gate, .wordtaste-choice-gate {
  width: min(920px, calc(100% - 72px));
  margin: 0 auto;
}
.wordtaste-intake { min-height: calc(100vh - 150px); display: grid; align-content: center; padding: 64px 0 84px; }
.wordtaste-intake-copy { max-width: 640px; }
.wordtaste-kicker { color: var(--wt-accent); font-size: 12px; font-weight: 600; }
.wordtaste-intake h1, .wordtaste-gate-heading h1 {
  margin: 9px 0 10px;
  color: var(--wt-ink);
  font-size: 30px;
  line-height: 1.16;
  letter-spacing: -0.035em;
  text-wrap: balance;
}
.wordtaste-intake-copy > p, .wordtaste-gate-heading p {
  max-width: 65ch;
  margin: 0;
  color: var(--wt-muted);
  font-size: 14px;
  line-height: 1.65;
  text-wrap: pretty;
}
.wordtaste-entry-options { margin-top: 34px; display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--wt-border); border-bottom: 1px solid var(--wt-border); }
.wordtaste-entry-options > button {
  min-height: 132px;
  padding: 22px 20px;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  border: none;
  background: transparent;
  color: var(--wt-ink);
  text-align: left;
  cursor: pointer;
  transition: background .16s ease;
}
.wordtaste-entry-options > button + button { border-left: 1px solid var(--wt-border); }
.wordtaste-entry-options > button:hover:not(:disabled) { background: var(--wt-accent-soft); }
.wordtaste-entry-options > button:disabled { opacity: .5; cursor: default; }
.wordtaste-entry-options > button > .wordtaste-icon:first-child { width: 22px; height: 22px; color: var(--wt-accent); margin-top: 1px; }
.wordtaste-entry-options > button > .wordtaste-icon:last-child { margin-left: auto; color: var(--wt-muted); transition: transform .16s ease; }
.wordtaste-entry-options > button:hover > .wordtaste-icon:last-child { transform: translateX(3px); }
.wordtaste-entry-options strong { display: block; font-size: 14px; }
.wordtaste-entry-options small { display: block; margin-top: 7px; color: var(--wt-muted); font-size: 11.5px; line-height: 1.5; }
.wordtaste-honesty { margin: 18px 0 0; color: color-mix(in srgb, var(--wt-muted) 78%, transparent); font-size: 10.5px; }

.wordtaste-layout-gate { padding: 54px 0 38px; }
.wordtaste-gate-heading > span, .wordtaste-writing-gate > div:first-child > span, .wordtaste-final-gate > div:first-child > span {
  color: var(--wt-accent);
  font-size: 11.5px;
  font-weight: 600;
}
.wordtaste-open-question {
  margin-top: 24px;
  padding: 14px 16px;
  display: flex;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--wt-accent) 40%, var(--wt-border));
  border-radius: 10px;
  background: var(--wt-accent-soft);
}
.wordtaste-open-question .wordtaste-icon { color: var(--wt-accent); margin-top: 1px; }
.wordtaste-open-question strong { font-size: 12px; }
.wordtaste-open-question p { margin: 3px 0 0; color: var(--wt-muted); font-size: 12px; line-height: 1.5; }
.wordtaste-thesis { margin-top: 28px; padding: 25px 0 8px; border-top: 1px solid var(--wt-border); }
.wordtaste-thesis h2 { margin: 0 0 14px; font-size: 17px; letter-spacing: -0.02em; }
.wordtaste-thesis ol { list-style: none; margin: 0; padding: 0; }
.wordtaste-thesis li { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 13px 0; border-top: 1px solid color-mix(in srgb, var(--wt-border) 75%, transparent); }
.wordtaste-claim-number { color: var(--wt-muted); font-family: ui-monospace, monospace; font-size: 11px; }
.wordtaste-thesis li p { margin: 0; color: var(--wt-ink); font-size: 13.5px; line-height: 1.5; }
.wordtaste-thesis li button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border: 1px solid var(--wt-border);
  border-radius: 8px;
  background: transparent;
  color: var(--wt-muted);
  font-size: 10.5px;
  cursor: pointer;
}
.wordtaste-thesis li button:hover:not(:disabled), .wordtaste-thesis li button.is-selected { border-color: color-mix(in srgb, var(--wt-accent) 55%, var(--wt-border)); color: var(--wt-accent); background: var(--wt-accent-soft); }
.wordtaste-thesis li button:disabled { opacity: .42; cursor: default; }
.wordtaste-thesis li button .wordtaste-icon { width: 13px; height: 13px; }
.wordtaste-plan-details { margin-top: 16px; border-top: 1px solid var(--wt-border); border-bottom: 1px solid var(--wt-border); }
.wordtaste-plan-details > summary { min-height: 48px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; color: var(--wt-ink); font-size: 12.5px; }
.wordtaste-plan-details > summary::-webkit-details-marker { display: none; }
.wordtaste-plan-details > summary span { color: var(--wt-muted); font-size: 11px; }
.wordtaste-plan-details ol { list-style: none; margin: 0; padding: 0 0 12px; }
.wordtaste-plan-details li { display: flex; gap: 11px; padding: 9px 0; }
.wordtaste-plan-details li > span { color: var(--wt-accent); font-family: ui-monospace, monospace; font-size: 10px; }
.wordtaste-plan-details strong { display: block; font-size: 12px; font-weight: 500; line-height: 1.45; }
.wordtaste-plan-details small { display: block; margin-top: 3px; color: var(--wt-muted); font-size: 10.5px; }

.wordtaste-claim-body { min-width: 0; }
.wordtaste-claim-source {
  display: inline-block;
  margin-top: 5px;
  padding: 2px 6px;
  max-width: 100%;
  border: 1px solid color-mix(in srgb, var(--wt-border) 85%, transparent);
  border-radius: 5px;
  background: var(--wt-raised);
  color: var(--wt-muted);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

.wordtaste-plan { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--wt-border); }
.wordtaste-plan-head { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin-bottom: 11px; }
.wordtaste-plan-head h3 { margin: 0; color: var(--wt-ink); font-size: 12.5px; font-weight: 600; }
.wordtaste-plan-head > span { color: var(--wt-muted); font-size: 11px; }
.wordtaste-plan-scroll {
  overflow-x: auto;
  overscroll-behavior-x: contain;
  border-top: 1px solid var(--wt-border);
  border-bottom: 1px solid var(--wt-border);
}
.wordtaste-plan-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  text-align: left;
}
.wordtaste-plan-table th {
  padding: 9px 14px 9px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--wt-border) 75%, transparent);
  color: var(--wt-muted);
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.wordtaste-plan-table td { padding: 11px 14px 11px 0; vertical-align: top; font-size: 12px; }
.wordtaste-plan-table :is(th, td):last-child { padding-right: 0; }
.wordtaste-plan-row + .wordtaste-plan-row > td,
.wordtaste-plan-notes + .wordtaste-plan-row > td { border-top: 1px solid color-mix(in srgb, var(--wt-border) 75%, transparent); }
/* Muted, like the claim numbers: orange belongs to the decision being made
   and to the button that commits it, not to a row label. */
.wordtaste-plan-order { width: 26px; color: var(--wt-muted); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 10px; }
.wordtaste-plan-role { color: var(--wt-ink); line-height: 1.45; }
.wordtaste-plan-figure { width: 1%; color: var(--wt-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.wordtaste-plan-blank { color: color-mix(in srgb, var(--wt-muted) 60%, transparent); }
.wordtaste-plan-spans { display: flex; flex-direction: column; gap: 5px; }
.wordtaste-plan-span { display: flex; align-items: center; gap: 6px; }
.wordtaste-plan-span code {
  display: block;
  max-width: 17ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wt-ink);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
}
.wordtaste-plan-span i { flex: 0 0 auto; color: var(--wt-muted); font-style: normal; font-size: 10px; }
.wordtaste-plan-chips { display: inline-flex; flex-wrap: nowrap; gap: 5px; }
.wordtaste-plan-chip {
  padding: 2px 8px;
  border: 1px solid var(--wt-border);
  border-radius: 999px;
  background: var(--wt-raised);
  color: var(--wt-muted);
  font-size: 10px;
  line-height: 1.6;
  white-space: nowrap;
}
.wordtaste-plan-notes > td { padding-top: 0; padding-bottom: 12px; color: var(--wt-muted); font-size: 10.5px; line-height: 1.55; }

.wordtaste-note-field { display: block; margin-top: 20px; }
.wordtaste-note-field > span { display: block; margin-bottom: 8px; color: var(--wt-muted); font-size: 11.5px; }
.wordtaste-note-field textarea {
  width: 100%;
  min-height: 76px;
  resize: vertical;
  padding: 11px 12px;
  border: 1px solid var(--wt-border);
  border-radius: 9px;
  background: var(--wt-panel);
  color: var(--wt-ink);
  font-size: 12.5px;
  line-height: 1.5;
}
.wordtaste-note-field textarea::placeholder { color: color-mix(in srgb, var(--wt-muted) 88%, transparent); }
.wordtaste-gate-actions { margin-top: 18px; display: flex; justify-content: flex-end; gap: 10px; }
.wordtaste-primary, .wordtaste-secondary {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.wordtaste-primary { border: 1px solid var(--wt-accent); background: var(--wt-accent); color: var(--wt-on-accent); }
.wordtaste-primary:hover:not(:disabled) { background: var(--wt-accent-hover); border-color: var(--wt-accent-hover); }
.wordtaste-secondary { border: 1px solid var(--wt-border); background: transparent; color: var(--wt-ink); }
.wordtaste-secondary:hover:not(:disabled) { border-color: var(--wt-muted); }
.wordtaste-primary:disabled, .wordtaste-secondary:disabled { opacity: .42; cursor: default; }
.wordtaste-primary .wordtaste-icon { width: 14px; height: 14px; }

.wordtaste-writing-gate, .wordtaste-review-gate, .wordtaste-final-gate {
  width: min(940px, calc(100% - 72px));
  margin: 0 auto;
  padding: 32px 0 24px;
  border-bottom: 1px solid var(--wt-border);
}
.wordtaste-writing-gate { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 28px; align-items: end; }
.wordtaste-writing-gate h1, .wordtaste-final-gate h1 { margin: 6px 0 6px; font-size: 20px; letter-spacing: -0.025em; }
.wordtaste-writing-gate p, .wordtaste-final-gate p { max-width: 68ch; margin: 0; color: var(--wt-muted); font-size: 12px; line-height: 1.55; }
.wordtaste-writing-gate p.wordtaste-writing-unit {
  margin: 0 0 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wt-ink);
  font-size: 12.5px;
}
.wordtaste-writing-count { text-align: right; }
.wordtaste-writing-count strong { display: block; font-size: 27px; line-height: 1; font-weight: 600; }
.wordtaste-writing-count span { display: block; margin-top: 5px; color: var(--wt-muted); font-size: 10.5px; }
.wordtaste-inline-skeleton { grid-column: 1 / -1; height: 3px; border-radius: 3px; background: linear-gradient(90deg, var(--wt-border), var(--wt-info), var(--wt-border)); background-size: 200% 100%; animation: wordtaste-scan 1.8s linear infinite; }
@keyframes wordtaste-scan { to { background-position: -200% 0; } }

.wordtaste-review-gate { padding-top: 30px; }
.wordtaste-review-summary { margin: 16px 0 0; color: var(--wt-ink); font-size: 12.5px; }
.wordtaste-issues { margin-top: 15px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px 20px; }
.wordtaste-issues blockquote { margin: 0; padding: 12px 0; border-top: 1px solid var(--wt-border); }
.wordtaste-issues blockquote p { margin: 0; color: var(--wt-ink); font-family: var(--wordtaste-font-family); font-size: 12.5px; line-height: 1.55; }
.wordtaste-issues blockquote footer { margin-top: 5px; color: var(--wt-muted); font-size: 10.5px; line-height: 1.4; }

.wordtaste-choice-gate { padding: 42px 0 22px; border-bottom: 1px solid var(--wt-border); }
.wordtaste-candidate-tabs { margin-top: 22px; display: flex; border-bottom: 1px solid var(--wt-border); }
.wordtaste-candidate-tabs button { min-height: 44px; padding: 10px 16px; border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--wt-muted); font-size: 12px; cursor: pointer; }
.wordtaste-candidate-tabs button:hover, .wordtaste-candidate-tabs button.is-active { color: var(--wt-ink); border-bottom-color: var(--wt-accent); }
.wordtaste-candidate-note { margin: 12px 0 0; color: var(--wt-muted); font-size: 11px; }

.wordtaste-final-gate { display: flex; align-items: center; justify-content: space-between; gap: 28px; }
.wordtaste-final-gate.is-done { border-bottom-color: color-mix(in srgb, var(--wt-success) 45%, var(--wt-border)); }
.wordtaste-learned-counts { flex: 0 0 auto; display: flex; flex-wrap: nowrap; justify-content: flex-end; gap: 6px; }
.wordtaste-learned-counts span { padding: 5px 8px; border-radius: 7px; background: var(--wt-raised); color: var(--wt-muted); font-size: 10px; }

.wordtaste-draft-shell { width: min(940px, calc(100% - 72px)); margin: 26px auto 90px; }
.wordtaste-draft-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; color: var(--wt-muted); font-size: 10.5px; }
.wordtaste-draft {
  width: 100%;
  min-height: 360px;
  padding: clamp(34px, 5vw, 66px) clamp(30px, 7vw, 92px);
  border: 1px solid var(--wordtaste-theme-rule, var(--wt-border));
  border-radius: 12px;
  background: var(--wordtaste-theme-bg, #111113);
  color: var(--wordtaste-theme-fg, var(--wt-ink));
  font-family: var(--wordtaste-font-family, "Newsreader", serif);
  font-size: 17px;
  line-height: var(--wordtaste-font-line, 1.82);
  box-shadow: var(--wt-card-shadow);
  transition: border-color .18s ease, box-shadow .18s ease;
}
.wordtaste-draft.is-flashing { border-color: var(--wordtaste-theme-accent, var(--wt-accent)); box-shadow: 0 0 0 4px color-mix(in srgb, var(--wordtaste-theme-accent, var(--wt-accent)) 12%, transparent), var(--wt-card-shadow); }
.wordtaste-draft ::selection { background: color-mix(in srgb, var(--wordtaste-theme-accent, var(--wt-accent)) 35%, transparent); color: inherit; }
.wordtaste-draft :is(h1, h2, h3) { color: var(--wordtaste-theme-heading, var(--wt-ink)); text-wrap: balance; letter-spacing: -0.025em; }
.wordtaste-draft h1 { margin: 0 0 28px; font-size: 31px; line-height: 1.25; }
.wordtaste-draft h2 { margin: 36px 0 13px; font-size: 22px; line-height: 1.3; }
.wordtaste-draft h3 { margin: 28px 0 10px; font-size: 18px; }
.wordtaste-draft p { max-width: var(--wordtaste-font-max-measure, 72ch); margin: 0 0 1.15em; text-wrap: pretty; }
.wordtaste-draft blockquote { margin: 1.4em 0; padding: 0 0 0 18px; border-left: 1px solid var(--wordtaste-theme-accent, var(--wt-accent)); color: var(--wordtaste-theme-muted, var(--wt-muted)); }
.wordtaste-draft :is(ul, ol) { max-width: 70ch; padding-left: 1.4em; }
.wordtaste-draft li { margin: .45em 0; }
.wordtaste-draft a { color: var(--wordtaste-theme-accent, var(--wt-accent)); }
/* KaTeX writes every formula twice: a clipped MathML copy for assistive
   technology, then the glyphs a reader sees. The hidden copy is still live
   text to Selection — measured on the live draft, copying one paragraph
   returned 675 characters where the eye saw ~340, each formula repeated
   once as one-MathML-token-per-line. Taking that copy out of selection
   leaves the accessibility tree untouched; it is only about what the
   clipboard and the quote-a-line gesture collect. */
.wordtaste-v2 .katex-mathml { -webkit-user-select: none; user-select: none; }
/* A display formula never wraps, and the reading column is 72ch. Measured
   with a 1800px probe: the article's scrollWidth went to 1892 against a
   938px client while the page itself did not grow — the right end of the
   formula was simply cut off, unreachable. Scrolling the formula in its own
   box keeps it readable and leaves the column alone. */
.wordtaste-draft .katex-display { overflow-x: auto; overflow-y: hidden; padding-block: 2px; }
/* Where the essay breaks into a new part. It rides in the role cell rather
   than taking a column of its own: most plans mark two or three units at
   most, and an almost-always-empty column reads as a mistake. */
.wordtaste-plan-section {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--wt-accent) 45%, transparent);
  border-radius: 999px;
  font-size: 10px;
  color: var(--wt-accent);
  vertical-align: middle;
}
.wordtaste-draft hr { border: none; border-top: 1px solid var(--wordtaste-theme-rule, var(--wt-border)); margin: 2em 0; }

/* An asset slot: a place held open for something that has not been made.
   Dashed, unfilled, and set below the reading size on purpose — it is not
   the essay, it is a note to whoever builds the thing later. */
.wordtaste-asset {
  max-width: var(--wordtaste-font-max-measure, 72ch);
  margin: 1.6em 0;
  padding: 15px 18px 13px;
  border: 1px dashed var(--wordtaste-theme-rule, var(--wt-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--wordtaste-theme-heading, var(--wt-ink)) 3%, transparent);
}
.wordtaste-asset-label {
  display: block;
  font-size: 9.5px;
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--wordtaste-theme-muted, var(--wt-muted));
}
.wordtaste-asset-what {
  max-width: none;
  margin: 6px 0 0;
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--wordtaste-theme-heading, var(--wt-ink));
}
.wordtaste-asset .wordtaste-asset-label + .wordtaste-asset-label,
.wordtaste-asset-what + .wordtaste-asset-label { margin-top: 13px; }
/* Numbered, because the order is part of what the slot specifies: these are
   the strings the thing has to show, in the sequence it should show them. The
   draft's own list rule leaves markers off, so this one puts them back. */
.wordtaste-asset-copy {
  max-width: none;
  margin: 6px 0 0;
  padding-left: 1.6em;
  font-size: 13.5px;
  line-height: 1.7;
  list-style: decimal;
  color: var(--wordtaste-theme-muted, var(--wt-muted));
}
.wordtaste-asset-copy li { margin: .1em 0; }
.wordtaste-asset-copy li::marker { font-size: 11px; color: color-mix(in srgb, var(--wordtaste-theme-muted, var(--wt-muted)) 70%, transparent); }

.wordtaste-writing-empty { width: min(940px, calc(100% - 72px)); margin: 44px auto; color: var(--wt-muted); text-align: center; font-size: 11.5px; }
.wordtaste-empty-lines { width: min(560px, 100%); margin: 0 auto 18px; display: flex; flex-direction: column; gap: 12px; }
.wordtaste-empty-lines span { height: 10px; border-radius: 5px; background: var(--wt-border); opacity: .65; }
.wordtaste-empty-lines span:nth-child(2) { width: 91%; }
.wordtaste-empty-lines span:nth-child(3) { width: 76%; }
.wordtaste-empty-lines span:nth-child(4) { width: 45%; }

.wordtaste-selection-menu {
  position: fixed;
  z-index: 80;
  width: 268px;
  padding: 7px;
  border: 1px solid var(--wt-border);
  border-radius: 11px;
  background: color-mix(in srgb, var(--wt-panel) 96%, transparent);
  color: var(--wt-ink);
  box-shadow: var(--wt-menu-shadow);
  backdrop-filter: blur(16px);
  font-family: "DM Sans", Inter, system-ui, sans-serif;
  animation: wordtaste-menu-in .16s cubic-bezier(.16,1,.3,1);
}
@keyframes wordtaste-menu-in { from { opacity: 0; transform: translateY(-5px); } }
.wordtaste-selection-head { display: flex; align-items: center; justify-content: space-between; padding: 3px 6px 7px; color: var(--wt-muted); font-size: 10px; }
.wordtaste-selection-head > button { width: 24px; height: 24px; display: grid; place-items: center; border: none; background: transparent; color: inherit; cursor: pointer; }
.wordtaste-selection-head .wordtaste-icon { width: 13px; height: 13px; }
.wordtaste-selection-menu > button { width: 100%; min-height: 44px; padding: 0 9px; display: flex; align-items: center; gap: 9px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--wt-ink); font-size: 12px; cursor: pointer; text-align: left; }
.wordtaste-selection-menu > button:hover { background: color-mix(in srgb, var(--wt-accent) 13%, transparent); border-color: color-mix(in srgb, var(--wt-accent) 28%, transparent); }
.wordtaste-selection-menu > button .wordtaste-icon { color: var(--wt-accent); width: 15px; height: 15px; }

@media (max-width: 900px) {
  .wordtaste-header { gap: 10px; }
  .wordtaste-scope { display: none; }
  .wordtaste-v2-body { flex-direction: column; }
  .wordtaste-process {
    width: 100%;
    flex: 0 0 auto;
    max-height: 112px;
    overflow: hidden;
    padding: 12px 18px;
    border-right: none;
    border-bottom: 1px solid var(--wt-border);
  }
  .wordtaste-process-title, .wordtaste-goal-summary, .wordtaste-progress-block, .wordtaste-rail-details { display: none; }
  .wordtaste-stage-list { flex-direction: row; }
  .wordtaste-stage { flex: 1; min-height: 56px; gap: 7px; }
  .wordtaste-stage:not(:last-child)::after { left: 28px; right: 0; top: 13px; bottom: auto; width: auto; height: 1px; }
  .wordtaste-stage small { display: none; }
  .wordtaste-stage strong { font-size: 10.5px; }
  .wordtaste-stage-marker { width: 27px; height: 27px; }
  .wordtaste-thesis li { grid-template-columns: 28px minmax(0, 1fr); }
  .wordtaste-thesis li button { grid-column: 2; justify-self: start; }
}

@media (max-width: 620px) {
  .wordtaste-header { min-height: 50px; padding: 0 10px; }
  .wordtaste-header-status, .wordtaste-project-select { display: none; }
  .wordtaste-brand { font-size: 13px; }
  .wordtaste-header-button { width: 44px; height: 44px; padding: 0; justify-content: center; }
  .wordtaste-header-label { display: none; }
  .wordtaste-entry-options { grid-template-columns: 1fr; }
  .wordtaste-entry-options > button + button { border-left: none; border-top: 1px solid var(--wt-border); }
  .wordtaste-intake, .wordtaste-layout-gate, .wordtaste-choice-gate,
  .wordtaste-writing-gate, .wordtaste-review-gate, .wordtaste-final-gate,
  .wordtaste-draft-shell, .wordtaste-writing-empty { width: min(100% - 28px, 940px); }
  .wordtaste-intake { padding-top: 40px; align-content: start; }
  .wordtaste-intake h1, .wordtaste-gate-heading h1 { font-size: 24px; }
  .wordtaste-process { padding-inline: 8px; }
  .wordtaste-stage { justify-content: center; }
  .wordtaste-stage > span:last-child { display: none; }
  .wordtaste-writing-gate, .wordtaste-final-gate { grid-template-columns: 1fr; display: grid; align-items: start; }
  .wordtaste-writing-count { text-align: left; }
  .wordtaste-learned-counts { justify-content: flex-start; flex-wrap: wrap; }
  .wordtaste-issues { grid-template-columns: 1fr; }
  .wordtaste-draft { padding: 28px 21px; border-radius: 9px; font-size: 16px; }
  .wordtaste-gate-actions { flex-direction: column-reverse; }
  .wordtaste-thesis li button { min-height: 44px; }
  .wordtaste-primary, .wordtaste-secondary { width: 100%; min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .wordtaste-progress-track span, .wordtaste-entry-options .wordtaste-icon,
  .wordtaste-draft, .wordtaste-inline-skeleton, .wordtaste-selection-menu {
    transition: none;
    animation: none;
  }
  .wordtaste-workspace { scroll-behavior: auto; }
}
`;
