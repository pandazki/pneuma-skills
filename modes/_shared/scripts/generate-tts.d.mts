// Type declarations for the untyped shared TTS script (generate-tts.mjs).
// Only the pure, importable helpers are declared — the CLI entry runs
// behind an isMain() guard and is not part of the module surface.

export function formatFromPath(p: string): "wav" | "ogg_opus" | "mp3";

/**
 * Exact audio length of a RIFF/WAVE byte buffer (data bytes / byte rate).
 * Returns null — never throws — when the bytes are not a readable WAV.
 */
export function wavDurationSeconds(bytes: Uint8Array): number | null;

/** The --json stdout line: path always, `seconds` only when measured. */
export function buildResultJson(path: string, seconds: number | null): string;

/**
 * The network half of the CLI with an injectable fetch: call fal, insist
 * on an audio URL, download it to `outputPath`, return the written bytes.
 * Throws on any failure — the CLI's top-level catch turns that into
 * exit 1 + stderr.
 */
export function synthesizeToFile(
  body: Record<string, unknown>,
  apiKey: string,
  outputPath: string,
  fetchImpl?: typeof fetch,
): Promise<Uint8Array<ArrayBuffer>>;
