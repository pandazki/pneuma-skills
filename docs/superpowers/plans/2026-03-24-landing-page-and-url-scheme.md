# Landing Page & URL Scheme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone landing page at `web/` and register `pneuma://` URL scheme in the Electron desktop client for deep linking.

**Architecture:** Pure static HTML/CSS/JS landing page (no framework) deployed to CF Pages. Electron app registers `pneuma://` protocol via electron-builder + `setAsDefaultProtocolClient`. URL parsing handles `pneuma://open` and `pneuma://open/{mode}`.

**Tech Stack:** HTML, CSS, vanilla JS, Electron protocol API, electron-builder protocols config

**Spec:** `docs/superpowers/specs/2026-03-24-landing-page-and-url-scheme-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `web/index.html` | Create | Landing page markup + inline critical styles |
| `web/styles.css` | Create | Full styles (design tokens, layout, animations) |
| `web/script.js` | Create | OS detection, download URL construction, query param handling |
| `web/assets/pneuma-logo.png` | Create | Copy from `public/logo.png` |
| `web/deploy.sh` | Create | CF Pages deploy script |
| `web/.deploy.env.example` | Create | Example deploy config |
| `web/README.md` | Create | Deployment instructions |
| `.gitignore` | Modify | Add `web/.deploy.env` |
| `desktop/electron-builder.yml` | Modify | Add `protocols` config |
| `desktop/src/main/index.ts` | Modify | Protocol registration + URL handling |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `web/index.html`
- Create: `web/styles.css`
- Create: `web/script.js`
- Create: `web/assets/pneuma-logo.png`
- Modify: `.gitignore`

- [ ] **Step 1: Create `web/` directory and copy + optimize logo asset**

The source `public/logo.png` is ~674KB which is too large for an 80px display element. Resize it down.

```bash
mkdir -p web/assets
# Resize to 160px (2x for retina) and compress
sips -Z 160 --out web/assets/pneuma-logo.png public/logo.png
```

If `sips` is unavailable, copy as-is and note it needs optimization later.

- [ ] **Step 2: Create minimal `web/index.html`**

Create the HTML skeleton with:
- Google Fonts (Fraunces + DM Sans)
- Meta tags (viewport, charset, OG tags, favicon)
- Link to `styles.css` and `script.js`
- Semantic structure: `<header>`, `<main>`, `<footer>`
- Hero section with logo, wordmark "Pneuma", tagline "Co-creation infrastructure for humans and code agents"
- Download button area with `id="download-section"` (populated by JS)
- "Open in Pneuma" button area with `id="open-app-section"` (shown conditionally by JS)
- GitHub link
- Footer with MIT License, version

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pneuma — Co-creation infrastructure for humans and code agents</title>
  <meta name="description" content="Visual environment, skills, continuous learning, and distribution for human-agent collaboration.">
  <meta property="og:title" content="Pneuma">
  <meta property="og:description" content="Co-creation infrastructure for humans and code agents">
  <meta property="og:type" content="website">
  <link rel="icon" href="assets/pneuma-logo.png" type="image/png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Fraunces:opsz,wght@9..144,400;9..144,600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <div class="hero">
      <img src="assets/pneuma-logo.png" alt="Pneuma" class="logo" />
      <h1 class="wordmark">Pneuma</h1>
      <p class="tagline">Co-creation infrastructure for humans and code agents</p>
      <p class="description">Visual environment, skills, continuous learning, and distribution — all in one workspace.</p>

      <div id="open-app-section" class="open-app-section" hidden>
        <!-- Populated by script.js when ?action= param present -->
      </div>

      <div id="download-section" class="download-section">
        <!-- Populated by script.js with OS-specific button -->
      </div>

      <div class="cli-install">
        <span class="cli-label">or install via CLI</span>
        <code class="cli-command">bunx pneuma-skills</code>
      </div>
    </div>
  </main>

  <footer>
    <div class="footer-links">
      <a href="https://github.com/pandazki/pneuma-skills" target="_blank" rel="noopener">GitHub</a>
      <span class="separator">·</span>
      <a href="https://github.com/pandazki/pneuma-skills/releases" target="_blank" rel="noopener">Releases</a>
      <span class="separator">·</span>
      <a href="https://www.npmjs.com/package/pneuma-skills" target="_blank" rel="noopener">npm</a>
    </div>
    <p class="copyright">MIT License</p>
  </footer>

  <script src="script.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create empty `web/styles.css` and `web/script.js`**

Create placeholder files so the HTML loads without errors:

`web/styles.css`:
```css
/* Pneuma Landing Page — populated in Task 2 */
```

`web/script.js`:
```js
// Pneuma Landing Page — populated in Task 3
```

- [ ] **Step 4: Add `web/.deploy.env` to `.gitignore`**

Append to the existing `.gitignore` (add a blank line separator to avoid concatenation):
```

