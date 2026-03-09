import { useState, useRef, useEffect } from "react";

interface SelectorItem {
  id: string;
  label: string;
}

interface ContentSetSelectorProps {
  items: SelectorItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  icon?: "folder" | "file";
  unread?: Set<string>;
}

export default function ContentSetSelector({ items, activeId, onSelect, icon = "folder", unread }: ContentSetSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeLabel = items.find((item) => item.id === activeId)?.label || "Select";
  const hasUnread = unread && unread.size > 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center gap-1.5 px-2 py-1 text-xs font-medium
          rounded-md text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
      >
        {icon === "folder" ? <FolderIcon /> : <FileIcon />}
        <span>{activeLabel}</span>
        {hasUnread && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cc-primary
            shadow-[0_0_6px_rgba(249,115,22,0.6)] animate-pulse" />
        )}
        <svg
          className={`w-3 h-3 text-cc-muted transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 min-w-[180px] z-50
            bg-cc-surface border border-cc-border rounded-md shadow-lg overflow-hidden"
        >
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => { onSelect(item.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2
                hover:bg-cc-hover transition-colors cursor-pointer
                ${item.id === activeId ? "bg-cc-primary/15 text-cc-fg" : "text-cc-muted"}`}
            >
              <span className="flex-1">{item.label}</span>
              {unread?.has(item.id) && (
                <span className="w-1.5 h-1.5 rounded-full bg-cc-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-cc-muted">
      <path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6.5a1 1 0 00-1-1H8L6.5 4H3a1 1 0 00-1 .5z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-cc-muted">
      <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M9 2v4h4" />
    </svg>
  );
}
