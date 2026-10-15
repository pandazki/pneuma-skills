import { useCallback, useEffect, useRef, useState } from "react";
import type { CollaborationClientMessage, CollaborationProjectState, CollaborationRoomState, CollaborationServerMessage } from "../../core/types/collaboration.js";
import type { ConnectionStatus } from "./client-state.js";
import { HOST_OFFLINE_MESSAGE, visibleRoomIds } from "./client-state.js";
import { UnreadTracker, type DiscussionChannel, type UnreadCounts } from "./unread.js";

export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function useCollaboration(token: string, initialRoom: string, options: { baseUrl?: string; updateHash?: boolean; selectDefault?: boolean } = {}) {
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  const updateHash = options.updateHash !== false;
  const selectDefault = options.selectDefault !== false;
  const [project, setProject] = useState<CollaborationProjectState | null>(null);
  const [room, setRoom] = useState<CollaborationRoomState | null>(null);
  const [selectedId, setSelectedId] = useState(initialRoom);
  const selectedRef = useRef(initialRoom);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [statusScope, setStatusScope] = useState({ token, baseUrl });
  const [error, setError] = useState("");
  const [hostOffline, setHostOffline] = useState(false);
  const [projectRemoved, setProjectRemoved] = useState(false);
  const stopForProjectRemoved = useRef<() => void>(() => {});
  const stopForHostOffline = useRef<() => void>(() => {});
  const [connectionId, setConnectionId] = useState("");
  const [rtt, setRtt] = useState<number | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [unread, setUnread] = useState<Record<string, UnreadCounts>>({});
  const unreadTracker = useRef<{ key: string; tracker: UnreadTracker } | null>(null);
  const visibleDiscussion = useRef<{ roomId: string; channel: DiscussionChannel | null }>({ roomId: "", channel: null });

  const syncUnread = useCallback(() => {
    const current = unreadTracker.current;
    if (!current) return;
    const counts = current.tracker.allCounts();
    setUnread((previous) => JSON.stringify(previous) === JSON.stringify(counts) ? previous : counts);
    try { sessionStorage.setItem(current.key, current.tracker.serialize()); }
    catch { /* In-memory notification state still survives reconnect when storage is full. */ }
  }, []);

  const setVisibleDiscussion = useCallback((roomId: string, channel: DiscussionChannel | null) => {
    const visible = document.visibilityState === "visible" && document.hasFocus() ? channel : null;
    visibleDiscussion.current = { roomId, channel: visible };
    if (visible) {
      unreadTracker.current?.tracker.markRead(roomId, visible);
      syncUnread();
    }
  }, [syncUnread]);

  const request = useCallback(async <T,>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: { Authorization: `Bearer ${token}`, ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 410 && data.code === "project_removed") {
      stopForProjectRemoved.current();
      throw new RequestError("Shared project removed. Your local files and private Agent remain available.", 410);
    }
    if (response.status === 423) {
      const selectedRoomPath = `/api/rooms/${encodeURIComponent(selectedRef.current)}`;
      if (path === "/api/state" || selectedRef.current && (path === selectedRoomPath || path.startsWith(`${selectedRoomPath}/`))) stopForHostOffline.current();
      throw new RequestError(HOST_OFFLINE_MESSAGE, 423);
    }
    if (!response.ok) throw new RequestError(data.error || data.message || `Request failed (${response.status}).`, response.status);
    return data as T;
  }, [token, baseUrl]);

  const send = useCallback((message: CollaborationClientMessage) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify(message));
    return true;
  }, []);

  const selectRoom = useCallback((id: string) => {
    if (id === selectedRef.current) return;
    selectedRef.current = id;
    setSelectedId(id);
    setRoom(null);
    setError("");
    const hash = new URLSearchParams(location.hash.slice(1));
    hash.set("room", id);
    if (updateHash) history.replaceState(null, "", `${location.pathname}${location.search}#${hash}`);
    if (hostOffline) { setHostOffline(false); setAttempt((value) => value + 1); return; }
    if (id && project?.rooms.find((item) => item.id === id)?.enabled) send({ type: "join", roomId: id });
    else send({ type: "leave" });
  }, [send, project, hostOffline, updateHash]);

  useEffect(() => {
    if (initialRoom === selectedRef.current) return;
    selectedRef.current = initialRoom;
    setSelectedId(initialRoom); setRoom(null);
    send(initialRoom ? { type: "join", roomId: initialRoom } : { type: "leave" });
  }, [initialRoom, send]);

  useEffect(() => {
    setStatusScope({ token, baseUrl });
    if (!token) { setStatus("closed"); return; }
    let disposed = false;
    let retries = 0;
    let terminal = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let lastPong = Date.now();
    let acceptedProject: CollaborationProjectState | null = null;
    const controller = new AbortController();
    const endForHostOffline = () => {
      terminal = true;
      clearTimeout(retryTimer);
      clearInterval(heartbeat);
      controller.abort();
      setHostOffline(true);
      setStatus("closed");
      setError(HOST_OFFLINE_MESSAGE);
      setProject((current) => current?.self.kind === "member" ? current : null);
      setRoom(null);
      setConnectionId("");
      setRtt(null);
      setUnread({});
      visibleDiscussion.current = { roomId: "", channel: null };
      const active = socket.current;
      socket.current = null;
      active?.close();
    };
    stopForHostOffline.current = endForHostOffline;
    const endForProjectRemoved = () => {
      terminal = true; clearTimeout(retryTimer); clearInterval(heartbeat); controller.abort();
      setProjectRemoved(true); setHostOffline(false); setStatus("closed");
      setError("Shared project removed. Your local files and private Agent remain available.");
      setRoom(null); setConnectionId(""); setRtt(null); setUnread({});
      setProject((current) => current ? { ...current, rooms: [], workspaces: [], members: [] } : null);
      visibleDiscussion.current = { roomId: "", channel: null };
      const active = socket.current; socket.current = null; active?.close();
    };
    setProjectRemoved(false);
    stopForProjectRemoved.current = endForProjectRemoved;
    const visibleChannel = (roomId: string): DiscussionChannel | null => {
      const visible = visibleDiscussion.current;
      return visible.roomId === roomId && document.visibilityState === "visible" && document.hasFocus() ? visible.channel : null;
    };

    const acceptProject = (next: CollaborationProjectState) => {
      acceptedProject = next;
      setProject(next);
      const ids = visibleRoomIds(next.self, next.rooms.map((item) => item.id));
      const unreadKey = `pneuma-collaboration-unread:${encodeURIComponent(baseUrl)}:${encodeURIComponent(next.project.id)}:${encodeURIComponent(next.self.id)}`;
      if (unreadTracker.current?.key !== unreadKey) {
        let stored: string | null = null;
        try { stored = sessionStorage.getItem(unreadKey); } catch { /* Optional tab persistence. */ }
        unreadTracker.current = { key: unreadKey, tracker: new UnreadTracker(next.self.id, stored) };
      }
      unreadTracker.current.tracker.restrictTo(ids);
      syncUnread();
      let nextId = selectedRef.current;
      if (!ids.includes(nextId)) {
        nextId = !nextId && !selectDefault ? "" : ids[0] || "";
        selectedRef.current = nextId;
        setSelectedId(nextId);
        setRoom(null);
      }
      return nextId;
    };

    const connect = async () => {
      if (disposed || terminal) return;
      setHostOffline(false);
      setStatus(retries ? "reconnecting" : "connecting");
      setError("");
      setRtt(null);
      try {
        const next = await request<CollaborationProjectState>("/api/state", { signal: controller.signal });
        if (disposed || terminal) return;
        acceptProject(next);
        const url = new URL(`${baseUrl}/ws`, location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("token", token);
        const ws = new WebSocket(url);
        socket.current = ws;
        ws.onmessage = (event) => {
          if (disposed || terminal || socket.current !== ws) return;
          let message: CollaborationServerMessage;
          try { message = JSON.parse(event.data); } catch { setError("The host sent an unreadable update. Reconnect to refresh."); return; }
          switch (message.type) {
            case "welcome": {
              retries = 0;
              setStatus("connected");
              setError("");
              setConnectionId(message.connectionId);
              const id = acceptProject(message.state);
              setRoom(null);
              if (id && message.state.rooms.find((item) => item.id === id)?.enabled) ws.send(JSON.stringify({ type: "join", roomId: id }));
              lastPong = Date.now();
              ws.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
              heartbeat = setInterval(() => {
                if (Date.now() - lastPong > 15_000) { ws.close(); return; }
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
              }, 5000);
              break;
            }
            case "project": {
              const before = selectedRef.current;
              const wasEnabled = acceptedProject?.rooms.find((item) => item.id === before)?.enabled;
              const id = acceptProject(message.state);
              const reenabled = before === id && wasEnabled === false && message.state.rooms.find((item) => item.id === id)?.enabled === true;
              setRoom((current) => {
                if (reenabled) return null; // Disabled-room grants were revoked; acquire a fresh one.
                const latest = message.state.rooms.find((item) => item.id === current?.room.id);
                // Project metadata is not a publication commit. Keep the page and
                // revision paired with their current asset grant until content arrives.
                return current && latest ? { ...current, room: { ...latest, revision: current.room.revision, page: current.room.page } } : null;
              });
              if (before !== id || reenabled) send(id && message.state.rooms.find((item) => item.id === id)?.enabled ? { type: "join", roomId: id } : { type: "leave" });
              break;
            }
            case "room":
              if (message.state.room.id === selectedRef.current) {
                const canReadChat = acceptedProject?.self.kind === "member" || acceptedProject?.self.guestAccess === "comment";
                unreadTracker.current?.tracker.snapshot(canReadChat ? message.state : { ...message.state, messages: [] }, visibleChannel(message.state.room.id));
                syncUnread();
                setRoom(message.state); setError("");
              }
              break;
            case "content":
              setProject((current) => current ? { ...current, rooms: current.rooms.map((item) => item.id === message.room.id ? message.room : item) } : null);
              setRoom((current) => current?.room.id === message.room.id ? { ...current, room: message.room, pageUrl: message.pageUrl, publication: message.publication } : current);
              if (message.room.id === selectedRef.current) setError("");
              break;
            case "presence":
              setRoom((current) => {
                if (current?.room.id !== message.participant.roomId) return current;
                const previous = current.participants.find((person) => person.id === message.participant.id);
                if (previous?.sequence !== undefined && message.participant.sequence !== undefined && previous.sequence >= message.participant.sequence) return current;
                return { ...current, participants: [...current.participants.filter((person) => person.id !== message.participant.id), message.participant] };
              });
              break;
            case "departed":
              setRoom((current) => current ? { ...current, participants: current.participants.filter((person) => person.id !== message.connectionId) } : current);
              break;
            case "comments":
              unreadTracker.current?.tracker.comments(selectedRef.current, message.comments, visibleChannel(selectedRef.current) === "comments");
              syncUnread();
              setRoom((current) => current ? { ...current, comments: message.comments.filter((comment) => comment.roomId === current.room.id) } : current);
              break;
            case "chat":
              if (acceptedProject?.self.kind === "member" || acceptedProject?.self.guestAccess === "comment") {
                unreadTracker.current?.tracker.chat(message.message, visibleChannel(message.message.roomId) === "chat");
                syncUnread();
              }
              setRoom((current) => current?.room.id === message.message.roomId ? { ...current, messages: [...current.messages.filter((item) => item.id !== message.message.id), message.message] } : current);
              break;
            case "pong":
              lastPong = Date.now();
              setRtt(Math.max(0, Math.round(Date.now() - message.sentAt)));
              break;
            case "closed":
              if (message.reason === "Project removed") {
                endForProjectRemoved();
                break;
              }
              if (("code" in message && message.code === "host_offline") || message.reason === HOST_OFFLINE_MESSAGE) {
                endForHostOffline();
                break;
              }
              terminal = true;
              setStatus("closed");
              setRoom(null);
              setError(message.reason);
              ws.close();
              break;
            case "error": setError(message.message); break;
          }
        };
        ws.onerror = () => {
          if (!disposed && !terminal && socket.current === ws) setError("Connection interrupted. Reconnecting to the host…");
        };
        ws.onclose = (event) => {
          if (heartbeat) clearInterval(heartbeat);
          if (disposed || terminal) return;
          if (event.code === 1008 && event.reason === "Project removed") { endForProjectRemoved(); return; }
          setStatus("reconnecting");
          setRoom((current) => current ? { ...current, participants: [] } : current);
          retries++;
          retryTimer = setTimeout(connect, Math.min(1000 * 2 ** (retries - 1), 8000));
        };
      } catch (failure) {
        if (disposed || terminal) return;
        setError(failure instanceof Error ? failure.message : "Unable to reach the host.");
        if (failure instanceof RequestError && [401, 403].includes(failure.status)) {
          terminal = true;
          setStatus("closed");
          setProject(null);
          setRoom(null);
        } else {
          setStatus("reconnecting");
          retries++;
          retryTimer = setTimeout(connect, Math.min(1000 * 2 ** (retries - 1), 8000));
        }
      }
    };
    void connect();
    return () => {
      disposed = true;
      if (stopForHostOffline.current === endForHostOffline) stopForHostOffline.current = () => {};
      if (stopForProjectRemoved.current === endForProjectRemoved) stopForProjectRemoved.current = () => {};
      controller.abort();
      clearTimeout(retryTimer);
      clearInterval(heartbeat);
      socket.current?.close();
      socket.current = null;
    };
  }, [token, attempt, request, send, syncUnread, baseUrl, selectDefault]);

  const removeProject = useCallback(async (opId: string) => {
    const receipt = await request<{ ok: boolean; removed: boolean; projectId: string; removedAt: number }>("/api/project", { method: "DELETE", body: { opId } });
    if (!receipt.ok || !receipt.removed) throw new Error("The authority has not confirmed removing shared access.");
    stopForProjectRemoved.current();
  }, [request]);
  const scopedStatus: ConnectionStatus = !token ? "closed" : statusScope.token === token && statusScope.baseUrl === baseUrl ? status : "connecting";
  return { baseUrl, project, room, selectedId, selectRoom, status: scopedStatus, error, hostOffline, projectRemoved, removeProject, setError, connectionId, rtt, request, send, unread, setVisibleDiscussion, reconnect: () => setAttempt((value) => value + 1) };
}
