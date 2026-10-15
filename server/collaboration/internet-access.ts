import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  COLLABORATION_PUBLIC_IDLE_MS, parseCollaborationTunnelProvider,
  type CollaborationInternetAccessChange, type CollaborationInternetAccessState,
  type CollaborationTunnelProvider,
} from "../../core/types/collaboration-access.js";
import { collaborationStateDir } from "./local-state.js";
import type { startCollaborationHost } from "./host.js";
import { CollaborationTunnelStartupError, type CollaborationTunnelCleanup, type CollaborationTunnelHandle } from "./internet-tunnel.js";
export type { CollaborationTunnelHandle } from "./internet-tunnel.js";
export type CollaborationTunnelStarter = (options: {
  targetUrl: string; provider: CollaborationTunnelProvider; signal: AbortSignal; onExit(error: Error): void;
}) => Promise<CollaborationTunnelHandle>;
type Host = Awaited<ReturnType<typeof startCollaborationHost>>;

/** The detached authority process owns this lifetime, never the private browser. */
export function createInternetAccessController(options: {
  host: Pick<Host, "startPublicIngress" | "stopPublicIngress" | "setPublicOrigin" | "publicConnections"> & Partial<Pick<Host, "publicLeaseDeadline">>;
  startTunnel: CollaborationTunnelStarter;
  provider?: CollaborationTunnelProvider;
  onProviderChosen?(provider: CollaborationTunnelProvider): Promise<void>;
  now?: () => number;
  idleTimeoutMs?: number;
  pollMs?: number;
}) {
  const now = options.now ?? Date.now;
  const idleTimeoutMs = options.idleTimeoutMs ?? COLLABORATION_PUBLIC_IDLE_MS;
  let state: CollaborationInternetAccessState = {
    status: "off", provider: options.provider ?? { kind: "quick" }, publicOrigin: null,
    publicClients: 0, idleDeadline: null, idleTimeoutMs,
  };
  let tunnel: CollaborationTunnelCleanup | null = null;
  let startup: AbortController | null = null;
  let operation: Promise<void> = Promise.resolve();
  let generation = 0;
  let closed = false;
  let checking = false;
  let lastLeaseDeadline: number | null = null;
  let stopRequested = false;

  function snapshot(): CollaborationInternetAccessState { return structuredClone(state); }
  function enqueue(action: () => Promise<void>): Promise<void> {
    const next = operation.catch(() => {}).then(action); operation = next; return next;
  }
  async function release(final: "off" | "idleexpired" | "failed", error?: string): Promise<void> {
    state = { ...state, status: "stopping", publicOrigin: null, publicClients: 0, idleDeadline: null };
    // Disable admissions and grants before waiting for the provider child to terminate.
    const failures: string[] = [];
    try { await options.host.stopPublicIngress(); } catch (cause) { failures.push(String(cause)); }
    if (tunnel) {
      try { await tunnel.stop(); tunnel = null; } catch (cause) { failures.push(String(cause)); }
    }
    state = { ...state, status: failures.length ? "failed" : final,
      ...(failures.length || error ? { error: [...(error ? [error] : []), ...failures].join("; ") } : { error: undefined }) };
    if (failures.length) throw new Error(state.error);
  }
  function requestStop(final: "off" | "idleexpired" | "failed", error?: string): Promise<void> {
    generation++; stopRequested = true; startup?.abort();
    // Calling this immediately rejects any new public request even during startup.
    const ingressStop = options.host.stopPublicIngress().then(() => null, (cause: unknown) => cause);
    return enqueue(async () => {
      const ingressError = await ingressStop;
      await release(ingressError ? "failed" : final, ingressError ? String(ingressError) : error);
      if (ingressError) throw ingressError;
    });
  }
  function check(): boolean {
    if (checking) return !stopRequested && state.status === "active";
    if (stopRequested || closed || state.status !== "active" && state.status !== "starting") return false;
    if (state.status === "starting") return false;
    checking = true;
    try {
      const count = options.host.publicConnections(now());
      if (count > 0) { lastLeaseDeadline = options.host.publicLeaseDeadline?.() ?? now() + 60_000; state = { ...state, publicClients: count, idleDeadline: null }; }
      else {
        const deadline = state.publicClients > 0 ? Math.min(now(), lastLeaseDeadline ?? now()) + idleTimeoutMs : state.idleDeadline ?? now() + idleTimeoutMs;
        state = { ...state, publicClients: 0, idleDeadline: deadline };
        if (now() >= deadline) { void requestStop("idleexpired").catch(() => {}); return false; }
      }
      return true;
    } finally { checking = false; }
  }
  const timer = setInterval(check, options.pollMs ?? 1000);
  timer.unref();
  return {
    read(): CollaborationInternetAccessState { check(); return snapshot(); },
    check,
    async change(change: CollaborationInternetAccessChange): Promise<CollaborationInternetAccessState> {
      if (typeof change.enabled !== "boolean") throw new Error("Public access enabled must be a boolean.");
      if (!change.enabled) { await requestStop("off"); return snapshot(); }
      if (tunnel && state.status === "failed") throw new Error("Public provider cleanup is unconfirmed. Disable public access again before restarting it.");
      if (closed) throw new Error("Project authority is closing.");
      const provider = change.provider ? parseCollaborationTunnelProvider(change.provider) : state.provider;
      if (state.status === "active" || state.status === "starting") {
        if (JSON.stringify(provider) !== JSON.stringify(state.provider)) throw new Error("Disable public access before changing its provider.");
        await operation; return snapshot();
      }
      const attempt = ++generation;
      stopRequested = false;
      state = { ...state, provider, status: "starting", publicOrigin: null, publicClients: 0, idleDeadline: null, error: undefined };
      await enqueue(async () => {
        if (attempt !== generation || closed) return;
        // Another private Session may enqueue enable while shutdown is still
        // pending. Recheck ownership after that operation settles; a failed
        // release must never be replaced by another provider process.
        if (tunnel) {
          stopRequested = true;
          const error = "Public provider cleanup is unconfirmed. Disable public access again before restarting it.";
          state = { ...state, status: "failed", publicOrigin: null, publicClients: 0, idleDeadline: null, error };
          throw new Error(error);
        }
        state = { ...state, provider, status: "starting", publicOrigin: null, publicClients: 0, idleDeadline: null, error: undefined };
        startup = new AbortController();
        try {
          await options.onProviderChosen?.(provider);
          if (attempt !== generation || closed || startup.signal.aborted) return;
          const targetUrl = options.host.startPublicIngress({ beforeActivity: check, onConnectionsChanged: () => { check(); } });
          const handle = await options.startTunnel({ targetUrl, provider, signal: startup.signal,
            onExit(error) { if (attempt === generation && !stopRequested) void requestStop("failed", error.message).catch(() => {}); } });
          tunnel = handle;
          if (attempt !== generation || closed || startup.signal.aborted) { await release("off"); return; }
          options.host.setPublicOrigin(handle.origin);
          state = { ...state, status: "active", publicOrigin: handle.origin, idleDeadline: now() + idleTimeoutMs };
          check();
        } catch (error) {
          // Startup rejection is not proof of child termination. Retain this
          // ownership before release, so disable retries confirm the same child.
          if (error instanceof CollaborationTunnelStartupError) tunnel = error.cleanup;
          await release(attempt === generation && !closed ? "failed" : "off", attempt === generation ? String(error) : undefined);
          if (attempt === generation && !closed) throw error;
        } finally { startup = null; }
      });
      return snapshot();
    },
    async close(): Promise<void> {
      closed = true; clearInterval(timer); await requestStop("off");
    },
  };
}

