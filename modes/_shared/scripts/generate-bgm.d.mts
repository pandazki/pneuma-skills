// Type declarations for the untyped shared BGM script (generate-bgm.mjs).
// Lyria 3 Pro on OpenRouter, over SSE. Clipcraft still carries its own copy
// of the same script; this one is the shared surface backlot installs.

export const BGM_MODEL: string;
export const BGM_ENDPOINT: string;
export const BGM_TIMEOUT_MS: number;
export const HELP: string;

/**
 * `OPENROUTER_API_KEY` from the environment, then from the `.env` every
 * shared script discovers the same way (skill root, then walking up from
 * cwd). Null when there is none; never printed.
 */
export function loadOpenRouterKey(): string | null;

export interface BgmRequestBody {
  model: string;
  modalities: string[];
  messages: Array<{ role: string; content: string }>;
}

/**
 * The body one brief is sent as. `duration` becomes a HINT inside the
 * prompt — Lyria has no duration parameter on OpenRouter.
 */
export function buildBgmRequest(input: { prompt: string; duration?: string | number; model?: string }): BgmRequestBody;

export interface BgmStreamResult {
  /** Concatenated `delta.audio.data`, still base64. */
  audioBase64: string;
  /** What the model said in text — the only explanation when no audio came. */
  textContent: string;
  transcript: string;
}

export function streamAudioRequest(
  body: BgmRequestBody,
  apiKey: string,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<BgmStreamResult>;

export interface BgmResult {
  path: string;
  bytes: number;
  model: string;
}

/**
 * Generate one music bed and write it to `output` (atomically, through a
 * `.tmp`). Throws — never exits — so an in-process caller owns the failure.
 */
export function generateBgm(
  options: {
    prompt: string;
    output: string;
    /** Seconds, as a hint; `duration` is the same field under the CLI's name. */
    seconds?: string | number;
    duration?: string | number;
    model?: string;
    apiKey?: string | null;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
  injected?: { fetchImpl?: typeof fetch },
): Promise<BgmResult>;

export function main(argv?: string[]): Promise<number>;
