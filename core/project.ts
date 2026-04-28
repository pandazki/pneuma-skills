import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";

export type ProjectBackendType = "claude-code" | "codex";

export interface ProjectManifest {
  schemaVersion: 1;
  projectId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  root: string;
  deliverablePaths?: string[];
  defaultBackendType?: ProjectBackendType;
}

export interface CreateProjectOptions {
  name?: string;
  description?: string;
  now?: () => string;
  idFactory?: () => string;
}

export interface ProjectSessionManifest {
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  mode: string;
  role?: string;
  displayName: string;
  backendType: ProjectBackendType;
  status: "active" | "idle" | "archived";
  createdAt: string;
  lastAccessed: string;
  sessionWorkspace: string;
  deliverablePaths?: string[];
  sourceQuickSessionId?: string;
}

export interface ProjectHandoffDraft {
  handoffId: string;
  content: string;
}

export interface ProjectHandoff {
  handoffId: string;
  projectId: string;
  fromSessionId: string;
  toSessionId?: string;
  fromMode: string;
  toMode: string;
  createdAt: string;
  confirmedAt?: string;
  content: string;
}

export interface CreateProjectHandoffDraftOptions {
  fromSessionId: string;
  toMode: string;
  goal?: string;
  now?: () => string;
  idFactory?: () => string;
}

export interface ConfirmProjectHandoffOptions {
  handoffId: string;
  content: string;
  toSessionId?: string;
  toMode?: string;
  now?: () => string;
}

export type QuickDeliverableTransfer = "copy" | "move" | "none";

export interface UpgradeQuickSessionToProjectOptions {
  name?: string;
  description?: string;
  mode?: string;
  displayName?: string;
  backendType?: ProjectBackendType;
  role?: string;
  deliverableTransfer?: QuickDeliverableTransfer;
  copyDeliverables?: boolean;
  now?: () => string;
  projectIdFactory?: () => string;
  sessionIdFactory?: () => string;
}

export interface UpgradeQuickSessionToProjectResult {
  project: ProjectManifest;
  session: ProjectSessionManifest;
}

export interface RunProjectEvolutionOptions {
  now?: () => string;
}

export interface ProjectEvolutionResult {
  preferencesPath: string;
  sourceSessionCount: number;
  handoffCount: number;
  timelineEventCount: number;
  deliverableCount: number;
  appendedContent: string;
}

export interface CreateProjectSessionOptions {
  mode: string;
  displayName: string;
  backendType: ProjectBackendType;
  role?: string;
  now?: () => string;
  idFactory?: () => string;
}

export interface RecentProjectRecord {
  projectId: string;
  name: string;
  description?: string;
  root: string;
  lastAccessed: string;
}

export interface RecordRecentProjectOptions {
  homeDir?: string;
  now?: () => string;
  limit?: number;
}

export interface ResolveProjectRuntimeOptions {
  projectRoot: string;
  mode: string;
  displayName: string;
  backendType: ProjectBackendType;
  role?: string;
  sessionId?: string;
  handoffId?: string;
  now?: () => string;
  projectIdFactory?: () => string;
  sessionIdFactory?: () => string;
}

export interface ProjectRuntime {
  projectRoot: string;
  workspace: string;
  project: ProjectManifest;
  session: ProjectSessionManifest;
  handoff?: ProjectHandoff;
}

export interface ProjectInstructionSessionSummary {
  sessionId: string;
  mode: string;
  displayName: string;
  role?: string;
  backendType: ProjectBackendType;
  status: ProjectSessionManifest["status"];
  lastAccessed: string;
}

export interface ProjectInstructionContext {
  projectId: string;
  projectName: string;
  projectRoot: string;
  description?: string;
  role?: string;
  currentSessionId: string;
  currentMode: string;
  currentSessionDisplayName: string;
  peerSessions: ProjectInstructionSessionSummary[];
  handoff?: ProjectHandoff;
}

export type ProjectTimelineEvent =
  | { type: "project.created"; at: string; projectId: string; name: string }
  | { type: "project.updated"; at: string; changes: Record<string, unknown> }
  | { type: "session.created"; at: string; sessionId: string; mode: string; role?: string }
  | { type: "session.resumed"; at: string; sessionId: string }
  | { type: "session.upgraded"; at: string; sessionId: string; sourceWorkspace: string; sourceQuickSessionId?: string }
  | { type: "handoff.created"; at: string; handoffId: string; fromSessionId: string; toSessionId?: string }
  | { type: "project.evolved"; at: string; sourceSessionCount: number }
  | { type: "deliverable.published"; at: string; sessionId: string; paths: string[] };

