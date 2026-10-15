import type { ServerWebSocket } from "bun";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { canWriteCollaboration, type CollaborationProjectState, type CollaborationRoom, type CollaborationServerMessage } from "../../core/types/collaboration.js";
import { createWorkspaceWatcher, type WorkspaceWatcher } from "../watch/index.js";
import { hash, publicPath, readContentSnapshot, writePage } from "./content.js";

export interface CloudConnectorOptions {
  cloudOrigin: string;
  root: string;
  page: string;
  roomId: string;
  ownerId: string;
  ownerToken: string;
  publisherToken: string;
  frontendDir: string;
  port?: number;
  onStatus?: (message: string) => void;
}

interface PublisherState { room: CollaborationRoom; revision: number; fingerprint: string; hostOnline: boolean }
interface Publication { opId: string; baseRevision: number; fingerprint: string; files: ReturnType<typeof readContentSnapshot>["files"] }
interface BridgeConnection { upstream: WebSocket | null; pending: string[] }
interface SaveReceipt { digest: string; fingerprint: string; revision?: number }

class CloudError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function validOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new Error("Cloud origin must be HTTPS, or loopback HTTP for local development");
  }
  return url.origin;
}

/** A local publisher owns the files; the cloud owns collaboration metadata. */
export async function startCloudCollaborationConnector(options: CloudConnectorOptions) {
  const cloudOrigin = validOrigin(options.cloudOrigin);
  if (!publicPath(options.page)) throw new Error("Invalid public page path");
  let closed = false;
  let publisher: WebSocket | null = null;
  let publisherId = "";
  let initialized = false;
  let resolveInitialPublisher: () => void = () => undefined;
  const initialPublisher = new Promise<void>((resolve) => { resolveInitialPublisher = resolve; });
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let publicationRetry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lastPong = 0;
  let attempts = 0;
  let publicationError: string | null = null;
  let pending: Publication | null = null;
  const uploaded = new Set<string>();
  const receipts = new Map<string, SaveReceipt>();
  const bridges = new Set<ServerWebSocket<BridgeConnection>>();
  let serial = Promise.resolve<unknown>(undefined);
  const status = (message: string) => options.onStatus?.(message);
  const closePublisher = () => publisher?.close();
  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = serial.then(operation);
    serial = result.catch(() => undefined);
    return result;
  };

  async function cloudRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${cloudOrigin}${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, ...Object.fromEntries(new Headers(init.headers)) },
      signal: AbortSignal.timeout(20_000),
    });
    let value: T & { error?: string };
    try { value = await response.json() as T & { error?: string }; }
    catch { throw new CloudError(`Cloud returned an unreadable response (${response.status}); the operation may have completed`, response.ok ? 502 : response.status); }
    if (!response.ok) throw new CloudError(value?.error || `Cloud request failed (${response.status})`, response.status);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CloudError("Cloud returned an invalid response; the operation may have completed", 502);
    return value;
  }
  const publisherRequest = <T>(path: string, body?: unknown) => cloudRequest<T>(path, options.publisherToken, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json", "X-Publisher-Id": publisherId }, body: JSON.stringify(body),
  });
  const remoteState = () => publisherRequest<PublisherState>("/api/publisher/state");
  async function commitPublication(publication: Publication) {
    const result = await publisherRequest<{ revision: number; fingerprint: string }>("/api/publisher/commit", publication);
    if (!Number.isInteger(result?.revision) || result.revision < 1 || result.fingerprint !== publication.fingerprint) {
      throw new CloudError("Cloud returned an invalid publication receipt; retrying the original operation", 502);
    }
    return result;
  }

  async function reportPublicationError(message: string) {
    if (publicationError === message) return;
    status(message || "Publication recovered");
    // Native filesystem errors can contain private absolute paths. Only the
    // local log receives their detail; collaborators receive a public status.
    const publicMessage = message ? "The host could not publish its latest files. Showing the last complete version." : "";
    try { await publisherRequest("/api/publisher/error", { message: publicMessage }); publicationError = message; }
    catch { /* A disconnected publisher reports its current state after reconnect. */ }
  }

  async function publishSnapshot(): Promise<{ revision: number; fingerprint: string }> {
    if (closed) throw new Error("Publisher is stopping");
    if (!publisherId) throw new CloudError("The publisher is reconnecting; changes remain on this computer", 503);
    // Resolve an uncertain commit with its original operation identity before
    // announcing a later file snapshot. A timeout does not prove failure.
    if (pending) {
      try {
        await commitPublication(pending);
        pending = null;
      } catch (error) {
        if (error instanceof CloudError && error.status === 409) pending = null;
        throw error;
      }
    }
    const snapshot = readContentSnapshot(options.root);
    if (!snapshot.files.some((file) => file.path === options.page)) throw new Error("Shared page is missing; retaining the last published version");
    const remote = await remoteState();
    if (remote.fingerprint === snapshot.fingerprint) {
      await reportPublicationError("");
      return { revision: remote.revision, fingerprint: snapshot.fingerprint };
    }
    // The connector sends each changed blob once; the DO independently verifies
    // that every manifest resource exists before making a revision visible.
    for (const [digest, bytes] of snapshot.blobs) {
      if (uploaded.has(digest)) continue;
      await cloudRequest(`/api/publisher/blobs/${digest}`, options.publisherToken, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(bytes).buffer,
      });
      uploaded.add(digest);
      if (uploaded.size > 4096) uploaded.delete(uploaded.values().next().value!);
    }
    pending = { opId: crypto.randomUUID(), baseRevision: remote.revision, fingerprint: snapshot.fingerprint, files: snapshot.files };
    const result = await commitPublication(pending);
    pending = null;
    await reportPublicationError("");
    status(`Published revision ${result.revision}`);
    return { revision: result.revision, fingerprint: snapshot.fingerprint };
  }

  const sync = () => queue(async () => {
    try {
      const result = await publishSnapshot();
      clearTimeout(publicationRetry);
      publicationRetry = undefined;
      return result;
    }
    catch (error) {
      await reportPublicationError(error instanceof Error ? error.message : "Publication failed");
      if (!closed && initialized && !publicationRetry) publicationRetry = setTimeout(() => {
        publicationRetry = undefined;
        scheduleSync();
      }, 5000);
      throw error;
    }
  });
  const scheduleSync = () => { void sync().catch(() => undefined); };

  function connectPublisher() {
    if (closed) return;
    const url = new URL("/publisher/ws", cloudOrigin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", options.publisherToken);
    const ws = new WebSocket(url);
    publisher = ws;
    ws.onopen = () => {
      if (closed || publisher !== ws) { ws.close(); return; }
      attempts = 0;
      lastPong = Date.now();
      ws.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
      heartbeat = setInterval(() => {
        if (Date.now() - lastPong > 45_000) { ws.close(); return; }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
      }, 15_000);
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; message?: string; publisherId?: string };
        if (message.type === "publisher_ready" && message.publisherId) {
          publisherId = message.publisherId;
          publicationError = null;
          status("Cloud publisher connected");
          resolveInitialPublisher();
          if (initialized) scheduleSync();
        }
        if (message.type === "pong") lastPong = Date.now();
        if (message.type === "error") status(message.message || "Publisher connection error");
      } catch { status("Invalid publisher response"); }
    };
    ws.onerror = () => status("Cloud connection interrupted; retrying");
    ws.onclose = () => {
      clearInterval(heartbeat);
      if (closed || publisher !== ws) return;
      publisherId = "";
      status("Cloud publisher disconnected; remote access is paused until the host reconnects");
      retryTimer = setTimeout(connectPublisher, Math.min(1000 * 2 ** attempts++, 10_000));
    };
  }

  // Fail startup on an invalid credential or publication root. The background
  // connector only retries after one successful initial publication.
  connectPublisher();
  let startupTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([initialPublisher, new Promise<never>((_, reject) => {
      startupTimeout = setTimeout(() => reject(new Error("Cloud publisher did not connect. Check credentials or an existing publisher")), 25_000);
    })]);
    await sync();
  } catch (error) {
    closed = true;
    clearTimeout(retryTimer);
    clearInterval(heartbeat);
    closePublisher();
    throw error;
  } finally { clearTimeout(startupTimeout); }
  initialized = true;
  let watcher: WorkspaceWatcher | undefined;
  let unsubscribe: () => void = () => undefined;
  let dirty = false;
  let processing = false;
  try {
    watcher = createWorkspaceWatcher({ root: options.root, ignore: (path) => !publicPath(path) });
    unsubscribe = watcher.subscribe(() => true, () => {
      dirty = true;
      if (processing) return;
      processing = true;
      void (async () => {
        try { while (dirty && !closed) { dirty = false; await sync().catch(() => undefined); } }
        finally { processing = false; }
      })();
    });
    await watcher.ready;
    // Reconcile writes made between initial publication and watcher registration.
    await sync();
  } catch (error) {
    closed = true;
    clearTimeout(retryTimer);
    clearTimeout(publicationRetry);
    clearInterval(heartbeat);
    closePublisher();
    unsubscribe();
    await watcher?.close();
    throw error;
  }

  const json = (value: unknown, code = 200) => Response.json(value, { status: code, headers: { "Cache-Control": "no-store" } });
  const ownerBearer = `Bearer ${options.ownerToken}`;
  const equalToken = (left: string, right: string) => {
    const a = new TextEncoder().encode(hash(left));
    const b = new TextEncoder().encode(hash(right));
    return timingSafeEqual(a, b);
  };
  const permitSource = (state: CollaborationProjectState): CollaborationProjectState => ({
    ...state, capabilities: { editSource: state.self.id === options.ownerId && canWriteCollaboration(state.self) },
  });
  function bridgeMessage(raw: string): string {
    const message = JSON.parse(raw) as CollaborationServerMessage;
    if (message.type === "welcome" || message.type === "project") message.state = permitSource(message.state);
    if (message.type === "room") message.state.pageUrl = new URL(message.state.pageUrl, cloudOrigin).toString();
    if (message.type === "content") message.pageUrl = new URL(message.pageUrl, cloudOrigin).toString();
    return JSON.stringify(message);
  }
  async function assertWritingOwner() {
    const state = await cloudRequest<CollaborationProjectState>("/api/state", options.ownerToken);
    const room = state.rooms.find((value) => value.id === options.roomId);
    if (state.self.id !== options.ownerId || !canWriteCollaboration(state.self) || !room?.enabled) throw new CloudError("You no longer have permission to edit this workspace", 403);
  }
  async function sourceRequest(request: Request): Promise<Response> {
    await assertWritingOwner();
    if (request.method === "GET") {
      return queue(async () => {
        const result = await publishSnapshot();
        const snapshot = readContentSnapshot(options.root);
        if (snapshot.fingerprint !== result.fingerprint) throw new CloudError("The page is changing. Reload the source after publication completes", 409);
        const entry = snapshot.files.find((file) => file.path === options.page)!;
        const html = new TextDecoder().decode(snapshot.blobs.get(entry.hash));
        return json({ html, revision: result.revision });
      });
    }
    if (request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
    const body = await request.json() as { opId?: unknown; baseRevision?: unknown; html?: unknown };
    if (typeof body.opId !== "string" || body.opId.length < 1 || body.opId.length > 100
      || typeof body.html !== "string" || new TextEncoder().encode(body.html).byteLength > 1024 * 1024
      || !Number.isInteger(body.baseRevision)) return json({ error: "Invalid source save" }, 400);
    const { opId, html } = body;
    return queue(async () => {
      const digest = hash(JSON.stringify(body));
      const previous = receipts.get(opId);
      if (previous) {
        if (previous.digest !== digest) throw new CloudError("Operation identity already used for different input", 409);
        if (previous.revision !== undefined) return json({ revision: previous.revision });
        if (readContentSnapshot(options.root).fingerprint !== previous.fingerprint) throw new CloudError("The locally saved file changed before publication completed", 409);
        const result = await publishSnapshot();
        previous.revision = result.revision;
        return json({ revision: result.revision });
      }
      const current = await publishSnapshot();
      if (current.revision !== body.baseRevision) throw new CloudError("The page changed. Reload the latest source before saving", 409);
      await assertWritingOwner();
      if (readContentSnapshot(options.root).fingerprint !== current.fingerprint) throw new CloudError("The local page changed during publication. Reload before saving", 409);
      writePage(options.root, options.page, html);
      const receipt: SaveReceipt = { digest, fingerprint: readContentSnapshot(options.root).fingerprint };
      receipts.set(opId, receipt);
      if (receipts.size > 128) receipts.delete(receipts.keys().next().value!);
      try {
        const result = await publishSnapshot();
        receipt.revision = result.revision;
        return json({ revision: result.revision });
      } catch (error) {
        await reportPublicationError(error instanceof Error ? error.message : "Publication failed");
        throw new CloudError("Saved on this computer, but cloud publication is pending. Reconnect before retrying", 502);
      }
    });
  }

  let server: ReturnType<typeof Bun.serve<BridgeConnection>>;
  try {
    server = Bun.serve<BridgeConnection>({
      hostname: "127.0.0.1", port: options.port ?? 17998, maxRequestBodySize: 1024 * 1024 + 8192,
      async fetch(request, runtime) {
        try {
          const url = new URL(request.url);
          if (!["localhost", "127.0.0.1"].includes(url.hostname)) return json({ error: "Loopback host required" }, 403);
          const origin = request.headers.get("origin");
          if (origin && origin !== url.origin) return json({ error: "Cross-origin access refused" }, 403);
          if (url.pathname === "/ws") {
            if (!equalToken(url.searchParams.get("token") || "", options.ownerToken)) return json({ error: "Owner credential required" }, 401);
            if (bridges.size >= 8) return json({ error: "Too many host windows" }, 429);
            if (runtime.upgrade(request, { data: { upstream: null, pending: [] } })) return;
            return json({ error: "Socket upgrade failed" }, 400);
          }
          if (url.pathname.startsWith("/api/")) {
            if (!equalToken(request.headers.get("authorization") || "", ownerBearer)) return json({ error: "Owner credential required" }, 401);
            if (url.pathname === `/api/rooms/${encodeURIComponent(options.roomId)}/content`) return await sourceRequest(request);
            // Only the collaboration API is forwarded. Private session APIs do
            // not exist on either end of this isolated host window.
            const response = await fetch(`${cloudOrigin}${url.pathname}${url.search}`, {
              method: request.method, headers: { Authorization: ownerBearer, "Content-Type": "application/json", Origin: cloudOrigin },
              body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
              signal: AbortSignal.timeout(20_000),
            });
            if (url.pathname === "/api/state" && response.ok) return json(permitSource(await response.json() as CollaborationProjectState));
            if (request.method === "GET" && /^\/api\/rooms\/[^/]+$/.test(url.pathname) && response.ok) {
              const state = await response.json() as { pageUrl?: string };
              if (state.pageUrl) state.pageUrl = new URL(state.pageUrl, cloudOrigin).toString();
              return json(state);
            }
            return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
          }
          if (!["GET", "HEAD"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
          const path = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
          if (!publicPath(path) || !(path === "index.html" || path === "viewer-manifest.json" || path === "favicon.svg" || path.startsWith("assets/") || path.startsWith("viewer/"))) return json({ error: "Not found" }, 404);
          const file = Bun.file(join(options.frontendDir, path));
          if (!await file.exists()) return json({ error: "Not found" }, 404);
          return new Response(request.method === "HEAD" ? null : file, { headers: {
            "Cache-Control": path.startsWith("assets/") || path.startsWith("viewer/") ? "public, max-age=31536000, immutable" : "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; frame-src ${cloudOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
          } });
        } catch (error) {
          if (error instanceof CloudError) return json({ error: error.message }, error.status);
          status(error instanceof Error ? error.message : "Local host request failed");
          return json({ error: "Unable to complete the request. Check the local publisher connection" }, 502);
        }
      },
      websocket: {
        maxPayloadLength: 16 * 1024, idleTimeout: 60,
        open(socket) {
          bridges.add(socket);
          const url = new URL("/ws", cloudOrigin);
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          url.searchParams.set("token", options.ownerToken);
          const upstream = new WebSocket(url);
          socket.data.upstream = upstream;
          upstream.onopen = () => {
            if (!bridges.has(socket)) { upstream.close(); return; }
            for (const message of socket.data.pending) upstream.send(message);
            socket.data.pending = [];
          };
          upstream.onmessage = (event) => {
            try {
              if (socket.getBufferedAmount() > 256 * 1024) { socket.close(1013, "Reconnect for current state"); return; }
              socket.send(bridgeMessage(String(event.data)));
            } catch { socket.close(1011, "Invalid cloud response"); }
          };
          upstream.onclose = () => socket.close(1012, "Cloud connection closed");
          upstream.onerror = () => socket.close(1011, "Cloud connection interrupted");
        },
        message(socket, raw) {
          const message = typeof raw === "string" ? raw : raw.toString();
          const upstream = socket.data.upstream;
          if (upstream?.readyState === WebSocket.OPEN) {
            if (upstream.bufferedAmount > 256 * 1024) { socket.close(1013, "Cloud connection is congested"); return; }
            upstream.send(message);
          } else if (socket.data.pending.length < 16) socket.data.pending.push(message);
          else socket.close(1013, "Cloud connection not ready");
        },
        close(socket) { bridges.delete(socket); socket.data.upstream?.close(); },
      },
    });
  } catch (error) {
    closed = true;
    clearTimeout(retryTimer);
    clearInterval(heartbeat);
    closePublisher();
    unsubscribe();
    await watcher?.close();
    throw error;
  }
  return {
    port: server.port,
    sync,
    async close() {
      closed = true;
      clearTimeout(retryTimer);
      clearTimeout(publicationRetry);
      clearInterval(heartbeat);
      closePublisher();
      for (const socket of bridges) { socket.data.upstream?.close(); socket.close(); }
      unsubscribe();
      await watcher?.close();
      await serial;
      await server.stop(true);
    },
  };
}

export { startCollaborationPublisher, type CollaborationPublisherOptions, type CollaborationPublisherSnapshot } from "./publisher.js";
