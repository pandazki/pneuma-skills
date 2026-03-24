# Landing Page & URL Scheme Design

## Goal

Create a standalone landing page for Pneuma Skills that:
1. Serves as the fallback when a user clicks a `pneuma://` deep link without the desktop client installed
2. Introduces the project and guides users to download the desktop client
3. Registers a custom `pneuma://` URL scheme in the Electron app for deep linking

## Architecture

### Project Structure

```
web/                           # Top-level standalone web project (static site)
├── index.html                 # Single-page landing (no framework)
├── styles.css                 # Styles (reuses project design tokens)
├── script.js                  # OS detection, URL scheme attempt, download logic
├── assets/                    # Logo, favicon, OG image
│   └── pneuma-logo.svg       # Extracted/adapted from existing app
├── deploy.sh                  # CF Pages publish script
├── .deploy.env.example        # Example deploy config (committed)
├── .deploy.env                # Actual deploy config (gitignored)
└── README.md                  # Deployment instructions
```

**Gitignore additions:**
```
web/.deploy.env
```

### Why Pure Static

- Single page, no routing, no state — a framework adds nothing
- Fastest possible load (no JS bundle required for content)
- Easy to deploy anywhere (CF Pages, Netlify, S3, etc.)
- JS is only for progressive enhancement (OS detection, scheme attempt)

## Landing Page Design

### Content (single page, top to bottom)

1. **Hero Section**
   - Pneuma flame logo (SVG)
   - Wordmark: "Pneuma"
   - Tagline: "Co-creation infrastructure for humans and code agents"
   - One-liner description: visual environment + skills + continuous learning
   - Primary CTA: OS-specific download button (auto-detected)
   - Secondary CTA: "View on GitHub" link

2. **Footer**
   - GitHub link, MIT License, version number
   - Links: GitHub Releases, npm package

### Visual Design

- **Dark only** — matches the app's primary theme
- **Background:** `#09090b` (zinc-950)
- **Text:** `#fafafa` (zinc-50), muted `#a1a1aa` (zinc-400)
- **Accent:** `#f97316` (neon orange) for CTAs and highlights
- **Glow:** `rgba(249, 115, 22, 0.15)` subtle orange glow on hero
- **Typography:**
  - Logo: Fraunces (serif)
  - Body: DM Sans (sans-serif)
  - Loaded from Google Fonts
- **Surfaces:** Glassmorphism cards with `backdrop-blur` and `rgba(24, 24, 27, 0.4)` background
- **Borders:** `rgba(255, 255, 255, 0.08)` ultra-subtle
- **Layout:** Centered, max-width ~640px, generous vertical spacing
- **Minimal:** lots of breathing room, no grid of features, no scrolling sections

### OS Detection & Download

```
navigator.userAgent → detect OS
  ├─ macOS  → GitHub Release .dmg link (arm64 primary, Intel secondary)
  ├─ Windows → GitHub Release .exe link
  ├─ Linux  → GitHub Release .AppImage link
  └─ Other  → Show all platform links
```

Download URLs use the GitHub Releases API to find the correct asset:
- Parse `https://api.github.com/repos/pandazki/pneuma-skills/releases/latest` at build time or use static links
- Asset naming pattern from electron-builder: `Pneuma-Skills-{version}-{arch}-mac.dmg`, `Pneuma-Skills-{version}-{arch}-Setup.exe`, `Pneuma-Skills-{version}-{arch}.AppImage`
- Fallback: link to `https://github.com/pandazki/pneuma-skills/releases/latest` (GitHub shows all assets)

Also show a CLI install alternative: `bunx pneuma-skills`

## URL Scheme

### Scheme Definition

Protocol: `pneuma://`

### Supported Routes (v1)

| Route | Action | Example |
|-------|--------|---------|
| `pneuma://open` | Open/focus the app (launcher) | Click to open Pneuma |
| `pneuma://open/{mode}` | Open launcher, pre-select mode | `pneuma://open/webcraft` |

Future extensions (not in v1): `pneuma://replay/{id}`, `pneuma://import/{url}`

### Browser → Client Handoff Flow

```
User clicks link containing pneuma:// URL
  │
  ├─ Client installed → OS launches Electron app
  │   └─ App receives URL via open-url event (macOS) or second-instance (Windows/Linux)
  │   └─ Parse route → execute action
  │
  └─ Client not installed → Browser shows "unsupported protocol" or does nothing
      └─ Landing page handles this case (see below)
```

