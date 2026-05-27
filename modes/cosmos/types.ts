/**
 * Cosmos domain types.
 *
 * A Cosmos is the structured projection of any content (code, prose,
 * research, business workflow…) into an interactive graph. `node.type`
 * is intentionally an open string — agents pick vocabulary per content
 * domain (codebase: file/function/class; fiction: character/event/clue;
 * research: claim/evidence; …). The viewer renders type → color via the
 * accompanying `layers[]` table.
 *
 * The schema's shape borrows from Lum1104/Understand-Anything (MIT);
 * see NOTICE.md for the full borrow/adapt/drop mapping.
 */

export interface CosmosProject {
  /** Human-readable name of the projected work (e.g. "src/", "The Antiqued Map", "Paper §4"). */
  name: string;
  /** Coarse content-domain tag for the agent's bookkeeping (e.g. "codebase", "fiction:mystery", "research:abstract"). Free-form. */
  kind?: string;
  /** Optional one-paragraph summary of the work being projected. */
  description?: string;
  /** ISO timestamp of when the projection was last produced. */
  analyzedAt?: string;
  /** Optional pointer back to source (git commit, file path, URL). */
  source?: string;
  /**
   * Absolute filesystem path to the root of the source material when
   * applicable — a codebase repo, a notes folder, a manuscript
   * directory. The viewer's INFO tab (default empty state) renders an
   * "Open project root in editor" affordance when this is set, so the
   * user can jump from the cosmos into their editor of choice with the
   * whole project as the open workspace. Subsequent file source-chip
   * clicks then naturally land in that editor's window (Cursor /
   * VS Code etc. activate the file inside the already-open workspace).
   *
   * Leave undefined for cosmoses with no on-disk source root (e.g., a
   * cosmos built from a conversation transcript or web URLs).
   */
  sourceRoot?: string;
}

/**
 * Cross-vocabulary category for a node. Free-form, but the viewer's
 * type-chip filters (CODE / CONFIG / DOCS / INFRA / DATA / DOMAIN /
 * KNOWLEDGE / OTHER) recognize these specific values. A node whose
 * `category` is set to one of those lights up the matching chip;
 * unset or unknown values fall into OTHER.
 *
 * Distinct from `type` (mode-defined vocabulary, e.g. `file` /
 * `character` / `claim`) because the chip-style filter wants a
 * domain-agnostic axis the user can toggle. A codebase mode might
 * map `file → code`, `config → config`, `README → docs`; a fiction
 * mode might leave it unset (no chip filter needed).
 */
export type CosmosNodeCategory =
  | "code"
  | "config"
  | "docs"
  | "infra"
  | "data"
  | "domain"
  | "knowledge"
  | "other";

/** Subjective complexity hint for a node. Used by the viewer's layer cards. */
export type CosmosNodeComplexity = "simple" | "moderate" | "complex";

/**
 * Multi-formed pointer back to a node's source material. Cosmos is
 * deliberately domain-agnostic: nodes can reference source files
 * (code, prose, notes), web URLs, fixed passages inside long
 * documents (chapter X paragraph Y), images, audio, video — any
 * artifact that produced the inference the node embodies.
 *
 * The viewer renders each ref as a click-to-open chip in the INFO
 * panel. The chip's behaviour is driven by `kind` (see the union
 * below): `file` opens with the user's default app / chosen editor,
 * `url` opens in the browser, `passage` opens the underlying file
 * (with the locator quoted in the chip tooltip so the user can scan
 * to it), `image` / `video` / `audio` open in the OS default
 * viewer.
 *
 * Multiple refs per node are normal. A character node in a fiction
 * cosmos might cite three chapters where the character appears; a
 * code node might cite the type definition file and a representative
 * caller; a research node might cite the paper PDF and its source
 * dataset URL.
 */
/**
 * Open-ended where-inside hint for a source ref. The viewer renders
 * it as a small chip beside the kind tag so the user knows the spot
 * in the source at a glance. Examples: "p.23", "5:32", "bottom-left",
 * "verse 14", "figure 3", "§4.2", "slide 7". Free-form — whatever
 * lets the user find the location in five seconds.
 *
 * Distinct from `passage.locator` (which is required and identifies
 * the passage itself). Every other ref kind now also accepts this
 * optional hint to point inside a single artifact (a page in a PDF,
 * a region in an image, a moment in audio, a frame in video).
 */
