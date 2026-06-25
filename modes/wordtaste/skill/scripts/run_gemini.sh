#!/usr/bin/env bash
#
# run_gemini.sh — generate or (primarily) JUDGE one candidate in the Gemini
# family by shelling out to the gemini CLI non-interactively. Gemini's main
# role in wordtaste is the neutral third-party judge: with provenance stripped it
# checks kernel survival, flags residual AI symptoms, and maps the diff between
# candidates — to focus the user's attention, never to choose for them. It is
# a third RLHF basin, so it can also act as a cross-family generator.
#
# Usage:
#   run_gemini.sh <promptfile>
#
#   <promptfile> — path to a file holding the full prompt. The agent writes it,
#                  then calls the script.
#
# Output:
#   Gemini's text response on stdout (and nothing else). Log noise → stderr.
#
# Exit codes:
#   0  — success, response on stdout
#   2  — usage error (missing/empty promptfile)
#   3  — gemini CLI not installed (degrade)
#   >3 — gemini itself failed; its exit code is propagated

set -euo pipefail

# --- validate input ---------------------------------------------------------
if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "wordtaste: run_gemini — usage: run_gemini.sh <promptfile>" >&2
  exit 2
fi
promptfile="$1"
if [[ ! -f "${promptfile}" ]]; then
  echo "wordtaste: run_gemini — prompt file not found: ${promptfile}" >&2
  exit 2
fi
if [[ ! -s "${promptfile}" ]]; then
  echo "wordtaste: run_gemini — prompt file is empty: ${promptfile}" >&2
  exit 2
fi

# --- precondition: CLI present ----------------------------------------------
if ! command -v gemini >/dev/null 2>&1; then
  echo "wordtaste: run_gemini — gemini CLI not installed; degrade (no third-party judge)" >&2
  exit 3
fi

# --- run --------------------------------------------------------------------
# Non-interactive: the prompt is piped on stdin (gemini appends piped stdin to
# any prompt). `-o text` forces plain-text output (not the JSON envelope) so
# the orchestrator reads clean prose. `-y` auto-accepts so a judge/generate
# pass never blocks waiting for tool approval. An optional GEMINI_MODEL env var
# pins the model when set.
echo "wordtaste: run_gemini — generating from ${promptfile} …" >&2

model_args=()
if [[ -n "${GEMINI_MODEL:-}" ]]; then
  model_args=(--model "${GEMINI_MODEL}")
fi

set +e
# "${model_args[@]+...}" expands safely when the array is empty under `set -u`
# (macOS ships bash 3.2, where a bare "${arr[@]}" on an empty array is "unbound").
output="$(gemini ${model_args[@]+"${model_args[@]}"} --output-format text --yolo < "${promptfile}" 2>/dev/null)"
status=$?
set -e

if [[ ${status} -ne 0 ]]; then
  echo "wordtaste: run_gemini — gemini failed (exit ${status})" >&2
  exit "${status}"
fi

if [[ -z "${output//[$' \t\n\r']/}" ]]; then
  echo "wordtaste: run_gemini — gemini returned an empty response" >&2
  exit 4
fi

printf '%s\n' "${output}"
exit 0
