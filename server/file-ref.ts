import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { ContentBlock } from "./session-types.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import { getBackendModule } from "../backends/index.js";

/** Image extensions whose paths in tool-result text get a thumbnail in the chat. */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

/**
 * Absolute-path token ending in an image extension. Permissive on the path
 * chars (any non-quote, non-whitespace run) so paths embedded in JSON values
 * like `"path":"/Users/…/foo.png"` still match cleanly. The trailing
 * extension capture is what gates the match.
 */
const ABSOLUTE_IMAGE_PATH_RE = /\/[^\s"'`<>(){}\[\]|]+?\.(png|jpe?g|gif|webp|svg)\b/gi;

/**
 * Mutates `content` in place. Two stamps in one pass:
 *
 *   - `tool_use` blocks → `block.fileRef = { path, kind }`, via the backend's
 *     `toolFileRef` resolver (file-touching tools like Read/Write/Edit).
 *   - `tool_result` blocks → `block.fileRefs = [{ path, kind: "output" }]`,
 *     by scanning the result text for absolute image paths inside `workspace`
 *     (and only paths that actually exist on disk — drops stale or
 *     hypothetical paths the agent might have echoed). `workspace` is
 *     optional; the result scan no-ops when it's not supplied.
 *
 * Called on every assistant-message broadcast from each backend's bridge so
 * the chat UI reads a single normalized field regardless of which agent
 * produced the message.
 */
export function stampFileRefs(
  content: ContentBlock[],
  backendType: AgentBackendType,
  workspace?: string,
): void {
  let resolve: ((name: string, input: Record<string, unknown>) => { path: string; kind: "read" | "write" | "edit" } | undefined) | undefined;
  try {
    resolve = getBackendModule(backendType).toolFileRef;
  } catch {
    return; // unknown backend type — nothing to stamp
  }
  for (const block of content) {
    if (block.type === "tool_use" && resolve) {
      const ref = resolve(block.name, block.input);
      if (ref) block.fileRef = ref;
      continue;
    }
    if (block.type === "tool_result" && workspace) {
      const refs = scanToolResultForImageRefs(block.content, workspace);
      if (refs.length > 0) block.fileRefs = refs;
    }
  }
}

function scanToolResultForImageRefs(
  resultContent: string | ContentBlock[],
  workspace: string,
): { path: string; kind: "output" }[] {
  const text = typeof resultContent === "string"
    ? resultContent
    : resultContent.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  if (!text) return [];

  const workspaceAbs = resolvePath(workspace);
  const seen = new Set<string>();
  const refs: { path: string; kind: "output" }[] = [];

  for (const match of text.matchAll(ABSOLUTE_IMAGE_PATH_RE)) {
    const raw = match[0];
    const ext = match[1]?.toLowerCase();
    if (!ext || !IMAGE_EXTS.has(ext)) continue;
    const abs = resolvePath(raw);
    if (seen.has(abs)) continue;
    // Workspace containment + existence check. Both matter: containment
    // stops third-party image URLs / unrelated `/etc/foo.png` mentions
    // from leaking a system-open affordance into the chat; existence
    // stops the agent's hypothetical or stale paths from rendering as
    // broken `<img>` placeholders.
    if (!abs.startsWith(workspaceAbs + "/") && abs !== workspaceAbs) continue;
    if (!existsSync(abs)) continue;
    seen.add(abs);
    refs.push({ path: abs, kind: "output" });
  }

  return refs;
}