type CosmosSourceLocator = string;

/**
 * A real visual extract from the source — a cropped PDF page, a video
 * frame, a UI screenshot region, a figure lifted from a paper. The
 * viewer renders it inline as a visual anchor so the user can verify
 * or read the origin at a glance, then click through to the full
 * artifact.
 *
 * Workspace-relative or absolute path to the image on disk. NOT for
 * AI-generated illustrations; concept imagery belongs on the canvas
 * as a node, not here. Conflating excerpts with generated imagery
 * destroys the trust signal — the whole point is that the user can
 * see real source material before they commit to opening it.
 *
 * Populated by the agent using shell tools (sips, pdftoppm, ffmpeg)
 * — see the SKILL's *Visual anchoring* chapter for per-domain
 * recipes and the hard rule against generative imagery.
 */
interface CosmosSourceExcerpt {
  /**
   * Workspace-relative or absolute path to a real extract from the
   * source — a cropped PDF page, video frame, UI screenshot, etc.
   * The viewer renders it inline as a visual anchor. NOT for
   * AI-generated illustrations; concept imagery belongs on the
   * canvas as a node, not here.
   */
  path: string;
  /** Optional short caption shown beneath the excerpt thumbnail. */
  caption?: string;
}

export type CosmosSourceRef =
  /** A file on disk. Path is absolute or workspace-relative. Optional
   *  range pinpoints a span — currently informational (shown in the
   *  chip tooltip); editor jumping requires an editor-bridge upgrade
   *  that's deferred to a later phase. */
  | {
      kind: "file";
      path: string;
      range?: [number, number];
      label?: string;
      locator?: CosmosSourceLocator;
      excerpt?: CosmosSourceExcerpt;
    }
  /** A web URL. Opened with the OS default browser. */
  | {
      kind: "url";
      url: string;
      label?: string;
      locator?: CosmosSourceLocator;
      excerpt?: CosmosSourceExcerpt;
    }
  /** A passage inside a long-form document — chapter+paragraph in a
   *  novel, section+paragraph in a paper, slide number in a deck.
   *  `file` is the document, `locator` is the agent-defined address
   *  (e.g. "ch.3 ¶12", "§4.2", "slide 7"); `quote` is the lifted
   *  text the reasoning rests on. Opens the underlying file; the
   *  user navigates inside it using the locator (no automatic jump). */
  | {
      kind: "passage";
      file: string;
      locator: string;
      quote?: string;
      label?: string;
      excerpt?: CosmosSourceExcerpt;
    }
  /** A bitmap or vector image. */
  | {
      kind: "image";
      path: string;
      label?: string;
      locator?: CosmosSourceLocator;
      excerpt?: CosmosSourceExcerpt;
    }
  /** An audio file. `t` is an optional timestamp in seconds. */
  | {
      kind: "audio";
      path: string;
      t?: number;
      label?: string;
      locator?: CosmosSourceLocator;
      excerpt?: CosmosSourceExcerpt;
    }
  /** A video file. `t` is an optional timestamp in seconds. */
  | {
      kind: "video";
      path: string;
      t?: number;
      label?: string;
      locator?: CosmosSourceLocator;
      excerpt?: CosmosSourceExcerpt;
    };

/**
 * Optional domain-view metadata. Only relevant when the node represents
 * a business domain, flow, or step in the Domain projection. Mirrors
 * the upstream KnowledgeGraph's domainMeta shape (see NOTICE.md).
 */
export interface CosmosNodeDomainMeta {
  /** For domain nodes: bounded-context entities the domain owns. */
  entities?: string[];
  /** For domain nodes: business rules / invariants the domain holds. */
  businessRules?: string[];
  /** For domain nodes: known cross-domain integration points. */
  crossDomainInteractions?: string[];
  /** For flow nodes: the entry-point id or label (e.g., "POST /checkout"). */
  entryPoint?: string;
  /** For flow nodes: optional tag for the kind of entry (`http`, `cli`, `event`, …). */
  entryType?: string;
}

/**
 * Optional knowledge-view metadata. Only relevant when the cosmos
 * projects a wiki / knowledge base. Mirrors upstream's knowledgeMeta.
 */
