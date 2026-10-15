/** Mode semantics for collaboration. No transport, credentials or session state. */
import type { ViewerActionResult, ViewerAddress } from "./viewer-contract.js";

export type CollaborationJsonValue = null | boolean | number | string
  | CollaborationJsonValue[] | { [key: string]: CollaborationJsonValue };
export type CollaborationJsonObject = { [key: string]: CollaborationJsonValue };

/** Pure manifest data. Declaring support does not register a mounted adapter. */
export interface ViewerCollaborationDeclaration {
  viewing: true;
  pointers?: true;
  follow?: true;
  addressAnchors?: true;
  publication: {
    /** Mode-relative module exporting a ModePublicationAdapter; no React. */
    module: string;
    /** Mode-owned public Source schema, independent of transport placement. */
    schema: string;
  };
}

export interface ViewerViewState {
  address: ViewerAddress;
  /** Mode-owned JSON: scroll anchor, camera, playhead, viewport, etc. */
  detail?: CollaborationJsonObject;
}

/** Coordinates are CSS pixels relative to the mounted viewer's overlay. */
export type ViewerProjection = { status: "visible"; x: number; y: number }
  | { status: "offscreen" | "unresolved" };

export interface ViewerCollaborationAdapter {
  /** Remote navigation must not edit content, select for an Agent or echo intent. */
  applyView?(view: ViewerViewState, signal: AbortSignal): Promise<ViewerActionResult>;
  projectPointer?(pointer: CollaborationJsonObject, signal?: AbortSignal): ViewerProjection | Promise<ViewerProjection>;
  projectAnchor?(address: ViewerAddress, signal?: AbortSignal): ViewerProjection | Promise<ViewerProjection>;
}

/** One binding per mounted view; the shell supplies identity and current revision. */
export interface ViewerCollaborationBinding {
  readonly viewerInstanceId: string;
  /** Disposal aborts pending applications and invalidates this mount's callbacks. */
  register(adapter: ViewerCollaborationAdapter): () => void;
  reportView(view: ViewerViewState, cause: "local-input" | "follow" | "content-refresh"): void;
  reportPointer(pointer: CollaborationJsonObject | null): void;
  /** Call after scroll, layout, resize or content changes alter projection. */
  invalidateProjection(): void;
}

/** ACLs are separate from readonly (replay) and editing (Session lifecycle). */
export interface ViewerPermissions {
  editContent: boolean;
  notifyAgent: boolean;
  export: boolean;
}

/** Reject non-JSON, cycles and unbounded mode payloads at runtime boundaries. */
export function isCollaborationJson(value: unknown, maxBytes = 32 * 1024): value is CollaborationJsonValue {
  const ancestors = new Set<object>();
  let nodes = 0;
  function visit(current: unknown, depth: number): boolean {
    if (++nodes > 4096 || depth > 16) return false;
    if (current === null || typeof current === "boolean" || typeof current === "string") return true;
    if (typeof current === "number") return Number.isFinite(current);
    if (typeof current !== "object" || ancestors.has(current)) return false;
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) return false;
    ancestors.add(current);
    const valid = Array.isArray(current)
      ? current.every((entry) => visit(entry, depth + 1))
      : Object.entries(current).every(([key, entry]) => key !== "__proto__" && key !== "constructor"
        && key !== "prototype" && visit(entry, depth + 1));
    ancestors.delete(current);
    return valid;
  }
  if (!visit(value, 0)) return false;
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxBytes;
}

export function isViewerViewState(value: unknown): value is ViewerViewState {
  if (!isCollaborationJson(value) || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const { address, detail } = value;
  return !!address && typeof address === "object" && !Array.isArray(address)
    && (detail === undefined || !!detail && typeof detail === "object" && !Array.isArray(detail));
}
