/**
 * Evolution API routes — list, view, apply, rollback, discard, fork proposals.
 *
 * Registered conditionally when modeName === "evolve".
 * All endpoints scoped under /api/evolve/.
 */

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { Hono } from "hono";
import {
  listProposals,
  loadProposal,
  loadLatestProposal,
  applyProposal,
  rollbackProposal,
  discardProposal,
  saveProposal,
} from "./evolution-proposal.js";

interface EvolutionRouteOptions {
  workspace: string;
}

export function registerEvolutionRoutes(app: Hono, opts: EvolutionRouteOptions): void {
  const { workspace } = opts;

  // GET /api/evolve/proposals — list all proposals
  app.get("/api/evolve/proposals", (c) => {
    const proposals = listProposals(workspace);
    return c.json({ proposals });
  });

  // GET /api/evolve/proposals/latest — most recent proposal
  app.get("/api/evolve/proposals/latest", (c) => {
    const proposal = loadLatestProposal(workspace);
    if (!proposal) {
      return c.json({ proposal: null, message: "No proposals found" });
    }
    return c.json({ proposal });
  });

  // GET /api/evolve/proposals/:id — specific proposal
  app.get("/api/evolve/proposals/:id", (c) => {
    const id = c.req.param("id");
    const proposal = loadProposal(workspace, id);
    if (!proposal) {
      return c.json({ error: "Proposal not found" }, 404);
    }
    return c.json({ proposal });
  });

  // POST /api/evolve/apply/:id — apply a pending proposal
  app.post("/api/evolve/apply/:id", (c) => {
    const id = c.req.param("id");
    const result = applyProposal(workspace, id);
    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json({ success: true, appliedFiles: result.appliedFiles });
  });

  // POST /api/evolve/rollback/:id — rollback an applied proposal
  app.post("/api/evolve/rollback/:id", (c) => {
    const id = c.req.param("id");
    const result = rollbackProposal(workspace, id);
    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json({ success: true, restoredFiles: result.restoredFiles });
  });

  // POST /api/evolve/discard/:id — discard a pending proposal
  app.post("/api/evolve/discard/:id", (c) => {
    const id = c.req.param("id");
    const success = discardProposal(workspace, id);
    if (!success) {
      return c.json({ success: false, error: "Cannot discard (not found or already applied)" }, 400);
    }
    return c.json({ success: true });
  });

  // POST /api/evolve/fork/:id — fork proposal into a new custom mode
  app.post("/api/evolve/fork/:id", async (c) => {
    const id = c.req.param("id");
    const proposal = loadProposal(workspace, id);
    if (!proposal) {
      return c.json({ error: "Proposal not found" }, 404);
    }
    if (proposal.status !== "pending") {
      return c.json({ error: `Cannot fork: proposal status is "${proposal.status}"` }, 400);
    }

    try {
      const forkPath = await forkProposalIntoMode(workspace, proposal);

      // Mark proposal as forked
      proposal.status = "forked";
      proposal.forkedAt = new Date().toISOString();
      proposal.forkPath = forkPath;
      saveProposal(workspace, proposal);

      return c.json({ success: true, forkPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: msg }, 500);
    }
  });
}

// ── Fork Implementation ──────────────────────────────────────────────────────

/**
 * Fork a proposal into a new custom mode:
 * 1. Resolve the target mode's source directory
 * 2. Copy entire mode source to ~/.pneuma/modes/<name>-evolved-<date>/
 * 3. Apply proposal changes to the copied skill files
 * 4. Update the copied manifest version
 * Returns the new mode path.
 */