export interface CosmosNodeKnowledgeMeta {
  /** Wikilink targets (other article ids) found in the article body. */
  wikilinks?: string[];
  /** Articles that wikilink to this node. */
  backlinks?: string[];
  /** Top-level category this article belongs to. */
  category?: string;
  /** Optional article body / claim text. Heavy; only on knowledge nodes. */
  content?: string;
}

export interface CosmosNode {
  /** Stable id, kebab-case prefix encouraged (e.g. `c-eliot`, `cl-x-mark`, `fn-auth-login`). */
  id: string;
  /** Open string — agent's vocabulary for this content domain. Examples: file, function, class, character, event, clue, claim, evidence, concept, entity. */
  type: string;
  /** Display name for the node (the noun the user reads). */
  name: string;
  /** Layer this node belongs to (must reference a `layers[].id`). Drives color in the viewer. */
  layerId?: string;
  /** Plain-English summary of what this node is. One sentence ideal, two max. */
  summary: string;
  /**
   * Domain-agnostic category for the type-chip filter (CODE / CONFIG /
   * DOCS / INFRA / DATA / DOMAIN / KNOWLEDGE / OTHER). Optional — when
   * unset, the chip filter treats the node as OTHER. See
   * `CosmosNodeCategory`.
   */
  category?: CosmosNodeCategory;
  /** Subjective complexity hint — viewer renders as a badge on layer cards. */
  complexity?: CosmosNodeComplexity;
  /** Multi-formed pointers back to source material — any combination
   *  of file / url / passage / image / audio / video. Rendered as
   *  click-to-open chips in the INFO panel. Zero or more per node;
   *  the viewer doesn't impose ordering, but agents typically list
   *  the most-authoritative source first. See `CosmosSourceRef`. */
  sources?: CosmosSourceRef[];
  /**
   * @deprecated Use `sources[]` instead. Single-string pointer that
   * existed before the multi-source rework. `normalizeCosmos` wraps
   * a legacy `source` string into `sources[0]` (file or url based on
   * a simple http(s) prefix heuristic), so older cosmos files still
   * render. The `source` value is left on the node for now to
   * survive a downgrade; new files should write `sources[]` directly.
   */
  source?: string;
  /**
   * @deprecated Use `sources[i].range` instead. The flat
   * `lineRange` was tied to `source` being a file path; the
   * multi-source schema folds it into the `file` source entry.
   * `normalizeCosmos` carries a legacy lineRange into the migrated
   * sources[0] when applicable.
   */
  lineRange?: [number, number];
  /** Optional language-specific notes — what stack / framework / dialect this node belongs to. Shown in the INFO panel. */
  languageNotes?: string;
  /** Optional free-form tags for filtering and search. */
  tags?: string[];
  /** Domain-view metadata. Only on nodes that participate in the Domain projection. */
  domainMeta?: CosmosNodeDomainMeta;
  /** Knowledge-view metadata. Only on nodes from a wiki / knowledge base. */
  knowledgeMeta?: CosmosNodeKnowledgeMeta;
  /** Domain-specific extra metadata. Agent can stash anything here; framework treats it as opaque. */
  meta?: Record<string, unknown>;
}

export interface CosmosEdge {
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  /** Open string — relationship verb. Examples: calls, imports, contains, depends_on, references, discovers, supports, contradicts, refers_to, marks_location, vanished_near, captains, related_to, authored. */
  type: string;
  /** `forward` (default), `backward`, or `bidirectional`. Drives arrow direction in the viewer. */
  direction?: "forward" | "backward" | "bidirectional";
  /** Optional one-sentence description of the relationship (shown on edge hover). */
  description?: string;
  /** Optional 0–1 weight for layout / visual emphasis. */
  weight?: number;
  /** Multi-formed pointers back to source material — same shape nodes
   *  use. Most edges don't need sources; use sparingly and only when
   *  the relationship claim itself benefits from grounding (an
   *  `imports` edge citing the import statement line, a `supports`
   *  edge citing the section that establishes the support). See
   *  `CosmosSourceRef` and the SKILL's *Visual anchoring* chapter. */
  sources?: CosmosSourceRef[];
}

