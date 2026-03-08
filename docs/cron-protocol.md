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
```
```

## `/loop` Slash Command

The `/loop` command is the user-facing interface for CronCreate. It translates human-friendly intervals into cron expressions:

| Input | Cron |
|-------|------|
| `5m` | `*/5 * * * *` |
| `1h` | `0 */1 * * *` |
| `30s` | Not supported (cron minimum is 1 minute) |

Usage: `/loop 5m check if the build passed`
