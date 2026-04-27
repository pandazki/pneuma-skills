import { useCallback } from "react";
import type { ViewerCommandDescriptor, ViewerNotification } from "../../../core/types/viewer-contract.js";
import {
  VideoIcon,
  AudioIcon,
  SparkleIcon,
  ScissorsIcon,
  SpeakerIcon,
  UploadIcon,
  type IconProps,
} from "./icons/index.js";
import { theme } from "./theme/tokens.js";

type IconComponent = (props: IconProps) => ReturnType<typeof VideoIcon>;

// Command id → icon mapping. Unknown command ids fall back to SparkleIcon
// so adding a new command in the manifest doesn't crash the bar.
const ICON_FOR_COMMAND: Record<string, IconComponent> = {
  "generate-image": SparkleIcon,
  "generate-video": VideoIcon,
  "regenerate-variant": ScissorsIcon,
  "add-narration": SpeakerIcon,
  "add-bgm": AudioIcon,
  "export-video": UploadIcon,
};

function iconFor(id: string): IconComponent {
  return ICON_FOR_COMMAND[id] ?? SparkleIcon;
}

interface CommandBarProps {
  commands: ViewerCommandDescriptor[];
  onNotifyAgent?: (notification: ViewerNotification) => void;
  /**
   * Map of command id → direct handler. When a command id is in this
   * map, clicking the button fires the handler locally instead of
   * sending a chat notification. Used for viewer-side operations like
   * export that don't need to round-trip through the agent.
   */
  handlers?: Record<string, () => void>;
}

/**
 * Horizontal command bar rendered above the main clipcraft layout.
 * Each button corresponds to a `viewerApi.commands[]` entry from the
 * mode manifest. Clicking a button fires an `onNotifyAgent` call with
 * a short natural-language message — the agent reads the command's
 * description (already in the injected CLAUDE.md section) and
 * executes the matching workflow.
 *
 * Severity `"warning"` is the protocol's "actually send to agent"
 * level; `"info"` is log-only.
 */
export function CommandBar({
  commands,
  onNotifyAgent,
  handlers,
}: CommandBarProps) {
  const handleClick = useCallback(
    (cmd: ViewerCommandDescriptor) => {
      const direct = handlers?.[cmd.id];
      if (direct) {
        direct();
        return;
      }
      if (!onNotifyAgent) return;
      onNotifyAgent({
        type: "clipcraft-command",
        message: `The user clicked the "${cmd.label}" command button. ${
          cmd.description ?? ""
        }`,
        severity: "warning",
        summary: `/${cmd.id}`,
      });
    },
    [onNotifyAgent, handlers],
  );

  if (commands.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.space.space2,
        padding: `${theme.space.space2}px ${theme.space.space4}px`,
        background: theme.color.surface1,
        borderBottom: `1px solid ${theme.color.borderWeak}`,
        fontFamily: theme.font.ui,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: theme.text.xs,
          fontWeight: theme.text.weightSemibold,
          color: theme.color.ink4,
          textTransform: "uppercase",
          letterSpacing: theme.text.trackingCaps,
          marginRight: theme.space.space2,
        }}
      >
        Commands
      </span>
      {commands.map((cmd) => {
        const Icon = iconFor(cmd.id);
        return (
          <button
            key={cmd.id}
            type="button"
            onClick={() => handleClick(cmd)}
            title={cmd.description}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: theme.space.space2,
              height: 26,
              padding: `0 ${theme.space.space3}px`,
              background: theme.color.surface2,
              border: `1px solid ${theme.color.borderWeak}`,
              borderRadius: theme.radius.sm,
              color: theme.color.ink1,
              fontFamily: theme.font.ui,
              fontSize: theme.text.xs,
              fontWeight: theme.text.weightMedium,
              letterSpacing: theme.text.trackingBase,
              cursor: "pointer",
              transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.color.surface3;
              e.currentTarget.style.borderColor = theme.color.accentBorder;
              e.currentTarget.style.color = theme.color.accentBright;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme.color.surface2;
              e.currentTarget.style.borderColor = theme.color.borderWeak;
              e.currentTarget.style.color = theme.color.ink1;
            }}
          >
            <Icon size={13} />
            <span>{cmd.label}</span>
          </button>
        );
      })}
    </div>
  );
}
