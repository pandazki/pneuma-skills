import { useState, useEffect } from "react";

interface CfStatus {
  available: boolean;
  method: "cli" | "token" | null;
}

export default function CfPagesStatusBadge() {
  const [status, setStatus] = useState<CfStatus | null>(null);

  useEffect(() => {
    fetch("/api/plugins/cf-pages-deploy/status")
      .then((r) => r.json())
      .then((s) => setStatus(s))
      .catch(() => {});
  }, []);

  if (!status) return null;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 12px",
      borderRadius: "8px",
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
      fontSize: "12px",
    }}>
      <span style={{
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: status.available ? "#22c55e" : "#ef4444",
        flexShrink: 0,
      }} />
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
        <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <span style={{ color: "rgba(255,255,255,0.9)" }}>
        {status.available
          ? `Connected${status.method === "cli" ? " via Wrangler" : " via token"}`
          : "Not connected"
        }
      </span>
    </div>
  );
}
