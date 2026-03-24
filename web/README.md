# Pneuma Landing Page

The landing page for Pneuma Skills, deployed to Cloudflare Pages.

## Setup

1. Copy `.deploy.env.example` to `.deploy.env`:
   ```bash
   cp .deploy.env.example .deploy.env
   ```

2. Update `.deploy.env` with your Cloudflare project details:
   - Set `CF_PROJECT_NAME` to your Cloudflare Pages project name
   - Optionally set `CF_BRANCH` (defaults to `production`)

3. Authenticate with Cloudflare:
   ```bash
   bunx wrangler login
   ```
   Or set the `CLOUDFLARE_API_TOKEN` environment variable.

## Deploy

1. Make the deploy script executable:
   ```bash
   chmod +x deploy.sh
   ```

2. Run the deployment:
   ```bash
   ./deploy.sh
   ```

## Local Preview

To preview the landing page locally:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## URL Parameters

The landing page supports the following URL parameters to control initial behavior:

- `?action=open` — Automatically trigger the "Open" action on page load
- `?action=open&mode=webcraft` — Open with a specific mode (e.g., `webcraft`, `doc`, `slide`, `draw`, `illustrate`, `remotion`, `mode-maker`, `evolve`)

Examples:
- `http://localhost:8080?action=open`
- `https://pneuma.example.com?action=open&mode=webcraft`
- `https://pneuma.example.com?action=open&mode=doc`
