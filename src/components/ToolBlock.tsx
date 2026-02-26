import { useState } from "react";

const TOOL_ICONS: Record<string, string> = {
  Bash: "terminal",
  Read: "file",
  Write: "file-plus",
  Edit: "file-edit",
  Glob: "search",
  Grep: "search",
  WebFetch: "globe",
  WebSearch: "globe",
  NotebookEdit: "notebook",
  Task: "agent",
  TodoWrite: "checklist",
  TaskCreate: "list",
  TaskUpdate: "list",
  SendMessage: "message",
};

export function getToolIcon(name: string): string {
  return TOOL_ICONS[name] || "tool";
}

export function getToolLabel(name: string): string {
  if (name === "Bash") return "Terminal";
  if (name === "Read") return "Read File";
  if (name === "Write") return "Write File";
  if (name === "Edit") return "Edit File";
  if (name === "Glob") return "Find Files";
  if (name === "Grep") return "Search Content";
  if (name === "WebSearch") return "Web Search";
  if (name === "WebFetch") return "Web Fetch";
  if (name === "Task") return "Subagent";
  if (name === "TodoWrite") return "Tasks";
  if (name === "NotebookEdit") return "Notebook";
  if (name === "SendMessage") return "Message";
  if (name.startsWith("mcp__")) return name.split("__").slice(1).join(":");
  return name;
}

export function getPreview(name: string, input: Record<string, unknown>): string {
  if (name === "Bash" && typeof input.command === "string") {
    if (input.description && typeof input.description === "string" && input.description.length <= 60) {
      return input.description;
    }
    return input.command.length > 60 ? input.command.slice(0, 60) + "..." : input.command;
  }
  if ((name === "Read" || name === "Write" || name === "Edit") && input.file_path) {
    const path = String(input.file_path);
    return path.split("/").slice(-2).join("/");
  }
  if (name === "Glob" && input.pattern) return String(input.pattern);
  if (name === "Grep" && input.pattern) {
    const p = String(input.pattern);
    const suffix = input.path ? ` in ${String(input.path).split("/").slice(-2).join("/")}` : "";
    const full = p + suffix;
    return full.length > 60 ? full.slice(0, 60) + "..." : full;
  }
  if (name === "WebSearch" && input.query) return String(input.query);
  if (name === "WebFetch" && input.url) {
    try {
      const u = new URL(String(input.url));
      return u.hostname + u.pathname;
    } catch {
      return String(input.url).slice(0, 60);
    }
  }
  if (name === "Task" && input.description) return String(input.description);
  if (name === "TodoWrite" && Array.isArray(input.todos)) {
    return `${input.todos.length} task${input.todos.length !== 1 ? "s" : ""}`;
  }
  if (name === "SendMessage" && input.recipient) {
    return `\u2192 ${String(input.recipient)}`;
  }
  return "";
}

export function ToolBlock({
  name,
  input,
}: {
  name: string;
  input: Record<string, unknown>;
  toolUseId: string;
}) {
  const [open, setOpen] = useState(false);
  const iconType = getToolIcon(name);
  const label = getToolLabel(name);
  const preview = getPreview(name, input);

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
        {preview && (
          <span className="text-xs text-cc-muted truncate flex-1 font-mono-code">
            {preview}
          </span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-0 border-t border-cc-border">
          <div className="mt-2">
            <ToolDetail name={name} input={input} />
          </div>
        </div>
      )}
    </div>
  );
}

