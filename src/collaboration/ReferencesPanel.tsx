import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CollaborationReference, CollaborationResolvedReference } from "../../core/types/collaboration-reference.js";
import type { CollaborationAnchor, CollaborationRoom, CollaborationRoomState } from "../../core/types/collaboration.js";
import { createPrivateViewerInstanceId } from "../../core/types/private-viewer.js";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";
import { mutationAvailable } from "./client-state.js";
import { PublishedViewer } from "./PublishedViewer.js";
import { currentReferenceSource, referenceAgentDraft, referenceLocation, selectedReferenceSource } from "./reference-utils.js";
import type { useCollaboration } from "./use-collaboration.js";
import type { ViewerCollaborationRuntime } from "./viewer-runtime.js";
import { clearReferenceOperation, hasReferenceOperation, readReferenceOperation, referenceOperationKey, saveReferenceOperation, type PendingReferenceOperation } from "./reference-operations.js";

type Client = ReturnType<typeof useCollaboration>;

export function PinRoomButton({ client, destinationWorkspaceId, room, onPinned, operationAuthority }: {
  client: Client; destinationWorkspaceId: string; room: CollaborationRoom; onPinned: () => void; operationAuthority?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const operationKey = referenceOperationKey({ authorityBaseUrl: client.baseUrl, authorityScope: operationAuthority, projectId: client.project!.project.id, workspaceId: destinationWorkspaceId, targetId: room.id, action: "pin" });
  const [recovering, setRecovering] = useState(() => hasReferenceOperation(operationKey));
  const operation = useRef<PendingReferenceOperation | null>(null);
  useEffect(() => { operation.current = null; setRecovering(hasReferenceOperation(operationKey)); }, [operationKey]);
  const pin = async () => {
    if (pending) return;
    setPending(true); setError("");
    try {
      operation.current ??= readReferenceOperation(operationKey);
      if (!operation.current) {
        const current = await client.request<CollaborationRoomState>(`/api/rooms/${encodeURIComponent(room.id)}`);
        operation.current = { opId: createPrivateViewerInstanceId(), source: currentReferenceSource(client.project!.project.id, current), destinationWorkspaceId, label: room.title };
      }
      saveReferenceOperation(operationKey, operation.current); setRecovering(true);
      await client.request("/api/references", { method: "POST", body: operation.current });
      clearReferenceOperation(operationKey); operation.current = null; setRecovering(false); onPinned();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to pin this room"); }
    finally { setPending(false); }
  };
  return <><button type="button" className="text-button" disabled={pending || !room.enabled || room.hostOnline === false || !mutationAvailable(client.project?.self, client.status)} onClick={() => void pin()}>{pending ? "Pinning…" : recovering ? "Retry pin" : "Pin to my workspace"}</button>{error && <p className="inline-error" role="alert">{error}</p>}</>;
}

export function ReferencesPanel({ client, destinationWorkspaceId, operationAuthority }: { client: Client; destinationWorkspaceId: string; operationAuthority?: string }) {
  const [references, setReferences] = useState<CollaborationReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [opened, setOpened] = useState<CollaborationResolvedReference | null>(null);
  const generation = useRef(0);
  const latestClient = useRef(client);
  latestClient.current = client;
  const connected = client.status === "connected" && !client.projectRemoved;
  const sourceAvailable = (current: Client, reference: CollaborationReference) => {
    const source = current.project?.rooms.find((room) => room.id === reference.source.roomId);
    return !current.projectRemoved && current.status === "connected" && !!source?.enabled && source.hostOnline === true;
  };
  useEffect(() => {
    if (!opened) return;
    if (!sourceAvailable(client, opened.reference)) {
      setOpened(null);
      setError(client.projectRemoved ? "Shared project removed. The pinned view is unavailable." : client.status !== "connected" ? "Connection unavailable. Open the reference again after access is restored." : "The source workspace is unavailable. Its host must be online with sharing enabled before you reopen this pinned view.");
    }
  }, [opened, client.projectRemoved, client.project, client.status]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = generation.current;
    const response = await client.request<{ references: CollaborationReference[] }>(`/api/references?workspaceId=${encodeURIComponent(destinationWorkspaceId)}`, { signal });
    if (!signal?.aborted && current === generation.current) setReferences(response.references);
  }, [client.request, destinationWorkspaceId]);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setError(""); setPending("");
    if (!connected) {
      setLoading(false);
      return () => { ++generation.current; };
    }
    setLoading(true);
    void load(controller.signal).catch((failure) => { if (!controller.signal.aborted && current === generation.current) setError(failure instanceof Error ? failure.message : "Unable to load references"); }).finally(() => { if (!controller.signal.aborted && current === generation.current) setLoading(false); });
    return () => { ++generation.current; controller.abort(); };
  }, [load, connected]);
  const perform = async (reference: CollaborationReference, action: "open" | "refresh" | "remove" | "import" | "agent") => {
    if (pending || !connected || ((action === "open" || action === "agent") && !sourceAvailable(client, reference))) return;
    const current = generation.current;
    setPending(`${reference.id}:${action}`); setError(""); setNotice("");
    const path = `/api/references/${encodeURIComponent(reference.id)}`;
    try {
      if (action === "open" || action === "agent") {
        const resolved = await client.request<CollaborationResolvedReference>(`${path}/resolve`);
        if (current !== generation.current) return;
        if (!sourceAvailable(latestClient.current, reference)) throw new Error("The source workspace is unavailable. Its host must be online with sharing enabled before you reopen this pinned view.");
        if (action === "open") setOpened(resolved);
        else {
          const store = useStore.getState();
          store.setComposerInsertion({ id: createPrivateViewerInstanceId(), text: referenceAgentDraft(resolved.reference) });
          if (store.editing) store.expandSurface();
          setNotice(store.editing ? "Reference added to your editable Agent draft. Review it before sending." : "Reference saved as an editable Agent draft. Open your composer when you choose; no message has been sent.");
        }
      } else if (action === "import") {
        const key = referenceOperationKey({ authorityBaseUrl: client.baseUrl, authorityScope: operationAuthority, projectId: reference.source.projectId, workspaceId: destinationWorkspaceId, targetId: reference.id, action, revision: reference.source.publicationRevision });
        const operation = readReferenceOperation(key) ?? { opId: createPrivateViewerInstanceId() };
        saveReferenceOperation(key, operation);
        const response = await fetch(`${getApiBase()}/api/collaboration/references/${encodeURIComponent(reference.id)}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: operation.opId }) });
        const receipt = await response.json();
        if (!response.ok) throw new Error(receipt.error || "Unable to import this reference");
        clearReferenceOperation(key);
        if (current !== generation.current) return;
        setNotice(`Local copy imported to ${receipt.path}. Source: ${reference.label}, revision ${receipt.publicationRevision}. Your edits will not change the shared source.`);
      } else {
        const key = referenceOperationKey({ authorityBaseUrl: client.baseUrl, authorityScope: operationAuthority, projectId: reference.source.projectId, workspaceId: destinationWorkspaceId, targetId: reference.id, action });
        let operation = readReferenceOperation(key);
        if (!operation) {
          operation = { opId: createPrivateViewerInstanceId(), ...(action === "refresh" ? { source: currentReferenceSource(reference.source.projectId, await client.request<CollaborationRoomState>(`/api/rooms/${encodeURIComponent(reference.source.roomId)}`)) } : {}) };
        }
        saveReferenceOperation(key, operation);
        await client.request(path, { method: action === "remove" ? "DELETE" : "PATCH", body: operation });
        clearReferenceOperation(key);
        if (current !== generation.current) return;
        await load();
        if (current !== generation.current) return;
        setNotice(action === "remove" ? "Reference removed from your workspace." : "Reference refreshed to the current published entry and revision.");
      }
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "Reference request failed"); }
    finally { if (current === generation.current) setPending(""); }
  };
  const writable = mutationAvailable(client.project?.self, client.status);
  return <div className="panel-content"><p className="muted">References pin a published address and revision. They keep attribution without copying source files into your workspace.</p>
    {!connected && <p role="status">{client.projectRemoved ? "Shared project removed. References are unavailable." : client.status === "connecting" || client.status === "reconnecting" ? "Connecting to Project… References will be available when the connection is restored." : "Project connection unavailable. Reconnect before opening references."}</p>}{loading && <p role="status">Loading references…</p>}{error && <p className="inline-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {connected && !loading && !references.length && <p className="muted">Pin a shared workspace from the Project tab to keep a reference here.</p>}
    <div className="reference-list">{references.map((reference) => {
      const workspace = client.project?.workspaces?.find((workspace) => workspace.id === reference.source.workspaceId);
      const room = client.project?.rooms.find((room) => room.id === reference.source.roomId);
      const available = sourceAvailable(client, reference);
      return <article className="reference-item" key={reference.id}><h3>{reference.label}</h3><p className="muted">{workspace?.name || "Shared workspace"} · {room?.title || "Published site"} · revision {reference.source.publicationRevision}</p><p className="reference-location">{referenceLocation(reference.source.address)}</p>
        {connected && !available && <p className="muted">The source workspace must be online with sharing enabled to open this reference.</p>}
        <div className="reference-actions"><button className="button" disabled={!!pending || !available} onClick={() => void perform(reference, "open")}>Open pinned view</button><button className="button" disabled={!!pending || !writable} onClick={() => void perform(reference, "refresh")}>Refresh to current entry</button><button className="text-button danger-text" disabled={!!pending || !writable} onClick={() => void perform(reference, "remove")}>Remove</button></div>
        <p className="muted">Import creates an attributed local copy. Your Agent can edit that copy after you send your own instructions.</p><div className="reference-actions"><button className="button" disabled={!!pending || !writable} onClick={() => void perform(reference, "import")}>Import a local copy</button><button className="button" disabled={!!pending || !available} onClick={() => void perform(reference, "agent")}>Send reference to my Agent</button></div>
      </article>;
    })}</div>{opened && <ReferenceViewer client={client} operationAuthority={operationAuthority} resolved={opened} onClose={() => setOpened(null)} onSaved={(next) => { setOpened({ ...opened, reference: next }); setReferences((current) => current.map((reference) => reference.id === next.id ? next : reference)); }}/>}</div>;
}

function ReferenceViewer({ client, resolved, onClose, onSaved, operationAuthority }: { operationAuthority?: string; client: Client; resolved: CollaborationResolvedReference; onClose: () => void; onSaved: (reference: CollaborationReference) => void }) {
  const runtimeRef = useRef<ViewerCollaborationRuntime | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<CollaborationAnchor | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const operationKey = referenceOperationKey({ authorityBaseUrl: client.baseUrl, authorityScope: operationAuthority, projectId: resolved.reference.source.projectId, workspaceId: resolved.reference.destinationWorkspaceId, targetId: resolved.reference.id, action: "selected-location", revision: resolved.reference.source.publicationRevision });
  const operation = useRef<PendingReferenceOperation | null>(null);
  useEffect(() => {
    try {
      operation.current = readReferenceOperation(operationKey);
      if (operation.current?.source) setSelected({ address: operation.current.source.address, revision: operation.current.source.publicationRevision, x: 0, y: 0, quote: operation.current.label });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to recover the selected location request"); }
  }, [operationKey]);
  const initialAnchor = useMemo(() => ({ address: resolved.reference.source.address, revision: resolved.publication.revision, x: 0, y: 0 }), [resolved.reference.source.address, resolved.publication.revision]);
  const saveLocation = async () => {
    if (!selected || pending) return;
    setPending(true); setError("");
    try {
      operation.current ??= { opId: createPrivateViewerInstanceId(), source: selectedReferenceSource(resolved.reference, selected), ...(selected.quote ? { label: selected.quote.slice(0, 160) } : {}) };
      saveReferenceOperation(operationKey, operation.current);
      const saved = await client.request<CollaborationReference>(`/api/references/${encodeURIComponent(resolved.reference.id)}`, { method: "PATCH", body: operation.current });
      clearReferenceOperation(operationKey); operation.current = null; setSelected(null); setSelecting(false); onSaved(saved);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save the selected location"); }
    finally { setPending(false); }
  };
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopImmediatePropagation(); onClose(); } }; window.addEventListener("keydown", close, true); return () => window.removeEventListener("keydown", close, true); }, [onClose]);
  const room: CollaborationRoomState = { room: { ...resolved.room, compatibility: resolved.compatibility }, publication: resolved.publication, pageUrl: resolved.pageUrl, participants: [], comments: [], messages: [] };
  const pinnedClient = { ...client, room, send: () => false };
  return createPortal(<section className="reference-viewer" role="dialog" aria-modal="true" aria-label={`Pinned reference: ${resolved.reference.label}`}><header><div><strong>{resolved.reference.label}</strong><span>Revision {resolved.publication.revision} · pinned view</span></div><button className="button" onClick={onClose}>Close reference</button></header><div className="reference-preview"><PublishedViewer client={pinnedClient} selectingLocation={true} commenting={selecting} followingId={null} onFollowingChange={() => {}} onSelect={(anchor) => { if (!operation.current) setSelected(anchor); }} onComment={() => {}} runtimeRef={runtimeRef} initialAnchor={initialAnchor}/></div><footer><button className="button" disabled={pending || !mutationAvailable(client.project?.self, client.status)} aria-pressed={selecting} onClick={() => setSelecting(!selecting)}>{selecting ? "Stop selecting" : "Select location"}</button>{selected && <><span>{selected.quote || "Selected object"} · keeps revision {resolved.publication.revision}</span><button className="button" disabled={pending} onClick={() => void saveLocation()}>{pending ? "Saving…" : operation.current ? "Retry selected location" : "Use selected location"}</button></>}{error && <p role="alert">{error}</p>}</footer></section>, document.body);
}
