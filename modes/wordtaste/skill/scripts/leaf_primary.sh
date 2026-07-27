#!/usr/bin/env bash
#
# Private primary leaf adapter. The neutral router is its only caller.
#
# Usage:
#   leaf_primary.sh <promptfile>
#
#   <promptfile> — path to a file holding the full prompt (kernel + voice
#                  anchors + recipe + source material).
#                  The agent writes this file, then calls the script.
#
# Output:
#   The model's FINAL answer, printed to stdout (and nothing else) so the
#   caller can redirect it straight to private staging. The CLI transcript is
#   kept in WORDTASTE_PRIVATE_LOG and never enters the visible terminal stream.
#
# Exit codes:
#   0  — success, final answer on stdout
#   2  — usage error (missing/empty promptfile)
#   3  — codex CLI not installed (single-family / degrade)
#   >3 — codex itself failed; its exit code is propagated

set -euo pipefail

# --- validate input ---------------------------------------------------------
if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "wordtaste: leaf adapter — usage: <promptfile>" >&2
  exit 2
fi
promptfile="$1"
if [[ ! -f "${promptfile}" ]]; then
  echo "wordtaste: leaf adapter — prompt file not found: ${promptfile}" >&2
  exit 2
fi
if [[ ! -s "${promptfile}" ]]; then
  echo "wordtaste: leaf adapter — prompt file is empty: ${promptfile}" >&2
  exit 2
fi
promptfile="$(cd "$(dirname "${promptfile}")" && pwd)/$(basename "${promptfile}")"

# --- precondition: CLI present ----------------------------------------------
if ! command -v codex >/dev/null 2>&1; then
  echo "wordtaste: leaf adapter unavailable" >&2
  exit 3
fi

# --- run --------------------------------------------------------------------
# `--skip-git-repo-check` lets codex run outside a git repo (the session dir).
# Reading the prompt from stdin via `-` keeps a large prompt off argv. We
# capture ONLY the final assistant message via `--output-last-message` so the
# orchestrator gets clean prose, not the full run transcript.
last_message_file="$(mktemp -t wordtaste-codex-XXXXXX)"
clean_work_dir="$(mktemp -d -t wordtaste-codex-cwd-XXXXXX)"
diagnostic_ephemeral="false"
if [[ -n "${WORDTASTE_PRIVATE_LOG:-}" ]]; then
  diagnostic_file="${WORDTASTE_PRIVATE_LOG}"
  mkdir -p "$(dirname "${diagnostic_file}")"
else
  diagnostic_file="$(mktemp -t wordtaste-codex-log-XXXXXX)"
  diagnostic_ephemeral="true"
fi
leaf_pid=""

terminate_leaf() {
  local signal="${1:-TERM}"
  if [[ -n "${leaf_pid}" ]] && kill -0 "${leaf_pid}" 2>/dev/null; then
    kill "-${signal}" "${leaf_pid}" 2>/dev/null || true
    (
      sleep 1
      kill -KILL "${leaf_pid}" 2>/dev/null || true
    ) &
    local watchdog_pid=$!
    wait "${leaf_pid}" 2>/dev/null || true
    kill "${watchdog_pid}" 2>/dev/null || true
    wait "${watchdog_pid}" 2>/dev/null || true
  fi
  leaf_pid=""
}

cleanup() {
  terminate_leaf TERM
  rm -f "${last_message_file}"
  if [[ "${diagnostic_ephemeral}" == "true" ]]; then
    rm -f "${diagnostic_file}"
  fi
  rm -rf "${clean_work_dir}"
}
trap cleanup EXIT
trap 'terminate_leaf TERM' TERM
trap 'terminate_leaf INT' INT
trap 'terminate_leaf HUP' HUP

set +e
(
  cd "${clean_work_dir}"
  exec codex exec --skip-git-repo-check --color never \
    --output-last-message "${last_message_file}" - \
    < "${promptfile}" \
    > "${diagnostic_file}" 2>&1
) &
leaf_pid=$!
wait "${leaf_pid}"
status=$?
leaf_pid=""
set -e

if [[ ${status} -ne 0 ]]; then
  echo "wordtaste: leaf adapter failed (exit ${status})" >&2
  exit "${status}"
fi

if [[ ! -s "${last_message_file}" ]]; then
  echo "wordtaste: leaf adapter returned no final message" >&2
  exit 4
fi

rm -f "${diagnostic_file}"
cat "${last_message_file}"
exit 0
