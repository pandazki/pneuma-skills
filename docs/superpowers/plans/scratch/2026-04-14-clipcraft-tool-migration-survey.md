# Plan 9 Scoping Survey: ClipCraft Tool Migration

**Date:** 2026-04-14 | **Task:** Migrate legacy MCP tools onto new craft-based architecture | **Target:** <600 words

---

## 1. Legacy MCP Tool Surface

**Location:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/modes/clipcraft-legacy/`

**MCP Servers declared** (manifest.ts:88–125):
- `clipcraft-imagegen` → `scripts/clipcraft-imagegen.mjs`
- `clipcraft-videogen` → `scripts/clipcraft-videogen.mjs`
- `clipcraft-tts` → `scripts/clipcraft-tts.mjs`
- `clipcraft-bgm` → `scripts/clipcraft-bgm.mjs`

**Tool shapes** (sample: imagegen.mjs:41–72):
- `generate_image(prompt, width?, height?, style?, output_path)` → writes file to disk
- `edit_image(source_path, instructions, output_path)` → returns same
- Each MCP server has analogous `generate_*` / `edit_*` / `list_*` tools

**Asset lifecycle** (storyboard protocol, manifest.ts:45–50):
1. Agent writes placeholder with `status: "generating"` to `storyboard.json`
2. Calls MCP tool → tool writes asset file to `assets/{type}/`
3. Agent updates entry: `status: "ready"`, `source: "path/to/file"`, `thumbnail`
4. On error: `status: "error"`, `errorMessage`

**Provenance:** Legacy mode doesn't explicitly track provenance in the storyboard schema. Generation params (prompt, model, seed) are **not captured on-disk**—they live only in agent context.

**Provider APIs:** fal.ai (image/video), OpenRouter (tts/bgm); API keys via env vars (`IMAGE_API_KEY`, `VIDEO_API_KEY`, `TTS_API_KEY`, `BGM_API_KEY`).

---

## 2. Craft Upstream Generate/Derive Support

**Location:** `/Users/pandazki/Codes/pneuma-craft/packages/core/src/types.ts`

**Operation types** (lines 43–49):
```typescript
type OperationType = 'upload' | 'import' | 'generate' | 'derive' | 'select' | 'composite'
```
Both `'generate'` and `'derive'` are first-class in the type union. ✓

**Operation shape** (lines 51–58):
```typescript
interface Operation {
  type: OperationType
  actor: 'human' | 'agent'
  agentId?: string                    // e.g. "clipcraft-videogen"
  params?: Record<string, unknown>    // free-form; convention: model, prompt, seed, durationMs, costUsd, providerJobId
  label?: string                      // e.g. "runway gen3-alpha-turbo"
  timestamp: number
}
```
Supports agent-authored generations with arbitrary metadata. ✓

**Asset lifecycle** (lines 14–16):
```typescript
type AssetStatus = 'pending' | 'generating' | 'ready' | 'failed'
```
Declared at `Asset.status?` (optional, defaults to 'ready'). Transitions are **not enforced**—the system treats status as advisory; commands are `asset:set-status`. ✓

**Dispatch commands** (lines 95–105):
- `asset:register` — create asset with optional id, type, uri, name, metadata
- `asset:update-metadata` — change width/height/duration/codec after generation
- `asset:set-status` — transition `pending` → `generating` → `ready` / `failed`
- `provenance:link` — attach operation edge to asset
- `provenance:set-root` — set origin of a generated asset (no fromAssetId)

No specific "queue generation" or "async dispatch" command—status transitions are manual. Plan 9 tools must coordinate this themselves.

---

## 3. Pneuma Viewer-Action Protocol

**Location:** `/Users/pandazki/Codes/pneuma-skills/core/types/viewer-contract.ts` and `mode-manifest.ts`

**ViewerApiConfig.actions** (mode-manifest.ts:149–156):
```typescript
actions?: Array<{
  id: string
  label: string
  category: 'file' | 'navigate' | 'ui' | 'custom'
  agentInvocable: boolean           // ← Key for agent-callable tools
  params?: Record<string, { type, description, required? }>
  description?: string
}>
```

**How it flows** (viewer-contract.ts:149–162):
- Agent calls `viewer_action` tool with `actionId` + params
- Runtime delivers via `actionRequest` prop to PreviewComponent
- Component executes and returns `onActionResult(requestId, { success, message, data })`
- **No built-in async/backend support**—actions must complete synchronously or return a promise the runtime can await

**Existing examples:**
- `illustrate/manifest.ts:83–107` — `navigate-to`, `fit-view`, `zoom-to-row` (all synchronous navigation)
- `clipcraft-legacy/manifest.ts:154–189` — `play-preview`, `pause-preview`, `select-scene`, `set-aspect-ratio` (playback UI control)
- No examples of actions that spawn long-running backend processes or file I/O

**Agent awareness** (skill-installer):
- Only `agentInvocable: true` actions are listed in CLAUDE.md
- Agent cannot invoke arbitrary actions; manifest declares the whitelist

**Conclusion:** The viewer-action protocol is **synchronous UI operations only**. It cannot spawn backend generation jobs or return streaming results. ← **Critical constraint for Plan 9 design.**

---

## 4. Current ClipCraft-by-Pneuma-Craft Tool State

**Location:** `/Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft/modes/clipcraft/`

**Manifest.ts (bootstrap):**
- `viewerApi` is **absent entirely** (no actions, no commands, no locators)
- `skill.mcpServers` is **absent** (no tool declarations yet)
- Only `sources.project` (json-file) is declared; no read-only file-glob for assets

**pneuma-mode.ts:**
- `extractContext()` returns minimal stub: `<viewer-context mode="clipcraft" files="N">`
- No domain-aware context (asset inventory, generation status, etc.)
- No action handlers

**Expected state:** Plan 5+ will add playback, UI, and actions. Plan 9 (this plan) targets **tool surface only**. No viewer interactions declared yet; the bootstrap is intentionally minimal.

---

## Open Questions for the Plan

1. **MCP vs viewer-action?** Legacy mode uses MCP servers for generation. New mode could either (a) keep MCP servers + skill-level tool docs, or (b) model generation as agent-initiated `provenance:link` + `asset:set-status` commands (viewer-agnostic). MCP is agent-native, but requires subprocess management. Which pattern fits the new architecture?

2. **Long-running generation?** Legacy tools write files synchronously (fal.ai / OpenRouter block). Should Plan 9 design assume **synchronous blocking** for simplicity, or introduce an **async queue** with status polling? (Affects provenance timing and agent UX.)

3. **Provenance in SKILL.md?** New skill must document generation workflow. Should the skill be "use Edit tool to write to project.json directly" (today's state) or "call MCP/viewer tools that handle provenance for you" (Plan 9 intent)?

4. **Asset file organization?** Legacy uses `assets/{type}/filename`. Should new mode preserve this, or adopt craft-native file handling (e.g., `/assets/asset-{id}.{ext}`)?

5. **Parallel generations?** Legacy mode processes one tool call at a time (agent waits). Should Plan 9 support multiple concurrent generations? (Requires status polling and store event subscription.)

6. **Viewer-initiated generation?** Should the viewer (Plan 5+ UI) be able to spawn generations directly, or only the agent? If viewer-initiated, is that a `viewer_command` → agent notification, or a separate action type?
