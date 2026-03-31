/**
 * Skill installer — copies mode-specific skill to the appropriate skills directory
 * (.claude/skills/ for Claude Code, .agents/skills/ for Codex) and
 * injects Pneuma configuration into CLAUDE.md / AGENTS.md.
 *
 * Parameterized by SkillConfig from ModeManifest — no hardcoded mode knowledge.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { homedir } from "node:os";
import type { SkillConfig, ViewerApiConfig, McpServerConfig, SkillDependency } from "../core/types/mode-manifest.js";

/** Return the workspace-relative skills directory for a given backend. */
function skillsDir(backendType?: string): string {
  return backendType === "codex" ? join(".agents", "skills") : join(".claude", "skills");
}

/** Return the instructions filename for a given backend. */
function instructionsFile(backendType?: string): string {
  return backendType === "codex" ? "AGENTS.md" : "CLAUDE.md";
}

const PNEUMA_MARKER_START = "<!-- pneuma:start -->";
const PNEUMA_MARKER_END = "<!-- pneuma:end -->";
const VIEWER_API_MARKER_START = "<!-- pneuma:viewer-api:start -->";
const VIEWER_API_MARKER_END = "<!-- pneuma:viewer-api:end -->";
const SKILLS_MARKER_START = "<!-- pneuma:skills:start -->";
const SKILLS_MARKER_END = "<!-- pneuma:skills:end -->";
const PREFS_MARKER_START = "<!-- pneuma:preferences:start -->";
const PREFS_MARKER_END = "<!-- pneuma:preferences:end -->";

/**
 * Extract critical preferences from a preference file.
 * Returns trimmed content between <!-- pneuma-critical:start --> and <!-- pneuma-critical:end -->,
 * or null if file doesn't exist or has no critical section.
 */
export function extractPreferenceCritical(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(
      /<!-- pneuma-critical:start -->\s*([\s\S]*?)\s*<!-- pneuma-critical:end -->/
    );
    const extracted = match?.[1]?.trim();
    return extracted || null;
  } catch {
    return null;
  }
}

/**
 * Ensure `.pneuma/` is listed in the workspace's .gitignore.
 */
function ensureGitignore(workspace: string): void {
  const gitignorePath = join(workspace, ".gitignore");
  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
  }
  if (!content.split("\n").some((line) => line.trim() === ".pneuma/" || line.trim() === ".pneuma")) {
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += ".pneuma/\n";
    writeFileSync(gitignorePath, content, "utf-8");
    console.log(`[skill-installer] Added .pneuma/ to ${gitignorePath}`);
  }
}

/**
 * Replace template placeholders in content with param values.
 *
 * Supports two syntaxes:
 * - Simple: `{{key}}` → replaced with value
 * - Conditional: `{{#key}}...content...{{/key}}` → kept if value is truthy, removed otherwise
 *
 * Conditional blocks are processed first, then simple replacements run on remaining content.
 */
export function applyTemplateParams(
  content: string,
  params: Record<string, number | string>,
): string {
  let result = content;

  // 1. Process conditional blocks: {{#key}}content{{/key}}
  //    Truthy = defined AND non-empty string (after trim)
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, key, inner) => {
    const value = params[key];
    const truthy = value !== undefined && String(value).trim() !== "";
    return truthy ? inner : "";
  });

  // 2. Simple replacements: {{key}} → value
  for (const [key, value] of Object.entries(params)) {
    result = result.replaceAll(`{{${key}}}`, String(value));
  }
  return result;
}

/** Recursively apply template params to all text files in a directory. */
const TEMPLATE_EXTENSIONS = new Set([".md", ".txt", ".html", ".css", ".json"]);

function applyTemplateToDir(
  dir: string,
  params: Record<string, number | string>,
): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      applyTemplateToDir(fullPath, params);
    } else if (TEMPLATE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      const content = readFileSync(fullPath, "utf-8");
      const replaced = applyTemplateParams(content, params);
      if (replaced !== content) {
        writeFileSync(fullPath, replaced, "utf-8");
      }
    }
  }
}

