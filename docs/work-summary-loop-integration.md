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

Key finding: tool_result content is **text, not JSON**. Each tool has a specific `mapToolResultToToolResultBlockParam` that converts internal data to human-readable text. The extraction logic must parse text with regex, not `JSON.parse()`.

Full protocol docs: `docs/cron-protocol.md`

### 2. Frontend Integration

#### Store (`src/store.ts`)
- `CronJob` interface: `{ id, cron, humanSchedule, prompt, recurring, durable, createdAt? }`
- New state: `cronJobs: CronJob[]`
- New actions: `setCronJobs`, `addCronJob`, `removeCronJob`
- Updated `Tab` type to include `"schedules"`

#### WebSocket Client (`src/ws.ts`)
- `extractCronJobsFromBlocks()` — mirrors existing `extractTasksFromBlocks()` pattern:
  - Tracks pending CronCreate tool_use inputs (Map by ID)
  - Parses CronCreate text results via regex: `Scheduled recurring job ID (schedule).`
  - Parses CronList multi-line text: `ID — schedule (recurring|one-shot) [session-only]: prompt`
  - Handles CronDelete by removing from store on tool_use
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

`server/__tests__/cron-extraction.test.ts` — 9 tests covering:
- CronCreate recurring, one-shot, durable result parsing
- CronList single/multi-line parsing, empty state
- Special characters in prompts
- CronDelete recognition

### 4. Test Results

- **325 tests pass** (316 existing + 9 new), 0 failures
- Build succeeds with no new errors

## Design Decisions

1. **Text regex parsing over JSON** — Claude Code's tool_result content is human-readable text, not JSON. Parsing with regex is necessary and works reliably with the fixed output format.

2. **Agent-mediated actions** — Cancel and Refresh send natural language messages to the agent rather than trying to directly invoke tools. This works through the existing chat flow and respects permissions.

3. **Dual tracking** — `pendingCronToolUse` Map tracks which tool_use IDs correspond to which cron tools, enabling correct result routing even when blocks arrive across multiple assistant messages.

4. **No new dependencies** — Pure TypeScript/React implementation following existing patterns.

## Known Limitations

- The `cron` field is empty in CronList results because the text format doesn't include the raw expression (only `humanSchedule`)
- Job state is client-side only — refreshing the browser loses tracked jobs until agent runs CronList again
- Cancel/Refresh require agent to be idle (uses `turnInProgress` guard)

## Files Changed

| File | Change |
|------|--------|
| `src/store.ts` | +31 lines — CronJob type, state, actions |
| `src/ws.ts` | +82 lines — extractCronJobsFromBlocks with text parsing |
| `src/components/TopBar.tsx` | +10 lines — Schedules tab + badge |
| `src/components/SchedulePanel.tsx` | +93 lines — New panel component |
| `src/App.tsx` | +2 lines — SchedulePanel import and render |
| `docs/cron-protocol.md` | +119 lines — Protocol documentation |
| `server/__tests__/cron-extraction.test.ts` | +120 lines — Regex tests |
