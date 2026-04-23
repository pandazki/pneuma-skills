import type { ViewerNotification } from "../../../../core/types/viewer-contract.js";
import type { Asset } from "@pneuma-craft/react";

// ─────────────────────────────────────────────────────────────────────────────
// Structured generation requests
// ─────────────────────────────────────────────────────────────────────────────
//
// This module is the thin bridge between the viewer's generation UI
// (GenerationDialog + NodeShell variant button + AssetPanel create
// button) and the agent's script-calling machinery. The viewer never
// calls providers directly — it gathers intent in a rich form, then
// dispatches ONE structured ViewerNotification for the agent to act on.
//
// The notification message is intentionally dual-purpose:
//   1. A short, human-readable top line that reads well in the chat log
//   2. A fenced JSON payload the agent parses to get the exact params
//   3. A brief instruction block telling the agent which script to run
//      and how to edit project.json
//
// SKILL.md / references/workflows.md have the agent-facing handler
// spec. Don't duplicate that here.

export type AssetKind = "image" | "video" | "audio";

export type RequestMode = "create" | "variant";

export interface ImageParams {
  kind: "image";
  /** For create: the full prompt. For variant: the source's ORIGINAL
   *  prompt — read-only, kept as lineage identity. The user-facing
   *  instruction for the variant lives on `changeDirection`. */
  prompt: string;
  /** Variant-mode only: user's modification direction, e.g.
   *  "make the character older". Agent fuses this with `prompt`. */
  changeDirection?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  style?: string;
}

export interface VideoParams {
  kind: "video";
  prompt: string;
  changeDirection?: string;
  /** veo3.1 requires explicit duration — no default. Units: "4s" / "6s" / "8s". */
  duration: string;
  aspectRatio?: "16:9" | "9:16";
  resolution?: "720p" | "1080p";
  imageUrl?: string;
}

export interface AudioParams {
  kind: "audio";
  /** Audio has two sub-modes discriminated by which field is set. */
  subKind: "tts" | "bgm";
  /** For tts: narration text (create) / original text (variant).
   *  For bgm: music prompt (create) / original prompt (variant). */
  prompt: string;
  changeDirection?: string;
  voice?: string;
  durationSeconds?: number;
}

export type GenerationParams = ImageParams | VideoParams | AudioParams;

export interface GenerationRequest {
  mode: RequestMode;
  params: GenerationParams;
  /** Populated when mode === "variant". The new asset's provenance
   *  edge will carry fromAssetId = source.id and operation.type = "derive".
   *
   *  The source envelope is the *read-only identity* of the variant
   *  lineage: original prompt, model, and format knobs. User feedback
   *  from the Variant dialog flows in as `params.changeDirection`
   *  (kept separate from the frozen source fields) — the agent is
   *  responsible for fusing the two per skill guidance. */
  source?: {
    id: string;
    /** Human label / semantic id, e.g. "asset-panda-sad-v2". */
    name: string;
    /** URI of the source asset, so the agent can feed it as a reference
     *  to GPT-Image-2's edit mode when appropriate. */
    uri?: string | null;
    /** Prompt recorded on the source's provenance edge. */
    sourcePrompt?: string | null;
    /** Model id recorded on the source's provenance edge, e.g.
     *  "openai/gpt-image-2" or "bytedance/seedance-2.0/image-to-video". */
    sourceModel?: string | null;
    /** Image/video pixel dimensions from asset.metadata. Carried so the
     *  variant inherits exact size unless the change direction asks
     *  otherwise (critical for first/last-frame continuity). */
    sourceWidth?: number | null;
    sourceHeight?: number | null;
    /** Aspect ratio label recorded on the source's provenance edge
     *  params, if any — e.g. "16:9". */
    sourceAspectRatio?: string | null;
    /** Duration for video/audio variants. Seconds. */
    sourceDuration?: number | null;
    /** TTS voice on the source (if audio/tts). */
    sourceVoice?: string | null;
  };
}

/** Narrative field tucked onto params when mode === "variant". Only the
 *  user-facing intent ("make it grainier", "swap the red card for green")
 *  — not the original prompt, which stays on `source.sourcePrompt`. */
export type VariantChangeDirection = string;

// ─────────────────────────────────────────────────────────────────────────────
// Notification builder
// ─────────────────────────────────────────────────────────────────────────────

const TAG_CREATE = "clipcraft:create-asset";
const TAG_VARIANT = "clipcraft:generate-variant";

export function buildGenerationNotification(
  request: GenerationRequest,
): ViewerNotification {
  const tag = request.mode === "variant" ? TAG_VARIANT : TAG_CREATE;
  const summary = buildSummary(request);
  const payload = buildPayload(request);
  const instructions = buildInstructions(request);

  return {
    type: tag,
    severity: "warning",
    summary: `/${tag}`,
    message: `[${tag}] ${summary}

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

${instructions}`,
  };
}