/**
 * Generate a CLAUDE.md section describing the Viewer's self-describing API.
 * Pure function — no side effects, no dependency on Skill.
 *
 * Returns empty string if no viewer API is declared.
 */
export function generateViewerApiSection(
  viewerApi: ViewerApiConfig | undefined,
): string {
  if (!viewerApi) return "";
  const lines: string[] = ["## Viewer API", ""];
  let hasContent = false;

  // Workspace model
  if (viewerApi.workspace) {
    const ws = viewerApi.workspace;
    const traits: string[] = [];
    if (ws.ordered) traits.push("ordered");
    if (ws.multiFile) traits.push("multi-file");
    if (ws.hasActiveFile) traits.push("active file tracking");
    lines.push("### Workspace");
    lines.push(`- Type: ${ws.type}${traits.length > 0 ? ` (${traits.join(", ")})` : ""}`);
    if (ws.manifestFile) lines.push(`- Index file: ${ws.manifestFile}`);
    lines.push("");
    hasContent = true;

    if (ws.supportsContentSets) {
      lines.push("### Content Sets");
      lines.push("This workspace may contain multiple content sets as top-level directories (e.g. en-dark/, ja-light/).");
      lines.push("The `<viewer-context>` includes a `content-set` attribute. File paths include the content set prefix.");
      lines.push("Always edit files within the active content set's directory unless asked to work across content sets.");
      lines.push("");
    }
  }

  // Actions
  const actions = viewerApi.actions?.filter((a) => a.agentInvocable) ?? [];
  if (actions.length > 0) {
    lines.push("### Actions");
    lines.push("");
    lines.push("The viewer supports these operations. Invoke via Bash:");
    lines.push("`curl -s -X POST $PNEUMA_API/api/viewer/action -H 'Content-Type: application/json' -d '{\"actionId\":\"<id>\",\"params\":{...}}'`");
    lines.push("");
    lines.push("| Action | Description | Params |");
    lines.push("|--------|-------------|--------|");
    for (const action of actions) {
      const paramDescs: string[] = [];
      if (action.params) {
        for (const [name, p] of Object.entries(action.params)) {
          paramDescs.push(`${name}${p.required ? "" : "?"}: ${p.type}`);
        }
      }
      lines.push(`| \`${action.id}\` | ${action.description || action.label} | ${paramDescs.join(", ") || "—"} |`);
    }
    lines.push("");
    hasContent = true;
  }

  // Scaffold
  if (viewerApi.scaffold) {
    const sc = viewerApi.scaffold;
    lines.push("### Scaffold");
    lines.push("");
    lines.push(`${sc.description} **Requires user confirmation in browser.**`);
    lines.push("");
    lines.push("Invoke via the viewer action API:");
    lines.push("`curl -s -X POST $PNEUMA_API/api/viewer/action -H 'Content-Type: application/json' -d '{\"actionId\":\"scaffold\",\"params\":{...}}'`");
    lines.push("");
    const paramEntries = Object.entries(sc.params);
    if (paramEntries.length > 0) {
      lines.push("| Param | Type | Required | Description |");
      lines.push("|-------|------|----------|-------------|");
      for (const [name, p] of paramEntries) {
        lines.push(`| \`${name}\` | ${p.type} | ${p.required ? "yes" : "no"} | ${p.description} |`);
      }
      lines.push("");
    }
    lines.push(`Clears: ${sc.clearPatterns.map((p) => `\`${p}\``).join(", ")}`);
    lines.push("");
    hasContent = true;
  }

  // Locator cards
  if (viewerApi.locatorDescription) {
    lines.push("### Locator Cards");
    lines.push("");
    lines.push("You may embed clickable navigation cards in your messages using this tag:");
    lines.push("`<viewer-locator label=\"Display Label\" data='{\"key\":\"value\"}' />`");
    lines.push("");
    lines.push(viewerApi.locatorDescription);
    lines.push("");
    lines.push("When the user clicks a locator card, the viewer navigates to that location.");
    lines.push("");
    lines.push("**Always** embed locator cards at the end of your response when you create or edit content. The user may have navigated away while you were working — locators let them jump directly to what changed.");
    lines.push("");
    hasContent = true;
  }

  if (!hasContent) return "";

  // Viewer context format description (prepend after header)
  const contextLines = [
    "### Viewer Context",
    "",
    "Each user message may be prefixed with a `<viewer-context>` block.",
    "It describes what the user is currently seeing — the active file, viewport position, and selected elements.",
    'Use this to resolve references like "this page", "here", "this section" in user messages.',
    "",
    "### User Actions",
    "",
    "Messages may include a `<user-actions>` block listing significant actions",
    "the user performed in the viewer since the last message.",
    "Use this to understand workspace state changes that happened outside of your edits.",
    "",
  ];
  lines.splice(2, 0, ...contextLines);

  return lines.join("\n");
}

