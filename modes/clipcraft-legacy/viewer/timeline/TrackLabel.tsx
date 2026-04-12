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
