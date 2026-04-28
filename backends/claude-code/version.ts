/**
 * Claude Code CLI version compatibility check.
 *
 * Pneuma's claude-code backend bridges traffic via the hidden `--sdk-url`
 * WebSocket transport, which Anthropic deprecated and removed in CC 2.1.118
 * (PR anthropics/claude-code#28334). Until we move to the new transport,
 * we treat any installed CC ≥ this break point as unavailable so the
 * launcher can disable the option with an explanation instead of letting
 * users start a doomed session.
 *
 * Non-cached on purpose — the launcher only probes during /api/backends,
 * which is rare; spawning `claude --version` adds ~50 ms once.
 */

/** First Claude Code release that removed `--sdk-url`. */
export const CLAUDE_CODE_BREAK_VERSION = "2.1.118";

/**
 * Probe the installed Claude Code binary for its version. Returns the
 * dotted MAJOR.MINOR.PATCH string, or null when the binary is missing,
 * failed, or printed something unparsable.
 */
export function probeClaudeCodeVersion(binaryPath: string): string | null {
  try {
    const result = Bun.spawnSync({
      cmd: [binaryPath, "--version"],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CLAUDECODE: "" },
    });
    if (result.exitCode !== 0) return null;
    const text = new TextDecoder().decode(result.stdout);
    const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return `${match[1]}.${match[2]}.${match[3]}`;
  } catch {
    return null;
  }
}

/** Numeric semver compare. Returns negative / zero / positive like Array.sort. */
export function semverCmp(a: string, b: string): number {
  const ap = a.split(".").map((n) => parseInt(n, 10) || 0);
  const bp = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * True when the given Claude Code version still ships the `--sdk-url`
 * transport Pneuma relies on (i.e. strictly less than the break point).
 * Unparsable / unknown versions return true so we don't block users on
 * a probe failure.
 */
export function isClaudeCodeCompatible(version: string | null): boolean {
  if (!version) return true;
  return semverCmp(version, CLAUDE_CODE_BREAK_VERSION) < 0;
}
