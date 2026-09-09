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
 */

import type { Motion } from "../domain.js";

export type PanelTab = "gif" | "video" | "atlas";

/** Does this tab have anything of this motion's to render? */
export function tabHasContent(motion: Motion | null, tab: PanelTab): boolean {
  if (!motion) return false;
  switch (tab) {
    case "video":
      return motion.videos.length > 0;
    case "atlas":
      return !!motion.sheet;
    default:
      return !!(motion.gif ?? motion.webp);
  }
}

/**
 * The tab to show after a navigation put `motion` on the stage.
 *
 * GIF is the fallback because it is the motion AS A MOTION — the artefact a
 * finished run always produces and the one an agent means by "look at what I
 * made". Falling back to it when it is empty too is deliberate: its empty
 * state ("no preview rendered yet") is the true answer, and hunting for some
 * other tab with content would move the panel somewhere nobody asked for.
 */
export function tabAfterNavigate(tab: PanelTab, motion: Motion | null): PanelTab {
  if (!motion) return tab;
  return tabHasContent(motion, tab) ? tab : "gif";
}
