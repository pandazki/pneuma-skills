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
 * See `docs/design/2026-04-28-handoff-tool-call.md` for the full design.
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
  /** Project root inferred from the source session (best-effort). */
  project_root?: string;
  proposed_at: number;
  state: "pending" | "confirmed" | "cancelled" | "timed_out";
}

/**
 * Minimal surface the routes need from the WS bridge — typed loosely so the
 * tests can pass an in-memory mock.
 */
export interface HandoffWsBridgeLike {
  broadcastToSession: (sessionId: string, msg: { type: string } & Record<string, unknown>) => void;
  sendUserMessage: (sessionId: string, content: string) => void;
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
    project: string;
    sessionId?: string;
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
  resolveSource?: (sourceSessionId: string) => Promise<{
    projectRoot: string;
    mode?: string;
    displayName?: string;
  } | null>;

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

    // Resolve source metadata up front — the proposal carries project_root so
    // confirm doesn't have to look it up again, and the inbound-handoff.json
    // can include source identity attributes for the target's env-tag dispatch.
    let projectRoot: string | undefined;
    let sourceMode: string | undefined;
    let sourceDisplayName: string | undefined;
    if (options.resolveSource) {
      try {
        const resolved = await options.resolveSource(sourceSessionId);
        if (resolved) {
          projectRoot = resolved.projectRoot;
          sourceMode = resolved.mode;
          sourceDisplayName = resolved.displayName;
        }
      } catch (err) {
        console.warn(`[handoff-routes] resolveSource failed for ${sourceSessionId}: ${err}`);
      }
    }

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
      ...(projectRoot !== undefined ? { project_root: projectRoot } : {}),
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

    // Resolve target session id. `auto` and undefined mean "fresh UUID".
    const targetSessionId =
      proposal.target_session && proposal.target_session !== "auto"
        ? proposal.target_session
        : randomUUID();

    if (!proposal.project_root) {
      proposal.state = "pending"; // Allow another confirm attempt.
      return c.json({ error: "project root could not be resolved for source session" }, 500);
    }

    const projectRoot = proposal.project_root;

    // Write inbound-handoff.json BEFORE spawn, so the target's skill installer
    // has the file in place when CLAUDE.md is generated. Atomic via .tmp +
    // rename so a concurrent reader never sees a half-written payload.
    //
    // Path: `<targetSessionDir>/.pneuma/inbound-handoff.json`. Project sessions
    // store their flat state directly in `<projectRoot>/.pneuma/sessions/<id>/`,
    // so the inbound payload lands one nesting deeper at
    // `<projectRoot>/.pneuma/sessions/<id>/.pneuma/inbound-handoff.json`. The
    // skill installer reads from this same path; the target agent rms the file
    // after consuming.
    const targetSessionDir = join(projectRoot, ".pneuma", "sessions", targetSessionId);
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
    try {
      const sourceHistoryPath = join(
        projectRoot,
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

    let launchUrl: string;
    try {
      launchUrl = await options.launchSession({
        mode: proposal.target_mode,
        project: projectRoot,
        sessionId: targetSessionId,
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
