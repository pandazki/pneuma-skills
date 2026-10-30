/**
 * Types for `rig-3d.mjs` — the script stays plain ESM, the declaration keeps
 * `tsc --noEmit` honest for the TypeScript suites that import it.
 */

export declare const FAL_QUEUE_URL: string;
export declare const MODEL_ENDPOINT: "meshy/v7.1/image-to-3d";
export declare const ANIMATE_ENDPOINT: "fal-ai/meshy/rigging/multi-animation";
export declare const PRICES: Readonly<{ model: number; animate: number; checked: string }>;
export declare const MODEL_TYPES: string[];
export declare const POSES: Readonly<Record<"a-pose" | "t-pose" | "none", string>>;
export declare const DEFAULT_HEIGHT_M: number;
export declare const DEFAULT_POLYCOUNT: number;
export declare const POLYCOUNT_MIN: number;
export declare const POLYCOUNT_MAX: number;
export declare const MAX_ACTIONS: number;
export declare const ACTION_ID_MAX: number;
export declare const DEFAULT_DEADLINE_S: number;

/** One curated entry of Meshy's animation library. */
export interface CatalogAction {
  readonly id: string;
  readonly label: string;
  /** Meshy library id. */
  readonly action: number;
  /** The action's name in Meshy's library. */
  readonly meshy: string;
}

/** An action as the script carries it: catalog name, or `action-<n>` for a raw id. */
export interface ResolvedAction {
  id: string;
  label: string;
  action: number;
}

export declare const ACTIONS: readonly CatalogAction[];

/** Names and/or raw ids → actions, de-duplicated; throws on unknown, out of range, empty or > 10. */
export declare function resolveActions(list: string | number | ReadonlyArray<string | number>): ResolvedAction[];

export interface ModelBodyOptions {
  image?: string;
  height?: number | string;
  polycount?: number | string;
  modelType?: string;
  pose?: string;
}

export interface ModelBody {
  image_url: string;
  enable_rigging: true;
  rigging_height_meters: number;
  pose_mode: "a-pose" | "t-pose" | "";
  should_texture: true;
  enable_pbr: false;
  target_polycount: number;
  model_type: string;
}

export declare function buildModelBody(options?: ModelBodyOptions): ModelBody;

export interface AnimateBody {
  model_url: string;
  animation_action_ids: number[];
  height_meters: number;
}

export declare function buildAnimateBody(options?: {
  modelUrl?: string;
  actions?: string | number | ReadonlyArray<string | number | ResolvedAction>;
  height?: number | string;
}): AnimateBody;

export interface OutputFile {
  role: "model" | "mesh" | "thumbnail" | "animation";
  name: string;
  /** Null when the response did not carry this file. */
  url: string | null;
  /** A required file that does not land fails the run. */
  required: boolean;
  animation?: { id: string; label: string; action?: number };
}

export declare function outputFiles(
  data: unknown,
  options?: { actions?: ReadonlyArray<string | number | ResolvedAction> },
): OutputFile[];

export interface StepCost {
  usd: number;
  estimate: true;
  basis: string;
  checked: string;
}

export declare function stepCost(step: "model" | "animate"): StepCost;
export declare function costLine(cost: StepCost, endpoint: string): string;

export declare function uploadGlb(
  path: string,
  options: { key: string; fetchImpl?: typeof fetch; signal?: AbortSignal; onNote?: (message: string) => void },
): Promise<string>;

export declare function checkModelInput(model: unknown): "url" | "file";

export interface MissingFile {
  role: OutputFile["role"];
  file: string;
  url: string | null;
  reason: string;
  id?: string;
}

export interface SavedAnimation {
  id: string;
  label: string;
  action?: number;
  file: string;
}

export interface ModelReport {
  step: "model";
  provider: "meshy-7.1";
  endpoint: string;
  image: string;
  files: { model: string | null; mesh: string | null; thumbnail: string | null; animations: SavedAnimation[] };
  remote: { model_url: string | null; rig_task_id: string | null };
  missing: MissingFile[];
  cost: StepCost;
  request_id?: string;
}

export interface AnimateReport {
  step: "animate";
  provider: "meshy";
  endpoint: string;
  model: string;
  files: { model: string | null; animations: SavedAnimation[] };
  remote: { model_url: string; rig_task_id: string | null };
  missing: MissingFile[];
  cost: StepCost;
  request_id?: string;
}

export interface RigDeps {
  runJob?: (options: any) => Promise<{ data: any; requestId?: string }>;
  download?: (url: string, options?: { signal?: AbortSignal; attempts?: number }) => Promise<Uint8Array>;
}

export declare function rigModel(
  options: ModelBodyOptions & { out?: string; apiKey?: string | null; signal?: AbortSignal; deadlineMs?: number },
  deps?: RigDeps,
): Promise<{ report: ModelReport; failed: boolean }>;

export declare function animateModel(
  options: {
    model?: string;
    actions?: string | ReadonlyArray<string | number>;
    out?: string;
    height?: number | string;
    apiKey?: string | null;
    signal?: AbortSignal;
    deadlineMs?: number;
  },
  deps?: RigDeps & { upload?: (path: string, options: { key: string; signal?: AbortSignal }) => Promise<string> },
): Promise<{ report: AnimateReport; failed: boolean }>;

export declare function main(argv?: string[]): Promise<number>;
