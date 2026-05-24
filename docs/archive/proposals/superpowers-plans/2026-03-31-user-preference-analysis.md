# User Preference Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all Pneuma modes the ability to analyze and maintain user preferences via a shared skill + file conventions + critical injection at startup.

**Architecture:** A new global skill dependency (`pneuma-preferences`) is installed for every mode by `skill-installer.ts`. Preference files live in `~/.pneuma/preferences/` as agent-managed Markdown. Critical sections (`<!-- pneuma-critical:start/end -->`) are extracted at startup and injected into the instructions file via a new `<!-- pneuma:preferences:start/end -->` marker section.

**Tech Stack:** TypeScript, Bun APIs, existing skill-installer infrastructure

**Spec:** `docs/design/2026-03-31-user-preference-analysis-design.md`
**ADR:** `docs/adr/adr-014-user-preference-analysis.md`

---

### Task 1: Create `pneuma-preferences` Skill (SKILL.md)

**Files:**
- Create: `modes/_shared/skills/pneuma-preferences/SKILL.md`

This is the core deliverable — the strategy document that guides agents on how to analyze, write, and maintain user preferences. Quality of this file directly determines the quality of the entire feature.

- [ ] **Step 1: Create the `_shared` directory structure**

```bash
mkdir -p modes/_shared/skills/pneuma-preferences
```

- [ ] **Step 2: Write SKILL.md**

Create `modes/_shared/skills/pneuma-preferences/SKILL.md` with:

