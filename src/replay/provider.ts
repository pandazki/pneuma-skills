// src/replay/provider.ts
//
// Replay data is read through one of two providers so the same playback engine
// drives both the local server-backed replay (`--replay`, Bun serves
// /api/replay/*) and the hosted static player (a materialized play package
// fetched directly from R2/CF-Pages, no backend).

import { getApiBase } from "../utils/api";
import { notifyContentLayer } from "../player/content-sw-client";
import type { SharedHistoryPackage } from "../../core/types/shared-history";
import type { CheckpointManifest, PlayPackageIndex } from "../../core/types/play-package";

export interface ReplayLoadResult {
  manifest: SharedHistoryPackage;
  messages: any[];
  /** Present only for static packages: the local-client badge target + supported flag. */
  index?: PlayPackageIndex;
}

export interface ReplayCheckoutResult {
  files: { path: string; content: string }[];
}

export interface ReplayDataProvider {
  load(): Promise<ReplayLoadResult>;
  checkout(hash: string): Promise<ReplayCheckoutResult>;
}

/** File extensions whose blobs are fed into the viewer's source layer as text.
 *  Everything else (images, fonts, audio, video) is binary and is served only
 *  through the `/content/*` service worker, never loaded into the store. */
const TEXT_EXTENSIONS = new Set([
  "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "json", "jsonl", "md", "markdown", "txt", "xml", "svg",
  "yaml", "yml", "csv", "tsv", "excalidraw", "drawio", "mmd",
]);

function isTextPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/** Fetch just the play.json index (mode, supported flag, importUrl) so the
 *  shell can choose between mounting the viewer and the local-client fallback
 *  before doing any heavier work. */
export async function fetchPlayIndex(baseUrl: string): Promise<PlayPackageIndex> {
  const base = baseUrl.replace(/\/$/, "");
  return (await (await fetch(`${base}/play.json`)).json()) as PlayPackageIndex;
}

/** Server-backed provider — talks to the running Bun server's /api/replay/* routes. */
export class ServerReplayProvider implements ReplayDataProvider {
  constructor(private readonly packagePath: string) {}

  async load(): Promise<ReplayLoadResult> {
    const base = getApiBase();
    const loadResp = await fetch(`${base}/api/replay/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: this.packagePath }),
    });
    const loadData = await loadResp.json();
    if (loadData.error) throw new Error(loadData.error);
    const msgsResp = await fetch(`${base}/api/replay/messages`);
    const msgsData = await msgsResp.json();
    return { manifest: loadData.manifest, messages: msgsData.messages };
  }

  async checkout(hash: string): Promise<ReplayCheckoutResult> {
    const resp = await fetch(`${getApiBase()}/api/replay/checkout/${hash}`, { method: "POST" });
    const data = await resp.json();
    return { files: data.files ?? [] };
  }
}

/** Static provider — reads a materialized play package straight from its base URL. */
export class StaticPackageProvider implements ReplayDataProvider {
  /** Absolute base URL of the package directory, e.g. https://r2/plays/<id>. */
  private readonly base: string;
  index: PlayPackageIndex | null = null;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  async load(): Promise<ReplayLoadResult> {
    const index = (await (await fetch(`${this.base}/play.json`)).json()) as PlayPackageIndex;
    this.index = index;
    const jsonl = await (await fetch(`${this.base}/messages.jsonl`)).text();
    const messages = jsonl
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    return { manifest: index.manifest, messages, index };
  }

  async checkout(hash: string): Promise<ReplayCheckoutResult> {
    const cp = (await (await fetch(`${this.base}/checkpoints/${hash}.json`)).json()) as CheckpointManifest;

    // Hand the full path→blob map (text + binary) to the content service worker
    // so iframe/viewer fetches under /content/* resolve to this checkpoint.
    notifyContentLayer(this.base, cp.files);

    // Feed only text files into the store's source layer.
    const textFiles = cp.files.filter((f) => isTextPath(f.path) && f.size < 5_000_000);
    const files = await Promise.all(
      textFiles.map(async (f) => ({
        path: f.path,
        content: await (await fetch(`${this.base}/blobs/${f.blob}`)).text(),
      })),
    );
    return { files };
  }
}
