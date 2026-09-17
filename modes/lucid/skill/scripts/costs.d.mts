export interface FalJobRecord {
  id?: string;
  endpoint?: string;
  state?: string;
  submitted_at?: string;
  input?: Record<string, unknown>;
}
export interface TokenUsageCounts {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
}
export interface RoundWindow {
  index: number | null;
  score: number | null;
  fal: { count: number; usd: number };
  images: { count: number; usd: number };
}
export interface CostSummary {
  asOf: string;
  basis: string;
  currency: string;
  total: number;
  fal: { count: number; usd: number; unpriced: string[]; jobs: Array<{ id: string | null; endpoint: string | null; state: string | null; usd: number | null }> };
  images: { count: number; usd: number };
  tokens: { usage: TokenUsageCounts | null; model: string; usd: number | null; priced: boolean };
  byRound: RoundWindow[];
}
export function estimateFalJob(job: FalJobRecord, prices?: unknown): number | null;
export function estimateTokens(usage: TokenUsageCounts | null | undefined, model: string, prices?: unknown): number | null;
export function summarizeCosts(args?: {
  jobs?: FalJobRecord[];
  imageTimestamps?: number[];
  tokenUsage?: TokenUsageCounts | null;
  model?: string;
  rounds?: Array<{ index: number; at: string; verdict?: { total: number } | null }>;
  prices?: unknown;
}): CostSummary;
