import { CollaborationSetupEntry } from "./CollaborationSetupGuide.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";
import type { CreateSessionCollaboration, SessionCollaborationStatus } from "../../core/types/collaboration-session.js";
import { isCollaborationHost, type CollaborationAnchor } from "../../core/types/collaboration.js";
import { createCommentAnchor } from "./comment-anchor.js";
import { createCommentFeedback, createChatFeedback } from "./forward-to-agent.js";
import type { ViewerSelectionContext } from "../../core/types/viewer-contract.js";
import { discussionAvailable, mutationAvailable, shareUrl } from "./client-state.js";
import { useCollaboration } from "./use-collaboration.js";
import { ViewerCollaborationRuntime } from "./viewer-runtime.js";
import type { ViewerRuntimeSnapshot } from "./viewer-runtime.js";
import { ViewerOverlays } from "./ViewerOverlays.js";
import { Chat, Comments, MembersPanel, SharePanel } from "./App.js";
import { InternetAccessPanel } from "./InternetAccessPanel.js";
import { migrateReferenceOperations } from "./reference-operations.js";
import { PinRoomButton, ReferencesPanel } from "./ReferencesPanel.js";
import { createPrivateViewerInstanceId } from "../../core/types/private-viewer.js";
import "./session-collaboration.css";

type Client = ReturnType<typeof useCollaboration>;
interface SessionContext {
  status: SessionCollaborationStatus | null;
  client: Client;
  runtime: ViewerCollaborationRuntime | null;
  sharedView: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  commenting: boolean;
  canComment: boolean;
  startComment: () => void;
  selection: (selection: ViewerSelectionContext | null) => void;
  draft: CollaborationAnchor | null;
  clearDraft: () => void;
  command: (path: string, body?: unknown) => Promise<void>;
  error: string;
  pending: boolean;
  referenceRecoveryError: string;
  tab: "project" | "references" | "comments" | "chat" | "links" | "members";
  setTab: (tab: SessionContext["tab"]) => void;
}
const Context = createContext<SessionContext | null>(null);
export function useSessionCollaboration() { return useContext(Context); }