/**
 * Generate a CLAUDE.md section describing the proxy mechanism.
 * Only generated when the mode declares proxy config (manifest.proxy).
 * Modes without proxy config don't need this — their viewers don't fetch external APIs.
 *
 * Pure function — no side effects.
 */
export function generateProxySection(
  proxy: Record<string, import("../core/types/mode-manifest.js").ProxyRoute> | undefined,
): string {
  if (!proxy) return "";

  const hasPresets = Object.keys(proxy).length > 0;

  const lines: string[] = [
    "### Proxy",
    "",
    "The runtime provides a reverse proxy at `/proxy/<name>/<path>` to avoid CORS issues when viewer code fetches external APIs.",
    "**Always use the proxy for external API access** — never use absolute URLs directly in viewer code.",
    "",
  ];

  // Preset routes table
  if (hasPresets) {
    lines.push("**Available proxies (from mode defaults):**");
    lines.push("");
    lines.push("| Name | Target | Description |");
    lines.push("|------|--------|-------------|");
    for (const [name, route] of Object.entries(proxy)) {
      lines.push(`| \`${name}\` | \`${route.target}\` | ${route.description ?? "—"} |`);
    }
    lines.push("");
    lines.push("**Usage in viewer code:**");
    lines.push(`- Example: \`fetch("/proxy/${Object.keys(proxy)[0]}/path/to/resource")\``);
  } else {
    lines.push("**Usage in viewer code:**");
    lines.push("- Example: `fetch(\"/proxy/myapi/path/to/resource\")`");
  }
  lines.push("");

  // Adding new proxies — use fenced code block to avoid template resolution
  lines.push("**Adding or overriding proxies at runtime:**");
  lines.push("Write `proxy.json` in workspace root (takes effect immediately, no restart).");
  lines.push("Fields: `target` (required, upstream base URL), `headers` (optional, supports env var templates), `methods` (optional, defaults to GET only).");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate a CLAUDE.md section describing the native bridge API.
 * Always injected — the API gracefully returns "not available" in non-desktop environments.
 */
export function generateNativeBridgeSection(): string {
  return [
    "### Native Desktop APIs",
    "",
    "The runtime provides native desktop capabilities via `/api/native/`. Available when running inside the Pneuma desktop app.",
    "",
    "**Discovery:** `curl -s $PNEUMA_API/api/native` — returns `{ available: true, capabilities: { module: [methods...] } }` or `{ available: false }`.",
    "Always check this first to see what's available — the capability list is dynamic and auto-generated from Electron modules.",
    "",
    "**Invoke:** `curl -s -X POST $PNEUMA_API/api/native/<module>/<method> -H 'Content-Type: application/json' -d '[...args]'`",
    "Returns `{ ok: true, result: ... }` or `{ ok: false, error: \"...\" }`.",
    "",
    "**Common modules:** `clipboard` (readText, writeText, readImage→base64, writeImage←base64, ...), `shell` (openPath, openExternal, ...), `app` (getVersion, getPath, ...), `system` (platform, cpus, totalMemory, hostname, ...), `screen`, `nativeTheme`, `notification` (show, isSupported), `window` (minimize, maximize, setAlwaysOnTop, getBounds, ...)",
    "",
  ].join("\n");
}

/**
 * Install MCP servers declared by a mode into workspace's .mcp.json.
 *
 * Management strategy: uses .pneuma/managed-mcp.json to track which servers
 * Pneuma manages. On re-install, old managed entries are removed before writing new ones.
 * User-added servers are preserved.
 */
export function installMcpServers(
  workspace: string,
  mcpServers: McpServerConfig[],
  params?: Record<string, number | string>,
): void {
  const mcpJsonPath = join(workspace, ".mcp.json");
  const managedListPath = join(workspace, ".pneuma", "managed-mcp.json");

  // Read existing .mcp.json
  let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
  if (existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    } catch {
      mcpConfig = { mcpServers: {} };
    }
  }

  // Read managed server names and remove old entries
  let managedNames: string[] = [];
  if (existsSync(managedListPath)) {
    try {
      managedNames = JSON.parse(readFileSync(managedListPath, "utf-8"));
    } catch {
      managedNames = [];
    }
  }
  for (const name of managedNames) {
    delete mcpConfig.mcpServers[name];
  }

  // Apply template params helper
  const applyToValue = (value: string): string => {
    return params && Object.keys(params).length > 0
      ? applyTemplateParams(value, params)
      : value;
  };
  const applyToRecord = (record: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(record)) {
      result[k] = applyToValue(v);
    }
    return result;
  };

  // Build and write new entries
  const newManagedNames: string[] = [];
  for (const server of mcpServers) {
    newManagedNames.push(server.name);

    if (server.url) {
      // HTTP server
      const entry: Record<string, unknown> = {
        type: "http",
        url: applyToValue(server.url),
      };
      if (server.headers && Object.keys(server.headers).length > 0) {
        entry.headers = applyToRecord(server.headers);
      }
      mcpConfig.mcpServers[server.name] = entry;
    } else {
      // stdio server
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args.map(applyToValue);
      if (server.env && Object.keys(server.env).length > 0) {
        entry.env = applyToRecord(server.env);
      }
      mcpConfig.mcpServers[server.name] = entry;
    }
  }

  // Write .mcp.json
  writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  console.log(`[skill-installer] Updated .mcp.json with ${mcpServers.length} server(s)`);

  // Write managed list
  mkdirSync(join(workspace, ".pneuma"), { recursive: true });
  writeFileSync(managedListPath, JSON.stringify(newManagedNames, null, 2), "utf-8");
}

