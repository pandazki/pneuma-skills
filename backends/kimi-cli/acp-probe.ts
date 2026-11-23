const TTL_MS = 60_000;
const probes = new Map<string, { result: Promise<boolean>; expiresAt: number }>();

async function supportsAcp(binaryPath: string): Promise<boolean> {
  try {
    const child = Bun.spawn([binaryPath, "acp", "--help"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
}

/** Concurrent launcher requests share the process. Cache its answer for a minute after exit. */
export function probeAcpSubcommand(binaryPath: string): Promise<boolean> {
  const cached = probes.get(binaryPath);
  if (cached && Date.now() < cached.expiresAt) return cached.result;
  const entry = { result: supportsAcp(binaryPath), expiresAt: Infinity };
  probes.set(binaryPath, entry);
  void entry.result.then(() => { entry.expiresAt = Date.now() + TTL_MS; });
  return entry.result;
}