export interface CosmosLayer {
  /** Stable id used by nodes' `layerId`. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** CSS color (hex, hsl, etc.) — drives node tint in the viewer. */
  color?: string;
  /** Optional description shown in the layer legend. */
  description?: string;
}

export interface CosmosTourStep {
  /** Order in the tour (1-based). */
  step: number;
  /** Node to focus this step on. */
  nodeId: string;
  /** Plain-English narrative — what does the user learn at this step? */
  narrative: string;
}

/**
 * CosmosPerspective — a guided walk through the cosmos seen through
 * one design lens.
 *
 * Where the overall `tour[]` is a single canonical reading path, a
 * perspective is a *variant tour* — same cosmos, but you're walking
 * it with a specific question in your hand. "Where does the system
 * maintain a feedback loop?" "Where do the v0.2 and v0.3 abstractions
 * collide?" "Where does entropy accumulate?" Each perspective answers
 * one such question by ordering nodes that bear on it and explaining
 * the through-line.
 *
 * A perspective is not invention. Each one must be defensible by
 * pointing at concrete nodes it walks through — that's what
 * `manifestsIn` is for. If a perspective can't be grounded in
 * specific nodes, the agent shouldn't have written it.
 *
 * The viewer surfaces perspectives in the TOUR tab alongside the
 * overall tour; the user picks one as an alternative reading path
 * through the same cosmos.
 *
 * Backward-compat note: this type used to be called `CosmosTao` and
 * the field on `Cosmos` was `tao[]`. The viewer reads
 * `cosmos.perspectives ?? cosmos.tao` so older cosmos.json files keep
 * working; new files should use the new field name.
 */
/**
 * One step in a perspective walk — a beat in the narration with its
 * own focus + its own paragraph. This is the unit the viewer's tour
 * stepper iterates over.
 *
 * `focus` is the **set** of node ids this step is about. Typically
 * 1, can be 2–4 when the beat lands on a small cluster ("these
 * three together form the loop"). The first id is the primary
 * anchor — selected for the INFO panel, used as the ViewerAddress;
 * the rest stay lit alongside so the user reads the cluster as a
 * unit. Direct neighbors of any focus node also stay lit; everything
 * else dims back.
 *
 * `narrative` is **this step's** paragraph — distinct from the
 * perspective's overall `insight`. The thesis frames the whole walk;
 * the narrative tells the user what they're looking at *right now*
 * and why this beat earns its place in the walk.
 */
export interface CosmosPerspectiveStep {
  /** Node ids focused for this step. At least one. First is the primary anchor (selected, info panel, ViewerAddress); additional ids stay lit alongside. */
  focus: string[];
  /** Step-specific paragraph — what the user is reading on this beat, not the perspective's thesis. One or two sentences. */
  narrative: string;
}

export interface CosmosPerspective {
  /** Stable id, prefix `perspective-` (e.g. `perspective-closed-loop`, `perspective-orthogonality`, `perspective-tension`). */
  id: string;
  /** Name of the perspective — the lens phrased as a noun (e.g. "Cybernetic loop maintaining attention", "Tension between v0.2 monolith and v0.3 published-language split"). Read out loud, this is what the user is about to explore. */
  name: string;
  /** Open string — the kind of lens. Starters: `orthogonality`, `cybernetic-loop`, `entropy`, `self-similarity`, `causal-chain`, `tension`, `convergence`, `layered-translation`, `hidden-hand`, `paradigm-shift`. Agents may extend. Shown as a small chip on the perspective card. */
  lens: string;
  /** One-paragraph thesis: what the user will see by walking the perspective and why it matters. Shown as the stepper's header; NOT used as per-step narrative — each step has its own. */
  insight: string;
  /** Ordered walk through the perspective. Each step has its own focus + narrative. Typically 3–6 steps. The discipline knob: if you can't write a distinct paragraph per step, you don't yet see the perspective sharply enough. */
  steps: CosmosPerspectiveStep[];
  /** Optional — why the inference is reasonable, citing what in the facts supports it (and what would falsify it). Shown at the end of the perspective walk. */
  evidence?: string;
  /** Optional tags for filtering. */
  tags?: string[];
  /**
   * @deprecated Pre-step schema only carried a flat list of node ids
   * with no per-step narrative. The normalizer synthesizes `steps[]`
   * from this when present — each manifestsIn id becomes a step with
   * the perspective's `insight` reused as narrative (degraded but
   * non-empty). New cosmos files should write `steps[]` directly.
   */
  manifestsIn?: string[];
}