```markdown
---
name: pneuma-preferences
description: >
  User preference analysis and maintenance. Use this skill to read, create, or update
  the user's preference profile — both cross-mode (aesthetics, cognition, collaboration style)
  and mode-specific habits. Consult preferences at the start of creative work;
  update them when you observe stable patterns.
---

# User Preference Analysis

You have access to a persistent preference system that remembers this user across sessions.
Preferences are stored as Markdown files in `~/.pneuma/preferences/`.

## File Layout

| File | Scope | Content |
|------|-------|---------|
| `profile.md` | Cross-mode | Aesthetics, cognition, collaboration style, deep profile |
| `mode-{name}.md` | Per-mode | Mode-specific habits, style choices, explicit instructions |

Files are created by you as needed. An absent file simply means no profile exists yet.

## Markers

Two markers have system-level meaning:

**Critical red lines** — injected into the instructions file at every session startup:
\`\`\`markdown
<!-- pneuma-critical:start -->
- Hard constraint here (e.g. "never use dark backgrounds")
<!-- pneuma-critical:end -->
\`\`\`

Only place truly non-negotiable, user-confirmed constraints here. Everything else belongs in the main body.

**Changelog** — maintained by you for incremental refresh:
\`\`\`markdown
<!-- changelog:start -->
## Changelog

- **2026-03-31** — Full refresh (2026-01 ~ 2026-03, 12 sessions)
  - Added: user prefers low-density layouts
  - Revised: aesthetic from "warm tones" to "low saturation"
  - Removed: temporary code style preference (obsolete)
<!-- changelog:end -->
\`\`\`

The rest of the file is free-form Markdown, entirely your domain.

## Three-Layer Preference Model

### Layer 1: Cross-Mode Observable Preferences (profile.md)

Surface patterns directly inferable from behavior:

- **Language & expression** — working language, formality, verbosity, terminology habits
- **Aesthetic sensibility** — color tendencies, layout density, typography instincts, style tone
- **Collaboration mode** — directive vs. collaborative, autonomy expectations, confirmation frequency, reaction to suggestions
- **Cognitive style** — big-picture-first vs. detail-first, visual vs. textual, how they frame problems

### Layer 2: Deep Profile (profile.md, deeper section)

Requires accumulated observation across multiple sessions. Do not write this layer from thin evidence.

- **Capability landscape** — technical depth, design sensitivity, domain knowledge boundaries
- **Value anchors** — efficiency vs. craft, innovation vs. stability, precision vs. intuition
- **Latent patterns** — what they consistently reach for without being asked, what they consistently avoid
- **Contradictions** — where behavior conflicts with stated preferences; record as-is, do not resolve

### Layer 3: Per-Mode Preferences (mode-{name}.md)

Concrete, mode-specific habits:

- Explicit instructions the user has given (quote or paraphrase, mark as "user-stated")
- Observed patterns you've inferred (mark as "observed")
- Critical constraints for this mode (in the `pneuma-critical` marker)

## Writing Principles

**This is a living document, not a label database.**

- **Full rewrite, not append** — each update is a fresh look at the whole portrait. Read the entire file, reconsider everything, rewrite what needs changing.
- **Natural-language confidence** — express certainty through prose: "consistently observed across 8+ sessions", "initial impression from two conversations", "user explicitly stated". No mechanical scores.
- **Preserve contradictions** — if behavior contradicts itself, record both sides. People are not consistent; forcing coherence is a lie.
- **Deletable** — any entry can be overturned by later observation. Nothing is permanent.
- **Temporary vs. stable** — distinguish "this project's special requirement" from "long-term stable preference". Temporary observations do not belong in the profile.
- **No labeling** — describe behavioral patterns and choice tendencies, not personality types. "Tends to request minimal text per slide" not "is a minimalist".
- **Neutral precision** — avoidance is avoidance, control is control. Do not prettify.

## Analysis Method

The most durable motivations hide in unconscious constancy.
Obvious preferences are merely projections of deeper logic.

- **Attend to the constant** — what does the user always do without being asked? That's where the real signal lives.
- **Reverse verify** — if your conclusion is X, you should observe Y behavior. Do you?
- **Isolate variables** — if you remove factor X, does pattern Y still appear? If so, X is not the cause.
- **Watch the shadows** — avoidance, hesitation, repeated corrections, emotional spikes. These reveal boundaries more clearly than positive choices.
- **Temporal awareness** — people change. A preference from 3 months ago may be obsolete. Weight recent observations more heavily, but don't discard old ones without reason.

## When to Read Preferences

- **Start of creative work in a mode** — check if `mode-{name}.md` and `profile.md` exist. If they do, read them and let them inform your approach. This is a very good first move.
- **When making aesthetic or style decisions** — consult rather than guess.
- **When the user seems surprised or corrects you** — check if this contradicts a recorded preference, or reveals a new one.

You do not need to announce that you're reading preferences. Just do it.

## When to Update Preferences

- **When you observe a stable new pattern** — not from a single instance, but from repetition or explicit statement.
- **When the user explicitly states a preference** — write it immediately, mark as user-stated.
- **When an existing entry is contradicted** — revise or annotate with the contradiction.
- **After a full refresh** — update the changelog.

You do not need to announce that you're updating preferences. Just do it.

## Full Refresh

A full refresh is a systematic review of all sessions within a time range:

1. **Determine scope** — check the changelog for the last refresh date. Sessions after that date are unprocessed.
2. **Enumerate sessions** — use the data scripts to list sessions:
   ```bash
   bun {EVOLVE_SCRIPTS}/list-sessions.ts --since {last_date}
   ```
3. **Extract conversation** — for each relevant session:
   ```bash
   bun {EVOLVE_SCRIPTS}/session-digest.ts --file {path}
   ```
4. **Analyze** — look for patterns across sessions. Apply the analysis method above.
5. **Rewrite** — update the preference files. Full rewrite, not append.
6. **Log** — add a changelog entry with date, scope, and summary of changes.

`{EVOLVE_SCRIPTS}` = the evolve mode's data access scripts directory. These are shared analysis tools, not part of the evolution workflow.

If the evolve scripts are not available (e.g., not installed), you can also read `~/.pneuma/sessions.json` for session listing and `{workspace}/.pneuma/history.json` for conversation data directly.

## Concurrent Access

Multiple sessions may run simultaneously. Since preference updates are infrequent and you perform full rewrites, the last writer wins. To minimize data loss: always read the latest file content before rewriting.
```

- [ ] **Step 3: Commit**

```bash
git add modes/_shared/skills/pneuma-preferences/SKILL.md
git commit -m "feat: add pneuma-preferences skill — user preference analysis strategy"
```

---

### Task 2: Add preference critical extraction to skill-installer

**Files:**
- Modify: `server/skill-installer.ts` (add marker constants, `extractPreferenceCritical()`, `injectPreferencesSection()`, call site in `installSkill()`)

- [ ] **Step 1: Write test for critical extraction**

Add to `server/__tests__/skill-installer.test.ts`:

