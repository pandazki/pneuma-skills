import type { ViewerAddress, ViewerActionResult } from "../../../core/types/viewer-contract.js";
import type { CollaborationJsonObject, ViewerCollaborationAdapter, ViewerCollaborationBinding, ViewerProjection, ViewerViewState } from "../../../core/types/viewer-collaboration.js";
import { isViewerViewState } from "../../../core/types/viewer-collaboration.js";
import { pageFromUrl } from "./page-document.js";

export interface WebcraftViewEnvironment {
  frame(): HTMLIFrameElement | null;
  overlay(): HTMLElement | null;
  current(): { contentSet: string | null; page: string; viewport: string; pages: string[] };
  resourceUrl(path: string): string;
  /** Mode-local view changes only. This callback must not select or write content. */
  show(address: ViewerAddress, viewport: string): void;
  /** The same semantic resolver used by the mode's ordinary navigateRequest. */
  navigate(address: ViewerAddress, signal: AbortSignal): Promise<ViewerActionResult>;
  navigating(href: string): void;
  loaded(page: string, href: string, nonce: string): void;
  leaving?(): void;
  unavailable?(message: string): void;
}
const CHANNEL = "pneuma-webcraft-page";
const PRESETS = new Set(["full", "mobile", "tablet", "desktop"]);

export function webcraftView(view: ViewerViewState): { contentSet: string | null; page: string; query: string; hash: string; viewport: string; scroll: { x: number; y: number } } | null {
  if (!isViewerViewState(view)) return null;
  const { page, contentSet } = view.address;
  const detail = view.detail ?? {};
  const scroll = detail.scroll as CollaborationJsonObject | undefined;
  const viewport = detail.viewport ?? "full";
  if (typeof page !== "string" || !page || page.startsWith("/") || page.split("/").some((part) => !part || part === "." || part === "..")
    || contentSet !== undefined && contentSet !== null && (typeof contentSet !== "string" || !contentSet || contentSet.split("/").some((part) => !part || part === "." || part === ".."))
    || typeof viewport !== "string" || !PRESETS.has(viewport)
    || typeof detail.query !== "string" && detail.query !== undefined || typeof detail.hash !== "string" && detail.hash !== undefined
    || detail.query && !String(detail.query).startsWith("?") || detail.hash && !String(detail.hash).startsWith("#")
    || !scroll || typeof scroll.x !== "number" || typeof scroll.y !== "number" || !Number.isFinite(scroll.x) || !Number.isFinite(scroll.y)) return null;
  return { contentSet: contentSet as string | null ?? null, page, query: String(detail.query ?? ""), hash: String(detail.hash ?? ""), viewport, scroll: { x: scroll.x, y: scroll.y } };
}

/** Translate page viewport CSS pixels into the mounted viewer overlay, including device scaling. */
export function projectWebcraftPoint(point: ViewerProjection, frame: Pick<HTMLIFrameElement, "getBoundingClientRect" | "clientWidth" | "clientHeight">, overlay: Pick<HTMLElement, "getBoundingClientRect">): ViewerProjection {
  if (point.status !== "visible") return point;
  const frameRect = frame.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  if (frame.clientWidth <= 0 || frame.clientHeight <= 0) return { status: "unresolved" };
  const x = frameRect.left - overlayRect.left + point.x * frameRect.width / frame.clientWidth;
  const y = frameRect.top - overlayRect.top + point.y * frameRect.height / frame.clientHeight;
  return x < 0 || y < 0 || x > overlayRect.width || y > overlayRect.height ? { status: "offscreen" } : { status: "visible", x, y };
}

