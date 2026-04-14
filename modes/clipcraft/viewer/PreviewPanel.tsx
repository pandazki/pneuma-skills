import { ClipCraftLayout } from "./layout/ClipCraftLayout.js";
import { StateDump } from "./StateDump.js";
import type { CaptionStyle } from "../persistence.js";
import { theme } from "./theme/tokens.js";

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
        background: theme.color.surface0,
        color: theme.color.ink1,
        fontFamily: theme.font.ui,
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <ClipCraftLayout captionStyle={captionStyle} />
      </div>
      <details
        style={{
          borderTop: `1px solid ${theme.color.borderWeak}`,
          padding: `${theme.space.space1}px ${theme.space.space4}px`,
          background: theme.color.surface1,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            color: theme.color.ink3,
            fontFamily: theme.font.ui,
            fontSize: theme.text.xs,
            letterSpacing: theme.text.trackingCaps,
            textTransform: "uppercase",
            fontWeight: theme.text.weightSemibold,
          }}
        >
          Debug · State dump
        </summary>
        <StateDump hydrationError={hydrationError} />
      </details>
    </div>
  );
}
