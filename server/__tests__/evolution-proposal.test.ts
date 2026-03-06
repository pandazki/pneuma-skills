import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  saveProposal,
  loadProposal,
  loadLatestProposal,
  listProposals,
  applyProposal,
  rollbackProposal,
  discardProposal,
  formatProposalForDisplay,
  updateClaudeMdEvolutionSummary,
} from "../evolution-proposal.js";
import type { EvolutionProposal } from "../evolution-proposal.js";

const TEST_DIR = join(import.meta.dir, ".tmp-evolution-test");

function makeWorkspace(): string {
  const ws = join(TEST_DIR, `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(join(ws, ".claude", "skills", "test-skill"), { recursive: true });
  writeFileSync(join(ws, ".claude", "skills", "test-skill", "SKILL.md"), "# Test Skill\n\nOriginal content.\n");
  writeFileSync(join(ws, "CLAUDE.md"), "# Project\n\nOriginal CLAUDE.md.\n");
  return ws;
}

function makeWorkspaceWithPneumaMarkers(): string {
  const ws = join(TEST_DIR, `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(join(ws, ".claude", "skills", "test-skill"), { recursive: true });
  writeFileSync(join(ws, ".claude", "skills", "test-skill", "SKILL.md"), "# Test Skill\n\nOriginal content.\n");
  writeFileSync(join(ws, "CLAUDE.md"), `# Project

<!-- pneuma:start -->
## Pneuma Test Mode

You are running inside Pneuma Test Mode.

### Core Rules
- Do not ask for confirmation
<!-- pneuma:end -->

## Other Section

Other content.
`);
  return ws;
}

function makeProposal(workspace: string, id = "evo-test-001"): EvolutionProposal {
  return {
    id,
    createdAt: new Date().toISOString(),
    mode: "test",
    workspace,
    status: "pending",
    summary: "Add user preferences section based on history analysis",
    changes: [
      {
        file: ".claude/skills/test-skill/SKILL.md",
        action: "modify",
        description: "Add user preferences section",
        evidence: [
          {
            sessionFile: "abc123.jsonl",
            quote: "I prefer dark themes",
            reasoning: "User explicitly stated preference for dark themes",
          },
        ],
        content: "## User Preferences\n<!-- evolved: 2026-03-06 -->\n\n- Prefers dark color schemes\n",
        insertAt: "append",
      },
    ],
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("proposal storage", () => {
  it("saves and loads a proposal", () => {
    const ws = makeWorkspace();
    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);

    const loaded = loadProposal(ws, proposal.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(proposal.id);
    expect(loaded!.summary).toBe(proposal.summary);
    expect(loaded!.changes).toHaveLength(1);
  });

  it("returns null for nonexistent proposal", () => {
    const ws = makeWorkspace();
    expect(loadProposal(ws, "nonexistent")).toBeNull();
  });

  it("loadLatestProposal returns most recent", () => {
    const ws = makeWorkspace();
    saveProposal(ws, makeProposal(ws, "evo-001"));
    saveProposal(ws, makeProposal(ws, "evo-002"));

    const latest = loadLatestProposal(ws);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe("evo-002");
  });

  it("listProposals returns all in reverse order", () => {
    const ws = makeWorkspace();
    saveProposal(ws, makeProposal(ws, "evo-001"));
    saveProposal(ws, makeProposal(ws, "evo-002"));
    saveProposal(ws, makeProposal(ws, "evo-003"));

    const proposals = listProposals(ws);
    expect(proposals).toHaveLength(3);
    expect(proposals[0].id).toBe("evo-003");
    expect(proposals[2].id).toBe("evo-001");
  });
});

describe("apply", () => {
  it("appends content to existing file and creates backup", () => {
    const ws = makeWorkspace();
    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);

    const result = applyProposal(ws, proposal.id);
    expect(result.success).toBe(true);
    expect(result.appliedFiles).toContain(".claude/skills/test-skill/SKILL.md");

    const content = readFileSync(join(ws, ".claude", "skills", "test-skill", "SKILL.md"), "utf-8");
    expect(content).toContain("Original content.");
    expect(content).toContain("## User Preferences");
    expect(content).toContain("evolved: 2026-03-06");

    const updated = loadProposal(ws, proposal.id);
    expect(updated!.status).toBe("applied");
    expect(updated!.appliedAt).toBeTruthy();
  });

  it("creates new files", () => {
    const ws = makeWorkspace();
    const proposal = makeProposal(ws);
    proposal.changes = [{
      file: ".claude/skills/test-skill/preferences.md",
      action: "create",
      description: "Create preferences file",
      evidence: [],
      content: "# Preferences\n\nDark themes preferred.\n",
    }];
    saveProposal(ws, proposal);

    const result = applyProposal(ws, proposal.id);
    expect(result.success).toBe(true);
    expect(existsSync(join(ws, ".claude", "skills", "test-skill", "preferences.md"))).toBe(true);
  });

  it("rejects already applied proposals", () => {
    const ws = makeWorkspace();
    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);

    applyProposal(ws, proposal.id);
    const result = applyProposal(ws, proposal.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("already applied");
  });
});

describe("rollback", () => {
  it("restores original file content after rollback", () => {
    const ws = makeWorkspace();
    const original = readFileSync(join(ws, ".claude", "skills", "test-skill", "SKILL.md"), "utf-8");

    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);
    applyProposal(ws, proposal.id);

    const modified = readFileSync(join(ws, ".claude", "skills", "test-skill", "SKILL.md"), "utf-8");
    expect(modified).not.toBe(original);

    const result = rollbackProposal(ws, proposal.id);
    expect(result.success).toBe(true);
    expect(result.restoredFiles).toContain(".claude/skills/test-skill/SKILL.md");

    const restored = readFileSync(join(ws, ".claude", "skills", "test-skill", "SKILL.md"), "utf-8");
    expect(restored).toBe(original);

    const updated = loadProposal(ws, proposal.id);
    expect(updated!.status).toBe("rolled_back");
  });

  it("removes created files on rollback", () => {
    const ws = makeWorkspace();
    const proposal = makeProposal(ws);
    proposal.changes = [{
      file: ".claude/skills/test-skill/new-file.md",
      action: "create",
      description: "Create new file",
      evidence: [],
      content: "New content\n",
    }];
    saveProposal(ws, proposal);
    applyProposal(ws, proposal.id);

    expect(existsSync(join(ws, ".claude", "skills", "test-skill", "new-file.md"))).toBe(true);

    rollbackProposal(ws, proposal.id);
    expect(existsSync(join(ws, ".claude", "skills", "test-skill", "new-file.md"))).toBe(false);
  });

  it("rejects rollback of non-applied proposals", () => {
    const ws = makeWorkspace();
    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);

    const result = rollbackProposal(ws, proposal.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not applied");
  });
});

describe("discard", () => {
  it("marks pending proposal as discarded", () => {
    const ws = makeWorkspace();
    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);

    expect(discardProposal(ws, proposal.id)).toBe(true);
    const updated = loadProposal(ws, proposal.id);
    expect(updated!.status).toBe("discarded");
  });

  it("rejects discarding applied proposals", () => {
    const ws = makeWorkspace();
    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);
    applyProposal(ws, proposal.id);

    expect(discardProposal(ws, proposal.id)).toBe(false);
  });
});

