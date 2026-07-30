#!/usr/bin/env bash
#
# Neutral leaf router. The orchestrator invokes a role, never a family name:
#   run_leaf.sh <writer|checker> <promptfile>
#   run_leaf.sh repair <promptfile> <passage-scope>
#
# The private probe chooses between the two shipped family wrappers. Successful
# runs emit only the leaf's final answer on stdout; the caller must redirect it
# straight to a canonical or private staging file.

set -euo pipefail

MAX_REPAIR_CYCLES=2

if [[ $# -lt 2 || -z "${1:-}" || -z "${2:-}" ]]; then
  echo "wordtaste: leaf — usage: run_leaf.sh <writer|checker|repair> <promptfile> [passage-scope]" >&2
  exit 2
fi

role="$1"
promptfile="$2"
scope="${3:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
session_root="${PNEUMA_SESSION_DIR:-.}"
probe_file="${WORDTASTE_PROBE_FILE:-${session_root}/.pneuma/cross-family.json}"
private_dir="${WORDTASTE_PRIVATE_DIR:-${session_root}/.pneuma/leaf-logs}"
budget_dir="${WORDTASTE_REPAIR_BUDGET_DIR:-${session_root}/.pneuma/repair-budget}"

available() {
  local family="$1"
  [[ -f "${probe_file}" ]] &&
    grep -Eq "\"${family}\"[[:space:]]*:[[:space:]]*true" "${probe_file}"
}

runner=""
case "${role}" in
  writer)
    if available codex; then
      runner="${script_dir}/leaf_primary.sh"
    elif available claude; then
      runner="${script_dir}/leaf_crosscheck.sh"
    fi
    ;;
  checker|repair)
    if available claude; then
      runner="${script_dir}/leaf_crosscheck.sh"
    elif available codex; then
      runner="${script_dir}/leaf_primary.sh"
    fi
    ;;
  *)
    echo "wordtaste: leaf — role must be writer, checker, or repair" >&2
    exit 2
    ;;
esac

if [[ -z "${runner}" ]]; then
  echo "wordtaste: leaf — no usable isolated process is available" >&2
  exit 3
fi

reserve_repair_cycle() {
  if [[ -z "${scope}" || ! "${scope}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
    echo "wordtaste: leaf — repair requires a stable passage scope" >&2
    return 2
  fi

  mkdir -p "${budget_dir}"
  local count_file="${budget_dir}/${scope}.count"
  local lock_dir="${budget_dir}/${scope}.lock"
  local count=0
  local wait_count=0

  while ! mkdir "${lock_dir}" 2>/dev/null; do
    wait_count=$((wait_count + 1))
    if (( wait_count >= 40 )); then
      echo "wordtaste: leaf — repair budget is temporarily busy" >&2
      return 4
    fi
    sleep 0.05
  done

  if [[ -f "${count_file}" ]]; then
    IFS= read -r count < "${count_file}" || count=0
  fi
  if [[ ! "${count}" =~ ^[0-9]+$ ]]; then
    rmdir "${lock_dir}"
    echo "wordtaste: leaf — repair budget state is invalid" >&2
    return 4
  fi
  if (( count >= MAX_REPAIR_CYCLES )); then
    rmdir "${lock_dir}"
    echo "wordtaste: leaf — repair budget exhausted for this passage" >&2
    return 5
  fi

  count=$((count + 1))
  local next_file="${count_file}.tmp.$$"
  printf '%s\n' "${count}" > "${next_file}"
  mv "${next_file}" "${count_file}"
  rmdir "${lock_dir}"
}

if [[ "${role}" == "repair" ]]; then
  reserve_repair_cycle
fi

mkdir -p "${private_dir}"
export WORDTASTE_PRIVATE_LOG="${private_dir}/${role}-$$.log"
exec "${runner}" "${promptfile}"