function ToolDetail({ name, input }: { name: string; input: Record<string, unknown> }) {
  switch (name) {
    case "Bash":
      return (
        <div className="space-y-1.5">
          {!!input.description && (
            <div className="text-[11px] text-cc-muted italic">{String(input.description)}</div>
          )}
          <pre className="px-3 py-2 rounded-lg bg-cc-code-bg text-cc-code-fg text-[12px] font-mono-code leading-relaxed overflow-x-auto">
            <span className="text-cc-muted select-none">$ </span>
            {String(input.command || "")}
          </pre>
        </div>
      );
    case "Edit":
      return (
        <div className="space-y-1.5">
          {input.file_path ? <div className="text-xs text-cc-muted font-mono-code">{String(input.file_path)}</div> : null}
          {!!input.replace_all && (
            <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-cc-warning/10 text-cc-warning">
              replace all
            </span>
          )}
          {(input.old_string || input.new_string) ? (
            <div className="space-y-1">
              {input.old_string ? (
                <pre className="px-2 py-1.5 rounded bg-cc-error/5 border border-cc-error/20 text-[11px] font-mono-code text-cc-error whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {String(input.old_string)}
                </pre>
              ) : null}
              {input.new_string ? (
                <pre className="px-2 py-1.5 rounded bg-cc-success/5 border border-cc-success/20 text-[11px] font-mono-code text-cc-success whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {String(input.new_string)}
                </pre>
              ) : null}
            </div>
          ) : (
            <pre className="text-[11px] text-cc-muted font-mono-code whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          )}
        </div>
      );
    case "Write":
    case "Read":
      return (
        <div className="space-y-1">
          <div className="text-xs text-cc-muted font-mono-code">{String(input.file_path || input.path || "")}</div>
          {input.content ? (
            <pre className="px-2 py-1.5 rounded bg-cc-code-bg text-cc-code-fg text-[11px] font-mono-code leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
              {String(input.content).slice(0, 2000)}
            </pre>
          ) : null}
        </div>
      );
    case "Glob":
      return (
        <div className="space-y-1">
          <div className="text-xs font-mono-code text-cc-code-fg">{String(input.pattern || "")}</div>
          {!!input.path && (
            <div className="text-[10px] text-cc-muted">in: <span className="font-mono-code">{String(input.path)}</span></div>
          )}
        </div>
      );
    case "Grep":
      return (
        <div className="space-y-1">
          <pre className="px-2 py-1.5 rounded bg-cc-code-bg text-cc-code-fg text-[12px] font-mono-code overflow-x-auto">
            {String(input.pattern || "")}
          </pre>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-cc-muted">
            {!!input.path && <span>path: <span className="font-mono-code">{String(input.path)}</span></span>}
            {!!input.glob && <span>glob: <span className="font-mono-code">{String(input.glob)}</span></span>}
          </div>
        </div>
      );
    default:
      return (
        <pre className="text-[11px] text-cc-muted font-mono-code whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      );
  }
}

export function ToolIcon({ type }: { type: string }) {
  const cls = "w-3.5 h-3.5 text-cc-primary shrink-0";

  if (type === "terminal") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
        <polyline points="3 11 6 8 3 5" />
        <line x1="8" y1="11" x2="13" y2="11" />
      </svg>
    );
  }
  if (type === "file" || type === "file-plus" || type === "file-edit") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
        <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
        <polyline points="9 1 9 5 13 5" />
      </svg>
    );
  }
  if (type === "search") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
        <circle cx="7" cy="7" r="4" />
        <path d="M13 13l-3-3" />
      </svg>
    );
  }
  if (type === "globe") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
        <circle cx="8" cy="8" r="6" />
        <path d="M2 8h12M8 2c2 2 3 4 3 6s-1 4-3 6c-2-2-3-4-3-6s1-4 3-6z" />
      </svg>
    );
  }
  if (type === "message") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
        <path d="M14 10a1 1 0 01-1 1H5l-3 3V3a1 1 0 011-1h10a1 1 0 011 1v7z" />
      </svg>
    );
  }
  if (type === "list") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
        <path d="M3 4h10M3 8h10M3 12h6" />
      </svg>
    );
  }
  if (type === "agent") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
        <circle cx="8" cy="5" r="3" />
        <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "checklist") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
        <path d="M3 4l1.5 1.5L7 3M3 8l1.5 1.5L7 7M3 12l1.5 1.5L7 11" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 4h4M9 8h4M9 12h4" />
      </svg>
    );
  }
  if (type === "notebook") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
        <rect x="3" y="1" width="10" height="14" rx="1" />
        <path d="M6 1v14M3 5h3M3 9h3M3 13h3" />
      </svg>
    );
  }
  // Default tool icon
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls}>
      <path d="M10.5 2.5l3 3-8 8H2.5v-3l8-8z" />
    </svg>
  );
}
