import type { Hono } from "hono";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { canWriteCollaboration, type CollaborationProjectState, type CollaborationRoom } from "../../core/types/collaboration.js";
import type { CollaborationViewerAsset, CollaborationViewerCatalog, CreateSessionCollaboration, SessionCollaborationStatus, ShareSessionCollaboration } from "../../core/types/collaboration-session.js";
import { collaborationAuthorityBase, collaborationIdentityChallenge, collaborationReferenceOperationAuthority, type CollaborationAuthorityIdentity, type LocalCollaborationBinding, type LocalCollaborationRoom } from "../../core/types/collaboration-workspace.js";
import { loadProjectManifest } from "../../core/project-loader.js";
import type { WorkspaceWatcher } from "../watch/index.js";
import { isCollaborationPublicPath } from "../../core/types/collaboration-publication.js";
import { loadModePublicationAdapter, readModeContentSnapshot, readPublicationInputFiles } from "./publication.js";
import { ensureLanCollaborationService, ensureOwnedLanCollaborationService } from "./lan-service.js";
import { collaborationStateDir, ensurePortableProjectId, parseCollaborationAuthority, readLocalCollaborationBinding, readLocalCollaborationRoom, withCollaborationSetupLock, writeLocalCollaborationBinding, writeLocalCollaborationRoom, writePrivateJson } from "./local-state.js";
import { startCollaborationPublisher } from "./publisher.js";
import { readInternetAccess, setInternetAccess } from "./internet-access.js";
import type { CollaborationInternetAccessChange, CollaborationInternetAccessState } from "../../core/types/collaboration-access.js";
import { mountSessionReferenceImportRoutes } from "./reference-import.js";

interface SessionCollaborationOptions {
  projectRoot?: string;
  packageRoot: string;
  workspace: string;
  stateDir: string;
  sessionId?: string;
  manifest?: ModeManifest;
  modeDir?: string;
  initParams?: Record<string, string | number>;
  watcher?: WorkspaceWatcher;
  /** Tests can supply built public assets without invoking a compiler. */
  frontendDir?: string;
}