export function projectPneumaDir(projectRoot: string): string {
  return join(resolve(projectRoot), ".pneuma");
}

export function projectManifestPath(projectRoot: string): string {
  return join(projectPneumaDir(projectRoot), "project.json");
}

export function projectPreferencesPath(projectRoot: string): string {
  return join(projectPneumaDir(projectRoot), "project-preferences.md");
}

export function projectTimelinePath(projectRoot: string): string {
  return join(projectPneumaDir(projectRoot), "timeline.jsonl");
}

export function projectSessionsDir(projectRoot: string): string {
  return join(projectPneumaDir(projectRoot), "sessions");
}

export function projectSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectSessionsDir(projectRoot), sessionId);
}

export function projectSessionManifestPath(projectRoot: string, sessionId: string): string {
  return join(projectSessionDir(projectRoot, sessionId), "session.json");
}

export function projectSessionWorkspace(projectRoot: string, sessionId: string): string {
  return join(projectSessionDir(projectRoot, sessionId), "workspace");
}

export function projectHandoffsDir(projectRoot: string): string {
  return join(projectPneumaDir(projectRoot), "handoffs");
}

export function projectHandoffPath(projectRoot: string, handoffId: string): string {
  if (basename(handoffId) !== handoffId || handoffId.includes(sep)) {
    throw new Error(`Invalid handoff id: ${handoffId}`);
  }
  return join(projectHandoffsDir(projectRoot), `${handoffId}.md`);
}

export function isProjectSessionWorkspace(workspace: string): boolean {
  const resolvedWorkspace = resolve(workspace);
  if (basename(resolvedWorkspace) !== "workspace") return false;

  const sessionDir = dirname(resolvedWorkspace);
  const sessionsDir = dirname(sessionDir);
  const pneumaDir = dirname(sessionsDir);
  if (basename(sessionsDir) !== "sessions" || basename(pneumaDir) !== ".pneuma") return false;

  return existsSync(join(pneumaDir, "project.json")) && existsSync(join(sessionDir, "session.json"));
}

export function recentProjectsRegistryPath(homeDir = homedir()): string {
  return join(homeDir, ".pneuma", "projects.json");
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultProjectId(): string {
  return `project_${crypto.randomUUID()}`;
}

function defaultSessionId(mode: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${mode}-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function defaultHandoffId(fromMode: string, toMode: string, now: string): string {
  const stamp = now.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${fromMode}-to-${toMode}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
}

function parseFrontmatter(content: string): { fields: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fields: {}, body: content };

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }
  return { fields, body: match[2] };
}

function upsertFrontmatterFields(content: string, fields: Record<string, string | undefined>): string {
  const parsed = parseFrontmatter(content);
  const merged: Record<string, string> = { ...parsed.fields };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) merged[key] = value;
  }

  const orderedKeys = [
    "handoffId",
    "projectId",
    "fromSessionId",
    "toSessionId",
    "fromMode",
    "toMode",
    "createdAt",
    "confirmedAt",
  ];
  const remainingKeys = Object.keys(merged).filter((key) => !orderedKeys.includes(key)).sort();
  const frontmatter = [...orderedKeys, ...remainingKeys]
    .filter((key) => key in merged)
    .map((key) => `${key}: ${merged[key]}`)
    .join("\n");

  return `---\n${frontmatter}\n---\n${parsed.body}`;
}

export function parseProjectHandoffContent(content: string): ProjectHandoff {
  const { fields } = parseFrontmatter(content);
  return {
    handoffId: fields.handoffId || "",
    projectId: fields.projectId || "",
    fromSessionId: fields.fromSessionId || "",
    ...(fields.toSessionId ? { toSessionId: fields.toSessionId } : {}),
    fromMode: fields.fromMode || "",
    toMode: fields.toMode || "",
    createdAt: fields.createdAt || "",
    ...(fields.confirmedAt ? { confirmedAt: fields.confirmedAt } : {}),
    content,
  };
}

export function loadProject(projectRoot: string): ProjectManifest | null {
  const filePath = projectManifestPath(projectRoot);
  if (!existsSync(filePath)) return null;

  const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ProjectManifest;
  if (parsed.schemaVersion !== 1 || !parsed.projectId || !parsed.name) {
    throw new Error(`Invalid Pneuma project manifest: ${filePath}`);
  }

  return { ...parsed, root: resolve(projectRoot) };
}

