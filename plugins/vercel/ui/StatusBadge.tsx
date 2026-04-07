import { useState, useEffect } from "react";

interface VercelStatus {
  available: boolean;
  method: "cli" | "token" | null;
  user?: string;
}

/** Vercel connection status badge — loaded dynamically by the slot system */
export default function VercelStatusBadge() {
  const [status, setStatus] = useState<VercelStatus | null>(null);

  useEffect(() => {
    fetch("/api/plugins/vercel-deploy/status")
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
      <svg width="14" height="12" viewBox="0 0 76 65" fill="currentColor" style={{ opacity: 0.7 }}>
        <path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/>
      </svg>
      <span style={{ color: "rgba(255,255,255,0.9)" }}>
        {status.available
          ? `Connected${status.method === "cli" ? " via CLI" : " via token"}${status.user ? ` as ${status.user}` : ""}`
          : "Not connected"
        }
      </span>
    </div>
  );
}
