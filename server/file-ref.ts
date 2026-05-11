import type { ContentBlock } from "./session-types.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import { getBackendModule } from "../backends/index.js";

/**
 * Mutates `content` in place: for each `tool_use` block, if the backend's
 * `toolFileRef` recognizes it as a file op, stamp `block.fileRef`. No-op
 * when the backend doesn't implement `toolFileRef`. Called on every
 * assistant-message broadcast in each backend's bridge so the chat UI can
 * render previews / system-open actions off a single normalized field.
 */
export function stampFileRefs(content: ContentBlock[], backendType: AgentBackendType): void {
  let resolve: ((name: string, input: Record<string, unknown>) => { path: string; kind: "read" | "write" | "edit" } | undefined) | undefined;
  try {
    resolve = getBackendModule(backendType).toolFileRef;
  } catch {
    return; // unknown backend type — nothing to stamp
  }
  if (!resolve) return;
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    const ref = resolve(block.name, block.input);
    if (ref) block.fileRef = ref;
  }
}
