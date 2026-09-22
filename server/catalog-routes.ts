/**
 * Catalog routes — `/api/catalog` and `/api/catalog/install`.
 *
 * The browser's view of the bundled/catalog split: which first-party modes
 * this release does not ship, what they cost to download, whether they are
 * already on disk, and a stream to install one.
 *
 * Launcher-scope, like libraries: a per-session server already has its mode.
 *
 * Install is a stream, not a request/response, because the user is waiting
 * on megabytes and has to be able to see why it stopped. The body is
 * newline-delimited JSON, one object per line:
 *
 *   {"event":"progress","received":1048576,"total":6391234}
 *   …
 *   {"event":"done","version":"0.2.1"}
 *   {"event":"error","message":"…","code":"checksum-mismatch"}
 *
 * Exactly one terminal event (`done` or `error`) ends every stream. The
 * status line is 200 as soon as streaming starts, so failures after that
 * point are reported in the body — a consumer must read to the terminal
 * event rather than trusting the status. Closing the connection aborts the
 * download (`core/mode-catalog.ts` leaves nothing behind).
 *
 * Design: docs/proposals/2026-09-22-mode-distribution.md (D5, D8)
 */

import type { Hono } from "hono";

import {
  ensureCatalogMode,
  getCatalogEntry,
  installState,
  listCatalogModes,
  readModeCatalog,
  ModeInstallError,
  type CatalogEnv,
} from "../core/mode-catalog.js";
import {
  MODE_CATALOG_FORMAT,
  type ModeCatalogEntry,
  type ModeInstallState,
} from "../core/types/mode-catalog.js";

/** One catalog card's data: the packaged entry plus this machine's state. */
export interface CatalogRouteEntry extends ModeCatalogEntry {
  state: ModeInstallState;
  /**
   * True when the mode's source is in the package (a repo checkout). Such a
   * mode never needs a download; `state` is already `installed`.
   */
  inTree: boolean;
}

export interface CatalogRouteResponse {
  /**
   * False in a repo checkout, where `modes/catalog.json` is not generated
   * and every mode runs from source. `modes` is then empty — the registry
   * route lists those modes instead.
   */
  available: boolean;
  formatVersion: number;
  /** The release that built every archive in `modes`. */
  coreVersion: string;
  generatedAt: string;
  modes: CatalogRouteEntry[];
}

export interface RegisterCatalogRoutesOptions extends CatalogEnv {
  /** Package root — the directory containing `modes/`. */
  projectRoot: string;
  /**
   * Called after a successful install so caches that describe which modes
   * are available (the launcher registry) can be dropped on the same tick.
   */
  onInstalled?: (name: string) => void;
}

/** Emit at most one progress line per this many bytes or milliseconds. */
const PROGRESS_BYTES = 256 * 1024;
const PROGRESS_MS = 120;

export function registerCatalogRoutes(
  app: Hono,
  options: RegisterCatalogRoutesOptions,
): void {
  const env: CatalogEnv = {
    projectRoot: options.projectRoot,
    ...(options.home ? { home: options.home } : {}),
  };

  app.get("/api/catalog", (c) => {
    const catalog = readModeCatalog(env);
    if (!catalog) {
      return c.json<CatalogRouteResponse>({
        available: false,
        formatVersion: MODE_CATALOG_FORMAT,
        coreVersion: "",
        generatedAt: "",
        modes: [],
      });
    }
    return c.json<CatalogRouteResponse>({
      available: true,
      formatVersion: catalog.formatVersion,
      coreVersion: catalog.coreVersion,
      generatedAt: catalog.generatedAt,
      // Same call the launcher registry makes, so the two cannot disagree
      // about what is installed.
      modes: listCatalogModes(env),
    });
  });

  app.post("/api/catalog/install", async (c) => {
    let name: string;
    try {
      const body = await c.req.json<{ name?: unknown }>();
      if (typeof body?.name !== "string" || body.name.length === 0) {
        return c.json({ error: "name is required" }, 400);
      }
      name = body.name;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const entry = getCatalogEntry(name, env);
    const total = entry?.archive.size ?? 0;
    // The caller's connection owns the download: closing the tab stops it.
    const signal = c.req.raw.signal;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (obj: Record<string, unknown>) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
          } catch {
            // Consumer went away mid-write; the abort signal ends the install.
            closed = true;
          }
        };

        let lastBytes = 0;
        let lastAt = 0;
        try {
          const resolved = await ensureCatalogMode(name, {
            ...env,
            signal,
            onProgress: ({ received, total: size }) => {
              const now = Date.now();
              if (
                received - lastBytes < PROGRESS_BYTES &&
                now - lastAt < PROGRESS_MS &&
                received !== size
              ) {
                return;
              }
              lastBytes = received;
              lastAt = now;
              send({ event: "progress", received, total: size });
            },
          });
          // An in-tree or already-installed mode streams no progress at
          // all; `done` is still the terminal event, so the client's code
          // path does not change.
          if (lastAt === 0 && total > 0) {
            send({ event: "progress", received: total, total });
          }
          options.onInstalled?.(name);
          send({
            event: "done",
            version: entry?.version ?? "",
            source: resolved.source,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          send({
            event: "error",
            message,
            ...(err instanceof ModeInstallError
              ? { code: err.code, ...(err.url ? { url: err.url } : {}) }
              : {}),
          });
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed by the consumer */
          }
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        // Progress that arrives in one lump at the end is not progress.
        "x-accel-buffering": "no",
      },
    });
  });
}