function buildSummary(req: GenerationRequest): string {
  const kind = req.params.kind;
  if (req.mode === "variant" && req.source) {
    const change = truncate(req.params.changeDirection ?? "", 80);
    return `Generate a variant of ${req.source.name} (${req.source.id}) — ${kind} — change: "${change}"`;
  }
  const promptPreview = truncate(req.params.prompt, 80);
  return `Create a new asset — ${kind} — "${promptPreview}"`;
}

interface JsonPayload {
  mode: RequestMode;
  kind: AssetKind;
  sub_kind?: "tts" | "bgm";
  /** Present in create mode. In variant mode the original prompt lives
   *  on source.prompt and the user's intent on change_direction, so
   *  this field is omitted. */
  prompt?: string;
  /** Variant-mode only: user's modification direction. */
  change_direction?: string;
  params: Record<string, unknown>;
  source?: {
    asset_id: string;
    asset_name: string;
    /** Variant mode: the source's frozen identity the agent must honour
     *  unless `change_direction` explicitly overrides. */
    uri?: string | null;
    prompt?: string | null;
    model?: string | null;
    width?: number | null;
    height?: number | null;
    aspect_ratio?: string | null;
    duration?: number | null;
    voice?: string | null;
  };
  script: string;
  script_args: Record<string, string | number>;
  provenance_hint: {
    operation_type: "generate" | "derive";
    from_asset_id: string | null;
    agent_id: string;
    label: string;
    model: string;
  };
}

function buildPayload(req: GenerationRequest): JsonPayload {
  const isVariant = req.mode === "variant";
  const base: Omit<JsonPayload, "params" | "script" | "script_args" | "provenance_hint"> = {
    mode: req.mode,
    kind: req.params.kind,
  };
  if (isVariant) {
    base.change_direction = req.params.changeDirection ?? "";
  } else {
    base.prompt = req.params.prompt;
  }
  if (req.params.kind === "audio") {
    (base as JsonPayload).sub_kind = req.params.subKind;
  }
  if (req.source) {
    base.source = {
      asset_id: req.source.id,
      asset_name: req.source.name,
      uri: req.source.uri ?? null,
      prompt: req.source.sourcePrompt ?? null,
      model: req.source.sourceModel ?? null,
      width: req.source.sourceWidth ?? null,
      height: req.source.sourceHeight ?? null,
      aspect_ratio: req.source.sourceAspectRatio ?? null,
      duration: req.source.sourceDuration ?? null,
      voice: req.source.sourceVoice ?? null,
    };
  }
  const { params, script, scriptArgs, provenance } = resolveScriptForRequest(req);
  return {
    ...base,
    params,
    script,
    script_args: scriptArgs,
    provenance_hint: provenance,
  };
}

interface ResolvedScript {
  params: Record<string, unknown>;
  script: string;
  scriptArgs: Record<string, string | number>;
  provenance: JsonPayload["provenance_hint"];
}

