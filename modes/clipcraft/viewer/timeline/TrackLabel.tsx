// Ported verbatim from modes/clipcraft-legacy/viewer/timeline/TrackLabel.tsx.
// Pure children renderer — no store coupling, no port changes needed.
// Legacy passes an emoji/char per track type in Timeline.tsx.

const LABEL_W = 32;

export { LABEL_W };

export function TrackLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: LABEL_W,
        flexShrink: 0,
        fontSize: 10,
        color: "#71717a",
        textAlign: "center",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
      }}
    >
      {children}
    </div>
  );
}
