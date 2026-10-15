import type { CollaborationPublicationViewer, CollaborationPublicationProjection, CollaborationPublishedFile } from "../../core/types/collaboration-publication.js";
import { canonical } from "../../core/collaboration/authority-domain.js";
import type { CollaborationRoom } from "../../core/types/collaboration.js";

export interface CollaborationPublisherSnapshot {
  files: CollaborationPublishedFile[];
  blobs: Map<string, Uint8Array>;
  fingerprint: string;
  projection?: CollaborationPublicationProjection;
}
export interface CollaborationPublisherOptions {
  /** Project-scoped authority URL. The selected authority is the only metadata writer. */
  authorityBaseUrl: string;
  roomId: string;
  publisherToken: string;
  getSnapshot: () => CollaborationPublisherSnapshot | Promise<CollaborationPublisherSnapshot>;
  /** Reuse an existing workspace watcher when available. */
  subscribeChanges?: (changed: () => void) => (() => void);
  onStatus?: (message: string) => void;
  viewer?: CollaborationPublicationViewer;
}
interface Head { viewer?: CollaborationPublicationViewer; room: CollaborationRoom; revision: number; fingerprint: string; hostOnline: boolean }
interface Commit { viewer?: CollaborationPublicationViewer; opId: string; baseRevision: number; fingerprint: string; files: CollaborationPublishedFile[]; projection?: CollaborationPublicationProjection }
class AuthorityError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Fenced publication transport shared by LAN and cloud normal Sessions. */
export async function startCollaborationPublisher(options: CollaborationPublisherOptions) {
  const base = new URL(options.authorityBaseUrl);
  if (base.username || base.password || base.search || base.hash || !["https:", "http:"].includes(base.protocol)
    || !/^\/projects\/[a-zA-Z0-9_-]{1,100}\/?$/.test(base.pathname)) throw new Error("A project-scoped authority URL is required");
  const baseUrl = base.toString().replace(/\/$/, "");
  const roomPath = `/api/publisher/rooms/${encodeURIComponent(options.roomId)}`;
  let stopped = false;
  let socket: WebSocket | null = null;
  let lease = "";
  let pending: Commit | null = null;
  let serial: Promise<unknown> = Promise.resolve();
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lastPong = 0;
  let attempts = 0;
  let status = "connecting";
  const uploaded = new Set<string>();
  let readyResolve: () => void = () => undefined;
  let readyReject: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => undefined); // A failed preflight can reject readiness before it is awaited.
  const report = (message: string) => { status = message; options.onStatus?.(message); };
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, { ...init,
      headers: { Authorization: `Bearer ${options.publisherToken}`, ...Object.fromEntries(new Headers(init.headers)) },
      signal: AbortSignal.timeout(20_000) });
    let result: T & { error?: string; code?: string };
    try { result = await response.json() as T & { error?: string; code?: string }; }
    catch { throw new AuthorityError("Authority response was unreadable; publication may have completed", response.ok ? 502 : response.status); }
    if (response.status === 410 && result.code === "project_removed") endForProjectRemoved();
    if (!response.ok) throw new AuthorityError(result.error || `Authority request failed (${response.status})`, response.status);
    return result;
  };
  const endForProjectRemoved = () => {
    stopped = true; clearTimeout(reconnectTimer); clearTimeout(retryTimer); clearInterval(heartbeat);
    unsubscribe?.(); socket?.close(); lease = "";
    report("Shared project removed"); readyReject(new Error("Shared project removed"));
  };
  const post = <T>(path: string, body: unknown) => request<T>(`${roomPath}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Publisher-Id": lease }, body: JSON.stringify(body) });
  const commit = async (publication: Commit) => {
    const receipt = await post<{ revision: number; fingerprint: string }>("commit", publication);
    if (!Number.isInteger(receipt?.revision) || receipt.revision < 1 || receipt.fingerprint !== publication.fingerprint)
      throw new AuthorityError("Invalid publication receipt; retrying the original operation", 502);
    return receipt;
  };
  const publish = async () => {
    if (stopped) throw new Error("Publisher stopped");
    if (!lease) throw new AuthorityError("Publisher disconnected; changes remain local", 503);
    // Resolve uncertain effects with the same operation identity before a newer snapshot.
    if (pending) {
      try { await commit(pending); pending = null; }
      catch (error) { if (error instanceof AuthorityError && [400, 409, 413, 422].includes(error.status)) pending = null; throw error; }
    }
    const snapshot = await options.getSnapshot();
    const head = await request<Head>(`${roomPath}/state`);
    const sameViewer = !options.viewer || canonical(head.viewer) === canonical(options.viewer);
    if (head.fingerprint === snapshot.fingerprint && sameViewer) { await post("error", { message: "" }); return { revision: head.revision, fingerprint: head.fingerprint }; }
    for (const [hash, bytes] of snapshot.blobs) {
      if (uploaded.has(hash)) continue;
      await request(`${roomPath}/blobs/${hash}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(bytes).buffer });
      uploaded.add(hash);
      if (uploaded.size > 4096) uploaded.delete(uploaded.values().next().value!);
    }
    pending = { ...(options.viewer ? { viewer: options.viewer } : {}), opId: crypto.randomUUID(), baseRevision: head.revision, files: snapshot.files,
      fingerprint: snapshot.fingerprint, ...(snapshot.projection ? { projection: snapshot.projection } : {}) };
    let result: { revision: number; fingerprint: string };
    try { result = await commit(pending); }
    catch (error) {
      if (error instanceof AuthorityError && [400, 409, 413, 422].includes(error.status)) pending = null;
      throw error;
    }
    pending = null;
    await post("error", { message: "" });
    report(`Published revision ${result.revision}`);
    return result;
  };
  const sync = () => {
    const result = serial.then(async () => {
      try { const receipt = await publish(); clearTimeout(retryTimer); retryTimer = undefined; return receipt; }
      catch (error) {
        report(error instanceof Error ? error.message : "Publication failed");
        if (lease) await post("error", { message: "The publisher could not publish its latest files. Showing the last complete version." }).catch(() => undefined);
        if (!stopped && !retryTimer) retryTimer = setTimeout(() => { retryTimer = undefined; void sync().catch(() => undefined); }, 5000);
        throw error;
      }
    });
    serial = result.catch(() => undefined);
    return result;
  };
  const connect = () => {
    if (stopped) return;
    const url = new URL(`${baseUrl}/publisher/ws`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("roomId", options.roomId); url.searchParams.set("token", options.publisherToken);
    const connection = new WebSocket(url); socket = connection;
    connection.onopen = () => {
      if (stopped || socket !== connection) { connection.close(); return; }
      lastPong = Date.now(); attempts = 0;
      heartbeat = setInterval(() => {
        if (Date.now() - lastPong >= 45_000) { connection.close(); return; }
        if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
      }, 15_000);
      connection.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
    };
    connection.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; publisherId?: string; roomId?: string };
        if (message.type === "publisher_ready" && message.publisherId && message.roomId === options.roomId) {
          const reconnect = status !== "connecting";
          lease = message.publisherId; report("Publisher connected"); readyResolve();
          if (reconnect) void sync().catch(() => undefined);
        }
        if (message.type === "pong") lastPong = Date.now();
      } catch { report("Invalid publisher response"); }
    };
    connection.onerror = () => report("Authority connection interrupted");
    connection.onclose = (event) => {
      if (socket !== connection) return;
      clearInterval(heartbeat); lease = "";
      if (event.code === 1008 && event.reason === "Project removed") { endForProjectRemoved(); return; }
      if (stopped) return;
      report("Publisher disconnected; room access is paused");
      reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10_000));
    };
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true; clearTimeout(reconnectTimer); clearTimeout(retryTimer); clearInterval(heartbeat);
    unsubscribe?.(); socket?.close(); lease = "";
    // In-flight requests can have completed remotely; wait for their result without claiming rollback.
    await serial;
    report("stopped");
  };
  let unsubscribe: (() => void) | undefined;
  const startup = setTimeout(() => readyReject(new Error("Publisher did not connect; check credentials or another running publisher")), 25_000);
  try { await request<Head>(`${roomPath}/state`); connect(); await ready; await sync(); unsubscribe = options.subscribeChanges?.(() => { void sync().catch(() => undefined); }); }
  catch (error) { await stop(); throw error; }
  finally { clearTimeout(startup); }
  return { sync, stop, get status() { return status; } };
}