/** One mounted viewer/document generation. Works with same-origin and opaque pages. */
export class WebcraftCollaborationController {
  readonly adapter: ViewerCollaborationAdapter;
  private binding?: ViewerCollaborationBinding;
  private unregister?: () => void;
  private document: { nonce: string; href: string; frame: Window } | null = null;
  private disposed = false;
  private loadedFrame: HTMLIFrameElement | null = null;
  private readyDeadline: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private helloId = 0;
  private pending = new Map<string, { resolve(value: Record<string, unknown>): void; cancel(): void }>();
  private arrivals = new Set<() => void>();
  private followGeneration = 0;
  private applying = false;
  private application: AbortController | null = null;
  private lastView: ViewerViewState | null = null;
  constructor(private environment: WebcraftViewEnvironment, binding?: ViewerCollaborationBinding, private readonly readyTimeoutMs = 5000) {
    this.binding = binding;
    this.adapter = { applyView: (view, signal) => this.apply(view, signal),
      projectPointer: (pointer, signal) => this.project(pointer, signal),
      projectAnchor: (address, signal) => this.project({ address: address as CollaborationJsonObject }, signal) };
    window.addEventListener("message", this.onMessage);
    this.unregister = binding?.register(this.adapter);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.followGeneration++;
    this.application?.abort();
    this.unregister?.();
    window.removeEventListener("message", this.onMessage);
    for (const entry of this.pending.values()) entry.cancel();
    for (const arrival of this.arrivals) arrival();
    this.arrivals.clear(); this.document = null;
    if (this.readyDeadline) clearTimeout(this.readyDeadline); this.readyDeadline = null;
  }
  /** Native load establishes eligibility; layout changes can only recheck that document. */
  frameLoaded(nativeLoad = false): void {
    const frame = this.environment.frame();
    if (!frame || this.disposed) return;
    if (nativeLoad) { this.frameLeaving(); this.loadedFrame = frame; }
    if (this.loadedFrame !== frame) return;
    if (!this.document && !this.readyDeadline) this.readyDeadline = setTimeout(() => {
      if (this.disposed || this.loadedFrame !== frame || this.document) return;
      this.frameLeaving(); this.environment.unavailable?.("This page did not provide its interaction bridge. Return to the site to select or address its content.");
    }, this.readyTimeoutMs);
    this.helloId = ++this.sequence; this.send({ type: "hello", helloId: this.helloId }, false);
  }
  frameLeaving(): void {
    this.document = null; this.loadedFrame = null;
    if (this.readyDeadline) clearTimeout(this.readyDeadline); this.readyDeadline = null;
    this.helloId = 0;
    for (const entry of this.pending.values()) entry.cancel();
    this.binding?.reportPointer(null);
    this.binding?.invalidateProjection();
  }
  localInput(): void {
    this.followGeneration++; this.applying = false;
    this.application?.abort();
    if (this.lastView) this.binding?.reportView(this.lastView, "local-input");
  }
  invalidate(): void { this.binding?.invalidateProjection(); }
  /** Verified page URL, including opaque-page history updates. Never a transport credential. */
  get pageHref(): string | null { return this.document?.href ?? null; }
  /** Fine address navigation completes through the existing Viewer locator acknowledgement. */
  async navigateAnchor(address: ViewerAddress, signal?: AbortSignal, cause: "local-input" | "follow" = "local-input"): Promise<ViewerActionResult> {
    const response = await this.request("navigate", { address, cause }, signal);
    return response.result as ViewerActionResult ?? { success: false, message: response.error ? String(response.error) : "The addressed page is unavailable" };
  }
  private send(message: Record<string, unknown>, needsNonce = true): void {
    const frame = this.environment.frame()?.contentWindow;
    if (!frame || this.disposed || needsNonce && !this.document) return;
    frame.postMessage({ channel: CHANNEL, ...(needsNonce ? { nonce: this.document!.nonce } : {}), ...message }, "*");
  }
  private configure(): void {
    const document = this.document;
    const frame = this.environment.frame();
    if (!document || !frame || this.loadedFrame !== frame) return;
    const current = this.environment.current();
    const prefix = current.contentSet ? `${current.contentSet}/` : "";
    const root = this.environment.resourceUrl(prefix);
    const page = pageFromUrl(document.href, root);
    if (!page || !current.pages.includes(page)) {
      this.frameLeaving(); this.environment.unavailable?.("This page is outside the published site. Return to the site to select or address its content."); return;
    }
    if (this.readyDeadline) clearTimeout(this.readyDeadline); this.readyDeadline = null;
    this.send({ type: "configure", address: { ...(current.contentSet ? { contentSet: current.contentSet } : {}), page }, root });
    this.environment.loaded(page, document.href, document.nonce);
    for (const arrival of this.arrivals) arrival();
  }
  private onMessage = (event: MessageEvent): void => {
    const message = event.data;
    const frame = this.environment.frame();
    if (this.disposed || !frame?.contentWindow || event.source !== frame.contentWindow || message?.channel !== CHANNEL) return;
    if (message.type === "ready" && this.helloId !== 0 && message.helloId === this.helloId && typeof message.nonce === "string" && typeof message.href === "string") {
      if (this.document?.nonce !== message.nonce) for (const entry of this.pending.values()) entry.cancel();
      this.document = { nonce: message.nonce, href: message.href, frame: frame.contentWindow };
      this.configure(); return;
    }
    if (!this.document || this.document.nonce !== message.nonce) return;
    if (message.type === "leaving") { this.frameLeaving(); this.environment.leaving?.(); return; }
    if (message.type === "result" && typeof message.requestId === "string") {
      this.pending.get(message.requestId)?.resolve(message); return;
    }
    if (message.type === "view" && isViewerViewState(message.view)) {
      const view = { ...message.view, detail: { ...message.view.detail, viewport: this.environment.current().viewport } };
      if (!webcraftView(view)) return;
      const href = new URL(this.document.href);
      href.search = String(view.detail.query ?? ""); href.hash = String(view.detail.hash ?? "");
      this.document.href = href.href;
      this.lastView = view;
      if (message.cause === "local-input") this.localInput();
      this.binding?.reportView(view, this.applying || message.cause === "follow" ? "follow" : message.cause === "local-input" ? "local-input" : "content-refresh");
      for (const arrival of this.arrivals) arrival();
    } else if (message.type === "pointer") this.binding?.reportPointer(message.pointer);
    else if (message.type === "invalidate") this.binding?.invalidateProjection();
  };
  private request(type: string, value: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      if (this.disposed || signal?.aborted || !this.document) { resolve({ cancelled: true }); return; }
      const requestId = String(++this.sequence);
      const finish = (message: Record<string, unknown>) => {
        clearTimeout(timer); signal?.removeEventListener("abort", cancel); this.pending.delete(requestId); resolve(message);
      };
      const cancel = () => finish({ cancelled: true });
      const timer = setTimeout(() => finish({ error: "Page did not acknowledge the request" }), 5000);
      this.pending.set(requestId, { resolve: finish, cancel });
      signal?.addEventListener("abort", cancel, { once: true });
      this.send({ type, requestId, ...value });
    });
  }
  private waitForPage(href: string, viewport: string, signal: AbortSignal, generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.disposed || signal.aborted || generation !== this.followGeneration) { finish(false); return; }
        const document = this.document;
        const frame = this.environment.frame();
        if (document?.href === href && document.frame === frame?.contentWindow && this.environment.current().viewport === viewport && frame?.getAttribute("aria-busy") !== "true") finish(true);
      };
      const finish = (ready: boolean) => { clearTimeout(timer); this.arrivals.delete(check); signal.removeEventListener("abort", check); resolve(ready); };
      const timer = setTimeout(() => finish(false), 5000);
      this.arrivals.add(check); signal.addEventListener("abort", check, { once: true }); check();
    });
  }
  private async apply(view: ViewerViewState, externalSignal: AbortSignal): Promise<ViewerActionResult> {
    if (this.disposed || externalSignal.aborted) return { success: false, message: "Following was cancelled" };
    const generation = ++this.followGeneration;
    this.application?.abort();
    this.application = new AbortController();
    const signal = AbortSignal.any([externalSignal, this.application.signal]);
    this.applying = true;
    if (isViewerViewState(view) && view.detail === undefined) {
      let result: ViewerActionResult;
      try { result = await this.environment.navigate(view.address, signal); }
      catch (failure) { result = { success: false, message: failure instanceof Error ? failure.message : "Address navigation failed" }; }
      if (generation === this.followGeneration) this.applying = false;
      return this.disposed || signal.aborted || generation !== this.followGeneration ? { success: false, message: "Navigation was cancelled" } : result;
    }
    const target = webcraftView(view);
    if (!target) { this.applying = false; return { success: false, message: "Unsupported Webcraft view state" }; }
    try { this.environment.show(view.address, target.viewport); }
    catch (failure) { this.applying = false; return { success: false, message: failure instanceof Error ? failure.message : "This site has no requested page" }; }
    const path = `${target.contentSet ? `${target.contentSet}/` : ""}${target.page}`;
    const href = this.environment.resourceUrl(path) + target.query + target.hash;
    const frame = this.environment.frame();
    if (!frame) { this.applying = false; return { success: false, message: "The preview frame is unavailable" }; }
    if (this.document?.href !== href) {
      this.environment.navigating(href);
      this.frameLeaving(); frame.setAttribute("aria-busy", "true"); frame.src = href;
    }
    const ready = await this.waitForPage(href, target.viewport, signal, generation);
    if (!ready) { if (generation === this.followGeneration) this.applying = false; return { success: false, message: signal.aborted || generation !== this.followGeneration ? "Following was cancelled" : "The requested page did not become ready" }; }
    const response = await this.request("apply", { scroll: target.scroll }, signal);
    if (generation === this.followGeneration) this.applying = false;
    if (this.disposed || signal.aborted || generation !== this.followGeneration || response.cancelled) return { success: false, message: "Following was cancelled" };
    if (response.error) return { success: false, message: String(response.error) };
    return response.result as ViewerActionResult ?? { success: false, message: "Missing page acknowledgement" };
  }
  private async project(value: CollaborationJsonObject, signal?: AbortSignal): Promise<ViewerProjection> {
    const document = this.document;
    const response = await this.request("project", { value }, signal);
    const frame = this.environment.frame(); const overlay = this.environment.overlay();
    if (this.disposed || signal?.aborted || document !== this.document || !frame || !overlay) return { status: "unresolved" };
    const point = response.projection as ViewerProjection | undefined;
    if (!point || !["visible", "offscreen", "unresolved"].includes(point.status)) return { status: "unresolved" };
    if (point.status === "visible" && (!Number.isFinite(point.x) || !Number.isFinite(point.y))) return { status: "unresolved" };
    return projectWebcraftPoint(point, frame, overlay);
  }
}
