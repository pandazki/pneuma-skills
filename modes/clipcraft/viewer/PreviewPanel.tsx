// modes/clipcraft/viewer/PreviewPanel.tsx
import { PreviewCanvas } from "./PreviewCanvas.js";
import { PlaybackControls } from "./PlaybackControls.js";
import { StateDump } from "./StateDump.js";

export interface PreviewPanelProps {
  hydrationError: string | null;
}

/**
 * Layout shell for ClipCraft's editing surface.
 *
 *   [ PreviewCanvas      ]   ← drawn by upstream PlaybackEngine
 *   [ PlaybackControls   ]
 *   [ StateDump (debug)  ]
 *
 * StateDump survives Plan 4 as a debug pane until the real timeline /
 * inspector lands in Plan 5+. It's not collapsible yet — that's noise
 * not worth the code right now.
 */
export function PreviewPanel({ hydrationError }: PreviewPanelProps) {
  return (
    <div
      className="cc-preview-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        padding: 12,
        background: "#09090b",
        color: "#e4e4e7",
        overflow: "auto",
      }}
    >
      <PreviewCanvas />
      <PlaybackControls />
      <div style={{ marginTop: 12, opacity: 0.85 }}>
        <StateDump hydrationError={hydrationError} />
      </div>
    </div>
  );
}
