export const PRICES: {
  asOf: string;
  currency: string;
  basis: string;
  fal: Record<string, { base?: number; texture?: number; hdTexture?: number; detailedGeometry?: number; quad?: number; flat?: number }>;
  imageGeneration: { perImage: number };
  tokensPer1M: Record<string, { input: number; cachedInput: number; output: number }>;
};
