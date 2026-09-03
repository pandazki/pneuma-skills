/**
 * Type surface of segment-lib.mjs — the pure half of the plotwise play
 * loop. Exists so `modes/plotwise/__tests__/` can pin the library under
 * `tsc --noEmit` (the skill directory itself is excluded from the
 * typecheck because it is shipped, not compiled).
 */

export interface StyleRecipe {
  recipe: string;
  narration: "on-camera" | "voiceover";
}

export interface EvidenceRef {
  kind: string;
  file?: string;
  url?: string;
  note: string;
  /** Set when `file` does not exist under the set directory. */
  missing?: boolean;
}

export interface OutlineBeatLike {
  id?: string;
  title?: string;
  summary?: string;
  tier?: string;
  evidence?: unknown;
  figures?: unknown;
  sources?: unknown;
}

export interface RefPlanEntry {
  file: string;
  role?: "first-frame" | "last-frame";
  job: "continuity" | "style-anchor" | "character" | "figure";
  note?: string;
}

export interface RefPlan {
  refs: RefPlanEntry[];
  lines: string[];
}

export interface GateResult {
  ok: boolean;
  bound: EvidenceRef[];
  missing: string[];
}

export interface CourseNodeLike {
  parent?: string;
  beat?: string;
  kind?: string;
  choiceLabel?: string;
  children?: Array<{ nodeId: string; label: string }>;
  status?: string;
  video?: { file: string; duration: number };
  [key: string]: unknown;
}

export interface CourseLike {
  title?: string;
  topic?: string;
  goal?: string;
  language?: string;
  style?: {
    id?: string;
    status?: string;
    name?: string;
    recipe?: string;
    rationale?: string;
    narration?: string;
    sample?: { image?: string; video?: string; hook?: string; error?: string };
    userRefs?: string[];
    refImages?: string[];
  };
  outline?: OutlineBeatLike[];
  rootNode?: string;
  path?: string[];
  nodes?: Record<string, CourseNodeLike>;
  summaryFile?: string;
  [key: string]: unknown;
}

export interface NodeSpec {
  id: string;
  parent?: string;
  beat?: string;
  kind?: string;
  choiceLabel?: string;
  status?: string;
  video?: { file: string; duration: number } | null;
  /** ISO time the producer started; null clears. */
  startedAt?: string | null;
  /** "script" | "shoot" | "qa" while generating; null clears. */
  phase?: string | null;
  /** Why the last production failed; null clears. */
  error?: string | null;
}

export interface LockOptions {
  timeoutMs?: number;
  pollMs?: number;
  staleMs?: number;
}

export const FIGURE_EXTS: Set<string>;
export const FIGURE_KINDS: Set<string>;
export const MAX_REFS: number;
export const QA_AUTO_PASS: number;
export const QA_AUTO_FAIL: number;
export const QA_KEYLESS_PASS: number;
export const DEFAULT_MODEL: string;
export const JUDGE_SYSTEM: string;

export function parseStyleCatalog(markdown: string): Map<string, StyleRecipe>;
export function resolveStyle(
  course: CourseLike | null | undefined,
  stylesMarkdown?: string | null,
): {
  id: string;
  name: string;
  recipe: string;
  narration: "on-camera" | "voiceover";
  status: string;
  fromCatalog: boolean;
};
export function detectLanguage(text: string | null | undefined): "zh" | "ja" | "en";

export const SPEECH_OVERRUN: number;
export function speechBudgetUnits(language: string, seconds: number): number;
export function speechUnits(text: string | null | undefined, language: string): number;

export const QA_COVERAGE_PASS: number;
export const QA_COVERAGE_TOLERANCE: number;
export function normalizeForCompare(text: string | null | undefined): string;
/** "24" → 二十四, "0.5" → 零点五 — a run of digits as it is spoken. */
export function digitsToChinese(run: string | number): string;
export function levenshtein(a: string, b: string): number;
export function similarity(script: string, transcript: string): number;
export function compareNarration(script: string, transcript: string): { similarity: number; coverage: number };
export function autoVerdict(sim: number, coverage?: number): "pass" | "fail" | null;

export function readJsonLenient(path: string): unknown;
export function normalizeEvidenceList(raw: unknown): EvidenceRef[];
export function beatEvidence(beat: OutlineBeatLike | null | undefined): EvidenceRef[];
export function resolveEvidence(input: {
  setDir: string;
  beat?: OutlineBeatLike | null;
  nodeId?: string;
  extraFiles?: string[];
}): EvidenceRef[];
export function shootableFigures(evidence: EvidenceRef[]): EvidenceRef[];
export function checkFigureGate(needsFigureRefs: string[] | undefined, figures: EvidenceRef[]): GateResult;

export type ShootEndpoint = "image" | "reference" | "text";

export function chooseEndpoint(input?: {
  requested?: "auto" | ShootEndpoint;
  anchorFile?: string | null;
  characters?: string[];
  figures?: Array<{ file: string; note?: string }>;
}): ShootEndpoint;

export function describeAvailableRefs(input?: {
  anchorKind?: "continuity" | "style-anchor" | null;
  characters?: string[];
  figures?: Array<{ file: string; note?: string }>;
}): string[];
export function injectBindings(prompt: string, sentences: string[]): string;

export function planRefs(input: {
  anchorFile?: string | null;
  anchorKind?: "continuity" | "style-anchor";
  characters?: string[];
  figures?: Array<{ file: string; note?: string }>;
  max?: number;
  /** "image": first/last keyframes only (the chain and one figure). */
  mode?: "reference" | "image";
}): RefPlan;

export function readCourse(setDir: string): CourseLike;
export function upsertNode<T extends CourseLike>(course: T, spec: NodeSpec): T;
export function appendWatched<T extends CourseLike>(course: T, id: string): T;
export function withCourseLock<T extends CourseLike = CourseLike>(
  setDir: string,
  mutate: (course: T) => T | void,
  options?: LockOptions,
): T;

export function loadEnvKey(name: string, options?: { skillRoot?: string; cwd?: string }): string | null;
export function readEnvValue(content: string, name: string): string | null;

export function chatJson(input: {
  key: string;
  model?: string;
  system: string;
  user: string;
  temperature?: number;
}): Promise<Record<string, unknown>>;
export function judgeNarration(input: {
  key: string;
  model?: string;
  script: string;
  transcript: string;
  language: string;
  similarity?: number;
  coverage?: number;
}): Promise<{ verdict: "pass" | "fail"; reason: string }>;

export function extractLastFrame(videoPath: string, outPath: string): boolean;
export const REF_ASPECT_MIN: number;
export const REF_ASPECT_MAX: number;
export function imageSize(path: string): { w: number; h: number } | null;
export function probeStreams(videoPath: string): {
  video: { codec: string; width: number; height: number; fps: string } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
} | null;
export function probeDuration(videoPath: string): number | null;
