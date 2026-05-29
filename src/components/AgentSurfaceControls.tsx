import { useTranslation } from "react-i18next";
import { useStore } from "../store.js";
import type { SurfaceForm } from "../store/agent-surface-slice.js";

function ControlButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer ${
        active
          ? "text-cc-primary bg-cc-primary/12"
          : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
      }`}
    >
      {children}
    </button>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "w-3.5 h-3.5",
};

/**
 * The form-switch cluster for the Agent Surface — dock to the side rail, pop
 * out to a floating panel, or collapse to the bubble. Shared by the docked and
 * floating forms so the affordance sits in the same place regardless of form.
 */
export default function AgentSurfaceControls({ form }: { form: SurfaceForm }) {
  const { t } = useTranslation("agent-surface");
  const setSurfaceForm = useStore((s) => s.setSurfaceForm);
  const collapseSurface = useStore((s) => s.collapseSurface);
  const tearOffSurface = useStore((s) => s.tearOffSurface);

  // Tear-off is desktop-only and meaningless inside the torn-off window itself.
  const openChatWindow =
    typeof window !== "undefined"
      ? (window as { pneumaDesktop?: { openChatWindow?: (url: string) => void } }).pneumaDesktop?.openChatWindow
      : undefined;
  const inChatWindow =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("surface") === "chat";
  const canTearOff = !!openChatWindow && !inChatWindow;

  const tearOff = () => {
    if (!openChatWindow) return;
    const url = new URL(window.location.href);
    url.searchParams.set("surface", "chat");
    openChatWindow(url.toString());
    // Enter the torn-off state: this window hides its surface and shows a
    // placeholder bubble that focuses the child window (no second chat).
    tearOffSurface();
  };

  return (
    <div className="flex items-center gap-0.5">
      <ControlButton label={t("dock")} active={form === "docked"} onClick={() => setSurfaceForm("docked")}>
        {/* panel-right — chat as a side rail */}
        <svg {...iconProps}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </ControlButton>
      <ControlButton label={t("float")} active={form === "floating"} onClick={() => setSurfaceForm("floating")}>
        {/* app-window — chat as a floating panel */}
        <svg {...iconProps}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M2 9h20" />
          <path d="M6 6.5h.01M9 6.5h.01" />
        </svg>
      </ControlButton>
      {canTearOff && (
        <ControlButton label={t("tear_off")} onClick={tearOff}>
          {/* external-link — pop the conversation into its own window */}
          <svg {...iconProps}>
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
          </svg>
        </ControlButton>
      )}
      <ControlButton label={t("collapse")} onClick={collapseSurface}>
        {/* chevron-down — collapse to the bubble */}
        <svg {...iconProps}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </ControlButton>
    </div>
  );
}
