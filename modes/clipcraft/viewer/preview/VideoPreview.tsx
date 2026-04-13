import { useCallback } from "react";
import { PreviewRoot, useComposition, usePlayback } from "@pneuma-craft/react";
import { CaptionOverlay } from "./CaptionOverlay.js";
import type { CaptionStyle } from "../../persistence.js";

export interface VideoPreviewProps {
  captionStyle?: CaptionStyle;
}

/**
 * Read-only preview surface. The craft PreviewRoot renders into a
 * <canvas> via its render-prop; we stack a caption DOM layer on top
 * and a compact control bar below.
 *
 * NOTE: we do NOT mount <video> elements here. Legacy did so because
 * its playback was driven from DOM video elements; craft's
 * PlaybackEngine renders frames into the canvas directly, so all
 * video decoding is inside the engine.
 */
export function VideoPreview({ captionStyle }: VideoPreviewProps) {
  const composition = useComposition();
  const playback = usePlayback();

  const aspect = composition?.settings
    ? composition.settings.width / composition.settings.height
    : 16 / 9;
  const aspectLabel = composition?.settings?.aspectRatio ?? "16:9";

  const isPlaying = playback.state === "playing";

  const togglePlay = useCallback(() => {
    if (isPlaying) playback.pause();
    else playback.play();
  }, [isPlaying, playback]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#09090b",
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
          padding: 16,
        }}
      >
        <div
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            aspectRatio: `${aspect}`,
            background: "#0a0a0a",
            borderRadius: 4,
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
                      background: "#000",
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
                        color: "#a1a1aa",
                        fontFamily: "system-ui, sans-serif",
                        fontSize: 12,
                        pointerEvents: "none",
                      }}
                    >
                      loading…
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
                color: "#71717a",
                fontFamily: "system-ui, sans-serif",
                fontSize: 14,
              }}
            >
              no composition loaded
            </div>
          )}

          <CaptionOverlay style={captionStyle} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderTop: "1px solid #27272a",
          fontSize: 12,
          color: "#a1a1aa",
        }}
      >
        <button
          type="button"
          onClick={togglePlay}
          disabled={!composition}
          style={{
            background: "none",
            border: "none",
            color: "#e4e4e7",
            cursor: composition ? "pointer" : "not-allowed",
            fontSize: 18,
            padding: 0,
            lineHeight: 1,
          }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "\u23F8" : "\u25B6"}
        </button>
        <span style={{ fontFamily: "monospace" }}>
          {(playback.currentTime ?? 0).toFixed(1)}s / {(playback.duration ?? 0).toFixed(1)}s
        </span>
        <span style={{ fontSize: 11, color: "#52525b" }}>{aspectLabel}</span>
      </div>
    </div>
  );
}
