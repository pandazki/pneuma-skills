import { useMemo } from "react";
import * as Diff from "diff";

interface DiffLine {
  type: "add" | "del" | "context" | "hunk-header";
  content: string;
  oldNum?: number;
  newNum?: number;
  wordHighlights?: { value: string; added?: boolean; removed?: boolean }[];
}

function parseUnifiedDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split("\n")) {
    // Skip diff headers
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)?$/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      lines.push({ type: "hunk-header", content: line });
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ type: "add", content: line.slice(1), newNum: newLine++ });
    } else if (line.startsWith("-")) {
      lines.push({ type: "del", content: line.slice(1), oldNum: oldLine++ });
    } else if (line.startsWith(" ")) {
      lines.push({ type: "context", content: line.slice(1), oldNum: oldLine++, newNum: newLine++ });
    }
  }

  // Add word-level highlights for adjacent del/add pairs
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].type === "del" && lines[i + 1].type === "add") {
      const wordDiff = Diff.diffWords(lines[i].content, lines[i + 1].content);
      lines[i].wordHighlights = wordDiff.map(({ value, added, removed }) => ({ value, added, removed }));
      lines[i + 1].wordHighlights = wordDiff.map(({ value, added, removed }) => ({ value, added, removed }));
    }
  }

  return lines;
}

function LineContent({ line }: { line: DiffLine }) {
  if (!line.wordHighlights) {
    return <span>{line.content || "\u00A0"}</span>;
  }

  return (
    <span>
      {line.wordHighlights.map((part, i) => {
        if (line.type === "del") {
          if (part.added) return null;
          return (
            <span key={i} className={part.removed ? "bg-red-800/60 rounded-sm" : ""}>
              {part.value}
            </span>
          );
        }
        if (line.type === "add") {
          if (part.removed) return null;
          return (
            <span key={i} className={part.added ? "bg-green-800/60 rounded-sm" : ""}>
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </span>
  );
}

export default function DiffViewer({ diff }: { diff: string }) {
  const lines = useMemo(() => parseUnifiedDiff(diff), [diff]);

  if (!diff.trim()) {
    return (
      <div className="flex items-center justify-center h-full text-cc-muted/60 text-sm">
        No changes
      </div>
    );
  }

  if (diff.includes("Binary files") && diff.includes("differ")) {
    return (
      <div className="flex items-center justify-center h-full text-cc-muted text-sm">
        Binary file — diff not available
      </div>
    );
  }

  return (
    <div className="overflow-auto h-full font-mono text-xs leading-5">
      {lines.map((line, i) => {
        if (line.type === "hunk-header") {
          return (
            <div key={i} className="px-3 py-1 bg-blue-900/20 text-blue-400 border-y border-cc-border select-none">
              {line.content}
            </div>
          );
        }
        const bg =
          line.type === "add"
            ? "bg-green-950/40"
            : line.type === "del"
              ? "bg-red-950/40"
              : "";
        const textColor =
          line.type === "add"
            ? "text-green-300"
            : line.type === "del"
              ? "text-red-300"
              : "text-cc-fg/80";

        return (
          <div key={i} className={`flex ${bg} hover:brightness-125`}>
            <span className="w-12 shrink-0 text-right pr-2 text-cc-muted/60 select-none border-r border-cc-border">
              {line.oldNum ?? ""}
            </span>
            <span className="w-12 shrink-0 text-right pr-2 text-cc-muted/60 select-none border-r border-cc-border">
              {line.newNum ?? ""}
            </span>
            <span className="w-5 shrink-0 text-center select-none text-cc-muted/60">
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </span>
            <span className={`flex-1 pr-4 whitespace-pre ${textColor}`}>
              <LineContent line={line} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
