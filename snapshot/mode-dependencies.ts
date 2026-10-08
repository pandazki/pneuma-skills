import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PENDING_INSTALL = ".pneuma-install-pending";
const RETRY_DELAYS_MS = [500, 1500];
const INSTALL_TIMEOUT_MS = 60_000;

type InstallResult = { exitCode: number; stderr: string };

async function runInstall(modeDir: string): Promise<InstallResult> {
  // Use the same Bun as the host, including the desktop's bundled runtime.
  const proc = Bun.spawn([process.execPath, "install"], {
    cwd: modeDir,
    stdout: "ignore",
    stderr: "pipe",
  });
  let timedOut = false;
  const reader = proc.stderr.getReader();
  const stderr = (async () => {
    const decoder = new TextDecoder();
    let text = "";
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return text + decoder.decode();
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  })();
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
    // An install script may have inherited stderr. Stop waiting on that
    // pipe too; killing Bun alone does not prove its descendants exited.
    void reader.cancel().catch((error) => console.warn("[mode-build] Could not close installer stderr:", error));
  }, INSTALL_TIMEOUT_MS);
  try {
    // Drain stderr while the process runs; a full pipe must not block exit.
    const [exitCode, output] = await Promise.all([
      proc.exited,
      stderr,
    ]);
    return { exitCode: timedOut ? 1 : exitCode, stderr: timedOut ? `Dependency installation timed out.\n${output}` : output };
  } finally {
    clearTimeout(timer);
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }
}

/** Network failures may recover; bad versions, permissions and scripts need a fix. */
export function isTransientInstallError(message: string): boolean {
  // A killed installer may have been running a lifecycle script; its effects
  // are uncertain, so leave that attempt to explicit user recovery.
  if (message.startsWith("Dependency installation timed out.")) return false;
  if (/\b(?:preinstall|postinstall|prepare|install) script\b|\bEACCES\b|\bEPERM\b|No version matching/i.test(message)) return false;
  return /CERTIFICATE|\bTLS\b|\bSSL\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|timed?\s*out|connection (?:closed|reset)|failed to connect|(?:HTTP|status|GET).*\b(?:429|50[0234])\b/i.test(message);
}

/** A failed/interrupted install remains pending even if it created node_modules. */
export async function ensureModeDependencies(
  modeDir: string,
  io: {
    force?: boolean;
    run?: (modeDir: string) => Promise<InstallResult>;
    wait?: (ms: number) => Promise<unknown>;
  } = {},
): Promise<void> {
  const marker = join(modeDir, PENDING_INSTALL);
  if (!existsSync(join(modeDir, "package.json"))) return;
  if (!io.force && existsSync(join(modeDir, "node_modules")) && !existsSync(marker)) return;

  writeFileSync(marker, "Dependency installation has not completed.\n");
  const run = io.run ?? runInstall;
  const wait = io.wait ?? Bun.sleep;
  for (let attempt = 0; ; attempt++) {
    const result = await run(modeDir);
    if (result.exitCode === 0) {
      // Another session may have completed the same install first.
      rmSync(marker, { force: true });
      return;
    }
    const error = `bun install failed (exit ${result.exitCode}): ${result.stderr.trim()}`;
    if (attempt >= RETRY_DELAYS_MS.length || !isTransientInstallError(result.stderr)) {
      throw new Error(error);
    }
    console.warn(`[mode-build] Dependency download failed; retrying (${attempt + 2}/3).\n${error}`);
    await wait(RETRY_DELAYS_MS[attempt]);
  }
}
