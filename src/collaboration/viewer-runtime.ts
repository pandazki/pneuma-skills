import type { CollaborationAnchor } from "../../core/types/collaboration.js";
import { isCollaborationJson, isViewerViewState, type CollaborationJsonObject, type ViewerCollaborationAdapter, type ViewerCollaborationBinding, type ViewerCollaborationDeclaration, type ViewerProjection, type ViewerViewState } from "../../core/types/viewer-collaboration.js";
import type { ViewerActionResult, ViewerAddress } from "../../core/types/viewer-contract.js";

export interface ViewerPeer {
  id: string;
  revision: number;
  view: ViewerViewState | null;
  pointer: CollaborationJsonObject | null;
  followingId: string | null;
}
export interface ViewerRuntimeSnapshot {
  ready: boolean;
  followingId: string | null;
  error: string;
  pointers: Record<string, ViewerProjection>;
  anchors: Record<string, ViewerProjection>;
}
export interface ViewerPresenceReport {
  revision: number;
  semanticView: ViewerViewState;
  semanticPointer: CollaborationJsonObject | null;
  followingId: string | null;
}

const PRESENCE_INTERVAL_MS = 1000 / 30;

/** One mount owns adapter callbacks, abort controllers and projection coordinates. */
export class ViewerCollaborationRuntime {
  readonly binding: ViewerCollaborationBinding;
  private adapter: ViewerCollaborationAdapter | null = null;
  private generation = 0;
  private disposed = false;
  private revision = 0;
  private connected = false;
  private view: ViewerViewState;
  private pointer: CollaborationJsonObject | null = null;
  private peers: ViewerPeer[] = [];
  private comments: Array<{ id: string; anchor: CollaborationAnchor }> = [];
  private applyController: AbortController | null = null;
  private projectionController: AbortController | null = null;
  private lastFollow = "";
  private lastPublishedAt = -Infinity;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: ViewerRuntimeSnapshot = { ready: false, followingId: null, error: "", pointers: {}, anchors: {} };

