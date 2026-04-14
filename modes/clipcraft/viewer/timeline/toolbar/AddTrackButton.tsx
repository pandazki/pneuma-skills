import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useComposition, useDispatch } from "@pneuma-craft/react";
import type { Track } from "@pneuma-craft/timeline";
import {
  VideoIcon,
  AudioIcon,
  SubtitleIcon,
  type IconProps,
} from "../../icons/index.js";
import { theme } from "../../theme/tokens.js";

type TrackKind = Track["type"];

interface Option {
  kind: TrackKind;
  label: string;
  Icon: (p: IconProps) => ReactElement;
  color: string;
}

const OPTIONS: Option[] = [
  { kind: "video", label: "Video", Icon: VideoIcon, color: theme.color.layerVideo },
  { kind: "audio", label: "Audio", Icon: AudioIcon, color: theme.color.layerAudio },
  { kind: "subtitle", label: "Subtitle", Icon: SubtitleIcon, color: theme.color.layerSubtitle },
];

/**
 * Dropdown button that adds a new track to the composition. Lives in
 * the Timeline's zoom-controls row next to Undo/Redo. Click opens a
 * small popover with the three track kinds; pick one, we dispatch
 * composition:add-track with sensible defaults and auto-increment the
 * track name so repeated adds don't collide.
 */
export function AddTrackButton() {
  const composition = useComposition();
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!anchorRef.current) return;
      if (!anchorRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Defer the listener a tick so the click that opened the popover
    // doesn't immediately close it.
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onClickOutside);
    }, 0);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const add = useCallback(
    (kind: TrackKind) => {
      if (!composition) return;
      // Auto-increment the display name so N-th add of the same kind
      // becomes "Video 2", "Video 3", etc. Based on existing tracks of
      // the same kind — not the total count — so mixed sequences read
      // cleanly.
      const sameKindCount = composition.tracks.filter((t) => t.type === kind).length;
      const baseName = kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Captions";
      const name = sameKindCount === 0 ? baseName : `${baseName} ${sameKindCount + 1}`;
      dispatch("human", {
        type: "composition:add-track",
        track: {
          type: kind,
          name,
          clips: [],
          muted: false,
          volume: 1,
          locked: false,
          visible: true,
        },
      });
      setOpen(false);
    },
    [composition, dispatch],
  );

  return (
    <div ref={anchorRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={open}
        aria-label="add track"
        title="Add a new track"
        style={triggerBtn(open)}
      >
        <span style={{ fontSize: theme.text.base, lineHeight: 1 }}>+</span>
        <span>Track</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 160,
            background: theme.color.surface2,
            border: `1px solid ${theme.color.borderStrong}`,
            borderRadius: theme.radius.md,
            boxShadow: theme.elevation.s3,
            padding: theme.space.space1,
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {OPTIONS.map((opt) => {
            const Icon = opt.Icon;
            return (
              <button
                key={opt.kind}
                type="button"
                role="menuitem"
                onClick={() => add(opt.kind)}
                style={menuItemStyle(opt.color)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.color.surface3;
                  e.currentTarget.style.color = theme.color.ink0;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = theme.color.ink1;
                }}
              >
                <span style={{ color: opt.color, display: "inline-flex" }}>
                  <Icon size={13} />
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function triggerBtn(open: boolean): React.CSSProperties {
  return {
    background: open ? theme.color.accentSoft : theme.color.surface2,
    border: `1px solid ${open ? theme.color.accentBorder : theme.color.borderWeak}`,
    borderRadius: theme.radius.sm,
    color: open ? theme.color.accentBright : theme.color.ink2,
    padding: `0 ${theme.space.space3}px`,
    height: 22,
    cursor: "pointer",
    fontFamily: theme.font.ui,
    fontSize: theme.text.xs,
    fontWeight: theme.text.weightSemibold,
    letterSpacing: theme.text.trackingCaps,
    textTransform: "uppercase",
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    gap: theme.space.space1,
    transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
  };
}

function menuItemStyle(color: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: theme.space.space2,
    width: "100%",
    padding: `${theme.space.space2}px ${theme.space.space3}px`,
    background: "transparent",
    border: "none",
    borderRadius: theme.radius.sm,
    fontFamily: theme.font.ui,
    fontSize: theme.text.sm,
    fontWeight: theme.text.weightMedium,
    color: theme.color.ink1,
    letterSpacing: theme.text.trackingBase,
    cursor: "pointer",
    textAlign: "left",
    transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}`,
  };
}