export function appendProjectTimelineEvent(projectRoot: string, event: ProjectTimelineEvent): void {
  mkdirSync(projectPneumaDir(projectRoot), { recursive: true });
  writeFileSync(projectTimelinePath(projectRoot), `${JSON.stringify(event)}\n`, { flag: "a" });
}

export function createProject(projectRoot: string, options: CreateProjectOptions = {}): ProjectManifest {
  const root = resolve(projectRoot);
  const existing = loadProject(root);
  if (existing) return existing;

  const now = options.now?.() ?? defaultNow();
  const manifest: ProjectManifest = {
    schemaVersion: 1,
    projectId: options.idFactory?.() ?? defaultProjectId(),
    name: options.name?.trim() || basename(root),
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    createdAt: now,
    updatedAt: now,
    root,
  };

  mkdirSync(projectPneumaDir(root), { recursive: true });
  mkdirSync(projectSessionsDir(root), { recursive: true });
  writeFileSync(projectManifestPath(root), JSON.stringify(manifest, null, 2));
  if (!existsSync(projectPreferencesPath(root))) {
    writeFileSync(projectPreferencesPath(root), "# Project Preferences\n\n");
  }
  appendProjectTimelineEvent(root, {
    type: "project.created",
    at: now,
    projectId: manifest.projectId,
    name: manifest.name,
  });
  return manifest;
}

export function createProjectSession(
  projectRoot: string,
  options: CreateProjectSessionOptions,
): ProjectSessionManifest {
  const project = createProject(projectRoot);
  const now = options.now?.() ?? defaultNow();
  const sessionId = options.idFactory?.() ?? defaultSessionId(options.mode);
  const dir = projectSessionDir(projectRoot, sessionId);
  const workspace = projectSessionWorkspace(projectRoot, sessionId);

  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(dir, "scratch"), { recursive: true });

  const session: ProjectSessionManifest = {
    schemaVersion: 1,
    sessionId,
    projectId: project.projectId,
    mode: options.mode,
    ...(options.role?.trim() ? { role: options.role.trim() } : {}),
    displayName: options.displayName,
    backendType: options.backendType,
    status: "active",
    createdAt: now,
    lastAccessed: now,
    sessionWorkspace: workspace,
  };

  writeFileSync(projectSessionManifestPath(projectRoot, sessionId), JSON.stringify(session, null, 2));
  appendProjectTimelineEvent(projectRoot, {
    type: "session.created",
    at: now,
    sessionId,
    mode: options.mode,
    ...(options.role?.trim() ? { role: options.role.trim() } : {}),
  });
  return session;
}

export function createProjectHandoffDraft(
  projectRoot: string,
  options: CreateProjectHandoffDraftOptions,
): ProjectHandoffDraft {
  const project = loadProject(projectRoot);
  if (!project) {
    throw new Error(`Project metadata not found: ${projectManifestPath(projectRoot)}`);
  }

  const sourceSession = loadProjectSession(projectRoot, options.fromSessionId);
  if (!sourceSession) {
    throw new Error(`Project session not found: ${options.fromSessionId}`);
  }

  const now = options.now?.() ?? defaultNow();
  const handoffId = options.idFactory?.() ?? defaultHandoffId(sourceSession.mode, options.toMode, now);
  const relevantFiles = [
    ...(sourceSession.deliverablePaths ?? []),
    ...(project.deliverablePaths ?? []),
  ];
  const relevantFileLines = relevantFiles.length > 0
    ? relevantFiles.map((path) => `- ${path}`)
    : ["- (Add reviewed deliverable paths before confirming.)"];

  const content = [
    "---",
    `handoffId: ${handoffId}`,
    `projectId: ${project.projectId}`,
    `fromSessionId: ${sourceSession.sessionId}`,
    "toSessionId: ",
    `fromMode: ${sourceSession.mode}`,
    `toMode: ${options.toMode}`,
    `createdAt: ${now}`,
    "---",
    "",
    `# Handoff: ${sourceSession.mode} to ${options.toMode}`,
    "",
    "## Goal",
    "",
    options.goal?.trim() || sourceSession.role || "(Summarize the goal for the target session.)",
    "",
    "## Decisions",
    "",
    "- (Add user-reviewed decisions from the source session.)",
    "",
    "## Constraints",
    "",
    "- Preserve project deliverables in the project root or explicit deliverable paths.",
    "- Keep scratch and intermediate work in the target session workspace.",
    "",
    "## Relevant Files",
    "",
    ...relevantFileLines,
    "",
    "## Open Questions",
    "",
    "- (Add unresolved questions, or write \"None\".)",
    "",
    "## Suggested Next Step",
    "",
    `- Continue in ${options.toMode} using only this reviewed handoff plus project metadata.`,
    "",
  ].join("\n");

  return { handoffId, content };
}

