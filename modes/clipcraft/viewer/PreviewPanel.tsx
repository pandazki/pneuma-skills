// modes/clipcraft/viewer/PreviewPanel.tsx
import { PreviewCanvas } from "./PreviewCanvas.js";
import { PlaybackControls } from "./PlaybackControls.js";
import { StateDump } from "./StateDump.js";
import { Timeline } from "./timeline/Timeline.js";

export interface PreviewPanelProps {
  hydrationError: string | null;
}

/**
 * Layout shell for ClipCraft's editing surface.
 *
 *   [ PreviewCanvas      ]   ← drawn by upstream PlaybackEngine
 *   [ PlaybackControls   ]
 *   [ Timeline           ]   ← Plan 5: ruler + track rows + playhead
 *   [ StateDump (debug)  ]   ← collapsed <details>
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
      <Timeline />
      <details>
        <summary
          style={{
            cursor: "pointer",
            color: "#a1a1aa",
            fontSize: 11,
            padding: "6px 0",
          }}
        >
          debug · StateDump
        </summary>
        <StateDump hydrationError={hydrationError} />
      </details>
    </div>
  );
}