# Landing page deploy config
web/.deploy.env
```

- [ ] **Step 5: Verify the page loads**

```bash
cd web && python3 -m http.server 8080
```

Open `http://localhost:8080` — should see unstyled HTML with text content. Kill the server.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/styles.css web/script.js web/assets/pneuma-logo.png .gitignore
git commit -m "feat(web): scaffold landing page structure"
```

---

### Task 2: Landing Page Styles

**Files:**
- Modify: `web/styles.css`

Use the `impeccable:frontend-design` skill for this task. The visual design should match the project's "Ethereal Tech" theme with extreme minimalism and generous breathing room.

**Design tokens reference:**
- Background: `#09090b` (zinc-950)
- Surface: `rgba(24, 24, 27, 0.4)` with `backdrop-blur`
- Text: `#fafafa` (zinc-50)
- Muted: `#a1a1aa` (zinc-400)
- Primary/accent: `#f97316` (neon orange)
- Primary hover: `#fdba74`
- Glow: `rgba(249, 115, 22, 0.15)`
- Border: `rgba(255, 255, 255, 0.08)`
- Logo font: `'Fraunces', Georgia, serif`
- Body font: `'DM Sans', system-ui, sans-serif`

**Layout requirements:**
- Centered, max-width ~640px
- Generous vertical spacing (hero centered vertically in viewport)
- No grid, no feature sections — breathe
- Subtle orange glow behind logo
- Glassmorphism download card if appropriate
- Smooth hover transitions on buttons
- Download button: orange fill (`#f97316`), white text, rounded
- GitHub link: muted, underline on hover
- CLI command: monospace, dark code block
- Footer: small, muted, bottom of page

- [ ] **Step 1: Write full styles in `web/styles.css`**

Include:
- CSS custom properties (`:root` block) with all design tokens
- Reset/base styles
- Typography (Fraunces for `.wordmark`, DM Sans for body)
- `.hero` — flex column, centered, full viewport height minus footer
- `.logo` — sized ~80px, with subtle orange glow `box-shadow`
- `.wordmark` — Fraunces, large, tight tracking
- `.tagline` — zinc-50, medium weight
- `.description` — zinc-400, smaller
- `.download-section` — margin top
- `.download-btn` — orange fill CTA button with hover lift
- `.download-btn-secondary` — ghost/outline variant for secondary platform
- `.open-app-section` — similar to download but with distinct styling
- `.open-app-btn` — outlined/distinct from download
- `.cli-install` — code block styling
- `.cli-command` — monospace, dark bg, `#fdba74` text
- `footer` — fixed bottom or pushed down, small muted text
- `.footer-links a` — muted, hover to orange
- Platform-specific download buttons (`.platform-mac`, `.platform-win`, `.platform-linux`)
- `[hidden]` — `display: none !important`
- Responsive: should look good on mobile too (already single column, just adjust spacing/font size)

- [ ] **Step 2: Verify styles render correctly**

```bash
cd web && python3 -m http.server 8080
```

Open `http://localhost:8080` — verify dark theme, typography, layout, breathing room.

- [ ] **Step 3: Commit**

```bash
git add web/styles.css
git commit -m "feat(web): add landing page styles with Ethereal Tech theme"
```

---

### Task 3: OS Detection & Download Logic

**Files:**
- Modify: `web/script.js`

- [ ] **Step 1: Write `web/script.js`**

Implement these functions:

```js
// 1. detectOS() — returns 'mac' | 'win' | 'linux' | 'unknown'
//    Use navigator.userAgent to detect platform
//    Also detect architecture where possible (arm64 vs x64 for macOS)

// 2. getDownloadUrl(os, arch) — returns GitHub Release download URL
//    Base: https://github.com/pandazki/pneuma-skills/releases/latest/download/
//    Asset patterns from electron-builder.yml:
//      macOS arm64: Pneuma-Skills-{version}-arm64-mac.dmg
//      macOS x64:   Pneuma-Skills-{version}-x64-mac.dmg
//      Windows:     Pneuma-Skills-{version}-x64-Setup.exe
//      Linux:       Pneuma-Skills-{version}-x64.AppImage
//    Since we don't know version at static page time, use the /releases/latest page as fallback
//    Primary strategy: link to /releases/latest (GitHub redirects to latest tag page)

// 3. renderDownloadSection() — populates #download-section
//    macOS: primary "Download for macOS" button → releases/latest
//           secondary "Intel Mac" link if arm64 detected → same page
//    Windows: "Download for Windows" button
//    Linux: "Download for Linux" button
//    Unknown: "View All Downloads" → releases page
//    All buttons also have "All platforms →" link below

// 4. handleOpenAppParam() — check for ?action=open&mode=xxx
//    If present, show #open-app-section with "Open in Pneuma" button
//    Button href = pneuma://open or pneuma://open/{mode}
//    Text: "Open in Pneuma" or "Open {mode} in Pneuma"

// 5. init() — called on DOMContentLoaded
//    renderDownloadSection()
//    handleOpenAppParam()
```

