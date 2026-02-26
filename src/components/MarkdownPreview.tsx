import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store.js";

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

export default function MarkdownPreview() {
  const files = useStore((s) => s.files);
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

  const isDark = theme === "dark";

  if (files.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <PreviewToolbar theme={theme} onToggleTheme={toggleTheme} />
        <div className="flex items-center justify-center flex-1 text-neutral-500">
          No markdown files in workspace
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PreviewToolbar theme={theme} onToggleTheme={toggleTheme} />
      <div
        className={`flex-1 overflow-y-auto p-6 transition-colors duration-200 ${
          isDark ? "bg-[#1a1a18] text-[#e8e6df]" : "bg-white text-[#1f1f1e]"
        }`}
      >
        {files.map((file) => (
          <div key={file.path} className="mb-8">
            <div className={`text-xs mb-2 font-mono ${isDark ? "text-neutral-500" : "text-neutral-400"}`}>
              {file.path}
            </div>
            <div className={`prose max-w-none ${isDark ? "prose-invert prose-neutral" : "prose-neutral"}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ src, alt, ...props }) => (
                    <img
                      src={rewriteImageSrc(src, file.path)}
                      alt={alt || ""}
                      className="max-w-full rounded"
                      {...props}
                    />
                  ),
                }}
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

function PreviewToolbar({ theme, onToggleTheme }: { theme: PreviewTheme; onToggleTheme: () => void }) {
  const isDark = theme === "dark";
  return (
    <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b border-cc-border bg-cc-card/50 shrink-0">
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
