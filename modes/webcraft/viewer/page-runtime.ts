import { buildSelectionScript } from "../../../core/iframe-selection/index.js";
import { elementBody } from "./page-document.js";

/** Runs inside a page, including an opaque sandbox. No room or transport knowledge. */
function installWebcraftPageRuntime() {
  const runtimeWindow = window as Window & { __pneumaWebcraftPage?: boolean };
  if (runtimeWindow.__pneumaWebcraftPage) return;
  runtimeWindow.__pneumaWebcraftPage = true;
  const channel = "pneuma-webcraft-page";
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let address: Record<string, unknown> | null = null;
  let root = "";
  let cause: "local-input" | "follow" | "content-refresh" = "content-refresh";
  let pointer: { x: number; y: number; target: Element | null } | null = null;
  const send = (message: Record<string, unknown>) => parent.postMessage({ channel, nonce, ...message }, "*");
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const selector = (target: Element): string => {
    const parts: string[] = [];
    let element: Element | null = target;
    while (element && element !== document.documentElement && parts.length < 12) {
      if (element.id) { parts.unshift(`#${CSS.escape(element.id)}`); break; }
      const tag = element.tagName.toLowerCase();
      const siblings: Element[] = element.parentElement ? Array.from(element.parentElement.children).filter((s) => s.tagName === element!.tagName) : [];
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(element) + 1})`);
      element = element.parentElement;
    }
    return parts.join(" > ");
  };
  function currentAddress(): Record<string, unknown> | null {
    if (!address) return null;
    try {
      const base = new URL(root);
      const here = new URL(location.href);
      if (here.origin !== base.origin || !here.pathname.startsWith(base.pathname)) return null;
      let page = decodeURIComponent(here.pathname.slice(base.pathname.length));
      if (!page || page.endsWith("/")) page += "index.html";
      return { ...address, page, query: here.search, hash: here.hash };
    } catch { return null; }
  }
  function state() {
    return { address: currentAddress(), detail: { query: location.search, hash: location.hash,
      scroll: { x: scrollX, y: scrollY }, width: innerWidth, height: innerHeight } };
  }
  function reportPointer() {
    const current = currentAddress();
    if (!pointer || !current) { send({ type: "pointer", pointer: null }); return; }
    const point: Record<string, unknown> = { address: current, x: pointer.x + scrollX, y: pointer.y + scrollY, width: innerWidth };
    if (pointer.target && !pointer.target.closest("[data-pneuma-preview],[data-pneuma-overlay]")) {
      const rect = pointer.target.getBoundingClientRect();
      point.address = { ...current, selector: selector(pointer.target) };
      point.offsetX = rect.width ? (pointer.x - rect.left) / rect.width : .5;
      point.offsetY = rect.height ? (pointer.y - rect.top) / rect.height : .5;
    }
    send({ type: "pointer", pointer: point });
  }
  function report() {
    const view = state();
    if (view.address) send({ type: "view", view, cause });
    send({ type: "invalidate" });
    reportPointer();
    cause = "content-refresh";
  }
  function project(value: Record<string, unknown>) {
    const targetAddress = (value.address ?? value) as Record<string, unknown>;
    const current = currentAddress();
    if (!current || targetAddress.page !== current.page || (targetAddress.contentSet ?? null) !== (current.contentSet ?? null)) return { status: "unresolved" };
    if (targetAddress.query !== undefined) {
      if (typeof targetAddress.query !== "string") return { status: "unresolved" };
      // Use the same URL.search normalization as address navigation.
      const target = new URL(location.href);
      target.search = targetAddress.query;
      if (target.search !== location.search) return { status: "unresolved" };
    }
    let x: number, y: number;
    if (typeof targetAddress.selector === "string") {
      let element: Element | null;
      try { element = document.querySelector(targetAddress.selector); } catch { return { status: "unresolved" }; }
      if (!element || element.closest("[data-pneuma-preview],[data-pneuma-overlay]")) return { status: "unresolved" };
      if (typeof targetAddress.quote === "string" && !(element.textContent ?? "").replace(/\s+/g, " ").includes(targetAddress.quote)) return { status: "unresolved" };
      const rect = element.getBoundingClientRect();
      const ox = finite(value.offsetX) ? value.offsetX : finite(targetAddress.offsetX) ? targetAddress.offsetX : .5;
      const oy = finite(value.offsetY) ? value.offsetY : finite(targetAddress.offsetY) ? targetAddress.offsetY : .5;
      x = rect.left + rect.width * Math.max(0, Math.min(1, ox));
      y = rect.top + rect.height * Math.max(0, Math.min(1, oy));
    } else if (finite(value.x) && finite(value.y) && value.width === innerWidth) {
      x = value.x - scrollX; y = value.y - scrollY;
    } else return { status: "unresolved" };
    return x < 0 || y < 0 || x > innerWidth || y > innerHeight ? { status: "offscreen" } : { status: "visible", x, y };
  }
  addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== parent || message?.channel !== channel || message.nonce !== nonce) return;
    if (message.type === "configure") {
      address = message.address; root = message.root;
      report();
    } else if (message.type === "apply") {
      const scroll = message.scroll;
      if (!scroll || !finite(scroll.x) || !finite(scroll.y)) { send({ type: "result", requestId: message.requestId, result: { success: false, message: "Invalid scroll state" } }); return; }
      cause = "follow";
      scrollTo({ left: scroll.x, top: scroll.y, behavior: "instant" });
      report();
      send({ type: "result", requestId: message.requestId, result: { success: true } });
    } else if (message.type === "project") {
      send({ type: "result", requestId: message.requestId, projection: project(message.value ?? {}) });
    } else if (message.type === "navigate") {
      const target = message.address;
      const current = currentAddress();
      let element: Element | null = null;
      if (current && target?.page === current.page && (target.contentSet ?? null) === (current.contentSet ?? null)) {
        try {
          if (typeof target.selector === "string") element = document.querySelector(target.selector);
          else if (typeof target.anchor === "string") element = document.getElementById(target.anchor.replace(/^#/, ""));
        } catch { /* Invalid selectors are unresolved addresses. */ }
      }
      if (!element || element.closest("[data-pneuma-preview],[data-pneuma-overlay]")) {
        send({ type: "result", requestId: message.requestId, result: { success: false, message: "This page no longer contains the addressed element" } });
      } else {
        cause = message.cause === "follow" ? "follow" : "local-input";
        element.scrollIntoView({ block: "center", behavior: "instant" });
        // Reuse the selection overlay without selecting content or notifying the host.
        dispatchEvent(new MessageEvent("message", { source: parent, data: { type: "pneuma:navigationHighlight", doc: nonce, selector: target.selector, anchor: target.anchor } }));
        report();
        send({ type: "result", requestId: message.requestId, result: { success: true } });
      }
    } else if (message.type === "reload") location.reload();
  });
  for (const eventName of ["pointerdown", "wheel", "keydown"] as const) addEventListener(eventName, () => {
    cause = "local-input";
    const view = state();
    if (view.address) send({ type: "view", view, cause });
  }, { capture: true, passive: true });
  window.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY, target: event.target instanceof Element ? event.target : null }; reportPointer(); }, { passive: true });
  window.addEventListener("pointerout", (event) => { if (!event.relatedTarget) { pointer = null; reportPointer(); } });
  for (const eventName of ["scroll", "resize", "hashchange", "popstate"] as const) addEventListener(eventName, report, { passive: true });
  new MutationObserver(() => send({ type: "invalidate" })).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  addEventListener("pagehide", () => send({ type: "leaving" }));
  send({ type: "ready", href: location.href });
  // A postMessage handshake also works when the first ready raced the parent mount.
  addEventListener("message", (event) => { if (event.source === parent && event.data?.channel === channel && event.data?.type === "hello") send({ type: "ready", href: location.href, helloId: event.data.helloId }); });
}

export function buildWebcraftPageRuntimeScript(): string {
  return `(${installWebcraftPageRuntime.toString()})();`;
}

/** Public pages keep selection for comment addresses; authoring scripts are absent. */
export function buildWebcraftPublicPageScript(): string {
  return `${elementBody(buildSelectionScript())}\n${buildWebcraftPageRuntimeScript()}`;
}
