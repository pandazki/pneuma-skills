/**
 * GitHub CLI bridge — auth-detection + repo-create wrapper.
 *
 * Pneuma's author-side flow leans on a working local `gh` install (with
 * `gh auth login` already done). This module is the thin layer that
 * answers "is gh ready?" for the settings UI and runs the few gh
 * commands we actually invoke.
 *
 * No PAT fallback in v1 — when gh is missing or unauthenticated, the
 * settings panel surfaces an install hint. The `library push` path
 * still works through whatever git credentials the user has set up
 * (gh credential helper, ssh, system keychain), it just won't help
 * configure them.
 */

const GH_PROBE_TIMEOUT_MS = 5_000;

export interface GhStatus {
  /** True when `gh` is on PATH and responds to `gh --version`. */
  installed: boolean;
  /** True when `gh auth status` reports an active session. */
  authenticated: boolean;
  /** Login handle from `gh api user` when authenticated. */
  username?: string;
  /** Resolved gh version string (best-effort). */
  version?: string;
  /** When installed=false or authenticated=false, a friendly remediation. */
  hint?: string;
}

/**
 * Probe local `gh` install + auth. Best-effort and fast — every value is
 * optional so a partial probe (e.g. gh present but `gh api user` slow)
 * still yields useful UI state.
 *
 * Cached per-call: callers (the launcher settings panel, the CLI's `library
 * status` summary) hit this every few seconds at worst.
 */
export async function detectGh(): Promise<GhStatus> {
  // Step 1 — `gh --version`. Fast, no network. Use it as the installed
  // probe.
  let version: string | undefined;
  try {
    const proc = Bun.spawn(["gh", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exited = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) =>
        setTimeout(() => {
          try {
            proc.kill();
          } catch {
            /* ignore */
          }
          resolve(1);
        }, GH_PROBE_TIMEOUT_MS),
      ),
    ]);
    if (exited === 0) {
      const out = await new Response(proc.stdout).text();
      const match = out.match(/gh version ([^\s]+)/);
      version = match ? match[1] : undefined;
    }
  } catch {
    // `gh` not on PATH → fall through to "not installed".
  }

  if (!version) {
    return {
      installed: false,
      authenticated: false,
      hint: "Install the GitHub CLI to publish libraries: https://cli.github.com/ (e.g. `brew install gh`).",
    };
  }

  // Step 2 — `gh auth status`. Slower (touches keyring), but still local.
  // We discriminate three results: authenticated / unauthenticated /
  // probe-failed. Probe-failed is reported as unauthenticated with a
  // generic hint, since the UX is the same.
  let authed = false;
  try {
    const proc = Bun.spawn(["gh", "auth", "status"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exited = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) =>
        setTimeout(() => {
          try {
            proc.kill();
          } catch {
            /* ignore */
          }
          resolve(1);
        }, GH_PROBE_TIMEOUT_MS),
      ),
    ]);
    authed = exited === 0;
  } catch {
    authed = false;
  }

  if (!authed) {
    return {
      installed: true,
      authenticated: false,
      version,
      hint: "Sign in with `gh auth login` to enable library publish.",
    };
  }

  // Step 3 — `gh api user`. Optional; just gives the settings panel a name
  // to show.
  let username: string | undefined;
  try {
    const proc = Bun.spawn(["gh", "api", "user", "--jq", ".login"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exited = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) =>
        setTimeout(() => {
          try {
            proc.kill();
          } catch {
            /* ignore */
          }
          resolve(1);
        }, GH_PROBE_TIMEOUT_MS),
      ),
    ]);
    if (exited === 0) {
      const out = (await new Response(proc.stdout).text()).trim();
      if (out) username = out;
    }
  } catch {
    // Non-fatal — we have authenticated=true already.
  }

  return {
    installed: true,
    authenticated: true,
    version,
    ...(username ? { username } : {}),
  };
}

// ── Repo creation ───────────────────────────────────────────────────────────

export interface CreateRepoOptions {
  /** `<user>/<repo>` or just `<repo>` (uses gh's default owner). */
  name: string;
  /** Public or private. Default "public". */
  visibility?: "public" | "private";
  /** Path to the local directory to push as the initial commit. */
  sourcePath: string;
  /** Optional one-line repo description. */
  description?: string;
}

export interface CreateRepoResult {
  /** Resolved `<owner>/<repo>` slug. */
  fullName: string;
  /** HTTPS URL (gh prints this on success). */
  url: string;
}

/**
 * Create a GitHub repo and push the source dir as the initial commit.
 * Runs `gh repo create … --source --push` in one shot, then captures the
 * resulting URL from stdout.
 *
 * Requires `gh` installed AND authenticated. Throws with a friendly hint
 * when either is missing — callers (CLI + UI) surface that text directly.
 */
export async function createRepo(opts: CreateRepoOptions): Promise<CreateRepoResult> {
  const status = await detectGh();
  if (!status.installed) {
    throw new Error(
      status.hint || "GitHub CLI not installed. Install it from https://cli.github.com/",
    );
  }
  if (!status.authenticated) {
    throw new Error(
      status.hint || "Not signed in to GitHub. Run `gh auth login` first.",
    );
  }

  const visibility = opts.visibility ?? "public";
  const args = [
    "repo",
    "create",
    opts.name,
    `--${visibility}`,
    "--source",
    opts.sourcePath,
    "--push",
  ];
  if (opts.description) {
    args.push("--description", opts.description);
  }

  const proc = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exited = await proc.exited;
  const stdout = (await new Response(proc.stdout).text()).trim();
  const stderr = (await new Response(proc.stderr).text()).trim();
  if (exited !== 0) {
    throw new Error(
      `gh repo create failed (exit ${exited}): ${stderr || stdout || "unknown error"}`,
    );
  }

  // gh prints the URL on success. Pull it out, and also try `gh repo
  // view --json` as a fallback in case the output format ever changes.
  const urlMatch = stdout.match(/https?:\/\/github\.com\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : `https://github.com/${opts.name}`;
  const fullName = url.replace(/^https?:\/\/github\.com\//, "");

  return { fullName, url };
}
