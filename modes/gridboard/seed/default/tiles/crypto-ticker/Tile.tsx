import { defineTile } from "gridboard";

const COIN_COLORS: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#627eea",
  SOL: "#9945ff",
};

const COIN_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
};

interface CoinPrice {
  usd: number;
  change24h: number;
  high: number;
  low: number;
  volume: string;
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

function CoinIcon({ symbol, size }: { symbol: string; size: number }) {
  const color = COIN_COLORS[symbol] || "#888";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: color,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      fontWeight: 700, fontSize: size * 0.42, color: "#fff", boxShadow: `0 0 8px ${color}55`,
    }}>{symbol[0]}</div>
  );
}

export default defineTile({
  label: "Crypto Ticker",
  description: "Live BTC, ETH, SOL prices with 24h change from CryptoCompare",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 5, rows: 3 },
  isOptimizedFor: () => true,

  dataSource: {
    refreshInterval: 300,
    async fetch({ signal }) {
      const res = await fetch(
        "/proxy/cryptocompare/data/pricemultifull?fsyms=BTC,ETH,SOL&tsyms=USD",
        { signal },
      );
      if (!res.ok) throw new Error(`CryptoCompare: ${res.status}`);
      const json = await res.json();
      const raw = json.RAW || {};

      const prices: Record<string, CoinPrice> = {};
      for (const sym of ["BTC", "ETH", "SOL"]) {
        const d = raw[sym]?.USD;
        if (!d) continue;
        prices[sym] = {
          usd: d.PRICE ?? 0,
          change24h: d.CHANGEPCT24HOUR ?? 0,
          high: d.HIGH24HOUR ?? 0,
          low: d.LOW24HOUR ?? 0,
          volume: formatVolume(d.TOTALVOLUME24HTO ?? 0),
        };
      }
      return { prices } as CryptoData;
    },
  },

  render({ data, width, height, loading, error }) {
    const d = data as CryptoData | null;
    const compact = width < 220 && height < 140;
    const wideShort = !compact && width >= 300 && height < 220;
    const large = !compact && !wideShort && width >= 340 && height >= 220;

    if (loading && !d) return <div style={centerStyle}><span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Loading...</span></div>;
    if (error && !d) return <div style={centerStyle}><span style={{ color: "#ef4444", fontSize: "0.72rem", textAlign: "center", padding: 8 }}>{error.message}</span></div>;

    const prices = d?.prices ?? {};
    const symbols = ["BTC", "ETH", "SOL"];

    if (compact) {
      const btc = prices["BTC"];
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "12px 14px", boxSizing: "border-box", fontFamily: "var(--font-family)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CoinIcon symbol="BTC" size={18} />
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600 }}>BTC</span>
          </div>
          <div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)", lineHeight: 1.1 }}>{btc ? formatPrice(btc.usd) : "\u2014"}</div>
            <div style={{ marginTop: 4 }}><ChangeBadge change={btc?.change24h ?? 0} compact /></div>
          </div>
        </div>
      );
    }

    if (wideShort) {
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", padding: "10px 14px", boxSizing: "border-box", fontFamily: "var(--font-family)" }}>
          {symbols.map((sym, idx) => {
            const coin = prices[sym];
            return (
              <div key={sym} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "0 10px", borderRight: idx < 2 ? "1px solid rgba(255,255,255,0.08)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <CoinIcon symbol={sym} size={22} />
                    <div>
                      <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1 }}>{sym}</div>
                      <div style={{ fontSize: "0.55rem", color: "var(--text-muted)", lineHeight: 1.2 }}>{COIN_NAMES[sym]}</div>
                    </div>
                  </div>
                  <ChangeBadge change={coin?.change24h ?? 0} compact />
                </div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)", margin: "4px 0 2px" }}>{coin ? formatPrice(coin.usd) : "\u2014"}</div>
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
          {symbols.map((sym) => {
            const coin = prices[sym];
            return (
              <div key={sym} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}><CoinIcon symbol={sym} size={22} /><span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)" }}>{sym}</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{coin ? formatPrice(coin.usd) : "\u2014"}</span>
                  <ChangeBadge change={coin?.change24h ?? 0} compact />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "12px 16px", boxSizing: "border-box", fontFamily: "var(--font-family)" }}>
        <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Crypto Prices · 24h</div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", marginTop: 8 }}>
          {symbols.map((sym) => {
            const coin = prices[sym];
            return (
              <div key={sym} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <CoinIcon symbol={sym} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{sym}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{COIN_NAMES[sym]}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{coin ? formatPrice(coin.usd) : "\u2014"}</div>
                  <div style={{ marginTop: 2 }}><ChangeBadge change={coin?.change24h ?? 0} /></div>
                </div>
                {coin && (
                  <div style={{ flexShrink: 0, textAlign: "right", fontSize: "0.55rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    <div>H {formatPrice(coin.high)}</div>
                    <div>L {formatPrice(coin.low)}</div>
                    <div>Vol {coin.volume}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
});

const centerStyle: React.CSSProperties = { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" };
