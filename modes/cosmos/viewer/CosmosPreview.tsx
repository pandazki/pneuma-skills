/**
 * CosmosPreview — the interactive player for a cosmos.json projection.
 *
 * Subscribes to `props.sources.cosmos` (a single JSON file), lays the
 * graph out with dagre, renders with @xyflow/react, and routes the
 * mode's four declared actions (navigate-to / focus-layer / fit-view /
 * switch-persona) through `actionRequest` → `onActionResult`.
 *
 * The schema and the tech-stack choice (React Flow + dagre) come from
 * Lum1104/Understand-Anything (MIT) — see NOTICE.md for the borrow/
 * adapt/drop mapping.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Background,
  ControlButton,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge as RfEdge,
  type Node as RfNode,
  type NodeProps,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./CosmosPreview.css";
import dagre from "@dagrejs/dagre";

import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import type { Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { getApiBase } from "../../../src/utils/api.js";
import EditorPickerButton from "../../../src/components/EditorPickerButton.js";
import type {
  Cosmos,
  CosmosEdge,
  CosmosNode,
  CosmosNodeCategory,
  CosmosPerspective,
  CosmosSourceRef,
  CosmosSubgraph,
} from "../types.js";

// ── Type chips — domain-agnostic category filter ──────────────────────

const CATEGORY_ORDER: CosmosNodeCategory[] = [
  "code",
  "config",
  "docs",
  "infra",
  "data",
  "domain",
  "knowledge",
  "other",
];

const CATEGORY_LABEL: Record<CosmosNodeCategory, string> = {
  code: "CODE",
  config: "CONFIG",
  docs: "DOCS",
  infra: "INFRA",
  data: "DATA",
  domain: "DOMAIN",
  knowledge: "KNOWLEDGE",
  other: "OTHER",
};

const CATEGORY_TINT: Record<CosmosNodeCategory, string> = {
  code: "#22d3ee",
  config: "#a78bfa",
  docs: "#86efac",
  infra: "#fb7185",
  data: "#fbbf24",
  domain: "#f97316",
  knowledge: "#e879f9",
  other: "#a1a1aa",
};

// ── Persona density ───────────────────────────────────────────────────

type Persona = "overview" | "learn" | "deep-dive";

/**
 * Navigation level — orthogonal to persona.
 * - "project-overview" → canvas renders one card per layer (gestalt).
 * - "detail" → canvas renders individual concrete nodes (the existing
 *    behaviour). Persona density still applies within detail.
 */
type NavigationLevel = "project-overview" | "detail";

// ── Source ref helpers — used by the INFO panel's SOURCES chip strip
// to render and dispatch click-to-open against any of the SourceRef
// kinds defined in types.ts.

/** Short tag shown as the chip's leading badge — kind at a glance. */
const SOURCE_KIND_TAG: Record<CosmosSourceRef["kind"], string> = {
  file: "FILE",
  url: "URL",
  passage: "PASS",
  image: "IMG",
  audio: "AUD",
  video: "VID",
};

/** Tint applied to the chip border + tag text per kind. Picked from
 *  the same palette the category chips use so the INFO panel reads
 *  coherent. */
const SOURCE_KIND_TINT: Record<CosmosSourceRef["kind"], string> = {
  file: "#60a5fa", // blue-400 — most common, code/text
  url: "#a78bfa", // violet-400 — external web
  passage: "#fbbf24", // amber-400 — quotes from long-form docs
  image: "#34d399", // emerald-400 — visual
  audio: "#f472b6", // pink-400 — audio
  video: "#fb923c", // orange-400 — video
};

/** Compose the chip's visible label. Agents can override via
 *  `ref.label`; otherwise we derive a short string from the ref's
 *  most-identifying field. Falls back to the kind tag so a chip is
 *  never empty. */
function sourceRefLabel(ref: CosmosSourceRef): string {
  if (ref.label) return ref.label;
  switch (ref.kind) {
    case "file":
    case "image":
    case "audio":
    case "video": {
      // Show the basename — the full path lives in the title attr.
      const path = ref.path ?? "";
      const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      return idx >= 0 ? path.slice(idx + 1) : path || SOURCE_KIND_TAG[ref.kind];
    }
    case "url": {
      try {
        const u = new URL(ref.url);
        return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
      } catch {
        return ref.url;
      }
    }
    case "passage":
      return ref.locator || ref.file || SOURCE_KIND_TAG.passage;
  }
}

/** Full tooltip text — the chip surface is small; the user reads
 *  the precise path / range / locator on hover. */
function sourceRefTooltip(ref: CosmosSourceRef): string {
  switch (ref.kind) {
    case "file":
      return ref.range
        ? `${ref.path} (lines ${ref.range[0]}–${ref.range[1]})`
        : ref.path;
    case "url":
      return ref.url;
    case "passage":
      return ref.quote
        ? `${ref.file} · ${ref.locator}\n“${ref.quote}”`
        : `${ref.file} · ${ref.locator}`;
    case "image":
    case "audio":
    case "video":
      return ref.path;
  }
}

/** Dispatch the right /api/system/* endpoint for the ref's kind.
 *  Web fallback: when no native bridge is available the server's
 *  open* endpoints still respond (with `{ available: false }` on
 *  web), so we just log and surface to the caller via the boolean
 *  return — InfoTab can show a tiny error chip. */
async function openSourceRef(ref: CosmosSourceRef): Promise<{ ok: boolean; message?: string }> {
  const base = getApiBase();
  const headers = { "Content-Type": "application/json" };
  try {
    let res: Response;
    if (ref.kind === "url") {
      res = await fetch(`${base}/api/system/open-url`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: ref.url }),
      });
    } else if (ref.kind === "passage") {
      // Passages live inside files — open the file for now and let
      // the user navigate to the locator manually. Editor-bridge
      // upgrade to jump to a line/locator is deferred.
      res = await fetch(`${base}/api/system/open`, {
        method: "POST",
        headers,
        body: JSON.stringify({ path: ref.file }),
      });
    } else {
      res = await fetch(`${base}/api/system/open`, {
        method: "POST",
        headers,
        body: JSON.stringify({ path: ref.path }),
      });
    }
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    if (data.success === false) {
      return { ok: false, message: data.message ?? "open failed" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "open failed" };
  }
}

/**
 * Which tour is currently running, and where in it the user is.
 *
 * - `overall` — walking the canonical `cosmos.tour[]` (the curated 5–8
 *   step reading path the agent picked).
 * - `perspective` — walking one of `cosmos.perspectives[]`, the variant
 *   tours framed by a design lens (cybernetic loop, tension, hidden
 *   hand, …). `perspectiveId` keys into the perspectives array.
 *
 * `null` (not represented in the type, but the state holds `… | null`)
 * means free exploration. Both kinds share the same stepper UI but the
 * perspective form renders a lens chip + thesis in the framing.
 */
type ActiveTour =
  | { kind: "overall"; step: number }
  | { kind: "perspective"; perspectiveId: string; step: number };

const DEFAULT_LAYER_COLOR = "#a1a1aa"; // zinc-400 fallback

// ── Node data (must be Record<string, unknown>-compatible for xyflow v12)

interface NodeData extends Record<string, unknown> {
  cosmosNode: CosmosNode;
  color: string;
  persona: Persona;
  dimmed: boolean;
  /** True when a drill request is in flight on this node (it's an
   *  anchor in `pendingDrillAnchors`). Renders a dashed pulsing
   *  orange ring + a small "drilling…" badge below. */
  pendingDrill?: boolean;
}

/** A "layer card" — one node per layer in the project-overview level. */
interface LayerCardData extends Record<string, unknown> {
  layerId: string;
  label: string;
  description?: string;
  color: string;
  nodeCount: number;
  aggregateComplexity: "simple" | "moderate" | "complex" | "mixed";
}

// ── Layout (dagre LR) ────────────────────────────────────────────────

const NODE_W = 200;
const NODE_H = 60;

/**
 * Layout for layer cards in project-overview level. Uses dagre TB
 * (top-bottom) with the aggregated layer edges so that the layout
 * reflects the inter-layer dependency direction.
 */
function layoutLayerCards(
  cards: LayerCardData[],
  layerEdges: Map<string, { source: string; target: string; count: number }>,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const c of cards) {
    g.setNode(c.layerId, { width: LAYER_CARD_W, height: LAYER_CARD_H });
  }
  for (const e of layerEdges.values()) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const c of cards) {
    const pos = g.node(c.layerId);
    if (pos) out.set(c.layerId, { x: pos.x - LAYER_CARD_W / 2, y: pos.y - LAYER_CARD_H / 2 });
  }
  return out;
}

function layout(
  nodes: CosmosNode[],
  edges: CosmosEdge[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 36 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) {
    // Dagre ignores edges to/from unknown nodes — guard so a malformed
    // cosmos.json doesn't take the whole viewer down.
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const pos = g.node(n.id);
    if (pos) out.set(n.id, { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 });
  }
  return out;
}

// ── CosmosNodeCard — the React Flow node component ──────────────────

