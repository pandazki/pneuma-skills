/**
 * Pure helper that decides what should happen when the user clicks a
 * panel slice inside a storyboard composite. The decision depends on
 * whether the panel exists in the asset registry and whether it is
 * currently placed on the timeline:
 *
 *   - "placed":       on the timeline → seek the playhead + select.
 *   - "registered":   in assets[] but no previewFrame → select only.
 *   - "unregistered": file exists but never made it into project.json
 *                     → toast prompt to ask the agent to register.
 *
 * Splitting this from the React component keeps the click logic
 * trivially testable and side-effect-free.
 */

type Status =
  | { kind: "placed"; assetId: string; trackId: string; time: number }
  | { kind: "registered"; assetId: string }
  | { kind: "unregistered"; panelPath: string };

interface Inputs {
  panelPath: string;
  panelAssetId?: string;
  assets: ReadonlyArray<{ id: string; uri: string }>;
  previewFrames: ReadonlyArray<{
    id: string;
    trackId: string;
    time: number;
    assetId: string;
  }>;
}

export function computePanelStatus(inputs: Inputs): Status {
  const { panelPath, panelAssetId, assets, previewFrames } = inputs;

  // Prefer matching by the explicit assetId hint from stdout.json,
  // but fall back to a URI match — the agent might register the
  // panel under a different id than the storyboard generator
  // suggested.
  const assetMatch =
    (panelAssetId ? assets.find((a) => a.id === panelAssetId) : undefined) ??
    assets.find((a) => a.uri === panelPath);

  if (!assetMatch) return { kind: "unregistered", panelPath };

  const pf = previewFrames.find((p) => p.assetId === assetMatch.id);
  if (pf) {
    return {
      kind: "placed",
      assetId: assetMatch.id,
      trackId: pf.trackId,
      time: pf.time,
    };
  }
  return { kind: "registered", assetId: assetMatch.id };
}

export type { Status as PanelStatus };