```typescript
describe("preference critical extraction", () => {
  it("extracts critical section from preference file", () => {
    // Directly test extractPreferenceCritical with a temp file
    const content = `# Profile\n\nSome observations.\n\n<!-- pneuma-critical:start -->\n- Never use dark backgrounds\n- Always use Chinese\n<!-- pneuma-critical:end -->\n\nMore content.`;
    const tmpFile = join(tmpDir, "test-prefs.md");
    writeFileSync(tmpFile, content, "utf-8");

    const result = extractPreferenceCritical(tmpFile);
    expect(result).toBe("- Never use dark backgrounds\n- Always use Chinese");
  });

  it("returns null when file does not exist", () => {
    const result = extractPreferenceCritical("/nonexistent/path.md");
    expect(result).toBeNull();
  });

  it("returns null when no critical markers exist", () => {
    const tmpFile = join(tmpDir, "no-critical.md");
    writeFileSync(tmpFile, "# Profile\n\nJust observations.", "utf-8");

    const result = extractPreferenceCritical(tmpFile);
    expect(result).toBeNull();
  });

  it("returns null when critical section is empty", () => {
    const tmpFile = join(tmpDir, "empty-critical.md");
    writeFileSync(tmpFile, "<!-- pneuma-critical:start -->\n<!-- pneuma-critical:end -->", "utf-8");

    const result = extractPreferenceCritical(tmpFile);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test server/__tests__/skill-installer.test.ts
```

- [ ] **Step 3: Implement extractPreferenceCritical in skill-installer.ts**

Add after the existing marker constants (around line 28):

```typescript
// Preference critical markers
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
    return null; // File doesn't exist — silent skip
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test server/__tests__/skill-installer.test.ts
```

- [ ] **Step 5: Write test for preferences section injection into instructions file**

```typescript
describe("preferences section injection in installSkill", () => {
  it("injects critical preferences from profile.md and mode file", () => {
    // Create preference files in a temp ~/.pneuma/preferences/
    // (mock homedir or use env override)
    // After installSkill(), CLAUDE.md should contain:
    // <!-- pneuma:preferences:start -->
    // ### User Preferences (Critical)
    // **Global:**
    // - constraint
    // **slide Mode:**
    // - mode constraint
    // <!-- pneuma:preferences:end -->
  });

  it("skips preferences section when no preference files exist", () => {
    // After installSkill(), CLAUDE.md should NOT contain pneuma:preferences markers
  });

  it("skips preferences section when files exist but have no critical markers", () => {
    // Same as above
  });

  it("creates ~/.pneuma/preferences/ directory if missing", () => {
    // Verify directory is created
  });
});
```

- [ ] **Step 6: Implement preferences injection in installSkill()**

In `installSkill()`, add after step 1c (skill dependencies) and before step 2 (instructions file injection):

```typescript
// 1d. Ensure preferences directory exists
const prefsDir = join(homedir(), ".pneuma", "preferences");
mkdirSync(prefsDir, { recursive: true });
```

Then after writing the instructions file content (after the skills section, before `writeFileSync`), add:

```typescript
// 2d. Inject/update preferences critical section
const prefsDir = join(homedir(), ".pneuma", "preferences");
const globalCritical = extractPreferenceCritical(join(prefsDir, "profile.md"));
const modeName = skillConfig.installName.replace(/^pneuma-/, "");
const modeCritical = extractPreferenceCritical(join(prefsDir, `mode-${modeName}.md`));

if (globalCritical || modeCritical) {
  const prefsLines: string[] = ["### User Preferences (Critical)", ""];
  if (globalCritical) {
    prefsLines.push("**Global:**", globalCritical, "");
  }
  if (modeCritical) {
    prefsLines.push(`**${modeName} Mode:**`, modeCritical);
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
  // Remove stale preferences section if no critical content
  const pStart = content.indexOf(PREFS_MARKER_START);
  const pEnd = content.indexOf(PREFS_MARKER_END);
  if (pStart !== -1 && pEnd !== -1) {
    content = content.substring(0, pStart) + content.substring(pEnd + PREFS_MARKER_END.length);
  }
}
```

- [ ] **Step 7: Run tests**

```bash
bun test server/__tests__/skill-installer.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add server/skill-installer.ts server/__tests__/skill-installer.test.ts
git commit -m "feat: extract preference critical sections and inject into instructions file"
```

---

### Task 3: Add global skill dependency injection

**Files:**
- Modify: `server/skill-installer.ts` (add global dependency install logic)

- [ ] **Step 1: Write test for global skill dependency**

```typescript
describe("global skill dependencies", () => {
  it("installs pneuma-preferences as global skill dependency for all modes", () => {
    // After installSkill(), .claude/skills/pneuma-preferences/SKILL.md should exist
    // CLAUDE.md skills section should include pneuma-preferences entry
  });

  it("works alongside mode-specific skill dependencies", () => {
    // If mode has its own deps, pneuma-preferences is added to the same section
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement global dependency injection**

In `installSkill()`, after mode-specific skill dependencies (step 1c), add:

```typescript
// 1d. Install global skill dependencies (framework-level, not mode-specific)
const globalDeps = getGlobalSkillDependencies();
if (globalDeps.length > 0) {
  const globalSnippets = installSkillDependencies(
    workspace,
    globalDeps,
    join(import.meta.dirname, "..", "modes", "_shared"), // _shared as the "mode source"
    params,
    backendType,
  );
  skillSnippets.push(...globalSnippets);
}
```

Add the helper function:

```typescript
/**
 * Returns framework-level skill dependencies that are installed for ALL modes.
 * These provide universal agent capabilities (e.g., user preference analysis).
 */
function getGlobalSkillDependencies(): SkillDependency[] {
  const sharedDir = join(import.meta.dirname, "..", "modes", "_shared");
  const prefsDir = join(sharedDir, "skills", "pneuma-preferences");

  // Only include if the skill exists (forward compatibility)
  if (!existsSync(prefsDir)) return [];

  return [{
    name: "pneuma-preferences",
    sourceDir: "skills/pneuma-preferences",
    claudeMdSnippet: "**pneuma-preferences** — Read and maintain user preference profiles across sessions",
  }];
}
```

- [ ] **Step 4: Run tests**

```bash
bun test server/__tests__/skill-installer.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/skill-installer.ts server/__tests__/skill-installer.test.ts
git commit -m "feat: install pneuma-preferences as global skill dependency for all modes"
```

---

### Task 4: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add preferences system documentation to CLAUDE.md**

Add a new section in the project structure or after the session registry section:

```markdown
### User Preferences

Persistent user preference files managed by the agent:

- **Directory:** `~/.pneuma/preferences/`
- **Files:** `profile.md` (cross-mode), `mode-{name}.md` (per-mode)
- **Format:** Agent-managed Markdown with two system markers:
  - `<!-- pneuma-critical:start/end -->` — Hard constraints, extracted and injected into instructions file at startup
  - `<!-- changelog:start/end -->` — Update log for incremental refresh
- **Injection:** `<!-- pneuma:preferences:start/end -->` marker in CLAUDE.md/AGENTS.md
- **Skill:** `pneuma-preferences` installed as global dependency for all modes
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add user preferences system documentation"
```

---

### Task 5: End-to-end verification

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

- [ ] **Step 2: Manual test — start a mode and verify skill installation**

```bash
bun run dev slide --workspace /tmp/test-prefs --no-open
```

Check:
- `~/.pneuma/preferences/` directory exists
- `/tmp/test-prefs/.claude/skills/pneuma-preferences/SKILL.md` exists
- `/tmp/test-prefs/CLAUDE.md` contains `pneuma-preferences` in skills section
- No errors in console

- [ ] **Step 3: Manual test — create preference files and verify critical injection**

Create test preference files:
```bash
mkdir -p ~/.pneuma/preferences
echo '# Profile\n\n<!-- pneuma-critical:start -->\n- Always respond in Chinese\n<!-- pneuma-critical:end -->' > ~/.pneuma/preferences/profile.md
echo '# Slide Preferences\n\n<!-- pneuma-critical:start -->\n- Never use font size below 24px\n<!-- pneuma-critical:end -->' > ~/.pneuma/preferences/mode-slide.md
```

Re-run mode, verify CLAUDE.md contains:
```
<!-- pneuma:preferences:start -->
### User Preferences (Critical)

**Global:**
- Always respond in Chinese

**slide Mode:**
- Never use font size below 24px
<!-- pneuma:preferences:end -->
```

- [ ] **Step 4: Manual test — verify no critical = no injection**

Remove the test preference files, re-run mode, verify no `pneuma:preferences` section in CLAUDE.md.

- [ ] **Step 5: Real-world test — start a session and let the agent use preferences**

Start a real session with an existing workspace that has history. Verify the agent can:
- See `pneuma-preferences` in its available skills
- Read/create preference files
- The SKILL.md strategy is accessible and usable
