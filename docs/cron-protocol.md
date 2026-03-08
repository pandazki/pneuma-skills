# Claude Code Cron Protocol (Reverse-Engineered)

Documented from Claude Code v2.1.71 binary analysis.

## Tools

### CronCreate

Creates a new scheduled job.

**Input:**
```json
{
  "cron": "*/5 * * * *",
  "prompt": "Check build status and report",
  "recurring": true,
  "durable": false
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `cron` | string | yes | — | Cron expression (standard 5-field) |
| `prompt` | string | yes | — | Message sent to the agent on each trigger |
| `recurring` | boolean | no | `true` | If false, job fires once then auto-deletes |
| `durable` | boolean | no | `false` | If true, persists to disk across sessions |

**Output:**
```json
{
  "id": "cron_abc123",
  "humanSchedule": "every 5 minutes",
  "recurring": true,
  "durable": false
}
```

### CronDelete

Deletes a scheduled job by ID.

**Input:**
```json
{ "id": "cron_abc123" }
```

**Output:**
```json
{ "id": "cron_abc123" }
```

### CronList

Lists all active scheduled jobs.

**Input:**
```json
{}
```

**Output:**
```json
{
  "jobs": [
    {
      "id": "cron_abc123",
      "cron": "*/5 * * * *",
      "humanSchedule": "every 5 minutes",
      "prompt": "Check build status and report",
      "recurring": true,
      "durable": false
    }
  ]
}
```

## Storage

- **Durable jobs** (`durable: true`): Stored in `.claude/scheduled_tasks.json` in the workspace. Survive session restarts.
- **Session jobs** (`durable: false`): Held in-memory only. Lost when the CLI process exits.

## Limits

- Maximum 50 concurrent jobs
- Jobs auto-expire after 3 days regardless of durability
- Non-recurring jobs fire once, then are automatically deleted

## Wire Format

Cron tools appear as standard `tool_use` / `tool_result` content blocks in assistant messages.

**Important:** The `tool_result` content is human-readable **text**, not JSON.

### CronCreate

```json
// tool_use (input is JSON)
{ "type": "tool_use", "id": "toolu_abc", "name": "CronCreate",
  "input": { "cron": "0 */1 * * *", "prompt": "Run tests", "recurring": true } }

// tool_result (content is TEXT)
{ "type": "tool_result", "tool_use_id": "toolu_abc",
  "content": "Scheduled recurring job abc123 (every hour). Session-only (not written to disk, dies when Claude exits). Auto-expires after 3 days. Use CronDelete to cancel sooner." }
```

### CronDelete

```json
{ "type": "tool_result", "tool_use_id": "toolu_xyz",
  "content": "Cancelled job abc123." }
```

### CronList

```json
// Multiple jobs → newline-separated text lines
{ "type": "tool_result", "tool_use_id": "toolu_list",
  "content": "abc123 — every hour (recurring) [session-only]: Run tests\ndef456 — every 5 minutes (one-shot): Check deploy status" }

// No jobs
{ "type": "tool_result", "tool_use_id": "toolu_list",
  "content": "No scheduled jobs." }
## `/loop` Slash Command

The `/loop` command is a bundled skill (user-invocable) that translates human-friendly intervals into cron expressions and calls CronCreate.

### Syntax

```
/loop [interval] <prompt>
/loop <prompt> every <interval>
/loop <prompt>                     # defaults to 10m
```

### Interval Parsing (priority order)

1. **Leading token** (`/loop 30m check build`) — regex `^\d+[smhd]$`
2. **Trailing "every" clause** (`/loop check build every 2h`)
3. **No interval** — defaults to **10 minutes**

### Supported Units

| Unit | Example | Cron |
|------|---------|------|
| `m` (minutes) | `5m` | `*/5 * * * *` |
| `h` (hours) | `2h` | `0 */2 * * *` |
| `d` (days) | `1d` | `0 0 */1 * *` |
| `s` (seconds) | `30s` | Rounded up to 1 minute |

### Can loop other commands

```
/loop 20m /review-pr 1234
/loop 1h /standup 1
```

## Scheduler Runtime Details

- **Tick interval:** Every 1 second
- **Execution:** Fires between turns (waits if agent is busy)
- **No catch-up:** Missed intervals fire once when idle, not per missed interval
- **Jitter:** Recurring tasks fire up to 10% late (max 15 min); one-shot tasks up to 90s early
- **Jitter is deterministic** per job ID (hash of first 8 hex chars)
- **Timezone:** All times in local timezone
- **Feature flag:** `tengu_kairos_cron` (polled every 5 minutes)
- **Disable:** Set `CLAUDE_CODE_DISABLE_CRON=1`

## One-Shot Reminders

Natural language scheduling also uses CronCreate with `recurring: false`:
```
"remind me at 3pm to push the release branch"
"in 45 minutes, check whether tests passed"
```
