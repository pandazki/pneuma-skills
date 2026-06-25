#!/usr/bin/env bash
#
# run_codex.sh — generate (or judge) one candidate in the GPT family by shelling
# out to the codex CLI as a fresh, naturally-isolated process. This is one of
# wordtaste's cross-family levers: a different RLHF basin than Claude, so it can
# route around Claude's habitual cadence and metaphors.
#
# Usage:
#   run_codex.sh <promptfile>
#
#   <promptfile> — path to a file holding the full prompt (kernel + voice
#                  anchors + recipe + swaps + rung mandate + source material).
#                  The agent writes this file, then calls the script.
#
# Output:
#   The model's FINAL answer, printed to stdout (and nothing else) so the
#   orchestrator can read it back cleanly. Progress/log noise goes to stderr.
#
# Exit codes:
#   0  — success, final answer on stdout
#   2  — usage error (missing/empty promptfile)
#   3  — codex CLI not installed (single-family / degrade)
#   >3 — codex itself failed; its exit code is propagated

set -euo pipefail

# --- validate input ---------------------------------------------------------
if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "wordtaste: run_codex — usage: run_codex.sh <promptfile>" >&2
  exit 2
fi
promptfile="$1"
if [[ ! -f "${promptfile}" ]]; then
  echo "wordtaste: run_codex — prompt file not found: ${promptfile}" >&2
  exit 2
fi
if [[ ! -s "${promptfile}" ]]; then
  echo "wordtaste: run_codex — prompt file is empty: ${promptfile}" >&2
  exit 2
fi

# --- precondition: CLI present ----------------------------------------------
if ! command -v codex >/dev/null 2>&1; then
  echo "wordtaste: run_codex — codex CLI not installed; degrade to single-family" >&2
  exit 3
fi

# --- run --------------------------------------------------------------------
# `--skip-git-repo-check` lets codex run outside a git repo (the session dir).
# Reading the prompt from stdin via `-` keeps a large prompt off argv. We
# capture ONLY the final assistant message via `--output-last-message` so the
# orchestrator gets clean prose, not the full run transcript.
last_message_file="$(mktemp -t wordtaste-codex-XXXXXX)"
cleanup() { rm -f "${last_message_file}"; }
trap cleanup EXIT

echo "wordtaste: run_codex — generating from ${promptfile} …" >&2

set +e
codex exec --skip-git-repo-check --color never \
  --output-last-message "${last_message_file}" - \
  < "${promptfile}" \
  >&2
status=$?
set -e

if [[ ${status} -ne 0 ]]; then
  echo "wordtaste: run_codex — codex exec failed (exit ${status})" >&2
  exit "${status}"
fi

if [[ ! -s "${last_message_file}" ]]; then
  echo "wordtaste: run_codex — codex returned no final message" >&2
  exit 4
fi

cat "${last_message_file}"
exit 0
