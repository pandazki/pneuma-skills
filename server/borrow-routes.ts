/**
 * Borrow routes — the server layer of the peer / round-trip cross-mode handoff
 * (the *subroutine call*, as opposed to Smart Handoff's *goto*).
 *
 *   POST /api/borrows/dispatch  — host agent A's CLI submits a bounded brief;
 *                                 the server mints a borrow, stages the brief,
 *                                 and spawns mode B in the background.
 *   POST /api/borrows/return    — B's `borrow-return` CLI relays completion;
 *                                 the server validates B's on-disk result,
 *                                 marks the link terminal, and pokes A.
 *
 * These mount on **A's own per-session server** — not the launcher. The
 * launcher has no agent session, so its WS broadcast can't reach A's live
 * agent (server.md: "Launcher 没 agent session"). A's own server is the only
 * thing that can enqueue the return tag to A.
 *
 * State is held in an in-memory `Map<borrow_id, BorrowLink>` per server
 * instance, mirroring `handoff-routes.ts`'s proposal map but with a longer TTL
 * (a borrow may legitimately run minutes). Disk is the source of truth — the
 * map is an index/cache reconstructable from B's `session.json` provenance +
 * `borrow-result.json` (design §4.3, §8). A borrow NEVER kills A's session.
 *
 * See `docs/proposals/errand-peer-handoff-design.md` (named `errand` in the
 * proposal; the shipped name is `borrow`) and `core/types/borrow.ts`.
 */

import type { Hono } from "hono";
import { mkdir, rename, writeFile, readFile } from "node:fs/promises";
import { join, resolve as resolvePath, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  isBorrowResult,
  normalizeBorrowScope,
  MAX_CONCURRENT_BORROWS_PER_SESSION,
  type BorrowDispatchPayload,
  type BorrowLink,
  type BorrowState,
} from "../core/types/borrow.js";

/**
 * A link plus the brief the server must stage if/when the borrow is promoted
 * from the queue. We hold the assembled brief on the link record so a queued
 * borrow can be staged + spawned later without re-parsing the original request.
 */
interface QueuedBorrow {
  link: BorrowLink;
  brief: BorrowDispatchPayload;
}

/**
 * Minimal WS-bridge surface the borrow routes need. Method syntax (not arrow
 * properties) so the concrete `WsBridge` satisfies it structurally while tests
 * pass an in-memory mock.
 */
export interface BorrowWsBridgeLike {
  /**
   * Enqueue a server-originated system tag (the `<pneuma:borrow-returned>`
   * relay) for delivery to the host agent at a turn boundary — queued while
   * busy, dispatched on idle. NEVER mid-turn.
   */
  enqueueSystemSignal(sessionId: string, tag: string): void;
  /** Broadcast a status update to the host session's browsers (status chip). */
  broadcastToSession(sessionId: string, msg: { type: string } & Record<string, unknown>): void;
}

export interface BorrowLaunchParams {
  mode: string;
  /** Project root for project-scoped borrows; absent for quick (temp-dir) borrows. */
  project?: string;
  /** The minted borrow_id, used as B's session id. */
  sessionId: string;
  /** Desktop hint — run B hidden and do NOT reveal on completion (design §6.2). */
  background: boolean;
}

export interface BorrowRoutesOptions {
  /** WS bridge for the return-leg poke + browser status broadcasts. */
  wsBridge: BorrowWsBridgeLike;
  /**
   * The host session this server drives — every dispatch belongs to A. Used as
   * the link's `host_session_id` and the target of the return-leg poke. May be
   * a thunk so the server can resolve the live active session id at request
   * time (a quick session's id is only known once the agent connects).
   */
  hostSessionId: string | (() => string);
  /**
   * A's own server URL (`$PNEUMA_SERVER_URL`), written into the brief's
   * `return_via`. May be a thunk because the server's final bound port isn't
   * known until after `Bun.serve` (it auto-increments on collision), while
   * these routes mount earlier — the thunk is resolved at dispatch time.
   */
  hostServerUrl: string | (() => string);
  /**
   * Validate that `mode` is a launchable local mode. Wired to
   * `enumerateLocalModes` by the server — never branch on the mode name here.
   */
  validateMode: (mode: string) => boolean;
  /**
   * Resolve the host session's project root (placement decision). Returns
   * `{ projectRoot }` for a project session, `{}` / `null` for a quick session
   * (B then runs in an OS temp dir).
   */
  resolveHost: (hostSessionId: string) => Promise<{ projectRoot?: string } | null>;
  /**
   * Spawn B in the background and resolve once it's launching. Wired to
   * `launchPneumaChild` by the server. The borrow must NOT kill A.
   */
  launchBorrow: (params: BorrowLaunchParams) => Promise<{ sessionId: string; url: string }>;

