import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { canDiscussCollaboration, canManageCollaborationRoom, canWriteCollaboration, type CollaborationAnchor, type CollaborationChatMessage, type CollaborationComment, type CollaborationGuestLink, type CollaborationIdentity, type CollaborationInvite, type CollaborationMember, type CollaborationRole, type CollaborationRoom, type CollaborationView } from "../../core/types/collaboration.js";
import { canApplyView, createOperationId, discussionAvailable, initials, mutationAvailable, safePageUrl, shareUrl, validAnchor, validView } from "./client-state.js";
import { useCollaboration } from "./use-collaboration.js";
import { PublishedViewer } from "./PublishedViewer.js";
import type { ViewerCollaborationRuntime } from "./viewer-runtime.js";

import type { SessionCollaborationStatus } from "../../core/types/collaboration-session.js";
import { EntryLink } from "./EntryLink.js";
import { CommentReference } from "./CommentReference.js";

type Client = ReturnType<typeof useCollaboration>;
type IconName = "grid" | "arrow" | "link" | "chat" | "comment" | "code" | "people" | "close" | "check" | "eye" | "refresh" | "plus";
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
    link: <><path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-1 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></>,
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/>,
    comment: <><path d="M20 15a3 3 0 0 1-3 3H9l-5 4V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z"/><path d="M8 8h8M8 12h5"/></>,
    code: <><path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18"/></>,
    people: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 5a5 5 0 0 1 3 4v2"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    refresh: <><path d="M20 7a9 9 0 1 0 1 9M20 2v5h-5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Avatar({ name, color, small }: { name: string; color?: string; small?: boolean }) {
  return <span className={`avatar${small ? " avatar-small" : ""}`} style={color ? { "--avatar-color": color } as CSSProperties : undefined}>{initials(name)}</span>;
}

function RolePicker({ value, onChange, disabled }: { value: CollaborationRole; onChange: (role: CollaborationRole) => void; disabled?: boolean }) {
  return <div className="role-picker" role="group" aria-label="Permission role">{(["reader", "writer", "admin"] as const).map((role) => <button key={role} type="button" disabled={disabled} className={value === role ? "selected" : ""} aria-pressed={value === role} onClick={() => onChange(role)}>{role}</button>)}</div>;
}

export function RoomActions({ self, room, enabled, commenting, canEditSource = true, onComment, onSource, onShare, onToggle }: {
  self: CollaborationIdentity; room: CollaborationRoom; enabled: boolean; commenting: boolean;
  canEditSource?: boolean;
  onComment: () => void; onSource: () => void; onShare: () => void; onToggle: () => void;
}) {
  return <div className="room-actions">
    {canDiscussCollaboration(self) && <button className={`button ${commenting ? "active" : ""}`} disabled={!enabled || !room.enabled} aria-pressed={commenting} onClick={onComment}><Icon name="comment"/>Add comment</button>}
    {canWriteCollaboration(self) && canEditSource && <button className="button quiet" disabled={!enabled} onClick={onSource}><Icon name="code"/>Source</button>}
    {canManageCollaborationRoom(self, room) && <>
      <button className="button quiet" disabled={!enabled} onClick={onShare}><Icon name="link"/>Share</button>
      <button className={`live-switch ${room.enabled ? "is-live" : ""}`} disabled={!enabled} role="switch" aria-checked={room.enabled} aria-label="Room collaboration" onClick={onToggle}><span className="switch-track"><span/></span>{room.enabled ? "Live" : "Off"}</button>
    </>}
    {!canDiscussCollaboration(self) && <span className="readonly-label"><Icon name="eye" size={15}/>Read only</span>}
  </div>;
}

