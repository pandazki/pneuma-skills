import { useCallback, useEffect, useRef, useState } from "react";
import type { Composition } from "@pneuma-craft/timeline";
import { createExportEngine } from "@pneuma-craft/video";
import type { SubtitleRenderer } from "@pneuma-craft/video";
import type { WorkspaceAssetResolver } from "../assetResolver.js";

export type ExportStatus =
  | "idle"
  | "preparing"
  | "exporting"
  | "done"
  | "error";

export interface ExportState {
  status: ExportStatus;
  /** 0..1 progress, provided by the craft export engine. */
  progress: number;
  /** Browser blob URL to download the finished MP4. Revoked on dismiss. */
  downloadUrl: string | null;
  error: string | null;
  /** Suggested filename for the download anchor. */
  filename: string | null;
  /** Bytes in the rendered file, for the UI status line. */
  byteSize: number | null;
}

const DEFAULT_OPTIONS = {
  format: "mp4" as const,
  videoCodec: "avc" as const,
  audioCodec: "aac" as const,
  // Sensible defaults for short AIGC clips. 8 Mbps @ 1080p reads clean on
  // modern hardware without bloating the file size. The craft engine will
  // infer fps/width/height from the composition settings if omitted.
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
};

const INITIAL: ExportState = {
  status: "idle",
  progress: 0,
  downloadUrl: null,
  error: null,
  filename: null,
  byteSize: null,
};

export interface UseExportVideoResult {
  state: ExportState;
  /** Start an export. No-op if one is already running. Accepts an optional
   *  title for the download filename. */
  start: (title?: string) => Promise<void>;
  /** Abort a running export and reset to idle. */
  abort: () => void;
  /** Clear a finished export's state and revoke the blob URL. */
  dismiss: () => void;
}

export function useExportVideo(
  composition: Composition | null,
  resolver: WorkspaceAssetResolver,
  subtitleRenderer?: SubtitleRenderer,
): UseExportVideoResult {
  const [state, setState] = useState<ExportState>(INITIAL);
  const engineRef = useRef<ReturnType<typeof createExportEngine> | null>(null);
  const urlRef = useRef<string | null>(null);

  const revokeUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // Release any in-flight engine + blob url on unmount.
  useEffect(
    () => () => {
      engineRef.current?.abort();
      engineRef.current = null;
      revokeUrl();
    },
    [revokeUrl],
  );

  const start = useCallback(
    async (title?: string) => {
      if (!composition) {
        setState({
          ...INITIAL,
          status: "error",
          error: "No composition loaded",
        });
        return;
      }
      if (engineRef.current) return; // already running

      revokeUrl();
      setState({
        status: "preparing",
        progress: 0,
        downloadUrl: null,
        error: null,
        filename: null,
        byteSize: null,
      });

      const engine = createExportEngine({ subtitleRenderer });
      engineRef.current = engine;
      const offProgress = engine.onProgress((p) => {
        setState((s) => ({
          ...s,
          status: "exporting",
          progress: Math.max(0, Math.min(1, p)),
        }));
      });

      try {
        const blob = await engine.export(
          composition,
          DEFAULT_OPTIONS,
          resolver,
        );
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const safeTitle = (title ?? "clipcraft-export")
          .toLowerCase()
          .replace(/[^\w.-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "clipcraft-export";
        const stamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[:T]/g, "-");
        const filename = `${safeTitle}-${stamp}.mp4`;
        setState({
          status: "done",
          progress: 1,
          downloadUrl: url,
          error: null,
          filename,
          byteSize: blob.size,
        });
      } catch (err) {
        setState({
          status: "error",
          progress: 0,
          downloadUrl: null,
          error: err instanceof Error ? err.message : String(err),
          filename: null,
          byteSize: null,
        });
      } finally {
        offProgress();
        engineRef.current = null;
      }
    },
    [composition, resolver, revokeUrl, subtitleRenderer],
  );

  const abort = useCallback(() => {
    engineRef.current?.abort();
    engineRef.current = null;
    revokeUrl();
    setState(INITIAL);
  }, [revokeUrl]);

  const dismiss = useCallback(() => {
    revokeUrl();
    setState(INITIAL);
  }, [revokeUrl]);

  return { state, start, abort, dismiss };
}