/** Only the private shell imports its store; the public viewer host never imports this file. */
export function SessionCollaborationProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionCollaborationStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SessionContext["tab"]>("project");
  const [pending, setPending] = useState(false);
  const pendingCommand = useRef(false);
  const [error, setError] = useState("");
  const [referenceRecoveryError, setReferenceRecoveryError] = useState("");
  const migratedStatus = useRef<SessionCollaborationStatus | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [draft, setDraft] = useState<CollaborationAnchor | null>(null);
  const viewerInstanceId = useStore((state) => state.viewerInstanceId);
  const manifest = useStore((state) => state.modeManifest);
  const activeContentSet = useStore((state) => state.activeContentSet);
  const sessionId = useStore((state) => state.sessionId);
  const projectContext = useStore((state) => state.projectContext);
  const params = new URLSearchParams(location.search);
  const enabled = (params.has("session") || params.has("mode")) && !params.has("replay") && params.get("surface") !== "chat";
  const refreshSequence = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++refreshSequence.current;
    try {
      const response = await fetch(`${getApiBase()}/api/collaboration`, { signal, cache: "no-store" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Unable to load collaboration settings");
      if (!signal?.aborted && sequence === refreshSequence.current) {
        try {
          migratedStatus.current ??= next; // Retain the first trusted prefix even when storage is temporarily unavailable.
          migrateReferenceOperations(migratedStatus.current?.connection, next.connection);
          setReferenceRecoveryError("");
          migratedStatus.current = next;
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : "Reference recovery is unavailable.";
          setReferenceRecoveryError(message);
        }
        setStatus(next);
      }
    } catch (failure) {
      if (!signal?.aborted && sequence === refreshSequence.current) throw failure;
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let polling = false;
    const load = () => {
      if (pendingCommand.current || polling) return;
      polling = true;
      const sequence = refreshSequence.current + 1;
      void refresh(controller.signal).catch((error) => {
        if (!controller.signal.aborted && sequence === refreshSequence.current) setError(error instanceof Error ? error.message : "Unable to reach collaboration");
      }).finally(() => { polling = false; });
    };
    load(); const timer = setInterval(load, 5000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [enabled, sessionId, projectContext?.projectRoot, refresh]);
  const client = useCollaboration(status?.connection?.token ?? "", status?.sharing ? status.roomId ?? "" : "", { baseUrl: status?.connection?.authorityBaseUrl, updateHash: false, selectDefault: false });
  const declaration = manifest?.viewerApi?.collaboration;
  const sharedView = !!status?.sharing && !status.projectRemoved && !client.projectRemoved && activeContentSet === (status.sharedContentSet ?? null);
  const runtime = useMemo(() => {
    if (!viewerInstanceId || !declaration || !sharedView || !status?.roomId) return null;
    return new ViewerCollaborationRuntime(viewerInstanceId, declaration, { address: client.room?.publication?.projection?.entryAddress ?? {} }, (report) => {
      client.send({ type: "presence", view: null, cursor: null, ...report, sentAt: Date.now() });
    }, { contentSet: status.sharedContentSet ?? null });
  }, [viewerInstanceId, declaration, sharedView, status?.roomId, status?.sharedContentSet, client.send]);
  useEffect(() => () => runtime?.dispose(), [runtime]);
  useEffect(() => {
    if (!runtime) return;
    const room = client.room;
    runtime.update(room?.room.revision ?? 0, client.status === "connected" && !!room, (room?.participants ?? []).filter((peer) => peer.id !== client.connectionId).map((peer) => ({ id: peer.id, revision: peer.revision ?? peer.view?.revision ?? 0, view: peer.semanticView ?? null, pointer: peer.semanticPointer ?? null, followingId: peer.followingId })), room?.comments ?? []);
  }, [runtime, client.room, client.connectionId, client.status]);
  const command = useCallback(async (path: string, body?: unknown) => {
    ++refreshSequence.current;
    pendingCommand.current = true;
    setPending(true); setError("");
    try {
      const response = await fetch(`${getApiBase()}/api/collaboration/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || "Collaboration request failed");
      await refresh();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Collaboration request failed";
      await refresh().catch(() => undefined);
      setError(message); throw failure;
    } finally { pendingCommand.current = false; setPending(false); }
  }, [refresh]);
  const canDiscuss = discussionAvailable(client.project?.self, client.status) && !!client.room?.room.enabled && client.room.room.id === status?.roomId && sharedView;
  useEffect(() => { if (!canDiscuss) { setCommenting(false); setDraft(null); } }, [canDiscuss]);
  const startComment = () => {
    if (!canDiscuss) return;
    setOpen(true); setTab("comments"); setCommenting(true);
  };
  const value: SessionContext = {
    status, client, runtime, sharedView, open, setOpen, commenting, canComment: canDiscuss, startComment, draft, clearDraft: () => { setDraft(null); setCommenting(false); }, command, error, pending, referenceRecoveryError, tab, setTab,
    selection: (selection) => {
      if (!canDiscuss || !selection || !client.room) return;
      const anchor = createCommentAnchor(selection, client.room.room.revision);
      if (!anchor) return;
      setDraft(anchor);
      setCommenting(false); setOpen(true); setTab("comments");
    },
  };
  return <Context.Provider value={value}>{children}{open && createPortal(<SessionCollaborationPanel/>, document.body)}</Context.Provider>;
}

export function SessionCollaborationButton() {
  const collaboration = useSessionCollaboration();
  if (!collaboration) return null;
  const count = Object.values(collaboration.client.unread).reduce((sum, counts) => sum + counts.chat + counts.comments, 0);
  return <button type="button" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-cc-border text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover" onClick={() => collaboration.setOpen(!collaboration.open)} aria-expanded={collaboration.open} title="Project collaboration"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 5a5 5 0 0 1 3 4v2"/></svg>{collaboration.status?.sharing ? "Sharing" : "Collaborate"}{count > 0 && <span>{count > 99 ? "99+" : count}</span>}</button>;
}

export function SessionViewerOverlays() {
  const context = useSessionCollaboration();
  const instanceError = useStore((state) => state.viewerInstanceError);
  return <>{instanceError && <p className="absolute bottom-2 left-2 z-50 rounded bg-cc-surface p-2 text-xs text-cc-error" role="alert">{instanceError}</p>}{context?.runtime && <ViewerOverlays runtime={context.runtime} peers={(context.client.room?.participants ?? []).filter((peer) => peer.id !== context.client.connectionId)} comments={context.client.room?.comments ?? []} onComment={() => { context.setOpen(true); context.setTab("comments"); }}/>}</>;
}

function SessionCollaborationPanel() {
  const context = useSessionCollaboration()!;
  const { status, client, pending, tab } = context;
  const runtimeState = useSyncExternalStore(context.runtime?.subscribe ?? noSubscribe, context.runtime?.current ?? emptyRuntime, context.runtime?.current ?? emptyRuntime);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [cloud, setCloud] = useState(false);
  const [origin, setOrigin] = useState("");
  const [bootstrapKey, setBootstrapKey] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmProjectName, setConfirmProjectName] = useState("");
  const [removingProject, setRemovingProject] = useState(false);
  const removalOperation = useRef<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const registrationError = useStore((state) => state.viewerInstanceError);
  const modeName = useStore((state) => state.modeManifest?.displayName);
  const peers = (client.room?.participants ?? []).filter((peer) => peer.id !== client.connectionId);
  const run = (path: string, body?: unknown) => { void context.command(path, body).catch(() => {}); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") context.setOpen(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [context.setOpen]);
  useEffect(() => {
    const mark = () => client.setVisibleDiscussion(client.selectedId, document.visibilityState === "visible" && document.hasFocus() && (tab === "chat" || tab === "comments") ? tab : null);
    mark(); window.addEventListener("focus", mark); window.addEventListener("blur", mark); document.addEventListener("visibilitychange", mark);
    return () => { client.setVisibleDiscussion(client.selectedId, null); window.removeEventListener("focus", mark); window.removeEventListener("blur", mark); document.removeEventListener("visibilitychange", mark); };
  }, [tab, client.selectedId, client.setVisibleDiscussion]);
  const share = () => {
    const state = useStore.getState();
    run("share", { title: state.activeContentSet || (typeof modeName === "string" ? modeName : state.modeManifest?.name) || "Workspace", contentSet: state.activeContentSet, activeFile: state.activeFile });
  };
  const room = client.room?.room;
  const canForward = !!room && !!client.project && !!status?.sharing && context.sharedView && status.roomId === room.id && client.selectedId === room.id && isCollaborationHost(client.project.self, room) && !!useStore.getState().sessionId;
  const forward = (item: Parameters<typeof createCommentFeedback>[0]["comment"] | Parameters<typeof createChatFeedback>[0]["message"], kind: "comment" | "chat") => {
    const state = useStore.getState();
    if (!canForward || !room || !client.project || !state.sessionId) return;
    const source = { sessionId: state.sessionId, projectId: client.project.project.id, room, contentSet: status?.sharedContentSet ?? null };
    const attachment = kind === "comment" ? createCommentFeedback({ ...source, comment: item as Parameters<typeof createCommentFeedback>[0]["comment"] }) : createChatFeedback({ ...source, message: item as Parameters<typeof createChatFeedback>[0]["message"] });
    if (!state.stageCollaborationFeedback(attachment)) return;
    if (state.tornOff) state.restoreFromTearOff();
    state.expandSurface();
    context.setOpen(false);
  };

  const projectRemoved = !!status?.projectRemoved || client.projectRemoved;
  const removeProject = async () => {
    if (removingProject || projectRemoved || client.project?.self.role !== "admin" || confirmProjectName !== client.project.project.name) return;
    setRemovingProject(true); setNotice("");
    removalOperation.current ??= createPrivateViewerInstanceId();
    try { await client.removeProject(removalOperation.current); setNotice("Shared project removed. Your local files and private Agent remain available."); }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : "Shared access removal is unconfirmed. Retry the same removal."); }
    finally { setRemovingProject(false); }
  };
  const panelError = context.error || status?.error || registrationError;
  const internetError = status?.internetAccess?.error?.replace(/^Error: /, "");
  return <section ref={panelRef} className="session-collaboration" aria-label="Project collaboration">
    <header><h2>{client.project?.project.name || "Project collaboration"}</h2><button type="button" aria-label="Close collaboration" onClick={() => context.setOpen(false)}>Close</button></header>
    <nav className="session-collaboration-tabs" aria-label="Collaboration panels">{(["project", "references", "comments", "chat", "links", "members"] as const).filter((item) => item === "project" || item === "references" && !!status?.connection || item === "comments" && !!room || item === "chat" && !!room || item === "links" && !!room && mutationAvailable(client.project?.self, client.status) || item === "members" && client.project?.self.role === "admin").map((item) => <button key={item} type="button" aria-pressed={tab === item} onClick={() => context.setTab(item)}>{item[0].toUpperCase() + item.slice(1)}{item === "comments" || item === "chat" ? client.unread[client.selectedId]?.[item] ? ` (${client.unread[client.selectedId]![item]})` : "" : ""}</button>)}</nav>
    {panelError && panelError !== internetError && <p className="inline-error" role="alert">{panelError}</p>}
    {notice && <p className="inline-error" role="status">{notice}</p>}
    {context.referenceRecoveryError && tab !== "references" && <p className="inline-error" role="alert">{context.referenceRecoveryError}</p>}
    {tab === "project" && <div className="panel-content">
      <CollaborationSetupEntry/>
      {!status?.projectAvailable ? <p>Open a Project Session to connect collaboration across your workspaces.</p> : !status.connection ? <>
        <p>Connect this Project to share work and keep your Agent conversation private.</p>
        <form onSubmit={(event) => { event.preventDefault(); const body: CreateSessionCollaboration = { name: name.trim(), ...(cloud ? { authority: { kind: "cloud", origin: origin.trim() }, bootstrapKey } : {}) }; run("create", body); }}>
          <label className="field-label">Your name<input autoComplete="name" required value={name} maxLength={80} onChange={(event) => setName(event.target.value)}/></label>
          <div className="duration-picker" role="group" aria-label="Collaboration hosting"><button type="button" aria-pressed={!cloud} className={!cloud ? "selected" : ""} onClick={() => setCloud(false)}>Local network</button><button type="button" aria-pressed={cloud} className={cloud ? "selected" : ""} onClick={() => setCloud(true)}>Cloud host</button></div>
          {cloud && <><label className="field-label">Cloud host URL<input type="url" required value={origin} placeholder="https://collaboration.example.com" onChange={(event) => setOrigin(event.target.value)}/></label><label className="field-label">Provisioning key<input type="password" required autoComplete="off" value={bootstrapKey} onChange={(event) => setBootstrapKey(event.target.value)}/></label></>}
          <button className="button primary" type="submit" disabled={pending || !name.trim()}>{pending ? "Connecting…" : "Create collaboration"}</button>
        </form>
        <form className="connect-member" onSubmit={(event) => { event.preventDefault(); run("connect", { url: link.trim() }); }}><label className="field-label">Member invitation link<input type="url" required value={link} placeholder="Paste your Project member link" onChange={(event) => setLink(event.target.value)}/></label><button type="submit" className="button" disabled={pending || !link.trim()}>Connect to Project</button></form>
      </> : <>
        <div className="session-sharing"><p>{projectRemoved ? "Shared project removed. Your local files and private Agent remain available." : status.sharing ? context.sharedView ? "This viewer is shared while this Session tab stays open." : `Sharing ${status.sharedContentSet || "the root site"}; this view is private.` : status.supported ? "Share the current workspace through this viewer." : "This mode does not support shared viewing yet. You can open other Project rooms."}</p>{!projectRemoved && status.sharing && !context.sharedView && <button className="button" onClick={() => useStore.getState().setActiveContentSet(status.sharedContentSet ?? null)}>Return to shared view</button>}<button className={`button ${status.sharing ? "" : "primary"}`} disabled={pending || !status.supported || projectRemoved} onClick={status.sharing ? () => run("stop") : share}>{pending ? "Working…" : projectRemoved ? "Sharing unavailable" : status.sharing ? "Stop sharing" : "Share this workspace"}</button><span className="muted">{projectRemoved ? "Shared project removed" : status.publisherStatus}</span></div>
        {!projectRemoved && <InternetAccessPanel status={status} pending={pending} command={context.command}/>}
        <form className="connect-member" onSubmit={(event) => { event.preventDefault(); run("connect", { url: link.trim() }); }}><label className="field-label">Reconnect with the current Project URL or member link<input type="url" required value={link} placeholder="Paste the current Project URL when the public address changes" onChange={(event) => setLink(event.target.value)}/></label><button type="submit" className="button" disabled={pending || !link.trim()}>Reconnect to Project</button></form>
        {client.error && <p className="inline-error" role="status">{client.error}</p>}
        {!projectRemoved && !status.sharing && status.roomId && <div className="danger-zone"><h3>Remove sharing registration</h3><p>Remove the old room before sharing a different site or viewer build. Its shared links and pinned references will become unavailable.</p><button className="button danger" disabled={pending} onClick={() => run("remove")}>Remove sharing registration</button></div>}
        <h3>Shared workspaces</h3>
        <div className="room-list">{client.project?.rooms.map((item) => <div key={item.id} className="shared-room-card"><button type="button" className="room-item" disabled={!item.enabled || item.hostOnline === false} onClick={() => window.open(shareUrl(status.connection!.token, item.id, { publicOrigin: status.connection!.authorityBaseUrl }), "_blank", "noopener,noreferrer")}><strong>{item.title}</strong><small>{item.mode} · {item.hostOnline === false ? "Host offline" : item.enabled ? "Open workspace" : "Sharing off"}</small></button>{!pending && !context.referenceRecoveryError && <PinRoomButton operationAuthority={status.connection!.referenceOperationAuthority} client={client} destinationWorkspaceId={status.connection!.workspaceId} room={item} onPinned={() => context.setTab("references")}/>}</div>)}{!client.project?.rooms.length && <p className="muted">Shared workspaces will appear here.</p>}</div>
        {room && <><h3>People in this workspace</h3><div className="participant-list">{peers.map((peer) => <button type="button" className="button" key={peer.id} aria-pressed={runtimeState.followingId === peer.id} disabled={!context.runtime || !runtimeState.ready || !peer.semanticView || !!peer.followingId} onClick={() => context.runtime?.setFollowing(runtimeState.followingId === peer.id ? null : peer.id)}>{peer.name}</button>)}{!peers.length && <span className="muted">You have the workspace to yourself.</span>}</div>{runtimeState.followingId && <button className="text-button" onClick={() => context.runtime?.setFollowing(null)}>Stop following</button>}<button className="button" disabled={!context.sharedView || !discussionAvailable(client.project?.self, client.status)} onClick={context.startComment}>Add comment to selection</button></>}
        {!projectRemoved && client.project?.self.role === "admin" && <form className="danger-zone" onSubmit={(event) => { event.preventDefault(); void removeProject(); }}><h3>Remove shared project</h3><p>Disable this Project's shared rooms, links, and references for everyone. Local files and private Agent sessions remain. Shared access cannot be restored by reopening a Session.</p><label className="field-label">Type {client.project.project.name} to confirm<input value={confirmProjectName} onChange={(event) => setConfirmProjectName(event.target.value)}/></label><button className="button danger" disabled={pending || removingProject || confirmProjectName !== client.project.project.name} type="submit">{removingProject ? "Removing shared access…" : removalOperation.current ? "Retry removing shared project" : "Remove shared project"}</button></form>}
      </>}
    </div>}
    {tab === "references" && status?.connection && (context.referenceRecoveryError ? <div className="panel-content"><p role="alert">{context.referenceRecoveryError}</p></div> : pending ? <div className="panel-content"><p role="status">Updating Project connection… References will be available when this finishes.</p></div> : <ReferencesPanel key={`${client.baseUrl}:${status.connection.workspaceId}`} client={client} operationAuthority={status.connection.referenceOperationAuthority} destinationWorkspaceId={status.connection.workspaceId}/>)}
    {tab === "comments" && room && <Comments client={client} onForwardComment={canForward ? (comment) => forward(comment, "comment") : undefined} writable={discussionAvailable(client.project?.self, client.status)} canResolve={mutationAvailable(client.project?.self, client.status)} draftAnchor={context.draft} onCancelDraft={context.clearDraft} onStart={context.startComment} onLocate={(anchor) => {
      if (!context.runtime) { setNotice("Return to the shared view before opening this comment's location."); return; }
      void context.runtime.navigateAnchor(anchor).then((result) => { if (!result.success) setNotice(result.message || "The comment's location could not be reached"); });
    }}/>} 
    {tab === "chat" && room && <Chat client={client} onForwardMessage={canForward ? (message) => forward(message, "chat") : undefined} writable={discussionAvailable(client.project?.self, client.status)}/>} 
    {tab === "links" && room && <SharePanel client={client} room={room} entries={status?.entries}/>} 
    {tab === "members" && client.project?.self.role === "admin" && <MembersPanel client={client} entries={status?.entries}/>} 
  </section>;
}

const EMPTY_RUNTIME: ViewerRuntimeSnapshot = { ready: false, followingId: null, error: "", pointers: {}, anchors: {} };
const emptyRuntime = () => EMPTY_RUNTIME;
const noSubscribe = () => () => {};