function resolveScriptForRequest(req: GenerationRequest): ResolvedScript {
  const operationType = req.mode === "variant" ? "derive" : "generate";
  const fromAssetId = req.mode === "variant" ? (req.source?.id ?? null) : null;
  const p = req.params;

  switch (p.kind) {
    case "image": {
      // The shared generate_image.mjs takes the prompt as a POSITIONAL arg
      // (not a flag). script_args therefore carries only the flags; the
      // agent reads `prompt` from the top-level payload and passes it
      // positionally when invoking the script.
      //
      // --image-size vs --aspect-ratio: when exact dimensions are known
      // (e.g. the image is destined for a video first/last frame and
      // MUST match the composition's pixel size), we pass
      // `--image-size WxH` to pin fal.ai's output to those exact pixels.
      // Without width/height we fall back to `--aspect-ratio`, which
      // routes to a fal preset (landscape_16_9, portrait_4_3, etc.) —
      // good enough for standalone illustrations, wrong for video anchors.
      const aspectRatio = p.aspectRatio ?? deriveAspectRatio(p.width, p.height) ?? "1:1";
      const scriptArgs: Record<string, string | number> = {
        "--quality": "high",
      };
      if (p.width && p.height) {
        scriptArgs["--image-size"] = `${p.width}x${p.height}`;
      } else {
        scriptArgs["--aspect-ratio"] = aspectRatio;
      }
      // `params.style` is a free-form direction note (e.g. "warm 1970s
      // 35mm"). The agent folds it into the prompt rather than passing
      // a flag — the shared script has no style flag, and a freeform
      // hint embedded in the prompt is what actually steers GPT-Image-2.
      return {
        params: {
          prompt: p.prompt,
          aspect_ratio: aspectRatio,
          width: p.width ?? null,
          height: p.height ?? null,
          style: p.style ?? null,
        },
        script: "scripts/generate_image.mjs",
        scriptArgs,
        provenance: {
          operation_type: operationType,
          from_asset_id: fromAssetId,
          agent_id: "clipcraft-imagegen",
          label: "openai/gpt-image-2",
          model: "openai/gpt-image-2",
        },
      };
    }
    case "video": {
      // Seedance 2 is the default video model now. With no image the
      // script routes to `bytedance/seedance-2.0/reference-to-video`
      // called with zero refs (= pure t2v); with one image it routes
      // to `bytedance/seedance-2.0/image-to-video`. veo3.1 is a
      // fallback the agent can request via `--model veo3.1` but the
      // default hint is seedance so the provenance edge reflects
      // what actually ran.
      const scriptArgs: Record<string, string | number> = {
        "--prompt": p.prompt,
        "--duration": p.duration,
      };
      if (p.aspectRatio) scriptArgs["--aspect-ratio"] = p.aspectRatio;
      if (p.resolution) scriptArgs["--resolution"] = p.resolution;
      const useFromImage = !!p.imageUrl;
      if (useFromImage) {
        scriptArgs["--image-url"] = p.imageUrl as string;
      }
      const modelId = useFromImage
        ? "bytedance/seedance-2.0/image-to-video"
        : "bytedance/seedance-2.0/reference-to-video";
      return {
        params: {
          prompt: p.prompt,
          duration: p.duration,
          aspect_ratio: p.aspectRatio ?? "auto",
          resolution: p.resolution ?? "720p",
          image_url: p.imageUrl ?? null,
        },
        script: useFromImage
          ? "scripts/generate-video.mjs from-image"
          : "scripts/generate-video.mjs",
        scriptArgs,
        provenance: {
          operation_type: operationType,
          from_asset_id: fromAssetId,
          agent_id: "clipcraft-videogen",
          label: modelId,
          model: modelId,
        },
      };
    }
    case "audio": {
      const isTts = p.subKind === "tts";
      const scriptArgs: Record<string, string | number> = isTts
        ? { "--text": p.prompt }
        : { "--prompt": p.prompt };
      if (isTts && p.voice) scriptArgs["--voice"] = p.voice;
      if (!isTts && p.durationSeconds) scriptArgs["--duration"] = p.durationSeconds;
      return {
        params: {
          sub_kind: p.subKind,
          prompt: p.prompt,
          voice: p.voice ?? null,
          duration_seconds: p.durationSeconds ?? null,
        },
        script: isTts ? "scripts/generate-tts.mjs" : "scripts/generate-bgm.mjs",
        scriptArgs,
        provenance: {
          operation_type: operationType,
          from_asset_id: fromAssetId,
          agent_id: isTts ? "clipcraft-tts" : "clipcraft-bgm",
          label: isTts ? "openai/gpt-audio" : "google/lyria-3-pro-preview",
          model: isTts ? "openai/gpt-audio" : "google/lyria-3-pro-preview",
        },
      };
    }
  }
}

