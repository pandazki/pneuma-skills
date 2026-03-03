/**
 * File Classifier — categorize mode package files and detect language for syntax highlighting.
 */

export type FileCategory = "manifest" | "mode-def" | "viewer" | "skill" | "seed" | "other";

/** Classify a file path into its role within a mode package */
export function classifyFile(path: string): FileCategory {
  if (path === "manifest.ts" || path === "manifest.js") return "manifest";
  if (path === "pneuma-mode.ts" || path === "pneuma-mode.js") return "mode-def";
  if (path.startsWith("viewer/")) return "viewer";
  if (path.startsWith("skill/")) return "skill";
  if (path.startsWith("seed/")) return "seed";
  return "other";
}

/** Detect CodeMirror language extension name from file extension */
export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "html":
      return "html";
    case "css":
      return "css";
    case "json":
    case "excalidraw":
      return "json";
    case "md":
      return "markdown";
    default:
      return "text";
  }
}
