/**
 * Normalized reference to the file a tool call operates on. Lets the chat
 * UI render previews / system-open actions without knowing any backend's
 * tool naming — each backend's BackendModule.toolFileRef returns one of
 * these (or undefined).
 */
export interface ToolFileRef {
  path: string;
  kind: "read" | "write" | "edit";
}

/**
 * The Claude-shaped file-tool convention, also used verbatim by the Codex
 * backend (its adapter normalizes fileChange → an `Edit` tool_use with
 * `file_path`). A non-default backend overrides BackendModule.toolFileRef
 * with its own resolver when its tool naming differs.
 */
const KIND_BY_NAME: Record<string, ToolFileRef["kind"]> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  NotebookEdit: "edit",
};

export function defaultToolFileRef(
  toolName: string,
  input: Record<string, unknown>,
): ToolFileRef | undefined {
  const kind = KIND_BY_NAME[toolName];
  if (!kind) return undefined;
  const raw = input.file_path ?? input.notebook_path;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return { path: raw, kind };
}
