import { useMemo } from "react";
import { usePneumaCraftStore } from "@pneuma-craft/react";

export interface AssetGenerationMetadata {
  operationType: string;
  actor: "human" | "agent";
  agentId?: string;
  label?: string;
  prompt?: string;
  model?: string;
  params?: Record<string, unknown>;
}

/**
 * Look up the incoming provenance edge for an asset and extract the
 * generation metadata recorded on operation.params. Returns null if
 * the asset has no recorded provenance.
 *
 * Model B convention: upload → operation.type === "import" with params.source === "upload";
 * ai generation → operation.type === "generate" with params.model + params.prompt.
 *
 * coreState.provenance.edges is typed as Map<string, ProvenanceEdge> per
 * @pneuma-craft/core's PneumaCraftCoreState, so we iterate via .values().
 */
export function useAssetMetadata(assetId: string): AssetGenerationMetadata | null {
  const edges = usePneumaCraftStore((s) => s.coreState.provenance.edges);
  return useMemo(() => {
    for (const edge of edges.values()) {
      if (edge.toAssetId !== assetId) continue;
      const op = edge.operation;
      const params = op.params as Record<string, unknown> | undefined;
      return {
        operationType: op.type,
        actor: op.actor,
        agentId: op.agentId,
        label: op.label,
        prompt: typeof params?.prompt === "string" ? (params.prompt as string) : undefined,
        model: typeof params?.model === "string" ? (params.model as string) : undefined,
        params,
      };
    }
    return null;
  }, [edges, assetId]);
}
