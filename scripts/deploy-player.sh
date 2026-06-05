#!/bin/bash
# Build the hosted player and deploy it alongside the landing page on the same
# Cloudflare Pages project, under /s/. The player fetches materialized play
# packages from R2 ($R2_PUBLIC_BASE/plays/<id>); share links resolve to
# $PLAYER_ORIGIN/s/<id> (set as playerBaseUrl in ~/.pneuma/r2.json).
set -e
cd "$(dirname "$0")/.."

R2_PUBLIC_BASE="${R2_PUBLIC_BASE:-https://pneuma-storage.vibecoding.icu}"
CF_PROJECT="${CF_PROJECT:-pneuma-landing}"
CF_BRANCH="${CF_BRANCH:-production}"

echo "[deploy] Building player (package base: $R2_PUBLIC_BASE)..."
VITE_PLAYER_PKG_BASE="$R2_PUBLIC_BASE" bunx vite build --config vite.player.config.ts

STAGE="$(mktemp -d)/site"
mkdir -p "$STAGE/s" "$STAGE/player-assets"

# Landing page (public files only — skip deploy config / readme).
cp web/index.html web/script.js web/styles.css "$STAGE/"
[ -d web/assets ] && cp -r web/assets "$STAGE/assets"

# Player SPA at /s/, assets + service worker at root (matches base "/").
cp dist-player/player.html "$STAGE/s/index.html"
cp -r dist-player/player-assets/. "$STAGE/player-assets/"
cp dist-player/player-content-sw.js "$STAGE/"
cp dist-player/favicon.png dist-player/favicon.ico dist-player/apple-touch-icon.png "$STAGE/" 2>/dev/null || true

# Routing. The landing project serves /index.html as a catch-all SPA fallback,
# so the player's /s/* rule MUST come first (first match wins in _redirects).
{
  printf '/s/* /s/index.html 200\n'
  printf '/* /index.html 200\n'
} > "$STAGE/_redirects"

# Cache control. The SPA HTML + service worker must always revalidate so users
# pick up new builds immediately (the HTML points at content-hashed assets);
# the hashed assets themselves are immutable.
{
  printf '/s/*\n  Cache-Control: no-cache\n'
  printf '/player-content-sw.js\n  Cache-Control: no-cache\n'
  printf '/player-assets/*\n  Cache-Control: public, max-age=31536000, immutable\n'
} > "$STAGE/_headers"

echo "[deploy] Deploying to Cloudflare Pages: $CF_PROJECT ($CF_BRANCH)..."
bunx wrangler pages deploy "$STAGE" --project-name="$CF_PROJECT" --branch="$CF_BRANCH"
echo "[deploy] Done. Player base: $PLAYER_ORIGIN (custom domain pneuma.deepaste.ai)."