export function loadProjectHandoff(projectRoot: string, handoffId: string): ProjectHandoff | null {
  const filePath = projectHandoffPath(projectRoot, handoffId);
  if (!existsSync(filePath)) return null;
  return parseProjectHandoffContent(readFileSync(filePath, "utf-8"));
}

export function confirmProjectHandoff(
  projectRoot: string,
  options: ConfirmProjectHandoffOptions,
): ProjectHandoff {
  const project = loadProject(projectRoot);
  if (!project) {
    throw new Error(`Project metadata not found: ${projectManifestPath(projectRoot)}`);
  }

  const now = options.now?.() ?? defaultNow();
  const content = upsertFrontmatterFields(options.content, {
    handoffId: options.handoffId,
    projectId: project.projectId,
    toSessionId: options.toSessionId,
    confirmedAt: now,
  });

  const handoff = parseProjectHandoffContent(content);
  if (!handoff.fromSessionId || !handoff.fromMode || !handoff.toMode) {
    throw new Error("Handoff content is missing required frontmatter fields.");
  }
  if (options.toMode && handoff.toMode !== options.toMode) {
    throw new Error(`Handoff targets mode "${handoff.toMode}", not "${options.toMode}".`);
  }

  mkdirSync(projectHandoffsDir(projectRoot), { recursive: true });
  writeFileSync(projectHandoffPath(projectRoot, options.handoffId), content);
  appendProjectTimelineEvent(projectRoot, {
    type: "handoff.created",
    at: now,
    handoffId: options.handoffId,
    fromSessionId: handoff.fromSessionId,
    ...(handoff.toSessionId ? { toSessionId: handoff.toSessionId } : {}),
  });
  return { ...handoff, content };
}

export function loadProjectSession(projectRoot: string, sessionId: string): ProjectSessionManifest | null {
  const filePath = projectSessionManifestPath(projectRoot, sessionId);
  if (!existsSync(filePath)) return null;

  const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ProjectSessionManifest;
  if (parsed.schemaVersion !== 1 || !parsed.sessionId || parsed.sessionId !== sessionId) {
    throw new Error(`Invalid Pneuma project session manifest: ${filePath}`);
  }
  return parsed;
}

export function saveProjectSession(projectRoot: string, session: ProjectSessionManifest): void {
  mkdirSync(projectSessionDir(projectRoot, session.sessionId), { recursive: true });
  writeFileSync(projectSessionManifestPath(projectRoot, session.sessionId), JSON.stringify(session, null, 2));
}

export function listProjectSessions(projectRoot: string): ProjectSessionManifest[] {
  const dir = projectSessionsDir(projectRoot);
  if (!existsSync(dir)) return [];

  const sessions: ProjectSessionManifest[] = [];
  for (const entry of readdirSync(dir)) {
    const entryDir = join(dir, entry);
    const filePath = join(entryDir, "session.json");
    try {
      if (!statSync(entryDir).isDirectory() || !existsSync(filePath)) continue;
      sessions.push(JSON.parse(readFileSync(filePath, "utf-8")) as ProjectSessionManifest);
    } catch {
      continue;
    }
  }

  return sessions.sort((a, b) => b.lastAccessed.localeCompare(a.lastAccessed));
}

function readQuickSessionMetadata(sourceWorkspace: string): {
  sessionId?: string;
  mode: string;
  backendType: ProjectBackendType;
} {
  const filePath = join(resolve(sourceWorkspace), ".pneuma", "session.json");
  const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as {
    sessionId?: string;
    mode?: string;
    backendType?: string;
  };
  if (!parsed.mode) {
    throw new Error(`Quick session is missing mode: ${filePath}`);
  }
  return {
    ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
    mode: parsed.mode,
    backendType: parsed.backendType === "codex" ? "codex" : "claude-code",
  };
}