/**
 * Install skill dependencies declared by a mode.
 *
 * Copies each dependency's source directory into the backend-appropriate skills dir,
 * applies template params, and returns instruction file snippet lines for injection.
 */
export function installSkillDependencies(
  workspace: string,
  dependencies: SkillDependency[],
  modeSourceDir: string,
  params?: Record<string, number | string>,
  backendType?: string,
): string[] {
  const snippets: string[] = [];

  for (const dep of dependencies) {
    if (!dep.sourceDir) {
      console.error(`[skill-installer] Skill dependency "${dep.name}" is missing sourceDir — skipping. The skill files must be bundled in the mode package.`);
      continue;
    }

    const depSource = join(modeSourceDir, dep.sourceDir);
    const depTarget = join(workspace, skillsDir(backendType), dep.name);

    mkdirSync(depTarget, { recursive: true });
    if (existsSync(depSource)) {
      cpSync(depSource, depTarget, { recursive: true, force: true });
      if (params && Object.keys(params).length > 0) {
        applyTemplateToDir(depTarget, params);
      }
      console.log(`[skill-installer] Installed skill dependency: ${dep.name}`);
    } else {
      console.error(`[skill-installer] Skill dependency "${dep.name}" source not found: ${depSource} — the mode package is incomplete.`);
    }

    // Collect snippet for CLAUDE.md
    if (dep.claudeMdSnippet) {
      snippets.push(`- ${dep.claudeMdSnippet}`);
    } else {
      // Try extracting summary from installed SKILL.md
      const skillMdPath = join(depTarget, "SKILL.md");
      if (existsSync(skillMdPath)) {
        const content = readFileSync(skillMdPath, "utf-8");
        const headingMatch = content.match(/^#\s+(.+)/m);
        snippets.push(`- **${dep.name}** — ${headingMatch ? headingMatch[1] : "Installed skill"}`);
      } else {
        snippets.push(`- **${dep.name}**`);
      }
    }
  }

  return snippets;
}

/**
 * Returns framework-level skill dependencies installed for ALL modes.
 * These provide universal agent capabilities (e.g., user preference analysis).
 */
function getGlobalSkillDependencies(): SkillDependency[] {
  const sharedDir = join(import.meta.dirname, "..", "modes", "_shared");
  const prefsDir = join(sharedDir, "skills", "pneuma-preferences");
  if (!existsSync(prefsDir)) return [];

  return [{
    name: "pneuma-preferences",
    sourceDir: "skills/pneuma-preferences",
    claudeMdSnippet: "**pneuma-preferences** — Read and maintain user preference profiles across sessions",
  }];
}

/**
 * Install a mode's skill and inject CLAUDE.md configuration.
 *
 * @param workspace  — User's project directory
 * @param skillConfig — Skill configuration from ModeManifest
 * @param modeSourceDir — Absolute path to the mode package directory (e.g. /path/to/modes/doc)
 * @param params — Optional init params for template replacement
 * @param viewerApi — Optional viewer self-describing API (auto-injected as independent CLAUDE.md section)
 * @param backendType — Backend type ("claude-code" | "codex"). When "codex", also writes AGENTS.md.
 */
export function installSkill(
  workspace: string,
  skillConfig: SkillConfig,
  modeSourceDir: string,
  params?: Record<string, number | string>,
  viewerApi?: ViewerApiConfig,
  backendType?: string,
  proxyConfig?: Record<string, import("../core/types/mode-manifest.js").ProxyRoute>,
): void {
  // 1. Copy skill to the backend-appropriate skills directory
  const skillSource = join(modeSourceDir, skillConfig.sourceDir);
  const skillTarget = join(workspace, skillsDir(backendType), skillConfig.installName);
  mkdirSync(skillTarget, { recursive: true });

  if (existsSync(skillSource)) {
    cpSync(skillSource, skillTarget, { recursive: true, force: true });
    // Apply template params to installed skill files
    if (params && Object.keys(params).length > 0) {
      applyTemplateToDir(skillTarget, params);
    }
    // Generate .env file from envMapping (only non-empty values)
    if (skillConfig.envMapping && params) {
      const envLines: string[] = [];
      for (const [envVar, paramName] of Object.entries(skillConfig.envMapping)) {
        const value = params[paramName];
        if (value !== undefined && String(value).trim() !== "") {
          envLines.push(`${envVar}=${value}`);
        }
      }
      if (envLines.length > 0) {
        writeFileSync(join(skillTarget, ".env"), envLines.join("\n") + "\n", "utf-8");
        console.log(`[skill-installer] Generated .env with ${envLines.length} key(s)`);
      }
    }
    console.log(`[skill-installer] Installed skill to ${skillTarget}`);
  } else {
    console.warn(`[skill-installer] Skill source not found: ${skillSource}`);
  }

  // 1b. Install MCP servers
  if (skillConfig.mcpServers && skillConfig.mcpServers.length > 0) {
    installMcpServers(workspace, skillConfig.mcpServers, params);
  }

  // 1c. Install skill dependencies
  let skillSnippets: string[] = [];
  if (skillConfig.skillDependencies && skillConfig.skillDependencies.length > 0) {
    skillSnippets = installSkillDependencies(workspace, skillConfig.skillDependencies, modeSourceDir, params, backendType);
  }

  // 1d. Install global skill dependencies (framework-level, all modes)
  const globalDeps = getGlobalSkillDependencies();
  if (globalDeps.length > 0) {
    const globalSnippets = installSkillDependencies(
      workspace,
      globalDeps,
      join(import.meta.dirname, "..", "modes", "_shared"),
      params,
      backendType,
    );
    skillSnippets.push(...globalSnippets);
  }

  // 1e. Ensure preferences directory exists
  mkdirSync(join(homedir(), ".pneuma", "preferences"), { recursive: true });

  // 2. Inject/update instructions file with pneuma configuration
  //    Claude Code uses CLAUDE.md, Codex uses AGENTS.md
  const primaryInstructionsPath = join(workspace, instructionsFile(backendType));
  let content = "";

  if (existsSync(primaryInstructionsPath)) {
    content = readFileSync(primaryInstructionsPath, "utf-8");
  }

  let sectionContent = skillConfig.claudeMdSection;
  if (params && Object.keys(params).length > 0) {
    sectionContent = applyTemplateParams(sectionContent, params);
  }
  const claudeMdSection = `${PNEUMA_MARKER_START}\n${sectionContent}\n${PNEUMA_MARKER_END}`;

  // Check if pneuma section already exists
  const startIdx = content.indexOf(PNEUMA_MARKER_START);
  const endIdx = content.indexOf(PNEUMA_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    content = content.substring(0, startIdx) +
      claudeMdSection +
      content.substring(endIdx + PNEUMA_MARKER_END.length);
  } else {
    // Append section
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += "\n" + claudeMdSection + "\n";
  }

  // 2b. Inject/update Viewer API section (independent marker, Viewer-owned)
  let viewerApiContent = generateViewerApiSection(viewerApi);
  const proxyContent = generateProxySection(proxyConfig);
  if (proxyContent) {
    viewerApiContent = viewerApiContent
      ? viewerApiContent + "\n" + proxyContent
      : proxyContent;
  }
  const nativeContent = generateNativeBridgeSection();
  if (nativeContent) {
    viewerApiContent = viewerApiContent
      ? viewerApiContent + "\n" + nativeContent
      : nativeContent;
  }
  if (viewerApiContent) {
    const viewerSection = `${VIEWER_API_MARKER_START}\n${viewerApiContent}\n${VIEWER_API_MARKER_END}`;
    const vStart = content.indexOf(VIEWER_API_MARKER_START);
    const vEnd = content.indexOf(VIEWER_API_MARKER_END);
    if (vStart !== -1 && vEnd !== -1) {
      content = content.substring(0, vStart) +
        viewerSection +
        content.substring(vEnd + VIEWER_API_MARKER_END.length);
    } else {
      if (content.length > 0 && !content.endsWith("\n")) {
        content += "\n";
      }
      content += "\n" + viewerSection + "\n";
    }
  }

  // 2c. Inject/update skills dependency section
  if (skillSnippets.length > 0) {
    const skillsContent = [
      "## Available Skills",
      "",
      "The following skills are installed and available for use:",
      "",
      ...skillSnippets,
      "",
      "Use `/<skill-name>` to invoke these skills.",
    ].join("\n");
    const skillsSection = `${SKILLS_MARKER_START}\n${skillsContent}\n${SKILLS_MARKER_END}`;
    const sStart = content.indexOf(SKILLS_MARKER_START);
    const sEnd = content.indexOf(SKILLS_MARKER_END);
    if (sStart !== -1 && sEnd !== -1) {
      content = content.substring(0, sStart) +
        skillsSection +
        content.substring(sEnd + SKILLS_MARKER_END.length);
    } else {
      if (content.length > 0 && !content.endsWith("\n")) {
        content += "\n";
      }
      content += "\n" + skillsSection + "\n";
    }
  } else {
    // Remove stale skills section if no dependencies
    const sStart = content.indexOf(SKILLS_MARKER_START);
    const sEnd = content.indexOf(SKILLS_MARKER_END);
    if (sStart !== -1 && sEnd !== -1) {
      content = content.substring(0, sStart) +
        content.substring(sEnd + SKILLS_MARKER_END.length);
    }
  }

  // 2d. Inject/update preferences critical section
  {
    const prefsDir = join(homedir(), ".pneuma", "preferences");
    const globalCritical = extractPreferenceCritical(join(prefsDir, "profile.md"));
    // Extract mode name from install name (e.g. "pneuma-slide" -> "slide")
    const prefModeName = skillConfig.installName.replace(/^pneuma-/, "");
    const modeCritical = extractPreferenceCritical(join(prefsDir, `mode-${prefModeName}.md`));

    if (globalCritical || modeCritical) {
      const prefsLines: string[] = ["### User Preferences (Critical)", ""];
      if (globalCritical) {
        prefsLines.push("**Global:**", globalCritical, "");
      }
      if (modeCritical) {
        prefsLines.push(`**${prefModeName} Mode:**`, modeCritical);
      }
      const prefsSection = `${PREFS_MARKER_START}\n${prefsLines.join("\n")}\n${PREFS_MARKER_END}`;
      const pStart = content.indexOf(PREFS_MARKER_START);
      const pEnd = content.indexOf(PREFS_MARKER_END);
      if (pStart !== -1 && pEnd !== -1) {
        content = content.substring(0, pStart) + prefsSection + content.substring(pEnd + PREFS_MARKER_END.length);
      } else {
        if (content.length > 0 && !content.endsWith("\n")) content += "\n";
        content += "\n" + prefsSection + "\n";
      }
    } else {
      // Remove stale preferences section
      const pStart = content.indexOf(PREFS_MARKER_START);
      const pEnd = content.indexOf(PREFS_MARKER_END);
      if (pStart !== -1 && pEnd !== -1) {
        content = content.substring(0, pStart) + content.substring(pEnd + PREFS_MARKER_END.length);
      }
    }
  }

  // Write instructions file
  mkdirSync(dirname(primaryInstructionsPath), { recursive: true });
  writeFileSync(primaryInstructionsPath, content, "utf-8");
  console.log(`[skill-installer] Updated ${primaryInstructionsPath}`);

  // 3. Ensure .pneuma/ is in .gitignore
  ensureGitignore(workspace);

  // 4. Inject resumed context if present
  injectResumedContext(workspace, backendType ?? "claude-code");
}

/**
 * Inject resumed session context from shared history into the instructions file.
 * Reads `.pneuma/resumed-context.xml` and injects it before `<!-- pneuma:end -->`.
 */
export function injectResumedContext(workspace: string, backendType: string): void {
  const contextPath = join(workspace, ".pneuma", "resumed-context.xml");
  if (!existsSync(contextPath)) return;

  const context = readFileSync(contextPath, "utf-8");
  const markerStart = "<!-- pneuma:resumed:start -->";
  const markerEnd = "<!-- pneuma:resumed:end -->";
  const section = `${markerStart}\n${context}\n${markerEnd}`;

  const instructionsPath = backendType === "codex"
    ? join(workspace, "AGENTS.md")
    : join(workspace, "CLAUDE.md");

  if (!existsSync(instructionsPath)) return;

  let content = readFileSync(instructionsPath, "utf-8");

  // Remove existing resumed section if present
  const existingStart = content.indexOf(markerStart);
  const existingEnd = content.indexOf(markerEnd);
  if (existingStart !== -1 && existingEnd !== -1) {
    content = content.slice(0, existingStart) + content.slice(existingEnd + markerEnd.length);
  }

  // Inject before <!-- pneuma:end --> if it exists, otherwise append
  const pneumaEnd = content.indexOf("<!-- pneuma:end -->");
  if (pneumaEnd !== -1) {
    content = content.slice(0, pneumaEnd) + section + "\n" + content.slice(pneumaEnd);
  } else {
    content += "\n" + section;
  }

  writeFileSync(instructionsPath, content);
}
