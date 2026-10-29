/**
 * craft-project.mjs — the executable rules of a `pneuma-craft/project/v1`
 * file, shared by every mode that persists generated media as craft assets.
 *
 * PURE and browser-safe: no `node:` imports, no I/O, no clock (every function
 * that stamps a time takes `now`). A mode viewer imports it by relative path
 * to read the file; `craft-project-io.mjs` imports it to write one. The type
 * authority is `core/types/craft-project.ts`; `craft-project.d.mts` declares
 * this module's surface in those types. Reference:
 * `docs/reference/craft-project-file.md`.
 *
 * The invariants it protects:
 *   1. asset ids are unique per file and match ASSET_ID_PATTERN; every edge
 *      points at registered assets; one edge per `toAssetId`;
 *   2. `ready` (or absent status) ⇒ `uri` non-empty (a `text` asset may keep
 *      its content inline) and, for an image, measured; `pending`,
 *      `generating` and `failed` may carry `uri: ""` and empty metadata;
 *   3. a call's record ends `ready` or `failed` — a `failed` asset's edge
 *      carries `params.failure`, and a reservation that replaces an earlier
 *      call carries that call forward in `params.earlier`, so a possibly
 *      billed call never silently disappears;
 *   4. every top-level key that is not craft's is the mode's sidecar and is
 *      passed through untouched, in its original position.
 */

export const CRAFT_PROJECT_SCHEMA = "pneuma-craft/project/v1";

export const ASSET_TYPES = ["video", "image", "audio", "text"];
export const ASSET_STATUSES = ["pending", "generating", "ready", "failed"];
/** Upstream `@pneuma-craft/core`'s six operation types, exactly. */
export const OPERATION_TYPES = ["upload", "import", "generate", "derive", "select", "composite"];
export const ACTORS = ["human", "agent"];
export const COST_BASES = ["estimate", "reported", "table"];
export const BILLINGS = ["none", "unknown"];

/** Allowed status moves. An absent status is `ready`. */
export const TRANSITIONS = Object.freeze({
  pending: Object.freeze(["generating", "ready", "failed"]),
  generating: Object.freeze(["ready", "failed"]),
  ready: Object.freeze([]),
  failed: Object.freeze([]),
});

/** Craft-owned top-level keys, in on-disk order. Every other key is sidecar. */
export const PROJECT_KEYS = ["$schema", "title", "composition", "assets", "provenance"];
export const COMPOSITION_KEYS = ["settings", "tracks", "transitions"];
export const SETTINGS_KEYS = ["width", "height", "fps", "aspectRatio", "sampleRate"];
export const ASSET_KEYS = ["id", "type", "uri", "name", "metadata", "createdAt", "status", "tags"];
export const EDGE_KEYS = ["toAssetId", "fromAssetId", "operation"];
export const OPERATION_KEYS = ["type", "actor", "agentId", "timestamp", "label", "params"];

/**
 * `operation.params` keys the lifecycle owns. A caller's free-form params may
 * not set them: each has exactly one writer (a flag or a lifecycle step).
 */
export const RESERVED_PARAM_KEYS = [
  "model", "prompt", "provider", "inputs", "cost", "failure", "requestId", "finishedAt", "earlier",
];

export const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** What `emptyProject` and the CLI's `init` use when no setting is given. */
export const DEFAULT_COMPOSITION_SETTINGS = Object.freeze({ width: 1920, height: 1080, fps: 30, aspectRatio: "16:9" });

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Effective status: an absent status is upstream's `ready`. */
export function statusOf(asset) {
  return asset?.status ?? "ready";
}

/**
 * Rebuild an object with a fixed key order so project.json diffs stay stable
 * no matter which command touched it. Unknown keys are appended, never lost.
 * (sprite-project.mjs `orderKeys`, verbatim.)
 */
function orderKeys(value, keys) {
  const out = {};
  for (const key of keys) if (value[key] !== undefined) out[key] = value[key];
  for (const key of Object.keys(value)) if (out[key] === undefined && value[key] !== undefined) out[key] = value[key];
  return out;
}

/** `16:9` for 1920x1080 — the reduced width:height ratio. */
export function aspectRatio(width, height) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

/** Why `id` is not a usable asset id, or null when it is. */
export function assetIdProblem(id) {
  if (typeof id !== "string" || id === "") return "an asset id must be a non-empty string";
  if (!ASSET_ID_PATTERN.test(id)) {
    return `asset id '${id}' must match ${ASSET_ID_PATTERN.source} (lowercase letters, digits and hyphens, starting with a letter or digit, at most 64 characters)`;
  }
  return null;
}

