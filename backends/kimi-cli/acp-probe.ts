const probes = new Map<string, Promise<boolean>>();

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

/** Share concurrent subprocesses. The next request can observe an install or upgrade. */
export function probeAcpSubcommand(binaryPath: string): Promise<boolean> {
  const pending = probes.get(binaryPath);
  if (pending) return pending;
  const result = supportsAcp(binaryPath).finally(() => probes.delete(binaryPath));
  probes.set(binaryPath, result);
  return result;
}