function buildInstructions(req: GenerationRequest): string {
  const isImage = req.params.kind === "image";
  const runStep = isImage
    ? "4. Run the script in `script` — prompt is POSITIONAL, not a flag. Example: `node <script> \"<prompt>\" --aspect-ratio ... --quality ... --output-dir assets/image --filename-prefix <semantic-id>`. Fold `params.style` (if set) into the prompt text rather than a flag. Use `--image-urls <url>` to switch GPT-Image-2 to edit mode (reference-driven continuation, first/last-frame pairs, character-on-background swaps, etc.)."
    : "4. Run the script referenced in `script` with the flags in `script_args`. Append `--output <path>`.";
  if (req.mode === "variant") {
    // Variant is a fundamentally different shape: the user did NOT write a
    // prompt. They wrote a *change direction* ("make the card red", "add
    // grain"). The agent must synthesize the new prompt by fusing the
    // frozen source prompt with the user's change direction, and must
    // preserve source dimensions/model unless the change direction
    // explicitly asks for a different shape or format.
    const lines = [
      "Handling (variant):",
      "1. Parse the JSON block above. Note the shape is *different* from create:",
      "   - `source` holds the lineage identity: original prompt, model, exact pixel dimensions, aspect ratio.",
      "   - `change_direction` is the user's modification intent. It is NOT a prompt — it is a delta.",
      "2. Synthesize the final prompt by fusing `source.prompt` with `change_direction`:",
      "   - Keep the source's subject, setting, lighting, typography language, and overall composition — those are what make this a variant *of* that asset.",
      "   - Apply only what `change_direction` calls for. If it says \"add grain\", the prompt stays identical plus a grain instruction; if it says \"swap card copy to 额度见底\", only the copy changes.",
      "   - Prefer additive edits. Do not rewrite the whole prompt unless the change direction explicitly asks for a wholesale redo.",
      "3. Honor source format:",
      "   - Run the script with the exact same `--image-size` / `--duration` / `--aspect-ratio` as the source unless the change direction explicitly asks for a different size / duration.",
      "   - For images, consider `--image-urls <source.uri>` to route through GPT-Image-2's edit mode — that produces the tightest family resemblance for small-delta variants (add grain, text swap, minor swap-outs). Pure t2v without the reference is fine when the change direction is more structural (different composition, different character).",
      "4. Pick a semantic asset id — never a UUID. Variants of `asset-panda-sad-v1` might be `asset-panda-sad-v2`, `asset-panda-sad-v3`, etc.",
      "5. Pick a relative output path under the matching `assets/{kind}/` directory.",
      runStep,
      "6. Edit `project.json`: add the new asset to `assets[]` and a new `derive` edge to `provenance[]` using the `provenance_hint` fields (keep `operation.type` exactly as given, `fromAssetId` = source asset id).",
      "7. Both source and the new variant stay in the registry so the variant switcher can show them side by side.",
      "8. Do NOT add a clip to any track — the user clicks USE THIS in the dive canvas to bind the new asset to the originating clip.",
      "",
      "The viewer auto-hydrates once `project.json` is saved.",
    ];
    return lines.join("\n");
  }
  const base = [
    "Handling:",
    "1. Parse the JSON block above.",
    "2. Pick a semantic asset id (e.g. `asset-forest-sunset`) — never a random UUID.",
    "3. Pick a relative output path under the matching `assets/{kind}/` directory.",
    runStep,
    "5. Edit `project.json`: add the new asset to `assets[]` and a new edge to `provenance[]` using the `provenance_hint` fields (keep `operation.type` exactly as given, `fromAssetId` null for create).",
    "6. Do NOT add a clip to any track — the viewer gives the user a chance to pick where to place it separately.",
    "",
    "The viewer will auto-hydrate once `project.json` is saved. No reload needed.",
  ];
  return base.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

const SUPPORTED_ASPECT_RATIOS: Array<{ ratio: number; label: string }> = [
  { ratio: 21 / 9, label: "21:9" },
  { ratio: 16 / 9, label: "16:9" },
  { ratio: 3 / 2, label: "3:2" },
  { ratio: 4 / 3, label: "4:3" },
  { ratio: 5 / 4, label: "5:4" },
  { ratio: 1, label: "1:1" },
  { ratio: 4 / 5, label: "4:5" },
  { ratio: 3 / 4, label: "3:4" },
  { ratio: 2 / 3, label: "2:3" },
  { ratio: 9 / 16, label: "9:16" },
];

function deriveAspectRatio(
  width: number | undefined,
  height: number | undefined,
): string | null {
  if (!width || !height) return null;
  const target = width / height;
  let best = SUPPORTED_ASPECT_RATIOS[0];
  let bestDist = Math.abs(Math.log(target / best.ratio));
  for (const option of SUPPORTED_ASPECT_RATIOS) {
    const dist = Math.abs(Math.log(target / option.ratio));
    if (dist < bestDist) {
      best = option;
      bestDist = dist;
    }
  }
  return best.label;
}

// Tiny adapter used by callers that have a craft `Asset` plus the
// provenance edge that produced it. Extracts the frozen-identity
// fields we want to carry into the variant dialog so the source is
// fully self-describing (prompt, model, dimensions, aspect) — the
// variant UI displays these read-only and the agent relies on them
// when synthesizing the new prompt/script args.
export function sourceFromAsset(
  asset: Asset | null | undefined,
  sourcePrompt: string | null,
  sourceModel: string | null,
  sourceAspectRatio: string | null = null,
): GenerationRequest["source"] | undefined {
  if (!asset) return undefined;
  const md = (asset.metadata ?? {}) as Record<string, unknown>;
  const width = typeof md.width === "number" ? md.width : null;
  const height = typeof md.height === "number" ? md.height : null;
  const duration = typeof md.duration === "number" ? md.duration : null;
  const voice = typeof md.voice === "string" ? md.voice : null;
  return {
    id: asset.id,
    name: asset.name ?? asset.id,
    uri: asset.uri ?? null,
    sourcePrompt,
    sourceModel,
    sourceWidth: width,
    sourceHeight: height,
    sourceAspectRatio: sourceAspectRatio ?? deriveAspectRatio(width ?? undefined, height ?? undefined),
    sourceDuration: duration,
    sourceVoice: voice,
  };
}
