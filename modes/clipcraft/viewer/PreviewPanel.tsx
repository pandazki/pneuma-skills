import { ClipCraftLayout } from "./layout/ClipCraftLayout.js";
import { StateDump } from "./StateDump.js";
import type { CaptionStyle } from "../persistence.js";

export interface PreviewPanelProps {
  hydrationError: string | null;
  captionStyle?: CaptionStyle;
}

/**
 * Plan 6 layout shell. VideoPreview + Timeline + AssetPanel are owned by
 * ClipCraftLayout; PreviewPanel is a thin shim that keeps the debug
 * StateDump accessible behind a collapsed details element.
 */
export function PreviewPanel({ hydrationError, captionStyle }: PreviewPanelProps) {
  return (
    <div
      className="cc-preview-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#09090b",
        color: "#e4e4e7",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <ClipCraftLayout captionStyle={captionStyle} />
      </div>
      <details style={{ borderTop: "1px solid #27272a", padding: "4px 12px" }}>
        <summary style={{ cursor: "pointer", color: "#a1a1aa", fontSize: 11 }}>
          debug · StateDump
        </summary>
        <StateDump hydrationError={hydrationError} />
      </details>
    </div>
  );
}