function copyQuickSessionState(sourceWorkspace: string, targetWorkspace: string): void {
  const sourcePneuma = join(resolve(sourceWorkspace), ".pneuma");
  const targetPneuma = join(resolve(targetWorkspace), ".pneuma");
  mkdirSync(targetPneuma, { recursive: true });

  for (const entry of ["history.json", "config.json", "thumbnail.png", "checkpoints.jsonl"]) {
    const src = join(sourcePneuma, entry);
    if (existsSync(src)) cpSync(src, join(targetPneuma, entry), { force: true });
  }

  const shadowGit = join(sourcePneuma, "shadow.git");
  if (existsSync(shadowGit)) {
    cpSync(shadowGit, join(targetPneuma, "shadow.git"), { recursive: true, force: true });
  }
}

function resolveQuickDeliverableTransfer(options: UpgradeQuickSessionToProjectOptions): QuickDeliverableTransfer {
  if (options.deliverableTransfer) return options.deliverableTransfer;
  return options.copyDeliverables === false ? "none" : "copy";
}

function transferQuickDeliverables(sourceWorkspace: string, projectRoot: string, transfer: QuickDeliverableTransfer): void {
  if (transfer === "none") return;
  const source = resolve(sourceWorkspace);
  const target = resolve(projectRoot);
  if (source === target) return;
  mkdirSync(target, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".pneuma" || entry.name === ".git" || entry.name === "node_modules") continue;
    const src = join(source, entry.name);
    const dst = join(target, entry.name);
    cpSync(src, dst, { recursive: entry.isDirectory(), force: true });
    if (transfer === "move") {
      rmSync(src, { recursive: entry.isDirectory(), force: true });
    }
  }
}

function assertQuickDeliverableTransferIsNonDestructive(sourceWorkspace: string, projectRoot: string, transfer: QuickDeliverableTransfer): void {
  if (transfer === "none") return;
  const source = resolve(sourceWorkspace);
  const target = resolve(projectRoot);
  if (source === target || !existsSync(target)) return;

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".pneuma" || entry.name === ".git" || entry.name === "node_modules") continue;
    const dst = join(target, entry.name);
    if (existsSync(dst)) {
      throw new Error(`Refusing to overwrite existing project deliverable: ${dst}`);
    }
  }
}

export function upgradeQuickSessionToProject(
  sourceWorkspace: string,
  projectRoot: string,
  options: UpgradeQuickSessionToProjectOptions = {},
): UpgradeQuickSessionToProjectResult {
  const source = resolve(sourceWorkspace);
  const root = resolve(projectRoot);
  const quickSession = readQuickSessionMetadata(source);
  const now = options.now?.() ?? defaultNow();
  const deliverableTransfer = resolveQuickDeliverableTransfer(options);
  assertQuickDeliverableTransferIsNonDestructive(source, root, deliverableTransfer);

  const project = createProject(root, {
    name: options.name,
    description: options.description,
    now: options.now,
    idFactory: options.projectIdFactory,
  });
  transferQuickDeliverables(source, root, deliverableTransfer);

  const created = createProjectSession(root, {
    mode: options.mode || quickSession.mode,
    displayName: options.displayName || options.mode || quickSession.mode,
    backendType: options.backendType || quickSession.backendType,
    role: options.role,
    now: options.now,
    idFactory: options.sessionIdFactory,
  });
  const session: ProjectSessionManifest = {
    ...created,
    ...(quickSession.sessionId ? { sourceQuickSessionId: quickSession.sessionId } : {}),
  };
  saveProjectSession(root, session);
  copyQuickSessionState(source, session.sessionWorkspace);
  appendProjectTimelineEvent(root, {
    type: "session.upgraded",
    at: now,
    sessionId: session.sessionId,
    sourceWorkspace: source,
    ...(quickSession.sessionId ? { sourceQuickSessionId: quickSession.sessionId } : {}),
  });
  recordRecentProject(root, { now: options.now });

  return { project, session };
}

