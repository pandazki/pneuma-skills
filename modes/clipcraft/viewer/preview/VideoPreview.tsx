import { PreviewRoot, useComposition } from "@pneuma-craft/react";
import { CaptionOverlay } from "./CaptionOverlay.js";
import type { CaptionStyle } from "../../persistence.js";
import { theme } from "../theme/tokens.js";

export interface VideoPreviewProps {
  captionStyle?: CaptionStyle;
}

/**
 * Read-only preview surface. The craft PreviewRoot renders into a
 * <canvas> via its render-prop; we stack a caption DOM layer on top.
 *
 * NOTE: we do NOT mount <video> elements here. Legacy did so because
 * its playback was driven from DOM video elements; craft's
 * PlaybackEngine renders frames into the canvas directly, so all
 * video decoding is inside the engine.
 */
export function VideoPreview({ captionStyle }: VideoPreviewProps) {
  const composition = useComposition();

  const aspect = composition?.settings
    ? composition.settings.width / composition.settings.height
    : 16 / 9;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: theme.color.surface0,
        fontFamily: theme.font.ui,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
          padding: theme.space.space5,
        }}
      >
        <div
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            aspectRatio: `${aspect}`,
            background: "oklch(8% 0.005 55)",
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.borderWeak}`,
            overflow: "hidden",
            position: "relative",
            width: "100%",
          }}
        >
          {composition ? (
            <PreviewRoot>
              {({ canvasRef, isLoading }) => (
                <>
                  <canvas
                    ref={canvasRef}
                    width={composition.settings.width}
                    height={composition.settings.height}
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "block",
                      background: "oklch(6% 0.003 55)",
                    }}
                  />
                  {isLoading && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: theme.color.ink3,
                        fontFamily: theme.font.ui,
                        fontSize: theme.text.base,
                        letterSpacing: theme.text.trackingWide,
                        pointerEvents: "none",
                      }}
                    >
                      Loading…
                    </div>
                  )}
                </>
              )}
            </PreviewRoot>
          ) : (
            <div
              data-testid="preview-empty"
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: theme.color.ink4,
                fontFamily: theme.font.ui,
                fontSize: theme.text.base,
                fontStyle: "italic",
                letterSpacing: theme.text.trackingBase,
              }}
            >
              No composition loaded
            </div>
          )}

          <CaptionOverlay style={captionStyle} />
        </div>
      </div>
    </div>
  );
}
