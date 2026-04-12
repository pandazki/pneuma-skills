import { useAssets, useComposition, useEventLog } from "@pneuma-craft/react";

interface StateDumpProps {
  hydrationError: string | null;
}

/**
 * Plan 2 debug renderer. Shows the live craft state so we can confirm
 * hydration is wired correctly. Replaced by real UI in Plans 4+.
 */
export function StateDump({ hydrationError }: StateDumpProps) {
  const assets = useAssets();
  const composition = useComposition();
  const events = useEventLog();

  if (hydrationError) {
    return (
      <section style={panelStyle}>
        <h2 style={headingStyle}>ClipCraft · Hydration Error</h2>
        <pre style={errorStyle}>{hydrationError}</pre>
      </section>
    );
  }

  return (
    <section style={panelStyle}>
      <h2 style={headingStyle}>ClipCraft · State Dump (Plan 2)</h2>

      <h3 style={subheadingStyle}>Composition</h3>
      {composition === null ? (
        <p style={mutedStyle}>No composition yet — hydration hasn't run.</p>
      ) : (
        <pre style={dumpStyle}>
{`settings: ${composition.settings.width}×${composition.settings.height} @ ${composition.settings.fps}fps (${composition.settings.aspectRatio})
tracks: ${composition.tracks.length}
transitions: ${composition.transitions.length}
duration: ${composition.duration.toFixed(2)}s`}
        </pre>
      )}

      <h3 style={subheadingStyle}>Assets ({assets.length})</h3>
      {assets.length === 0 ? (
        <p style={mutedStyle}>No assets registered.</p>
      ) : (
        <ul style={listStyle}>
          {assets.map((a) => (
            <li key={a.id} style={itemStyle}>
              <StatusBadge status={a.status ?? "ready"} />
              <span style={monoStyle}>
                {a.type} · {a.name} {a.uri && `(${a.uri})`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 style={subheadingStyle}>Event Log (last 10 of {events.length})</h3>
      <pre style={dumpStyle}>
        {events.slice(-10).map((e) => `${e.type} · ${e.actor}`).join("\n") || "— empty —"}
      </pre>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "ready" ? "#22c55e"
    : status === "generating" ? "#f97316"
    : status === "pending" ? "#eab308"
    : status === "failed" ? "#ef4444"
    : "#a1a1aa";
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 6px",
      marginRight: 8,
      fontSize: 10,
      borderRadius: 3,
      background: color,
      color: "#09090b",
      fontWeight: 600,
      textTransform: "uppercase",
    }}>
      {status}
    </span>
  );
}

const panelStyle: React.CSSProperties = {
  padding: 24,
  background: "#09090b",
  color: "#e4e4e7",
  fontFamily: "system-ui",
  fontSize: 13,
  height: "100%",
  overflow: "auto",
};
const headingStyle: React.CSSProperties = { color: "#f97316", fontSize: 20, marginBottom: 16 };
const subheadingStyle: React.CSSProperties = { color: "#a1a1aa", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 8 };
const dumpStyle: React.CSSProperties = { margin: 0, padding: 12, background: "#18181b", borderRadius: 4, fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap" };
const errorStyle: React.CSSProperties = { ...dumpStyle, background: "#450a0a", color: "#fca5a5" };
const mutedStyle: React.CSSProperties = { color: "#71717a", fontStyle: "italic" };
const listStyle: React.CSSProperties = { listStyle: "none", padding: 0, margin: 0 };
const itemStyle: React.CSSProperties = { padding: "4px 0", display: "flex", alignItems: "center" };
const monoStyle: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