async function forkProposalIntoMode(workspace: string, proposal: {
  mode: string;
  changes: Array<{ file: string; action: string; content: string; insertAt?: string }>;
}): Promise<string> {
  // 1. Resolve the target mode's source
  const { resolveMode } = await import("../core/mode-resolver.js");
  const projectRoot = resolve(dirname(import.meta.path), "..");
  const resolved = await resolveMode(proposal.mode, projectRoot);

  const sourceDir = resolved.type === "builtin"
    ? join(projectRoot, "modes", proposal.mode)
    : resolved.path;

  if (!existsSync(sourceDir)) {
    throw new Error(`Mode source not found: ${sourceDir}`);
  }

  // 2. Copy to ~/.pneuma/modes/<name>-evolved-<YYYYMMDD>/
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const forkName = `${proposal.mode}-evolved-${date}`;
  const modesDir = join(homedir(), ".pneuma", "modes");
  let forkPath = join(modesDir, forkName);

  // Avoid collisions
  let suffix = 0;
  while (existsSync(forkPath)) {
    suffix++;
    forkPath = join(modesDir, `${forkName}-${suffix}`);
  }

  mkdirSync(forkPath, { recursive: true });

  // 3. Copy manifest.ts + skill/ + seed/ + hooks/ (NOT viewer/ or pneuma-mode.ts)
  //    Viewer files have relative imports (../../core/*, ../../src/*) that break
  //    when moved outside the pneuma-skills source tree.
  const manifestSrc = join(sourceDir, "manifest.ts");
  if (existsSync(manifestSrc)) {
    cpSync(manifestSrc, join(forkPath, "manifest.ts"));
  }
  const skillSrc = join(sourceDir, "skill");
  if (existsSync(skillSrc)) {
    cpSync(skillSrc, join(forkPath, "skill"), { recursive: true });
  }
  const seedSrc = join(sourceDir, "seed");
  if (existsSync(seedSrc)) {
    cpSync(seedSrc, join(forkPath, "seed"), { recursive: true });
  }
  const hooksSrc = join(sourceDir, "hooks");
  if (existsSync(hooksSrc)) {
    cpSync(hooksSrc, join(forkPath, "hooks"), { recursive: true });
  }

  // 4. Generate a proxy pneuma-mode.ts that re-exports the original mode's viewer
  //    but uses this fork's manifest. The absolute import path lets Vite/Bun resolve
  //    all the original viewer's internal imports correctly.
  const originalPneumaMode = join(sourceDir, "pneuma-mode.ts");
  const proxyContent = `/**
 * Evolved mode — delegates viewer to the original ${proposal.mode} mode.
 * Only manifest + skill files are customized in this fork.
 * Auto-generated by Pneuma Evolution Agent.
 */
import { default as original } from "${originalPneumaMode}";
import manifest from "./manifest.js";

const evolvedMode = {
  ...original,
  manifest,
};

export default evolvedMode;
`;
  writeFileSync(join(forkPath, "pneuma-mode.ts"), proxyContent, "utf-8");

  // 5. Apply proposal changes to the forked skill files
  for (const change of proposal.changes) {
    const skillPath = mapWorkspacePathToModePath(change.file);
    if (!skillPath) continue;

    const targetPath = join(forkPath, skillPath);

    if (change.action === "create") {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, change.content, "utf-8");
    } else if (change.action === "modify") {
      let existing = "";
      if (existsSync(targetPath)) {
        existing = readFileSync(targetPath, "utf-8");
      }

      if (change.insertAt === "append" || !change.insertAt) {
        if (existing && !existing.endsWith("\n")) existing += "\n";
        writeFileSync(targetPath, existing + "\n" + change.content + "\n", "utf-8");
      }
    }
  }

  // 6. Update the manifest version + seedFiles paths in the forked mode
  const manifestPath = join(forkPath, "manifest.ts");
  if (existsSync(manifestPath)) {
    let manifestContent = readFileSync(manifestPath, "utf-8");
    manifestContent = manifestContent.replace(
      /version:\s*["']([^"']+)["']/,
      (_, v) => `version: "${v}-evolved"`,
    );
    manifestContent = manifestContent.replace(
      /displayName:\s*["']([^"']+)["']/,
      (_, name) => `displayName: "${name} (Evolved)"`,
    );
    // Rewrite seedFiles paths from "modes/<mode>/seed/..." to "seed/..."
    // External modes resolve seed paths relative to the mode directory
    manifestContent = manifestContent.replace(
      /["']modes\/[^/]+\/seed\//g,
      `"seed/`,
    );
    writeFileSync(manifestPath, manifestContent, "utf-8");
  }

  return forkPath;
}

/**
 * Map a workspace-relative file path to a mode-relative path.
 * e.g. ".claude/skills/pneuma-slide/SKILL.md" → "skill/SKILL.md"
 */
function mapWorkspacePathToModePath(wsPath: string): string | null {
  // Match .claude/skills/<installName>/<rest>
  const match = wsPath.match(/^\.claude\/skills\/[^/]+\/(.+)$/);
  if (match) {
    return `skill/${match[1]}`;
  }
  // CLAUDE.md doesn't map to mode files
  return null;
}
