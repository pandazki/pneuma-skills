import { useRef, useEffect } from "react";

export interface SlashMenuItem {
  name: string;
  kind: "skill" | "command";
}

interface SlashMenuProps {
  items: SlashMenuItem[];
  selectedIndex: number;
  onSelect: (item: SlashMenuItem) => void;
}

export default function SlashMenu({ items, selectedIndex, onSelect }: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 mb-1 w-64 max-h-48 overflow-y-auto bg-neutral-800 border border-neutral-700 rounded-md shadow-lg z-50"
    >
      {items.map((item, i) => (
        <button
          key={item.name}
          onMouseDown={(e) => {
            e.preventDefault(); // prevent textarea blur
            onSelect(item);
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
            i === selectedIndex
              ? "bg-neutral-700 text-neutral-100"
              : "text-neutral-400 hover:bg-neutral-750 hover:text-neutral-200"
          }`}
        >
          <span className="w-4 h-4 flex items-center justify-center text-neutral-500 shrink-0">
            {item.kind === "skill" ? (
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z" />
              </svg>
            ) : (
              <span className="text-[11px] font-bold">/</span>
            )}
          </span>
          <span className="truncate">/{item.name}</span>
        </button>
      ))}
    </div>
  );
}