### Landing Page Deep Link UX

The landing page does NOT attempt automatic scheme detection (iframe/timeout approach is unreliable in modern browsers). Instead:

- Landing page always shows its full content (intro + download)
- An "Open in Pneuma" button is displayed if a `?action=open&mode=webcraft` query param is present
- Clicking the button navigates to `pneuma://open/webcraft` — if the client is installed, the OS handles it; if not, the browser shows a protocol error which is acceptable
- The download CTA is always visible alongside the open button

This is simpler, more reliable, and avoids false negatives from browser security policies.

## Electron Changes

### 1. electron-builder.yml

```yaml
protocols:
  - name: Pneuma
    schemes:
      - pneuma
```

### 2. main/index.ts — Protocol Registration

```typescript
// Register protocol handler — MUST be called before app.whenReady()
// In dev mode (process.defaultApp=true), pass execPath for Electron to find the app
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('pneuma', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('pneuma');
}
```

### 3. main/index.ts — URL Handling

**macOS** — `open-url` event (register BEFORE `app.whenReady()` to catch cold-launch URLs):
```typescript
// Queue URL if app isn't ready yet
let pendingUrl: string | null = null;

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handlePneumaUrl(url);
  } else {
    pendingUrl = url;
  }
});

// After app.whenReady(), process any queued URL:
if (pendingUrl) {
  handlePneumaUrl(pendingUrl);
  pendingUrl = null;
}
```

**Windows/Linux** — Merge into the EXISTING `second-instance` handler at `index.ts:32` (do not add a separate listener):
```typescript
// Extend the existing handler — do NOT create a new app.on('second-instance', ...)
app.on('second-instance', (_event, argv, _workingDirectory) => {
  const url = argv.find(arg => arg.startsWith('pneuma://'));
  if (url) {
    handlePneumaUrl(url);
  }
  // ...existing window focus logic stays here...
});
```

**Note:** Linux (AppImage) protocol registration is not handled automatically by electron-builder. Linux deep linking requires a `.desktop` file with `MimeType=x-scheme-handler/pneuma;`. This is out of scope for v1 — Linux users use direct download or CLI.

### 4. URL Parser

```typescript
function handlePneumaUrl(url: string) {
  const parsed = new URL(url);
  // parsed.hostname = 'open', parsed.pathname = '/webcraft'

  switch (parsed.hostname) {
    case 'open':
      const mode = parsed.pathname.replace(/^\//, '') || undefined;
      // Focus or create launcher window
      // If mode specified, could pre-select it
      focusOrCreateLauncher(mode);
      break;
    default:
      // Unknown route — just open launcher
      focusOrCreateLauncher();
  }
}
```

## Deploy Script

```bash
#!/bin/bash
# web/deploy.sh — Deploy landing page to Cloudflare Pages

set -e

# Load config
if [ -f .deploy.env ]; then
  source .deploy.env
else
  echo "Error: .deploy.env not found. Copy .deploy.env.example and configure."
  exit 1
fi

# Deploy
npx wrangler pages deploy . \
  --project-name="${CF_PROJECT_NAME}" \
  --branch="${CF_BRANCH:-production}"
```

`.deploy.env.example`:
```bash
CF_PROJECT_NAME=pneuma-landing
CF_BRANCH=production
# CF credentials via wrangler login or CLOUDFLARE_API_TOKEN env var
```

## Testing Plan

- [ ] Landing page renders correctly in Chrome, Firefox, Safari
- [ ] OS detection shows correct download button
- [ ] Download links resolve to valid GitHub Release assets
- [ ] `pneuma://open` launches Electron app on macOS
- [ ] `pneuma://open` launches Electron app on Windows
- [ ] Cold launch on macOS correctly processes queued `open-url`
- [ ] `pneuma://open/webcraft` parsed correctly in handlePneumaUrl
- [ ] Landing page gracefully handles missing client (no error, shows download)
- [ ] Deploy script works with CF Pages
- [ ] `.deploy.env` is gitignored

## Scope Boundaries

**In scope:**
- Static landing page with OS-aware download
- `pneuma://` URL scheme registration in Electron
- Basic `open` and `open/{mode}` routes
- CF Pages deploy script with gitignored config

**Out of scope:**
- Landing page framework/SSR
- Light theme for landing page
- Analytics/tracking
- Mode-specific deep links beyond open
- Replay/import deep links
- i18n
- Linux `.desktop` file for protocol handler registration