describe("formatProposalForDisplay", () => {
  it("produces readable output", () => {
    const ws = makeWorkspace();
    const proposal = makeProposal(ws);
    const output = formatProposalForDisplay(proposal);

    expect(output).toContain("Evolution Proposal");
    expect(output).toContain("evo-test");
    expect(output).toContain("Add user preferences section");
    expect(output).toContain("I prefer dark themes");
    expect(output).toContain("Evidence");
  });
});

describe("CLAUDE.md evolution sync", () => {
  it("applyProposal inserts evolved section into CLAUDE.md", () => {
    const ws = makeWorkspaceWithPneumaMarkers();
    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);

    applyProposal(ws, proposal.id);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("<!-- pneuma:evolved:start -->");
    expect(claudeMd).toContain("### Learned Preferences");
    expect(claudeMd).toContain("Add user preferences section");
    expect(claudeMd).toContain("<!-- pneuma:evolved:end -->");
    // Evolved section should be inside pneuma markers
    const evolvedStart = claudeMd.indexOf("<!-- pneuma:evolved:start -->");
    const pneumaEnd = claudeMd.indexOf("<!-- pneuma:end -->");
    expect(evolvedStart).toBeLessThan(pneumaEnd);
    // Other content should be preserved
    expect(claudeMd).toContain("## Other Section");
  });

  it("rollbackProposal restores original CLAUDE.md", () => {
    const ws = makeWorkspaceWithPneumaMarkers();
    const original = readFileSync(join(ws, "CLAUDE.md"), "utf-8");

    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);
    applyProposal(ws, proposal.id);

    // Verify evolved section was added
    const modified = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(modified).toContain("<!-- pneuma:evolved:start -->");

    rollbackProposal(ws, proposal.id);

    const restored = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(restored).toBe(original);
  });

  it("re-apply replaces existing evolved section", () => {
    const ws = makeWorkspaceWithPneumaMarkers();
    const proposal1 = makeProposal(ws, "evo-test-001");
    saveProposal(ws, proposal1);
    applyProposal(ws, proposal1.id);

    // Manually set to rolled_back so we can apply a second proposal
    rollbackProposal(ws, proposal1.id);

    const proposal2 = makeProposal(ws, "evo-test-002");
    proposal2.changes[0].description = "Add typography preferences";
    saveProposal(ws, proposal2);
    applyProposal(ws, proposal2.id);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    // Should have the second proposal's content
    expect(claudeMd).toContain("Add typography preferences");
    // Should only have one evolved section
    const count = (claudeMd.match(/<!-- pneuma:evolved:start -->/g) || []).length;
    expect(count).toBe(1);
  });

  it("works when CLAUDE.md has no pneuma markers (graceful no-op)", () => {
    const ws = makeWorkspace(); // No pneuma markers
    const original = readFileSync(join(ws, "CLAUDE.md"), "utf-8");

    const proposal = makeProposal(ws);
    saveProposal(ws, proposal);
    applyProposal(ws, proposal.id);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    // CLAUDE.md should NOT have evolved section (no pneuma markers to anchor to)
    expect(claudeMd).not.toContain("<!-- pneuma:evolved:start -->");
    // Original content should be unchanged
    expect(claudeMd).toBe(original);
  });

  it("updateClaudeMdEvolutionSummary replaces existing evolved block on second call", () => {
    const ws = makeWorkspaceWithPneumaMarkers();
    const proposal1 = makeProposal(ws, "evo-test-001");
    updateClaudeMdEvolutionSummary(ws, proposal1);

    const after1 = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(after1).toContain("Add user preferences section");

    const proposal2 = makeProposal(ws, "evo-test-002");
    proposal2.changes[0].description = "Use serif fonts by default";
    updateClaudeMdEvolutionSummary(ws, proposal2);

    const after2 = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(after2).toContain("Use serif fonts by default");
    expect(after2).not.toContain("Add user preferences section");
    // Still only one evolved section
    const count = (after2.match(/<!-- pneuma:evolved:start -->/g) || []).length;
    expect(count).toBe(1);
  });
});