/** Why `value` is not JSON (NaN, a function, undefined in an array…), or null. */
function jsonProblem(value, at, depth = 0) {
  if (depth > 64) return `${at} is nested too deeply`;
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : `${at} is not a finite number`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const problem = jsonProblem(value[i], `${at}[${i}]`, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const [key, inner] of Object.entries(value)) {
      if (inner === undefined) continue; // JSON.stringify drops it
      const problem = jsonProblem(inner, `${at}.${key}`, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  return `${at} is not JSON (${typeof value})`;
}

function costProblem(cost, at) {
  if (!isRecord(cost)) return `${at} must be an object { usd, basis, note? }`;
  if (!(cost.usd === null || (isFiniteNumber(cost.usd) && cost.usd >= 0))) {
    return `${at}.usd must be a non-negative number or null (got ${JSON.stringify(cost.usd)})`;
  }
  if (!COST_BASES.includes(cost.basis)) return `${at}.basis must be one of ${COST_BASES.join(", ")} (got ${JSON.stringify(cost.basis)})`;
  if (cost.note !== undefined && typeof cost.note !== "string") return `${at}.note must be a string`;
  return null;
}

function failureProblem(failure, at) {
  if (!isRecord(failure)) return `${at} must be an object { reason, at, billing }`;
  if (typeof failure.reason !== "string" || !failure.reason.trim()) return `${at}.reason must be a non-empty string`;
  if (!isFiniteNumber(failure.at)) return `${at}.at must be epoch milliseconds`;
  if (!BILLINGS.includes(failure.billing)) return `${at}.billing must be one of ${BILLINGS.join(", ")} (got ${JSON.stringify(failure.billing)})`;
  return null;
}

// ---------------------------------------------------------------------------
// Validation and reading
// ---------------------------------------------------------------------------

function validateSettings(settings) {
  if (!isRecord(settings)) return "composition.settings must be an object";
  for (const key of ["width", "height", "fps"]) {
    if (!isFiniteNumber(settings[key]) || settings[key] <= 0) return `composition.settings.${key} must be a positive number`;
  }
  if (typeof settings.aspectRatio !== "string" || !settings.aspectRatio) return "composition.settings.aspectRatio must be a non-empty string";
  if (settings.sampleRate !== undefined && (!isFiniteNumber(settings.sampleRate) || settings.sampleRate <= 0)) {
    return "composition.settings.sampleRate must be a positive number";
  }
  return null;
}

function validateAsset(asset, at, ids) {
  if (!isRecord(asset)) return `${at} must be an object`;
  const idProblem = assetIdProblem(asset.id);
  if (idProblem) return `${at}: ${idProblem}`;
  const label = `${at} ('${asset.id}')`;
  if (ids.has(asset.id)) return `${label}: duplicate asset id '${asset.id}'`;
  ids.add(asset.id);
  if (!ASSET_TYPES.includes(asset.type)) return `${label}: type must be one of ${ASSET_TYPES.join(", ")} (got ${JSON.stringify(asset.type)})`;
  if (typeof asset.uri !== "string") return `${label}: uri must be a string`;
  if (typeof asset.name !== "string") return `${label}: name must be a string`;
  if (!isRecord(asset.metadata)) return `${label}: metadata must be an object`;
  const metadataProblem = jsonProblem(asset.metadata, "metadata");
  if (metadataProblem) return `${label}: ${metadataProblem}`;
  if (!isFiniteNumber(asset.createdAt)) return `${label}: createdAt must be epoch milliseconds`;
  if (asset.status !== undefined && !ASSET_STATUSES.includes(asset.status)) {
    return `${label}: status must be one of ${ASSET_STATUSES.join(", ")} (got ${JSON.stringify(asset.status)})`;
  }
  if (asset.tags !== undefined && (!Array.isArray(asset.tags) || asset.tags.some((t) => typeof t !== "string"))) {
    return `${label}: tags must be an array of strings`;
  }
  if (statusOf(asset) === "ready") {
    if (asset.uri === "" && asset.type !== "text") return `${label}: a ready ${asset.type} must have a uri`;
    if (asset.type === "image") {
      const { width, height } = asset.metadata;
      if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
        return `${label}: a ready image must be measured (metadata.width and metadata.height)`;
      }
    }
  }
  return null;
}

function validateEarlier(earlier, at) {
  if (!Array.isArray(earlier)) return `${at} must be an array`;
  for (let i = 0; i < earlier.length; i++) {
    const entry = earlier[i];
    const where = `${at}[${i}]`;
    if (!isRecord(entry)) return `${where} must be an object`;
    if (!isFiniteNumber(entry.at)) return `${where}.at must be epoch milliseconds`;
    if (entry.status !== "ready" && entry.status !== "failed") return `${where}.status must be ready or failed`;
    if (entry.status === "failed") {
      const problem = failureProblem(entry.failure, `${where}.failure`);
      if (problem) return problem;
    }
    if (entry.cost !== undefined) {
      const problem = costProblem(entry.cost, `${where}.cost`);
      if (problem) return problem;
    }
    if (entry.requestId !== undefined && typeof entry.requestId !== "string") return `${where}.requestId must be a string`;
  }
  return null;
}

function validateEdge(edge, at, assetsById, seen) {
  if (!isRecord(edge)) return `${at} must be an object`;
  if (typeof edge.toAssetId !== "string" || !assetsById.has(edge.toAssetId)) {
    return `${at}: provenance edge points at unknown asset '${edge.toAssetId}'`;
  }
  const label = `${at} (-> '${edge.toAssetId}')`;
  if (seen.has(edge.toAssetId)) return `${label}: a second provenance edge for '${edge.toAssetId}' — one edge per asset`;
  seen.add(edge.toAssetId);
  if (edge.fromAssetId !== null) {
    if (typeof edge.fromAssetId !== "string" || !assetsById.has(edge.fromAssetId)) {
      return `${label}: provenance edge comes from unknown asset '${edge.fromAssetId}'`;
    }
    if (edge.fromAssetId === edge.toAssetId) return `${label}: an asset cannot be its own parent`;
  }
  const op = edge.operation;
  if (!isRecord(op)) return `${label}: operation must be an object`;
  if (!OPERATION_TYPES.includes(op.type)) {
    return `${label}: operation.type must be one of ${OPERATION_TYPES.join(", ")} (got ${JSON.stringify(op.type)})`;
  }
  if (!ACTORS.includes(op.actor)) return `${label}: operation.actor must be one of ${ACTORS.join(", ")} (got ${JSON.stringify(op.actor)})`;
  if (op.agentId !== undefined && typeof op.agentId !== "string") return `${label}: operation.agentId must be a string`;
  if (!isFiniteNumber(op.timestamp)) return `${label}: operation.timestamp must be epoch milliseconds`;
  if (op.label !== undefined && typeof op.label !== "string") return `${label}: operation.label must be a string`;
  if (op.params === undefined) return null;
  if (!isRecord(op.params)) return `${label}: operation.params must be an object`;
  const paramsProblem = jsonProblem(op.params, "operation.params");
  if (paramsProblem) return `${label}: ${paramsProblem}`;
  const p = op.params;
  if (p.inputs !== undefined) {
    if (!Array.isArray(p.inputs) || p.inputs.length === 0) return `${label}: operation.params.inputs must be a non-empty array of asset ids`;
    for (const id of p.inputs) {
      if (typeof id !== "string" || !assetsById.has(id)) return `${label}: operation.params.inputs names unknown asset '${id}'`;
    }
    if (p.inputs[0] !== edge.fromAssetId) {
      return `${label}: operation.params.inputs[0] ('${p.inputs[0]}') must be the edge's fromAssetId ('${edge.fromAssetId}')`;
    }
  }
  for (const key of ["model", "prompt", "provider", "requestId"]) {
    if (p[key] !== undefined && typeof p[key] !== "string") return `${label}: operation.params.${key} must be a string`;
  }
  if (p.finishedAt !== undefined && !isFiniteNumber(p.finishedAt)) return `${label}: operation.params.finishedAt must be epoch milliseconds`;
  if (p.cost !== undefined) {
    const problem = costProblem(p.cost, "operation.params.cost");
    if (problem) return `${label}: ${problem}`;
  }
  if (p.failure !== undefined) {
    const problem = failureProblem(p.failure, "operation.params.failure");
    if (problem) return `${label}: ${problem}`;
    if (statusOf(assetsById.get(edge.toAssetId)) !== "failed") {
      return `${label}: operation.params.failure is set but '${edge.toAssetId}' is ${statusOf(assetsById.get(edge.toAssetId))}`;
    }
  }
  if (p.earlier !== undefined) {
    const problem = validateEarlier(p.earlier, "operation.params.earlier");
    if (problem) return `${label}: ${problem}`;
  }
  return null;
}

/**
 * Structural and referential validation of a whole project file.
 * `options.sidecarKey`, when given, must name a key the file carries — a file
 * without it is some other mode's project.
 *
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateProjectFile(value, options = {}) {
  const error = projectProblem(value, options);
  return error ? { ok: false, error } : { ok: true, value };
}

function projectProblem(value, { sidecarKey } = {}) {
  if (!isRecord(value)) return "the project file must be a JSON object";
  if (value.$schema !== CRAFT_PROJECT_SCHEMA) {
    return `$schema must be "${CRAFT_PROJECT_SCHEMA}" (got ${JSON.stringify(value.$schema)})`;
  }
  if (typeof value.title !== "string") return "title must be a string";
  if (!isRecord(value.composition)) return "composition must be an object";
  const settingsProblem = validateSettings(value.composition.settings);
  if (settingsProblem) return settingsProblem;
  if (!Array.isArray(value.composition.tracks)) return "composition.tracks must be an array";
  if (!Array.isArray(value.composition.transitions)) return "composition.transitions must be an array";
  if (!Array.isArray(value.assets)) return "assets must be an array";
  if (!Array.isArray(value.provenance)) return "provenance must be an array";

  const ids = new Set();
  for (let i = 0; i < value.assets.length; i++) {
    const problem = validateAsset(value.assets[i], `assets[${i}]`, ids);
    if (problem) return problem;
  }
  const assetsById = new Map(value.assets.map((a) => [a.id, a]));
  const seen = new Set();
  for (let i = 0; i < value.provenance.length; i++) {
    const problem = validateEdge(value.provenance[i], `provenance[${i}]`, assetsById, seen);
    if (problem) return problem;
  }
  for (const asset of value.assets) {
    if (statusOf(asset) !== "failed") continue;
    const edge = value.provenance.find((e) => e.toAssetId === asset.id);
    if (!edge?.operation?.params?.failure) {
      return `asset '${asset.id}' is failed but its provenance edge carries no operation.params.failure`;
    }
  }

  if (sidecarKey !== undefined) {
    if (PROJECT_KEYS.includes(sidecarKey)) return `'${sidecarKey}' is a craft key, not a sidecar key`;
    if (value[sidecarKey] === undefined) return `the file has no '${sidecarKey}' sidecar — it is not this mode's project`;
  }
  return null;
}

/**
 * Parse and validate a project file's text. Strict: a malformed asset or edge
 * makes the whole file invalid, with a named error the viewer can show.
 */
export function readProjectFile(raw, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  return validateProjectFile(parsed, options);
}

/**
 * A new, empty project. `settings` may be partial: the rest comes from
 * DEFAULT_COMPOSITION_SETTINGS, and `aspectRatio` is derived from the size
 * when it is not given.
 */
export function emptyProject({ title, settings = {}, sidecarKey, sidecar = {} }) {
  if (typeof title !== "string") throw new Error("emptyProject: title must be a string");
  if (typeof sidecarKey !== "string" || !sidecarKey) throw new Error("emptyProject: sidecarKey is required");
  if (PROJECT_KEYS.includes(sidecarKey)) throw new Error(`emptyProject: '${sidecarKey}' is a craft key, not a sidecar key`);
  const width = settings.width ?? DEFAULT_COMPOSITION_SETTINGS.width;
  const height = settings.height ?? DEFAULT_COMPOSITION_SETTINGS.height;
  const sized = settings.width !== undefined || settings.height !== undefined;
  const resolved = orderKeys({
    width,
    height,
    fps: settings.fps ?? DEFAULT_COMPOSITION_SETTINGS.fps,
    aspectRatio: settings.aspectRatio ?? (sized ? aspectRatio(width, height) : DEFAULT_COMPOSITION_SETTINGS.aspectRatio),
    sampleRate: settings.sampleRate,
  }, SETTINGS_KEYS);
  const doc = {
    $schema: CRAFT_PROJECT_SCHEMA,
    title,
    composition: { settings: resolved, tracks: [], transitions: [] },
    assets: [],
    provenance: [],
    [sidecarKey]: sidecar,
  };
  const problem = projectProblem(doc, { sidecarKey });
  if (problem) throw new Error(`emptyProject: ${problem}`);
  return doc;
}

/**
 * The craft key order on disk: top level `$schema, title, composition,
 * assets, provenance`, then every sidecar key in its original order and
 * untouched; asset, edge and operation keys in their fixed orders. Returns a
 * new object; the sidecar values are the same references.
 */
export function orderCraftKeys(doc) {
  const out = {};
  for (const key of PROJECT_KEYS) {
    if (doc[key] === undefined) continue;
    if (key === "composition" && isRecord(doc.composition)) {
      const composition = orderKeys(doc.composition, COMPOSITION_KEYS);
      if (isRecord(composition.settings)) composition.settings = orderKeys(composition.settings, SETTINGS_KEYS);
      out.composition = composition;
    } else if (key === "assets" && Array.isArray(doc.assets)) {
      out.assets = doc.assets.map((asset) => (isRecord(asset) ? orderKeys(asset, ASSET_KEYS) : asset));
    } else if (key === "provenance" && Array.isArray(doc.provenance)) {
      out.provenance = doc.provenance.map((edge) => {
        if (!isRecord(edge)) return edge;
        const ordered = orderKeys(edge, EDGE_KEYS);
        if (isRecord(ordered.operation)) ordered.operation = orderKeys(ordered.operation, OPERATION_KEYS);
        return ordered;
      });
    } else {
      out[key] = doc[key];
    }
  }
  for (const key of Object.keys(doc)) {
    if (!(key in out) && doc[key] !== undefined) out[key] = doc[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Indexing (what a viewer needs)
// ---------------------------------------------------------------------------

/** Assets by id and each asset's edge by `toAssetId`. */
export function indexAssets(doc) {
  const assets = new Map();
  for (const asset of doc.assets) assets.set(asset.id, asset);
  const edges = new Map();
  for (const edge of doc.provenance) edges.set(edge.toAssetId, edge);
  return { assets, edges };
}

/** Every input of an edge: `params.inputs` when listed, else the parent, else none. */
export function edgeInputs(edge) {
  const inputs = edge?.operation?.params?.inputs;
  if (Array.isArray(inputs)) return [...inputs];
  return edge?.fromAssetId ? [edge.fromAssetId] : [];
}

/** Percent-encode each `/`-separated segment, keeping the slashes. */
function encodePath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/**
 * The URL a viewer loads an asset from: `<prefix>/<uri>?r=<createdAt>`. The
 * stamp makes a file re-generated at the same path new bytes to the browser.
 * Null when there is nothing to load: the asset is not ready or has no uri.
 * A uri that is already a URL (`https:`, `data:`) is returned unchanged.
 *
 * @param {string} prefix e.g. "/content" or "/content/<contentSet>"
 */
export function resolveAssetUri(prefix, asset) {
  if (!asset || statusOf(asset) !== "ready" || typeof asset.uri !== "string" || !asset.uri) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(asset.uri)) return asset.uri;
  const base = String(prefix ?? "").replace(/\/+$/, "");
  const path = encodePath(asset.uri.replace(/^\/+/, ""));
  return `${base}/${path}?r=${asset.createdAt}`;
}

// ---------------------------------------------------------------------------
// Mutation (lifted from sprite-project.mjs)
// ---------------------------------------------------------------------------

/**
 * Write an asset, replacing an existing one IN PLACE so re-registering does
 * not shuffle the file (a re-run must be a no-op diff).
 */
export function upsertAsset(doc, asset) {
  const index = doc.assets.findIndex((a) => a.id === asset.id);
  if (index === -1) {
    doc.assets.push(asset);
    return;
  }
  doc.assets[index] = asset;
}

/** One edge per asset, kept at the position the asset first took. */
export function setEdge(doc, edge) {
  const index = doc.provenance.findIndex((e) => e.toAssetId === edge.toAssetId);
  if (index === -1) {
    doc.provenance.push(edge);
    return;
  }
  doc.provenance[index] = edge;
  doc.provenance = doc.provenance.filter((e, i) => i === index || e.toAssetId !== edge.toAssetId);
}

/**
 * Remove assets and their edges. A surviving edge never points at a removed
 * parent — neither as its parent nor in the fan-in list behind it. The list
 * keeps `operation`'s shape: the parent is its first surviving entry, and one
 * entry is no list. (sprite-project.mjs `dropAssets`, verbatim.)
 */
export function dropAssets(doc, ids) {
  const set = new Set(ids);
  doc.assets = doc.assets.filter((a) => !set.has(a.id));
  doc.provenance = doc.provenance.filter((e) => !set.has(e.toAssetId));
  doc.provenance = doc.provenance.map((e) => {
    const inputs = e.operation?.params?.inputs;
    if (Array.isArray(inputs) && inputs.some((id) => set.has(id))) {
      const kept = inputs.filter((id) => !set.has(id));
      const params = { ...e.operation.params };
      if (kept.length > 1) params.inputs = kept;
      else delete params.inputs;
      const operation = { ...e.operation };
      if (Object.keys(params).length) operation.params = params;
      else delete operation.params;
      return { ...e, fromAssetId: kept[0] ?? null, operation };
    }
    return e.fromAssetId && set.has(e.fromAssetId) ? { ...e, fromAssetId: null } : e;
  });
}

/**
 * craft edges are single-parent, so a fan-in step names its first input as
 * the parent and lists the whole set in params.inputs. A single input is
 * fully described by fromAssetId and carries no list. Undefined params are
 * dropped. (sprite-project.mjs `operation`, verbatim.)
 */
export function operation(type, timestamp, params, inputs, actor = "agent") {
  const merged = { ...params };
  if (inputs && inputs.length > 1) merged.inputs = inputs;
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  const op = { type, actor, timestamp };
  if (Object.keys(merged).length) op.params = merged;
  return op;
}

/** (sprite-project.mjs `edge`, verbatim.) */
export function edge(toAssetId, inputs, op) {
  return { toAssetId, fromAssetId: inputs && inputs.length ? inputs[0] : null, operation: op };
}

/**
 * The asset with its status moved to `next`, or a thrown error naming the
 * move that is not allowed (see TRANSITIONS).
 */
export function transition(asset, next) {
  if (!ASSET_STATUSES.includes(next)) throw new Error(`unknown status '${next}'`);
  const from = statusOf(asset);
  if (!TRANSITIONS[from].includes(next)) {
    const allowed = TRANSITIONS[from].length ? TRANSITIONS[from].join(" or ") : "nothing (it is final)";
    throw new Error(`asset '${asset.id}' is ${from} and cannot become ${next} — from ${from} it can become ${allowed}`);
  }
  return { ...asset, status: next };
}

// ---------------------------------------------------------------------------
// Lifecycle: reserve → land | fail
// ---------------------------------------------------------------------------

/** Whether an edge records a call someone may have paid for. */
export function isCallEdge(edge) {
  const op = edge?.operation;
  if (!op) return false;
  const p = op.params ?? {};
  return op.type === "generate" || typeof p.model === "string" || typeof p.provider === "string" || p.cost !== undefined;
}

/** What a replaced call leaves behind in `params.earlier`. */
function earlierAttempt(asset, previous, now) {
  const p = previous.operation.params ?? {};
  const status = statusOf(asset);
  const entry = { at: previous.operation.timestamp, status: status === "ready" ? "ready" : "failed" };
  if (typeof p.model === "string") entry.model = p.model;
  if (typeof p.requestId === "string") entry.requestId = p.requestId;
  if (p.cost !== undefined) entry.cost = p.cost;
  if (status === "failed" && p.failure) entry.failure = p.failure;
  else if (status !== "ready") {
    entry.failure = {
      reason: `replaced while ${status} — this call's outcome was never recorded`,
      at: now,
      billing: "unknown",
    };
  }
  return entry;
}

function checkCost(cost, allowed, label) {
  if (cost === undefined) return undefined;
  const problem = costProblem(cost, label);
  if (problem) throw new Error(problem);
  if (!allowed.includes(cost.basis)) throw new Error(`${label}.basis must be one of ${allowed.join(", ")} here (got '${cost.basis}')`);
  const out = { usd: cost.usd, basis: cost.basis };
  if (cost.note !== undefined) out.note = cost.note;
  return out;
}

/**
 * Reserve an asset BEFORE its call leaves: `pending` (or `generating`),
 * `uri` as planned or "", `metadata: {}`, and the edge with
 * `params.{model, prompt, provider, inputs?, cost?}`.
 *
 * A `ready` id is refused unless `force`. A `pending`, `generating` or
 * `failed` id is replaced in place; when the earlier edge has the same
 * operation type, an absent `model` / `prompt` / `provider` / `from` keeps
 * what it recorded (sprite's `keptGenerateEdge`). Every replaced call is
 * carried forward in `params.earlier`, so a call that may have been billed
 * never disappears from the cost reading.
 *
 * @returns {{ asset: object, edge: object }}
 */
export function reserveAsset(doc, spec, now) {
  const { id, type, name, op } = spec;
  const idProblem = assetIdProblem(id);
  if (idProblem) throw new Error(idProblem);
  if (!ASSET_TYPES.includes(type)) throw new Error(`type must be one of ${ASSET_TYPES.join(", ")} (got '${type}')`);
  if (typeof name !== "string" || !name.trim()) throw new Error("name is required");
  if (!OPERATION_TYPES.includes(op)) throw new Error(`op must be one of ${OPERATION_TYPES.join(", ")} (got '${op}')`);
  const actor = spec.actor ?? (op === "upload" ? "human" : "agent");
  if (!ACTORS.includes(actor)) throw new Error(`actor must be one of ${ACTORS.join(", ")} (got '${actor}')`);
  const uri = spec.uri ?? "";
  if (typeof uri !== "string") throw new Error("uri must be a string");
  if (!isFiniteNumber(now)) throw new Error("now must be epoch milliseconds");

  const extra = spec.params ?? {};
  if (!isRecord(extra)) throw new Error("params must be an object");
  const reserved = Object.keys(extra).filter((key) => RESERVED_PARAM_KEYS.includes(key));
  if (reserved.length) {
    throw new Error(`params may not set ${reserved.join(", ")} — ${reserved.length > 1 ? "they have" : "it has"} its own flag or lifecycle step`);
  }
  const extraProblem = jsonProblem(extra, "params");
  if (extraProblem) throw new Error(extraProblem);
  const cost = checkCost(spec.cost, ["estimate", "table"], "cost");

  const index = indexAssets(doc);
  if (spec.from !== undefined) {
    for (const input of spec.from) {
      if (!index.assets.has(input)) throw new Error(`from: unknown asset '${input}'`);
      if (input === id) throw new Error(`from: '${id}' cannot be its own input`);
    }
  }

  const existing = index.assets.get(id);
  const previous = existing ? index.edges.get(id) : undefined;
  if (existing && statusOf(existing) === "ready" && !spec.force) {
    throw new Error(`asset '${id}' is already ready — re-reserving it would replace a landed file; pass force (--force) or choose a new id`);
  }

  const sameOp = previous?.operation?.type === op ? previous : null;
  const keptParams = sameOp?.operation?.params ?? {};
  const inputs = spec.from !== undefined ? [...spec.from] : sameOp ? edgeInputs(sameOp) : [];
  const earlier = [
    ...(Array.isArray(previous?.operation?.params?.earlier) ? previous.operation.params.earlier : []),
    ...(previous && isCallEdge(previous) ? [earlierAttempt(existing, previous, now)] : []),
  ];

  const asset = {
    id, type, uri, name, metadata: {}, createdAt: now,
    status: spec.generating ? "generating" : "pending",
  };
  const tags = spec.tags ?? existing?.tags;
  if (tags !== undefined) asset.tags = [...tags];

  const recordedOp = operation(op, now, {
    model: spec.model ?? keptParams.model,
    prompt: spec.prompt ?? keptParams.prompt,
    provider: spec.provider ?? keptParams.provider,
    ...extra,
    cost,
    earlier: earlier.length ? earlier : undefined,
  }, inputs, actor);
  if (spec.agentId !== undefined) recordedOp.agentId = spec.agentId;
  if (spec.label !== undefined) recordedOp.label = spec.label;
  const record = edge(id, inputs, orderKeys(recordedOp, OPERATION_KEYS));

  upsertAsset(doc, asset);
  setEdge(doc, record);
  return { asset, edge: record };
}

/**
 * Land a reserved asset: `uri`, measured `metadata`, `ready`, and on its edge
 * `params.requestId` and `params.finishedAt`. A cost given here (a vendor's
 * reported figure, typically) replaces the reservation's estimate.
 * `createdAt` becomes the landing time, so the file's URL stamp is new.
 */
export function landAsset(doc, spec, now) {
  const { id, uri, metadata = {} } = spec;
  const index = indexAssets(doc);
  const asset = index.assets.get(id);
  if (!asset) throw new Error(`no asset '${id}' — reserve it first`);
  const previous = index.edges.get(id);
  if (!previous) throw new Error(`asset '${id}' has no provenance edge — reserve it again to record how it was made`);
  const moved = transition(asset, "ready");
  if (typeof uri !== "string" || !uri) throw new Error(`landing '${id}' needs the file's uri`);
  if (!isRecord(metadata)) throw new Error("metadata must be an object");
  if (spec.requestId !== undefined && typeof spec.requestId !== "string") throw new Error("requestId must be a string");
  const cost = checkCost(spec.cost, COST_BASES, "cost");

  const landed = { ...moved, uri, metadata, createdAt: now };
  const params = { ...(previous.operation.params ?? {}) };
  if (spec.requestId) params.requestId = spec.requestId;
  params.finishedAt = now;
  if (cost) params.cost = cost;
  const record = { ...previous, operation: { ...previous.operation, params } };

  upsertAsset(doc, landed);
  setEdge(doc, record);
  return { asset: landed, edge: record };
}

/**
 * Record a call that ended without a file: `failed`, and on its edge
 * `params.failure = { reason, at, billing }` (+ `requestId` when known).
 * `billing: "none"` only when the request provably never left.
 */
export function failAsset(doc, spec, now) {
  const { id, reason, billing } = spec;
  const index = indexAssets(doc);
  const asset = index.assets.get(id);
  if (!asset) throw new Error(`no asset '${id}' — reserve it first`);
  const previous = index.edges.get(id);
  if (!previous) throw new Error(`asset '${id}' has no provenance edge — reserve it again to record how it was made`);
  const moved = transition(asset, "failed");
  if (typeof reason !== "string" || !reason.trim()) throw new Error("a failure needs a reason");
  if (!BILLINGS.includes(billing)) throw new Error(`billing must be one of ${BILLINGS.join(", ")} (got '${billing}')`);
  if (spec.requestId !== undefined && typeof spec.requestId !== "string") throw new Error("requestId must be a string");

  const params = { ...(previous.operation.params ?? {}) };
  if (spec.requestId) params.requestId = spec.requestId;
  params.failure = { reason: reason.trim(), at: now, billing };
  const record = { ...previous, operation: { ...previous.operation, params } };

  upsertAsset(doc, moved);
  setEdge(doc, record);
  return { asset: moved, edge: record };
}

// ---------------------------------------------------------------------------
// Cost — read off the edges; there is no ledger
// ---------------------------------------------------------------------------

function round(usd) {
  return Math.round(usd * 10000) / 10000;
}

function costLine(assetId, attempt, opType, status, cost, failure, at, requestId) {
  const usd = isRecord(cost) && isFiniteNumber(cost.usd) ? round(cost.usd) : null;
  const basis = isRecord(cost) && COST_BASES.includes(cost.basis) ? cost.basis : null;
  return {
    assetId,
    attempt,
    operation: opType,
    status,
    usd,
    basis,
    billing: isRecord(failure) && BILLINGS.includes(failure.billing) ? failure.billing : null,
    at,
    requestId: typeof requestId === "string" && requestId ? requestId : null,
    sameCallAsLater: false,
  };
}

/**
 * Every call the file records, priced or not.
 *
 * A *call* is an edge that is a `generate`, names a `model` or `provider`, or
 * carries a `cost`; anything else (`derive` by a local tool, `upload`,
 * `select`, `composite` without a model) is a local step and costs nothing.
 * A call without a number is UNPRICED, never free. A call that failed with
 * `billing: "none"` provably never left and is excluded from the total; one
 * that failed with `"unknown"` stays in it and is listed as uncertain.
 * Earlier attempts a reservation replaced (`params.earlier`) count too —
 * except one whose `requestId` a LATER attempt of the same asset also
 * carries: that is the same remote job landed afterwards (a wait that timed
 * out, then reconciled by id), so it is counted once, as the later record,
 * and listed in `reconciled` instead.
 */
export function summarizeCosts(doc) {
  const assetsById = new Map(doc.assets.map((a) => [a.id, a]));
  const lines = [];
  for (const e of doc.provenance) {
    if (!isCallEdge(e)) continue;
    const p = e.operation.params ?? {};
    const earlier = Array.isArray(p.earlier) ? p.earlier : [];
    const own = earlier.map((entry, i) => costLine(e.toAssetId, i + 1, e.operation.type, entry.status, entry.cost, entry.failure, entry.at, entry.requestId));
    own.push(costLine(e.toAssetId, null, e.operation.type, statusOf(assetsById.get(e.toAssetId)), p.cost, p.failure, e.operation.timestamp, p.requestId));
    own.forEach((line, i) => {
      line.sameCallAsLater = line.requestId !== null && own.slice(i + 1).some((later) => later.requestId === line.requestId);
    });
    lines.push(...own);
  }

  const label = (line) => (line.attempt === null ? line.assetId : `${line.assetId}#${line.attempt}`);
  const counted = lines.filter((line) => !line.sameCallAsLater);
  const billed = counted.filter((line) => line.billing !== "none");
  const byBasis = { estimate: 0, reported: 0, table: 0 };
  let total = 0;
  for (const line of billed) {
    if (line.usd === null) continue;
    total += line.usd;
    if (line.basis) byBasis[line.basis] = round(byBasis[line.basis] + line.usd);
  }
  return {
    currency: "USD",
    total: round(total),
    calls: lines.length,
    priced: billed.filter((line) => line.usd !== null).length,
    byBasis,
    unpriced: billed.filter((line) => line.usd === null).map(label),
    uncertain: counted.filter((line) => line.billing === "unknown").map(label),
    notBilled: counted.filter((line) => line.billing === "none").map(label),
    inFlight: counted.filter((line) => line.status === "pending" || line.status === "generating").map(label),
    reconciled: lines.filter((line) => line.sameCallAsLater).map(label),
    lines,
  };
}
