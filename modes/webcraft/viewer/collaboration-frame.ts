import type {
  CollaborationAnchor,
  CollaborationComment,
  CollaborationPresence,
  CollaborationView,
} from "../../../core/types/collaboration.js";

/** A small, self-contained bridge injected into the isolated web player. */
function installCollaborationFrame() {
  const FRAME = "pneuma-collab-frame";
  const HOST = "pneuma-collab-host";
  let revision = 0;
  let page = "index.html";
  let commenting = false;
  let participants: CollaborationPresence[] = [];
  let comments: CollaborationComment[] = [];
  let cursor: { x: number; y: number } | null = null;
  let pointerInViewport: { x: number; y: number } | null = null;
  let configured = false;
  let overlay: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  let renderPending = false;
  const cursorNodes = new Map<string, HTMLDivElement>();
  const commentNodes = new Map<string, HTMLButtonElement>();

  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const safeColor = (color: unknown) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : "#f97316";
  const send = (message: Record<string, unknown>) => parent.postMessage({ channel: FRAME, ...message }, "*");
  const view = (): CollaborationView => ({
    page, revision,
    scrollX: window.scrollX, scrollY: window.scrollY,
    width: window.innerWidth, height: window.innerHeight,
    documentWidth: Math.max(document.documentElement.scrollWidth, window.innerWidth),
    documentHeight: Math.max(document.documentElement.scrollHeight, window.innerHeight),
  });

  function selectorFor(element: Element): string {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement && parts.length < 8) {
      if (current.id) { parts.unshift(`#${CSS.escape(current.id)}`); break; }
      const tag = current.tagName.toLowerCase();
      const siblings: Element[] = current.parentElement ? Array.from(current.parentElement.children).filter((s) => s.tagName === current!.tagName) : [];
      parts.unshift(`${tag}:nth-of-type(${Math.max(1, siblings.indexOf(current) + 1)})`);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function resolveAnchor(anchor: CollaborationAnchor): { x: number; y: number; stale: boolean } {
    const address = anchor.address;
    const selector = typeof address?.selector === "string" ? address.selector : null;
    if (selector) {
      try {
        const target = document.querySelector(selector);
        if (target && !overlay?.contains(target)) {
          const rect = target.getBoundingClientRect();
          const rx = finite(address.offsetX) ? Math.max(0, Math.min(1, address.offsetX)) : 0.5;
          const ry = finite(address.offsetY) ? Math.max(0, Math.min(1, address.offsetY)) : 0.5;
          const text = (target.textContent ?? "").replace(/\s+/g, " ").trim();
          return {
            x: rect.left + window.scrollX + rect.width * rx,
            y: rect.top + window.scrollY + rect.height * ry,
            stale: Boolean(anchor.quote && !text.includes(anchor.quote)),
          };
        }
      } catch { /* An obsolete selector retains its original position. */ }
    }
    return { x: finite(anchor.x) ? anchor.x : 0, y: finite(anchor.y) ? anchor.y : 0, stale: Boolean(selector) };
  }

  function renderOverlays() {
    renderPending = false;
    if (!shadow) return;
    const visibleCursors = new Set<string>();
    const visibleComments = new Set<string>();
    const ownView = view();
    for (const participant of participants) {
      if (!participant.cursor || !participant.view || participant.view.page !== page || participant.view.revision !== revision) continue;
      const remote = participant.view;
      const sameLayout = ownView.width === remote.width;
      const x = participant.cursor.x * (sameLayout ? 1 : ownView.documentWidth / Math.max(1, remote.documentWidth)) - window.scrollX;
      const y = participant.cursor.y * (sameLayout ? 1 : ownView.documentHeight / Math.max(1, remote.documentHeight)) - window.scrollY;
      if (!finite(x) || !finite(y) || x < -30 || y < -30 || x > window.innerWidth + 30 || y > window.innerHeight + 30) continue;
      visibleCursors.add(participant.id);
      let node = cursorNodes.get(participant.id);
      if (!node) {
        node = document.createElement("div");
        node.dataset.cursor = participant.id;
        node.className = "cursor";
        const arrow = document.createElement("span");
        arrow.className = "arrow";
        const label = document.createElement("span");
        label.className = "label";
        node.append(arrow, label);
        cursorNodes.set(participant.id, node);
        shadow.append(node);
      }
      node.style.transform = `translate(${x}px, ${y}px)`;
      node.style.setProperty("--participant-color", safeColor(participant.color));
      node.querySelector(".label")!.textContent = participant.name.slice(0, 60);
    }
    for (const comment of comments) {
      if (comment.status !== "open" || comment.anchor.address?.page !== page) continue;
      const position = resolveAnchor(comment.anchor);
      visibleComments.add(comment.id);
      let node = commentNodes.get(comment.id);
      if (!node) {
        node = document.createElement("button");
        node.dataset.comment = comment.id;
        node.className = "pin";
        node.type = "button";
        node.addEventListener("click", (event) => {
          event.preventDefault(); event.stopPropagation();
          send({ type: "thread", commentId: comment.id });
        });
        commentNodes.set(comment.id, node);
        shadow.append(node);
      }
      node.dataset.stale = String(position.stale);
      node.style.transform = `translate(${position.x - window.scrollX}px, ${position.y - window.scrollY}px)`;
      node.textContent = String(comments.indexOf(comment) + 1);
      const message = comment.messages[0];
      node.title = `${position.stale ? "Original location changed. " : ""}${message?.authorName ?? "Comment"}: ${message?.body ?? ""}`;
      node.setAttribute("aria-label", node.title);
    }
    for (const [id, node] of cursorNodes) if (!visibleCursors.has(id)) { node.remove(); cursorNodes.delete(id); }
    for (const [id, node] of commentNodes) if (!visibleComments.has(id)) { node.remove(); commentNodes.delete(id); }
  }

  function scheduleRender() {
    if (!renderPending) { renderPending = true; requestAnimationFrame(renderOverlays); }
  }

  function moveTo(next: CollaborationView) {
    if (next.page !== page || next.revision !== revision || !finite(next.scrollX) || !finite(next.scrollY)) return;
    const own = view();
    // Equal canonical widths preserve the same responsive layout. If the host
    // uses another size, retain relative scroll progress as a bounded fallback.
    const maxX = Math.max(0, own.documentWidth - own.width);
    const maxY = Math.max(0, own.documentHeight - own.height);
    const sourceMaxX = Math.max(0, next.documentWidth - next.width);
    const sourceMaxY = Math.max(0, next.documentHeight - next.height);
    const x = own.width === next.width ? next.scrollX : sourceMaxX ? next.scrollX / sourceMaxX * maxX : 0;
    const y = own.width === next.width ? next.scrollY : sourceMaxY ? next.scrollY / sourceMaxY * maxY : 0;
    window.scrollTo({ left: Math.max(0, Math.min(maxX, x)), top: Math.max(0, Math.min(maxY, y)), behavior: "instant" });
    scheduleRender();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || event.data.channel !== HOST) return;
    const data = event.data;
    if (data.type === "configure") {
      if (!finite(data.revision) || typeof data.page !== "string" || data.page.length > 1024) return;
      revision = data.revision;
      page = data.page;
      commenting = data.commenting === true;
      configured = true;
      document.documentElement.style.cursor = commenting ? "crosshair" : "";
      if (data.restoreView) moveTo({ ...data.restoreView, revision, page });
      send({ type: "view", view: view() });
      scheduleRender();
    } else if (data.type === "follow" && data.view) {
      moveTo(data.view);
    } else if (data.type === "overlays") {
      participants = Array.isArray(data.participants) ? data.participants.filter((p: CollaborationPresence) => p && p.id !== data.selfId).slice(0, 100) : [];
      comments = Array.isArray(data.comments) ? data.comments.filter((c: CollaborationComment) => c && c.anchor && Array.isArray(c.messages)).slice(0, 500) : [];
      scheduleRender();
    } else if (data.type === "locate" && data.anchor) {
      const position = resolveAnchor(data.anchor);
      window.scrollTo({ left: Math.max(0, position.x - window.innerWidth / 2), top: Math.max(0, position.y - window.innerHeight / 3), behavior: "smooth" });
    }
  });

  window.addEventListener("pointermove", (event) => {
    if (!configured || event.composedPath().includes(overlay!)) return;
    pointerInViewport = { x: event.clientX, y: event.clientY };
    cursor = { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY };
    send({ type: "cursor", cursor, view: view() });
  }, { passive: true });
  document.addEventListener("pointerleave", () => {
    cursor = null;
    pointerInViewport = null;
    send({ type: "cursor", cursor, view: view() });
  });
  window.addEventListener("scroll", () => {
    if (configured) send({ type: "view", view: view() });
    if (configured && pointerInViewport) {
      cursor = { x: pointerInViewport.x + window.scrollX, y: pointerInViewport.y + window.scrollY };
      send({ type: "cursor", cursor, view: view() });
    }
    scheduleRender();
  }, { passive: true });
  window.addEventListener("resize", () => {
    if (configured) send({ type: "view", view: view() });
    scheduleRender();
  });
  for (const type of ["wheel", "pointerdown", "keydown"] as const) {
    window.addEventListener(type, (event) => {
      if (event.isTrusted) send({ type: "interact" });
    }, { passive: true, capture: true });
  }
  document.addEventListener("click", (event) => {
    if (!configured || !commenting || event.composedPath().includes(overlay!)) return;
    const element = event.target;
    if (!(element instanceof Element)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const rect = element.getBoundingClientRect();
    const quote = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const anchor: CollaborationAnchor = {
      address: {
        page,
        selector: selectorFor(element),
        offsetX: rect.width ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0,
        offsetY: rect.height ? Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) : 0,
      },
      revision, x: event.clientX + window.scrollX, y: event.clientY + window.scrollY,
      ...(quote ? { quote } : {}),
    };
    send({ type: "anchor", anchor });
  }, true);

  function start() {
    overlay = document.createElement("div");
    overlay.setAttribute("data-pneuma-collaboration", "");
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "2147483647", pointerEvents: "none", overflow: "hidden",
      display: "block", margin: "0", padding: "0", border: "0", contain: "strict",
    });
    shadow = overlay.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host{all:initial}.cursor,.pin{position:absolute;left:0;top:0;font:12px system-ui,sans-serif;box-sizing:border-box}
      .cursor{pointer-events:none;white-space:nowrap}.arrow{display:block;width:0;height:0;border-left:12px solid var(--participant-color);border-top:5px solid transparent;border-bottom:14px solid transparent;filter:drop-shadow(0 1px 1px #0006);transform:rotate(-15deg)}
      .label{display:inline-block;margin:0 0 0 12px;padding:4px 7px;border-radius:4px;background:var(--participant-color);color:#111;font-weight:650;box-shadow:0 2px 8px #0002}
      .pin{appearance:none;pointer-events:auto;cursor:pointer;border:2px solid white;border-radius:50% 50% 50% 2px;background:#f97316;color:#111;width:28px;height:28px;box-shadow:0 2px 8px #0004;font-weight:700;line-height:22px;text-align:center;padding:0}
      .pin[data-stale=true]{background:#a1a1aa;border-style:dashed}.pin:focus-visible{outline:3px solid #18181b;outline-offset:2px}
    `;
    shadow.append(style);
    document.documentElement.append(overlay);
    send({ type: "ready", view: view() });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

/** No member credentials or private session data are interpolated here. */
export function buildCollaborationFrameScript(): string {
  return `(${installCollaborationFrame.toString()})();`;
}
