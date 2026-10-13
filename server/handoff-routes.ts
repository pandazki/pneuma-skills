/**
 * Handoff routes — implements the v2 tool-call handoff protocol.
 *
 *   POST /api/handoffs/request        — user captures settings before the agent prepares a brief
 *   POST /api/handoffs/emit           — agent CLI submits a structured payload
 *   POST /api/handoffs/:id/confirm    — user clicked Confirm on the HandoffCard
 *   POST /api/handoffs/:id/cancel     — user clicked Cancel on the HandoffCard
 *
 * State is held in an in-memory `Map<handoff_id, HandoffProposal>` per server
 * instance. Preparing and pending proposals expire after 30 minutes.
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
import type { AgentBackendType } from "../core/types/agent-backend.js";
import type { HandoffProposalPayload, HandoffRequestInput } from "../core/types/handoff.js";

/** User settings and agent brief share one proposal and one lifecycle. */
export interface HandoffProposal extends Omit<HandoffProposalPayload, "source_kind"> {
  handoff_id: string;
  /** Present only for a UI-owned request; equals handoff_id for correlation. */
  request_id?: string;
  source_session_id: string;
  /**
   * Where the target session will be minted, resolved from the source
   * session. Absent means the source was not recognised, and confirm refuses.
   */
  location?: HandoffSourceLocation;
  proposed_at: number;
  state: "preparing" | "pending" | "confirmed" | "cancelled" | "timed_out";
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
  /** Registry-owned validation; route code has no backend name list. */
  isBackendRegistered: (backendType: string) => backendType is AgentBackendType;
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
    /** Captured user choice for a new project target, or inherited quick workspace lock. */
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
 * been preparing or pending past the TTL as `timed_out` and return the ids that flipped.
 */
export function pruneExpiredProposals(
  proposals: Map<string, HandoffProposal>,
  now: number,
  ttlMs: number,
): string[] {
  const flipped: string[] = [];
  for (const [id, proposal] of proposals.entries()) {
    if (proposal.state !== "preparing" && proposal.state !== "pending") continue;
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

  const broadcastCancelled = (proposal: HandoffProposal, reason: string): void => {
    try {
      options.wsBridge.broadcastToSession(proposal.source_session_id, {
        type: "handoff_cancelled",
        handoff_id: proposal.handoff_id,
        reason,
      });
    } catch (err) {
      console.warn(`[handoff-routes] failed to broadcast cancellation: ${err}`);
    }
  };
  const pruneExpired = (): void => {
    for (const id of pruneExpiredProposals(proposals, Date.now(), ttlMs)) {
      broadcastCancelled(proposals.get(id)!, "timed_out");
    }
  };
  const activeRequest = (sourceSessionId: string): HandoffProposal | undefined =>
    [...proposals.values()].find((proposal) =>
      proposal.request_id !== undefined &&
      proposal.source_session_id === sourceSessionId &&
      (proposal.state === "preparing" || proposal.state === "pending"),
    );
  const supersedeActive = (sourceSessionId: string): void => {
    for (const proposal of proposals.values()) {
      if (proposal.source_session_id === sourceSessionId &&
          (proposal.state === "preparing" || proposal.state === "pending")) {
        proposal.state = "cancelled";
        broadcastCancelled(proposal, "superseded");
      }
    }
  };
  const broadcastProposal = (proposal: HandoffProposal): void => {
    const payload: HandoffProposalPayload = {
      source_session_id: proposal.source_session_id,
      source_mode: proposal.source_mode,
      source_display_name: proposal.source_display_name,
      target_mode: proposal.target_mode,
      target_session: proposal.target_session,
      target_backend: proposal.target_backend,
      intent: proposal.intent,
      summary: proposal.summary,
      suggested_files: proposal.suggested_files,
      key_decisions: proposal.key_decisions,
      open_questions: proposal.open_questions,
      source_kind: proposal.location?.kind,
    };
    try {
      options.wsBridge.broadcastToSession(proposal.source_session_id, {
        type: "handoff_proposed",
        handoff_id: proposal.handoff_id,
        payload,
        proposed_at: proposal.proposed_at,
      });
    } catch (err) {
      console.warn(`[handoff-routes] broadcast failed for ${proposal.handoff_id}: ${err}`);
    }
  };
  const missingRequestIdError = (proposal: HandoffProposal): string =>
    `request_id is required for the active handoff request; include request_id="${proposal.request_id}" from the request-handoff message`;

  const pruneTimer = setInterval(pruneExpired, pruneInterval);
  // Don't keep the process alive on this timer.
  if (typeof pruneTimer.unref === "function") pruneTimer.unref();

  // POST /api/handoffs/request ──────────────────────────────────────────
  app.post("/api/handoffs/request", async (c) => {
    pruneExpired();
    const raw: unknown = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return c.json({ error: "handoff request must be a JSON object" }, 400);
    }
    const body = raw as Record<string, unknown>;
    for (const field of ["source_session_id", "target_mode", "intent"] as const) {
      if (typeof body[field] !== "string" || !body[field].trim()) {
        return c.json({ error: `${field} is required and must be a non-empty string` }, 400);
      }
    }
    if (typeof body.target_backend !== "string" || !options.isBackendRegistered(body.target_backend)) {
      return c.json({ error: "target_backend must name a registered backend" }, 400);
    }
    if (body.target_session !== undefined && body.target_session !== "auto") {
      return c.json({ error: "a handoff request creates a new target session; target_session must be auto or omitted" }, 400);
    }
    const request: HandoffRequestInput = {
      source_session_id: body.source_session_id as string,
      target_mode: body.target_mode as string,
      intent: body.intent as string,
      target_backend: body.target_backend,
    };
    let location: HandoffSourceLocation | null | undefined;
    try {
      location = await options.resolveSource?.(request.source_session_id);
    } catch (err) {
      console.warn(`[handoff-routes] resolveSource failed for ${request.source_session_id}: ${err}`);
      return c.json({ error: "the source session could not be resolved" }, 500);
    }
    if (location?.kind !== "project") {
      return c.json({ error: "a handoff request requires a known project source session" }, 400);
    }

    // Commit settings only after validation. No await may separate superseding
    // the previous request, storing this one, and dispatching its correlation id.
    pruneExpired();
    supersedeActive(request.source_session_id);
    const requestId = randomUUID();
    const proposal: HandoffProposal = {
      ...request,
      handoff_id: requestId,
      request_id: requestId,
      source_mode: location.mode,
      source_display_name: location.displayName,
      target_session: "auto",
      location,
      proposed_at: Date.now(),
      state: "preparing",
    };
    proposals.set(requestId, proposal);
    const tag = `<pneuma:request-handoff request_id="${requestId}" target="${escapeXmlAttr(request.target_mode)}" target_session="auto" intent="${escapeXmlAttr(request.intent)}" />`;
    try {
      // The bridge records/broadcasts the user message. It does not acknowledge
      // agent delivery, so this response only reports the stored request state.
      options.wsBridge.sendUserMessage(request.source_session_id, tag);
    } catch (err) {
      // Retain the id so a late response cannot turn into a legacy proposal.
      proposal.state = "cancelled";
      broadcastCancelled(proposal, "dispatch_failed");
      console.error(`[handoff-routes] request dispatch failed for ${requestId}: ${err}`);
      return c.json({ error: "failed to dispatch the handoff request", request_id: requestId }, 500);
    }
    return c.json({ request_id: requestId, status: "preparing" });
  });

  // POST /api/handoffs/emit ─────────────────────────────────────────────
  app.post("/api/handoffs/emit", async (c) => {
    pruneExpired();
    const raw: unknown = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return c.json({ error: "handoff payload must be a JSON object" }, 400);
    }
    const body = raw as Record<string, unknown>;
    const sourceSessionId = typeof body.source_session_id === "string" ? body.source_session_id : "";
    const targetMode = typeof body.target_mode === "string" ? body.target_mode : "";
    const intent = typeof body.intent === "string" ? body.intent : "";
    if (!sourceSessionId.trim()) return c.json({ error: "source_session_id missing" }, 400);
    if (!targetMode.trim()) return c.json({ error: "target_mode is required" }, 400);
    if (!intent.trim()) return c.json({ error: "intent is required" }, 400);
    if (body.request_id !== undefined &&
        (typeof body.request_id !== "string" || !body.request_id.trim())) {
      return c.json({ error: "request_id must be a non-empty string when provided" }, 400);
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

    pruneExpired();
    if (typeof body.request_id === "string") {
      const proposal = proposals.get(body.request_id);
      if (!proposal || proposal.request_id !== body.request_id) {
        return c.json({ error: "request_id does not identify a handoff request; request a new handoff from the project UI" }, 400);
      }
      if (proposal.source_session_id !== sourceSessionId || proposal.target_mode !== targetMode) {
        return c.json({ error: "request_id must match the source session and target mode in the handoff request" }, 400);
      }
      if (body.target_session !== undefined && body.target_session !== "auto") {
        return c.json({ error: "the requested target_session is auto and cannot be changed by the agent" }, 400);
      }
      if (proposal.state !== "preparing") {
        return c.json({ error: `handoff request already ${proposal.state}` }, 409);
      }
      // The agent owns only the brief. Backend, target and original intent
      // stay exactly as recorded by the user, even if extra JSON fields differ.
      Object.assign(proposal, {
        summary,
        suggested_files: suggestedFiles,
        key_decisions: keyDecisions,
        open_questions: openQuestions,
        state: "pending",
      });
      broadcastProposal(proposal);
      return c.json({ handoff_id: proposal.handoff_id, status: "proposed" });
    }

    const preparing = activeRequest(sourceSessionId);
    if (preparing) return c.json({ error: missingRequestIdError(preparing) }, 400);

    // Uncorrelated agent proposals retain the legacy quick/existing-session
    // flow. Source lookup is asynchronous: recheck UI ownership after it, so a
    // delayed legacy emit cannot replace settings the user just selected.
    let location: HandoffSourceLocation | undefined;
    if (options.resolveSource) {
      try {
        location = (await options.resolveSource(sourceSessionId)) ?? undefined;
      } catch (err) {
        console.warn(`[handoff-routes] resolveSource failed for ${sourceSessionId}: ${err}`);
      }
    }
    pruneExpired();
    const newerRequest = activeRequest(sourceSessionId);
    if (newerRequest) return c.json({ error: missingRequestIdError(newerRequest) }, 400);
    supersedeActive(sourceSessionId);

    const handoffId = randomUUID();
    const proposal: HandoffProposal = {
      handoff_id: handoffId,
      source_session_id: sourceSessionId,
      source_mode: location?.mode,
      source_display_name: location?.displayName,
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
    broadcastProposal(proposal);
    return c.json({ handoff_id: handoffId, status: "proposed" });
  });

  // POST /api/handoffs/:id/confirm ──────────────────────────────────────
  app.post("/api/handoffs/:id/confirm", async (c) => {
    pruneExpired();
    const id = c.req.param("id");
    const proposal = proposals.get(id);
    if (!proposal) return c.json({ error: "handoff not found" }, 404);
    if (proposal.state !== "pending") {
      return c.json({ error: `handoff already ${proposal.state}` }, 409);
    }
    if (!options.launchSession) {
      return c.json({ error: "launch not configured" }, 500);
    }

    const location = proposal.location;
    if (!location) {
      return c.json({ error: "the source session could not be resolved" }, 500);
    }
    const targetBackend = proposal.request_id
      ? proposal.target_backend
      : location.kind === "quick" ? location.backendType : undefined;
    if ((proposal.request_id && !targetBackend) ||
        (targetBackend !== undefined && !options.isBackendRegistered(targetBackend))) {
      return c.json({ error: "the selected target backend is not registered; request a new handoff" }, 400);
    }

    // Claim confirmation after validation and before the first filesystem
    // await. Concurrent confirms/cancels cannot both perform launch effects.
    proposal.state = "confirmed";

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
      // A newer request may have arrived during the write. Do not revive an
      // old card alongside it when the failed write permits a retry.
      const superseded = [...proposals.values()].some((other) =>
        other !== proposal && other.source_session_id === proposal.source_session_id &&
        (other.state === "preparing" || other.state === "pending"),
      );
      proposal.state = superseded ? "cancelled" : "pending";
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
          ? {
              workspace: location.projectRoot,
              project: location.projectRoot,
              sessionId: targetSessionId,
              ...(targetBackend ? { backendType: targetBackend } : {}),
            }
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
    pruneExpired();
    const id = c.req.param("id");
    const proposal = proposals.get(id);
    if (!proposal) return c.json({ error: "handoff not found" }, 404);
    if (proposal.state !== "preparing" && proposal.state !== "pending") {
      return c.json({ error: `handoff already ${proposal.state}` }, 409);
    }

    const body = (await c.req.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    // Parsing a streamed body yields. Confirmation, supersession or expiry
    // may have claimed the proposal while this request was waiting.
    pruneExpired();
    if (proposal.state !== "preparing" && proposal.state !== "pending") {
      return c.json({ error: `handoff already ${proposal.state}` }, 409);
    }

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
