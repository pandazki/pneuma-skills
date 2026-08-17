import { useState, useEffect, useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getApiBase } from "../utils/api.js";

interface AppSettingsData {
  windowWidth?: number;
  windowHeight?: number;
  resizable?: boolean;
}

/** Where the panel sits, in viewport coordinates. */
interface PanelPos {
  top: number;
  right: number;
}

/** Gap between the gear's bottom edge and the panel. */
const ANCHOR_GAP = 6;

/**
 * Small popover for app-mode settings (window size, resizable, etc.)
 *
 * Portaled to `<body>` and positioned `fixed` under the gear — the same
 * escape `ShareDropdown` makes in `TopBar.tsx`, for the same reason. The
 * TopBar root is `relative z-20`, which is a stacking context, so a panel
 * nested inside it is sealed into the layer painted at z=20 no matter what
 * z-index it carries: a viewer's own chrome painted later at a higher z
 * (bansho's board buttons at z-30) cuts straight through it. Raising this
 * panel's number cannot help; raising the TopBar's only helps against the
 * viewers whose z you happen to have seen. Leaving the context entirely
 * fixes it against every viewer, present and future.
 */
export default function AppSettings({
  anchorRef,
  onClose,
}: {
  /** The gear that opened this panel — the rect the panel hangs from. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation("app-settings");
  const [settings, setSettings] = useState<AppSettingsData>({});
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Anchor tracking. Measured in a layout effect so the first paint is
  // already in place (no flash at the top-left corner), and re-measured on
  // resize/scroll because a fixed panel does not follow its anchor by itself.
  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + ANCHOR_GAP, right: window.innerWidth - r.right });
  }, [anchorRef]);

  useLayoutEffect(() => {
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  // Load current settings
  useEffect(() => {
    fetch(`${getApiBase()}/api/app-settings`)
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  // Close on click outside, or on Escape. The anchor is explicitly NOT
  // outside: without that, mousedown on the gear closes the panel and the
  // gear's own click re-opens it, leaving a button that can only ever open.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

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

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      data-app-settings=""
      role="dialog"
      aria-label={t("title")}
      style={{
        position: "fixed", top: pos.top, right: pos.right, zIndex: 200,
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
    </div>,
    document.body,
  );
}
