import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useStore } from "../store.js";
import type { ElementSelection } from "../store.js";

type PreviewTheme = "dark" | "light";
type PreviewMode = "view" | "edit" | "select";

/** Rewrite relative image paths to go through the /content/ endpoint */
function rewriteImageSrc(src: string | undefined, filePath: string, cacheBust?: number): string {
  if (!src) return "";
  if (/^(https?:|data:)/.test(src)) return src;
  let url: string;
  if (src.startsWith("/content/")) url = src;
  else if (src.startsWith("/")) url = `/content${src}`;
  else {
    const dir = filePath.includes("/") ? filePath.replace(/\/[^/]+$/, "") : "";
    const resolved = dir ? `${dir}/${src}` : src;
    url = `/content/${resolved}`;
  }
  if (cacheBust) url += `?v=${cacheBust}`;
  return url;
}

/** Build react-markdown components with data-selectable attributes */
function buildSelectableComponents(filePath: string, imageTick?: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapBlock = (tag: string, type: ElementSelection["type"], level?: number): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ({ children, node, ...props }: any) => {
      const attrs: Record<string, string | number> = {
        "data-selectable": "",
        "data-type": type,
      };
      if (level) attrs["data-level"] = level;
      switch (tag) {
        case "h1": return <h1 {...attrs} {...props}>{children}</h1>;
        case "h2": return <h2 {...attrs} {...props}>{children}</h2>;
        case "h3": return <h3 {...attrs} {...props}>{children}</h3>;
        case "h4": return <h4 {...attrs} {...props}>{children}</h4>;
        case "h5": return <h5 {...attrs} {...props}>{children}</h5>;
        case "h6": return <h6 {...attrs} {...props}>{children}</h6>;
        case "p": return <p {...attrs} {...props}>{children}</p>;
        case "ul": return <ul {...attrs} {...props}>{children}</ul>;
        case "ol": return <ol {...attrs} {...props}>{children}</ol>;
        case "pre": return <pre {...attrs} {...props}>{children}</pre>;
        case "blockquote": return <blockquote {...attrs} {...props}>{children}</blockquote>;
        case "table": return <table {...attrs} {...props}>{children}</table>;
        default: return <div {...attrs} {...props}>{children}</div>;
      }
    };
  };

  return {
    h1: wrapBlock("h1", "heading", 1),
    h2: wrapBlock("h2", "heading", 2),
    h3: wrapBlock("h3", "heading", 3),
    h4: wrapBlock("h4", "heading", 4),
    h5: wrapBlock("h5", "heading", 5),
    h6: wrapBlock("h6", "heading", 6),
    p: wrapBlock("p", "paragraph"),
    ul: wrapBlock("ul", "list"),
    ol: wrapBlock("ol", "list"),
    pre: wrapBlock("pre", "code"),
    blockquote: wrapBlock("blockquote", "blockquote"),
    table: wrapBlock("table", "table"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    img: ({ src, alt, node, ...props }: any) => {
      const rewritten = rewriteImageSrc(src, filePath, imageTick);
      return (
        <span
          className="inline-block max-w-full"
          data-selectable=""
          data-type="image"
          data-src={src || ""}
        >
          <img
            src={rewritten}
            alt={alt || ""}
            className="max-w-full rounded"
            {...props}
          />
        </span>
      );
    },
  };
}

/** Build default (non-selectable) react-markdown components */
function buildDefaultComponents(filePath: string, imageTick?: number) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    img: ({ src, alt, node, ...props }: any) => (
      <img
        src={rewriteImageSrc(src, filePath, imageTick)}
        alt={alt || ""}
        className="max-w-full rounded"
        {...props}
      />
    ),
  };
}

