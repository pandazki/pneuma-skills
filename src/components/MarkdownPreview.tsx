import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store.js";
import type { ElementSelection } from "../store.js";

type PreviewTheme = "dark" | "light";

/** Rewrite relative image paths to go through the /content/ endpoint */
function rewriteImageSrc(src: string | undefined, filePath: string): string {
  if (!src) return "";
  if (/^(https?:|data:)/.test(src)) return src;
  if (src.startsWith("/content/")) return src;
  if (src.startsWith("/")) return `/content${src}`;
  const dir = filePath.includes("/") ? filePath.replace(/\/[^/]+$/, "") : "";
  const resolved = dir ? `${dir}/${src}` : src;
  return `/content/${resolved}`;
}

/** Build react-markdown components with data-selectable attributes */
function buildSelectableComponents(filePath: string) {
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
    img: ({ src, alt, node, ...props }: any) => (
      <img
        src={rewriteImageSrc(src, filePath)}
        alt={alt || ""}
        className="max-w-full rounded"
        data-selectable=""
        data-type="image"
        {...props}
      />
    ),
  };
}

/** Build default (non-selectable) react-markdown components */
function buildDefaultComponents(filePath: string) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    img: ({ src, alt, node, ...props }: any) => (
      <img
        src={rewriteImageSrc(src, filePath)}
        alt={alt || ""}
        className="max-w-full rounded"
        {...props}
      />
    ),
  };
}

export default function MarkdownPreview() {
  const files = useStore((s) => s.files);
  const selectMode = useStore((s) => s.selectMode);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const setSelectMode = useStore((s) => s.setSelectMode);
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
    fetch("/api/files")
      .then((r) => r.json())
      .then((data: { files: { path: string; content: string }[] }) => {
        useStore.getState().setFiles(data.files);
      })
      .catch(() => {});
  }, []);

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
      const text = (el.textContent || "").trim().slice(0, 200);
      if (text === selection.content || text.startsWith(selection.content.slice(0, 50))) {
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
      if (e.key === "Escape" && selectMode) {
        if (selection) {
          setSelection(null);
        } else {
          setSelectMode(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectMode, selection, setSelection, setSelectMode]);

  // Click handler for element selection (event delegation)
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!selectMode) return;

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
      const content = (target.textContent || "").trim().slice(0, 200);

      // Update DOM highlight
      if (selectedElRef.current) {
        selectedElRef.current.classList.remove("element-selected");
      }
      target.classList.add("element-selected");
      selectedElRef.current = target;

      setSelection({ file, type, content, level });
    },
    [selectMode, setSelection],
  );

  // Text range selection via mouseup
  const handleMouseUp = useCallback(() => {
    if (!selectMode) return;

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
  }, [selectMode, setSelection]);

  const isDark = theme === "dark";

  if (files.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <PreviewToolbar
          theme={theme}
          onToggleTheme={toggleTheme}
          selectMode={selectMode}
          onToggleSelect={() => setSelectMode(!selectMode)}
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
        selectMode={selectMode}
        onToggleSelect={() => setSelectMode(!selectMode)}
      />
      <div
        ref={containerRef}
        onClick={handleClick}
        onMouseUp={handleMouseUp}
        className={`flex-1 overflow-y-auto p-6 transition-colors duration-200 ${
          isDark ? "bg-[#1a1a18] text-[#e8e6df]" : "bg-white text-[#1f1f1e]"
        } ${selectMode ? "select-mode" : ""}`}
      >
        {files.map((file) => (
          <div key={file.path} className="mb-8" data-file={file.path}>
            <div className={`text-xs mb-2 font-mono ${isDark ? "text-neutral-500" : "text-neutral-400"}`}>
              {file.path}
            </div>
            <div className={`prose max-w-none ${isDark ? "prose-invert prose-neutral" : "prose-neutral"}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={
                  selectMode ? buildSelectableComponents(file.path) : buildDefaultComponents(file.path)
                }
              >
                {file.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function PreviewToolbar({
  theme,
  onToggleTheme,
  selectMode,
  onToggleSelect,
}: {
  theme: PreviewTheme;
  onToggleTheme: () => void;
  selectMode: boolean;
  onToggleSelect: () => void;
}) {
  const isDark = theme === "dark";
  return (
    <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b border-cc-border bg-cc-card/50 shrink-0">
      <button
        onClick={onToggleSelect}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer ${
          selectMode
            ? "bg-cc-primary/20 text-cc-primary"
            : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
        }`}
        title={selectMode ? "Exit select mode (Esc)" : "Enter select mode"}
      >
        <CursorIcon />
        <span>{selectMode ? "Selecting" : "Select"}</span>
      </button>
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
