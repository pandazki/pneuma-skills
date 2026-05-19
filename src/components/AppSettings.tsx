import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getApiBase } from "../utils/api.js";
import { AgentCommandSettings } from "./AgentCommandPanel.js";

interface AppSettingsData {
  windowWidth?: number;
  windowHeight?: number;
  resizable?: boolean;
}

/**
 * Small popover for app-mode settings (window size, resizable, etc.)
 * Anchored to a trigger element, positioned below-left.
 */
export default function AppSettings({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("app-settings");
  const [settings, setSettings] = useState<AppSettingsData>({});
  const [saving, setSaving] = useState(false);
  const [showAgentCommands, setShowAgentCommands] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load current settings
  useEffect(() => {
    fetch(`${getApiBase()}/api/app-settings`)
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  // Close on click outside — but not while the agent-commands modal is up.
  // That modal sits outside `ref` and owns its own outside-click handler;
  // letting the popover close too would dismiss both surfaces at once.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showAgentCommands) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, showAgentCommands]);

  // Load manifest defaults from URL params as placeholders
  const params = new URLSearchParams(location.search);
  const defaultW = parseInt(params.get("w") || "", 10) || 1080;
  const defaultH = parseInt(params.get("h") || "", 10) || 800;

  const save = useCallback(async (updates: Partial<AppSettingsData>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    setSaving(true);
    try {
      await fetch(`${getApiBase()}/api/app-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch { /* ignore */ }
    setSaving(false);
  }, [settings]);

  const inputStyle: React.CSSProperties = {
    width: 64, height: 26, borderRadius: 5,
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
    color: "#e4e4e7", fontSize: 12, textAlign: "center",
    outline: "none",
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 10000,
        width: 220, padding: 14, borderRadius: 10,
        background: "rgba(24,24,27,0.95)", border: "1px solid rgba(255,255,255,0.1)",
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", gap: 12,
        fontSize: 12, color: "#a1a1aa",
      }}
    >
      <div style={{ fontWeight: 600, color: "#e4e4e7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {t("title")}
      </div>

      {/* Window size */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{t("window")}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="number"
            value={settings.windowWidth ?? defaultW}
            onChange={(e) => save({ windowWidth: parseInt(e.target.value, 10) || defaultW })}
            style={inputStyle}
          />
          <span style={{ color: "#52525b" }}>x</span>
          <input
            type="number"
            value={settings.windowHeight ?? defaultH}
            onChange={(e) => save({ windowHeight: parseInt(e.target.value, 10) || defaultH })}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Resizable */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{t("resizable")}</span>
        <button
          onClick={() => save({ resizable: !settings.resizable })}
          style={{
            width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
            background: settings.resizable ? "#f97316" : "rgba(255,255,255,0.12)",
            position: "relative", transition: "background 0.2s",
          }}
        >
          <div style={{
            width: 16, height: 16, borderRadius: 8,
            background: "#fff", position: "absolute", top: 2,
            left: settings.resizable ? 18 : 2,
            transition: "left 0.2s",
          }} />
        </button>
      </div>

      {saving && <div style={{ fontSize: 10, color: "#52525b" }}>{t("saving")}</div>}

      <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 0" }} />

      <button
        type="button"
        onClick={() => setShowAgentCommands(true)}
        style={{
          background: "transparent",
          border: "none",
          padding: "6px 0",
          color: "#a1a1aa",
          fontSize: 12,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        Manage agent commands…
      </button>

      {showAgentCommands && (
        <AgentCommandSettingsModal onClose={() => setShowAgentCommands(false)} />
      )}
    </div>
  );
}

/**
 * Centered modal for the full agent-commands settings panel. Lives next to
 * AppSettings because both are reachable from the same launcher gear, but
 * it deserves its own dedicated surface (350px+ rather than 220px) to
 * render backend paths without truncating.
 */
function AgentCommandSettingsModal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 20000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        ref={ref}
        style={{
          width: 480,
          maxWidth: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          padding: 20,
          borderRadius: 14,
          background: "rgba(24,24,27,0.98)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
        }}
      >
        <AgentCommandSettings />
      </div>
    </div>
  );
}
