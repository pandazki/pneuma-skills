/** Session-owned production viewer build state. Retrying never restarts the agent. */
export type ModeViewerBuildState =
  | { status: "building" }
  | { status: "failed"; error: string }
  | { status: "ready"; revision: string; stylesheets: string[] };

/** GET /api/mode-info. Dev-mode externals do not have a production build state. */
export type ModeInfo =
  | { external: false }
  | {
      external: true;
      name: string;
      path: string;
      type: string;
      viewerBuild?: ModeViewerBuildState;
    };

/** Entry assets share one URL contract; revisions bypass cached failed imports. */
export function modeViewerAssetUrl(file: string, revision?: string): string {
  return `/mode-assets/${encodeURIComponent(file)}${revision ? `?v=${encodeURIComponent(revision)}` : ""}`;
}