  /** Override for tests so the prune timer doesn't keep the process alive. */
  pruneIntervalMs?: number;
  /** Override for tests so we can fast-forward the expiry deadline. */
  borrowTtlMs?: number;
}

export interface BorrowRoutesContext {
  /**
   * The active/terminal link map — exposed so tests + cross-route lookups can
   * inspect. Only borrows that have actually STARTED appear here (the contract
   * `BorrowState` has no `queued`); pending dispatches wait in the queue.
   */
  borrows: Map<string, BorrowLink>;
  /** Number of borrows waiting behind the concurrency cap. */
  queueDepth: () => number;
  /** Stop the prune timer (test cleanup). */
  stop: () => void;
}

const DEFAULT_PRUNE_INTERVAL_MS = 60_000; // 1 min
// A borrow may legitimately run many minutes (unlike a handoff proposal the
// user confirms quickly). 60 min, configurable for tests.
const DEFAULT_BORROW_TTL_MS = 60 * 60_000;

const TERMINAL_STATES: ReadonlySet<BorrowState> = new Set<BorrowState>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

function isTerminal(state: BorrowState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Resolve B's on-disk directory for a given placement.
 *   - project session → `<projectRoot>/.pneuma/sessions/<borrow_id>/`
 *   - quick session   → `<os-tmp>/pneuma-borrow-<borrow_id>/`
 * (design §5, §8 disk surface.)
 */
export function resolveBorrowDir(borrowId: string, projectRoot: string | undefined): string {
  if (projectRoot) {
    return join(projectRoot, ".pneuma", "sessions", borrowId);
  }
  return join(tmpdir(), `pneuma-borrow-${borrowId}`);
}

/**
 * Path-containment guard — true when `candidate` resolves inside `root` (or is
 * `root` itself). Mirrors `/api/contentsets/delete` + `mountFileRoute`'s
 * traversal check: `..` segments and absolute escapes are rejected. Used to
 * keep a borrow brief's `inputs` / `in_place_targets` inside the project root
 * (contract invariant, design §4.1).
 */
export function isInsideRoot(candidate: string, root: string): boolean {
  const absRoot = resolvePath(root);
  const abs = resolvePath(absRoot, candidate);
  return abs === absRoot || abs.startsWith(absRoot + sep);
}

/** Atomic JSON write (tmp + rename) so a concurrent reader never sees a partial file. */
async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
  await rename(tmp, path);
}