/**
 * @deprecated Use `CosmosPerspective` instead. Retained as a re-export so
 * older code/tests/JSON keeping the old name still type-check during the
 * transition. Will be removed after the next viewer release.
 */
export type CosmosTao = CosmosPerspective;

/**
 * Wrap a legacy single-string `source` (with optional flat
 * `lineRange`) into the new `sources[]` shape. Heuristic: anything
 * starting with `http://` or `https://` becomes a url ref;
 * everything else is treated as a file path. Returns null when the
 * input is empty/unusable so the caller can skip migration.
 */
function migrateLegacySource(
  source: string | undefined,
  lineRange: [number, number] | undefined,
): CosmosSourceRef | null {
  if (!source || typeof source !== "string") return null;
  const trimmed = source.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: "url", url: trimmed };
  }
  const ref: CosmosSourceRef = { kind: "file", path: trimmed };
  if (Array.isArray(lineRange) && lineRange.length === 2) {
    ref.range = [lineRange[0], lineRange[1]];
  }
  return ref;
}

/**
 * Normalize a parsed cosmos to the current schema. Handles three
 * historical-rename cases transparently so older cosmos.json files
 * keep working:
 * 1. Top-level `tao[]` → `perspectives[]`
 * 2. Each perspective's `type` → `lens`; legacy `manifestsIn[]` →
 *    synthesized `steps[]` (each step reuses the perspective's
 *    `insight` as fallback narrative — degraded but non-empty)
 * 3. Node `source: string` (+ optional `lineRange`) → `sources[0]`
 *    as a file or url ref depending on http(s) prefix
 *
 * Anything else passes through untouched. Returns a *new* object —
 * does not mutate the input.
 */
export function normalizeCosmos(raw: unknown): Cosmos {
  if (!raw || typeof raw !== "object") return raw as Cosmos;
  const c = { ...(raw as Cosmos) };
  // Migrate node-level legacy `source: string` → `sources[]`.
  // Done first so any cosmos that downstream code consumes has the
  // unified shape regardless of when the file was written.
  if (Array.isArray(c.nodes)) {
    c.nodes = c.nodes.map((n) => {
      if (!n || typeof n !== "object") return n;
      const hasSources = Array.isArray(n.sources) && n.sources.length > 0;
      if (hasSources) return n; // already on the new shape
      const migrated = migrateLegacySource(n.source, n.lineRange);
      if (!migrated) return n;
      return { ...n, sources: [migrated] };
    });
  }
  const legacyTao = (raw as { tao?: unknown }).tao;
  const next = (raw as { perspectives?: unknown }).perspectives;
  // Prefer the new field; fall back to the legacy one. If neither is
  // present we leave `perspectives` undefined — the viewer treats that
  // as "no perspectives".
  const source = Array.isArray(next) ? next : Array.isArray(legacyTao) ? legacyTao : undefined;
  if (source) {
    c.perspectives = source.map((entry) => {
      if (!entry || typeof entry !== "object") return entry as CosmosPerspective;
      const e = entry as CosmosPerspective & { type?: string };
      // Lens field — copy from legacy `type` if `lens` unset.
      const lens = e.lens ?? e.type ?? "perspective";
      // Steps field — if missing, synthesize from manifestsIn so older
      // cosmos.json files still render. Per-step narrative falls back
      // to the perspective's overall insight (degraded but non-empty);
      // agents should rewrite to per-step narratives for the proper
      // experience. If neither steps nor manifestsIn is present, treat
      // it as a zero-step perspective (defensive — shouldn't happen).
      let steps = e.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        const m = e.manifestsIn;
        if (Array.isArray(m) && m.length > 0) {
          steps = m.map((nodeId) => ({
            focus: [nodeId],
            narrative: e.insight ?? "",
          }));
        } else {
          steps = [];
        }
      }
      return { ...e, lens, steps };
    });
  }
  // Strip the legacy field from the normalized output so consumers
  // don't get tempted to read it (and so JSON.stringify doesn't echo
  // both names back out).
  delete (c as { tao?: unknown }).tao;
  return c;
}

