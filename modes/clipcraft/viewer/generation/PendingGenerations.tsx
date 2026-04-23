/**
 * PendingGenerationsProvider — keeps an in-memory list of variant
 * requests the user has dispatched but the agent hasn't finished yet.
 *
 * The dispatch flow for a variant is fire-and-forget from the
 * viewer's POV: we send a notification and then wait 30+ seconds
 * while the agent runs scripts and edits project.json. Without a
 * visual signal in between, the canvas looks idle and the user
 * can't tell whether the click registered.
 *
 * This provider is the visual signal. On variant submit, the caller
 * adds a pending entry keyed by `sourceAssetId`. DiveCanvas reads
 * the map and interleaves a synthetic "Generating…" node into the
 * DAG next to the source. When a real provenance edge from the
 * same source arrives (agent finished), the matching pending entry
 * is dropped automatically.
 *
 * State is purely in-memory — intentionally. If the user reloads
 * mid-generation, the placeholder disappears but the agent's write
 * still lands and the real node appears normally. We choose not to
 * persist ephemeral UI state because it complicates nothing (30s
 * window) and persisting it across reloads would require a
 * race-prone extra write path.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import type { AssetKind } from "./dispatchGeneration.js";

/** 2 minutes — if the agent hasn't landed a matching asset by then,
 *  assume the attempt died and clear the placeholder. */
const PENDING_TTL_MS = 2 * 60 * 1000;

export interface PendingGeneration {
  id: string;
  kind: AssetKind;
  sourceAssetId: string;
  changeDirection: string;
  startedAt: number;
}

interface PendingGenerationsApi {
  pending: PendingGeneration[];
  /** Returns the newly-created pending entry's id. */
  add: (input: Omit<PendingGeneration, "id" | "startedAt">) => string;
  remove: (id: string) => void;
}

const Ctx = createContext<PendingGenerationsApi | null>(null);

export function PendingGenerationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [pending, setPending] = useState<PendingGeneration[]>([]);
  const counterRef = useRef(0);

  const add = useCallback(
    (input: Omit<PendingGeneration, "id" | "startedAt">) => {
      counterRef.current += 1;
      const id = `pending-${Date.now()}-${counterRef.current}`;
      const entry: PendingGeneration = {
        id,
        startedAt: Date.now(),
        ...input,
      };
      setPending((prev) => [...prev, entry]);
      return id;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Auto-clean expired placeholders. Runs periodically rather than
  // per-entry so we don't spawn N timers for N parallel generations.
  useEffect(() => {
    if (pending.length === 0) return;
    const tick = setInterval(() => {
      const now = Date.now();
      setPending((prev) => prev.filter((p) => now - p.startedAt < PENDING_TTL_MS));
    }, 15_000);
    return () => clearInterval(tick);
  }, [pending.length]);

  // Match-and-drop: when a new provenance edge arrives with
  // fromAssetId == some pending's sourceAssetId and a timestamp later
  // than the pending's startedAt, that's the agent's write completing.
  // Drop the oldest matching pending for that source.
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const edges = coreState.provenance.edges;
  useEffect(() => {
    if (pending.length === 0) return;
    setPending((prev) => {
      if (prev.length === 0) return prev;
      const toRemove = new Set<string>();
      // For each source with pending entries, collect any edges that
      // look like a completion match. Consume oldest-first so multiple
      // variants in flight disambiguate in FIFO order.
      const bySource = new Map<string, PendingGeneration[]>();
      for (const p of prev) {
        if (!bySource.has(p.sourceAssetId)) bySource.set(p.sourceAssetId, []);
        bySource.get(p.sourceAssetId)!.push(p);
      }
      for (const [sourceId, list] of bySource) {
        list.sort((a, b) => a.startedAt - b.startedAt);
        for (const edge of edges.values()) {
          if (edge.fromAssetId !== sourceId) continue;
          // Match: first pending whose startedAt <= edge.operation.timestamp
          // and not already removed.
          const match = list.find(
            (p) =>
              !toRemove.has(p.id) && p.startedAt <= edge.operation.timestamp,
          );
          if (match) toRemove.add(match.id);
        }
      }
      if (toRemove.size === 0) return prev;
      return prev.filter((p) => !toRemove.has(p.id));
    });
  }, [edges, pending.length]);

  const value = useMemo(() => ({ pending, add, remove }), [pending, add, remove]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePendingGenerations(): PendingGenerationsApi {
  const api = useContext(Ctx);
  if (!api) {
    throw new Error(
      "usePendingGenerations must be called inside a PendingGenerationsProvider",
    );
  }
  return api;
}