function CosmosNodeCard({ data, selected }: NodeProps<RfNode<NodeData>>) {
  const { t } = useTranslation("cosmos");
  const { cosmosNode, color, persona, dimmed, pendingDrill } = data;
  // Pending wraps selection — even if not selected, the card gets a
  // dashed orange ring so the user can see "agent is drilling here"
  // even after they've moved focus elsewhere.
  const borderColor = pendingDrill
    ? "rgba(249,115,22,0.8)"
    : selected
      ? "#f97316"
      : color;
  return (
    <div
      className={`cc-cosmos-node${pendingDrill ? " cc-cosmos-node--pending" : ""}`}
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        background: "rgba(24,24,27,0.92)",
        border: pendingDrill ? `1.5px dashed ${borderColor}` : `1px solid ${borderColor}`,
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: selected
          ? "0 0 0 2px rgba(249,115,22,0.35), 0 6px 18px rgba(0,0,0,0.4)"
          : pendingDrill
            ? "0 0 0 1px rgba(249,115,22,0.18), 0 6px 18px rgba(249,115,22,0.12)"
            : "0 2px 10px rgba(0,0,0,0.35)",
        opacity: dimmed ? 0.22 : 1,
        transition: "opacity 200ms ease, box-shadow 150ms ease, border-color 150ms ease",
        color: "#e4e4e7",
        fontFamily: "Inter, -apple-system, sans-serif",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, border: "none" }} />
      <div
        style={{
          fontSize: 10,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color,
          marginBottom: 2,
        }}
      >
        {cosmosNode.type}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{cosmosNode.name}</div>
      {pendingDrill && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginTop: 4,
            fontSize: 9,
            letterSpacing: 0.4,
            color: "rgba(249,115,22,0.95)",
            fontStyle: "italic",
          }}
        >
          <span className="cc-cosmos-spinner" />
          {t("canvas.drilling_badge")}
        </div>
      )}
      {persona !== "overview" && cosmosNode.summary && (
        <div
          style={{
            fontSize: 11,
            color: "#a1a1aa",
            marginTop: 6,
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: persona === "deep-dive" ? 4 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {cosmosNode.summary}
        </div>
      )}
      {persona === "deep-dive" && cosmosNode.tags && cosmosNode.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {cosmosNode.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              style={{
                fontSize: 9,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.06)",
                color: "#d4d4d8",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color, border: "none" }} />
    </div>
  );
}

// ── Search ─────────────────────────────────────────────────────────────

interface SearchHit {
  node: CosmosNode;
  score: number;
  // Where the match was — for the result chip highlighting.
  matchedIn: "name" | "summary" | "tag" | "type";
}

/**
 * Fuzzy substring search over name / summary / tags / type. Returns
 * top N hits ranked by score. Designed to be cheap (O(N·m) where m
 * is the field length); good enough for cosmoses up to a few thousand
 * nodes. Semantic search (deferred to v0.3+) would replace this.
 */
function computeFuzzyHits(cosmos: Cosmos, query: string, limit: number = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const n of cosmos.nodes) {
    let score = 0;
    let matchedIn: SearchHit["matchedIn"] = "name";
    const name = n.name.toLowerCase();
    if (name.startsWith(q)) {
      score += 120;
      matchedIn = "name";
    } else if (name.includes(q)) {
      score += 100;
      matchedIn = "name";
    }
    if (n.summary && n.summary.toLowerCase().includes(q)) {
      if (score === 0) matchedIn = "summary";
      score += 50;
    }
    if (n.tags) {
      for (const t of n.tags) {
        if (t.toLowerCase().includes(q)) {
          if (score === 0) matchedIn = "tag";
          score += 30;
          break;
        }
      }
    }
    if (n.type.toLowerCase().includes(q)) {
      if (score === 0) matchedIn = "type";
      score += 20;
    }
    if (n.id.toLowerCase().includes(q)) {
      score += 15;
    }
    if (score > 0) hits.push({ node: n, score, matchedIn });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

interface SearchBarProps {
  cosmos: Cosmos;
  onSelectHit: (n: CosmosNode) => void;
}

function SearchBar({ cosmos, onSelectHit }: SearchBarProps) {
  const { t } = useTranslation("cosmos");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"fuzzy" | "semantic">("fuzzy");
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hits = useMemo(() => (mode === "fuzzy" ? computeFuzzyHits(cosmos, query) : []), [cosmos, query, mode]);

  // Close dropdown on click outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const showDropdown = focused && query.trim().length >= 2;
  return (
    <div ref={containerRef} style={{ position: "relative", flex: 1, display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type="text"
        placeholder={t("search.placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            setFocused(false);
          } else if (e.key === "Enter" && hits.length > 0) {
            onSelectHit(hits[0].node);
            setQuery("");
            setFocused(false);
          }
        }}
        style={{
          flex: 1,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid #27272a",
          borderRadius: 6,
          color: "#e4e4e7",
          fontSize: 12,
          padding: "7px 12px",
          fontFamily: "Inter, sans-serif",
          outline: "none",
        }}
      />
      <button
        type="button"
        onClick={() => setMode("fuzzy")}
        style={{
          fontSize: 10,
          padding: "5px 10px",
          borderRadius: 4,
          border: `1px solid ${mode === "fuzzy" ? "#f97316" : "#27272a"}`,
          background: mode === "fuzzy" ? "rgba(249,115,22,0.15)" : "transparent",
          color: mode === "fuzzy" ? "#fb923c" : "#71717a",
          cursor: "pointer",
        }}
      >
        {t("search.fuzzy")}
      </button>
      <button
        type="button"
        disabled
        title={t("search.semantic_tooltip")}
        style={{
          fontSize: 10,
          padding: "5px 10px",
          borderRadius: 4,
          border: "1px solid #27272a",
          background: "transparent",
          color: "#52525b",
          cursor: "not-allowed",
        }}
      >
        {t("search.semantic")}
      </button>
      {showDropdown && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 130, // leave room for mode buttons
            zIndex: 100,
            background: "rgba(24,24,27,0.98)",
            border: "1px solid #27272a",
            borderRadius: 6,
            boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {hits.length === 0 && (
            <div style={{ padding: "12px 14px", fontSize: 11, color: "#71717a" }}>{t("search.no_results")}</div>
          )}
          {hits.map((h) => {
            const layer = cosmos.layers.find((l) => l.id === h.node.layerId);
            return (
              <button
                key={h.node.id}
                type="button"
                onClick={() => {
                  onSelectHit(h.node);
                  setQuery("");
                  setFocused(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 14px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  color: "#e4e4e7",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 12,
                }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  {layer && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 2,
                        background: layer.color ?? DEFAULT_LAYER_COLOR,
                        display: "inline-block",
                      }}
                    />
                  )}
                  <span style={{ fontSize: 9, color: "#71717a", letterSpacing: 0.3 }}>{h.node.type}</span>
                  <span style={{ fontWeight: 600 }}>{h.node.name}</span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 8,
                      color: "#52525b",
                      letterSpacing: 0.2,
                      textTransform: "uppercase",
                    }}
                  >
                    {h.matchedIn}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#a1a1aa",
                    lineHeight: 1.4,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {h.node.summary}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── LayerClusterNode — the big card shown in project-overview level ────

const LAYER_CARD_W = 340;
const LAYER_CARD_H = 144;

const COMPLEXITY_TINT: Record<LayerCardData["aggregateComplexity"], string> = {
  simple: "#86efac",   // mint
  moderate: "#fbbf24", // amber
  complex: "#fb7185",  // pink-rose
  mixed: "#a1a1aa",
};

function LayerCard({ data, selected }: NodeProps<RfNode<LayerCardData>>) {
  const { t } = useTranslation("cosmos");
  const { label, description, color, nodeCount, aggregateComplexity } = data;
  return (
    <div
      style={{
        width: LAYER_CARD_W,
        minHeight: LAYER_CARD_H,
        background: "rgba(24,24,27,0.94)",
        border: `1px solid ${selected ? "#f97316" : color}`,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: selected
          ? "0 0 0 2px rgba(249,115,22,0.35), 0 8px 24px rgba(0,0,0,0.5)"
          : "0 4px 18px rgba(0,0,0,0.4)",
        color: "#e4e4e7",
        fontFamily: "Inter, -apple-system, sans-serif",
        // Subtle left-edge accent in the layer's color
        borderLeft: `4px solid ${color}`,
        cursor: "pointer",
        transition: "box-shadow 150ms ease, border-color 150ms ease",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, border: "none", opacity: 0 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: "#71717a",
          }}
        >
          Layer
        </div>
        <div
          style={{
            fontSize: 9,
            padding: "2px 8px",
            borderRadius: 3,
            background: `${COMPLEXITY_TINT[aggregateComplexity]}22`,
            color: COMPLEXITY_TINT[aggregateComplexity],
            textTransform: "lowercase",
            letterSpacing: 0.3,
          }}
        >
          {aggregateComplexity}
        </div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2, marginBottom: 6, color: "#fff" }}>{label}</div>
      {description && (
        <div
          style={{
            fontSize: 11,
            color: "#a1a1aa",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            marginBottom: 10,
          }}
        >
          {description}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
        <div style={{ fontSize: 11, color: "#d4d4d8" }}>
          <span style={{ fontWeight: 600 }}>{nodeCount}</span>{" "}
          <span style={{ color: "#71717a" }}>{t("node_card.node_count", { count: nodeCount }).replace(`${nodeCount} `, "")}</span>
        </div>
        <div style={{ fontSize: 10, color: "rgba(249,115,22,0.7)", fontStyle: "italic" }}>{t("node_card.click_to_explore")}</div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color, border: "none", opacity: 0 }} />
    </div>
  );
}

const NODE_TYPES = { cosmosNode: CosmosNodeCard, layerCard: LayerCard };

/**
 * Compute per-layer aggregate stats from cosmos nodes. Returns a Map
 * keyed by layerId.
 */
function computeLayerAggregates(cosmos: Cosmos): Map<string, LayerCardData> {
  const out = new Map<string, LayerCardData>();
  for (const layer of cosmos.layers) {
    const nodesInLayer = cosmos.nodes.filter((n) => n.layerId === layer.id);
    // Aggregate complexity: take the mode (most-common). When tied with
    // multiple complexities present, return "mixed".
    const counts: Record<string, number> = { simple: 0, moderate: 0, complex: 0 };
    for (const n of nodesInLayer) {
      if (n.complexity) counts[n.complexity] = (counts[n.complexity] ?? 0) + 1;
    }
    const total = counts.simple + counts.moderate + counts.complex;
    let agg: LayerCardData["aggregateComplexity"] = "mixed";
    if (total === 0) {
      agg = "mixed";
    } else {
      const ranking: Array<"complex" | "moderate" | "simple"> = ["complex", "moderate", "simple"];
      const sorted = [...ranking].sort((a, b) => counts[b] - counts[a]);
      const top = sorted[0];
      // "mixed" when the dominant complexity is not at least half of nodes
      agg = counts[top] / total >= 0.5 ? top : "mixed";
    }
    out.set(layer.id, {
      layerId: layer.id,
      label: layer.label,
      description: layer.description,
      color: layer.color ?? DEFAULT_LAYER_COLOR,
      nodeCount: nodesInLayer.length,
      aggregateComplexity: agg,
    });
  }
  return out;
}

/** Aggregate cross-layer edges to a (sourceLayer, targetLayer) → count map. */
function aggregateLayerEdges(cosmos: Cosmos): Map<string, { source: string; target: string; count: number }> {
  const out = new Map<string, { source: string; target: string; count: number }>();
  const layerOf = new Map<string, string | undefined>();
  for (const n of cosmos.nodes) layerOf.set(n.id, n.layerId);
  for (const e of cosmos.edges) {
    const sl = layerOf.get(e.source);
    const tl = layerOf.get(e.target);
    if (!sl || !tl || sl === tl) continue;
    const key = `${sl}::${tl}`;
    const existing = out.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      out.set(key, { source: sl, target: tl, count: 1 });
    }
  }
  return out;
}

// (taoPositions removed — perspectives are no longer rendered as
//  floating overlay nodes; they live as variant tours in the TOUR tab.)

// ── Canvas (consumes useReactFlow, must be inside ReactFlowProvider) ──

interface CanvasProps {
  cosmos: Cosmos;
  persona: Persona;
  navigationLevel: NavigationLevel;
  focusedLayer: string | null;
  selectedNodeId: string | null;
  /** Extra anchor nodes to keep lit alongside `selectedNodeId`. When
   *  a perspective step lands on more than one focus node ("these
   *  three together form the loop"), the non-primary ids ride in
   *  here. Each one expands the dim-out neighborhood the same way
   *  the primary does. Null/empty means "no extra anchors". */
  tourFocus: string[] | null;
  /** Extra anchor nodes the user has added via shift+click. Same
   *  visual treatment as tourFocus (orange ring + neighbor highlight)
   *  but the meaning is "user picked these for a drill", not "tour
   *  is showing these". Empty when no multi-selection. */
  extraAnchors: string[];
  /** Pending drill anchor ids — anchors of in-flight drill requests
   *  that haven't been answered yet. Shown with a dashed orange ring
   *  + spinner pulse so the user sees the agent is working. */
  pendingDrillAnchors: Set<string>;
  hiddenCategories: Set<CosmosNodeCategory>;
  onSelectNode: (n: CosmosNode | null) => void;
  /** Shift+click on a node — toggles the node in/out of the extra
   *  anchor set without disturbing the primary selectedNodeId. */
  onShiftClickNode: (n: CosmosNode) => void;
  /** Clear the extra anchor set — fired by plain node-click and
   *  pane-click. Distinct from `onSelectNode(null)`, which only
   *  clears the primary. */
  onClearExtraAnchors: () => void;
  onLayerCardClick: (layerId: string) => void;
  onNodeHover: (n: CosmosNode | null, x?: number, y?: number) => void;
  registerFitView: (fn: () => void) => void;
  registerNavigate: (fn: (nodeId: string) => void) => void;
  /** Top-level `r` keybinding routes through this ref so the reset
   * action stays defined in Canvas (where the Dagre-positioned arrays
   * live) but is callable from the document-level keydown handler. */
  registerResetLayout: (fn: () => void) => void;
}

function Canvas({
  cosmos,
  persona,
  navigationLevel,
  focusedLayer,
  selectedNodeId,
  tourFocus,
  extraAnchors,
  pendingDrillAnchors,
  hiddenCategories,
  onSelectNode,
  onShiftClickNode,
  onClearExtraAnchors,
  onLayerCardClick,
  onNodeHover,
  registerFitView,
  registerNavigate,
  registerResetLayout,
}: CanvasProps) {
  const { t } = useTranslation("cosmos");
  const layerColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of cosmos.layers) m.set(l.id, l.color ?? DEFAULT_LAYER_COLOR);
    return m;
  }, [cosmos.layers]);

  const positions = useMemo(() => layout(cosmos.nodes, cosmos.edges), [cosmos.nodes, cosmos.edges]);

  // Set of node ids in the active focus neighborhood — anchors +
  // every node sharing an edge with any anchor. "Anchors" is the
  // selected node plus any extra focus the active tour step asked
  // for (typically the rest of a multi-node beat: "these three
  // together form the loop"). Members stay vivid; everyone else
  // dims. Edges touching any anchor get the orange highlight + the
  // directional animated dash.
  //
  // Computed once per (edges, selectedNodeId, tourFocus) so the
  // O(N + E) walk doesn't repeat inside the node/edge memos.
  const selectedNeighbors = useMemo(() => {
    const anchors: string[] = [];
    if (selectedNodeId) anchors.push(selectedNodeId);
    if (tourFocus) {
      for (const id of tourFocus) if (id !== selectedNodeId) anchors.push(id);
    }
    for (const id of extraAnchors) {
      if (id !== selectedNodeId) anchors.push(id);
    }
    if (anchors.length === 0) return null;
    const anchorSet = new Set(anchors);
    const set = new Set<string>(anchors);
    for (const e of cosmos.edges) {
      if (anchorSet.has(e.source)) set.add(e.target);
      if (anchorSet.has(e.target)) set.add(e.source);
    }
    return set;
  }, [cosmos.edges, selectedNodeId, tourFocus, extraAnchors]);

  // The same anchor set, exposed for edge styling so any edge whose
  // either endpoint is an anchor gets the highlight treatment — not
  // just edges touching the single selected node.
  const focusAnchorSet = useMemo(() => {
    const anchors = new Set<string>();
    if (selectedNodeId) anchors.add(selectedNodeId);
    if (tourFocus) for (const id of tourFocus) anchors.add(id);
    for (const id of extraAnchors) anchors.add(id);
    return anchors.size > 0 ? anchors : null;
  }, [selectedNodeId, tourFocus, extraAnchors]);

  // layerId lookup — a Map is O(1) per access vs the .find() scan the
  // edge memo used to do for every edge. With ~60 nodes / ~80 edges the
  // O(N·E) cost was tolerable; for larger cosmoses it isn't.
  const nodeLayerById = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const n of cosmos.nodes) m.set(n.id, n.layerId);
    return m;
  }, [cosmos.nodes]);

  // Fast-lookup sets for selection/pending classification — avoids
  // doing array.includes inside the per-node map.
  const extraAnchorSet = useMemo(() => new Set(extraAnchors), [extraAnchors]);

  const rfNodes: RfNode<NodeData>[] = useMemo(
    () =>
      cosmos.nodes.map((n) => {
        const categoryHidden = n.category
          ? hiddenCategories.has(n.category)
          : hiddenCategories.has("other");
        const layerOutOfFocus = focusedLayer != null && n.layerId !== focusedLayer;
        const neighborOutOfFocus = selectedNeighbors != null && !selectedNeighbors.has(n.id);
        // "selected" in React Flow sense — anything the user has
        // anchored: the primary OR any extra anchor (shift+click).
        // Tour focus does NOT mark `selected`; it just lights the
        // node up via the dim-mask. This keeps the primary-only
        // INFO-panel binding sane.
        const isAnchored = n.id === selectedNodeId || extraAnchorSet.has(n.id);
        return {
          id: n.id,
          type: "cosmosNode",
          position: positions.get(n.id) ?? { x: 0, y: 0 },
          data: {
            cosmosNode: n,
            color: layerColor.get(n.layerId ?? "") ?? DEFAULT_LAYER_COLOR,
            persona,
            dimmed: categoryHidden || layerOutOfFocus || neighborOutOfFocus,
            // Pending drill state — agent is generating a subgraph
            // anchored on this node. Renders as a dashed pulsing
            // ring on the node card.
            pendingDrill: pendingDrillAnchors.has(n.id),
          },
          selected: isAnchored,
        };
      }),
    [
      cosmos.nodes,
      positions,
      layerColor,
      persona,
      focusedLayer,
      selectedNodeId,
      extraAnchorSet,
      selectedNeighbors,
      hiddenCategories,
      pendingDrillAnchors,
    ],
  );

  const rfEdges: RfEdge[] = useMemo(
    () =>
      cosmos.edges.map((e, i) => {
        const sourceLayer = nodeLayerById.get(e.source);
        const targetLayer = nodeLayerById.get(e.target);
        const layerOutOfFocus =
          focusedLayer != null && (sourceLayer !== focusedLayer || targetLayer !== focusedLayer);
        // An edge is "adjacent" if either endpoint is in the active
        // anchor set (selected node OR any extra tour focus). This
        // means an edge BETWEEN two co-focused nodes during a tour
        // step gets highlighted from both sides — exactly what reads
        // best when the agent says "see how A talks to B here".
        const isAdjacent =
          focusAnchorSet != null && (focusAnchorSet.has(e.source) || focusAnchorSet.has(e.target));
        // When anything is focused, non-adjacent edges fade so the
        // user's eye lands on the highlighted neighborhood.
        const neighborOutOfFocus = focusAnchorSet != null && !isAdjacent;
        const stroke = isAdjacent
          ? "rgba(249,115,22,0.95)"
          : layerOutOfFocus || neighborOutOfFocus
            ? "rgba(82,82,91,0.18)"
            : "rgba(161,161,170,0.55)";
        return {
          id: `e-${i}-${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          label: e.type,
          labelStyle: {
            fontSize: 9,
            fill: isAdjacent ? "#fb923c" : "#71717a",
            // Avoid clutter when surrounding edges are faded — keep labels
            // visible only on highlighted edges or when nothing is selected.
            opacity: neighborOutOfFocus || layerOutOfFocus ? 0 : 1,
          },
          labelBgStyle: { fill: "rgba(9,9,11,0.85)" },
          labelBgPadding: [3, 5],
          labelBgBorderRadius: 3,
          style: { stroke, strokeWidth: isAdjacent ? 1.8 : 1.2 },
          animated: e.direction === "bidirectional" || isAdjacent,
          markerEnd: isAdjacent
            ? { type: MarkerType.ArrowClosed, color: "rgba(249,115,22,0.95)", width: 14, height: 14 }
            : undefined,
        };
      }),
    [cosmos.edges, nodeLayerById, focusedLayer, focusAnchorSet],
  );

  // ── Project-overview level: layer cards + aggregated layer edges ─────

  const layerAggregates = useMemo(() => computeLayerAggregates(cosmos), [cosmos]);
  const layerEdgeAggregates = useMemo(() => aggregateLayerEdges(cosmos), [cosmos]);
  const layerCardPositions = useMemo(() => {
    const cards = Array.from(layerAggregates.values());
    return layoutLayerCards(cards, layerEdgeAggregates);
  }, [layerAggregates, layerEdgeAggregates]);

  const layerCardNodes: RfNode<LayerCardData>[] = useMemo(() => {
    if (navigationLevel !== "project-overview") return [];
    return Array.from(layerAggregates.values()).map((card) => ({
      id: `layer:${card.layerId}`,
      type: "layerCard",
      position: layerCardPositions.get(card.layerId) ?? { x: 0, y: 0 },
      data: card,
      selected: focusedLayer === card.layerId,
    }));
  }, [navigationLevel, layerAggregates, layerCardPositions, focusedLayer]);

  const layerCardEdges: RfEdge[] = useMemo(() => {
    if (navigationLevel !== "project-overview") return [];
    return Array.from(layerEdgeAggregates.values()).map((agg, i) => ({
      id: `layer-edge-${i}-${agg.source}-${agg.target}`,
      source: `layer:${agg.source}`,
      target: `layer:${agg.target}`,
      label: String(agg.count),
      labelStyle: { fontSize: 10, fill: "#a1a1aa", fontWeight: 600 },
      labelBgStyle: { fill: "rgba(9,9,11,0.92)" },
      labelBgPadding: [4, 8] as [number, number],
      labelBgBorderRadius: 4,
      style: {
        stroke: "rgba(161,161,170,0.5)",
        // Edge thickness scales with edge count (log-ish)
        strokeWidth: Math.min(1 + Math.log2(agg.count + 1), 4),
      },
    }));
  }, [navigationLevel, layerEdgeAggregates]);

  // In project-overview level, hide detail nodes/edges entirely.
  // In detail level, those drive the canvas as before.
  const combinedNodes = useMemo(() => {
    if (navigationLevel === "project-overview") {
      return layerCardNodes as RfNode[];
    }
    return rfNodes as RfNode[];
  }, [navigationLevel, layerCardNodes, rfNodes]);

  const combinedEdges = useMemo(() => {
    if (navigationLevel === "project-overview") {
      return layerCardEdges;
    }
    return rfEdges;
  }, [navigationLevel, layerCardEdges, rfEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode>(combinedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RfEdge>(combinedEdges);
  // Sync the freshly computed `combinedNodes` into React Flow's
  // internal state, but **preserve user-dragged positions when the
  // graph's node identity is unchanged**.
  //
  // Without the merge, every selection / focus / drill state change
  // would push a new array through `setNodes` and overwrite the
  // in-progress (or just-finished) drag with the Dagre default
  // position — visible as flicker + snap-back.
  //
  // With *only* the merge (preserve all matching ids), a scope
  // change (entering a subgraph view) would lock anchor nodes at
  // their old main-graph positions while new subgraph nodes lay out
  // from origin — anchors stuck far away from the cluster they
  // anchor.
  //
  // Rule: if the node-id set is **identical** to the prev render,
  // preserve every position (pure drag-preservation case). Otherwise
  // the layout itself changed (added/removed nodes, scope switch) —
  // accept the fresh Dagre positions wholesale.
  useEffect(() => {
    setNodes((prev) => {
      if (prev.length === 0) return combinedNodes;
      const prevIds = new Set(prev.map((n) => n.id));
      const sameIdSet =
        prevIds.size === combinedNodes.length &&
        combinedNodes.every((n) => prevIds.has(n.id));
      if (!sameIdSet) {
        // Structural change — let the new Dagre layout win.
        return combinedNodes;
      }
      const prevById = new Map(prev.map((n) => [n.id, n.position]));
      return combinedNodes.map((n) => {
        const existing = prevById.get(n.id);
        return existing ? { ...n, position: existing } : n;
      });
    });
  }, [combinedNodes, setNodes]);
  useEffect(() => setEdges(combinedEdges), [combinedEdges, setEdges]);

  const rf = useReactFlow();

  useEffect(() => {
    registerFitView(() => rf.fitView({ padding: 0.2, duration: 400 }));
  }, [rf, registerFitView]);

  useEffect(() => {
    registerNavigate((nodeId: string) => {
      const pos = positions.get(nodeId);
      if (!pos) return;
      rf.setCenter(pos.x + NODE_W / 2, pos.y + NODE_H / 2, { zoom: 1.2, duration: 400 });
    });
  }, [rf, positions, registerNavigate]);

  // Reset-layout: re-apply the Dagre positions we computed up top.
  // After a user drags nodes around the canvas can quickly become
  // illegible; this is the escape hatch back to the canonical layout.
  // The two `setNodes` / `setEdges` re-pushes are intentional — they
  // overwrite whatever positions React Flow's internal state holds with
  // the freshly memoized `combinedNodes`. The fitView delay lets the
  // commit settle so the resulting frame is the one we zoom to.
  const handleResetLayout = useCallback(() => {
    setNodes(combinedNodes);
    setEdges(combinedEdges);
    setTimeout(() => rf.fitView({ padding: 0.18, duration: 400 }), 50);
  }, [combinedNodes, combinedEdges, setNodes, setEdges, rf]);

  useEffect(() => {
    registerResetLayout(handleResetLayout);
  }, [handleResetLayout, registerResetLayout]);

  // Auto-fit on navigation-level switch — project-overview and detail
  // live at very different coordinate scales (layer cards ~600px apart;
  // concrete nodes packed closer), so the user's old viewport almost
  // never frames the new level usefully. We wait one tick so React
  // Flow has committed the new node set before computing the bounding
  // box.
  useEffect(() => {
    const timer = setTimeout(() => rf.fitView({ padding: 0.16, duration: 400 }), 120);
    return () => clearTimeout(timer);
  }, [navigationLevel, rf]);

  const handlePaneClick = useCallback(() => {
    // Pane-click clears both primary + extra anchors. Same as Esc.
    onSelectNode(null);
    onClearExtraAnchors();
  }, [onSelectNode, onClearExtraAnchors]);

  const handleNodeClick = useCallback(
    (evt: React.MouseEvent, rfn: RfNode) => {
      // Two card kinds reach the canvas now: layer cards (project
      // overview) and concrete cosmos nodes (detail). Layer cards
      // carry `layerId` without `cosmosNode`; concrete nodes carry
      // `cosmosNode`. Perspectives never render here — they live in
      // the TOUR tab as variant walks.
      const d = rfn.data as Partial<NodeData> & Partial<LayerCardData>;
      if (d.layerId && !d.cosmosNode) {
        onLayerCardClick(d.layerId);
      } else if (d.cosmosNode) {
        // Shift+click toggles the node in/out of the extra-anchor
        // set (for multi-node drill). Plain click is a "fresh pick":
        // primary = this node, extras cleared. We don't reverse the
        // primary in shift mode — that's how the user keeps a stable
        // INFO panel while adding/removing siblings.
        if (evt.shiftKey) {
          onShiftClickNode(d.cosmosNode);
        } else {
          onSelectNode(d.cosmosNode);
          onClearExtraAnchors();
        }
      }
    },
    [onLayerCardClick, onSelectNode, onShiftClickNode, onClearExtraAnchors],
  );

  // Hover events for tooltip — only fire for concrete cosmosNodes
  // (skip layer cards — they already show their full info on the canvas).
  const handleNodeMouseEnter = useCallback(
    (evt: React.MouseEvent, rfn: RfNode) => {
      const d = rfn.data as Partial<NodeData>;
      if (d.cosmosNode) onNodeHover(d.cosmosNode, evt.clientX, evt.clientY);
    },
    [onNodeHover],
  );
  const handleNodeMouseLeave = useCallback(() => onNodeHover(null), [onNodeHover]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onNodeMouseEnter={handleNodeMouseEnter}
      onNodeMouseLeave={handleNodeMouseLeave}
      onPaneClick={handlePaneClick}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.12, duration: 0 }}
      minZoom={0.12}
      proOptions={{ hideAttribution: true }}
      style={{ background: "#09090b" }}
    >
      <Background color="#27272a" gap={28} />
      <Controls>
        <ControlButton onClick={handleResetLayout} title={t("canvas.reset_layout_tooltip")} aria-label={t("canvas.reset_layout_label")}>
          {/* Circular-arrow glyph drawn inline so it inherits the dark
           * controls theme; matches the visual weight of the other
           * built-in icons. */}
          <svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 4V1L7 6l5 5V7c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 13c0-4.42-3.58-8-8-8zm-6.7 4.2L3.84 6.74A7.93 7.93 0 0 0 4 13c0 4.42 3.58 8 8 8v3l5-5-5-5v3c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8z"
              fill="currentColor"
            />
          </svg>
        </ControlButton>
      </Controls>
      <MiniMap
        pannable
        zoomable
        style={{ background: "rgba(24,24,27,0.85)", border: "1px solid #27272a" }}
        maskColor="rgba(9,9,11,0.78)"
        nodeColor={(n) => {
          const d = n.data as Partial<NodeData> & Partial<LayerCardData>;
          if (d.color) return d.color as string;
          return "#52525b";
        }}
      />
    </ReactFlow>
  );
}

// ── Sidebar tab panels (INFO / FILES / TOUR) ──────────────────────────

type SidebarTab = "info" | "files" | "tour" | "drills";

/** Build the workspace-relative or absolute path → /api/file URL the
 *  excerpt thumbnail loads from. The server's /api/file route handles
 *  both — see server/index.ts. We encode the path because excerpts
 *  may sit under `.cosmos-assets/<id>/...` with characters that need
 *  escaping. */
function excerptSrcUrl(path: string): string {
  return `${getApiBase()}/api/file?path=${encodeURIComponent(path)}`;
}

/** Open-ended where-inside hint for a ref. For passages the
 *  required `locator` field is the natural answer; for other kinds
 *  we read the new optional `locator?: string`. Returns empty when
 *  no useful hint exists. */
function sourceRefLocatorText(ref: CosmosSourceRef): string {
  if (ref.kind === "passage") return ref.locator;
  return (ref as { locator?: string }).locator ?? "";
}

/**
 * EXCERPTS section — renders the visual-anchor view of a node's
 * sources. Each ref classifies into one of three shapes:
 *
 *   - **Image card** — `excerpt.path` is set on any kind. Thumbnail
 *     loads via `/api/file?path=…`; on the right, kind chip + locator
 *     chip + caption + auto-derived path label. The whole card is a
 *     button that delegates to `openSourceRef(ref)` — same behaviour
 *     as the chip strip below.
 *   - **Quote card** — `passage` ref with `quote` and no excerpt.
 *     Large curly quote glyph in the tint color, italicised body,
 *     file + locator chips, "open source" affordance.
 *   - **No card** — neither excerpt nor quote present. The ref still
 *     surfaces in the chip strip below; nothing renders here.
 *
 * If no cards qualify, the whole section (header + body) hides.
 * Excerpts are *real* extracts (cropped PDF pages, video frames, UI
 * screenshots) — see SKILL's *Visual anchoring* chapter. The viewer
 * does not enforce this; the discipline is in the SKILL.
 */
function ExcerptsSection({ sources }: { sources: CosmosSourceRef[] }) {
  const { t } = useTranslation("cosmos");
  const [error, setError] = useState<string | null>(null);
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const [imgFailed, setImgFailed] = useState<Record<number, boolean>>({});

  // Classify each ref once; only "image" / "quote" produce cards.
  type Card =
    | { kind: "image"; ref: CosmosSourceRef; excerpt: { path: string; caption?: string }; refIdx: number }
    | { kind: "quote"; ref: Extract<CosmosSourceRef, { kind: "passage" }>; refIdx: number };
  const cards: Card[] = [];
  sources.forEach((ref, refIdx) => {
    const excerpt = (ref as { excerpt?: { path: string; caption?: string } }).excerpt;
    if (excerpt && typeof excerpt.path === "string" && excerpt.path) {
      cards.push({ kind: "image", ref, excerpt, refIdx });
      return;
    }
    if (ref.kind === "passage" && ref.quote) {
      cards.push({ kind: "quote", ref, refIdx });
    }
  });

  if (cards.length === 0) return null;

  const handleOpen = async (ref: CosmosSourceRef, idx: number) => {
    setError(null);
    setPendingIdx(idx);
    const res = await openSourceRef(ref);
    setPendingIdx(null);
    if (!res.ok) setError(res.message ?? "Failed to open");
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: "#71717a",
          marginBottom: 6,
        }}
      >
        {t("info.excerpts_label")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {cards.map((card, idx) => {
          const { ref, refIdx } = card;
          const tint = SOURCE_KIND_TINT[ref.kind];
          const tag = t(`source_kind.${ref.kind}`);
          const locator = sourceRefLocatorText(ref);
          const label = sourceRefLabel(ref);
          const pending = pendingIdx === idx;
          const failed = imgFailed[idx] === true;

          if (card.kind === "image") {
            return (
              <button
                key={`${refIdx}-img`}
                type="button"
                title={sourceRefTooltip(ref)}
                onClick={() => void handleOpen(ref, idx)}
                disabled={pending}
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  gap: 10,
                  width: "100%",
                  padding: 8,
                  borderRadius: 6,
                  border: `1px solid ${tint}55`,
                  background: `${tint}0d`,
                  color: "#d4d4d8",
                  cursor: pending ? "default" : "pointer",
                  opacity: pending ? 0.5 : 1,
                  textAlign: "left",
                  transition: "all 120ms ease",
                }}
                onMouseEnter={(ev) => {
                  if (pending) return;
                  ev.currentTarget.style.background = `${tint}1c`;
                  ev.currentTarget.style.borderColor = `${tint}aa`;
                }}
                onMouseLeave={(ev) => {
                  if (pending) return;
                  ev.currentTarget.style.background = `${tint}0d`;
                  ev.currentTarget.style.borderColor = `${tint}55`;
                }}
              >
                <div
                  style={{
                    width: 144,
                    height: 88,
                    flexShrink: 0,
                    borderRadius: 4,
                    border: `1px solid ${tint}66`,
                    background: "#0a0a0b",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {failed ? (
                    <div style={{ fontSize: 10, color: "#71717a", textAlign: "center", padding: 6 }}>
                      image unavailable
                    </div>
                  ) : (
                    <img
                      src={excerptSrcUrl(card.excerpt.path)}
                      alt={card.excerpt.caption ?? label}
                      onError={() => setImgFailed((m) => ({ ...m, [idx]: true }))}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontFamily: "JetBrains Mono, ui-monospace, monospace",
                        fontSize: 8.5,
                        letterSpacing: 0.5,
                        fontWeight: 700,
                        color: tint,
                        padding: "1px 4px",
                        borderRadius: 2,
                        background: `${tint}1a`,
                      }}
                    >
                      {tag}
                    </span>
                    {locator && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "#a1a1aa",
                          padding: "1px 5px",
                          borderRadius: 2,
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid #2a2a2e",
                        }}
                      >
                        {locator}
                      </span>
                    )}
                  </div>
                  {card.excerpt.caption ? (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "#e4e4e7",
                        lineHeight: 1.4,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {card.excerpt.caption}
                    </div>
                  ) : (
                    // Caption is the card's "what is this" label. When
                    // missing, fall back to the auto-derived path label
                    // so the user still has something to read. Showing
                    // both is just noise — the caption already names it.
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "#d4d4d8",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </div>
                  )}
                </div>
              </button>
            );
          }

          // Quote card — passage ref with a lifted quote, no excerpt.
          const passage = card.ref;
          return (
            <button
              key={`${refIdx}-quote`}
              type="button"
              title={sourceRefTooltip(passage)}
              onClick={() => void handleOpen(passage, idx)}
              disabled={pending}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                width: "100%",
                padding: "12px 14px 10px 36px",
                borderRadius: 6,
                border: `1px solid ${tint}55`,
                background: `${tint}0d`,
                color: "#d4d4d8",
                cursor: pending ? "default" : "pointer",
                opacity: pending ? 0.5 : 1,
                textAlign: "left",
                transition: "all 120ms ease",
              }}
              onMouseEnter={(ev) => {
                if (pending) return;
                ev.currentTarget.style.background = `${tint}1c`;
                ev.currentTarget.style.borderColor = `${tint}aa`;
              }}
              onMouseLeave={(ev) => {
                if (pending) return;
                ev.currentTarget.style.background = `${tint}0d`;
                ev.currentTarget.style.borderColor = `${tint}55`;
              }}
            >
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  left: 8,
                  fontFamily: "Georgia, serif",
                  fontSize: 32,
                  lineHeight: 1,
                  color: tint,
                  opacity: 0.55,
                  pointerEvents: "none",
                }}
              >
                &ldquo;
              </span>
              <div
                style={{
                  fontStyle: "italic",
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "#e4e4e7",
                }}
              >
                {passage.quote}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                    fontSize: 8.5,
                    letterSpacing: 0.5,
                    fontWeight: 700,
                    color: tint,
                    padding: "1px 4px",
                    borderRadius: 2,
                    background: `${tint}1a`,
                  }}
                >
                  {tag}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#a1a1aa",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 220,
                  }}
                >
                  {passage.file}
                </span>
                {passage.locator && (
                  <span
                    style={{
                      fontSize: 9,
                      color: "#a1a1aa",
                      padding: "1px 5px",
                      borderRadius: 2,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid #2a2a2e",
                    }}
                  >
                    {passage.locator}
                  </span>
                )}
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 9,
                    color: "#71717a",
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                  }}
                >
                  open source ›
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {error && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            color: "#fb7185",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 3,
            padding: "4px 8px",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * SOURCES chip strip — renders every CosmosSourceRef on a node as a
 * click-to-open chip with kind tag, derived label, and on-hover full
 * path / locator / range tooltip. Clicking dispatches the right
 * /api/system/* endpoint. Errors land in a small inline notice
 * below the strip; they auto-clear on the next click.
 *
 * No state shared with the rest of the InfoTab — each strip is
 * self-contained so it can be reused (e.g., if drill-down phases
 * add per-subgraph node panels later).
 */
function SourcesStrip({ sources }: { sources: CosmosSourceRef[] }) {
  const { t } = useTranslation("cosmos");
  const [error, setError] = useState<string | null>(null);
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const handleOpen = async (ref: CosmosSourceRef, idx: number) => {
    setError(null);
    setPendingIdx(idx);
    const res = await openSourceRef(ref);
    setPendingIdx(null);
    if (!res.ok) setError(res.message ?? "Failed to open");
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: "#71717a",
          marginBottom: 6,
        }}
      >
        {t("info.sources_label")}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {sources.map((ref, idx) => {
          const tint = SOURCE_KIND_TINT[ref.kind];
          const label = sourceRefLabel(ref);
          const tip = sourceRefTooltip(ref);
          const pending = pendingIdx === idx;
          return (
            <button
              key={idx}
              type="button"
              title={tip}
              onClick={() => void handleOpen(ref, idx)}
              disabled={pending}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 7px 3px 4px",
                borderRadius: 4,
                border: `1px solid ${tint}55`,
                background: `${tint}12`,
                color: "#d4d4d8",
                fontSize: 10.5,
                lineHeight: 1.3,
                cursor: pending ? "default" : "pointer",
                opacity: pending ? 0.5 : 1,
                maxWidth: "100%",
                transition: "all 120ms ease",
              }}
              onMouseEnter={(ev) => {
                if (pending) return;
                ev.currentTarget.style.background = `${tint}24`;
                ev.currentTarget.style.borderColor = `${tint}88`;
              }}
              onMouseLeave={(ev) => {
                if (pending) return;
                ev.currentTarget.style.background = `${tint}12`;
                ev.currentTarget.style.borderColor = `${tint}55`;
              }}
            >
              <span
                style={{
                  fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  fontSize: 8.5,
                  letterSpacing: 0.5,
                  fontWeight: 700,
                  color: tint,
                  padding: "1px 4px",
                  borderRadius: 2,
                  background: `${tint}1a`,
                }}
              >
                {t(`source_kind.${ref.kind}`)}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 180,
                }}
              >
                {label}
              </span>
              {"range" in ref && Array.isArray(ref.range) && (
                <span style={{ color: "#71717a", fontSize: 9 }}>
                  L{ref.range[0]}-{ref.range[1]}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            color: "#fb7185",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 3,
            padding: "4px 8px",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * NodeDrawer — right-side slide-out panel that owns per-node detail.
 *
 * Visibility is bound to `node !== null`. When `node` becomes null the
 * drawer slides off; the last node is remembered so the body stays
 * rendered through the closing animation rather than blanking.
 *
 * The drawer overlays the canvas right edge (position: absolute) so
 * the user's spatial map of the graph doesn't reflow when it opens /
 * closes. The left-side sidebar holds project-/layer-/tour-level
 * context; the drawer holds the one-node context — separation of
 * jobs is the whole point of moving node detail out of the tab.
 */
interface NodeDrawerProps {
  cosmos: Cosmos;
  node: CosmosNode | null;
  onSelectNode: (n: CosmosNode | null) => void;
  onClose: () => void;
}

function NodeDrawer({ cosmos, node, onSelectNode, onClose }: NodeDrawerProps) {
  // Keep the previously-rendered node around while the panel slides
  // away, so the user sees a clean exit instead of an empty panel mid-
  // animation.
  const [lastNode, setLastNode] = useState<CosmosNode | null>(node);
  useEffect(() => {
    if (node) setLastNode(node);
  }, [node]);

  const open = node !== null;
  const display = node ?? lastNode;

  // Close on Escape, mirroring the canvas's "click pane to deselect"
  // affordance for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!display) return null;

  const layer = cosmos.layers.find((l) => l.id === display.layerId);
  const outboundEdges = cosmos.edges.filter((e) => e.source === display.id);
  const inboundEdges = cosmos.edges.filter((e) => e.target === display.id);

  return (
    <aside
      aria-hidden={!open}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        maxWidth: "92%",
        background: "rgba(20,20,23,0.92)",
        borderLeft: "1px solid #27272a",
        boxShadow: open ? "-18px 0 32px -18px rgba(0,0,0,0.55)" : "none",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        color: "#d4d4d8",
        fontFamily: "Inter, sans-serif",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        transform: open ? "translateX(0)" : "translateX(105%)",
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        transition:
          "transform 220ms cubic-bezier(.2,.7,.2,1), opacity 220ms ease, box-shadow 220ms ease",
        zIndex: 8,
        minHeight: 0,
      }}
    >
      {/* Header — type chip, complexity, close button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px 10px",
          borderBottom: "1px solid #27272a",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: layer?.color ?? "#71717a",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {display.type}
          </div>
          {display.complexity && (
            <div
              style={{
                fontSize: 9,
                padding: "2px 7px",
                borderRadius: 3,
                background: `${COMPLEXITY_TINT[display.complexity] ?? "#52525b"}22`,
                color: COMPLEXITY_TINT[display.complexity] ?? "#a1a1aa",
              }}
            >
              {display.complexity}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          style={{
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "1px solid transparent",
            background: "transparent",
            color: "#71717a",
            fontSize: 14,
            lineHeight: 1,
            cursor: "pointer",
            transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
          }}
          onMouseEnter={(ev) => {
            ev.currentTarget.style.background = "rgba(255,255,255,0.06)";
            ev.currentTarget.style.color = "#fafafa";
            ev.currentTarget.style.borderColor = "#3f3f46";
          }}
          onMouseLeave={(ev) => {
            ev.currentTarget.style.background = "transparent";
            ev.currentTarget.style.color = "#71717a";
            ev.currentTarget.style.borderColor = "transparent";
          }}
        >
          ×
        </button>
      </div>

      {/* Body (scrollable) */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 18px", minHeight: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.25, color: "#fff", marginBottom: 8 }}>
          {display.name}
        </div>
        {layer && (
          <div style={{ fontSize: 10, color: "#71717a", marginBottom: 10 }}>
            <span style={{ color: layer.color ?? "#71717a" }}>●</span> {layer.label}
          </div>
        )}
        <div style={{ fontSize: 12.5, color: "#e4e4e7", lineHeight: 1.55, marginBottom: 14 }}>
          {display.summary}
        </div>
        {display.sources && display.sources.length > 0 && (
          <>
            <ExcerptsSection sources={display.sources} />
            <SourcesStrip sources={display.sources} />
          </>
        )}
        {display.languageNotes && (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: "#71717a",
                marginBottom: 3,
              }}
            >
              Stack
            </div>
            <div style={{ fontSize: 11, color: "#a1a1aa", lineHeight: 1.5 }}>
              {display.languageNotes}
            </div>
          </div>
        )}
        {display.tags && display.tags.length > 0 && (
          <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {display.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 9,
                  padding: "2px 7px",
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.06)",
                  color: "#a1a1aa",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {outboundEdges.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: "#71717a",
                marginBottom: 5,
              }}
            >
              Outbound · {outboundEdges.length}
            </div>
            {outboundEdges.slice(0, 8).map((e, i) => {
              const target = cosmos.nodes.find((n) => n.id === e.target);
              if (!target) return null;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelectNode(target)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "4px 8px",
                    fontSize: 11,
                    color: "#d4d4d8",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 4,
                    transition: "background 100ms ease",
                  }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                >
                  <span style={{ color: "#71717a" }}>{e.type}</span> → {target.name}
                </button>
              );
            })}
            {outboundEdges.length > 8 && (
              <div style={{ fontSize: 9, color: "#52525b", marginTop: 2, paddingLeft: 8 }}>
                + {outboundEdges.length - 8} more
              </div>
            )}
          </div>
        )}
        {inboundEdges.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: "#71717a",
                marginBottom: 5,
              }}
            >
              Inbound · {inboundEdges.length}
            </div>
            {inboundEdges.slice(0, 8).map((e, i) => {
              const src = cosmos.nodes.find((n) => n.id === e.source);
              if (!src) return null;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelectNode(src)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "4px 8px",
                    fontSize: 11,
                    color: "#d4d4d8",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 4,
                    transition: "background 100ms ease",
                  }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                >
                  {src.name} <span style={{ color: "#71717a" }}>← {e.type}</span>
                </button>
              );
            })}
            {inboundEdges.length > 8 && (
              <div style={{ fontSize: 9, color: "#52525b", marginTop: 2, paddingLeft: 8 }}>
                + {inboundEdges.length - 8} more
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

interface InfoTabProps {
  cosmos: Cosmos;
  focusedLayer: string | null;
  onSelectNode: (n: CosmosNode | null) => void;
}

function InfoTab({ cosmos, focusedLayer, onSelectNode }: InfoTabProps) {
  // Per-node detail moved to the right-side NodeDrawer. This tab keeps
  // the project-level view (and the focused-layer summary) so the left
  // panel and the drawer do different jobs and don't compete.
  // (Perspectives live in the TOUR tab as variant walks.)

  // Focused layer (no node) → layer summary card
  if (focusedLayer) {
    const layer = cosmos.layers.find((l) => l.id === focusedLayer);
    const nodesInLayer = cosmos.nodes.filter((n) => n.layerId === focusedLayer);
    if (!layer) return <EmptyTabHint />;
    return (
      <div style={{ padding: "0 4px 12px" }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: layer.color ?? "#71717a",
            marginBottom: 4,
          }}
        >
          Layer
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{layer.label}</div>
        {layer.description && (
          <div style={{ fontSize: 12, color: "#d4d4d8", lineHeight: 1.5, marginBottom: 12 }}>{layer.description}</div>
        )}
        <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4 }}>
          {nodesInLayer.length} nodes — click any to inspect
        </div>
        {nodesInLayer.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelectNode(n)}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              width: "100%",
              textAlign: "left",
              padding: "4px 6px",
              fontSize: 11,
              color: "#d4d4d8",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              borderRadius: 3,
            }}
            onMouseEnter={(ev) => (ev.currentTarget.style.background = "rgba(255,255,255,0.04)")}
            onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontSize: 9, color: "#71717a", letterSpacing: 0.3 }}>{n.type}</span>
            <span>{n.name}</span>
          </button>
        ))}
      </div>
    );
  }

  return <ProjectOverviewCard cosmos={cosmos} />;
}

/**
 * ProjectOverviewCard — what the INFO tab shows when nothing is
 * selected and no layer is focused. Frames the cosmos itself: name,
 * one-line kind chip, description, stats, and (when
 * `cosmos.project.sourceRoot` is set) an "Open project root in editor"
 * button that hands the path to the user's chosen editor via
 * `/api/system/open-in-editor`. Once the root is open in Cursor / VS
 * Code, subsequent source-chip clicks land in that same window
 * naturally (the editor activates the file inside the open workspace).
 *
 * The card replaces the older "click to inspect" placeholder so the
 * default INFO state actually teaches the user what they're looking
 * at and offers the most likely next action.
 */
function ProjectOverviewCard({ cosmos }: { cosmos: Cosmos }) {
  const { t } = useTranslation("cosmos");
  const projectName = cosmos.project.name;
  const projectKind = cosmos.project.kind;
  const projectDescription = cosmos.project.description;
  const sourceRoot = cosmos.project.sourceRoot;
  const perspectiveCount = cosmos.perspectives?.length ?? 0;
  const drillCount = cosmos.subgraphs?.length ?? 0;
  return (
    <div style={{ padding: "0 4px 12px" }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "rgba(249,115,22,0.85)",
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {t("info.project_overview_eyebrow")}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1.2, marginBottom: 6 }}>
        {projectName}
      </div>
      {projectKind && (
        <div
          style={{
            display: "inline-block",
            fontSize: 9.5,
            padding: "2px 7px",
            borderRadius: 3,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid #3f3f46",
            color: "#a1a1aa",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            letterSpacing: 0.3,
            marginBottom: 10,
          }}
        >
          {projectKind}
        </div>
      )}
      {projectDescription && (
        <div style={{ fontSize: 12, color: "#d4d4d8", lineHeight: 1.55, marginBottom: 12 }}>
          {projectDescription}
        </div>
      )}
      {/* Stats — same numbers as the sidebar header, repeated here as a
          first-impression panel for "what am I looking at" */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 14,
          fontSize: 10,
          color: "#71717a",
        }}
      >
        <span>{t("header.stats_nodes", { count: cosmos.nodes.length })}</span>
        <span>·</span>
        <span>{t("header.stats_edges", { count: cosmos.edges.length })}</span>
        <span>·</span>
        <span>{t("header.stats_layers", { count: cosmos.layers.length })}</span>
        {perspectiveCount > 0 && (
          <>
            <span>·</span>
            <span style={{ color: "rgba(249,115,22,0.7)" }}>
              {t("header.stats_perspectives", { count: perspectiveCount })}
            </span>
          </>
        )}
        {drillCount > 0 && (
          <>
            <span>·</span>
            <span style={{ color: "rgba(249,115,22,0.7)" }}>
              {t("header.stats_drills", { count: drillCount })}
            </span>
          </>
        )}
      </div>
      {/* Open-in-editor — only when sourceRoot is set. The button is
          self-contained (handles picker, default-editor persistence,
          actual /api/system/open-in-editor dispatch). When no editor
          is detected on the system the component renders nothing,
          gracefully degrading. */}
      {sourceRoot ? (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "#71717a",
              marginBottom: 6,
            }}
          >
            {t("info.project_open_root_label")}
          </div>
          <EditorPickerButton targetPath={sourceRoot} menuPosition="above" />
          <div
            style={{
              fontSize: 10,
              color: "#71717a",
              lineHeight: 1.5,
              marginTop: 8,
            }}
          >
            {t("info.project_open_root_hint")}
          </div>
          <code
            style={{
              display: "block",
              fontSize: 9.5,
              color: "#a1a1aa",
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              wordBreak: "break-all",
              background: "rgba(255,255,255,0.04)",
              padding: "4px 8px",
              borderRadius: 3,
              marginTop: 6,
            }}
          >
            {sourceRoot}
          </code>
        </div>
      ) : (
        <div
          style={{
            fontSize: 10,
            color: "#71717a",
            lineHeight: 1.5,
            marginBottom: 12,
            padding: "8px 10px",
            background: "rgba(255,255,255,0.03)",
            borderLeft: "2px solid #3f3f46",
            borderRadius: 3,
          }}
        >
          {t("info.project_no_root_hint")}
        </div>
      )}
    </div>
  );
}

function EmptyTabHint() {
  const { t } = useTranslation("cosmos");
  return (
    <div style={{ padding: "20px 8px", fontSize: 11, color: "#71717a", lineHeight: 1.6, textAlign: "center" }}>
      {t("info.empty")}
    </div>
  );
}

interface FilesTabProps {
  cosmos: Cosmos;
  onSelectNode: (n: CosmosNode) => void;
}

function FilesTab({ cosmos, onSelectNode }: FilesTabProps) {
  // Group nodes by layer, retain layer ordering.
  const byLayer = cosmos.layers.map((layer) => ({
    layer,
    nodes: cosmos.nodes.filter((n) => n.layerId === layer.id),
  }));
  const orphans = cosmos.nodes.filter((n) => !n.layerId);
  return (
    <div style={{ padding: "0 4px 12px" }}>
      {byLayer.map(({ layer, nodes }) => (
        <details key={layer.id} open={nodes.length <= 12} style={{ marginBottom: 6 }}>
          <summary
            style={{
              fontSize: 10,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: layer.color ?? "#71717a",
              cursor: "pointer",
              padding: "4px 6px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 2, background: layer.color ?? "#52525b" }} />
            <span style={{ flex: 1 }}>{layer.label}</span>
            <span style={{ color: "#52525b", fontSize: 9 }}>{nodes.length}</span>
          </summary>
          <div style={{ paddingLeft: 14 }}>
            {nodes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelectNode(n)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "3px 6px",
                  fontSize: 11,
                  color: "#d4d4d8",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 3,
                }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
              >
                {n.name}
                {n.source && (
                  <span style={{ color: "#52525b", marginLeft: 6, fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}>
                    {n.source.length > 32 ? "…" + n.source.slice(-32) : n.source}
                  </span>
                )}
              </button>
            ))}
          </div>
        </details>
      ))}
      {orphans.length > 0 && (
        <details>
          <summary
            style={{
              fontSize: 10,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "#71717a",
              cursor: "pointer",
              padding: "4px 6px",
            }}
          >
            (no layer) — {orphans.length}
          </summary>
          {orphans.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onSelectNode(n)}
              style={{
                display: "block",
                padding: "3px 14px",
                fontSize: 11,
                color: "#d4d4d8",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              {n.name}
            </button>
          ))}
        </details>
      )}
    </div>
  );
}

interface TourTabProps {
  cosmos: Cosmos;
  activeTour: ActiveTour | null;
  onStartOverallTour: () => void;
  onStartPerspectiveTour: (perspectiveId: string) => void;
  onEndTour: () => void;
  onTourStep: (step: number) => void;
}

/**
 * TOUR tab — surfaces the canonical overall tour AND the perspective
 * variants (the new shape of what we used to call "Tao"). The two are
 * different framings of the same cosmos: the overall is *the* curated
 * reading path; each perspective is a local walk through nodes seen
 * through one design lens.
 *
 * Two display modes:
 * - **Index mode** (no tour active) — render the overall tour entry on
 *   top with a Start button, then a list of perspective cards below
 *   each with its own Start button. The user picks one.
 * - **Stepper mode** (a tour is active) — render the unified stepper:
 *   header shows kind-specific framing (lens + name for perspective;
 *   "Project Tour" for overall), step badge + narrative + prev/next.
 */
function TourTab({
  cosmos,
  activeTour,
  onStartOverallTour,
  onStartPerspectiveTour,
  onEndTour,
  onTourStep,
}: TourTabProps) {
  const { t } = useTranslation("cosmos");
  const overall = cosmos.tour ?? [];
  const perspectives = cosmos.perspectives ?? [];

  // Empty state — nothing to walk.
  if (overall.length === 0 && perspectives.length === 0) {
    return (
      <div style={{ padding: "20px 8px", fontSize: 11, color: "#71717a", lineHeight: 1.6, textAlign: "center" }}>
        {t("tour.empty")}
      </div>
    );
  }

  // ── Stepper mode: a tour is running ────────────────────────────────
  if (activeTour) {
    // Build the unified per-step list + framing. Overall and
    // perspective tours both surface `{step, focus[], narrative}`
    // here; differences live in the header.
    let steps: Array<{ step: number; focus: string[]; narrative: string }>;
    let header: { eyebrow: string; title: string; thesis?: string };
    if (activeTour.kind === "overall") {
      steps = overall.map((s) => ({
        step: s.step,
        focus: [s.nodeId],
        narrative: s.narrative,
      }));
      header = { eyebrow: t("tour.header_eyebrow"), title: cosmos.project.name };
    } else {
      const persp = perspectives.find((p) => p.id === activeTour.perspectiveId);
      if (!persp) {
        // Defensive — perspective disappeared mid-tour (shouldn't happen
        // in practice; cosmos.json hot-reload + race could trigger).
        return (
          <div style={{ padding: "12px 8px", fontSize: 11, color: "#71717a" }}>
            {t("tour.perspective_gone")}{" "}
            <button type="button" onClick={onEndTour} style={{ color: "#fb923c", background: "none", border: "none", cursor: "pointer" }}>
              {t("tour.perspective_gone_action")}
            </button>
          </div>
        );
      }
      steps = (persp.steps ?? []).map((s, i) => ({
        step: i + 1,
        focus: s.focus,
        narrative: s.narrative,
      }));
      header = {
        eyebrow: t("tour.header_perspective_eyebrow", { lens: persp.lens }),
        title: persp.name,
        thesis: persp.insight,
      };
    }
    const step = steps.find((s) => s.step === activeTour.step) ?? steps[0];
    if (!step) return null;
    return (
      <div style={{ padding: "0 4px 12px" }}>
        {/* Eyebrow + title */}
        <div
          style={{
            fontSize: 9,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "rgba(249,115,22,0.85)",
            fontWeight: 600,
            marginBottom: 2,
          }}
        >
          {header.eyebrow}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#fff",
            lineHeight: 1.25,
            marginBottom: 10,
          }}
        >
          {header.title}
        </div>
        {/* Thesis — the perspective's overall insight, shown small
            above the step narrative so the user has the big-picture
            framing for every beat without it dominating the card. */}
        {header.thesis && (
          <div
            style={{
              fontSize: 10.5,
              color: "rgba(254,215,170,0.78)",
              lineHeight: 1.5,
              marginBottom: 10,
              padding: "6px 9px",
              borderRadius: 4,
              background: "rgba(249,115,22,0.06)",
              fontStyle: "italic",
            }}
          >
            {header.thesis}
          </div>
        )}
        {/* Step badge + end button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#a1a1aa", letterSpacing: 0.4 }}>
            {t("tour.step_badge", { current: step.step, total: steps.length })}
          </div>
          <button
            type="button"
            onClick={onEndTour}
            style={{
              fontSize: 9,
              color: "#71717a",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              letterSpacing: 0.3,
            }}
          >
            {t("tour.end_tour")}
          </button>
        </div>
        {/* Progress bar */}
        <div
          style={{
            height: 3,
            background: "rgba(255,255,255,0.06)",
            borderRadius: 2,
            marginBottom: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              background: "linear-gradient(90deg, rgba(249,115,22,0.9), rgba(251,146,60,0.8))",
              width: `${(step.step / steps.length) * 100}%`,
              transition: "width 250ms ease",
            }}
          />
        </div>
        {/* Narrative */}
        <div
          style={{
            fontSize: 12,
            color: "#e4e4e7",
            lineHeight: 1.6,
            marginBottom: 16,
            padding: "10px 12px",
            background: "rgba(255,255,255,0.03)",
            borderLeft: "2px solid rgba(249,115,22,0.6)",
            borderRadius: 3,
          }}
        >
          {step.narrative}
        </div>
        {/* Prev / next */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => onTourStep(Math.max(1, step.step - 1))}
            disabled={step.step === 1}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: 5,
              border: "1px solid #27272a",
              background: "transparent",
              color: step.step === 1 ? "#52525b" : "#d4d4d8",
              fontSize: 11,
              cursor: step.step === 1 ? "default" : "pointer",
            }}
          >
            {t("tour.prev")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (step.step >= steps.length) onEndTour();
              else onTourStep(step.step + 1);
            }}
            style={{
              flex: 1.4,
              padding: "7px 10px",
              borderRadius: 5,
              border: "1px solid rgba(249,115,22,0.6)",
              background: "rgba(249,115,22,0.18)",
              color: "#fb923c",
              fontSize: 11,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {step.step >= steps.length ? t("tour.finish") : t("tour.next")}
          </button>
        </div>
      </div>
    );
  }

  // ── Index mode: no tour running, show options ──────────────────────
  return (
    <div style={{ padding: "0 4px 12px" }}>
      {/* Overall tour section */}
      {overall.length > 0 && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
            {t("tour.overall_title")}
          </div>
          <div style={{ fontSize: 11, color: "#71717a", marginBottom: 12 }}>
            {t("tour.overall_subtitle", { count: overall.length })}
          </div>
          <button
            type="button"
            onClick={onStartOverallTour}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: 6,
              border: "1px solid rgba(249,115,22,0.6)",
              background: "linear-gradient(135deg, rgba(249,115,22,0.22), rgba(251,146,60,0.10))",
              color: "#fed7aa",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              marginBottom: 18,
              letterSpacing: 0.3,
            }}
          >
            {t("tour.overall_start")}
          </button>
        </>
      )}

      {/* Perspectives section */}
      {perspectives.length > 0 && (
        <>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#fff",
              marginBottom: 4,
              marginTop: overall.length > 0 ? 8 : 0,
            }}
          >
            {t("tour.perspectives_title")}
          </div>
          <div style={{ fontSize: 11, color: "#71717a", marginBottom: 12, lineHeight: 1.5 }}>
            {t("tour.perspectives_subtitle", { count: perspectives.length })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {perspectives.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onStartPerspectiveTour(p.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid rgba(249,115,22,0.32)",
                  background: "rgba(249,115,22,0.06)",
                  color: "#d4d4d8",
                  cursor: "pointer",
                  transition: "all 150ms ease",
                }}
                onMouseEnter={(ev) => {
                  ev.currentTarget.style.background = "rgba(249,115,22,0.14)";
                  ev.currentTarget.style.borderColor = "rgba(249,115,22,0.6)";
                }}
                onMouseLeave={(ev) => {
                  ev.currentTarget.style.background = "rgba(249,115,22,0.06)";
                  ev.currentTarget.style.borderColor = "rgba(249,115,22,0.32)";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 8.5,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      color: "rgba(249,115,22,0.85)",
                      fontWeight: 600,
                    }}
                  >
                    {p.lens}
                  </span>
                  <span style={{ fontSize: 9, color: "#71717a" }}>
                    {t("tour.perspective_steps", { count: p.steps?.length ?? 0 })}
                  </span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 4 }}>
                  {p.name}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "#a1a1aa",
                    lineHeight: 1.5,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {p.insight}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sidebar (tabs + view controls) ──────────────────────────────────

/**
 * DRILLS sidebar tab — lists every user-driven drill request in the
 * cosmos. Each entry is a card with status badge (pending / ready /
 * failed), anchor names, prompt preview, and a click target that
 * enters the subgraph view. Pending entries show a spinner and grey
 * out; failed entries surface the agent's message in red.
 *
 * Cards are ordered by `generatedAt` desc (newest on top), with
 * pending entries pinned to the top regardless so the user sees
 * in-flight work first.
 */
function DrillsTab({
  cosmos,
  subgraphs,
  activeSubgraphId,
  onEnterSubgraph,
}: {
  cosmos: Cosmos;
  subgraphs: CosmosSubgraph[];
  activeSubgraphId: string | null;
  onEnterSubgraph: (id: string) => void;
}) {
  const { t } = useTranslation("cosmos");
  if (subgraphs.length === 0) {
    return (
      <div style={{ padding: "20px 8px", fontSize: 11, color: "#71717a", lineHeight: 1.6, textAlign: "center" }}>
        <Trans
          ns="cosmos"
          i18nKey="drills.empty"
          components={{ strong: <strong /> }}
        />
      </div>
    );
  }

  // Pending first, then newest-by-generatedAt.
  const sorted = [...subgraphs].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    const at = a.generatedAt ?? "";
    const bt = b.generatedAt ?? "";
    return bt.localeCompare(at);
  });
  const nodeById = new Map(cosmos.nodes.map((n) => [n.id, n]));
  return (
    <div style={{ padding: "0 4px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{t("drills.title")}</div>
      <div style={{ fontSize: 11, color: "#71717a", marginBottom: 10, lineHeight: 1.5 }}>
        {t("drills.subtitle")}
      </div>
      {sorted.map((sg) => {
        const isActive = sg.id === activeSubgraphId;
        const anchorPreview = sg.anchors
          .slice(0, 3)
          .map((id) => nodeById.get(id)?.name ?? id)
          .join(" · ");
        const moreAnchors = sg.anchors.length > 3 ? ` · +${sg.anchors.length - 3}` : "";
        const statusTint =
          sg.status === "ready"
            ? "rgba(74,222,128,0.85)"
            : sg.status === "failed"
              ? "rgba(248,113,113,0.85)"
              : "rgba(251,146,60,0.95)";
        return (
          <button
            key={sg.id}
            type="button"
            disabled={sg.status !== "ready"}
            onClick={() => onEnterSubgraph(sg.id)}
            title={sg.status === "ready" ? t("drills.enter_tooltip") : undefined}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 6,
              border: isActive
                ? "1px solid rgba(249,115,22,0.7)"
                : sg.status === "pending"
                  ? "1px dashed rgba(251,146,60,0.45)"
                  : "1px solid rgba(249,115,22,0.32)",
              background: isActive
                ? "rgba(249,115,22,0.14)"
                : sg.status === "pending"
                  ? "rgba(251,146,60,0.06)"
                  : sg.status === "failed"
                    ? "rgba(248,113,113,0.05)"
                    : "rgba(249,115,22,0.06)",
              color: "#d4d4d8",
              cursor: sg.status === "ready" ? "pointer" : "default",
              opacity: sg.status === "failed" ? 0.7 : 1,
              transition: "all 150ms ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {sg.status === "pending" && <span className="cc-cosmos-spinner" />}
                <span
                  style={{
                    fontSize: 8.5,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    color: statusTint,
                    fontWeight: 700,
                  }}
                >
                  {sg.status === "ready"
                    ? t("drills.status_ready")
                    : sg.status === "failed"
                      ? t("drills.status_failed")
                      : t("drills.status_drilling")}
                </span>
              </span>
              <span style={{ fontSize: 9, color: "#71717a" }}>
                {t("drills.node_count", { count: sg.nodes?.length ?? 0 })}
              </span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 4 }}>
              {sg.title ?? sg.prompt.split("\n")[0].slice(0, 80)}
            </div>
            <div style={{ fontSize: 10, color: "#a1a1aa", lineHeight: 1.4, marginBottom: 4 }}>
              <span style={{ color: "rgba(249,115,22,0.7)", fontWeight: 600 }}>{t("drills.anchors")}</span> {anchorPreview}
              {moreAnchors}
            </div>
            {sg.status === "failed" && sg.message && (
              <div style={{ fontSize: 10, color: "rgba(248,113,113,0.85)", marginTop: 4, fontStyle: "italic" }}>
                {sg.message}
              </div>
            )}
            {sg.parentSubgraphId && (
              <div style={{ fontSize: 9, color: "#71717a", marginTop: 4 }}>
                {t("drills.nested")}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SidebarProps {
  cosmos: Cosmos;
  /** Full list of subgraphs from the main cosmos — pinned separately
   *  from `cosmos.subgraphs` because when we're inside a subgraph
   *  view the `cosmos` prop is the synthesized scope and doesn't
   *  carry the drill registry. */
  subgraphs: CosmosSubgraph[];
  /** Id of the subgraph the canvas is currently rendering, or null
   *  for main-cosmos view. Drives the breadcrumb + the active row in
   *  the DRILLS tab. */
  activeSubgraphId: string | null;
  /** Enter a subgraph (canvas swaps to that scope). */
  onEnterSubgraph: (id: string) => void;
  /** Exit subgraph view, back to main. */
  onExitSubgraph: () => void;
  navigationLevel: NavigationLevel;
  onNavigationLevel: (n: NavigationLevel) => void;
  persona: Persona;
  onPersona: (p: Persona) => void;
  focusedLayer: string | null;
  onFocusLayer: (id: string | null) => void;
  perspectiveCount: number;
  onSelectNode: (n: CosmosNode | null) => void;
  activeTour: ActiveTour | null;
  onStartOverallTour: () => void;
  onStartPerspectiveTour: (perspectiveId: string) => void;
  onEndTour: () => void;
  onTourStep: (step: number) => void;
}

function Sidebar({
  cosmos,
  subgraphs,
  activeSubgraphId,
  onEnterSubgraph,
  onExitSubgraph,
  navigationLevel,
  onNavigationLevel,
  persona,
  onPersona,
  focusedLayer,
  onFocusLayer,
  perspectiveCount,
  onSelectNode,
  activeTour,
  onStartOverallTour,
  onStartPerspectiveTour,
  onEndTour,
  onTourStep,
}: SidebarProps) {
  const { t } = useTranslation("cosmos");
  const [activeTab, setActiveTab] = useState<SidebarTab>("info");

  // Node selection no longer drives this panel — the right-side
  // NodeDrawer handles per-node detail. The INFO tab stays on project /
  // layer context so the two panels do different jobs.
  // When any tour (overall or perspective) starts, auto-switch to TOUR.
  useEffect(() => {
    if (activeTour) setActiveTab("tour");
  }, [activeTour]);

  // Breadcrumb piece — when inside a subgraph, label what we're in.
  const activeSubgraph = activeSubgraphId
    ? subgraphs.find((s) => s.id === activeSubgraphId) ?? null
    : null;
  const drillsCount = subgraphs.length;
  const pendingDrills = subgraphs.filter((s) => s.status === "pending").length;

  return (
    <aside
      style={{
        width: 268,
        flexShrink: 0,
        background: "rgba(24,24,27,0.6)",
        borderRight: "1px solid #27272a",
        color: "#d4d4d8",
        fontFamily: "Inter, sans-serif",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Header — project name + stats */}
      <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #27272a" }}>
        {/* Breadcrumb — shown when canvas is rendering a subgraph
            view. The user can pop back to main with one click. */}
        {activeSubgraph && (
          <button
            type="button"
            onClick={onExitSubgraph}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              textAlign: "left",
              padding: "4px 6px",
              marginBottom: 6,
              borderRadius: 4,
              border: "1px solid rgba(249,115,22,0.32)",
              background: "rgba(249,115,22,0.06)",
              color: "#fed7aa",
              fontSize: 10.5,
              cursor: "pointer",
            }}
            title={t("header.exit_drill_tooltip")}
          >
            <span style={{ fontSize: 11 }}>←</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <Trans
                ns="cosmos"
                i18nKey="header.in_drill"
                values={{ title: activeSubgraph.title ?? activeSubgraph.prompt.slice(0, 40) }}
                components={{ strong: <strong /> }}
              />
            </span>
          </button>
        )}
        <div style={{ fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", color: "#71717a", marginBottom: 4 }}>
          {cosmos.project.name}
        </div>
        <div style={{ fontSize: 10, color: "#71717a" }}>
          {t("header.stats_nodes", { count: cosmos.nodes.length })}
          {" · "}
          {t("header.stats_edges", { count: cosmos.edges.length })}
          {" · "}
          {t("header.stats_layers", { count: cosmos.layers.length })}
          {perspectiveCount > 0 && (
            <span style={{ color: "rgba(249,115,22,0.7)" }}>
              {" · "}
              {t("header.stats_perspectives", { count: perspectiveCount })}
            </span>
          )}
          {drillsCount > 0 && (
            <span style={{ color: "rgba(249,115,22,0.7)" }}>
              {" · "}
              {t("header.stats_drills", { count: drillsCount })}
              {pendingDrills > 0 && (
                <span style={{ color: "rgba(251,146,60,0.95)" }}>
                  {" "}
                  {t("header.stats_pending", { count: pendingDrills })}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #27272a" }}>
        {(
          [
            { id: "info" as const, labelKey: "tabs.info" },
            { id: "files" as const, labelKey: "tabs.files" },
            { id: "tour" as const, labelKey: "tabs.tour" },
            { id: "drills" as const, labelKey: "tabs.drills" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: "9px 0",
              fontSize: 10,
              letterSpacing: 0.6,
              fontWeight: 600,
              background: activeTab === tab.id ? "rgba(255,255,255,0.04)" : "transparent",
              color: activeTab === tab.id ? "#fff" : "#71717a",
              border: "none",
              borderBottom: `2px solid ${activeTab === tab.id ? "#f97316" : "transparent"}`,
              cursor: "pointer",
              position: "relative",
            }}
          >
            {t(tab.labelKey)}
            {tab.id === "drills" && pendingDrills > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "rgba(251,146,60,0.95)",
                  boxShadow: "0 0 8px rgba(251,146,60,0.55)",
                }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content (scrollable, grows) */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 4px", minHeight: 0 }}>
        {activeTab === "info" && (
          <InfoTab
            cosmos={cosmos}
            focusedLayer={focusedLayer}
            onSelectNode={onSelectNode}
          />
        )}
        {activeTab === "files" && (
          <FilesTab cosmos={cosmos} onSelectNode={(n) => onSelectNode(n)} />
        )}
        {activeTab === "tour" && (
          <TourTab
            cosmos={cosmos}
            activeTour={activeTour}
            onStartOverallTour={onStartOverallTour}
            onStartPerspectiveTour={onStartPerspectiveTour}
            onEndTour={onEndTour}
            onTourStep={onTourStep}
          />
        )}
        {activeTab === "drills" && (
          <DrillsTab
            cosmos={cosmos}
            subgraphs={subgraphs}
            activeSubgraphId={activeSubgraphId}
            onEnterSubgraph={onEnterSubgraph}
          />
        )}
      </div>

      {/* View controls (compact, always-present, at bottom) */}
      <div style={{ borderTop: "1px solid #27272a", padding: "12px 14px", overflowY: "auto", maxHeight: "44%" }}>
      <div style={{ fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "#a1a1aa", marginBottom: 6 }}>
        {t("view_controls.level")}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {(
          [
            { id: "project-overview", labelKey: "view_controls.level_project" },
            { id: "detail", labelKey: "view_controls.level_detail" },
          ] as const
        ).map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onNavigationLevel(l.id)}
            style={{
              flex: 1,
              padding: "5px 6px",
              borderRadius: 5,
              border: `1px solid ${navigationLevel === l.id ? "#f97316" : "#27272a"}`,
              background: navigationLevel === l.id ? "rgba(249,115,22,0.15)" : "transparent",
              color: navigationLevel === l.id ? "#fb923c" : "#a1a1aa",
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            {t(l.labelKey)}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "#a1a1aa", marginBottom: 6 }}>
        {t("view_controls.density")}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(
          [
            { id: "overview" as const, labelKey: "view_controls.density_overview" },
            { id: "learn" as const, labelKey: "view_controls.density_learn" },
            { id: "deep-dive" as const, labelKey: "view_controls.density_deep" },
          ] as const
        ).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPersona(p.id)}
            style={{
              flex: 1,
              padding: "5px 6px",
              borderRadius: 5,
              border: `1px solid ${persona === p.id ? "#f97316" : "#27272a"}`,
              background: persona === p.id ? "rgba(249,115,22,0.15)" : "transparent",
              color: persona === p.id ? "#fb923c" : "#a1a1aa",
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "#a1a1aa", marginBottom: 6 }}>
        {t("view_controls.layers")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button
          type="button"
          onClick={() => onFocusLayer(null)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 8px",
            borderRadius: 5,
            border: `1px solid ${focusedLayer === null ? "#3f3f46" : "#27272a"}`,
            background: focusedLayer === null ? "rgba(63,63,70,0.4)" : "transparent",
            color: "#d4d4d8",
            fontSize: 11,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#52525b" }} />
          {t("view_controls.all_layers")}
        </button>
        {cosmos.layers.map((l) => {
          const active = focusedLayer === l.id;
          const count = cosmos.nodes.filter((n) => n.layerId === l.id).length;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onFocusLayer(active ? null : l.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 8px",
                borderRadius: 5,
                border: `1px solid ${active ? l.color ?? "#3f3f46" : "#27272a"}`,
                background: active ? `${l.color}22` : "transparent",
                color: "#d4d4d8",
                fontSize: 11,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color ?? DEFAULT_LAYER_COLOR }} />
              <span style={{ flex: 1 }}>{l.label}</span>
              <span style={{ color: "#71717a", fontSize: 10 }}>{count}</span>
            </button>
          );
        })}
      </div>
      </div>
    </aside>
  );
}

// ── Drill request (Phase B+C) — user-driven drill-down to subgraphs ──
//
// The drill flow:
//   1. User shift-clicks nodes on canvas (multi-select) or selects one.
//   2. User clicks the floating "Drill into N nodes" CTA.
//   3. DrillPromptModal opens with a default prompt template + lets
//      the user edit it.
//   4. On submit, the viewer dispatches a `drill-request` notification
//      via `props.onNotifyAgent` (the existing viewer→agent channel).
//      The payload is a structured XML-like block the SKILL teaches
//      the agent to recognize.
//   5. The viewer enters "pending" state on the anchor nodes (dashed
//      orange ring + "drilling…" badge) and tracks the anchor
//      signature locally.
//   6. Agent reads the notification, writes `cosmos.subgraphs[]` with
//      status: "pending" (optional placeholder) then status: "ready"
//      with nodes/edges, emits a `<viewer-locator>` card pointing at
//      `{ subgraphId }`.
//   7. Viewer's source subscription fires; pending state clears; the
//      DRILLS sidebar grows a new entry. Clicking the locator (or the
//      DRILLS entry) navigates the canvas into the subgraph view.

/** Generate the default prompt template shown in the modal. The user
 *  can edit before sending. Uses the localized template from the
 *  cosmos namespace (count-aware: `_one` vs `_other`) interpolated
 *  with the joined anchor name list. The user's working language
 *  drives the t() resolution, so this naturally tracks Pneuma's
 *  Language menu without any per-mode locale heuristic. */
function defaultDrillPrompt(
  anchorIds: string[],
  cosmos: Cosmos,
  t: TFunction<"cosmos">,
): string {
  const names = anchorIds
    .map((id) => cosmos.nodes.find((n) => n.id === id)?.name ?? id)
    .map((n) => `「${n}」`)
    .join("、");
  return t("drill_modal.default_prompt", { count: anchorIds.length, anchors: names });
}

/** Build the `<drill-request>` XML-ish payload the agent reads in
 *  the viewer-notification. Carries the anchors, the user's edited
 *  prompt, and the parent subgraph id (when drilling inside an
 *  existing subgraph — recursive depth). */
function buildDrillRequestPayload(opts: {
  anchors: string[];
  prompt: string;
  parentSubgraphId: string | null;
  cosmos: Cosmos;
}): string {
  const { anchors, prompt, parentSubgraphId, cosmos } = opts;
  const anchorNames = anchors
    .map((id) => {
      const n = cosmos.nodes.find((x) => x.id === id);
      return n ? `${id} (${n.name})` : id;
    })
    .join(", ");
  const lines: string[] = [];
  lines.push("<drill-request>");
  lines.push(`  <anchors ids="${anchors.join(",")}" />`);
  if (parentSubgraphId) {
    lines.push(`  <parent subgraph-id="${parentSubgraphId}" />`);
  }
  lines.push(`  <anchor-names>${anchorNames}</anchor-names>`);
  lines.push("  <prompt>");
  lines.push(prompt);
  lines.push("  </prompt>");
  lines.push("</drill-request>");
  lines.push("");
  lines.push(
    "The user asked you to drill into the anchor nodes above. Read the SKILL.md \"Drill-down\" chapter for the protocol: write a new entry in `cosmos.subgraphs[]` with status: \"ready\" once nodes/edges are authored, then emit a `<viewer-locator>` card targeting the new subgraph so the user can navigate.",
  );
  return lines.join("\n");
}

interface DrillPromptModalProps {
  anchors: string[];
  defaultPrompt: string;
  cosmos: Cosmos;
  parentSubgraphId: string | null;
  onCancel: () => void;
  onSubmit: (prompt: string) => void;
}

function DrillPromptModal({
  anchors,
  defaultPrompt,
  cosmos,
  parentSubgraphId,
  onCancel,
  onSubmit,
}: DrillPromptModalProps) {
  const { t } = useTranslation("cosmos");
  const [text, setText] = useState(defaultPrompt);
  const anchorNames = anchors
    .map((id) => cosmos.nodes.find((n) => n.id === id))
    .filter((n): n is CosmosNode => Boolean(n));
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2200,
        background: "rgba(9,9,11,0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(5px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "92vw",
          background: "rgba(24,24,27,0.98)",
          border: "1px solid rgba(249,115,22,0.4)",
          borderRadius: 12,
          padding: "22px 26px",
          color: "#e4e4e7",
          fontFamily: "Inter, sans-serif",
          boxShadow: "0 30px 60px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: "rgba(249,115,22,0.85)",
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          {parentSubgraphId ? t("drill_modal.eyebrow_nested") : t("drill_modal.eyebrow")}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 12 }}>
          {t("drill_modal.title", { count: anchors.length })}
        </div>
        {/* Anchor chip strip — confirms which nodes the agent will be
            asked to expand */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
          {anchorNames.map((n) => (
            <span
              key={n.id}
              style={{
                fontSize: 10.5,
                padding: "3px 8px",
                borderRadius: 4,
                background: "rgba(249,115,22,0.1)",
                border: "1px solid rgba(249,115,22,0.32)",
                color: "#fed7aa",
              }}
            >
              {n.name}
            </span>
          ))}
        </div>
        <label
          style={{
            display: "block",
            fontSize: 10,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: "#a1a1aa",
            marginBottom: 4,
          }}
        >
          {t("drill_modal.prompt_label")}
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          rows={5}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.5,
            background: "rgba(9,9,11,0.85)",
            color: "#e4e4e7",
            border: "1px solid #3f3f46",
            borderRadius: 6,
            resize: "vertical",
            fontFamily: "Inter, sans-serif",
            marginBottom: 14,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 10, color: "#71717a", lineHeight: 1.4, maxWidth: 320 }}>
            {t("drill_modal.hint")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                border: "1px solid #3f3f46",
                background: "transparent",
                color: "#a1a1aa",
                borderRadius: 5,
                cursor: "pointer",
              }}
            >
              {t("drill_modal.cancel")}
            </button>
            <button
              type="button"
              onClick={() => onSubmit(text.trim() || defaultPrompt)}
              disabled={text.trim().length === 0}
              style={{
                padding: "8px 16px",
                fontSize: 12,
                fontWeight: 600,
                border: "1px solid rgba(249,115,22,0.7)",
                background:
                  "linear-gradient(135deg, rgba(249,115,22,0.85), rgba(251,146,60,0.7))",
                color: "#fff",
                borderRadius: 5,
                cursor: "pointer",
                opacity: text.trim().length === 0 ? 0.5 : 1,
              }}
            >
              {t("drill_modal.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── NodeTooltip — hover preview after 200ms ──────────────────────────

interface NodeTooltipProps {
  cosmos: Cosmos;
  node: CosmosNode;
  x: number;
  y: number;
}

function NodeTooltip({ cosmos, node, x, y }: NodeTooltipProps) {
  const layer = cosmos.layers.find((l) => l.id === node.layerId);
  // Tooltip placed near cursor but clamped from viewport edges.
  const W = 280;
  const H = 120;
  const left = Math.min(window.innerWidth - W - 12, x + 16);
  const top = Math.min(window.innerHeight - H - 12, y + 12);
  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: W,
        background: "rgba(24,24,27,0.97)",
        border: "1px solid #27272a",
        borderRadius: 8,
        padding: "10px 12px",
        boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
        color: "#e4e4e7",
        fontFamily: "Inter, sans-serif",
        fontSize: 11,
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        {layer && (
          <span style={{ width: 7, height: 7, borderRadius: 2, background: layer.color ?? DEFAULT_LAYER_COLOR }} />
        )}
        <span style={{ fontSize: 9, color: "#71717a", letterSpacing: 0.3 }}>{node.type}</span>
        {node.complexity && (
          <span
            style={{
              fontSize: 8,
              padding: "1px 5px",
              borderRadius: 2,
              background: `${COMPLEXITY_TINT[node.complexity] ?? "#52525b"}22`,
              color: COMPLEXITY_TINT[node.complexity] ?? "#a1a1aa",
              marginLeft: "auto",
              textTransform: "lowercase",
            }}
          >
            {node.complexity}
          </span>
        )}
      </div>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: "#fff" }}>{node.name}</div>
      <div
        style={{
          fontSize: 10,
          color: "#a1a1aa",
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {node.summary}
      </div>
    </div>
  );
}

// ── HelpModal — keyboard shortcuts ────────────────────────────────────

interface HelpModalProps {
  onClose: () => void;
  hasPerspectives: boolean;
}

function HelpModal({ onClose, hasPerspectives }: HelpModalProps) {
  const { t } = useTranslation("cosmos");
  const shortcuts: { keys: string; description: string }[] = [
    { keys: "?", description: t("help_modal.shortcut_help") },
    { keys: "R", description: t("help_modal.shortcut_reset") },
    { keys: "F", description: t("help_modal.shortcut_fit") },
    { keys: "1", description: t("help_modal.shortcut_density_overview") },
    { keys: "2", description: t("help_modal.shortcut_density_learn") },
    { keys: "3", description: t("help_modal.shortcut_density_deep") },
    { keys: "P", description: t("help_modal.shortcut_level") },
    ...(hasPerspectives
      ? [
          {
            keys: t("help_modal.shortcut_tour_tab_key"),
            description: t("help_modal.shortcut_tour_tab"),
          },
        ]
      : []),
    { keys: "Esc", description: t("help_modal.shortcut_escape") },
  ];
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(9,9,11,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "90vw",
          background: "rgba(24,24,27,0.98)",
          border: "1px solid #27272a",
          borderRadius: 10,
          padding: "20px 24px",
          color: "#e4e4e7",
          fontFamily: "Inter, sans-serif",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{t("help_modal.title")}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 18,
              color: "#71717a",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shortcuts.map((s) => (
            <div key={s.keys} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12 }}>
              <code
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid #3f3f46",
                  color: "#fed7aa",
                  minWidth: 36,
                  textAlign: "center",
                }}
              >
                {s.keys}
              </code>
              <span style={{ color: "#d4d4d8" }}>{s.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── OnboardingOverlay — 5-step welcome (first visit only) ──────────────

interface OnboardingOverlayProps {
  onDismiss: () => void;
  hasPerspectives: boolean;
}

function OnboardingOverlay({ onDismiss, hasPerspectives }: OnboardingOverlayProps) {
  const { t } = useTranslation("cosmos");
  const [step, setStep] = useState(0);
  const steps: { title: string; body: string }[] = [
    { title: t("onboarding.step1_title"), body: t("onboarding.step1_body") },
    { title: t("onboarding.step2_title"), body: t("onboarding.step2_body") },
    { title: t("onboarding.step3_title"), body: t("onboarding.step3_body") },
    { title: t("onboarding.step4_title"), body: t("onboarding.step4_body") },
    ...(hasPerspectives
      ? [{ title: t("onboarding.step5_title"), body: t("onboarding.step5_body") }]
      : []),
  ];
  const isLast = step >= steps.length - 1;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1900,
        background: "rgba(9,9,11,0.86)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: "90vw",
          background: "rgba(24,24,27,0.98)",
          border: "1px solid rgba(249,115,22,0.4)",
          borderRadius: 12,
          padding: "26px 30px",
          color: "#e4e4e7",
          fontFamily: "Inter, sans-serif",
          boxShadow: "0 30px 60px rgba(0,0,0,0.6), 0 0 0 4px rgba(249,115,22,0.06)",
        }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: "rgba(249,115,22,0.85)",
            marginBottom: 6,
            fontStyle: "italic",
          }}
        >
          {t("onboarding.eyebrow", { current: step + 1, total: steps.length })}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 12 }}>{steps[step].title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "#d4d4d8", marginBottom: 22 }}>{steps[step].body}</div>
        {/* progress dots */}
        <div style={{ display: "flex", gap: 5, marginBottom: 18 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: i <= step ? "rgba(249,115,22,0.7)" : "rgba(255,255,255,0.08)",
                transition: "background 200ms ease",
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              fontSize: 11,
              color: "#71717a",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              letterSpacing: 0.4,
            }}
          >
            {t("onboarding.dont_show_again")}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 5,
                  border: "1px solid #27272a",
                  background: "transparent",
                  color: "#a1a1aa",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {t("onboarding.back")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLast) onDismiss();
                else setStep((s) => s + 1);
              }}
              style={{
                padding: "7px 18px",
                borderRadius: 5,
                border: "1px solid rgba(249,115,22,0.6)",
                background: "rgba(249,115,22,0.18)",
                color: "#fb923c",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {isLast ? t("onboarding.get_started") : t("onboarding.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────

function EmptyState() {
  const { t } = useTranslation("cosmos");
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#09090b",
        color: "#71717a",
        fontFamily: "Inter, sans-serif",
        gap: 8,
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 16, color: "#d4d4d8" }}>{t("empty_state.title")}</div>
      <div style={{ fontSize: 13, maxWidth: 420, lineHeight: 1.5 }}>{t("empty_state.body")}</div>
    </div>
  );
}

// ── Top-level PreviewComponent ──────────────────────────────────────

export function CosmosPreview(props: ViewerPreviewProps) {
  const { t } = useTranslation("cosmos");
  const cosmosSource = props.sources.cosmos as Source<Cosmos> | undefined;
  const { value: cosmos } = useSource(cosmosSource);
  // First-impression navigation is project-overview — gestalt before detail.
  // Click a layer card or use the toggle to drop into detail.
  const [navigationLevel, setNavigationLevel] = useState<NavigationLevel>("project-overview");
  // In detail level, default to overview persona (labels only) for large
  // cosmoses; user dials up density when they zoom in.
  const [persona, setPersona] = useState<Persona>("overview");
  const [focusedLayer, setFocusedLayer] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  /**
   * Additional anchors added via shift+click — used for multi-node
   * drill-down requests. The primary `selectedNodeId` always drives
   * INFO + tour navigation; `extraAnchors` is a set of ids the user
   * has *added* alongside. Clicking a node without shift clears the
   * extras; shift+clicking toggles a node in/out. Anchors for a
   * drill request = primary ∪ extraAnchors.
   */
  const [extraAnchors, setExtraAnchors] = useState<Set<string>>(() => new Set());
  /** Currently navigated subgraph — `null` means main cosmos. Set
   *  via DRILLS sidebar click or `<viewer-locator>` with subgraphId.
   *  Resets selection/tour when changing scope. */
  const [activeSubgraphId, setActiveSubgraphId] = useState<string | null>(null);
  /** Open state of the drill prompt modal. Carries the anchor list
   *  + default prompt at the moment Drill was clicked, so the modal
   *  is stable even if the user keeps clicking nodes underneath. */
  const [drillModalState, setDrillModalState] = useState<
    | { anchors: string[]; defaultPrompt: string }
    | null
  >(null);
  /** Local "drills in flight" tracker — keyed by the canonical
   *  anchor signature (sorted ids). Cleared when a matching subgraph
   *  appears in cosmos.subgraphs. Used to render the pending UI on
   *  the anchor nodes + a "drilling…" status next to the DRILLS
   *  tab. The agent's authoritative pending state is whatever it
   *  writes to cosmos.subgraphs[].status; this local tracker only
   *  bridges the latency between "send request" and "first write".
   */
  const [pendingDrillAnchorKeys, setPendingDrillAnchorKeys] = useState<Set<string>>(
    () => new Set(),
  );
  // The active tour, discriminated by kind. `overall` walks the canonical
  // `cosmos.tour[]`; `perspective` walks one of `cosmos.perspectives[]`
  // (the new shape of what we used to call "Tao"). `null` means no tour
  // is running — the user is free-exploring. The two share a unified
  // stepper UI but render different framing (lens chip + thesis vs.
  // plain step badge).
  const [activeTour, setActiveTour] = useState<ActiveTour | null>(null);
  // Type-chip filter — categories the user has temporarily hidden.
  const [hiddenCategories, setHiddenCategories] = useState<Set<CosmosNodeCategory>>(() => new Set());
  // Hover tooltip state.
  const [hoveredNode, setHoveredNode] = useState<{ node: CosmosNode; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Help + onboarding modals.
  const [helpOpen, setHelpOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem("cosmos:onboarded") !== "1";
    } catch {
      return false;
    }
  });
  const fitViewRef = useRef<() => void>(() => {});
  const navigateRef = useRef<(id: string) => void>(() => {});
  const resetLayoutRef = useRef<() => void>(() => {});

  const dismissOnboarding = useCallback(() => {
    try {
      window.localStorage.setItem("cosmos:onboarded", "1");
    } catch {
      /* ignore — incognito etc. */
    }
    setOnboardingOpen(false);
  }, []);

  // Multi-select handlers (drill-down) — declared up here because
  // the keyboard handler effect below needs `handleClearExtraAnchors`
  // in its closure dependency list.
  const handleShiftClickNode = useCallback((n: CosmosNode) => {
    setExtraAnchors((prev) => {
      const next = new Set(prev);
      if (next.has(n.id)) next.delete(n.id);
      else next.add(n.id);
      return next;
    });
  }, []);
  const handleClearExtraAnchors = useCallback(() => {
    setExtraAnchors((prev) => (prev.size > 0 ? new Set<string>() : prev));
  }, []);

  const toggleCategoryHidden = useCallback((cat: CosmosNodeCategory) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Keyboard shortcuts at the document level. Skip when user is typing
  // in an input / textarea / contenteditable so search box etc. work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isTyping && e.key !== "Escape") return;

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setHelpOpen((o) => !o);
      } else if (e.key === "Escape") {
        // Escape unwinds in nested order: dismiss modals first, then
        // end an active tour, then exit a subgraph view, then clear
        // selection. One press = one layer popped.
        if (helpOpen) setHelpOpen(false);
        else if (onboardingOpen) dismissOnboarding();
        else if (drillModalState) setDrillModalState(null);
        else if (activeTour) setActiveTour(null);
        else if (activeSubgraphId) setActiveSubgraphId(null);
        else if (extraAnchors.size > 0) handleClearExtraAnchors();
        else setSelectedNodeId(null);
      } else if (e.key === "p") {
        setNavigationLevel((l) => (l === "project-overview" ? "detail" : "project-overview"));
      } else if (e.key === "1") {
        setPersona("overview");
      } else if (e.key === "2") {
        setPersona("learn");
      } else if (e.key === "3") {
        setPersona("deep-dive");
      } else if (e.key === "r" || e.key === "R") {
        resetLayoutRef.current();
      } else if (e.key === "f" || e.key === "F") {
        fitViewRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    helpOpen,
    onboardingOpen,
    dismissOnboarding,
    cosmos,
    activeTour,
    drillModalState,
    activeSubgraphId,
    extraAnchors,
    handleClearExtraAnchors,
  ]);

  // Layer-card click in project-overview → drill into that layer.
  const handleLayerCardClick = useCallback((layerId: string) => {
    setFocusedLayer(layerId);
    setNavigationLevel("detail");
    setSelectedNodeId(null);
  }, []);

  // ── Tour controls (handles both overall + perspective kinds) ──
  //
  // A tour-start is also a *filter reset*: clearing focusedLayer keeps
  // off-layer steps from landing dimmed — that was the same bug the
  // search handler hits. A tour is an "explicit walk", which trumps
  // whatever sticky layer filter the user had on.
  //
  // The unified step shape — overall and perspective tours both
  // resolve to the same `{step, focus[], narrative}` triple here, so
  // the stepper UI doesn't have to branch on tour kind beyond
  // framing. Overall tour: each step has a single focus node and
  // the curated narrative. Perspective: each step has focus[] (1+
  // ids) and its own per-step narrative; legacy perspectives with
  // only `manifestsIn[]` get steps synthesized by the normalizer
  // (with insight reused as narrative — degraded but renders).
  const tourStepsForActive = useCallback(
    (
      kind: ActiveTour,
    ): Array<{ step: number; focus: string[]; narrative: string }> | null => {
      if (!cosmos) return null;
      if (kind.kind === "overall") {
        return (cosmos.tour ?? []).map((s) => ({
          step: s.step,
          focus: [s.nodeId],
          narrative: s.narrative,
        }));
      }
      const persp = cosmos.perspectives?.find((p) => p.id === kind.perspectiveId);
      if (!persp || !Array.isArray(persp.steps) || persp.steps.length === 0) return null;
      return persp.steps.map((s, i) => ({
        step: i + 1,
        focus: s.focus,
        narrative: s.narrative,
      }));
    },
    [cosmos],
  );

  const handleStartOverallTour = useCallback(() => {
    if (!cosmos?.tour || cosmos.tour.length === 0) return;
    const first = cosmos.tour[0];
    setFocusedLayer(null);
    setActiveTour({ kind: "overall", step: first.step });
    setNavigationLevel("detail");
    setSelectedNodeId(first.nodeId);
    setTimeout(() => navigateRef.current(first.nodeId), 80);
  }, [cosmos]);

  const handleStartPerspectiveTour = useCallback(
    (perspectiveId: string) => {
      if (!cosmos?.perspectives) return;
      const persp = cosmos.perspectives.find((p) => p.id === perspectiveId);
      if (!persp || !persp.steps || persp.steps.length === 0) return;
      const firstStep = persp.steps[0];
      if (!firstStep.focus || firstStep.focus.length === 0) return;
      const primary = firstStep.focus[0];
      setFocusedLayer(null);
      setActiveTour({ kind: "perspective", perspectiveId, step: 1 });
      setNavigationLevel("detail");
      setSelectedNodeId(primary);
      setTimeout(() => navigateRef.current(primary), 80);
    },
    [cosmos],
  );

  // End-tour also clears the primary selection + extra anchors. The
  // last step's focus node would otherwise stay highlighted on the
  // canvas after the tour ended, which reads as "the user is still
  // pointed at this node" — but the user just *exited* the walk.
  // The Esc keyboard path goes through the same flow so the two stay
  // consistent.
  const handleEndTour = useCallback(() => {
    setActiveTour(null);
    setSelectedNodeId(null);
    setExtraAnchors((prev) => (prev.size > 0 ? new Set<string>() : prev));
  }, []);

  const handleTourStep = useCallback(
    (step: number) => {
      if (!cosmos || !activeTour) return;
      const steps = tourStepsForActive(activeTour);
      if (!steps) return;
      const stepEntry = steps.find((s) => s.step === step);
      if (!stepEntry || stepEntry.focus.length === 0) return;
      const primary = stepEntry.focus[0];
      setActiveTour({ ...activeTour, step });
      setNavigationLevel("detail");
      setSelectedNodeId(primary);
      setTimeout(() => navigateRef.current(primary), 60);
    },
    [cosmos, activeTour, tourStepsForActive],
  );

  // Resolve the current step's focus[] so the canvas can light up
  // every focus node together (not just the selected primary). Null
  // when no tour is active or the current step has no focus.
  const tourFocus: string[] | null = useMemo(() => {
    if (!activeTour || !cosmos) return null;
    const steps = tourStepsForActive(activeTour);
    if (!steps) return null;
    const stepEntry = steps.find((s) => s.step === activeTour.step);
    return stepEntry ? stepEntry.focus : null;
  }, [activeTour, cosmos, tourStepsForActive]);

  // Handle selection of a concrete node — produce a ViewerSelectionContext
  // with the round-trippable address per the protocol.
  const handleSelectNode = useCallback(
    (n: CosmosNode | null) => {
      setSelectedNodeId(n?.id ?? null);
      if (!n) {
        props.onSelect(null);
        return;
      }
      props.onSelect({
        type: "cosmos-node",
        content: n.name,
        address: { nodeId: n.id },
        label: `${n.type} "${n.name}"`,
        nearbyText: n.summary,
      });
    },
    [props],
  );

  // Route agent action requests (navigate-to / focus-layer / fit-view / switch-persona).
  useEffect(() => {
    const req = props.actionRequest;
    if (!req || !props.onActionResult) return;
    try {
      switch (req.actionId) {
        case "navigate-to": {
          const address = req.params?.address as
            | { nodeId?: string; perspectiveId?: string; subgraphId?: string }
            | undefined;
          if (address?.subgraphId) {
            // Navigating to a subgraph = enter its view. The agent's
            // post-drill locator card lands here. We also end any
            // active tour (its node ids may not exist in the
            // subgraph scope), clear extras, and force detail level
            // so the user sees the actual subgraph nodes rather than
            // empty layer-overview cards.
            setActiveSubgraphId(address.subgraphId);
            setActiveTour(null);
            handleClearExtraAnchors();
            setSelectedNodeId(null);
            setNavigationLevel("detail");
            props.onActionResult(req.requestId, { success: true });
          } else if (address?.nodeId) {
            navigateRef.current(address.nodeId);
            setSelectedNodeId(address.nodeId);
            props.onActionResult(req.requestId, { success: true });
          } else if (address?.perspectiveId) {
            // Navigating to a perspective = start that perspective tour.
            handleStartPerspectiveTour(address.perspectiveId);
            props.onActionResult(req.requestId, { success: true });
          } else {
            props.onActionResult(req.requestId, {
              success: false,
              message: "missing address.nodeId, address.perspectiveId, or address.subgraphId",
            });
          }
          break;
        }
        case "focus-layer": {
          const address = req.params?.address as { layerId?: string } | undefined;
          if (address?.layerId) {
            setFocusedLayer(address.layerId);
            props.onActionResult(req.requestId, { success: true });
          } else {
            props.onActionResult(req.requestId, { success: false, message: "missing address.layerId" });
          }
          break;
        }
        case "fit-view": {
          fitViewRef.current();
          props.onActionResult(req.requestId, { success: true });
          break;
        }
        case "switch-persona": {
          const p = req.params?.persona as Persona | undefined;
          if (p === "overview" || p === "learn" || p === "deep-dive") {
            setPersona(p);
            props.onActionResult(req.requestId, { success: true });
          } else {
            props.onActionResult(req.requestId, { success: false, message: "invalid persona" });
          }
          break;
        }
        default: {
          props.onActionResult(req.requestId, { success: false, message: "unknown action" });
        }
      }
    } catch (err) {
      props.onActionResult(req.requestId, { success: false, message: String(err) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.actionRequest]);

  // Locator card path (User → Viewer navigation).
  //
  // When the agent embeds a `<viewer-locator>` card in chat and the
  // user clicks it, the runtime sets `props.navigateRequest` to a
  // ViewerLocator with `{ label, address }`. We route the same
  // address shapes as `navigate-to` here, then call
  // `onNavigateComplete` to clear the request. Distinct from the
  // imperative `navigate-to` action above: locator clicks are user
  // intent; the action is agent imperative. Both share the address
  // vocabulary so the agent can use whichever fits the moment.
  useEffect(() => {
    const req = props.navigateRequest;
    if (!req) return;
    const address = req.address as
      | { nodeId?: string; layerId?: string; perspectiveId?: string; subgraphId?: string }
      | undefined;
    if (address?.subgraphId) {
      // Subgraph entry. If the address also carries a `nodeId`, do
      // "enter subgraph, then select that node inside it" — the
      // node-pan is deferred so React Flow has the new node set
      // committed before computing its center. Force detail level
      // so the user actually sees the subgraph's nodes.
      setActiveSubgraphId(address.subgraphId);
      setActiveTour(null);
      handleClearExtraAnchors();
      setNavigationLevel("detail");
      if (typeof address.nodeId === "string") {
        setSelectedNodeId(address.nodeId);
        setTimeout(() => navigateRef.current(address.nodeId!), 120);
      } else {
        setSelectedNodeId(null);
      }
    } else if (address?.nodeId) {
      // Plain node navigation in the current scope (main or current
      // subgraph). Lookup is scoped to the effective cosmos.
      navigateRef.current(address.nodeId);
      setSelectedNodeId(address.nodeId);
    } else if (address?.perspectiveId) {
      handleStartPerspectiveTour(address.perspectiveId);
    } else if (address?.layerId) {
      setFocusedLayer(address.layerId);
    }
    props.onNavigateComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.navigateRequest]);

  // ── Hooks below MUST be unconditional (no early-return before them)
  // to keep call order stable across cosmos = null ↔ cosmos = value
  // renders. React enforces this.

  const handleNodeHover = useCallback((n: CosmosNode | null, x?: number, y?: number) => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (n && x !== undefined && y !== undefined) {
      hoverTimer.current = setTimeout(() => setHoveredNode({ node: n, x, y }), 220);
    } else {
      setHoveredNode(null);
    }
  }, []);

  const presentCategories = useMemo(() => {
    if (!cosmos) return [];
    const set = new Set<CosmosNodeCategory>();
    for (const n of cosmos.nodes) set.add(n.category ?? "other");
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [cosmos]);

  // ── Drill-down hooks (unconditional — must run on every render to
  //  keep hook-call order stable across cosmos = null ↔ value). The
  //  early-return guard below short-circuits the rest of the render,
  //  not the hooks. ────────────────────────────────────────────────

  // Synthesized "effective" cosmos. When `activeSubgraphId` is set
  // and the matching subgraph is `status: "ready"`, swap to that
  // subgraph's nodes/edges (with anchor nodes pulled from the main
  // graph so the user sees where the drill attaches). When cosmos
  // itself is null we return a benign empty object — the early-
  // return below will short-circuit before anything reads it.
  const effectiveCosmos = useMemo<Cosmos>(() => {
    if (!cosmos) {
      return {
        version: "0",
        project: { name: "" },
        nodes: [],
        edges: [],
        layers: [],
      };
    }
    const sg = activeSubgraphId
      ? cosmos.subgraphs?.find((s) => s.id === activeSubgraphId) ?? null
      : null;
    if (!sg || sg.status !== "ready") return cosmos;
    const byId = new Map(cosmos.nodes.map((n) => [n.id, n]));
    const anchorNodes = sg.anchors
      .map((id) => byId.get(id))
      .filter((n): n is CosmosNode => Boolean(n));
    return {
      ...cosmos,
      nodes: [...anchorNodes, ...(sg.nodes ?? [])],
      edges: sg.edges ?? [],
    };
  }, [cosmos, activeSubgraphId]);

  // Pending-drill anchor ids — flattened from locally tracked keys
  // + cosmos.subgraphs entries with status: "pending".
  const pendingDrillAnchors = useMemo(() => {
    const set = new Set<string>();
    for (const key of pendingDrillAnchorKeys) {
      for (const id of key.split(",")) if (id) set.add(id);
    }
    for (const sg of cosmos?.subgraphs ?? []) {
      if (sg.status === "pending") {
        for (const id of sg.anchors) set.add(id);
      }
    }
    return set;
  }, [pendingDrillAnchorKeys, cosmos?.subgraphs]);

  // The full drill anchor list — primary + extras, deduped.
  const drillAnchors: string[] = useMemo(() => {
    const list: string[] = [];
    if (selectedNodeId) list.push(selectedNodeId);
    for (const id of extraAnchors) if (id !== selectedNodeId) list.push(id);
    return list;
  }, [selectedNodeId, extraAnchors]);

  // Canvas's `extraAnchors` prop — must be a *stable* array reference
  // when the underlying data hasn't changed, otherwise Canvas's
  // useMemo chain (extraAnchorSet → selectedNeighbors → rfNodes →
  // combinedNodes) re-fires on every parent render, which makes the
  // `setNodes(combinedNodes)` effect overwrite user-dragged node
  // positions on each frame. Memoizing here breaks that cascade.
  const canvasExtraAnchors = useMemo(
    () => drillAnchors.filter((id) => id !== selectedNodeId),
    [drillAnchors, selectedNodeId],
  );

  // Clear any local pending entries the agent has now answered.
  // Runs on every cosmos update — if a `ready` (or `failed`)
  // subgraph appears whose anchor signature matches a local
  // pending key, drop the key (the cosmos.subgraphs entry is now
  // the source of truth).
  useEffect(() => {
    if (!cosmos) return;
    if (pendingDrillAnchorKeys.size === 0) return;
    const sig = (ids: string[]) => [...ids].sort().join(",");
    const readySigs = new Set(
      (cosmos.subgraphs ?? [])
        .filter((s) => s.status !== "pending")
        .map((s) => sig(s.anchors)),
    );
    let changed = false;
    const next = new Set<string>();
    for (const key of pendingDrillAnchorKeys) {
      if (readySigs.has(key)) changed = true;
      else next.add(key);
    }
    if (changed) setPendingDrillAnchorKeys(next);
  }, [cosmos, pendingDrillAnchorKeys]);

  if (!cosmos) return <EmptyState />;

  const perspectiveCount = cosmos.perspectives?.length ?? 0;

  // Resolve selected node id to its full object — scoped to the
  // effective cosmos so an in-subgraph selection finds the subgraph
  // node, not the main one.
  const selectedNode = selectedNodeId
    ? effectiveCosmos.nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  // Canonical signature for an anchor set — sorted ids joined by
  // ",". Mirrors what the pending-cleanup effect uses; kept inline
  // here because the modal's onSubmit path needs it.
  const anchorSignature = (ids: string[]): string => [...ids].sort().join(",");

  const handleSearchSelect = (n: CosmosNode) => {
    // Clear any active layer focus — otherwise a hit outside that layer
    // lands dimmed-out and the user can't see what they searched for.
    // Search is an explicit override that means "take me to this node",
    // not "this node within my current filter".
    setFocusedLayer(null);
    setNavigationLevel("detail");
    setSelectedNodeId(n.id);
    setTimeout(() => navigateRef.current(n.id), 60);
    handleSelectNode(n);
  };

  // (handleNodeHover + presentCategories moved above the early-return
  // for hook-order stability.)

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "#09090b" }}>
      {/* Top strip: search bar + type chips + ? help */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "8px 14px",
          borderBottom: "1px solid #27272a",
          background: "rgba(9,9,11,0.96)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <SearchBar cosmos={cosmos} onSelectHit={handleSearchSelect} />
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title={t("help_modal.tooltip")}
            style={{
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid #27272a",
              background: "transparent",
              color: "#a1a1aa",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              minWidth: 32,
            }}
          >
            ?
          </button>
        </div>
        {presentCategories.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, letterSpacing: 0.5, color: "#52525b", marginRight: 4 }}>{t("categories.label")}</span>
            {presentCategories.map((cat) => {
              const hidden = hiddenCategories.has(cat);
              const tint = CATEGORY_TINT[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategoryHidden(cat)}
                  title={
                    hidden
                      ? t("categories.show_tooltip", { kind: t(`categories.${cat}`) })
                      : t("categories.hide_tooltip", { kind: t(`categories.${cat}`) })
                  }
                  style={{
                    fontSize: 9,
                    letterSpacing: 0.6,
                    padding: "3px 8px",
                    borderRadius: 3,
                    border: `1px solid ${hidden ? "#27272a" : tint}55`,
                    background: hidden ? "transparent" : `${tint}18`,
                    color: hidden ? "#52525b" : tint,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 5,
                      height: 5,
                      borderRadius: 1,
                      marginRight: 5,
                      background: hidden ? "#3f3f46" : tint,
                    }}
                  />
                  {t(`categories.${cat}`)}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* Body: sidebar (left) + canvas + drawer (right, overlays canvas) */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        <Sidebar
          cosmos={effectiveCosmos}
          subgraphs={cosmos.subgraphs ?? []}
          activeSubgraphId={activeSubgraphId}
          onEnterSubgraph={(id) => {
            // Entering a subgraph also resets the in-main session
            // state that doesn't belong inside it: tours (their
            // step nodes may not exist), the extra-anchor pile,
            // primary selection. Force `detail` level — subgraphs
            // are 10–15 nodes typically; project-overview's layer
            // aggregation collapses them into mostly-empty cards.
            setActiveTour(null);
            handleClearExtraAnchors();
            setSelectedNodeId(null);
            setNavigationLevel("detail");
            setActiveSubgraphId(id);
          }}
          onExitSubgraph={() => {
            setActiveTour(null);
            handleClearExtraAnchors();
            setSelectedNodeId(null);
            setActiveSubgraphId(null);
          }}
          navigationLevel={navigationLevel}
          onNavigationLevel={setNavigationLevel}
          persona={persona}
          onPersona={setPersona}
          focusedLayer={focusedLayer}
          onFocusLayer={setFocusedLayer}
          perspectiveCount={perspectiveCount}
          onSelectNode={(n) => {
            // Selecting from sidebar — auto-drop into detail so the
            // node is actually visible on the canvas, then center on it.
            if (n) {
              setNavigationLevel("detail");
              handleSelectNode(n);
              setTimeout(() => navigateRef.current(n.id), 60);
            } else {
              handleSelectNode(null);
            }
          }}
          activeTour={activeTour}
          onStartOverallTour={handleStartOverallTour}
          onStartPerspectiveTour={handleStartPerspectiveTour}
          onEndTour={handleEndTour}
          onTourStep={handleTourStep}
        />
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <ReactFlowProvider>
            <Canvas
              cosmos={effectiveCosmos}
              persona={persona}
              navigationLevel={navigationLevel}
              focusedLayer={focusedLayer}
              selectedNodeId={selectedNodeId}
              tourFocus={tourFocus}
              extraAnchors={canvasExtraAnchors}
              pendingDrillAnchors={pendingDrillAnchors}
              hiddenCategories={hiddenCategories}
              onSelectNode={handleSelectNode}
              onShiftClickNode={handleShiftClickNode}
              onClearExtraAnchors={handleClearExtraAnchors}
              onLayerCardClick={handleLayerCardClick}
              onNodeHover={handleNodeHover}
              registerFitView={(fn) => {
                fitViewRef.current = fn;
              }}
              registerNavigate={(fn) => {
                navigateRef.current = fn;
              }}
              registerResetLayout={(fn) => {
                resetLayoutRef.current = fn;
              }}
            />
          </ReactFlowProvider>
          {/* Floating Drill action — appears when the user has any
              anchor selected. Bottom-left of the canvas, above the
              React Flow controls strip. */}
          {drillAnchors.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setDrillModalState({
                  anchors: drillAnchors,
                  defaultPrompt: defaultDrillPrompt(drillAnchors, effectiveCosmos, t),
                })
              }
              style={{
                position: "absolute",
                bottom: 16,
                left: 72, // sit right of the React Flow controls column
                padding: "9px 14px",
                borderRadius: 8,
                border: "1px solid rgba(249,115,22,0.65)",
                background:
                  "linear-gradient(135deg, rgba(249,115,22,0.85), rgba(251,146,60,0.7))",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.3,
                cursor: "pointer",
                boxShadow: "0 8px 24px rgba(249,115,22,0.28)",
                zIndex: 6,
              }}
              title={t("canvas.drill_cta_tooltip")}
            >
              {t("canvas.drill_cta", { count: drillAnchors.length })}
            </button>
          )}
        </div>
        <NodeDrawer
          cosmos={effectiveCosmos}
          node={selectedNode}
          onSelectNode={(n) => {
            if (n) {
              setNavigationLevel("detail");
              handleSelectNode(n);
              setTimeout(() => navigateRef.current(n.id), 60);
            } else {
              handleSelectNode(null);
            }
          }}
          onClose={() => handleSelectNode(null)}
        />
      </div>

      {/* Hover tooltip — fixed-position overlay floating above the canvas */}
      {hoveredNode && hoveredNode.node.id !== selectedNodeId && (
        <NodeTooltip cosmos={effectiveCosmos} node={hoveredNode.node} x={hoveredNode.x} y={hoveredNode.y} />
      )}

      {/* Drill prompt modal — opens when the user clicks the Drill
          CTA. Lets them edit the prompt before sending. */}
      {drillModalState && (
        <DrillPromptModal
          anchors={drillModalState.anchors}
          defaultPrompt={drillModalState.defaultPrompt}
          cosmos={effectiveCosmos}
          parentSubgraphId={activeSubgraphId}
          onCancel={() => setDrillModalState(null)}
          onSubmit={(prompt) => {
            const sig = anchorSignature(drillModalState.anchors);
            setPendingDrillAnchorKeys((prev) => {
              const next = new Set(prev);
              next.add(sig);
              return next;
            });
            // Dispatch via the standard viewer→agent notification
            // channel. `severity: "warning"` flushes the message to
            // the agent on idle (info would be logged only). The
            // payload is a structured tag the SKILL teaches the
            // agent to recognize.
            props.onNotifyAgent?.({
              type: "drill-request",
              severity: "warning",
              message: buildDrillRequestPayload({
                anchors: drillModalState.anchors,
                prompt,
                parentSubgraphId: activeSubgraphId,
                cosmos: effectiveCosmos,
              }),
              summary: t("drill_modal.summary", { count: drillModalState.anchors.length }),
            });
            // Clear the anchor selection so the canvas releases the
            // shift-click pile; pending pulse is now the visual
            // anchor.
            handleClearExtraAnchors();
            setDrillModalState(null);
          }}
        />
      )}

      {/* Keyboard-shortcut help modal */}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} hasPerspectives={perspectiveCount > 0} />}

      {/* First-visit onboarding overlay (5-step intro) */}
      {onboardingOpen && <OnboardingOverlay onDismiss={dismissOnboarding} hasPerspectives={perspectiveCount > 0} />}
    </div>
  );
}

export default CosmosPreview;