/**
 * CosmosSubgraph — a user-driven drill-down result.
 *
 * The cosmos's main graph + perspectives are pre-curated by the
 * agent ("here's what I think you should see"). Subgraphs are the
 * other half of the contract: when the user picks one or more nodes
 * and asks "go deeper here", that request becomes a subgraph — a
 * focused expansion with its own nodes and edges, grounded in the
 * anchors and the user's question.
 *
 * Subgraphs avoid the "agent must analyze everything upfront"
 * problem. The main graph stays a navigable overview; depth is
 * paid for on demand, where the user has indicated interest.
 *
 * Subgraphs can themselves be drilled into — `parentSubgraphId`
 * makes this a tree. The viewer renders a breadcrumb when navigated
 * into a subgraph and supports recursive drilling without limit.
 */
export interface CosmosSubgraph {
  /** Stable id, prefix `subgraph-` (e.g. `subgraph-cybernetic-loop-deep`). */
  id: string;
  /** Node ids in the parent graph (or parent subgraph) that triggered this drill. At least one; usually 1–4. */
  anchors: string[];
  /** The user's actual prompt — what they asked the agent to analyze. Shown in the DRILLS sidebar so the user can find a previous drill by what they were trying to learn. */
  prompt: string;
  /** Status of the drill task. `pending` while the agent is generating; `ready` once nodes/edges land; `failed` if the agent declined or gave up. */
  status: "pending" | "ready" | "failed";
  /** ISO timestamp when the drill was issued / completed. */
  generatedAt?: string;
  /** Optional human-readable explanation when status === "failed" — what the agent couldn't do and why. */
  message?: string;
  /** Parent subgraph id if this drill was issued from inside another subgraph; absent at top level. Enables the recursive drill tree. */
  parentSubgraphId?: string;
  /** Optional short title the agent assigned — shown on the breadcrumb and in DRILLS list. Falls back to the first line of the prompt when absent. */
  title?: string;
  /** Nodes the agent generated for this subgraph. Ids that match a main-graph node act as anchor references (no new node rendered); ids unique to the subgraph render as new nodes scoped to this view. */
  nodes?: CosmosNode[];
  /** Edges inside the subgraph. `source`/`target` reference node ids; ids pointing at main-graph nodes link back to the anchors. */
  edges?: CosmosEdge[];
}

/** Top-level view kind — drives the viewer's default projection. */
export type CosmosKind = "codebase" | "knowledge" | "general";

export interface Cosmos {
  /** Schema version. */
  version: string;
  /**
   * Top-level kind of cosmos. Drives the viewer's default projection
   * (codebase → structural graph; knowledge → wiki-style force-directed;
   * general → structural without code-specific affordances). Optional;
   * defaults to "general" if unset.
   */
  kind?: CosmosKind;
  /** Metadata about the projected work. */
  project: CosmosProject;
  /** All nodes in the graph. */
  nodes: CosmosNode[];
  /** All edges (directed by default). */
  edges: CosmosEdge[];
  /** Layer table — drives color, optional grouping in the viewer. */
  layers: CosmosLayer[];
  /** Optional curated walkthrough — what to look at first, second, third. */
  tour?: CosmosTourStep[];
  /**
   * Optional variant tours — guided walks through the cosmos seen
   * through specific design lenses. The viewer surfaces these in the
   * TOUR tab alongside the overall tour; each one offers an alternate
   * reading path. See `CosmosPerspective`.
   */
  perspectives?: CosmosPerspective[];

  /**
   * @deprecated Old name for `perspectives`. Kept on the type so files
   * written before the rename still parse. The viewer reads
   * `cosmos.perspectives ?? cosmos.tao` and prefers the new field. New
   * cosmos.json files should use `perspectives`.
   */
  tao?: CosmosPerspective[];

  /**
   * User-driven drill-down subgraphs — focused expansions the agent
   * generates in response to "go deeper here" requests. Each subgraph
   * is keyed by its anchor node set + the user's prompt, has its own
   * nodes/edges, and can itself be the parent of further drills via
   * `parentSubgraphId`. The viewer surfaces these in the DRILLS
   * sidebar tab and lets the user navigate into any one.
   */
  subgraphs?: CosmosSubgraph[];
}
