/**
 * The three things a user can ask the agent for from inside the stage.
 *
 * A command is a REQUEST, not an action: the viewer never renders a video or
 * re-runs a pipeline itself, it tells the agent what the user wants and with
 * which choices. That is why every popover ends in one `onNotifyAgent` call
 * whose message carries the selection verbatim — the agent must honour the
 * model and mode the user picked instead of falling back to its own defaults.
 *
 * Deliberately NOT `replaces`-collapsed (see the frontend rules): two clicks
 * on "Render video preview" for two different motions are two real requests,
 * and the first one is still true after the second is sent. Only "where the
 * user is now" style notifications may replace each other, and this viewer
 * sends none — selection travels with the next message as `<viewer-context>`.
 */

import { useEffect, useRef, useState } from "react";

import type {
  ViewerCommandDescriptor,
  ViewerNotification,
} from "../../../core/types/viewer-contract.js";
import type { Motion, VideoMode, VideoModel } from "../domain.js";
import { CrosshairIcon, FilmIcon, SparkIcon, type IconProps } from "./icons.js";

const ICON_FOR: Record<string, (p: IconProps) => React.ReactElement> = {
  "render-video": FilmIcon,
  "regenerate-motion": SparkIcon,
  "fix-alignment": CrosshairIcon,
};

const MODELS: Array<{ id: VideoModel; label: string; hint: string }> = [
  { id: "seedance-2.5", label: "Seedance 2.5", hint: "cheap and quick at 480p" },
  { id: "h3-max", label: "MiniMax H3 Max", hint: "stronger motion, slower, min 5 s" },
];

const MODES: Array<{ id: VideoMode; label: string; hint: string }> = [
  { id: "i2v", label: "i2v", hint: "from the first frame" },
  { id: "first-last", label: "first-last", hint: "from the first and last frames" },
  { id: "r2v", label: "r2v", hint: "frames as references, new footage" },
];

export interface CommandBarProps {
  commands: ViewerCommandDescriptor[];
  motion: Motion | null;
  /** `initParams.defaultVideoModel` — the session's configured default. */
  defaultVideoModel: VideoModel;
  onNotifyAgent: (notification: ViewerNotification) => void;
}

export function CommandBar({
  commands,
  motion,
  defaultVideoModel,
  onNotifyAgent,
}: CommandBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (commands.length === 0) return null;

  const send = (
    command: ViewerCommandDescriptor,
    facts: string[],
    note: string,
  ) => {
    if (!motion) return;
    const line = [
      `command: ${command.id}`,
      `motion: ${motion.id}`,
      ...facts,
    ].join(" · ");
    onNotifyAgent({
      type: `sprite-command:${command.id}`,
      severity: "warning",
      summary: `/${command.id} · ${motion.label}`,
      message: [
        `The user pressed "${command.label}" on the sprite stage.`,
        line,
        note ? `note: ${note}` : "",
        command.description ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    setOpen(null);
  };

  return (
    <div ref={rootRef} className="flex items-center gap-1.5">
      {commands.map((command) => {
        const Icon = ICON_FOR[command.id] ?? SparkIcon;
        const disabled = !motion;
        return (
          <div key={command.id} className="relative">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setOpen(open === command.id ? null : command.id)}
              title={
                disabled
                  ? "Select a motion first"
                  : (command.description ?? command.label)
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
                open === command.id
                  ? "border-cc-primary/60 bg-cc-primary/15 text-cc-primary"
                  : "border-cc-border text-cc-muted hover:border-cc-primary/40 hover:text-cc-fg"
              } disabled:opacity-40`}
            >
              <Icon size={12} />
              {command.label}
            </button>

            {open === command.id && motion ? (
              command.id === "render-video" ? (
                <RenderVideoPopover
                  motion={motion}
                  defaultModel={defaultVideoModel}
                  onCancel={() => setOpen(null)}
                  onConfirm={(model, mode, note) =>
                    send(command, [`model: ${model}`, `mode: ${mode}`], note)
                  }
                />
              ) : (
                <NotePopover
                  title={command.label}
                  motion={motion}
                  placeholder={
                    command.id === "fix-alignment"
                      ? "What looks wrong? (e.g. the feet slide on frames 3-5)"
                      : "Anything to change? (optional)"
                  }
                  onCancel={() => setOpen(null)}
                  onConfirm={(note) => send(command, [], note)}
                />
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Popover({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute right-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-cc-border bg-cc-surface p-3 shadow-2xl">
      {children}
    </div>
  );
}

function RenderVideoPopover({
  motion,
  defaultModel,
  onCancel,
  onConfirm,
}: {
  motion: Motion;
  defaultModel: VideoModel;
  onCancel: () => void;
  onConfirm: (model: VideoModel, mode: VideoMode, note: string) => void;
}) {
  const [model, setModel] = useState<VideoModel>(defaultModel);
  const [mode, setMode] = useState<VideoMode>("i2v");
  const [note, setNote] = useState("");

  return (
    <Popover>
      <p className="pb-2 text-[11px] text-cc-muted">
        Render a clip of <span className="text-cc-fg">{motion.label}</span>.
      </p>
      <Field label="Model">
        {MODELS.map((option) => (
          <Choice
            key={option.id}
            active={model === option.id}
            onClick={() => setModel(option.id)}
            hint={option.hint}
          >
            {option.label}
          </Choice>
        ))}
      </Field>
      <Field label="Mode">
        {MODES.map((option) => (
          <Choice
            key={option.id}
            active={mode === option.id}
            onClick={() => setMode(option.id)}
            hint={option.hint}
          >
            {option.label}
          </Choice>
        ))}
      </Field>
      <NoteBox
        value={note}
        onChange={setNote}
        placeholder="Anything the clip should emphasise? (optional)"
      />
      <Actions
        onCancel={onCancel}
        onConfirm={() => onConfirm(model, mode, note.trim())}
        confirmLabel="Ask the agent"
      />
    </Popover>
  );
}

function NotePopover({
  title,
  motion,
  placeholder,
  onCancel,
  onConfirm,
}: {
  title: string;
  motion: Motion;
  placeholder: string;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Popover>
      <p className="pb-2 text-[11px] text-cc-muted">
        {title} — <span className="text-cc-fg">{motion.label}</span>
      </p>
      <NoteBox value={note} onChange={setNote} placeholder={placeholder} />
      <Actions
        onCancel={onCancel}
        onConfirm={() => onConfirm(note.trim())}
        confirmLabel="Ask the agent"
      />
    </Popover>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-2">
      <p className="pb-1 text-[10px] uppercase tracking-wide text-cc-muted">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`rounded-lg border px-2 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
        active
          ? "border-cc-primary/60 bg-cc-primary/15 text-cc-primary"
          : "border-cc-border text-cc-muted hover:text-cc-fg"
      }`}
    >
      {children}
    </button>
  );
}

function NoteBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={2}
      className="w-full resize-none rounded-lg border border-cc-border bg-cc-input-bg px-2 py-1.5 text-[11px] text-cc-fg placeholder:text-cc-muted focus-visible:ring-2 focus-visible:ring-cc-primary/60"
    />
  );
}

function Actions({
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  return (
    <div className="flex justify-end gap-1.5 pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-2 py-1 text-[11px] text-cc-muted transition-colors hover:text-cc-fg"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="rounded-lg border border-cc-primary/50 bg-cc-primary/15 px-2.5 py-1 text-[11px] text-cc-primary transition-colors hover:bg-cc-primary/25"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
