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
  prompt: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  style?: string;
}

export interface VideoParams {
  kind: "video";
  prompt: string;
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
  /** For tts: narration text. For bgm: music prompt. */
  prompt: string;
  voice?: string;
  durationSeconds?: number;
}

export type GenerationParams = ImageParams | VideoParams | AudioParams;

export interface GenerationRequest {
  mode: RequestMode;
  params: GenerationParams;
  /** Populated when mode === "variant". The new asset's provenance
   *  edge will carry fromAssetId = source.id and operation.type = "derive". */
  source?: {
    id: string;
    name: string;
    /** Current prompt on the source's provenance edge, if any. Used to
     *  seed the form, NOT to constrain the new variant. */
    sourcePrompt?: string | null;
    /** Source operation model name for continuity, e.g. "fal-ai/veo3.1". */
    sourceModel?: string | null;
  };
}

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
  const verb = req.mode === "variant" ? "Generate a variant" : "Create a new asset";
  const kind = req.params.kind;
  const promptPreview = truncate(req.params.prompt, 80);
  if (req.mode === "variant" && req.source) {
    return `${verb} of ${req.source.name} (${req.source.id}) — ${kind} — "${promptPreview}"`;
  }
  return `${verb} — ${kind} — "${promptPreview}"`;
}

interface JsonPayload {
  mode: RequestMode;
  kind: AssetKind;
  sub_kind?: "tts" | "bgm";
  prompt: string;
  params: Record<string, unknown>;
  source?: {
    asset_id: string;
    asset_name: string;
    model?: string | null;
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
  const base: Omit<JsonPayload, "params" | "script" | "script_args" | "provenance_hint"> = {
    mode: req.mode,
    kind: req.params.kind,
    prompt: req.params.prompt,
  };
  if (req.params.kind === "audio") {
    (base as JsonPayload).sub_kind = req.params.subKind;
  }
  if (req.source) {
    base.source = {
      asset_id: req.source.id,
      asset_name: req.source.name,
      model: req.source.sourceModel ?? null,
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
      const aspectRatio = p.aspectRatio ?? deriveAspectRatio(p.width, p.height) ?? "1:1";
      const scriptArgs: Record<string, string | number> = {
        "--aspect-ratio": aspectRatio,
        "--quality": "high",
      };
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
  const base = [
    "Handling:",
    "1. Parse the JSON block above.",
    "2. Pick a semantic asset id (e.g. `asset-forest-sunset`) — never a random UUID.",
    "3. Pick a relative output path under the matching `assets/{kind}/` directory.",
    runStep,
    "5. Edit `project.json`: add the new asset to `assets[]` and a new edge to `provenance[]` using the `provenance_hint` fields (keep `operation.type` exactly as given, set `fromAssetId` from the hint — null for create, source asset id for variant).",
    "6. Do NOT add a clip to any track — the viewer gives the user a chance to pick where to place it separately.",
  ];
  if (req.mode === "variant") {
    base.push(
      "7. This is a DERIVE operation — the new asset is a sibling of the source. Both should remain in the registry so the variant switcher can show them.",
    );
  }
  base.push(
    "",
    "The viewer will auto-hydrate once `project.json` is saved. No reload needed.",
  );
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

// Tiny adapter used by callers that have a craft `Asset` and want to
// convert its declared provenance (if any) into the `source` envelope
// expected by `GenerationRequest`. Keeps the bridge call site tight.
export function sourceFromAsset(
  asset: Asset | null | undefined,
  sourcePrompt: string | null,
  sourceModel: string | null,
): GenerationRequest["source"] | undefined {
  if (!asset) return undefined;
  return {
    id: asset.id,
    name: asset.name ?? asset.id,
    sourcePrompt,
    sourceModel,
  };
}
