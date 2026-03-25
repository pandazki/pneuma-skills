import { defineTile } from "gridboard";

const COIN_COLORS: Record<string, string> = {
  bitcoin: "#f7931a",
  ethereum: "#627eea",
  solana: "#9945ff",
};

const COIN_SYMBOLS: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
};

const COIN_NAMES: Record<string, string> = {
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  solana: "Solana",
};

interface CoinPrice {
  usd: number;
  usd_24h_change: number;
  high: number;
  low: number;
  volume: string;
  sparkline: number[];
}

interface CryptoData {
  prices: Record<string, CoinPrice>;
}

function formatPrice(n: number): string {
  if (n >= 100000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 10000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (n >= 1000) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(2)}`;
}

function formatVolume(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function Sparkline({ values, color, width, height }: { values: number[]; color: string; width: number; height: number }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const isUp = values[values.length - 1] >= values[0];
  const lineColor = isUp ? "#22c55e" : "#ef4444";
  const pathD = `M ${pts.join(" L ")}`;
  const fillD = `M 0,${height} L ${pts.join(" L ")} L ${width},${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible", display: "block" }}>
      <defs>
        <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#sg-${color.replace("#", "")})`} />
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChangeBadge({ change, compact }: { change: number; compact?: boolean }) {
  const up = change >= 0;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "2px",
      padding: compact ? "1px 5px" : "2px 7px", borderRadius: 4,
      fontSize: compact ? "0.65rem" : "0.7rem", fontWeight: 600,
      background: up ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
      color: up ? "#22c55e" : "#ef4444",
      fontFamily: "var(--font-mono, monospace)", flexShrink: 0,
    }}>
      {up ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
    </span>
  );
}

function CoinIcon({ id, size }: { id: string; size: number }) {
  const color = COIN_COLORS[id] || "#888";
  const letter = COIN_SYMBOLS[id]?.[0] ?? "?";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: color,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      fontWeight: 700, fontSize: size * 0.42, color: "#fff", boxShadow: `0 0 8px ${color}55`,
    }}>{letter}</div>
  );
}

export default defineTile({
  label: "Crypto Ticker",
  description: "Live BTC, ETH, SOL prices with 24h change and 7-day sparklines",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 5, rows: 3 },
  // responsive breakpoints cover all sizes within min/max
  isOptimizedFor: () => true,

  dataSource: {
    refreshInterval: 120,
    async fetch({ signal }) {
      const COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
      const COIN_IDS = ["bitcoin", "ethereum", "solana"];

      const tickerRes = await fetch(
        `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(COINS))}`,
        { signal },
      );
      if (!tickerRes.ok) throw new Error(`Binance ticker: ${tickerRes.status}`);
      const tickers = await tickerRes.json();

      const klineResults = await Promise.all(
        COINS.map(sym =>
          fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=7`, { signal })
            .then(r => r.ok ? r.json() : []).catch(() => [])
        ),
      );

      const prices: Record<string, CoinPrice> = {};
      for (let i = 0; i < COINS.length; i++) {
        const t = tickers.find((x: any) => x.symbol === COINS[i]);
        if (t) {
          const klines = klineResults[i] || [];
          prices[COIN_IDS[i]] = {
            usd: parseFloat(t.lastPrice),
            usd_24h_change: parseFloat(t.priceChangePercent),
            high: parseFloat(t.highPrice),
            low: parseFloat(t.lowPrice),
            volume: formatVolume(parseFloat(t.quoteVolume)),
            sparkline: klines.map((k: any) => parseFloat(k[4])),
          };
        }
      }
      return { prices } as CryptoData;
    },
  },

  render({ data, width, height, loading, error }) {
    const d = data as CryptoData | null;
    const compact = width < 220 && height < 140;
    const wideShort = !compact && width >= 300 && height < 220;
    const large = !compact && !wideShort && width >= 340 && height >= 220;

    if (loading && !d) return <div style={centerStyle}><span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Loading…</span></div>;
    if (error && !d) return <div style={centerStyle}><span style={{ color: "#ef4444", fontSize: "0.72rem", textAlign: "center", padding: 8 }}>{error.message}</span></div>;

    const prices = d?.prices ?? {};

    if (compact) {
      const btc = prices["bitcoin"];
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "12px 14px", boxSizing: "border-box", fontFamily: "var(--font-family)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CoinIcon id="bitcoin" size={18} />
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600 }}>BTC</span>
          </div>
          <div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)", lineHeight: 1.1 }}>{btc ? formatPrice(btc.usd) : "—"}</div>
            <div style={{ marginTop: 4 }}><ChangeBadge change={btc?.usd_24h_change ?? 0} compact /></div>
          </div>
        </div>
      );
    }

    if (wideShort) {
      const colW = (width - 28) / 3;
      const sparkW = Math.max(60, colW * 0.55);
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", padding: "10px 14px", boxSizing: "border-box", fontFamily: "var(--font-family)" }}>
          {["bitcoin", "ethereum", "solana"].map((id, idx) => {
            const coin = prices[id];
            return (
              <div key={id} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "0 10px", borderRight: idx < 2 ? "1px solid rgba(255,255,255,0.08)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <CoinIcon id={id} size={22} />
                    <div>
                      <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1 }}>{COIN_SYMBOLS[id]}</div>
                      <div style={{ fontSize: "0.55rem", color: "var(--text-muted)", lineHeight: 1.2 }}>{COIN_NAMES[id]}</div>
                    </div>
                  </div>
                  <ChangeBadge change={coin?.usd_24h_change ?? 0} compact />
                </div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)", margin: "4px 0 2px" }}>{coin ? formatPrice(coin.usd) : "—"}</div>
                <Sparkline values={coin?.sparkline ?? []} color={COIN_COLORS[id]} width={sparkW} height={36} />
                {coin && <div style={{ display: "flex", gap: 6, fontSize: "0.55rem", color: "var(--text-muted)", marginTop: 3, fontFamily: "var(--font-mono)" }}><span>H {formatPrice(coin.high)}</span><span>L {formatPrice(coin.low)}</span><span>Vol {coin.volume}</span></div>}
              </div>
            );
          })}
        </div>
      );
    }

    if (!large) {
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-around", padding: "10px 12px", boxSizing: "border-box", fontFamily: "var(--font-family)" }}>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Crypto</div>
          {["bitcoin", "ethereum", "solana"].map((id) => {
            const coin = prices[id];
            return (
              <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}><CoinIcon id={id} size={22} /><span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)" }}>{COIN_SYMBOLS[id]}</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{coin ? formatPrice(coin.usd) : "—"}</span>
                  <ChangeBadge change={coin?.usd_24h_change ?? 0} compact />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    const sparkW = Math.min(80, width * 0.22);
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "12px 16px", boxSizing: "border-box", fontFamily: "var(--font-family)" }}>
        <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Crypto Prices · 24h</div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", marginTop: 8 }}>
          {["bitcoin", "ethereum", "solana"].map((id) => {
            const coin = prices[id];
            return (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <CoinIcon id={id} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{COIN_SYMBOLS[id]}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{COIN_NAMES[id]}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{coin ? formatPrice(coin.usd) : "—"}</div>
                  <div style={{ marginTop: 2 }}><ChangeBadge change={coin?.usd_24h_change ?? 0} /></div>
                </div>
                <div style={{ flexShrink: 0, marginLeft: 4 }}><Sparkline values={coin?.sparkline ?? []} color={COIN_COLORS[id]} width={sparkW} height={32} /></div>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
});

const centerStyle: React.CSSProperties = { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" };
