import { defineTile } from "gridboard";

interface BiliVideo {
  title: string;
  owner: string;
  pic: string;
  stat: { view: number; danmaku: number; like: number };
  tname: string;
  duration: number;
}

function formatView(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default defineTile({
  label: "Bilibili Hot",
  description: "Bilibili popular videos — trending content on China's largest video platform",
  minSize: { cols: 3, rows: 2 },
  maxSize: { cols: 6, rows: 6 },

  dataSource: {
    refreshInterval: 600,
    async fetch({ signal }) {
      const res = await fetch("/proxy/bilibili/x/web-interface/popular?ps=20&pn=1", { signal });
      if (!res.ok) throw new Error(`Bilibili API: ${res.status}`);
      const json = await res.json();
      if (json.code !== 0) throw new Error(`Bilibili: ${json.message}`);
      return (json.data?.list || []).map((v: any) => ({
        title: v.title,
        owner: v.owner?.name || "",
        pic: v.pic?.replace("http://", "https://") || "",
        stat: { view: v.stat?.view || 0, danmaku: v.stat?.danmaku || 0, like: v.stat?.like || 0 },
        tname: v.tname || "",
        duration: v.duration || 0,
      }));
    },
  },

  render({ data, width, height, loading, error }) {
    const items = (data as BiliVideo[]) || [];
    const compact = width < 280 || height < 200;
    const large = !compact && width >= 400 && height >= 320;

    if (loading && !items.length) {
      return <Center><span style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading...</span></Center>;
    }
    if (error && !items.length) {
      return <Center><span style={{ color: "var(--error)", fontSize: 12 }}>{error.message}</span></Center>;
    }

    const count = compact ? 4 : large ? 8 : 6;
    const visible = items.slice(0, count);

    return (
      <div style={{ padding: "var(--tile-padding)", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "var(--font-family)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: compact ? 6 : 10, flexShrink: 0 }}>
          <span style={{ fontSize: compact ? 11 : 13, fontWeight: 600, color: "var(--text-primary)" }}>
            <span style={{ color: "#fb7299" }}>B</span> Bilibili Hot
          </span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{items.length} videos</span>
        </div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: compact ? 2 : large ? 8 : 5 }}>
          {visible.map((v, i) => (
            <VideoRow key={i} video={v} compact={compact} large={large} index={i} />
          ))}
        </div>
      </div>
    );
  },
});

const CATEGORY_COLORS: Record<string, string> = {
  "game": "#7c3aed", "music": "#2563eb", "anime": "#db2777",
  "tech": "#059669", "life": "#d97706", "food": "#dc2626",
};

function categoryColor(tname: string): string {
  const key = Object.keys(CATEGORY_COLORS).find((k) => tname.toLowerCase().includes(k));
  if (key) return CATEGORY_COLORS[key];
  const h = tname.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const palette = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#db2777", "#6366f1"];
  return palette[h % palette.length];
}

function VideoRow({ video, compact, large, index }: { video: BiliVideo; compact: boolean; large: boolean; index: number }) {
  const tagColor = categoryColor(video.tname);

  if (compact) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: "1px solid var(--tile-border)" }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", width: 14, textAlign: "right", flexShrink: 0 }}>{index + 1}</span>
        <span style={{ fontSize: 11, color: "var(--text-primary)", lineHeight: 1.3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {video.title}
        </span>
      </div>
    );
  }

  if (large) {
    return (
      <div style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--tile-border)" }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", width: 16, textAlign: "right", flexShrink: 0, paddingTop: 2 }}>{index + 1}</span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>
            {video.title}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10, color: "var(--text-muted)" }}>
            <span style={{ color: tagColor, fontWeight: 500 }}>{video.tname}</span>
            <span>{video.owner}</span>
            <span>{formatView(video.stat.view)} views</span>
            <span>{formatDuration(video.duration)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Medium
  return (
    <div style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--tile-border)" }}>
      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 14, textAlign: "right", flexShrink: 0, paddingTop: 1 }}>{index + 1}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {video.title}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 2, fontSize: 10, color: "var(--text-muted)" }}>
          <span style={{ color: tagColor }}>{video.tname}</span>
          <span>{formatView(video.stat.view)}</span>
        </div>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>;
}
