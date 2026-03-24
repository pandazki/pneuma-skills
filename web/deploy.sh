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