export function CollaborationApp({ token, initialRoom, baseUrl = "" }: { token: string; initialRoom: string; baseUrl?: string }) {
  const client = useCollaboration(token, initialRoom, { baseUrl });
  const publishedRuntime = useRef<ViewerCollaborationRuntime | null>(null);
  const { project, room, selectedId, status } = client;
  const [tab, setTab] = useState<"comments" | "chat">("comments");
  const [panel, setPanel] = useState<"source" | "share" | "members" | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [draftAnchor, setDraftAnchor] = useState<CollaborationAnchor | null>(null);
  const [followingId, setFollowingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [frameReady, setFrameReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const discussionPane = useRef<HTMLElement>(null);
  const [discussionOnscreen, setDiscussionOnscreen] = useState(false);
  const [documentActive, setDocumentActive] = useState(() => document.visibilityState === "visible" && document.hasFocus());
  const originalTitle = useRef(document.title);
  const [size, setSize] = useState({ width: 1200, height: 760 });
  const viewRef = useRef<CollaborationView | null>(null);
  const savedViews = useRef(new Map<string, CollaborationView>());
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ room, followingId, commenting, self: project?.self, status, connectionId: client.connectionId });
  latest.current = { room, followingId, commenting, self: project?.self, status, connectionId: client.connectionId };
  const pendingPresence = useRef(false);
  const rafId = useRef(0);
  const lastPresenceAt = useRef(0);
  const appliedFollow = useRef("");

  const postFrame = useCallback((message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ channel: "pneuma-collab-host", ...message }, "*");
  }, []);

  const queuePresence = useCallback(() => {
    pendingPresence.current = true;
    if (rafId.current) return;
    const flush = (now: number) => {
      if (!pendingPresence.current) { rafId.current = 0; return; }
      if (now - lastPresenceAt.current < 1000 / 30) { rafId.current = requestAnimationFrame(flush); return; }
      rafId.current = 0;
      pendingPresence.current = false;
      lastPresenceAt.current = now;
      const current = latest.current;
      if (viewRef.current && current.status === "connected" && canApplyView(viewRef.current, current.room)) {
        client.send({ type: "presence", view: viewRef.current, cursor: cursorRef.current, followingId: current.followingId, sentAt: Date.now() });
      }
    };
    rafId.current = requestAnimationFrame(flush);
  }, [client.send]);

  const configureFrame = useCallback(() => {
    const current = latest.current;
    if (!current.room) return;
    const own = savedViews.current.get(current.room.room.id);
    postFrame({ type: "configure", revision: current.room.room.revision, page: current.room.room.page,
      commenting: current.commenting && discussionAvailable(current.self, current.status),
      ...(own ? { restoreView: { ...own, revision: current.room.room.revision } } : {}),
    });
    postFrame({ type: "overlays", participants: current.room.participants.filter((person) => person.id !== current.connectionId), comments: current.room.comments, selfId: current.connectionId });
    const leader = current.room.participants.find((person) => person.id === current.followingId);
    if (leader?.view && canApplyView(leader.view, current.room)) postFrame({ type: "follow", view: leader.view });
  }, [postFrame]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow || event.data?.channel !== "pneuma-collab-frame") return;
      const data = event.data;
      const current = latest.current;
      if (!current.room) return;
      if (data.type === "ready") { setFrameReady(true); configureFrame(); return; }
      if (data.type === "view" && validView(data.view) && canApplyView(data.view, current.room)) {
        if (current.followingId) return;
        viewRef.current = data.view;
        savedViews.current.set(current.room.room.id, data.view);
        queuePresence();
      } else if (data.type === "cursor") {
        const point = data.cursor;
        if (point === null || (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 1e8 && Math.abs(point.y) < 1e8)) {
          cursorRef.current = point;
          queuePresence();
        }
      } else if (data.type === "anchor" && current.commenting && discussionAvailable(current.self, current.status) && validAnchor(data.anchor) && data.anchor.revision === current.room.room.revision) {
        setDraftAnchor(data.anchor);
        setTab("comments");
        setCommenting(false);
      } else if (data.type === "thread" && typeof data.commentId === "string") {
        const comment = current.room.comments.find((item) => item.id === data.commentId);
        if (comment) {
          setTab("comments");
          requestAnimationFrame(() => document.getElementById(`thread-${comment.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
        }
      } else if (data.type === "interact" && current.followingId) {
        latest.current.followingId = null;
        setFollowingId(null);
        setNotice("You are browsing independently.");
        queuePresence();
      }
    };
    window.addEventListener("message", onMessage);
    return () => { window.removeEventListener("message", onMessage); cancelAnimationFrame(rafId.current); };
  }, [configureFrame, queuePresence]);

  useEffect(() => {
    setPanel(null); setCommenting(false); setDraftAnchor(null); setFollowingId(null); setFrameReady(false); setNotice("");
    viewRef.current = savedViews.current.get(selectedId) || null;
    cursorRef.current = null;
  }, [selectedId]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [!!project, !!room]);
  useEffect(() => { setFrameReady(false); }, [room?.pageUrl, room?.room.revision]);
  useEffect(() => {
    if (!frameReady) return;
    const current = latest.current;
    if (!current.room) return;
    postFrame({ type: "configure", revision: current.room.room.revision, page: current.room.room.page, commenting: commenting && discussionAvailable(current.self, status) });
  }, [commenting, project?.self.role, project?.self.guestAccess, status, frameReady, postFrame]);
  useEffect(() => {
    if (room && frameReady) postFrame({ type: "overlays", participants: status === "connected" ? room.participants.filter((person) => person.id !== client.connectionId) : [], comments: room.comments, selfId: client.connectionId });
  }, [room?.participants, room?.comments, frameReady, status, client.connectionId, postFrame]);
  useEffect(() => {
    if (!followingId || !room || room.room.compatibility) { appliedFollow.current = ""; return; }
    const leader = room.participants.find((person) => person.id === followingId);
    if (!leader || leader.followingId || status !== "connected") { setFollowingId(null); setNotice("Following ended. You are browsing independently."); return; }
    if (leader.view && canApplyView(leader.view, room)) {
      const signature = JSON.stringify([leader.id, leader.view, frameReady]);
      if (appliedFollow.current === signature) return;
      appliedFollow.current = signature;
      postFrame({ type: "follow", view: leader.view });
      viewRef.current = leader.view;
      queuePresence();
    }
  }, [followingId, room?.participants, room?.room.revision, status, frameReady, postFrame, queuePresence]);
  useEffect(() => {
    if (!discussionAvailable(project?.self, status)) { setCommenting(false); setDraftAnchor(null); }
    if (!mutationAvailable(project?.self, status) && (panel === "source" || panel === "share")) setPanel(null);
    if (project?.capabilities?.editSource === false && panel === "source") setPanel(null);
    if (project?.self.role !== "admin" && panel === "members") setPanel(null);
  }, [project?.self.role, project?.self.guestAccess, project?.capabilities?.editSource, status, panel]);

  useEffect(() => {
    const update = () => setDocumentActive(document.visibilityState === "visible" && document.hasFocus());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", update); window.removeEventListener("blur", update); };
  }, []);
  useEffect(() => {
    const element = discussionPane.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setDiscussionOnscreen(!!entry?.isIntersecting && entry.intersectionRatio >= .25), { threshold: [0, .25] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [!!project]);
  useEffect(() => {
    const canSeeChat = project?.self.kind === "member" || project?.self.guestAccess === "comment";
    const activeTab = tab === "chat" && !canSeeChat ? "comments" : tab;
    client.setVisibleDiscussion(selectedId, room && documentActive && discussionOnscreen && !panel ? activeTab : null);
    return () => client.setVisibleDiscussion(selectedId, null);
  }, [selectedId, !!room, documentActive, discussionOnscreen, panel, tab, project?.self.kind, project?.self.guestAccess, client.setVisibleDiscussion]);
  useEffect(() => {
    const total = Object.values(client.unread).reduce((sum, counts) => sum + counts.chat + counts.comments, 0);
    document.title = `${total ? `(${total}) ` : ""}${project?.project.name || "Collaboration"} · Pneuma`;
  }, [client.unread, project?.project.name]);
  useEffect(() => () => { document.title = originalTitle.current; }, []);

  const doToggle = async (target: CollaborationRoom) => {
    try {
      await client.request(`/api/rooms/${encodeURIComponent(target.id)}`, { method: "PATCH", body: { enabled: !target.enabled } });
    } catch (error) { client.setError(error instanceof Error ? error.message : "Unable to change sharing."); }
  };

  if (client.projectRemoved) return <Welcome title="Shared project removed" text="Shared access to this Project has ended. Its shared rooms, links, and references are unavailable. Local files and private Agent sessions remain with their owners."/>;
  if (!token) return <Welcome title="Join a shared workspace" text="Open the invitation link from your project administrator. Your access stays in this browser tab."/>;
  if (client.hostOffline && !project) return <Welcome title="The host is offline" text="This workspace is available while the host is online. Rejoin when they return; your invitation is saved in this tab." action={<button className="button" onClick={client.reconnect}><Icon name="refresh"/>Rejoin</button>}/>;
  if (!project) return <Welcome title={status === "closed" ? "This invitation is unavailable" : "Connecting to your project"} text={client.error || "Loading the latest shared state…"} action={<button className="button" onClick={client.reconnect}><Icon name="refresh"/>Try again</button>}/>;

  const self = project.self;
  const guest = self.kind === "guest";
  const guestCanDiscuss = guest && canDiscussCollaboration(self);
  const canSeeChat = !guest || guestCanDiscuss;
  const selectedRoom = project.rooms.find((item) => item.id === selectedId);
  const displayRoom = room?.room || selectedRoom;
  const writable = mutationAvailable(self, status);
  const discussable = discussionAvailable(self, status);
  const unread = client.unread[selectedId] || { comments: 0, chat: 0 };
  const peers = room?.participants.filter((person) => person.id !== client.connectionId) || [];
  const leader = peers.find((person) => person.id === followingId);
  const pageUrl = room ? safePageUrl(room.pageUrl, location.origin, project.publicOrigin) : null;
  const scale = Math.max(0.1, Math.min(1, size.width / 1200));

  return <div className={`collab-app${guest ? " is-guest" : ""}`}>
    {!guest && <aside className="project-rail">
      <div className="brand"><span className="brand-mark"><Icon name="grid" size={20}/></span><span>Pneuma<span className="brand-version">Collaboration Beta</span></span></div>
      <div className="project-name"><span className="project-monogram">{initials(project.project.name)}</span><div><strong>{project.project.name}</strong><span>Shared project</span></div></div>
      <div className="rail-heading"><span>Workspaces</span><span>{project.rooms.length}</span></div>
      <nav aria-label="Project workspaces" className="room-list">{project.rooms.map((item) => <button key={item.id} className={`room-item ${item.id === selectedId ? "selected" : ""}`} onClick={() => client.selectRoom(item.id)} aria-current={item.id === selectedId ? "page" : undefined}>
        <span className="room-icon"><Icon name="code" size={17}/></span><span><strong>{item.title}</strong><small>{item.mode} · {project.members.find((member) => member.id === item.ownerId)?.name || "Shared workspace"}</small></span>{(client.unread[item.id]?.chat || client.unread[item.id]?.comments) ? <UnreadBadge count={(client.unread[item.id]?.chat || 0) + (client.unread[item.id]?.comments || 0)}/> : <span className={`status-dot ${item.enabled ? "live" : ""}`} title={item.enabled ? "Sharing enabled" : "Sharing off"}/>}
      </button>)}</nav>
      <div className="rail-bottom">
        <div className="private-note"><Icon name="eye" size={16}/><span>Agent conversations stay private.</span></div>
        {self.role === "admin" && <button className="button rail-manage" onClick={() => setPanel(panel === "members" ? null : "members")}><Icon name="people"/>Manage members<span>{project.members.length}</span></button>}
        <div className="self-row"><Avatar name={self.name}/><div><strong>{self.name}</strong><span>{self.role}</span></div><span className="you-label">You</span></div>
      </div>
    </aside>}
    <main className="room-main">
      {!guest && <div className="mobile-projectbar"><nav aria-label="Project workspaces">{project.rooms.map((item) => <button key={item.id} aria-current={item.id === selectedId ? "page" : undefined} className={item.id === selectedId ? "selected" : ""} onClick={() => client.selectRoom(item.id)}>{item.title}</button>)}</nav>{self.role === "admin" && <button className="icon-button" aria-label="Manage members" onClick={() => setPanel("members")}><Icon name="people"/></button>}</div>}
      <header className="room-header">
        <div className="room-heading">{guest && <span className="brand-mark"><Icon name="grid"/></span>}<div><h1>{displayRoom?.title || "Choose a workspace"}</h1><div className="room-subtitle"><span>Beta</span><span className="separator">/</span><span>{guest ? "Shared preview" : displayRoom?.mode || "Project collaboration"}</span>{displayRoom && <><span className="separator">/</span><span>Revision {displayRoom.revision}</span></>}</div></div></div>
        {displayRoom && <RoomActions self={self} room={displayRoom} enabled={status === "connected"} commenting={commenting} canEditSource={project.capabilities?.editSource !== false} onComment={() => { setCommenting((value) => !value); setTab("comments"); }} onSource={() => setPanel(panel === "source" ? null : "source")} onShare={() => setPanel(panel === "share" ? null : "share")} onToggle={() => void doToggle(displayRoom)}/>}
      </header>
      <div className="presence-bar">
        <div className="participant-list"><span className="participant-self"><Avatar name={self.name} small/><span>You{guest ? " · guest" : ""}</span></span>{peers.map((person) => <button key={person.id} className={`participant ${person.id === followingId ? "following" : ""}`} disabled={!!person.followingId || status !== "connected" || !(person.view || person.semanticView)} onClick={() => { setFollowingId(followingId === person.id ? null : person.id); setNotice(""); }} title={person.followingId ? `${person.name} is following someone` : `Follow ${person.name}`} aria-pressed={person.id === followingId}><Avatar name={person.name} color={person.color} small/><span>{person.name}</span>{person.id === followingId && <Icon name="eye" size={13}/>}</button>)}{!peers.length && <span className="alone-note">You have the room to yourself</span>}</div>
        <div className="transport"><span className={`status-dot ${status === "connected" ? "live" : ""}`}/><span>{status === "connected" ? "Connected" : status === "closed" ? "Access closed" : "Reconnecting"}</span><span className="rtt" title="WebSocket ping round-trip time. This is transport latency, not end-to-end rendering latency.">{client.rtt === null ? "—" : `${client.rtt} ms`} RTT</span></div>
      </div>
      {(client.error || status === "reconnecting" || status === "closed") && <div className="connection-banner" role="alert"><span>{client.error || "Connection interrupted. Showing the last received revision; changes are disabled until reconnect."}</span><button onClick={client.reconnect}>Reconnect</button></div>}
      {displayRoom?.hostOnline === false && self.id === displayRoom.ownerId && <div className="host-offline-banner" role="status"><span className="status-dot"/><span>Guests can join only while the host is connected. Keep this host window open.</span></div>}
      {followingId && <div className="follow-banner"><Icon name="eye" size={15}/><span>{leader?.view && !canApplyView(leader.view, room) ? `Waiting for ${leader.name}’s revision…` : `Following ${leader?.name || "participant"}`}</span><span className="follow-hint">Click or scroll in the page to browse independently</span><button onClick={() => { setFollowingId(null); queuePresence(); }}>Stop following</button></div>}
      {commenting && <div className="comment-banner"><Icon name="comment" size={15}/><span>Click an element in the page to leave a comment.</span><button onClick={() => setCommenting(false)}>Cancel</button></div>}
      {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice("")}><Icon name="close" size={13}/></button></div>}
      <div className="room-body">
        <section className="viewer-pane" aria-label="Shared page">
          <div className="viewer-address"><Icon name="code" size={14}/><span>{displayRoom?.page || "No page selected"}</span><span className="viewport-label">1200 px</span>{room && <span className="revision-label">r{room.room.revision}</span>}</div>
          <div className="viewer-stage" ref={stage}>
            {room?.room.compatibility && room.room.enabled && status !== "closed" ? <PublishedViewer client={client} commenting={commenting} followingId={followingId} onFollowingChange={setFollowingId} runtimeRef={publishedRuntime} onSelect={(anchor) => { setDraftAnchor(anchor); setTab("comments"); setCommenting(false); }} onComment={(id) => { setTab("comments"); document.getElementById(`thread-${id}`)?.scrollIntoView({ block: "nearest" }); }}/> : room && pageUrl && room.room.enabled && status !== "closed" ? <>
              <iframe key={`${room.room.id}:${room.room.revision}:${room.pageUrl}`} ref={frame} title={`${room.room.title} shared page`} src={pageUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" aria-busy={!frameReady} onLoad={configureFrame} style={{ width: 1200, height: Math.max(200, Math.floor(size.height / scale)), transform: `scale(${scale})` }}/>
              {!frameReady && <div className="frame-loading"><span className="loading-dot"/>Loading shared page…</div>}
            </> : <div className="viewer-empty"><Icon name={displayRoom?.enabled === false ? "eye" : "grid"} size={32}/><h2>{status === "closed" ? "Access to this room has ended" : displayRoom?.enabled === false ? "Collaboration is off" : client.error ? "Workspace unavailable" : "Opening workspace…"}</h2><p>{displayRoom?.enabled === false ? "The owner can turn on live collaboration from the toolbar." : status === "closed" ? "Ask the owner for a new invitation to continue." : "The latest page will appear here once the host responds."}</p></div>}
          </div>
          <footer className="viewer-footer"><span><span className={`status-dot ${status === "connected" && displayRoom?.hostOnline !== false ? "live" : ""}`}/>{displayRoom?.hostOnline === false ? "Host offline · saved revision" : status === "connected" ? "Live workspace" : "Last received state"}</span><span>{guest ? guestCanDiscuss ? "Guest access · comments & chat" : "Guest access · view only" : "Private agent sessions · shared results"}</span></footer>
        </section>
        <aside className="discussion-pane" aria-label="Workspace discussion" ref={discussionPane}>
          <div className="discussion-tabs" role="tablist" aria-label="Discussion"><button role="tab" aria-selected={tab === "comments" || !canSeeChat} className={tab === "comments" || !canSeeChat ? "selected" : ""} onClick={() => setTab("comments")}><Icon name="comment" size={16}/>Comments{unread.comments ? <UnreadBadge count={unread.comments}/> : <span>{room?.comments.filter((comment) => comment.status === "open").length || 0}</span>}</button>{canSeeChat && <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "selected" : ""} onClick={() => setTab("chat")}><Icon name="chat" size={16}/>Chat<UnreadBadge count={unread.chat}/></button>}</div>
          {tab === "comments" || !canSeeChat ? <Comments client={client} writable={discussable && !!room?.room.enabled} canResolve={writable && !!room?.room.enabled} draftAnchor={draftAnchor} onCancelDraft={() => setDraftAnchor(null)} onLocate={(anchor) => {
              if (room?.room.compatibility) {
                if (!publishedRuntime.current) { setNotice("The viewer is still loading. Try this location again when it is ready."); return; }
                void publishedRuntime.current.navigateAnchor(anchor).then((result) => { if (!result.success) setNotice(result.message || "This location could not be reached"); });
                return;
              }
              setFollowingId(null); postFrame({ type: "locate", anchor });
            }} onStart={() => setCommenting(true)}/> : <Chat client={client} writable={discussable && !!room?.room.enabled}/>}
        </aside>
      </div>
    </main>
    {panel && <section className="utility-panel" aria-label={panel === "source" ? "Edit page source" : panel === "members" ? "Project members" : "Share workspace"}>
      <div className="utility-heading"><h2>{panel === "source" ? "Page source" : panel === "members" ? "Project members" : "Share workspace"}</h2><button className="icon-button" aria-label="Close panel" onClick={() => setPanel(null)}><Icon name="close"/></button></div>
      {panel === "source" && displayRoom && writable && project.capabilities?.editSource !== false && <SourceEditor key={displayRoom.id} client={client} room={displayRoom}/>}
      {panel === "share" && displayRoom && canManageCollaborationRoom(self, displayRoom) && <SharePanel client={client} room={displayRoom}/>}
      {panel === "members" && self.role === "admin" && <MembersPanel client={client}/>}
    </section>}
  </div>;
}

function Welcome({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="welcome"><span className="brand-mark"><Icon name="grid" size={26}/></span><span className="brand-version">Collaboration Beta</span><h1>{title}</h1><p>{text}</p>{action}</div>;
}

function EmptyDiscussion({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <div className="empty-discussion"><Icon name={icon} size={28}/><h3>{title}</h3><p>{children}</p></div>;
}

function UnreadBadge({ count }: { count: number }) {
  return count > 0 ? <span className="unread-badge" aria-label={`${count} unread messages`}>{count > 99 ? "99+" : count}</span> : null;
}

function Composer({ label, placeholder, onSubmit, onCancel }: { label: string; placeholder: string; onSubmit: (text: string, opId: string) => Promise<void>; onCancel?: () => void }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<{ text: string; id: string } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || pending) return;
    setPending(true); setError("");
    const body = text.trim();
    const opId = operation.current?.text === body ? operation.current.id : createOperationId();
    operation.current = { text: body, id: opId };
    try { await onSubmit(body, opId); setText(""); operation.current = null; }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Message not sent. Your draft is preserved."); }
    finally { setPending(false); }
  };
  return <form className="composer" onSubmit={(event) => void submit(event)}><textarea aria-label={label} placeholder={placeholder} value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} disabled={pending}/>{error && <p className="inline-error" role="alert">{error}</p>}<div className="composer-actions">{onCancel && <button type="button" className="text-button" onClick={onCancel} disabled={pending}>Cancel</button>}<button className="button primary" disabled={!text.trim() || pending} type="submit">{pending ? "Sending…" : label}<Icon name="arrow" size={14}/></button></div></form>;
}

export function Comments({ client, writable, canResolve, draftAnchor, onCancelDraft, onLocate, onStart, onForwardComment }: { client: Client; writable: boolean; canResolve: boolean; draftAnchor: CollaborationAnchor | null; onCancelDraft: () => void; onLocate: (anchor: CollaborationAnchor) => void; onStart: () => void; onForwardComment?: (comment: CollaborationComment) => void }) {
  const [showResolved, setShowResolved] = useState(false);
  const { room } = client;
  const comments = room?.comments.filter((comment) => showResolved || comment.status === "open") || [];
  return <div className="discussion-content">
    {writable && <div className="comment-create"><button type="button" className="button" onClick={onStart}><Icon name="plus" size={14}/>Add comment</button><span>Hold Ctrl and click to comment</span></div>}
    <div className="discussion-filter"><span>{showResolved ? "All comments" : "Open comments"}</span><button aria-pressed={showResolved} onClick={() => setShowResolved((value) => !value)}>{showResolved ? "Hide resolved" : "Show resolved"}</button></div>
    <div className="thread-list">{draftAnchor && writable && room && <div className="new-thread"><span className="anchor-label"><Icon name="comment" size={14}/>New comment · revision {draftAnchor.revision}</span><CommentReference anchor={draftAnchor} onLocate={onLocate}/><Composer label="Post comment" placeholder="What would you change here?" onCancel={onCancelDraft} onSubmit={async (body, opId) => { await client.request(`/api/rooms/${encodeURIComponent(room.room.id)}/comments`, { method: "POST", body: { opId, anchor: draftAnchor, body } }); onCancelDraft(); }}/></div>}
      {comments.map((comment) => <CommentThread key={comment.id} comment={comment} client={client} writable={writable} canResolve={canResolve} onLocate={onLocate} onForwardComment={onForwardComment}/>)}
      {!comments.length && !draftAnchor && <EmptyDiscussion icon="comment" title="Start with a point of view">{writable ? <>Pin a comment to anything in the page.</> : "Comments about this workspace will appear here."}</EmptyDiscussion>}
    </div>
    {!writable && <div className="readonly-footnote"><Icon name="eye" size={13}/>You have read-only access.</div>}
  </div>;
}

export function CommentThread({ comment, client, writable, canResolve, onLocate, onForwardComment }: { comment: CollaborationComment; client: Client; writable: boolean; canResolve: boolean; onLocate: (anchor: CollaborationAnchor) => void; onForwardComment?: (comment: CollaborationComment) => void }) {
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const stale = comment.anchor.revision !== client.room?.room.revision;
  const path = `/api/rooms/${encodeURIComponent(comment.roomId)}/comments/${encodeURIComponent(comment.id)}`;
  const toggle = async () => {
    setPending(true); setError("");
    try { await client.request(path, { method: "PATCH", body: { opId: createOperationId(), status: comment.status === "open" ? "resolved" : "open" } }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to update comment."); }
    finally { setPending(false); }
  };
  return <article id={`thread-${comment.id}`} className={`comment-thread ${comment.status === "resolved" ? "resolved" : ""}`}>
    <CommentReference anchor={comment.anchor} onLocate={onLocate}/>
    {stale && <span className="stale-anchor">Pinned to revision {comment.anchor.revision} · location may have changed</span>}
    {comment.messages.map((message) => <div className="thread-message" key={message.id}><Avatar name={message.authorName} small/><div><div className="message-byline"><strong>{message.authorName}</strong><time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time></div><p>{message.body}</p></div></div>)}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {(writable || onForwardComment) && <div className="thread-actions">{writable && <button type="button" onClick={() => setReplying((value) => !value)}>{replying ? "Cancel reply" : "Reply"}</button>}{writable && canResolve && <button type="button" disabled={pending} onClick={() => void toggle()}><Icon name="check" size={13}/>{comment.status === "open" ? "Resolve" : "Reopen"}</button>}{onForwardComment && <button type="button" onClick={() => onForwardComment(comment)} title="Attach to your private AI composer"><Icon name="arrow" size={13}/>Send to AI</button>}</div>}
    {writable && replying && <Composer label="Reply" placeholder="Add to the conversation…" onSubmit={async (body, opId) => { await client.request(path, { method: "PATCH", body: { opId, body } }); setReplying(false); }}/>} 
  </article>;
}

export function Chat({ client, writable, onForwardMessage }: { client: Client; writable: boolean; onForwardMessage?: (message: CollaborationChatMessage) => void }) {
  const tail = useRef<HTMLDivElement>(null);
  const messages = client.room?.messages || [];
  useEffect(() => { tail.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);
  return <div className="discussion-content"><div className="chat-messages">{messages.map((message) => <div className="thread-message chat-message" key={message.id}><Avatar name={message.authorName} small/><div><div className="message-byline"><strong>{message.authorName}</strong><time>{formatTime(message.createdAt)}</time></div><p>{message.body}</p>{onForwardMessage && <div className="thread-actions chat-message-actions"><button type="button" onClick={() => onForwardMessage(message)} title="Attach to your private AI composer"><Icon name="arrow" size={13}/>Send to AI</button></div>}</div></div>)}{!messages.length && <EmptyDiscussion icon="chat" title="Talk it through">A shared conversation for everyone in this workspace.</EmptyDiscussion>}<div ref={tail}/></div>{writable && client.room ? <Composer label="Send" placeholder="Message this workspace…" onSubmit={async (body, opId) => { await client.request(`/api/rooms/${encodeURIComponent(client.room!.room.id)}/chat`, { method: "POST", body: { opId, body } }); }}/> : <div className="readonly-footnote"><Icon name="eye" size={13}/>You have read-only access.</div>}</div>;
}

function SourceEditor({ client, room }: { client: Client; room: CollaborationRoom }) {
  const [source, setSource] = useState<{ html: string; revision: number } | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const operation = useRef<{ html: string; revision: number; id: string } | null>(null);
  const load = useCallback(async () => {
    setError(""); setPending(true);
    try { const next = await client.request<{ html: string; revision: number }>(`/api/rooms/${encodeURIComponent(room.id)}/content`); setSource(next); setHtml(next.html); setSaved(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load source."); }
    finally { setPending(false); }
  }, [client.request, room.id]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!source) return;
    setPending(true); setError(""); setSaved(false);
    const previous = operation.current;
    const opId = previous?.html === html && previous.revision === source.revision ? previous.id : createOperationId();
    operation.current = { html, revision: source.revision, id: opId };
    try {
      const result = await client.request<{ revision: number }>(`/api/rooms/${encodeURIComponent(room.id)}/content`, { method: "PUT", body: { html, baseRevision: source.revision, opId } });
      setSource({ html, revision: result.revision }); setSaved(true); operation.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Save not confirmed. Your draft is preserved."); }
    finally { setPending(false); }
  };
  return <div className="source-panel"><p className="panel-description">Edit this page’s HTML. Saving publishes a new revision to everyone in the workspace.</p><div className="source-meta"><span>{room.page}</span><span>{source ? `Based on r${source.revision}` : "Loading…"}</span></div>{source && room.revision !== source.revision && <p className="warning">A newer revision is available. Your draft is preserved; reload before making a new edit.</p>}<textarea className="source-editor" aria-label="Page HTML source" spellCheck={false} value={html} onChange={(event) => { setHtml(event.target.value); setSaved(false); }} disabled={!source || pending}/>{error && <p className="inline-error" role="alert">{error}</p>}{saved && <p className="success" role="status">Published revision {source?.revision}.</p>}<div className="panel-actions"><button className="button quiet" onClick={() => void load()} disabled={pending}>Reload source</button><button className="button primary" disabled={!source || pending || html === source.html} onClick={() => void save()}>{pending ? "Working…" : "Publish changes"}</button></div></div>;
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return <div className="copy-link"><label>Invitation link<input ref={input} readOnly value={url} onFocus={(event) => event.target.select()}/></label><button className="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { input.current?.select(); setManual(true); } }}>{copied ? "Copied" : "Copy link"}</button>{manual && <p className="muted">Link selected. Copy it using your keyboard.</p>}</div>;
}

export function SharePanel({ client, room, entries }: { client: Client; room: CollaborationRoom; entries?: SessionCollaborationStatus["entries"] }) {
  const cloud = !!client.project?.publicOrigin;
  const [access, setAccess] = useState<"view" | "comment">("view");
  const [duration, setDuration] = useState(3600);
  const [link, setLink] = useState<CollaborationGuestLink | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const create = async () => {
    setPending(true); setError(""); setRevoked(false);
    try { setLink(await client.request<CollaborationGuestLink>(`/api/rooms/${encodeURIComponent(room.id)}/links`, { method: "POST", body: { expiresInSeconds: duration, access } })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to create link."); }
    finally { setPending(false); }
  };
  const revoke = async () => {
    setPending(true); setError("");
    try { await client.request(`/api/rooms/${encodeURIComponent(room.id)}/links`, { method: "DELETE" }); setLink(null); setRevoked(true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to revoke links."); }
    finally { setPending(false); }
  };
  return <div className="panel-content"><div className="sharing-summary"><Icon name="link" size={24}/><h3>A window into your work</h3><p>{cloud ? "Invite people to follow your work and join the discussion from their browser. They only see this workspace." : "Guests can view this workspace in their browser. They cannot edit, comment, chat, or browse the project."}</p></div>{cloud && <><label className="field-label">Guests can</label><div className="duration-picker" role="group" aria-label="Guest permissions"><button className={access === "comment" ? "selected" : ""} aria-pressed={access === "comment"} onClick={() => setAccess("comment")}>Comment & chat</button><button className={access === "view" ? "selected" : ""} aria-pressed={access === "view"} onClick={() => setAccess("view")}>View only</button></div><p className="role-description">{access === "comment" ? "View, follow, comment, and chat. Source files and project settings stay private." : "View and follow. Guests cannot write comments or messages."}</p></>}<label className="field-label">Link expires after</label><div className="duration-picker" role="group" aria-label="Guest link expiry">{[[900, "15 minutes"], [3600, "1 hour"], [86400, "24 hours"]].map(([seconds, label]) => <button key={seconds} className={duration === seconds ? "selected" : ""} aria-pressed={duration === seconds} onClick={() => setDuration(Number(seconds))}>{label}</button>)}</div><button className="button primary wide" disabled={pending || !room.enabled} onClick={() => void create()}><Icon name="link"/>{pending ? "Working…" : "Create guest link"}</button>{!room.enabled && <p className="warning">Turn on collaboration before sharing a link.</p>}{link && <><EntryLink token={link.token} roomId={room.id} invitation={cloud} entries={entries} fallback={client.baseUrl || client.project?.publicOrigin}/><p className="muted">{link.access === "comment" ? "Comments & chat" : "View only"} · Expires {new Date(link.expiresAt).toLocaleString()}.</p></>}{error && <p className="inline-error" role="alert">{error}</p>}{revoked && <p className="success" role="status">All guest links for this workspace have been revoked.</p>}<div className="danger-zone"><h3>Revoke guest access</h3><p>Immediately close access through every guest link for this workspace.</p><button className="button danger" disabled={pending} onClick={() => void revoke()}>Revoke all guest links</button></div></div>;
}

export function MembersPanel({ client, entries }: { client: Client; entries?: SessionCollaborationStatus["entries"] }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<CollaborationRole>("reader");
  const [invite, setInvite] = useState<CollaborationInvite | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const add = async (event: FormEvent) => {
    event.preventDefault(); if (!name.trim()) return;
    setPending(true); setError("");
    try { setInvite(await client.request<CollaborationInvite>("/api/members", { method: "POST", body: { name: name.trim(), role } })); setName(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to invite member."); }
    finally { setPending(false); }
  };
  return <div className="panel-content"><p className="panel-description">Members can join the project’s shared workspaces. Reader access is strictly read only.</p><div className="member-list">{client.project?.members.map((member) => <MemberRow key={member.id} client={client} member={member}/>)}</div><form className="invite-form" onSubmit={(event) => void add(event)}><h3>Invite a collaborator</h3><label className="field-label">Name<input placeholder="e.g. Alex Chen" value={name} maxLength={80} required onChange={(event) => setName(event.target.value)}/></label><RolePicker value={role} onChange={setRole}/><p className="role-description">{role === "reader" ? "View pages, comments, and conversations." : role === "writer" ? "Edit pages, write comments, and join conversations." : "Manage members and every workspace, including deletion."}</p><button type="submit" className="button primary wide" disabled={pending || !name.trim()}><Icon name="plus"/>{pending ? "Creating invitation…" : "Create invitation"}</button></form>{error && <p className="inline-error" role="alert">{error}</p>}{invite && <div className="invite-result"><p>Invitation for <strong>{invite.member.name}</strong> · {invite.member.role}</p><EntryLink token={invite.token} entries={entries} fallback={client.baseUrl || client.project?.publicOrigin}/></div>}</div>;
}

function MemberRow({ client, member }: { client: Client; member: CollaborationMember }) {
  const [pending, setPending] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [error, setError] = useState("");
  const change = async (role?: CollaborationRole) => {
    setPending(true); setError("");
    try { await client.request(`/api/members/${encodeURIComponent(member.id)}`, { method: role ? "PATCH" : "DELETE", ...(role ? { body: { role } } : {}) }); setConfirmRevoke(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to update member."); }
    finally { setPending(false); }
  };
  return <div className="member-row"><div className="member-name"><Avatar name={member.name} small/><strong>{member.name}</strong>{member.id === client.project?.self.id && <span className="you-label">You</span>}<button className="text-button danger-text" disabled={pending} onClick={() => setConfirmRevoke((value) => !value)}>{confirmRevoke ? "Cancel" : "Revoke"}</button></div><RolePicker value={member.role} disabled={pending} onChange={(role) => void change(role)}/>{confirmRevoke && <div className="revoke-confirm"><span>End {member.name}’s project access?</span><button className="button danger" disabled={pending} onClick={() => void change()}>Revoke access</button></div>}{error && <p className="inline-error" role="alert">{error}</p>}</div>;
}

function formatTime(timestamp: number): string { return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
