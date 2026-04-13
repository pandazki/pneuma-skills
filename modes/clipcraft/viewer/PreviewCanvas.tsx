// modes/clipcraft/viewer/PreviewCanvas.tsx
import { PreviewRoot, useComposition } from "@pneuma-craft/react";

/**
 * Headless canvas binding for the upstream PlaybackEngine.
 *
 * Uses PreviewRoot's render-prop to receive a canvasRef that is wired to
 * the store's frame subscription. This component owns the actual <canvas>
 * element and sizes it from composition.settings — width/height are pixel
 * dimensions used by the engine compositor; CSS sizing is responsive so
 * the canvas fits its parent.
 *
 * When no composition is loaded yet (fresh workspace before hydration,
 * or hydration produced no composition), shows a placeholder instead of
 * a 0×0 canvas so the layout doesn't collapse.
 */
export function PreviewCanvas() {
  const composition = useComposition();

  if (!composition) {
    return (
      <div
        data-testid="preview-empty"
        className="cc-preview-empty"
        style={{
          aspectRatio: "16 / 9",
          background: "#0a0a0a",
          color: "#71717a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
        }}
      >
        no composition loaded
      </div>
    );
  }

  const { width, height, aspectRatio } = composition.settings;

  return (
    <PreviewRoot>
      {({ canvasRef, isLoading }) => (
        <div
          className="cc-preview-canvas-wrap"
          style={{
            position: "relative",
            background: "#0a0a0a",
            aspectRatio: aspectRatio.replace(":", " / "),
            overflow: "hidden",
          }}
        >
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
            }}
          />
          {isLoading && (
            <div
              className="cc-preview-loading"
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
        </div>
      )}
    </PreviewRoot>
  );
}
