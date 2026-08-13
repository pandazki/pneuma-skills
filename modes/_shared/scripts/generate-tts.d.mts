// Type declarations for the untyped shared TTS script (generate-tts.mjs).
// Only the pure, importable helpers are declared — the CLI entry runs
// behind an isMain() guard and is not part of the module surface.

export function formatFromPath(p: string): "wav" | "ogg_opus" | "mp3";

/** How one vendor differs from the other, in fields rather than in code. */
export interface TtsModel {
  /** The fal endpoint this voice answers on. */
  url: string;
  /** Used when the caller names no `--voice`. */
  defaultVoice: string;
  /** What it can actually return — the gate `resolveFormat` refuses on. */
  formats: readonly string[];
  /**
   * How this vendor spells a language. Each rejects the other's spelling,
   * so a value is checked locally rather than at the far end of a request:
   * a closed published enum (`values`) or an open display-name shape
   * (`check`).
   */
  language:
    | { kind: "code"; values: readonly string[]; check?: undefined }
    | { kind: "display-name"; check: RegExp; values?: undefined };
  supports: { temperature: boolean; speed: boolean };
  /** The vendor's request body for one utterance. */
  body(options: {
    text: string;
    voice: string;
    format: string;
    style?: string | undefined;
    language?: string | undefined;
    temperature?: number | null;
    speed?: number | null;
  }): Record<string, unknown>;
}

export const MODELS: Record<string, TtsModel>;
export const DEFAULT_MODEL: string;

/**
 * The format this model will return for that output path, or a thrown
 * refusal naming the mismatch — so a vendor with no WAV can never write
 * mp3 bytes into a file called `.wav`.
 */
export function resolveFormat(model: TtsModel, outputPath: string): string;

/**
 * Exact audio length of a RIFF/WAVE byte buffer (data bytes / byte rate).
 * Returns null — never throws — when the bytes are not a readable WAV.
 */
export function wavDurationSeconds(bytes: Uint8Array): number | null;

/**
 * Exact audio length of an MP3 buffer: a Xing/Info frame count when the
 * stream carries one, otherwise the CBR bitrate over the audio bytes with
 * ID3 tags excluded. Returns null — never throws, never estimates.
 */
export function mp3DurationSeconds(bytes: Uint8Array | null): number | null;

/** Whichever reader can read these bytes; null when neither can. */
export function audioDurationSeconds(bytes: Uint8Array | null): number | null;

/** The --json stdout line: path always, `seconds` only when measured. */
export function buildResultJson(path: string, seconds: number | null): string;

/**
 * The network half of the CLI with an injectable fetch: call the chosen
 * model, insist on an audio URL, download it to `outputPath`, return the
 * written bytes. Throws on any failure — the CLI's top-level catch turns
 * that into exit 1 + stderr.
 */
export function synthesizeToFile(
  model: TtsModel,
  body: Record<string, unknown>,
  apiKey: string,
  outputPath: string,
  fetchImpl?: typeof fetch,
): Promise<Uint8Array<ArrayBuffer>>;
