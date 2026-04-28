import { useState, useMemo, type ComponentProps } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ContentBlock, SelectionContext, Annotation, PermissionRequest } from "../types.js";
import { useStore } from "../store.js";
import { sendPermissionResponse } from "../ws.js";
import { ToolBlock, getToolIcon, getToolLabel, getPreview, ToolIcon } from "./ToolBlock.js";
import { parsePneumaTag, PneumaSignalPill } from "./PneumaSignalPill.js";
import type { ViewerLocator } from "../../core/types/viewer-contract.js";

// ─── Viewer Locator parsing ────────────────────────────────────────────────

const LOCATOR_RE = /<viewer-locator\s+label="([^"]+)"\s+data='([^']+)'\s*\/>/g;

function parseViewerLocators(text: string): { cleanText: string; locators: ViewerLocator[] } {
  const locators: ViewerLocator[] = [];
  for (const match of text.matchAll(LOCATOR_RE)) {
    try { locators.push({ label: match[1], data: JSON.parse(match[2]) }); } catch { /* skip malformed */ }
  }
  return { cleanText: text.replace(LOCATOR_RE, "").trim(), locators };
}

function LocatorCardGroup({ locators }: { locators: ViewerLocator[] }) {
  const setNavigateRequest = useStore((s) => s.setNavigateRequest);
  const debugMode = useStore((s) => s.debugMode);
  const [debugOpen, setDebugOpen] = useState(false);
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">
        {locators.map((loc, i) => (
          <button key={i} onClick={() => setNavigateRequest(loc)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cc-primary/5 border border-cc-primary/20 hover:bg-cc-primary/15 hover:border-cc-primary/40 transition-all cursor-pointer text-xs group">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-cc-primary shrink-0">
              <circle cx="8" cy="8" r="3" />
              <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
            </svg>
            <span className="text-cc-fg font-medium group-hover:text-cc-primary transition-colors">{loc.label}</span>
          </button>
        ))}
      </div>
      {debugMode && (
        <div className="mt-1">
          <button
            onClick={() => setDebugOpen(!debugOpen)}
            className="flex items-center gap-1 text-[10px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 16 16" fill="none" className={`w-3 h-3 transition-transform ${debugOpen ? "rotate-90" : ""}`}>
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>payload</span>
          </button>
          {debugOpen && (
            <pre className="mt-1 text-[10px] font-mono-code bg-black/30 text-cc-code-fg rounded-md px-2.5 py-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
              {locators.map((loc) => `${loc.label}: ${JSON.stringify(loc.data)}`).join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function MessageBubble({
  message,
  globalToolUseById,
}: {
  message: ChatMessage;
  /**
   * Tool-name lookup spanning the full conversation. Populated by the
   * parent (ChatPanel) so a `tool_result` block can find its `tool_use`
   * even when the two arrived in separate assistant messages — which is
   * the default for the Codex backend (it emits `msg-{id}` for the
   * tool_use and `result-{id}` for the result, several events apart).
   * The Claude backend keeps them in the same turn so per-message
   * lookup also works there; this is the more general fallback.
   */
  globalToolUseById?: Map<string, ToolUseInfo>;
}) {
  if (message.role === "system") {
    if (message.isCollapsible) {
      // /context output — render as a rich visualization card (open by default)
      if (message.subtype === "context") {
        return (
          <div className="animate-[fadeSlideIn_0.2s_ease-out] my-1">
            <ContextUsageCard content={message.content} />
          </div>
        );
      }

      // System output (command results, compact output, etc.) — collapsed by default
      const preview = message.content.replace(/\s+/g, " ").slice(0, 60);
      return (
        <details className="animate-[fadeSlideIn_0.2s_ease-out] rounded-lg border border-cc-border bg-cc-card/50 my-1 group">
          <summary className="flex items-center gap-2 px-3 py-2 text-xs text-cc-muted cursor-pointer hover:bg-cc-hover/50 transition-colors select-none">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0">
              <path d="M6 4l4 4-4 4" />
            </svg>
            <span className="font-medium text-cc-fg/70">Output</span>
            <span className="truncate text-cc-muted/60">{preview}</span>
          </summary>
          <div className="px-4 pb-3 max-h-60 overflow-y-auto">
            <MarkdownContent text={message.content} />
          </div>
        </details>
      );
    }
    return (
      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-px bg-cc-border" />
        <span className="text-[11px] text-cc-muted italic font-mono-code shrink-0 px-1">
          {message.content}
        </span>
        <div className="flex-1 h-px bg-cc-border" />
      </div>
    );
  }

  if (message.role === "user") {
    const sel = message.selectionContext;
    const notif = message.viewerNotification;
    const anns = message.annotations;
    const imgs = message.images;
    const files = message.files;
    const hasText = message.content.trim().length > 0;
    // System-injected pneuma signal tags (env, request-handoff,
    // handoff-cancelled) are routed through the "user message" path so the
    // agent receives them in the right place, but they're not actually user
    // input — render them as a centered horizontal-divider marker rather
    // than a chat bubble so the conversation doesn't get drowned in raw XML.
    // Only triggers for messages whose ENTIRE content is one self-closing
    // pneuma tag with no attachments; mixed content keeps the bubble.
    if (
      hasText && !sel && !notif && !anns?.length && !imgs?.length && !files?.length
    ) {
      const pneumaTag = parsePneumaTag(message.content);
      if (pneumaTag) return <PneumaSignalPill tag={pneumaTag} />;
    }
    return (
      <div className="flex justify-end animate-[fadeSlideIn_0.2s_ease-out]">
        <div className="max-w-[85%] rounded-[20px] rounded-br-[6px] bg-cc-surface/60 backdrop-blur-md border border-cc-border/30 text-cc-fg overflow-hidden shadow-sm">
          {anns && anns.length > 0 ? <AnnotationsCard annotations={anns} /> : null}
          {!anns?.length && sel ? <SelectionCard sel={sel} interactive /> : null}
          {notif ? <ViewerNotificationCard notification={notif} /> : null}
          {imgs && imgs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {imgs.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.media_type};base64,${img.data}`}
                  alt=""
                  className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-white/10"
                />
              ))}
            </div>
          )}
          {files && files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {files.map((f, i) => (
                <FileTag key={i} name={f.name} size={f.size} />
              ))}
            </div>
          )}
          {hasText && (
            <div className="px-3 py-2.5">
              <div className="text-[13px] leading-relaxed break-words font-chat">
                <MarkdownContent text={message.content} />
              </div>
            </div>
          )}
          {message.debugPayload && <DebugPayloadButton payload={message.debugPayload} />}
        </div>
      </div>
    );
  }

  // Assistant message — skip empty messages (e.g. AskUserQuestion-only turns)
  if (isEmptyAssistantMessage(message)) return null;

  return (
    <div className="animate-[fadeSlideIn_0.2s_ease-out]">
      <AssistantMessage message={message} globalToolUseById={globalToolUseById} />
    </div>
  );
}

// ─── Selection Card ─────────────────────────────────────────────────────────

function SelectionCard({ sel, interactive }: { sel: SelectionContext; interactive?: boolean }) {
  const setSelection = useStore((s) => s.setSelection);
  const setPreviewMode = useStore((s) => s.setPreviewMode);

  // Build a label: prefer CSS selector, fallback to type-based labels
  let typeLabel: string;
  if (sel.selector) {
    typeLabel = sel.selector;
  } else {
    const typeLabels: Record<string, string> = {
      heading: `h${sel.level || 1}`,
      paragraph: "paragraph",
      list: "list",
      code: "code block",
      blockquote: "blockquote",
      image: "image",
      table: "table",
      "text-range": "selected text",
      section: "section",
      link: "link",
      container: "container",
      interactive: "interactive",
    };
    typeLabel = typeLabels[sel.type] || sel.type;
  }
  const preview = sel.content.length > 80 ? sel.content.slice(0, 77) + "..." : sel.content;

  const handleClick = () => {
    if (!interactive) return;
    setPreviewMode("select");
    setSelection(sel);
  };

  return (
    <div
      className={`px-3 pt-2.5 pb-1.5 border-b border-cc-border/40 bg-cc-primary/5 ${interactive ? "cursor-pointer hover:bg-cc-primary/10 transition-colors" : ""
        }`}
      onClick={interactive ? handleClick : undefined}
    >
      {sel.thumbnail && (
        <img src={sel.thumbnail} alt="" className="mb-1.5 max-h-24 max-w-full rounded border border-cc-border/30 bg-white" />
      )}
      <div className="flex items-start gap-2 text-xs">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-cc-primary shrink-0 mt-0.5">
          <path d="M3 2l4 12 2-5 5-2L3 2z" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0">
          <div className="text-cc-primary font-medium">
            {typeLabel}
            <span className="text-cc-muted font-normal ml-1.5">in {sel.file}</span>
          </div>
          <div className="text-cc-muted mt-0.5 break-words leading-snug">"{preview}"</div>
        </div>
      </div>
    </div>
  );
}

// ─── Annotations Card ────────────────────────────────────────────────────

function AnnotationsCard({ annotations }: { annotations: Annotation[] }) {
  return (
    <div className="px-3 pt-2.5 pb-1.5 border-b border-cc-border/40 bg-cc-primary/5">
      <div className="flex items-center gap-2 text-xs mb-1.5">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-cc-primary shrink-0">
          <path d="M2 11l7-7 2 2-7 7H2v-2z" strokeLinejoin="round" />
          <path d="M12.5 2.5l1 1" strokeLinecap="round" />
        </svg>
        <span className="text-cc-primary font-medium">
          {annotations.length} annotation{annotations.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-1">
        {annotations.map((ann, i) => {
          const label = ann.element.label || ann.element.selector || `${ann.element.type}`;
          return (
            <div key={ann.id} className="flex items-start gap-1.5 text-xs">
              <span className="shrink-0 text-cc-primary/70 font-mono text-[10px] mt-0.5 w-4 text-right">
                {i + 1}.
              </span>
              <div className="min-w-0">
                <span className="text-cc-muted">{label}</span>
                {ann.comment && (
                  <span className="text-cc-fg ml-1">&rarr; {ann.comment}</span>
                )}
                <span className="text-cc-muted/50 ml-1 text-[10px]">{ann.slideFile}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Viewer Notification Card ────────────────────────────────────────────

function ViewerNotificationCard({ notification }: { notification: NonNullable<ChatMessage["viewerNotification"]> }) {
  const filesLabel = notification.files?.length
    ? notification.files.join(", ")
    : undefined;

  return (
    <div className="px-3 pt-2.5 pb-1.5 border-b border-cc-border/40 bg-cc-primary/5">
      <div className="flex items-start gap-2 text-xs">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-cc-primary shrink-0 mt-0.5">
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 2v1M8 13v1M2 8h1M13 8h1" strokeLinecap="round" />
        </svg>
        <div className="min-w-0">
          <div className="text-cc-primary font-medium">
            {notification.type}
            {filesLabel && (
              <span className="text-cc-muted font-normal ml-1.5">{filesLabel}</span>
            )}
          </div>
          <div className="text-cc-muted mt-0.5 break-words leading-snug">{notification.summary}</div>
        </div>
      </div>
    </div>
  );
}

// ─── File Tag ─────────────────────────────────────────────────────────────

function FileTag({ name, size }: { name: string; size: number }) {
  const sizeStr = size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.round(size / 1024)} KB`
      : `${(size / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-cc-fg/[0.06] border border-cc-border/30">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-3.5 h-3.5 text-cc-muted shrink-0">
        <path d="M4 1.5h5l3 3v10H4z" strokeLinejoin="round" />
        <path d="M9 1.5v3h3" strokeLinejoin="round" />
      </svg>
      <span className="text-xs text-cc-fg truncate max-w-[150px]">{name}</span>
      <span className="text-[10px] text-cc-muted shrink-0">{sizeStr}</span>
    </div>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface ToolGroupItem {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolUseInfo {
  name: string;
  input: Record<string, unknown>;
}

type GroupedBlock =
  | { kind: "content"; block: ContentBlock }
  | { kind: "tool_group"; name: string; items: ToolGroupItem[] }
  | { kind: "ask_user_question"; id: string; input: Record<string, unknown> };

// ─── Block grouping ────────────────────────────────────────────────────────

/** Returns true when the message has no renderable content at all. */
function isEmptyAssistantMessage(message: ChatMessage): boolean {
  const blocks = message.contentBlocks || [];
  if (blocks.length === 0 && !message.content?.trim()) return true;
  const hasVisibleBlock = blocks.some((b) =>
    b.type === "text" || b.type === "thinking" || b.type === "tool_use" || b.type === "tool_result"
  );
  return !hasVisibleBlock && !message.content?.trim();
}

function groupContentBlocks(blocks: ContentBlock[]): GroupedBlock[] {
  const groups: GroupedBlock[] = [];

  for (const block of blocks) {
    if (block.type === "tool_use") {
      if (block.name === "AskUserQuestion") {
        groups.push({ kind: "ask_user_question", id: block.id, input: block.input });
        continue;
      }
      const last = groups[groups.length - 1];
      if (last?.kind === "tool_group" && last.name === block.name) {
        last.items.push({ id: block.id, name: block.name, input: block.input });
      } else {
        groups.push({
          kind: "tool_group",
          name: block.name,
          items: [{ id: block.id, name: block.name, input: block.input }],
        });
      }
    } else {
      groups.push({ kind: "content", block });
    }
  }

  return groups;
}

function mapToolUsesById(blocks: ContentBlock[]): Map<string, ToolUseInfo> {
  const map = new Map<string, ToolUseInfo>();
  for (const block of blocks) {
    if (block.type === "tool_use") {
      map.set(block.id, { name: block.name, input: block.input });
    }
  }
  return map;
}

// ─── AssistantMessage ──────────────────────────────────────────────────────

function AssistantMessage({
  message,
  globalToolUseById,
}: {
  message: ChatMessage;
  globalToolUseById?: Map<string, ToolUseInfo>;
}) {
  const blocks = message.contentBlocks || [];

  const grouped = useMemo(() => groupContentBlocks(blocks), [blocks]);
  const toolUseById = useMemo(() => {
    const local = mapToolUsesById(blocks);
    if (!globalToolUseById || globalToolUseById.size === 0) return local;
    const merged = new Map(globalToolUseById);
    for (const [k, v] of local) merged.set(k, v); // local wins on collision
    return merged;
  }, [blocks, globalToolUseById]);

  // Fallback: no content blocks, just plain text
  if (blocks.length === 0 && message.content) {
    const { cleanText, locators } = parseViewerLocators(message.content);
    return (
      <div className="flex items-start gap-3">
        <AssistantAvatar />
        <div className="flex-1 min-w-0">
          {cleanText && <MarkdownContent text={cleanText} />}
          {locators.length > 0 && <LocatorCardGroup locators={locators} />}
        </div>
      </div>
    );
  }

  // Nothing to render (or all blocks filtered out, e.g. AskUserQuestion-only messages)
  if (grouped.length === 0 && !message.content?.trim()) return null;

  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 space-y-3">
        {grouped.map((group, i) => {
          if (group.kind === "ask_user_question") {
            return <InlineAskUserQuestion key={i} toolUseId={group.id} input={group.input} />;
          }
          if (group.kind === "content") {
            return <ContentBlockRenderer key={i} block={group.block} toolUseById={toolUseById} />;
          }
          if (group.items.length === 1) {
            const item = group.items[0];
            return <ToolBlock key={i} name={item.name} input={item.input} toolUseId={item.id} />;
          }
          return <ToolGroupBlock key={i} name={group.name} items={group.items} />;
        })}
      </div>
    </div>
  );
}

// ─── AssistantAvatar ───────────────────────────────────────────────────────

function AssistantAvatar() {
  return (
    <div className="w-6 h-6 rounded-full bg-cc-primary/10 border border-cc-primary/30 shadow-[0_0_10px_rgba(249,115,22,0.3)] flex items-center justify-center shrink-0 mt-0.5">
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-cc-primary">
        <circle cx="8" cy="8" r="3" />
      </svg>
    </div>
  );
}

// ─── InlineAskUserQuestion ─────────────────────────────────────────────────

function InlineAskUserQuestion({ toolUseId, input }: { toolUseId: string; input: Record<string, unknown> }) {
  const perm = useStore((s) => {
    for (const p of s.pendingPermissions.values()) {
      if (p.tool_use_id === toolUseId) return p;
    }
    return null;
  });
  const answered = useStore((s) => s.answeredQuestions.get(toolUseId));

  if (answered) {
    return <AnsweredQuestionSummary pairs={answered.pairs} />;
  }

  if (perm) {
    return <AskUserQuestionPicker perm={perm} />;
  }

  // Brief loading state (tool_use block arrived but permission_request not yet)
  return (
    <div className="text-xs text-cc-muted italic py-1">
      Waiting for question...
    </div>
  );
}

function AnsweredQuestionSummary({ pairs }: { pairs: { question: string; answer: string }[] }) {
  const summaryText = pairs.map((p) => p.answer).filter(Boolean).join(", ");
  return (
    <details className="rounded-lg border border-cc-border bg-cc-card group">
      <summary className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-cc-hover/50 transition-colors select-none">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0 text-cc-muted">
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="text-cc-primary font-medium shrink-0">Q&A</span>
        <span className="text-cc-fg truncate">{summaryText}</span>
      </summary>
      <div className="px-3 pb-2.5 border-t border-cc-border/50 pt-2 space-y-2.5">
        {pairs.map((pair, i) => (
          <div key={i} className="space-y-1">
            {pair.question && <p className="text-xs text-cc-muted leading-relaxed">{pair.question}</p>}
            <div className="text-xs text-cc-fg font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cc-primary shrink-0" />
              {pair.answer}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function AskUserQuestionPicker({ perm }: { perm: PermissionRequest }) {
  const questions: Record<string, unknown>[] = Array.isArray(perm.input.questions) ? perm.input.questions : [];
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  function submit(answers: Record<string, string>) {
    setSubmitted(true);
    sendPermissionResponse(perm.request_id, "allow", { ...perm.input, answers });
  }

  function handleOptionClick(qIdx: number, label: string) {
    const key = String(qIdx);
    setSelections((prev) => ({ ...prev, [key]: label }));
    setShowCustom((prev) => ({ ...prev, [key]: false }));
    if (questions.length <= 1) submit({ [key]: label });
  }

  function handleCustomToggle(qIdx: number) {
    const key = String(qIdx);
    setShowCustom((prev) => {
      const wasOpen = Boolean(prev[key]);
      const next = { ...prev, [key]: !wasOpen };
      if (wasOpen) {
        setSelections((s) => { const c = { ...s }; delete c[key]; return c; });
        setCustomText((t) => { const c = { ...t }; delete c[key]; return c; });
      }
      return next;
    });
  }

  function handleCustomChange(qIdx: number, value: string) {
    const key = String(qIdx);
    setCustomText((prev) => ({ ...prev, [key]: value }));
    const trimmed = value.trim();
    setSelections((prev) => {
      if (!trimmed) { const c = { ...prev }; delete c[key]; return c; }
      return { ...prev, [key]: trimmed };
    });
  }

  function handleCustomSubmit(qIdx: number) {
    const key = String(qIdx);
    const text = customText[key]?.trim();
    if (!text) return;
    setSelections((prev) => ({ ...prev, [key]: text }));
    if (questions.length <= 1) submit({ [key]: text });
  }

  // Fallback: no structured questions
  if (questions.length === 0) {
    const question = typeof perm.input.question === "string" ? perm.input.question : "";
    return (
      <div className="rounded-lg border border-cc-primary/20 bg-cc-card p-3">
        <div className="text-sm font-medium text-cc-primary mb-1">Question</div>
        {question && <div className="text-xs text-cc-fg">{question}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cc-primary/20 bg-cc-card p-3 space-y-3">
      {questions.map((q, i) => {
        const header = typeof q.header === "string" ? q.header : "";
        const text = typeof q.question === "string" ? q.question : "";
        const options: Record<string, unknown>[] = Array.isArray(q.options) ? q.options : [];
        const key = String(i);
        const selected = selections[key];
        const isCustom = showCustom[key];

        return (
          <div key={i} className="space-y-2">
            {header && (
              <span className="inline-block text-[10px] font-semibold text-cc-primary bg-cc-primary/10 px-1.5 py-0.5 rounded">
                {header}
              </span>
            )}
            {text && <p className="text-sm text-cc-fg leading-relaxed">{text}</p>}

            {options.length > 0 && (
              <div className="space-y-1.5">
                {options.map((opt, j) => {
                  const label = typeof opt.label === "string" ? opt.label : String(opt);
                  const desc = typeof opt.description === "string" ? opt.description : "";
                  const isSelected = selected === label && !isCustom;

                  return (
                    <button
                      key={j}
                      onClick={() => handleOptionClick(i, label)}
                      disabled={submitted}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-all cursor-pointer disabled:opacity-50 ${
                        isSelected
                          ? "border-cc-primary bg-cc-primary/10 ring-1 ring-cc-primary/30"
                          : "border-cc-border bg-cc-bg hover:bg-cc-hover hover:border-cc-primary/30"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          isSelected ? "border-cc-primary" : "border-cc-border"
                        }`}>
                          {isSelected && <span className="w-2 h-2 rounded-full bg-cc-primary" />}
                        </span>
                        <div>
                          <span className="text-xs font-medium text-cc-fg">{label}</span>
                          {desc && <p className="text-[11px] text-cc-muted mt-0.5 leading-snug">{desc}</p>}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* "Other..." custom input */}
                <button
                  onClick={() => handleCustomToggle(i)}
                  disabled={submitted}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-all cursor-pointer disabled:opacity-50 ${
                    isCustom
                      ? "border-cc-primary bg-cc-primary/10 ring-1 ring-cc-primary/30"
                      : "border-cc-border bg-cc-bg hover:bg-cc-hover hover:border-cc-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isCustom ? "border-cc-primary" : "border-cc-border"
                    }`}>
                      {isCustom && <span className="w-2 h-2 rounded-full bg-cc-primary" />}
                    </span>
                    <span className="text-xs font-medium text-cc-muted">Other...</span>
                  </div>
                </button>

                {isCustom && (
                  <div className="pl-6">
                    <input
                      type="text"
                      value={customText[key] || ""}
                      onChange={(e) => handleCustomChange(i, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCustomSubmit(i); }}
                      placeholder="Type your answer..."
                      className="w-full px-2.5 py-1.5 text-xs bg-cc-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/50"
                      autoFocus
                    />
                    {questions.length <= 1 && (
                      <p className="mt-1 text-[10px] text-cc-muted">Press Enter to submit</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Submit button for multi-question forms */}
      {questions.length > 1 && Object.keys(selections).length > 0 && (
        <button
          onClick={() => submit(selections)}
          disabled={submitted}
          className="px-4 py-1.5 text-xs font-medium bg-cc-primary hover:bg-cc-primary-hover text-white rounded-lg disabled:opacity-50 transition-colors cursor-pointer"
        >
          Submit answers
        </button>
      )}
    </div>
  );
}

// ─── MarkdownContent ───────────────────────────────────────────────────────

export function MarkdownContent({ text, showCursor = false }: { text: string; showCursor?: boolean }) {
  // Strip locator tags so they don't render as raw HTML during streaming
  const cleanText = text.replace(/<viewer-locator\s[^>]*\/>/g, "");
  return (
    <div className="markdown-body text-[14px] text-cc-fg leading-relaxed overflow-hidden font-chat">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="mb-3 last:mb-0">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-cc-fg">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic">{children}</em>
          ),
          h1: ({ children }) => (
            <h1 className="text-xl font-bold text-cc-fg mt-4 mb-2">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-bold text-cc-fg mt-3 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-cc-fg mt-3 mb-1">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-cc-fg">{children}</li>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-cc-primary hover:underline">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-cc-primary/30 pl-3 my-2 text-cc-muted italic">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="border-cc-border my-4" />
          ),
          code: (props: ComponentProps<"code">) => {
            const { children, className } = props;
            const match = /language-(\w+)/.exec(className || "");
            const isBlock = match || (typeof children === "string" && children.includes("\n"));

            if (isBlock) {
              const lang = match?.[1] || "";
              return (
                <div className="my-2 rounded-lg overflow-hidden border border-cc-border">
                  {lang && (
                    <div className="px-3 py-1.5 bg-cc-code-bg/80 border-b border-cc-border text-[10px] text-cc-muted font-mono-code uppercase tracking-wider">
                      {lang}
                    </div>
                  )}
                  <pre className="px-3 py-2.5 bg-cc-code-bg text-cc-code-fg text-[13px] font-mono-code leading-relaxed overflow-x-auto">
                    <code>{children}</code>
                  </pre>
                </div>
              );
            }

            return (
              <code className="px-1.5 py-0.5 rounded-md bg-cc-fg/[0.06] text-[13px] font-mono-code text-cc-fg/80">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full text-sm border border-cc-border rounded-lg overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-cc-code-bg/50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-1.5 text-left text-xs font-semibold text-cc-fg border-b border-cc-border">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-1.5 text-xs text-cc-fg border-b border-cc-border">
              {children}
            </td>
          ),
        }}
      >
        {cleanText}
      </Markdown>
      {showCursor && (
        <span
          className="inline-block w-0.5 h-4 bg-cc-primary ml-0.5 align-middle animate-[pulse-dot_0.8s_ease-in-out_infinite]"
        />
      )}
    </div>
  );
}

// ─── ContentBlockRenderer ──────────────────────────────────────────────────

function ContentBlockRenderer({
  block,
  toolUseById,
}: {
  block: ContentBlock;
  toolUseById: Map<string, ToolUseInfo>;
}) {
  if (block.type === "text") {
    const { cleanText, locators } = parseViewerLocators(block.text);
    return (
      <>
        {cleanText && <MarkdownContent text={cleanText} />}
        {locators.length > 0 && <LocatorCardGroup locators={locators} />}
      </>
    );
  }

  if (block.type === "thinking") {
    // Adaptive thinking (Claude Code 2.1.119+) sends `thinking: ""` with a
    // populated `signature` field — the model reasoned but Anthropic only
    // returns an encrypted signature, not plaintext. Surface that state
    // explicitly instead of showing "0 chars / No thinking text captured".
    const hasSignature = !!(block as { signature?: string }).signature;
    return <ThinkingBlock text={block.thinking} hasSignature={hasSignature} />;
  }

  if (block.type === "tool_use") {
    return <ToolBlock name={block.name} input={block.input} toolUseId={block.id} />;
  }

  if (block.type === "tool_result") {
    const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
    const linkedTool = toolUseById.get(block.tool_use_id);
    const isError = block.is_error ?? false;
    const isBash = linkedTool?.name === "Bash";

    if (isBash) {
      return <BashResultBlock text={content} isError={isError} />;
    }

    return (
      <div className={`text-xs font-mono-code rounded-lg px-3 py-2 border ${isError
        ? "bg-cc-error/5 border-cc-error/20 text-cc-error"
        : "bg-cc-card border-cc-border text-cc-muted"
        } max-h-40 overflow-y-auto whitespace-pre-wrap`}>
        {content}
      </div>
    );
  }

  return null;
}

// ─── BashResultBlock ───────────────────────────────────────────────────────

function BashResultBlock({ text, isError }: { text: string; isError: boolean }) {
  const lines = text.split(/\r?\n/);
  const hasMore = lines.length > 20;
  const [showFull, setShowFull] = useState(false);
  const rendered = showFull || !hasMore ? text : lines.slice(-20).join("\n");

  return (
    <div className={`rounded-lg border ${isError ? "bg-cc-error/5 border-cc-error/20" : "bg-cc-card border-cc-border"
      }`}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-cc-border">
        <span className={`text-[10px] font-medium ${isError ? "text-cc-error" : "text-cc-muted"}`}>
          {hasMore && !showFull ? "Output (last 20 lines)" : "Output"}
        </span>
        {hasMore && (
          <button
            onClick={() => setShowFull(!showFull)}
            className="text-[10px] text-cc-primary hover:underline cursor-pointer"
          >
            {showFull ? "Show tail" : "Show full"}
          </button>
        )}
      </div>
      <pre className={`text-xs font-mono-code px-3 py-2 whitespace-pre-wrap max-h-60 overflow-y-auto ${isError ? "text-cc-error" : "text-cc-muted"
        }`}>
        {rendered}
      </pre>
    </div>
  );
}

// ─── ThinkingBlock ─────────────────────────────────────────────────────────

function ThinkingBlock({ text, hasSignature = false }: { text: string; hasSignature?: boolean }) {
  const normalized = text.trim();
  const preview = normalized.replace(/\s+/g, " ").slice(0, 90);
  // Adaptive thinking (Claude Code 2.1.119+) emits `thinking: ""` with a
  // populated `signature` — the model reasoned but Anthropic only returned
  // the encrypted signature, not plaintext. Surface that state explicitly
  // instead of the misleading "0 chars / No thinking text captured".
  const isEncryptedOnly = !normalized && hasSignature;
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-cc-primary/20 rounded-[16px] bg-cc-primary/[0.03] shadow-[0_0_15px_rgba(249,115,22,0.05)] relative before:absolute before:inset-0 before:rounded-[16px] before:bg-gradient-to-b before:from-cc-primary/10 before:to-transparent before:opacity-0 hover:before:opacity-100 before:transition-opacity before:pointer-events-none">
      <button
        onClick={() => !isEncryptedOnly && setOpen(!open)}
        disabled={isEncryptedOnly}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs text-cc-muted transition-colors relative z-10 ${isEncryptedOnly ? "cursor-default" : "hover:bg-cc-primary/10 cursor-pointer"}`}
      >
        {!isEncryptedOnly && (
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        )}
        <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-cc-primary/10 text-cc-primary shrink-0">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
            <path d="M8 2.5a3.5 3.5 0 013.5 3.5c0 1.3-.7 2.1-1.4 2.8-.6.6-1.1 1.1-1.1 1.7V11" strokeLinecap="round" />
            <circle cx="8" cy="13" r="0.7" fill="currentColor" stroke="none" />
            <path d="M5.3 3.8A3.5 3.5 0 004.5 6c0 1.3.7 2.1 1.4 2.8.6.6 1.1 1.1 1.1 1.7V11" strokeLinecap="round" />
          </svg>
        </span>
        <span className="font-medium text-cc-fg">Reasoning</span>
        {isEncryptedOnly ? (
          <span className="text-cc-muted/60 italic">hidden by Anthropic (adaptive thinking)</span>
        ) : (
          <>
            <span className="text-cc-muted/60">{text.length} chars</span>
            {!open && preview && (
              <span className="text-cc-muted truncate max-w-[55%]">{preview}</span>
            )}
          </>
        )}
      </button>
      {open && !isEncryptedOnly && (
        <div className="px-3 pb-3 pt-0">
          <div className="border border-cc-border/70 rounded-lg px-3 py-2 bg-cc-bg/60 max-h-60 overflow-y-auto">
            <div className="markdown-body text-[13px] text-cc-muted leading-relaxed">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                  li: ({ children }) => <li>{children}</li>,
                  code: ({ children }) => (
                    <code className="px-1.5 py-0.5 rounded-md bg-cc-fg/[0.06] text-cc-fg/80 font-mono-code text-[12px]">
                      {children}
                    </code>
                  ),
                }}
              >
                {normalized || "No thinking text captured."}
              </Markdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ToolGroupBlock ────────────────────────────────────────────────────────

// ─── ContextUsageCard ──────────────────────────────────────────────────────

interface ContextCategory {
  name: string;
  tokens: string;
  percent: number;
  type: "used" | "free" | "compacted";
}

interface ContextUsageData {
  model: string;
  usedTokens: string;
  totalTokens: string;
  overallPercent: number;
  categories: ContextCategory[];
}

const CONTEXT_COLORS = [
  "#8b5cf6", "#3b82f6", "#06b6d4", "#f59e0b",
  "#10b981", "#ec4899", "#f97316",
];
const CONTEXT_FREE_COLOR = "#374151";
const CONTEXT_COMPACT_COLOR = "#6b7280";

function getContextCategoryColor(cat: ContextCategory, usedIdx: number): string {
  if (cat.type === "free") return CONTEXT_FREE_COLOR;
  if (cat.type === "compacted") return CONTEXT_COMPACT_COLOR;
  return CONTEXT_COLORS[usedIdx % CONTEXT_COLORS.length];
}

function parseContextOutput(content: string): ContextUsageData | null {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  let model = "";
  let usedTokens = "";
  let totalTokens = "";
  let overallPercent = 0;

  // Find the token fraction line — handles both formats:
  //   "55.7k / 200k tokens (28%)"          — plain text
  //   "**Tokens:** 55.7k / 200k (28%)"     — markdown
  for (const line of lines) {
    const m = line.match(/([\d,.]+k?)\s*\/\s*([\d,.]+k?)\s*(?:tokens?\s*)?\((\d+)%\)/i);
    if (m) {
      usedTokens = m[1];
      totalTokens = m[2];
      overallPercent = parseInt(m[3], 10);
      break;
    }
  }

  if (!usedTokens) return null;

  // Extract model — handles "**Model:** claude-opus-4-6" or "Model: claude-opus-4-6"
  for (const line of lines) {
    const m = line.match(/\*{0,2}Model\*{0,2}[:\s]+\*{0,2}\s*([a-z][\w.-]+)/i);
    if (m) {
      model = m[1];
      break;
    }
  }

  // Parse categories from markdown table rows or bullet/icon lines
  const categories: ContextCategory[] = [];

  // Markdown table row: | System prompt | 3.8k | 1.9% |
  const tableRowRegex = /\|\s*(.+?)\s*\|\s*([\d,.]+k?)\s*\|\s*([\d.]+)%\s*\|?/;
  // Bullet/icon: ● System prompt    3.4k   1.7%
  const bulletRegex = /([●○⊠▪▫◻■□•◦])\s*(.+?)\s+([\d,.]+k?)\s+([\d.]+)%/;
  // Simple spacing: System prompt    3.4k   1.7%
  const simpleRegex = /(.+?)\s{2,}([\d,.]+k?)\s+([\d.]+)%/;

  for (const line of lines) {
    // Skip markdown table headers and separators
    if (line.match(/\|\s*-+/) || line.match(/\|\s*Category\s*\|/i)) continue;

    // Try markdown table row
    let match = line.match(tableRowRegex);
    if (match) {
      const name = match[1].replace(/\*\*/g, "").trim();
      if (!name || name.toLowerCase() === "category") continue;
      categories.push({
        name,
        tokens: match[2],
        percent: parseFloat(match[3]),
        type: name.toLowerCase().includes("free") ? "free"
          : name.toLowerCase().includes("compact") ? "compacted"
            : "used",
      });
      continue;
    }

    // Try bullet/icon format
    match = line.match(bulletRegex);
    if (match) {
      const marker = match[1];
      const name = match[2].trim();
      categories.push({
        name,
        tokens: match[3],
        percent: parseFloat(match[4]),
        type: marker === "○" || name.toLowerCase().includes("free") ? "free"
          : marker === "⊠" || name.toLowerCase().includes("compact") ? "compacted"
            : "used",
      });
      continue;
    }

    // Try simple spacing format
    match = line.match(simpleRegex);
    if (match) {
      const name = match[1].replace(/^[^\w]+/, "").trim();
      if (!name) continue;
      categories.push({
        name,
        tokens: match[2],
        percent: parseFloat(match[3]),
        type: name.toLowerCase().includes("free") ? "free"
          : name.toLowerCase().includes("compact") ? "compacted"
            : "used",
      });
    }
  }

  return { model, usedTokens, totalTokens, overallPercent, categories };
}

function ContextUsageCard({ content }: { content: string }) {
  const data = useMemo(() => parseContextOutput(content), [content]);

  if (!data) {
    return (
      <div className="rounded-lg border border-cc-border bg-cc-card/50 px-4 py-3">
        <MarkdownContent text={content} />
      </div>
    );
  }

  let usedColorIdx = 0;
  const coloredCategories = data.categories.map((cat) => {
    const color = getContextCategoryColor(cat, cat.type === "used" ? usedColorIdx : 0);
    if (cat.type === "used") usedColorIdx++;
    return { ...cat, color };
  });

  return (
    <div className="rounded-lg border border-cc-border bg-cc-card overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className="text-xs font-semibold text-cc-fg mb-0.5">Context Usage</div>
        <div className="text-xs text-cc-muted">
          {data.model && <span>{data.model} &middot; </span>}
          {data.usedTokens} / {data.totalTokens} tokens ({data.overallPercent}%)
        </div>
      </div>

      {coloredCategories.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex h-2 rounded-full overflow-hidden bg-neutral-800">
            {coloredCategories.map((cat, i) =>
              cat.percent > 0 ? (
                <div
                  key={i}
                  style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
                  className="h-full"
                  title={`${cat.name}: ${cat.tokens} (${cat.percent}%)`}
                />
              ) : null,
            )}
          </div>
        </div>
      )}

      {coloredCategories.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          {coloredCategories.map((cat, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 shrink-0 ${cat.type === "free"
                  ? "rounded-full border border-neutral-500"
                  : cat.type === "compacted"
                    ? "rounded-sm border border-neutral-500"
                    : "rounded-full"
                  }`}
                style={cat.type !== "free" && cat.type !== "compacted" ? { backgroundColor: cat.color } : undefined}
              />
              <span className="text-cc-muted flex-1">{cat.name}</span>
              <span className="text-cc-fg tabular-nums">{cat.tokens}</span>
              <span className="text-cc-muted tabular-nums w-12 text-right">{cat.percent}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ToolGroupBlock ────────────────────────────────────────────────────────

// ─── Debug Payload ──────────────────────────────────────────────────────────

function DebugPayloadButton({ payload }: { payload: NonNullable<ChatMessage["debugPayload"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-cc-border/30">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-[10px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer w-full"
        title="Debug: view CLI payload"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}>
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        <span>payload</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <pre className="text-[10px] font-mono-code bg-black/30 text-cc-code-fg rounded-md px-2.5 py-2 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
            {payload.enrichedContent}
          </pre>
          {payload.images && payload.images.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {payload.images.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.media_type};base64,${img.data}`}
                  alt={`Debug image ${i + 1}`}
                  className="max-w-[200px] max-h-[120px] rounded-md border border-cc-border object-contain bg-white"
                />
              ))}
            </div>
          )}
          {payload.files && payload.files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {payload.files.map((f, i) => (
                <FileTag key={i} name={f.name} size={f.size} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ToolGroupBlock ────────────────────────────────────────────────────────

function ToolGroupBlock({ name, items }: { name: string; items: ToolGroupItem[] }) {
  const [open, setOpen] = useState(false);
  const iconType = getToolIcon(name);
  const label = getToolLabel(name);

  return (
    <div className="border border-cc-border rounded-[10px] overflow-hidden bg-cc-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-cc-hover transition-colors cursor-pointer"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`w-3 h-3 text-cc-muted transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <ToolIcon type={iconType} />
        <span className="text-xs font-medium text-cc-fg">{label}</span>
        <span className="text-[10px] text-cc-muted bg-cc-hover rounded-full px-1.5 py-0.5 tabular-nums">
          {items.length}
        </span>
      </button>

      {open && (
        <div className="border-t border-cc-border px-3 py-1.5">
          {items.map((item, i) => {
            const itemPreview = getPreview(item.name, item.input);
            return (
              <div key={item.id || i} className="flex items-center gap-2 py-1 text-xs text-cc-muted font-mono-code truncate">
                <span className="w-1 h-1 rounded-full bg-cc-muted/40 shrink-0" />
                <span className="truncate">{itemPreview || JSON.stringify(item.input).slice(0, 80)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
