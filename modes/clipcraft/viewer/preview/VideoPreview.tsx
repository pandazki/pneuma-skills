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
          // minHeight: 0 / minWidth: 0 are required so the inner
          // aspect-ratio box can shrink below its content's intrinsic
          // size — without them flex would refuse to clamp and the
          // canvas would overflow + distort under `width: 100%`.
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {/*
         * Aspect-ratio wrapper. The ONLY constraints on this div are
         * `aspect-ratio` + `max-width: 100%` + `max-height: 100%` —
         * no explicit `width` or `height`. Modern browsers then pick
         * the inner box size that fits the flex parent while
         * preserving the exact composition aspect. The canvas inside
         * stretches 100%×100% to this box, and since the box's
         * aspect matches the canvas backing-store aspect, the image
         * never distorts — it letterboxes or pillarboxes naturally.
         */}
        <div
          style={{
            aspectRatio: `${composition?.settings?.width ?? 16} / ${composition?.settings?.height ?? 9}`,
            maxWidth: "100%",
            maxHeight: "100%",
            background: "oklch(6% 0.003 55)",
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.borderWeak}`,
            overflow: "hidden",
            position: "relative",
            // height: auto + width: auto are defaults — the aspect-ratio
            // + max-* combo computes one dimension from the other
            // inside a sized flex parent.
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