Implementation:

```js
(function () {
  'use strict';

  const GITHUB_RELEASES = 'https://github.com/pandazki/pneuma-skills/releases/latest';

  function detectOS() {
    const ua = navigator.userAgent.toLowerCase();
    const platform = navigator.platform?.toLowerCase() || '';

    if (ua.includes('mac') || platform.includes('mac')) {
      // Detect Apple Silicon vs Intel
      // navigator.userAgent on ARM Macs still shows "Intel" in many browsers
      // Use navigator.userAgentData if available
      const arch = navigator.userAgentData?.architecture === 'arm' ? 'arm64' : 'x64';
      return { os: 'mac', arch };
    }
    if (ua.includes('win') || platform.includes('win')) {
      return { os: 'win', arch: 'x64' };
    }
    if (ua.includes('linux')) {
      return { os: 'linux', arch: 'x64' };
    }
    return { os: 'unknown', arch: 'x64' };
  }

  function renderDownloadSection() {
    const section = document.getElementById('download-section');
    if (!section) return;

    const { os } = detectOS();

    const labels = {
      mac: 'Download for macOS',
      win: 'Download for Windows',
      linux: 'Download for Linux',
      unknown: 'View All Downloads',
    };

    const label = labels[os] || labels.unknown;

    section.innerHTML = `
      <a href="${GITHUB_RELEASES}" class="download-btn" target="_blank" rel="noopener">
        ${label}
      </a>
      ${os !== 'unknown' ? `<a href="${GITHUB_RELEASES}" class="all-platforms" target="_blank" rel="noopener">All platforms</a>` : ''}
    `;
  }

  function handleOpenAppParam() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action !== 'open') return;

    const mode = params.get('mode') || '';
    const section = document.getElementById('open-app-section');
    if (!section) return;

    const schemeUrl = mode ? `pneuma://open/${mode}` : 'pneuma://open';
    const label = mode ? `Open ${mode} in Pneuma` : 'Open in Pneuma';

    section.removeAttribute('hidden');
    section.innerHTML = `
      <a href="${schemeUrl}" class="open-app-btn">${label}</a>
      <p class="open-app-hint">If Pneuma is installed, it will open automatically.</p>
    `;
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderDownloadSection();
    handleOpenAppParam();
  });
})();
```

- [ ] **Step 2: Test OS detection manually**

```bash
cd web && python3 -m http.server 8080
```

Open `http://localhost:8080` — verify:
- macOS shows "Download for macOS"
- "All platforms" link is visible
- Test with `?action=open` — "Open in Pneuma" button appears
- Test with `?action=open&mode=webcraft` — "Open webcraft in Pneuma" button appears

- [ ] **Step 3: Commit**

```bash
git add web/script.js
git commit -m "feat(web): add OS detection and download logic"
```

---

### Task 4: Deploy Infrastructure (parallelizable with Task 5)

**Files:**
- Create: `web/deploy.sh`
- Create: `web/.deploy.env.example`
- Create: `web/README.md`

- [ ] **Step 1: Create `web/deploy.sh`**

```bash
#!/bin/bash
# Deploy Pneuma landing page to Cloudflare Pages
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .deploy.env ]; then
  set -a
  source .deploy.env
  set +a
else
  echo "Error: .deploy.env not found. Copy .deploy.env.example and configure."
  exit 1
fi

if [ -z "$CF_PROJECT_NAME" ]; then
  echo "Error: CF_PROJECT_NAME not set in .deploy.env"
  exit 1
fi

echo "Deploying to Cloudflare Pages project: $CF_PROJECT_NAME"
bunx wrangler pages deploy . \
  --project-name="$CF_PROJECT_NAME" \
  --branch="${CF_BRANCH:-production}"
```

- [ ] **Step 2: Create `web/.deploy.env.example`**

```bash
# Cloudflare Pages deployment config
# Copy this to .deploy.env and fill in your values
CF_PROJECT_NAME=pneuma-landing
CF_BRANCH=production
# Authentication: run `bunx wrangler login` or set CLOUDFLARE_API_TOKEN
```

- [ ] **Step 3: Create `web/README.md`**

