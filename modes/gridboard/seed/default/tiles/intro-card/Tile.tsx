import { defineTile } from "gridboard";

export default defineTile({
  label: "Welcome",
  description: "Pneuma GridBoard introduction card",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 8, rows: 4 },
  isOptimizedFor: () => true,

  render({ width, height }) {
    const tiny = width < 200 || height < 120;
    const compact = !tiny && (width < 320 || height < 160);
    const medium = !tiny && !compact && (width < 500 || height < 200);
    const full = !tiny && !compact && !medium;

    if (tiny) {
      return (
        <div style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8,
          fontFamily: "var(--font-family)",
          background: "linear-gradient(135deg, rgba(249,115,22,0.06) 0%, transparent 60%)",
        }}>
          <Logo size={28} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)" }}>GridBoard</div>
            <div style={{ fontSize: "0.55rem", color: "var(--text-muted)", marginTop: 2 }}>Drag. Resize. Create.</div>
          </div>
        </div>
      );
    }

    if (compact) {
      return (
        <Wrapper>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Logo size={30} />
            <ShimmerTitle size="0.95rem" />
          </div>
          <p style={{ margin: 0, fontSize: "0.72rem", lineHeight: 1.5, color: "var(--text-secondary)" }}>
            Drag to rearrange, pull edges to resize.
            <span style={{ color: "var(--accent)", fontWeight: 500 }}> Try the weather tile.</span>
          </p>
        </Wrapper>
      );
    }

    if (medium) {
      return (
        <Wrapper>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <Logo size={36} />
            <div>
              <ShimmerTitle size="1.15rem" />
              <p style={{ margin: 0, fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 2 }}>Interactive dashboard builder</p>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.6, color: "var(--text-secondary)", maxWidth: 420 }}>
            Drag tiles to rearrange, pull edges to resize. The agent creates tiles,
            fetches APIs, and adapts layouts in real time.
            <span style={{ color: "var(--accent)", fontWeight: 500 }}> Try resizing the weather tile below.</span>
          </p>
        </Wrapper>
      );
    }

    // Full: two-column — text left, large illustration right
    const illustrationWidth = Math.min(Math.floor(width * 0.45), 340);

    return (
      <Wrapper>
        <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: "100%", gap: 8 }}>
          {/* Text */}
          <div style={{ flex: 1, minWidth: 0, zIndex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
              <Logo size={40} />
              <div>
                <ShimmerTitle size="1.4rem" />
                <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>Interactive dashboard builder</p>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, color: "var(--text-secondary)", maxWidth: 380 }}>
              Drag tiles to rearrange, pull edges to resize.
              The agent creates tiles, fetches APIs, and adapts layouts in real time.
            </p>
            {/* Arrow hint pointing down-right toward weather tile */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, opacity: 0.9 }}>
                <path d="M4 4l10 10M14 8v6H8" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: "0.78rem", color: "var(--accent)", fontWeight: 500 }}>
                Try resizing the weather tile below
              </span>
            </div>
          </div>

          {/* Illustration — large, flush to edges */}
          <div style={{
            flexShrink: 0, width: illustrationWidth,
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden", borderRadius: 10,
            position: "relative",
          }}>
            <img
              src="/content/tiles/intro-card/illustration.png"
              alt=""
              style={{
                width: "100%", height: "100%",
                objectFit: "cover", objectPosition: "center",
                opacity: 0.9,
                maskImage: "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 15%, rgba(0,0,0,1) 30%)",
                WebkitMaskImage: "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 15%, rgba(0,0,0,1) 30%)",
              }}
            />
          </div>
        </div>
      </Wrapper>
    );
  },
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: "100%", height: "100%", position: "relative", overflow: "hidden",
      display: "flex", flexDirection: "column", justifyContent: "center",
      padding: "20px 28px", boxSizing: "border-box",
      fontFamily: "var(--font-family)",
      background: "linear-gradient(135deg, rgba(249,115,22,0.06) 0%, transparent 50%, rgba(249,115,22,0.03) 100%)",
    }}>
      <div style={{
        position: "absolute", top: -60, right: -60, width: 200, height: 200,
        background: "radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      {children}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes shimmer { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
      `}} />
    </div>
  );
}

function Logo({ size }: { size: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.25,
      background: "linear-gradient(135deg, #f97316, #fb923c)",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 0 20px rgba(249,115,22,0.25)", flexShrink: 0,
    }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    </div>
  );
}

function ShimmerTitle({ size }: { size: string }) {
  return (
    <h1 style={{
      margin: 0, fontSize: size, fontWeight: 700, lineHeight: 1.2,
      background: "linear-gradient(90deg, var(--text-primary), #f97316, var(--text-primary))",
      backgroundSize: "200% 100%",
      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
      backgroundClip: "text",
      animation: "shimmer 4s ease-in-out infinite",
    }}>
      Pneuma GridBoard
    </h1>
  );
}