export function mountBorrowRoutes(
  app: Hono,
  options: BorrowRoutesOptions,
): BorrowRoutesContext {
  const borrows = new Map<string, BorrowLink>();
  // Borrows that arrived while the host was at its concurrency cap. FIFO —
  // promoted oldest-first when an active borrow ends.
  const queue: QueuedBorrow[] = [];
  const ttlMs = options.borrowTtlMs ?? DEFAULT_BORROW_TTL_MS;
  const pruneInterval = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;

  /** Count borrows currently occupying a concurrency slot for this host. */
  function activeCount(): number {
    let n = 0;
    for (const link of borrows.values()) {
      if (link.state === "running") n++;
    }
    return n;
  }

  /**
   * Stage the brief and spawn B for an already-minted link. Shared by the
   * dispatch (immediate) and the return (promotion) paths. On failure the link
   * is marked `failed` so the slot frees up and the host isn't stuck waiting.
   */
  async function startBorrow(link: BorrowLink, brief: BorrowDispatchPayload): Promise<boolean> {
    try {
      const briefDir = join(link.borrow_dir, ".pneuma");
      await mkdir(briefDir, { recursive: true });
      await atomicWriteJson(join(briefDir, "borrow-brief.json"), brief);
    } catch (err) {
      link.state = "failed";
      console.error(`[borrow-routes] failed to write borrow-brief.json for ${link.borrow_id}: ${err}`);
      return false;
    }
    try {
      await options.launchBorrow({
        mode: link.mode,
        ...(link.project_root !== undefined ? { project: link.project_root } : {}),
        sessionId: link.borrow_id,
        background: true,
      });
    } catch (err) {
      link.state = "failed";
      console.error(`[borrow-routes] launchBorrow failed for ${link.borrow_id}: ${err}`);
      return false;
    }
    return true;
  }

  /**
   * A slot just freed up (a borrow ended). Promote the next queued borrow, if
   * any, until either the queue is empty or the cap is reached again. Promotion
   * stages the brief + spawns B; a promotion that fails to spawn is skipped so
   * one bad borrow doesn't wedge the queue.
   */
  async function promoteQueued(): Promise<void> {
    while (queue.length > 0 && activeCount() < MAX_CONCURRENT_BORROWS_PER_SESSION) {
      const next = queue.shift()!;
      borrows.set(next.link.borrow_id, next.link);
      const ok = await startBorrow(next.link, next.brief);
      if (!ok) {
        // startBorrow already flipped the link to `failed`; loop continues to
        // try the next queued borrow.
        continue;
      }
    }
  }

  function hostSessionId(): string {
    return typeof options.hostSessionId === "function"
      ? options.hostSessionId()
      : options.hostSessionId;
  }

  const pruneTimer = setInterval(() => {
    for (const link of borrows.values()) {
      if (link.state === "running" && Date.now() - link.dispatched_at > ttlMs) {
        link.state = "timed_out";
      }
    }
  }, pruneInterval);
  if (typeof pruneTimer.unref === "function") pruneTimer.unref();

  // POST /api/borrows/dispatch ──────────────────────────────────────────
  app.post("/api/borrows/dispatch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const mode = typeof body.mode === "string" ? body.mode.trim() : "";
    const brief = typeof body.brief === "string" ? body.brief.trim() : "";

    if (!mode) return c.json({ error: "mode is required" }, 400);
    if (!brief) return c.json({ error: "brief is required" }, 400);
    if (!options.validateMode(mode)) {
      return c.json({ error: `unknown mode: ${mode}` }, 400);
    }

    // Resolve placement before minting so a quick session lands in temp.
    const hostId = hostSessionId();
    const resolved = await options.resolveHost(hostId).catch(() => null);
    const projectRoot = resolved?.projectRoot;

    const inputs = Array.isArray(body.inputs)
      ? (body.inputs as unknown[]).filter((v): v is string => typeof v === "string")
      : undefined;
    const scope = normalizeBorrowScope(
      typeof body.scope === "string" ? (body.scope as BorrowDispatchPayload["scope"]) : undefined,
    );
    // `in_place_targets` is meaningful only when scope is in-place (contract
    // invariant); drop it otherwise so a stray value can't widen B's write
    // surface.
    const inPlaceTargets =
      scope === "in-place" && Array.isArray(body.in_place_targets)
        ? (body.in_place_targets as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined;

    // Traversal guard (design §4.1): for a project borrow, every host path the
    // brief names — read inputs and writable in-place targets — must resolve
    // inside the project root. Quick sessions have no project root to anchor
    // to; their paths point into B's temp reach and aren't guarded here.
    if (projectRoot) {
      const offending = [...(inputs ?? []), ...(inPlaceTargets ?? [])].find(
        (p) => !isInsideRoot(p, projectRoot),
      );
      if (offending) {
        return c.json({ error: `path escapes project root: ${offending}` }, 400);
      }
    }

    // Mint the borrow_id — also B's session id.
    const borrowId = randomUUID();
    const borrowDir = resolveBorrowDir(borrowId, projectRoot);

    // Assemble the on-disk brief: the dispatch payload + server-filled
    // return_via so B's `borrow-return` CLI can reach A's own server.
    const briefPayload: BorrowDispatchPayload = {
      mode,
      brief,
      scope,
      ...(inputs !== undefined ? { inputs } : {}),
      ...(typeof body.expects === "string" ? { expects: body.expects } : {}),
      ...(inPlaceTargets !== undefined ? { in_place_targets: inPlaceTargets } : {}),
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
      ...(typeof body.language === "string" ? { language: body.language } : {}),
      return_via: {
        borrow_id: borrowId,
        host_server_url:
          typeof options.hostServerUrl === "function"
            ? options.hostServerUrl()
            : options.hostServerUrl,
      },
    };

    const link: BorrowLink = {
      borrow_id: borrowId,
      host_session_id: hostId,
      borrow_session_id: borrowId,
      mode,
      ...(projectRoot !== undefined ? { project_root: projectRoot } : {}),
      borrow_dir: borrowDir,
      state: "running",
      dispatched_at: Date.now(),
    };

    // Concurrency cap (OQ-5): one active borrow per host. Extras QUEUE — they
    // are not rejected. A queued borrow holds no `BorrowLink` yet (the contract
    // state space has no `queued`); it materializes on promotion.
    if (activeCount() >= MAX_CONCURRENT_BORROWS_PER_SESSION) {
      queue.push({ link, brief: briefPayload });
      return c.json({ borrow_id: borrowId, state: "queued" });
    }

    // Start now. Register the link first so `activeCount()` reflects it.
    borrows.set(borrowId, link);
    const ok = await startBorrow(link, briefPayload);
    if (!ok) {
      return c.json({ error: "failed to start borrow" }, 500);
    }

    return c.json({ borrow_id: borrowId, state: link.state });
  });

  // POST /api/borrows/return ─────────────────────────────────────────────
  // B's `borrow-return` CLI calls this on A's server (resolved from the
  // brief's `return_via.host_server_url`). The server reads + validates B's
  // on-disk result, marks the link terminal, frees the cap slot (promoting any
  // queued borrow), and enqueues the `<pneuma:borrow-returned>` poke onto A's
  // flush-on-idle queue.
  app.post("/api/borrows/return", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const borrowId = typeof body.borrow_id === "string" ? body.borrow_id : "";
    if (!borrowId) return c.json({ error: "borrow_id is required" }, 400);

    const link = borrows.get(borrowId);
    if (!link) return c.json({ error: "borrow not found" }, 404);

    // Idempotent: a duplicate return (network retry) on an already-terminal
    // link is a no-op success — the host was already poked.
    if (isTerminal(link.state)) {
      return c.json({ borrow_id: borrowId, state: link.state, already: true });
    }

    // Read + validate B's result off disk. B is the sole writer of this file.
    const resultPath = join(link.borrow_dir, "borrow-result.json");
    let resultStatus: BorrowState = "completed";
    try {
      const raw = await readFile(resultPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!isBorrowResult(parsed)) {
        // A return with no usable result on disk is a failed borrow — surface
        // it as such, but still poke A so it isn't left waiting forever.
        link.state = "failed";
      } else {
        // Mirror B's self-reported artifact status onto the link's terminal
        // state. `partial` is a success outcome for the link (B produced
        // something); only `failed` flips to failed.
        link.state = parsed.status === "failed" ? "failed" : "completed";
        resultStatus = link.state;
      }
    } catch (err) {
      console.warn(`[borrow-routes] no readable result for ${borrowId}: ${err}`);
      link.state = "failed";
    }

    // Poke A at a turn boundary with a pointer to the result. The tag carries
    // the result path so A reads the artifact + change_notes itself.
    const tag =
      `<pneuma:borrow-returned borrow_id="${escapeXmlAttr(borrowId)}" ` +
      `mode="${escapeXmlAttr(link.mode)}" ` +
      `status="${escapeXmlAttr(link.state)}" ` +
      `result_path="${escapeXmlAttr(resultPath)}" />`;
    try {
      options.wsBridge.enqueueSystemSignal(link.host_session_id, tag);
    } catch (err) {
      console.warn(`[borrow-routes] failed to enqueue return signal for ${borrowId}: ${err}`);
    }

    // Optional status-chip broadcast — best-effort, never fatal.
    try {
      options.wsBridge.broadcastToSession(link.host_session_id, {
        type: "borrow_returned",
        borrow_id: borrowId,
        state: link.state,
      });
    } catch {
      // Broadcast failures don't affect the return flow.
    }

    // A slot freed — promote the next queued borrow, if any.
    await promoteQueued();

    return c.json({ borrow_id: borrowId, state: resultStatus });
  });

  return {
    borrows,
    queueDepth: () => queue.length,
    stop: () => clearInterval(pruneTimer),
  };
}

/**
 * Escape a string for inclusion as an XML attribute value — the
 * `<pneuma:borrow-returned>` tag's attrs (mode, paths) may contain quotes / `&`
 * which would otherwise break parsing on the agent side. Same rule the handoff
 * cancel-tag dispatch uses.
 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
