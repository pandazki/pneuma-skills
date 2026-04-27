import { useMemo } from "react";
import type { Operation, ProvenanceEdge, PneumaCraftCoreState } from "@pneuma-craft/core";
import type { Clip } from "@pneuma-craft/timeline";
import { useAsset, usePneumaCraftStore } from "@pneuma-craft/react";

export interface ClipProvenanceInfo {
  operation: Operation | null;
  summary: string;
}

/**
 * Resolve the clip's asset and walk the provenance edge map to find the
 * incoming operation that produced it. Returns an Operation plus a
 * human-readable one-line summary suitable for a native `title` tooltip.
 *
 * An asset can have multiple incoming edges (composite / derive). We
 * pick the most recent by timestamp — that's the operation that
 * produced this exact version.
 */
export function useClipProvenance(clip: Clip | null): ClipProvenanceInfo {
  const asset = useAsset(clip?.assetId ?? "");
  const coreState = usePneumaCraftStore(
    (s) => s.coreState as PneumaCraftCoreState,
  );

  return useMemo(() => {
    if (!clip || !asset) return { operation: null, summary: "" };
    const incoming: ProvenanceEdge[] = [];
    for (const edge of coreState.provenance.edges.values()) {
      if (edge.toAssetId === asset.id) incoming.push(edge);
    }
    if (incoming.length === 0) return { operation: null, summary: "" };
    incoming.sort(
      (a, b) => (b.operation.timestamp ?? 0) - (a.operation.timestamp ?? 0),
    );
    const op = incoming[0].operation;
    return { operation: op, summary: formatOperation(asset.name, op) };
  }, [clip, asset, coreState.provenance]);
}

/**
 * Pure formatter — exported for unit tests. Produces a one-line
 * description of an operation suitable for a `title` tooltip.
 *
 * Examples:
 *   generate · sdxl · "opening shot of a sunrise"
 *   import · sample.mp4
 *   derive · upscale · 2x
 *   upload · IMG_4492.jpg
 */
export function formatOperation(assetName: string, op: Operation): string {
  const parts: string[] = [op.type];

  const params = op.params ?? {};
  const model = typeof params.model === "string" ? params.model : null;
  const prompt = typeof params.prompt === "string" ? params.prompt : null;
  const filename =
    typeof params.filename === "string"
      ? params.filename
      : typeof params.originalName === "string"
      ? params.originalName
      : null;
  const label = typeof op.label === "string" ? op.label : null;

  if (model) parts.push(model);
  if (prompt) parts.push(`"${truncate(prompt, 60)}"`);
  else if (filename) parts.push(filename);
  else if (label) parts.push(label);
  else parts.push(assetName);

  return `${assetName}\n${parts.join(" · ")}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
