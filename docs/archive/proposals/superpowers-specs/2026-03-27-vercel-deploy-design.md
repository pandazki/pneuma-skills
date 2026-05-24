# Vercel Deploy Feature Design

**Date:** 2026-03-27
**Status:** Draft

## Overview

Add per-mode deployment capability to Vercel. Each mode owns its deploy button and packaging logic; the platform provides shared auth, status detection, and deployment infrastructure. First implementation targets webcraft mode, then extends to all builtin modes.

## Architecture

Three layers, following the existing R2 pattern:

```
Global Config:  ~/.pneuma/vercel.json (token) + CLI detection
       ↓
Status API:     GET /api/vercel/status → { available, method, user }
       ↓
Mode Layer:     Each mode's export page owns its deploy button + packaging
       ↓
Deploy API:     POST /api/vercel/deploy (shared, mode-agnostic)
```

## Authentication

**Priority: CLI → Token → Unavailable**

1. Detect `vercel` CLI installed and logged in (`vercel whoami`)
2. Fallback to `~/.pneuma/vercel.json` token
3. Neither available → button disabled with hint

### CLI Detection

```typescript
// Check: which vercel → vercel whoami
// If both succeed → method: "cli", user: whoami output
```

### Token Storage

File: `~/.pneuma/vercel.json`
```json
{
  "token": "xxx",
  "teamId": null
}
```

### Launcher Settings

New "Vercel" section in Launcher settings (alongside existing Cloud Storage section):
- Show CLI detection status ("Vercel CLI: connected as @user" or "not found")
- Token input field (when CLI not available or user prefers token)
- Team selector (fetched from Vercel API when authenticated)

## Server API

All endpoints are global (not mode-specific).

### Status & Config

| Endpoint | Description |
|----------|-------------|
| `GET /api/vercel/status` | `{ available: bool, method: "cli"\|"token"\|null, user?: string }` |
| `GET /api/vercel/config` | Token config (masked) + CLI status |
| `POST /api/vercel/config` | Save token to `~/.pneuma/vercel.json` |
| `GET /api/vercel/teams` | List user's teams (for scope selection) |

### Deploy

| Endpoint | Description |
|----------|-------------|
| `POST /api/vercel/deploy` | Deploy files to Vercel |

**Request body:**
```typescript
{
  files: Array<{ path: string; content: string }>;
  projectName?: string;   // First deploy: desired project name
  projectId?: string;     // Subsequent deploys: from deploy.json
  teamId?: string;        // Team scope (null = personal)
  framework?: string;     // Vercel framework preset (null = static)
}
```

**Response:**
```typescript
{
  url: string;            // Production URL (e.g. my-site.vercel.app)
  projectId: string;      // For binding
  deploymentUrl: string;  // This specific deployment URL
}
```

### Implementation by Auth Method

| | CLI | Token API |
|---|-----|-----------|
| Deploy | Write temp dir → `vercel deploy --prod --yes` | `POST https://api.vercel.com/v13/deployments` |
| Project binding | Pre-write `.vercel/project.json` in temp dir | projectId from API response |
| User info | `vercel whoami` | `GET https://api.vercel.com/v2/user` |
| Teams | `vercel teams list` | `GET https://api.vercel.com/v2/teams` |

Both methods are transparent to the export page — everything goes through `POST /api/vercel/deploy`.

## Deploy Binding

Stored in `.pneuma/deploy.json`:
```json
{
  "vercel": {
    "projectId": "prj_xxx",
    "projectName": "my-webcraft-site",
    "teamId": null,
    "url": "https://my-webcraft-site.vercel.app",
    "lastDeployedAt": "2026-03-27T12:00:00Z"
  }
}
```

- Created on first deploy, read on subsequent deploys
- Enables "Update existing project" without re-prompting

## First Deploy Flow (Interactive)

When no binding exists in `deploy.json`:

1. User clicks "Deploy to Vercel" in export page toolbar
2. Check `GET /api/vercel/status` — if unavailable, show setup hint
3. Show configuration form:
   - **Project name** — default: session name or workspace directory name
   - **Team/Scope** — dropdown from `GET /api/vercel/teams`, default: personal
4. User confirms → `POST /api/vercel/deploy`
5. On success: show deployed URL, write binding to `deploy.json`

## Subsequent Deploy Flow

When binding exists:

1. User clicks "Deploy to Vercel"
2. Read binding from `deploy.json` → pass `projectId` to deploy API
3. Deploy directly, no form
4. Show updated URL + timestamp
5. Optionally: "Unlink" button to clear binding and re-configure

## Webcraft Mode (First Implementation)

### Deploy Button Location

In the webcraft export page toolbar (`/export/webcraft`), alongside existing Download HTML / ZIP buttons.

### Packaging

Webcraft deploys as a static multi-page site:

```
/index.html              ← Aggregation homepage
/{contentSet}/index.html ← Content set landing (grid of pages)
/{contentSet}/{page}.html ← Individual page (self-contained)
```

**Aggregation homepage (`index.html`):**
- Lists all content sets
- Each content set shows a grid of its pages (thumbnails or titles)
- Clicking navigates to the individual page

**Individual pages:**
- Self-contained HTML with inlined assets (using existing `inlineAssets()` logic)
- Each page has its own URL path

**Framework preset:** `null` (static site, no build step)

### Export Page UI Changes

Add to the webcraft export toolbar:
- "Deploy to Vercel" button (enabled/disabled based on vercel status)
- Status indicator: "Last deployed: {time}" when binding exists
- Deploy progress feedback (deploying... → success URL / error)

## Future Mode Extensions

After webcraft is complete, extend to other modes. Each mode implements:

1. **Packaging logic** — what files to generate and how to organize them
2. **Deploy button** — in its export page toolbar (or dedicated UI if no export page)

Expected patterns:
- **slide** — static site with slide pages
- **remotion** — exported HTML player or rendered video hosting
- **draw** — exported SVG/PNG hosting
- **doc** — static document site
- **gridboard** — interactive dashboard site

## Vercel Infrastructure Module

New file: `server/vercel.ts` (parallel to `server/share.ts`)

Responsibilities:
- `getVercelConfig()` / `saveVercelConfig()` — token persistence
- `checkVercelCli()` — CLI detection + login status
- `getVercelStatus()` — combined availability check
- `deployToVercel(opts)` — unified deploy (routes to CLI or API)
- `getVercelTeams(auth)` — team list
- `getDeployBinding(workspace)` / `saveDeployBinding(workspace, binding)` — deploy.json CRUD

## Open Questions

None — all design decisions resolved in brainstorming.