function listProjectHandoffs(projectRoot: string): ProjectHandoff[] {
  const dir = projectHandoffsDir(projectRoot);
  if (!existsSync(dir)) return [];

  const handoffs: ProjectHandoff[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    try {
      handoffs.push(parseProjectHandoffContent(readFileSync(join(dir, entry), "utf-8")));
    } catch {
      continue;
    }
  }
  return handoffs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function summarizeProjectDeliverables(projectRoot: string): Array<{ path: string; kind: "file" | "directory"; size?: number }> {
  const root = resolve(projectRoot);
  if (!existsSync(root)) return [];

  const summaries: Array<{ path: string; kind: "file" | "directory"; size?: number }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".pneuma" || entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = join(root, entry.name);
    try {
      const stat = statSync(fullPath);
      summaries.push({
        path: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
        ...(entry.isDirectory() ? {} : { size: stat.size }),
      });
    } catch {
      continue;
    }
  }
  return summaries.sort((a, b) => a.path.localeCompare(b.path));
}

function readProjectTimelineEvents(projectRoot: string): string[] {
  try {
    return readFileSync(projectTimelinePath(projectRoot), "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function runProjectEvolution(
  projectRoot: string,
  options: RunProjectEvolutionOptions = {},
): ProjectEvolutionResult {
  const project = loadProject(projectRoot);
  if (!project) {
    throw new Error(`Project metadata not found: ${projectManifestPath(projectRoot)}`);
  }

  const now = options.now?.() ?? defaultNow();
  const sessions = listProjectSessions(projectRoot);
  const handoffs = listProjectHandoffs(projectRoot);
  const timelineEvents = readProjectTimelineEvents(projectRoot);
  const deliverables = summarizeProjectDeliverables(projectRoot);

  const sessionLines = sessions.length > 0
    ? sessions.map((session) => `- ${session.mode}: ${session.role || session.displayName} (${session.status}, last active ${session.lastAccessed})`)
    : ["- No project sessions recorded yet."];
  const handoffLines = handoffs.length > 0
    ? handoffs.map((handoff) => `- ${handoff.handoffId}: ${handoff.fromMode} -> ${handoff.toMode}${handoff.toSessionId ? ` (${handoff.toSessionId})` : ""}`)
    : ["- No handoffs recorded yet."];
  const deliverableLines = deliverables.length > 0
    ? deliverables.map((deliverable) => `- ${deliverable.path} (${deliverable.kind}${deliverable.size !== undefined ? `, ${deliverable.size} bytes` : ""})`)
    : ["- No top-level deliverables found outside .pneuma/."];

  const appendedContent = [
    "",
    `## Project Evolution - ${now}`,
    "",
    "### Sources",
    "",
    `- Sessions scanned: ${sessions.length}`,
    `- Handoffs scanned: ${handoffs.length}`,
    `- Timeline facts scanned: ${timelineEvents.length}`,
    `- Deliverables summarized: ${deliverables.length}`,
    "",
    "### Session Signals",
    "",
    ...sessionLines,
    "",
    "### Handoff Signals",
    "",
    ...handoffLines,
    "",
    "### Deliverable Summary",
    "",
    ...deliverableLines,
    "",
    "### Project-Level Preference Notes",
    "",
    "- Review these project-local signals before adding durable preferences; keep only constraints that should apply to future sessions in this project.",
    "",
  ].join("\n");

  const prefsPath = projectPreferencesPath(projectRoot);
  mkdirSync(projectPneumaDir(projectRoot), { recursive: true });
  if (!existsSync(prefsPath)) writeFileSync(prefsPath, "# Project Preferences\n\n");
  writeFileSync(prefsPath, appendedContent, { flag: "a" });
  appendProjectTimelineEvent(projectRoot, {
    type: "project.evolved",
    at: now,
    sourceSessionCount: sessions.length,
  });

  return {
    preferencesPath: prefsPath,
    sourceSessionCount: sessions.length,
    handoffCount: handoffs.length,
    timelineEventCount: timelineEvents.length,
    deliverableCount: deliverables.length,
    appendedContent,
  };
}

export function loadRecentProjects(homeDir = homedir()): RecentProjectRecord[] {
  try {
    const records = JSON.parse(readFileSync(recentProjectsRegistryPath(homeDir), "utf-8")) as RecentProjectRecord[];
    return records.filter((record) => existsSync(record.root));
  } catch {
    return [];
  }
}

export function saveRecentProjects(records: RecentProjectRecord[], homeDir = homedir()): void {
  mkdirSync(join(homeDir, ".pneuma"), { recursive: true });
  writeFileSync(recentProjectsRegistryPath(homeDir), JSON.stringify(records, null, 2));
}

export function recordRecentProject(projectRoot: string, options: RecordRecentProjectOptions = {}): RecentProjectRecord {
  const project = createProject(projectRoot);
  const home = options.homeDir ?? homedir();
  const record: RecentProjectRecord = {
    projectId: project.projectId,
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    root: resolve(projectRoot),
    lastAccessed: options.now?.() ?? defaultNow(),
  };
  const next = [
    record,
    ...loadRecentProjects(home).filter((existing) => existing.projectId !== record.projectId),
  ].slice(0, options.limit ?? 50);

  saveRecentProjects(next, home);
  return record;
}

function resolveRuntimeHandoff(
  projectRoot: string,
  handoffId: string | undefined,
  session: ProjectSessionManifest,
): ProjectHandoff | undefined {
  if (!handoffId) return undefined;
  const handoff = loadProjectHandoff(projectRoot, handoffId);
  if (!handoff) {
    throw new Error(`Project handoff not found: ${handoffId}`);
  }
  if (handoff.toSessionId && handoff.toSessionId !== session.sessionId) {
    throw new Error(`Project handoff "${handoffId}" targets session "${handoff.toSessionId}", not "${session.sessionId}".`);
  }
  if (handoff.toMode && handoff.toMode !== session.mode) {
    throw new Error(`Project handoff "${handoffId}" targets mode "${handoff.toMode}", not "${session.mode}".`);
  }
  return handoff;
}

export function resolveProjectRuntime(options: ResolveProjectRuntimeOptions): ProjectRuntime {
  const project = createProject(options.projectRoot, {
    now: options.now,
    idFactory: options.projectIdFactory,
  });

  if (options.sessionId) {
    const existing = loadProjectSession(options.projectRoot, options.sessionId);
    if (!existing) {
      throw new Error(`Project session not found: ${options.sessionId}`);
    }
    if (existing.mode !== options.mode) {
      throw new Error(`Project session "${options.sessionId}" belongs to mode "${existing.mode}", not "${options.mode}".`);
    }
    if (existing.backendType !== options.backendType) {
      throw new Error(`Project session "${options.sessionId}" uses backend "${existing.backendType}", not "${options.backendType}".`);
    }

    const now = options.now?.() ?? defaultNow();
    const session: ProjectSessionManifest = {
      ...existing,
      status: "active",
      lastAccessed: now,
    };
    saveProjectSession(options.projectRoot, session);
    appendProjectTimelineEvent(options.projectRoot, {
      type: "session.resumed",
      at: now,
      sessionId: session.sessionId,
    });
    recordRecentProject(options.projectRoot, { now: options.now });
    const handoff = resolveRuntimeHandoff(options.projectRoot, options.handoffId, session);
    return {
      projectRoot: resolve(options.projectRoot),
      workspace: session.sessionWorkspace,
      project,
      session,
      ...(handoff ? { handoff } : {}),
    };
  }

  const session = createProjectSession(options.projectRoot, {
    mode: options.mode,
    displayName: options.displayName,
    backendType: options.backendType,
    role: options.role,
    now: options.now,
    idFactory: options.sessionIdFactory,
  });
  recordRecentProject(options.projectRoot, { now: options.now });
  const handoff = resolveRuntimeHandoff(options.projectRoot, options.handoffId, session);
  return {
    projectRoot: resolve(options.projectRoot),
    workspace: session.sessionWorkspace,
    project,
    session,
    ...(handoff ? { handoff } : {}),
  };
}

export function buildProjectInstructionContext(
  runtime: ProjectRuntime,
  sessions: ProjectSessionManifest[] = listProjectSessions(runtime.projectRoot),
): ProjectInstructionContext {
  return {
    projectId: runtime.project.projectId,
    projectName: runtime.project.name,
    projectRoot: runtime.projectRoot,
    ...(runtime.project.description ? { description: runtime.project.description } : {}),
    ...(runtime.session.role ? { role: runtime.session.role } : {}),
    currentSessionId: runtime.session.sessionId,
    currentMode: runtime.session.mode,
    currentSessionDisplayName: runtime.session.displayName,
    ...(runtime.handoff ? { handoff: runtime.handoff } : {}),
    peerSessions: sessions
      .filter((session) => session.sessionId !== runtime.session.sessionId)
      .map((session) => ({
        sessionId: session.sessionId,
        mode: session.mode,
        displayName: session.displayName,
        ...(session.role ? { role: session.role } : {}),
        backendType: session.backendType,
        status: session.status,
        lastAccessed: session.lastAccessed,
      })),
  };
}
