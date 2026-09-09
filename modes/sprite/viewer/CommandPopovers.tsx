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
import type { SpriteStrings } from "./strings.js";

/**
 * The hover text on a command button: the label, then the one-line hint.
 *
 * `command.description` is written FOR THE USER now. For three blind sessions
 * it was the agent's prose — script names, flags and all — hanging off a
 * button a human was hovering ("the UI is talking to the AI", in the tester's
 * words); the agent's copy of the same three commands lives in the mode's
 * SKILL.md, where it belongs. The locale table gets first refusal so a
 * translated hint can win, and falls through to the manifest, which is the
 * single English source.
 */
export function commandTooltip(
  command: ViewerCommandDescriptor,
  t: SpriteStrings,
): string {
  const hint = t.commandHint(command.id) ?? command.description ?? "";
  return hint ? `${command.label} — ${hint}` : command.label;
}

const ICON_FOR: Record<string, (p: IconProps) => React.ReactElement> = {
  "render-video": FilmIcon,
  "regenerate-motion": SparkIcon,
  "fix-alignment": CrosshairIcon,
};

/** Model and mode names are the API's own, so they are not translated — the
 *  sentence explaining each one is (see `strings.ts`). */
const MODELS: Array<{ id: VideoModel; label: string }> = [
  { id: "seedance-2.5", label: "Seedance 2.5" },
  { id: "h3-max", label: "MiniMax H3 Max" },
];

const MODES: Array<{ id: VideoMode; label: string }> = [
  { id: "i2v", label: "i2v" },
  { id: "first-last", label: "first-last" },
  { id: "r2v", label: "r2v" },
];

export interface CommandBarProps {
  commands: ViewerCommandDescriptor[];
  motion: Motion | null;
  /** `initParams.defaultVideoModel` — the session's configured default. */
  defaultVideoModel: VideoModel;
  onNotifyAgent: (notification: ViewerNotification) => void;
  t: SpriteStrings;
  /** Told whenever a popover opens or closes: while one is up it owns the
   *  keyboard, and the stage's transport shortcuts must stand down. */
  onOpenChange?: (open: boolean) => void;
}

export function CommandBar({
  commands,
  motion,
  defaultVideoModel,
  onNotifyAgent,
  t,
  onOpenChange,
}: CommandBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Unmounting with a popover up (the command bar is gated on `editing`)
  // must release the keyboard too, hence the cleanup.
  useEffect(() => {
    onOpenChange?.(open !== null);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);

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
      // `command.description` is deliberately NOT forwarded: it is the hint
      // the user was shown, not an instruction, and the agent's own briefing
      // for these three commands is in SKILL.md's Commands section.
      message: [
        `The user pressed "${command.label}" on the sprite stage.`,
        line,
        note ? `note: ${note}` : "",
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
                  ? t.selectMotionFirst
                  : commandTooltip(command, t)
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
                  t={t}
                  onCancel={() => setOpen(null)}
                  onConfirm={(model, mode, note) =>
                    send(command, [`model: ${model}`, `mode: ${mode}`], note)
                  }
                />
              ) : (
                <NotePopover
                  title={command.label}
                  motion={motion}
                  t={t}
                  placeholder={
                    command.id === "fix-alignment"
                      ? t.notePlaceholder.misalignment
                      : t.notePlaceholder.change
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
  t,
  onCancel,
  onConfirm,
}: {
  motion: Motion;
  defaultModel: VideoModel;
  t: SpriteStrings;
  onCancel: () => void;
  onConfirm: (model: VideoModel, mode: VideoMode, note: string) => void;
}) {
  const [model, setModel] = useState<VideoModel>(defaultModel);
  const [mode, setMode] = useState<VideoMode>("i2v");
  const [note, setNote] = useState("");

  return (
    <Popover>
      <p className="pb-2 text-[11px] text-cc-muted">
        {t.renderClipFor} <span className="text-cc-fg">{motion.label}</span>
      </p>
      <Field label={t.fieldModel}>
        {MODELS.map((option) => (
          <Choice
            key={option.id}
            active={model === option.id}
            onClick={() => setModel(option.id)}
            hint={t.modelHint[option.id]}
          >
            {option.label}
          </Choice>
        ))}
      </Field>
      <Field label={t.fieldMode}>
        {MODES.map((option) => (
          <Choice
            key={option.id}
            active={mode === option.id}
            onClick={() => setMode(option.id)}
            hint={t.modeHint[option.id]}
          >
            {option.label}
          </Choice>
        ))}
      </Field>
      <NoteBox
        value={note}
        onChange={setNote}
        placeholder={t.notePlaceholder.emphasis}
      />
      <Actions
        onCancel={onCancel}
        onConfirm={() => onConfirm(model, mode, note.trim())}
        confirmLabel={t.askTheAgent}
        cancelLabel={t.cancel}
      />
    </Popover>
  );
}

function NotePopover({
  title,
  motion,
  placeholder,
  t,
  onCancel,
  onConfirm,
}: {
  title: string;
  motion: Motion;
  placeholder: string;
  t: SpriteStrings;
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
        confirmLabel={t.askTheAgent}
        cancelLabel={t.cancel}
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
  cancelLabel,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  cancelLabel: string;
}) {
  return (
    <div className="flex justify-end gap-1.5 pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-2 py-1 text-[11px] text-cc-muted transition-colors hover:text-cc-fg"
      >
        {cancelLabel}
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
