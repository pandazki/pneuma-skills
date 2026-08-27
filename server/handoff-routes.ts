/**
 * Handoff routes — implements the v2 tool-call handoff protocol.
 *
 *   POST /api/handoffs/emit           — agent CLI submits a structured payload
 *   POST /api/handoffs/:id/confirm    — user clicked Confirm on the HandoffCard
 *   POST /api/handoffs/:id/cancel     — user clicked Cancel on the HandoffCard
 *
 * State is held in an in-memory `Map<handoff_id, HandoffProposal>` per server
 * instance. Pending proposals expire after 30 minutes via a janitor timer.
 *
 * The endpoints are mounted on BOTH the launcher and the per-session servers
 * so the source agent's `pneuma handoff` invocation reaches the same server
 * that's driving its session — that's how the WS broadcast lands in the
 * source's browser.
 *
 * See `docs/archive/proposals/2026-04-28-handoff-tool-call.md` for the full design.
 */

import type { Hono } from "hono";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Single handoff proposal — what the agent submitted, plus its lifecycle state. */
export interface HandoffProposal {
  handoff_id: string;
  source_session_id: string;
  source_mode?: string;
  source_display_name?: string;
  target_mode: string;
  target_session?: string;
  intent: string;
  summary?: string;
  suggested_files?: string[];
  key_decisions?: string[];
  open_questions?: string[];
  /**
   * Where the target session will be minted, resolved from the source
   * session. Absent means the source was not recognised, and confirm refuses.
   */
  location?: HandoffSourceLocation;
  proposed_at: number;
  state: "pending" | "confirmed" | "cancelled" | "timed_out";
}

/**
 * Where a handoff's target session gets minted, which follows from what the
 * source session is.
 *
 * A project source mints a sibling under `<projectRoot>/.pneuma/sessions/`. A
 * quick source hands the workspace to a new quick session instead — no project
 * is created, nothing is migrated, and the two sessions are related by nothing
 * but a `sourceSessionId` mark in the new `session.json`. Two sessions that
 * need to share preferences, files and a panel are what a project is for; a
 * handoff out of a quick session is just a launch with a brief.
 */
export type HandoffSourceLocation =
  | { kind: "project"; projectRoot: string; mode?: string; displayName?: string }
  | {
      kind: "quick";
      workspace: string;
      /** The source's backend, which the target inherits — it is workspace-locked. */
      backendType?: string;
      mode?: string;
      displayName?: string;
    };

/**
 * Minimal surface the routes need from the WS bridge — typed loosely so the
 * tests can pass an in-memory mock.
 */
export interface HandoffWsBridgeLike {
  // Method syntax (not arrow properties) so parameter bivariance lets the concrete
  // WsBridge — whose methods take the narrower BrowserIncomingMessage — satisfy this
  // loose surface, while tests can still pass a structural in-memory mock.
  broadcastToSession(sessionId: string, msg: { type: string } & Record<string, unknown>): void;
  sendUserMessage(sessionId: string, content: string): void;
}

export interface HandoffRoutesOptions {
  /** Bridge for chat-tag dispatch + browser broadcast. */
  wsBridge: HandoffWsBridgeLike;
  /**
   * Best-effort kill of a session's backend. The new protocol still terminates
   * the source on confirm so the user isn't billed for a session they left.
   */
  killSession?: (sessionId: string) => Promise<void>;
  /**
   * Spawn the target session and return the URL the browser should open.
   * Mirrors the v1 contract — wired by the server to `launchPneumaChild`.
   */
  launchSession?: (params: {
    mode: string;
    /** Agent workspace. For a project target this is the project root. */
    workspace: string;
    /** Set only for a project target; a quick target has no project. */
    project?: string;
    /** Set only for a project target, whose id names its directory. */
    sessionId?: string;
    /** Inherited from the source for a quick target; backends are locked per workspace. */
    backendType?: string;
  }) => Promise<string>;
  /**
   * Resolve project root + source session metadata for a given source session
   * id, so the `inbound-handoff.json` file written before target spawn can
   * carry the source's identity (the target's env-tag dispatch reads it).
   *
   * Returning `null` means the source isn't recognised — the route falls
   * back to the data the agent submitted (which doesn't include project
   * root, so confirm can't proceed without this lookup).
   */
  resolveSource?: (sourceSessionId: string) => Promise<HandoffSourceLocation | null>;

  /** Override for tests so the timer doesn't keep the test process alive. */
  pruneIntervalMs?: number;
  /** Override for tests so we can fast-forward the expiry deadline. */
  pendingTtlMs?: number;
}

