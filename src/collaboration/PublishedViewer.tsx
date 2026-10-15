import { Component, useEffect, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import type { CollaborationAnchor, CollaborationRoomState } from "../../core/types/collaboration.js";
import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext } from "../../core/types/viewer-contract.js";
import { createPrivateViewerInstanceId } from "../../core/types/private-viewer.js";
import { loadPublishedViewer } from "./viewer-assets.js";
import { publishedSources, publicResourceResolver } from "./published-sources.js";
import { ViewerCollaborationRuntime } from "./viewer-runtime.js";
import { ViewerOverlays } from "./ViewerOverlays.js";
import { discussionAvailable } from "./client-state.js";
import { createCommentAnchor } from "./comment-anchor.js";
import type { useCollaboration } from "./use-collaboration.js";

export function PublishedViewer({ client, commenting, followingId, onFollowingChange, onSelect, onComment, runtimeRef, initialAnchor, selectingLocation = false }: {
  client: ReturnType<typeof useCollaboration>; commenting: boolean; followingId: string | null;
  onFollowingChange: (id: string | null) => void; onSelect: (anchor: CollaborationAnchor) => void;
  onComment: (id: string) => void; runtimeRef: RefObject<ViewerCollaborationRuntime | null>;
  initialAnchor?: CollaborationAnchor;
  /** A pinned reference chooses an address; it is not a writable comment surface. */
  selectingLocation?: boolean;
}) {
  const room = client.room!;
  const [definition, setDefinition] = useState<ModeDefinition | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setDefinition(null); setError("");
    void loadPublishedViewer(room.room, client.baseUrl, controller.signal).then((next) => {
      if (!controller.signal.aborted) setDefinition(next);
    }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load the published viewer"); });
    return () => controller.abort();
  }, [room.room.id, room.room.compatibility?.viewerHash, client.baseUrl, attempt]);
  if (error) return <div className="viewer-empty"><h2>Viewer unavailable</h2><p role="alert">{error}</p><button className="button" onClick={() => setAttempt((value) => value + 1)}>Retry viewer</button></div>;
  if (!definition) return <div className="frame-loading">Loading the published viewer…</div>;
  if (!room.publication?.projection || room.publication.revision !== room.room.revision) return <div className="viewer-empty"><h2>Publication unavailable</h2><p>The host has not provided a complete compatible publication.</p></div>;
  return <PublishedBoundary key={`${room.room.id}:${room.room.compatibility?.viewerHash}`}><PublishedMount definition={definition} room={room} client={client} commenting={commenting} followingId={followingId} onFollowingChange={onFollowingChange} onSelect={onSelect} onComment={onComment} runtimeRef={runtimeRef} initialAnchor={initialAnchor} selectingLocation={selectingLocation}/></PublishedBoundary>;
}

class PublishedBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error ? <div className="viewer-empty"><h2>Viewer unavailable</h2><p role="alert">{this.state.error.message}</p><button className="button" onClick={() => this.setState({ error: null })}>Retry viewer</button></div> : this.props.children;
  }
}

interface PublishedMountProps {
  definition: ModeDefinition; room: CollaborationRoomState; client: ReturnType<typeof useCollaboration>; commenting: boolean;
  followingId: string | null; onFollowingChange: (id: string | null) => void; onSelect: (anchor: CollaborationAnchor) => void;
  onComment: (id: string) => void; runtimeRef: RefObject<ViewerCollaborationRuntime | null>;
  initialAnchor?: CollaborationAnchor;
  selectingLocation?: boolean;
}
interface PublishedGenerationState {
  channels: ReturnType<typeof publishedSources>;
  runtime: ViewerCollaborationRuntime;
}

export function PublishedMount(props: PublishedMountProps) {
  const [generation, setGeneration] = useState<PublishedGenerationState | null>(null);
  useLayoutEffect(() => {
    const projection = props.room.publication!.projection!;
    const channels = publishedSources(projection);
    const runtime = new ViewerCollaborationRuntime(createPrivateViewerInstanceId(), props.definition.manifest.viewerApi!.collaboration!, { address: projection.entryAddress }, (report) => {
      props.client.send({ type: "presence", view: null, cursor: null, ...report, sentAt: Date.now() });
    }, { contentSet: typeof projection.entryAddress.contentSet === "string" ? projection.entryAddress.contentSet : null });
    setGeneration({ channels, runtime });
    return () => { runtime.dispose(); for (const source of Object.values(channels.sources)) source.destroy(); };
  }, [props.definition]);
  if (!generation) return <div className="frame-loading">Preparing the published viewer…</div>;
  return <PublishedGeneration key={generation.runtime.instanceId} {...props} generation={generation}/>;
}

