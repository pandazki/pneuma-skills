/**
 * Type surface of image-to-3d.mjs — the resumable fal image-to-3D job file.
 * Exists so `modes/lucid/__tests__/` can pin it under `tsc --noEmit` (the
 * skill directory itself is shipped, not compiled).
 */

/** Where the shared fal transport was resolved from: installed sibling or repo. */
export declare const FAL_QUEUE_URL: string;

/**
 * Every call this script makes: a string URL and a plain init object. It
 * never passes a `Request`, so a test double can take exactly this.
 */
export interface FalFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: string;
  signal?: AbortSignal;
}

export type FalFetch = (url: string, init: FalFetchInit) => Promise<Response>;

/** The container a collected job landed in. `quad` topology returns FBX. */
export type ModelFormat = "glb" | "fbx";

/** One reported job. `check` fills only `id`, `state`, `request_id`, `error`. */
export interface JobRow {
  id: string;
  state?: string;
  /** Set once a file has landed: what it actually is. */
  format?: ModelFormat;
  /** Echo of `input.auto_size` — whether the model is in real-world metres. */
  auto_size?: boolean;
  /** The path written, which is the requested one unless the format differs. */
  output?: string;
  request_id?: string;
  bytes?: number;
  error?: string;
  error_stage?: string;
  error_detail?: string;
  connection_error?: string;
}

export interface RunBatchOptions {
  /** Independent jobs in flight (default 4). */
  concurrency?: number;
  /** Injected transport; nothing else in this script reaches the network. */
  fetchFn?: FalFetch;
  /** fal API key. Discovered through `loadFalKey` when omitted. */
  key?: string;
  /** Back-off between download attempts, injected so a test does not spend it. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Side notes that are not job state; defaults to stderr. */
  onNote?: (message: string) => void;
}

export declare function runBatch(
  command: "check" | "submit" | "collect",
  filename: string,
  options?: RunBatchOptions,
): Promise<JobRow[]>;

/** One preset: the endpoint and the input the skill quotes for that role. */
export interface Recipe {
  summary: string;
  endpoint: string;
  multiview?: boolean;
  input: Record<string, string | number | boolean>;
}

/** The named presets `--help` prints and `recipe <name>` renders. */
export declare const RECIPES: Record<string, Recipe>;

/** One preset as a pasteable job, with `<placeholder>` id, image and output. */
export declare function recipeJob(name: string): {
  id: string;
  endpoint: string;
  image?: string;
  images?: string[];
  output: string;
  input: Record<string, string | number | boolean>;
};
