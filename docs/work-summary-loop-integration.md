# Work Summary: Claude Code Cron/Loop Integration

**Branch:** `feat/loop-integration`
**Worktree:** `../pneuma-skills-loop`
**Date:** 2026-03-09

## What was done

### 1. Protocol Reverse Engineering

Analyzed the Claude Code v2.1.71 native binary (`strings` extraction) to fully document the cron scheduling protocol:

- **CronCreate** — schedules recurring or one-shot prompts with standard 5-field cron expressions
- **CronDelete** — cancels a job by ID
- **CronList** — lists all active jobs

Key finding: `tool_result` content is **text, not JSON**. Each tool has a specific `mapToolResultToToolResultBlockParam` that converts internal data to human-readable text.

**Critical finding (from E2E testing):** In the SDK WebSocket stream (`--sdk-url` mode), `tool_result` blocks are **NOT forwarded** to the browser at all. Only `tool_use` blocks appear in assistant messages. The CLI handles tool results internally and produces a natural-language text response.

Full protocol docs: `docs/cron-protocol.md`

### 2. Frontend Integration

#### Store (`src/store.ts`)
- `CronJob` interface: `{ id, cron, humanSchedule, prompt, recurring, durable, createdAt? }`
- New state: `cronJobs: CronJob[]`
- New actions: `setCronJobs`, `addCronJob`, `removeCronJob`
- Updated `Tab` type to include `"schedules"`

#### WebSocket Client (`src/ws.ts`)
- **Optimistic extraction from `tool_use` blocks** — the final working approach after 3 iterations:
  1. ~~JSON.parse on tool_result content~~ (failed: content is text, not JSON)
  2. ~~Regex parsing of tool_result text~~ (failed: tool_result blocks don't exist in SDK stream)
  3. ~~Regex parsing of follow-up text blocks~~ (failed: agent response is free-form natural language)
  4. **Direct extraction from `tool_use` input blocks** (working)
- `cronIdFromToolUseId()` — generates display ID from tool_use block ID
- `cronToHuman()` — converts cron expressions to human-readable strings locally
- `extractCronJobsFromBlocks()` — intercepts CronCreate/CronDelete tool_use blocks
- `seenCronToolUseIds` Set — deduplicates blocks across live + history replay
- Called in both live message handling and history replay

#### TopBar (`src/components/TopBar.tsx`)
- Added "Schedules" tab
- Count badge shows number of active cron jobs

#### SchedulePanel (`src/components/SchedulePanel.tsx`)
- Empty state with clock icon and `/loop` hint
- Job list: prompt, humanSchedule, recurring/one-shot/durable badges
- Cancel button (sends natural language request to agent)
- Refresh button (asks agent to run CronList)

#### App (`src/App.tsx`)
- Added SchedulePanel render for schedules tab

### 3. Tests

`server/__tests__/cron-extraction.test.ts` — 16 tests covering:
- `cronIdFromToolUseId()` — prefix stripping, short IDs
- `cronToHuman()` — minute/hour/day patterns, unrecognized/invalid expressions
- CronCreate tool_use extraction — full job construction, defaults
- CronDelete tool_use extraction — ID extraction
- [Protocol ref] CronCreate/CronList text parsing — regex patterns for documentation

### 4. E2E Test Results

Tested in a live Pneuma doc mode session (`/tmp/pneuma-loop-test`):

| Test | Result |
|------|--------|
| CronCreate → Schedules tab shows job | PASS |
| Second CronCreate → badge shows 2, both jobs listed | PASS |
| CronDelete → job removed, badge decremented | PASS |
| Session history replay → jobs restored on page load | PASS |
| Schedule details (prompt, humanSchedule, badges) | PASS |
| Empty state with `/loop` hint | PASS (before any jobs) |
| Full test suite (332 tests) | PASS, 0 failures |

### 5. Build Status

- **332 tests pass** (316 existing + 16 new), 0 failures
- Build succeeds with no new errors

## Design Decisions

1. **Optimistic tool_use extraction** — Since tool_result blocks are not forwarded through the SDK stream, and the agent's natural-language response doesn't follow a parseable format, we extract job data directly from CronCreate tool_use inputs. This provides immediate UI feedback.

2. **Synthetic display IDs** — The real job ID (assigned by Claude Code's scheduler) is only available in the tool_result, which we can't see. We generate a display ID from the tool_use block ID. The Cancel button sends this ID in a natural language message, which the agent handles correctly.

3. **Local cron-to-human conversion** — `cronToHuman()` converts common cron patterns (*/N minutes, hours, days) to readable strings. Uncommon patterns fall back to the raw cron expression.

4. **Agent-mediated actions** — Cancel and Refresh send natural language messages to the agent rather than trying to directly invoke tools. This works through the existing chat flow and respects permissions.

5. **No new dependencies** — Pure TypeScript/React implementation following existing patterns.

## Known Limitations

1. **Synthetic IDs** — The display ID doesn't match the real scheduler job ID. Cancel works via natural language intent, not exact ID matching.
2. **Job state is client-side only** — Refreshing the browser loses tracked jobs until a CronCreate occurs again or the agent runs CronList (which also can't be parsed reliably).
3. **CronList not parseable** — The agent's response to CronList is free-form natural language, so we can't automatically extract jobs from it. The Refresh button is a best-effort feature.
4. **Cancel/Refresh require agent idle** — Uses `turnInProgress` guard to avoid interrupting active turns.

## Files Changed

| File | Change |
|------|--------|
| `src/store.ts` | +31 lines — CronJob type, state, actions |
| `src/ws.ts` | +65 lines — optimistic cron extraction from tool_use blocks |
| `src/components/TopBar.tsx` | +10 lines — Schedules tab + badge |
| `src/components/SchedulePanel.tsx` | +93 lines — New panel component |
| `src/App.tsx` | +2 lines — SchedulePanel import and render |
| `docs/cron-protocol.md` | +178 lines — Protocol documentation with SDK stream findings |
| `server/__tests__/cron-extraction.test.ts` | +165 lines — Unit tests for extraction + protocol ref |
