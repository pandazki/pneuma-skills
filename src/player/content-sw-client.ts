// src/player/content-sw-client.ts
//
// Client side of the player's content service worker. The SW intercepts
// same-origin `/content/*` and `/api/file` requests (the asset fetches that
// iframe-based viewers make) and resolves them against the active checkpoint's
// blob manifest, fetched from the play package on R2. This module registers the
// SW and pushes the active checkpoint's path→blob map to it.
//
// Safe no-op when service workers are unavailable (the engine still feeds text
// files through the store; only binary /content assets degrade).

import type { PlayFileEntry } from "../../core/types/play-package";

export interface ContentCheckpointMessage {
  type: "pneuma-player-checkout";
  /** Base URL of the play package (where blobs/<sha> live). */
  baseUrl: string;
  /** path → blob sha for every file at the active checkpoint. */
  files: Record<string, string>;
}

let registered = false;
let lastMessage: ContentCheckpointMessage | null = null;

/** Register the content service worker and wait until it controls the page.
 *  Call once at player startup, BEFORE the first checkpoint checkout — otherwise
 *  the initial `/content/*` asset fetches race ahead of SW control and 404. */
export async function registerContentServiceWorker(swUrl = "/player-content-sw.js"): Promise<void> {
  if (registered || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  registered = true;
  try {
    await navigator.serviceWorker.register(swUrl, { scope: "/" });
    await navigator.serviceWorker.ready;

    // On a first-ever load the SW activates but does not control this client
    // until it claims it (controllerchange). Wait for that — with a timeout so
    // a stuck registration degrades to network rather than hanging the player.
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2500);
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }

    // Re-push the active checkpoint map whenever control changes (e.g. SW update).
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (lastMessage) navigator.serviceWorker.controller?.postMessage(lastMessage);
    });
    if (lastMessage) navigator.serviceWorker.controller?.postMessage(lastMessage);
  } catch (err) {
    console.warn("[player] content service worker registration failed:", err);
  }
}

/** Push the active checkpoint's file map to the service worker. */
export function notifyContentLayer(baseUrl: string, files: PlayFileEntry[]): void {
  const map: Record<string, string> = {};
  for (const f of files) map[f.path] = f.blob;
  const message: ContentCheckpointMessage = { type: "pneuma-player-checkout", baseUrl, files: map };
  lastMessage = message;
  if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage(message);
  }
}