```markdown
# Pneuma Landing Page

Static landing page for Pneuma Skills. Deployed to Cloudflare Pages.

## Setup

1. Copy `.deploy.env.example` to `.deploy.env`
2. Set `CF_PROJECT_NAME` to your Cloudflare Pages project name
3. Authenticate: `bunx wrangler login`

## Deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

## Local Preview

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

## URL Parameters

- `?action=open` — Shows "Open in Pneuma" button (triggers `pneuma://open`)
- `?action=open&mode=webcraft` — Shows "Open webcraft in Pneuma" button (triggers `pneuma://open/webcraft`)
```

- [ ] **Step 4: Make deploy script executable**

```bash
chmod +x web/deploy.sh
```

- [ ] **Step 5: Commit**

```bash
git add web/deploy.sh web/.deploy.env.example web/README.md
git commit -m "feat(web): add CF Pages deploy script and docs"
```

---

### Task 5: Electron Protocol Registration (parallelizable with Task 4)

**Files:**
- Modify: `desktop/electron-builder.yml` (add `protocols` block)
- Modify: `desktop/src/main/index.ts` (protocol registration + URL handling)

- [ ] **Step 1: Add `protocols` to `desktop/electron-builder.yml`**

Add at the top level (after `copyright` line, before `directories`):

```yaml
protocols:
  - name: Pneuma
    schemes:
      - pneuma
```

- [ ] **Step 2: Add protocol registration to `desktop/src/main/index.ts`**

After the single-instance lock block (line 27, after `app.quit();` + `}`), add:

```typescript
// ── Custom protocol handler (pneuma://) ──────────────────────────────────────
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('pneuma', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('pneuma');
}
```

- [ ] **Step 3: Add `handlePneumaUrl` function**

Add before the `showLauncher` function:

```typescript
// ── URL scheme handler ────────────────────────────────────────────────────────
let pendingPneumaUrl: string | null = null;

function handlePneumaUrl(url: string) {
  try {
    const parsed = new URL(url);
    switch (parsed.hostname) {
      case 'open': {
        const mode = parsed.pathname.replace(/^\//, '') || undefined;
        // For now, just open/focus launcher — mode pre-selection is future work
        showLauncher();
        break;
      }
      default:
        showLauncher();
    }
  } catch {
    showLauncher();
  }
}
```

- [ ] **Step 4: Add macOS `open-url` handler (before `app.whenReady()`)**

Add right after the `handlePneumaUrl` function:

```typescript
// macOS: open-url fires before app.whenReady() on cold launch
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handlePneumaUrl(url);
  } else {
    pendingPneumaUrl = url;
  }
});
```

- [ ] **Step 5: Process pending URL after app ready**

Inside `app.whenReady().then(async () => { ... })`, add AFTER the launcher/setup window is shown (after the `showSetupWizard()` / `showLauncher()` block, around line 249 — after `splash.destroy()`). This must run after the normal startup flow completes, not early in the ready handler, to avoid racing with launcher creation.

```typescript
  // Process any URL that arrived before app was ready (macOS cold launch)
  if (pendingPneumaUrl) {
    handlePneumaUrl(pendingPneumaUrl);
    pendingPneumaUrl = null;
  }
```

- [ ] **Step 6: Extend existing `second-instance` handler**

Replace the existing handler at line 32. Note: the callback signature changes from `() =>` to `(_event, argv) =>` to receive the command-line arguments:

```typescript
app.on("second-instance", (_event, argv) => {
  // Check for pneuma:// URL in args (Windows/Linux deep link)
  const url = argv.find(arg => arg.startsWith('pneuma://'));
  if (url) {
    handlePneumaUrl(url);
    return;
  }

  // Default: focus launcher
  const launcher = getLauncherWindow();
  if (launcher) {
    if (launcher.isMinimized()) launcher.restore();
    launcher.focus();
  } else {
    showLauncher();
  }
});
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd desktop && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron-builder.yml desktop/src/main/index.ts
git commit -m "feat(desktop): register pneuma:// URL scheme for deep linking"
```

---

### Task 6: Visual Polish with impeccable

Use the `impeccable:frontend-design` skill to review and enhance the landing page visuals. This is the design quality pass — the HTML structure and JS logic are already in place from Tasks 1-3.

**Files:**
- Modify: `web/index.html` (if structural changes needed for design)
- Modify: `web/styles.css` (primary target)

- [ ] **Step 1: Invoke `impeccable:frontend-design` skill**

Use the skill to review the current landing page and enhance:
- Overall visual impression and "Ethereal Tech" feel
- Subtle animations (logo glow breathe, button hover)
- Typography scale and spacing
- Mobile responsiveness
- Any micro-interactions that elevate the page

- [ ] **Step 2: Verify final result**

```bash
cd web && python3 -m http.server 8080
```

Check on desktop and mobile viewport sizes.

- [ ] **Step 3: Commit**

```bash
git add web/
git commit -m "feat(web): polish landing page design"
```
