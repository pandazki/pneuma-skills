import { useAssets, useComposition, useEventLog } from "@pneuma-craft/react";
import { theme } from "./theme/tokens.js";

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
      <h2 style={headingStyle}>ClipCraft · State Dump</h2>

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

      <h3 style={subheadingStyle}>Event log (last 10 of {events.length})</h3>
      <pre style={dumpStyle}>
        {events.slice(-10).map((e) => `${e.type} · ${e.actor}`).join("\n") ||
          "— empty —"}
      </pre>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "ready"
      ? theme.color.success
      : status === "generating"
        ? theme.color.warn
        : status === "pending"
          ? theme.color.layerVideo
          : status === "failed"
            ? theme.color.danger
            : theme.color.ink2;
  return (
    <span
      style={{
        display: "inline-block",
        padding: `2px ${theme.space.space2}px`,
        marginRight: theme.space.space2,
        fontFamily: theme.font.ui,
        fontSize: theme.text.xs,
        fontWeight: theme.text.weightSemibold,
        letterSpacing: theme.text.trackingCaps,
        borderRadius: theme.radius.sm,
        background: color,
        color: theme.color.surface0,
        textTransform: "uppercase",
      }}
    >
      {status}
    </span>
  );
}

const panelStyle: React.CSSProperties = {
  padding: theme.space.space5,
  background: theme.color.surface0,
  color: theme.color.ink1,
  fontFamily: theme.font.ui,
  fontSize: theme.text.base,
  height: "100%",
  overflow: "auto",
};
const headingStyle: React.CSSProperties = {
  color: theme.color.accentBright,
  fontFamily: theme.font.display,
  fontSize: theme.text.xl,
  marginBottom: theme.space.space4,
  fontWeight: theme.text.weightSemibold,
  letterSpacing: theme.text.trackingTight,
};
const subheadingStyle: React.CSSProperties = {
  color: theme.color.ink3,
  fontFamily: theme.font.ui,
  fontSize: theme.text.xs,
  textTransform: "uppercase",
  letterSpacing: theme.text.trackingCaps,
  marginTop: theme.space.space5,
  marginBottom: theme.space.space2,
  fontWeight: theme.text.weightSemibold,
};
const dumpStyle: React.CSSProperties = {
  margin: 0,
  padding: theme.space.space3,
  background: theme.color.surface1,
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.sm,
  fontFamily: theme.font.numeric,
  fontVariantNumeric: "tabular-nums",
  fontSize: theme.text.sm,
  color: theme.color.ink1,
  whiteSpace: "pre-wrap",
  letterSpacing: theme.text.trackingBase,
};
const errorStyle: React.CSSProperties = {
  ...dumpStyle,
  background: theme.color.dangerSoft,
  border: `1px solid ${theme.color.dangerBorder}`,
  color: theme.color.dangerInk,
};
const mutedStyle: React.CSSProperties = {
  color: theme.color.ink4,
  fontStyle: "italic",
};
const listStyle: React.CSSProperties = { listStyle: "none", padding: 0, margin: 0 };
const itemStyle: React.CSSProperties = {
  padding: `${theme.space.space1}px 0`,
  display: "flex",
  alignItems: "center",
};
const monoStyle: React.CSSProperties = {
  fontFamily: theme.font.numeric,
  color: theme.color.ink1,
};