export interface InternetAccessCredentials { projectId: string; memberToken: string; authorityOrigin?: string }
interface ControlRecord { projectId: string; origin: string; controlOrigin?: string; controlKey?: string }

async function control(projectRoot: string, credentials: InternetAccessCredentials, change?: CollaborationInternetAccessChange): Promise<CollaborationInternetAccessState | null> {
  let record: ControlRecord;
  try { record = JSON.parse(await readFile(join(collaborationStateDir(projectRoot), "service.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (record.projectId !== credentials.projectId || credentials.authorityOrigin && record.origin !== credentials.authorityOrigin) {
    if (!change) return null;
    throw new Error("Public access can only be managed by this Project's local LAN authority.");
  }
  if (!record.controlOrigin || !record.controlKey) throw new Error("Restart this Project's LAN authority to enable public access controls.");
  const origin = new URL(record.controlOrigin);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password)
    throw new Error("Invalid private collaboration control endpoint.");
  const response = await fetch(`${origin.origin}/internet-access`, {
    method: "POST", headers: { Authorization: `Bearer ${record.controlKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: credentials.projectId, memberToken: credentials.memberToken, ...(change ? { change } : {}) }),
    signal: AbortSignal.timeout(change?.enabled ? 60_000 : 15_000),
  });
  const result = await response.json() as CollaborationInternetAccessState & { error?: string };
  if (!response.ok && response.status === 403 && !change) return null;
  if (!response.ok) throw new Error(result.error ?? "Project public access control failed.");
  return result;
}
export function readInternetAccess(projectRoot: string, credentials: InternetAccessCredentials) { return control(projectRoot, credentials); }
export async function setInternetAccess(projectRoot: string, change: CollaborationInternetAccessChange, credentials: InternetAccessCredentials): Promise<CollaborationInternetAccessState> {
  const result = await control(projectRoot, credentials, change);
  if (!result) throw new Error("This Project does not own a running local LAN authority.");
  return result;
}
