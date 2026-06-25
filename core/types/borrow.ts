/**
 * Borrow — peer / round-trip cross-mode handoff contract.
 *
 * A *handoff* is a goto: source agent A is killed and target B takes over with
 * A's context; control never returns. A *borrow* is a subroutine call: from a
 * live session A, the agent borrows another mode B's capability for one bounded
 * job. A stays alive and foreground; B does the job in a background sub-session,
 * writes a deliverable plus a structured {@link BorrowResult} to disk, and
 * signals completion; control returns to A. See ADR-015 and
 * `docs/proposals/errand-peer-handoff-design.md` for the full design.
 *
 * Three shapes live here, one per edge of the round trip:
 *   - {@link BorrowDispatchPayload} — caller A → server (the bounded brief)
 *   - {@link BorrowResult}          — borrowed mode B → disk → A (the return leg)
 *   - {@link BorrowLink}            — server's in-memory link record
 *
 * This module is pure types + small pure helpers/guards. No React, no server
 * imports — it is read by the Bun backend, the CLI, and (potentially) the
 * frontend status chip alike. Instantiation/consumption lands in later tasks
 * (`bin/borrow-cli.ts`, `server/borrow-routes.ts`, `server/skill-installer.ts`,
 * `bin/env-tag.ts`); see the AGENTS.md contracts table.
 */

/**
 * Who edits the host's canonical artifact after B finishes its job.
 *
 * - `"return"` (default) — B returns content + change-notes in its own scratch
 *   reach; A is the sole writer of the host artifact and applies the result.
 *   Preserves the division of expertise (B knows its craft, A knows its medium)
 *   and eliminates concurrent-write bugs. This is the safe default (ADR-015 D3).
 * - `"in-place"` — opt-in escape hatch: when the brief names host files in
 *   {@link BorrowDispatchPayload.in_place_targets} and the medium is one B
 *   genuinely owns (e.g. regenerating an existing asset in place), B may edit
 *   those host files directly and list them in {@link BorrowResult.applied_in_place}.
 */
export type BorrowScope = "return" | "in-place";

/**
 * Lifecycle state of a borrow, as tracked by the server's {@link BorrowLink}.
 *
 * `running` → terminal one of `completed` | `failed` | `cancelled` | `timed_out`.
 * The terminal set mirrors the value space {@link BorrowResult.status} reports
 * for the artifact (`completed` | `failed` | `partial`), plus the server-only
 * outcomes (`cancelled` | `timed_out`) that no result file can carry.
 */
export type BorrowState = "running" | "completed" | "failed" | "cancelled" | "timed_out";

/**
 * Status the borrowed mode B stamps onto its own deliverable.
 *
 * Distinct from {@link BorrowState}: this is B's self-report of the *artifact*,
 * not the server's view of the *link*. A `partial` borrow still produced
 * something useful but left {@link BorrowResult.open_questions} for A/the user.
 */
export type BorrowResultStatus = "completed" | "failed" | "partial";

/**
 * Where B sends its completion relay. Carried inside the on-disk brief (not the
 * CLI dispatch by default) so B's `borrow-return` CLI can reach A's own
 * per-session server across the two-server topology (each session runs its own
 * server on its own port). The loopback POST is localhost-only.
 */
export interface BorrowReturnVia {
  /** The borrow this relay belongs to. */
  borrow_id: string;
  /** Absolute URL of A's per-session server (A's `$PNEUMA_SERVER_URL`). */
  host_server_url: string;
}

/**
 * BorrowDispatchPayload — the bounded brief A submits via `pneuma borrow --json`.
 *
 * A deliberately superset-shaped sibling of the inbound-handoff payload, but a
 * distinct type: it carries borrow-specific fields (`expects`, `scope`,
 * `in_place_targets`, `return_via`) and omits handoff-terminal fields.
 *
 * Invariants (enforced by the dispatch route in a later task, not by this type):
 *   - `mode` + `brief` are required.
 *   - `in_place_targets` is ignored unless `scope === "in-place"`.
 *   - `inputs` / `in_place_targets` must resolve inside the project root
 *     (traversal guard, mirroring `/api/contentsets/delete`).
 */
export interface BorrowDispatchPayload {
  /** Target sub-mode (validated via `enumerateLocalModes`; never branched on). */
  mode: string;
  /** REQUIRED. The bounded job, stated for B's first turn. */
  brief: string;
  /** Host files/dirs B should read (read-only by default). Absolute paths. */
  inputs?: string[];
  /** What B must produce, stated in B's terms (advisory for B's first turn). */
  expects?: string;
  /** Who applies the result to the host artifact. Defaults to `"return"`. */
  scope?: BorrowScope;
  /** Host files B may edit — only meaningful when `scope === "in-place"`. */
  in_place_targets?: string[];
  /** Optional context (reuses the handoff `summary` vocabulary). */
  summary?: string;
  /** BCP47-ish language of the source conversation (`zh-CN`, `en`, …). */
  language?: string;
  /**
   * Completion-relay coordinates. Usually filled by A's server when it writes
   * the on-disk brief (so B knows where to POST its return), not set by the
   * agent's `pneuma borrow` call — but modeled here because the dispatch
   * payload and the on-disk brief share this type.
   */
  return_via?: BorrowReturnVia;
}