class CollaborationRouteError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const credential = () => [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
function label(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new CollaborationRouteError("Provide a valid name or title.");
  return value.trim();
}

/** Private normal-Session setup and publishing; never mounted on a public authority. */
export function mountSessionCollaborationRoutes(app: Hono, options: SessionCollaborationOptions) {
  mountSessionReferenceImportRoutes(app, options);
  let binding: LocalCollaborationBinding | null = null;
  let room: LocalCollaborationRoom | null = null;
  let publisher: Awaited<ReturnType<typeof startCollaborationPublisher>> | null = null;
  let error = "";
  let publisherStatus = "Not sharing";
  let initialized: Promise<void> | null = null;
  let starting: Promise<void> | null = null;
  let stopped = false;
  let projectRemoved = false;
  let internetAccess: CollaborationInternetAccessState | undefined;
  let canManageInternetAccess = false;
  let entries: SessionCollaborationStatus["entries"];

  let operation: Promise<unknown> = Promise.resolve();
  const frontendDir = options.frontendDir ?? join(options.packageRoot, "dist", "collaboration");
  const supported = !!options.manifest?.viewerApi?.collaboration?.viewing;
  const serial = <T>(action: () => Promise<T>) => {
    const result = operation.then(action);
    operation = result.catch(() => undefined);
    return result;
  };
  const requireProject = () => {
    if (!options.projectRoot) throw new CollaborationRouteError("Create or open a Pneuma Project to collaborate.");
    return options.projectRoot;
  };
  async function request<T>(connection: LocalCollaborationBinding, path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
    const response = await fetch(`${collaborationAuthorityBase(connection.authority, connection.projectId)}${path}`, {
      method, headers: { Authorization: `Bearer ${connection.memberToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => { throw new CollaborationRouteError("Authority response was unreadable; the operation may have completed. Retry to recover its receipt.", 502); }) as T & { error?: string };
    if (response.status === 410 && (result as { code?: string }).code === "project_removed") {
      projectRemoved = true; publisherStatus = "Shared project removed";
    }
    if (!response.ok) throw new CollaborationRouteError(result.error ?? `Collaboration authority returned ${response.status}.`, response.status);
    return result;
  }
  async function viewerCatalog(): Promise<CollaborationViewerCatalog> {
    let catalog: CollaborationViewerCatalog;
    try { catalog = await Bun.file(join(frontendDir, "viewer-manifest.json")).json(); }
    catch { throw new CollaborationRouteError("Shared viewer assets are unavailable. Build them with bun run build:collaboration, then retry sharing.", 503); }
    if (!catalog || typeof catalog.coreVersion !== "string" || !Array.isArray(catalog.modes)) throw new CollaborationRouteError("The shared viewer catalog is invalid. Rebuild shared viewer assets and retry.", 409);
    return catalog;
  }
  async function viewerAsset(): Promise<CollaborationViewerAsset> {
    if (!supported || !options.manifest || !options.modeDir) throw new CollaborationRouteError("This mode does not support collaboration yet.");
    const catalog = await viewerCatalog();
    const asset = catalog.modes?.find((entry) => entry.mode === options.manifest!.name
      && entry.modeVersion === options.manifest!.version
      && entry.publicationSchema === options.manifest!.viewerApi!.collaboration!.publication.schema);
    if (!asset || asset.coreVersion !== catalog.coreVersion || !/^[a-f0-9]{64}$/.test(asset.viewerHash)) throw new CollaborationRouteError("The shared viewer build is incompatible with this mode. Rebuild shared viewer assets and retry.", 409);
    return asset;
  }
  async function status(): Promise<SessionCollaborationStatus> {
    const connection = binding;
    const referenceOperationAuthority = connection ? await collaborationReferenceOperationAuthority(connection.authority) : undefined;
    return { projectAvailable: !!options.projectRoot, supported, sharing: !!room?.enabled && !projectRemoved,
      publisherStatus: publisher?.status ?? publisherStatus,
      ...(connection ? { connection: { projectId: connection.projectId, workspaceId: connection.workspace.id,
        ownerId: connection.workspace.ownerId, authorityBaseUrl: collaborationAuthorityBase(connection.authority, connection.projectId), token: connection.memberToken, authorityKind: connection.authority.kind, referenceOperationAuthority } } : {}),
      ...(internetAccess ? { internetAccess } : {}), canManageInternetAccess, ...(entries ? { entries } : {}),
      ...(room ? { roomId: room.roomId, sharedContentSet: room.contentSet } : {}), ...(projectRemoved ? { projectRemoved: true } : {}), ...(error ? { error } : {}) };
  }
  async function startPublishing(): Promise<void> {
    if (publisher || stopped || !binding || !room?.enabled) return;
    if (starting) return starting;
    const connection = binding;
    const attachment = room;
    starting = (async () => {
      if (!options.manifest || !options.modeDir || !supported) throw new CollaborationRouteError("This running mode cannot publish a shared viewer.");
      if (attachment.projectId !== connection.projectId || attachment.workspaceId !== connection.workspace.id
        || attachment.modeInstanceId !== options.sessionId) throw new CollaborationRouteError("This sharing registration belongs to another running instance.");
      const adapter = await loadModePublicationAdapter(options.modeDir, options.manifest);
      publisherStatus = "Connecting publisher";
      const active = await startCollaborationPublisher({
        authorityBaseUrl: collaborationAuthorityBase(connection.authority, connection.projectId),
        roomId: attachment.roomId, publisherToken: attachment.publisherToken,
        getSnapshot: () => readModeContentSnapshot({ workspace: options.workspace, manifest: options.manifest!, adapter,
          input: { files: readPublicationInputFiles(options.workspace, attachment.contentSet), contentSet: attachment.contentSet,
            activeFile: attachment.activeFile, initParams: options.initParams ?? {} } }),
        ...(options.watcher ? { subscribeChanges: (changed: () => void) => options.watcher!.subscribe(isCollaborationPublicPath, changed) } : {}),
        onStatus: (value) => { publisherStatus = value; if (value === "Shared project removed") projectRemoved = true; },
      });
      if (stopped || room !== attachment || !room.enabled) { await active.stop(); return; }
      publisher = active;
      error = "";
    })().catch((failure) => { error = failure instanceof Error ? failure.message : "Publication failed."; publisherStatus = "Publication unavailable"; throw failure; })
      .finally(() => { starting = null; });
    return starting;
  }
  async function initialize() {
    if (!initialized) initialized = (async () => {
      if (!options.projectRoot) return;
      binding = await readLocalCollaborationBinding(options.projectRoot);
      room = await readLocalCollaborationRoom(options.stateDir);
      if (binding?.authority.kind === "lan") await ensureOwnedLanCollaborationService({ projectRoot: options.projectRoot, packageRoot: options.packageRoot, binding, frontendDir });
      if (room?.enabled && binding) void startPublishing().catch(() => undefined);
    })().catch((failure) => { error = failure instanceof Error ? failure.message : "Cannot load collaboration configuration."; });
    await initialized;
  }
  async function create(body: CreateSessionCollaboration) {
    const root = requireProject();
    await initialize();
    return withCollaborationSetupLock(root, async () => {
      const existing = await readLocalCollaborationBinding(root);
      if (existing) {
        binding = existing;
        if (existing.authority.kind === "lan" && !existing.authority.publicKey) {
          const trusted = await identity(existing.authority.origin, existing.projectId);
          existing.authority = { ...existing.authority, publicKey: trusted.publicKey };
          await writeLocalCollaborationBinding(root, existing);
        }
        const state = await request<CollaborationProjectState>(existing, "/api/state");
        if (canWriteCollaboration(state.self)) await request(existing, "/api/workspaces", { id: existing.workspace.id, name: existing.workspace.name, placement: "local" });
        await refreshAccess();
        return status();
      }
      const name = label(body.name, 100);
      const projectId = await ensurePortableProjectId(root);
      const manifest = (await loadProjectManifest(root))!;
      const pendingPath = join(collaborationStateDir(root), "pending-setup.json");
      let pending: { project: { id: string; name: string }; owner: { id: string; name: string; token: string }; authority?: LocalCollaborationBinding["authority"] };
      if (await Bun.file(pendingPath).exists()) pending = await Bun.file(pendingPath).json();
      else {
        pending = { project: { id: projectId, name: manifest.displayName }, owner: { id: crypto.randomUUID(), name, token: credential() },
          ...(body.authority?.kind === "cloud" ? { authority: parseCollaborationAuthority(body.authority) } : {}) };
        await writePrivateJson(pendingPath, pending);
      }
      if (pending.project.id !== projectId) throw new CollaborationRouteError("Pending setup belongs to a different shared project.");
      let authority: LocalCollaborationBinding["authority"];
      if (pending.authority) {
        const selected = parseCollaborationAuthority(body.authority);
        if (selected.kind !== pending.authority.kind || selected.origin !== pending.authority.origin) throw new CollaborationRouteError("Recover the existing cloud setup before choosing another authority.");
        if (!body.bootstrapKey) throw new CollaborationRouteError("This self-hosted cloud service requires its provisioning key to create a Project.");
        const response = await fetch(`${collaborationAuthorityBase(selected, projectId)}/internal/bootstrap`, {
          method: "POST", headers: { Authorization: `Bearer ${body.bootstrapKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ project: pending.project, owner: pending.owner }), signal: AbortSignal.timeout(20_000),
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new CollaborationRouteError(result.error ?? "Cloud setup failed; retry with the same provisioning key.", response.status);
        authority = selected;
      } else {
        if (body.authority?.kind === "cloud") throw new CollaborationRouteError("This Project has a pending LAN setup. Recover it before choosing another authority.");
        await viewerCatalog();
        authority = { kind: "lan", origin: await ensureLanCollaborationService({ projectRoot: root, packageRoot: options.packageRoot,
          project: pending.project, owner: { ...pending.owner, role: "admin" }, frontendDir }) };
      }
      const placement = await identity(authority.origin, projectId);
      if (placement.kind !== authority.kind) throw new CollaborationRouteError("Created Project returned an incompatible authority placement.", 502);
      if (placement.publicKey) authority = { ...authority, publicKey: placement.publicKey };
      binding = { version: 1, projectId, workspace: { id: crypto.randomUUID(), projectId, ownerId: pending.owner.id,
        name: manifest.displayName, placement: "local" }, authority, memberToken: pending.owner.token, memberName: pending.owner.name };
      // Verify before persisting the connection; no LAN fallback is created for cloud failure.
      const state = await request<CollaborationProjectState>(binding, "/api/state");
      if (state.project.id !== projectId || state.self.id !== binding.workspace.ownerId || state.self.kind !== "member") throw new CollaborationRouteError("Created Project returned an incompatible identity.", 502);
      await writeLocalCollaborationBinding(root, binding);
      await request(binding, "/api/workspaces", { id: binding.workspace.id, name: binding.workspace.name, placement: "local" });
      await unlink(pendingPath);
      await refreshAccess();
      error = "";
      return status();
    });
  }
  async function identity(origin: string, projectId: string, pinnedKey?: string): Promise<CollaborationAuthorityIdentity> {
    const nonce = credential();
    const base = `${origin}/projects/${encodeURIComponent(projectId)}`;
    const response = await fetch(`${base}/api/identity?nonce=${nonce}`, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (response.status === 410) {
      const removed = await response.json().catch(() => ({})) as { code?: string };
      if (removed.code === "project_removed") { projectRemoved = true; publisherStatus = "Shared project removed"; throw new CollaborationRouteError("Shared Project was removed.", 410); }
    }
    if (!response.ok) throw new CollaborationRouteError("This authority does not expose a verifiable placement identity. Use its existing entry URL.", 409);
    const value = await response.json() as CollaborationAuthorityIdentity;
    if (value.version !== 1 || value.projectId !== projectId || value.origin !== origin || !["lan", "cloud"].includes(value.kind)) throw new CollaborationRouteError("Authority returned an incompatible placement identity.", 502);
    if (value.kind === "lan") {
      if (pinnedKey && value.publicKey !== pinnedKey) throw new CollaborationRouteError("This link belongs to another authority. Existing credentials were not sent.", 409);
      try {
        if (!value.publicKey || value.nonce !== nonce || !value.signature) throw new Error("Missing identity proof");
        const key = await crypto.subtle.importKey("spki", Uint8Array.from(atob(value.publicKey), (char) => char.charCodeAt(0)), { name: "Ed25519" }, false, ["verify"]);
        const verified = await crypto.subtle.verify("Ed25519", key, Uint8Array.from(atob(value.signature), (char) => char.charCodeAt(0)), new TextEncoder().encode(collaborationIdentityChallenge(projectId, origin, nonce)));
        if (!verified) throw new Error("Invalid identity proof");
      } catch { throw new CollaborationRouteError("The authority identity could not be verified. Existing credentials were not sent.", 409); }
    } else if (pinnedKey) throw new CollaborationRouteError("This link changes the authority placement. Existing credentials were not sent.", 409);
    return value;
  }
  async function refreshAccess(): Promise<void> {
    if (!binding || !options.projectRoot) return;
    entries = [{ kind: binding.authority.kind === "cloud" ? "cloud" : "lan", baseUrl: collaborationAuthorityBase(binding.authority, binding.projectId) }];
    if (binding.authority.kind !== "lan") { canManageInternetAccess = false; internetAccess = undefined; return; }
    // Loopback control remains usable when the advertised LAN address is unreachable.
    const access = await readInternetAccess(options.projectRoot, { projectId: binding.projectId, memberToken: binding.memberToken, authorityOrigin: binding.authority.origin });
    if (access) {
      internetAccess = access; canManageInternetAccess = true;
      if (access.publicOrigin) entries.push({ kind: "public", baseUrl: collaborationAuthorityBase({ kind: "lan", origin: access.publicOrigin }, binding.projectId) });
      return;
    }
    internetAccess = undefined; canManageInternetAccess = false;
    const placement = await identity(binding.authority.origin, binding.projectId, binding.authority.publicKey);
    entries = [];
    if (placement.lanOrigin) entries.push({ kind: "lan", baseUrl: collaborationAuthorityBase({ kind: "lan", origin: placement.lanOrigin }, binding.projectId) });
    if (placement.publicOrigin) entries.push({ kind: "public", baseUrl: collaborationAuthorityBase({ kind: "lan", origin: placement.publicOrigin }, binding.projectId) });
    if (!entries.length) entries.push({ kind: "lan", baseUrl: collaborationAuthorityBase(binding.authority, binding.projectId) });
  }
  async function changeInternetAccess(body: CollaborationInternetAccessChange) {
    const root = requireProject(); await initialize();
    if (!binding || binding.authority.kind !== "lan") throw new CollaborationRouteError("Public access is available only for a locally hosted LAN Project.", 409);
    await setInternetAccess(root, body, { projectId: binding.projectId, memberToken: binding.memberToken, authorityOrigin: binding.authority.origin });
    await refreshAccess();
    error = "";
    return status();
  }
  async function connect(urlString: unknown) {
    const root = requireProject(); await initialize();
    const url = new URL(label(urlString, 4000));
    // Validate the entry before fetching identity; never forward credentials through redirects.
    parseCollaborationAuthority({ kind: "lan", origin: url.origin });
    if (url.username || url.password || url.search) throw new CollaborationRouteError("Use a Project collaboration member link.");
    const fragment = new URLSearchParams(url.hash.slice(1));
    const incomingToken = fragment.get("token");
    if (fragment.has("invite") || incomingToken !== null && (incomingToken.length < 16 || incomingToken.length > 256)) throw new CollaborationRouteError("Paste a Project member link or, for an already connected workspace, its current Project URL. A guest invitation cannot connect a local workspace.");
    const match = url.pathname.match(/^\/projects\/([a-zA-Z0-9_-]{1,100})\/?$/);
    if (!match) throw new CollaborationRouteError("Use a Project collaboration member link with its Project path.");
    return withCollaborationSetupLock(root, async () => {
      const existing = await readLocalCollaborationBinding(root);
      if (!incomingToken && (!existing || existing.authority.kind !== "lan")) throw new CollaborationRouteError("A new workspace requires a Project member link with its token.");
      const changingOrigin = !!existing && existing.authority.origin !== url.origin;
      const ownsLocalAuthority = existing?.authority.kind === "lan" && await ensureOwnedLanCollaborationService({ projectRoot: root, packageRoot: options.packageRoot, binding: existing, frontendDir });
      if (existing && existing.projectId !== match[1]) throw new CollaborationRouteError("This local Project already has a different collaboration binding.", 409);
      if (changingOrigin && existing!.authority.kind !== "lan") throw new CollaborationRouteError("Cloud authority bindings must keep their existing entry URL.", 409);
      if (existing?.authority.kind === "lan" && !existing.authority.publicKey) {
        // Upgrade only through the old, trusted endpoint, never through the new candidate.
        const trusted = await identity(existing.authority.origin, existing.projectId);
        existing.authority = { ...existing.authority, publicKey: trusted.publicKey };
        await writeLocalCollaborationBinding(root, existing);
      }
      const placement = await identity(url.origin, match[1], existing?.authority.publicKey);
      const authority = { ...parseCollaborationAuthority({ kind: placement.kind, origin: url.origin }), ...(placement.publicKey ? { publicKey: placement.publicKey } : {}) };
      // Existing credentials move only after the candidate has proved its pinned identity.
      const token = incomingToken ?? existing!.memberToken;
      const response = await fetch(`${collaborationAuthorityBase(authority, match[1])}/api/state`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(20_000),
      });
      const state = await response.json() as CollaborationProjectState & { error?: string };
      if (!response.ok) throw new CollaborationRouteError(state.error ?? "Unable to connect to that Project.", response.status);
      if (state.self?.kind !== "member") throw new CollaborationRouteError("Visitors can inspect their invited room; connecting a workspace requires Project membership.", 403);
      if (state.project.id !== match[1]) throw new CollaborationRouteError("Authority returned a different Project.", 502);
      if (existing && (existing.authority.kind !== authority.kind || existing.workspace.ownerId !== state.self.id)) throw new CollaborationRouteError("This local Project already has a different collaboration binding.", 409);
      await ensurePortableProjectId(root, state.project.id);
      const manifest = (await loadProjectManifest(root))!;
      const selectedAuthority = ownsLocalAuthority ? { ...authority, origin: existing!.authority.origin } : authority;
      if (binding?.authority.origin !== selectedAuthority.origin || binding.memberToken !== token) {
        await starting?.catch(() => undefined);
        await publisher?.stop(); publisher = null;
      }
      binding = { version: 1, projectId: state.project.id, authority: selectedAuthority, memberToken: token, memberName: state.self.name,
        workspace: existing?.workspace ?? { id: crypto.randomUUID(), projectId: state.project.id, ownerId: state.self.id, name: manifest.displayName, placement: "local" } };
      await writeLocalCollaborationBinding(root, binding);
      if (canWriteCollaboration(state.self)) await request(binding, "/api/workspaces", { id: binding.workspace.id, name: binding.workspace.name, placement: "local" });
      if (room?.enabled) await startPublishing();
      await refreshAccess();
      error = "";
      return status();
    });
  }
  async function share(body: ShareSessionCollaboration) {
    requireProject(); await initialize();
    if (!binding) throw new CollaborationRouteError("Connect this Project to collaboration first.");
    if (!options.sessionId || !options.manifest || !options.modeDir) throw new CollaborationRouteError("Sharing requires a running Project mode instance.");
    const title = label(body.title, 160);
    if (body.contentSet !== null && (typeof body.contentSet !== "string" || !isCollaborationPublicPath(body.contentSet))
      || body.activeFile !== null && (typeof body.activeFile !== "string" || !isCollaborationPublicPath(body.activeFile))) throw new CollaborationRouteError("Invalid selected content scope.");
    const state = await request<CollaborationProjectState>(binding, "/api/state");
    if (!canWriteCollaboration(state.self) || state.self.id !== binding.workspace.ownerId) throw new CollaborationRouteError("Only this workspace's writer or administrator can publish its work.", 403);
    const asset = await viewerAsset();
    const current = room && state.rooms.find((entry) => entry.id === room!.roomId);
    if (current) {
      if (current.ownerId !== binding.workspace.ownerId || current.workspaceId !== binding.workspace.id || current.modeInstanceId !== options.sessionId) throw new CollaborationRouteError("Room ownership does not match this private Session.", 403);
      if (room!.contentSet !== body.contentSet || current.compatibility?.viewerHash !== asset.viewerHash) {
        throw new CollaborationRouteError("This room is pinned to its published site and viewer build. Remove its sharing registration before sharing a different scope or build.", 409);
      }
    }
    const adapter = await loadModePublicationAdapter(options.modeDir, options.manifest);
    const snapshot = await readModeContentSnapshot({ workspace: options.workspace, manifest: options.manifest, adapter,
      input: { files: readPublicationInputFiles(options.workspace, body.contentSet), contentSet: body.contentSet, activeFile: body.activeFile, initParams: options.initParams ?? {} } });
    await request(binding, "/api/workspaces", { id: binding.workspace.id, name: binding.workspace.name, placement: "local" });
    if (current) {
      await request(binding, `/api/rooms/${encodeURIComponent(current.id)}`, { enabled: true }, "PATCH");
      room = { ...room!, enabled: true, title };
    } else {
      const pendingPath = join(options.stateDir, "collaboration-registration.json");
      const desired = { workspaceId: binding.workspace.id, modeInstanceId: options.sessionId,
        mode: options.manifest.name, title, page: snapshot.page, enabled: true,
        compatibility: { coreVersion: asset.coreVersion, modeVersion: asset.modeVersion, viewerHash: asset.viewerHash, publicationSchema: asset.publicationSchema },
        ...(asset.frameScriptUrl ? { frameScriptUrl: asset.frameScriptUrl } : { frameScript: adapter.frameScript ?? "" }) };
      let registration: typeof desired & { opId: string };
      if (await Bun.file(pendingPath).exists()) {
        registration = await Bun.file(pendingPath).json();
        if (JSON.stringify({ ...registration, opId: undefined }) !== JSON.stringify(desired)) throw new CollaborationRouteError("A previous sharing registration has an uncertain result. Retry its original scope before changing it.", 409);
      } else { registration = { ...desired, opId: crypto.randomUUID() }; await writePrivateJson(pendingPath, registration); }
      const result = await request<{ room: CollaborationRoom; publisherToken?: string }>(binding, "/api/rooms", registration);
      if (!result.publisherToken) throw new CollaborationRouteError("This instance already has a registration, but its publisher credential is unavailable. Recover the original sharing receipt.", 409);
      room = { version: 1, projectId: binding.projectId, workspaceId: binding.workspace.id, modeInstanceId: options.sessionId,
        roomId: result.room.id, publisherToken: result.publisherToken, title, contentSet: body.contentSet, activeFile: body.activeFile, enabled: true };
      await writeLocalCollaborationRoom(options.stateDir, room);
      await unlink(pendingPath);
    }
    await writeLocalCollaborationRoom(options.stateDir, room);
    await startPublishing();
    error = "";
    return status();
  }
  async function stopSharing() {
    await initialize();
    if (!room || !binding) return status();
    room = { ...room, enabled: false };
    await writeLocalCollaborationRoom(options.stateDir, room);
    try { await request(binding, `/api/rooms/${encodeURIComponent(room.roomId)}`, { enabled: false }, "PATCH"); error = ""; }
    catch (failure) { error = `Local publication stopped; the authority has not confirmed disabling the room. ${failure instanceof Error ? failure.message : "Retry when connected."}`; }
    finally { await publisher?.stop(); publisher = null; publisherStatus = "Not sharing"; }
    return status();
  }
  async function removeSharingRegistration() {
    await initialize();
    if (!room || !binding) return status();
    // Keep the original room identity until absence is confirmed remotely.
    room = { ...room, enabled: false };
    await writeLocalCollaborationRoom(options.stateDir, room);
    await starting?.catch(() => undefined);
    await publisher?.stop(); publisher = null; publisherStatus = "Not sharing";
    try { await request(binding, `/api/rooms/${encodeURIComponent(room.roomId)}`, undefined, "DELETE"); }
    catch (failure) {
      if (!(failure instanceof CollaborationRouteError && failure.status === 404)) {
        throw new CollaborationRouteError(`Local publication stopped; removal has not been confirmed. Retry removing this registration. ${failure instanceof Error ? failure.message : "Authority unavailable."}`, 502);
      }
    }
    await unlink(join(options.stateDir, "collaboration-room.json"));
    room = null; error = "";
    return status();
  }
  app.get("/api/collaboration", async (c) => { await initialize(); if (binding) await refreshAccess().catch((failure) => { error = failure instanceof Error ? failure.message : "Public access status is unavailable."; }); c.header("Cache-Control", "no-store"); return c.json(await status()); });
  for (const [path, action] of Object.entries({ create, "internet-access": changeInternetAccess, connect: (body: { url: unknown }) => connect(body.url), share, stop: stopSharing, remove: removeSharingRegistration })) {
    app.post(`/api/collaboration/${path}`, async (c) => {
      try {
        const text = await c.req.text();
        if (text.length > 16 * 1024) return c.json({ error: "Collaboration setup request is too large." }, 413);
        const body = text ? JSON.parse(text) : {};
        return c.json(await serial(() => (action as (body: never) => Promise<SessionCollaborationStatus>)(body as never)));
      } catch (failure) {
        error = failure instanceof Error ? failure.message : "Collaboration setup failed.";
        return c.json({ error }, failure instanceof CollaborationRouteError ? failure.status as 400 : 500);
      }
    });
  }
  return {
    async stop() {
      stopped = true;
      await starting?.catch(() => undefined);
      await publisher?.stop(); publisher = null;
    },
  };
}
