#!/usr/bin/env bash
#
# Private check → repair → recheck loop.
#
# Usage:
#   run_check_cycle.sh <candidate-file> <check-brief-file> <scope> <result-file>
#
# The caller creates only the candidate and a stable check brief. This script
# appends candidate/report contents to private prompts internally, so neither
# raw prompts nor judge output enters a visible terminal command. It emits
# nothing on success and writes only a sanitized outcome to <result-file>.

set -euo pipefail

MAX_REPAIR_CYCLES=2

if [[ $# -ne 4 ]]; then
  echo "wordtaste: check cycle — usage: <candidate> <brief> <scope> <result>" >&2
  exit 2
fi

candidate_file="$1"
brief_file="$2"
scope="$3"
result_file="$4"

if [[ ! "${scope}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "wordtaste: check cycle — invalid stable scope" >&2
  exit 2
fi
for required_file in "${candidate_file}" "${brief_file}"; do
  if [[ ! -s "${required_file}" ]]; then
    echo "wordtaste: check cycle — required private input is missing" >&2
    exit 2
  fi
done

absolute_path() {
  local path="$1"
  printf '%s/%s\n' "$(cd -P "$(dirname "${path}")" && pwd -P)" "$(basename "${path}")"
}

candidate_file="$(absolute_path "${candidate_file}")"
brief_file="$(absolute_path "${brief_file}")"
mkdir -p "$(dirname "${result_file}")"
result_dir="$(cd -P "$(dirname "${result_file}")" && pwd -P)"
result_file="${result_dir}/$(basename "${result_file}")"
script_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
session_root="$(cd -P "${PNEUMA_SESSION_DIR:-.}" && pwd -P)"
private_dir="${WORDTASTE_PRIVATE_DIR:-${session_root}/.pneuma/private}"
mkdir -p "${private_dir}" "${result_dir}"
private_dir="$(cd -P "${private_dir}" && pwd -P)"

is_private_path() {
  local path="$1"
  [[ "${path}" == "${private_dir}/"* ]]
}

if ! is_private_path "${candidate_file}" ||
  ! is_private_path "${brief_file}" ||
  ! is_private_path "${result_file}"; then
  echo "wordtaste: check cycle — candidate, brief, and result must stay private" >&2
  exit 2
fi

original_file="${private_dir}/${scope}.original.md"
cp "${candidate_file}" "${original_file}"

write_result() {
  local outcome="$1"
  local repairs="$2"
  local next_file="${result_file}.tmp.$$"
  jq -n \
    --arg outcome "${outcome}" \
    --arg scope "${scope}" \
    --arg original "${original_file}" \
    --arg candidate "${candidate_file}" \
    --argjson repairs "${repairs}" \
    '{outcome:$outcome, scope:$scope, repairs:$repairs, original:$original, candidate:$candidate}' \
    > "${next_file}"
  mv "${next_file}" "${result_file}"
}

valid_report() {
  local report="$1"
  jq -e '
    type == "object"
    and (.pass | type == "boolean")
    and (.kernelOk | type == "boolean")
    and (.issues | type == "array")
    and all(.issues[];
      type == "object"
      and (.kind == "meaning" or .kind == "style")
      and (.quote | type == "string")
      and (.problem | type == "string")
    )
  ' "${report}" >/dev/null 2>&1
}

report_passes() {
  local report="$1"
  jq -e '.pass and .kernelOk and (.issues | length == 0)' "${report}" >/dev/null 2>&1
}

terminal_outcome() {
  local report="$1"
  if jq -e '(.kernelOk | not) or any(.issues[]; .kind == "meaning")' \
    "${report}" >/dev/null 2>&1; then
    printf '%s\n' "blocked"
  else
    printf '%s\n' "needs-review"
  fi
}

build_check_prompt() {
  local prompt="$1"
  local previous_report="${2:-}"
  cp "${brief_file}" "${prompt}"
  {
    printf '\n\nWORDTASTE_CHECK\n'
    if [[ -n "${previous_report}" ]]; then
      printf '\nPrevious private issue report:\n'
      command cat "${previous_report}"
    fi
    printf '\nCandidate to check:\n'
    command cat "${candidate_file}"
    printf '\n\nReturn JSON only with this exact shape:\n'
    printf '{"pass":boolean,"kernelOk":boolean,"issues":[{"kind":"meaning|style","quote":"exact quote","problem":"specific problem"}]}\n'
    printf 'Use an empty issues array when clean. Do not add summary, advice, ranking, markdown, or prose outside JSON.\n'
  } >> "${prompt}"
}

build_repair_prompt() {
  local prompt="$1"
  local report="$2"
  cp "${brief_file}" "${prompt}"
  {
    printf '\n\nWORDTASTE_REPAIR\n'
    printf '\nCurrent candidate:\n'
    command cat "${candidate_file}"
    printf '\n\nOne-use private issue report:\n'
    command cat "${report}"
    printf '\n\nRepair only the quoted issues while preserving the frozen meaning and useful surrounding prose.\n'
    printf 'Return the complete repaired prose only. No preface, explanation, list, markdown fence, or afterword.\n'
  } >> "${prompt}"
}

repairs=0
previous_report=""

while true; do
  cycle=$((repairs + 1))
  check_prompt="${private_dir}/${scope}.check-${cycle}.md"
  check_report="${private_dir}/${scope}.report-${cycle}.json"
  check_error="${private_dir}/${scope}.check-${cycle}.stderr"
  build_check_prompt "${check_prompt}" "${previous_report}"

  if ! "${script_dir}/run_leaf.sh" checker "${check_prompt}" \
    > "${check_report}" 2> "${check_error}"; then
    write_result "blocked" "${repairs}"
    exit 0
  fi
  if ! valid_report "${check_report}"; then
    write_result "blocked" "${repairs}"
    exit 0
  fi
  if report_passes "${check_report}"; then
    write_result "accepted" "${repairs}"
    exit 0
  fi
  if (( repairs >= MAX_REPAIR_CYCLES )); then
    write_result "$(terminal_outcome "${check_report}")" "${repairs}"
    exit 0
  fi

  repair_prompt="${private_dir}/${scope}.repair-$((repairs + 1)).md"
  repaired_file="${private_dir}/${scope}.repaired-$((repairs + 1)).md"
  repair_error="${private_dir}/${scope}.repair-$((repairs + 1)).stderr"
  build_repair_prompt "${repair_prompt}" "${check_report}"
  repairs=$((repairs + 1))

  if ! "${script_dir}/run_leaf.sh" repair "${repair_prompt}" "${scope}" \
    > "${repaired_file}" 2> "${repair_error}"; then
    write_result "$(terminal_outcome "${check_report}")" "${repairs}"
    exit 0
  fi
  if [[ ! -s "${repaired_file}" ]]; then
    write_result "blocked" "${repairs}"
    exit 0
  fi

  mv "${repaired_file}" "${candidate_file}"
  previous_report="${check_report}"
done
