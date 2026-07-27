#!/usr/bin/env bash
#
# Project a sanitized check-cycle result into canonical WordTaste files.
#
# Usage:
#   project_check_cycle.sh unit <result-file> <workflow-file> <candidate-file> <unit-id>
#   project_check_cycle.sh whole <result-file> <workflow-file> <candidate-file>
#
# The command emits nothing. Raw reports remain private; workflow.json receives
# only stable, plain-language state.

set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "wordtaste: check projection — invalid invocation" >&2
  exit 2
fi

mode="$1"
result_file="$2"
workflow_file="$3"
candidate_file="$4"
unit_id="${5:-}"
session_root="${PNEUMA_SESSION_DIR:-.}"
session_root="$(cd -P "${session_root}" && pwd -P)"
draft_file="${session_root}/draft.md"
private_dir="${WORDTASTE_PRIVATE_DIR:-${session_root}/.pneuma/private}"
private_dir="$(cd -P "${private_dir}" && pwd -P)"

if [[ ! -s "${result_file}" || ! -s "${workflow_file}" || ! -s "${candidate_file}" ]]; then
  echo "wordtaste: check projection — required private input is missing" >&2
  exit 2
fi
if [[ "${mode}" != "unit" && "${mode}" != "whole" ]]; then
  echo "wordtaste: check projection — mode must be unit or whole" >&2
  exit 2
fi
if [[ "${mode}" == "unit" && ! "${unit_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "wordtaste: check projection — invalid unit id" >&2
  exit 2
fi
candidate_file="$(cd -P "$(dirname "${candidate_file}")" && pwd -P)/$(basename "${candidate_file}")"
result_file="$(cd -P "$(dirname "${result_file}")" && pwd -P)/$(basename "${result_file}")"
if [[ "${candidate_file}" != "${private_dir}/"* ||
  "${result_file}" != "${private_dir}/"* ]]; then
  echo "wordtaste: check projection — candidate and result must stay private" >&2
  exit 2
fi

outcome="$(jq -r '.outcome // empty' "${result_file}")"
scope="$(jq -r '.scope // empty' "${result_file}")"
original_file="$(jq -r '.original // empty' "${result_file}")"
if [[ ! "${scope}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "wordtaste: check projection — invalid private result" >&2
  exit 2
fi

next_workflow="${workflow_file}.tmp.$$"

case "${outcome}" in
  accepted)
    if [[ "${mode}" == "whole" ]]; then
      cp "${candidate_file}" "${draft_file}"
      jq '
        .stage = "final"
        | .review.summary = "全文检查完成。"
        | .review.issues = []
        | .progress.note = "正文已完成，等待阅读确认。"
        | .layout.openQuestion = "请阅读正文；若有一句仍显得不真，可以直接选中它。"
      ' "${workflow_file}" > "${next_workflow}"
    else
      if [[ -s "${draft_file}" ]]; then
        printf '\n\n' >> "${draft_file}"
        command cat "${candidate_file}" >> "${draft_file}"
      else
        cp "${candidate_file}" "${draft_file}"
      fi
      jq --arg unit "${unit_id}" '
        .progress.currentUnit = ""
        | .progress.completedUnits = (((.progress.completedUnits // []) + [$unit]) | unique)
        | .progress.note = "当前单元检查完成。"
      ' "${workflow_file}" > "${next_workflow}"
    fi
    ;;
  blocked)
    jq '
      .stage = "review"
      | .review.summary = "中心判断、事实或限定仍未稳定，当前版本暂不进入终稿。"
      | .review.issues = ["需要重新确认意义是否完整保留。"]
      | .progress.note = "有限修复后仍有意义问题。"
    ' "${workflow_file}" > "${next_workflow}"
    ;;
  needs-review)
    if [[ ! -s "${original_file}" ]]; then
      echo "wordtaste: check projection — original candidate is missing" >&2
      exit 2
    fi
    choice_dir="${session_root}/candidates/${scope}"
    mkdir -p "${choice_dir}"
    cp "${original_file}" "${choice_dir}/A.md"
    cp "${candidate_file}" "${choice_dir}/B.md"
    jq --arg a "candidates/${scope}/A.md" --arg b "candidates/${scope}/B.md" '
      .stage = "choice"
      | .candidates = [
          {"label":"A","file":$a},
          {"label":"B","file":$b}
        ]
      | .layout.openQuestion = "两版各有取舍，请按阅读感受选择。"
      | .progress.note = "有限修复后仍有主观取舍，等待选择。"
    ' "${workflow_file}" > "${next_workflow}"
    ;;
  *)
    echo "wordtaste: check projection — invalid private result" >&2
    exit 2
    ;;
esac

mv "${next_workflow}" "${workflow_file}"
exit 0