function PublishedGeneration({ definition, room, client, commenting, followingId, onFollowingChange, onSelect, onComment, runtimeRef, initialAnchor, selectingLocation = false, generation }: PublishedMountProps & { generation: PublishedGenerationState }) {
  const projection = room.publication!.projection!;
  const { channels, runtime } = generation;
  const [selection, setSelection] = useState<ViewerSelectionContext | null>(null);
  const [initialLocationError, setInitialLocationError] = useState("");
  const [activeFile, setActiveFile] = useState<string | null>(typeof projection.entryAddress.page === "string" ? projection.entryAddress.page : room.room.page);
  const [contentSet, setContentSet] = useState<string | null>(typeof projection.entryAddress.contentSet === "string" ? projection.entryAddress.contentSet : null);
  useLayoutEffect(() => { channels.update(projection); }, [channels, projection]);
  const peers = room.participants.filter((peer) => peer.id !== client.connectionId);
  useEffect(() => {
    runtimeRef.current = runtime;
    const unsubscribe = runtime.subscribe(() => onFollowingChange(runtime.current().followingId));
    return () => { unsubscribe(); if (runtimeRef.current === runtime) runtimeRef.current = null; };
  }, [runtime]);
  useEffect(() => {
    runtime.update(room.room.revision, client.status === "connected", peers.map((peer) => ({ id: peer.id, revision: peer.revision ?? peer.view?.revision ?? 0, view: peer.semanticView ?? null, pointer: peer.semanticPointer ?? null, followingId: peer.followingId })), room.comments);
  }, [runtime, room.room.revision, room.participants, room.comments, client.status, client.connectionId]);
  useEffect(() => { if (runtime.current().followingId !== followingId) runtime.setFollowing(followingId); }, [runtime, followingId]);
  useEffect(() => {
    if (!initialAnchor) return;
    let started = false; let active = true;
    setInitialLocationError("");
    const apply = () => {
      if (started || !runtime.current().ready) return;
      started = true;
      void runtime.navigateAnchor(initialAnchor).then((result) => { if (active && !result.success) setInitialLocationError(result.message || "The pinned location could not be reached"); });
    };
    const unsubscribe = runtime.subscribe(apply); apply();
    return () => { active = false; unsubscribe(); };
  }, [runtime, initialAnchor]);
  const resolver = useMemo(() => publicResourceResolver(room.pageUrl, room.room.page, client.baseUrl || location.origin), [room.pageUrl, room.room.page, client.baseUrl]);
  const canComment = !selectingLocation && !!room.room.enabled && discussionAvailable(client.project?.self, client.status);
  const selectAnchor = (next: ViewerSelectionContext) => {
    const anchor = createCommentAnchor(next, room.room.revision);
    if (anchor) onSelect(anchor);
  };
  const Preview = definition.viewer.PreviewComponent;
  return <div className="published-viewer">
    {initialLocationError && <p className="viewer-binding-error" role="alert">{initialLocationError}</p>}
    <Preview sources={channels.sources} fileChannel={channels.fileChannel} collaboration={runtime.binding}
      permissions={{ editContent: false, notifyAgent: false, export: false }} resolveResourceUrl={resolver}
      commenting={selectingLocation ? undefined : { enabled: canComment, active: canComment && commenting, onSelect: (next) => { if (canComment) selectAnchor(next); } }}
      activeContentSet={contentSet} onActiveContentSetChange={setContentSet} activeFile={activeFile} onActiveFileChange={setActiveFile}
      selection={selection} onSelect={(next) => { setSelection(next); if (selectingLocation && commenting && next?.address) selectAnchor(next); }}
      mode={selectingLocation && commenting ? "select" : "view"} imageVersion={room.room.revision} initParams={projection.initParams}
      readonly={false} editing={false} theme="dark" locale="en"/>
    <ViewerOverlays runtime={runtime} peers={peers} comments={room.comments} onComment={onComment}/>
  </div>;
}
