#!/usr/bin/env bash
#
# cross_family_probe.sh — detect which model-family CLIs are actually USABLE and
# write the result to .pneuma/cross-family.json. The palate viewer reads this
# memory source to render the family-availability banner and gate its
# cross-family affordances; the agent reads it to plan how it generates.
#
# Run this on the agent's first turn (SKILL.md step 0). It probes the CLIs the
# orchestrator can shell out to as separate, naturally-isolated processes:
#   - claude : the in-family generator (Task subagent when this IS the backend,
#              else the `claude` CLI).
#   - codex  : GPT family (`codex exec`).
#   - gemini : Gemini family (neutral third-party judge / generator).
#
# Liveness, not PATH-presence: a CLI can be installed yet unusable — e.g.
# gemini on PATH but UNAUTHENTICATED, whose non-interactive call falls into an
# interactive OAuth flow that hangs forever. PATH alone over-reports it as
# available, so the banner/agent would claim "full engine" against a CLI that
# hangs on first real use. Instead, for each CLI present on PATH we run a
# trivial non-interactive invocation wrapped in a HARD timeout:
#   - returns success (exit 0) within the timeout → true
#   - times out, errors, or needs interactive auth → false
#
# The probe MUST NOT hang under any circumstance (that is the whole point) and
# always exits 0 writing valid JSON — an unusable family is a normal degraded
# state (single-family mode), not an error the agent should abort on.
#
# Output target resolution (first writable wins):
#   1. $PNEUMA_SESSION_DIR/.pneuma/cross-family.json  (session dir, preferred)
#   2. ./.pneuma/cross-family.json                    (cwd fallback)

set -euo pipefail

# Per-family liveness timeout (seconds). A clean CLI answers well within this;
# an unauthenticated/hanging one is killed at the boundary and reported false.
# The three families are probed in PARALLEL, so the whole probe finishes in
# roughly this bound (the slowest single family), not the sum.
PROBE_TIMEOUT="${PALATE_PROBE_TIMEOUT:-6}"

# --- resolve the output path ------------------------------------------------
out_dir=""
if [[ -n "${PNEUMA_SESSION_DIR:-}" && -d "${PNEUMA_SESSION_DIR}" ]]; then
  out_dir="${PNEUMA_SESSION_DIR}/.pneuma"
else
  out_dir="./.pneuma"
fi

if ! mkdir -p "${out_dir}" 2>/dev/null; then
  echo "palate: cross_family_probe — cannot create ${out_dir}" >&2
  exit 1
fi
out_file="${out_dir}/cross-family.json"

# --- portable hard timeout --------------------------------------------------
# macOS ships no `timeout`/`gtimeout` and bash 3.2 (no `wait -n`), so we run the
# command in the background, poll for completion, and SIGTERM→SIGKILL it at the
# deadline. Returns the command's exit status, or a non-zero status on timeout.
# stdout/stderr of the inner command are discarded — we only care about success.
run_with_timeout() {
  local secs="$1"; shift
  "$@" >/dev/null 2>&1 &
  local pid=$!
  local waited=0
  # Poll in 0.2s steps so a fast clean CLI returns promptly.
  while kill -0 "${pid}" 2>/dev/null; do
    if [[ "${waited}" -ge $(( secs * 5 )) ]]; then
      # Kill (graceful, then hard) and reap INSIDE a stderr-suppressed group so
      # the shell's async "Terminated" job notice never leaks to our stderr —
      # the probe's only intended output is the JSON + one summary log line.
      {
        kill -TERM "${pid}" || true
        sleep 0.3
        kill -KILL "${pid}" || true
        wait "${pid}" || true
      } >/dev/null 2>&1
      return 124  # conventional timeout exit code
    fi
    sleep 0.2
    waited=$(( waited + 1 ))
  done
  wait "${pid}"  # propagate the real exit status of the finished command
}

# Probe one family by name: false if not on PATH; otherwise run its cheapest
# auth-exercising liveness command under the hard timeout and map exit 0 → true.
probe_family() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "false"
    return 0
  fi

  # Cheapest non-interactive call that actually exercises auth per CLI:
  #   codex  — `login status` reports auth state directly (no model spend).
  #   claude — a minimal `-p` print call (a real, in-family generation hop).
  #   gemini — a minimal `-p` print call; when unauthenticated this is exactly
  #            the interactive-OAuth path that hangs, so the timeout is what
  #            turns "installed but unusable" into a clean false.
  local status=1
  case "${name}" in
    codex)
      run_with_timeout "${PROBE_TIMEOUT}" codex login status
      status=$?
      ;;
    claude)
      run_with_timeout "${PROBE_TIMEOUT}" claude -p "ping" --output-format text
      status=$?
      ;;
    gemini)
      run_with_timeout "${PROBE_TIMEOUT}" gemini -p "ping" --output-format text
      status=$?
      ;;
    *)
      # Unknown family: a bare --version proves install but not auth; be
      # conservative and only trust a clean run.
      run_with_timeout "${PROBE_TIMEOUT}" "${name}" --version
      status=$?
      ;;
  esac

  if [[ "${status}" -eq 0 ]]; then
    echo "true"
  else
    echo "false"
  fi
}

# --- probe each family (in parallel) ----------------------------------------
# Each family's liveness check is independent and the slow one (an
# unauthenticated CLI killed at the timeout) dominates, so run all three at
# once and join — the whole probe then finishes in ~PROBE_TIMEOUT, not 3×.
# Each writes its single-word result ("true"/"false") to a temp file; we read
# them back after the joins.
work_tmp="$(mktemp -d -t palate-probe-XXXXXX)"
cleanup() { rm -rf "${work_tmp}"; }
trap cleanup EXIT

probe_family claude > "${work_tmp}/claude" &
pid_claude=$!
probe_family codex > "${work_tmp}/codex" &
pid_codex=$!
probe_family gemini > "${work_tmp}/gemini" &
pid_gemini=$!

# `wait` on each pid; probe_family itself never fails (always echoes a word and
# returns 0), so `|| true` is belt-and-braces against a killed subshell.
wait "${pid_claude}" 2>/dev/null || true
wait "${pid_codex}" 2>/dev/null || true
wait "${pid_gemini}" 2>/dev/null || true

# Read back, defaulting to false if a result file is somehow missing/empty.
read_result() {
  local f="$1"
  local v="false"
  if [[ -s "${f}" ]]; then
    v="$(cat "${f}")"
  fi
  [[ "${v}" == "true" ]] && echo "true" || echo "false"
}
claude="$(read_result "${work_tmp}/claude")"
codex="$(read_result "${work_tmp}/codex")"
gemini="$(read_result "${work_tmp}/gemini")"

# --- write the result -------------------------------------------------------
# Hand-rolled JSON keeps the script dependency-free (no jq). The shape matches
# the `crossFamily` memory source's initial value in manifest.ts.
cat > "${out_file}" <<JSON
{
  "claude": ${claude},
  "codex": ${codex},
  "gemini": ${gemini}
}
JSON

echo "palate: cross-family probe (liveness) → claude=${claude} codex=${codex} gemini=${gemini} (wrote ${out_file})" >&2
exit 0
