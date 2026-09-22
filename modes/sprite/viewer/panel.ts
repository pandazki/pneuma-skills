/**
 * Which deliverable tab is worth showing — the decidable half of the panel.
 *
 * `navigate-to` moves the STAGE, and for two rounds that was all it moved:
 * an agent that had just finished a motion said "switched the stage to GIF"
 * while the panel sat on a Video tab with no clips in it, showing an empty
 * state for the thing it had just made. The agent was not lying about its
 * intent — it had no way to do what it said. So a navigation now carries the
 * panel with it, but only when the current tab has NOTHING for the motion
 * being shown: a user who deliberately opened Atlas keeps Atlas as long as
 * there is an atlas to see.
 *
 * A loop motion is a different set of deliverables from the same character —
 * no GIF, no atlas, four frontend exports instead — so it has a different
 * first tab. `panelTabs` is the one place that says which tabs a motion HAS,
 * and both the tab strip and the fallback read it, so the panel can never
 * render a tab it would refuse to select.
 */

import type { CharacterProject, Motion } from "../domain.js";

export type PanelTab = "gif" | "loop" | "video" | "atlas";

/** The formats a loop is delivered in, in the order the panel lists them. */
export type LoopFormat = "webp" | "apng" | "webm" | "lottie";

const LOOP_FORMATS: LoopFormat[] = ["webp", "apng", "webm", "lottie"];

/** The tabs this motion has, in order. The first one is its default. */
export function panelTabs(motion: Motion | null): PanelTab[] {
  return motion?.kind === "loop"
    ? ["loop", "video", "atlas"]
    : ["gif", "video", "atlas"];
}

/**
 * The tab a motion falls back to.
 *
 * It is the artefact that motion IS — the GIF for a sprite sheet, the WebP
 * loop for a loop — which is what an agent means by "look at what I made".
 * Falling back to it when it is empty too is deliberate: its empty state is
 * the true answer, and hunting for some other tab with content would move the
 * panel somewhere nobody asked for.
 */
export function defaultTab(motion: Motion | null): PanelTab {
  return motion?.kind === "loop" ? "loop" : "gif";
}

/** Does this tab have anything of this motion's to render? */
export function tabHasContent(motion: Motion | null, tab: PanelTab): boolean {
  if (!motion) return false;
  switch (tab) {
    case "video":
      return motion.videos.length > 0;
    case "atlas":
      return !!motion.sheet;
    case "loop":
      return !!(motion.webp ?? motion.exports);
    default:
      return !!(motion.gif ?? motion.webp);
  }
}

/** The tab to show after a navigation put `motion` on the stage. */
export function tabAfterNavigate(tab: PanelTab, motion: Motion | null): PanelTab {
  if (!motion) return tab;
  // A tab this motion does not have at all cannot be kept, whatever is in it:
  // a loop has no GIF tab to sit on, and a sprite motion no Loop tab.
  if (!panelTabs(motion).includes(tab)) return defaultTab(motion);
  return tabHasContent(motion, tab) ? tab : defaultTab(motion);
}

/** One downloadable loop export. */
export interface LoopExport {
  format: LoopFormat;
  assetId: string;
  /** Size in bytes as `register-run` measured it; null when unrecorded. */
  size: number | null;
}

/**
 * The exports a loop motion can be downloaded as, in list order.
 *
 * The size comes off `metadata.size`, which `register-run` reads from the file
 * itself — the panel prints it beside the link, and the viewer never fetches
 * an asset to describe it. An export whose asset the project no longer carries
 * is left out rather than offered as a broken link.
 */
export function loopExports(
  project: CharacterProject,
  motion: Motion,
): LoopExport[] {
  const ids: Record<LoopFormat, string | undefined> = {
    webp: motion.webp,
    apng: motion.exports?.apng,
    webm: motion.exports?.webm,
    lottie: motion.exports?.lottie,
  };
  const out: LoopExport[] = [];
  for (const format of LOOP_FORMATS) {
    const assetId = ids[format];
    if (!assetId) continue;
    const asset = project.assetsById.get(assetId);
    if (!asset) continue;
    const size = asset.metadata.size;
    out.push({
      format,
      assetId,
      size: typeof size === "number" && Number.isFinite(size) ? size : null,
    });
  }
  return out;
}
