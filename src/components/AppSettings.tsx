import { useState, useEffect, useCallback, useRef } from "react";
import { getApiBase } from "../utils/api.js";

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
  const [settings, setSettings] = useState<AppSettingsData>({});
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load current settings
  useEffect(() => {
    fetch(`${getApiBase()}/api/app-settings`)
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

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
        App Settings
      </div>

      {/* Window size */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Window</span>
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
        <span>Resizable</span>
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

      {saving && <div style={{ fontSize: 10, color: "#52525b" }}>Saving...</div>}
    </div>
  );
}
