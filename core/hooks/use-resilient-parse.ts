/**
 * useResilientParse — shared hook for parsing workspace data files with fallback.
 *
 * Keeps the last successfully parsed result when a parse error occurs
 * (e.g. agent writes invalid JSON), so the viewer doesn't blank out.
 * Notifies the agent when a previously working file breaks.
 *
 * Usage in any mode viewer:
 *
 *   const manifest = useResilientParse(files, (files) => {
 *     const mf = files.find(f => f.path.endsWith("manifest.json"));
 *     if (!mf) return { data: null };
 *     return JSON.parse(mf.content); // throw on error is fine
 *   }, onNotifyAgent);
 */

import { useRef, useMemo } from "react";
import type { ViewerFileContent, ViewerNotification } from "../types/viewer-contract.js";

export interface ParseResult<T> {
  data: T | null;
  /** File path that was parsed (for error reporting) */
  file?: string;
}

/**
 * Parse workspace files with automatic fallback and agent notification.
 *
 * @param files - Current workspace files from ViewerPreviewProps
 * @param parseFn - Parse function that returns `{ data, file? }`.
 *                  May throw on parse errors (caught internally).
 * @param onNotifyAgent - Optional callback to notify agent of errors
 * @returns The latest valid parse result, or null if never successfully parsed
 */
export function useResilientParse<T>(
  files: ViewerFileContent[],
  parseFn: (files: ViewerFileContent[]) => ParseResult<T>,
  onNotifyAgent?: (notification: ViewerNotification) => void,
): T | null {
  const lastValid = useRef<T | null>(null);
  const hasNotifiedError = useRef(false);

  return useMemo(() => {
    let result: ParseResult<T>;
    let error: string | undefined;

    try {
      result = parseFn(files);
    } catch (e: any) {
      error = e?.message || "Parse error";
      result = { data: null, file: undefined };
    }

    // Success — update last valid, reset error state
    if (result.data != null) {
      lastValid.current = result.data;
      hasNotifiedError.current = false;
      return result.data;
    }

    // No data but no error either (e.g. file not found) — normal empty state
    if (!error) {
      return lastValid.current;
    }

    // Error + had a working version before = agent broke it → notify
    if (lastValid.current && !hasNotifiedError.current) {
      hasNotifiedError.current = true;
      const fileName = result.file || "data file";
      onNotifyAgent?.({
        type: "parseError",
        severity: "warning",
        message: [
          `<viewer-notification type="parseError">`,
          `${fileName} is broken: ${error}`,
          ``,
          `The viewer is showing stale content. Please read the file and fix the syntax error.`,
          `</viewer-notification>`,
        ].join("\n"),
        summary: `${fileName} broken after edit`,
      });
    }

    return lastValid.current;
  }, [files, parseFn, onNotifyAgent]);
}
