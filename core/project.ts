import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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
  now?: () => string;
  projectIdFactory?: () => string;
  sessionIdFactory?: () => string;
}

export interface ProjectRuntime {
  projectRoot: string;
  workspace: string;
  project: ProjectManifest;
  session: ProjectSessionManifest;
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
}

export type ProjectTimelineEvent =
  | { type: "project.created"; at: string; projectId: string; name: string }
  | { type: "project.updated"; at: string; changes: Record<string, unknown> }
  | { type: "session.created"; at: string; sessionId: string; mode: string; role?: string }
  | { type: "session.resumed"; at: string; sessionId: string }
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

export function projectSessionWorkspace(projectRoot: string, sessionId: string): string {
  return join(projectSessionDir(projectRoot, sessionId), "workspace");
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

  writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2));
  appendProjectTimelineEvent(projectRoot, {
    type: "session.created",
    at: now,
    sessionId,
    mode: options.mode,
    ...(options.role?.trim() ? { role: options.role.trim() } : {}),
  });
  return session;
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

export function resolveProjectRuntime(options: ResolveProjectRuntimeOptions): ProjectRuntime {
  const project = createProject(options.projectRoot, {
    now: options.now,
    idFactory: options.projectIdFactory,
  });
  const session = createProjectSession(options.projectRoot, {
    mode: options.mode,
    displayName: options.displayName,
    backendType: options.backendType,
    role: options.role,
    now: options.now,
    idFactory: options.sessionIdFactory,
  });
  recordRecentProject(options.projectRoot, { now: options.now });
  return {
    projectRoot: resolve(options.projectRoot),
    workspace: session.sessionWorkspace,
    project,
    session,
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
