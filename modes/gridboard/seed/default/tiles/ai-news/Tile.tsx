import { defineTile } from "gridboard";

interface NewsItem {
  title: string;
  description: string;
  image: string | null;
  source: string;
  url: string;
  publishedAt: string;
}

export default defineTile({
  label: "AI News",
  description: "Latest AI news with images — adapts from headlines to rich cards",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 6, rows: 6 },
  isOptimizedFor: () => true, // compact/medium/large breakpoints cover all sizes

  dataSource: {
    refreshInterval: 900,
    async fetch(ctx) {
      // Use HN Algolia API for AI news — reliable, no key needed
      const res = await fetch(
        "/proxy/hn/api/v1/search?query=AI+LLM+GPT&tags=story&hitsPerPage=10",
        { signal: ctx.signal },
      );
      if (!res.ok) throw new Error(`News API: ${res.status}`);
      const data = await res.json();
      return (data.hits || []).map((h: any) => ({
        title: h.title || "Untitled",
        description: h.story_text?.slice(0, 120) || h.comment_text?.slice(0, 120) || "",
        // Generate a colored placeholder based on title hash (no real images from HN)
        image: null,
        source: (() => { try { return h.url ? new URL(h.url).hostname.replace("www.", "") : "news.ycombinator.com"; } catch { return "hn"; } })(),
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        publishedAt: h.created_at || "",
        points: h.points || 0,
        comments: h.num_comments || 0,
      }));
    },
  },

  render({ data, width, height, loading, error }) {
    const items = (data as any[]) || [];
    const compact = width < 240 || height < 180;
    const medium = !compact && (width < 380 || height < 300);
    const large = !compact && !medium;

    if (loading && !items.length) {
      return <Center><span style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading news...</span></Center>;
    }
    if (error && !items.length) {
      return <Center><span style={{ color: "var(--error)", fontSize: 12 }}>{error.message}</span></Center>;
    }

    const count = compact ? 3 : medium ? 5 : 6;
    const visible = items.slice(0, count);

    return (
      <div style={{ padding: "var(--tile-padding)", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "var(--font-family)" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: compact ? 6 : 10, flexShrink: 0 }}>
          <span style={{ fontSize: compact ? 11 : 13, fontWeight: 600, color: "var(--text-primary)" }}>AI News</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{items.length} stories</span>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: compact ? 2 : large ? 8 : 4 }}>
          {visible.map((item: any, i: number) => (
            <NewsCard key={i} item={item} compact={compact} large={large} index={i} />
          ))}
        </div>
      </div>
    );
  },
});

// Color palette for placeholder thumbnails — deterministic from title
const PALETTE = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#db2777", "#6366f1"];
function titleColor(title: string) {
  const h = title.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return PALETTE[h % PALETTE.length];
}

function NewsCard({ item, compact, large, index }: { item: any; compact: boolean; large: boolean; index: number }) {
  const bg = titleColor(item.title);
  const initial = (item.source || "?")[0].toUpperCase();
  const timeAgo = item.publishedAt ? formatTimeAgo(item.publishedAt) : "";

  if (compact) {
    // Compact: single line title
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: "1px solid var(--tile-border)" }}>
        <div style={{
          width: 20, height: 20, borderRadius: 4, background: bg, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color: "#fff",
        }}>{initial}</div>
        <span style={{
          fontSize: 11, color: "var(--text-primary)", lineHeight: 1.3,
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
        }}>{item.title}</span>
      </div>
    );
  }

  if (large) {
    // Large: thumbnail + title + description + meta
    return (
      <div style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--tile-border)" }}>
        {/* Colored thumbnail placeholder */}
        <div style={{
          width: 64, height: 48, borderRadius: 6, background: `linear-gradient(135deg, ${bg}, ${bg}88)`,
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,0.6)",
        }}>{initial}</div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, color: "var(--text-primary)", lineHeight: 1.3,
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
          }}>{item.title}</div>
          <div style={{ display: "flex", gap: 8, fontSize: 10, color: "var(--text-muted)" }}>
            <span style={{ color: "var(--accent)", opacity: 0.8 }}>{item.source}</span>
            <span>▲ {item.points}</span>
            <span>💬 {item.comments}</span>
            {timeAgo && <span>{timeAgo}</span>}
          </div>
        </div>
      </div>
    );
  }

  // Medium: small icon + title + meta
  return (
    <div style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--tile-border)" }}>
      <div style={{
        width: 28, height: 28, borderRadius: 5, background: bg, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700, color: "#fff",
      }}>{initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, color: "var(--text-primary)", lineHeight: 1.3,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
        }}>{item.title}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 2, fontSize: 10, color: "var(--text-muted)" }}>
          <span style={{ color: "var(--accent)", opacity: 0.7 }}>{item.source}</span>
          <span>▲ {item.points}</span>
        </div>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>;
}

function formatTimeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `${Math.floor(ms / 60000)}m`;
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  } catch { return ""; }
}