export interface HandoffRoutesContext {
  /** The proposal map — exposed so tests + cross-route lookups can inspect. */
  proposals: Map<string, HandoffProposal>;
  /** Stop the prune timer (test cleanup). */
  stop: () => void;
}

const DEFAULT_PRUNE_INTERVAL_MS = 60_000; // 1 min
const DEFAULT_PENDING_TTL_MS = 30 * 60_000; // 30 min

/**
 * Pure helper exported for tests — given a proposal map, mark anything that's
 * been pending past the TTL as `timed_out` and return the ids that flipped.
 */
export function pruneExpiredProposals(
  proposals: Map<string, HandoffProposal>,
  now: number,
  ttlMs: number,
): string[] {
  const flipped: string[] = [];
  for (const [id, proposal] of proposals.entries()) {
    if (proposal.state !== "pending") continue;
    if (now - proposal.proposed_at > ttlMs) {
      proposal.state = "timed_out";
      flipped.push(id);
    }
  }
  return flipped;
}

/**
 * Escape a string for inclusion as an XML attribute value. Handoff cancel
 * reasons may contain quotes or `&` — without escaping the synthetic tag
 * dispatched to the source agent could break parsing.
 */
export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function mountHandoffRoutes(
  app: Hono,
  options: HandoffRoutesOptions,
): HandoffRoutesContext {
  const proposals = new Map<string, HandoffProposal>();
  const ttlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  const pruneInterval = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;

  const pruneTimer = setInterval(() => {
    pruneExpiredProposals(proposals, Date.now(), ttlMs);
  }, pruneInterval);
  // Don't keep the process alive on this timer.
  if (typeof pruneTimer.unref === "function") pruneTimer.unref();

  // POST /api/handoffs/emit ─────────────────────────────────────────────
  app.post("/api/handoffs/emit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const sourceSessionId = typeof body.source_session_id === "string" ? body.source_session_id : "";
    const targetMode = typeof body.target_mode === "string" ? body.target_mode : "";
    const intent = typeof body.intent === "string" ? body.intent : "";

    if (!sourceSessionId) {
      return c.json({ error: "source_session_id missing" }, 400);
    }
    if (!targetMode) {
      return c.json({ error: "target_mode is required" }, 400);
    }
    if (!intent) {
      return c.json({ error: "intent is required" }, 400);
    }

    const targetSession = typeof body.target_session === "string" ? body.target_session : undefined;
    const summary = typeof body.summary === "string" ? body.summary : undefined;
    const suggestedFiles = Array.isArray(body.suggested_files)
      ? (body.suggested_files as unknown[]).filter((v): v is string => typeof v === "string")
      : undefined;
    const keyDecisions = Array.isArray(body.key_decisions)
      ? (body.key_decisions as unknown[]).filter((v): v is string => typeof v === "string")
      : undefined;
    const openQuestions = Array.isArray(body.open_questions)
      ? (body.open_questions as unknown[]).filter((v): v is string => typeof v === "string")
      : undefined;

    // Single-flight per source — supersede any prior pending proposal from the
    // same source session. The user reasonably revises their intent; the new
    // emission silently replaces the old one (no chat tag, no UI churn).
    for (const [oldId, oldProposal] of proposals.entries()) {
      if (
        oldProposal.state === "pending" &&
        oldProposal.source_session_id === sourceSessionId
      ) {
        oldProposal.state = "cancelled";
        // Tell any browsers viewing the old proposal to clear it.
        try {
          options.wsBridge.broadcastToSession(sourceSessionId, {
            type: "handoff_cancelled",
            handoff_id: oldId,
            reason: "superseded",
          });
        } catch {
          // Broadcast failures aren't fatal for proposal flow.
        }
      }
    }

    // Resolve the source up front — the proposal carries the location so
    // confirm doesn't have to look it up again, and the inbound-handoff.json
    // can include source identity attributes for the target's env-tag dispatch.
    let location: HandoffSourceLocation | undefined;
    if (options.resolveSource) {
      try {
        location = (await options.resolveSource(sourceSessionId)) ?? undefined;
      } catch (err) {
        console.warn(`[handoff-routes] resolveSource failed for ${sourceSessionId}: ${err}`);
      }
    }
    const sourceMode = location?.mode;
    const sourceDisplayName = location?.displayName;

    const handoffId = randomUUID();
    const proposal: HandoffProposal = {
      handoff_id: handoffId,
      source_session_id: sourceSessionId,
      source_mode: sourceMode,
      source_display_name: sourceDisplayName,
      target_mode: targetMode,
      ...(targetSession !== undefined ? { target_session: targetSession } : {}),
      intent,
      ...(summary !== undefined ? { summary } : {}),
      ...(suggestedFiles !== undefined ? { suggested_files: suggestedFiles } : {}),
      ...(keyDecisions !== undefined ? { key_decisions: keyDecisions } : {}),
      ...(openQuestions !== undefined ? { open_questions: openQuestions } : {}),
      ...(location !== undefined ? { location } : {}),
      proposed_at: Date.now(),
      state: "pending",
    };
    proposals.set(handoffId, proposal);

    // Broadcast the proposal — the source session's HandoffCard subscribes
    // to this event. The payload mirrors what the agent submitted plus the
    // server-assigned id; the browser doesn't need to know about source/
    // project plumbing.
    try {
      options.wsBridge.broadcastToSession(sourceSessionId, {
        type: "handoff_proposed",
        handoff_id: handoffId,
        payload: {
          source_session_id: sourceSessionId,
          source_mode: sourceMode,
          source_display_name: sourceDisplayName,
          target_mode: targetMode,
          target_session: targetSession,
          intent,
          summary,
          suggested_files: suggestedFiles,
          key_decisions: keyDecisions,
          open_questions: openQuestions,
          // The one piece of plumbing the card does need: what confirming
          // will do to this workspace. A project source gains a sibling
          // session; a quick source hands its workspace over, and the card
          // has to say so before the user presses the button.
          source_kind: location?.kind,
        },
        proposed_at: proposal.proposed_at,
      });
    } catch (err) {
      console.warn(`[handoff-routes] broadcast failed for ${handoffId}: ${err}`);
    }

    return c.json({ handoff_id: handoffId, status: "proposed" });
  });

  // POST /api/handoffs/:id/confirm ──────────────────────────────────────
  app.post("/api/handoffs/:id/confirm", async (c) => {
    const id = c.req.param("id");
    const proposal = proposals.get(id);
    if (!proposal) return c.json({ error: "handoff not found" }, 404);
    if (proposal.state !== "pending") {
      return c.json({ error: `handoff already ${proposal.state}` }, 409);
    }
    if (!options.launchSession) {
      return c.json({ error: "launch not configured" }, 500);
    }

    // Atomic state swap — flip to confirmed up front so a duplicate confirm
    // (double-click, network retry) hits the 409 above. We only reach this
    // point once per id.
    proposal.state = "confirmed";

    const location = proposal.location;
    if (!location) {
      proposal.state = "pending"; // Allow another confirm attempt.
      return c.json({ error: "the source session could not be resolved" }, 500);
    }

    // Resolve target session id. `auto` and undefined mean "fresh UUID".
    //
    // Only a project target has one to resolve: its id names the directory it
    // will live in, so it has to be decided here, before anything is written.
    // A quick target's id is minted by the session itself at boot, the way
    // every quick session's always has been, so there is nothing to name and
    // `target_session` has no siblings to point at.
    const targetSessionId =
      location.kind === "project"
        ? proposal.target_session && proposal.target_session !== "auto"
          ? proposal.target_session
          : randomUUID()
        : undefined;

    // Write inbound-handoff.json BEFORE spawn, so the target's skill installer
    // has the file in place when the project-level instructions file
    // (CLAUDE.md / AGENTS.md, depending on backend) is generated. Atomic via
    // .tmp + rename so a concurrent reader never sees a half-written payload.
    //
    // Path: `<targetSessionDir>/.pneuma/inbound-handoff.json`, where
    // `targetSessionDir` is the agent's working directory — the same rule
    // `readInboundHandoff` and `handoff-from-external` both follow. Project
    // sessions store their flat state in `<projectRoot>/.pneuma/sessions/<id>/`
    // and the payload lands one nesting deeper inside it; a quick session's
    // working directory is the workspace itself, so the payload lands in the
    // workspace's own `.pneuma/`. Getting this wrong is invisible — the target
    // boots and sees no handoff at all, which is the shape of the pre-3.10.9
    // double-nesting bug.
    const targetSessionDir =
      location.kind === "project"
        ? join(location.projectRoot, ".pneuma", "sessions", targetSessionId!)
        : location.workspace;
    const targetPneumaDir = join(targetSessionDir, ".pneuma");
    try {
      await mkdir(targetPneumaDir, { recursive: true });
      const inboundFile = join(targetPneumaDir, "inbound-handoff.json");
      const inboundTmp = `${inboundFile}.tmp`;
      const inboundPayload = {
        handoff_id: proposal.handoff_id,
        source_session_id: proposal.source_session_id,
        source_mode: proposal.source_mode,
        source_display_name: proposal.source_display_name,
        target_mode: proposal.target_mode,
        target_session: targetSessionId,
        intent: proposal.intent,
        summary: proposal.summary,
        suggested_files: proposal.suggested_files,
        key_decisions: proposal.key_decisions,
        open_questions: proposal.open_questions,
        proposed_at: proposal.proposed_at,
      };
      await writeFile(inboundTmp, JSON.stringify(inboundPayload, null, 2), "utf-8");
      await rename(inboundTmp, inboundFile);
    } catch (err) {
      proposal.state = "pending";
      console.error(`[handoff-routes] failed to write inbound-handoff.json: ${err}`);
      return c.json({ error: "failed to write inbound-handoff payload" }, 500);
    }

    // Best-effort kill of the source backend. The user already chose to
    // leave; failures here aren't worth aborting the launch over.
    if (options.killSession) {
      try {
        await options.killSession(proposal.source_session_id);
      } catch (err) {
        console.warn(`[handoff-routes] kill source failed: ${err}`);
      }
    }

    // Append `switched_out` to source history.json (best-effort; matches v1).
    //
    // Project sources only. A quick source's history lives in the workspace's
    // single `.pneuma/`, which the target session is about to take over — the
    // event would be written into a file that is replaced moments later, and
    // the two sessions are deliberately unrelated anyway.
    if (location.kind === "project") {
      try {
        const sourceHistoryPath = join(
          location.projectRoot,
          ".pneuma",
          "sessions",
          proposal.source_session_id,
          "history.json",
        );
        if (existsSync(sourceHistoryPath)) {
          const raw = await readFile(sourceHistoryPath, "utf-8");
          const arr = JSON.parse(raw) as unknown[];
          if (Array.isArray(arr)) {
            arr.push({
              type: "session_event",
              subtype: "switched_out",
              handoff_id: id,
              ts: Date.now(),
            });
            await writeFile(sourceHistoryPath, JSON.stringify(arr, null, 2), "utf-8");
          }
        }
      } catch (err) {
        console.warn(`[handoff-routes] write switched_out failed: ${err}`);
      }
    }

    let launchUrl: string;
    try {
      launchUrl = await options.launchSession({
        mode: proposal.target_mode,
        // A project target is launched into its project; a quick target is a
        // plain workspace launch, with the source's backend carried over
        // because a workspace's backend is fixed once chosen.
        ...(location.kind === "project"
          ? { workspace: location.projectRoot, project: location.projectRoot, sessionId: targetSessionId }
          : {
              workspace: location.workspace,
              ...(location.backendType ? { backendType: location.backendType } : {}),
            }),
      });
    } catch (err) {
      // The target failed to spawn — leave the proposal as `confirmed` (it
      // was confirmed) but surface the failure to the UI. Don't roll back to
      // `pending` because the inbound-handoff.json + history events are
      // already written and a retry would create a double-spawn risk.
      console.error(`[handoff-routes] launch target failed: ${err}`);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }

    return c.json({
      confirmed: true,
      launchUrl,
      // Absent for a quick target, whose id the session mints for itself at
      // boot; the browser navigates by `launchUrl`, which carries the real one.
      target_session_id: targetSessionId,
      handoff_id: id,
    });
  });

  // POST /api/handoffs/:id/cancel ────────────────────────────────────────
  app.post("/api/handoffs/:id/cancel", async (c) => {
    const id = c.req.param("id");
    const proposal = proposals.get(id);
    if (!proposal) return c.json({ error: "handoff not found" }, 404);
    if (proposal.state !== "pending") {
      return c.json({ error: `handoff already ${proposal.state}` }, 409);
    }

    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    proposal.state = "cancelled";

    // Tell the source agent the user reconsidered. The skill teaches it to
    // continue the conversation without being defensive.
    const tag = reason
      ? `<pneuma:handoff-cancelled reason="${escapeXmlAttr(reason)}" />`
      : `<pneuma:handoff-cancelled />`;
    try {
      options.wsBridge.sendUserMessage(proposal.source_session_id, tag);
    } catch (err) {
      console.warn(`[handoff-routes] failed to dispatch cancel tag: ${err}`);
    }

    // Broadcast cancellation so any other browser tabs viewing the same
    // proposal clear their HandoffCard. The originating tab will already
    // have cleared on its own POST response, but a multi-tab user wants
    // both views to stay in sync.
    try {
      options.wsBridge.broadcastToSession(proposal.source_session_id, {
        type: "handoff_cancelled",
        handoff_id: id,
        reason: reason || undefined,
      });
    } catch (err) {
      console.warn(`[handoff-routes] failed to broadcast cancel: ${err}`);
    }

    return c.json({ cancelled: true });
  });

  return {
    proposals,
    stop: () => clearInterval(pruneTimer),
  };
}