  constructor(readonly instanceId: string, private declaration: ViewerCollaborationDeclaration, initialView: ViewerViewState, private publish: (report: ViewerPresenceReport) => void, private publicScope?: { contentSet: string | null }) {
    this.view = initialView;
    this.binding = {
      viewerInstanceId: instanceId,
      register: (adapter) => this.register(adapter),
      reportView: (view, cause) => this.reportView(view, cause),
      reportPointer: (pointer) => {
        if (this.disposed || !this.declaration.pointers || !this.snapshot.ready) return;
        if (pointer !== null && (!isCollaborationJson(pointer) || Array.isArray(pointer))) return this.fail("Invalid pointer reported by the mode viewer");
        this.pointer = pointer;
        this.send();
      },
      invalidateProjection: () => { void this.project(); },
    };
  }
  current = (): ViewerRuntimeSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private change(change: Partial<ViewerRuntimeSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  private fail(message: string): void { this.change({ error: message }); }
  private allowedAddress(address: ViewerAddress): boolean {
    return !this.publicScope || (address.contentSet ?? null) === this.publicScope.contentSet;
  }
  private send(): void {
    if (this.disposed || !this.connected || !this.snapshot.ready || this.revision < 1) return;
    if (!this.allowedAddress(this.view.address)) return;
    if (this.presenceTimer) return;
    const delay = PRESENCE_INTERVAL_MS - (performance.now() - this.lastPublishedAt);
    if (delay > 0) {
      // View, pointer and follow reports share one latest-state transport budget.
      this.presenceTimer = setTimeout(() => { this.presenceTimer = null; this.send(); }, delay);
      return;
    }
    this.lastPublishedAt = performance.now();
    this.publish({ revision: this.revision, semanticView: this.view, semanticPointer: this.pointer, followingId: this.snapshot.followingId });
  }
  private abort(): void {
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
    this.applyController?.abort(); this.applyController = null;
    this.projectionController?.abort(); this.projectionController = null;
    this.lastFollow = "";
  }
  private register(adapter: ViewerCollaborationAdapter): () => void {
    if (this.disposed) return () => {};
    this.abort();
    const generation = ++this.generation;
    const missing = [this.declaration.follow && !adapter.applyView && "applyView", this.declaration.pointers && !adapter.projectPointer && "projectPointer", this.declaration.addressAnchors && !adapter.projectAnchor && "projectAnchor"].filter(Boolean);
    this.adapter = missing.length ? null : adapter;
    this.change({ ready: !missing.length, error: missing.length ? `Mode collaboration is unavailable: missing ${missing.join(", ")}` : "", pointers: {}, anchors: {} });
    if (this.adapter) { void this.followCurrent(); void this.project(); this.send(); }
    return () => {
      if (generation !== this.generation || this.disposed) return;
      this.abort(); this.adapter = null; ++this.generation;
      this.change({ ready: false, pointers: {}, anchors: {} });
    };
  }
  update(revision: number, connected: boolean, peers: ViewerPeer[], comments: Array<{ id: string; anchor: CollaborationAnchor }>): void {
    if (this.disposed) return;
    const changed = revision !== this.revision || connected !== this.connected;
    if (changed) { this.abort(); this.change({ pointers: {}, anchors: {} }); }
    this.revision = revision; this.connected = connected; this.peers = peers; this.comments = comments;
    if (!connected && this.snapshot.followingId) this.change({ followingId: null });
    void this.followCurrent(); void this.project();
    if (changed) this.send();
  }
  setFollowing(id: string | null): void {
    if (this.disposed) return;
    this.applyController?.abort(); this.lastFollow = "";
    if (id && (!this.declaration.follow || !this.snapshot.ready || !this.connected)) return this.fail("Following is unavailable for this viewer");
    this.change({ followingId: id, error: "" });
    this.send(); void this.followCurrent();
  }
  private reportView(view: ViewerViewState, cause: "local-input" | "follow" | "content-refresh"): void {
    if (this.disposed || !this.snapshot.ready) return;
    if (!isViewerViewState(view)) return this.fail("Invalid view state reported by the mode viewer");
    if (!this.allowedAddress(view.address)) return this.fail("This view is outside the published workspace");
    // Applying peer state never becomes another participant's local intent.
    if (cause === "follow") { this.view = view; void this.project(); return; }
    if (cause === "local-input") {
      this.applyController?.abort(); this.lastFollow = "";
      this.change({ followingId: null, error: "" });
    }
    this.view = view; this.send(); void this.project();
  }
  private async followCurrent(): Promise<void> {
    const id = this.snapshot.followingId;
    if (!id || !this.adapter?.applyView || !this.connected) return;
    const leader = this.peers.find((peer) => peer.id === id);
    if (!leader || leader.followingId) { this.setFollowing(null); return; }
    if (leader.revision !== this.revision || !leader.view) { this.fail("Waiting for the participant's published revision"); return; }
    if (!this.allowedAddress(leader.view.address)) { this.fail("The participant's target is outside the published workspace"); return; }
    const signature = JSON.stringify([this.generation, id, leader.revision, leader.view]);
    if (signature === this.lastFollow) return;
    this.lastFollow = signature;
    this.applyController?.abort();
    const controller = new AbortController(); this.applyController = controller;
    const generation = this.generation;
    const previousView = this.view;
    try {
      const result = await this.adapter.applyView(leader.view, controller.signal);
      if (controller.signal.aborted || this.disposed || generation !== this.generation) return;
      if (result.success && this.view === previousView) this.view = leader.view;
      this.change({ error: result.success ? "" : result.message ?? "The participant's view could not be applied" });
      void this.project();
    } catch (error) { if (!controller.signal.aborted) this.fail(error instanceof Error ? error.message : "Unable to follow this view"); }
  }
  async navigateAnchor(anchor: CollaborationAnchor): Promise<ViewerActionResult> {
    if (!this.allowedAddress(anchor.address)) return { success: false, message: "This comment's target is outside the published workspace" };
    if (anchor.revision !== this.revision) return { success: false, message: "This comment belongs to an older publication. Its location must be confirmed again." };
    if (!this.adapter?.applyView || !this.snapshot.ready) return { success: false, message: "Navigation is unavailable for this viewer" };
    this.setFollowing(null); this.applyController?.abort();
    const controller = new AbortController(); this.applyController = controller;
    const generation = this.generation;
    const previousView = this.view;
    try {
      const result = await this.adapter.applyView({ address: anchor.address }, controller.signal);
      if (controller.signal.aborted || generation !== this.generation || this.disposed) return { success: false, message: "Navigation was superseded" };
      if (result.success) { if (this.view === previousView) this.view = { address: anchor.address }; this.send(); void this.project(); }
      else this.fail(result.message ?? "The comment's location could not be reached");
      return result;
    } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Navigation failed" }; }
  }
  private async project(): Promise<void> {
    this.projectionController?.abort();
    const controller = new AbortController(); this.projectionController = controller;
    const adapter = this.adapter; const generation = this.generation;
    if (!adapter || !this.snapshot.ready || !this.connected) { this.change({ pointers: {}, anchors: {} }); return; }
    try {
      const pointers = await Promise.all(this.peers.filter((peer) => peer.revision === this.revision && peer.pointer && adapter.projectPointer).map(async (peer) => [peer.id, await adapter.projectPointer!(peer.pointer!, controller.signal)] as const));
      const anchors = await Promise.all(this.comments.filter((comment) => comment.anchor.revision === this.revision && this.allowedAddress(comment.anchor.address) && adapter.projectAnchor).map(async (comment) => [comment.id, await adapter.projectAnchor!(comment.anchor.address, controller.signal)] as const));
      if (controller.signal.aborted || this.disposed || generation !== this.generation) return;
      this.change({ pointers: Object.fromEntries(pointers), anchors: Object.fromEntries(anchors) });
    } catch (error) { if (!controller.signal.aborted) this.fail(error instanceof Error ? error.message : "Viewer positions are unavailable"); }
  }
  dispose(): void { this.abort(); this.adapter = null; this.disposed = true; ++this.generation; this.listeners.clear(); }
}