/** Save file content to server */
async function saveFile(path: string, content: string): Promise<boolean> {
  try {
    const baseUrl = import.meta.env.DEV ? `http://localhost:17007` : "";
    const res = await fetch(`${baseUrl}/api/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default function MarkdownPreview() {
  const files = useStore((s) => s.files);
  const imageTick = useStore((s) => s.imageTick);
  const previewMode = useStore((s) => s.previewMode);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const setPreviewMode = useStore((s) => s.setPreviewMode);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedElRef = useRef<HTMLElement | null>(null);

  const [theme, setTheme] = useState<PreviewTheme>(() => {
    return (localStorage.getItem("pneuma-preview-theme") as PreviewTheme) || "dark";
  });

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("pneuma-preview-theme", next);
  };

  useEffect(() => {
    const baseUrl = import.meta.env.DEV ? `http://localhost:17007` : "";
    fetch(`${baseUrl}/api/files`)
      .then((r) => r.json())
      .then((data: { files: { path: string; content: string }[] }) => {
        useStore.getState().setFiles(data.files);
      })
      .catch(() => {});
  }, []);

  const isSelectMode = previewMode === "select";

  // Re-apply selection highlight after content re-renders or selection changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous highlight
    if (selectedElRef.current) {
      selectedElRef.current.classList.remove("element-selected");
      selectedElRef.current = null;
    }

    if (!selection) return;

    // Find matching element by type + content
    const fileEl = container.querySelector(`[data-file="${selection.file}"]`);
    if (!fileEl) return;

    const selector = `[data-selectable][data-type="${selection.type}"]${
      selection.level ? `[data-level="${selection.level}"]` : ""
    }`;
    const candidates = fileEl.querySelectorAll(selector);

    for (const el of candidates) {
      let match = false;
      if (selection.type === "image") {
        // Match images by data-src attribute
        match = (el as HTMLElement).dataset.src === selection.content;
      } else {
        const text = (el.textContent || "").trim().slice(0, 200);
        match = text === selection.content || text.startsWith(selection.content.slice(0, 50));
      }
      if (match) {
        el.classList.add("element-selected");
        selectedElRef.current = el as HTMLElement;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      }
    }
  }, [selection, files]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSelectMode) {
        if (selection) {
          setSelection(null);
        } else {
          setPreviewMode("view");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSelectMode, selection, setSelection, setPreviewMode]);

  // Click handler for element selection (event delegation)
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isSelectMode) return;

      const target = (e.target as HTMLElement).closest("[data-selectable]") as HTMLElement | null;

      // Click on background → deselect
      if (!target) {
        if (selectedElRef.current) {
          selectedElRef.current.classList.remove("element-selected");
          selectedElRef.current = null;
        }
        setSelection(null);
        return;
      }

      // Find which file this element belongs to
      const fileEl = target.closest("[data-file]") as HTMLElement | null;
      const file = fileEl?.dataset.file || "";
      const type = (target.dataset.type || "paragraph") as ElementSelection["type"];
      const level = target.dataset.level ? Number(target.dataset.level) : undefined;
      const content = type === "image"
        ? (target.dataset.src || target.querySelector("img")?.getAttribute("alt") || "image")
        : (target.textContent || "").trim().slice(0, 200);

      // Update DOM highlight
      if (selectedElRef.current) {
        selectedElRef.current.classList.remove("element-selected");
      }
      target.classList.add("element-selected");
      selectedElRef.current = target;

      setSelection({ file, type, content, level });
    },
    [isSelectMode, setSelection],
  );

  // Text range selection via mouseup
  const handleMouseUp = useCallback(() => {
    if (!isSelectMode) return;

    const sel = window.getSelection();
    if (!sel || !sel.toString().trim()) return;

    const text = sel.toString().trim();
    if (text.length < 2) return; // Ignore accidental tiny selections

    // Find which file
    const anchor = sel.anchorNode;
    const fileEl =
      (anchor as Element)?.closest?.("[data-file]") ||
      anchor?.parentElement?.closest("[data-file]");
    const file = (fileEl as HTMLElement)?.dataset?.file || "";

    // Clear any block selection
    if (selectedElRef.current) {
      selectedElRef.current.classList.remove("element-selected");
      selectedElRef.current = null;
    }

    setSelection({ file, type: "text-range", content: text.slice(0, 300) });
  }, [isSelectMode, setSelection]);

  const isDark = theme === "dark";

  if (files.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <PreviewToolbar
          theme={theme}
          onToggleTheme={toggleTheme}
          previewMode={previewMode}
          onSetPreviewMode={setPreviewMode}
        />
        <div className="flex items-center justify-center flex-1 text-neutral-500">
          No markdown files in workspace
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PreviewToolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        previewMode={previewMode}
        onSetPreviewMode={setPreviewMode}
      />
      {previewMode === "edit" ? (
        <div
          className={`flex-1 overflow-y-auto transition-colors duration-200 ${
            isDark ? "bg-[#1a1a18]" : "bg-white"
          }`}
        >
          {files.map((file) => (
            <MarkdownEditor key={file.path} file={file} isDark={isDark} />
          ))}
        </div>
      ) : (
        <div
          ref={containerRef}
          onClick={handleClick}
          onMouseUp={handleMouseUp}
          className={`flex-1 overflow-y-auto p-6 transition-colors duration-200 ${
            isDark ? "bg-[#1a1a18] text-[#e8e6df]" : "bg-white text-[#1f1f1e]"
          } ${isSelectMode ? "select-mode" : ""}`}
        >
          {files.map((file) => (
            <div key={file.path} className="mb-8" data-file={file.path}>
              <div className={`text-xs mb-2 font-mono ${isDark ? "text-neutral-500" : "text-neutral-400"}`}>
                {file.path}
              </div>
              <div className={`prose max-w-none ${isDark ? "prose-invert prose-neutral" : "prose-neutral"}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={
                    isSelectMode ? buildSelectableComponents(file.path, imageTick) : buildDefaultComponents(file.path, imageTick)
                  }
                >
                  {file.content}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Markdown Editor (Edit mode) ─────────────────────────────────────────────

function MarkdownEditor({ file, isDark }: { file: { path: string; content: string }; isDark: boolean }) {
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastExternalRef = useRef(file.content);

  // Sync from external changes (e.g. Claude Code edits) — only when content
  // actually changed externally (not from our own saves)
  useEffect(() => {
    const el = textareaRef.current;
    if (el && file.content !== lastExternalRef.current) {
      el.value = file.content;
      lastExternalRef.current = file.content;
    }
  }, [file.content]);

  const scheduleSave = useCallback((content: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      await saveFile(file.path, content);
      lastExternalRef.current = content; // prevent echo-back
      setSaving(false);
    }, 800);
  }, [file.path]);

  // Save on unmount if pending
  useEffect(() => {
    return () => {
      if (saveTimerRef.current && textareaRef.current) {
        clearTimeout(saveTimerRef.current);
        saveFile(file.path, textareaRef.current.value);
      }
    };
  }, [file.path]);

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) scheduleSave(el.value);
  };

  /** Insert markdown using execCommand to preserve native undo */
  const insertMarkdown = (before: string, after: string = "") => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = el.value.slice(start, end);
    const inner = selected || "text";
    const replacement = `${before}${inner}${after}`;

    // execCommand('insertText') preserves native undo stack
    el.setSelectionRange(start, end);
    document.execCommand("insertText", false, replacement);

    // Select the inner text for easy overtyping
    const cursorPos = start + before.length;
    el.setSelectionRange(cursorPos, cursorPos + inner.length);

    scheduleSave(el.value);
  };

  /** Insert line-level markdown (prepend to line start) */
  const insertLine = (prefix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const start = el.selectionStart;
    const lineStart = el.value.lastIndexOf("\n", start - 1) + 1;

    el.setSelectionRange(lineStart, lineStart);
    document.execCommand("insertText", false, prefix);

    const newCursor = start + prefix.length;
    el.setSelectionRange(newCursor, newCursor);

    scheduleSave(el.value);
  };

  const lineCount = (textareaRef.current?.value || file.content).split("\n").length;

  return (
    <div className="border-b border-cc-border/30 last:border-b-0">
      <div className={`flex items-center justify-between px-4 py-1.5 ${isDark ? "bg-cc-card/50" : "bg-neutral-50"}`}>
        <span className={`text-xs font-mono ${isDark ? "text-neutral-500" : "text-neutral-400"}`}>
          {file.path}
        </span>
        <span className={`text-[10px] ${saving ? "text-cc-warning" : "text-cc-muted/50"}`}>
          {saving ? "saving..." : "auto-save"}
        </span>
      </div>
      {/* WYSIWYG toolbar */}
      <div className={`flex items-center gap-0.5 px-3 py-1 border-b ${
        isDark ? "border-cc-border/30 bg-cc-card/30" : "border-neutral-200 bg-neutral-50/50"
      }`}>
        <EditorButton title="Bold (⌘B)" onClick={() => insertMarkdown("**", "**")}>
          <BoldIcon />
        </EditorButton>
        <EditorButton title="Italic (⌘I)" onClick={() => insertMarkdown("*", "*")}>
          <ItalicIcon />
        </EditorButton>
        <EditorButton title="Strikethrough" onClick={() => insertMarkdown("~~", "~~")}>
          <StrikethroughIcon />
        </EditorButton>
        <ToolbarDivider isDark={isDark} />
        <EditorButton title="Heading 1" onClick={() => insertLine("# ")}>
          <span className="text-[10px] font-bold">H1</span>
        </EditorButton>
        <EditorButton title="Heading 2" onClick={() => insertLine("## ")}>
          <span className="text-[10px] font-bold">H2</span>
        </EditorButton>
        <EditorButton title="Heading 3" onClick={() => insertLine("### ")}>
          <span className="text-[10px] font-bold">H3</span>
        </EditorButton>
        <ToolbarDivider isDark={isDark} />
        <EditorButton title="Inline code" onClick={() => insertMarkdown("`", "`")}>
          <CodeIcon />
        </EditorButton>
        <EditorButton title="Code block" onClick={() => insertMarkdown("```\n", "\n```")}>
          <CodeBlockIcon />
        </EditorButton>
        <ToolbarDivider isDark={isDark} />
        <EditorButton title="Bullet list" onClick={() => insertLine("- ")}>
          <ListIcon />
        </EditorButton>
        <EditorButton title="Numbered list" onClick={() => insertLine("1. ")}>
          <OrderedListIcon />
        </EditorButton>
        <EditorButton title="Blockquote" onClick={() => insertLine("> ")}>
          <QuoteIcon />
        </EditorButton>
        <ToolbarDivider isDark={isDark} />
        <EditorButton title="Link" onClick={() => insertMarkdown("[", "](url)")}>
          <LinkIcon />
        </EditorButton>
        <EditorButton title="Image" onClick={() => insertMarkdown("![alt](", ")")}>
          <ImageIcon />
        </EditorButton>
        <EditorButton title="Horizontal rule" onClick={() => insertLine("---\n")}>
          <HrIcon />
        </EditorButton>
      </div>
      <textarea
        ref={textareaRef}
        defaultValue={file.content}
        onInput={handleInput}
        spellCheck={false}
        className={`w-full min-h-[300px] p-4 text-sm font-mono-code resize-y focus:outline-none ${
          isDark
            ? "bg-[#1a1a18] text-[#e8e6df] caret-cc-primary"
            : "bg-white text-[#1f1f1e] caret-blue-500"
        }`}
        style={{ height: `${Math.max(300, lineCount * 22 + 40)}px` }}
      />
    </div>
  );
}

// ── Editor Button ────────────────────────────────────────────────────────────

function EditorButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center w-7 h-7 rounded text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}

function ToolbarDivider({ isDark }: { isDark: boolean }) {
  return <div className={`w-px h-4 mx-0.5 ${isDark ? "bg-cc-border" : "bg-neutral-300"}`} />;
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function PreviewToolbar({
  theme,
  onToggleTheme,
  previewMode,
  onSetPreviewMode,
}: {
  theme: PreviewTheme;
  onToggleTheme: () => void;
  previewMode: PreviewMode;
  onSetPreviewMode: (mode: PreviewMode) => void;
}) {
  const isDark = theme === "dark";

  const modes: { value: PreviewMode; label: string; icon: React.ReactNode }[] = [
    { value: "view", label: "View", icon: <EyeIcon /> },
    { value: "edit", label: "Edit", icon: <PencilIcon /> },
    { value: "select", label: "Select", icon: <CursorIcon /> },
  ];

  return (
    <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b border-cc-border bg-cc-card/50 shrink-0">
      {/* 3-state segmented control */}
      <div className="flex items-center bg-cc-bg/60 rounded-md p-0.5">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => onSetPreviewMode(m.value)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
              previewMode === m.value
                ? "bg-cc-primary/20 text-cc-primary"
                : "text-cc-muted hover:text-cc-fg"
            }`}
            title={
              m.value === "view" ? "Read-only view"
                : m.value === "edit" ? "Edit markdown directly"
                : "Select elements (Esc to exit)"
            }
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <div className="w-px h-4 bg-cc-border mx-0.5" />
      <button
        onClick={onToggleTheme}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {isDark ? <SunIcon /> : <MoonIcon />}
        <span>{isDark ? "Light" : "Dark"}</span>
      </button>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" strokeLinejoin="round" />
      <path d="M9 4l3 3" />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M3 2l4 12 2-5 5-2L3 2z" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M13.5 8.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z" />
    </svg>
  );
}

// ── Editor toolbar icons ────────────────────────────────────────────────────

function BoldIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M4 2h5a3 3 0 011.5 5.6A3.5 3.5 0 019.5 14H4V2zm2 5h3a1 1 0 000-2H6v2zm0 2v3h3.5a1.5 1.5 0 000-3H6z" />
    </svg>
  );
}

function ItalicIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M6 2h6v2h-2.2l-2.6 8H9v2H3v-2h2.2l2.6-8H6V2z" />
    </svg>
  );
}

function StrikethroughIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M2 8h12v1.5H2V8zM5.5 3H11v2H8v1h3v1H5V6h1V5H5.5V3zM8 11h3v2H5.5v-2H8z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CodeBlockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <rect x="1.5" y="2" width="13" height="12" rx="2" />
      <path d="M5 6L3 8l2 2M8 6l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <circle cx="3" cy="4" r="1.2" />
      <circle cx="3" cy="8" r="1.2" />
      <circle cx="3" cy="12" r="1.2" />
      <rect x="6" y="3" width="8" height="2" rx="0.5" />
      <rect x="6" y="7" width="8" height="2" rx="0.5" />
      <rect x="6" y="11" width="8" height="2" rx="0.5" />
    </svg>
  );
}

function OrderedListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <text x="1.5" y="5.5" fontSize="5" fontWeight="600">1</text>
      <text x="1.5" y="9.5" fontSize="5" fontWeight="600">2</text>
      <text x="1.5" y="13.5" fontSize="5" fontWeight="600">3</text>
      <rect x="6" y="3" width="8" height="2" rx="0.5" />
      <rect x="6" y="7" width="8" height="2" rx="0.5" />
      <rect x="6" y="11" width="8" height="2" rx="0.5" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M3 3h2.5L4 7.5C5.5 7.5 6.5 8.5 6.5 10s-1 2.5-2.5 2.5S1.5 11.5 1.5 10c0-.7.2-1.5.5-2.2L3 3zm7 0h2.5L11 7.5c1.5 0 2.5 1 2.5 2.5s-1 2.5-2.5 2.5S8.5 11.5 8.5 10c0-.7.2-1.5.5-2.2L10 3z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M6.5 9.5a3 3 0 004 .5l2-2a3 3 0 00-4.2-4.2l-1.2 1.1" strokeLinecap="round" />
      <path d="M9.5 6.5a3 3 0 00-4-.5l-2 2a3 3 0 004.2 4.2l1.1-1.1" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <circle cx="5" cy="6" r="1.5" />
      <path d="M1.5 11l3-3 2 2 3-3 5 5" strokeLinejoin="round" />
    </svg>
  );
}

function HrIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <rect x="1" y="7" width="14" height="2" rx="1" />
    </svg>
  );
}