/**
 * One deliverable B produced for the borrow.
 *
 * `path` is the only required field — A needs it to read/place the artifact.
 * `kind`/`role` are advisory metadata for A and the UI; they carry no behavior.
 */
export interface BorrowProducedArtifact {
  /**
   * Absolute path B wrote. In B's own scratch reach for `scope: "return"`, or a
   * host file for `scope: "in-place"`.
   */
  path: string;
  /** Advisory media kind: `"markdown"` | `"image"` | `"json"` | … */
  kind?: string;
  /** Advisory semantic role in B's terms: `"polished-copy"` | `"logo"` | … */
  role?: string;
}

/**
 * BorrowResult — the return-leg contract, written by B into
 * `<Bdir>/borrow-result.json` and read by A.
 *
 * B is the sole writer of this file and of everything under `<Bdir>`; A is the
 * sole writer of the host's canonical artifact. This writer-ownership split is
 * what makes the default `scope: "return"` model safe.
 */
export interface BorrowResult {
  /** The borrow this result fulfills. */
  borrow_id: string;
  /** Which mode ran the borrow. */
  mode: string;
  /** B's self-report of the deliverable. */
  status: BorrowResultStatus;
  /** The deliverables. May be empty when `status === "failed"`. */
  produced: BorrowProducedArtifact[];
  /**
   * Human + agent readable: WHAT changed and WHY, in B's voice. For wordtaste,
   * a per-section map of original → revised + rationale. This is what lets A
   * reason about the change without diffing files itself.
   */
  change_notes: string;
  /** Host files B edited directly — present only when `scope` was `"in-place"`. */
  applied_in_place?: string[];
  /** Anything B could not resolve, bubbled back to A / the user. */
  open_questions?: string[];
  /** Timestamp (ms) when B wrote this result. */
  produced_at: number;
}

/**
 * BorrowLink — the server's in-memory link record, held in a
 * `Map<borrow_id, BorrowLink>` on A's per-session server (mirroring the handoff
 * proposal map, with a longer TTL since a borrow may legitimately run minutes).
 *
 * Disk is the source of truth: this map is an index/cache, reconstructable from
 * B's `session.json` provenance + `borrow-result.json` on a server restart.
 */
export interface BorrowLink {
  /** Stable id minted at dispatch; also B's project-session id. */
  borrow_id: string;
  /** A — the host session that dispatched the borrow. */
  host_session_id: string;
  /** B — the borrowed sub-session. */
  borrow_session_id: string;
  /** Target mode B runs. */
  mode: string;
  /** Present for project sessions; absent for quick sessions (B in a temp dir). */
  project_root?: string;
  /** Absolute `<Bdir>` — where B's brief and result live. */
  borrow_dir: string;
  /** Lifecycle state. */
  state: BorrowState;
  /** Timestamp (ms) when A dispatched the borrow. */
  dispatched_at: number;
}

/**
 * Concurrency default (resolves design OQ-5).
 *
 * One active borrow per host session; additional dispatches queue behind it.
 * Encoded as a single documented constant so the server task (which enforces
 * the cap) has one source of truth rather than re-deciding it inline.
 *
 * Rationale: a borrow is a bounded sub-task the host is waiting to fold back in;
 * letting one host fan out unbounded background sub-sessions invites resource
 * churn and a confusing return-leg ordering. Serializing keeps the mental model
 * "borrow → get it back → continue" and bounds spawned processes per host.
 */
export const MAX_CONCURRENT_BORROWS_PER_SESSION = 1 as const;

/**
 * Resolve the effective {@link BorrowScope} for a borrow.
 *
 * The brief is JSON read off disk, so a missing or stray value must never
 * become an accidental in-place write to a host file. Only the explicit literal
 * `"in-place"` selects the escape hatch; everything else — `undefined`, an
 * unknown string — resolves to the safe default `"return"`.
 */
export function normalizeBorrowScope(scope: BorrowScope | undefined): BorrowScope {
  return scope === "in-place" ? "in-place" : "return";
}

const BORROW_RESULT_STATUSES: ReadonlySet<string> = new Set<BorrowResultStatus>([
  "completed",
  "failed",
  "partial",
]);

/**
 * Runtime guard: validate an unknown value (e.g. parsed from
 * `<Bdir>/borrow-result.json`) against the {@link BorrowResult} schema.
 *
 * Checks the required scalar fields and their types, the `status` value space,
 * and that `produced` is an array of entries each carrying a string `path`.
 * Optional fields (`applied_in_place`, `open_questions`, per-artifact
 * `kind`/`role`) are tolerated. Mirrors `isProjectManifest`.
 *
 * Returns false on anything malformed — callers treat that as "no usable
 * result on disk".
 */
export function isBorrowResult(value: unknown): value is BorrowResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.borrow_id !== "string") return false;
  if (typeof v.mode !== "string") return false;
  if (typeof v.status !== "string" || !BORROW_RESULT_STATUSES.has(v.status)) return false;
  if (typeof v.change_notes !== "string") return false;
  if (typeof v.produced_at !== "number") return false;
  if (!Array.isArray(v.produced)) return false;
  for (const entry of v.produced) {
    if (!entry || typeof entry !== "object") return false;
    if (typeof (entry as Record<string, unknown>).path !== "string") return false;
  }
  return true;
}
