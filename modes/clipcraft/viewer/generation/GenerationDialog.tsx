import { useEffect, useMemo, useState } from "react";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import type { ViewerNotification } from "../../../../core/types/viewer-contract.js";
import { XIcon, SparkleIcon } from "../icons/index.js";
import { theme } from "../theme/tokens.js";
import { AssetInfoView } from "../assetInfo/AssetInfoView.js";
import { usePendingGenerations } from "./PendingGenerations.js";
import {
  buildGenerationNotification,
  type AssetKind,
  type GenerationParams,
  type GenerationRequest,
  type RequestMode,
} from "./dispatchGeneration.js";

export interface GenerationDialogProps {
  open: boolean;
  mode: RequestMode;
  initialKind?: AssetKind;
  /** Present when mode === "variant". Locks the type picker and
   *  seeds the prompt with the source's existing prompt. */
  source?: GenerationRequest["source"];
  onClose: () => void;
  onNotifyAgent?: (n: ViewerNotification) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay + panel shell
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Centered modal with the generation form. Uses the same overlay
 * pattern as AssetLightbox — fixed full-viewport backdrop + centered
 * card. Token-based styling throughout.
 */
export function GenerationDialog({
  open,
  mode,
  initialKind = "image",
  source,
  onClose,
  onNotifyAgent,
}: GenerationDialogProps) {
  // Escape-to-close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        background: "oklch(0% 0 0 / 0.72)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: theme.font.ui,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: mode === "variant" ? "min(720px, 92vw)" : "min(560px, 90vw)",
          maxHeight: "88vh",
          overflow: "auto",
          background: theme.color.surface1,
          border: `1px solid ${theme.color.borderStrong}`,
          borderRadius: theme.radius.lg,
          boxShadow: theme.elevation.s3,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DialogHeader mode={mode} source={source} onClose={onClose} />
        {mode === "variant" && source ? (
          <VariantForm
            kind={initialKind}
            source={source}
            onCancel={onClose}
            onSubmit={(req) => {
              if (onNotifyAgent) onNotifyAgent(buildGenerationNotification(req));
              onClose();
            }}
          />
        ) : (
          <GenerationForm
            mode={mode}
            initialKind={initialKind}
            source={source}
            onCancel={onClose}
            onSubmit={(req) => {
              if (onNotifyAgent) onNotifyAgent(buildGenerationNotification(req));
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

function DialogHeader({
  mode,
  source,
  onClose,
}: {
  mode: RequestMode;
  source?: GenerationRequest["source"];
  onClose: () => void;
}) {
  const title = mode === "variant" ? "Generate variant" : "Create new asset";
  const sub =
    mode === "variant"
      ? source
        ? `from ${source.name}`
        : "variant"
      : "AI generation";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.space.space3,
        padding: `${theme.space.space4}px ${theme.space.space5}px ${theme.space.space3}px`,
        borderBottom: `1px solid ${theme.color.borderWeak}`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: theme.radius.md,
          background: theme.color.accentSoft,
          border: `1px solid ${theme.color.accentBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: theme.color.accentBright,
          flexShrink: 0,
        }}
      >
        <SparkleIcon size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: theme.text.lg,
            fontWeight: theme.text.weightSemibold,
            color: theme.color.ink0,
            letterSpacing: theme.text.trackingTight,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: theme.text.sm,
            color: theme.color.ink3,
            letterSpacing: theme.text.trackingBase,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="close"
        title="Close (Esc)"
        style={closeBtnStyle}
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form
// ─────────────────────────────────────────────────────────────────────────────

const ASPECT_RATIOS: { label: string; value: string }[] = [
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" },
];

const DURATIONS: { label: string; value: string }[] = [
  { label: "4 s", value: "4s" },
  { label: "6 s", value: "6s" },
  { label: "8 s", value: "8s" },
];

const RESOLUTIONS: { label: string; value: "720p" | "1080p" }[] = [
  { label: "720p", value: "720p" },
  { label: "1080p", value: "1080p" },
];

const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

function GenerationForm({
  mode,
  initialKind,
  source,
  onSubmit,
  onCancel,
}: {
  mode: RequestMode;
  initialKind: AssetKind;
  source?: GenerationRequest["source"];
  onSubmit: (req: GenerationRequest) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<AssetKind>(initialKind);
  const [audioSubKind, setAudioSubKind] = useState<"tts" | "bgm">("bgm");

  // Prompt — seeded with the source's prompt on variant mode so the
  // user can tweak rather than start from scratch.
  const initialPrompt = mode === "variant" ? source?.sourcePrompt ?? "" : "";
  const [prompt, setPrompt] = useState(initialPrompt);
  useEffect(() => {
    setPrompt(mode === "variant" ? source?.sourcePrompt ?? "" : "");
  }, [mode, source]);

  // Image params
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [style, setStyle] = useState<string>("");
  const [width, setWidth] = useState<number>(1920);
  const [height, setHeight] = useState<number>(1080);

  // Video params
  const [videoDuration, setVideoDuration] = useState<string>("4s");
  const [videoAspect, setVideoAspect] = useState<"16:9" | "9:16">("16:9");
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p">(
    "720p",
  );

  // Audio params
  const [voice, setVoice] = useState<string>("alloy");
  const [bgmDuration, setBgmDuration] = useState<number>(30);

  const typeLocked = mode === "variant"; // for variants we inherit the source kind

  // Keep `kind` in sync with the locked mode.
  useEffect(() => {
    if (typeLocked) setKind(initialKind);
  }, [typeLocked, initialKind]);

  const canSubmit = prompt.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const params: GenerationParams =
      kind === "image"
        ? {
            kind: "image",
            prompt: prompt.trim(),
            aspectRatio,
            width,
            height,
            style: style.trim() || undefined,
          }
        : kind === "video"
          ? {
              kind: "video",
              prompt: prompt.trim(),
              duration: videoDuration,
              aspectRatio: videoAspect,
              resolution: videoResolution,
            }
          : {
              kind: "audio",
              subKind: audioSubKind,
              prompt: prompt.trim(),
              voice: audioSubKind === "tts" ? voice : undefined,
              durationSeconds:
                audioSubKind === "bgm" ? bgmDuration : undefined,
            };
    onSubmit({ mode, params, source });
  };

  // ── UI helpers ─────────────────────────────────────────────────────────
  const typeOptions: { id: AssetKind; label: string }[] = useMemo(
    () => [
      { id: "image", label: "Image" },
      { id: "video", label: "Video" },
      { id: "audio", label: "Audio" },
    ],
    [],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.space.space4,
        padding: theme.space.space5,
      }}
    >
      {/* Type picker */}
      <FieldRow label="Type">
        <SegmentControl
          value={kind}
          disabled={typeLocked}
          options={typeOptions}
          onChange={(v) => setKind(v as AssetKind)}
        />
      </FieldRow>

      {/* Audio sub-kind — only when kind is audio */}
      {kind === "audio" && (
        <FieldRow label="Audio type">
          <SegmentControl
            value={audioSubKind}
            options={[
              { id: "bgm", label: "Background music" },
              { id: "tts", label: "Narration (TTS)" },
            ]}
            onChange={(v) => setAudioSubKind(v as "tts" | "bgm")}
          />
        </FieldRow>
      )}

      {/* Prompt */}
      <FieldRow
        label={
          kind === "audio" && audioSubKind === "tts"
            ? "Narration text"
            : "Prompt"
        }
        hint={
          mode === "variant"
            ? "Seeded from the source's original prompt — tweak it to steer the variant."
            : undefined
        }
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          placeholder={
            kind === "audio" && audioSubKind === "tts"
              ? "The text to speak"
              : "Describe what to generate"
          }
          rows={5}
          style={textareaStyle}
        />
      </FieldRow>

      {/* Type-specific fields */}
      {kind === "image" && (
        <>
          <FieldRow label="Aspect ratio">
            <SegmentControl
              value={aspectRatio}
              options={ASPECT_RATIOS.map((r) => ({ id: r.value, label: r.label }))}
              onChange={(v) => setAspectRatio(v)}
            />
          </FieldRow>
          <TwoColRow>
            <FieldRow label="Width">
              <NumberInput
                value={width}
                onChange={setWidth}
                min={256}
                max={4096}
                step={16}
              />
            </FieldRow>
            <FieldRow label="Height">
              <NumberInput
                value={height}
                onChange={setHeight}
                min={256}
                max={4096}
                step={16}
              />
            </FieldRow>
          </TwoColRow>
          <FieldRow label="Style" hint="Optional — e.g. 'cinematic', 'anime', 'photorealistic'">
            <input
              type="text"
              value={style}
              onChange={(e) => setStyle(e.currentTarget.value)}
              placeholder="(none)"
              style={textInputStyle}
            />
          </FieldRow>
        </>
      )}

      {kind === "video" && (
        <>
          <TwoColRow>
            <FieldRow label="Duration">
              <SegmentControl
                value={videoDuration}
                options={DURATIONS.map((d) => ({ id: d.value, label: d.label }))}
                onChange={setVideoDuration}
              />
            </FieldRow>
            <FieldRow label="Aspect">
              <SegmentControl
                value={videoAspect}
                options={[
                  { id: "16:9", label: "16:9" },
                  { id: "9:16", label: "9:16" },
                ]}
                onChange={(v) => setVideoAspect(v as "16:9" | "9:16")}
              />
            </FieldRow>
          </TwoColRow>
          <FieldRow
            label="Resolution"
            hint="veo3.1 pricing is per-second — longer + higher res = more $"
          >
            <SegmentControl
              value={videoResolution}
              options={RESOLUTIONS.map((r) => ({ id: r.value, label: r.label }))}
              onChange={(v) => setVideoResolution(v as "720p" | "1080p")}
            />
          </FieldRow>
        </>
      )}

      {kind === "audio" && audioSubKind === "tts" && (
        <FieldRow label="Voice">
          <SegmentControl
            value={voice}
            options={TTS_VOICES.map((v) => ({ id: v, label: v }))}
            onChange={setVoice}
          />
        </FieldRow>
      )}

      {kind === "audio" && audioSubKind === "bgm" && (
        <FieldRow label="Duration (seconds)" hint="Approximate — lyria interprets this loosely">
          <NumberInput
            value={bgmDuration}
            onChange={setBgmDuration}
            min={10}
            max={180}
            step={5}
          />
        </FieldRow>
      )}

      {/* Actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: theme.space.space2,
          paddingTop: theme.space.space3,
          borderTop: `1px solid ${theme.color.borderWeak}`,
        }}
      >
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={canSubmit ? primaryBtnStyle : primaryBtnDisabledStyle}
        >
          <SparkleIcon size={13} />
          <span>{mode === "variant" ? "Generate variant" : "Generate"}</span>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant form — source is the frozen identity, user only types "what to change"
// ─────────────────────────────────────────────────────────────────────────────

function VariantForm({
  kind,
  source,
  onSubmit,
  onCancel,
}: {
  kind: AssetKind;
  source: NonNullable<GenerationRequest["source"]>;
  onSubmit: (req: GenerationRequest) => void;
  onCancel: () => void;
}) {
  const [changeDirection, setChangeDirection] = useState("");
  const canSubmit = changeDirection.trim().length > 0;

  const inheritedPrompt = source.sourcePrompt ?? "";
  const w = source.sourceWidth ?? null;
  const h = source.sourceHeight ?? null;
  const aspect = source.sourceAspectRatio ?? null;
  const duration = source.sourceDuration ?? null;
  const voice = source.sourceVoice ?? null;

  // Look up the live Asset + producing provenance edge from craft state so
  // the AssetInfoView can render the hero media, full metadata, and lineage.
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const sourceAsset = coreState.registry.get(source.id) ?? null;
  const sourceEdge = useMemo(() => {
    for (const e of coreState.provenance.edges.values()) {
      if (e.toAssetId === source.id) return e;
    }
    return null;
  }, [coreState.provenance.edges, source.id]);
  const parentAsset = sourceEdge?.fromAssetId
    ? (coreState.registry.get(sourceEdge.fromAssetId) ?? null)
    : null;

  const { add: addPending } = usePendingGenerations();

  const handleSubmit = () => {
    if (!canSubmit) return;
    const change = changeDirection.trim();
    const params: GenerationParams =
      kind === "image"
        ? {
            kind: "image",
            prompt: inheritedPrompt,
            changeDirection: change,
            aspectRatio: aspect ?? undefined,
            width: w ?? undefined,
            height: h ?? undefined,
          }
        : kind === "video"
          ? {
              kind: "video",
              prompt: inheritedPrompt,
              changeDirection: change,
              duration: duration ? `${Math.max(4, Math.round(duration))}s` : "4s",
              aspectRatio: (aspect === "16:9" || aspect === "9:16") ? aspect : "16:9",
            }
          : {
              kind: "audio",
              // Video tracks don't carry discriminator on asset; we infer
              // tts from the presence of a voice in metadata — same rule
              // sourceFromAsset used when it filled voice.
              subKind: voice ? "tts" : "bgm",
              prompt: inheritedPrompt,
              changeDirection: change,
              voice: voice ?? undefined,
              durationSeconds: duration ?? undefined,
            };
    addPending({
      kind,
      sourceAssetId: source.id,
      changeDirection: change,
    });
    onSubmit({ mode: "variant", params, source });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.space.space4,
        padding: theme.space.space5,
      }}
    >
      {sourceAsset ? (
        <div
          style={{
            padding: theme.space.space4,
            background: theme.color.surface0,
            border: `1px solid ${theme.color.borderWeak}`,
            borderRadius: theme.radius.base,
          }}
        >
          <AssetInfoView
            asset={sourceAsset}
            edge={sourceEdge}
            parentAsset={parentAsset}
          />
        </div>
      ) : (
        // Source asset missing from registry — fall back to the envelope
        // fields alone so the dialog still works.
        <div
          style={{
            padding: theme.space.space3,
            background: theme.color.surface0,
            border: `1px solid ${theme.color.borderWeak}`,
            borderRadius: theme.radius.base,
            fontSize: theme.text.sm,
            color: theme.color.ink2,
            fontStyle: "italic",
          }}
        >
          Source {source.name} — {inheritedPrompt || "(no recorded prompt)"}
        </div>
      )}

      <FieldRow
        label="Change direction"
        hint="What should be different from the source? The agent fuses this with the original prompt and reuses the source's dimensions / model."
      >
        <textarea
          autoFocus
          value={changeDirection}
          onChange={(e) => setChangeDirection(e.currentTarget.value)}
          placeholder={
            kind === "image"
              ? "e.g. 'make the background red', 'swap card copy to 额度见底', 'add film grain'"
              : kind === "video"
                ? "e.g. 'slower camera move', 'add a subtle push-in'"
                : "e.g. 'brighter mood', 'slower tempo', or for TTS: 'change phrasing to …'"
          }
          rows={4}
          style={textareaStyle}
        />
      </FieldRow>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: theme.space.space2,
          paddingTop: theme.space.space3,
          borderTop: `1px solid ${theme.color.borderWeak}`,
        }}
      >
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={canSubmit ? primaryBtnStyle : primaryBtnDisabledStyle}
        >
          <SparkleIcon size={13} />
          <span>Generate variant</span>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Field primitives
// ─────────────────────────────────────────────────────────────────────────────

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.space.space1,
      }}
    >
      <span
        style={{
          fontSize: theme.text.xs,
          color: theme.color.ink3,
          textTransform: "uppercase",
          letterSpacing: theme.text.trackingCaps,
          fontWeight: theme.text.weightSemibold,
        }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span
          style={{
            fontSize: theme.text.xs,
            color: theme.color.ink4,
            fontStyle: "italic",
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

function TwoColRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: theme.space.space3,
      }}
    >
      {children}
    </div>
  );
}

function SegmentControl<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        background: theme.color.surface2,
        border: `1px solid ${theme.color.borderWeak}`,
        borderRadius: theme.radius.base,
        opacity: disabled ? 0.55 : 1,
        pointerEvents: disabled ? "none" : "auto",
        flexWrap: "wrap",
      }}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            style={{
              background: active ? theme.color.accentSoft : "transparent",
              border: active
                ? `1px solid ${theme.color.accentBorder}`
                : "1px solid transparent",
              color: active ? theme.color.accentBright : theme.color.ink2,
              padding: `4px ${theme.space.space3}px`,
              borderRadius: theme.radius.sm,
              fontFamily: theme.font.ui,
              fontSize: theme.text.xs,
              fontWeight: active
                ? theme.text.weightSemibold
                : theme.text.weightMedium,
              letterSpacing: theme.text.trackingWide,
              cursor: disabled ? "not-allowed" : "pointer",
              transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = parseInt(e.currentTarget.value, 10);
        if (!Number.isNaN(v)) onChange(v);
      }}
      style={{
        ...textInputStyle,
        fontFamily: theme.font.numeric,
        fontVariantNumeric: "tabular-nums",
        width: 100,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared style objects
// ─────────────────────────────────────────────────────────────────────────────

const textareaStyle: React.CSSProperties = {
  background: theme.color.surface0,
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.base,
  color: theme.color.ink0,
  fontFamily: theme.font.ui,
  fontSize: theme.text.base,
  lineHeight: theme.text.lineHeightBody,
  letterSpacing: theme.text.trackingBase,
  padding: `${theme.space.space2}px ${theme.space.space3}px`,
  resize: "vertical",
  minHeight: 96,
  outline: "none",
};

const textInputStyle: React.CSSProperties = {
  background: theme.color.surface0,
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.base,
  color: theme.color.ink0,
  fontFamily: theme.font.ui,
  fontSize: theme.text.base,
  letterSpacing: theme.text.trackingBase,
  padding: `6px ${theme.space.space3}px`,
  outline: "none",
};

const primaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space.space2,
  height: 32,
  padding: `0 ${theme.space.space4}px`,
  background: theme.color.accentSoft,
  border: `1px solid ${theme.color.accentBorder}`,
  borderRadius: theme.radius.base,
  color: theme.color.accentBright,
  fontFamily: theme.font.ui,
  fontSize: theme.text.sm,
  fontWeight: theme.text.weightSemibold,
  letterSpacing: theme.text.trackingCaps,
  textTransform: "uppercase",
  cursor: "pointer",
  transition: `background ${theme.duration.quick}ms ${theme.easing.out}`,
};

const primaryBtnDisabledStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  opacity: 0.4,
  cursor: "not-allowed",
};

const secondaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 32,
  padding: `0 ${theme.space.space4}px`,
  background: "transparent",
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.base,
  color: theme.color.ink2,
  fontFamily: theme.font.ui,
  fontSize: theme.text.sm,
  fontWeight: theme.text.weightMedium,
  letterSpacing: theme.text.trackingBase,
  cursor: "pointer",
};

const closeBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  background: "transparent",
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.sm,
  color: theme.color.ink2,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
};
