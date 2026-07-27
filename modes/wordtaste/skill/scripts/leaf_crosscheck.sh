#!/usr/bin/env bash
#
# Private cross-check leaf adapter. The neutral router is its only caller.
# A fresh, non-persistent process with disabled tools and a clean working
# directory keeps the leaf context limited to the prompt.
#
# Usage:
#   leaf_crosscheck.sh <promptfile>
#
# Output:
#   Claude's final text on stdout. The CLI transcript stays in
#   WORDTASTE_PRIVATE_LOG; only a one-line failure reaches stderr.
#
# Exit codes:
#   0  — success
#   2  — usage error
#   3  — Claude Code is unavailable
#   >3 — Claude Code failed

set -euo pipefail

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

if ! command -v claude >/dev/null 2>&1; then
  echo "wordtaste: leaf adapter unavailable" >&2
  exit 3
fi

clean_work_dir="$(mktemp -d -t wordtaste-claude-cwd-XXXXXX)"
output_file="$(mktemp -t wordtaste-claude-XXXXXX)"
diagnostic_ephemeral="false"
if [[ -n "${WORDTASTE_PRIVATE_LOG:-}" ]]; then
  diagnostic_file="${WORDTASTE_PRIVATE_LOG}"
  mkdir -p "$(dirname "${diagnostic_file}")"
else
  diagnostic_file="$(mktemp -t wordtaste-claude-log-XXXXXX)"
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
  rm -f "${output_file}"
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
  exec claude -p \
    --output-format text \
    --no-session-persistence \
    --safe-mode \
    --tools "" \
    < "${promptfile}" \
    > "${output_file}" \
    2> "${diagnostic_file}"
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
if [[ ! -s "${output_file}" ]]; then
  echo "wordtaste: leaf adapter returned no final text" >&2
  exit 4
fi

rm -f "${diagnostic_file}"
cat "${output_file}"
