/**
 * Catalog install progress — a standalone store for "this mode is being
 * downloaded right now".
 *
 * Standalone on purpose: `src/store/index.ts` is the SESSION store, created
 * per mode window and wired to a WebSocket. Catalog installs belong to the
 * launcher, which has no session, and the progress has to stay visible while
 * the user moves between the Quick Start grid, the gallery overlay and the
 * Mode Maker hero — three subtrees with no common parent below `Launcher`.
 * A store keeps one record per mode name instead of three copies of the same
 * stream.
 *
 * Protocol (`POST /api/catalog/install`, newline-delimited JSON):
 *   {"event":"progress","received":N,"total":N}   zero or more
 *   {"event":"done","version":"…"}                exactly one terminal event…
 *   {"event":"error","message":"…"}               …or this one
 *
 * A stream that ends without a terminal event is an error, not a success:
 * the installer writes its completion record last (proposal D8), so "the
 * connection stopped" tells us nothing about what landed on disk. We say so
 * and let the user retry — a retry is safe because the installer only
 * publishes a directory after the archive verifies.
 */

import { create } from "zustand";
import { getApiBase } from "../utils/api.js";

export type CatalogInstallPhase = "installing" | "done" | "error";

export interface CatalogInstall {
  phase: CatalogInstallPhase;
  /** Archive bytes received so far. */
  received: number;
  /** Archive bytes expected, from the stream. 0 until the server says. */
  total: number;
  /** The reason the server gave, shown verbatim to the user. */
  error?: string;
  /** Installed mode version, from the `done` event. */
  version?: string;
}

interface CatalogInstallStore {
  installs: Record<string, CatalogInstall>;
  /**
   * Download and install a catalog mode. Resolves `true` only on an explicit
   * `done` event. Concurrent callers for the same mode share one request.
   */
  install: (name: string) => Promise<boolean>;
  /** Drop a finished/failed record so the card returns to its resting state. */
  clear: (name: string) => void;
}

/**
 * In-flight requests, keyed by mode name. Lives outside the store because it
 * holds promises, not renderable state: the Quick Start tile and the gallery
 * card can both call `install("backlot")` and must join the same download
 * rather than start a second one.
 */
const inflight = new Map<string, Promise<boolean>>();

/** Human-readable byte size for card copy — `19.9 MB`, `712 KB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 0–100, or null while the server has not announced a total yet. */
export function installPercent(install: CatalogInstall | undefined): number | null {
  if (!install || install.total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((install.received / install.total) * 100)));
}

export const useCatalogInstallStore = create<CatalogInstallStore>()((set, get) => {
  const patch = (name: string, next: Partial<CatalogInstall>) => {
    set((state) => {
      const prev = state.installs[name] ?? { phase: "installing" as const, received: 0, total: 0 };
      return { installs: { ...state.installs, [name]: { ...prev, ...next } } };
    });
  };

  const run = async (name: string): Promise<boolean> => {
    patch(name, { phase: "installing", received: 0, total: 0, error: undefined, version: undefined });
    try {
      const res = await fetch(`${getApiBase()}/api/catalog/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok || !res.body) {
        // Read whatever the server said — a JSON `{error}` body, plain text,
        // or nothing at all. Never invent a friendlier message than the truth.
        let detail = "";
        try {
          const text = (await res.text()).trim();
          if (text.startsWith("{")) {
            const parsed = JSON.parse(text) as { error?: string; message?: string };
            detail = parsed.error || parsed.message || "";
          } else if (text && text.length <= 300 && !text.startsWith("<")) {
            detail = text;
          }
        } catch { /* body already consumed or not text — fall back to status */ }
        patch(name, { phase: "error", error: detail || `HTTP ${res.status} ${res.statusText}`.trim() });
        return false;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let terminal: "done" | "error" | null = null;

      const handleLine = (line: string) => {
        let event: { event?: string; received?: number; total?: number; message?: string; version?: string };
        try {
          event = JSON.parse(line);
        } catch {
          return; // a line we cannot read is not a result — wait for the terminal event
        }
        if (event.event === "progress") {
          patch(name, {
            phase: "installing",
            received: typeof event.received === "number" ? event.received : 0,
            total: typeof event.total === "number" ? event.total : 0,
          });
        } else if (event.event === "done") {
          terminal = "done";
          patch(name, { phase: "done", version: event.version, error: undefined });
        } else if (event.event === "error") {
          terminal = "error";
          patch(name, { phase: "error", error: event.message || "" });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let cut = buffered.indexOf("\n");
        while (cut >= 0) {
          const line = buffered.slice(0, cut).trim();
          buffered = buffered.slice(cut + 1);
          if (line) handleLine(line);
          cut = buffered.indexOf("\n");
        }
      }
      buffered += decoder.decode();
      const tail = buffered.trim();
      if (tail) handleLine(tail);

      if (terminal === "done") return true;
      if (terminal === "error") return false;
      patch(name, {
        phase: "error",
        error: get().installs[name]?.error || "The download ended before the install finished.",
      });
      return false;
    } catch (err) {
      patch(name, { phase: "error", error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  };

  return {
    installs: {},
    install: (name: string) => {
      const existing = inflight.get(name);
      if (existing) return existing;
      const promise = run(name).finally(() => inflight.delete(name));
      inflight.set(name, promise);
      return promise;
    },
    clear: (name: string) =>
      set((state) => {
        if (!state.installs[name]) return state;
        const next = { ...state.installs };
        delete next[name];
        return { installs: next };
      }),
  };
});
